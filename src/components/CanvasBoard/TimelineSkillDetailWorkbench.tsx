import { useState } from 'react';
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
  activeHit: TimelineDetailActiveHit | null;
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
  onDecrementBuff,
  onIncrementBuff,
  statuses,
  hits,
  summary,
  activeHit,
  formula,
  isFormulaExpanded,
  onToggleFormula,
  infoLines,
}: TimelineSkillDetailWorkbenchProps) {
  const [utilityPanel, setUtilityPanel] = useState<'resistance' | 'info' | null>(null);

  return createPortal(
    <div className="timeline-detail-layer" role="dialog" aria-modal="true" aria-label="技能排轴详情">
      {searchLayer}
      <main className="timeline-detail-canvas">
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
            >
              目标抗性
            </button>
            <button
              type="button"
              className={utilityPanel === 'info' ? 'is-active' : ''}
              onClick={() => setUtilityPanel((current) => current === 'info' ? null : 'info')}
            >
              信息
            </button>
            <button type="button" className={isLocked ? 'is-active' : ''} onClick={onToggleLock}>
              {isLocked ? '已锁定' : '未锁定'}
            </button>
            <button type="button" onClick={onOpenSearch}>添加 Buff</button>
            <button type="button" onClick={onClose}>关闭</button>
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
            <button
              type="button"
              key={hit.key}
              className={`timeline-detail-hit${hit.selected ? ' is-selected' : ''}${hit.disabled ? ' is-disabled' : ''}`}
              onClick={hit.onSelect}
            >
              <span><strong>{hit.title}</strong><em>{hit.meta}</em></span>
              <small>期望 {hit.expected} · 暴击 {hit.crit} · 非暴 {hit.nonCrit}</small>
            </button>
          ))}
        </aside>

        <section className={`timeline-detail-middle${activeHit ? ' is-tuning' : ' is-buff-list'}`}>
          {activeHit ? (
            <TimelineHitTuningPanel activeHit={activeHit} />
          ) : (
            <TimelineBuffListPanel
              buffs={buffs}
              stackCounts={buffStackCounts}
              onRemove={onRemoveBuff}
              onDecrement={onDecrementBuff}
              onIncrement={onIncrementBuff}
            />
          )}
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
