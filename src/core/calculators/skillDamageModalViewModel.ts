import { calculateBuffedPanelTrace, ELEMENT_LABELS, getBuffEffectiveValue } from './buffCalculator';
import type {
  AppliedBuffTagViewModel,
  FormulaViewModel,
  HitCardViewModel,
  HitDetailViewModel,
  SkillDamageCalcResultV2,
  SkillDamageModalViewModel,
  ResolvedSkillDamageTemplate,
  SkillDamagePanel,
  SkillDamagePanelBase,
} from './skillDamage.types';
import type { SkillButtonBuff } from '../../types/storage';
import type { BuffContribution, ZoneCalculationResult } from './buffZoneCalculator';

function formatInteger(value: number): string {
  return value.toFixed(0);
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function formatMultiplier(multiplier: number): string {
  return `${(multiplier * 100).toFixed(0)}%`;
}

const ABILITY_LABELS = {
  strength: '力量',
  agility: '敏捷',
  intelligence: '智识',
  will: '意志',
} as const;

export function buildAttackFormulaLines(
  panelBase: SkillDamagePanelBase | null | undefined,
  panel: SkillDamagePanel,
  buffs: SkillButtonBuff[],
  stackCounts: Record<string, number> = {}
): string[] {
  if (!panelBase) {
    return [`最终攻击力: ${formatInteger(panel.atk)}`];
  }

  const trace = calculateBuffedPanelTrace(panelBase, buffs, stackCounts);
  const lines = [
    `角色攻击: ${trace.characterAtk.toFixed(1)}`,
    `武器攻击: ${trace.weaponAtk.toFixed(1)}`,
    `武器攻击加成: ${(trace.weaponAtkRate * 100).toFixed(1)}%`,
    `攻击力 Buff: ${(trace.atkPercentBoost * 100).toFixed(1)}%`,
    `原面板固定项: ${trace.fixedAtk.toFixed(1)}`,
    `攻击基础值: (${trace.characterAtk.toFixed(1)} + ${trace.weaponAtk.toFixed(1)}) × (1 + ${(trace.weaponAtkRate * 100).toFixed(1)}% + ${(trace.atkPercentBoost * 100).toFixed(1)}%) + ${trace.fixedAtk.toFixed(1)} = ${trace.attackBaseAfterBuff.toFixed(1)}`,
  ];

  (Object.keys(ABILITY_LABELS) as Array<keyof typeof ABILITY_LABELS>).forEach((field) => {
    const baseValue = panelBase[field];
    if (typeof baseValue !== 'number') return;
    lines.push(`${ABILITY_LABELS[field]}面板值: ${baseValue.toFixed(1)}`);
  });

  if (trace.mainAbility) {
    const main = trace.mainAbility;
    const mainAdditiveProduct = (1 + main.statAdditiveRate) * (1 + main.allStatAdditiveRate);
    const mainMultiplierProduct = main.directionalMultiplier * main.statMultiplier * main.allStatMultiplier;
    lines.push(
      `主能力（${ABILITY_LABELS[main.field]}）: ${main.rawValue.toFixed(1)} + 定向 ${main.directionalFlatBoost.toFixed(1)}`,
      `主能力加算: 主 ${(main.baseStatScale * 100).toFixed(1)}% + Buff ${(main.statBuffRate * 100).toFixed(1)}% ｜ 全 ${(main.baseAllStatScale * 100).toFixed(1)}% + Buff ${(main.allStatBuffRate * 100).toFixed(1)}% = ×${mainAdditiveProduct.toFixed(3)}`,
      `主能力乘算: 定向 ${main.directionalMultiplier.toFixed(3)} × 主 ${main.statMultiplier.toFixed(3)} × 全 ${main.allStatMultiplier.toFixed(3)} = ×${mainMultiplierProduct.toFixed(3)}`,
      `Buff 后主能力: (${main.rawValue.toFixed(1)} + ${main.directionalFlatBoost.toFixed(1)}) × ${mainAdditiveProduct.toFixed(3)} × ${mainMultiplierProduct.toFixed(3)} = ${main.finalValue.toFixed(1)}`,
      `主能力攻击转换: ${main.finalValue.toFixed(1)} × ${main.attackCoefficient.toFixed(3)} = ${main.attackBonus.toFixed(4)}`
    );
  }
  if (trace.subAbility) {
    const sub = trace.subAbility;
    const subAdditiveProduct = (1 + sub.statAdditiveRate) * (1 + sub.allStatAdditiveRate);
    const subMultiplierProduct = sub.directionalMultiplier * sub.statMultiplier * sub.allStatMultiplier;
    lines.push(
      `副能力（${ABILITY_LABELS[sub.field]}）: ${sub.rawValue.toFixed(1)} + 定向 ${sub.directionalFlatBoost.toFixed(1)}`,
      `副能力加算: 副 ${(sub.baseStatScale * 100).toFixed(1)}% + Buff ${(sub.statBuffRate * 100).toFixed(1)}% ｜ 全 ${(sub.baseAllStatScale * 100).toFixed(1)}% + Buff ${(sub.allStatBuffRate * 100).toFixed(1)}% = ×${subAdditiveProduct.toFixed(3)}`,
      `副能力乘算: 定向 ${sub.directionalMultiplier.toFixed(3)} × 副 ${sub.statMultiplier.toFixed(3)} × 全 ${sub.allStatMultiplier.toFixed(3)} = ×${subMultiplierProduct.toFixed(3)}`,
      `Buff 后副能力: (${sub.rawValue.toFixed(1)} + ${sub.directionalFlatBoost.toFixed(1)}) × ${subAdditiveProduct.toFixed(3)} × ${subMultiplierProduct.toFixed(3)} = ${sub.finalValue.toFixed(1)}`,
      `副能力攻击转换: ${sub.finalValue.toFixed(1)} × ${sub.attackCoefficient.toFixed(3)} = ${sub.attackBonus.toFixed(4)}`
    );
  }
  lines.push(
    `能力值总攻击加成: ${trace.mainAbility?.attackBonus.toFixed(4) ?? '0.0000'} + ${trace.subAbility?.attackBonus.toFixed(4) ?? '0.0000'} = ${trace.abilityBonus.toFixed(4)}`,
    `最终攻击力: ${trace.attackBaseAfterBuff.toFixed(1)} × (1 + ${trace.abilityBonus.toFixed(4)}) = ${trace.finalAtk.toFixed(1)}`
  );
  if (trace.flatAtk !== 0) {
    lines.push(`固定攻击 Buff（当前公式未使用）: ${trace.flatAtk.toFixed(1)}`);
  }
  return lines;
}

function formatHitCardLabel(displayName: string): string {
  const match = displayName.match(/^第(\d+)击$/);
  if (match) {
    return `${match[1]}段`;
  }
  return displayName;
}

function normalizeMaxStacks(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 1;
}

function normalizeStackCount(buff: SkillDamageCalcResultV2['hits'][number]['appliedBuffs'][number], stackCounts: Record<string, number>): number {
  const maxStacks = normalizeMaxStacks(buff.maxStacks);
  const rawCount = stackCounts[buff.id];
  return typeof rawCount === 'number' && Number.isFinite(rawCount)
    ? Math.min(Math.max(Math.floor(rawCount), 0), maxStacks)
    : maxStacks;
}

function formatBuffValue(value: number): string {
  return String(Number(value.toFixed(4)));
}

function findBuffContribution(
  buffId: string,
  contributions: BuffContribution[] = []
): BuffContribution | undefined {
  return contributions.find((contribution) => contribution.buffId === buffId);
}

function buildAppliedBuffTags(
  result: SkillDamageCalcResultV2['hits'][number]['appliedBuffs'],
  stackCounts: Record<string, number> = {},
  contributions: BuffContribution[] = []
): AppliedBuffTagViewModel[] {
  return result.map((buff) => {
    const contribution = findBuffContribution(buff.id, contributions);
    if (contribution?.multiplier) {
      const coefficient = contribution.multiplierCoefficient ?? contribution.effectiveValue;
      return {
        id: buff.id,
        label: buff.displayName,
        displayLabel: `${buff.displayName} · ${contribution.type} × ${coefficient.toFixed(3)}`,
        sourceName: buff.sourceName,
        type: contribution.type,
        effectiveValue: coefficient,
        runtimeCoefficient: 1,
        multiplierCoefficient: coefficient,
        isMultiplier: true,
        isCountable: false,
      };
    }

    const isCountable = buff.category === 'countable';
    const maxStacks = normalizeMaxStacks(buff.maxStacks);
    const stackCount = contribution?.runtimeCoefficient
      ?? (isCountable ? normalizeStackCount(buff, stackCounts) : undefined);
    const rawValue = contribution?.rawValue ?? buff.value;
    const effectiveValue = contribution?.effectiveValue ?? getBuffEffectiveValue(buff, stackCounts);
    const contributionText = contribution && typeof rawValue === 'number'
      ? `n ${formatBuffValue(rawValue)} × k ${formatBuffValue(contribution.runtimeCoefficient)} = kn ${formatBuffValue(effectiveValue)}`
      : '';
    const legacyValueText = !contribution && isCountable && typeof buff.value === 'number' && Number.isFinite(buff.value)
      ? `合计 ${formatBuffValue(effectiveValue)}`
      : '';
    const stackText = !contribution && isCountable ? `${stackCount}/${maxStacks}层` : '';
    const extraText = [contributionText, stackText, legacyValueText].filter(Boolean).join(' · ');
    return {
      id: buff.id,
      label: buff.displayName,
      displayLabel: extraText ? `${buff.displayName} · ${extraText}` : buff.displayName,
      sourceName: buff.sourceName,
      type: contribution?.type ?? buff.type,
      value: rawValue,
      effectiveValue,
      runtimeCoefficient: contribution?.runtimeCoefficient,
      stackCount,
      maxStacks: isCountable ? maxStacks : undefined,
      isCountable,
      isMultiplier: false,
    };
  });
}

function formatZoneFormula(
  zone: ZoneCalculationResult | undefined,
  legacyAdditiveTotal: number,
  legacyBaseValue = 1
): string {
  if (!zone) {
    return `${legacyBaseValue.toFixed(3)} + ${formatPercent(legacyAdditiveTotal)} = ${(legacyBaseValue + legacyAdditiveTotal).toFixed(3)}`;
  }

  const baseValue = zone.multiplierProduct !== 0
    ? zone.finalValue / zone.multiplierProduct - zone.additiveTotal
    : legacyBaseValue;
  const multiplierText = zone.multiplierContributions.length > 0
    ? zone.multiplierContributions
        .map((contribution) => (contribution.multiplierCoefficient ?? contribution.effectiveValue).toFixed(3))
        .join(' × ')
    : zone.multiplierProduct.toFixed(3);
  return `${multiplierText} × (${baseValue.toFixed(3)} + ${formatPercent(zone.additiveTotal)}) = ${zone.finalValue.toFixed(3)}`;
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
    buffCountText: hitResult.isDisabled
      ? '已禁用'
      : hitResult.appliedBuffs.length > 0 ? `+${hitResult.appliedBuffs.length} Buff` : '无 Buff',
    isSelected: selectedHitIndex === index,
    isDisabled: hitResult.isDisabled,
  }));
}

