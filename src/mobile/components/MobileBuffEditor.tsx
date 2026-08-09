import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { ConfigSnapshot } from '../../core/calculators/operatorPanelCalculator';
import type { HitResistanceInput, SkillButtonBuff } from '../../types/storage';
import type { Character } from '../../types';
import type { HitCalcResult, SkillDamageCalcResultV2 } from '../../core/calculators/skillDamage.types';
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
  const [selectedHitKey, setSelectedHitKey] = useState<string | null>(null);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const pagerPointerRef = useRef<{ pointerId: number; startX: number; startY: number; horizontal: boolean } | null>(null);
  const safeResult = calculation?.result ?? result ?? null;
  const buffs = action.buffs ?? [];
  const hits = safeResult?.hits ?? [];
  const specialSegments = calculation?.specialSegments ?? [];
  const activeHit = hits.find((hit) => hit.hit.key === selectedHitKey) ?? hits[0] ?? null;
  const currentHitKey = activeHit?.hit.key ?? null;
  const globallyDisabled = new Set(action.globallyDisabledBuffIds ?? []);
  const disabledForCurrentHit = new Set(currentHitKey ? action.disabledBuffIdsByHitKey?.[currentHitKey] ?? [] : []);

  useEffect(() => {
    onInteractionLockChange?.(true);
    return () => onInteractionLockChange?.(false);
  }, [onInteractionLockChange]);

  useEffect(() => {
    if (selectedHitKey && hits.some((hit) => hit.hit.key === selectedHitKey)) return;
    setSelectedHitKey(hits[0]?.hit.key ?? null);
  }, [hits, selectedHitKey]);

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

  const toggleCurrentHit = () => {
    if (!currentHitKey) return;
    updateAction({
      ...action,
      disabledHitKeys: toggleId(action.disabledHitKeys, currentHitKey),
    });
  };

  const toggleCurrentHitBuff = (buffId: string) => {
    if (!currentHitKey) return;
    updateAction(withHitDisabledBuffs(action, currentHitKey, buffId));
  };

  const removeBuff = (buffId: string) => {
    const nextByHit = Object.fromEntries(
      Object.entries(action.disabledBuffIdsByHitKey ?? {})
        .map(([hitKey, ids]) => [hitKey, ids.filter((id) => id !== buffId)]),
    );
    const nextStacksByHit = Object.fromEntries(
      Object.entries(action.buffStackCountsByHitKey ?? {})
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
    });
  };

  const addBuff = (buff: SkillButtonBuff) => {
    if (buffs.some((current) => current.id === buff.id)) return;
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

  const activeHitBuffs = activeHit ? buffs.filter((buff) => isBuffApplicableToHit(buff, activeHit)) : [];
  const isCurrentHitDisabled = currentHitKey ? action.disabledHitKeys?.includes(currentHitKey) ?? false : false;
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

  const toggleSpecialSegment = (segmentKey: string) => {
    updateAction({
      ...action,
      disabledHitKeys: toggleId(action.disabledHitKeys, segmentKey),
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
            {hits.length === 0 ? (
              <p className="mobile-buff-empty">当前技能没有可编辑的 Hit。</p>
            ) : (
              <>
                <div className="mobile-buff-hit-list" role="list" aria-label="Hit 列表">
                  {hits.map((hit) => {
                    const selected = hit.hit.key === currentHitKey;
                    const disabled = action.disabledHitKeys?.includes(hit.hit.key) ?? false;
                    return (
                      <button
                        key={hit.hit.key}
                        type="button"
                        className={`mobile-buff-hit-card${selected ? ' is-selected' : ''}${disabled ? ' is-disabled' : ''}`}
                        onClick={() => setSelectedHitKey(hit.hit.key)}
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
                      className={`mobile-buff-hit-card is-special${segment.isDisabled ? ' is-disabled' : ''}`}
                      onClick={() => toggleSpecialSegment(segment.key)}
                      aria-pressed={!segment.isDisabled}
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

                {activeHit ? (
                  <section className="mobile-buff-panel mobile-buff-hit-tuning" aria-label={`${activeHit.hit.displayName} 微调`}>
                    <div className="mobile-buff-panel-heading">
                      <div>
                        <p className="mobile-buff-kicker">当前 Hit</p>
                        <h3>{activeHit.hit.displayName}</h3>
                      </div>
                      <button type="button" className={`mobile-buff-toggle${isCurrentHitDisabled ? ' is-off' : ''}`} onClick={toggleCurrentHit} aria-pressed={!isCurrentHitDisabled}>
                        {isCurrentHitDisabled ? '启用 Hit' : '禁用 Hit'}
                      </button>
                    </div>
                    <div className="mobile-buff-summary-grid">
                      <SummaryMetric label="期望" value={formatNumber(activeHit.expected.final)} />
                      <SummaryMetric label="暴击" value={formatNumber(activeHit.crit.final)} />
                      <SummaryMetric label="非暴" value={formatNumber(activeHit.nonCrit.final)} />
                    </div>
                    <div className="mobile-buff-tuning-list">
                      <p>本段 Buff</p>
                      {activeHitBuffs.length === 0 ? <span className="mobile-buff-muted-line">没有匹配到作用于本段的 Buff。</span> : activeHitBuffs.map((buff) => {
                        const hitDisabled = disabledForCurrentHit.has(buff.id);
                        const globalDisabled = globallyDisabled.has(buff.id);
                        const countable = isCountable(buff);
                        return (
                          <div key={buff.id} className={`mobile-buff-tuning-row${hitDisabled || globalDisabled ? ' is-disabled' : ''}`}>
                            <button type="button" className="mobile-buff-tuning-name" onClick={() => toggleCurrentHitBuff(buff.id)} aria-pressed={!hitDisabled}>
                              <strong>{getBuffLabel(buff)}</strong>
                              <small>{globalDisabled ? 'Buff 页已停用' : hitDisabled ? '本段已停用' : getBuffSource(buff)}</small>
                            </button>
                            {countable ? (
                              <StackControl
                                value={getEffectiveStack(action, buff, currentHitKey ?? undefined)}
                                max={getMaxStacks(buff)}
                                onChange={(value) => currentHitKey && updateAction(withHitStack(action, currentHitKey, buff, value))}
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
                <i>异常 / 燃烧 / 导弹</i>
              </span>
            </button>

            <section className="mobile-buff-panel" aria-labelledby="mobile-buff-selected-title">
              <div className="mobile-buff-panel-heading">
                <div>
                  <p className="mobile-buff-kicker">当前实例</p>
                  <h3 id="mobile-buff-selected-title">已选 Buff</h3>
                </div>
                <span>{buffs.length}</span>
              </div>
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
                            <small>{getMobileBuffSourceLabel(buff)} · {getBuffSource(buff)}{buff.type ? ` · ${buff.type}` : ''}</small>
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
            </section>

            <section className="mobile-buff-panel mobile-buff-special-configs" aria-labelledby="mobile-buff-special-title">
              <div className="mobile-buff-panel-heading">
                <div>
                  <p className="mobile-buff-kicker">SPECIAL EFFECTS</p>
                  <h3 id="mobile-buff-special-title">异常与状态</h3>
                </div>
                <span>{specialConfigCount}</span>
              </div>
              {specialConfigCount === 0 ? <p className="mobile-buff-empty">尚未挂载异常伤害、异常状态或状态区效果。</p> : (
                <div className="mobile-buff-special-config-list">
                  {(action.anomalyDamages ?? []).map((card) => (
                    <article key={card.id} className="mobile-buff-special-config-row">
                      <span className="mobile-buff-special-kind">异常伤害</span>
                      <span>
                        <strong>{card.primaryText}</strong>
                        <small>{[card.secondaryText, card.tertiaryText].filter(Boolean).join(' · ')}</small>
                      </span>
                      <button type="button" className="mobile-buff-remove" onClick={() => removeAnomalyCard('damage', card.id)} aria-label={`移除 ${card.primaryText}`}>×</button>
                    </article>
                  ))}
                  {(action.anomalyStateSnapshots ?? []).map((snapshot) => (
                    <article key={snapshot.id} className="mobile-buff-special-config-row">
                      <span className="mobile-buff-special-kind is-state">异常状态</span>
                      <span>
                        <strong>{snapshot.primaryText}</strong>
                        <small>{[snapshot.secondaryText, snapshot.tertiaryText].filter(Boolean).join(' · ')}</small>
                      </span>
                      <button type="button" className="mobile-buff-remove" onClick={() => removeAnomalyStateSnapshot(snapshot.id)} aria-label={`移除 ${snapshot.primaryText}`}>×</button>
                    </article>
                  ))}
                  {(action.anomalyStatuses ?? []).map((card) => (
                    <article key={card.id} className="mobile-buff-special-config-row">
                      <span className="mobile-buff-special-kind is-zone">状态区</span>
                      <span>
                        <strong>{card.primaryText}</strong>
                        <small>{[card.secondaryText, card.tertiaryText].filter(Boolean).join(' · ')}</small>
                      </span>
                      <button type="button" className="mobile-buff-remove" onClick={() => removeAnomalyCard('state', card.id)} aria-label={`移除 ${card.primaryText}`}>×</button>
                    </article>
                  ))}
                </div>
              )}
            </section>

            {specialSegments.length > 0 ? (
              <section className="mobile-buff-panel mobile-buff-special-damage" aria-labelledby="mobile-buff-special-damage-title">
                <div className="mobile-buff-panel-heading">
                  <div>
                    <p className="mobile-buff-kicker">EXTRA DAMAGE</p>
                    <h3 id="mobile-buff-special-damage-title">特殊伤害段</h3>
                  </div>
                  <span>{specialSegments.length}</span>
                </div>
                <div className="mobile-buff-special-damage-list">
                  {specialSegments.map((segment) => (
                    <button
                      type="button"
                      key={segment.key}
                      className={segment.isDisabled ? 'is-disabled' : ''}
                      onClick={() => toggleSpecialSegment(segment.key)}
                      aria-pressed={!segment.isDisabled}
                    >
                      <span className="mobile-buff-special-damage-index">{segment.sourceKind === 'buff-extra-hit' ? 'HIT' : 'EX'}</span>
                      <span>
                        <strong>{segment.compactTitle}</strong>
                        <small>{segment.elementText} · {segment.baseMultiplierText} · {segment.isDisabled ? '已停用' : segment.buffText}</small>
                      </span>
                      <b>{formatNumber(segment.expectedValue)}</b>
                    </button>
                  ))}
                </div>
              </section>
            ) : null}
          </section>

          <section className="mobile-buff-page mobile-buff-calculation-page" aria-label="计算过程与目标抗性">
            <div className="mobile-buff-page-heading">
              <div>
                <p className="mobile-buff-kicker">03 / CALCULATION</p>
                <h2>计算过程与抗性</h2>
              </div>
              <span>{activeHit ? activeHit.hit.displayName : '—'}</span>
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
                  <>
                    <section className="mobile-buff-panel" aria-labelledby="mobile-buff-zone-title">
                      <div className="mobile-buff-panel-heading">
                        <div>
                          <p className="mobile-buff-kicker">当前 Hit</p>
                          <h3 id="mobile-buff-zone-title">乘区计算</h3>
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
                                {getZoneContributions(activeHit, zone.key, buffs).length > 0 ? (
                                  <div className="mobile-buff-contribution-list">
                                    <small>作用于本区的 Buff</small>
                                    {getZoneContributions(activeHit, zone.key, buffs).map((contribution) => (
                                      <p key={`${zone.key}-${contribution.buffId}`}><span>{getBuffLabel(buffs.find((buff) => buff.id === contribution.buffId) ?? ({ id: contribution.buffId, name: contribution.buffId, displayName: contribution.buffId, sourceName: '', refCount: 0 } as SkillButtonBuff))}</span><b>{formatContribution(contribution)}</b></p>
                                    ))}
                                  </div>
                                ) : null}
                              </div>
                            </details>
                          );
                        })}
                      </div>
                    </section>

                    <section className="mobile-buff-panel mobile-buff-resistance-panel" aria-labelledby="mobile-buff-resistance-title">
                      <div className="mobile-buff-panel-heading">
                        <div>
                          <p className="mobile-buff-kicker">目标设置</p>
                          <h3 id="mobile-buff-resistance-title">目标抗性</h3>
                        </div>
                        <span>{formatNumber(activeHit.zones.resistance.effectiveResistance, 1)} 有效</span>
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
                      <p className="mobile-buff-formula">{activeHit.zones.resistance.formulaText}</p>
                    </section>
                  </>
                ) : <p className="mobile-buff-empty">选择一个 Hit 后查看乘区计算。</p>}

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
                            <p><span>来源</span><b>{segment.sourceKind === 'buff-extra-hit' ? '导弹 / 额外 Hit' : '异常伤害'}</b></p>
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
          onAddBuff={addBuff}
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
