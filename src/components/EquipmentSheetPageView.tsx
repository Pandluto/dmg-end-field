import { APP_ROUTE_PATHS, navigateToAppPath } from '../utils/appRoute';
import { normalizeAssetUrl } from '../utils/assetResolver';
import BuffEffectEditorDrawer from './BuffEffectEditorDrawer';
import './BuffDraftPage.css';
import './OperatorDraftPage.css';
import './WorkbookSheet.css';
import './EquipmentSheetPage.css';

import * as equipmentSheetPageModel from './equipmentSheetPageModel';
type EquipmentWorkbookCell = equipmentSheetPageModel.EquipmentWorkbookCell;
type EquipmentWorkbookRow = equipmentSheetPageModel.EquipmentWorkbookRow;
const {
  EQUIPMENT_PARTS,
  LEVEL_KEYS,
  COLUMNS,
  BUFF_TYPE_OPTIONS,
  BUFF_TYPE_LABELS,
  stopEditingKeyPropagation,
  equipmentBuffToDrawer,
  drawerEffectToEquipmentBuff,
  EQUIPMENT_BUFF_BUSINESS_TYPE_OPTIONS,
  getEquipmentBuffBusinessType,
  getEquipmentEffectShape,
  getEquipmentEffectTypeOptions,
  getEquipments,
  getSortedEquipments,
  getEffectEntries,
  getWorkbookRowClassName,
  renderMenuIcon,
  updateLibrarySet,
} = equipmentSheetPageModel;

import type { EquipmentSheetPageController } from './useEquipmentSheetPageController';

