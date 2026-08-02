import assert from 'node:assert/strict';
import {
  applyEffectValueCatalogForPart,
  createEmptyLibrary,
  drawerEffectToEquipmentBuff,
  equipmentBuffToDrawer,
  getEffectEntries,
  getEquipmentEffectShape,
  getEquipmentEffectShapeFromCount,
  getEquipmentEffectTypeOptions,
  getEquipmentEffectValuePreset,
  getSortedEquipments,
  makeValueCatalogKey,
  normalizeCategory,
  normalizeEnglishId,
  normalizeEquipmentLibrary,
  normalizeLegacyPercentValue,
  normalizeNumber,
  normalizePart,
  normalizePresetLevels,
  normalizeThreePieceBuff,
  normalizeUnit,
  parseLevelValuesFromRaw,
  shouldStoreEquipmentEffectAsDecimal,
  slugifyIdPart,
  type EquipmentEffect,
  type EquipmentEffectId,
  type EquipmentGearSet,
  type EquipmentItem,
  type EquipmentLibrary,
} from './equipmentSheetModel';

function makeEffect(effectId: EquipmentEffectId, overrides: Partial<EquipmentEffect> = {}): EquipmentEffect {
  return {
    effectId,
    label: `效果 ${effectId}`,
    typeKey: 'physicalDmgBonus',
    category: 'buff',
    levels: { '0': 0.1234, '1': 0.2345, '2': 0.3456, '3': 0.4567 },
    unit: 'percent',
    raw: '伤害：+12.34%/+23.45%/+34.56%/+45.67%',
    ...overrides,
  };
}

function makeEquipment(overrides: Partial<EquipmentItem> = {}): EquipmentItem {
  return {
    equipmentId: 'equipment-main',
    name: '主装备',
    part: '护甲',
    fixedStat: {
      label: '防御力',
      typeKey: 'defense',
      value: 999,
      unit: 'flat',
      raw: '自定义防御：+999',
    },
    effects: {
      effect1: makeEffect('effect1', {
        label: '力量',
        typeKey: 'strengthBoost',
        category: 'ability',
        levels: { '0': 10, '1': 20, '2': 30, '3': 40 },
        unit: 'flat',
        raw: '力量：+10/+20/+30/+40',
      }),
      effect2: makeEffect('effect2', {
        label: '智识',
        typeKey: 'intelligenceBoost',
        category: 'ability',
        levels: { '0': 11, '1': 21, '2': 31, '3': 41 },
        unit: 'flat',
        raw: '智识：+11/+21/+31/+41',
      }),
      effect3: makeEffect('effect3', {
        label: '自定义伤害',
        typeKey: 'ultimateDmgBonus',
      }),
    },
    ...overrides,
  };
}

assert.equal(normalizePart('护甲'), '护甲');
assert.equal(normalizePart('unknown'), '配件');
assert.equal(normalizeUnit('percent'), 'percent');
assert.equal(normalizeUnit('percentage'), 'flat');
assert.equal(normalizeCategory('ability'), 'ability');
assert.equal(normalizeCategory('能力值'), 'buff');
assert.equal(normalizeNumber('12.5'), 12.5);
assert.equal(normalizeNumber('not-a-number', 7), 7);
assert.equal(slugifyIdPart('  Alpha / Item  '), 'a-l-p-h-a-i-t-e-m');
assert.equal(slugifyIdPart('', 'fallback'), 'f-a-l-l-b-a-c-k');

const normalizedIds = new Set<string>();
assert.equal(normalizeEnglishId('equipment', 'bad id', 'Alpha Item', normalizedIds), 'equipment-a-l-p-h-a-i-t-e-m');
assert.equal(normalizeEnglishId('equipment', 'bad id', 'Alpha Item', normalizedIds), 'equipment-a-l-p-h-a-i-t-e-m-2');
assert.equal(normalizeEnglishId('equipment', 'equipment-kept', 'ignored', normalizedIds), 'equipment-kept');

