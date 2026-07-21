import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import './OperatorDraftPage.css';
import './BuffDraftPage.css';
import type { BuffEffectKind } from '../core/domain/buff';
import { APP_ROUTE_PATHS, navigateToAppPath } from '../utils/appRoute';

import * as buffDraftPageModel from './buffDraftPageModel';
import { useBuffExplorerDrag } from './useBuffExplorerDrag';
import { buildBuffFormulaTextBinding } from './buffDraftFormula';
import { useBuffDraftShare } from './useBuffDraftShare';
type BuffUndoSnapshot = buffDraftPageModel.BuffUndoSnapshot;
type BuffEffectDraft = buffDraftPageModel.BuffEffectDraft;
type BuffItemDraft = buffDraftPageModel.BuffItemDraft;
type BuffDraft = buffDraftPageModel.BuffDraft;
type BuffSheetRow = buffDraftPageModel.BuffSheetRow;
type BuffSheetContextMenuState = buffDraftPageModel.BuffSheetContextMenuState;
type BuffWorkbookSelection = buffDraftPageModel.BuffWorkbookSelection;
type FormulaFocusSnapshot = buffDraftPageModel.FormulaFocusSnapshot;

const {
  BUFF_DRAFT_STORAGE_KEY,
  BUFF_LIBRARY_STORAGE_KEY,
  BUFF_TYPE_OPTIONS,
  BUFF_TYPE_LABELS,
  MULTIPLIER_SUPPORTED_BUFF_TYPES,
  createDefaultBuffName,
  createDefaultBuffEffect,
  createDefaultBuffItem,
  createEmptyBuffDraft,
  getNextDraftId,
  buildBuffDraftIdFromName,
  getBuffEffectMultiplier,
  applyBuffEffectKind,
  getNextItemKey,
  getNextEffectKey,
  normalizeBuffDraft,
  normalizeBuffDraftLibrary,
  reorderDraftStructure,
  loadDraftFromStorage,
  loadLocalBuffLibrary,
  cloneValue,
  readBuffUndoSnapshots,
  captureBuffUndoSnapshot,
  restoreBuffUndoSnapshot,
  buildBuffSheetRows,
  buildCollapsedDraftState,
  buildCollapsedItemState,
  buildBuffSheetColumns,
  buildBuffWorkbookView,
} = buffDraftPageModel;

