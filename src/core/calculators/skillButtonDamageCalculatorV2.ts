import type { DamageBonusSnapshot, SkillButtonBuff } from '../../types/storage';
import {
  calculateBuffTotals,
  calculateElementDmgBonus,
  calculateResistanceZone,
  calculateSkillDmgBonus,
} from './buffCalculator';
import { calculateHitBuffZones } from './buffZoneCalculator';
import type {
  DamageBreakdown,
  DamageZones,
  HitCalcResult,
  ResolvedHitTemplate,
  SkillDamageCalcInputV2,
  SkillDamageCalcResultV2,
  SkillDamagePanel,
} from './skillDamage.types';

function doesBuffApplyToHit(buff: SkillButtonBuff, hit: ResolvedHitTemplate): boolean {
  const target = buff.target;
  if (!target || target.mode === 'all') {
    return true;
  }

  switch (target.mode) {
    case 'damageKey':
      return hit.key === target.key;
    case 'skillType':
      return hit.skillType === target.skillType;
    case 'element':
      return hit.element === target.element;
    default:
      return true;
  }
}

function filterBuffsForHit(hit: ResolvedHitTemplate, buffs: SkillButtonBuff[]): SkillButtonBuff[] {
  return buffs.filter((buff) => doesBuffApplyToHit(buff, hit));
}

function buildPanelForHit(
  appliedBuffs: SkillButtonBuff[],
  input: SkillDamageCalcInputV2
): SkillDamagePanel {
  if (!input.panelBase) {
    return input.panel;
  }

  const buffTotals = calculateBuffTotals(appliedBuffs, input.buffStackCounts);
  const currentAtkPercent = input.panelBase.weaponAtkPercent * 0.01;
  const rawAtk = input.panelBase.characterAtk + input.panelBase.weaponAtk;
  const fixedAtk = input.panelBase.baseAtk - rawAtk * (1 + currentAtkPercent);
  const nextBaseAtk = rawAtk * (1 + currentAtkPercent + buffTotals.atkPercentBoost) + fixedAtk;
  const abilityAtkPercentBonus = input.panelBase.abilityBonus * 0.01;

  return {
    atk: nextBaseAtk * (1 + abilityAtkPercentBonus),
    critRate: (input.panelBase.critRate ?? 0.05) + buffTotals.critRateBoost,
    critDmg: (input.panelBase.critDmg ?? 0.5) + buffTotals.critDmgBonusBoost,
  };
}

function calculateHitDamage(
  panelAtk: number,
  multiplierValue: number,
  critMultiplier: number,
  damageBonusRate: number,
  defenseZone: number,
  resistanceZone: number,
  amplifyRate: number,
  fragileRate: number,
  vulnerabilityRate: number,
  comboDamageBonus: number,
  imbalanceDamageBonus: number
): DamageBreakdown {
  const base = panelAtk * multiplierValue;
  const afterCrit = base * critMultiplier;
  const afterBonus = afterCrit * damageBonusRate;
  const afterDefense = afterBonus * defenseZone;
  const afterResistance = afterDefense * resistanceZone;
  const afterAmplify = afterResistance * (1 + amplifyRate);
  const afterFragile = afterAmplify * (1 + fragileRate);
  const afterVulnerability = afterFragile * (1 + vulnerabilityRate);
  const afterCombo = afterVulnerability * (1 + comboDamageBonus);
  const final = afterCombo * (1 + imbalanceDamageBonus);

  return {
    base,
    afterCrit,
    afterBonus,
    afterDefense,
    afterResistance,
    afterAmplify,
    afterFragile,
    afterVulnerability,
    final,
  };
}

function toDamageBonusRecord(damageBonus: DamageBonusSnapshot): Record<string, number> {
  return { ...damageBonus };
}

function calculateAllDamageBonus(
  damageBonus: DamageBonusSnapshot,
  buffs: ReturnType<typeof calculateBuffTotals>
): number {
  return (damageBonus.allDmgBonus || 0) + (buffs.allDmgBonus || 0);
}

function calculateHitZones(
  hit: ResolvedHitTemplate,
  damageBonus: DamageBonusSnapshot,
  buffs: ReturnType<typeof calculateBuffTotals>,
  targetResistance: SkillDamageCalcInputV2['targetResistance'],
  zoneResults: ReturnType<typeof calculateHitBuffZones>
): DamageZones {
  const parsedDamageBonus = toDamageBonusRecord(damageBonus);
  const elementBonus = calculateElementDmgBonus(hit.element, parsedDamageBonus, buffs);
  const skillBonus = calculateSkillDmgBonus(hit.skillType, parsedDamageBonus, buffs);
  const allDamageBonus = calculateAllDamageBonus(damageBonus, buffs);
  const damageBonusRate = zoneResults.damageBonus.finalValue;
  const resistance = calculateResistanceZone(hit.element, targetResistance, buffs);

  return {
    damageBonus: zoneResults.damageBonus,
    amplify: zoneResults.amplify,
    fragile: zoneResults.fragile,
    vulnerability: zoneResults.vulnerability,
    skillMultiplier: zoneResults.skillMultiplier,
    elementBonus,
    skillBonus,
    allDamageBonus,
    damageBonusRate,
    resistanceZone: resistance.resistanceZone,
    resistance,
    amplifyRate: zoneResults.amplify.finalValue - 1,
    fragileRate: zoneResults.fragile.finalValue - 1,
    vulnerabilityRate: zoneResults.vulnerability.finalValue - 1,
    comboDamageBonus: buffs.comboDamageBonus,
    imbalanceDamageBonus: buffs.imbalanceDamageBonus + (hit.element === 'physical' ? (damageBonus.imbalanceDmgBonus || 0) : 0),
    defenseZone: 0.5,
  };
}

