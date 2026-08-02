import assert from 'node:assert/strict';
import {
  applyAttackGrowthInterpolation,
  applyEffectLevelsInterpolation,
  applyWeaponDrawerEffect,
  autoFillAttackGrowthMilestones,
  buildNextCustomWeaponId,
  buildWeaponIdFromName,
  buildWeaponSheetRows,
  createEmptyWeaponDraft,
  createEmptyWeaponLevelData,
  createEmptyWeaponSkillData,
  getSkillAutoBuffType,
  interpolateWeaponLevelValues,
  moveRecordEntry,
  normalizeWeaponDraft,
  parseInlineLevelAddress,
  projectWeaponEffectForLevel,
  reorderWeaponDraft,
  type WeaponDraft,
  type WeaponEffectData,
} from './weaponDraftModel';

const emptyLevel = createEmptyWeaponLevelData();
assert.deepEqual(emptyLevel, { value: undefined, description: '' });

const emptySkill = createEmptyWeaponSkillData('skill2');
assert.equal(emptySkill.name, '属性');
assert.deepEqual(Object.keys(emptySkill.levels), ['1', '2', '3', '4', '5', '6', '7', '8', '9']);
assert.ok(Object.values(emptySkill.levels).every((level) => level.description === '' && level.value === undefined));

const emptyDraft = createEmptyWeaponDraft('custom-weapon-009');
assert.equal(emptyDraft.id, 'custom-weapon-009');
assert.equal(emptyDraft.name, '新建武器');
assert.deepEqual(Object.keys(emptyDraft.skills), ['skill1', 'skill2', 'skill3']);
assert.deepEqual(
  Object.values(emptyDraft.skills).map((skill) => skill.name),
  ['能力值', '属性', '特效'],
);

assert.equal(buildWeaponIdFromName('潮涌'), 'chaoyong');
assert.equal(buildWeaponIdFromName('  Test Weapon  '), 'testweapon');
assert.equal(buildWeaponIdFromName('  '), '');
assert.equal(
  buildNextCustomWeaponId(['custom-weapon-001', 'custom-weapon-003']),
  'custom-weapon-002',
);
assert.equal(getSkillAutoBuffType('skill1', ' 敏捷提升 '), 'agilityBoost');
assert.equal(getSkillAutoBuffType('skill2', '攻击提升'), 'atkPercentBoost');
assert.equal(getSkillAutoBuffType('skill3', '攻击提升'), '');

const legacyDraft = normalizeWeaponDraft({
  name: ' 旧式武器 ',
  rarity: 5,
  type: ' 单手剑 ',
  description: ' 迁移测试 ',
  imgUrl: ' /images/legacy.png ',
  attackGrowth: { 1: 100, 90: 278 },
  skills: {
    skill1: {
      name: ' 能力成长 ',
      statType: ' 敏捷提升 ',
      levels: {
        1: { value: 10, description: ' 一级 ' },
        9: { value: 90 },
      },
    },
    skill3: {
      name: ' 旧特效 ',
      effectTypes: {
        legacyPassive: 'physicalDmgBonus',
        legacyCondition: 'magicDmgBonus',
      },
      effectCategories: {
        legacyCondition: 'condition',
      },
      levels: {
        1: {
          passive: { legacyPassive: 12 },
          effects: { legacyCondition: 4 },
        },
        9: {
          passive: { legacyPassive: 36 },
          effects: { legacyCondition: 20 },
        },
      },
    },
  },
});

assert.equal(legacyDraft.id, 'jiushiwuqi');
assert.equal(legacyDraft.name, '旧式武器');
assert.equal(legacyDraft.type, '单手剑');
assert.equal(legacyDraft.description, '迁移测试');
assert.equal(legacyDraft.imgUrl, '/images/legacy.png');
assert.deepEqual(legacyDraft.attackGrowth, { 1: 100, 90: 278 });
assert.equal(legacyDraft.skills.skill1.name, '能力成长');
assert.equal(legacyDraft.skills.skill1.statType, '敏捷提升');
assert.deepEqual(legacyDraft.skills.skill1.levels['1'], { value: 10, description: '一级' });
assert.deepEqual(legacyDraft.skills.skill1.levels['2'], { value: undefined, description: '' });
assert.deepEqual(Object.keys(legacyDraft.skills.skill3.effects), ['legacyCondition', 'legacyPassive']);
assert.deepEqual(legacyDraft.skills.skill3.effects.legacyPassive, {
  schemaVersion: 2,
  effectId: 'legacyPassive',
  name: 'legacyPassive',
  type: 'physicalDmgBonus',
  category: 'passive',
  levels: { 1: 12, 9: 36 },
  valueMode: 'fixed',
  effectKind: 'modifier',
});
assert.equal(legacyDraft.skills.skill3.effects.legacyCondition.category, 'condition');
assert.deepEqual(legacyDraft.skills.skill3.effects.legacyCondition.levels, { 1: 4, 9: 20 });

