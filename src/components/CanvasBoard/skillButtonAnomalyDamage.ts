import {
  calculateAmplifyRate,
  calculateBuffTotals,
  calculateFragileRate,
  calculateVulnerabilityRate,
} from '../../core/calculators/buffCalculator';
import type { AppliedBuffTagViewModel, SkillDamagePanel, SkillDamagePanelBase } from '../../core/calculators/skillDamage.types';
import type { DamageBonusSnapshot, SkillButtonBuff } from '../../types/storage';
import {
  buildAppliedBuffTags,
  buildPanelFromBase,
  type AnomalyDamageSegmentView,
  type SelectedAnomalyCard,
} from './skillButton.shared';

interface HitCardRef {
  displayName: string;
  nonCritText: string;
}

interface BuildAnomalyDamageSegmentsParams {
  panelBase: SkillDamagePanelBase | null;
  panelData: SkillDamagePanel | null;
  hitCards: HitCardRef[];
  selectedAnomalyDamages: SelectedAnomalyCard[];
  buttonCharacterId: string;
  element?: string;
  damageBonus: DamageBonusSnapshot;
  fullCombinedModifierBuffList: SkillButtonBuff[];
  extraHitBuffList: Array<SkillButtonBuff & { effectKind: 'extraHit'; extraHitConfig: NonNullable<SkillButtonBuff['extraHitConfig']> }>;
  manuallyDisabledBuffIdsBySegmentKey: Record<string, string[]>;
  getEffectiveCharacterSourceSkillBoost: (characterId: string | null, buffs?: SkillButtonBuff[]) => number;
}

function resolveBaseMultiplierPercent(card: SelectedAnomalyCard): number {
  switch (card.key) {
    case 'magic-burst':
      return 160;
    case 'smash':
      return 150 * (1 + card.level);
    case 'armor-break':
      return 50 * (1 + card.level);
    case 'shatter-ice':
      return 120 * (1 + card.level);
    case 'conductive':
    case 'corrosion':
    case 'burn':
    case 'freeze':
      return 80 * (1 + card.level);
    case 'knockdown':
    case 'launch':
      return 120;
    default:
      return 0;
  }
}

function resolveLevelCoefficient(card: SelectedAnomalyCard, operatorLevel: number): number {
  if (card.key === 'shatter-ice' || card.category === 'magic') {
    return 1 + (operatorLevel - 1) / 196;
  }
  return 1 + (operatorLevel - 1) / 392;
}

function resolveElementText(card: SelectedAnomalyCard, fallbackElement?: string): string {
  switch (card.key) {
    case 'smash':
    case 'knockdown':
    case 'launch':
    case 'shatter-ice':
      return '物理';
    case 'conductive':
      return '电磁';
    case 'corrosion':
      return '自然';
    case 'burn':
      return '灼热';
    case 'freeze':
      return '寒冷';
    case 'magic-burst':
      return fallbackElement === 'electric'
        ? '电磁'
        : fallbackElement === 'fire'
          ? '灼热'
          : fallbackElement === 'ice'
            ? '寒冷'
            : fallbackElement === 'nature'
              ? '自然'
              : '法术';
    default:
      return '异常';
  }
}

function resolveElementKey(card: SelectedAnomalyCard, fallbackElement?: string): string {
  switch (card.key) {
    case 'smash':
    case 'knockdown':
    case 'launch':
    case 'shatter-ice':
    case 'armor-break':
      return 'physical';
    case 'conductive':
      return 'electric';
    case 'corrosion':
      return 'nature';
    case 'burn':
      return 'fire';
    case 'freeze':
      return 'ice';
    case 'magic-burst':
      return fallbackElement ?? 'magic';
    default:
      return fallbackElement ?? 'magic';
  }
}

function calculateBreakdown(
  panelAtk: number,
  multiplierValue: number,
  critFactor: number,
  damageBonusRate: number,
  defenseZone: number,
  amplifyRate: number,
  fragileRate: number,
  vulnerabilityRate: number,
  comboDamageBonus: number,
  imbalanceDamageBonus: number
): number {
  const base = panelAtk * multiplierValue;
  const afterCrit = base * critFactor;
  const afterBonus = afterCrit * damageBonusRate;
  const afterDefense = afterBonus * defenseZone;
  const afterAmplify = afterDefense * (1 + amplifyRate);
  const afterFragile = afterAmplify * (1 + fragileRate);
  const afterVulnerability = afterFragile * (1 + vulnerabilityRate);
  const afterCombo = afterVulnerability * (1 + comboDamageBonus);
  return afterCombo * (1 + imbalanceDamageBonus);
}

