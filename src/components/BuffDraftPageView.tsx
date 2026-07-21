import { useMemo } from 'react';
import type * as React from 'react';
import type { BuffCategory, BuffEffectKind } from '../core/domain/buff';
import './OperatorDraftPage.css';
import './BuffDraftPage.css';
import BuffEffectEditorDrawer from './BuffEffectEditorDrawer';

import * as buffDraftPageModel from './buffDraftPageModel';
type BuffSheetRow = buffDraftPageModel.BuffSheetRow;
type BuffExplorerDragNode = buffDraftPageModel.BuffExplorerDragNode;
type BuffSheetContextMenuAction = buffDraftPageModel.BuffSheetContextMenuAction;

const {
  buffSheetEffectToDrawer,
  applyDrawerEffectToBuffSheet,
  BUFF_CATEGORY_OPTIONS,
  BUFF_CATEGORY_LABELS,
  BUFF_EFFECT_KIND_OPTIONS,
  getEffectKindLabel,
  getBuffTypeDisplayLabel,
  normalizeBuffCategory,
  getBuffEffectMultiplier,
  applyBuffType,
  applyBuffCategory,
  setBuffMultiplierEnabled,
  setBuffMultiplierCoefficient,
  setBuffMaxStacks,
  formatBuffExplorerDragKindLabel,
  renderBuffSheetMenuIcon,
  formatBuffUndoLabel,
  renderBuffWorkbookCellContent,
} = buffDraftPageModel;

import type { BuffDraftPageController } from './useBuffDraftPageController';

