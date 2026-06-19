import {
  calculateBuffTotals,
  calculateResistanceZone,
} from '../../core/calculators/buffCalculator';
import {
  calculateHitBuffZones,
  type HitBuffZoneResults,
} from '../../core/calculators/buffZoneCalculator';
import { getBuffTypeRegistryEntry } from '../../core/domain/buffTypeRegistry';
import type { AppliedBuffTagViewModel, SkillDamagePanel, SkillDamagePanelBase } from '../../core/calculators/skillDamage.types';
import type { ElementType, HitSkillType } from '../../types';
import type { DamageBonusSnapshot, HitResistanceInput, SkillButtonBuff } from '../../types/storage';
import {
  buildAppliedBuffTags,
  buildPanelFromBase,
  type AnomalyDamageSegmentView,
  type BurnDamageMode,
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
  targetResistance?: HitResistanceInput;
  fullCombinedModifierBuffList: SkillButtonBuff[];
  extraHitBuffList: Array<SkillButtonBuff & { effectKind: 'extraHit'; extraHitConfig: NonNullable<SkillButtonBuff['extraHitConfig']> }>;
  buffStackCounts?: Record<string, number>;
  buffStackCountsBySegmentKey?: Record<string, Record<string, number>>;
  manuallyDisabledBuffIdsBySegmentKey: Record<string, string[]>;
  getEffectiveCharacterSourceSkillBoost: (characterId: string | null, buffs?: SkillButtonBuff[]) => number;
}

type SpecialHitElement = ElementType | 'magic';
type SpecialHitSkillType = HitSkillType | '';

const ELEMENT_DAMAGE_BONUS_TYPES = new Set([
  'physicalDmgBonus',
  'magicDmgBonus',
  'allElementDmgBonus',
  'fireDmgBonus',
  'electricDmgBonus',
  'iceDmgBonus',
  'natureDmgBonus',
]);

const SKILL_DAMAGE_BONUS_TYPES = new Set([
  'normalAttackDmgBonus',
  'dotDmgBonus',
  'skillDmgBonus',
  'chainSkillDmgBonus',
  'ultimateDmgBonus',
  'allSkillDmgBonus',
]);

const ALL_DAMAGE_BONUS_TYPES = new Set(['allDmgBonus']);

function calculateSpecialHitBuffZones(input: {
  element: SpecialHitElement;
  skillType: SpecialHitSkillType;
  buffs: SkillButtonBuff[];
  stackCounts: Record<string, number>;
  damageBonus: DamageBonusSnapshot;
  baseSkillMultiplier: number;
}): HitBuffZoneResults {
  const contextElement: ElementType = input.element === 'magic' ? 'nature' : input.element;
  const contextSkillType: HitSkillType = input.skillType || 'A';
  const buffs = input.buffs.filter((buff) => {
    const match = getBuffTypeRegistryEntry(buff.type)?.match;
    if (!match) return true;
    if (input.element === 'magic' && match.kind === 'element') return false;
    if (!input.skillType && (match.kind === 'skillType' || match.kind === 'skillTypes')) return false;
    return true;
  });
  const damageBonus = { ...input.damageBonus };

  if (input.element === 'magic') {
    damageBonus.natureDmgBonus = 0;
  }
  if (!input.skillType) {
    damageBonus.normalAttackDmgBonus = 0;
  }

  return calculateHitBuffZones({
    context: { element: contextElement, skillType: contextSkillType },
    buffs,
    stackCounts: input.stackCounts,
    damageBonus,
    baseSkillMultiplier: input.baseSkillMultiplier,
  });
}

function sumAdditiveContributions(
  zoneResults: HitBuffZoneResults,
  includedTypes: ReadonlySet<string>
): number {
  return zoneResults.damageBonus.additiveContributions.reduce(
    (total, contribution) => total + (includedTypes.has(contribution.type) ? contribution.effectiveValue : 0),
    0
  );
}

function readPanelElementBonus(damageBonus: DamageBonusSnapshot, element: SpecialHitElement): number {
  if (element === 'physical') return damageBonus.physicalDmgBonus || 0;
  const damageBonusRecord = damageBonus as unknown as Record<string, number | undefined>;
  const elementBonus = element === 'magic' ? 0 : damageBonus[`${element}DmgBonus`] || 0;
  return elementBonus + (damageBonus.magicDmgBonus || 0) + (damageBonusRecord.allElementDmgBonus || 0);
}