export function useBuffDraftPageController() {
  const [draft, setDraft] = useState<BuffDraft>(() => loadDraftFromStorage());
  const [localLibrary, setLocalLibrary] = useState<Record<string, BuffDraft>>({});
  const [selectedLocalDraftId, setSelectedLocalDraftId] = useState('');
  const [undoSnapshots, setUndoSnapshots] = useState<BuffUndoSnapshot[]>([]);
  const [isUndoMenuOpen, setIsUndoMenuOpen] = useState(false);
  const [filterKeyword, setFilterKeyword] = useState('');
  const [buffTypeQuery, setBuffTypeQuery] = useState('');
  const [collapsedItems, setCollapsedItems] = useState<Record<string, boolean>>({});
  const [collapsedDraftIds, setCollapsedDraftIds] = useState<Record<string, boolean>>({});
  const [isOverwriteProtectionEnabled, setIsOverwriteProtectionEnabled] = useState(true);
  const [isOverwriteDraftModalOpen, setIsOverwriteDraftModalOpen] = useState(false);
  const [selectedWorkbookCell, setSelectedWorkbookCell] = useState<BuffWorkbookSelection | null>(null);
  const [pendingFocusRowKey, setPendingFocusRowKey] = useState<string | null>(null);
  const [effectValueInput, setEffectValueInput] = useState('');
  const [formulaTextInput, setFormulaTextInput] = useState('');
  const [contextMenu, setContextMenu] = useState<BuffSheetContextMenuState | null>(null);
  const [buffDrawerTarget, setBuffDrawerTarget] = useState<{ itemKey: string; effectKey: string } | null>(null);
  const columns = useMemo(() => buildBuffSheetColumns(), []);
  const getItemCollapseKey = useCallback((draftId: string, itemKey: string) => `${draftId}:${itemKey}`, []);
  const formulaBarRef = useRef<HTMLDivElement>(null);
  const pendingFormulaFocusRef = useRef<FormulaFocusSnapshot | null>(null);
  const [formulaFocusRestoreToken, setFormulaFocusRestoreToken] = useState(0);

  const applyExplorerDefaultCollapse = useCallback((nextLibrary: Record<string, BuffDraft>) => {
    setCollapsedDraftIds(buildCollapsedDraftState(nextLibrary));
    setCollapsedItems(buildCollapsedItemState(nextLibrary, getItemCollapseKey));
  }, [getItemCollapseKey]);

  const syncUndoSnapshots = useCallback(() => {
    setUndoSnapshots(readBuffUndoSnapshots());
  }, []);

  const withUndo = useCallback((label: string, fn: () => void) => {
    captureBuffUndoSnapshot(label, {
      selectedDraftId: selectedLocalDraftId || draft.id || undefined,
    });
    fn();
    syncUndoSnapshots();
  }, [draft.id, selectedLocalDraftId, syncUndoSnapshots]);

  const handleRestoreUndoSnapshot = useCallback((snapshotId: string) => {
    const restored = restoreBuffUndoSnapshot(snapshotId);
    if (!restored) {
      return;
    }

    const nextLibrary = loadLocalBuffLibrary();
    const nextDraftFromStorage = loadDraftFromStorage();
    const nextSelectedId = restored.selectedDraftId && nextLibrary[restored.selectedDraftId]
      ? restored.selectedDraftId
      : (Object.keys(nextLibrary)[0] ?? nextDraftFromStorage.id);
    const nextDraft = nextSelectedId && nextLibrary[nextSelectedId]
      ? normalizeBuffDraft(cloneValue(nextLibrary[nextSelectedId]))
      : nextDraftFromStorage;

    setLocalLibrary(nextLibrary);
    applyExplorerDefaultCollapse(nextLibrary);
    setSelectedLocalDraftId(nextSelectedId);
    setDraft(nextDraft);
    setFilterKeyword('');
    setSelectedWorkbookCell(null);
    setPendingFocusRowKey(`group-${nextDraft.id}`);
    setIsUndoMenuOpen(false);
    syncUndoSnapshots();
  }, [applyExplorerDefaultCollapse, syncUndoSnapshots]);

  const refreshLocalLibrary = useCallback(() => {
    const nextLibrary = {
      ...loadLocalBuffLibrary(),
      [draft.id]: normalizeBuffDraft(draft),
    };
    setLocalLibrary(nextLibrary);
    applyExplorerDefaultCollapse(nextLibrary);
    setSelectedLocalDraftId((prev) => prev || draft.id || Object.keys(nextLibrary)[0] || '');
  }, [applyExplorerDefaultCollapse, draft]);

  useEffect(() => {
    syncUndoSnapshots();
  }, [syncUndoSnapshots]);

  const handleCollapseAllDrafts = useCallback(() => {
    applyExplorerDefaultCollapse(localLibrary);
  }, [applyExplorerDefaultCollapse, localLibrary]);

  const handleExpandAllDrafts = useCallback(() => {
    setCollapsedDraftIds(Object.fromEntries(Object.keys(localLibrary).map((draftId) => [draftId, false])));
  }, [localLibrary]);

  const handleCollapseAllItemsInDraft = useCallback((draftId: string) => {
    const targetDraft = localLibrary[draftId];
    if (!targetDraft) {
      return;
    }
    setCollapsedItems((prev) => ({
      ...prev,
      ...Object.fromEntries(Object.keys(targetDraft.items).map((itemKey) => [getItemCollapseKey(draftId, itemKey), true])),
    }));
  }, [getItemCollapseKey, localLibrary]);

  const handleExpandAllItemsInDraft = useCallback((draftId: string) => {
    const targetDraft = localLibrary[draftId];
    if (!targetDraft) {
      return;
    }
    setCollapsedItems((prev) => ({
      ...prev,
      ...Object.fromEntries(Object.keys(targetDraft.items).map((itemKey) => [getItemCollapseKey(draftId, itemKey), false])),
    }));
  }, [getItemCollapseKey, localLibrary]);

  const {
    isShareModalOpen, shareModalMode, setShareModalMode, shareImportText, setShareImportText,
    shareImportError, setShareImportError, pendingImportShare, shareImportInputRef,
    currentSheetShareText, openSheetShareModal, closeSheetShareModal, handleExportSheetLibraryShare,
    handleOpenSheetShareImportPicker, handleSheetShareFileSelected, handleParseSheetImportText,
    handleCopySheetShareJson, handleCancelSheetImportShare, handleConfirmSheetImportShare,
  } = useBuffDraftShare({
    applyExplorerDefaultCollapse, draft, selectedLocalDraftId, setDraft, setLocalLibrary,
    setPendingFocusRowKey, setSelectedLocalDraftId,
  });

  useEffect(() => {
    const nextLibrary = {
      ...loadLocalBuffLibrary(),
      [draft.id]: normalizeBuffDraft(draft),
    };
    setLocalLibrary(nextLibrary);
    applyExplorerDefaultCollapse(nextLibrary);
    setSelectedLocalDraftId((prev) => prev || draft.id || Object.keys(nextLibrary)[0] || '');
    // Only initialize once. Subsequent draft edits must not re-collapse the explorer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rows = useMemo(() => buildBuffSheetRows(draft), [draft]);
  const visibleRows = useMemo(() => {
    const keyword = filterKeyword.trim().toLowerCase();
    if (!keyword) {
      return rows.filter((row) => row.kind !== 'effect' || !collapsedItems[getItemCollapseKey(draft.id, row.itemKey)]);
    }

    const matchedItemKeys = new Set<string>();
    rows.forEach((row) => {
      if (row.kind === 'effect' && row.searchText.includes(keyword)) {
        matchedItemKeys.add(row.itemKey);
      }
    });

    return rows.filter((row) => {
      if (row.kind === 'group') {
        return true;
      }
      if (row.kind === 'item') {
        return row.searchText.includes(keyword) || matchedItemKeys.has(row.itemKey);
      }
      return row.searchText.includes(keyword);
    });
  }, [collapsedItems, draft.id, filterKeyword, getItemCollapseKey, rows]);
  const workbookRows = useMemo(() => buildBuffWorkbookView(visibleRows, columns), [columns, visibleRows]);

  useLayoutEffect(() => {
    const snapshot = pendingFormulaFocusRef.current;
    if (!snapshot) {
      return;
    }
    const container = formulaBarRef.current;
    if (!container) {
      return;
    }
    const target = container.querySelector<HTMLElement>(`[data-formula-focus-id="${snapshot.focusId}"]`);
    if (!target) {
      return;
    }
    target.focus();
    if ('setSelectionRange' in target && typeof snapshot.selectionStart === 'number' && typeof snapshot.selectionEnd === 'number') {
      (target as HTMLInputElement).setSelectionRange(snapshot.selectionStart, snapshot.selectionEnd);
    }
    pendingFormulaFocusRef.current = null;
  }, [formulaFocusRestoreToken]);

  useEffect(() => {
    const resolveCellFromSelection = (selection: BuffWorkbookSelection | null) => {
      if (!selection) {
        return null;
      }
      if (selection.sourceRowKey) {
        const matchedRow = workbookRows.find((row) => row.sourceRow?.key === selection.sourceRowKey);
        if (matchedRow) {
          if (selection.columnKey) {
            const matchedCell = matchedRow.cells.find((cell) => cell.columnKey === selection.columnKey);
            if (matchedCell) {
              return matchedCell;
            }
          }
          return matchedRow.cells[0] ?? null;
        }
      }
      return workbookRows
        .flatMap((row) => row.cells)
        .find((cell) => cell.address === selection.address) ?? null;
    };

    const resolveCellByRowKey = (rowKey: string) => {
      const matchedRow = workbookRows.find((row) => row.sourceRow?.key === rowKey);
      return matchedRow?.cells[0] ?? null;
    };

    if (pendingFocusRowKey) {
      const targetCell = resolveCellByRowKey(pendingFocusRowKey);
      if (targetCell) {
        setSelectedWorkbookCell({
          address: targetCell.address,
          value: targetCell.value,
          sourceRowKey: targetCell.sourceRowKey,
          columnKey: targetCell.columnKey,
        });
        setPendingFocusRowKey(null);
        return;
      }
    }

    const firstDataRow = workbookRows.find((row) => row.kind === 'data') ?? workbookRows[0] ?? null;
    const firstCell = firstDataRow?.cells[0] ?? null;
    if (!firstCell) {
      setSelectedWorkbookCell(null);
      return;
    }
    const resolvedSelectedCell = resolveCellFromSelection(selectedWorkbookCell);
    if (resolvedSelectedCell) {
      if (
        resolvedSelectedCell.address !== selectedWorkbookCell?.address
        || resolvedSelectedCell.value !== selectedWorkbookCell?.value
        || resolvedSelectedCell.sourceRowKey !== selectedWorkbookCell?.sourceRowKey
        || resolvedSelectedCell.columnKey !== selectedWorkbookCell?.columnKey
      ) {
        setSelectedWorkbookCell({
          address: resolvedSelectedCell.address,
          value: resolvedSelectedCell.value,
          sourceRowKey: resolvedSelectedCell.sourceRowKey,
          columnKey: resolvedSelectedCell.columnKey,
        });
      }
      return;
    }
    if (!selectedWorkbookCell) {
      setSelectedWorkbookCell({
        address: firstCell.address,
        value: firstCell.value,
        sourceRowKey: firstCell.sourceRowKey,
        columnKey: firstCell.columnKey,
      });
    }
  }, [pendingFocusRowKey, selectedWorkbookCell, workbookRows]);

  const handleLoadDraftById = useCallback((draftId: string) => {
    const nextDraft = localLibrary[draftId];
    if (!nextDraft) {
      return;
    }
    setDraft(nextDraft);
    setSelectedLocalDraftId(draftId);
    setCollapsedDraftIds(buildCollapsedDraftState(localLibrary));
    setCollapsedItems(buildCollapsedItemState(localLibrary, getItemCollapseKey));
    setFilterKeyword('');
    setSelectedWorkbookCell(null);
    setPendingFocusRowKey(`group-${nextDraft.id}`);
  }, [getItemCollapseKey, localLibrary]);

  const openBuffDrawer = useCallback((draftId: string, itemKey: string, effectKey: string) => {
    const targetDraft = draftId === draft.id ? draft : localLibrary[draftId];
    if (!targetDraft?.items[itemKey]?.effects[effectKey]) {
      return;
    }
    if (draftId !== draft.id) {
      setDraft(targetDraft);
      setSelectedLocalDraftId(draftId);
      setSelectedWorkbookCell(null);
      setPendingFocusRowKey(`effect-${itemKey}-${effectKey}`);
    }
    setBuffDrawerTarget({ itemKey, effectKey });
  }, [draft, localLibrary]);

  const handleOpenWorkbenchPage = () => {
    navigateToAppPath(APP_ROUTE_PATHS.home);
  };

  const handleOpenBuffEditorPage = () => {
    navigateToAppPath(APP_ROUTE_PATHS.buffSheet);
  };

  const toggleItemCollapsed = (itemKey: string) => {
    const collapseKey = getItemCollapseKey(draft.id, itemKey);
    setCollapsedItems((prev) => ({ ...prev, [collapseKey]: !prev[collapseKey] }));
  };

  const toggleDraftCollapsed = (draftId: string) => {
    setCollapsedDraftIds((prev) => ({ ...prev, [draftId]: !prev[draftId] }));
  };

  const setDraftCollapsed = useCallback((draftId: string, collapsed: boolean) => {
    setCollapsedDraftIds((prev) => ({ ...prev, [draftId]: collapsed }));
  }, []);

  const setItemCollapsed = useCallback((draftId: string, itemKey: string, collapsed: boolean) => {
    setCollapsedItems((prev) => ({ ...prev, [getItemCollapseKey(draftId, itemKey)]: collapsed }));
  }, [getItemCollapseKey]);

  const selectedWorkbookSummary = selectedWorkbookCell?.sourceRowKey
    ? visibleRows.find((row) => row.key === selectedWorkbookCell.sourceRowKey)
    : null;
  const selectedItemKey = selectedWorkbookSummary?.kind === 'item'
    ? selectedWorkbookSummary.itemKey
    : selectedWorkbookSummary?.kind === 'effect'
      ? selectedWorkbookSummary.itemKey
      : null;
  const selectedEffectKey = selectedWorkbookSummary?.kind === 'effect'
    ? selectedWorkbookSummary.effectKey
    : null;
  const selectedItem = selectedItemKey ? draft.items[selectedItemKey] ?? null : null;
  const selectedEffect = selectedItemKey && selectedEffectKey
    ? draft.items[selectedItemKey]?.effects[selectedEffectKey] ?? null
    : null;
  const drawerEffect = buffDrawerTarget
    ? draft.items[buffDrawerTarget.itemKey]?.effects[buffDrawerTarget.effectKey] ?? null
    : null;
  const filteredBuffTypeOptions = useMemo(() => {
    const keyword = buffTypeQuery.trim().toLowerCase();
    const options = getBuffEffectMultiplier(selectedEffect ?? {})
      ? BUFF_TYPE_OPTIONS.filter((option) => MULTIPLIER_SUPPORTED_BUFF_TYPES.includes(option))
      : BUFF_TYPE_OPTIONS;
    if (!keyword) {
      return options;
    }
    return options.filter((option) => {
      const meta = BUFF_TYPE_LABELS[option];
      const haystack = [option, meta.label, ...meta.keywords].join('|').toLowerCase();
      return haystack.includes(keyword);
    });
  }, [buffTypeQuery, selectedEffect]);

  useEffect(() => {
    if (!selectedEffect || selectedEffect.effectKind === 'extraHit') {
      setEffectValueInput('');
      return;
    }
    const multiplier = getBuffEffectMultiplier(selectedEffect);
    if (multiplier) {
      setEffectValueInput(String(multiplier.coefficient));
      return;
    }
    setEffectValueInput(String(selectedEffect.value ?? 0));
  }, [selectedEffect?.effectKind, selectedEffect?.id, selectedEffect?.multiplier, selectedEffect?.value]);

  const updateDraftField = useCallback(<K extends keyof BuffDraft>(field: K, value: BuffDraft[K]) => {
    setDraft((prev) => {
      if (field === 'name') {
        const nextName = String(value);
        return {
          ...prev,
          name: nextName,
          id: buildBuffDraftIdFromName(nextName) || prev.id,
        };
      }
      return { ...prev, [field]: value };
    });
  }, []);

  const updateSelectedItem = useCallback((updater: (item: BuffItemDraft) => BuffItemDraft) => {
    if (!selectedItemKey) {
      return;
    }
    setDraft((prev) => ({
      ...prev,
      items: {
        ...prev.items,
        [selectedItemKey]: updater(prev.items[selectedItemKey]),
      },
    }));
  }, [selectedItemKey]);

  const updateSelectedEffect = useCallback((updater: (effect: BuffEffectDraft) => BuffEffectDraft) => {
    if (!selectedItemKey || !selectedEffectKey) {
      return;
    }
    setDraft((prev) => ({
      ...prev,
      items: {
        ...prev.items,
        [selectedItemKey]: {
          ...prev.items[selectedItemKey],
          effects: {
            ...prev.items[selectedItemKey].effects,
            [selectedEffectKey]: updater(prev.items[selectedItemKey].effects[selectedEffectKey]),
          },
        },
      },
    }));
  }, [selectedEffectKey, selectedItemKey]);

  const formulaTextBinding = useMemo(() => buildBuffFormulaTextBinding({
    draft,
    selectedEffect,
    selectedItem,
    selectedWorkbookCell,
    selectedWorkbookSummary,
    updateDraftField,
    updateSelectedEffect,
    updateSelectedItem,
  }), [
    draft,
    selectedEffect,
    selectedItem,
    selectedWorkbookCell,
    selectedWorkbookSummary,
    updateDraftField,
    updateSelectedEffect,
    updateSelectedItem,
  ]);

  useEffect(() => {
    setFormulaTextInput(formulaTextBinding?.value ?? '');
  }, [formulaTextBinding?.key, formulaTextBinding?.value]);

  const updateSelectedEffectKind = useCallback((nextKind: BuffEffectKind) => {
    updateSelectedEffect((prev) => applyBuffEffectKind(prev, nextKind));
  }, [updateSelectedEffect]);

  const handleEffectValueInputChange = useCallback((nextValue: string) => {
    setEffectValueInput(nextValue);
    if (!selectedEffect || getBuffEffectMultiplier(selectedEffect)) {
      return;
    }
    if (nextValue.trim() === '') {
      return;
    }
    const parsed = Number(nextValue);
    if (Number.isFinite(parsed)) {
      updateSelectedEffect((prev) => ({ ...prev, value: parsed }));
    }
  }, [selectedEffect, updateSelectedEffect]);

  const finalizeEffectValueInput = useCallback(() => {
    if (!selectedEffect || selectedEffect.effectKind === 'extraHit' || getBuffEffectMultiplier(selectedEffect)) {
      setEffectValueInput('');
      return;
    }
    const trimmed = effectValueInput.trim();
    if (trimmed === '') {
      updateSelectedEffect((prev) => ({ ...prev, value: 0 }));
      setEffectValueInput('0');
      return;
    }
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) {
      setEffectValueInput(String(selectedEffect.value ?? 0));
      return;
    }
    updateSelectedEffect((prev) => ({ ...prev, value: parsed }));
    setEffectValueInput(String(parsed));
  }, [effectValueInput, selectedEffect, updateSelectedEffect]);

  const buildDraftWithFormulaTextInput = useCallback((baseDraft: BuffDraft) => {
    if (!formulaTextBinding || formulaTextInput === formulaTextBinding.value) {
      return baseDraft;
    }

    if (selectedWorkbookSummary?.kind === 'group') {
      if (selectedWorkbookCell?.columnKey === 'idText') {
        return { ...baseDraft, id: formulaTextInput };
      }
      if (selectedWorkbookCell?.columnKey === 'description') {
        return { ...baseDraft, description: formulaTextInput };
      }
      return {
        ...baseDraft,
        name: formulaTextInput,
        id: buildBuffDraftIdFromName(formulaTextInput) || baseDraft.id,
      };
    }

    if (selectedWorkbookSummary?.kind === 'item' && selectedItemKey) {
      const targetItem = baseDraft.items[selectedItemKey];
      if (!targetItem) {
        return baseDraft;
      }

      const nextItem = selectedWorkbookCell?.columnKey === 'idText'
        ? { ...targetItem, id: formulaTextInput }
        : selectedWorkbookCell?.columnKey === 'description'
          ? { ...targetItem, description: formulaTextInput }
          : { ...targetItem, name: formulaTextInput };

      return {
        ...baseDraft,
        items: {
          ...baseDraft.items,
          [selectedItemKey]: nextItem,
        },
      };
    }

    if (selectedWorkbookSummary?.kind === 'effect' && selectedItemKey && selectedEffectKey) {
      const targetItem = baseDraft.items[selectedItemKey];
      const targetEffect = targetItem?.effects[selectedEffectKey];
      if (!targetItem || !targetEffect) {
        return baseDraft;
      }

      const nextEffect = selectedWorkbookCell?.columnKey === 'condition'
        ? { ...targetEffect, condition: formulaTextInput }
        : selectedWorkbookCell?.columnKey === 'description'
          ? { ...targetEffect, description: formulaTextInput }
          : { ...targetEffect, displayName: formulaTextInput };

      return {
        ...baseDraft,
        items: {
          ...baseDraft.items,
          [selectedItemKey]: {
            ...targetItem,
            effects: {
              ...targetItem.effects,
              [selectedEffectKey]: nextEffect,
            },
          },
        },
      };
    }

    return baseDraft;
  }, [
    formulaTextBinding,
    formulaTextInput,
    selectedEffectKey,
    selectedItemKey,
    selectedWorkbookCell?.columnKey,
    selectedWorkbookSummary,
  ]);

  const persistDraftToLibrary = useCallback((allowOverwrite: boolean, focusRowKey?: string | null, draftOverride?: BuffDraft) => {
    const library = loadLocalBuffLibrary();
    const existingIds = Object.keys(library);
    const workingDraft = draftOverride ?? draft;
    const nextDraftId = workingDraft.id.trim() || getNextDraftId(existingIds);

    if (library[nextDraftId] && !allowOverwrite) {
      setIsOverwriteDraftModalOpen(true);
      return false;
    }

    const nextDraft = normalizeBuffDraft({
      ...workingDraft,
      id: nextDraftId,
    });

    const nextLibrary = normalizeBuffDraftLibrary({ ...library });
    nextLibrary[nextDraftId] = nextDraft;

    const normalizedLibrary = normalizeBuffDraftLibrary(nextLibrary);
    window.localStorage.setItem(BUFF_LIBRARY_STORAGE_KEY, JSON.stringify(normalizedLibrary));
    window.localStorage.setItem(BUFF_DRAFT_STORAGE_KEY, JSON.stringify(nextDraft));
    setDraft(nextDraft);
    setLocalLibrary(normalizedLibrary);
    setSelectedLocalDraftId(nextDraftId);
    setIsOverwriteDraftModalOpen(false);
    setPendingFocusRowKey(focusRowKey ?? `group-${nextDraftId}`);
    return true;
  }, [draft, selectedLocalDraftId]);

  const handleSaveDraft = useCallback(() => {
    const activeElement = typeof document !== 'undefined' ? document.activeElement : null;
    const formulaField = activeElement instanceof HTMLElement
      ? activeElement.closest<HTMLElement>('[data-formula-focus-id]')
      : null;
    const nextDraft = buildDraftWithFormulaTextInput(draft);
    if (formulaField && formulaBarRef.current?.contains(formulaField)) {
      const selectionCapable = formulaField as HTMLInputElement;
      pendingFormulaFocusRef.current = {
        focusId: formulaField.dataset.formulaFocusId || '',
        selectionStart: typeof selectionCapable.selectionStart === 'number' ? selectionCapable.selectionStart : null,
        selectionEnd: typeof selectionCapable.selectionEnd === 'number' ? selectionCapable.selectionEnd : null,
      };
      setFormulaFocusRestoreToken((prev) => prev + 1);
    }
    if (nextDraft !== draft) {
      setDraft(nextDraft);
    }
    persistDraftToLibrary(!isOverwriteProtectionEnabled, selectedWorkbookCell?.sourceRowKey ?? null, nextDraft);
  }, [buildDraftWithFormulaTextInput, draft, isOverwriteProtectionEnabled, persistDraftToLibrary, selectedWorkbookCell]);

  const handleConfirmOverwriteDraft = useCallback(() => {
    const nextDraft = buildDraftWithFormulaTextInput(draft);
    if (nextDraft !== draft) {
      setDraft(nextDraft);
    }
    persistDraftToLibrary(true, selectedWorkbookCell?.sourceRowKey ?? null, nextDraft);
  }, [buildDraftWithFormulaTextInput, draft, persistDraftToLibrary, selectedWorkbookCell]);

  const handleCreateNewDraft = useCallback(() => {
    const nextDraftId = getNextDraftId(Object.keys(localLibrary));
    const nextDraft = createEmptyBuffDraft(nextDraftId);
    setLocalLibrary((prev) => ({
      ...prev,
      [nextDraftId]: nextDraft,
    }));
    setDraft(nextDraft);
    setSelectedLocalDraftId(nextDraftId);
    setCollapsedDraftIds((prev) => ({
      ...prev,
      [nextDraftId]: true,
    }));
    setSelectedWorkbookCell(null);
    setPendingFocusRowKey(`group-${nextDraftId}`);
  }, [localLibrary]);

  const handleNormalizeDraft = useCallback(() => {
    const nextDraft = reorderDraftStructure(cloneValue(draft));
    setDraft(nextDraft);
    setPendingFocusRowKey(`group-${nextDraft.id}`);
  }, [draft]);

  const persistLibraryState = useCallback((nextLibrary: Record<string, BuffDraft>, nextSelectedId?: string) => {
    const normalizedLibrary = normalizeBuffDraftLibrary(nextLibrary);
    window.localStorage.setItem(BUFF_LIBRARY_STORAGE_KEY, JSON.stringify(normalizedLibrary));
    setLocalLibrary(normalizedLibrary);
    if (nextSelectedId) {
      setSelectedLocalDraftId(nextSelectedId);
      if (normalizedLibrary[nextSelectedId]) {
        setDraft(normalizedLibrary[nextSelectedId]);
        window.localStorage.setItem(BUFF_DRAFT_STORAGE_KEY, JSON.stringify(normalizedLibrary[nextSelectedId]));
      }
    }
  }, []);

  const handleCreateDraftItem = useCallback((draftId: string) => {
    const targetDraft = localLibrary[draftId];
    if (!targetDraft) {
      return;
    }
    const nextItemKey = getNextItemKey(targetDraft);
    const nextItem = createDefaultBuffItem(nextItemKey, targetDraft.sourceName || targetDraft.name);
    const nextDraft = {
      ...cloneValue(targetDraft),
      items: {
        ...cloneValue(targetDraft.items),
        [nextItemKey]: nextItem,
      },
    };
    const nextLibrary = { ...localLibrary, [draftId]: nextDraft };
    persistLibraryState(nextLibrary, draftId);
    setCollapsedItems((prev) => ({ ...prev, [getItemCollapseKey(draftId, nextItemKey)]: false }));
    setPendingFocusRowKey(`item-${nextItemKey}`);
  }, [getItemCollapseKey, localLibrary, persistLibraryState]);

  const handleDuplicateDraftItem = useCallback((draftId: string, itemKey: string) => {
    const targetDraft = localLibrary[draftId];
    const targetItem = targetDraft?.items[itemKey];
    if (!targetDraft || !targetItem) {
      return;
    }
    const nextItemKey = getNextItemKey(targetDraft);
    const duplicated = cloneValue(targetItem);
    duplicated.id = nextItemKey;
    duplicated.name = `${targetItem.name}（副本）`;
    const nextDraft = {
      ...cloneValue(targetDraft),
      items: {
        ...cloneValue(targetDraft.items),
        [nextItemKey]: duplicated,
      },
    };
    const nextLibrary = { ...localLibrary, [draftId]: nextDraft };
    persistLibraryState(nextLibrary, draftId);
    setPendingFocusRowKey(`item-${nextItemKey}`);
  }, [localLibrary, persistLibraryState]);

  const handleDeleteDraftItem = useCallback((draftId: string, itemKey: string) => {
    const targetDraft = localLibrary[draftId];
    if (!targetDraft?.items[itemKey]) {
      return;
    }
    withUndo(`删除自定义项 · ${itemKey}`, () => {
      const nextDraft = cloneValue(targetDraft);
      delete nextDraft.items[itemKey];
      const nextLibrary = { ...localLibrary, [draftId]: nextDraft };
      persistLibraryState(nextLibrary, draftId);
      const nextItemKey = Object.keys(nextDraft.items)[0] ?? null;
      setPendingFocusRowKey(nextItemKey ? `item-${nextItemKey}` : `group-${nextDraft.id}`);
    });
  }, [localLibrary, persistLibraryState, withUndo]);

  const handleCreateDraftEffect = useCallback((draftId: string, itemKey: string) => {
    const targetDraft = localLibrary[draftId];
    const targetItem = targetDraft?.items[itemKey];
    if (!targetDraft || !targetItem) {
      return;
    }
    const nextEffectKey = getNextEffectKey(targetItem);
    const nextEffect = createDefaultBuffEffect(nextEffectKey, targetItem.sourceName || targetDraft.sourceName);
    const nextDraft = cloneValue(targetDraft);
    nextDraft.items[itemKey].effects[nextEffectKey] = nextEffect;
    const nextLibrary = { ...localLibrary, [draftId]: nextDraft };
    persistLibraryState(nextLibrary, draftId);
    setCollapsedItems((prev) => ({ ...prev, [getItemCollapseKey(draftId, itemKey)]: false }));
    setPendingFocusRowKey(`effect-${itemKey}-${nextEffectKey}`);
    setBuffDrawerTarget({ itemKey, effectKey: nextEffectKey });
  }, [getItemCollapseKey, localLibrary, persistLibraryState]);

  const handleDuplicateDraftEffect = useCallback((draftId: string, itemKey: string, effectKey: string) => {
    const targetDraft = localLibrary[draftId];
    const targetItem = targetDraft?.items[itemKey];
    const targetEffect = targetItem?.effects[effectKey];
    if (!targetDraft || !targetItem || !targetEffect) {
      return;
    }
    const nextEffectKey = getNextEffectKey(targetItem);
    const duplicated = cloneValue(targetEffect);
    duplicated.id = nextEffectKey;
    duplicated.displayName = `${targetEffect.displayName}（副本）`;
    duplicated.name = `${createDefaultBuffName(nextEffectKey)}_copy`;
    const nextDraft = cloneValue(targetDraft);
    nextDraft.items[itemKey].effects[nextEffectKey] = duplicated;
    const nextLibrary = { ...localLibrary, [draftId]: nextDraft };
    persistLibraryState(nextLibrary, draftId);
    setPendingFocusRowKey(`effect-${itemKey}-${nextEffectKey}`);
    setBuffDrawerTarget({ itemKey, effectKey: nextEffectKey });
  }, [localLibrary, persistLibraryState]);

  const handleDeleteDraftEffect = useCallback((draftId: string, itemKey: string, effectKey: string) => {
    const targetDraft = localLibrary[draftId];
    const targetItem = targetDraft?.items[itemKey];
    if (!targetDraft || !targetItem?.effects[effectKey]) {
      return;
    }
    withUndo(`删除 Buff 效果 · ${effectKey}`, () => {
      const nextDraft = cloneValue(targetDraft);
      delete nextDraft.items[itemKey].effects[effectKey];
      const nextLibrary = { ...localLibrary, [draftId]: nextDraft };
      persistLibraryState(nextLibrary, draftId);
      const nextEffectKey = Object.keys(nextDraft.items[itemKey].effects)[0] ?? null;
      setPendingFocusRowKey(nextEffectKey ? `effect-${itemKey}-${nextEffectKey}` : `item-${itemKey}`);
    });
  }, [localLibrary, persistLibraryState, withUndo]);

  const handleDeleteDraftGroup = useCallback((draftId: string) => {
    if (!localLibrary[draftId]) {
      return;
    }
    withUndo(`删除本地组 · ${draftId}`, () => {
      const nextLibrary = cloneValue(localLibrary);
      delete nextLibrary[draftId];
      const nextSelectedId = Object.keys(nextLibrary)[0] ?? '';
      const normalizedLibrary = normalizeBuffDraftLibrary(nextLibrary);
      window.localStorage.setItem(BUFF_LIBRARY_STORAGE_KEY, JSON.stringify(normalizedLibrary));
      setLocalLibrary(normalizedLibrary);
      setSelectedLocalDraftId(nextSelectedId);
      if (nextSelectedId && normalizedLibrary[nextSelectedId]) {
        setDraft(normalizedLibrary[nextSelectedId]);
        setPendingFocusRowKey(`group-${nextSelectedId}`);
      } else {
        const nextDraftId = getNextDraftId([]);
        const nextDraft = createEmptyBuffDraft(nextDraftId);
        setDraft(nextDraft);
        setPendingFocusRowKey(`group-${nextDraftId}`);
      }
    });
  }, [localLibrary, withUndo]);

  const openContextMenu = useCallback((event: ReactMouseEvent, nextMenu: BuffSheetContextMenuState) => {
    event.preventDefault();
    event.stopPropagation();
    setContextMenu(nextMenu);
  }, []);

  const openWorkbookContextMenu = useCallback((
    event: ReactMouseEvent,
    sourceRow?: BuffSheetRow,
    selectedCell?: { address: string; value: string; sourceRowKey?: string; columnKey?: string },
  ) => {
    if (selectedCell) {
      setSelectedWorkbookCell(selectedCell);
    }
    if (!sourceRow) {
      openContextMenu(event, {
        x: event.clientX,
        y: event.clientY,
        target: 'blank',
      });
      return;
    }
    if (sourceRow.kind === 'group') {
      openContextMenu(event, {
        x: event.clientX,
        y: event.clientY,
        target: 'draft',
        draftId: draft.id,
      });
      return;
    }
    if (sourceRow.kind === 'item') {
      openContextMenu(event, {
        x: event.clientX,
        y: event.clientY,
        target: 'item',
        draftId: draft.id,
        itemKey: sourceRow.itemKey,
      });
      return;
    }
    openContextMenu(event, {
      x: event.clientX,
      y: event.clientY,
      target: 'effect',
      draftId: draft.id,
      itemKey: sourceRow.itemKey,
      effectKey: sourceRow.effectKey,
    });
  }, [draft.id, openContextMenu]);

  const {
    dragState,
    getExplorerDragNodeKey,
    getExplorerDragNodeLabel,
    consumeSuppressedExplorerClick,
    canStartExplorerDrag,
    handleExplorerPointerDown,
  } = useBuffExplorerDrag({
    collapsedDraftIds,
    collapsedItems,
    contextMenu,
    filterKeyword,
    getItemCollapseKey,
    localLibrary,
    persistLibraryState,
    selectedLocalDraftId,
    setContextMenu,
    setPendingFocusRowKey,
  });

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const isSaveShortcut = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's';
      if (!isSaveShortcut) {
        return;
      }
      event.preventDefault();
      handleSaveDraft();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleSaveDraft]);

  return {
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
  };
}

export type BuffDraftPageController = ReturnType<typeof useBuffDraftPageController>;