export function BuffDraftPageView(props: BuffDraftPageController) {
  const {
    draft,
    setDraft,
    localLibrary,
    selectedLocalDraftId,
    undoSnapshots,
    isUndoMenuOpen,
    setIsUndoMenuOpen,
    filterKeyword,
    setFilterKeyword,
    collapsedItems,
    setCollapsedItems,
    collapsedDraftIds,
    isOverwriteProtectionEnabled,
    setIsOverwriteProtectionEnabled,
    isOverwriteDraftModalOpen,
    setIsOverwriteDraftModalOpen,
    selectedWorkbookCell,
    setSelectedWorkbookCell,
    setPendingFocusRowKey,
    isShareModalOpen,
    shareModalMode,
    setShareModalMode,
    shareImportText,
    setShareImportText,
    shareImportError,
    setShareImportError,
    pendingImportShare,
    contextMenu,
    setContextMenu,
    dragState,
    buffDrawerTarget,
    setBuffDrawerTarget,
    getItemCollapseKey,
    shareImportInputRef,
    formulaBarRef,
    handleRestoreUndoSnapshot,
    refreshLocalLibrary,
    currentSheetShareText,
    openSheetShareModal,
    closeSheetShareModal,
    handleExportSheetLibraryShare,
    handleOpenSheetShareImportPicker,
    handleSheetShareFileSelected,
    handleParseSheetImportText,
    handleCopySheetShareJson,
    handleCancelSheetImportShare,
    handleConfirmSheetImportShare,
    workbookRows,
    handleLoadDraftById,
    openBuffDrawer,
    handleOpenWorkbenchPage,
    handleOpenBuffEditorPage,
    toggleItemCollapsed,
    toggleDraftCollapsed,
    drawerEffect,
    handleSaveDraft,
    handleConfirmOverwriteDraft,
    handleCreateNewDraft,
    handleNormalizeDraft,
    openContextMenu,
    openWorkbookContextMenu,
    getExplorerDragNodeKey,
    consumeSuppressedExplorerClick,
    canStartExplorerDrag,
    handleExplorerPointerDown,
    selectedWorkbookSummary,
    formulaTextBinding,
    formulaTextInput,
    setFormulaTextInput,
    selectedItem,
    selectedEffect,
    updateSelectedEffectKind,
    buffTypeQuery,
    setBuffTypeQuery,
    updateSelectedEffect,
    filteredBuffTypeOptions,
    effectValueInput,
    handleEffectValueInputChange,
    finalizeEffectValueInput,
    getExplorerDragNodeLabel,
    handleCollapseAllDrafts,
    handleExpandAllDrafts,
    handleCollapseAllItemsInDraft,
    handleExpandAllItemsInDraft,
    handleCreateDraftItem,
    handleDeleteDraftGroup,
    handleCreateDraftEffect,
    setDraftCollapsed,
    setItemCollapsed,
    handleDuplicateDraftItem,
    handleDeleteDraftItem,
    handleDuplicateDraftEffect,
    handleDeleteDraftEffect,
  } = props;
  const renderFormulaEditor = () => {
    if (!selectedWorkbookSummary) {
      return <div className="damage-sheet-formula-value">{draft.description || 'Sheet-Buff workbook'}</div>;
    }

    const commitFormulaTextInput = () => {
      if (!formulaTextBinding) {
        return;
      }
      if (formulaTextInput === formulaTextBinding.value) {
        return;
      }
      formulaTextBinding.commit(formulaTextInput);
    };

    const handleFormulaTextInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Enter') {
        commitFormulaTextInput();
        event.currentTarget.blur();
        return;
      }
      if (event.key === 'Escape') {
        setFormulaTextInput(formulaTextBinding?.value ?? '');
        event.currentTarget.blur();
      }
    };

    if (selectedWorkbookSummary.kind === 'group') {
      if (selectedWorkbookCell?.columnKey === 'idText') {
        return <input data-formula-focus-id="group-id" className="buff-sheet-formula-input" value={formulaTextInput} onChange={(event) => setFormulaTextInput(event.target.value)} onBlur={commitFormulaTextInput} onKeyDown={handleFormulaTextInputKeyDown} placeholder="组 ID" />;
      }
      if (selectedWorkbookCell?.columnKey === 'description') {
        return <input data-formula-focus-id="group-description" className="buff-sheet-formula-input" value={formulaTextInput} onChange={(event) => setFormulaTextInput(event.target.value)} onBlur={commitFormulaTextInput} onKeyDown={handleFormulaTextInputKeyDown} placeholder="组描述" />;
      }
      return <input data-formula-focus-id="group-name" className="buff-sheet-formula-input" value={formulaTextInput} onChange={(event) => setFormulaTextInput(event.target.value)} onBlur={commitFormulaTextInput} onKeyDown={handleFormulaTextInputKeyDown} placeholder="组名称" />;
    }

    if (selectedWorkbookSummary.kind === 'item' && selectedItem) {
      if (selectedWorkbookCell?.columnKey === 'idText') {
        return <input data-formula-focus-id="item-id" className="buff-sheet-formula-input" value={formulaTextInput} onChange={(event) => setFormulaTextInput(event.target.value)} onBlur={commitFormulaTextInput} onKeyDown={handleFormulaTextInputKeyDown} placeholder="项 ID" />;
      }
      if (selectedWorkbookCell?.columnKey === 'description') {
        return <input data-formula-focus-id="item-description" className="buff-sheet-formula-input" value={formulaTextInput} onChange={(event) => setFormulaTextInput(event.target.value)} onBlur={commitFormulaTextInput} onKeyDown={handleFormulaTextInputKeyDown} placeholder="项描述" />;
      }
      return <input data-formula-focus-id="item-name" className="buff-sheet-formula-input" value={formulaTextInput} onChange={(event) => setFormulaTextInput(event.target.value)} onBlur={commitFormulaTextInput} onKeyDown={handleFormulaTextInputKeyDown} placeholder="项名称" />;
    }

    if (selectedWorkbookSummary.kind === 'effect' && selectedEffect) {
      switch (selectedWorkbookCell?.columnKey) {
        case 'idText':
          return <div className="damage-sheet-formula-value">{selectedEffect.id}</div>;
        case 'effectKind':
          return (
            <select data-formula-focus-id="effect-kind" className="buff-sheet-formula-input is-select" value={selectedEffect.effectKind || 'modifier'} onChange={(event) => updateSelectedEffectKind(event.target.value as BuffEffectKind)}>
              {BUFF_EFFECT_KIND_OPTIONS.map((option) => (
                <option key={option} value={option}>{getEffectKindLabel(option)}</option>
              ))}
            </select>
          );
        case 'typeLabel':
          return (
            <div className="buff-sheet-formula-type-editor">
              <input
                data-formula-focus-id="effect-type-search"
                className="buff-sheet-formula-input buff-sheet-formula-type-search"
                value={buffTypeQuery}
                onChange={(event) => setBuffTypeQuery(event.target.value)}
                placeholder="搜索类型：法术 / 异伤 / 倍率 / 源石技艺"
                disabled={selectedEffect.effectKind === 'extraHit'}
              />
              <select
                data-formula-focus-id="effect-type-select"
                className="buff-sheet-formula-input is-select buff-sheet-formula-type-select"
                value={selectedEffect.type || ''}
                onChange={(event) => updateSelectedEffect((prev) => applyBuffType(prev, event.target.value))}
                disabled={selectedEffect.effectKind === 'extraHit'}
              >
                <option value="">暂无类型</option>
                {filteredBuffTypeOptions.map((option) => (
                  <option key={option} value={option}>{getBuffTypeDisplayLabel(option)}</option>
                ))}
              </select>
              {selectedEffect.effectKind !== 'extraHit' && (
                <label className="buff-sheet-formula-inline-toggle">
                  <input
                    type="checkbox"
                    checked={Boolean(getBuffEffectMultiplier(selectedEffect))}
                    disabled={normalizeBuffCategory(selectedEffect.category) === 'countable'}
                    onChange={(event) => updateSelectedEffect((prev) => setBuffMultiplierEnabled(prev, event.target.checked))}
                  />
                  乘算
                </label>
              )}
            </div>
          );
        case 'valueText':
          return (
            <input
              data-formula-focus-id="effect-value"
              className="buff-sheet-formula-input"
              type="text"
              inputMode="decimal"
              value={selectedEffect.effectKind === 'extraHit' ? 0 : effectValueInput}
              onChange={(event) => handleEffectValueInputChange(event.target.value)}
              onBlur={getBuffEffectMultiplier(selectedEffect)
                ? (event) => updateSelectedEffect((prev) => setBuffMultiplierCoefficient(prev, Number(event.target.value)))
                : finalizeEffectValueInput}
              disabled={selectedEffect.effectKind === 'extraHit'}
              placeholder={getBuffEffectMultiplier(selectedEffect) ? '乘算系数' : '数值'}
            />
          );
        case 'categoryText':
          return (
            <div className="buff-sheet-formula-type-editor">
              <select
                data-formula-focus-id="effect-category"
                className="buff-sheet-formula-input is-select"
                value={normalizeBuffCategory(selectedEffect.category)}
                onChange={(event) => updateSelectedEffect((prev) => applyBuffCategory(prev, event.target.value as BuffCategory))}
                disabled={Boolean(getBuffEffectMultiplier(selectedEffect))}
              >
                {BUFF_CATEGORY_OPTIONS
                  .filter((option) => selectedEffect.effectKind !== 'extraHit' || option !== 'condition')
                  .map((option) => (
                    <option key={option} value={option}>{BUFF_CATEGORY_LABELS[option]}</option>
                  ))}
              </select>
              {normalizeBuffCategory(selectedEffect.category) === 'countable' && (
                <input
                  data-formula-focus-id="effect-max-stacks"
                  className="buff-sheet-formula-input"
                  type="number"
                  min={1}
                  step={1}
                  value={selectedEffect.maxStacks ?? 1}
                  onChange={(event) => updateSelectedEffect((prev) => setBuffMaxStacks(prev, Number(event.target.value)))}
                  placeholder="最大层数"
                />
              )}
            </div>
          );
        case 'condition':
          return <input data-formula-focus-id="effect-condition" className="buff-sheet-formula-input" value={formulaTextInput} onChange={(event) => setFormulaTextInput(event.target.value)} onBlur={commitFormulaTextInput} onKeyDown={handleFormulaTextInputKeyDown} placeholder="条件" />;
        case 'description':
          return <input data-formula-focus-id="effect-description" className="buff-sheet-formula-input" value={formulaTextInput} onChange={(event) => setFormulaTextInput(event.target.value)} onBlur={commitFormulaTextInput} onKeyDown={handleFormulaTextInputKeyDown} placeholder="描述" />;
        default:
          return <input data-formula-focus-id="effect-display-name" className="buff-sheet-formula-input" value={formulaTextInput} onChange={(event) => setFormulaTextInput(event.target.value)} onBlur={commitFormulaTextInput} onKeyDown={handleFormulaTextInputKeyDown} placeholder="效果名称" />;
      }
    }

    return <div className="damage-sheet-formula-value">{draft.description || 'Sheet-Buff workbook'}</div>;
  };

  const dragSourceKey = dragState ? getExplorerDragNodeKey(dragState.source) : '';
  const dragTargetKey = dragState?.over ? getExplorerDragNodeKey(dragState.over) : '';
  const dragSourceLabel = dragState ? getExplorerDragNodeLabel(dragState.source) : '';
  const dragTargetLabel = dragState?.over ? getExplorerDragNodeLabel(dragState.over) : '';
  const dragTargetKindLabel = dragState?.over ? formatBuffExplorerDragKindLabel(dragState.over.kind) : '';
  const currentContextMenuActions = useMemo<BuffSheetContextMenuAction[]>(() => {
    if (!contextMenu) {
      return [];
    }
    if (contextMenu.target === 'blank') {
      return [
        { key: 'new-draft', label: '新建组', icon: 'new', onClick: () => handleCreateNewDraft() },
        { key: 'collapse-all-drafts', label: '折叠全部组', icon: 'collapse', onClick: () => handleCollapseAllDrafts() },
        { key: 'expand-all-drafts', label: '展开全部组', icon: 'expand', onClick: () => handleExpandAllDrafts() },
      ];
    }
    if (contextMenu.target === 'draft' && contextMenu.draftId) {
      const isCollapsed = Boolean(collapsedDraftIds[contextMenu.draftId]);
      return [
        { key: 'open-draft', label: '打开组', icon: 'open', onClick: () => handleLoadDraftById(contextMenu.draftId!) },
        {
          key: 'toggle-draft-collapse',
          label: isCollapsed ? '展开此组' : '折叠此组',
          icon: isCollapsed ? 'expand' : 'collapse',
          onClick: () => setDraftCollapsed(contextMenu.draftId!, !isCollapsed),
        },
        { key: 'collapse-draft-items', label: '折叠全部项', icon: 'collapse', onClick: () => handleCollapseAllItemsInDraft(contextMenu.draftId!) },
        { key: 'expand-draft-items', label: '展开全部项', icon: 'expand', onClick: () => handleExpandAllItemsInDraft(contextMenu.draftId!) },
        { key: 'create-item', label: '新建项', icon: 'new', onClick: () => handleCreateDraftItem(contextMenu.draftId!) },
        { key: 'delete-draft', label: '删除组', icon: 'delete', onClick: () => handleDeleteDraftGroup(contextMenu.draftId!) },
      ];
    }
    if (contextMenu.target === 'item' && contextMenu.draftId && contextMenu.itemKey) {
      const collapseKey = getItemCollapseKey(contextMenu.draftId, contextMenu.itemKey);
      const isCollapsed = Boolean(collapsedItems[collapseKey]);
      return [
        { key: 'create-effect', label: '新建效果', icon: 'new', onClick: () => handleCreateDraftEffect(contextMenu.draftId!, contextMenu.itemKey!) },
        {
          key: 'toggle-item-collapse',
          label: isCollapsed ? '展开此项' : '折叠此项',
          icon: isCollapsed ? 'expand' : 'collapse',
          onClick: () => setItemCollapsed(contextMenu.draftId!, contextMenu.itemKey!, !isCollapsed),
        },
        { key: 'duplicate-item', label: '复制项', icon: 'copy', onClick: () => handleDuplicateDraftItem(contextMenu.draftId!, contextMenu.itemKey!) },
        { key: 'delete-item', label: '删除项', icon: 'delete', onClick: () => handleDeleteDraftItem(contextMenu.draftId!, contextMenu.itemKey!) },
      ];
    }
    if (contextMenu.target === 'effect' && contextMenu.draftId && contextMenu.itemKey && contextMenu.effectKey) {
      return [
        { key: 'edit-effect', label: '编辑 Buff', icon: 'open', onClick: () => openBuffDrawer(contextMenu.draftId!, contextMenu.itemKey!, contextMenu.effectKey!) },
        { key: 'duplicate-effect', label: '复制效果', icon: 'copy', onClick: () => handleDuplicateDraftEffect(contextMenu.draftId!, contextMenu.itemKey!, contextMenu.effectKey!) },
        { key: 'delete-effect', label: '删除效果', icon: 'delete', onClick: () => handleDeleteDraftEffect(contextMenu.draftId!, contextMenu.itemKey!, contextMenu.effectKey!) },
      ];
    }
    return [];
  }, [
    collapsedDraftIds,
    collapsedItems,
    contextMenu,
    getItemCollapseKey,
    handleCollapseAllDrafts,
    handleCollapseAllItemsInDraft,
    handleCreateDraftEffect,
    handleCreateDraftItem,
    handleCreateNewDraft,
    handleDeleteDraftEffect,
    handleDeleteDraftGroup,
    handleDeleteDraftItem,
    handleDuplicateDraftEffect,
    handleDuplicateDraftItem,
    handleExpandAllDrafts,
    handleExpandAllItemsInDraft,
    handleLoadDraftById,
    openBuffDrawer,
    setDraftCollapsed,
    setItemCollapsed,
  ]);

  return (
    <main className="damage-sheet-page buff-sheet-page">
      <header className="damage-sheet-topbar">
        <div className="damage-sheet-topbar-left">
          <button type="button" className="damage-sheet-back-button" onClick={handleOpenWorkbenchPage}>
            返回主界面
          </button>
          <div className="damage-sheet-title-block">
            <h1>Sheet-Buff</h1>
            <p>沿用表格工作表框架，把 Buff 组、自定义项、效果三层平铺到同一张表里。</p>
          </div>
        </div>
        <div className="damage-sheet-topbar-right">
          <div className="damage-sheet-undo-wrap">
            <button
              type="button"
              className="damage-sheet-action-button"
              onClick={() => setIsUndoMenuOpen((open) => !open)}
              disabled={undoSnapshots.length === 0}
            >
              撤回
            </button>
            {isUndoMenuOpen && undoSnapshots.length > 0 ? (
              <div className="damage-sheet-undo-menu">
                {undoSnapshots.map((snapshot) => (
                  <button
                    key={snapshot.id}
                    type="button"
                    className="damage-sheet-undo-item"
                    onClick={() => handleRestoreUndoSnapshot(snapshot.id)}
                    title={snapshot.label}
                  >
                    <strong>{formatBuffUndoLabel(snapshot.createdAt)}</strong>
                    <span>{snapshot.label}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <button type="button" className="damage-sheet-action-button" onClick={handleOpenBuffEditorPage}>
            返回编辑器
          </button>
          <button type="button" className="damage-sheet-action-button" onClick={refreshLocalLibrary}>
            刷新本地库
          </button>
        </div>
      </header>

      <section className="damage-sheet-ribbon buff-sheet-ribbon">
        <div className="buff-sheet-ribbon-actions">
          <button type="button" className="buff-sheet-tool-button" onClick={handleCreateNewDraft} title="新建组">
            <span className="buff-sheet-tool-icon" aria-hidden="true">
              <svg className="buff-sheet-tool-svg" viewBox="0 0 16 16" focusable="false">
                <path d="M8 3.25v9.5M3.25 8h9.5" />
              </svg>
            </span>
            <span className="buff-sheet-tool-text">新建</span>
          </button>
          <button type="button" className="buff-sheet-tool-button" onClick={handleSaveDraft} title="保存当前组">
            <span className="buff-sheet-tool-icon" aria-hidden="true">
              <svg className="buff-sheet-tool-svg" viewBox="0 0 16 16" focusable="false">
                <path d="M3.25 2.75h7.5l2.25 2.25v8.25H3.25z" />
                <path d="M5.25 2.75v3.5h4.5v-3.5M5.25 10.25h5.5" />
              </svg>
            </span>
            <span className="buff-sheet-tool-text">保存</span>
          </button>
          <button type="button" className="buff-sheet-tool-button" onClick={handleNormalizeDraft} title="整理项与效果顺序">
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
          <button type="button" className="buff-sheet-tool-button" onClick={() => openSheetShareModal('export')} title="导出本地 Buff 库">
            <span className="buff-sheet-tool-icon" aria-hidden="true">
              <svg className="buff-sheet-tool-svg" viewBox="0 0 16 16" focusable="false">
                <path d="M8 3v6.5" />
                <path d="M5.75 7.25L8 9.5l2.25-2.25" />
                <path d="M3.5 11.75h9" />
              </svg>
            </span>
            <span className="buff-sheet-tool-text">导出</span>
          </button>
          <button type="button" className="buff-sheet-tool-button" onClick={() => openSheetShareModal('import')} title="导入 Buff 分享">
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
        <div ref={formulaBarRef} className="damage-sheet-formula-bar">
          <span className="damage-sheet-formula-address">{selectedWorkbookCell?.address ?? '-'}</span>
          <span className="damage-sheet-formula-label">fx</span>
          {renderFormulaEditor()}
        </div>
      </section>

      <main className="damage-sheet-workspace buff-sheet-workspace">
        <aside className="damage-sheet-sidebar buff-sheet-explorer" onContextMenu={(event) => openContextMenu(event, {
          x: event.clientX,
          y: event.clientY,
          target: 'blank',
        })}>
          <div className="damage-sheet-sidebar-title">资源管理器</div>
          <input
            className="buff-sheet-search-input"
            value={filterKeyword}
            onChange={(event) => setFilterKeyword(event.target.value)}
            placeholder="搜索组 / 项 / 效果"
          />
          <input
            ref={shareImportInputRef}
            type="file"
            accept=".json,application/json"
            className="operator-draft-file-input"
            onChange={handleSheetShareFileSelected}
          />
          <div className="buff-sheet-explorer-tree">
            {Object.entries(localLibrary).map(([draftId, draftValue]) => {
              const isCollapsed = collapsedDraftIds[draftId];
              const itemEntries = Object.entries(draftValue.items);
              const draftDragNode: BuffExplorerDragNode = { kind: 'draft', draftId };
              return (
                <div key={draftId} className="buff-sheet-explorer-node">
                  <button
                    type="button"
                    className={`buff-sheet-explorer-row${selectedLocalDraftId === draftId ? ' is-active' : ''}${dragSourceKey === getExplorerDragNodeKey(draftDragNode) ? ' is-drag-source' : ''}${dragTargetKey === getExplorerDragNodeKey(draftDragNode) ? ' is-drag-target' : ''}${canStartExplorerDrag(draftDragNode) ? ' is-draggable' : ''}`}
                    data-buff-drag-kind="draft"
                    data-buff-draft-id={draftId}
                    onPointerDown={(event) => handleExplorerPointerDown(event, draftDragNode)}
                    onClick={() => {
                      if (consumeSuppressedExplorerClick()) {
                        return;
                      }
                      handleLoadDraftById(draftId);
                    }}
                    onContextMenu={(event) => openContextMenu(event, {
                      x: event.clientX,
                      y: event.clientY,
                      target: 'draft',
                      draftId,
                    })}
                  >
                    <span
                      className="damage-sheet-row-toggle buff-sheet-explorer-toggle"
                      onClick={(event) => {
                        event.stopPropagation();
                        toggleDraftCollapsed(draftId);
                      }}
                    >
                      {isCollapsed ? '[+]' : '[-]'}
                    </span>
                    <span className="buff-sheet-explorer-label">{draftValue.name}</span>
                  </button>
                  {!isCollapsed ? (
                    <div className="buff-sheet-explorer-children">
                      {itemEntries.map(([itemKey, item]) => {
                        const itemDragNode: BuffExplorerDragNode = { kind: 'item', draftId, itemKey };
                        return (
                        <div key={itemKey} className="buff-sheet-explorer-node">
                          <button
                            type="button"
                            className={`buff-sheet-explorer-child${dragSourceKey === getExplorerDragNodeKey(itemDragNode) ? ' is-drag-source' : ''}${dragTargetKey === getExplorerDragNodeKey(itemDragNode) ? ' is-drag-target' : ''}${canStartExplorerDrag(itemDragNode) ? ' is-draggable' : ''}`}
                            data-buff-drag-kind="item"
                            data-buff-draft-id={draftId}
                            data-buff-item-key={itemKey}
                            onPointerDown={(event) => handleExplorerPointerDown(event, itemDragNode)}
                            onClick={() => {
                              if (consumeSuppressedExplorerClick()) {
                                return;
                              }
                              handleLoadDraftById(draftId);
                              setCollapsedItems((prev) => ({ ...prev, [getItemCollapseKey(draftId, itemKey)]: false }));
                              setPendingFocusRowKey(`item-${itemKey}`);
                            }}
                            onContextMenu={(event) => openContextMenu(event, {
                              x: event.clientX,
                              y: event.clientY,
                              target: 'item',
                              draftId,
                              itemKey,
                            })}
                          >
                            <span
                              className="damage-sheet-row-toggle buff-sheet-explorer-toggle"
                              onClick={(event) => {
                                event.stopPropagation();
                                setCollapsedItems((prev) => ({
                                  ...prev,
                                  [getItemCollapseKey(draftId, itemKey)]: !prev[getItemCollapseKey(draftId, itemKey)],
                                }));
                              }}
                            >
                              {collapsedItems[getItemCollapseKey(draftId, itemKey)] ? '[+]' : '[-]'}
                            </span>
                            <span className="buff-sheet-explorer-label">{item.name}</span>
                            <span className="buff-sheet-explorer-count">{Object.keys(item.effects).length}</span>
                          </button>
                          {!collapsedItems[getItemCollapseKey(draftId, itemKey)] ? (
                            <div className="buff-sheet-explorer-children buff-sheet-explorer-effects">
                              {Object.entries(item.effects).map(([effectKey, effect]) => {
                                const effectDragNode: BuffExplorerDragNode = { kind: 'effect', draftId, itemKey, effectKey };
                                return (
                                <button
                                  key={effectKey}
                                  type="button"
                                  className={`buff-sheet-explorer-effect${dragSourceKey === getExplorerDragNodeKey(effectDragNode) ? ' is-drag-source' : ''}${dragTargetKey === getExplorerDragNodeKey(effectDragNode) ? ' is-drag-target' : ''}${canStartExplorerDrag(effectDragNode) ? ' is-draggable' : ''}`}
                                  data-buff-drag-kind="effect"
                                  data-buff-draft-id={draftId}
                                  data-buff-item-key={itemKey}
                                  data-buff-effect-key={effectKey}
                                  onPointerDown={(event) => handleExplorerPointerDown(event, effectDragNode)}
                                  onClick={() => {
                                    if (consumeSuppressedExplorerClick()) {
                                      return;
                                    }
                                    handleLoadDraftById(draftId);
                                    setPendingFocusRowKey(`effect-${itemKey}-${effectKey}`);
                                  }}
                                  onContextMenu={(event) => openContextMenu(event, {
                                    x: event.clientX,
                                    y: event.clientY,
                                    target: 'effect',
                                    draftId,
                                    itemKey,
                                    effectKey,
                                  })}
                                >
                                  <span className="buff-sheet-explorer-bullet">·</span>
                                  <span className="buff-sheet-explorer-label">{effect.displayName || effectKey}</span>
                                </button>
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
                      {renderBuffSheetMenuIcon(action.icon)}
                    </svg>
                  </span>
                  <span className="buff-sheet-context-menu-label">{action.label}</span>
                </button>
              ))}
            </div>
          ) : null}
        </aside>

        <section className="damage-sheet-excel-shell">
          <div
            className="damage-sheet-excel-scroll"
            onContextMenu={(event) => openWorkbookContextMenu(event)}
          >
            {workbookRows.length === 0 ? (
              <div className="damage-sheet-empty-state">
                <h2>当前没有可展示的 Buff 数据</h2>
                <p>先在本地 Buff 编辑器里准备一组数据，再打开这张表。</p>
              </div>
            ) : (
              workbookRows.map((row) => (
                <div
                  key={row.key}
                  className={`damage-sheet-excel-row is-${row.kind}`}
                  onContextMenu={(event) => openWorkbookContextMenu(event, row.sourceRow)}
                  onDoubleClick={() => {
                    if (row.sourceRow?.kind === 'effect') {
                      openBuffDrawer(draft.id, row.sourceRow.itemKey, row.sourceRow.effectKey);
                    }
                  }}
                >
                  <div
                    className="damage-sheet-excel-row-number"
                    onContextMenu={(event) => openWorkbookContextMenu(event, row.sourceRow)}
                  >
                    {row.sourceRow?.kind === 'item' ? (
                      <button
                        type="button"
                        className="damage-sheet-row-toggle"
                        onClick={() => toggleItemCollapsed((row.sourceRow as Extract<BuffSheetRow, { kind: 'item' }>).itemKey)}
                      >
                        {collapsedItems[getItemCollapseKey(draft.id, (row.sourceRow as Extract<BuffSheetRow, { kind: 'item' }>).itemKey)] ? '[+]' : '[-]'}
                      </button>
                    ) : row.rowNumber}
                  </div>
                  <div className="damage-sheet-excel-row-cells">
                    {row.cells.map((cell) => (
                      <div
                        key={cell.key}
                        className={`damage-sheet-excel-cell is-${cell.kind} is-${cell.align}${selectedWorkbookCell?.address === cell.address ? ' is-active' : ''}`}
                        style={{ width: `${cell.width}px` }}
                        onClick={() => setSelectedWorkbookCell({
                          address: cell.address,
                          value: cell.value,
                          sourceRowKey: cell.sourceRowKey,
                          columnKey: cell.columnKey,
                        })}
                        onContextMenu={(event) => openWorkbookContextMenu(event, row.sourceRow, {
                          address: cell.address,
                          value: cell.value,
                          sourceRowKey: cell.sourceRowKey,
                          columnKey: cell.columnKey,
                        })}
                      >
                        {renderBuffWorkbookCellContent(cell, row.sourceRow)}
                      </div>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      </main>
      <BuffEffectEditorDrawer
        open={Boolean(buffDrawerTarget && drawerEffect)}
        sourceLabel={`Buff Sheet · ${buffDrawerTarget ? draft.items[buffDrawerTarget.itemKey]?.name ?? draft.name : draft.name}`}
        effect={drawerEffect ? buffSheetEffectToDrawer(drawerEffect) : null}
        onChange={(nextEffect) => {
          if (!buffDrawerTarget) {
            return;
          }
          setDraft((prev) => {
            const currentEffect = prev.items[buffDrawerTarget.itemKey]?.effects[buffDrawerTarget.effectKey];
            if (!currentEffect) {
              return prev;
            }
            return {
              ...prev,
              items: {
                ...prev.items,
                [buffDrawerTarget.itemKey]: {
                  ...prev.items[buffDrawerTarget.itemKey],
                  effects: {
                    ...prev.items[buffDrawerTarget.itemKey].effects,
                    [buffDrawerTarget.effectKey]: applyDrawerEffectToBuffSheet(currentEffect, nextEffect),
                  },
                },
              },
            };
          });
        }}
        onClose={() => setBuffDrawerTarget(null)}
      />
      {dragState ? (
        <div
          className="buff-sheet-drag-preview"
          style={{ left: `${dragState.x + 8}px`, top: `${dragState.y + 10}px` }}
        >
          <div className="buff-sheet-drag-preview-title">{dragSourceLabel}</div>
          <div className={`buff-sheet-drag-preview-drop${dragState.over ? ' is-active' : ''}`}>
            {dragState.over
              ? `将放到该${dragTargetKindLabel}位置：${dragTargetLabel}`
              : '移动到同层级目标上方后松开'}
          </div>
        </div>
      ) : null}
      {isOverwriteDraftModalOpen ? (
        <div className="operator-draft-modal-overlay" onClick={() => setIsOverwriteDraftModalOpen(false)}>
          <div className="operator-draft-modal operator-draft-confirm-modal" onClick={(event) => event.stopPropagation()}>
            <div className="operator-draft-section-header">
              <div>
                <h3>确认覆盖本地 Buff 组</h3>
                <p>当前 ID 已存在于本地库中。</p>
              </div>
            </div>
            <div className="operator-draft-confirm-body">
              <strong>{draft.name || draft.id || '未命名 Buff 组'}</strong>
              <p>保护开启时，确认后会用当前 Sheet-Buff 编辑内容覆盖本地同 ID Buff 组。</p>
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
        <div className="buff-sheet-share-modal-mask" onClick={closeSheetShareModal}>
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
              <button type="button" className="buff-sheet-share-modal-close" onClick={closeSheetShareModal} aria-label="关闭">
                ×
              </button>
            </div>
            {shareModalMode === 'export' ? (
              <div className="buff-sheet-share-modal-body">
                <div className="buff-sheet-share-modal-copybar">
                  <div className="buff-sheet-share-modal-copyhint">预览当前本地 Buff 库分享 JSON</div>
                  <div className="buff-sheet-share-modal-actions">
                    <button type="button" className="buff-sheet-share-action" onClick={handleCopySheetShareJson}>
                      复制 JSON
                    </button>
                    <button type="button" className="buff-sheet-share-action is-primary" onClick={handleExportSheetLibraryShare}>
                      导出文件
                    </button>
                  </div>
                </div>
                <textarea
                  className="buff-sheet-share-textarea is-preview"
                  value={currentSheetShareText}
                  readOnly
                  spellCheck={false}
                />
              </div>
            ) : (
              <div className="buff-sheet-share-modal-body">
                <div className="buff-sheet-share-modal-copybar">
                  <div className="buff-sheet-share-modal-copyhint">支持直接粘贴 JSON，或选择本地分享文件</div>
                  <div className="buff-sheet-share-modal-actions">
                    <button type="button" className="buff-sheet-share-action" onClick={handleOpenSheetShareImportPicker}>
                      导入文件
                    </button>
                    <button type="button" className="buff-sheet-share-action is-primary" onClick={handleParseSheetImportText}>
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
                  placeholder="把 Buff 分享 JSON 粘贴到这里，或点击右上角导入文件。"
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
                      <span>{`分组数：${Object.keys(pendingImportShare.payload).length}`}</span>
                    </div>
                    <div className="buff-sheet-share-modal-actions">
                      <button type="button" className="buff-sheet-share-action" onClick={handleCancelSheetImportShare}>
                        清空预览
                      </button>
                      <button type="button" className="buff-sheet-share-action is-primary" onClick={handleConfirmSheetImportShare}>
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
    </main>
  );
}
