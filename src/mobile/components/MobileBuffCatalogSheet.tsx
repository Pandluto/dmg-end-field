import { useMemo, useState } from 'react';
import type { ConfigSnapshot } from '../../core/calculators/operatorPanelCalculator';
import type { Character } from '../../types';
import type { SkillButtonBuff } from '../../types/storage';
import type { MobileTimelineAction } from '../model';
import {
  MOBILE_ANOMALY_GROUPS,
  MOBILE_ANOMALY_STATE_OPTIONS,
  MOBILE_BUFF_CATALOG_MODES,
  MOBILE_FIXED_STATE_OPTIONS,
  MOBILE_OPERATOR_BUFF_GROUPS,
  buildMobileAnomalyCard,
  buildMobileAnomalyStateSnapshot,
  filterMobileBuffCandidates,
  getMobileAnomalyDurationOptions,
  getMobileAnomalyStateDurationOptions,
  getMobileBuffSourceLabel,
  type MobileAnomalyCategory,
  type MobileAnomalyOption,
  type MobileAnomalyStateOption,
  type MobileBuffCatalogMode,
  type MobileBurnDamageMode,
  type MobileOperatorBuffGroup,
} from '../mobileBuffWorkbench';
import { MobilePortal } from './MobilePortal';
import './MobileBuffCatalogSheet.css';

interface MobileBuffCatalogSheetProps {
  action: MobileTimelineAction;
  catalogBuffs: SkillButtonBuff[];
  operators: Character[];
  operatorSnapshots: Record<string, ConfigSnapshot>;
  onToggleBuff: (buff: SkillButtonBuff) => void;
  onActionChange: (nextAction: MobileTimelineAction) => void;
  onClose: () => void;
}

const ANOMALY_HINTS: Record<string, string> = {
  conductive: '电磁异常伤害 / 法术易伤状态',
  corrosion: '自然异常伤害 / 持续全属性降抗',
  burn: '灼热初始段与持续段可分别计算',
  freeze: '寒冷异常伤害，可配置冻结时长',
  'shatter-ice': '碎冰造成物理异常伤害',
  'magic-burst': '固定 160% 的法术爆发伤害',
  knockdown: '固定倍率的倒地物理伤害',
  launch: '固定倍率的击飞物理伤害',
  'armor-break': '碎甲伤害 / 物理易伤状态',
  smash: '随异常等级提升的猛击伤害',
  'combo-state': '战技与终结技使用独立连击区',
  'imbalance-state': '固定提供 30% 失衡伤害区',
};

function getModeTitle(mode: MobileBuffCatalogMode): string {
  return MOBILE_BUFF_CATALOG_MODES.find((item) => item.key === mode)?.label ?? 'Buff 组';
}

function getBuffMeta(buff: SkillButtonBuff): string {
  if (buff.effectKind === 'extraHit' && buff.extraHitConfig) {
    const { damageType, skillType, baseMultiplier, imbalanceValue, cooldownSeconds } = buff.extraHitConfig;
    return `${damageType} · ${skillType || '独立'} · ${(baseMultiplier * 100).toFixed(0)}% · 失衡 ${imbalanceValue} · CD ${cooldownSeconds}s`;
  }
  return [buff.sourceName, buff.type, buff.level].filter(Boolean).join(' · ');
}