function readPanelSkillBonus(damageBonus: DamageBonusSnapshot, skillType: SpecialHitSkillType): number {
  switch (skillType) {
    case 'A':
      return damageBonus.normalAttackDmgBonus || 0;
    case 'Dot':
      return damageBonus.dotDmgBonus || 0;
    case 'B':
      return (damageBonus.skillDmgBonus || 0) + (damageBonus.allSkillDmgBonus || 0);
    case 'E':
      return (damageBonus.chainSkillDmgBonus || 0) + (damageBonus.allSkillDmgBonus || 0);
    case 'Q':
      return (damageBonus.ultimateDmgBonus || 0) + (damageBonus.allSkillDmgBonus || 0);
    default:
      return 0;
  }
}

function normalizeExtraHitStackCount(
  buff: SkillButtonBuff,
  stackCounts: Record<string, number>
): number {
  if (buff.category !== 'countable') {
    return 1;
  }
  const maxStacks = typeof buff.maxStacks === 'number' && Number.isFinite(buff.maxStacks) && buff.maxStacks > 0
    ? Math.floor(buff.maxStacks)
    : 1;
  const rawCount = stackCounts[buff.id];
  const stackCount = typeof rawCount === 'number' && Number.isFinite(rawCount)
    ? Math.floor(rawCount)
    : maxStacks;
  return Math.min(Math.max(stackCount, 0), maxStacks);
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

function resolveBurnDotTotalMultiplierPercent(card: SelectedAnomalyCard): number {
  const durationSeconds = typeof card.durationSeconds === 'number' ? card.durationSeconds : 0;
  if (card.key !== 'burn' || resolveBurnDamageMode(card) === 'initialOnly' || durationSeconds <= 0) {
    return 0;
  }
  return 12 * (1 + card.level) * durationSeconds;
}

function resolveBurnDamageMode(card: SelectedAnomalyCard): BurnDamageMode {
  if (card.key !== 'burn') {
    return 'initialOnly';
  }
  return card.burnDamageMode ?? (card.includeDotInTotal ? 'dotOnly' : 'initialOnly');
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
  resistanceZone: number,
  amplifyZone: number,
  fragileZone: number,
  vulnerabilityZone: number,
  comboDamageBonus: number,
  imbalanceDamageBonus: number
): number {
  const base = panelAtk * multiplierValue;
  const afterCrit = base * critFactor;
  const afterBonus = afterCrit * damageBonusRate;
  const afterDefense = afterBonus * defenseZone;
  const afterResistance = afterDefense * resistanceZone;
  const afterAmplify = afterResistance * amplifyZone;
  const afterFragile = afterAmplify * fragileZone;
  const afterVulnerability = afterFragile * vulnerabilityZone;
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
  targetResistance,
  fullCombinedModifierBuffList,
  extraHitBuffList,
  buffStackCounts = {},
  buffStackCountsBySegmentKey = {},
  manuallyDisabledBuffIdsBySegmentKey,
  getEffectiveCharacterSourceSkillBoost,
}: BuildAnomalyDamageSegmentsParams): AnomalyDamageSegmentView[] {
  if (!panelData) {
    return [];
  }

  const currentOperatorLevel = 90;
  let anomalySequenceOffset = 0;
  const anomalySegments = selectedAnomalyDamages.flatMap<AnomalyDamageSegmentView>((card) => {
    const segmentStackCounts = {
      ...buffStackCounts,
      ...(buffStackCountsBySegmentKey[card.id] ?? {}),
    };
    const baseMultiplierPercent = resolveBaseMultiplierPercent(card);
    const levelCoefficient = resolveLevelCoefficient(card, currentOperatorLevel);
    const elementKey = resolveElementKey(card, element);
    const disabledBuffIds = new Set(manuallyDisabledBuffIdsBySegmentKey[card.id] ?? []);
    const baseAppliedBuffs = card.selectedBuffIds.length === 0
      ? [...fullCombinedModifierBuffList]
      : [...fullCombinedModifierBuffList.filter((buff) => card.selectedBuffIds.includes(buff.id) || buff.source === 'anomaly_state')];
    const appliedBuffs = baseAppliedBuffs.filter((buff) => !disabledBuffIds.has(buff.id));
    const appliedBuffTags = buildAppliedBuffTags(appliedBuffs, segmentStackCounts);
    const segmentPanel = buildPanelFromBase(panelBase, panelData, appliedBuffs, segmentStackCounts);
    if (!segmentPanel) {
      return [];
    }

    const buffTotals = calculateBuffTotals(appliedBuffs, segmentStackCounts);
    const currentCharacterSourceSkillBoost = getEffectiveCharacterSourceSkillBoost(buttonCharacterId, appliedBuffs);
    const sourceSkillZone = 1 + currentCharacterSourceSkillBoost / 100;
    const anomalyAtk = segmentPanel.atk;
    const anomalyCritRate = segmentPanel.critRate;
    const anomalyCritDmg = segmentPanel.critDmg;
    const anomalyCritMultiplier = 1 + anomalyCritDmg;
    const anomalyExpectedMultiplier = 1 + anomalyCritRate * anomalyCritDmg;
    const anomalyBaseMultiplier = (baseMultiplierPercent / 100) * levelCoefficient * sourceSkillZone;
    const zoneResults = calculateSpecialHitBuffZones({
      element: elementKey as SpecialHitElement,
      skillType: '',
      buffs: appliedBuffs,
      stackCounts: segmentStackCounts,
      damageBonus,
      baseSkillMultiplier: anomalyBaseMultiplier,
    });
    const finalMultiplier = zoneResults.skillMultiplier.finalValue;
    const elementBonus = readPanelElementBonus(damageBonus, elementKey as SpecialHitElement)
      + sumAdditiveContributions(zoneResults, ELEMENT_DAMAGE_BONUS_TYPES);
    const skillBonus = 0;
    const allDamageBonus = (damageBonus.allDmgBonus || 0)
      + sumAdditiveContributions(zoneResults, ALL_DAMAGE_BONUS_TYPES);
    const damageBonusRate = zoneResults.damageBonus.finalValue;
    const resistance = calculateResistanceZone(elementKey, targetResistance, buffTotals);
    const amplifyZone = zoneResults.amplify.finalValue;
    const fragileZone = zoneResults.fragile.finalValue;
    const vulnerabilityZone = zoneResults.vulnerability.finalValue;
    const amplifyRate = amplifyZone - 1;
    const fragileRate = fragileZone - 1;
    const vulnerabilityRate = vulnerabilityZone - 1;
    const comboDamageBonus = buffTotals.comboDamageBonus;
    const imbalanceDamageBonus = buffTotals.imbalanceDamageBonus + (elementKey === 'physical' ? (damageBonus.imbalanceDmgBonus || 0) : 0);
    const defenseZone = 0.5;
    const baseNonCrit = anomalyAtk * finalMultiplier;
    const nonCrit = calculateBreakdown(anomalyAtk, finalMultiplier, 1, damageBonusRate, defenseZone, resistance.resistanceZone, amplifyZone, fragileZone, vulnerabilityZone, comboDamageBonus, imbalanceDamageBonus);
    const crit = calculateBreakdown(anomalyAtk, finalMultiplier, anomalyCritMultiplier, damageBonusRate, defenseZone, resistance.resistanceZone, amplifyZone, fragileZone, vulnerabilityZone, comboDamageBonus, imbalanceDamageBonus);
    const expected = calculateBreakdown(anomalyAtk, finalMultiplier, anomalyExpectedMultiplier, damageBonusRate, defenseZone, resistance.resistanceZone, amplifyZone, fragileZone, vulnerabilityZone, comboDamageBonus, imbalanceDamageBonus);
    const sequenceNumber = hitCards.length + anomalySequenceOffset + 1;
    const burnDamageMode = resolveBurnDamageMode(card);
    const burnTickMultiplierPercent = 12 * (1 + card.level);
    const burnDotMultiplierPercent = burnDamageMode === 'splitDot'
      ? burnTickMultiplierPercent
      : resolveBurnDotTotalMultiplierPercent(card);
    const burnDotBaseMultiplier = (burnDotMultiplierPercent / 100) * levelCoefficient * sourceSkillZone;
    const burnDotZoneResults = calculateSpecialHitBuffZones({
      element: elementKey as SpecialHitElement,
      skillType: 'Dot',
      buffs: appliedBuffs,
      stackCounts: segmentStackCounts,
      damageBonus,
      baseSkillMultiplier: burnDotBaseMultiplier,
    });
    const burnDotFinalMultiplier = burnDotZoneResults.skillMultiplier.finalValue;
    const burnDotDamageBonusRate = burnDotZoneResults.damageBonus.finalValue;
    const burnDotElementBonus = readPanelElementBonus(damageBonus, elementKey as SpecialHitElement)
      + sumAdditiveContributions(burnDotZoneResults, ELEMENT_DAMAGE_BONUS_TYPES);
    const burnDotSkillBonus = readPanelSkillBonus(damageBonus, 'Dot')
      + sumAdditiveContributions(burnDotZoneResults, SKILL_DAMAGE_BONUS_TYPES);
    const burnDotAllDamageBonus = (damageBonus.allDmgBonus || 0)
      + sumAdditiveContributions(burnDotZoneResults, ALL_DAMAGE_BONUS_TYPES);
    const burnDotAmplifyZone = burnDotZoneResults.amplify.finalValue;
    const burnDotFragileZone = burnDotZoneResults.fragile.finalValue;
    const burnDotVulnerabilityZone = burnDotZoneResults.vulnerability.finalValue;
    const burnDotBaseNonCrit = anomalyAtk * burnDotFinalMultiplier;
    const burnDotNonCrit = burnDotMultiplierPercent > 0
      ? calculateBreakdown(anomalyAtk, burnDotFinalMultiplier, 1, burnDotDamageBonusRate, defenseZone, resistance.resistanceZone, burnDotAmplifyZone, burnDotFragileZone, burnDotVulnerabilityZone, comboDamageBonus, imbalanceDamageBonus)
      : 0;
    const burnDotCrit = burnDotMultiplierPercent > 0
      ? calculateBreakdown(anomalyAtk, burnDotFinalMultiplier, anomalyCritMultiplier, burnDotDamageBonusRate, defenseZone, resistance.resistanceZone, burnDotAmplifyZone, burnDotFragileZone, burnDotVulnerabilityZone, comboDamageBonus, imbalanceDamageBonus)
      : 0;
    const burnDotExpected = burnDotMultiplierPercent > 0
      ? calculateBreakdown(anomalyAtk, burnDotFinalMultiplier, anomalyExpectedMultiplier, burnDotDamageBonusRate, defenseZone, resistance.resistanceZone, burnDotAmplifyZone, burnDotFragileZone, burnDotVulnerabilityZone, comboDamageBonus, imbalanceDamageBonus)
      : 0;

    const initialSegment: AnomalyDamageSegmentView = {
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
      multiplierFormulaText: `(${(anomalyBaseMultiplier * 100).toFixed(1)}% + ${(zoneResults.skillMultiplier.additiveTotal * 100).toFixed(1)}%) × ${zoneResults.skillMultiplier.multiplierProduct.toFixed(3)}`,
      expectedText: expected.toFixed(0),
      critText: crit.toFixed(0),
      nonCritText: nonCrit.toFixed(0),
      expectedValue: expected,
      critValue: crit,
      nonCritValue: nonCrit,
      formulaText: `(${baseMultiplierPercent.toFixed(1)}% × ${levelCoefficient.toFixed(3)} × ${sourceSkillZone.toFixed(3)} + ${(zoneResults.skillMultiplier.additiveTotal * 100).toFixed(1)}%) × ${zoneResults.skillMultiplier.multiplierProduct.toFixed(3)} = ${(finalMultiplier * 100).toFixed(1)}%`,
      elementBonusText: `${(elementBonus * 100).toFixed(1)}%`,
      skillBonusText: `${(skillBonus * 100).toFixed(1)}%`,
      allDamageBonusText: `${(allDamageBonus * 100).toFixed(1)}%`,
      damageBonusRateText: damageBonusRate.toFixed(3),
      resistanceBaseText: resistance.baseResistance.toFixed(1),
      corrosionText: resistance.corrosion.toFixed(1),
      resistanceIgnoreText: resistance.resistanceIgnore.toFixed(1),
      resistanceZoneText: resistance.resistanceZone.toFixed(3),
      resistanceFormulaText: resistance.formulaText,
      amplifyFormulaText: `${zoneResults.amplify.finalValue.toFixed(3)}`,
      amplifyRateText: amplifyRate.toFixed(3),
      fragileFormulaText: `${zoneResults.fragile.finalValue.toFixed(3)}`,
      fragileRateText: fragileRate.toFixed(3),
      vulnerabilityFormulaText: `${zoneResults.vulnerability.finalValue.toFixed(3)}`,
      vulnerabilityRateText: vulnerabilityRate.toFixed(3),
      comboFormulaText: `1 + ${(comboDamageBonus * 100).toFixed(1)}% = ${(1 + comboDamageBonus).toFixed(3)}`,
      comboDamageBonusText: comboDamageBonus.toFixed(3),
      imbalanceFormulaText: `1 + ${(imbalanceDamageBonus * 100).toFixed(1)}% = ${(1 + imbalanceDamageBonus).toFixed(3)}`,
      imbalanceDamageBonusText: imbalanceDamageBonus.toFixed(3),
      defenseZoneText: defenseZone.toFixed(3),
      nonCritFormulaText: `${anomalyAtk.toFixed(0)} × ${(finalMultiplier * 100).toFixed(1)}% × ${damageBonusRate.toFixed(3)} × ${defenseZone.toFixed(3)} × ${resistance.resistanceZone.toFixed(3)} × ${amplifyZone.toFixed(3)} × ${fragileZone.toFixed(3)} × ${vulnerabilityZone.toFixed(3)} × ${(1 + comboDamageBonus).toFixed(3)} × ${(1 + imbalanceDamageBonus).toFixed(3)} = ${nonCrit.toFixed(0)} (基础伤害 ${baseNonCrit.toFixed(0)})`,
    };

    if (burnDotMultiplierPercent <= 0) {
      anomalySequenceOffset += 1;
      return [initialSegment];
    }

    const burnMultiplierFormulaPrefix = burnDamageMode === 'splitDot'
      ? `${burnTickMultiplierPercent.toFixed(1)}%`
      : `${burnTickMultiplierPercent.toFixed(1)}% × ${(card.durationSeconds ?? 0).toFixed(0)}s`;
    const buildDotSegment = (sequence: number, keySuffix: string, titleSuffix = '持续'): AnomalyDamageSegmentView => ({
      ...initialSegment,
      key: `${card.id}-${keySuffix}`,
      title: `${sequence}段 · ${card.label}${titleSuffix}`,
      sequenceTitle: `${sequence}段`,
      compactTitle: `${card.label}${titleSuffix}`,
      baseMultiplierText: `${burnDotMultiplierPercent.toFixed(1)}%`,
      multiplierText: `${(burnDotFinalMultiplier * 100).toFixed(1)}%`,
      multiplierFormulaText: `(${(burnDotBaseMultiplier * 100).toFixed(1)}% + ${(burnDotZoneResults.skillMultiplier.additiveTotal * 100).toFixed(1)}%) × ${burnDotZoneResults.skillMultiplier.multiplierProduct.toFixed(3)}`,
      expectedText: burnDotExpected.toFixed(0),
      critText: burnDotCrit.toFixed(0),
      nonCritText: burnDotNonCrit.toFixed(0),
      expectedValue: burnDotExpected,
      critValue: burnDotCrit,
      nonCritValue: burnDotNonCrit,
      formulaText: `(${burnMultiplierFormulaPrefix} × ${levelCoefficient.toFixed(3)} × ${sourceSkillZone.toFixed(3)} + ${(burnDotZoneResults.skillMultiplier.additiveTotal * 100).toFixed(1)}%) × ${burnDotZoneResults.skillMultiplier.multiplierProduct.toFixed(3)} = ${(burnDotFinalMultiplier * 100).toFixed(1)}%`,
      elementBonusText: `${(burnDotElementBonus * 100).toFixed(1)}%`,
      skillBonusText: `${(burnDotSkillBonus * 100).toFixed(1)}%`,
      allDamageBonusText: `${(burnDotAllDamageBonus * 100).toFixed(1)}%`,
      damageBonusRateText: burnDotDamageBonusRate.toFixed(3),
      amplifyFormulaText: burnDotAmplifyZone.toFixed(3),
      amplifyRateText: (burnDotAmplifyZone - 1).toFixed(3),
      fragileFormulaText: burnDotFragileZone.toFixed(3),
      fragileRateText: (burnDotFragileZone - 1).toFixed(3),
      vulnerabilityFormulaText: burnDotVulnerabilityZone.toFixed(3),
      vulnerabilityRateText: (burnDotVulnerabilityZone - 1).toFixed(3),
      nonCritFormulaText: `${anomalyAtk.toFixed(0)} × ${(burnDotFinalMultiplier * 100).toFixed(1)}% × ${burnDotDamageBonusRate.toFixed(3)} × ${defenseZone.toFixed(3)} × ${resistance.resistanceZone.toFixed(3)} × ${burnDotAmplifyZone.toFixed(3)} × ${burnDotFragileZone.toFixed(3)} × ${burnDotVulnerabilityZone.toFixed(3)} × ${(1 + comboDamageBonus).toFixed(3)} × ${(1 + imbalanceDamageBonus).toFixed(3)} = ${burnDotNonCrit.toFixed(0)} (基础伤害 ${burnDotBaseNonCrit.toFixed(0)})`,
    });

    if (burnDamageMode === 'splitDot') {
      const hitCount = Math.max(1, Math.trunc(card.durationSeconds ?? 0));
      const dotSegments = Array.from({ length: hitCount }, (_, dotIndex) => buildDotSegment(
        sequenceNumber + dotIndex,
        `dot-${dotIndex + 1}`,
        `持续 ${dotIndex + 1}/${hitCount}`
      ));
      anomalySequenceOffset += hitCount;
      return dotSegments;
    }

    if (burnDamageMode === 'dotOnly') {
      anomalySequenceOffset += 1;
      return [buildDotSegment(sequenceNumber, 'dot')];
    }
    anomalySequenceOffset += 1;
    return [initialSegment];
  });

  let extraHitSequenceOffset = 0;
  const extraHitSegments = extraHitBuffList.flatMap<AnomalyDamageSegmentView>((buff) => {
    const extraHitConfig = buff.extraHitConfig;
    const elementKey = extraHitConfig.damageType;
    const stackCount = normalizeExtraHitStackCount(buff, buffStackCounts);
    const hitCount = buff.category === 'countable' ? stackCount : 1;
    const baseSegmentKey = `buff-extra-hit-${buff.id}`;
    const segments = Array.from({ length: hitCount }).flatMap<AnomalyDamageSegmentView>((_, hitIndex) => {
      const sequenceNumber = hitCards.length + anomalySegments.length + extraHitSequenceOffset + hitIndex + 1;
      const layerSuffix = hitCount > 1 ? ` ${hitIndex + 1}/${hitCount}` : '';
      const segmentKey = hitCount > 1 ? `${baseSegmentKey}-${hitIndex + 1}` : baseSegmentKey;
      const segmentStackCounts = {
        ...buffStackCounts,
        ...(buffStackCountsBySegmentKey[baseSegmentKey] ?? {}),
        ...(buffStackCountsBySegmentKey[segmentKey] ?? {}),
      };
      const disabledBuffIds = new Set([
        ...(manuallyDisabledBuffIdsBySegmentKey[baseSegmentKey] ?? []),
        ...(manuallyDisabledBuffIdsBySegmentKey[segmentKey] ?? []),
      ]);
      const combinedAppliedBuffs = fullCombinedModifierBuffList.filter((item) => !disabledBuffIds.has(item.id));
      const appliedBuffTags = buildAppliedBuffTags(combinedAppliedBuffs, segmentStackCounts);
      const segmentPanel = buildPanelFromBase(panelBase, panelData, combinedAppliedBuffs, segmentStackCounts);
      if (!segmentPanel) {
        return [];
      }

      const buffTotals = calculateBuffTotals(combinedAppliedBuffs, segmentStackCounts);
      const zoneResults = calculateSpecialHitBuffZones({
        element: elementKey,
        skillType: extraHitConfig.skillType,
        buffs: combinedAppliedBuffs,
        stackCounts: segmentStackCounts,
        damageBonus,
        baseSkillMultiplier: extraHitConfig.baseMultiplier,
      });
      const elementBonus = readPanelElementBonus(damageBonus, elementKey)
        + sumAdditiveContributions(zoneResults, ELEMENT_DAMAGE_BONUS_TYPES);
      const skillBonus = readPanelSkillBonus(damageBonus, extraHitConfig.skillType)
        + sumAdditiveContributions(zoneResults, SKILL_DAMAGE_BONUS_TYPES);
      const allDamageBonus = (damageBonus.allDmgBonus || 0)
        + sumAdditiveContributions(zoneResults, ALL_DAMAGE_BONUS_TYPES);
      const damageBonusRate = zoneResults.damageBonus.finalValue;
      const resistance = calculateResistanceZone(elementKey, targetResistance, buffTotals);
      const amplifyZone = zoneResults.amplify.finalValue;
      const fragileZone = zoneResults.fragile.finalValue;
      const vulnerabilityZone = zoneResults.vulnerability.finalValue;
      const amplifyRate = amplifyZone - 1;
      const fragileRate = fragileZone - 1;
      const vulnerabilityRate = vulnerabilityZone - 1;
      const comboDamageBonus = buffTotals.comboDamageBonus;
      const imbalanceDamageBonus = buffTotals.imbalanceDamageBonus + (elementKey === 'physical' ? (damageBonus.imbalanceDmgBonus || 0) : 0);
      const defenseZone = 0.5;
      const finalMultiplier = zoneResults.skillMultiplier.finalValue;
      const extraHitAtk = segmentPanel.atk;
      const extraHitCritRate = segmentPanel.critRate;
      const extraHitCritDmg = segmentPanel.critDmg;
      const critMultiplier = 1 + extraHitCritDmg;
      const expectedMultiplier = 1 + extraHitCritRate * extraHitCritDmg;
      const baseNonCrit = extraHitAtk * finalMultiplier;
      const nonCrit = calculateBreakdown(extraHitAtk, finalMultiplier, 1, damageBonusRate, defenseZone, resistance.resistanceZone, amplifyZone, fragileZone, vulnerabilityZone, comboDamageBonus, imbalanceDamageBonus);
      const crit = calculateBreakdown(extraHitAtk, finalMultiplier, critMultiplier, damageBonusRate, defenseZone, resistance.resistanceZone, amplifyZone, fragileZone, vulnerabilityZone, comboDamageBonus, imbalanceDamageBonus);
      const expected = calculateBreakdown(extraHitAtk, finalMultiplier, expectedMultiplier, damageBonusRate, defenseZone, resistance.resistanceZone, amplifyZone, fragileZone, vulnerabilityZone, comboDamageBonus, imbalanceDamageBonus);

      const segment: AnomalyDamageSegmentView = {
        key: segmentKey,
        sourceKind: 'buff-extra-hit',
        title: `${sequenceNumber}段 · ${buff.displayName}${layerSuffix}`,
        sequenceTitle: `${sequenceNumber}段`,
        compactTitle: `${buff.displayName}${layerSuffix}`,
        buffText: appliedBuffTags.length > 0 ? `+${appliedBuffTags.length} Buff` : '无 Buff',
        appliedBuffTags,
        elementText: extraHitConfig.damageType === 'physical' ? '物理' : extraHitConfig.damageType,
        elementKey,
        skillTypeText: extraHitConfig.skillType,
        panelAtkText: extraHitAtk.toFixed(0),
        critRateText: `${(extraHitCritRate * 100).toFixed(1)}%`,
        critDmgText: `${(extraHitCritDmg * 100).toFixed(1)}%`,
        sourceSkillBoostText: '-',
        levelCoefficientText: '-',
        sourceSkillZoneText: '-',
        baseMultiplierText: `${(extraHitConfig.baseMultiplier * 100).toFixed(1)}%`,
        multiplierText: `${(finalMultiplier * 100).toFixed(1)}%`,
        multiplierFormulaText: `(${(extraHitConfig.baseMultiplier * 100).toFixed(1)}% + ${(zoneResults.skillMultiplier.additiveTotal * 100).toFixed(1)}%) × ${zoneResults.skillMultiplier.multiplierProduct.toFixed(3)}`,
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
        resistanceBaseText: resistance.baseResistance.toFixed(1),
        corrosionText: resistance.corrosion.toFixed(1),
        resistanceIgnoreText: resistance.resistanceIgnore.toFixed(1),
        resistanceZoneText: resistance.resistanceZone.toFixed(3),
        resistanceFormulaText: resistance.formulaText,
        amplifyFormulaText: amplifyZone.toFixed(3),
        amplifyRateText: amplifyRate.toFixed(3),
        fragileFormulaText: fragileZone.toFixed(3),
        fragileRateText: fragileRate.toFixed(3),
        vulnerabilityFormulaText: vulnerabilityZone.toFixed(3),
        vulnerabilityRateText: vulnerabilityRate.toFixed(3),
        comboFormulaText: `1 + ${(comboDamageBonus * 100).toFixed(1)}% = ${(1 + comboDamageBonus).toFixed(3)}`,
        comboDamageBonusText: comboDamageBonus.toFixed(3),
        imbalanceFormulaText: `1 + ${(imbalanceDamageBonus * 100).toFixed(1)}% = ${(1 + imbalanceDamageBonus).toFixed(3)}`,
        imbalanceDamageBonusText: imbalanceDamageBonus.toFixed(3),
        defenseZoneText: defenseZone.toFixed(3),
        nonCritFormulaText: `${extraHitAtk.toFixed(0)} × ${(finalMultiplier * 100).toFixed(1)}% × ${damageBonusRate.toFixed(3)} × ${defenseZone.toFixed(3)} × ${resistance.resistanceZone.toFixed(3)} × ${amplifyZone.toFixed(3)} × ${fragileZone.toFixed(3)} × ${vulnerabilityZone.toFixed(3)} × ${(1 + comboDamageBonus).toFixed(3)} × ${(1 + imbalanceDamageBonus).toFixed(3)} = ${nonCrit.toFixed(0)} (基础伤害 ${baseNonCrit.toFixed(0)})`,
        imbalanceText: String(extraHitConfig.imbalanceValue),
        cooldownText: `${extraHitConfig.cooldownSeconds}s`,
        sourceBuffName: buff.displayName,
      };
      return [segment];
    });
    extraHitSequenceOffset += hitCount;
    return segments;
  });

  return [...anomalySegments, ...extraHitSegments];
}

