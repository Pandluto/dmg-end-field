import { Fragment, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { HitResistanceInput, SkillButtonBuff } from '../../types/storage';
import type { AppliedBuffTagViewModel, FormulaViewModel } from '../../core/calculators/skillDamage.types';
import { getBuffTypeRegistryEntry } from '../../core/domain/buffTypeRegistry';
import { TimelineBuffListPanel } from './TimelineBuffListPanel';
import { TimelineHitTuningPanel } from './TimelineHitTuningPanel';
import { TimelineInfoPanel } from './TimelineInfoPanel';
import { TimelineStatusPanel } from './TimelineStatusPanel';
import { TimelineTargetResistancePanel } from './TimelineTargetResistancePanel';
import './CanvasBoard.css';
import './TimelineSkillDetailWorkbench.css';

export interface TimelineDetailHit {
  key: string;
  title: string;
  meta: string;
  expected: string;
  crit: string;
  nonCrit: string;
  selected: boolean;
  disabled?: boolean;
  onSelect: () => void;
  tuning?: TimelineDetailActiveHit;
}

export interface TimelineDetailStatus {
  key: string;
  title: string;
  detail?: string;
  kind: string;
  onRemove: () => void;
}

export interface TimelineDetailActiveHit {
  title: string;
  stats: string[];
  buffs: AppliedBuffTagViewModel[];
  segmentKey: string | null;
  disabled?: boolean;
  onToggleDisabled?: () => void;
  onToggleBuff: (buffId: string) => void;
  isBuffActive: (buffId: string) => boolean;
  onDecrementBuff?: (buffId: string) => void;
  onIncrementBuff?: (buffId: string) => void;
  onResetBuffs?: () => void;
}

interface TimelineSkillDetailWorkbenchProps {
  children?: ReactNode;
  searchLayer?: ReactNode;
  characterName: string;
  skillLabel: string;
  positionLabel: string;
  isLocked: boolean;
  onToggleLock: () => void;
  onClose: () => void;
  onOpenSearch: () => void;
  targetResistance: Required<HitResistanceInput>;
  onResistanceChange: (key: keyof HitResistanceInput, value: number) => void;
  buffs: SkillButtonBuff[];
  buffStackCounts: Record<string, number>;
  onRemoveBuff: (buffId: string) => void;
  onToggleBuffDisabled: (buffId: string) => void;
  isBuffDisabled: (buffId: string) => boolean;
  onDecrementBuff: (buffId: string) => void;
  onIncrementBuff: (buff: SkillButtonBuff) => void;
  onClearBuffs: () => void;
  onEnableAllBuffs: () => void;
  onDisableAllBuffs: () => void;
  onResetBuffStacks: () => void;
  statuses: TimelineDetailStatus[];
  hits: TimelineDetailHit[];
  summary: {
    title: string;
    expected: string;
    crit: string;
    nonCrit: string;
    formula: string;
    parts: Array<{ label: string; value: string }>;
  } | null;
  formula: FormulaViewModel | null;
  infoLines: string[];
}

type CalculationSectionKey =
  | 'attack'
  | 'multiplier'
  | 'crit'
  | 'damageBonus'
  | 'defense'
  | 'resistance'
  | 'amplify'
  | 'fragile'
  | 'vulnerability'
  | 'combo'
  | 'imbalance'
  | 'result';

interface CalculationSection {
  key: CalculationSectionKey;
  label: string;
  value: string;
  lines: Array<{ label: string; value: string }>;
  buffs: AppliedBuffTagViewModel[];
}

function readFormulaResult(formulaText: string): string {
  const match = formulaText.match(/=\s*(-?\d+(?:\.\d+)?%?)(?:\s|$|\()/);
  return match?.[1] ?? '—';
}

function readPanelValue(panelLines: string[], label: string): string {
  const line = panelLines.find((item) => item.startsWith(`${label}:`));
  return line?.slice(label.length + 1).trim() || '—';
}

function toDetailLines(lines: string[]): Array<{ label: string; value: string }> {
  return lines.map((line) => {
    const separatorIndex = line.indexOf(':');
    return separatorIndex > 0
      ? { label: line.slice(0, separatorIndex), value: line.slice(separatorIndex + 1).trim() }
      : { label: '计算项', value: line };
  });
}

function isAbilityDetailLine(label: string): boolean {
  return label.endsWith('面板值')
    || label.startsWith('主能力')
    || label.startsWith('副能力')
    || label.startsWith('Buff 后主能力')
    || label.startsWith('Buff 后副能力');
}

const ATTACK_BUFF_TYPES = new Set([
  'atkPercentBoost',
  'mainStatBoost',
  'subStatBoost',
  'allStatBoost',
  'strengthBoost',
  'agilityBoost',
  'intelligenceBoost',
  'willBoost',
]);

const CRIT_BUFF_TYPES = new Set(['critRateBoost', 'critDmgBonusBoost']);
const RESISTANCE_BUFF_TYPES = new Set([
  'allCorrosion',
  'physicalCorrosion',
  'magicCorrosion',
  'fireCorrosion',
  'electricCorrosion',
  'iceCorrosion',
  'natureCorrosion',
  'allResistanceIgnore',
  'physicalResistanceIgnore',
  'magicResistanceIgnore',
  'fireResistanceIgnore',
  'electricResistanceIgnore',
  'iceResistanceIgnore',
  'natureResistanceIgnore',
]);

function resolveBuffSection(buff: AppliedBuffTagViewModel): CalculationSectionKey | null {
  if (!buff.type) return null;
  if (ATTACK_BUFF_TYPES.has(buff.type)) return 'attack';
  if (CRIT_BUFF_TYPES.has(buff.type)) return 'crit';
  if (RESISTANCE_BUFF_TYPES.has(buff.type)) return 'resistance';
  if (buff.type === 'comboDamageBonus') return 'combo';
  if (buff.type === 'imbalanceDmgBonus') return 'imbalance';
  if (buff.type === 'sourceSkillBoost') return 'multiplier';
  const registeredZone = getBuffTypeRegistryEntry(buff.type)?.zone;
  return registeredZone === 'skillMultiplier' ? 'multiplier' : registeredZone ?? null;
}

function getSectionBuffs(
  formula: FormulaViewModel,
  sectionKey: CalculationSectionKey
): AppliedBuffTagViewModel[] {
  return formula.buffTags.filter((buff) => resolveBuffSection(buff) === sectionKey);
}

function formatBuffEffect(buff: AppliedBuffTagViewModel): string {
  if (buff.isMultiplier) {
    return `× ${(buff.multiplierCoefficient ?? buff.effectiveValue ?? 1).toFixed(3)}`;
  }
  const value = buff.effectiveValue ?? buff.value;
  if (typeof value !== 'number') {
    return buff.type || '已生效';
  }
  const flatValueTypes = new Set([
    'flatAtk',
    'mainStatBoost',
    'subStatBoost',
    'allStatBoost',
    'strengthBoost',
    'agilityBoost',
    'intelligenceBoost',
    'willBoost',
    'sourceSkillBoost',
    ...RESISTANCE_BUFF_TYPES,
  ]);
  const formattedValue = flatValueTypes.has(buff.type || '')
    ? Number(value.toFixed(3)).toString()
    : `${(value * 100).toFixed(1)}%`;
  const stackText = buff.isCountable && buff.stackCount !== undefined ? ` · ${buff.stackCount}层` : '';
  return `+ ${formattedValue}${stackText}`;
}

function buildCalculationSections(formula: FormulaViewModel): CalculationSection[] {
  return [
    {
      key: 'attack',
      label: '攻击',
      value: readPanelValue(formula.panelLines, 'ATK'),
      lines: toDetailLines(formula.attackLines ?? [`最终攻击力: ${readPanelValue(formula.panelLines, 'ATK')}`]),
      buffs: getSectionBuffs(formula, 'attack'),
    },
    {
      key: 'multiplier',
      label: '倍率',
      value: readFormulaResult(formula.formulaText),
      lines: [
        { label: '基础倍率', value: formula.baseMultiplierText },
        { label: '倍率计算', value: formula.formulaText },
      ],
      buffs: getSectionBuffs(formula, 'multiplier'),
    },
    {
      key: 'crit',
      label: '暴击',
      value: formula.critText,
      lines: [
        { label: '暴击率', value: readPanelValue(formula.panelLines, '暴击率') },
        { label: '暴击伤害', value: readPanelValue(formula.panelLines, '暴击伤害') },
        { label: '非暴击伤害', value: formula.nonCritText },
        { label: '暴击伤害', value: formula.critText },
        { label: '期望伤害', value: formula.expectedText },
      ],
      buffs: getSectionBuffs(formula, 'crit'),
    },
    {
      key: 'damageBonus',
      label: '加成',
      value: formula.damageBonusRateText,
      lines: [
        { label: '元素伤害加成', value: formula.elementBonusText },
        { label: '技能伤害加成', value: formula.skillBonusText },
        { label: '全伤害加成', value: formula.allDamageBonusText },
        { label: '加成区计算', value: formula.damageBonusFormulaText },
      ],
      buffs: getSectionBuffs(formula, 'damageBonus'),
    },
    {
      key: 'defense',
      label: '防御',
      value: formula.defenseZoneText,
      lines: [{ label: '防御区系数', value: formula.defenseZoneText }],
      buffs: getSectionBuffs(formula, 'defense'),
    },
    {
      key: 'resistance',
      label: '抗性',
      value: readFormulaResult(formula.resistanceFormulaText),
      lines: [
        { label: '有效抗性', value: formula.resistanceEffectiveText },
        { label: '抗性区计算', value: formula.resistanceFormulaText },
      ],
      buffs: getSectionBuffs(formula, 'resistance'),
    },
    {
      key: 'amplify',
      label: '增幅',
      value: readFormulaResult(formula.amplifyFormulaText),
      lines: [{ label: '增幅区计算', value: formula.amplifyFormulaText }],
      buffs: getSectionBuffs(formula, 'amplify'),
    },
    {
      key: 'fragile',
      label: '易伤',
      value: readFormulaResult(formula.fragileFormulaText),
      lines: [{ label: '易伤区计算', value: formula.fragileFormulaText }],
      buffs: getSectionBuffs(formula, 'fragile'),
    },
    {
      key: 'vulnerability',
      label: '脆弱',
      value: readFormulaResult(formula.vulnerabilityFormulaText),
      lines: [{ label: '脆弱区计算', value: formula.vulnerabilityFormulaText }],
      buffs: getSectionBuffs(formula, 'vulnerability'),
    },
    {
      key: 'combo',
      label: '连击',
      value: readFormulaResult(formula.comboFormulaText),
      lines: [{ label: '连击区计算', value: formula.comboFormulaText }],
      buffs: getSectionBuffs(formula, 'combo'),
    },
    {
      key: 'imbalance',
      label: '失衡',
      value: readFormulaResult(formula.imbalanceFormulaText),
      lines: [{ label: '失衡区计算', value: formula.imbalanceFormulaText }],
      buffs: getSectionBuffs(formula, 'imbalance'),
    },
    {
      key: 'result',
      label: '结果',
      value: formula.nonCritText,
      lines: [
        { label: '非暴击全链路', value: formula.nonCritFormulaText },
        { label: '期望伤害', value: formula.expectedText },
        { label: '暴击伤害', value: formula.critText },
        { label: '非暴击伤害', value: formula.nonCritText },
      ],
      buffs: [],
    },
  ];
}

export function TimelineSkillDetailWorkbench({
  searchLayer,
  characterName,
  skillLabel,
  positionLabel,
  isLocked,
  onToggleLock,
  onClose,
  onOpenSearch,
  targetResistance,
  onResistanceChange,
  buffs,
  buffStackCounts,
  onRemoveBuff,
  onToggleBuffDisabled,
  isBuffDisabled,
  onDecrementBuff,
  onIncrementBuff,
  onClearBuffs,
  onEnableAllBuffs,
  onDisableAllBuffs,
  onResetBuffStacks,
  statuses,
  hits,
  summary,
  formula,
  infoLines,
}: TimelineSkillDetailWorkbenchProps) {
  const [utilityPanel, setUtilityPanel] = useState<'resistance' | 'info' | null>(null);
  const [isAllTuningExpanded, setIsAllTuningExpanded] = useState(false);
  const [activeCalculationSection, setActiveCalculationSection] = useState<CalculationSectionKey>('attack');
  const [isAbilityDetailExpanded, setIsAbilityDetailExpanded] = useState(false);
  const [isSummaryFormulaExpanded, setIsSummaryFormulaExpanded] = useState(false);
  const [buffSourceFilter, setBuffSourceFilter] = useState('all');
  const calculationSections = formula ? buildCalculationSections(formula) : [];
  const buffSourceOptions = useMemo(() => {
    const sources = Array.from(new Set(
      buffs.map((buff) => buff.sourceName || buff.source || '未知来源')
    ));
    return [
      { key: 'all', label: '全部来源' },
      ...sources.map((source) => ({ key: source, label: source })),
    ];
  }, [buffs]);
  const visibleBuffs = useMemo(() => {
    if (buffSourceFilter === 'all') {
      return buffs;
    }
    return buffs.filter((buff) => (buff.sourceName || buff.source || '未知来源') === buffSourceFilter);
  }, [buffSourceFilter, buffs]);
  const selectedCalculationSection = calculationSections.find((section) => section.key === activeCalculationSection)
    ?? calculationSections[0]
    ?? null;
  const visibleCalculationLines = (() => {
    if (selectedCalculationSection?.key !== 'attack') {
      return selectedCalculationSection?.lines ?? [];
    }
    const summaryIndex = selectedCalculationSection.lines.findIndex((line) => line.label === '能力值总攻击加成');
    if (summaryIndex < 0) {
      return selectedCalculationSection.lines;
    }
    const summaryLine = selectedCalculationSection.lines[summaryIndex];
    const detailLines = selectedCalculationSection.lines.filter((line) => isAbilityDetailLine(line.label));
    const beforeSummary = selectedCalculationSection.lines
      .slice(0, summaryIndex)
      .filter((line) => !isAbilityDetailLine(line.label));
    const afterSummary = selectedCalculationSection.lines
      .slice(summaryIndex + 1)
      .filter((line) => !isAbilityDetailLine(line.label));
    return [
      ...beforeSummary,
      summaryLine,
      ...(isAbilityDetailExpanded ? detailLines : []),
      ...afterSummary,
    ];
  })();
  const calculationSvgHeight = Math.max(calculationSections.length * 50, 50);

  useEffect(() => {
    if (buffSourceFilter === 'all') {
      return;
    }
    const hasSource = buffs.some((buff) => (buff.sourceName || buff.source || '未知来源') === buffSourceFilter);
    if (!hasSource) {
      setBuffSourceFilter('all');
    }
  }, [buffSourceFilter, buffs]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return;
      }
      const target = event.target as HTMLElement | null;
      const isEditable =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        !!target?.closest('[contenteditable="true"]');
      if (isEditable) {
        return;
      }
      event.preventDefault();
      onClose();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return createPortal(
    <div className="timeline-detail-layer" role="dialog" aria-modal="true" aria-label="技能排轴详情">
      {searchLayer}
      <main className="timeline-detail-canvas">
        <button
          type="button"
          className={`timeline-detail-expand-all-button${isAllTuningExpanded ? ' is-active' : ''}`}
          onClick={() => setIsAllTuningExpanded((value) => !value)}
          title={isAllTuningExpanded ? '收起全部 Hit 微调' : '展开全部 Hit 微调'}
          aria-label={isAllTuningExpanded ? '收起全部 Hit 微调' : '展开全部 Hit 微调'}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            {isAllTuningExpanded ? (
              <path d="M7 10 12 5l5 5-1.4 1.4L12 7.8l-3.6 3.6L7 10Zm0 5 1.4-1.4 3.6 3.6 3.6-3.6L17 15l-5 5-5-5Z" />
            ) : (
              <path d="m7 9 5 5 5-5-1.4-1.4L12 11.2 8.4 7.6 7 9Zm0 6 5 5 5-5-1.4-1.4L12 17.2l-3.6-3.6L7 15Z" />
            )}
          </svg>
        </button>

        <header className="timeline-detail-heading">
          <p>
            <strong>{skillLabel}</strong>
            <span>{characterName} · {positionLabel}</span>
          </p>
          <nav>
            <button
              type="button"
              className={utilityPanel === 'resistance' ? 'is-active' : ''}
              onClick={() => setUtilityPanel((current) => current === 'resistance' ? null : 'resistance')}
              title="目标抗性"
              aria-label="目标抗性"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M11 2h2v3.1A7 7 0 0 1 18.9 11H22v2h-3.1A7 7 0 0 1 13 18.9V22h-2v-3.1A7 7 0 0 1 5.1 13H2v-2h3.1A7 7 0 0 1 11 5.1V2Zm1 5a5 5 0 1 0 0 10 5 5 0 0 0 0-10Zm0 3a2 2 0 1 1 0 4 2 2 0 0 1 0-4Z" />
              </svg>
            </button>
            <button
              type="button"
              className={utilityPanel === 'info' ? 'is-active' : ''}
              onClick={() => setUtilityPanel((current) => current === 'info' ? null : 'info')}
              title="信息"
              aria-label="信息"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M11 10h2v7h-2v-7Zm0-3h2v2h-2V7Zm1-5a10 10 0 1 1 0 20 10 10 0 0 1 0-20Zm0 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16Z" />
              </svg>
            </button>
            <button
              type="button"
              className={isLocked ? 'is-active' : ''}
              onClick={onToggleLock}
              title={isLocked ? '已锁定，点击解锁' : '未锁定，点击锁定'}
              aria-label={isLocked ? '解锁技能按钮' : '锁定技能按钮'}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                {isLocked ? (
                  <path d="M7 10V7a5 5 0 0 1 10 0v3h2v12H5V10h2Zm2 0h6V7a3 3 0 0 0-6 0v3Zm-2 2v8h10v-8H7Zm4 2h2v4h-2v-4Z" />
                ) : (
                  <path d="M9 10h10v12H5V10h2V7a5 5 0 0 1 9.9-1H14.8A3 3 0 0 0 9 7v3Zm-2 2v8h10v-8H7Zm4 2h2v4h-2v-4Z" />
                )}
              </svg>
            </button>
            <button type="button" onClick={onOpenSearch} title="添加 Buff" aria-label="添加 Buff">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6V5Z" />
              </svg>
            </button>
            <button type="button" onClick={onClose} title="关闭" aria-label="关闭">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="m6.4 5 5.6 5.6L17.6 5 19 6.4 13.4 12l5.6 5.6-1.4 1.4-5.6-5.6L6.4 19 5 17.6l5.6-5.6L5 6.4 6.4 5Z" />
              </svg>
            </button>
          </nav>
        </header>

        {utilityPanel ? (
          <aside className="timeline-detail-utility-panel">
            {utilityPanel === 'resistance' ? (
              <TimelineTargetResistancePanel value={targetResistance} onChange={onResistanceChange} />
            ) : (
              <TimelineInfoPanel lines={infoLines} />
            )}
          </aside>
        ) : null}

        <aside className="timeline-detail-hit-list" aria-label="Hit 列表">
          {hits.length === 0 ? <p className="timeline-detail-empty">暂无 Hit</p> : hits.map((hit) => (
            <Fragment key={hit.key}>
              <button
                type="button"
                className={`timeline-detail-hit${hit.selected ? ' is-selected' : ''}${hit.disabled ? ' is-disabled' : ''}`}
                onClick={hit.onSelect}
              >
                <span><strong>{hit.title}</strong><em>{hit.meta}</em></span>
                <small>期望 {hit.expected} · 暴击 {hit.crit} · 非暴 {hit.nonCrit}</small>
              </button>
              {(isAllTuningExpanded || hit.selected) && hit.tuning ? (
                <TimelineHitTuningPanel activeHit={hit.tuning} compact />
              ) : null}
            </Fragment>
          ))}
        </aside>

        <section className="timeline-detail-middle">
          <TimelineBuffListPanel
            buffs={visibleBuffs}
            totalBuffCount={buffs.length}
            stackCounts={buffStackCounts}
            onRemove={onRemoveBuff}
            onToggleDisabled={onToggleBuffDisabled}
            isDisabled={isBuffDisabled}
            onDecrement={onDecrementBuff}
            onIncrement={onIncrementBuff}
            sourceFilter={buffSourceFilter}
            sourceOptions={buffSourceOptions}
            onSourceFilterChange={setBuffSourceFilter}
            onClearAll={onClearBuffs}
            onEnableAll={onEnableAllBuffs}
            onDisableAll={onDisableAllBuffs}
            onResetStacks={onResetBuffStacks}
          />
          <TimelineStatusPanel statuses={statuses} />
        </section>

        <section className="timeline-detail-right-column">
          <section className="timeline-detail-card timeline-summary-card">
            <h3>{summary?.title || '伤害汇总'}</h3>
            {summary ? (
              <>
                <p>
                  <strong>期望 {summary.expected}</strong>
                  <span>暴击 {summary.crit}</span>
                  <span>非暴 {summary.nonCrit}</span>
                  {summary.parts.length > 1 ? (
                    <button
                      type="button"
                      className="timeline-calculation-inline-toggle"
                      onClick={() => setIsSummaryFormulaExpanded((value) => !value)}
                      aria-label={isSummaryFormulaExpanded ? '收起伤害组成' : '展开伤害组成'}
                    >
                      {isSummaryFormulaExpanded ? '−' : '+'}
                    </button>
                  ) : null}
                </p>
                {isSummaryFormulaExpanded && summary.parts.length > 1 ? (
                  <div className="timeline-summary-formula-parts">
                    {summary.parts.map((part, index) => (
                      <div key={`${part.label}-${index}`}>
                        <span>{part.label}</span>
                        <strong>{part.value}</strong>
                      </div>
                    ))}
                  </div>
                ) : null}
              </>
            ) : <p className="timeline-detail-empty">伤害数据加载中</p>}
          </section>

          <section className="timeline-detail-card timeline-calculation-card">
            <h3>计算过程</h3>
            {formula ? (
              <>
                <div className="timeline-calculation-summary">
                  <strong>{formula.title}</strong>
                  <span>期望 {formula.expectedText}</span>
                  <span>暴击 {formula.critText}</span>
                  <span>非暴 {formula.nonCritText}</span>
                </div>
                <div className="timeline-calculation-layout">
                  <article className="timeline-calculation-detail">
                    {selectedCalculationSection ? (
                      <>
                        <header>
                          <span>{selectedCalculationSection.label}区详情</span>
                          <strong>{selectedCalculationSection.value}</strong>
                        </header>
                        <div className="timeline-calculation-detail-rows">
                          {visibleCalculationLines.map((line, index) => (
                            <div key={`${selectedCalculationSection.key}-${index}`}>
                              <span>
                                {line.label}
                                {line.label === '能力值总攻击加成' ? (
                                  <button
                                    type="button"
                                    className="timeline-calculation-inline-toggle"
                                    onClick={() => setIsAbilityDetailExpanded((value) => !value)}
                                    aria-label={isAbilityDetailExpanded ? '收起能力明细' : '展开能力明细'}
                                  >
                                    {isAbilityDetailExpanded ? '−' : '+'}
                                  </button>
                                ) : null}
                              </span>
                              <strong>{line.value}</strong>
                            </div>
                          ))}
                        </div>
                        <div className="timeline-calculation-buffs">
                          <span>作用于本区的 Buff</span>
                          {selectedCalculationSection.buffs.length > 0 ? (
                            <div>
                              {selectedCalculationSection.buffs.map((buff) => (
                                <div key={buff.id} className="timeline-calculation-buff-row">
                                  <span>
                                    <strong>{buff.label}</strong>
                                    <small>{buff.type || '未分类'}</small>
                                  </span>
                                  <em>{formatBuffEffect(buff)}</em>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p>本区没有 Buff 作用</p>
                          )}
                        </div>
                      </>
                    ) : null}
                  </article>
                  <div className="timeline-calculation-zone-scroll">
                    <svg
                      className="timeline-calculation-zone-map"
                      viewBox={`0 0 116 ${calculationSvgHeight}`}
                      style={{ height: calculationSvgHeight }}
                      role="list"
                      aria-label="计算乘区导航"
                    >
                      {calculationSections.map((section, index) => {
                        const y = index * 50;
                        const selected = section.key === selectedCalculationSection?.key;
                        return (
                          <g
                            key={section.key}
                            className={`timeline-calculation-zone-node${selected ? ' is-selected' : ''}`}
                            role="button"
                            tabIndex={0}
                            aria-label={`${section.label} ${section.value}`}
                            onClick={() => setActiveCalculationSection(section.key)}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault();
                                setActiveCalculationSection(section.key);
                              }
                            }}
                          >
                            {index > 0 ? <path className="zone-node-link" d={`M58 ${y - 8} V${y + 3}`} /> : null}
                            {index > 0 ? <path className="zone-node-arrow" d={`M54 ${y - 1} L58 ${y + 4} L62 ${y - 1}`} /> : null}
                            <rect x="8" y={y + 5} width="100" height="38" rx="4" />
                            <text className="zone-node-label" x="18" y={y + 21}>{section.label}</text>
                            <text className="zone-node-value" x="98" y={y + 21} textAnchor="end">{section.value}</text>
                            <text className="zone-node-order" x="18" y={y + 35}>
                              {String(index + 1).padStart(2, '0')} · {section.buffs.length} Buff
                            </text>
                          </g>
                        );
                      })}
                    </svg>
                  </div>
                </div>
              </>
            ) : <p className="timeline-detail-empty">选择 Hit 后查看计算过程</p>}
          </section>
        </section>
      </main>
    </div>,
    document.body
  );
}
