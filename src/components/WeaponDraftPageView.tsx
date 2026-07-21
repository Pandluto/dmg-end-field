import './BuffDraftPage.css';
import './OperatorDraftPage.css';
import { APP_ROUTE_PATHS, navigateToAppPath } from '../utils/appRoute';
import { normalizeAssetUrl } from '../utils/assetResolver';
import DeferredNumberInput from './DeferredNumberInput';
import BuffEffectEditorDrawer from './BuffEffectEditorDrawer';

import * as weaponDraftPageModel from './weaponDraftPageModel';
type WeaponSheetRow = weaponDraftPageModel.WeaponSheetRow;
type WeaponExplorerDragNode = weaponDraftPageModel.WeaponExplorerDragNode;
type WeaponWorkbookRow = weaponDraftPageModel.WeaponWorkbookRow;


const {
  SKILL_KEYS,
  LEVEL_KEYS,
  ATTACK_GROWTH_MILESTONE_KEYS,
  normalizeWeaponDraft,
  applyWeaponDrawerEffect,
  getBuffTypeDisplayLabel,
  stopEditingKeyPropagation,
  buildWeaponSheetRows,
  columnIndexToLabel,
  getWeaponWorkbookRowClassName,
} = weaponDraftPageModel;

import type { WeaponDraftPageController } from './useWeaponDraftPageController';

