import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { ConfigSnapshot } from '../../core/calculators/operatorPanelCalculator';
import type { HitResistanceInput, SkillButtonBuff } from '../../types/storage';
import type { Character } from '../../types';
import type {
  AppliedBuffTagViewModel,
  HitCalcResult,
  SkillDamageCalcResultV2,
} from '../../core/calculators/skillDamage.types';
import type { AnomalyDamageSegmentView } from '../../components/CanvasBoard/skillButton.shared';
import type { MobileSlotCalculation, MobileTimelineAction } from '../model';
import { getMobileBuffSourceLabel } from '../mobileBuffWorkbench';
import { MobileBuffCatalogSheet } from './MobileBuffCatalogSheet';
import './MobileBuffEditor.css';

export interface MobileBuffEditorProps {
  action: MobileTimelineAction;
  calculation?: MobileSlotCalculation | null;
  result?: SkillDamageCalcResultV2 | null;
  /** Online catalog Buffs are read-only candidates; selected copies live on the action. */
  catalogBuffs?: SkillButtonBuff[];
  characterName?: string;
  operators?: Character[];
  operatorSnapshots?: Record<string, ConfigSnapshot>;
  onActionChange: (nextAction: MobileTimelineAction) => void;
  onClose: () => void;
  /** Locks the outer four-page pager for the lifetime of this fullscreen editor. */
  onInteractionLockChange?: (locked: boolean) => void;
}

type EditorPage = 0 | 1 | 2;

const PAGE_LABELS = ['Hit 微调', 'Buff', '计算与抗性'] as const;
const EDITOR_PAGER_INTERACTIVE_SELECTOR = [
  'button',
  'input',
  'select',
  'textarea',
  'a',
  'summary',
  '[data-mobile-pager-lock]',
].join(',');
const RESISTANCE_FIELDS: Array<[keyof HitResistanceInput, string]> = [
  ['physicalResistance', '物理'],
  ['fireResistance', '灼热'],
  ['electricResistance', '电磁'],
  ['iceResistance', '寒冷'],
  ['natureResistance', '自然'],
];

const ZONE_LABELS: Array<{ key: string; label: string }> = [
  { key: 'attack', label: '攻击' },
  { key: 'multiplier', label: '倍率' },
  { key: 'crit', label: '暴击' },
  { key: 'damageBonus', label: '伤害加成' },
  { key: 'defense', label: '防御' },
  { key: 'resistance', label: '抗性' },
  { key: 'amplify', label: '增幅' },
  { key: 'fragile', label: '易伤' },
  { key: 'vulnerability', label: '脆弱' },
  { key: 'combo', label: '连击' },
  { key: 'imbalance', label: '失衡' },
];
const SPECIAL_ZONE_LABELS = [...ZONE_LABELS, { key: 'result', label: '结果' }] as const;
const FLAT_APPLIED_BUFF_TYPES = new Set([
  'flatAtk',
  'mainStatBoost',
  'subStatBoost',
  'allStatBoost',
  'strengthBoost',
  'agilityBoost',
  'intelligenceBoost',
  'willBoost',
  'sourceSkillBoost',
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

function finite(value: number | undefined, fallback = 0): number {
  return Number.isFinite(value) ? value ?? fallback : fallback;
}

function formatNumber(value: number | undefined, fractionDigits = 0): string {
  const safeValue = finite(value);
  return safeValue.toLocaleString('zh-CN', {
    maximumFractionDigits: fractionDigits,
    minimumFractionDigits: fractionDigits,
  });
}

function formatPercent(value: number | undefined): string {
  return `${(finite(value) * 100).toFixed(1)}%`;
}

function getMaxStacks(buff: SkillButtonBuff): number {
  return typeof buff.maxStacks === 'number' && Number.isFinite(buff.maxStacks)
    ? Math.max(1, Math.floor(buff.maxStacks))
    : 1;
}

function isCountable(buff: SkillButtonBuff): boolean {
  return buff.category === 'countable' || getMaxStacks(buff) > 1;
}

function isBuffApplicableToHit(buff: SkillButtonBuff, hit: HitCalcResult): boolean {
  const target = buff.target;
  if (!target || target.mode === 'all') return true;
  if (target.mode === 'damageKey') return target.key === hit.hit.key;
  if (target.mode === 'skillType') return target.skillType === hit.hit.skillType;
  return target.element === hit.hit.element;
}

function getBuffLabel(buff: SkillButtonBuff): string {
  return buff.displayName || buff.name || buff.id;
}

function getBuffSource(buff: SkillButtonBuff): string {
  return buff.sourceName || buff.source || '未知来源';
}

function getBuffEffectMeta(buff: SkillButtonBuff): string {
  if (buff.effectKind === 'extraHit' && buff.extraHitConfig) {
    const config = buff.extraHitConfig;
    return `${config.damageType} · ${config.skillType || '独立'} · ${(config.baseMultiplier * 100).toFixed(1)}% · 失衡 ${config.imbalanceValue} · CD ${config.cooldownSeconds}s`;
  }
  return buff.type || '普通加成';
}

function getEffectiveStack(action: MobileTimelineAction, buff: SkillButtonBuff, hitKey?: string): number {
  const maxStacks = getMaxStacks(buff);
  const byHit = hitKey ? action.buffStackCountsByHitKey?.[hitKey]?.[buff.id] : undefined;
  const global = action.buffStackCounts?.[buff.id];
  const value = byHit ?? global ?? maxStacks;
  return Math.min(Math.max(Math.round(finite(value, maxStacks)), 0), maxStacks);
}

function toggleId(ids: string[] | undefined, id: string): string[] {
  const current = new Set(ids ?? []);
  if (current.has(id)) current.delete(id);
  else current.add(id);
  return [...current];
}

function withHitDisabledBuffs(action: MobileTimelineAction, hitKey: string, buffId: string): MobileTimelineAction {
  return {
    ...action,
    disabledBuffIdsByHitKey: {
      ...(action.disabledBuffIdsByHitKey ?? {}),
      [hitKey]: toggleId(action.disabledBuffIdsByHitKey?.[hitKey], buffId),
    },
  };
}

function withHitStack(action: MobileTimelineAction, hitKey: string, buff: SkillButtonBuff, value: number): MobileTimelineAction {
  const maxStacks = getMaxStacks(buff);
  const nextValue = Math.min(Math.max(Math.round(value), 0), maxStacks);
  return {
    ...action,
    buffStackCountsByHitKey: {
      ...(action.buffStackCountsByHitKey ?? {}),
      [hitKey]: {
        ...(action.buffStackCountsByHitKey?.[hitKey] ?? {}),
        [buff.id]: nextValue,
      },
    },
  };
}

function withGlobalStack(action: MobileTimelineAction, buff: SkillButtonBuff, value: number): MobileTimelineAction {
  const maxStacks = getMaxStacks(buff);
  return {
    ...action,
    buffStackCounts: {
      ...(action.buffStackCounts ?? {}),
      [buff.id]: Math.min(Math.max(Math.round(value), 0), maxStacks),
    },
  };
}

function SummaryMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="mobile-buff-summary-metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function StackControl({
  value,
  max,
  onChange,
}: {
  value: number;
  max: number;
  onChange: (value: number) => void;
}) {
  return (
    <span className="mobile-buff-stack-control" aria-label={`层数 ${value}/${max}`}>
      <button type="button" onClick={() => onChange(value - 1)} disabled={value <= 0} aria-label="减少层数">−</button>
      <span>{value}/{max}</span>
      <button type="button" onClick={() => onChange(value + 1)} disabled={value >= max} aria-label="增加层数">＋</button>
    </span>
  );
}

