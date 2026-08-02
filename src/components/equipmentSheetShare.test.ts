import assert from 'node:assert/strict';
import {
  EQUIPMENT_LIBRARY_SHARE_TYPE,
  EQUIPMENT_SHARE_EMPTY_PAYLOAD_ERROR,
  EQUIPMENT_SHARE_INVALID_FILE_ERROR,
  buildEquipmentLibraryShareFile,
  mergeEquipmentLibraryShare,
  parseEquipmentLibraryShare,
  resolveEquipmentShareSelection,
  type EquipmentLibraryShareFile,
} from './equipmentSheetShare';
import type {
  EquipmentGearSet,
  EquipmentLibrary,
} from './equipmentSheetModel';

function makeGearSet(
  gearSetId: string,
  name: string,
  overrides: Partial<EquipmentGearSet> = {},
): EquipmentGearSet {
  return {
    gearSetId,
    name,
    buffId: `buff-${gearSetId}`,
    imgUrl: `/sets/${gearSetId}.png`,
    equipments: {},
    ...overrides,
  };
}

const alphaSet = makeGearSet('gear-set-alpha', 'Alpha 套装', {
  imgUrl: '/sets/alpha-custom.png',
  equipments: {
    'equipment-alpha': {
      equipmentId: 'equipment-alpha',
      name: '不能作为分享 label 的装备标题',
      part: '护甲',
      imgUrl: '/equipment/alpha-custom.png',
      effects: {},
    },
  },
});
const betaSet = makeGearSet('gear-set-beta', 'Beta 套装');
const exportLibrary: EquipmentLibrary = {
  updatedAt: '2026-08-03T01:00:00.000Z',
  migration: {
    source: 'fixture',
    warnings: ['保留'],
    reviewRequired: true,
  },
  gearSets: {
    [alphaSet.gearSetId]: alphaSet,
    [betaSet.gearSetId]: betaSet,
  },
};

assert.equal(EQUIPMENT_LIBRARY_SHARE_TYPE, 'equipment-library-share.v1');
assert.equal(EQUIPMENT_SHARE_INVALID_FILE_ERROR, '导入失败：文件不是有效的装备库分享 JSON。');
assert.equal(EQUIPMENT_SHARE_EMPTY_PAYLOAD_ERROR, 'JSON 中没有可导入的有效套装。');

const currentExport = buildEquipmentLibraryShareFile({
  library: exportLibrary,
  scope: 'current',
  selectedGearSetId: alphaSet.gearSetId,
});
assert.equal(currentExport.type, EQUIPMENT_LIBRARY_SHARE_TYPE);
assert.equal(currentExport.label, 'Alpha 套装');
assert.deepEqual(Object.keys(currentExport.payload), ['gear-set-alpha']);
assert.strictEqual(currentExport.payload['gear-set-alpha'], alphaSet);
assert.equal(currentExport.payload['gear-set-alpha'].imgUrl, '/sets/alpha-custom.png');
assert.equal(
  currentExport.payload['gear-set-alpha'].equipments['equipment-alpha'].imgUrl,
  '/equipment/alpha-custom.png',
);
assert.equal(typeof currentExport.exportedAt, 'number');

const missingCurrentExport = buildEquipmentLibraryShareFile({
  library: exportLibrary,
  scope: 'current',
  selectedGearSetId: 'gear-set-missing',
});
assert.equal(missingCurrentExport.label, 'equipment-library');
assert.deepEqual(Object.keys(missingCurrentExport.payload), ['gear-set-alpha', 'gear-set-beta']);

const allExport = buildEquipmentLibraryShareFile({
  library: exportLibrary,
  scope: 'all',
  selectedGearSetId: alphaSet.gearSetId,
});
assert.equal(allExport.label, 'equipment-library');
assert.deepEqual(allExport.payload, exportLibrary.gearSets);
assert.equal(allExport.payload['gear-set-alpha'].imgUrl, '/sets/alpha-custom.png');

assert.deepEqual(parseEquipmentLibraryShare('{malformed'), {
  ok: false,
  error: EQUIPMENT_SHARE_INVALID_FILE_ERROR,
});
assert.deepEqual(parseEquipmentLibraryShare(JSON.stringify({
  type: 'weapon-library-share.v1',
  payload: {},
})), {
  ok: false,
  error: EQUIPMENT_SHARE_INVALID_FILE_ERROR,
});
assert.deepEqual(parseEquipmentLibraryShare(JSON.stringify({
  type: EQUIPMENT_LIBRARY_SHARE_TYPE,
  payload: [],
})), {
  ok: false,
  error: EQUIPMENT_SHARE_INVALID_FILE_ERROR,
});
assert.deepEqual(parseEquipmentLibraryShare(JSON.stringify({
  type: EQUIPMENT_LIBRARY_SHARE_TYPE,
  payload: 42,
})), {
  ok: false,
  error: EQUIPMENT_SHARE_INVALID_FILE_ERROR,
});

