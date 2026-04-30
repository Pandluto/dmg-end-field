import { ELEMENT_LABELS } from './buffCalculator';
import type {
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
    isSelected: (selectedHitIndex ?? 0) === index,
  }));
}

function buildHitDetail(
  result: SkillDamageCalcResultV2,
  selectedHitIndex: number | null
): HitDetailViewModel | null {
  const activeHit = result.hits[selectedHitIndex ?? 0];
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
    appliedBuffTags: activeHit.appliedBuffs.map((buff) => buff.displayName),
    showNoBuff: activeHit.appliedBuffs.length === 0,
  };
}

function buildFormula(
  result: SkillDamageCalcResultV2,
  selectedHitIndex: number | null,
  panel: SkillDamagePanel
): FormulaViewModel | null {
  const activeHit = result.hits[selectedHitIndex ?? 0];
  if (!activeHit) {
    return null;
  }

  return {
    title: `计算过程 - ${activeHit.hit.displayName}`,
    panelLines: [
      `ATK: ${formatInteger(panel.atk)}`,
      `暴击率: ${formatPercent(panel.critRate)}`,
      `暴击伤害: ${formatPercent(panel.critDmg)}`,
    ],
    zoneSections: [
      {
        title: '【加成区】',
        lines: [
          `元素伤害加成 ${formatPercent(activeHit.zones.elementBonus)}`,
          `技能伤害加成 ${formatPercent(activeHit.zones.skillBonus)}`,
          `全伤害加成 ${formatPercent(activeHit.zones.allDamageBonus)}`,
        ],
        totalText: `加成区系数 = 1 + ${formatPercent(activeHit.zones.elementBonus)} + ${formatPercent(activeHit.zones.skillBonus)} + ${formatPercent(activeHit.zones.allDamageBonus)} = ${activeHit.zones.damageBonusRate.toFixed(3)}`,
      },
      {
        title: '【增幅区】',
        lines: ['法术/元素增幅'],
        totalText: `增幅区 = ${formatPercent(activeHit.zones.amplifyRate)}`,
      },
      {
        title: '【脆弱区】',
        lines: ['脆弱效果'],
        totalText: `脆弱区 = ${formatPercent(activeHit.zones.fragileRate)}`,
      },
      {
        title: '【易伤区】',
        lines: ['易伤效果'],
        totalText: `易伤区 = ${formatPercent(activeHit.zones.vulnerabilityRate)}`,
      },
      {
        title: '【异常区】',
        lines: ['连击异常伤害'],
        totalText: `异常区 = ${formatPercent(activeHit.zones.comboDamageBonus)}`,
      },
      {
        title: '【防御区】',
        lines: ['防御减免系数'],
        totalText: `防御区 = ${activeHit.zones.defenseZone.toFixed(3)}`,
      },
    ],
    buffTags: activeHit.appliedBuffs.map((buff) => buff.displayName),
    showNoBuff: activeHit.appliedBuffs.length === 0,
  };
}

export function buildSkillDamageModalViewModel(
  template: ResolvedSkillDamageTemplate,
  result: SkillDamageCalcResultV2,
  selectedHitIndex: number | null,
  panel: SkillDamagePanel
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
    activeHitFormula: buildFormula(result, selectedHitIndex, panel),
  };
}