assert.equal(shouldStoreEquipmentEffectAsDecimal('physicalDmgBonus', 'percent'), true);
assert.equal(shouldStoreEquipmentEffectAsDecimal('strengthBoost', 'percent'), false);
assert.equal(shouldStoreEquipmentEffectAsDecimal('sourceSkillBoost', 'percent'), false);
assert.equal(normalizeLegacyPercentValue('physicalDmgBonus', 'percent', 0.12), 0.12);
assert.equal(normalizeLegacyPercentValue('physicalDmgBonus', 'percent', 12, '物理伤害：+12%'), 0.12);
assert.equal(normalizeLegacyPercentValue('physicalDmgBonus', 'percent', 0.12, '物理伤害：+12%'), 0.12);
assert.equal(normalizeLegacyPercentValue('physicalDmgBonus', 'percent', 2, '物理伤害：+2'), 2, 'percent without raw % keeps the current value');
assert.equal(normalizeLegacyPercentValue('physicalDmgBonus', 'percent', 2, '伤害：+20%'), 0.02, 'stale raw percent applies the current heuristic');
assert.equal(normalizeLegacyPercentValue('strengthBoost', 'percent', 12, '力量：+12%'), 12);
assert.equal(normalizeLegacyPercentValue('sourceSkillBoost', 'percent', 0.12, '源石技艺强度：+12%'), 0.12);
assert.deepEqual(
  parseLevelValuesFromRaw('伤害：+12%/+13%/+14%/+15%', 'physicalDmgBonus', 'percent'),
  { '0': 0.12, '1': 0.13, '2': 0.14, '3': 0.15 },
);
assert.deepEqual(
  parseLevelValuesFromRaw('强度：+12/+13/+14/+15', 'sourceSkillBoost', 'percent'),
  { '0': 12, '1': 13, '2': 14, '3': 15 },
);
assert.deepEqual(
  normalizePresetLevels({
    typeKey: 'physicalDmgBonus',
    unit: 'percent',
    raw: '伤害：+12%/+13%/+14%/+15%',
    levels: { '0': 12, '1': 0.13, '2': 14, '3': 15 },
  }),
  { '0': 0.12, '1': 0.13, '2': 0.14, '3': 0.15 },
);
assert.deepEqual(
  normalizePresetLevels({
    typeKey: 'ultimateDmgBonus',
    unit: 'percent',
    raw: '伤害：+25.875%/28.4625%/31.05%/33.6375%',
    levels: { '0': 18.38, '1': 18.38, '2': 18.38, '3': 18.38 },
  }),
  { '0': 0.25875, '1': 0.28462499999999996, '2': 0.3105, '3': 0.33637500000000004 },
);
assert.deepEqual(
  normalizePresetLevels({
    typeKey: 'sourceSkillBoost',
    unit: 'percent',
    raw: '强度：+12/+13/+14/+15%',
    levels: { '0': 12, '1': 13, '2': 14, '3': 15 },
  }),
  { '0': 12, '1': 13, '2': 14, '3': 15 },
);

assert.equal(getEquipmentEffectShapeFromCount(0), 'two-effects');
assert.equal(getEquipmentEffectShapeFromCount(2), 'two-effects');
assert.equal(getEquipmentEffectShapeFromCount(3), 'three-effects');
assert.equal(getEquipmentEffectShape(makeEquipment({ effects: { effect1: makeEffect('effect1'), effect2: makeEffect('effect2') } })), 'two-effects');
assert.equal(getEquipmentEffectShape(makeEquipment()), 'three-effects');
assert.equal(makeValueCatalogKey('配件', 'effect1', 'strengthBoost', 'two-effects'), '配件:effect1:strengthBoost:two-effects');

const twoEffectStrengthPreset = getEquipmentEffectValuePreset('配件', 'effect1', 'strengthBoost', 'two-effects');
const threeEffectStrengthPreset = getEquipmentEffectValuePreset('配件', 'effect1', 'strengthBoost', 'three-effects');
assert.ok(twoEffectStrengthPreset);
assert.ok(threeEffectStrengthPreset);
assert.notDeepEqual(twoEffectStrengthPreset.levels, threeEffectStrengthPreset.levels, 'two/three effect catalogs must stay separate');
const twoEffectAbilityOptions = getEquipmentEffectTypeOptions('配件', 'effect1', 'ability', 'two-effects');
const threeEffectAbilityOptions = getEquipmentEffectTypeOptions('配件', 'effect1', 'ability', 'three-effects');
assert.ok(twoEffectAbilityOptions.includes('strengthBoost'));
assert.ok(threeEffectAbilityOptions.includes('strengthBoost'));
assert.deepEqual(twoEffectAbilityOptions, ['strengthBoost', 'willBoost', 'intelligenceBoost']);

