import type { ReactNode } from 'react';
import {
  getGridLineCenterY,
  getGridNodeCenterX,
  GRID_NODE_COUNT,
  GRID_ROW_HEIGHT,
  LINE_ROW_INDICES,
} from '../core/calculators/gridSnapLayout';
import { normalizeAssetUrl } from '../utils/assetResolver';
import type { Character } from '../types';
import type { PersistedSkillButton } from '../types/storage';
import { BuffEditSkillButton } from './BuffEditSkillButton';
import {
  CANDIDATE_ADDER_MODE_OPTIONS,
  columnLabels,
  getBuffLabel,
  getBuffSourceLabel,
  getBuffValueLine,
  getCandidateAdderModeLabel,
  getMissingBuffShortId,
  resolveWeaponImageUrl,
  rowLabels,
  type SourceFilter,
} from './buffBatchEditModel';
import { useBuffBatchEditWorkbench } from './useBuffBatchEditWorkbench';
import { SkillButtonAnomalyStatePanel } from './CanvasBoard/SkillButtonAnomalyPanels';
import { WorkbenchSplitSurface } from './WorkbenchSplitSurface';
import './CanvasBoard/CanvasBoard.css';
import './BuffBatchEditWorkbench.css';

interface BuffBatchEditWorkbenchProps {
  selectedCharacters: Character[];
  workbenchControl: ReactNode;
  bottomRightControl: ReactNode;
  isWorkbenchTopZoneOpen: boolean;
}