export function WeaponDraftPageView(props: WeaponDraftPageController) {
  const {
    draft,
    setDraft,
    selectedLocalDraftId,
    filterKeyword,
    setFilterKeyword,
    weaponImageLoadFailed,
    setWeaponImageLoadFailed,
    selectedWorkbookCell,
    setSelectedWorkbookCell,
    setPendingFocusRowKey,
    inlineEditingCellKey,
    setInlineEditingCellKey,
    inlineEditingValue,
    setInlineEditingValue,
    isOverwriteProtectionEnabled,
    setIsOverwriteProtectionEnabled,
    isOverwriteDraftModalOpen,
    setIsOverwriteDraftModalOpen,
    shareImportError,
    setShareImportError,
    pendingImportShare,
    isShareModalOpen,
    shareModalMode,
    setShareModalMode,
    shareImportText,
    setShareImportText,
    exportScope,
    setExportScope,
    contextMenu,
    setContextMenu,
    dragState,
    buffDrawerTarget,
    setBuffDrawerTarget,
    shareImportInputRef,
    suppressExplorerClickRef,
    columns,
    workbookRows,
    selectedSummaryKey,
    projectedDrawerEffect,
    openWeaponBuffDrawer,
    handleSaveDraft,
    handleNormalizeDraft,
    handleConfirmOverwriteDraft,
    handleCreateNewDraft,
    handleLoadLocalDraft,
    setDraftCollapsed,
    setSkillCollapsed,
    setLevelCollapsed,
    isExplorerDraftCollapsed,
    isExplorerSkillCollapsed,
    isExplorerLevelCollapsed,
    handleAttackGrowthChange,
    handleEffectLevelCommit,
    currentShareText,
    openShareModal,
    closeShareModal,
    handleCopyShareJson,
    handleExportLocalLibrary,
    handleOpenShareImportPicker,
    handleParseImportText,
    handleCancelImportShare,
    handleShareFileSelected,
    handleConfirmImportShare,
    openContextMenu,
    openWorkbookContextMenu,
    currentContextMenuActions,
    filteredExplorerEntries,
    getExplorerDragNodeKey,
    getExplorerDragNodeLabel,
    canStartExplorerDrag,
    handleExplorerPointerDown,
    formatWeaponExplorerDragKindLabel,
    formulaBinding,
    setFormulaInput,
    buffTypeQuery,
    setBuffTypeQuery,
    filteredBuffTypeOptions,
    weaponImageFormulaRef,
    weaponImageQuery,
    setWeaponImageQuery,
    isWeaponImageDrawerOpen,
    setIsWeaponImageDrawerOpen,
    imageAssetsLoading,
    imageAssetsError,
    filteredWeaponImageOptions,
    handleSelectWeaponImage,
    handleClearWeaponImage,
    formulaInput,
    commitFormulaInput,
    toggleSkillCollapsed,
    activeDraftId,
    collapsedSkills,
    toggleLevelCollapsed,
    collapsedLevels,
  } = props;
  const renderFormulaEditor = () => {
    if (!formulaBinding) {
      return <div className="damage-sheet-formula-value">{draft.description || 'Sheet-Weapon workbook'}</div>;
    }

    if (formulaBinding.control === 'select') {
      return (
        <select
          data-formula-focus-id={formulaBinding.focusId}
          className="buff-sheet-formula-input is-select"
          value={formulaBinding.value}
          onChange={(event) => {
            const nextValue = event.target.value;
            setFormulaInput(nextValue);
            formulaBinding.onValueChange?.(nextValue);
            const nextDraft = normalizeWeaponDraft(formulaBinding.apply(draft, nextValue));
            if (nextDraft !== draft) {
              setDraft(nextDraft);
            }
          }}
        >
          {(formulaBinding.options ?? []).map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      );
    }

    if (formulaBinding.control === 'search-select') {
      return (
        <div className="buff-sheet-formula-type-editor">
          <input
            data-formula-focus-id={`${formulaBinding.focusId}-search`}
            className="buff-sheet-formula-input buff-sheet-formula-type-search"
            value={buffTypeQuery}
            onChange={(event) => setBuffTypeQuery(event.target.value)}
            placeholder="搜索类型：法术 / 异伤 / 倍率 / 源石技艺"
          />
          <select
            data-formula-focus-id={`${formulaBinding.focusId}-select`}
            className="buff-sheet-formula-input is-select buff-sheet-formula-type-select"
            value={formulaBinding.value}
            onChange={(event) => {
              const nextValue = event.target.value;
              setFormulaInput(nextValue);
              const nextDraft = normalizeWeaponDraft(formulaBinding.apply(draft, nextValue));
              if (nextDraft !== draft) {
                setDraft(nextDraft);
              }
            }}
          >
            {(formulaBinding.options ?? []).slice(0, 1).map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
            {filteredBuffTypeOptions.map((option) => (
              <option key={option} value={option}>{getBuffTypeDisplayLabel(option)}</option>
            ))}
          </select>
        </div>
      );
    }

    if (formulaBinding.control === 'image-search-select') {
      return (
        <div className="weapon-sheet-image-formula-editor" ref={weaponImageFormulaRef}>
          <input
            data-formula-focus-id={`${formulaBinding.focusId}-search`}
            className="buff-sheet-formula-input weapon-sheet-image-formula-search"
            value={weaponImageQuery}
            onChange={(event) => setWeaponImageQuery(event.target.value)}
            onClick={() => setIsWeaponImageDrawerOpen(true)}
            placeholder="搜索图片：文件名 / baseName / 路径 / URL"
          />
          {isWeaponImageDrawerOpen ? (
            <div className="weapon-sheet-image-formula-results">
            <div className="weapon-sheet-image-formula-toolbar">
              <button
                type="button"
                className={`weapon-sheet-image-option weapon-sheet-image-option-clear${!draft.imgUrl ? ' is-active' : ''}`}
                onClick={() => handleClearWeaponImage()}
              >
                <span className="weapon-sheet-image-option-thumb weapon-sheet-image-option-thumb-empty">无图</span>
                <span className="weapon-sheet-image-option-meta">
                  <strong>清空主图</strong>
                  <span>移除当前武器顶层 imgUrl</span>
                </span>
              </button>
            </div>
            {imageAssetsLoading ? (
              <div className="weapon-sheet-image-picker-empty">图片资源加载中…</div>
            ) : imageAssetsError ? (
              <div className="weapon-sheet-image-picker-empty">图片资源加载失败：{imageAssetsError}</div>
            ) : filteredWeaponImageOptions.length === 0 ? (
              <div className="weapon-sheet-image-picker-empty">没有匹配的图片</div>
            ) : (
              <div className="weapon-sheet-image-picker-list">
                {filteredWeaponImageOptions.map((option) => (
                  <button
                    key={option.key}
                    type="button"
                    className={`weapon-sheet-image-option${draft.imgUrl === option.displayUrl ? ' is-active' : ''}`}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => handleSelectWeaponImage(option.displayUrl)}
                  >
                    <span className="weapon-sheet-image-option-thumb">
                      <img src={option.displayUrl} alt={option.fileName} />
                    </span>
                    <span className="weapon-sheet-image-option-meta">
                      <strong>{option.fileName}</strong>
                      <span>{option.relativePath}</span>
                      <em>{option.source === 'user' ? 'user' : 'builtin'}</em>
                    </span>
                  </button>
                ))}
              </div>
            )}
            </div>
          ) : null}
        </div>
      );
    }

    if (formulaBinding.readOnly) {
      return (
        <input
          data-formula-focus-id={formulaBinding.focusId}
          className="buff-sheet-formula-input"
          type="text"
          value={formulaBinding.value}
          readOnly
        />
      );
    }

    return (
      <input
        data-formula-focus-id={formulaBinding.focusId}
        className="buff-sheet-formula-input"
        type={formulaBinding.inputMode === 'number' ? 'number' : 'text'}
        value={formulaInput}
        onChange={(event) => setFormulaInput(event.target.value)}
        onBlur={() => {
          const nextDraft = commitFormulaInput(draft);
          if (nextDraft !== draft) {
            setDraft(nextDraft);
          }
        }}
        onKeyDown={(event) => {
          // 拦截方向键、Backspace 等，防止冒泡到外层的表格导航逻辑
          stopEditingKeyPropagation(event, { isNumberInput: formulaBinding.inputMode === 'number' });

          if (event.key === 'Enter') {
            const nextDraft = commitFormulaInput(draft);
            if (nextDraft !== draft) {
              setDraft(nextDraft);
            }
            event.currentTarget.blur();
          }
          if (event.key === 'Escape') {
            setFormulaInput(formulaBinding.value);
            event.currentTarget.blur();
          }
        }}
        placeholder={formulaBinding.placeholder}
      />
    );
  };

  const renderRowNumberContent = (row: WeaponWorkbookRow) => {
    const sourceRow = row.sourceRow;
    if (sourceRow.kind === 'skill') {
      return (
        <button
          type="button"
          className="damage-sheet-row-toggle"
          onClick={() => toggleSkillCollapsed(activeDraftId, sourceRow.skillKey)}
        >
          {collapsedSkills[`${activeDraftId}:${sourceRow.skillKey}`] ? '[+]' : '[-]'}
        </button>
      );
    }

    if (sourceRow.kind === 'effect') {
      return (
        <button
          type="button"
          className="damage-sheet-row-toggle"
          onClick={() => toggleLevelCollapsed(activeDraftId, sourceRow.skillKey, sourceRow.bucket, sourceRow.sourceEffectKey)}
        >
          {collapsedLevels[`${activeDraftId}:${sourceRow.skillKey}:${sourceRow.bucket}:${sourceRow.sourceEffectKey}`] ? '[+]' : '[-]'}
        </button>
      );
    }

    return row.rowNumber;
  };

  return (
    <main className="damage-sheet-page buff-sheet-page weapon-sheet-page">
      <header className="damage-sheet-topbar">
        <div className="damage-sheet-topbar-left">
          <button type="button" className="damage-sheet-back-button" onClick={() => navigateToAppPath(APP_ROUTE_PATHS.home)}>
            返回
          </button>
          <div className="damage-sheet-title-block">
            <h1>Sheet-Weapon</h1>
            <p>武器档案工作表 · 按 weapon → skill → level → effect 编辑</p>
          </div>
        </div>
        <div className="damage-sheet-topbar-right">
          <button type="button" className="damage-sheet-action-button" onClick={() => navigateToAppPath(APP_ROUTE_PATHS.buffSheet)}>
            打开 Sheet-Buff
          </button>
        </div>
      </header>

      <section className="damage-sheet-ribbon buff-sheet-ribbon">
        <div className="buff-sheet-ribbon-actions">
          <button type="button" className="buff-sheet-tool-button" onClick={handleCreateNewDraft} title="新建武器">
            <span className="buff-sheet-tool-icon" aria-hidden="true">
              <svg className="buff-sheet-tool-svg" viewBox="0 0 16 16" focusable="false">
                <path d="M8 3.25v9.5M3.25 8h9.5" />
              </svg>
            </span>
            <span className="buff-sheet-tool-text">新建</span>
          </button>
          <button type="button" className="buff-sheet-tool-button" onClick={handleSaveDraft} title="保存当前武器">
            <span className="buff-sheet-tool-icon" aria-hidden="true">
              <svg className="buff-sheet-tool-svg" viewBox="0 0 16 16" focusable="false">
                <path d="M3.25 2.75h7.5l2.25 2.25v8.25H3.25z" />
                <path d="M5.25 2.75v3.5h4.5v-3.5M5.25 10.25h5.5" />
              </svg>
            </span>
            <span className="buff-sheet-tool-text">保存</span>
          </button>
          <button type="button" className="buff-sheet-tool-button" onClick={handleNormalizeDraft} title="整理技能与效果顺序">
            <span className="buff-sheet-tool-icon" aria-hidden="true">
              <svg className="buff-sheet-tool-svg" viewBox="0 0 16 16" focusable="false">
                <path d="M4 4.5h7.5M4 8h5.5M4 11.5h7.5" />
                <path d="M11 3.25l1.75 1.25L11 5.75" />
              </svg>
            </span>
            <span className="buff-sheet-tool-text">整理</span>
          </button>
          <button
            type="button"
            className={`buff-sheet-tool-button${isOverwriteProtectionEnabled ? ' is-active' : ''}`}
            onClick={() => setIsOverwriteProtectionEnabled((prev) => !prev)}
            title="切换覆盖保护"
          >
            <span className="buff-sheet-tool-icon" aria-hidden="true">
              <svg className="buff-sheet-tool-svg" viewBox="0 0 16 16" focusable="false">
                <path d="M8 2.5l4 1.5v3.25c0 2.5-1.5 4.75-4 6.25-2.5-1.5-4-3.75-4-6.25V4z" />
                <path d="M6.25 8.25L7.4 9.4l2.35-2.55" />
              </svg>
            </span>
            <span className="buff-sheet-tool-text">{isOverwriteProtectionEnabled ? '保护开' : '保护关'}</span>
          </button>
          <button type="button" className="buff-sheet-tool-button" onClick={() => openShareModal('export')} title="导出本地武器库">
            <span className="buff-sheet-tool-icon" aria-hidden="true">
              <svg className="buff-sheet-tool-svg" viewBox="0 0 16 16" focusable="false">
                <path d="M8 3v6.5" />
                <path d="M5.75 7.25L8 9.5l2.25-2.25" />
                <path d="M3.5 11.75h9" />
              </svg>
            </span>
            <span className="buff-sheet-tool-text">导出</span>
          </button>
          <button type="button" className="buff-sheet-tool-button" onClick={() => openShareModal('import')} title="导入武器分享">
            <span className="buff-sheet-tool-icon" aria-hidden="true">
              <svg className="buff-sheet-tool-svg" viewBox="0 0 16 16" focusable="false">
                <path d="M8 13V6.5" />
                <path d="M5.75 8.75L8 6.5l2.25 2.25" />
                <path d="M3.5 3.25h9" />
              </svg>
            </span>
            <span className="buff-sheet-tool-text">导入</span>
          </button>
        </div>

        <div className={`weapon-sheet-image-slot${draft.imgUrl ? ' has-image' : ''}${weaponImageLoadFailed ? ' is-broken' : ''}`} title={draft.imgUrl || '武器主图预览'}>
          <div className="weapon-sheet-image-slot-square">
            {draft.imgUrl && !weaponImageLoadFailed ? (
              <img
                className="weapon-sheet-image-preview"
                src={normalizeAssetUrl(draft.imgUrl)}
                alt={draft.name || '武器主图'}
                onError={() => setWeaponImageLoadFailed(true)}
              />
            ) : null}
            {draft.imgUrl && weaponImageLoadFailed ? (
              <span className="weapon-sheet-image-fallback">加载失败</span>
            ) : null}
            {!draft.imgUrl ? (
              <span className="weapon-sheet-image-fallback">主图</span>
            ) : null}
          </div>
        </div>

        <div className="damage-sheet-formula-bar">
          <span className="damage-sheet-formula-address">{selectedWorkbookCell?.address ?? '-'}</span>
          <span className="damage-sheet-formula-label">fx</span>
          {renderFormulaEditor()}
        </div>
      </section>

      <main className="damage-sheet-workspace weapon-sheet-workspace">
        <aside
          className="damage-sheet-sidebar buff-sheet-explorer"
          onContextMenu={(event) => openContextMenu(event, {
            x: event.clientX,
            y: event.clientY,
            target: 'blank',
          })}
        >
          <div className="damage-sheet-sidebar-title">资源管理器</div>
          <input
            className="buff-sheet-search-input"
            value={filterKeyword}
            onChange={(event) => setFilterKeyword(event.target.value)}
            placeholder="按武器名称搜索"
          />
          <input
            ref={shareImportInputRef}
            type="file"
            accept=".json,application/json"
            className="operator-draft-file-input"
            onChange={handleShareFileSelected}
          />
          <div className="buff-sheet-explorer-tree">
            {filteredExplorerEntries.length === 0 ? (
              <div className="damage-sheet-detail-empty">当前还没有本地保存的武器。</div>
            ) : filteredExplorerEntries.map((entry) => {
              const explorerDraft = entry.id === selectedLocalDraftId ? draft : entry;
              const isDraftCollapsed = isExplorerDraftCollapsed(entry.id);
              const draftDragNode: WeaponExplorerDragNode = { kind: 'draft', draftId: entry.id };
              const draftDragKey = getExplorerDragNodeKey(draftDragNode);
              return (
                <div key={entry.id} className="buff-sheet-explorer-node">
                  <button
                    type="button"
                    className={`buff-sheet-explorer-row${selectedLocalDraftId === entry.id ? ' is-active' : ''}${dragState?.source && getExplorerDragNodeKey(dragState.source) === draftDragKey ? ' is-drag-source' : ''}${dragState?.over && getExplorerDragNodeKey(dragState.over) === draftDragKey ? ' is-drag-target' : ''}${canStartExplorerDrag(draftDragNode) ? ' is-draggable' : ''}`}
                    data-weapon-drag-kind="draft"
                    data-weapon-draft-id={entry.id}
                    onPointerDown={(event) => handleExplorerPointerDown(event, draftDragNode)}
                    onClick={() => {
                      if (suppressExplorerClickRef.current) {
                        suppressExplorerClickRef.current = false;
                        return;
                      }
                      handleLoadLocalDraft(entry.id);
                    }}
                    onContextMenu={(event) => openContextMenu(event, {
                      x: event.clientX,
                      y: event.clientY,
                      target: 'draft',
                      draftId: entry.id,
                    })}
                  >
                    <span
                      className="damage-sheet-row-toggle buff-sheet-explorer-toggle"
                      onClick={(event) => {
                        event.stopPropagation();
                        setDraftCollapsed(entry.id, !isDraftCollapsed);
                      }}
                    >
                      {isDraftCollapsed ? '[+]' : '[-]'}
                    </span>
                    <span className="buff-sheet-explorer-label">{explorerDraft.name}</span>
                  </button>
                  {!isDraftCollapsed ? (
                    <div className="buff-sheet-explorer-children">
                      {SKILL_KEYS.map((skillKey) => {
                        const isSkillCollapsed = isExplorerSkillCollapsed(entry.id, skillKey);
                        const effectRows = buildWeaponSheetRows(explorerDraft)
                          .filter((row): row is Extract<WeaponSheetRow, { kind: 'effect' }> => row.kind === 'effect')
                          .filter((row) => row.skillKey === skillKey);
                        const skillDragNode: WeaponExplorerDragNode = { kind: 'skill', draftId: entry.id, skillKey };
                        const skillDragKey = getExplorerDragNodeKey(skillDragNode);
                        return (
                          <div key={`${entry.id}-${skillKey}`} className="buff-sheet-explorer-node">
                            <button
                              type="button"
                              className={`buff-sheet-explorer-child${selectedLocalDraftId === entry.id && selectedSummaryKey === `skill-${skillKey}` ? ' is-active' : ''}${dragState?.source && getExplorerDragNodeKey(dragState.source) === skillDragKey ? ' is-drag-source' : ''}${dragState?.over && getExplorerDragNodeKey(dragState.over) === skillDragKey ? ' is-drag-target' : ''}${canStartExplorerDrag(skillDragNode) ? ' is-draggable' : ''}`}
                              data-weapon-drag-kind="skill"
                              data-weapon-draft-id={entry.id}
                              data-weapon-skill-key={skillKey}
                              onPointerDown={(event) => handleExplorerPointerDown(event, skillDragNode)}
                              onClick={() => {
                                if (suppressExplorerClickRef.current) {
                                  suppressExplorerClickRef.current = false;
                                  return;
                                }
                                handleLoadLocalDraft(entry.id);
                                setPendingFocusRowKey(`skill-${skillKey}`);
                              }}
                              onContextMenu={(event) => openContextMenu(event, {
                                x: event.clientX,
                                y: event.clientY,
                                target: 'skill',
                                draftId: entry.id,
                                skillKey,
                              })}
                            >
                              <span
                                className="damage-sheet-row-toggle buff-sheet-explorer-toggle"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setSkillCollapsed(entry.id, skillKey, !isSkillCollapsed);
                                }}
                              >
                                {isSkillCollapsed ? '[+]' : '[-]'}
                              </span>
                              <span className="buff-sheet-explorer-label">{getExplorerDragNodeLabel(skillDragNode)}</span>
                            </button>
                            {!isSkillCollapsed ? (
                              <div className="buff-sheet-explorer-children">
                                {effectRows.map((row) => {
                                  const isEffectCollapsed = isExplorerLevelCollapsed(entry.id, skillKey, row.bucket, row.sourceEffectKey);
                                  const effectDragNode: WeaponExplorerDragNode = { kind: 'effect', draftId: entry.id, skillKey, bucket: row.bucket, effectKey: row.sourceEffectKey };
                                  const effectDragKey = getExplorerDragNodeKey(effectDragNode);
                                  return (
                                    <div key={`${entry.id}-${row.key}`} className="buff-sheet-explorer-node">
                                      <button
                                        type="button"
                                        className={`buff-sheet-explorer-effect${selectedLocalDraftId === entry.id && selectedSummaryKey === row.key ? ' is-active' : ''}${dragState?.source && getExplorerDragNodeKey(dragState.source) === effectDragKey ? ' is-drag-source' : ''}${dragState?.over && getExplorerDragNodeKey(dragState.over) === effectDragKey ? ' is-drag-target' : ''}${canStartExplorerDrag(effectDragNode) ? ' is-draggable' : ''}`}
                                        data-weapon-drag-kind="effect"
                                        data-weapon-draft-id={entry.id}
                                        data-weapon-skill-key={skillKey}
                                        data-weapon-bucket={row.bucket}
                                        data-weapon-effect-key={row.sourceEffectKey}
                                        onPointerDown={(event) => handleExplorerPointerDown(event, effectDragNode)}
                                        onClick={() => {
                                          if (suppressExplorerClickRef.current) {
                                            suppressExplorerClickRef.current = false;
                                            return;
                                          }
                                          handleLoadLocalDraft(entry.id);
                                          setPendingFocusRowKey(row.key);
                                        }}
                                        onContextMenu={(event) => openContextMenu(event, {
                                          x: event.clientX,
                                          y: event.clientY,
                                          target: 'effect',
                                          draftId: entry.id,
                                          skillKey,
                                          effectKey: row.sourceEffectKey,
                                          bucket: row.bucket,
                                        })}
                                      >
                                        <span
                                          className="damage-sheet-row-toggle buff-sheet-explorer-toggle"
                                          onClick={(event) => {
                                            event.stopPropagation();
                                            setLevelCollapsed(entry.id, skillKey, row.bucket, row.sourceEffectKey, !isEffectCollapsed);
                                          }}
                                        >
                                          {isEffectCollapsed ? '[+]' : '[-]'}
                                        </span>
                                        {/* 资源管理器这里显示 effect.name（已映射到 row.title），不能直接用 row.effectKey，否则会退回成 effect1/effect2。 */}
                                        <span className="buff-sheet-explorer-label">{row.title}</span>
                                        <span className="buff-sheet-explorer-count">Lv1~Lv9</span>
                                      </button>
                                    </div>
                                  );
                                })}
                              </div>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>

          {shareImportError ? <div className="buff-sheet-share-feedback is-error">{shareImportError}</div> : null}
        </aside>

        <section className="damage-sheet-excel-shell">
          <div
            className="damage-sheet-excel-scroll"
            onContextMenu={(event) => openWorkbookContextMenu(event)}
          >
            <div className="damage-sheet-excel-row is-header">
              <div className="damage-sheet-excel-row-number">#</div>
              <div className="damage-sheet-excel-row-cells">
                {columns.map((column) => (
                  <div
                    key={column.key}
                    className={`damage-sheet-excel-cell is-header is-${column.align ?? 'left'}`}
                    style={{ width: `${column.width}px` }}
                  >
                    {column.title}
                  </div>
                ))}
              </div>
            </div>
            {workbookRows.map((row) => (
              <div
                key={row.key}
                className={getWeaponWorkbookRowClassName(row)}
                onContextMenu={(event) => openWorkbookContextMenu(event, row.sourceRow)}
                onDoubleClick={() => {
                  const sourceRow = row.sourceRow;
                  if (sourceRow.kind === 'effect' && sourceRow.skillKey === 'skill3' && sourceRow.bucket === 'effect') {
                    openWeaponBuffDrawer(sourceRow.skillKey, sourceRow.sourceEffectKey);
                  }
                  if (sourceRow.kind === 'effectLevels' && sourceRow.skillKey === 'skill3' && sourceRow.bucket === 'effect') {
                    openWeaponBuffDrawer(sourceRow.skillKey, sourceRow.sourceEffectKey);
                  }
                }}
              >
                <div
                  className="damage-sheet-excel-row-number"
                  onContextMenu={(event) => openWorkbookContextMenu(event, row.sourceRow)}
                >
                  {renderRowNumberContent(row)}
                </div>
                <div className="damage-sheet-excel-row-cells">
                  {row.sourceRow.kind === 'growth' ? (
                    <div
                      className="damage-sheet-excel-cell is-growth is-left weapon-sheet-growth-merged-cell"
                      style={{ width: `${columns.reduce((sum, column) => sum + column.width, 0)}px` }}
                      onContextMenu={(event) => openWorkbookContextMenu(event, row.sourceRow, {
                        address: `${columnIndexToLabel(0)}${row.rowNumber}`,
                        sourceRowKey: row.sourceRow.key,
                        columnKey: 'name',
                      })}
                    >
                      <div className="weapon-sheet-growth-inline-grid">
                        {ATTACK_GROWTH_MILESTONE_KEYS.map((levelKey) => (
                          <div key={levelKey} className="weapon-sheet-growth-inline-item">
                            <span className="weapon-sheet-growth-inline-label">{`Lv${levelKey}`}</span>
                            <DeferredNumberInput
                              className="weapon-sheet-inline-input"
                              step="any"
                              value={draft.attackGrowth[levelKey]}
                              placeholder="ATK"
                              onClick={(event) => event.stopPropagation()}
                              onCommit={(value) => handleAttackGrowthChange(levelKey, value)}
                              onKeyDown={(event) => stopEditingKeyPropagation(event, { isNumberInput: true })}
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : row.sourceRow.kind === 'effectLevels' ? (
                    <div
                      className="damage-sheet-excel-cell is-effectLevels is-left weapon-sheet-growth-merged-cell"
                      style={{ width: `${columns.reduce((sum, column) => sum + column.width, 0)}px` }}
                    >
                      <div className="weapon-sheet-growth-inline-grid weapon-sheet-levels-inline-grid">
                        {LEVEL_KEYS.map((levelKey) => {
                          const sourceRow = row.sourceRow as Extract<WeaponSheetRow, { kind: 'effectLevels' }>;
                          const value = sourceRow.bucket === 'value'
                            ? draft.skills[sourceRow.skillKey].levels[levelKey]?.value
                            : draft.skills[sourceRow.skillKey].effects[sourceRow.sourceEffectKey]?.levels[levelKey];
                          const inlineAddress = `Lv${levelKey}`;
                          const isInlineActive = selectedWorkbookCell?.sourceRowKey === sourceRow.key && selectedWorkbookCell.address === inlineAddress;
                          return (
                            <div key={levelKey} className={`weapon-sheet-growth-inline-item${isInlineActive ? ' is-active' : ''}`}>
                              <span className="weapon-sheet-growth-inline-label">{`Lv${levelKey}`}</span>
                              <DeferredNumberInput
                                className="weapon-sheet-inline-input"
                                step="any"
                                value={value}
                                placeholder=""
                                onFocus={() => {
                                  setSelectedWorkbookCell({
                                    address: inlineAddress,
                                    sourceRowKey: sourceRow.key,
                                    columnKey: 'valueText',
                                  });
                                }}
                                onCommit={(nextValue) => handleEffectLevelCommit(sourceRow, levelKey, nextValue)}
                                onKeyDown={(event) => stopEditingKeyPropagation(event, { isNumberInput: true })}
                              />
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ) : row.cells.map((cell) => {
                    const isSkillNameCell = row.sourceRow.kind === 'skill' && cell.columnKey === 'name';
                    if (isSkillNameCell) {
                      return (
                        <div
                          key={cell.key}
                          className={`damage-sheet-excel-cell is-${row.kind} is-${cell.align}${selectedWorkbookCell?.address === cell.address ? ' is-active' : ''}`}
                          style={{ width: `${cell.width}px` }}
                          onContextMenu={(event) => openWorkbookContextMenu(event, row.sourceRow, {
                            address: cell.address,
                            sourceRowKey: cell.sourceRowKey,
                            columnKey: cell.columnKey,
                          })}
                        >
                          <input
                            className="weapon-sheet-inline-input"
                            type="text"
                            value={inlineEditingCellKey === cell.key ? inlineEditingValue : cell.value}
                            onFocus={() => {
                              setInlineEditingCellKey(cell.key);
                              setInlineEditingValue(cell.value);
                              setSelectedWorkbookCell({
                                address: cell.address,
                                sourceRowKey: cell.sourceRowKey,
                                columnKey: cell.columnKey,
                              });
                            }}
                            onChange={(event) => setInlineEditingValue(event.target.value)}
                            onBlur={() => {
                              if (inlineEditingCellKey === cell.key) {
                                const newName = inlineEditingValue.trim();
                                if (newName && row.sourceRow.kind === 'skill') {
                                  const skillKey = row.sourceRow.skillKey;
                                  setDraft((prev) => normalizeWeaponDraft({
                                    ...prev,
                                    skills: {
                                      ...prev.skills,
                                      [skillKey]: {
                                        ...prev.skills[skillKey],
                                        name: newName,
                                      },
                                    },
                                  }));
                                }
                                setInlineEditingCellKey(null);
                              }
                            }}
                            onKeyDown={(event) => {
                              // 拦截方向键、Backspace 等，防止冒泡到外层的表格导航逻辑
                              stopEditingKeyPropagation(event, { isNumberInput: false });

                              if (event.key === 'Enter') {
                                event.currentTarget.blur();
                              }
                              if (event.key === 'Escape') {
                                setInlineEditingCellKey(null);
                              }
                            }}
                          />
                        </div>
                      );
                    }
                    return (
                      <div
                        key={cell.key}
                        className={`damage-sheet-excel-cell is-${row.kind} is-${cell.align}${selectedWorkbookCell?.address === cell.address ? ' is-active' : ''}`}
                        style={{ width: `${cell.width}px` }}
                        onClick={() => {
                          setSelectedWorkbookCell({
                            address: cell.address,
                            sourceRowKey: cell.sourceRowKey,
                            columnKey: cell.columnKey,
                          });
                        }}
                        onContextMenu={(event) => openWorkbookContextMenu(event, row.sourceRow, {
                          address: cell.address,
                          sourceRowKey: cell.sourceRowKey,
                          columnKey: cell.columnKey,
                        })}
                      >
                        {cell.value}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </section>
      </main>

      <BuffEffectEditorDrawer
        open={Boolean(buffDrawerTarget && projectedDrawerEffect)}
        sourceLabel={`武器 Skill3 · ${draft.name}`}
        effect={projectedDrawerEffect}
        levelOptions={LEVEL_KEYS.map((levelKey) => ({ key: levelKey, label: `Lv${levelKey}` }))}
        activeLevelKey={buffDrawerTarget?.levelKey}
        onActiveLevelChange={(levelKey) => setBuffDrawerTarget((current) => current ? { ...current, levelKey } : current)}
        onChange={(nextEffect) => {
          if (!buffDrawerTarget) return;
          setDraft((prev) => normalizeWeaponDraft({
            ...prev,
            skills: {
              ...prev.skills,
              [buffDrawerTarget.skillKey]: {
                ...prev.skills[buffDrawerTarget.skillKey],
                effects: {
                  ...prev.skills[buffDrawerTarget.skillKey].effects,
                  [buffDrawerTarget.effectKey]: applyWeaponDrawerEffect(
                    prev.skills[buffDrawerTarget.skillKey].effects[buffDrawerTarget.effectKey],
                    buffDrawerTarget.levelKey,
                    nextEffect,
                  ),
                },
              },
            },
          }));
        }}
        onClose={() => setBuffDrawerTarget(null)}
      />

      {isOverwriteDraftModalOpen ? (
        <div className="operator-draft-modal-overlay" onClick={() => setIsOverwriteDraftModalOpen(false)}>
          <div className="operator-draft-modal operator-draft-confirm-modal" onClick={(event) => event.stopPropagation()}>
            <div className="operator-draft-section-header">
              <div>
                <h3>确认覆盖本地武器</h3>
                <p>当前 ID 已存在于本地武器库中。</p>
              </div>
            </div>
            <div className="operator-draft-confirm-body">
              <strong>{draft.name || draft.id || '未命名武器'}</strong>
              <p>保护开启时，确认后会用当前 Sheet-Weapon 编辑内容覆盖同 ID 武器。</p>
            </div>
            <div className="operator-draft-modal-actions">
              <button type="button" className="operator-draft-ghost-button" onClick={() => setIsOverwriteDraftModalOpen(false)}>
                取消
              </button>
              <button type="button" className="operator-draft-copy-button operator-draft-danger-button" onClick={handleConfirmOverwriteDraft}>
                确认覆盖
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {isShareModalOpen ? (
        <div className="buff-sheet-share-modal-mask" onClick={closeShareModal}>
          <div className="buff-sheet-share-modal" onClick={(event) => event.stopPropagation()}>
            <div className="buff-sheet-share-modal-header">
              <div className="buff-sheet-share-modal-tabs">
                <button
                  type="button"
                  className={`buff-sheet-share-modal-tab${shareModalMode === 'export' ? ' is-active' : ''}`}
                  onClick={() => setShareModalMode('export')}
                >
                  导出
                </button>
                <button
                  type="button"
                  className={`buff-sheet-share-modal-tab${shareModalMode === 'import' ? ' is-active' : ''}`}
                  onClick={() => setShareModalMode('import')}
                >
                  导入
                </button>
              </div>
              <button type="button" className="buff-sheet-share-modal-close" onClick={closeShareModal} aria-label="关闭">
                ×
              </button>
            </div>
            {shareModalMode === 'export' ? (
              <div className="buff-sheet-share-modal-body">
                <div className="buff-sheet-share-modal-copybar">
                  <div className="buff-sheet-share-modal-tabs">
                    <button
                      type="button"
                      className={`buff-sheet-share-modal-tab${exportScope === 'current' ? ' is-active' : ''}`}
                      onClick={() => setExportScope('current')}
                    >
                      导出当前
                    </button>
                    <button
                      type="button"
                      className={`buff-sheet-share-modal-tab${exportScope === 'all' ? ' is-active' : ''}`}
                      onClick={() => setExportScope('all')}
                    >
                      导出全部
                    </button>
                  </div>
                  <div className="buff-sheet-share-modal-actions">
                    <button type="button" className="buff-sheet-share-action" onClick={handleCopyShareJson}>
                      复制 JSON
                    </button>
                    <button type="button" className="buff-sheet-share-action is-primary" onClick={handleExportLocalLibrary}>
                      导出文件
                    </button>
                  </div>
                </div>
                <textarea
                  className="buff-sheet-share-textarea is-preview"
                  value={currentShareText}
                  readOnly
                  spellCheck={false}
                />
              </div>
            ) : (
              <div className="buff-sheet-share-modal-body">
                <div className="buff-sheet-share-modal-copybar">
                  <div className="buff-sheet-share-modal-copyhint">支持直接粘贴 JSON，或选择本地分享文件</div>
                  <div className="buff-sheet-share-modal-actions">
                    <button type="button" className="buff-sheet-share-action" onClick={handleOpenShareImportPicker}>
                      导入文件
                    </button>
                    <button type="button" className="buff-sheet-share-action is-primary" onClick={handleParseImportText}>
                      读取粘贴内容
                    </button>
                  </div>
                </div>
                <textarea
                  className="buff-sheet-share-textarea"
                  value={shareImportText}
                  onChange={(event) => {
                    setShareImportText(event.target.value);
                    if (shareImportError) {
                      setShareImportError('');
                    }
                  }}
                  placeholder="把武器分享 JSON 粘贴到这里，或点击右上角导入文件。"
                  spellCheck={false}
                />
                {shareImportError ? (
                  <div className="buff-sheet-share-feedback is-error">{shareImportError}</div>
                ) : null}
                {pendingImportShare ? (
                  <div className="buff-sheet-share-import-preview">
                    <div className="buff-sheet-share-import-title">导入预览</div>
                    <div className="buff-sheet-share-import-meta">
                      <span>{`名称：${pendingImportShare.label}`}</span>
                      <span>{`武器数：${Object.keys(pendingImportShare.payload).length}`}</span>
                    </div>
                    <div className="buff-sheet-share-modal-actions">
                      <button type="button" className="buff-sheet-share-action" onClick={handleCancelImportShare}>
                        清空预览
                      </button>
                      <button type="button" className="buff-sheet-share-action is-primary" onClick={handleConfirmImportShare}>
                        确认导入
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            )}
          </div>
        </div>
      ) : null}

      {contextMenu ? (
        <div
          className="buff-sheet-context-menu"
          style={{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }}
          onPointerDown={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
        >
          {currentContextMenuActions.map((action) => (
            <button
              key={action.key}
              type="button"
              className="buff-sheet-context-menu-item"
              onClick={() => {
                action.onClick();
                setContextMenu(null);
              }}
            >
              <span className="buff-sheet-context-menu-icon" aria-hidden="true">
                <svg className="buff-sheet-context-menu-svg" viewBox="0 0 16 16" focusable="false">
                  {action.icon === 'new' && <path d="M8 3.25v9.5M3.25 8h9.5" />}
                  {action.icon === 'delete' && (
                    <>
                      <path d="M4.25 5.25h7.5" />
                      <path d="M6.25 2.75h3.5" />
                      <path d="M5.25 5.25v6.5M8 5.25v6.5M10.75 5.25v6.5" />
                      <path d="M4.75 5.25l.5 7h5.5l.5-7" />
                    </>
                  )}
                  {action.icon === 'collapse' && (
                    <>
                      <path d="M3.25 5.25h9.5" />
                      <path d="M5.75 8h6.5" />
                      <path d="M8.25 10.75h4" />
                    </>
                  )}
                  {action.icon === 'expand' && (
                    <>
                      <path d="M3.25 5.25h9.5" />
                      <path d="M3.25 8h9.5" />
                      <path d="M3.25 10.75h9.5" />
                    </>
                  )}
                  {action.icon === 'open' && (
                    <>
                      <path d="M3.25 4.25h3l1.25 1.5h5.25v6.5H3.25z" />
                      <path d="M7.5 5.75h5.25" />
                    </>
                  )}
                </svg>
              </span>
              <span className="buff-sheet-context-menu-label">{action.label}</span>
            </button>
          ))}
        </div>
      ) : null}

      {dragState ? (
        <div
          className="buff-sheet-drag-preview"
          style={{ left: `${dragState.x + 8}px`, top: `${dragState.y + 10}px` }}
        >
          <div className="buff-sheet-drag-preview-title">{getExplorerDragNodeLabel(dragState.source)}</div>
          <div className={`buff-sheet-drag-preview-drop${dragState.over ? ' is-active' : ''}`}>
            {dragState.over
              ? `将放到该${formatWeaponExplorerDragKindLabel(dragState.over.kind)}位置：${getExplorerDragNodeLabel(dragState.over)}`
              : '移动到同层级目标上方后松开'}
          </div>
        </div>
      ) : null}
    </main>
  );
}