const unmappedEffect = makeEffect('effect1', {
  label: '自定义词条',
  typeKey: 'strengthBoost',
  category: 'buff',
  levels: { '0': 901, '1': 902, '2': 903, '3': 904 },
  raw: '',
});
const mappedTwoEffect = applyEffectValueCatalogForPart(
  unmappedEffect,
  '配件',
  'two-effects',
);
const mappedThreeEffect = applyEffectValueCatalogForPart(
  unmappedEffect,
  '配件',
  'three-effects',
);
assert.deepEqual(mappedTwoEffect.levels, twoEffectStrengthPreset.levels);
assert.deepEqual(mappedThreeEffect.levels, threeEffectStrengthPreset.levels);
assert.equal(mappedTwoEffect.category, 'ability');
assert.equal(unmappedEffect.levels['0'], 901, 'catalog application must not mutate the source effect');
const noCatalogEffect = makeEffect('effect1', { typeKey: 'notInCatalog' });
assert.strictEqual(applyEffectValueCatalogForPart(noCatalogEffect, '配件', 'three-effects'), noCatalogEffect);

const normalizedLibrary = normalizeEquipmentLibrary({
  updatedAt: '2026-08-03T01:02:03.000Z',
  gearSets: {
    first: {
      gearSetId: 'bad id',
      name: 'Same Set',
      threePieceBuff: {
        effectId: 'legacy-effect',
        name: '旧三件套',
        category: 'positive',
        typeKey: 'physicalDmgBonus',
        value: 12,
        unit: 'percent',
        raw: '物理伤害：+12%',
      },
      equipments: {
        firstItem: {
          equipmentId: 'bad id',
          name: '第一装备',
          part: 'not-a-part',
          fixedStat: { label: '坏固定值', typeKey: 'not-a-fixed-type', value: 'bad', unit: 'bad', raw: 123 },
          effects: {
            effect1: {
              effectId: 'effect1',
              label: '旧百分比',
              typeKey: 'physicalDmgBonus',
              category: 'not-a-category',
              unit: 'percent',
              raw: '伤害：+12%/+13%/+14%/+15%',
              levels: { '0': 12, '1': 0.13, '2': 'invalid', '3': 15 },
            },
          },
        },
        secondItem: {
          equipmentId: 'bad id',
          name: '重复装备',
          part: '护手',
          effects: {},
        },
      },
    },
    second: {
      gearSetId: 'bad id',
      name: 'Same Set',
      equipments: {
        secondItem: {
          equipmentId: 'bad id',
          name: '第二装备',
          part: '配件',
          effects: {},
        },
      },
    },
  },
});
assert.deepEqual(Object.keys(normalizedLibrary.gearSets), ['gear-set-s-a-m-e-s-e-t', 'gear-set-s-a-m-e-s-e-t-2']);
const normalizedFirstSet = normalizedLibrary.gearSets['gear-set-s-a-m-e-s-e-t'];
assert.ok(normalizedFirstSet);
assert.deepEqual(Object.keys(normalizedFirstSet.threePieceBuffs || {}), ['legacy-effect']);
assert.equal(normalizedFirstSet.threePieceBuffs?.['legacy-effect'].category, 'passive');
assert.equal(normalizedFirstSet.threePieceBuffs?.['legacy-effect'].value, 0.12);
const normalizedFirstEquipment = normalizedFirstSet.equipments['equipment-b-a-d-i-d'];
assert.ok(normalizedFirstEquipment);
assert.equal(normalizedFirstEquipment.part, '配件');
assert.deepEqual(normalizedFirstEquipment.fixedStat, {
  label: '坏固定值',
  typeKey: 'defense',
  value: 0,
  unit: 'flat',
  raw: '123',
});
assert.deepEqual(normalizedFirstEquipment.effects.effect1?.levels, { '0': 0.12, '1': 0.13, '3': 0.15 });
assert.ok(normalizedFirstSet.equipments['equipment-b-a-d-i-d-2']);
assert.deepEqual(normalizeEquipmentLibrary(normalizedLibrary), normalizedLibrary, 'equipment normalization must be idempotent');

const customLevelsLibrary = normalizeEquipmentLibrary({
  gearSets: {
    'gear-set-custom': {
      gearSetId: 'gear-set-custom',
      name: 'Custom',
      equipments: {
        'equipment-custom': {
          equipmentId: 'equipment-custom',
          name: 'Custom',
          part: '配件',
          fixedStat: { label: '自定义防御', typeKey: 'defense', value: 999, unit: 'flat', raw: '自定义' },
          effects: {
            effect1: {
              effectId: 'effect1',
              label: '自定义力量',
              typeKey: 'strengthBoost',
              category: 'ability',
              unit: 'flat',
              raw: '自定义等级',
              levels: { '0': 901, '1': 902, '2': 903, '3': 904 },
            },
            effect2: {
              effectId: 'effect2',
              label: '自定义源石技艺强度',
              typeKey: 'sourceSkillBoost',
              category: 'buff',
              unit: 'flat',
              raw: '自定义等级',
              levels: { '0': 801, '1': 802, '2': 803, '3': 804 },
            },
          },
        },
      },
    },
  },
});
const customNormalizedEquipment = customLevelsLibrary.gearSets['gear-set-custom'].equipments['equipment-custom'];
assert.equal(customNormalizedEquipment.fixedStat?.value, 999);
assert.deepEqual(customNormalizedEquipment.effects.effect1?.levels, { '0': 901, '1': 902, '2': 903, '3': 904 });
assert.deepEqual(customNormalizedEquipment.effects.effect2?.levels, { '0': 801, '1': 802, '2': 803, '3': 804 });