export function buildAnomalyDamageSegments({
  panelBase,
  panelData,
  hitCards,
  selectedAnomalyDamages,
  buttonCharacterId,
  element,
  damageBonus,
  fullCombinedModifierBuffList,
  extraHitBuffList,
  manuallyDisabledBuffIdsBySegmentKey,
  getEffectiveCharacterSourceSkillBoost,
}: BuildAnomalyDamageSegmentsParams): AnomalyDamageSegmentView[] {
  if (!panelData) {
    return [];
  }

  const currentOperatorLevel = 90;
  const parsedDamageBonusRecord = damageBonus as unknown as Record<string, number>;

  const anomalySegments = selectedAnomalyDamages.flatMap<AnomalyDamageSegmentView>((card, index) => {
    const baseMultiplierPercent = resolveBaseMultiplierPercent(card);
    const levelCoefficient = resolveLevelCoefficient(card, currentOperatorLevel);
    const elementKey = resolveElementKey(card, element);
    const disabledBuffIds = new Set(manuallyDisabledBuffIdsBySegmentKey[card.id] ?? []);
    const baseAppliedBuffs = card.selectedBuffIds.length === 0
      ? [...fullCombinedModifierBuffList]
      : [...fullCombinedModifierBuffList.filter((buff) => card.selectedBuffIds.includes(buff.id) || buff.source === 'anomaly_state')];
    const appliedBuffs = baseAppliedBuffs.filter((buff) => !disabledBuffIds.has(buff.id));
    const appliedBuffTags = buildAppliedBuffTags(appliedBuffs);
    const segmentPanel = buildPanelFromBase(panelBase, panelData, appliedBuffs);
    if (!segmentPanel) {
      return [];
    }

    const buffTotals = calculateBuffTotals(appliedBuffs);
    const currentCharacterSourceSkillBoost = getEffectiveCharacterSourceSkillBoost(buttonCharacterId, appliedBuffs);
    const sourceSkillZone = 1 + currentCharacterSourceSkillBoost / 100;
    const anomalyAtk = segmentPanel.atk;
    const anomalyCritRate = segmentPanel.critRate;
    const anomalyCritDmg = segmentPanel.critDmg;
    const anomalyCritMultiplier = 1 + anomalyCritDmg;
    const anomalyExpectedMultiplier = 1 + anomalyCritRate * anomalyCritDmg;
    const anomalyBaseMultiplier = (baseMultiplierPercent / 100) * levelCoefficient * sourceSkillZone;
    const multiplierAfterBonus = anomalyBaseMultiplier + buffTotals.multiplierBonus;
    const finalMultiplier = multiplierAfterBonus * buffTotals.multiplierMultiplier;
    const isPhysical = elementKey === 'physical';
    const elementBonus = isPhysical
      ? (damageBonus.physicalDmgBonus || 0) + (buffTotals.physicalDmgBonus || 0)
      : (((parsedDamageBonusRecord[`${elementKey}DmgBonus`] || 0) as number)
        + (((buffTotals[`${elementKey}DmgBonus` as keyof typeof buffTotals] || 0) as number))
        + ((parsedDamageBonusRecord.magicDmgBonus || 0) as number)
        + (buffTotals.magicDmgBonus || 0)
        + ((parsedDamageBonusRecord.allElementDmgBonus || 0) as number));
    const skillBonus = 0;
    const allDamageBonus = (damageBonus.allDmgBonus || 0) + (buffTotals.allDmgBonus || 0);
    const damageBonusRate = 1 + elementBonus + skillBonus + allDamageBonus;
    const amplifyRate = calculateAmplifyRate(elementKey, buffTotals);
    const fragileRate = calculateFragileRate(elementKey, buffTotals);
    const vulnerabilityRate = calculateVulnerabilityRate(elementKey, buffTotals);
    const comboDamageBonus = buffTotals.comboDamageBonus;
    const imbalanceDamageBonus = buffTotals.imbalanceDamageBonus + (elementKey === 'physical' ? (damageBonus.imbalanceDmgBonus || 0) : 0);
    const defenseZone = 0.5;
    const baseNonCrit = anomalyAtk * finalMultiplier;
    const nonCrit = calculateBreakdown(anomalyAtk, finalMultiplier, 1, damageBonusRate, defenseZone, amplifyRate, fragileRate, vulnerabilityRate, comboDamageBonus, imbalanceDamageBonus);
    const crit = calculateBreakdown(anomalyAtk, finalMultiplier, anomalyCritMultiplier, damageBonusRate, defenseZone, amplifyRate, fragileRate, vulnerabilityRate, comboDamageBonus, imbalanceDamageBonus);
    const expected = calculateBreakdown(anomalyAtk, finalMultiplier, anomalyExpectedMultiplier, damageBonusRate, defenseZone, amplifyRate, fragileRate, vulnerabilityRate, comboDamageBonus, imbalanceDamageBonus);
    const sequenceNumber = hitCards.length + index + 1;

    return [{
      key: card.id,
      sourceKind: 'anomaly',
      title: `${sequenceNumber}段 · ${card.label}`,
      sequenceTitle: `${sequenceNumber}段`,
      compactTitle: `${card.label}`,
      buffText: appliedBuffTags.length > 0 ? `+${appliedBuffTags.length} Buff` : '无 Buff',
      appliedBuffTags,
      elementText: resolveElementText(card, element),
      elementKey,
      skillTypeText: '',
      panelAtkText: anomalyAtk.toFixed(0),
      critRateText: `${(anomalyCritRate * 100).toFixed(1)}%`,
      critDmgText: `${(anomalyCritDmg * 100).toFixed(1)}%`,
      sourceSkillBoostText: currentCharacterSourceSkillBoost.toFixed(1),
      levelCoefficientText: levelCoefficient.toFixed(3),
      sourceSkillZoneText: sourceSkillZone.toFixed(3),
      baseMultiplierText: `${baseMultiplierPercent.toFixed(1)}%`,
      multiplierText: `${(finalMultiplier * 100).toFixed(1)}%`,
      multiplierFormulaText: `(${(anomalyBaseMultiplier * 100).toFixed(1)}% + ${(buffTotals.multiplierBonus * 100).toFixed(1)}%) × ${buffTotals.multiplierMultiplier.toFixed(3)}`,
      expectedText: expected.toFixed(0),
      critText: crit.toFixed(0),
      nonCritText: nonCrit.toFixed(0),
      expectedValue: expected,
      critValue: crit,
      nonCritValue: nonCrit,
      formulaText: `(${baseMultiplierPercent.toFixed(1)}% × ${levelCoefficient.toFixed(3)} × ${sourceSkillZone.toFixed(3)} + ${(buffTotals.multiplierBonus * 100).toFixed(1)}%) × ${buffTotals.multiplierMultiplier.toFixed(3)} = ${(finalMultiplier * 100).toFixed(1)}%`,
      elementBonusText: `${(elementBonus * 100).toFixed(1)}%`,
      skillBonusText: `${(skillBonus * 100).toFixed(1)}%`,
      allDamageBonusText: `${(allDamageBonus * 100).toFixed(1)}%`,
      damageBonusRateText: damageBonusRate.toFixed(3),
      amplifyFormulaText: `1 + ${(amplifyRate * 100).toFixed(1)}% = ${(1 + amplifyRate).toFixed(3)}`,
      amplifyRateText: amplifyRate.toFixed(3),
      fragileFormulaText: `1 + ${(fragileRate * 100).toFixed(1)}% = ${(1 + fragileRate).toFixed(3)}`,
      fragileRateText: fragileRate.toFixed(3),
      vulnerabilityFormulaText: `1 + ${(vulnerabilityRate * 100).toFixed(1)}% = ${(1 + vulnerabilityRate).toFixed(3)}`,
      vulnerabilityRateText: vulnerabilityRate.toFixed(3),
      comboFormulaText: `1 + ${(comboDamageBonus * 100).toFixed(1)}% = ${(1 + comboDamageBonus).toFixed(3)}`,
      comboDamageBonusText: comboDamageBonus.toFixed(3),
      imbalanceFormulaText: `1 + ${(imbalanceDamageBonus * 100).toFixed(1)}% = ${(1 + imbalanceDamageBonus).toFixed(3)}`,
      imbalanceDamageBonusText: imbalanceDamageBonus.toFixed(3),
      defenseZoneText: defenseZone.toFixed(3),
      nonCritFormulaText: `${anomalyAtk.toFixed(0)} × ${(finalMultiplier * 100).toFixed(1)}% × ${damageBonusRate.toFixed(3)} × ${defenseZone.toFixed(3)} × ${(1 + amplifyRate).toFixed(3)} × ${(1 + fragileRate).toFixed(3)} × ${(1 + vulnerabilityRate).toFixed(3)} × ${(1 + comboDamageBonus).toFixed(3)} × ${(1 + imbalanceDamageBonus).toFixed(3)} = ${nonCrit.toFixed(0)} (基础伤害 ${baseNonCrit.toFixed(0)})`,
    }];
  });

  const extraHitSegments = extraHitBuffList.flatMap<AnomalyDamageSegmentView>((buff, index) => {
    const extraHitConfig = buff.extraHitConfig;
    const elementKey = extraHitConfig.damageType;
    const sequenceNumber = hitCards.length + anomalySegments.length + index + 1;
    const segmentKey = `buff-extra-hit-${buff.id}`;
    const disabledBuffIds = new Set(manuallyDisabledBuffIdsBySegmentKey[segmentKey] ?? []);
    const combinedAppliedBuffs = fullCombinedModifierBuffList.filter((item) => !disabledBuffIds.has(item.id));
    const appliedBuffTags = buildAppliedBuffTags(combinedAppliedBuffs);
    const segmentPanel = buildPanelFromBase(panelBase, panelData, combinedAppliedBuffs);
    if (!segmentPanel) {
      return [];
    }

    const buffTotals = calculateBuffTotals(combinedAppliedBuffs);
    const isPhysical = elementKey === 'physical';
    const elementBonus = isPhysical
      ? (damageBonus.physicalDmgBonus || 0) + (buffTotals.physicalDmgBonus || 0)
      : (((parsedDamageBonusRecord[`${elementKey}DmgBonus`] || 0) as number)
        + (((buffTotals[`${elementKey}DmgBonus` as keyof typeof buffTotals] || 0) as number))
        + ((parsedDamageBonusRecord.magicDmgBonus || 0) as number)
        + (buffTotals.magicDmgBonus || 0)
        + ((parsedDamageBonusRecord.allElementDmgBonus || 0) as number));
    const skillBonus = 0;
    const allDamageBonus = (damageBonus.allDmgBonus || 0) + (buffTotals.allDmgBonus || 0);
    const damageBonusRate = 1 + elementBonus + skillBonus + allDamageBonus;
    const amplifyRate = calculateAmplifyRate(elementKey, buffTotals);
    const fragileRate = calculateFragileRate(elementKey, buffTotals);
    const vulnerabilityRate = calculateVulnerabilityRate(elementKey, buffTotals);
    const comboDamageBonus = buffTotals.comboDamageBonus;
    const imbalanceDamageBonus = buffTotals.imbalanceDamageBonus + (elementKey === 'physical' ? (damageBonus.imbalanceDmgBonus || 0) : 0);
    const defenseZone = 0.5;
    const finalMultiplier = (extraHitConfig.baseMultiplier + buffTotals.multiplierBonus) * buffTotals.multiplierMultiplier;
    const extraHitAtk = segmentPanel.atk;
    const extraHitCritRate = segmentPanel.critRate;
    const extraHitCritDmg = segmentPanel.critDmg;
    const critMultiplier = 1 + extraHitCritDmg;
    const expectedMultiplier = 1 + extraHitCritRate * extraHitCritDmg;
    const baseNonCrit = extraHitAtk * finalMultiplier;
    const nonCrit = calculateBreakdown(extraHitAtk, finalMultiplier, 1, damageBonusRate, defenseZone, amplifyRate, fragileRate, vulnerabilityRate, comboDamageBonus, imbalanceDamageBonus);
    const crit = calculateBreakdown(extraHitAtk, finalMultiplier, critMultiplier, damageBonusRate, defenseZone, amplifyRate, fragileRate, vulnerabilityRate, comboDamageBonus, imbalanceDamageBonus);
    const expected = calculateBreakdown(extraHitAtk, finalMultiplier, expectedMultiplier, damageBonusRate, defenseZone, amplifyRate, fragileRate, vulnerabilityRate, comboDamageBonus, imbalanceDamageBonus);

    return [{
      key: `buff-extra-hit-${buff.id}`,
      sourceKind: 'buff-extra-hit',
      title: `${sequenceNumber}段 · ${buff.displayName}`,
      sequenceTitle: `${sequenceNumber}段`,
      compactTitle: buff.displayName,
      buffText: appliedBuffTags.length > 0 ? `+${appliedBuffTags.length} Buff` : '无 Buff',
      appliedBuffTags,
      elementText: extraHitConfig.damageType === 'physical' ? '物理' : extraHitConfig.damageType,
      elementKey,
      skillTypeText: '',
      panelAtkText: extraHitAtk.toFixed(0),
      critRateText: `${(extraHitCritRate * 100).toFixed(1)}%`,
      critDmgText: `${(extraHitCritDmg * 100).toFixed(1)}%`,
      sourceSkillBoostText: '-',
      levelCoefficientText: '-',
      sourceSkillZoneText: '-',
      baseMultiplierText: `${(extraHitConfig.baseMultiplier * 100).toFixed(1)}%`,
      multiplierText: `${(finalMultiplier * 100).toFixed(1)}%`,
      multiplierFormulaText: `(${(extraHitConfig.baseMultiplier * 100).toFixed(1)}% + ${(buffTotals.multiplierBonus * 100).toFixed(1)}%) × ${buffTotals.multiplierMultiplier.toFixed(3)}`,
      expectedText: expected.toFixed(0),
      critText: crit.toFixed(0),
      nonCritText: nonCrit.toFixed(0),
      expectedValue: expected,
      critValue: crit,
      nonCritValue: nonCrit,
      formulaText: `${extraHitAtk.toFixed(0)} × ${(extraHitConfig.baseMultiplier * 100).toFixed(1)}% 经 Buff 修正后 = ${(finalMultiplier * 100).toFixed(1)}%`,
      elementBonusText: `${(elementBonus * 100).toFixed(1)}%`,
      skillBonusText: `${(skillBonus * 100).toFixed(1)}%`,
      allDamageBonusText: `${(allDamageBonus * 100).toFixed(1)}%`,
      damageBonusRateText: damageBonusRate.toFixed(3),
      amplifyFormulaText: `1 + ${(amplifyRate * 100).toFixed(1)}% = ${(1 + amplifyRate).toFixed(3)}`,
      amplifyRateText: amplifyRate.toFixed(3),
      fragileFormulaText: `1 + ${(fragileRate * 100).toFixed(1)}% = ${(1 + fragileRate).toFixed(3)}`,
      fragileRateText: fragileRate.toFixed(3),
      vulnerabilityFormulaText: `1 + ${(vulnerabilityRate * 100).toFixed(1)}% = ${(1 + vulnerabilityRate).toFixed(3)}`,
      vulnerabilityRateText: vulnerabilityRate.toFixed(3),
      comboFormulaText: `1 + ${(comboDamageBonus * 100).toFixed(1)}% = ${(1 + comboDamageBonus).toFixed(3)}`,
      comboDamageBonusText: comboDamageBonus.toFixed(3),
      imbalanceFormulaText: `1 + ${(imbalanceDamageBonus * 100).toFixed(1)}% = ${(1 + imbalanceDamageBonus).toFixed(3)}`,
      imbalanceDamageBonusText: imbalanceDamageBonus.toFixed(3),
      defenseZoneText: defenseZone.toFixed(3),
      nonCritFormulaText: `${extraHitAtk.toFixed(0)} × ${(finalMultiplier * 100).toFixed(1)}% × ${damageBonusRate.toFixed(3)} × ${defenseZone.toFixed(3)} × ${(1 + amplifyRate).toFixed(3)} × ${(1 + fragileRate).toFixed(3)} × ${(1 + vulnerabilityRate).toFixed(3)} × ${(1 + comboDamageBonus).toFixed(3)} × ${(1 + imbalanceDamageBonus).toFixed(3)} = ${nonCrit.toFixed(0)} (基础伤害 ${baseNonCrit.toFixed(0)})`,
      imbalanceText: String(extraHitConfig.imbalanceValue),
      cooldownText: `${extraHitConfig.cooldownSeconds}s`,
      sourceBuffName: buff.displayName,
    }];
  });

  return [...anomalySegments, ...extraHitSegments];
}

export function buildAnomalyBuffOptionsBySegmentKey(
  selectedAnomalyDamages: SelectedAnomalyCard[],
  fullCombinedModifierBuffList: SkillButtonBuff[],
  extraHitBuffList: Array<SkillButtonBuff & { effectKind: 'extraHit'; extraHitConfig: NonNullable<SkillButtonBuff['extraHitConfig']> }>
): Record<string, AppliedBuffTagViewModel[]> {
  const nextMap: Record<string, AppliedBuffTagViewModel[]> = {};

  selectedAnomalyDamages.forEach((card) => {
    const appliedBuffs = card.selectedBuffIds.length === 0
      ? [...fullCombinedModifierBuffList]
      : [...fullCombinedModifierBuffList.filter((buff) => card.selectedBuffIds.includes(buff.id) || buff.source === 'anomaly_state')];
    nextMap[card.id] = buildAppliedBuffTags(appliedBuffs);
  });

  extraHitBuffList.forEach((buff) => {
    nextMap[`buff-extra-hit-${buff.id}`] = buildAppliedBuffTags(fullCombinedModifierBuffList);
  });

  return nextMap;
}