export function EquipmentSheetPageView(props: EquipmentSheetPageController) {
  const {
    library,
    selectedRowKey,
    setSelectedRowKey,
    selectedCell,
    setSelectedCell,
    filterKeyword,
    setFilterKeyword,
    isOverwriteProtectionEnabled,
    setIsOverwriteProtectionEnabled,
    contextMenu,
    buffDrawerTarget,
    setBuffDrawerTarget,
    equipmentImageLoadFailed,
    setEquipmentImageLoadFailed,
    isSaveConfirmModalOpen,
    setIsSaveConfirmModalOpen,
    isShareModalOpen,
    shareModalMode,
    setShareModalMode,
    shareImportText,
    setShareImportText,
    shareImportError,
    setShareImportError,
    pendingImportShare,
    exportScope,
    setExportScope,
    shareImportInputRef,
    tableScrollRef,
    workbookRows,
    previewImageMeta,
    currentShareText,
    mutateLibrary,
    openEquipmentBuffDrawer,
    handleCreateNew,
    handleNormalize,
    openContextMenu,
    closeContextMenu,
    focusRow,
    toggleRowCollapsed,
    isRowCollapsed,
    buildContextMenuActions,
    updateCellValue,
    hasUnsavedChanges,
    handleSave,
    handleConfirmSave,
    openShareModal,
    closeShareModal,
    handleCopyShareJson,
    handleExportLocalLibrary,
    handleOpenShareImportPicker,
    handleParseImportText,
    handleCancelImportShare,
    handleShareFileSelected,
    handleConfirmImportShare,
    message,
    formulaBinding,
    buffTypeQuery,
    setBuffTypeQuery,
    selectedWorkbookRow,
    equipmentImageFormulaRef,
    equipmentImageQuery,
    setEquipmentImageQuery,
    isEquipmentImageDrawerOpen,
    setIsEquipmentImageDrawerOpen,
    imageAssetsLoading,
    imageAssetsError,
    filteredEquipmentImageOptions,
    handleSelectEquipmentImage,
    handleClearEquipmentImage,
    formulaInput,
    setFormulaInput,
    commitFormulaInput,
    activeGearSetId,
    setActiveGearSetId,
    setActiveEquipmentId,
    filteredGearSets,
    collapsedGearSetIds,
    setCollapsedGearSetIds,
    collapsedEquipmentIds,
    setCollapsedEquipmentIds,
    collapsedEffectIds,
    setCollapsedEffectIds,
  } = props;
  const renderFormulaEditor = () => {
    if (!formulaBinding) {
      return <div className="damage-sheet-formula-value">{message}</div>;
    }
    if (formulaBinding.readOnly) {
      return <input className="buff-sheet-formula-input" value={formulaBinding.value} readOnly />;
    }
    if (formulaBinding.control === 'select') {
      return (
        <select
          className="buff-sheet-formula-input is-select"
          value={formulaBinding.value}
          onChange={(event) => formulaBinding.commit(event.target.value)}
        >
          {(formulaBinding.options ?? []).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      );
    }
    if (formulaBinding.control === 'search-select') {
      const keyword = buffTypeQuery.trim().toLowerCase();
      const searchOptions = (formulaBinding.options ?? BUFF_TYPE_OPTIONS.map((typeKey) => ({
        value: typeKey,
        label: `${BUFF_TYPE_LABELS[typeKey] || typeKey} · ${typeKey}`,
      }))).filter((option) => !keyword || `${option.label} ${option.value}`.toLowerCase().includes(keyword));
      return (
        <div className="buff-sheet-formula-type-editor">
          <input
            className="buff-sheet-formula-input buff-sheet-formula-type-search"
            value={buffTypeQuery}
            onChange={(event) => setBuffTypeQuery(event.target.value)}
            placeholder="搜索类型：敏捷 / 物理 / sourceSkillBoost"
          />
          <select
            className="buff-sheet-formula-input is-select buff-sheet-formula-type-select"
            value={formulaBinding.value}
            onChange={(event) => formulaBinding.commit(event.target.value)}
          >
            <option value="">未映射</option>
            {searchOptions.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </div>
      );
    }
    if (formulaBinding.control === 'image-search-select') {
      const clearLabel = selectedWorkbookRow?.sourceRow.kind === 'set' ? '清空套装配图' : '清空装备配图';
      const clearHint = selectedWorkbookRow?.sourceRow.kind === 'set' ? '移除当前套装 imgUrl' : '移除当前装备 imgUrl';
      return (
        <div className="weapon-sheet-image-formula-editor" ref={equipmentImageFormulaRef}>
          <input
            className="buff-sheet-formula-input weapon-sheet-image-formula-search"
            value={equipmentImageQuery}
            onChange={(event) => setEquipmentImageQuery(event.target.value)}
            onClick={() => setIsEquipmentImageDrawerOpen(true)}
            onKeyDown={stopEditingKeyPropagation}
            placeholder="搜索图片：文件名 / baseName / 路径 / URL"
          />
          {isEquipmentImageDrawerOpen ? (
            <div className="weapon-sheet-image-formula-results">
              <div className="weapon-sheet-image-formula-toolbar">
                <button
                  type="button"
                  className={`weapon-sheet-image-option weapon-sheet-image-option-clear${!formulaBinding.value ? ' is-active' : ''}`}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={handleClearEquipmentImage}
                >
                  <span className="weapon-sheet-image-option-thumb weapon-sheet-image-option-thumb-empty">无图</span>
                  <span className="weapon-sheet-image-option-meta">
                    <strong>{clearLabel}</strong>
                    <span>{clearHint}</span>
                  </span>
                </button>
              </div>
              {imageAssetsLoading ? (
                <div className="weapon-sheet-image-picker-empty">图片资源加载中...</div>
              ) : imageAssetsError ? (
                <div className="weapon-sheet-image-picker-empty">图片资源加载失败：{imageAssetsError}</div>
              ) : filteredEquipmentImageOptions.length === 0 ? (
                <div className="weapon-sheet-image-picker-empty">没有匹配的图片</div>
              ) : (
                <div className="weapon-sheet-image-picker-list">
                  {filteredEquipmentImageOptions.map((option) => (
                    <button
                      key={option.key}
                      type="button"
                      className={`weapon-sheet-image-option${formulaBinding.value === option.displayUrl ? ' is-active' : ''}`}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => handleSelectEquipmentImage(option.displayUrl)}
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
    return (
      <input
        className="buff-sheet-formula-input"
        type={formulaBinding.inputMode === 'number' ? 'number' : 'text'}
        step="any"
        value={formulaInput}
        placeholder={formulaBinding.placeholder}
        onChange={(event) => setFormulaInput(event.target.value)}
        onBlur={commitFormulaInput}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            commitFormulaInput();
          }
          if (event.key === 'Escape') {
            setFormulaInput(formulaBinding.value);
          }
        }}
      />
    );
  };

  const renderEditableCell = (row: EquipmentWorkbookRow, cell: EquipmentWorkbookCell) => {
    const sourceRow = row.sourceRow;
    const editable =
      (sourceRow.kind === 'set' && ['name', 'effectKey', 'description'].includes(cell.columnKey))
      || (sourceRow.kind === 'threePieceBuffHeader' && false)
      || (sourceRow.kind === 'threePieceBuff' && ['name', 'field', 'effectKey', 'valueText', 'description'].includes(cell.columnKey))
      || (sourceRow.kind === 'equipment' && ['name', 'field', 'description'].includes(cell.columnKey))
      || (sourceRow.kind === 'fixedStat' && ['name', 'effectKey', 'description'].includes(cell.columnKey))
      || (sourceRow.kind === 'effect' && ['name', 'field', 'effectKey', 'description'].includes(cell.columnKey));
    if (!editable) {
      return cell.value;
    }
    if (sourceRow.kind === 'equipment' && cell.columnKey === 'field') {
      return (
        <select
          className="weapon-sheet-inline-input"
          value={cell.value}
          onKeyDown={stopEditingKeyPropagation}
          onChange={(event) => updateCellValue(sourceRow, cell.columnKey, event.target.value)}
        >
          {EQUIPMENT_PARTS.map((part) => <option key={part} value={part}>{part}</option>)}
        </select>
      );
    }
    if (sourceRow.kind === 'threePieceBuff' && cell.columnKey === 'field') {
      const buff = library.gearSets[sourceRow.gearSetId]?.threePieceBuffs?.[sourceRow.effectId];
      return (
        <select
          className="weapon-sheet-inline-input"
          value={getEquipmentBuffBusinessType(buff)}
          onKeyDown={stopEditingKeyPropagation}
          onChange={(event) => updateCellValue(sourceRow, cell.columnKey, event.target.value)}
        >
          {EQUIPMENT_BUFF_BUSINESS_TYPE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      );
    }
    if (sourceRow.kind === 'effect' && cell.columnKey === 'field') {
      return (
        <select
          className="weapon-sheet-inline-input"
          value={sourceRow.field === '能力值' ? 'ability' : 'buff'}
          onKeyDown={stopEditingKeyPropagation}
          onChange={(event) => updateCellValue(sourceRow, cell.columnKey, event.target.value)}
        >
          <option value="ability">能力值</option>
          <option value="buff">Buff类型</option>
        </select>
      );
    }
    if ((sourceRow.kind === 'effect' || sourceRow.kind === 'threePieceBuff') && cell.columnKey === 'effectKey') {
      const isExtraHit = sourceRow.kind === 'threePieceBuff'
        && library.gearSets[sourceRow.gearSetId]?.threePieceBuffs?.[sourceRow.effectId]?.effectKind === 'extraHit';
      if (isExtraHit) return cell.value;
      const typeOptions = sourceRow.kind === 'effect'
        ? (() => {
            const equipment = library.gearSets[sourceRow.gearSetId]?.equipments[sourceRow.equipmentId];
            const effect = equipment?.effects[sourceRow.effectId];
            return equipment && effect
              ? getEquipmentEffectTypeOptions(equipment.part, sourceRow.effectId, effect.category, getEquipmentEffectShape(equipment))
              : BUFF_TYPE_OPTIONS;
          })()
        : BUFF_TYPE_OPTIONS;
      return (
        <select
          className="weapon-sheet-inline-input"
          value={cell.value}
          onKeyDown={stopEditingKeyPropagation}
          onChange={(event) => updateCellValue(sourceRow, cell.columnKey, event.target.value)}
        >
          <option value="">未映射</option>
          {typeOptions.map((typeKey) => <option key={typeKey} value={typeKey}>{`${BUFF_TYPE_LABELS[typeKey] || typeKey} · ${typeKey}`}</option>)}
        </select>
      );
    }
    if (sourceRow.kind === 'fixedStat' && cell.columnKey === 'effectKey') {
      return (
        <select
          className="weapon-sheet-inline-input"
          value={cell.value}
          onKeyDown={stopEditingKeyPropagation}
          onChange={(event) => updateCellValue(sourceRow, cell.columnKey, event.target.value)}
        >
          <option value="defense">防御力 · defense</option>
          <option value="hp">生命 · hp</option>
          <option value="flatAtk">固定攻击力 · flatAtk</option>
        </select>
      );
    }
    return (
      <input
        className="weapon-sheet-inline-input"
        value={cell.value}
        type={cell.columnKey === 'valueText' ? 'number' : 'text'}
        step="any"
        onKeyDown={stopEditingKeyPropagation}
        onChange={(event) => updateCellValue(sourceRow, cell.columnKey, event.target.value)}
      />
    );
  };

  const renderExplorer = () => (
    <div className="buff-sheet-explorer-tree">
      <button
        type="button"
        className={`buff-sheet-explorer-row equipment-sheet-explorer-all${activeGearSetId ? '' : ' is-active'}`}
        onClick={() => {
          setActiveGearSetId(null);
          setActiveEquipmentId(null);
          setSelectedCell(null);
          setSelectedRowKey(filteredGearSets[0] ? `set-${filteredGearSets[0].gearSetId}` : '');
        }}
      >
        <span className="buff-sheet-explorer-label">全部套装</span>
        <span className="buff-sheet-explorer-count">{filteredGearSets.length}</span>
      </button>
      {filteredGearSets.length === 0 ? (
        <div className="damage-sheet-detail-empty">没有匹配的装备。</div>
      ) : filteredGearSets.map((gearSet) => {
        const isSetCollapsed = collapsedGearSetIds[gearSet.gearSetId] !== false;
        return (
          <div key={gearSet.gearSetId} className="buff-sheet-explorer-node">
            <button
              type="button"
              className={`buff-sheet-explorer-row${activeGearSetId === gearSet.gearSetId && selectedRowKey === `set-${gearSet.gearSetId}` ? ' is-active' : ''}`}
              onClick={() => {
                setActiveGearSetId(gearSet.gearSetId);
                setActiveEquipmentId(null);
                focusRow(`set-${gearSet.gearSetId}`, { expandAncestors: true, scroll: true });
              }}
              onContextMenu={(event) => openContextMenu(event, { x: event.clientX, y: event.clientY, target: 'set', gearSetId: gearSet.gearSetId })}
            >
              <span className="damage-sheet-row-toggle buff-sheet-explorer-toggle" onClick={(event) => {
                event.stopPropagation();
                setCollapsedGearSetIds((prev) => ({ ...prev, [gearSet.gearSetId]: prev[gearSet.gearSetId] === false }));
              }}>{isSetCollapsed ? '[+]' : '[-]'}</span>
              <span className="buff-sheet-explorer-label">{gearSet.name}</span>
              <span className="buff-sheet-explorer-count">{getEquipments(gearSet).length}</span>
            </button>
            {!isSetCollapsed ? (
              <div className="buff-sheet-explorer-children">
                {getSortedEquipments(gearSet).map((equipment) => {
                  const equipmentCollapseKey = `${gearSet.gearSetId}:${equipment.equipmentId}`;
                  const isEquipmentCollapsed = collapsedEquipmentIds[equipmentCollapseKey] !== false;
                  return (
                    <div key={equipment.equipmentId} className="buff-sheet-explorer-node">
                      <button
                        type="button"
                        className={`buff-sheet-explorer-child${selectedRowKey === `equipment-${gearSet.gearSetId}-${equipment.equipmentId}` ? ' is-active' : ''}`}
                        onClick={() => {
                          setActiveGearSetId(gearSet.gearSetId);
                          setActiveEquipmentId(equipment.equipmentId);
                          setCollapsedGearSetIds((prev) => ({ ...prev, [gearSet.gearSetId]: false }));
                          setCollapsedEquipmentIds((prev) => ({ ...prev, [equipmentCollapseKey]: false }));
                          focusRow(`equipment-${gearSet.gearSetId}-${equipment.equipmentId}`, { expandAncestors: true, scroll: true });
                        }}
                        onContextMenu={(event) => openContextMenu(event, { x: event.clientX, y: event.clientY, target: 'equipment', gearSetId: gearSet.gearSetId, equipmentId: equipment.equipmentId })}
                      >
                        <span className="damage-sheet-row-toggle buff-sheet-explorer-toggle" onClick={(event) => {
                          event.stopPropagation();
                          setCollapsedEquipmentIds((prev) => ({ ...prev, [equipmentCollapseKey]: prev[equipmentCollapseKey] === false }));
                        }}>{isEquipmentCollapsed ? '[+]' : '[-]'}</span>
                        <span className="buff-sheet-explorer-label">{equipment.name}</span>
                        <span className="buff-sheet-explorer-count">{equipment.part}</span>
                      </button>
                      {!isEquipmentCollapsed ? (
                        <div className="buff-sheet-explorer-children">
                          {equipment.fixedStat ? (
                            <button
                              type="button"
                              className={`buff-sheet-explorer-effect${selectedRowKey === `fixed-${gearSet.gearSetId}-${equipment.equipmentId}` ? ' is-active' : ''}`}
                              onClick={() => {
                                setActiveGearSetId(gearSet.gearSetId);
                                setActiveEquipmentId(equipment.equipmentId);
                                setCollapsedGearSetIds((prev) => ({ ...prev, [gearSet.gearSetId]: false }));
                                setCollapsedEquipmentIds((prev) => ({ ...prev, [equipmentCollapseKey]: false }));
                                focusRow(`fixed-${gearSet.gearSetId}-${equipment.equipmentId}`, { expandAncestors: true, scroll: true });
                              }}
                              onContextMenu={(event) => openContextMenu(event, { x: event.clientX, y: event.clientY, target: 'fixedStat', gearSetId: gearSet.gearSetId, equipmentId: equipment.equipmentId })}
                            >
                              <span className="buff-sheet-explorer-label">{equipment.fixedStat.label}</span>
                              <span className="buff-sheet-explorer-count">固定</span>
                            </button>
                          ) : null}
                          {getEffectEntries(equipment).map(([effectId, effect]) => (
                            <button
                              key={effectId}
                              type="button"
                              className={`buff-sheet-explorer-effect${selectedRowKey === `effect-${gearSet.gearSetId}-${equipment.equipmentId}-${effectId}` ? ' is-active' : ''}`}
                              onClick={() => {
                                setActiveGearSetId(gearSet.gearSetId);
                                setActiveEquipmentId(equipment.equipmentId);
                                setCollapsedGearSetIds((prev) => ({ ...prev, [gearSet.gearSetId]: false }));
                                setCollapsedEquipmentIds((prev) => ({ ...prev, [equipmentCollapseKey]: false }));
                                focusRow(`effect-${gearSet.gearSetId}-${equipment.equipmentId}-${effectId}`, { expandAncestors: true, scroll: true });
                              }}
                              onContextMenu={(event) => openContextMenu(event, { x: event.clientX, y: event.clientY, target: 'effect', gearSetId: gearSet.gearSetId, equipmentId: equipment.equipmentId, effectId })}
                            >
                              <span className="damage-sheet-row-toggle buff-sheet-explorer-toggle" onClick={(event) => {
                                event.stopPropagation();
                                const key = `${gearSet.gearSetId}:${equipment.equipmentId}:${effectId}`;
                                setCollapsedEffectIds((prev) => ({ ...prev, [key]: prev[key] === false }));
                              }}>{collapsedEffectIds[`${gearSet.gearSetId}:${equipment.equipmentId}:${effectId}`] !== false ? '[+]' : '[-]'}</span>
                              <span className="buff-sheet-explorer-label">{`${effectId} · ${effect.label}`}</span>
                              <span className="buff-sheet-explorer-count">Lv0~Lv3</span>
                            </button>
                          ))}
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
  );

  return (
    <main className="damage-sheet-page buff-sheet-page weapon-sheet-page equipment-sheet-page">
      <header className="damage-sheet-topbar">
        <div className="damage-sheet-topbar-left">
          <button type="button" className="damage-sheet-back-button" onClick={() => navigateToAppPath(APP_ROUTE_PATHS.home)}>
            返回
          </button>
          <div className="damage-sheet-title-block">
            <h1>Sheet-Equipment</h1>
            <p>{'装备数据工作表 · 按 gearSet -> equipment -> fixed/effect -> Lv0~Lv3 编辑'}</p>
          </div>
        </div>
        <div className="damage-sheet-topbar-right">
          <span className={`equipment-sheet-save-status${hasUnsavedChanges ? ' is-dirty' : ''}`}>{hasUnsavedChanges ? '未保存' : '已保存'}</span>
          <button type="button" className="damage-sheet-action-button" onClick={() => navigateToAppPath(APP_ROUTE_PATHS.weaponSheet)}>
            打开 Sheet-Weapon
          </button>
        </div>
      </header>

      <section className="damage-sheet-ribbon buff-sheet-ribbon">
        <div className="buff-sheet-ribbon-actions">
          <button type="button" className="buff-sheet-tool-button" onClick={handleCreateNew} title="新建装备项">
            <span className="buff-sheet-tool-icon" aria-hidden="true"><svg className="buff-sheet-tool-svg" viewBox="0 0 16 16" focusable="false"><path d="M8 3.25v9.5M3.25 8h9.5" /></svg></span>
            <span className="buff-sheet-tool-text">新建</span>
          </button>
          <button type="button" className="buff-sheet-tool-button" onClick={handleSave} title="保存当前装备库">
            <span className="buff-sheet-tool-icon" aria-hidden="true"><svg className="buff-sheet-tool-svg" viewBox="0 0 16 16" focusable="false"><path d="M3.25 2.75h7.5l2.25 2.25v8.25H3.25z" /><path d="M5.25 2.75v3.5h4.5v-3.5M5.25 10.25h5.5" /></svg></span>
            <span className="buff-sheet-tool-text">保存</span>
          </button>
          <button type="button" className="buff-sheet-tool-button" onClick={handleNormalize} title="整理套装与装备顺序">
            <span className="buff-sheet-tool-icon" aria-hidden="true"><svg className="buff-sheet-tool-svg" viewBox="0 0 16 16" focusable="false"><path d="M4 4.5h7.5M4 8h5.5M4 11.5h7.5" /><path d="M11 3.25l1.75 1.25L11 5.75" /></svg></span>
            <span className="buff-sheet-tool-text">整理</span>
          </button>
          <button type="button" className={`buff-sheet-tool-button${isOverwriteProtectionEnabled ? ' is-active' : ''}`} onClick={() => setIsOverwriteProtectionEnabled((prev) => !prev)} title="切换覆盖保护">
            <span className="buff-sheet-tool-icon" aria-hidden="true"><svg className="buff-sheet-tool-svg" viewBox="0 0 16 16" focusable="false"><path d="M8 2.5l4 1.5v3.25c0 2.5-1.5 4.75-4 6.25-2.5-1.5-4-3.75-4-6.25V4z" /><path d="M6.25 8.25L7.4 9.4l2.35-2.55" /></svg></span>
            <span className="buff-sheet-tool-text">{isOverwriteProtectionEnabled ? '保护开' : '保护关'}</span>
          </button>
          <button type="button" className="buff-sheet-tool-button" onClick={() => openShareModal('export')} title="导出本地装备库">
            <span className="buff-sheet-tool-icon" aria-hidden="true"><svg className="buff-sheet-tool-svg" viewBox="0 0 16 16" focusable="false"><path d="M8 3v6.5" /><path d="M5.75 7.25L8 9.5l2.25-2.25" /><path d="M3.5 11.75h9" /></svg></span>
            <span className="buff-sheet-tool-text">导出</span>
          </button>
          <button type="button" className="buff-sheet-tool-button" onClick={() => openShareModal('import')} title="导入装备分享">
            <span className="buff-sheet-tool-icon" aria-hidden="true"><svg className="buff-sheet-tool-svg" viewBox="0 0 16 16" focusable="false"><path d="M8 13V6.5" /><path d="M5.75 8.75L8 6.5l2.25 2.25" /><path d="M3.5 3.25h9" /></svg></span>
            <span className="buff-sheet-tool-text">导入</span>
          </button>
        </div>

        <div className={`weapon-sheet-image-slot${previewImageMeta.imgUrl ? ' has-image' : ''}${equipmentImageLoadFailed ? ' is-broken' : ''}`} title={previewImageMeta.title}>
          <div className="weapon-sheet-image-slot-square">
            {previewImageMeta.imgUrl && !equipmentImageLoadFailed ? (
              <img
                className="weapon-sheet-image-preview"
                src={normalizeAssetUrl(previewImageMeta.imgUrl)}
                alt={previewImageMeta.alt}
                onError={() => setEquipmentImageLoadFailed(true)}
              />
            ) : null}
            {previewImageMeta.imgUrl && equipmentImageLoadFailed ? (
              <span className="weapon-sheet-image-fallback">加载失败</span>
            ) : null}
            {!previewImageMeta.imgUrl ? (
              <span className="weapon-sheet-image-fallback">主图</span>
            ) : null}
          </div>
        </div>

        <div className="damage-sheet-formula-bar">
          <span className="damage-sheet-formula-address">{selectedCell?.address ?? '-'}</span>
          <span className="damage-sheet-formula-label">fx</span>
          {renderFormulaEditor()}
        </div>
      </section>

      <main className="damage-sheet-workspace weapon-sheet-workspace" onClick={closeContextMenu}>
        <aside
          className="damage-sheet-sidebar buff-sheet-explorer"
          onContextMenu={(event) => openContextMenu(event, { x: event.clientX, y: event.clientY, target: 'blank' })}
        >
          <div className="damage-sheet-sidebar-title">资源管理器</div>
          <input className="buff-sheet-search-input" value={filterKeyword} onChange={(event) => setFilterKeyword(event.target.value)} placeholder="按套装 / 装备 / 属性搜索" />
          <input ref={shareImportInputRef} type="file" accept=".json,application/json" className="operator-draft-file-input" onChange={handleShareFileSelected} />
          {renderExplorer()}
        </aside>

        <section className="damage-sheet-excel-shell">
          <div className="damage-sheet-excel-scroll" ref={tableScrollRef}>
            <div className="damage-sheet-excel-row is-header">
              <div className="damage-sheet-excel-row-number">#</div>
              <div className="damage-sheet-excel-row-cells">
                {COLUMNS.map((column) => (
                  <div key={column.key} className={`damage-sheet-excel-cell is-header is-${column.align ?? 'left'}`} style={{ width: `${column.width}px` }}>{column.title}</div>
                ))}
              </div>
            </div>
            {workbookRows.map((row) => (
              <div
                key={row.key}
                data-equipment-row-key={row.sourceRow.key}
                className={`${getWorkbookRowClassName(row)}${selectedRowKey === row.sourceRow.key ? ' is-active' : ''}`}
                onClick={() => focusRow(row.sourceRow.key)}
                onDoubleClick={() => {
                  if (row.sourceRow.kind === 'threePieceBuff') {
                    openEquipmentBuffDrawer(row.sourceRow.gearSetId, row.sourceRow.effectId);
                  }
                }}
                onContextMenu={(event) => {
                  const sourceRow = row.sourceRow;
                  if (sourceRow.kind === 'set') {
                    openContextMenu(event, { x: event.clientX, y: event.clientY, target: 'set', gearSetId: sourceRow.gearSetId });
                  } else if (sourceRow.kind === 'threePieceBuffHeader') {
                    openContextMenu(event, { x: event.clientX, y: event.clientY, target: 'threePieceBuffHeader', gearSetId: sourceRow.gearSetId });
                  } else if (sourceRow.kind === 'threePieceBuff') {
                    openContextMenu(event, { x: event.clientX, y: event.clientY, target: 'threePieceBuff', gearSetId: sourceRow.gearSetId, effectId: sourceRow.effectId });
                  } else if (sourceRow.kind === 'equipment') {
                    openContextMenu(event, { x: event.clientX, y: event.clientY, target: 'equipment', gearSetId: sourceRow.gearSetId, equipmentId: sourceRow.equipmentId });
                  } else if (sourceRow.kind === 'fixedStat') {
                    openContextMenu(event, { x: event.clientX, y: event.clientY, target: 'fixedStat', gearSetId: sourceRow.gearSetId, equipmentId: sourceRow.equipmentId });
                  } else if (sourceRow.kind === 'effect') {
                    openContextMenu(event, { x: event.clientX, y: event.clientY, target: 'effect', gearSetId: sourceRow.gearSetId, equipmentId: sourceRow.equipmentId, effectId: sourceRow.effectId });
                  } else {
                    openContextMenu(event, { x: event.clientX, y: event.clientY, target: 'effectLevels', gearSetId: sourceRow.gearSetId, equipmentId: sourceRow.equipmentId, effectId: sourceRow.effectId });
                  }
                }}
              >
                <div className="damage-sheet-excel-row-number">
                  {row.sourceRow.kind === 'set' || row.sourceRow.kind === 'threePieceBuffHeader' || row.sourceRow.kind === 'equipment' || row.sourceRow.kind === 'effect' ? (
                    <span className="damage-sheet-row-toggle" onClick={(event) => {
                      event.stopPropagation();
                      toggleRowCollapsed(row.sourceRow);
                    }}>{isRowCollapsed(row.sourceRow) ? '[+]' : '[-]'}</span>
                  ) : row.rowNumber}
                </div>
                <div className="damage-sheet-excel-row-cells">
                  {row.sourceRow.kind === 'effectLevels' ? (() => {
                    const levelRow = row.sourceRow;
                    const gearSet = library.gearSets[levelRow.gearSetId];
                    const equipment = gearSet?.equipments[levelRow.equipmentId];
                    const effect = equipment?.effects[levelRow.effectId];
                    return (
                      <div className="damage-sheet-excel-cell is-effectLevels is-left weapon-sheet-growth-merged-cell" style={{ width: `${COLUMNS.reduce((sum, column) => sum + column.width, 0)}px` }}>
                        <div className="weapon-sheet-growth-inline-grid weapon-sheet-levels-inline-grid">
                          {LEVEL_KEYS.map((levelKey) => (
                            <div key={levelKey} className="weapon-sheet-growth-inline-item">
                              <span className="weapon-sheet-growth-inline-label">{`Lv${levelKey}`}</span>
                              <input
                                className="weapon-sheet-inline-input equipment-sheet-preset-value"
                                type="number"
                                step="any"
                                value={effect?.levels[levelKey] == null ? '' : String(effect.levels[levelKey])}
                                onFocus={() => setSelectedCell({ address: `Lv${levelKey}`, sourceRowKey: levelRow.key, columnKey: 'valueText' })}
                                onChange={(event) => {
                                  setSelectedCell({ address: `Lv${levelKey}`, sourceRowKey: levelRow.key, columnKey: 'valueText' });
                                  updateCellValue(levelRow, 'valueText', `${levelKey}:${event.target.value}`);
                                }}
                              />
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })() : row.cells.map((cell) => (
                    <div
                      key={cell.key}
                      className={`damage-sheet-excel-cell is-${row.kind} is-${cell.align} is-col-${cell.columnKey}${selectedCell?.address === cell.address ? ' is-active' : ''}`}
                      style={{ width: `${cell.width}px` }}
                      onClick={(event) => {
                        event.stopPropagation();
                        const isTopLevelCell = row.sourceRow.kind === 'set' || row.sourceRow.kind === 'equipment';
                        if (isTopLevelCell) {
                          setSelectedRowKey(row.sourceRow.key);
                        } else {
                          focusRow(row.sourceRow.key);
                        }
                        setSelectedCell({ address: cell.address, sourceRowKey: cell.sourceRowKey, columnKey: cell.columnKey });
                      }}
                    >
                      {renderEditableCell(row, cell)}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      </main>

      <BuffEffectEditorDrawer
        open={Boolean(buffDrawerTarget)}
        sourceLabel={`装备三件套 · ${buffDrawerTarget ? library.gearSets[buffDrawerTarget.gearSetId]?.name ?? buffDrawerTarget.gearSetId : ''}`}
        effect={buffDrawerTarget
          ? (() => {
              const buff = library.gearSets[buffDrawerTarget.gearSetId]?.threePieceBuffs?.[buffDrawerTarget.effectId];
              return buff ? equipmentBuffToDrawer(buff) : null;
            })()
          : null}
        onChange={(nextEffect) => {
          if (!buffDrawerTarget) return;
          mutateLibrary((prev) => updateLibrarySet(prev, buffDrawerTarget.gearSetId, (gearSet) => ({
            ...gearSet,
            threePieceBuffs: {
              ...(gearSet.threePieceBuffs || {}),
              [buffDrawerTarget.effectId]: drawerEffectToEquipmentBuff(nextEffect),
            },
          })));
        }}
        onClose={() => setBuffDrawerTarget(null)}
      />

      {contextMenu ? (
        <div className="buff-sheet-context-menu" style={{ left: contextMenu.x, top: contextMenu.y }} onClick={(event) => event.stopPropagation()}>
          {buildContextMenuActions(contextMenu).map((action) => (
            <button key={action.key} type="button" className="buff-sheet-context-menu-item" onClick={() => { action.onClick(); closeContextMenu(); }}>
              <svg className="buff-sheet-context-menu-svg" viewBox="0 0 16 16" focusable="false">{renderMenuIcon(action.icon)}</svg>
              <span>{action.label}</span>
            </button>
          ))}
        </div>
      ) : null}

      {isSaveConfirmModalOpen ? (
        <div className="operator-draft-modal-overlay" onClick={() => setIsSaveConfirmModalOpen(false)}>
          <div className="operator-draft-modal operator-draft-confirm-modal" onClick={(event) => event.stopPropagation()}>
            <div className="operator-draft-section-header">
              <div>
                <h3>确认保存装备库</h3>
                <p>保护开启时，保存前需要确认覆盖本地装备 JSON。</p>
              </div>
            </div>
            <div className="operator-draft-confirm-body">
              <p>确认后会将当前 Sheet Equipment 编辑内容写入本地装备库文件。</p>
            </div>
            <div className="operator-draft-modal-actions">
              <button type="button" className="operator-draft-ghost-button" onClick={() => setIsSaveConfirmModalOpen(false)}>
                取消
              </button>
              <button type="button" className="operator-draft-copy-button operator-draft-danger-button" onClick={handleConfirmSave}>
                确认保存
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
                <button type="button" className={`buff-sheet-share-modal-tab${shareModalMode === 'export' ? ' is-active' : ''}`} onClick={() => setShareModalMode('export')}>导出</button>
                <button type="button" className={`buff-sheet-share-modal-tab${shareModalMode === 'import' ? ' is-active' : ''}`} onClick={() => setShareModalMode('import')}>导入</button>
              </div>
              <button type="button" className="buff-sheet-share-modal-close" onClick={closeShareModal} aria-label="关闭">×</button>
            </div>
            {shareModalMode === 'export' ? (
              <div className="buff-sheet-share-modal-body">
                <div className="buff-sheet-share-modal-copybar">
                  <div className="buff-sheet-share-modal-tabs">
                    <button type="button" className={`buff-sheet-share-modal-tab${exportScope === 'current' ? ' is-active' : ''}`} onClick={() => setExportScope('current')}>导出当前</button>
                    <button type="button" className={`buff-sheet-share-modal-tab${exportScope === 'all' ? ' is-active' : ''}`} onClick={() => setExportScope('all')}>导出全部</button>
                  </div>
                  <div className="buff-sheet-share-modal-actions">
                    <button type="button" className="buff-sheet-share-action" onClick={handleCopyShareJson}>复制 JSON</button>
                    <button type="button" className="buff-sheet-share-action is-primary" onClick={handleExportLocalLibrary}>导出文件</button>
                  </div>
                </div>
                <textarea className="buff-sheet-share-textarea is-preview" readOnly value={currentShareText} spellCheck={false} />
              </div>
            ) : (
              <div className="buff-sheet-share-modal-body">
                <div className="buff-sheet-share-modal-copybar">
                  <div className="buff-sheet-share-modal-copyhint">支持直接粘贴 JSON，或选择本地分享文件</div>
                  <div className="buff-sheet-share-modal-actions">
                    <button type="button" className="buff-sheet-share-action" onClick={handleOpenShareImportPicker}>导入文件</button>
                    <button type="button" className="buff-sheet-share-action is-primary" onClick={handleParseImportText}>读取粘贴内容</button>
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
                  placeholder="把装备分享 JSON 粘贴到这里，或点击右上角导入文件。"
                  spellCheck={false}
                />
                {shareImportError ? <div className="buff-sheet-share-feedback is-error">{shareImportError}</div> : null}
                {pendingImportShare ? (
                  <div className="buff-sheet-share-import-preview">
                    <div className="buff-sheet-share-import-title">导入预览</div>
                    <div className="buff-sheet-share-import-meta">
                      <span>{`名称：${pendingImportShare.label}`}</span>
                      <span>{`套装数：${Object.keys(pendingImportShare.payload).length}`}</span>
                    </div>
                    <div className="buff-sheet-share-modal-actions">
                      <button type="button" className="buff-sheet-share-action" onClick={handleCancelImportShare}>清空预览</button>
                      <button type="button" className="buff-sheet-share-action is-primary" onClick={handleConfirmImportShare}>确认导入</button>
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