const emptyLibrary = createEmptyLibrary();
assert.match(emptyLibrary.updatedAt || '', /^20\d\d-/);
assert.deepEqual(Object.keys(emptyLibrary.gearSets), ['gear-set-new']);
assert.deepEqual(emptyLibrary.gearSets['gear-set-new'].equipments, {});

const sortableSet: EquipmentGearSet = {
  gearSetId: 'gear-set-sort',
  name: 'Sort',
  equipments: {
    z: makeEquipment({ equipmentId: 'z', name: 'Zeta', part: '配件', effects: {} }),
    a: makeEquipment({ equipmentId: 'a', name: 'Zeta', part: '护甲', effects: {} }),
    b: makeEquipment({ equipmentId: 'b', name: 'Alpha', part: '护手', effects: {} }),
    c: makeEquipment({ equipmentId: 'c', name: 'Alpha', part: '护甲', effects: {} }),
  },
};
assert.deepEqual(getSortedEquipments(sortableSet).map((equipment) => equipment.equipmentId), ['c', 'a', 'b', 'z']);
assert.deepEqual(Object.keys(sortableSet.equipments), ['z', 'a', 'b', 'c']);
assert.deepEqual(getEffectEntries(makeEquipment({ effects: {
  effect3: makeEffect('effect3'),
  effect1: makeEffect('effect1'),
} })).map(([effectId]) => effectId), ['effect1', 'effect3']);

const modifierBuff = normalizeThreePieceBuff('effect1', {
  effectId: 'legacy-modifier',
  name: '旧 modifier',
  category: 'positive',
  typeKey: 'physicalDmgBonus',
  value: 12,
  unit: 'percent',
  raw: '物理伤害：+12%',
});
assert.equal(modifierBuff.effectId, 'legacy-modifier');
assert.equal(modifierBuff.category, 'passive');
assert.equal(modifierBuff.typeKey, 'physicalDmgBonus');
assert.equal(modifierBuff.value, 0.12);
const modifierDrawer = equipmentBuffToDrawer(modifierBuff);
assert.equal(modifierDrawer.type, 'physicalDmgBonus');
assert.equal(modifierDrawer.value, 0.12);
const modifierRoundTrip = drawerEffectToEquipmentBuff(modifierDrawer);
assert.equal(modifierRoundTrip.effectKind, 'modifier');
assert.equal(modifierRoundTrip.typeKey, 'physicalDmgBonus');
assert.equal(modifierRoundTrip.value, 0.12);

const extraHitBuff = normalizeThreePieceBuff('effect2', {
  effectId: 'extra-hit',
  name: '额外伤害段',
  category: 'countable',
  typeKey: '',
  value: 999,
  unit: 'percent',
  effectKind: 'extraHit',
  extraHitConfig: {
    key: 'extra-hit',
    damageType: 'fire',
    skillType: 'E',
    baseMultiplier: 1.5,
    imbalanceValue: 2,
    cooldownSeconds: 3,
    trigger: 'physicalAbnormal',
  },
});
assert.equal(extraHitBuff.effectKind, 'extraHit');
assert.equal(extraHitBuff.value, 0);
assert.equal(extraHitBuff.extraHitConfig?.damageType, 'fire');
const extraHitDrawer = equipmentBuffToDrawer(extraHitBuff);
assert.equal(extraHitDrawer.effectKind, 'extraHit');
assert.equal(extraHitDrawer.type, '');
assert.equal(extraHitDrawer.extraHitConfig?.baseMultiplier, 1.5);
const extraHitRoundTrip = drawerEffectToEquipmentBuff(extraHitDrawer);
assert.equal(extraHitRoundTrip.effectKind, 'extraHit');
assert.equal(extraHitRoundTrip.value, 0);
assert.equal(extraHitRoundTrip.extraHitConfig?.skillType, 'E');

console.log('Equipment sheet model characterization contract: PASS');