export function BuffBatchEditWorkbench({
  selectedCharacters,
  workbenchControl,
  bottomRightControl,
  isWorkbenchTopZoneOpen,
}: BuffBatchEditWorkbenchProps) {
  const {
    layout: {
      boxSelectRect,
      canvasHeight,
      canvasRef,
      handleBoxSelectMouseDown,
      isBoxSelectArmed,
      layoutRef,
      normalizedBoxSelectRect,
      secondaryButtonLeft,
      setBoxSelectRect,
      setIsBoxSelectArmed,
      staffGroupCount,
    },
    buttons: {
      characterById,
      editAddCountByButton,
      editRemoveCountByButton,
      pendingAddCountByButton,
      pendingRemoveCountByButton,
      pressedCharacterIds,
      selectedButtonIds,
      selectedButtons,
      setSelectedButtonIds,
      skillButtons,
      toggleButton,
      toggleCharacterQuickSelect,
    },
    filters: {
      activeSourceFilter,
      selectedFilterBuffIds,
      toggleFilterBuff,
      toggleSourceFilter,
      visibleFilterBuffs,
      weaponButtonItems,
    },
    modes: {
      activeAddBuffId,
      activeRemoveBuffId,
      commonBuffIds,
      editAddByBuff,
      editRemoveByBuff,
      handleCancelAddMode,
      handleCancelEditMode,
      handleCancelRemoveMode,
      handleToggleAddMode,
      handleToggleEditMode,
      handleToggleFilterMode,
      handleToggleRemoveMode,
      pendingAddByBuff,
      pendingRemoveByBuff,
      setActiveAddBuffId,
      setActiveRemoveBuffId,
      toolMode,
      toggleEditAddBuff,
      toggleEditRemoveBuff,
      unusedBuffIds,
      usedNonCommonBuffIds,
    },
    candidate: {
      anomalyStateWorkbench,
      batchAnomalyStateSnapshots,
      candidateAddBuffs,
      candidateAdderMode,
      candidateSearchInputRef,
      candidateSearchKeyword,
      candidateSearchResults,
      handleAddAnomalyStateSnapshotCandidate,
      handleAddCandidateSearchResult,
      handleCreateAnomalyStateCandidate,
      handleDeleteBatchAnomalyStateSnapshot,
      isCandidateAdderOpen,
      setCandidateAdderMode,
      setCandidateSearchKeyword,
      setIsCandidateAdderOpen,
    },
    catalog: { buffById },
  } = useBuffBatchEditWorkbench(selectedCharacters);

  const renderStaffVisualGroup = (staffIndex: number) => (
    <div key={`staff-visual-${staffIndex}`} className="canvas-staff-visual-group" aria-hidden="true">
      {LINE_ROW_INDICES.map((_, lineIndex) => {
        const character = selectedCharacters[lineIndex];
        const lineCenterY = getGridLineCenterY(lineIndex);

        return (
          <div
            key={`staff-line-${staffIndex}-${lineIndex}`}
            className="canvas-staff-visual-line"
            data-line-index={lineIndex}
            style={{ top: lineCenterY }}
          >
            <div className="canvas-staff-line" />
            <div className="canvas-staff-line-label">
              {character?.avatarUrl && (
                <img
                  className="canvas-staff-avatar"
                  src={normalizeAssetUrl(character.avatarUrl)}
                  alt={`${character.name} avatar`}
                  onError={(event) => {
                    (event.target as HTMLImageElement).style.display = 'none';
                  }}
                />
              )}
              <span className="canvas-staff-name">
                {character?.name || `干员 ${lineIndex + 1}`}
              </span>
            </div>
            <div className="canvas-damage-nodes">
              {Array.from({ length: GRID_NODE_COUNT }, (_, nodeIndex) => {
                const nodeCenterX = getGridNodeCenterX(nodeIndex);
                return (
                  <div
                    key={`node-${staffIndex}-${lineIndex}-${nodeIndex}`}
                    className="canvas-damage-node"
                    style={{ left: nodeCenterX - 1, top:  GRID_ROW_HEIGHT / 2 - 3 }}
                  />
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );

  const renderGridGroup = (staffIndex: number) => (
    <div key={`grid-row-${staffIndex}`} className="canvas-grid-row">
      <div className="canvas-grid-group">
        <div className="canvas-grid-header-bg" aria-hidden="true" />
        <div className="canvas-grid-background" aria-hidden="true" />
        <div className="canvas-grid-labels" aria-hidden="true">
          <div className="canvas-grid-corner" />
          <div className="canvas-grid-column-labels">
            {columnLabels.map((label) => (
              <span key={label}>{label}</span>
            ))}
          </div>
          <div className="canvas-grid-row-labels">
            {rowLabels.map((label) => (
              <span key={label}>{label}</span>
            ))}
          </div>
        </div>
      </div>
      {renderStaffVisualGroup(staffIndex)}
    </div>
  );

  const renderSkillButton = (button: PersistedSkillButton) => {
    const character = characterById.get(button.characterId || button.characterName) ?? characterById.get(button.characterName);
    const isSelected = selectedButtonIds.includes(button.id);
    const isAddOwned = toolMode === 'add' && Boolean(activeAddBuffId && button.selectedBuff?.includes(activeAddBuffId));
    const isAddTarget = toolMode === 'add' && Boolean(activeAddBuffId && pendingAddByBuff[activeAddBuffId]?.includes(button.id));
    const isRemoveOwned = toolMode === 'remove' && Boolean(activeRemoveBuffId && button.selectedBuff?.includes(activeRemoveBuffId));
    const isRemoveTarget = toolMode === 'remove' && Boolean(activeRemoveBuffId && pendingRemoveByBuff[activeRemoveBuffId]?.includes(button.id));
    const isEditAddTarget = toolMode === 'edit' && (editAddCountByButton.get(button.id) ?? 0) > 0;
    const isEditRemoveTarget = toolMode === 'edit' && (editRemoveCountByButton.get(button.id) ?? 0) > 0;
    const pendingAddCount = toolMode === 'edit' ? (editAddCountByButton.get(button.id) ?? 0) : (pendingAddCountByButton.get(button.id) ?? 0);
    const pendingRemoveCount = toolMode === 'edit' ? (editRemoveCountByButton.get(button.id) ?? 0) : (pendingRemoveCountByButton.get(button.id) ?? 0);
    const element = character?.element ?? '';

    return (
      <BuffEditSkillButton
        key={button.id}
        button={button}
        element={element}
        isSelected={isSelected}
        isAddOwned={isAddOwned}
        isAddTarget={isAddTarget}
        isRemoveOwned={isRemoveOwned}
        isRemoveTarget={isRemoveTarget}
        isEditAddTarget={isEditAddTarget}
        isEditRemoveTarget={isEditRemoveTarget}
        pendingAddCount={pendingAddCount}
        pendingRemoveCount={pendingRemoveCount}
        onToggle={toggleButton}
      />
    );
  };

  const renderBuffTag = (
    buffId: string,
    options: { selected?: boolean; white?: boolean; gray?: boolean; intent?: 'add' | 'remove'; onClick?: () => void } = {}
  ) => {
    const buff = buffById.get(buffId);
    const label = buff ? getBuffLabel(buff) : '缺失 Buff';
    const missingLine = getMissingBuffShortId(buffId);
    return (
      <button
        key={buffId}
        type="button"
        className={`buff-edit-buff-card${options.selected ? ' is-selected' : ''}${options.white ? ' is-white' : ''}${options.gray ? ' is-gray' : ''}${options.intent === 'add' ? ' is-add-intent' : ''}${options.intent === 'remove' ? ' is-remove-intent' : ''}`}
        onClick={options.onClick}
        disabled={!options.onClick}
        title={buff ? `${label} / ${getBuffSourceLabel(buff)} / ${getBuffValueLine(buff)}` : `实体缺失：${buffId}`}
      >
        <span className="buff-edit-buff-card-title">{label}</span>
        <span>{buff ? getBuffSourceLabel(buff) : '可点击清理引用'}</span>
        <span>{buff ? getBuffValueLine(buff) : missingLine}</span>
      </button>
    );
  };

  const isSourceFilterActive = (filter: SourceFilter): boolean => (
    activeSourceFilter?.kind === filter.kind && activeSourceFilter.id === filter.id
  );

  const renderRightSideButtons = () => {
    if (toolMode === 'filter' || toolMode === 'add' || toolMode === 'remove') {
      const characterButtons = selectedCharacters.slice(0, 4).map((character, index) => {
        const filter: SourceFilter = { kind: 'character', id: character.id, name: character.name };
        return (
          <button
            key={`source-character-${character.id}`}
            className={`buff-edit-secondary-button buff-edit-secondary-avatar-button${isSourceFilterActive(filter) ? ' is-active' : ''}`}
            type="button"
            title={character.name}
            aria-label={`筛选干员来源 ${character.name}`}
            style={{ left: secondaryButtonLeft, top: 48 + index * 40 }}
            onClick={() => toggleSourceFilter(filter)}
          >
            {character.avatarUrl ? <img src={normalizeAssetUrl(character.avatarUrl)} alt="" /> : <span>{character.name.slice(0, 1)}</span>}
          </button>
        );
      });

      const weaponButtons = weaponButtonItems.map(({ character, weaponName }, index) => {
        const filter: SourceFilter = { kind: 'weapon', id: weaponName, name: weaponName };
        return (
          <button
            key={`source-weapon-${character.id}-${weaponName}`}
            className={`buff-edit-secondary-button buff-edit-secondary-avatar-button${isSourceFilterActive(filter) ? ' is-active' : ''}`}
            type="button"
            title={weaponName}
            aria-label={`筛选武器来源 ${weaponName}`}
            style={{ left: secondaryButtonLeft, top: 248 + index * 40 }}
            onClick={() => toggleSourceFilter(filter)}
          >
            <img
              src={resolveWeaponImageUrl(weaponName)}
              alt=""
              onError={(event) => {
                event.currentTarget.style.display = 'none';
              }}
            />
            <span>{weaponName.slice(0, 1)}</span>
          </button>
        );
      });

      const equipmentFilter: SourceFilter = { kind: 'equipment', id: 'equipment', name: '装备' };
      return (
        <>
          {characterButtons}
          {weaponButtons}
          <button
            className={`buff-edit-secondary-button${isSourceFilterActive(equipmentFilter) ? ' is-active' : ''}`}
            type="button"
            title="装备"
            aria-label="筛选装备来源"
            style={{ left: secondaryButtonLeft, top: 208 }}
            onClick={() => toggleSourceFilter(equipmentFilter)}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M15 4l6 2v5h-3v8a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1v-8H3V6l6-2a3 3 0 0 0 6 0" />
            </svg>
          </button>
        </>
      );
    }

    return selectedCharacters.slice(0, 4).map((character, index) => (
      <button
        key={`quick-character-${character.id}`}
        className={`buff-edit-secondary-button buff-edit-secondary-avatar-button${pressedCharacterIds.includes(character.id) ? ' is-active' : ''}`}
        type="button"
        title={character.name}
        aria-label={`选择干员按钮 ${character.name}`}
        style={{ left: secondaryButtonLeft, top: 48 + index * 40 }}
        onClick={() => toggleCharacterQuickSelect(character)}
      >
        {character.avatarUrl ? <img src={normalizeAssetUrl(character.avatarUrl)} alt="" /> : <span>{character.name.slice(0, 1)}</span>}
      </button>
    ));
  };

  const renderRightPanel = () => {
    if (toolMode === 'remove') {
      const draftBuffCount = Object.keys(pendingRemoveByBuff).filter((buffId) => (pendingRemoveByBuff[buffId] ?? []).length > 0).length;
      return (
        <div className="buff-edit-right-panel">
          <div className="buff-edit-right-head">
            <h3>删减 Buff</h3>
            <span>{draftBuffCount} Buff 草稿</span>
          </div>
          <div className="buff-edit-tag-list">
            {visibleFilterBuffs.length > 0 ? (
              visibleFilterBuffs.map((buff) => renderBuffTag(buff.id, {
                selected: activeRemoveBuffId === buff.id,
                onClick: () => setActiveRemoveBuffId((current) => current === buff.id ? null : buff.id),
              }))
            ) : (
              <div className="buff-edit-right-empty">暂无 Buff</div>
            )}
          </div>
        </div>
      );
    }

    if (toolMode === 'add') {
      const draftBuffCount = Object.keys(pendingAddByBuff).filter((buffId) => (pendingAddByBuff[buffId] ?? []).length > 0).length;
      return (
        <div className="buff-edit-right-panel">
          <div className="buff-edit-right-head">
            <h3>增加 Buff</h3>
            <span>{draftBuffCount} Buff 草稿</span>
          </div>
          <div className="buff-edit-tag-list">
            {visibleFilterBuffs.length > 0 ? (
              visibleFilterBuffs.map((buff) => renderBuffTag(buff.id, {
                selected: activeAddBuffId === buff.id,
                onClick: () => setActiveAddBuffId((current) => current === buff.id ? null : buff.id),
              }))
            ) : (
              <div className="buff-edit-right-empty">暂无 Buff</div>
            )}
          </div>
          <section className="buff-edit-right-section buff-edit-candidate-section">
            <div className="buff-edit-candidate-head">
              <h4>候选 Buff</h4>
              <span>Tab 打开面板添加候选 Buff</span>
            </div>
            {candidateAddBuffs.length > 0 ? (
              <div className="buff-edit-tag-list">
                {candidateAddBuffs.map((buff) => renderBuffTag(buff.id, {
                  selected: activeAddBuffId === buff.id,
                  onClick: () => setActiveAddBuffId((current) => current === buff.id ? null : buff.id),
                }))}
              </div>
            ) : (
              <div className="buff-edit-candidate-empty">候选 Buff 为空</div>
            )}
            {isCandidateAdderOpen ? (
              <div className="buff-edit-candidate-empty">候选 Buff 面板已打开，Tab 切换入口，Esc 关闭</div>
            ) : null}
          </section>
        </div>
      );
    }

    if (toolMode === 'filter') {
      return (
        <div className="buff-edit-right-panel">
          <div className="buff-edit-right-head">
            <h3>筛选 Buff</h3>
            <span>{selectedFilterBuffIds.length} 已选</span>
          </div>
          <div className="buff-edit-tag-list">
            {visibleFilterBuffs.length > 0 ? (
              visibleFilterBuffs.map((buff) => renderBuffTag(buff.id, {
                selected: selectedFilterBuffIds.includes(buff.id),
                onClick: () => toggleFilterBuff(buff.id),
              }))
            ) : (
              <div className="buff-edit-right-empty">暂无 Buff</div>
            )}
          </div>
        </div>
      );
    }

    if (toolMode === 'edit') {
      return (
        <div className="buff-edit-right-panel">
          <div className="buff-edit-right-head">
            <h3>编辑目录</h3>
            <span>{selectedButtons.length} 技能按钮</span>
          </div>
          <section className="buff-edit-right-section">
            <h4>共同 Buff</h4>
            <div className="buff-edit-tag-list">
              {commonBuffIds.length > 0
                ? commonBuffIds.map((buffId) => renderBuffTag(buffId, {
                  selected: (editRemoveByBuff[buffId] ?? []).length > 0,
                  intent: 'remove',
                  onClick: () => toggleEditRemoveBuff(buffId),
                }))
                : <div className="buff-edit-right-empty">暂无共同 Buff</div>}
            </div>
          </section>
          <section className="buff-edit-right-section">
            <h4>已用剩余 Buff</h4>
            <div className="buff-edit-tag-list">
              {usedNonCommonBuffIds.length > 0
                ? usedNonCommonBuffIds.map((buffId) => renderBuffTag(buffId, {
                  selected: (editAddByBuff[buffId] ?? []).length > 0,
                  intent: 'add',
                  onClick: () => toggleEditAddBuff(buffId),
                }))
                : <div className="buff-edit-right-empty">暂无剩余 Buff</div>}
            </div>
          </section>
          <section className="buff-edit-right-section">
            <h4>未用 Buff</h4>
            <div className="buff-edit-tag-list">
              {unusedBuffIds.length > 0
                ? unusedBuffIds.map((buffId) => renderBuffTag(buffId, {
                  selected: (editAddByBuff[buffId] ?? []).length > 0,
                  gray: true,
                  intent: 'add',
                  onClick: () => toggleEditAddBuff(buffId),
                }))
                : <div className="buff-edit-right-empty">暂无未用 Buff</div>}
            </div>
          </section>
        </div>
      );
    }

    return <div className="buff-edit-right-placeholder" />;
  };

  const renderCandidateAdderModal = () => {
    if (toolMode !== 'add' || !isCandidateAdderOpen) {
      return null;
    }

    return (
      <div className="skill-button-inline-buff-search-mask" onClick={() => {
        setIsCandidateAdderOpen(false);
        setCandidateSearchKeyword('');
      }}>
        <div
          className="skill-button-inline-buff-search is-workbench-mode buff-edit-candidate-modal"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="skill-button-inline-buff-search-head">
            <h5>{getCandidateAdderModeLabel(candidateAdderMode)}</h5>
            <span>Tab 切换入口 / Esc 关闭</span>
          </div>
          <div className="skill-button-inline-buff-search-modes">
            {CANDIDATE_ADDER_MODE_OPTIONS.map((option) => (
              <button
                key={option.key}
                type="button"
                className={`skill-button-inline-buff-search-mode${candidateAdderMode === option.key ? ' is-active' : ''}`}
                onClick={() => {
                  setCandidateAdderMode(option.key);
                  setCandidateSearchKeyword('');
                }}
              >
                {option.label}
              </button>
            ))}
          </div>
          <div className="skill-button-buff-workbench">
            <div className="skill-button-buff-workbench-main">
              {candidateAdderMode === 'anomaly-state' ? (
                <SkillButtonAnomalyStatePanel
                  activeAnomalyStateOption={anomalyStateWorkbench.activeAnomalyStateOption}
                  activeAnomalyStateLevel={anomalyStateWorkbench.activeAnomalyStateLevel}
                  activeAnomalyStateDurationSeconds={anomalyStateWorkbench.activeAnomalyStateDurationSeconds}
                  activeAnomalyStatePreview={anomalyStateWorkbench.activeAnomalyStatePreview}
                  activeAnomalyStateSourceCharacter={anomalyStateWorkbench.activeAnomalyStateSourceCharacter}
                  sourceCharacters={anomalyStateWorkbench.sourceCharacters}
                  selectedAnomalyStateSnapshots={batchAnomalyStateSnapshots}
                  onSelectAnomalyState={anomalyStateWorkbench.handleSelectAnomalyState}
                  onCreateSnapshot={handleCreateAnomalyStateCandidate}
                  onSetActiveAnomalyStateLevel={anomalyStateWorkbench.setActiveAnomalyStateLevel}
                  onSetActiveAnomalyStateSourceId={anomalyStateWorkbench.setActiveAnomalyStateSourceId}
                  onSetActiveAnomalyStateDurationSeconds={anomalyStateWorkbench.setActiveAnomalyStateDurationSeconds}
                  onRemoveAnomalyStateSnapshotCard={handleDeleteBatchAnomalyStateSnapshot}
                />
              ) : (
                <div className="skill-button-local-buff-panel">
                <input
                  ref={candidateSearchInputRef}
                  className="skill-button-inline-buff-search-input"
                  value={candidateSearchKeyword}
                  onChange={(event) => setCandidateSearchKeyword(event.target.value)}
                  placeholder="搜索组 / 项 / Buff / 类型 / 条件"
                />
                <div className="skill-button-inline-buff-search-results">
                  {candidateSearchKeyword.trim().length === 0 ? (
                    <div className="skill-button-inline-buff-search-empty">
                      输入关键词后再显示{getCandidateAdderModeLabel(candidateAdderMode)}结果
                    </div>
                  ) : candidateSearchResults.length > 0 ? (
                    candidateSearchResults.map((entry) => (
                      <button
                        key={entry.key}
                        type="button"
                        className="skill-button-inline-buff-search-item"
                        onClick={() => handleAddCandidateSearchResult(entry)}
                      >
                        <div className="local-buff-search-item-head">
                          <strong>{entry.displayName}</strong>
                          <span>{entry.effectKind === 'extraHit' ? '额外伤害段' : entry.type || '暂无'}</span>
                        </div>
                        <p>{entry.groupName}{entry.itemName ? ` / ${entry.itemName}` : ''}</p>
                        <p>{entry.effectKind === 'extraHit'
                          ? `倍率: ${((entry.extraHitConfig?.baseMultiplier ?? 0) * 100).toFixed(1)}% / ${entry.extraHitConfig?.damageType || 'physical'} / ${entry.extraHitConfig?.skillType || '空'} / CD ${entry.extraHitConfig?.cooldownSeconds ?? 0}s`
                          : `数值: ${entry.value ?? '-'}${entry.condition ? ` / ${entry.condition}` : ''}`}</p>
                      </button>
                    ))
                  ) : (
                    <div className="skill-button-inline-buff-search-empty">
                      没有匹配到{getCandidateAdderModeLabel(candidateAdderMode)}
                    </div>
                  )}
                </div>
              </div>
              )}
            </div>
            <aside className="skill-button-buff-resource-rail">
              <div className="skill-anomaly-board skill-anomaly-cache-board">
                <div className="skill-anomaly-board-section">
                  <p className="skill-anomaly-board-title">{candidateAdderMode === 'anomaly-state' ? '缓存快照' : '本轮候选 Buff'}</p>
                  <div className="skill-anomaly-board-list skill-anomaly-cache-list">
                    {candidateAdderMode === 'anomaly-state' ? (
                      batchAnomalyStateSnapshots.length === 0 ? (
                        <div className="skill-button-buff-empty">暂无缓存快照</div>
                      ) : (
                        batchAnomalyStateSnapshots.map((snapshot) => (
                          <button
                            key={`available-state-${snapshot.id}`}
                            type="button"
                            className="anomaly-board-card is-state"
                            onClick={() => handleAddAnomalyStateSnapshotCandidate(snapshot)}
                            title="单击加入本轮候选 Buff"
                          >
                            <span className="anomaly-board-card-title">{snapshot.primaryText}</span>
                            <span>{snapshot.sourceCharacterName}</span>
                            <span>{snapshot.secondaryText}</span>
                            <span
                              className="anomaly-board-card-delete-text"
                              onClick={(event) => {
                                event.stopPropagation();
                                handleDeleteBatchAnomalyStateSnapshot(snapshot.id);
                              }}
                            >
                              删除
                            </span>
                          </button>
                        ))
                      )
                    ) : candidateAddBuffs.length === 0 ? (
                      <div className="skill-button-buff-empty">暂无候选 Buff</div>
                    ) : (
                      candidateAddBuffs.map((buff) => (
                        <button
                          key={`candidate-add-modal-${buff.id}`}
                          type="button"
                          className={`anomaly-board-card${activeAddBuffId === buff.id ? ' is-state' : ''}`}
                          onClick={() => setActiveAddBuffId(buff.id)}
                          title="单击设为当前待添加 Buff"
                        >
                          <span className="anomaly-board-card-title">{buff.displayName || buff.name}</span>
                          <span>{buff.sourceName || buff.source || '未知来源'}</span>
                          <span>{getBuffValueLine(buff)}</span>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </aside>
          </div>
        </div>
      </div>
    );
  };

  return (
    <WorkbenchSplitSurface
      rootClassName={`buff-batch-edit-workbench ${isWorkbenchTopZoneOpen ? 'has-top-zone' : ''}${toolMode === 'add' ? ' is-add-mode' : ''}${toolMode === 'remove' ? ' is-remove-mode' : ''}${toolMode === 'edit' ? ' is-edit-mode' : ''}`}
      layoutClassName="buff-edit-layout"
      layoutRef={layoutRef}
      overlay={renderCandidateAdderModal()}
    >
        <section className="canvas-left-zone buff-edit-left-zone">
          <div className="canvas-area buff-edit-canvas-area">
            <div ref={canvasRef} className="canvas-container buff-edit-canvas" style={{ height: canvasHeight }}>
              <div className="buff-edit-tool-layer">
                <button
                  className={`buff-edit-box-select-button${isBoxSelectArmed ? ' is-active' : ''}`}
                  type="button"
                  onClick={() => setIsBoxSelectArmed((value) => !value)}
                  disabled={!['normal', 'add', 'remove'].includes(toolMode)}
                  title="框选技能按钮"
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M5 4h5v2H7v3H5V4Zm9 0h5v5h-2V6h-3V4ZM5 15h2v3h3v2H5v-5Zm12 0h2v5h-5v-2h3v-3ZM9 9h6v6H9V9Z" />
                  </svg>
                </button>
                <button
                  className={`buff-edit-clear-selection-button${toolMode === 'add' || toolMode === 'edit' ? ' is-cancel-add' : ''}${toolMode === 'remove' ? ' is-cancel-remove' : ''}`}
                  type="button"
                  onClick={() => {
                    if (toolMode === 'add') {
                      handleCancelAddMode();
                      return;
                    }
                    if (toolMode === 'remove') {
                      handleCancelRemoveMode();
                      return;
                    }
                    if (toolMode === 'edit') {
                      handleCancelEditMode();
                      return;
                    }
                    setSelectedButtonIds([]);
                    setIsBoxSelectArmed(false);
                    setBoxSelectRect(null);
                  }}
                  disabled={toolMode !== 'normal' && toolMode !== 'add' && toolMode !== 'remove' && toolMode !== 'edit'}
                  title={toolMode === 'add' ? '取消增加' : toolMode === 'remove' ? '取消删减' : toolMode === 'edit' ? '取消编辑' : '取消全部选中'}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12 19 6.4 17.6 5 12 10.6 6.4 5Z" />
                  </svg>
                </button>
                <button
                  className={`buff-edit-filter-button${toolMode === 'filter' ? ' is-active' : ''}`}
                  type="button"
                  onClick={handleToggleFilterMode}
                  disabled={toolMode === 'edit' || toolMode === 'add' || toolMode === 'remove'}
                  title="筛选 Buff"
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M4 5h16l-6.2 7.1V18l-3.6 1.8v-7.7L4 5Zm4.4 2 3.8 4.4v5.2l.6-.3v-4.9L16.6 7H8.4Z" />
                  </svg>
                </button>
                <button
                  className={`buff-edit-mode-button${toolMode === 'edit' ? ' is-confirm-edit' : ''}`}
                  type="button"
                  onClick={handleToggleEditMode}
                  disabled={toolMode === 'filter' || toolMode === 'add' || toolMode === 'remove'}
                  title={toolMode === 'edit' ? '确认编辑' : '编辑目录'}
                >
                  {toolMode === 'edit' ? (
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M9.5 16.6 4.9 12l-1.4 1.4 6 6L21 7.9 19.6 6.5 9.5 16.6Z" />
                    </svg>
                  ) : (
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M5 4h9v2H7v12h10v-7h2v9H5V4Zm11.8.6 2.6 2.6-7.8 7.8H9v-2.6l7.8-7.8Zm1.2 2.6-1.2-1.2L11 11.8V13h1.2L18 7.2Z" />
                    </svg>
                  )}
                </button>
                <button
                  className={`buff-edit-add-button${toolMode === 'add' ? ' is-confirm-add' : ''}`}
                  type="button"
                  onClick={handleToggleAddMode}
                  disabled={toolMode === 'filter' || toolMode === 'edit' || toolMode === 'remove'}
                  title={toolMode === 'add' ? '确认增加' : '增加 Buff'}
                >
                  {toolMode === 'add' ? (
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M9.5 16.6 4.9 12l-1.4 1.4 6 6L21 7.9 19.6 6.5 9.5 16.6Z" />
                    </svg>
                  ) : (
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6V5Z" />
                    </svg>
                  )}
                </button>
                <button
                  className={`buff-edit-remove-button${toolMode === 'remove' ? ' is-confirm-remove' : ''}`}
                  type="button"
                  onClick={handleToggleRemoveMode}
                  disabled={toolMode === 'filter' || toolMode === 'edit' || toolMode === 'add'}
                  title={toolMode === 'remove' ? '确认删减' : '删减 Buff'}
                >
                  {toolMode === 'remove' ? (
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M9.5 16.6 4.9 12l-1.4 1.4 6 6L21 7.9 19.6 6.5 9.5 16.6Z" />
                    </svg>
                  ) : (
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M5 11h14v2H5v-2Z" />
                    </svg>
                  )}
                </button>
              </div>
              <div className="buff-edit-secondary-button-layer" aria-label="左区右侧按钮区">
                {renderRightSideButtons()}
              </div>
              <div className="canvas-grid-shell">
                <div className="canvas-grid-stack">
                  <div className="canvas-left-top-spacer" aria-hidden="true" />
                  {Array.from({ length: staffGroupCount }, (_, staffIndex) => renderGridGroup(staffIndex))}
                </div>
              </div>
              <div className="buff-edit-mask" />
              <div className="buff-edit-button-layer" aria-label="Buff 批量编辑按钮选择层">
                {skillButtons.map(renderSkillButton)}
              </div>
              {isBoxSelectArmed ? (
                <div
                  className={`buff-edit-box-select-layer${boxSelectRect ? ' is-dragging' : ''}`}
                  onMouseDown={handleBoxSelectMouseDown}
                >
                  {normalizedBoxSelectRect ? (
                    <div
                      className="buff-edit-box-select-rect"
                      style={{
                        left: normalizedBoxSelectRect.left,
                        top: normalizedBoxSelectRect.top,
                        width: normalizedBoxSelectRect.width,
                        height: normalizedBoxSelectRect.height,
                      }}
                    />
                  ) : null}
                </div>
              ) : null}
              {skillButtons.length === 0 ? (
                <div className="buff-edit-empty">当前没有可选择的技能按钮</div>
              ) : null}
            </div>
          </div>
        </section>

        <aside className="canvas-right-zone buff-edit-right-zone">
          {renderRightPanel()}
        </aside>

        <div className="canvas-bottom-zone buff-edit-bottom-bar">
          <div className="canvas-bottom-zone-left">
            {workbenchControl}
            <div className="buff-edit-selection-counter">已选 {selectedButtonIds.length}/{skillButtons.length}</div>
          </div>
          <div className="canvas-bottom-zone-center" />
          <div className="canvas-bottom-zone-right">
            {bottomRightControl}
          </div>
        </div>
    </WorkbenchSplitSurface>
  );
}