export function buildAnomalyBuffOptionsBySegmentKey(
  selectedAnomalyDamages: SelectedAnomalyCard[],
  fullCombinedModifierBuffList: SkillButtonBuff[],
  extraHitBuffList: Array<SkillButtonBuff & { effectKind: 'extraHit'; extraHitConfig: NonNullable<SkillButtonBuff['extraHitConfig']> }>,
  buffStackCounts: Record<string, number> = {}
): Record<string, AppliedBuffTagViewModel[]> {
  const nextMap: Record<string, AppliedBuffTagViewModel[]> = {};

  selectedAnomalyDamages.forEach((card) => {
    const appliedBuffs = card.selectedBuffIds.length === 0
      ? [...fullCombinedModifierBuffList]
      : [...fullCombinedModifierBuffList.filter((buff) => card.selectedBuffIds.includes(buff.id) || buff.source === 'anomaly_state')];
    nextMap[card.id] = buildAppliedBuffTags(appliedBuffs, buffStackCounts);
  });

  extraHitBuffList.forEach((buff) => {
    const baseSegmentKey = `buff-extra-hit-${buff.id}`;
    const appliedBuffTags = buildAppliedBuffTags(fullCombinedModifierBuffList, buffStackCounts);
    nextMap[baseSegmentKey] = appliedBuffTags;
    const stackCount = normalizeExtraHitStackCount(buff, buffStackCounts);
    if (buff.category === 'countable') {
      Array.from({ length: stackCount }, (_, index) => {
        nextMap[`${baseSegmentKey}-${index + 1}`] = appliedBuffTags;
      });
    }
  });

  return nextMap;
}
