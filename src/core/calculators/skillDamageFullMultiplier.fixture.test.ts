import { calculateBuffTotals, calculateBuffedPanelTrace } from './buffCalculator';
import { calculateSkillButtonDamageV2 } from './skillButtonDamageCalculatorV2';
import { resolveBuffInstanceValue } from './buffZoneCalculator';
import { FULL_MULTIPLIER_FIXTURE, FULL_MULTIPLIER_GOLDEN } from './skillDamageFullMultiplier.fixture';

function assertClose(actual: number, expected: number, message: string, tolerance = 1e-9): void {
  if (Math.abs(actual - expected) > tolerance) {
    throw new Error(`${message}: expected ${expected}, got ${actual}`);
  }
}

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

function assertBreakdown(actual: typeof FULL_MULTIPLIER_GOLDEN.hits[number]['breakdown']['nonCrit'], expected: typeof actual, label: string): void {
  const keys = [
    'base',
    'afterCrit',
    'afterBonus',
    'afterDefense',
    'afterResistance',
    'afterAmplify',
    'afterFragile',
    'afterVulnerability',
    'final',
  ] as const;
  keys.forEach((key) => assertClose(actual[key], expected[key], `${label}.${key}`));
}

function assertZone(
  actual: {
    additiveTotal: number;
    multiplierProduct: number;
    finalValue: number;
  },
  expected: { additiveTotal: number; multiplierProduct: number; finalValue: number },
  label: string,
): void {
  assertClose(actual.additiveTotal, expected.additiveTotal, `${label}.additiveTotal`);
  assertClose(actual.multiplierProduct, expected.multiplierProduct, `${label}.multiplierProduct`);
  assertClose(actual.finalValue, expected.finalValue, `${label}.finalValue`);
}

const totals = calculateBuffTotals(
  FULL_MULTIPLIER_FIXTURE.buffs,
  FULL_MULTIPLIER_FIXTURE.buffStackCounts,
);

const findBuff = (id: string) => FULL_MULTIPLIER_FIXTURE.buffs.find((buff) => buff.id === id);
const derivedCombo = findBuff('combo-derived');
if (!derivedCombo) throw new Error('derived combo fixture buff is missing');
assertEqual(derivedCombo.valueMode, 'derived', 'derived buff should retain valueMode metadata');
assertEqual(derivedCombo.derivedValue?.source, 'atk', 'derived buff should retain its source metadata');
assertClose(derivedCombo.derivedValue?.perPointValue ?? 0, 0.000025, 'derived buff per-point value');
assertClose(derivedCombo.value ?? 0, 2400 * 0.000025, 'fixture builder should resolve source value × perPointValue');

// The fixture intentionally makes every applicable attack input non-default.
assertClose(totals.atkPercentBoost, 0.12, 'attack additive total');
assertClose(totals.flatAtk, 85, 'fixed attack total');
assertClose(totals.mainStat, 12, 'main stat flat total');
assertClose(totals.subStat, 9, 'sub stat flat total');
assertClose(totals.mainStatBoost, 0.08, 'main stat additive total');
assertClose(totals.subStatBoost, 0.06, 'sub stat additive total');
assertClose(totals.allStatBoost, 0.04, 'all stat additive total');
assertClose(totals.strengthBoost, 10, 'strength flat total');
assertClose(totals.agilityBoost, 7, 'agility flat total');
assertClose(totals.critRateBoost, 0.15, 'crit rate boost total');
assertClose(totals.critDmgBonusBoost, 0.22, 'crit damage boost total');
assertClose(totals.comboDamageBonus, 0.26, 'combo total should include direct, partial-countable, and derived values');
assertClose(totals.imbalanceDamageBonus, 0.17, 'buff imbalance total');