export function MobileBuffEditor({
  action,
  calculation,
  result,
  catalogBuffs = [],
  characterName,
  operators = [],
  operatorSnapshots = {},
  onActionChange,
  onClose,
  onInteractionLockChange,
}: MobileBuffEditorProps) {
  const [activePage, setActivePage] = useState<EditorPage>(0);
  const [selectedSegmentKey, setSelectedSegmentKey] = useState<string | null>(null);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const pagerPointerRef = useRef<{ pointerId: number; startX: number; startY: number; horizontal: boolean } | null>(null);
  const safeResult = calculation?.result ?? result ?? null;
  const buffs = action.buffs ?? [];
  const hits = safeResult?.hits ?? [];
  const specialSegments = calculation?.specialSegments ?? [];
  const selectedHit = hits.find((hit) => hit.hit.key === selectedSegmentKey) ?? null;
  const activeSpecialSegment = specialSegments.find((segment) => segment.key === selectedSegmentKey) ?? null;
  const activeHit = selectedHit ?? (activeSpecialSegment ? null : hits[0] ?? null);
  const currentSegmentKey = activeSpecialSegment?.key ?? activeHit?.hit.key ?? null;
  const activeAnomalyCardId = activeSpecialSegment?.sourceKind === 'anomaly'
    ? (action.anomalyDamages ?? []).find((card) => (
        activeSpecialSegment.key === card.id || activeSpecialSegment.key.startsWith(`${card.id}-dot`)
      ))?.id ?? null
    : null;
  const currentBuffScopeKey = activeAnomalyCardId ?? currentSegmentKey;
  const globallyDisabled = new Set(action.globallyDisabledBuffIds ?? []);
  const disabledForCurrentSegment = new Set(currentBuffScopeKey ? action.disabledBuffIdsByHitKey?.[currentBuffScopeKey] ?? [] : []);
  const modifierBuffs = calculation?.modifierBuffs ?? buffs.filter((buff) => buff.effectKind !== 'extraHit');

  useEffect(() => {
    onInteractionLockChange?.(true);
    return () => onInteractionLockChange?.(false);
  }, [onInteractionLockChange]);

  useEffect(() => {
    const segmentExists = selectedSegmentKey
      && (hits.some((hit) => hit.hit.key === selectedSegmentKey)
        || specialSegments.some((segment) => segment.key === selectedSegmentKey));
    if (segmentExists) return;
    setSelectedSegmentKey(hits[0]?.hit.key ?? specialSegments[0]?.key ?? null);
  }, [hits, selectedSegmentKey, specialSegments]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (catalogOpen) setCatalogOpen(false);
        else onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [catalogOpen, onClose]);

  const updateAction = (nextAction: MobileTimelineAction) => {
    onActionChange(nextAction);
  };

  const handlePagerPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest(EDITOR_PAGER_INTERACTIVE_SELECTOR)) return;
    pagerPointerRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      horizontal: false,
    };
  };

  const handlePagerPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const pointer = pagerPointerRef.current;
    if (!pointer || pointer.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - pointer.startX;
    const deltaY = event.clientY - pointer.startY;
    if (!pointer.horizontal && Math.abs(deltaX) > 12 && Math.abs(deltaX) > Math.abs(deltaY) * 1.15) {
      pointer.horizontal = true;
    }
    if (pointer.horizontal) {
      event.preventDefault();
      event.stopPropagation();
    }
  };

  const handlePagerPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const pointer = pagerPointerRef.current;
    if (!pointer || pointer.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - pointer.startX;
    const deltaY = event.clientY - pointer.startY;
    if (pointer.horizontal && Math.abs(deltaX) >= 44 && Math.abs(deltaX) > Math.abs(deltaY)) {
      const nextPage = deltaX < 0 ? Math.min(2, activePage + 1) : Math.max(0, activePage - 1);
      setActivePage(nextPage as EditorPage);
      event.preventDefault();
      event.stopPropagation();
    }
    pagerPointerRef.current = null;
  };

  const handlePagerPointerCancel = () => {
    pagerPointerRef.current = null;
  };

  const toggleCurrentSegment = () => {
    if (!currentSegmentKey) return;
    updateAction({
      ...action,
      disabledHitKeys: toggleId(action.disabledHitKeys, currentSegmentKey),
    });
  };

  const toggleCurrentSegmentBuff = (buffId: string) => {
    if (!currentBuffScopeKey) return;
    updateAction(withHitDisabledBuffs(action, currentBuffScopeKey, buffId));
  };

  const removeBuff = (buffId: string) => {
    const extraHitSegmentPrefix = `buff-extra-hit-${buffId}`;
    const nextByHit = Object.fromEntries(
      Object.entries(action.disabledBuffIdsByHitKey ?? {})
        .filter(([hitKey]) => !hitKey.startsWith(extraHitSegmentPrefix))
        .map(([hitKey, ids]) => [hitKey, ids.filter((id) => id !== buffId)]),
    );
    const nextStacksByHit = Object.fromEntries(
      Object.entries(action.buffStackCountsByHitKey ?? {})
        .filter(([hitKey]) => !hitKey.startsWith(extraHitSegmentPrefix))
        .map(([hitKey, counts]) => {
          const { [buffId]: _removed, ...rest } = counts;
          return [hitKey, rest];
        }),
    );
    updateAction({
      ...action,
      buffs: buffs.filter((buff) => buff.id !== buffId),
      buffStackCounts: Object.fromEntries(Object.entries(action.buffStackCounts ?? {}).filter(([id]) => id !== buffId)),
      buffStackCountsByHitKey: nextStacksByHit,
      globallyDisabledBuffIds: (action.globallyDisabledBuffIds ?? []).filter((id) => id !== buffId),
      disabledBuffIdsByHitKey: nextByHit,
      disabledHitKeys: (action.disabledHitKeys ?? []).filter((hitKey) => !hitKey.startsWith(extraHitSegmentPrefix)),
    });
  };

  const toggleCatalogBuff = (buff: SkillButtonBuff) => {
    if (buffs.some((current) => current.id === buff.id)) {
      removeBuff(buff.id);
      return;
    }
    const maxStacks = getMaxStacks(buff);
    updateAction({
      ...action,
      buffs: [...buffs, { ...buff, refCount: Number.isFinite(buff.refCount) ? buff.refCount : 0 }],
      buffStackCounts: {
        ...(action.buffStackCounts ?? {}),
        ...(isCountable(buff) ? { [buff.id]: maxStacks } : {}),
      },
      globallyDisabledBuffIds: (action.globallyDisabledBuffIds ?? []).filter((id) => id !== buff.id),
    });
  };

  const toggleGlobalBuff = (buffId: string) => {
    updateAction({
      ...action,
      globallyDisabledBuffIds: toggleId(action.globallyDisabledBuffIds, buffId),
    });
  };

  const activeSegmentBuffs = activeSpecialSegment
    ? modifierBuffs
    : activeHit
      ? modifierBuffs.filter((buff) => isBuffApplicableToHit(buff, activeHit))
      : [];
  const isCurrentSegmentDisabled = currentSegmentKey
    ? action.disabledHitKeys?.includes(currentSegmentKey) ?? false
    : false;
  const specialConfigCount = (action.anomalyDamages?.length ?? 0)
    + (action.anomalyStatuses?.length ?? 0)
    + (action.anomalyStateSnapshots?.length ?? 0);

  const removeAnomalyCard = (kind: 'damage' | 'state', cardId: string) => {
    updateAction({
      ...action,
      ...(kind === 'damage'
        ? { anomalyDamages: (action.anomalyDamages ?? []).filter((card) => card.id !== cardId) }
        : { anomalyStatuses: (action.anomalyStatuses ?? []).filter((card) => card.id !== cardId) }),
    });
  };

  const removeAnomalyStateSnapshot = (snapshotId: number) => {
    updateAction({
      ...action,
      anomalyStateSnapshots: (action.anomalyStateSnapshots ?? []).filter((snapshot) => snapshot.id !== snapshotId),
    });
  };

  const resetCurrentSegmentBuffs = () => {
    if (!currentBuffScopeKey) return;
    const { [currentBuffScopeKey]: _disabled, ...nextDisabledByHit } = action.disabledBuffIdsByHitKey ?? {};
    const { [currentBuffScopeKey]: _stacks, ...nextStacksByHit } = action.buffStackCountsByHitKey ?? {};
    updateAction({
      ...action,
      disabledBuffIdsByHitKey: nextDisabledByHit,
      buffStackCountsByHitKey: nextStacksByHit,
    });
  };

  return (
    <div className="mobile-buff-editor" role="dialog" aria-modal="true" aria-label="技能 Buff 编辑器">
      <header className="mobile-buff-editor-header">
        <button type="button" className="mobile-buff-editor-back" onClick={onClose} aria-label="返回排轴">
          <span aria-hidden="true">‹</span>
          <span>返回排轴</span>
        </button>
        <div className="mobile-buff-editor-heading">
          <p>{characterName || '技能实例'}</p>
          <h1>{action.skillName}</h1>
        </div>
        <span className="mobile-buff-editor-skill-type">{action.skillType}</span>
      </header>

      <nav className="mobile-buff-editor-tabs" aria-label="Buff 编辑分页">
        {PAGE_LABELS.map((label, index) => (
          <button
            key={label}
            type="button"
            className={activePage === index ? 'is-active' : ''}
            onClick={() => setActivePage(index as EditorPage)}
            aria-current={activePage === index ? 'page' : undefined}
          >
            <span>0{index + 1}</span>{label}
          </button>
        ))}
      </nav>

      <div
        className="mobile-buff-editor-viewport"
        onPointerDown={handlePagerPointerDown}
        onPointerMove={handlePagerPointerMove}
        onPointerUp={handlePagerPointerUp}
        onPointerCancel={handlePagerPointerCancel}
      >
        <div className="mobile-buff-editor-track" style={{ transform: `translate3d(-${activePage * 33.333333}%, 0, 0)` }}>
          <section className="mobile-buff-page mobile-buff-hit-page" aria-label="Hit 微调">
            <div className="mobile-buff-page-heading">
              <div>
                <p className="mobile-buff-kicker">01 / HIT</p>
                <h2>命中详情与微调</h2>
              </div>
              <span>{hits.length + specialSegments.length} 段</span>
            </div>
            {hits.length + specialSegments.length === 0 ? (
              <p className="mobile-buff-empty">当前技能没有可编辑的伤害段。</p>
            ) : (
              <>
                <div className="mobile-buff-hit-list" role="list" aria-label="Hit 列表">
                  {hits.map((hit) => {
                    const selected = hit.hit.key === currentSegmentKey;
                    const disabled = action.disabledHitKeys?.includes(hit.hit.key) ?? false;
                    return (
                      <button
                        key={hit.hit.key}
                        type="button"
                        className={`mobile-buff-hit-card${selected ? ' is-selected' : ''}${disabled ? ' is-disabled' : ''}`}
                        onClick={() => setSelectedSegmentKey(hit.hit.key)}
                        aria-current={selected ? 'true' : undefined}
                      >
                        <span className="mobile-buff-hit-number">{String(hits.indexOf(hit) + 1).padStart(2, '0')}</span>
                        <span className="mobile-buff-hit-copy">
                          <strong>{hit.hit.displayName}</strong>
                          <small>{formatPercent(hit.hit.multiplier)} · {disabled ? '已禁用' : '启用'}</small>
                        </span>
                        <span className="mobile-buff-hit-expected">{formatNumber(hit.expected.final)}</span>
                      </button>
                    );
                  })}
                  {specialSegments.map((segment, index) => (
                    <button
                      key={segment.key}
                      type="button"
                      className={`mobile-buff-hit-card is-special${segment.key === currentSegmentKey ? ' is-selected' : ''}${segment.isDisabled ? ' is-disabled' : ''}`}
                      onClick={() => setSelectedSegmentKey(segment.key)}
                      aria-current={segment.key === currentSegmentKey ? 'true' : undefined}
                    >
                      <span className="mobile-buff-hit-number">{String(hits.length + index + 1).padStart(2, '0')}</span>
                      <span className="mobile-buff-hit-copy">
                        <strong>{segment.compactTitle}</strong>
                        <small>{segment.sourceKind === 'buff-extra-hit' ? '额外 Hit' : '异常伤害'} · {segment.elementText} · {segment.isDisabled ? '已禁用' : '启用'}</small>
                      </span>
                      <span className="mobile-buff-hit-expected">{formatNumber(segment.expectedValue)}</span>
                    </button>
                  ))}
                </div>

                {activeHit || activeSpecialSegment ? (
                  <section className="mobile-buff-panel mobile-buff-hit-tuning" aria-label={`${activeHit?.hit.displayName ?? activeSpecialSegment?.compactTitle ?? '伤害段'} 微调`}>
                    <div className="mobile-buff-panel-heading">
                      <div>
                        <p className="mobile-buff-kicker">
                          {activeSpecialSegment?.sourceKind === 'buff-extra-hit'
                            ? 'EXTRA HIT / 当前段'
                            : activeSpecialSegment
                              ? 'ANOMALY / 当前段'
                              : 'NORMAL HIT / 当前段'}
                        </p>
                        <h3>{activeHit?.hit.displayName ?? activeSpecialSegment?.compactTitle}</h3>
                      </div>
                      <button type="button" className={`mobile-buff-toggle${isCurrentSegmentDisabled ? ' is-off' : ''}`} onClick={toggleCurrentSegment} aria-pressed={!isCurrentSegmentDisabled}>
                        {isCurrentSegmentDisabled ? '启用本段' : '禁用本段'}
                      </button>
                    </div>
                    <div className="mobile-buff-summary-grid">
                      <SummaryMetric label="期望" value={formatNumber(activeHit?.expected.final ?? activeSpecialSegment?.expectedValue)} />
                      <SummaryMetric label="暴击" value={formatNumber(activeHit?.crit.final ?? activeSpecialSegment?.critValue)} />
                      <SummaryMetric label="非暴" value={formatNumber(activeHit?.nonCrit.final ?? activeSpecialSegment?.nonCritValue)} />
                    </div>
                    {activeSpecialSegment ? (
                      <div className="mobile-buff-segment-scope" aria-label="特殊伤害段参数">
                        <p><span>属性 / 类型</span><b>{activeSpecialSegment.elementText}{activeSpecialSegment.skillTypeText ? ` · ${activeSpecialSegment.skillTypeText}` : ' · 独立段'}</b></p>
                        <p><span>基础 / 最终倍率</span><b>{activeSpecialSegment.baseMultiplierText} / {activeSpecialSegment.multiplierText}</b></p>
                        {activeSpecialSegment.sourceKind === 'buff-extra-hit' ? (
                          <>
                            <p><span>失衡值</span><b>{activeSpecialSegment.imbalanceText || '0'}</b></p>
                            <p><span>冷却</span><b>{activeSpecialSegment.cooldownText || '0s'}</b></p>
                          </>
                        ) : (
                          <>
                            <p><span>等级系数</span><b>{activeSpecialSegment.levelCoefficientText}</b></p>
                            <p><span>源石技艺</span><b>{activeSpecialSegment.sourceSkillZoneText}</b></p>
                          </>
                        )}
                      </div>
                    ) : null}
                    <div className="mobile-buff-tuning-list">
                      <div className="mobile-buff-tuning-list-heading">
                        <p>{activeAnomalyCardId ? '异常配置 Buff · 拆分持续段共享' : '本段 Buff · 可逐项停用或覆盖层数'}</p>
                        <button type="button" onClick={resetCurrentSegmentBuffs} disabled={!currentBuffScopeKey}>重置</button>
                      </div>
                      {activeSegmentBuffs.length === 0 ? <span className="mobile-buff-muted-line">没有匹配到作用于本段的 Buff。</span> : activeSegmentBuffs.map((buff) => {
                        const segmentDisabled = disabledForCurrentSegment.has(buff.id);
                        const globalDisabled = globallyDisabled.has(buff.id);
                        const countable = isCountable(buff);
                        return (
                          <div key={buff.id} className={`mobile-buff-tuning-row${segmentDisabled || globalDisabled ? ' is-disabled' : ''}`}>
                            <button type="button" className="mobile-buff-tuning-name" onClick={() => toggleCurrentSegmentBuff(buff.id)} aria-pressed={!segmentDisabled}>
                              <span className="mobile-buff-segment-latch" aria-hidden="true">{segmentDisabled ? '×' : '✓'}</span>
                              <span>
                                <strong>{getBuffLabel(buff)}</strong>
                                <small>{globalDisabled ? 'Buff 页已停用' : segmentDisabled ? '本段已停用' : getBuffSource(buff)}</small>
                              </span>
                            </button>
                            {countable ? (
                              <StackControl
                                value={getEffectiveStack(action, buff, currentBuffScopeKey ?? undefined)}
                                max={getMaxStacks(buff)}
                                onChange={(value) => currentBuffScopeKey && updateAction(withHitStack(action, currentBuffScopeKey, buff, value))}
                              />
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  </section>
                ) : null}
              </>
            )}
          </section>

          <section className="mobile-buff-page mobile-buff-catalog-page" aria-label="Buff 选择与添加">
            <div className="mobile-buff-page-heading">
              <div>
                <p className="mobile-buff-kicker">02 / BUFF</p>
                <h2>Buff 与特殊效果</h2>
              </div>
              <span>{buffs.length + specialConfigCount} 个已选</span>
            </div>

            <details className="mobile-buff-panel mobile-buff-disclosure mobile-buff-special-configs mobile-buff-state-manager">
              <summary className="mobile-buff-panel-heading mobile-buff-panel-summary">
                <div>
                  <p className="mobile-buff-kicker">STATE MANAGER</p>
                  <h3 id="mobile-buff-special-title">当前状态管理</h3>
                </div>
                <span>{specialConfigCount}</span>
              </summary>
              <div className="mobile-buff-panel-body">
                <p className="mobile-buff-state-manager-note">导电、腐蚀、碎甲、异常伤害与状态区效果统一在这里管理。</p>
                {specialConfigCount === 0 ? <p className="mobile-buff-empty">当前没有特殊状态；可从下方分类台添加。</p> : (
                  <div className="mobile-buff-special-config-list">
                    {(action.anomalyDamages ?? []).map((card) => (
                      <article key={card.id} className="mobile-buff-special-config-row">
                        <span className="mobile-buff-special-kind">异常伤害</span>
                        <span>
                          <strong>{card.primaryText}</strong>
                          <small>{[card.secondaryText, card.tertiaryText].filter(Boolean).join(' · ')}</small>
                        </span>
                        <button type="button" className="mobile-buff-remove is-labeled" onClick={() => removeAnomalyCard('damage', card.id)} aria-label={`删除 ${card.primaryText}`}>删除</button>
                      </article>
                    ))}
                    {(action.anomalyStateSnapshots ?? []).map((snapshot) => (
                      <article key={snapshot.id} className="mobile-buff-special-config-row">
                        <span className="mobile-buff-special-kind is-state">异常状态</span>
                        <span>
                          <strong>{snapshot.primaryText}</strong>
                          <small>{[snapshot.secondaryText, snapshot.tertiaryText].filter(Boolean).join(' · ')}</small>
                        </span>
                        <button type="button" className="mobile-buff-remove is-labeled" onClick={() => removeAnomalyStateSnapshot(snapshot.id)} aria-label={`删除 ${snapshot.primaryText}`}>删除</button>
                      </article>
                    ))}
                    {(action.anomalyStatuses ?? []).map((card) => (
                      <article key={card.id} className="mobile-buff-special-config-row">
                        <span className="mobile-buff-special-kind is-zone">状态区</span>
                        <span>
                          <strong>{card.primaryText}</strong>
                          <small>{[card.secondaryText, card.tertiaryText].filter(Boolean).join(' · ')}</small>
                        </span>
                        <button type="button" className="mobile-buff-remove is-labeled" onClick={() => removeAnomalyCard('state', card.id)} aria-label={`删除 ${card.primaryText}`}>删除</button>
                      </article>
                    ))}
                  </div>
                )}
              </div>
            </details>

            <button type="button" className="mobile-buff-workbench-launch" onClick={() => setCatalogOpen(true)}>
              <span className="mobile-buff-workbench-icon" aria-hidden="true">⌘</span>
              <span className="mobile-buff-workbench-copy">
                <small>BUFF WORKBENCH</small>
                <strong>打开分类与特殊效果</strong>
                <span>按干员、武器、装备、潜能与异常类型筛选</span>
              </span>
              <span className="mobile-buff-workbench-arrow" aria-hidden="true">›</span>
              <span className="mobile-buff-workbench-tags" aria-hidden="true">
                <i>天赋 / 潜能 / 技能</i>
                <i>异常 / 燃烧 / 额外 Hit</i>
              </span>
            </button>

            <details className="mobile-buff-panel mobile-buff-disclosure">
              <summary className="mobile-buff-panel-heading mobile-buff-panel-summary">
                <div>
                  <p className="mobile-buff-kicker">当前实例</p>
                  <h3 id="mobile-buff-selected-title">已选 Buff</h3>
                </div>
                <span>{buffs.length}</span>
              </summary>
              <div className="mobile-buff-panel-body">
                {buffs.length === 0 ? <p className="mobile-buff-empty">还没有常规 Buff，打开分类台从干员、武器或装备中添加。</p> : (
                  <div className="mobile-buff-selected-list">
                    {buffs.map((buff) => {
                      const disabled = globallyDisabled.has(buff.id);
                      return (
                        <article key={buff.id} className={`mobile-buff-selected-row${disabled ? ' is-disabled' : ''}`}>
                          <button type="button" className="mobile-buff-selected-main" onClick={() => toggleGlobalBuff(buff.id)} aria-pressed={!disabled}>
                            <span className="mobile-buff-status-dot" aria-hidden="true" />
                            <span>
                              <strong>{getBuffLabel(buff)}</strong>
                              <small>{getMobileBuffSourceLabel(buff)} · {getBuffSource(buff)} · {getBuffEffectMeta(buff)}</small>
                            </span>
                          </button>
                          {isCountable(buff) ? (
                            <StackControl value={getEffectiveStack(action, buff)} max={getMaxStacks(buff)} onChange={(value) => updateAction(withGlobalStack(action, buff, value))} />
                          ) : null}
                          <button type="button" className="mobile-buff-remove" onClick={() => removeBuff(buff.id)} aria-label={`移除 ${getBuffLabel(buff)}`}>×</button>
                        </article>
                      );
                    })}
                  </div>
                )}
              </div>
            </details>

            {specialSegments.length > 0 ? (
              <details className="mobile-buff-panel mobile-buff-disclosure mobile-buff-special-damage">
                <summary className="mobile-buff-panel-heading mobile-buff-panel-summary">
                  <div>
                    <p className="mobile-buff-kicker">EXTRA DAMAGE</p>
                    <h3 id="mobile-buff-special-damage-title">特殊伤害段</h3>
                  </div>
                  <span>{specialSegments.length}</span>
                </summary>
                <div className="mobile-buff-panel-body">
                  <div className="mobile-buff-special-damage-list">
                    {specialSegments.map((segment) => (
                      <button
                        type="button"
                        key={segment.key}
                        className={`${segment.key === currentSegmentKey ? 'is-selected' : ''}${segment.isDisabled ? ' is-disabled' : ''}`}
                        onClick={() => {
                          setSelectedSegmentKey(segment.key);
                          setActivePage(0);
                        }}
                        aria-current={segment.key === currentSegmentKey ? 'true' : undefined}
                      >
                        <span className="mobile-buff-special-damage-index">{segment.sourceKind === 'buff-extra-hit' ? 'HIT' : 'EX'}</span>
                        <span>
                          <strong>{segment.compactTitle}</strong>
                          <small>{segment.elementText} · {segment.baseMultiplierText} · {segment.isDisabled ? '已停用' : segment.buffText}</small>
                        </span>
                        <b>{segment.isDisabled ? '已停用' : formatNumber(segment.expectedValue)}</b>
                      </button>
                    ))}
                  </div>
                </div>
              </details>
            ) : null}
          </section>

          <section className="mobile-buff-page mobile-buff-calculation-page" aria-label="计算过程与目标抗性">
            <div className="mobile-buff-page-heading">
              <div>
                <p className="mobile-buff-kicker">03 / CALCULATION</p>
                <h2>计算过程与抗性</h2>
              </div>
              <span>{activeHit?.hit.displayName ?? activeSpecialSegment?.compactTitle ?? '—'}</span>
            </div>
            {safeResult ? (
              <>
                <section className="mobile-buff-panel mobile-buff-total-card" aria-label="技能伤害汇总">
                  <p className="mobile-buff-kicker">技能总计</p>
                  <strong>{formatNumber(safeResult.summary.totalExpected)}</strong>
                  <div className="mobile-buff-summary-grid">
                    <SummaryMetric label="暴击" value={formatNumber(safeResult.summary.totalCrit)} />
                    <SummaryMetric label="非暴" value={formatNumber(safeResult.summary.totalNonCrit)} />
                    <SummaryMetric label="Hit" value={`${hits.length + specialSegments.length} 段`} />
                  </div>
                </section>

                {activeHit ? (
                  <section className="mobile-buff-panel" aria-labelledby="mobile-buff-zone-title">
                    <div className="mobile-buff-panel-heading">
                      <div>
                        <p className="mobile-buff-kicker">NORMAL HIT / 当前段</p>
                        <h3 id="mobile-buff-zone-title">完整乘区计算</h3>
                      </div>
                      <span>{formatNumber(activeHit.expected.final)}</span>
                    </div>
                    <div className="mobile-buff-zone-list">
                      {ZONE_LABELS.map((zone) => {
                        const details = getZoneDetails(activeHit, zone.key);
                        return (
                          <details key={zone.key} className="mobile-buff-zone" open={zone.key === 'attack' || zone.key === 'resistance'}>
                            <summary><span>{zone.label}</span><strong>{details.value}</strong></summary>
                            <div className="mobile-buff-zone-details">
                              {details.lines.map((line) => <p key={line.label}><span>{line.label}</span><b>{line.value}</b></p>)}
                              {getZoneContributions(activeHit, zone.key, modifierBuffs).length > 0 ? (
                                <div className="mobile-buff-contribution-list">
                                  <small>作用于本区的 Buff</small>
                                  {getZoneContributions(activeHit, zone.key, modifierBuffs).map((contribution) => (
                                    <p key={`${zone.key}-${contribution.buffId}`}><span>{getBuffLabel(modifierBuffs.find((buff) => buff.id === contribution.buffId) ?? ({ id: contribution.buffId, name: contribution.buffId, displayName: contribution.buffId, sourceName: '', refCount: 0 } as SkillButtonBuff))}</span><b>{formatContribution(contribution)}</b></p>
                                  ))}
                                </div>
                              ) : null}
                            </div>
                          </details>
                        );
                      })}
                    </div>
                  </section>
                ) : activeSpecialSegment ? (
                  <section className="mobile-buff-panel mobile-buff-special-calculation" aria-labelledby="mobile-buff-special-zone-title">
                    <div className="mobile-buff-panel-heading">
                      <div>
                        <p className="mobile-buff-kicker">{activeSpecialSegment.sourceKind === 'buff-extra-hit' ? 'EXTRA HIT / 当前段' : 'ANOMALY / 当前段'}</p>
                        <h3 id="mobile-buff-special-zone-title">完整乘区计算</h3>
                      </div>
                      <span>{formatNumber(activeSpecialSegment.expectedValue)}</span>
                    </div>
                    <div className="mobile-buff-special-calculation-meta">
                      <span>{activeSpecialSegment.elementText}</span>
                      <span>{activeSpecialSegment.skillTypeText || '独立伤害'}</span>
                      <span>{activeSpecialSegment.baseMultiplierText} 基础</span>
                      {activeSpecialSegment.cooldownText ? <span>CD {activeSpecialSegment.cooldownText}</span> : null}
                    </div>
                    <div className="mobile-buff-zone-list">
                      {SPECIAL_ZONE_LABELS.map((zone) => {
                        const details = getSpecialZoneDetails(activeSpecialSegment, zone.key);
                        return (
                          <details key={zone.key} className="mobile-buff-zone" open={zone.key === 'attack' || zone.key === 'result'}>
                            <summary><span>{zone.label}</span><strong>{details.value}</strong></summary>
                            <div className="mobile-buff-zone-details">
                              {details.lines.map((line) => <p key={line.label}><span>{line.label}</span><b>{line.value}</b></p>)}
                            </div>
                          </details>
                        );
                      })}
                    </div>
                    <div className="mobile-buff-special-applied">
                      <small>本段实际生效 Buff</small>
                      {activeSpecialSegment.appliedBuffTags.length > 0 ? activeSpecialSegment.appliedBuffTags.map((buff) => (
                        <p key={buff.id}><span>{buff.displayLabel || buff.label}</span><b>{formatAppliedBuffTag(buff)}</b></p>
                      )) : <p><span>无生效 Buff</span><b>—</b></p>}
                    </div>
                  </section>
                ) : <p className="mobile-buff-empty">选择一个伤害段后查看乘区计算。</p>}

                {activeHit || activeSpecialSegment ? (
                  <section className="mobile-buff-panel mobile-buff-resistance-panel" aria-labelledby="mobile-buff-resistance-title">
                    <div className="mobile-buff-panel-heading">
                      <div>
                        <p className="mobile-buff-kicker">目标设置</p>
                        <h3 id="mobile-buff-resistance-title">目标抗性</h3>
                      </div>
                      <span>
                        {activeHit
                          ? formatNumber(activeHit.zones.resistance.effectiveResistance, 1)
                          : (Number(activeSpecialSegment?.resistanceBaseText ?? 0) - Number(activeSpecialSegment?.corrosionText ?? 0)).toFixed(1)} 有效
                      </span>
                    </div>
                    <div className="mobile-buff-resistance-fields">
                      {RESISTANCE_FIELDS.map(([key, label]) => (
                        <label key={key}>
                          <span>{label}</span>
                          <input
                            type="number"
                            inputMode="decimal"
                            step="1"
                            value={finite(action.targetResistance?.[key])}
                            onChange={(event) => updateAction({
                              ...action,
                              targetResistance: {
                                ...(action.targetResistance ?? {}),
                                [key]: Number.isFinite(Number(event.target.value)) ? Number(event.target.value) : 0,
                              },
                            })}
                          />
                        </label>
                      ))}
                    </div>
                    <p className="mobile-buff-formula">{activeHit?.zones.resistance.formulaText ?? activeSpecialSegment?.resistanceFormulaText}</p>
                  </section>
                ) : null}

                {specialSegments.length > 0 ? (
                  <section className="mobile-buff-panel" aria-labelledby="mobile-buff-special-formula-title">
                    <div className="mobile-buff-panel-heading">
                      <div>
                        <p className="mobile-buff-kicker">SPECIAL SEGMENTS</p>
                        <h3 id="mobile-buff-special-formula-title">异常与额外 Hit 计算</h3>
                      </div>
                      <span>{specialSegments.length}</span>
                    </div>
                    <div className="mobile-buff-zone-list">
                      {specialSegments.map((segment) => (
                        <details key={segment.key} className={`mobile-buff-zone mobile-buff-special-formula${segment.isDisabled ? ' is-disabled' : ''}`}>
                          <summary>
                            <span>{segment.compactTitle}</span>
                            <strong>{formatNumber(segment.expectedValue)}</strong>
                          </summary>
                          <div className="mobile-buff-zone-details">
                            <p><span>来源</span><b>{segment.sourceKind === 'buff-extra-hit' ? '额外 Hit' : '异常伤害'}</b></p>
                            <p><span>元素 / 类型</span><b>{segment.elementText}{segment.skillTypeText ? ` · ${segment.skillTypeText}` : ''}</b></p>
                            <p><span>基础倍率</span><b>{segment.baseMultiplierText}</b></p>
                            <p><span>最终倍率</span><b>{segment.multiplierText}</b></p>
                            <p><span>暴击 / 非暴</span><b>{segment.critText} / {segment.nonCritText}</b></p>
                            <p className="mobile-buff-special-formula-line"><span>公式</span><b>{segment.formulaText}</b></p>
                          </div>
                        </details>
                      ))}
                    </div>
                  </section>
                ) : null}
              </>
            ) : <p className="mobile-buff-empty">当前还没有可用计算结果。</p>}
          </section>
        </div>
      </div>

      <footer className="mobile-buff-editor-footer">
        <span className="mobile-buff-page-indicator" aria-label={`第 ${activePage + 1} 页，共 3 页`}>
          {[0, 1, 2].map((page) => <i key={page} className={activePage === page ? 'is-active' : ''} />)}
        </span>
        <span>左右滑动切换 · 修改自动保留</span>
      </footer>

      {catalogOpen ? (
        <MobileBuffCatalogSheet
          action={action}
          catalogBuffs={catalogBuffs}
          operators={operators}
          operatorSnapshots={operatorSnapshots}
          onToggleBuff={toggleCatalogBuff}
          onActionChange={updateAction}
          onClose={() => setCatalogOpen(false)}
        />
      ) : null}
    </div>
  );
}

function getZoneDetails(hit: HitCalcResult, zoneKey: string): { value: string; lines: Array<{ label: string; value: string }> } {
  switch (zoneKey) {
    case 'attack':
      return {
        value: formatNumber(hit.panel.atk),
        lines: [
          { label: '最终攻击力', value: formatNumber(hit.panel.atk) },
          { label: '暴击率', value: formatPercent(hit.panel.critRate) },
          { label: '暴击伤害', value: formatPercent(hit.panel.critDmg) },
        ],
      };
    case 'multiplier':
      return {
        value: formatPercent(hit.multiplier.afterMultiply),
        lines: [
          { label: '基础倍率', value: formatPercent(hit.multiplier.base) },
          { label: '加法后', value: formatPercent(hit.multiplier.afterBonus) },
          { label: '乘法后', value: formatPercent(hit.multiplier.afterMultiply) },
        ],
      };
    case 'crit':
      return {
        value: formatNumber(hit.expected.final),
        lines: [
          { label: '暴击结果', value: formatNumber(hit.crit.final) },
          { label: '非暴击结果', value: formatNumber(hit.nonCrit.final) },
          { label: '期望结果', value: formatNumber(hit.expected.final) },
        ],
      };
    case 'damageBonus':
      return {
        value: hit.zones.damageBonusRate.toFixed(3),
        lines: [
          { label: '元素伤害加成', value: formatPercent(hit.zones.elementBonus) },
          { label: '技能伤害加成', value: formatPercent(hit.zones.skillBonus) },
          { label: '全伤害加成', value: formatPercent(hit.zones.allDamageBonus) },
          { label: '加成区系数', value: hit.zones.damageBonusRate.toFixed(3) },
        ],
      };
    case 'defense':
      return { value: hit.zones.defenseZone.toFixed(3), lines: [{ label: '防御区系数', value: hit.zones.defenseZone.toFixed(3) }] };
    case 'resistance':
      return {
        value: hit.zones.resistanceZone.toFixed(3),
        lines: [
          { label: '有效抗性', value: formatNumber(hit.zones.resistance.effectiveResistance, 1) },
          { label: '降抗', value: formatNumber(hit.zones.resistance.corrosion, 1) },
          { label: '无视抗性', value: formatNumber(hit.zones.resistance.resistanceIgnore, 1) },
          { label: '抗性区系数', value: hit.zones.resistanceZone.toFixed(3) },
        ],
      };
    case 'amplify':
      return { value: (1 + hit.zones.amplifyRate).toFixed(3), lines: [{ label: '增幅区系数', value: (1 + hit.zones.amplifyRate).toFixed(3) }] };
    case 'fragile':
      return { value: (1 + hit.zones.fragileRate).toFixed(3), lines: [{ label: '易伤区系数', value: (1 + hit.zones.fragileRate).toFixed(3) }] };
    case 'vulnerability':
      return { value: (1 + hit.zones.vulnerabilityRate).toFixed(3), lines: [{ label: '脆弱区系数', value: (1 + hit.zones.vulnerabilityRate).toFixed(3) }] };
    case 'combo':
      return { value: (1 + hit.zones.comboDamageBonus).toFixed(3), lines: [{ label: '连击区系数', value: (1 + hit.zones.comboDamageBonus).toFixed(3) }] };
    case 'imbalance':
      return { value: (1 + hit.zones.imbalanceDamageBonus).toFixed(3), lines: [{ label: '失衡区系数', value: (1 + hit.zones.imbalanceDamageBonus).toFixed(3) }] };
    default:
      return { value: '—', lines: [] };
  }
}

function getSpecialZoneDetails(
  segment: AnomalyDamageSegmentView,
  zoneKey: string,
): { value: string; lines: Array<{ label: string; value: string }> } {
  switch (zoneKey) {
    case 'attack':
      return {
        value: segment.panelAtkText,
        lines: [
          { label: '最终攻击力', value: segment.panelAtkText },
          { label: '暴击率', value: segment.critRateText },
          { label: '暴击伤害', value: segment.critDmgText },
          ...(segment.sourceKind === 'anomaly' ? [
            { label: '源石技艺强度', value: segment.sourceSkillBoostText },
            { label: '等级系数区', value: segment.levelCoefficientText },
            { label: '源石技艺', value: segment.sourceSkillZoneText },
          ] : []),
        ],
      };
    case 'multiplier':
      return {
        value: segment.multiplierText,
        lines: [
          { label: '基础倍率', value: segment.baseMultiplierText },
          { label: '最终倍率', value: segment.multiplierText },
          { label: '倍率计算', value: segment.multiplierFormulaText },
        ],
      };
    case 'crit':
      return {
        value: segment.expectedText,
        lines: [
          { label: '暴击结果', value: segment.critText },
          { label: '非暴击结果', value: segment.nonCritText },
          { label: '期望结果', value: segment.expectedText },
        ],
      };
    case 'damageBonus':
      return {
        value: segment.damageBonusRateText,
        lines: [
          { label: '元素伤害加成', value: segment.elementBonusText },
          { label: '技能伤害加成', value: segment.skillBonusText },
          { label: '全伤害加成', value: segment.allDamageBonusText },
          { label: '加成区系数', value: segment.damageBonusRateText },
        ],
      };
    case 'defense':
      return { value: segment.defenseZoneText, lines: [{ label: '防御区系数', value: segment.defenseZoneText }] };
    case 'resistance':
      return {
        value: segment.resistanceZoneText,
        lines: [
          { label: '目标基础抗性', value: segment.resistanceBaseText },
          { label: '降抗', value: segment.corrosionText },
          { label: '无视抗性', value: segment.resistanceIgnoreText },
          { label: '抗性区系数', value: segment.resistanceZoneText },
          { label: '抗性计算', value: segment.resistanceFormulaText },
        ],
      };
    case 'amplify':
      return { value: segment.amplifyFormulaText, lines: [{ label: '增幅区计算', value: segment.amplifyFormulaText }] };
    case 'fragile':
      return { value: segment.fragileFormulaText, lines: [{ label: '易伤区计算', value: segment.fragileFormulaText }] };
    case 'vulnerability':
      return { value: segment.vulnerabilityFormulaText, lines: [{ label: '脆弱区计算', value: segment.vulnerabilityFormulaText }] };
    case 'combo':
      return { value: segment.comboDamageBonusText, lines: [{ label: '连击区计算', value: segment.comboFormulaText }] };
    case 'imbalance':
      return { value: segment.imbalanceDamageBonusText, lines: [
        { label: '失衡区计算', value: segment.imbalanceFormulaText },
        ...(segment.imbalanceText ? [{ label: '本段失衡值', value: segment.imbalanceText }] : []),
      ] };
    case 'result':
      return {
        value: segment.nonCritText,
        lines: [
          { label: '倍率公式', value: segment.formulaText },
          { label: '非暴击全链路', value: segment.nonCritFormulaText },
          { label: '期望伤害', value: segment.expectedText },
          { label: '暴击伤害', value: segment.critText },
          { label: '非暴击伤害', value: segment.nonCritText },
        ],
      };
    default:
      return { value: '—', lines: [] };
  }
}

function formatAppliedBuffTag(buff: AppliedBuffTagViewModel): string {
  const stackText = buff.isCountable && typeof buff.stackCount === 'number' ? ` · ${buff.stackCount}层` : '';
  if (buff.isMultiplier) {
    return `× ${finite(buff.multiplierCoefficient, 1).toFixed(3)}${stackText}`;
  }
  const value = typeof buff.effectiveValue === 'number' ? buff.effectiveValue : buff.value;
  if (typeof value === 'number') {
    const valueText = FLAT_APPLIED_BUFF_TYPES.has(buff.type || '')
      ? Number(value.toFixed(3)).toString()
      : `${(value * 100).toFixed(1)}%`;
    return `${value >= 0 ? '+' : ''}${valueText}${stackText}`;
  }
  return buff.type || `已生效${stackText}`;
}

function getZoneContributions(hit: HitCalcResult, zoneKey: string, buffs: SkillButtonBuff[]) {
  const contributions = hit.buffContributions ?? [];
  const zoneMap: Record<string, string> = {
    damageBonus: 'damageBonus',
    resistance: 'resistance',
    amplify: 'amplify',
    fragile: 'fragile',
    vulnerability: 'vulnerability',
    multiplier: 'skillMultiplier',
    combo: 'combo',
    imbalance: 'imbalance',
  };
  const mappedZone = zoneMap[zoneKey];
  if (!mappedZone) return [];
  return contributions.filter((contribution) => {
    if (contribution.zone === mappedZone) return true;
    const buff = buffs.find((candidate) => candidate.id === contribution.buffId);
    return zoneKey === 'resistance' && Boolean(buff?.type?.toLocaleLowerCase().includes('resistance'));
  });
}

function formatContribution(contribution: NonNullable<HitCalcResult['buffContributions']>[number]): string {
  if (contribution.multiplier) return `× ${finite(contribution.multiplierCoefficient, 1).toFixed(3)}`;
  return `+ ${formatNumber(contribution.effectiveValue, 3)}`;
}

export default MobileBuffEditor;
