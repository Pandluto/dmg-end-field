import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { HitResistanceInput, SkillButtonBuff } from '../../types/storage';
import type { HitCalcResult, SkillDamageCalcResultV2 } from '../../core/calculators/skillDamage.types';
import type { MobileSlotCalculation, MobileTimelineAction } from '../model';
import './MobileBuffEditor.css';

export interface MobileBuffEditorProps {
  action: MobileTimelineAction;
  calculation?: MobileSlotCalculation | null;
  result?: SkillDamageCalcResultV2 | null;
  /** Online catalog Buffs are read-only candidates; selected copies live on the action. */
  catalogBuffs?: SkillButtonBuff[];
  characterName?: string;
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

function fuzzyScore(buff: SkillButtonBuff, keyword: string): number {
  if (!keyword) return 0;
  const haystack = [buff.displayName, buff.name, buff.sourceName, buff.source, buff.type, buff.description]
    .filter(Boolean)
    .join(' ')
    .toLocaleLowerCase();
  const normalized = keyword.toLocaleLowerCase().trim();
  if (!normalized) return 0;
  if (haystack.includes(normalized)) return 0;
  let cursor = 0;
  let gaps = 0;
  for (const character of normalized) {
    const index = haystack.indexOf(character, cursor);
    if (index < 0) return Number.POSITIVE_INFINITY;
    gaps += index - cursor;
    cursor = index + 1;
  }
  return gaps + haystack.length / 1000;
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
  onActionChange,
  onClose,
  onInteractionLockChange,
}: MobileBuffEditorProps) {
  const [activePage, setActivePage] = useState<EditorPage>(0);
  const [selectedHitKey, setSelectedHitKey] = useState<string | null>(null);
  const [searchKeyword, setSearchKeyword] = useState('');
  const pagerPointerRef = useRef<{ pointerId: number; startX: number; startY: number; horizontal: boolean } | null>(null);
  const safeResult = calculation?.result ?? result ?? null;
  const buffs = action.buffs ?? [];
  const hits = safeResult?.hits ?? [];
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
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const availableBuffs = useMemo(() => {
    const selectedIds = new Set(buffs.map((buff) => buff.id));
    return catalogBuffs
      .filter((buff) => !selectedIds.has(buff.id))
      .map((buff, index) => ({ buff, index, score: fuzzyScore(buff, searchKeyword) }))
      .filter((entry) => Number.isFinite(entry.score))
      .sort((left, right) => left.score - right.score || left.index - right.index)
      .slice(0, searchKeyword.trim() ? 30 : 12)
      .map((entry) => entry.buff);
  }, [buffs, catalogBuffs, searchKeyword]);

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
    setSearchKeyword('');
  };

  const toggleGlobalBuff = (buffId: string) => {
    updateAction({
      ...action,
      globallyDisabledBuffIds: toggleId(action.globallyDisabledBuffIds, buffId),
    });
  };

  const activeHitBuffs = activeHit ? buffs.filter((buff) => isBuffApplicableToHit(buff, activeHit)) : [];
  const isCurrentHitDisabled = currentHitKey ? action.disabledHitKeys?.includes(currentHitKey) ?? false : false;
  const selectedBuffIds = new Set(buffs.map((buff) => buff.id));

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
              <span>{hits.length} 段</span>
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
                <h2>选择与添加 Buff</h2>
              </div>
              <span>{buffs.length} 个已选</span>
            </div>
            <label className="mobile-buff-search">
              <span aria-hidden="true">⌕</span>
              <input
                value={searchKeyword}
                onChange={(event) => setSearchKeyword(event.target.value)}
                placeholder="模糊搜索名称、类型或来源"
                aria-label="搜索 Buff"
              />
              {searchKeyword ? <button type="button" onClick={() => setSearchKeyword('')} aria-label="清除搜索">×</button> : null}
            </label>

            <section className="mobile-buff-panel" aria-labelledby="mobile-buff-selected-title">
              <div className="mobile-buff-panel-heading">
                <div>
                  <p className="mobile-buff-kicker">当前实例</p>
                  <h3 id="mobile-buff-selected-title">已选 Buff</h3>
                </div>
                <span>{buffs.length}</span>
              </div>
              {buffs.length === 0 ? <p className="mobile-buff-empty">还没有 Buff，使用下面的搜索结果添加。</p> : (
                <div className="mobile-buff-selected-list">
                  {buffs.map((buff) => {
                    const disabled = globallyDisabled.has(buff.id);
                    return (
                      <article key={buff.id} className={`mobile-buff-selected-row${disabled ? ' is-disabled' : ''}`}>
                        <button type="button" className="mobile-buff-selected-main" onClick={() => toggleGlobalBuff(buff.id)} aria-pressed={!disabled}>
                          <span className="mobile-buff-status-dot" aria-hidden="true" />
                          <span>
                            <strong>{getBuffLabel(buff)}</strong>
                            <small>{getBuffSource(buff)}{buff.type ? ` · ${buff.type}` : ''}</small>
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

            <section className="mobile-buff-panel mobile-buff-candidates" aria-labelledby="mobile-buff-candidate-title">
              <div className="mobile-buff-panel-heading">
                <div>
                  <p className="mobile-buff-kicker">线上目录</p>
                  <h3 id="mobile-buff-candidate-title">添加候选</h3>
                </div>
                <span>{selectedBuffIds.size > 0 ? '只显示未选' : '可添加'}</span>
              </div>
              {availableBuffs.length === 0 ? <p className="mobile-buff-empty">没有匹配的 Buff。</p> : (
                <div className="mobile-buff-candidate-list">
                  {availableBuffs.map((buff) => (
                    <button type="button" key={buff.id} className="mobile-buff-candidate-row" onClick={() => addBuff(buff)}>
                      <span>
                        <strong>{getBuffLabel(buff)}</strong>
                        <small>{getBuffSource(buff)}{buff.description ? ` · ${buff.description}` : ''}</small>
                      </span>
                      <b aria-hidden="true">＋</b>
                    </button>
                  ))}
                </div>
              )}
            </section>
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
                    <SummaryMetric label="Hit" value={`${hits.length} 段`} />
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