const panelTrace = calculateBuffedPanelTrace(
  FULL_MULTIPLIER_FIXTURE.panelBase!,
  FULL_MULTIPLIER_FIXTURE.buffs,
  FULL_MULTIPLIER_FIXTURE.buffStackCounts,
);
const expectedPanel = FULL_MULTIPLIER_GOLDEN.panel;
assertClose(panelTrace.rawAtk, expectedPanel.rawAtk, 'panel.rawAtk');
assertClose(panelTrace.weaponAtkRate, expectedPanel.weaponAtkRate, 'panel.weaponAtkRate');
assertClose(panelTrace.atkPercentBoost, expectedPanel.atkPercentBoost, 'panel.atkPercentBoost');
assertClose(panelTrace.flatAtk, expectedPanel.flatAtk, 'panel.flatAtk');
assertClose(panelTrace.fixedAtk, expectedPanel.fixedAtk, 'panel.fixedAtk');
assertClose(panelTrace.attackBaseAfterBuff, expectedPanel.attackBaseAfterBuff, 'panel.attackBaseAfterBuff');
assertClose(panelTrace.mainAbility?.rawValue ?? 0, expectedPanel.main.rawValue, 'panel.main.rawValue');
assertClose(panelTrace.mainAbility?.directionalFlatBoost ?? 0, expectedPanel.main.directionalFlatBoost, 'panel.main.directionalFlatBoost');
assertClose(panelTrace.mainAbility?.baseStatScale ?? 0, expectedPanel.main.baseStatScale, 'panel.main.baseStatScale');
assertClose(panelTrace.mainAbility?.statBuffRate ?? 0, expectedPanel.main.statBuffRate, 'panel.main.statBuffRate');
assertClose(panelTrace.mainAbility?.statAdditiveRate ?? 0, expectedPanel.main.statAdditiveRate, 'panel.main.statAdditiveRate');
assertClose(panelTrace.mainAbility?.baseAllStatScale ?? 0, expectedPanel.main.baseAllStatScale, 'panel.main.baseAllStatScale');
assertClose(panelTrace.mainAbility?.allStatBuffRate ?? 0, expectedPanel.main.allStatBuffRate, 'panel.main.allStatBuffRate');
assertClose(panelTrace.mainAbility?.allStatAdditiveRate ?? 0, expectedPanel.main.allStatAdditiveRate, 'panel.main.allStatAdditiveRate');
assertClose(panelTrace.mainAbility?.directionalMultiplier ?? 0, expectedPanel.main.directionalMultiplier, 'panel.main.directionalMultiplier');
assertClose(panelTrace.mainAbility?.statMultiplier ?? 0, expectedPanel.main.statMultiplier, 'panel.main.statMultiplier');
assertClose(panelTrace.mainAbility?.allStatMultiplier ?? 0, expectedPanel.main.allStatMultiplier, 'panel.main.allStatMultiplier');
assertClose(panelTrace.mainAbility?.valueBeforeRounding ?? 0, expectedPanel.main.valueBeforeRounding, 'panel.main.valueBeforeRounding');
assertEqual(panelTrace.mainAbility?.finalValue, expectedPanel.main.finalValue, 'panel.main.finalValue');
assertClose(panelTrace.mainAbility?.attackBonus ?? 0, expectedPanel.main.attackBonus, 'panel.main.attackBonus');
assertClose(panelTrace.subAbility?.rawValue ?? 0, expectedPanel.sub.rawValue, 'panel.sub.rawValue');
assertClose(panelTrace.subAbility?.directionalFlatBoost ?? 0, expectedPanel.sub.directionalFlatBoost, 'panel.sub.directionalFlatBoost');
assertClose(panelTrace.subAbility?.baseStatScale ?? 0, expectedPanel.sub.baseStatScale, 'panel.sub.baseStatScale');
assertClose(panelTrace.subAbility?.statBuffRate ?? 0, expectedPanel.sub.statBuffRate, 'panel.sub.statBuffRate');
assertClose(panelTrace.subAbility?.statAdditiveRate ?? 0, expectedPanel.sub.statAdditiveRate, 'panel.sub.statAdditiveRate');
assertClose(panelTrace.subAbility?.baseAllStatScale ?? 0, expectedPanel.sub.baseAllStatScale, 'panel.sub.baseAllStatScale');
assertClose(panelTrace.subAbility?.allStatBuffRate ?? 0, expectedPanel.sub.allStatBuffRate, 'panel.sub.allStatBuffRate');
assertClose(panelTrace.subAbility?.allStatAdditiveRate ?? 0, expectedPanel.sub.allStatAdditiveRate, 'panel.sub.allStatAdditiveRate');
assertClose(panelTrace.subAbility?.directionalMultiplier ?? 0, expectedPanel.sub.directionalMultiplier, 'panel.sub.directionalMultiplier');
assertClose(panelTrace.subAbility?.statMultiplier ?? 0, expectedPanel.sub.statMultiplier, 'panel.sub.statMultiplier');
assertClose(panelTrace.subAbility?.allStatMultiplier ?? 0, expectedPanel.sub.allStatMultiplier, 'panel.sub.allStatMultiplier');
assertClose(panelTrace.subAbility?.valueBeforeRounding ?? 0, expectedPanel.sub.valueBeforeRounding, 'panel.sub.valueBeforeRounding');
assertEqual(panelTrace.subAbility?.finalValue, expectedPanel.sub.finalValue, 'panel.sub.finalValue');
assertClose(panelTrace.subAbility?.attackBonus ?? 0, expectedPanel.sub.attackBonus, 'panel.sub.attackBonus');
assertClose(panelTrace.abilityBonus, expectedPanel.abilityBonus, 'panel.abilityBonus');
assertClose(panelTrace.finalAtk, expectedPanel.finalAtk, 'panel.finalAtk');
assertClose(panelTrace.critRate, expectedPanel.critRate, 'panel.critRate');
assertClose(panelTrace.critDmg, expectedPanel.critDmg, 'panel.critDmg');

