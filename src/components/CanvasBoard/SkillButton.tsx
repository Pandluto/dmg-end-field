import type { CSSProperties } from 'react';
import {
  SkillButton as SkillButtonType,
  SkillButtonSkillChangePayload,
  SkillButtonSkillOption,
  TimelineData,
} from '../../types';
import { getElementBackgroundColor, normalizeAssetUrl } from '../../utils/assetResolver';
import {
  getNormalHitSegmentKey,
  type BuffSourceSearchMode,
  BUFF_SOURCE_SEARCH_MODE_OPTIONS,
  getBuffSourceSearchModeLabel,
  buildAppliedBuffTags,
} from './skillButton.shared';
import {
  SkillButtonAnomalyPanel,
  SkillButtonAnomalyStatePanel,
  SkillButtonStatePanel,
} from './SkillButtonAnomalyPanels';
import { useSkillButtonAnomaly } from './useSkillButtonAnomaly';
import { TimelineSkillDetailWorkbench } from './TimelineSkillDetailWorkbench';
import { SkillButtonDamageModal } from './SkillButtonDamageModal';
import { useSkillButtonRuntime } from './useSkillButtonRuntime';
import { useSkillButtonDamageRuntime } from './useSkillButtonDamageRuntime';
import { useSkillButtonInteractions } from './useSkillButtonInteractions';
import { SkillButtonContextMenu } from './SkillButtonContextMenu';
import { SkillButtonInfoModal } from './SkillButtonInfoModal';
import { formatAnomalyStateSnapshotName, getBuffCategoryText } from './skillButtonFormatting';
import './SkillButton.css';

type BuffSearchMode = BuffSourceSearchMode | 'anomaly' | 'anomaly-state' | 'state';
type OperatorBuffGroupFilter = 'talent' | 'potential' | 'skill';

const BUFF_SEARCH_MODE_OPTIONS: Array<{ key: BuffSearchMode; label: string }> = [
  ...BUFF_SOURCE_SEARCH_MODE_OPTIONS,
  { key: 'anomaly', label: '异常伤害' },
  { key: 'anomaly-state', label: '异常状态区' },
  { key: 'state', label: '状态区' },
];

const SOURCE_BUFF_SEARCH_MODES = new Set<BuffSearchMode>(BUFF_SOURCE_SEARCH_MODE_OPTIONS.map((option) => option.key));
const OPERATOR_BUFF_GROUP_FILTERS: Array<{ key: OperatorBuffGroupFilter; label: string }> = [
  { key: 'talent', label: '天赋' },
  { key: 'potential', label: '潜能' },
  { key: 'skill', label: '技能' },
];

function isSourceBuffSearchMode(mode: BuffSearchMode): mode is BuffSourceSearchMode {
  return SOURCE_BUFF_SEARCH_MODES.has(mode);
}

function getBuffSearchModeLabel(mode: BuffSearchMode): string {
  if (isSourceBuffSearchMode(mode)) {
    return getBuffSourceSearchModeLabel(mode);
  }
  return BUFF_SEARCH_MODE_OPTIONS.find((option) => option.key === mode)?.label || 'Buff组';
}

interface SkillButtonProps {
  isDetailRouteActive?: boolean;
  button: SkillButtonType & { nodeNumber?: number };
  size: number;
  onMouseDown: (e: React.MouseEvent) => void;
  onContextMenu: (e: React.MouseEvent) => void;
  timelineData?: TimelineData;
  onModalOpen?: () => void;
  onModalClose?: () => void;
  contextMenuState?: { buttonId: string; position: { x: number; y: number } } | null;
  onConfirmRemove?: () => void;
  onCloseContextMenu?: () => void;
  onCopy?: () => void;
  onChangeSkillType?: (payload: SkillButtonSkillChangePayload) => void;
  skillChangeOptions?: SkillButtonSkillOption[];
  isBrowseMode?: boolean;
  isInspectMode?: boolean;
  isDragDisabled?: boolean;
  resistanceRevision?: number;
}

