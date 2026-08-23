import assert from 'node:assert/strict';
import type { ResolvedHitTemplate } from '../calculators/skillDamage.types';
import { calculateSkillButtonDamageV2 } from '../calculators/skillButtonDamageCalculatorV2';
import type { DamageBonusSnapshot, SkillButtonBuff } from '../../types/storage';
import {
  isSingleHitMultiplierBonusBuff,
  resolveSingleHitMultiplierBonusTarget,
  resolveSingleHitMultiplierBonusTargets,
} from './singleHitMultiplierBonus';

const hits: ResolvedHitTemplate[] = [
  { key: 'hit-1', displayName: '第一段', multiplier: 1, element: 'physical', skillType: 'B' },
  { key: 'hit-2', displayName: '第二段', multiplier: 2, element: 'fire', skillType: 'B' },
  { key: 'hit-3', displayName: '第三段', multiplier: 3, element: 'fire', skillType: 'B' },
];
const additive: SkillButtonBuff = {
  id: 'additive',
  name: '追加倍率',
  displayName: '追加倍率',
  sourceName: 'test',
  source: 'test',
  type: 'multiplierBonus',
  value: 0.8,
  effectKind: 'modifier',
  category: 'condition',
  refCount: 1,
};
const multiplier: SkillButtonBuff = {
  ...additive,
  id: 'multiplier',
  value: undefined,
  multiplier: { coefficient: 1.15 },
};

assert.equal(isSingleHitMultiplierBonusBuff(additive), true);
assert.equal(isSingleHitMultiplierBonusBuff(multiplier), false);
assert.equal(resolveSingleHitMultiplierBonusTarget(additive, hits), 'hit-3');
assert.equal(resolveSingleHitMultiplierBonusTarget(additive, hits, {}, { additive: 'hit-1' }), 'hit-1');
assert.equal(resolveSingleHitMultiplierBonusTarget(additive, hits, {}, { additive: null }), null);
assert.equal(resolveSingleHitMultiplierBonusTarget(additive, hits, {
  'hit-2': ['additive'],
  'hit-3': ['additive'],
}), 'hit-1');

const fireOnly = { ...additive, id: 'fire-only', target: { mode: 'element', element: 'fire' as const } };
assert.equal(resolveSingleHitMultiplierBonusTarget(fireOnly, hits), 'hit-3');
assert.deepEqual(resolveSingleHitMultiplierBonusTargets(
  [additive, multiplier, fireOnly],
  hits,
  {},
  { additive: 'buff-extra-hit-extra-1' },
), {
  additive: 'buff-extra-hit-extra-1',
  'fire-only': 'hit-3',
});

const zeroDamageBonus: DamageBonusSnapshot = {
  physicalDmgBonus: 0,
  fireDmgBonus: 0,
  electricDmgBonus: 0,
  iceDmgBonus: 0,
  natureDmgBonus: 0,
  magicDmgBonus: 0,
  normalAttackDmgBonus: 0,
  dotDmgBonus: 0,
  skillDmgBonus: 0,
  chainSkillDmgBonus: 0,
  ultimateDmgBonus: 0,
  allSkillDmgBonus: 0,
  imbalanceDmgBonus: 0,
  allDmgBonus: 0,
};
const calculate = (targets?: Record<string, string | null>) => calculateSkillButtonDamageV2({
  buttonId: 'button',
  characterId: 'operator',
  runtimeSkillId: 'skill',
  template: {
    characterId: 'operator',
    characterName: '测试干员',
    runtimeSkillId: 'skill',
    displayName: '三段技能',
    buttonType: 'B',
    hits,
  },
  buffs: [additive, multiplier],
  panel: { atk: 100, critRate: 0, critDmg: 0 },
  damageBonus: zeroDamageBonus,
  targetResistance: {},
  singleHitBuffTargetByBuffId: targets,
});

const defaultResult = calculate();
const multipliersOf = (result: ReturnType<typeof calculate>) => (
  result.hits.map((hit) => Number(hit.multiplier.afterMultiply.toFixed(6)))
);
assert.deepEqual(multipliersOf(defaultResult), [1.15, 2.3, 4.37]);
assert.deepEqual(
  defaultResult.hits.map((hit) => hit.appliedBuffs.some((buff) => buff.id === additive.id)),
  [false, false, true],
);

const movedResult = calculate({ additive: 'hit-1' });
assert.deepEqual(multipliersOf(movedResult), [2.07, 2.3, 3.45]);

const disabledResult = calculate({ additive: null });
assert.deepEqual(multipliersOf(disabledResult), [1.15, 2.3, 3.45]);
