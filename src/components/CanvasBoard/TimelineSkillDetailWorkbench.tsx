import { Fragment, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { HitResistanceInput, SkillButtonBuff } from '../../types/storage';
import type { AppliedBuffTagViewModel, FormulaViewModel } from '../../core/calculators/skillDamage.types';
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
  statuses: TimelineDetailStatus[];
  hits: TimelineDetailHit[];
  summary: {
    title: string;
    expected: string;
    crit: string;
    nonCrit: string;
    formula: string;
  } | null;
  formula: FormulaViewModel | null;
  isFormulaExpanded: boolean;
  onToggleFormula: () => void;
  infoLines: string[];
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
  statuses,
  hits,
  summary,
  formula,
  isFormulaExpanded,
  onToggleFormula,
  infoLines,
}: TimelineSkillDetailWorkbenchProps) {
  const [utilityPanel, setUtilityPanel] = useState<'resistance' | 'info' | null>(null);
  const [isAllTuningExpanded, setIsAllTuningExpanded] = useState(false);

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
            buffs={buffs}
            stackCounts={buffStackCounts}
            onRemove={onRemoveBuff}
            onToggleDisabled={onToggleBuffDisabled}
            isDisabled={isBuffDisabled}
            onDecrement={onDecrementBuff}
            onIncrement={onIncrementBuff}
          />
          <TimelineStatusPanel statuses={statuses} />
        </section>

        <section className="timeline-detail-right-column">
          <section className="timeline-detail-card timeline-summary-card">
            <h3>{summary?.title || '伤害汇总'}</h3>
            {summary ? (
              <>
                <p><strong>期望 {summary.expected}</strong><span>暴击 {summary.crit}</span><span>非暴 {summary.nonCrit}</span></p>
                <small>{summary.formula}</small>
              </>
            ) : <p className="timeline-detail-empty">伤害数据加载中</p>}
          </section>

          <section className="timeline-detail-card timeline-calculation-card">
            <header>
              <h3>计算过程</h3>
              <button type="button" onClick={onToggleFormula} disabled={!formula}>
                {isFormulaExpanded ? '收起' : '展开'}
              </button>
            </header>
            {isFormulaExpanded && formula ? (
              <article>
                <h4>{formula.title}</h4>
                {formula.panelLines.map((line) => <p key={line}>{line}</p>)}
                <h4>倍率区</h4><p>{formula.formulaText}</p>
                <h4>加成区</h4><p>{formula.damageBonusFormulaText}</p>
                <h4>增幅 / 易伤 / 脆弱</h4>
                <p>{formula.amplifyFormulaText}</p>
                <p>{formula.fragileFormulaText}</p>
                <p>{formula.vulnerabilityFormulaText}</p>
                <h4>防御 / 抗性</h4>
                <p>防御区 {formula.defenseZoneText}</p>
                <p>{formula.resistanceFormulaText}</p>
                <h4>结果</h4><p>{formula.nonCritFormulaText}</p>
              </article>
            ) : <p className="timeline-detail-empty">选择 Hit 后展开计算过程</p>}
          </section>
        </section>
      </main>
    </div>,
    document.body
  );
}