const normalizedDraft = normalizeWeaponDraft({
  id: ' current-weapon ',
  name: ' 当前武器 ',
  skills: {
    skill3: {
      effects: {
        fixed: {
          effectId: 'fixed-id',
          name: ' 固定值 ',
          type: 'physicalDmgBonus',
          category: 'passive',
          levels: { 1: 10, 9: 90, 10: 100 },
        },
        multiplier: {
          name: '倍率',
          type: 'multiplierBonus',
          category: 'passive',
          multiplier: { coefficient: 1.5 },
          levels: { 1: 2.25, 9: 3.5 },
        },
        derived: {
          name: '派生值',
          type: 'atkPercentBoost',
          category: 'condition',
          valueMode: 'derived',
          derivedValue: { source: 'intelligence', perPointValue: 0.1 },
          levels: { 1: 0.2, 9: 0.8 },
        },
        extra: {
          name: '额外伤害',
          type: 'physicalDmgBonus',
          category: 'countable',
          effectKind: 'extraHit',
          extraHitConfig: {
            key: 'extra-key',
            damageType: 'fire',
            skillType: 'E',
            baseMultiplier: 1.25,
            imbalanceValue: 8,
            cooldownSeconds: 3,
            trigger: 'physicalAbnormal',
          },
          levels: { 1: 2.5, 9: 4.5 },
        },
      },
    },
  },
});

assert.equal(normalizedDraft.id, 'current-weapon');
assert.deepEqual(normalizedDraft.skills.skill3.effects.fixed.levels, { 1: 10, 9: 90 });
assert.equal(normalizedDraft.skills.skill3.effects.fixed.effectId, 'fixed-id');
assert.equal(normalizedDraft.skills.skill3.effects.multiplier.category, 'condition');
assert.deepEqual(normalizedDraft.skills.skill3.effects.multiplier.multiplier, { coefficient: 1.5 });
assert.deepEqual(normalizedDraft.skills.skill3.effects.derived.derivedValue, {
  source: 'intelligence',
  perPointValue: 0.1,
});
assert.equal(normalizedDraft.skills.skill3.effects.extra.type, '');
assert.deepEqual(normalizeWeaponDraft(normalizedDraft), normalizedDraft, 'normalization must be idempotent');

const fixedEffect = normalizedDraft.skills.skill3.effects.fixed;
const multiplierEffect = normalizedDraft.skills.skill3.effects.multiplier;
const derivedEffect = normalizedDraft.skills.skill3.effects.derived;
const extraHitEffect = normalizedDraft.skills.skill3.effects.extra;

assert.equal(projectWeaponEffectForLevel('fixed', fixedEffect, '1').value, 10);
assert.equal(projectWeaponEffectForLevel('multiplier', multiplierEffect, '1').multiplier?.coefficient, 2.25);
assert.equal(projectWeaponEffectForLevel('derived', derivedEffect, '1').derivedValue?.perPointValue, 0.2);
assert.equal(projectWeaponEffectForLevel('extra', extraHitEffect, '1').extraHitConfig?.baseMultiplier, 2.5);

assert.equal(applyWeaponDrawerEffect(
  fixedEffect,
  '2',
  { ...projectWeaponEffectForLevel('fixed', fixedEffect, '1'), value: 22 },
).levels['2'], 22);
assert.equal(applyWeaponDrawerEffect(
  multiplierEffect,
  '2',
  {
    ...projectWeaponEffectForLevel('multiplier', multiplierEffect, '1'),
    multiplier: { coefficient: 2.75 },
  },
).levels['2'], 2.75);
assert.equal(applyWeaponDrawerEffect(
  derivedEffect,
  '2',
  {
    ...projectWeaponEffectForLevel('derived', derivedEffect, '1'),
    derivedValue: { source: 'intelligence', perPointValue: 0.35 },
  },
).levels['2'], 0.35);
assert.equal(applyWeaponDrawerEffect(
  extraHitEffect,
  '2',
  {
    ...projectWeaponEffectForLevel('extra', extraHitEffect, '1'),
    extraHitConfig: {
      ...projectWeaponEffectForLevel('extra', extraHitEffect, '1').extraHitConfig!,
      baseMultiplier: 3.25,
    },
  },
).levels['2'], 3.25);