function calculateSingleHit(
  hit: ResolvedHitTemplate,
  buffs: SkillButtonBuff[],
  input: SkillDamageCalcInputV2
): HitCalcResult {
  const isDisabled = input.disabledHitKeys?.includes(hit.key) ?? false;
  const disabledBuffIds = new Set(input.disabledBuffIdsByHitKey?.[hit.key] ?? []);
  const appliedBuffs = filterBuffsForHit(hit, buffs).filter((buff) => !disabledBuffIds.has(buff.id));
  const effectiveBuffs = isDisabled ? [] : appliedBuffs;
  const hitStackCounts = {
    ...(input.buffStackCounts ?? {}),
    ...(input.buffStackCountsByHitKey?.[hit.key] ?? {}),
  };
  const hitInput = { ...input, buffStackCounts: hitStackCounts };
  const panel = buildPanelForHit(effectiveBuffs, hitInput);
  const buffTotals = calculateBuffTotals(effectiveBuffs, hitStackCounts);
  const zoneResults = calculateHitBuffZones({
    context: { element: hit.element, skillType: hit.skillType },
    buffs: effectiveBuffs,
    stackCounts: hitStackCounts,
    damageBonus: input.damageBonus,
    baseSkillMultiplier: hit.multiplier,
  });
  const zones = calculateHitZones(hit, input.damageBonus, buffTotals, input.targetResistance, zoneResults);
  const multiplier = {
    base: hit.multiplier,
    afterBonus: hit.multiplier + zoneResults.skillMultiplier.additiveTotal,
    afterMultiply: zoneResults.skillMultiplier.finalValue,
  };

  const critRate = panel.critRate;
  const critDmg = panel.critDmg;
  const critExpected = 1 + critRate * critDmg;

  return {
    hit,
    isDisabled,
    appliedBuffs: effectiveBuffs,
    panel,
    zones,
    buffContributions: zoneResults.contributions,
    multiplier,
    nonCrit: isDisabled
      ? createZeroDamageBreakdown()
      : calculateHitDamage(
        panel.atk,
        multiplier.afterMultiply,
        1,
        zones.damageBonusRate,
        zones.defenseZone,
        zones.resistanceZone,
        zones.amplifyRate,
        zones.fragileRate,
        zones.vulnerabilityRate,
        zones.comboDamageBonus,
        zones.imbalanceDamageBonus
      ),
    crit: isDisabled
      ? createZeroDamageBreakdown()
      : calculateHitDamage(
        panel.atk,
        multiplier.afterMultiply,
        1 + critDmg,
        zones.damageBonusRate,
        zones.defenseZone,
        zones.resistanceZone,
        zones.amplifyRate,
        zones.fragileRate,
        zones.vulnerabilityRate,
        zones.comboDamageBonus,
        zones.imbalanceDamageBonus
      ),
    expected: isDisabled
      ? createZeroDamageBreakdown()
      : calculateHitDamage(
        panel.atk,
        multiplier.afterMultiply,
        critExpected,
        zones.damageBonusRate,
        zones.defenseZone,
        zones.resistanceZone,
        zones.amplifyRate,
        zones.fragileRate,
        zones.vulnerabilityRate,
        zones.comboDamageBonus,
        zones.imbalanceDamageBonus
      ),
  };
}

function createZeroDamageBreakdown(): DamageBreakdown {
  return {
    base: 0,
    afterCrit: 0,
    afterBonus: 0,
    afterDefense: 0,
    afterResistance: 0,
    afterAmplify: 0,
    afterFragile: 0,
    afterVulnerability: 0,
    final: 0,
  };
}

export function calculateSkillButtonDamageV2(
  input: SkillDamageCalcInputV2
): SkillDamageCalcResultV2 {
  const hits = input.template.hits.map((hit) => calculateSingleHit(hit, input.buffs, input));

  return {
    hits,
    summary: {
      totalExpected: hits.reduce((sum, hit) => sum + hit.expected.final, 0),
      totalCrit: hits.reduce((sum, hit) => sum + hit.crit.final, 0),
      totalNonCrit: hits.reduce((sum, hit) => sum + hit.nonCrit.final, 0),
    },
  };
}
