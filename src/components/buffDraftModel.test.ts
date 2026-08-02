import assert from 'node:assert/strict';
import {
  applyBuffCategory,
  applyBuffEffectKind,
  applyBuffType,
  buildBuffDraftIdFromName,
  buildBuffSheetRows,
  createDefaultBuffEffect,
  getNextDraftId,
  normalizeBuffDraft,
  parseImportedBuffDraft,
  reorderDraftStructure,
  setBuffMaxStacks,
  setBuffMultiplierCoefficient,
  setBuffMultiplierEnabled,
  type BuffDraft,
} from './buffDraftModel';

const legacyDraft = normalizeBuffDraft({
  id: ' legacy-buff ',
  name: ' 旧格式 Buff ',
  sourceName: ' 测试来源 ',
  source: ' local_custom ',
  buffs: {
    'buff-7': {
      name: 'legacy_magic_vulnerability',
      type: 'magicTakenDmgBonus',
      value: 15,
      category: 'positive' as never,
      source: '',
      sourceName: '',
    },
  },
});

assert.equal(legacyDraft.id, 'legacy-buff');
assert.equal(legacyDraft.name, '旧格式 Buff');
assert.equal(legacyDraft.sourceName, '测试来源');
assert.deepEqual(Object.keys(legacyDraft.items), ['item-1']);

const legacyEffect = legacyDraft.items['item-1'].effects['buff-7'];
assert.equal(legacyEffect.id, 'buff-7');
assert.equal(legacyEffect.type, 'magicVulnerability');
assert.equal(legacyEffect.category, 'passive');
assert.equal(legacyEffect.displayName, '15%法术脆弱');
assert.equal(legacyEffect.sourceName, '测试来源');
assert.deepEqual(normalizeBuffDraft(legacyDraft), legacyDraft, 'normalization must be idempotent');

assert.equal(buildBuffDraftIdFromName('潮涌'), 'chaoyong');
assert.equal(buildBuffDraftIdFromName('  '), '');
assert.equal(getNextDraftId(['custom-buff-001', 'custom-buff-002']), 'custom-buff-003');

const baseEffect = {
  ...createDefaultBuffEffect('buff-3', '测试来源'),
  type: 'physicalDmgBonus',
  value: 20,
  category: 'countable' as const,
  maxStacks: 4,
};
const multiplierEffect = setBuffMultiplierEnabled(baseEffect, true);
assert.equal(multiplierEffect.effectKind, 'modifier');
assert.equal(multiplierEffect.type, 'physicalDmgBonus');
assert.equal(multiplierEffect.category, 'condition');
assert.equal(multiplierEffect.value, undefined);
assert.deepEqual(multiplierEffect.multiplier, { coefficient: 1 });

const multiplierCannotBecomeCountable = applyBuffCategory(multiplierEffect, 'countable');
assert.equal(multiplierCannotBecomeCountable.category, 'condition');
assert.equal(multiplierCannotBecomeCountable.maxStacks, undefined);
assert.equal(applyBuffType(multiplierEffect, 'flatAtk').multiplier, undefined);
assert.deepEqual(setBuffMultiplierCoefficient(multiplierEffect, -3).multiplier, { coefficient: 1 });
assert.deepEqual(setBuffMultiplierCoefficient(multiplierEffect, 1.75).multiplier, { coefficient: 1.75 });
assert.equal(setBuffMaxStacks(baseEffect, 3.9).maxStacks, 3);
assert.equal(setBuffMaxStacks(baseEffect, Number.NaN).maxStacks, 1);

const extraHit = applyBuffEffectKind({
  ...baseEffect,
  category: 'condition',
  multiplier: { coefficient: 1.5 },
}, 'extraHit');
assert.equal(extraHit.type, '');
assert.equal(extraHit.value, 0);
assert.equal(extraHit.category, 'passive');
assert.equal(extraHit.multiplier, undefined);
assert.deepEqual(extraHit.extraHitConfig, {
  key: 'dianjian',
  damageType: 'physical',
  skillType: '',
  baseMultiplier: 2.5,
  imbalanceValue: 10,
  cooldownSeconds: 15,
  trigger: 'physicalAbnormal',
});
const countableExtraHit = applyBuffCategory(extraHit, 'countable');
assert.equal(countableExtraHit.category, 'countable');
assert.equal(countableExtraHit.maxStacks, 1);
assert.equal(applyBuffCategory(extraHit, 'condition').category, 'passive');

const secondEffect = {
  ...legacyEffect,
  id: 'buff-2',
  name: 'kept_name',
  displayName: '保留名称',
};
const unorderedDraft: BuffDraft = {
  ...legacyDraft,
  items: {
    'item-9': {
      ...legacyDraft.items['item-1'],
      id: 'item-9',
      name: '',
      sourceName: '',
      effects: {
        'buff-8': {
          ...legacyEffect,
          id: 'buff-8',
          name: '',
          displayName: '',
          sourceName: '',
        },
        'buff-2': secondEffect,
      },
    },
  },
};
const reordered = reorderDraftStructure(unorderedDraft);
assert.deepEqual(Object.keys(reordered.items), ['item-1']);
assert.deepEqual(Object.keys(reordered.items['item-1'].effects), ['buff-1', 'buff-2']);
assert.equal(reordered.items['item-1'].id, 'item-1');
assert.equal(reordered.items['item-1'].name, '自定义项 01');
assert.equal(reordered.items['item-1'].sourceName, '测试来源');
assert.equal(reordered.items['item-1'].effects['buff-1'].id, 'buff-1');
assert.equal(reordered.items['item-1'].effects['buff-1'].displayName, 'Buff 效果 01');
assert.equal(reordered.items['item-1'].effects['buff-1'].name, 'custom_buff_001');
assert.equal(reordered.items['item-1'].effects['buff-2'].displayName, '保留名称');
assert.deepEqual(Object.keys(unorderedDraft.items), ['item-9'], 'reorder must not mutate the source');

assert.deepEqual(buildBuffSheetRows(reordered).map((row) => row.kind), ['group', 'item', 'effect', 'effect']);
assert.throws(() => parseImportedBuffDraft('{}'), /JSON 缺少 id \/ name/);
assert.equal(parseImportedBuffDraft(JSON.stringify(legacyDraft)).id, 'legacy-buff');

console.log('Buff draft model characterization contract: PASS');