function buildHitDetail(
  result: SkillDamageCalcResultV2,
  selectedHitIndex: number | null,
  stackCounts: Record<string, number>
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
    appliedBuffTags: buildAppliedBuffTags(activeHit.appliedBuffs, stackCounts, activeHit.buffContributions),
    showNoBuff: activeHit.appliedBuffs.length === 0,
    isDisabled: activeHit.isDisabled,
  };
}

function buildFormula(
  result: SkillDamageCalcResultV2,
  selectedHitIndex: number | null,
  stackCounts: Record<string, number>,
  panelBase?: SkillDamagePanelBase | null
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
    attackLines: buildAttackFormulaLines(panelBase, activeHit.panel, activeHit.appliedBuffs, stackCounts),
    buffTags: buildAppliedBuffTags(activeHit.appliedBuffs, stackCounts, activeHit.buffContributions),
    showNoBuff: activeHit.appliedBuffs.length === 0,
    baseMultiplierText: formatPercent(activeHit.multiplier.base),
    multiplierFormulaText: formatZoneFormula(
      activeHit.zones.skillMultiplier,
      activeHit.multiplier.afterBonus - activeHit.multiplier.base,
      activeHit.multiplier.base
    ),
    formulaText: formatZoneFormula(
      activeHit.zones.skillMultiplier,
      activeHit.multiplier.afterBonus - activeHit.multiplier.base,
      activeHit.multiplier.base
    ),
    elementBonusText: formatPercent(activeHit.zones.elementBonus),
    skillBonusText: formatPercent(activeHit.zones.skillBonus),
    allDamageBonusText: formatPercent(activeHit.zones.allDamageBonus),
    damageBonusRateText: (activeHit.zones.damageBonus?.finalValue ?? activeHit.zones.damageBonusRate).toFixed(3),
    damageBonusFormulaText: formatZoneFormula(
      activeHit.zones.damageBonus,
      activeHit.zones.damageBonusRate - 1
    ),
    resistanceEffectiveText: activeHit.zones.resistance.effectiveResistance.toFixed(1),
    resistanceFormulaText: activeHit.zones.resistance.formulaText,
    amplifyFormulaText: formatZoneFormula(activeHit.zones.amplify, activeHit.zones.amplifyRate),
    fragileFormulaText: formatZoneFormula(activeHit.zones.fragile, activeHit.zones.fragileRate),
    vulnerabilityFormulaText: formatZoneFormula(activeHit.zones.vulnerability, activeHit.zones.vulnerabilityRate),
    comboFormulaText: `1 + ${formatPercent(activeHit.zones.comboDamageBonus)} = ${(1 + activeHit.zones.comboDamageBonus).toFixed(3)}`,
    imbalanceFormulaText: `1 + ${formatPercent(activeHit.zones.imbalanceDamageBonus)} = ${(1 + activeHit.zones.imbalanceDamageBonus).toFixed(3)}`,
    defenseZoneText: activeHit.zones.defenseZone.toFixed(3),
    nonCritFormulaText: `${formatInteger(activeHit.panel.atk)} × ${formatPercent(activeHit.zones.skillMultiplier?.finalValue ?? activeHit.multiplier.afterMultiply)} × ${(activeHit.zones.damageBonus?.finalValue ?? activeHit.zones.damageBonusRate).toFixed(3)} × ${activeHit.zones.defenseZone.toFixed(3)} × ${activeHit.zones.resistanceZone.toFixed(3)} × ${(activeHit.zones.amplify?.finalValue ?? 1 + activeHit.zones.amplifyRate).toFixed(3)} × ${(activeHit.zones.fragile?.finalValue ?? 1 + activeHit.zones.fragileRate).toFixed(3)} × ${(activeHit.zones.vulnerability?.finalValue ?? 1 + activeHit.zones.vulnerabilityRate).toFixed(3)} × ${(1 + activeHit.zones.comboDamageBonus).toFixed(3)} × ${(1 + activeHit.zones.imbalanceDamageBonus).toFixed(3)} = ${formatInteger(activeHit.nonCrit.final)} (基础伤害 ${formatInteger(activeHit.nonCrit.base)})`,
    expectedText: activeHit.expected.final.toFixed(0),
    critText: activeHit.crit.final.toFixed(0),
    nonCritText: activeHit.nonCrit.final.toFixed(0),
  };
}

export function buildSkillDamageModalViewModel(
  template: ResolvedSkillDamageTemplate,
  result: SkillDamageCalcResultV2,
  selectedHitIndex: number | null,
  _panel: SkillDamagePanel,
  stackCounts: Record<string, number> = {},
  panelBase?: SkillDamagePanelBase | null
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
    activeHitDetail: buildHitDetail(result, selectedHitIndex, stackCounts),
    activeHitFormula: buildFormula(result, selectedHitIndex, stackCounts, panelBase),
  };
}