function ChoiceRail({
  values,
  value,
  onChange,
  ariaLabel,
}: {
  values: Array<{ value: string | number; label: string }>;
  value: string | number;
  onChange: (value: string) => void;
  ariaLabel: string;
}) {
  return (
    <div className="mobile-buff-sheet-choice-rail" aria-label={ariaLabel}>
      {values.map((item) => (
        <button
          key={item.value}
          type="button"
          className={value === item.value ? 'is-active' : ''}
          onClick={() => onChange(String(item.value))}
          aria-pressed={value === item.value}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

interface ManagedSpecialItem {
  id: string;
  kind: string;
  title: string;
  detail: string;
  tone?: 'damage' | 'state' | 'zone';
}

function SpecialOptionCard({
  title,
  status,
  description,
  active,
  selected,
  onSelect,
  onRemove,
}: {
  title: string;
  status: string;
  description: string;
  active: boolean;
  selected: boolean;
  onSelect: () => void;
  onRemove?: () => void;
}) {
  return (
    <article className={`${active ? 'is-active' : ''}${selected ? ' is-selected' : ''}`}>
      <button
        type="button"
        className="mobile-buff-sheet-option-main"
        onClick={onSelect}
        aria-pressed={active}
      >
        <span>{selected ? `✓ ${status}` : status}</span>
        <strong>{title}</strong>
        <small>{description}</small>
      </button>
      {selected && onRemove ? (
        <button
          type="button"
          className="mobile-buff-sheet-option-remove"
          onClick={onRemove}
          aria-label={`取消挂载 ${title}`}
        >
          ×
        </button>
      ) : null}
    </article>
  );
}

function ManagedSpecialBoard({
  title,
  description,
  emptyText,
  items,
  onSelect,
  onRemove,
}: {
  title: string;
  description: string;
  emptyText: string;
  items: ManagedSpecialItem[];
  onSelect: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <details className="mobile-buff-sheet-managed">
      <summary className="mobile-buff-sheet-managed-heading">
        <span><small>当前生效</small><strong>{title}</strong></span>
        <b>{items.length}</b>
      </summary>
      <div className="mobile-buff-sheet-managed-content">
        <p>{description}</p>
        {items.length === 0 ? <div className="mobile-buff-sheet-managed-empty">{emptyText}</div> : (
          <div className="mobile-buff-sheet-managed-list">
            {items.map((item) => (
              <article key={item.id} className="mobile-buff-sheet-managed-row">
                <span className={`mobile-buff-sheet-managed-kind is-${item.tone ?? 'state'}`}>{item.kind}</span>
                <button type="button" className="mobile-buff-sheet-managed-copy" onClick={() => onSelect(item.id)}>
                  <strong>{item.title}</strong>
                  <small>{item.detail || '点此载入并调整参数'}</small>
                </button>
                <button type="button" className="mobile-buff-sheet-managed-remove" onClick={() => onRemove(item.id)} aria-label={`删除 ${item.title}`}>删除</button>
              </article>
            ))}
          </div>
        )}
      </div>
    </details>
  );
}

export function MobileBuffCatalogSheet({
  action,
  catalogBuffs,
  operators,
  operatorSnapshots,
  onToggleBuff,
  onActionChange,
  onClose,
}: MobileBuffCatalogSheetProps) {
  const [activeMode, setActiveMode] = useState<MobileBuffCatalogMode>('operator');
  const [characterFilter, setCharacterFilter] = useState<string | null>(action.operatorId || null);
  const [operatorBuffGroup, setOperatorBuffGroup] = useState<MobileOperatorBuffGroup | null>(null);
  const [anomalyCategory, setAnomalyCategory] = useState<MobileAnomalyCategory>('magic');
  const [activeAnomalyKey, setActiveAnomalyKey] = useState('burn');
  const [anomalyLevel, setAnomalyLevel] = useState(1);
  const [anomalyDuration, setAnomalyDuration] = useState(10);
  const [burnDamageMode, setBurnDamageMode] = useState<MobileBurnDamageMode>('dotOnly');
  const [activeStateKey, setActiveStateKey] = useState('combo-state');
  const [stateLevel, setStateLevel] = useState(1);
  const [stateSourceId, setStateSourceId] = useState(action.operatorId || operators[0]?.id || '');
  const [activeAnomalyStateKey, setActiveAnomalyStateKey] = useState<MobileAnomalyStateOption['key']>('conductive');
  const [anomalyStateLevel, setAnomalyStateLevel] = useState(1);
  const [anomalyStateDuration, setAnomalyStateDuration] = useState(0);
  const [anomalyStateSourceId, setAnomalyStateSourceId] = useState(action.operatorId || operators[0]?.id || '');

  const selectedBuffIds = useMemo(() => new Set((action.buffs ?? []).map((buff) => buff.id)), [action.buffs]);
  const potentialCounts = useMemo(() => Object.fromEntries(
    Object.entries(operatorSnapshots).map(([characterId, snapshot]) => [characterId, snapshot.operator.potentialCount]),
  ), [operatorSnapshots]);
  const candidates = useMemo(() => filterMobileBuffCandidates({
    buffs: catalogBuffs,
    mode: activeMode,
    characterId: characterFilter,
    operatorBuffGroup,
    potentialCounts,
  }), [activeMode, catalogBuffs, characterFilter, operatorBuffGroup, potentialCounts]);
  const activeAnomaly = MOBILE_ANOMALY_GROUPS
    .flatMap((group) => group.items)
    .find((option) => option.key === activeAnomalyKey) ?? null;
  const activeFixedState = MOBILE_FIXED_STATE_OPTIONS.find((option) => option.key === activeStateKey) ?? MOBILE_FIXED_STATE_OPTIONS[0];
  const activeAnomalyState = MOBILE_ANOMALY_STATE_OPTIONS.find((option) => option.key === activeAnomalyStateKey) ?? MOBILE_ANOMALY_STATE_OPTIONS[0];
  const selectedAnomalyKeys = new Set((action.anomalyDamages ?? []).map((card) => card.key));
  const selectedStateKeys = new Set((action.anomalyStatuses ?? []).map((card) => card.key));
  const selectedAnomalyStateKeys = new Set((action.anomalyStateSnapshots ?? []).map((snapshot) => snapshot.key));

  const changeMode = (mode: MobileBuffCatalogMode) => {
    setActiveMode(mode);
  };

  const selectAnomaly = (option: MobileAnomalyOption) => {
    const existing = (action.anomalyDamages ?? []).find((card) => card.key === option.key);
    setActiveAnomalyKey(option.key);
    setAnomalyLevel(existing?.level ?? option.levelOptions[0] ?? 1);
    setAnomalyDuration(existing?.durationSeconds ?? getMobileAnomalyDurationOptions(option)[0] ?? 0);
    setBurnDamageMode(existing?.burnDamageMode ?? (option.key === 'burn' ? 'dotOnly' : 'initialOnly'));
  };

  const selectAnomalyState = (option: MobileAnomalyStateOption) => {
    const existing = (action.anomalyStateSnapshots ?? []).find((snapshot) => snapshot.key === option.key);
    setActiveAnomalyStateKey(option.key);
    setAnomalyStateLevel(existing?.level ?? 1);
    setAnomalyStateDuration(existing?.durationSeconds ?? getMobileAnomalyStateDurationOptions(option)[0] ?? 0);
    if (existing?.sourceCharacterId) setAnomalyStateSourceId(existing.sourceCharacterId);
  };

  const selectFixedState = (option: MobileAnomalyOption) => {
    const existing = (action.anomalyStatuses ?? []).find((card) => card.key === option.key);
    setActiveStateKey(option.key);
    setStateLevel(existing?.level ?? option.levelOptions[0] ?? 1);
    if (existing?.sourceCharacterId) setStateSourceId(existing.sourceCharacterId);
  };

  const applyAnomaly = () => {
    if (!activeAnomaly) return;
    const nextCard = buildMobileAnomalyCard({
      option: activeAnomaly,
      level: anomalyLevel,
      durationSeconds: anomalyDuration,
      burnDamageMode,
    });
    onActionChange({
      ...action,
      anomalyDamages: [
        ...(action.anomalyDamages ?? []).filter((card) => card.key !== nextCard.key),
        nextCard,
      ],
    });
  };

  const applyFixedState = () => {
    const sourceCharacter = activeFixedState.key === 'combo-state'
      ? operators.find((operator) => operator.id === stateSourceId)
        ?? operators.find((operator) => operator.id === action.operatorId)
        ?? operators[0]
      : undefined;
    const nextCard = buildMobileAnomalyCard({
      option: activeFixedState,
      level: stateLevel,
      sourceCharacterId: sourceCharacter?.id,
      sourceName: sourceCharacter?.name,
    });
    onActionChange({
      ...action,
      anomalyStatuses: [
        ...(action.anomalyStatuses ?? []).filter((card) => card.key !== nextCard.key),
        nextCard,
      ],
    });
  };

  const applyAnomalyState = () => {
    const sourceCharacter = operators.find((operator) => operator.id === anomalyStateSourceId)
      ?? operators.find((operator) => operator.id === action.operatorId)
      ?? operators[0];
    if (!sourceCharacter) return;
    const nextSnapshot = buildMobileAnomalyStateSnapshot({
      option: activeAnomalyState,
      level: anomalyStateLevel,
      durationSeconds: anomalyStateDuration,
      sourceCharacter,
      sourceSnapshot: operatorSnapshots[sourceCharacter.id],
      sourceButtonId: action.id,
    });
    onActionChange({
      ...action,
      anomalyStateSnapshots: [
        ...(action.anomalyStateSnapshots ?? []).filter((snapshot) => snapshot.key !== nextSnapshot.key),
        nextSnapshot,
      ],
    });
  };

  const removeAnomalyCard = (kind: 'damage' | 'state', cardId: string) => {
    onActionChange({
      ...action,
      ...(kind === 'damage'
        ? { anomalyDamages: (action.anomalyDamages ?? []).filter((card) => card.id !== cardId) }
        : { anomalyStatuses: (action.anomalyStatuses ?? []).filter((card) => card.id !== cardId) }),
    });
  };

  const removeAnomalyStateSnapshot = (snapshotId: number) => {
    onActionChange({
      ...action,
      anomalyStateSnapshots: (action.anomalyStateSnapshots ?? []).filter((snapshot) => snapshot.id !== snapshotId),
    });
  };

  const renderCharacterFilters = () => (
    <div className="mobile-buff-sheet-character-filters" aria-label="按干员筛选">
      <button
        type="button"
        className={!characterFilter ? 'is-active' : ''}
        onClick={() => setCharacterFilter(null)}
        aria-pressed={!characterFilter}
      >
        全部
      </button>
      {operators.map((operator) => (
        <button
          key={operator.id}
          type="button"
          className={characterFilter === operator.id ? 'is-active' : ''}
          onClick={() => setCharacterFilter((current) => current === operator.id ? null : operator.id)}
          aria-pressed={characterFilter === operator.id}
        >
          {operator.name}
        </button>
      ))}
    </div>
  );

  const renderBuffCatalog = () => (
    <>
      {activeMode !== 'buff-group' ? renderCharacterFilters() : null}
      {activeMode === 'operator' ? (
        <div className="mobile-buff-sheet-group-filters" aria-label="干员 Buff 分组">
          <button type="button" className={!operatorBuffGroup ? 'is-active' : ''} onClick={() => setOperatorBuffGroup(null)}>全部</button>
          {MOBILE_OPERATOR_BUFF_GROUPS.map((group) => (
            <button
              key={group.key}
              type="button"
              className={operatorBuffGroup === group.key ? 'is-active' : ''}
              onClick={() => setOperatorBuffGroup((current) => current === group.key ? null : group.key)}
            >
              {group.label}
            </button>
          ))}
        </div>
      ) : null}
      {activeMode === 'operator' && operatorBuffGroup === 'potential' ? (
        <p className="mobile-buff-sheet-filter-note">
          已按当前干员配置的潜能等级隐藏未解锁效果。
        </p>
      ) : null}
      <div className="mobile-buff-sheet-result-heading">
        <span>{getModeTitle(activeMode)}</span>
        <strong>{candidates.length} 项</strong>
      </div>
      {candidates.length === 0 ? (
        <div className="mobile-buff-sheet-empty">
          <strong>当前分类没有项目</strong>
          <span>可以切换干员或分组。</span>
        </div>
      ) : (
        <div className="mobile-buff-sheet-result-list">
          {candidates.map((buff) => {
            const isSelected = selectedBuffIds.has(buff.id);
            return (
              <button
                key={buff.id}
                type="button"
                className={`mobile-buff-sheet-result${isSelected ? ' is-selected' : ''}`}
                onClick={() => onToggleBuff(buff)}
                aria-pressed={isSelected}
              >
                <span className="mobile-buff-sheet-result-copy">
                  <span><b>{getMobileBuffSourceLabel(buff)}</b>{buff.effectKind === 'extraHit' ? <i>额外伤害</i> : null}</span>
                  <strong>{buff.displayName || buff.name}</strong>
                  <small>{getBuffMeta(buff) || buff.description || '在线 Buff 目录'}</small>
                </span>
                <span className="mobile-buff-sheet-add" aria-hidden="true">{isSelected ? '✓' : '＋'}</span>
              </button>
            );
          })}
        </div>
      )}
    </>
  );

  const renderAnomalyDamage = () => {
    const group = MOBILE_ANOMALY_GROUPS.find((item) => item.key === anomalyCategory) ?? MOBILE_ANOMALY_GROUPS[0];
    const durationOptions = activeAnomaly ? getMobileAnomalyDurationOptions(activeAnomaly) : [];
    return (
      <>
        <ManagedSpecialBoard
          title="已挂载异常伤害"
          description="异常伤害会生成独立伤害段。点条目可继续调整，或直接删除。"
          emptyText="当前没有异常伤害段。"
          items={(action.anomalyDamages ?? []).map((card) => ({
            id: card.id,
            kind: '异常伤害',
            title: card.primaryText,
            detail: [card.secondaryText, card.tertiaryText].filter(Boolean).join(' · '),
            tone: 'damage',
          }))}
          onSelect={(id) => {
            const card = (action.anomalyDamages ?? []).find((item) => item.id === id);
            const option = MOBILE_ANOMALY_GROUPS.flatMap((item) => item.items).find((item) => item.key === card?.key);
            if (!option) return;
            setAnomalyCategory(option.category);
            selectAnomaly(option);
          }}
          onRemove={(id) => removeAnomalyCard('damage', id)}
        />
        <ChoiceRail
          values={MOBILE_ANOMALY_GROUPS.map((item) => ({ value: item.key, label: item.label }))}
          value={anomalyCategory}
          onChange={(value) => {
            const category = value as MobileAnomalyCategory;
            setAnomalyCategory(category);
            const option = MOBILE_ANOMALY_GROUPS.find((item) => item.key === category)?.items[0];
            if (option) selectAnomaly(option);
          }}
          ariaLabel="异常伤害分类"
        />
        <div className="mobile-buff-sheet-option-grid">
          {group.items.map((option) => {
            const mountedCard = (action.anomalyDamages ?? []).find((card) => card.key === option.key);
            return (
              <SpecialOptionCard
                key={option.key}
                title={option.label}
                status={mountedCard ? '已挂载' : option.category === 'magic' ? '法术' : '物理'}
                description={ANOMALY_HINTS[option.key]}
                active={activeAnomalyKey === option.key}
                selected={Boolean(mountedCard)}
                onSelect={() => selectAnomaly(option)}
                onRemove={mountedCard ? () => removeAnomalyCard('damage', mountedCard.id) : undefined}
              />
            );
          })}
        </div>
        {activeAnomaly ? (
          <section className="mobile-buff-sheet-config-card">
            <div className="mobile-buff-sheet-config-heading">
              <div><span>异常伤害设置</span><h3>{activeAnomaly.label}</h3></div>
              <b>{selectedAnomalyKeys.has(activeAnomaly.key) ? '更新现有' : '新建伤害段'}</b>
            </div>
            {activeAnomaly.usesAnomalyLevel !== false ? (
              <div className="mobile-buff-sheet-field">
                <span>异常等级</span>
                <ChoiceRail
                  values={activeAnomaly.levelOptions.map((level) => ({ value: level, label: `Lv${level}` }))}
                  value={anomalyLevel}
                  onChange={(value) => setAnomalyLevel(Number(value))}
                  ariaLabel="异常等级"
                />
              </div>
            ) : null}
            {durationOptions.length > 0 ? (
              <div className="mobile-buff-sheet-field">
                <span>{activeAnomaly.key === 'burn' ? '燃烧时长' : '持续时间'}</span>
                <ChoiceRail
                  values={durationOptions.map((seconds) => ({ value: seconds, label: `${seconds}s` }))}
                  value={anomalyDuration}
                  onChange={(value) => setAnomalyDuration(Number(value))}
                  ariaLabel="持续时间"
                />
              </div>
            ) : null}
            {activeAnomaly.supportsBurnMode ? (
              <div className="mobile-buff-sheet-field">
                <span>燃烧计入口径</span>
                <ChoiceRail
                  values={[
                    { value: 'initialOnly', label: '初始段' },
                    { value: 'dotOnly', label: '持续总伤' },
                    { value: 'splitDot', label: '逐秒拆分' },
                  ]}
                  value={burnDamageMode}
                  onChange={(value) => setBurnDamageMode(value as MobileBurnDamageMode)}
                  ariaLabel="燃烧计算模式"
                />
              </div>
            ) : null}
            <button type="button" className="mobile-buff-sheet-primary" onClick={applyAnomaly}>
              {selectedAnomalyKeys.has(activeAnomaly.key) ? '更新异常伤害' : '挂载异常伤害'}
            </button>
          </section>
        ) : null}
      </>
    );
  };

  const renderAnomalyState = () => {
    const durationOptions = getMobileAnomalyStateDurationOptions(activeAnomalyState);
    return (
      <>
        <ManagedSpecialBoard
          title="当前异常状态"
          description="导电、腐蚀与碎甲统一在这里管理；删除后会立即从当前技能实例移除。"
          emptyText="当前没有导电、腐蚀或碎甲状态。"
          items={(action.anomalyStateSnapshots ?? []).map((snapshot) => ({
            id: String(snapshot.id),
            kind: '异常状态',
            title: snapshot.primaryText,
            detail: [snapshot.secondaryText, snapshot.tertiaryText].filter(Boolean).join(' · '),
            tone: 'state',
          }))}
          onSelect={(id) => {
            const snapshot = (action.anomalyStateSnapshots ?? []).find((item) => item.id === Number(id));
            const option = MOBILE_ANOMALY_STATE_OPTIONS.find((item) => item.key === snapshot?.key);
            if (option) selectAnomalyState(option);
          }}
          onRemove={(id) => removeAnomalyStateSnapshot(Number(id))}
        />
        <div className="mobile-buff-sheet-option-grid is-three">
          {MOBILE_ANOMALY_STATE_OPTIONS.map((option) => {
            const mountedSnapshot = (action.anomalyStateSnapshots ?? []).find((snapshot) => snapshot.key === option.key);
            return (
              <SpecialOptionCard
                key={option.key}
                title={option.label}
                status={mountedSnapshot ? '已挂载' : '状态快照'}
                description={ANOMALY_HINTS[option.key]}
                active={activeAnomalyStateKey === option.key}
                selected={Boolean(mountedSnapshot)}
                onSelect={() => selectAnomalyState(option)}
                onRemove={mountedSnapshot ? () => removeAnomalyStateSnapshot(mountedSnapshot.id) : undefined}
              />
            );
          })}
        </div>
        <section className="mobile-buff-sheet-config-card">
          <div className="mobile-buff-sheet-config-heading">
            <div><span>异常状态设置</span><h3>{activeAnomalyState.label}</h3></div>
            <b>按源石技艺快照</b>
          </div>
          <div className="mobile-buff-sheet-field">
            <span>来源干员</span>
            <div className="mobile-buff-sheet-source-operators">
              {operators.map((operator) => (
                <button
                  key={operator.id}
                  type="button"
                  className={anomalyStateSourceId === operator.id ? 'is-active' : ''}
                  onClick={() => setAnomalyStateSourceId(operator.id)}
                >
                  <span><strong>{operator.name}</strong><small>源石技艺 {operatorSnapshots[operator.id]?.panel.display.sourceSkill ?? 0}</small></span>
                </button>
              ))}
            </div>
          </div>
          <div className="mobile-buff-sheet-field">
            <span>异常等级</span>
            <ChoiceRail
              values={activeAnomalyState.levelOptions.map((level) => ({ value: level, label: `Lv${level}` }))}
              value={anomalyStateLevel}
              onChange={(value) => setAnomalyStateLevel(Number(value))}
              ariaLabel="异常状态等级"
            />
          </div>
          {durationOptions.length > 0 ? (
            <div className="mobile-buff-sheet-field">
              <span>{activeAnomalyState.key === 'corrosion' ? '已持续时间' : '持续时间'}</span>
              <ChoiceRail
                values={durationOptions.map((seconds) => ({ value: seconds, label: `${seconds}s` }))}
                value={anomalyStateDuration}
                onChange={(value) => setAnomalyStateDuration(Number(value))}
                ariaLabel="异常状态持续时间"
              />
            </div>
          ) : null}
          <button type="button" className="mobile-buff-sheet-primary" onClick={applyAnomalyState}>
            {selectedAnomalyStateKeys.has(activeAnomalyState.key) ? '更新异常状态' : '挂载异常状态'}
          </button>
        </section>
      </>
    );
  };

  const renderFixedState = () => (
    <>
      <ManagedSpecialBoard
        title="已启用状态区"
        description="连击区与失衡区在这里集中管理，点条目载入参数，点删除立即停用。"
        emptyText="当前没有启用状态区效果。"
        items={(action.anomalyStatuses ?? []).map((card) => ({
          id: card.id,
          kind: '状态区',
          title: card.primaryText,
          detail: [card.secondaryText, card.tertiaryText].filter(Boolean).join(' · '),
          tone: 'zone',
        }))}
        onSelect={(id) => {
          const card = (action.anomalyStatuses ?? []).find((item) => item.id === id);
          const option = MOBILE_FIXED_STATE_OPTIONS.find((item) => item.key === card?.key);
          if (option) selectFixedState(option);
        }}
        onRemove={(id) => removeAnomalyCard('state', id)}
      />
      <div className="mobile-buff-sheet-option-grid is-two">
        {MOBILE_FIXED_STATE_OPTIONS.map((option) => {
          const mountedCard = (action.anomalyStatuses ?? []).find((card) => card.key === option.key);
          return (
            <SpecialOptionCard
              key={option.key}
              title={option.label}
              status={mountedCard ? '已启用' : '状态区'}
              description={ANOMALY_HINTS[option.key]}
              active={activeStateKey === option.key}
              selected={Boolean(mountedCard)}
              onSelect={() => selectFixedState(option)}
              onRemove={mountedCard ? () => removeAnomalyCard('state', mountedCard.id) : undefined}
            />
          );
        })}
      </div>
      <section className="mobile-buff-sheet-config-card">
        <div className="mobile-buff-sheet-config-heading">
          <div><span>状态区设置</span><h3>{activeFixedState.label}</h3></div>
          <b>独立乘区</b>
        </div>
        {activeFixedState.usesAnomalyLevel !== false ? (
          <div className="mobile-buff-sheet-field">
            <span>连击层数</span>
            <ChoiceRail
              values={activeFixedState.levelOptions.map((level) => ({ value: level, label: `${level} 层` }))}
              value={stateLevel}
              onChange={(value) => setStateLevel(Number(value))}
              ariaLabel="连击层数"
            />
          </div>
        ) : <p className="mobile-buff-sheet-static-copy">失衡状态固定进入独立失衡区，当前效果为 +30%。</p>}
        {activeFixedState.key === 'combo-state' ? (
          <div className="mobile-buff-sheet-field">
            <span>来源干员</span>
            <div className="mobile-buff-sheet-source-operators">
              {operators.map((operator) => (
                <button
                  key={operator.id}
                  type="button"
                  className={stateSourceId === operator.id ? 'is-active' : ''}
                  onClick={() => setStateSourceId(operator.id)}
                >
                  <span><strong>{operator.name}</strong></span>
                </button>
              ))}
            </div>
          </div>
        ) : null}
        <button type="button" className="mobile-buff-sheet-primary" onClick={applyFixedState}>
          {selectedStateKeys.has(activeFixedState.key) ? '更新状态区' : '启用状态区'}
        </button>
      </section>
    </>
  );

  return (
    <MobilePortal>
      <div className="mobile-buff-sheet-backdrop" role="presentation">
        <section
          className="mobile-buff-sheet"
          role="dialog"
          aria-modal="true"
          aria-labelledby="mobile-buff-sheet-title"
        >
          <header className="mobile-buff-sheet-header">
            <div>
              <p>BUFF WORKBENCH</p>
              <h2 id="mobile-buff-sheet-title">分类与特殊效果</h2>
            </div>
            <button type="button" onClick={onClose} aria-label="关闭 Buff 分类页面">完成</button>
          </header>

          <nav className="mobile-buff-sheet-tabs" aria-label="Buff 分类">
            {MOBILE_BUFF_CATALOG_MODES.map((mode) => (
              <button
                key={mode.key}
                type="button"
                className={activeMode === mode.key ? 'is-active' : ''}
                onClick={() => changeMode(mode.key)}
                aria-current={activeMode === mode.key ? 'page' : undefined}
              >
                <span>{mode.shortLabel}</span>
                {mode.key === 'anomaly' && (action.anomalyDamages?.length ?? 0) > 0 ? <i>{action.anomalyDamages?.length}</i> : null}
                {mode.key === 'anomaly-state' && (action.anomalyStateSnapshots?.length ?? 0) > 0 ? <i>{action.anomalyStateSnapshots?.length}</i> : null}
                {mode.key === 'state' && (action.anomalyStatuses?.length ?? 0) > 0 ? <i>{action.anomalyStatuses?.length}</i> : null}
              </button>
            ))}
          </nav>

          <div className="mobile-buff-sheet-body">
            {['buff-group', 'operator', 'weapon', 'equipment', 'extra-hit'].includes(activeMode)
              ? renderBuffCatalog()
              : activeMode === 'anomaly'
                ? renderAnomalyDamage()
                : activeMode === 'anomaly-state'
                  ? renderAnomalyState()
                  : renderFixedState()}
          </div>
        </section>
      </div>
    </MobilePortal>
  );
}

export default MobileBuffCatalogSheet;