const result = calculateSkillButtonDamageV2(FULL_MULTIPLIER_FIXTURE);
result.hits.forEach((hit, index) => {
  const expected = FULL_MULTIPLIER_GOLDEN.hits[index];
  const label = `hit[${index}]`;
  assertClose(hit.panel.atk, expectedPanel.finalAtk, `${label}.panel.atk`);
  assertClose(hit.panel.critRate, expectedPanel.critRate, `${label}.panel.critRate`);
  assertClose(hit.panel.critDmg, expectedPanel.critDmg, `${label}.panel.critDmg`);
  assertClose(hit.zones.elementBonus, expected.zones.elementBonus, `${label}.zones.elementBonus`);
  assertClose(hit.zones.skillBonus, expected.zones.skillBonus, `${label}.zones.skillBonus`);
  assertClose(hit.zones.allDamageBonus, expected.zones.allDamageBonus, `${label}.zones.allDamageBonus`);
  assertZone(hit.zones.damageBonus!, expected.zones.damageBonus, `${label}.zones.damageBonus`);
  assertZone(hit.zones.amplify!, expected.zones.amplify, `${label}.zones.amplify`);
  assertZone(hit.zones.fragile!, expected.zones.fragile, `${label}.zones.fragile`);
  assertZone(hit.zones.vulnerability!, expected.zones.vulnerability, `${label}.zones.vulnerability`);
  assertZone(hit.zones.skillMultiplier!, expected.zones.skillMultiplier, `${label}.zones.skillMultiplier`);
  assertClose(hit.zones.resistance.baseResistance, expected.zones.resistance.baseResistance, `${label}.zones.resistance.baseResistance`);
  assertClose(hit.zones.resistance.corrosion, expected.zones.resistance.corrosion, `${label}.zones.resistance.corrosion`);
  assertClose(hit.zones.resistance.resistanceIgnore, expected.zones.resistance.resistanceIgnore, `${label}.zones.resistance.resistanceIgnore`);
  assertClose(hit.zones.resistance.effectiveResistance, expected.zones.resistance.effectiveResistance, `${label}.zones.resistance.effectiveResistance`);
  assertClose(hit.zones.resistance.resistanceZone, expected.zones.resistance.resistanceZone, `${label}.zones.resistance.resistanceZone`);
  assertClose(hit.zones.resistanceZone, expected.zones.resistance.resistanceZone, `${label}.zones.resistanceZone`);
  assertClose(hit.zones.amplifyRate, expected.zones.amplify.finalValue - 1, `${label}.zones.amplifyRate`);
  assertClose(hit.zones.fragileRate, expected.zones.fragile.finalValue - 1, `${label}.zones.fragileRate`);
  assertClose(hit.zones.vulnerabilityRate, expected.zones.vulnerability.finalValue - 1, `${label}.zones.vulnerabilityRate`);
  assertClose(hit.zones.comboDamageBonus, expected.zones.comboDamageBonus, `${label}.zones.comboDamageBonus`);
  assertClose(hit.zones.imbalanceDamageBonus, expected.zones.imbalanceDamageBonus, `${label}.zones.imbalanceDamageBonus`);
  assertClose(hit.zones.defenseZone, expected.zones.defenseZone, `${label}.zones.defenseZone`);
  assertClose(hit.multiplier.base, expected.multiplier.base, `${label}.multiplier.base`);
  assertClose(hit.multiplier.afterBonus, expected.multiplier.afterBonus, `${label}.multiplier.afterBonus`);
  assertClose(hit.multiplier.afterMultiply, expected.multiplier.afterMultiply, `${label}.multiplier.afterMultiply`);

  const conditionId = index === 0 ? 'fire-damage' : 'physical-damage';
  const conditionValue = index === 0 ? 0.11 : 0.13;
  const conditionContribution = hit.buffContributions?.find((contribution) => contribution.buffId === conditionId);
  if (!conditionContribution) throw new Error(`${label} is missing condition fixed-value contribution`);
  assertClose(conditionContribution.rawValue, conditionValue, `${label}.condition.rawValue`);
  assertClose(conditionContribution.runtimeCoefficient, 1, `${label}.condition.runtimeCoefficient`);
  assertClose(conditionContribution.effectiveValue, conditionValue, `${label}.condition.effectiveValue`);
  assertEqual(conditionContribution.multiplierCoefficient, undefined, `${label}.condition.multiplierCoefficient`);

  const passiveContribution = hit.buffContributions?.find((contribution) => contribution.buffId === 'all-damage');
  if (!passiveContribution) throw new Error(`${label} is missing passive contribution`);
  assertClose(passiveContribution.rawValue, 0.10, `${label}.passive.rawValue`);
  assertClose(passiveContribution.runtimeCoefficient, 1, `${label}.passive.runtimeCoefficient`);
  assertClose(passiveContribution.effectiveValue, 0.10, `${label}.passive.effectiveValue`);
  assertEqual(passiveContribution.multiplierCoefficient, undefined, `${label}.passive.multiplierCoefficient`);

  const countable = FULL_MULTIPLIER_FIXTURE.buffs.find((buff) => buff.id === 'combo-countable');
  if (!countable) throw new Error(`${label} is missing countable buff definition`);
  const countableValue = resolveBuffInstanceValue(countable, FULL_MULTIPLIER_FIXTURE.buffStackCounts);
  assertClose(countableValue.rawValue, 0.06, `${label}.countable.rawValue`);
  assertClose(countableValue.runtimeCoefficient, 2, `${label}.countable.runtimeCoefficient`);
  assertClose(countableValue.effectiveValue, 0.12, `${label}.countable.effectiveValue`);

  const derived = FULL_MULTIPLIER_FIXTURE.buffs.find((buff) => buff.id === 'combo-derived');
  if (!derived) throw new Error(`${label} is missing derived buff definition`);
  const derivedValue = resolveBuffInstanceValue(derived, FULL_MULTIPLIER_FIXTURE.buffStackCounts);
  assertClose(derivedValue.rawValue, 0.06, `${label}.derived.rawValue`);
  assertClose(derivedValue.runtimeCoefficient, 1, `${label}.derived.runtimeCoefficient`);
  assertClose(derivedValue.effectiveValue, 0.06, `${label}.derived.effectiveValue`);

  const multiplierId = index === 0 ? 'fire-damage-multiplier' : 'physical-damage-multiplier';
  const multiplierCoefficient = index === 0 ? 1.10 : 1.12;
  const multiplierContribution = hit.buffContributions?.find((contribution) => contribution.buffId === multiplierId);
  if (!multiplierContribution) throw new Error(`${label} is missing multiplier contribution`);
  assertClose(multiplierContribution.rawValue, 0, `${label}.multiplier.rawValue`);
  assertClose(multiplierContribution.runtimeCoefficient, 1, `${label}.multiplier.runtimeCoefficient`);
  assertClose(multiplierContribution.effectiveValue, multiplierCoefficient, `${label}.multiplier.effectiveValue`);
  assertClose(multiplierContribution.multiplierCoefficient ?? 0, multiplierCoefficient, `${label}.multiplier.multiplierCoefficient`);
  assertBreakdown(hit.nonCrit, expected.breakdown.nonCrit, `${label}.nonCrit`);
  assertBreakdown(hit.crit, expected.breakdown.crit, `${label}.crit`);
  assertBreakdown(hit.expected, expected.breakdown.expected, `${label}.expected`);

  // Combo is applied after the last exposed field. Keep this hidden transition explicit in the golden test.
  assertClose(
    hit.nonCrit.afterVulnerability * (1 + expected.zones.comboDamageBonus),
    expected.breakdown.nonCrit.afterCombo,
    `${label}.nonCrit.afterCombo`,
  );
  assertClose(
    hit.crit.afterVulnerability * (1 + expected.zones.comboDamageBonus),
    expected.breakdown.crit.afterCombo,
    `${label}.crit.afterCombo`,
  );
  assertClose(
    hit.expected.afterVulnerability * (1 + expected.zones.comboDamageBonus),
    expected.breakdown.expected.afterCombo,
    `${label}.expected.afterCombo`,
  );
});

assertClose(result.summary.totalExpected, FULL_MULTIPLIER_GOLDEN.summary.totalExpected, 'summary.totalExpected');
assertClose(result.summary.totalCrit, FULL_MULTIPLIER_GOLDEN.summary.totalCrit, 'summary.totalCrit');
assertClose(result.summary.totalNonCrit, FULL_MULTIPLIER_GOLDEN.summary.totalNonCrit, 'summary.totalNonCrit');
