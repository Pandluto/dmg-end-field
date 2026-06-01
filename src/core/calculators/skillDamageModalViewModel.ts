import { ELEMENT_LABELS } from './buffCalculator';
import type {
  AppliedBuffTagViewModel,
  FormulaViewModel,
  HitCardViewModel,
  HitDetailViewModel,
  SkillDamageCalcResultV2,
  SkillDamageModalViewModel,
  ResolvedSkillDamageTemplate,
  SkillDamagePanel,
} from './skillDamage.types';

function formatInteger(value: number): string {
  return value.toFixed(0);
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function formatMultiplier(multiplier: number): string {
  return `${(multiplier * 100).toFixed(0)}%`;
}

function formatHitCardLabel(displayName: string): string {
  const match = displayName.match(/^第(\d+)击$/);
  if (match) {
    return `${match[1]}段`;
  }
  return displayName;
}

function buildAppliedBuffTags(result: SkillDamageCalcResultV2['hits'][number]['appliedBuffs']): AppliedBuffTagViewModel[] {
  return result.map((buff) => ({
    id: buff.id,
    label: buff.displayName,
    sourceName: buff.sourceName,
  }));
}

function buildHitCards(
  result: SkillDamageCalcResultV2,
  selectedHitIndex: number | null
): HitCardViewModel[] {
  return result.hits.map((hitResult, index) => ({
    key: hitResult.hit.key,
    displayName: formatHitCardLabel(hitResult.hit.displayName),
    multiplierText: formatMultiplier(hitResult.hit.multiplier),
    expectedText: formatInteger(hitResult.expected.final),
    critText: formatInteger(hitResult.crit.final),
    nonCritText: formatInteger(hitResult.nonCrit.final),
    buffCountText: hitResult.appliedBuffs.length > 0 ? `+${hitResult.appliedBuffs.length} Buff` : '无 Buff',
    isSelected: selectedHitIndex === index,
  }));
}

function buildHitDetail(
  result: SkillDamageCalcResultV2,
  selectedHitIndex: number | null
): HitDetailViewModel | null {
  if (selectedHitIndex === null) {
    return null;
  }
  const activeHit = result.hits[selectedHitIndex];
  if (!activeHit) {
    return null;
  }

  return {
    title: `${activeHit.hit.displayName} 详情`,
    elementText: ELEMENT_LABELS[activeHit.hit.element] || activeHit.hit.element,
    multiplierText: formatMultiplier(activeHit.hit.multiplier),
    expectedText: activeHit.expected.final.toFixed(2),
    critText: activeHit.crit.final.toFixed(2),
    nonCritText: activeHit.nonCrit.final.toFixed(2),
    appliedBuffTags: buildAppliedBuffTags(activeHit.appliedBuffs),
    showNoBuff: activeHit.appliedBuffs.length === 0,
  };
}

function buildFormula(
  result: SkillDamageCalcResultV2,
  selectedHitIndex: number | null
): FormulaViewModel | null {
  if (selectedHitIndex === null) {
    return null;
  }
  const activeHit = result.hits[selectedHitIndex];
  if (!activeHit) {
    return null;
  }

  return {
    title: `计算过程 - ${activeHit.hit.displayName}`,
    panelLines: [
      `ATK: ${formatInteger(activeHit.panel.atk)}`,
      `暴击率: ${formatPercent(activeHit.panel.critRate)}`,
      `暴击伤害: ${formatPercent(activeHit.panel.critDmg)}`,
    ],
    buffTags: activeHit.appliedBuffs.map((buff) => buff.displayName),
    showNoBuff: activeHit.appliedBuffs.length === 0,
    baseMultiplierText: formatPercent(activeHit.multiplier.base),
    multiplierFormulaText: `(${formatPercent(activeHit.multiplier.base)} + ${formatPercent(activeHit.multiplier.afterBonus - activeHit.multiplier.base)}) × ${(activeHit.multiplier.afterMultiply / activeHit.multiplier.afterBonus).toFixed(3)}`,
    formulaText: `(${formatPercent(activeHit.multiplier.base)} + ${formatPercent(activeHit.multiplier.afterBonus - activeHit.multiplier.base)}) × ${(activeHit.multiplier.afterMultiply / activeHit.multiplier.afterBonus).toFixed(3)} = ${formatPercent(activeHit.multiplier.afterMultiply)}`,
    elementBonusText: formatPercent(activeHit.zones.elementBonus),
    skillBonusText: formatPercent(activeHit.zones.skillBonus),
    allDamageBonusText: formatPercent(activeHit.zones.allDamageBonus),
    damageBonusRateText: activeHit.zones.damageBonusRate.toFixed(3),
    resistanceFormulaText: activeHit.zones.resistance.formulaText,
    amplifyFormulaText: `1 + ${formatPercent(activeHit.zones.amplifyRate)} = ${(1 + activeHit.zones.amplifyRate).toFixed(3)}`,
    fragileFormulaText: `1 + ${formatPercent(activeHit.zones.fragileRate)} = ${(1 + activeHit.zones.fragileRate).toFixed(3)}`,
    vulnerabilityFormulaText: `1 + ${formatPercent(activeHit.zones.vulnerabilityRate)} = ${(1 + activeHit.zones.vulnerabilityRate).toFixed(3)}`,
    comboFormulaText: `1 + ${formatPercent(activeHit.zones.comboDamageBonus)} = ${(1 + activeHit.zones.comboDamageBonus).toFixed(3)}`,
    imbalanceFormulaText: `1 + ${formatPercent(activeHit.zones.imbalanceDamageBonus)} = ${(1 + activeHit.zones.imbalanceDamageBonus).toFixed(3)}`,
    defenseZoneText: activeHit.zones.defenseZone.toFixed(3),
    nonCritFormulaText: `${formatInteger(activeHit.panel.atk)} × ${formatPercent(activeHit.multiplier.afterMultiply)} × ${activeHit.zones.damageBonusRate.toFixed(3)} × ${activeHit.zones.defenseZone.toFixed(3)} × ${activeHit.zones.resistanceZone.toFixed(3)} × ${(1 + activeHit.zones.amplifyRate).toFixed(3)} × ${(1 + activeHit.zones.fragileRate).toFixed(3)} × ${(1 + activeHit.zones.vulnerabilityRate).toFixed(3)} × ${(1 + activeHit.zones.comboDamageBonus).toFixed(3)} × ${(1 + activeHit.zones.imbalanceDamageBonus).toFixed(3)} = ${formatInteger(activeHit.nonCrit.final)} (基础伤害 ${formatInteger(activeHit.nonCrit.base)})`,
    expectedText: activeHit.expected.final.toFixed(0),
    critText: activeHit.crit.final.toFixed(0),
    nonCritText: activeHit.nonCrit.final.toFixed(0),
  };
}

export function buildSkillDamageModalViewModel(
  template: ResolvedSkillDamageTemplate,
  result: SkillDamageCalcResultV2,
  selectedHitIndex: number | null,
  _panel: SkillDamagePanel
): SkillDamageModalViewModel {
  return {
    header: {
      displayName: template.displayName,
      buttonType: template.buttonType,
      hitCount: template.hits.length,
      fullText: `${template.displayName} / ${template.buttonType} / ${template.hits.length}段`,
    },
    summary: {
      totalExpectedText: formatInteger(result.summary.totalExpected),
      totalCritText: formatInteger(result.summary.totalCrit),
      totalNonCritText: formatInteger(result.summary.totalNonCrit),
    },
    hitCards: buildHitCards(result, selectedHitIndex),
    activeHitDetail: buildHitDetail(result, selectedHitIndex),
    activeHitFormula: buildFormula(result, selectedHitIndex),
  };
}