export function SkillButtonComponent({
  isDetailRouteActive = false,
  button,
  size,
  onMouseDown,
  onContextMenu,
  timelineData,
  onModalOpen,
  onModalClose,
  contextMenuState,
  onConfirmRemove,
  onCloseContextMenu,
  onCopy,
  onChangeSkillType,
  skillChangeOptions = [],
  isBrowseMode = false,
  isInspectMode = false,
  isDragDisabled = false,
  resistanceRevision = 0,
}: SkillButtonProps) {
  /**
   * position.y 语义约定（v1.1.0+）：
   * - position.x: 按钮碰撞箱左边界（原始值，未做视觉偏移）
   * - position.y: 底座中线（不是圆心！）
   *   渲染时通过 `top: position.y - radius - visualOffsetY` 转换为 CSS top
   *   其中 visualOffsetY = 15，用于对齐谱线中心
   *
   * 恢复兼容性说明：
   * - timeline version < 1.1.0 时：CanvasBoard 恢复链直接使用缓存中的 position.y
   * - timeline version >= 1.1.0 时：CanvasBoard 恢复链按 nodeIndex + lineIndex 重建标准 Y
   * - 本组件只消费最终的 position.y，不再区分旧缓存/新缓存细节
   */
  const runtime = useSkillButtonRuntime({
    button,
    size,
    timelineData,
    isDetailRouteActive,
    isBrowseMode,
    contextMenuState,
    onModalClose,
  });
  const {
    position,
    skillType,
    isSelected,
    isDragging,
    characterName,
    skillIconUrl,
    element,
    isLocked,
    displayName,
    browseModeDisplayName,
    isDotButton,
    state,
    dispatch,
    radius,
    visualOffsetX,
    visualOffsetY,
    hitWidth,
    hitHeight,
    shouldRenderContextMenu,
    isModalOpen,
    buffList,
    currentSkillLevelMode,
    resolvedTemplate,
    targetResistance,
    selectedHitIndex,
    setSelectedHitIndex,
    panelData,
    isExpanded,
    setIsExpanded,
    infoSnapshotLines,
    selectedAnomalySegmentKey,
    setSelectedAnomalySegmentKey,
    isAnomalyFormulaExpanded,
    setIsAnomalyFormulaExpanded,
    isLocalBuffSearchOpen,
    localBuffSearchKeyword,
    setLocalBuffSearchKeyword,
    buffSearchMode,
    setBuffSearchMode,
    operatorCharacterFilter,
    setOperatorCharacterFilter,
    operatorBuffGroupFilter,
    setOperatorBuffGroupFilter,
    manuallyDisabledBuffIdsBySegmentKey,
    globallyDisabledBuffIds,
    setManuallyDisabledHitKeys,
    iconLoadFailed,
    localBuffSearchInputRef,
    localBuffSearchResults,
    closeLocalBuffSearch,
    openLocalBuffSearch,
    handleCloseModal,
    updateTargetResistance,
    persistManualDisabledHitKeys,
    toggleGlobalBuffDisabled,
    handleApplyLocalBuffSearchResult,
    handleApplyNearbyBuff,
    removeBuff,
    clearAllBuffs,
    enableAllBuffs,
    disableAllBuffs,
    resetAllBuffStacks,
    decrementBuffStack,
    incrementBuffStack,
    modifierBuffList,
    buttonStackCounts,
    usedLocalBuffList,
    nearbyBuffList,
  } = runtime;
  const anomaly = useSkillButtonAnomaly({
    buttonId: button.id,
    buttonCharacterId: button.characterId,
    buttonSkillType: button.skillType,
    characterName,
    selectedCharacters: state.selectedCharacters.map((character) => ({
      id: character.id,
      name: character.name,
    })),
    modifierBuffList,
  });
  const {
    activeAnomaly,
    activeAnomalyGroup,
    activeAnomalyLevel,
    activeAnomalyPreview,
    activeSourceCharacter,
    activeAnomalyStateDurationSeconds,
    activeAnomalyStateLevel,
    activeAnomalyStateOption,
    activeAnomalyStatePreview,
    activeAnomalyStateSourceCharacter,
    anomalyStateSnapshotUsageCounts,
    attachAnomalyStateSnapshotCard,
    availableAnomalyStateSnapshots,
    deleteAnomalyStateSnapshotCard,
    fullCombinedModifierBuffList,
    handleApplyActiveAnomaly,
    handleCreateAnomalyStateSnapshot,
    handleSelectAnomaly,
    handleSelectAnomalyState,
    removeAnomalyCard,
    removeAnomalyStateSnapshotCard,
    selectedAnomalyDamages,
    selectedAnomalyStateSnapshots,
    selectedStatusCards,
    burnDamageMode,
    setActiveAnomalyGroup,
    setActiveAnomalyKey,
    setActiveAnomalyLevel,
    setActiveAnomalySourceId,
    setActiveAnomalyStateDurationSeconds,
    setActiveAnomalyStateLevel,
    setActiveAnomalyStateSourceId,
    setActiveDurationSeconds,
    setBurnDamageMode,
    sourceCharacters,
    activeDurationSeconds,
  } = anomaly;
  const {
    activeNormalHitSegmentKey,
    activeNormalHitKey,
    isActiveNormalHitDisabled,
    fullDamageResult,
    damageResult,
    damageViewModel,
    activeHitBuffOptions,
    isBuffManuallyActive,
    toggleManualBuff,
    resetManualBuffTweaks,
    getEffectiveSegmentStackCounts,
    adjustSegmentBuffStack,
    toggleActiveNormalHitDisabled,
    toggleManualHitDisabled,
    anomalyDamageSegments,
    activeAnomalySegment,
    activeAnomalyBuffOptions,
    isShowingAnomalyDetail,
    activeAnomalyFormula,
    anomalyDamageSummary,
    inspectDamageSummary,
    totalNonCritSummaryFormula,
    totalNonCritSummaryParts,
  } = useSkillButtonDamageRuntime({
    button,
    characterName,
    isInspectMode,
    resistanceRevision,
    runtime,
    anomaly,
  });
  const { handleClick, handleIconError, handleIconLoad, handleMouseDown } = useSkillButtonInteractions({
    button,
    timelineData,
    isBrowseMode,
    isDragDisabled,
    onMouseDown,
    onModalOpen,
    runtime,
  });

  return (
    <>
      <div
        className={`canvas-skill-button ${isSelected ? 'selected' : ''} ${isDragging ? 'dragging' : ''} ${isLocked ? 'locked' : ''} ${isBrowseMode ? 'is-browse-mode' : ''} ${isBrowseMode && isDotButton ? 'is-browse-dot' : ''} ${isInspectMode ? 'is-inspect-mode' : ''} ${isDragDisabled ? 'is-drag-disabled' : ''}`}
        data-skill-button-id={button.id}
        aria-disabled={isDragDisabled}
        style={{
          left: position.x - radius - visualOffsetX,
          top: position.y - radius - visualOffsetY,
          width: hitWidth,
          height: hitHeight,
          '--skill-button-size': `${size}px`,
          '--skill-button-radius': `${radius}px`,
          '--skill-button-element-color': getElementBackgroundColor(element ?? ''),
        } as CSSProperties}
        onMouseDown={handleMouseDown}
        onClick={handleClick}
        onContextMenu={isBrowseMode ? (event) => event.preventDefault() : onContextMenu}
      >
        <div className="skill-button-anchor">
          <div className="skill-button-base">
            <span className="skill-button-name">{isBrowseMode ? browseModeDisplayName : `${skillType} ${displayName}`}</span>
            {isLocked ? <span className="skill-button-lock">锁</span> : null}
            {isInspectMode ? (
              <span className="skill-button-inspect-damage">
                <span>{`期望=${inspectDamageSummary.expected}`}</span>
                <span>{`非暴=${inspectDamageSummary.nonCrit}`}</span>
              </span>
            ) : null}
          </div>
          <div className="skill-button-orb" title={`${characterName} - ${displayName}`}>
            {/* skillIconUrl 有值且未失败时渲染图标 */}
            {skillIconUrl && !iconLoadFailed && !(isBrowseMode && isDotButton) ? (
              <img
                className="skill-icon"
                key={normalizeAssetUrl(skillIconUrl)}
                src={normalizeAssetUrl(skillIconUrl)}
                alt={displayName}
                onLoad={handleIconLoad}
                onError={handleIconError}
              />
            ) : null}
            {/* 兜底文字：图标加载失败或无图标时显示 */}
            <span className={`skill-label ${!iconLoadFailed && skillIconUrl && !(isBrowseMode && isDotButton) ? 'hidden' : ''}`}>{isBrowseMode && isDotButton ? '~' : skillType}</span>
          </div>
        </div>
      </div>

      {/* 右键上下文菜单 - portal 到 body，避免被右侧面板 stacking context 遮挡 */}
      <SkillButtonContextMenu
        buttonId={button.id}
        isOpen={shouldRenderContextMenu}
        position={contextMenuState?.position}
        skillChangeOptions={skillChangeOptions}
        onChangeSkillType={onChangeSkillType}
        onClose={onCloseContextMenu}
        onCopy={onCopy}
        onConfirmRemove={onConfirmRemove}
      />

      {/* 技能信息弹窗 + 技能伤害弹窗 */}
      {isModalOpen && (
        <TimelineSkillDetailWorkbench
          searchLayer={isLocalBuffSearchOpen ? (
            <div className="skill-button-inline-buff-search-mask" onClick={closeLocalBuffSearch}>
              <div
                className="skill-button-inline-buff-search is-workbench-mode"
                onClick={(event) => event.stopPropagation()}
              >
                <div className="skill-button-inline-buff-search-head">
                  <h5>{getBuffSearchModeLabel(buffSearchMode)}</h5>
                  <span>Tab 切换入口 / Esc 关闭</span>
                </div>
                <div className="skill-button-inline-buff-search-modes">
                  {BUFF_SEARCH_MODE_OPTIONS.map((option) => (
                    <button
                      key={option.key}
                      type="button"
                      className={`skill-button-inline-buff-search-mode${buffSearchMode === option.key ? ' is-active' : ''}`}
                      onClick={() => setBuffSearchMode(option.key)}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                <div className={`skill-button-buff-workbench${isSourceBuffSearchMode(buffSearchMode) ? ' has-nearby-buffs' : ''}`}>
                  <div className="skill-button-buff-workbench-main">
                    {buffSearchMode === 'anomaly' ? (
                      <SkillButtonAnomalyPanel
                        activeAnomaly={activeAnomaly}
                        activeAnomalyGroup={activeAnomalyGroup}
                        activeAnomalyLevel={activeAnomalyLevel}
                        activeAnomalyPreview={activeAnomalyPreview}
                        activeSourceCharacter={activeSourceCharacter}
                        sourceCharacters={sourceCharacters}
                        selectedAnomalyDamages={selectedAnomalyDamages}
                        activeDurationSeconds={activeDurationSeconds}
                        burnDamageMode={burnDamageMode}
                        onSetActiveAnomalyGroup={setActiveAnomalyGroup}
                        onResetActiveAnomalyKey={() => setActiveAnomalyKey(null)}
                        onSelectAnomaly={handleSelectAnomaly}
                        onApplyActiveAnomaly={handleApplyActiveAnomaly}
                        onSetActiveAnomalyLevel={setActiveAnomalyLevel}
                        onSetActiveAnomalySourceId={setActiveAnomalySourceId}
                        onSetBurnDamageMode={setBurnDamageMode}
                        onSetActiveDurationSeconds={setActiveDurationSeconds}
                        onRemoveAnomalyCard={removeAnomalyCard}
                      />
                    ) : buffSearchMode === 'anomaly-state' ? (
                      <SkillButtonAnomalyStatePanel
                        activeAnomalyStateOption={activeAnomalyStateOption}
                        activeAnomalyStateLevel={activeAnomalyStateLevel}
                        activeAnomalyStateDurationSeconds={activeAnomalyStateDurationSeconds}
                        activeAnomalyStatePreview={activeAnomalyStatePreview}
                        activeAnomalyStateSourceCharacter={activeAnomalyStateSourceCharacter}
                        sourceCharacters={sourceCharacters}
                        selectedAnomalyStateSnapshots={selectedAnomalyStateSnapshots}
                        onSelectAnomalyState={handleSelectAnomalyState}
                        onCreateSnapshot={handleCreateAnomalyStateSnapshot}
                        onSetActiveAnomalyStateLevel={setActiveAnomalyStateLevel}
                        onSetActiveAnomalyStateSourceId={setActiveAnomalyStateSourceId}
                        onSetActiveAnomalyStateDurationSeconds={setActiveAnomalyStateDurationSeconds}
                        onRemoveAnomalyStateSnapshotCard={removeAnomalyStateSnapshotCard}
                      />
                    ) : buffSearchMode === 'state' ? (
                      <SkillButtonStatePanel
                        activeAnomaly={activeAnomaly}
                        activeAnomalyLevel={activeAnomalyLevel}
                        activeAnomalyPreview={activeAnomalyPreview}
                        selectedStatusCards={selectedStatusCards}
                        onSelectAnomaly={handleSelectAnomaly}
                        onApplyActiveAnomaly={handleApplyActiveAnomaly}
                        onSetActiveAnomalyLevel={setActiveAnomalyLevel}
                        onRemoveAnomalyCard={removeAnomalyCard}
                      />
                    ) : (
                      <div className="skill-button-local-buff-panel">
                        <div className={`skill-button-inline-buff-search-bar${['operator', 'weapon', 'equipment'].includes(buffSearchMode) ? ' has-operator-filters' : ''}`}>
                          <input
                            ref={localBuffSearchInputRef}
                            className="skill-button-inline-buff-search-input"
                            value={localBuffSearchKeyword}
                            onChange={(event) => setLocalBuffSearchKeyword(event.target.value)}
                            placeholder="搜索组 / 项 / Buff / 类型 / 条件"
                          />
                          {['operator', 'weapon', 'equipment'].includes(buffSearchMode) ? (
                            <div className="operator-buff-search-filters">
                              <div className="operator-buff-character-filters" aria-label="按干员筛选">
                                {state.selectedCharacters.slice(0, 4).map((character) => (
                                  <button
                                    key={character.id}
                                    type="button"
                                    className={`operator-buff-character-filter${operatorCharacterFilter === character.id ? ' is-active' : ''}`}
                                    onClick={() => setOperatorCharacterFilter((current) => current === character.id ? null : character.id)}
                                    title={character.name}
                                    aria-label={`筛选干员 ${character.name}`}
                                    aria-pressed={operatorCharacterFilter === character.id}
                                  >
                                    {character.avatarUrl ? (
                                      <img src={normalizeAssetUrl(character.avatarUrl)} alt="" />
                                    ) : (
                                      <span>{character.name.slice(0, 1)}</span>
                                    )}
                                  </button>
                                ))}
                              </div>
                              {buffSearchMode === 'operator' ? (
                                <div className="operator-buff-group-filters" aria-label="按 Buff 来源分类筛选">
                                  {OPERATOR_BUFF_GROUP_FILTERS.map((option) => (
                                    <button
                                      key={option.key}
                                      type="button"
                                      className={operatorBuffGroupFilter === option.key ? 'is-active' : ''}
                                      onClick={() => setOperatorBuffGroupFilter((current) => current === option.key ? null : option.key)}
                                      aria-pressed={operatorBuffGroupFilter === option.key}
                                    >
                                      {option.label}
                                    </button>
                                  ))}
                                </div>
                              ) : null}
                            </div>
                          ) : null}
                        </div>
                        <div className="skill-button-inline-buff-search-results">
                          {localBuffSearchKeyword.trim().length === 0 ? (
                            localBuffSearchResults.length > 0 ? (
                              localBuffSearchResults.map((entry) => (
                                <button
                                  key={entry.key}
                                  type="button"
                                  className="skill-button-inline-buff-search-item"
                                  onClick={() => handleApplyLocalBuffSearchResult(entry)}
                                >
                                  <div className="local-buff-search-item-head">
                                    <strong>{entry.displayName}</strong>
                                    <span>{entry.effectKind === 'extraHit' ? '额外伤害段' : entry.type || '暂无'}</span>
                                  </div>
                                  <p className="local-buff-search-item-source">
                                    {entry.groupName}{entry.itemName ? ` / ${entry.itemName}` : ''}
                                  </p>
                                  <p>{getBuffCategoryText(entry.category)} / {entry.type || '暂无'}{entry.value !== undefined ? ` · ${entry.value}` : ''}</p>
                                </button>
                              ))
                            ) : (
                              <div className="skill-button-inline-buff-search-empty">
                                输入关键词或选择筛选后显示{getBuffSearchModeLabel(buffSearchMode)}结果
                              </div>
                            )
                          ) : localBuffSearchResults.length > 0 ? (
                            localBuffSearchResults.map((entry) => (
                              <button
                                key={entry.key}
                                type="button"
                                className="skill-button-inline-buff-search-item"
                                onClick={() => handleApplyLocalBuffSearchResult(entry)}
                              >
                                <div className="local-buff-search-item-head">
                                  <strong>{entry.displayName}</strong>
                                  <span>{entry.effectKind === 'extraHit' ? '额外伤害段' : entry.type || '暂无'}</span>
                                </div>
                                <p className="local-buff-search-item-source">
                                  {entry.groupName}{entry.itemName ? ` / ${entry.itemName}` : ''}
                                </p>
                                <p>{entry.effectKind === 'extraHit'
                                  ? `倍率: ${((entry.extraHitConfig?.baseMultiplier ?? 0) * 100).toFixed(1)}% / ${entry.extraHitConfig?.damageType || 'physical'} / ${entry.extraHitConfig?.skillType || '空'} / CD ${entry.extraHitConfig?.cooldownSeconds ?? 0}s${entry.category === 'countable' ? ` / 计层 ${entry.maxStacks ?? 1}` : ''}`
                                  : `数值: ${entry.value ?? '-'}${entry.condition ? ` / ${entry.condition}` : ''}`}</p>
                              </button>
                            ))
                          ) : (
                            <div className="skill-button-inline-buff-search-empty">
                              没有匹配到{getBuffSearchModeLabel(buffSearchMode)}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                  {isSourceBuffSearchMode(buffSearchMode) ? (
                    <aside className="skill-button-buff-resource-rail nearby-buff-resource-rail">
                      <div className="skill-anomaly-board skill-anomaly-cache-board">
                        <div className="skill-anomaly-board-section">
                          <p className="skill-anomaly-board-title">附近 Buff</p>
                          <div className="skill-anomaly-board-list skill-anomaly-cache-list">
                            {nearbyBuffList.length === 0 ? (
                              <div className="skill-button-buff-empty">附近暂无可选 Buff</div>
                            ) : (
                              nearbyBuffList.map((buff) => (
                                <button
                                  key={`nearby-buff-${buff.id}`}
                                  type="button"
                                  className="anomaly-board-card nearby-buff-card"
                                  onClick={() => handleApplyNearbyBuff(buff)}
                                  title="添加到已选 Buff"
                                >
                                  <span className="anomaly-board-card-title buff-card-title-line">
                                    <span>{buff.displayName || buff.name}</span>
                                    <span className="buff-card-source">/ {buff.sourceName || buff.source || '未知来源'}</span>
                                  </span>
                                  <span>
                                    {getBuffCategoryText(buff.category)} / {buff.type || '暂无'}{buff.value !== undefined ? ` · ${buff.value}` : ''}
                                  </span>
                                </button>
                              ))
                            )}
                          </div>
                        </div>
                      </div>
                    </aside>
                  ) : null}

                  <aside className="skill-button-buff-resource-rail">
                    <div className="skill-anomaly-board skill-anomaly-cache-board">
                      <div className="skill-anomaly-board-section">
                        <p className="skill-anomaly-board-title">
                          {isSourceBuffSearchMode(buffSearchMode) ? '已选 Buff' : buffSearchMode === 'anomaly-state' ? '缓存快照' : '资源栏'}
                        </p>
                        <div className="skill-anomaly-board-list skill-anomaly-cache-list">
                          {isSourceBuffSearchMode(buffSearchMode) ? (
                            usedLocalBuffList.length === 0 ? (
                              <div className="skill-button-buff-empty">暂无已选 Buff</div>
                            ) : (
                              usedLocalBuffList.map((buff) => (
                                <div
                                  key={`used-buff-${buff.id}`}
                                  className="anomaly-board-card selected-buff-card"
                                >
                                  <button
                                    type="button"
                                    className="selected-buff-card-remove"
                                    onClick={() => removeBuff(buff.id)}
                                    title="移除 Buff"
                                    aria-label={`移除 ${buff.displayName || buff.name}`}
                                  >
                                    <svg viewBox="0 0 24 24" aria-hidden="true">
                                      <path d="m6.4 5 5.6 5.6L17.6 5 19 6.4 13.4 12l5.6 5.6-1.4 1.4-5.6-5.6L6.4 19 5 17.6l5.6-5.6L5 6.4 6.4 5Z" />
                                    </svg>
                                  </button>
                                  <span className="anomaly-board-card-title buff-card-title-line">
                                    <span>{buff.displayName || buff.name}</span>
                                    <span className="buff-card-source">/ {buff.sourceName || buff.source || '未知来源'}</span>
                                  </span>
                                  <span>
                                    {getBuffCategoryText(buff.category)} / {buff.type || '暂无'}{buff.value !== undefined ? ` · ${buff.value}` : ''}
                                  </span>
                                </div>
                              ))
                            )
                          ) : buffSearchMode === 'anomaly-state' ? (
                            availableAnomalyStateSnapshots.length === 0 ? (
                              <div className="skill-button-buff-empty">暂无缓存快照</div>
                            ) : (
                            availableAnomalyStateSnapshots.map((snapshot) => {
                              const usageCount = anomalyStateSnapshotUsageCounts.get(snapshot.id) ?? 0;
                              return (
                                <div
                                  key={`available-${snapshot.id}`}
                                  className="anomaly-board-card is-state"
                                  onClick={() => attachAnomalyStateSnapshotCard(snapshot.id)}
                                  title="单击挂载到当前角色"
                                >
                                  <div className="anomaly-board-card-topline">
                                    <span className="anomaly-board-card-title">{formatAnomalyStateSnapshotName(snapshot)}</span>
                                    <button
                                      type="button"
                                      className="anomaly-board-card-delete-btn"
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        deleteAnomalyStateSnapshotCard(snapshot.id);
                                      }}
                                      disabled={usageCount > 0}
                                      title={usageCount > 0 ? '该快照仍被界面中的项目引用，无法删除' : '删除缓存快照'}
                                    >
                                      删除
                                    </button>
                                  </div>
                                  <span>{snapshot.sourceCharacterName}</span>
                                </div>
                              );
                            })
                            )
                          ) : (
                            <div className="skill-button-buff-empty">当前页不需要右侧资源</div>
                          )}
                        </div>
                      </div>
                    </div>
                  </aside>
                </div>
              </div>
            </div>
          ) : null}
          characterName={characterName}
          skillLabel={`${skillType} / ${displayName} ${currentSkillLevelMode}`}
          positionLabel={(() => {
            const staffLine = timelineData?.staffLines?.find((item) => item.staffIndex === (button as SkillButtonType).lineIndex);
            const buttonData = staffLine?.buttons?.find((item) => item.id === button.id);
            return `干员 ${String((button as SkillButtonType).lineIndex ?? '-')} · 节点 ${String(buttonData?.nodeNumber ?? buttonData?.nodeIndex ?? '-')}`;
          })()}
          isLocked={Boolean(isLocked)}
          onToggleLock={() => dispatch({ type: 'TOGGLE_SKILL_BUTTON_LOCK', buttonId: button.id })}
          onClose={handleCloseModal}
          onOpenSearch={openLocalBuffSearch}
          targetResistance={targetResistance}
          onResistanceChange={updateTargetResistance}
          buffs={buffList}
          buffStackCounts={buttonStackCounts}
          onRemoveBuff={removeBuff}
          onToggleBuffDisabled={toggleGlobalBuffDisabled}
          isBuffDisabled={(buffId) => globallyDisabledBuffIds.includes(buffId)}
          onDecrementBuff={decrementBuffStack}
          onIncrementBuff={incrementBuffStack}
          onClearBuffs={clearAllBuffs}
          onEnableAllBuffs={enableAllBuffs}
          onDisableAllBuffs={disableAllBuffs}
          onResetBuffStacks={resetAllBuffStacks}
          statuses={[
            ...selectedStatusCards.map((card) => ({
              key: card.id,
              title: card.primaryText,
              detail: [card.secondaryText, card.tertiaryText].filter(Boolean).join(' · '),
              kind: '状态',
              onRemove: () => removeAnomalyCard('state', card.id),
            })),
            ...selectedAnomalyStateSnapshots.map((snapshot) => ({
              key: `snapshot-${snapshot.id}`,
              title: formatAnomalyStateSnapshotName(snapshot),
              detail: snapshot.sourceCharacterName,
              kind: '异常状态',
              onRemove: () => removeAnomalyStateSnapshotCard(snapshot.id),
            })),
            ...selectedAnomalyDamages.map((card) => ({
              key: card.id,
              title: card.primaryText,
              detail: [card.secondaryText, card.tertiaryText].filter(Boolean).join(' · '),
              kind: '异常伤害',
              onRemove: () => removeAnomalyCard('damage', card.id),
            })),
          ]}
          hits={[
            ...(damageViewModel?.hitCards.map((hitCard, index) => ({
              ...(() => {
                const hit = resolvedTemplate?.hits[index];
                const segmentKey = hit ? getNormalHitSegmentKey(hit.key) : null;
                const fullHitResult = fullDamageResult?.hits[index];
                const effectiveStackCounts = segmentKey
                  ? getEffectiveSegmentStackCounts(segmentKey)
                  : buttonStackCounts;
                const tuningBuffs = fullHitResult
                  ? buildAppliedBuffTags(fullHitResult.appliedBuffs, effectiveStackCounts)
                  : [];
                return {
                  tuning: segmentKey ? {
                    title: `${hitCard.displayName} 详情`,
                    stats: [],
                    buffs: tuningBuffs,
                    segmentKey,
                    disabled: hitCard.isDisabled,
                    onToggleDisabled: hit ? () => {
                      setManuallyDisabledHitKeys((prev) => {
                        const next = prev.includes(hit.key)
                          ? prev.filter((hitKey) => hitKey !== hit.key)
                          : [...prev, hit.key];
                        persistManualDisabledHitKeys(next);
                        return next;
                      });
                    } : undefined,
                    onToggleBuff: (buffId: string) => toggleManualBuff(segmentKey, buffId),
                    isBuffActive: (buffId: string) => isBuffManuallyActive(segmentKey, buffId),
                    onDecrementBuff: (buffId: string) => adjustSegmentBuffStack(segmentKey, buffId, -1),
                    onIncrementBuff: (buffId: string) => adjustSegmentBuffStack(segmentKey, buffId, 1),
                    onResetBuffs: () => resetManualBuffTweaks(segmentKey),
                  } : undefined,
                };
              })(),
              key: hitCard.key,
              title: hitCard.displayName,
              meta: `${hitCard.buffCountText} · ${hitCard.multiplierText}`,
              expected: hitCard.expectedText,
              crit: hitCard.critText,
              nonCrit: hitCard.nonCritText,
              selected: hitCard.isSelected,
              disabled: hitCard.isDisabled,
              onSelect: () => {
                const isCurrentHit = selectedHitIndex === index && selectedAnomalySegmentKey === null;
                setSelectedHitIndex(isCurrentHit ? null : index);
                setSelectedAnomalySegmentKey(null);
                setIsAnomalyFormulaExpanded(false);
              },
            })) ?? []),
            ...anomalyDamageSegments.map((segment) => ({
              key: segment.key,
              title: segment.sequenceTitle,
              meta: `${segment.buffText} · ${segment.multiplierText}`,
              expected: segment.expectedText,
              crit: segment.critText,
              nonCrit: segment.nonCritText,
              selected: activeAnomalySegment?.key === segment.key,
              disabled: segment.isDisabled,
              tuning: {
                title: segment.title,
                stats: [],
                buffs: buildAppliedBuffTags(
                  fullCombinedModifierBuffList,
                  getEffectiveSegmentStackCounts(segment.key)
                ),
                segmentKey: segment.key,
                disabled: segment.isDisabled,
                onToggleDisabled: () => toggleManualHitDisabled(segment.key),
                onToggleBuff: (buffId: string) => toggleManualBuff(segment.key, buffId),
                isBuffActive: (buffId: string) => isBuffManuallyActive(segment.key, buffId),
                onDecrementBuff: (buffId: string) => adjustSegmentBuffStack(segment.key, buffId, -1),
                onIncrementBuff: (buffId: string) => adjustSegmentBuffStack(segment.key, buffId, 1),
                onResetBuffs: () => resetManualBuffTweaks(segment.key),
              },
              onSelect: () => {
                const isCurrentSegment = selectedHitIndex === null && selectedAnomalySegmentKey === segment.key;
                setSelectedHitIndex(null);
                setSelectedAnomalySegmentKey(isCurrentSegment ? null : segment.key);
                setIsAnomalyFormulaExpanded(false);
              },
            })),
          ]}
          summary={damageViewModel ? {
            title: damageViewModel.header.fullText,
            expected: (Number(damageViewModel.summary.totalExpectedText) + anomalyDamageSummary.expected).toFixed(0),
            crit: (Number(damageViewModel.summary.totalCritText) + anomalyDamageSummary.crit).toFixed(0),
            nonCrit: (Number(damageViewModel.summary.totalNonCritText) + anomalyDamageSummary.nonCrit).toFixed(0),
            formula: totalNonCritSummaryFormula,
            parts: totalNonCritSummaryParts,
          } : null}
          formula={isShowingAnomalyDetail ? activeAnomalyFormula : damageViewModel?.activeHitFormula ?? null}
          infoLines={infoSnapshotLines}
        >
          <div className={`skill-button-modal-pair${isLocalBuffSearchOpen ? ' is-buff-search-open' : ''}`}>
            {/* 弹窗1：技能信息 */}
            <SkillButtonInfoModal
              anomaly={anomaly}
              button={button}
              characterName={characterName}
              currentSkillLevelMode={currentSkillLevelMode}
              displayName={displayName}
              isLocked={Boolean(isLocked)}
              onClose={handleCloseModal}
              onToggleLock={() => dispatch({ type: 'TOGGLE_SKILL_BUTTON_LOCK', buttonId: button.id })}
              runtime={runtime}
              skillType={skillType}
              timelineData={timelineData}
            />

            {/* 弹窗2：技能伤害 - Hit 主导版本 */}
            <SkillButtonDamageModal
              isDamageReady={Boolean(damageResult)}
              isPanelReady={Boolean(panelData)}
              damageViewModel={damageViewModel}
              anomalyDamageSummary={anomalyDamageSummary}
              totalNonCritSummaryFormula={totalNonCritSummaryFormula}
              anomalyDamageSegments={anomalyDamageSegments}
              activeAnomalySegment={activeAnomalySegment}
              isShowingAnomalyDetail={isShowingAnomalyDetail}
              activeNormalHitKey={activeNormalHitKey}
              activeNormalHitSegmentKey={activeNormalHitSegmentKey}
              isActiveNormalHitDisabled={isActiveNormalHitDisabled}
              activeHitBuffOptions={activeHitBuffOptions}
              activeAnomalyBuffOptions={activeAnomalyBuffOptions}
              isExpanded={isExpanded}
              isAnomalyFormulaExpanded={isAnomalyFormulaExpanded}
              hasManualBuffTweaks={(segmentKey) => (manuallyDisabledBuffIdsBySegmentKey[segmentKey]?.length ?? 0) > 0}
              isBuffManuallyActive={isBuffManuallyActive}
              onSelectHit={(index) => {
                setSelectedHitIndex(index);
                setSelectedAnomalySegmentKey(null);
                setIsAnomalyFormulaExpanded(false);
              }}
              onSelectAnomalySegment={(segmentKey) => {
                setSelectedHitIndex(null);
                setSelectedAnomalySegmentKey(segmentKey);
                setIsAnomalyFormulaExpanded(false);
              }}
              onToggleActiveNormalHit={toggleActiveNormalHitDisabled}
              onToggleManualBuff={toggleManualBuff}
              onResetManualBuffTweaks={resetManualBuffTweaks}
              onToggleFormula={() => {
                if (isShowingAnomalyDetail) {
                  setIsAnomalyFormulaExpanded(!isAnomalyFormulaExpanded);
                  return;
                }
                setIsExpanded(!isExpanded);
              }}
            />

            {/* 弹窗4：信息快照 */}
            <div className="skill-button-modal skill-button-modal-info-snapshot">
              <h4>信息</h4>
              <div className="modal-content">
                {infoSnapshotLines.length > 0 ? (
                  <pre className="skill-info-snapshot-content">{infoSnapshotLines.join('\n')}</pre>
                ) : (
                  <p className="skill-info-snapshot-empty">暂无信息快照</p>
                )}
              </div>
            </div>
          </div>
        </TimelineSkillDetailWorkbench>
      )}
    </>
  );
}
