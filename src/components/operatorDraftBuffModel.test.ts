import assert from 'node:assert/strict';
import {
  applyBuffBusinessType,
  convertExtraHitToMultiplierBonus,
  createDefaultBuffEffect,
  deriveOperatorBuffBusinessType,
  getFilteredOperatorBuffTypeOptions,
} from './operatorDraftBuffModel';

const countableMultiplierBonus = applyBuffBusinessType({
  ...createDefaultBuffEffect('effect-countable-multiplier'),
  type: 'multiplierBonus',
  value: 0.2,
}, 'countable', 'effect-countable-multiplier');

assert.equal(countableMultiplierBonus.category, 'countable');
assert.equal(countableMultiplierBonus.type, 'multiplierBonus');
assert.equal(countableMultiplierBonus.maxStacks, 1);
assert.ok(getFilteredOperatorBuffTypeOptions({
  query: '',
  selectedEffect: countableMultiplierBonus,
  buildSearchIndex: (values) => values.filter(Boolean).join(' ').toLowerCase(),
}).includes('multiplierBonus'));

const converted = convertExtraHitToMultiplierBonus({
  ...createDefaultBuffEffect('effect-extra-hit'),
  effectKind: 'extraHit',
  type: '',
  category: 'countable',
  maxStacks: 5,
  extraHitConfig: {
    key: 'effect-extra-hit',
    damageType: 'nature',
    skillType: 'B',
    baseMultiplier: 0.8,
    imbalanceValue: 0,
    cooldownSeconds: 0,
    trigger: 'physicalAbnormal',
    formulaMode: 'sourceSkill',
    levelCurve: 'artsBurst',
  },
});

assert.equal(converted.effectKind, 'modifier');
assert.equal(converted.type, 'multiplierBonus');
assert.equal(converted.category, 'countable');
assert.equal(converted.maxStacks, 5);
assert.equal(converted.value, 0.8);
assert.equal(converted.extraHitConfig, undefined);
assert.equal(deriveOperatorBuffBusinessType(converted), 'countable');
