import assert from 'node:assert/strict';
import { createEmptyWeaponDraft } from './weaponDraftModel';
import {
  WEAPON_LIBRARY_SHARE_TYPE,
  WEAPON_SHARE_EMPTY_PAYLOAD_ERROR,
  WEAPON_SHARE_INVALID_FILE_ERROR,
  buildWeaponDraftLibraryShareFile,
  mergeWeaponDraftLibraryShare,
  parseWeaponDraftLibraryShare,
  resolveWeaponDraftShareSelection,
} from './weaponDraftShare';

const existingDraft = {
  ...createEmptyWeaponDraft('existing'),
  name: '现有武器',
};
const staleDraft = {
  ...existingDraft,
  name: '旧内存值',
};

const currentExport = buildWeaponDraftLibraryShareFile({
  draft: existingDraft,
  library: { existing: staleDraft },
  scope: 'current',
});
assert.equal(currentExport.type, WEAPON_LIBRARY_SHARE_TYPE);
assert.equal(currentExport.label, '现有武器');
assert.deepEqual(currentExport.payload, { existing: existingDraft });
assert.equal(typeof currentExport.exportedAt, 'number');

const allExport = buildWeaponDraftLibraryShareFile({
  draft: existingDraft,
  library: {
    existing: staleDraft,
    second: { ...createEmptyWeaponDraft('second'), name: '第二把武器' },
  },
  scope: 'all',
  libraryLabel: '  全部武器  ',
});
assert.equal(allExport.label, '全部武器');
assert.equal(allExport.payload.existing.name, '现有武器', 'current draft overrides its stale library entry');
assert.equal(allExport.payload.second.name, '第二把武器');

assert.deepEqual(parseWeaponDraftLibraryShare('{broken'), {
  ok: false,
  error: WEAPON_SHARE_INVALID_FILE_ERROR,
});
assert.deepEqual(parseWeaponDraftLibraryShare(JSON.stringify({
  type: 'buff-library-share.v1',
  payload: {},
})), {
  ok: false,
  error: WEAPON_SHARE_INVALID_FILE_ERROR,
});
assert.deepEqual(parseWeaponDraftLibraryShare(JSON.stringify({
  type: WEAPON_LIBRARY_SHARE_TYPE,
  payload: [],
})), {
  ok: false,
  error: WEAPON_SHARE_INVALID_FILE_ERROR,
});
assert.deepEqual(parseWeaponDraftLibraryShare(JSON.stringify({
  type: WEAPON_LIBRARY_SHARE_TYPE,
  payload: {},
})), {
  ok: false,
  error: WEAPON_SHARE_EMPTY_PAYLOAD_ERROR,
});

const parsedResult = parseWeaponDraftLibraryShare(JSON.stringify({
  type: WEAPON_LIBRARY_SHARE_TYPE,
  exportedAt: 123,
  label: ' 导入武器 ',
  payload: {
    imported: {
      id: 'ignored-inner-id',
      name: ' 导入武器 ',
      type: ' 单手剑 ',
      skills: {
        skill3: {
          effectTypes: { legacyEffect: 'physicalDmgBonus' },
          levels: {
            1: { passive: { legacyEffect: 10 } },
            9: { passive: { legacyEffect: 90 } },
          },
        },
      },
    },
  },
}));
assert.equal(parsedResult.ok, true);
if (!parsedResult.ok) {
  throw new Error(parsedResult.error);
}
assert.equal(parsedResult.shareFile.exportedAt, 123);
assert.equal(parsedResult.shareFile.label, '导入武器');
assert.equal(parsedResult.shareFile.payload.imported.id, 'imported');
assert.equal(parsedResult.shareFile.payload.imported.name, '导入武器');
assert.equal(parsedResult.shareFile.payload.imported.type, '单手剑');
assert.deepEqual(
  parsedResult.shareFile.payload.imported.skills.skill3.effects.legacyEffect.levels,
  { 1: 10, 9: 90 },
);

const normalizedUnknownEntry = parseWeaponDraftLibraryShare(JSON.stringify({
  type: WEAPON_LIBRARY_SHARE_TYPE,
  payload: { unknown: {} },
}));
assert.equal(normalizedUnknownEntry.ok, true, 'current LTS normalizes object entries instead of dropping them');
if (!normalizedUnknownEntry.ok) {
  throw new Error(normalizedUnknownEntry.error);
}
assert.equal(normalizedUnknownEntry.shareFile.payload.unknown.id, 'unknown');
assert.equal(normalizedUnknownEntry.shareFile.payload.unknown.name, '未命名武器');

const nextLibrary = mergeWeaponDraftLibraryShare(
  {
    existing: existingDraft,
    imported: { ...existingDraft, id: 'imported', name: '待覆盖' },
  },
  parsedResult.shareFile,
);
assert.deepEqual(Object.keys(nextLibrary), ['existing', 'imported']);
assert.equal(nextLibrary.existing.name, '现有武器');
assert.equal(nextLibrary.imported.name, '导入武器');

assert.equal(resolveWeaponDraftShareSelection(parsedResult.shareFile.payload, 'existing', 'fallback'), 'imported');
assert.equal(resolveWeaponDraftShareSelection({}, 'existing', 'fallback'), 'existing');
assert.equal(resolveWeaponDraftShareSelection({}, '', 'fallback'), 'fallback');

console.log('Weapon share parse and merge contract: PASS');