const attackGrowth = { 1: 100, 90: 278 };
const interpolatedAttackGrowth = autoFillAttackGrowthMilestones(attackGrowth);
assert.deepEqual(interpolatedAttackGrowth, {
  1: 100,
  10: 118,
  20: 138,
  30: 158,
  40: 178,
  50: 198,
  60: 218,
  70: 238,
  80: 258,
  90: 278,
});
assert.deepEqual(attackGrowth, { 1: 100, 90: 278 }, 'attack interpolation must not mutate the source');
assert.notEqual(applyAttackGrowthInterpolation(legacyDraft), legacyDraft);
assert.deepEqual(autoFillAttackGrowthMilestones({ 1: 100 }), { 1: 100 });

assert.equal(interpolateWeaponLevelValues({ 1: 10 }), null);
assert.deepEqual(interpolateWeaponLevelValues({ 1: 10, 3: 30 }), {
  1: 10,
  2: 20,
  3: 30,
  4: 40,
  5: 50,
  6: 60,
  7: 70,
  8: 80,
  9: 100,
});

const draftForEffectInterpolation: WeaponDraft = {
  ...normalizedDraft,
  skills: {
    ...normalizedDraft.skills,
    skill3: {
      ...normalizedDraft.skills.skill3,
      effects: {
        ...normalizedDraft.skills.skill3.effects,
        fixed: { ...fixedEffect, levels: { 1: 10, 3: 30 } },
      },
    },
  },
};
const interpolatedEffectDraft = applyEffectLevelsInterpolation(
  draftForEffectInterpolation,
  'skill3',
  'effect',
  'fixed',
);
assert.notEqual(interpolatedEffectDraft, draftForEffectInterpolation);
assert.equal(interpolatedEffectDraft.skills.skill3.effects.fixed.levels['9'], 100);
assert.deepEqual(draftForEffectInterpolation.skills.skill3.effects.fixed.levels, { 1: 10, 3: 30 });
assert.equal(
  applyEffectLevelsInterpolation(draftForEffectInterpolation, 'skill3', 'value', 'fixed'),
  draftForEffectInterpolation,
);
assert.equal(
  applyEffectLevelsInterpolation(draftForEffectInterpolation, 'skill1', 'effect', 'fixed'),
  draftForEffectInterpolation,
);

const draftForRows: WeaponDraft = {
  ...normalizedDraft,
  skills: {
    ...normalizedDraft.skills,
    skill3: {
      ...normalizedDraft.skills.skill3,
      levels: {
        ...normalizedDraft.skills.skill3.levels,
        1: { value: 1, description: '' },
      },
    },
  },
};
assert.deepEqual(buildWeaponSheetRows(draftForRows).map((row) => row.kind), [
  'weapon',
  'growth',
  'skill',
  'effect',
  'effectLevels',
  'skill',
  'effect',
  'effectLevels',
  'skill',
  'effect',
  'effectLevels',
  'effect',
  'effectLevels',
  'effect',
  'effectLevels',
  'effect',
  'effectLevels',
  'effect',
  'effectLevels',
]);

const orderedEffects: Record<string, WeaponEffectData> = {
  alpha: { ...fixedEffect, name: 'Alpha' },
  beta: { ...derivedEffect, name: 'Beta' },
  gamma: { ...extraHitEffect, name: 'Gamma' },
};
assert.deepEqual(Object.keys(moveRecordEntry(orderedEffects, 'alpha', 'gamma')), ['beta', 'gamma', 'alpha']);
assert.equal(moveRecordEntry(orderedEffects, 'missing', 'gamma'), orderedEffects);
assert.deepEqual(Object.keys(orderedEffects), ['alpha', 'beta', 'gamma']);

const draftForReorder: WeaponDraft = {
  ...normalizedDraft,
  skills: {
    ...normalizedDraft.skills,
    skill3: { ...normalizedDraft.skills.skill3, effects: orderedEffects },
  },
};
const reorderedDraft = reorderWeaponDraft(draftForReorder);
assert.deepEqual(Object.keys(reorderedDraft.skills.skill3.effects), ['effect1', 'effect2', 'effect3']);
assert.deepEqual(
  Object.values(reorderedDraft.skills.skill3.effects).map((effect) => effect.name),
  ['Alpha', 'Beta', 'Gamma'],
);
assert.deepEqual(Object.keys(draftForReorder.skills.skill3.effects), ['alpha', 'beta', 'gamma']);

assert.equal(parseInlineLevelAddress('Lv1'), '1');
assert.equal(parseInlineLevelAddress(' lv9 '), '9');
assert.equal(parseInlineLevelAddress('Lv10'), '');
assert.equal(parseInlineLevelAddress(null), '');

console.log('Weapon draft model characterization contract: PASS');
