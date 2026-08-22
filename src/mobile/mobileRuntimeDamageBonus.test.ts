import assert from 'node:assert/strict';
import type { ConfigSnapshot } from '../core/calculators/operatorPanelCalculator';
import type { DamageBonusSnapshot } from '../types/storage';
import { resolveMobileRuntimeDamageBonus } from './mobileRuntime';

const rawDamageBonus: DamageBonusSnapshot = {
  physicalDmgBonus: 0,
  fireDmgBonus: 0.3987,
  electricDmgBonus: 0,
  iceDmgBonus: 0,
  natureDmgBonus: 0.3987,
  magicDmgBonus: 0.25,
  normalAttackDmgBonus: 0,
  dotDmgBonus: 0,
  skillDmgBonus: 0,
  chainSkillDmgBonus: 0,
  ultimateDmgBonus: 0,
  allSkillDmgBonus: 0.32,
  imbalanceDmgBonus: 0.18,
  allDmgBonus: 0,
};

const displayDamageBonus: DamageBonusSnapshot = {
  ...rawDamageBonus,
  fireDmgBonus: 0.6487,
  electricDmgBonus: 0.25,
  iceDmgBonus: 0.25,
  natureDmgBonus: 0.6487,
  skillDmgBonus: 0.32,
  chainSkillDmgBonus: 0.32,
  ultimateDmgBonus: 0.32,
};

const snapshot = {
  panel: {
    calc: { damageBonus: rawDamageBonus },
    display: { damageBonus: displayDamageBonus },
  },
} as ConfigSnapshot;

assert.strictEqual(
  resolveMobileRuntimeDamageBonus(snapshot),
  rawDamageBonus,
  'mobile damage calculation must use raw zone inputs instead of presentation-expanded totals',
);
assert.deepEqual(
  resolveMobileRuntimeDamageBonus(snapshot, false),
  { ...rawDamageBonus, imbalanceDmgBonus: 0 },
  'RDPS direct-damage evaluation may suppress imbalance without mutating the raw snapshot',
);
assert.equal(rawDamageBonus.imbalanceDmgBonus, 0.18);
