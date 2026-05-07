import type { DamageBonusSnapshot, SkillButtonBuff } from '../../types/storage';
import {
  calculateAmplifyRate,
  calculateBuffTotals,
  calculateElementDmgBonus,
  calculateFragileRate,
  calculateSkillDmgBonus,
  calculateVulnerabilityRate,
} from './buffCalculator';
import type {
  DamageBreakdown,
  DamageZones,
  HitCalcResult,
  MultiplierAdjustment,
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

  const buffTotals = calculateBuffTotals(appliedBuffs);
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
  const afterAmplify = afterDefense * (1 + amplifyRate);
  const afterFragile = afterAmplify * (1 + fragileRate);
  const afterVulnerability = afterFragile * (1 + vulnerabilityRate);
  const afterCombo = afterVulnerability * (1 + comboDamageBonus);
  const final = afterCombo * (1 + imbalanceDamageBonus);

  return {
    base,
    afterCrit,
    afterBonus,
    afterDefense,
    afterAmplify,
    afterFragile,
    afterVulnerability,
    final,
  };
}

function applyMultiplierAdjustments(
  baseMultiplier: number,
  buffs: ReturnType<typeof calculateBuffTotals>
): MultiplierAdjustment {
  const afterBonus = baseMultiplier + buffs.multiplierBonus;
  const afterMultiply = afterBonus * buffs.multiplierMultiplier;
  return {
    base: baseMultiplier,
    afterBonus,
    afterMultiply,
  };
}

function toDamageBonusRecord(damageBonus: DamageBonusSnapshot): Record<string, number> {
  return { ...damageBonus };
}

function calculateAllDamageBonus(
  hit: ResolvedHitTemplate,
  damageBonus: DamageBonusSnapshot
): number {
  if (hit.element === 'physical') {
    return damageBonus.allDmgBonus || 0;
  }
  return 0;
}

function calculateHitZones(
  hit: ResolvedHitTemplate,
  damageBonus: DamageBonusSnapshot,
  buffs: ReturnType<typeof calculateBuffTotals>
): DamageZones {
  const parsedDamageBonus = toDamageBonusRecord(damageBonus);
  const elementBonus = calculateElementDmgBonus(hit.element, parsedDamageBonus, buffs);
  const skillBonus = calculateSkillDmgBonus(hit.skillType, parsedDamageBonus, buffs);
  const allDamageBonus = calculateAllDamageBonus(hit, damageBonus);
  const damageBonusRate = 1 + elementBonus + skillBonus + allDamageBonus;

  return {
    elementBonus,
    skillBonus,
    allDamageBonus,
    damageBonusRate,
    amplifyRate: calculateAmplifyRate(hit.element, buffs),
    // 项目既有语义：
    // - 脆弱区 = Vulnerability
    // - 易伤区 = Fragile
    // 例如：
    // - physicalVulnerability = 物理脆弱
    // - physicalFragile = 物伤易伤
    fragileRate: calculateVulnerabilityRate(hit.element, buffs),
    vulnerabilityRate: calculateFragileRate(hit.element, buffs),
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
  const disabledBuffIds = new Set(input.disabledBuffIdsByHitKey?.[hit.key] ?? []);
  const appliedBuffs = filterBuffsForHit(hit, buffs).filter((buff) => !disabledBuffIds.has(buff.id));
  const panel = buildPanelForHit(appliedBuffs, input);
  const buffTotals = calculateBuffTotals(appliedBuffs);
  const zones = calculateHitZones(hit, input.damageBonus, buffTotals);
  const multiplier = applyMultiplierAdjustments(hit.multiplier, buffTotals);

  const critRate = panel.critRate;
  const critDmg = panel.critDmg;
  const critExpected = 1 + critRate * critDmg;

  return {
    hit,
    appliedBuffs,
    panel,
    zones,
    multiplier,
    nonCrit: calculateHitDamage(
      panel.atk,
      multiplier.afterMultiply,
      1,
      zones.damageBonusRate,
      zones.defenseZone,
      zones.amplifyRate,
      zones.fragileRate,
      zones.vulnerabilityRate,
      zones.comboDamageBonus,
      zones.imbalanceDamageBonus
    ),
    crit: calculateHitDamage(
      panel.atk,
      multiplier.afterMultiply,
      1 + critDmg,
      zones.damageBonusRate,
      zones.defenseZone,
      zones.amplifyRate,
      zones.fragileRate,
      zones.vulnerabilityRate,
      zones.comboDamageBonus,
      zones.imbalanceDamageBonus
    ),
    expected: calculateHitDamage(
      panel.atk,
      multiplier.afterMultiply,
      critExpected,
      zones.damageBonusRate,
      zones.defenseZone,
      zones.amplifyRate,
      zones.fragileRate,
      zones.vulnerabilityRate,
      zones.comboDamageBonus,
      zones.imbalanceDamageBonus
    ),
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