const mixedResult = parseEquipmentLibraryShare(JSON.stringify({
  type: EQUIPMENT_LIBRARY_SHARE_TYPE,
  exportedAt: 123,
  label: ' 混合装备分享 ',
  payload: {
    nullEntry: null,
    numberEntry: 42,
    stringEntry: 'not-a-set',
    booleanEntry: true,
    arrayEntry: [],
    'gear-set-outer': {
      gearSetId: 'gear-set-inner-must-lose',
      name: '外层 ID 套装',
      buffId: 'buff-imported',
      imgUrl: '/sets/imported.png',
      equipments: {
        'equipment-imported': {
          equipmentId: 'equipment-imported',
          name: '导入装备',
          part: 'invalid-part',
          imgUrl: '/equipment/imported.png',
          fixedStat: {
            label: '旧固定属性',
            typeKey: 'invalid-fixed-type',
            value: '42',
            unit: 'invalid-unit',
          },
          effects: {
            effect1: {
              effectId: 'wrong-effect-id',
              label: '旧效果',
              typeKey: 'strengthBoost',
              category: 'invalid-category',
              unit: 'flat',
              levels: { '0': '12', '1': 'not-a-number' },
            },
          },
        },
      },
    },
  },
}));
assert.equal(mixedResult.ok, true);
if (!mixedResult.ok) {
  throw new Error(mixedResult.error);
}
assert.equal(mixedResult.shareFile.exportedAt, 123);
assert.equal(mixedResult.shareFile.label, '混合装备分享');
assert.deepEqual(Object.keys(mixedResult.shareFile.payload), ['gear-set-outer']);
const mixedSet = mixedResult.shareFile.payload['gear-set-outer'];
assert.equal(mixedSet.gearSetId, 'gear-set-outer');
assert.equal(mixedSet.name, '外层 ID 套装');
assert.equal(mixedSet.imgUrl, '/sets/imported.png');
const mixedEquipment = mixedSet.equipments['equipment-imported'];
assert.equal(mixedEquipment.part, '配件');
assert.equal(mixedEquipment.imgUrl, '/equipment/imported.png');
assert.equal(mixedEquipment.fixedStat?.typeKey, 'defense');
assert.equal(mixedEquipment.fixedStat?.value, 42);
assert.equal(mixedEquipment.effects.effect1?.effectId, 'effect1');
assert.equal(mixedEquipment.effects.effect1?.category, 'buff');
assert.deepEqual(mixedEquipment.effects.effect1?.levels, { '0': 12 });

const canonicalShareResult = parseEquipmentLibraryShare(JSON.stringify({
  type: EQUIPMENT_LIBRARY_SHARE_TYPE,
  payload: {
    'gear-set-canonical': {
      schemaVersion: 2,
      gearSetId: 'gear-set-canonical',
      name: 'Canonical 套装',
      equipments: {
        'equipment-canonical': {
          equipmentId: 'equipment-canonical',
          name: 'Canonical 装备',
          part: '配件',
          effects: {
            effect1: {
              effectId: 'effect1',
              label: '自定义百分比',
              typeKey: 'physicalDmgBonus',
              category: 'buff',
              levels: { '0': 2 },
              unit: 'percent',
              raw: '伤害：+20%',
            },
          },
        },
      },
    },
  },
}));
assert.equal(canonicalShareResult.ok, true);
if (!canonicalShareResult.ok) throw new Error(canonicalShareResult.error);
assert.equal(
  canonicalShareResult.shareFile.payload['gear-set-canonical']
    .equipments['equipment-canonical']
    .effects.effect1?.levels['0'],
  2,
  'schema-marked shares must not rerun legacy percent migration',
);

const collisionResult = parseEquipmentLibraryShare(JSON.stringify({
  type: EQUIPMENT_LIBRARY_SHARE_TYPE,
  payload: {
    'gear-set-collision': {
      gearSetId: 'gear-set-inner-one',
      name: '碰撞一',
      equipments: {},
    },
    ' gear-set-collision ': {
      gearSetId: 'gear-set-inner-two',
      name: '碰撞二',
      equipments: {},
    },
  },
}));
assert.equal(collisionResult.ok, true);
if (!collisionResult.ok) {
  throw new Error(collisionResult.error);
}
assert.deepEqual(Object.keys(collisionResult.shareFile.payload), [
  'gear-set-collision',
  'gear-set-collision-2',
]);
assert.equal(collisionResult.shareFile.payload['gear-set-collision'].name, '碰撞一');
assert.equal(collisionResult.shareFile.payload['gear-set-collision-2'].name, '碰撞二');
Object.entries(collisionResult.shareFile.payload).forEach(([gearSetId, gearSet]) => {
  assert.equal(gearSet.gearSetId, gearSetId);
});

assert.deepEqual(parseEquipmentLibraryShare(JSON.stringify({
  type: EQUIPMENT_LIBRARY_SHARE_TYPE,
  payload: {},
})), {
  ok: false,
  error: EQUIPMENT_SHARE_EMPTY_PAYLOAD_ERROR,
});
assert.deepEqual(parseEquipmentLibraryShare(JSON.stringify({
  type: EQUIPMENT_LIBRARY_SHARE_TYPE,
  payload: {
    nullEntry: null,
    primitiveEntry: 1,
    arrayEntry: [],
  },
})), {
  ok: false,
  error: EQUIPMENT_SHARE_EMPTY_PAYLOAD_ERROR,
});

const existingSet = makeGearSet('gear-set-existing', '保留的现有套装', {
  equipments: {
    'equipment-existing': {
      equipmentId: 'equipment-existing',
      name: '旧百分比装备',
      part: '护甲',
      effects: {
        effect1: {
          effectId: 'effect1',
          label: '不得二次迁移',
          typeKey: 'physicalDmgBonus',
          category: 'buff',
          levels: { '0': 2 },
          unit: 'percent',
          raw: '伤害：+20%',
        },
      },
    },
  },
});
const oldOverrideSet = makeGearSet('gear-set-override', '等待覆盖');
const currentLibrary: EquipmentLibrary = {
  updatedAt: 'keep-updated-at',
  migration: {
    source: 'keep-migration',
    migratedAt: 'keep-migrated-at',
    warnings: ['keep-warning'],
    reviewRequired: true,
  },
  gearSets: {
    [existingSet.gearSetId]: existingSet,
    [oldOverrideSet.gearSetId]: oldOverrideSet,
  },
};
const importedOverrideSet = makeGearSet('gear-set-override', '覆盖完成', {
  imgUrl: '/sets/override-imported.png',
});
const importedNewSet = makeGearSet('gear-set-new-import', '新增导入');
const importedPayload = {
  [importedOverrideSet.gearSetId]: importedOverrideSet,
  [importedNewSet.gearSetId]: importedNewSet,
};
const importShareFile: EquipmentLibraryShareFile = {
  type: EQUIPMENT_LIBRARY_SHARE_TYPE,
  exportedAt: 456,
  label: '导入套装',
  payload: importedPayload,
};
const currentBeforeMerge = structuredClone(currentLibrary);
const payloadBeforeMerge = structuredClone(importedPayload);
const mergedLibrary = mergeEquipmentLibraryShare(currentLibrary, importShareFile);
assert.equal(mergedLibrary.updatedAt, 'keep-updated-at');
assert.deepEqual(mergedLibrary.migration, currentLibrary.migration);
assert.deepEqual(Object.keys(mergedLibrary.gearSets), [
  'gear-set-existing',
  'gear-set-override',
  'gear-set-new-import',
]);
assert.equal(mergedLibrary.gearSets['gear-set-override'].name, '覆盖完成');
assert.equal(mergedLibrary.gearSets['gear-set-override'].imgUrl, '/sets/override-imported.png');
assert.equal(mergedLibrary.gearSets['gear-set-new-import'].name, '新增导入');
assert.equal(
  mergedLibrary.gearSets['gear-set-existing'].equipments['equipment-existing'].effects.effect1?.levels['0'],
  2,
  'merge must not re-normalize existing legacy percentage values',
);
assert.strictEqual(mergedLibrary.gearSets['gear-set-existing'], existingSet);
assert.deepEqual(currentLibrary, currentBeforeMerge);
assert.deepEqual(importedPayload, payloadBeforeMerge);
assert.notStrictEqual(mergedLibrary, currentLibrary);
assert.notStrictEqual(mergedLibrary.gearSets, currentLibrary.gearSets);

assert.equal(
  resolveEquipmentShareSelection(importedPayload, 'gear-set-existing', mergedLibrary),
  'gear-set-override',
);
assert.equal(
  resolveEquipmentShareSelection({}, 'gear-set-existing', currentLibrary),
  'gear-set-existing',
);
assert.equal(
  resolveEquipmentShareSelection({}, 'gear-set-missing', currentLibrary),
  'gear-set-existing',
);
assert.equal(
  resolveEquipmentShareSelection({}, 'gear-set-missing', { ...currentLibrary, gearSets: {} }),
  '',
);

console.log('Equipment share build, parse, canonical merge, and selection contract: PASS');
