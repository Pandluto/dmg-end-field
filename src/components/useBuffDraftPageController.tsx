import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import './OperatorDraftPage.css';
import './BuffDraftPage.css';
import type { BuffCategory, BuffEffectKind } from '../core/domain/buff';
import { APP_ROUTE_PATHS, navigateToAppPath } from '../utils/appRoute';
import {
  buildDraftLibraryShareFile,
  buildDraftLibraryShareFileName,
  parseDraftLibraryShareFile,
  type DraftLibraryShareFile,
} from '../utils/draftShare';

import * as buffDraftPageModel from './buffDraftPageModel';
type BuffUndoSnapshot = buffDraftPageModel.BuffUndoSnapshot;
type BuffEffectDraft = buffDraftPageModel.BuffEffectDraft;
type BuffItemDraft = buffDraftPageModel.BuffItemDraft;
type BuffDraft = buffDraftPageModel.BuffDraft;
type BuffSheetRow = buffDraftPageModel.BuffSheetRow;
type BuffExplorerDragNode = buffDraftPageModel.BuffExplorerDragNode;
type BuffExplorerDragState = buffDraftPageModel.BuffExplorerDragState;
type BuffSheetContextMenuState = buffDraftPageModel.BuffSheetContextMenuState;
type BuffSheetContextMenuAction = buffDraftPageModel.BuffSheetContextMenuAction;
type BuffWorkbookSelection = buffDraftPageModel.BuffWorkbookSelection;
type FormulaFocusSnapshot = buffDraftPageModel.FormulaFocusSnapshot;

const {
  BUFF_DRAFT_STORAGE_KEY,
  BUFF_LIBRARY_STORAGE_KEY,
  BUFF_LIBRARY_SHARE_TYPE,
  BUFF_TYPE_OPTIONS,
  BUFF_TYPE_LABELS,
  BUFF_CATEGORY_OPTIONS,
  BUFF_CATEGORY_LABELS,
  MULTIPLIER_SUPPORTED_BUFF_TYPES,
  BUFF_EFFECT_KIND_OPTIONS,
  getEffectKindLabel,
  createDefaultBuffName,
  createDefaultBuffEffect,
  createDefaultBuffItem,
  createEmptyBuffDraft,
  getNextDraftId,
  buildBuffDraftIdFromName,
  getBuffTypeDisplayLabel,
  normalizeBuffCategory,
  getBuffEffectMultiplier,
  applyBuffEffectKind,
  applyBuffType,
  applyBuffCategory,
  setBuffMultiplierEnabled,
  setBuffMultiplierCoefficient,
  setBuffMaxStacks,
  cloneValue,
  getNextItemKey,
  getNextEffectKey,
  normalizeBuffDraft,
  normalizeBuffDraftLibrary,
  reorderDraftStructure,
  parseImportedBuffDraft,
  loadDraftFromStorage,
  loadLocalBuffLibrary,
  copyText,
  readBuffUndoSnapshots,
  captureBuffUndoSnapshot,
  restoreBuffUndoSnapshot,
  buildBuffSheetRows,
  reorderRecordEntries,
  formatBuffExplorerDragKindLabel,
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
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);
  const [shareModalMode, setShareModalMode] = useState<'export' | 'import'>('export');
  const [shareImportText, setShareImportText] = useState('');
  const [shareImportError, setShareImportError] = useState('');
  const [pendingImportShare, setPendingImportShare] = useState<DraftLibraryShareFile<BuffDraft> | null>(null);
  const [contextMenu, setContextMenu] = useState<BuffSheetContextMenuState | null>(null);
  const [dragState, setDragState] = useState<BuffExplorerDragState | null>(null);
  const [buffDrawerTarget, setBuffDrawerTarget] = useState<{ itemKey: string; effectKey: string } | null>(null);
  const columns = useMemo(() => buildBuffSheetColumns(), []);
  const getItemCollapseKey = useCallback((draftId: string, itemKey: string) => `${draftId}:${itemKey}`, []);
  const dragHoldTimerRef = useRef<number | null>(null);
  const pendingDragSourceRef = useRef<{ source: BuffExplorerDragNode; x: number; y: number } | null>(null);
  const suppressExplorerClickRef = useRef(false);
  const shareImportInputRef = useRef<HTMLInputElement>(null);
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

  const downloadSheetShareFile = useCallback((shareFile: DraftLibraryShareFile<BuffDraft>) => {
    const blob = new Blob([JSON.stringify(shareFile, null, 2)], {
      type: 'application/json;charset=utf-8',
    });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = buildDraftLibraryShareFileName(shareFile.label, shareFile.exportedAt);
    link.click();
    window.URL.revokeObjectURL(url);
  }, []);

  const currentSheetShareFile = useMemo(() => buildDraftLibraryShareFile(
    BUFF_LIBRARY_SHARE_TYPE,
    loadLocalBuffLibrary(),
    draft.name || selectedLocalDraftId || 'buff-library',
  ), [draft.name, selectedLocalDraftId]);
  const currentSheetShareText = useMemo(() => JSON.stringify(currentSheetShareFile, null, 2), [currentSheetShareFile]);

  const openSheetShareModal = useCallback((mode: 'export' | 'import') => {
    setShareModalMode(mode);
    setIsShareModalOpen(true);
    setShareImportError('');
    if (mode === 'import') {
      setPendingImportShare(null);
    }
  }, []);

  const closeSheetShareModal = useCallback(() => {
    setIsShareModalOpen(false);
    setShareImportError('');
    setPendingImportShare(null);
  }, []);

  const handleExportSheetLibraryShare = useCallback(() => {
    const library = loadLocalBuffLibrary();
    const draftCount = Object.keys(library).length;
    if (draftCount === 0) {
      return;
    }
    const shareFile = buildDraftLibraryShareFile(
      BUFF_LIBRARY_SHARE_TYPE,
      library,
      draft.name || selectedLocalDraftId || 'buff-library',
    );
    downloadSheetShareFile(shareFile);
  }, [downloadSheetShareFile, draft.name, selectedLocalDraftId]);

  const handleOpenSheetShareImportPicker = useCallback(() => {
    shareImportInputRef.current?.click();
  }, []);

  const prepareSheetImportShare = useCallback((rawText: string) => {
    const parsedShare = parseDraftLibraryShareFile(rawText, BUFF_LIBRARY_SHARE_TYPE);
    if (!parsedShare) {
      setPendingImportShare(null);
      setShareImportError('JSON 无效，或不是 Buff 分享文件。');
      return;
    }
    const normalizedPayload = Object.fromEntries(
      Object.entries(parsedShare.payload).flatMap(([draftId, value]) => {
        try {
          const normalizedDraft = parseImportedBuffDraft(JSON.stringify(value));
          return [[draftId, normalizedDraft] as const];
        } catch {
          return [];
        }
      }),
    ) as Record<string, BuffDraft>;
    if (Object.keys(normalizedPayload).length === 0) {
      setPendingImportShare(null);
      setShareImportError('JSON 中没有可导入的有效 Buff 分组。');
      return;
    }
    setShareImportError('');
    setPendingImportShare({
      ...parsedShare,
      payload: normalizedPayload,
    });
  }, []);

  const handleSheetShareFileSelected = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    const rawText = await file.text();
    setShareImportText(rawText);
    prepareSheetImportShare(rawText);
    event.target.value = '';
  }, [prepareSheetImportShare]);

  const handleParseSheetImportText = useCallback(() => {
    prepareSheetImportShare(shareImportText);
  }, [prepareSheetImportShare, shareImportText]);

  const handleCopySheetShareJson = useCallback(async () => {
    await copyText(currentSheetShareText);
  }, [currentSheetShareText]);

  const handleCancelSheetImportShare = useCallback(() => {
    setPendingImportShare(null);
    setShareImportError('');
  }, []);

  const handleConfirmSheetImportShare = useCallback(() => {
    if (!pendingImportShare) {
      return;
    }
    const nextLibrary = normalizeBuffDraftLibrary({
      ...loadLocalBuffLibrary(),
      ...pendingImportShare.payload,
    });
    window.localStorage.setItem(BUFF_LIBRARY_STORAGE_KEY, JSON.stringify(nextLibrary));
    setLocalLibrary(nextLibrary);
    applyExplorerDefaultCollapse(nextLibrary);
    const nextSelectedId = selectedLocalDraftId && nextLibrary[selectedLocalDraftId]
      ? selectedLocalDraftId
      : (Object.keys(pendingImportShare.payload)[0] ?? Object.keys(nextLibrary)[0] ?? '');
    if (nextSelectedId && nextLibrary[nextSelectedId]) {
      setSelectedLocalDraftId(nextSelectedId);
      setDraft(nextLibrary[nextSelectedId]);
      setPendingFocusRowKey(`group-${nextSelectedId}`);
    }
    setPendingImportShare(null);
    setShareImportText('');
    setShareImportError('');
    setIsShareModalOpen(false);
  }, [applyExplorerDefaultCollapse, pendingImportShare, selectedLocalDraftId]);

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

  const formulaTextBinding = useMemo(() => {
    if (!selectedWorkbookSummary) {
      return null;
    }

    if (selectedWorkbookSummary.kind === 'group') {
      if (selectedWorkbookCell?.columnKey === 'idText') {
        return {
          key: 'group:id',
          focusId: 'group-id',
          value: draft.id,
          placeholder: '组 ID',
          commit: (nextValue: string) => updateDraftField('id', nextValue),
        };
      }
      if (selectedWorkbookCell?.columnKey === 'description') {
        return {
          key: 'group:description',
          focusId: 'group-description',
          value: draft.description,
          placeholder: '组描述',
          commit: (nextValue: string) => updateDraftField('description', nextValue),
        };
      }
      return {
        key: 'group:name',
        focusId: 'group-name',
        value: draft.name,
        placeholder: '组名称',
        commit: (nextValue: string) => updateDraftField('name', nextValue),
      };
    }

    if (selectedWorkbookSummary.kind === 'item' && selectedItem) {
      if (selectedWorkbookCell?.columnKey === 'idText') {
        return {
          key: `item:${selectedItem.id}:id`,
          focusId: 'item-id',
          value: selectedItem.id,
          placeholder: '项 ID',
          commit: (nextValue: string) => updateSelectedItem((prev) => ({ ...prev, id: nextValue })),
        };
      }
      if (selectedWorkbookCell?.columnKey === 'description') {
        return {
          key: `item:${selectedItem.id}:description`,
          focusId: 'item-description',
          value: selectedItem.description,
          placeholder: '项描述',
          commit: (nextValue: string) => updateSelectedItem((prev) => ({ ...prev, description: nextValue })),
        };
      }
      return {
        key: `item:${selectedItem.id}:name`,
        focusId: 'item-name',
        value: selectedItem.name,
        placeholder: '项名称',
        commit: (nextValue: string) => updateSelectedItem((prev) => ({ ...prev, name: nextValue })),
      };
    }

    if (selectedWorkbookSummary.kind === 'effect' && selectedEffect) {
      switch (selectedWorkbookCell?.columnKey) {
        case 'condition':
          return {
            key: `effect:${selectedEffect.id}:condition`,
            focusId: 'effect-condition',
            value: selectedEffect.condition || '',
            placeholder: '条件',
            commit: (nextValue: string) => updateSelectedEffect((prev) => ({ ...prev, condition: nextValue })),
          };
        case 'description':
          return {
            key: `effect:${selectedEffect.id}:description`,
            focusId: 'effect-description',
            value: selectedEffect.description || '',
            placeholder: '描述',
            commit: (nextValue: string) => updateSelectedEffect((prev) => ({ ...prev, description: nextValue })),
          };
        default:
          return {
            key: `effect:${selectedEffect.id}:displayName`,
            focusId: 'effect-display-name',
            value: selectedEffect.displayName,
            placeholder: '效果名称',
            commit: (nextValue: string) => updateSelectedEffect((prev) => ({ ...prev, displayName: nextValue })),
          };
      }
    }

    return null;
  }, [
    draft.description,
    draft.id,
    draft.name,
    selectedEffect,
    selectedItem,
    selectedWorkbookCell?.columnKey,
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

  const getExplorerDragNodeKey = useCallback((node: BuffExplorerDragNode) => {
    if (node.kind === 'draft') {
      return `draft:${node.draftId}`;
    }
    if (node.kind === 'item') {
      return `item:${node.draftId}:${node.itemKey}`;
    }
    return `effect:${node.draftId}:${node.itemKey}:${node.effectKey}`;
  }, []);

  const getExplorerDragNodeLabel = useCallback((node: BuffExplorerDragNode) => {
    const targetDraft = localLibrary[node.draftId];
    if (!targetDraft) {
      return node.draftId;
    }
    if (node.kind === 'draft') {
      return targetDraft.name || node.draftId;
    }
    const targetItem = targetDraft.items[node.itemKey];
    if (!targetItem) {
      return node.itemKey;
    }
    if (node.kind === 'item') {
      return targetItem.name || node.itemKey;
    }
    const targetEffect = targetItem.effects[node.effectKey];
    return targetEffect?.displayName || node.effectKey;
  }, [localLibrary]);

  const clearPendingExplorerDrag = useCallback(() => {
    if (dragHoldTimerRef.current !== null) {
      window.clearTimeout(dragHoldTimerRef.current);
      dragHoldTimerRef.current = null;
    }
    pendingDragSourceRef.current = null;
  }, []);

  const consumeSuppressedExplorerClick = useCallback(() => {
    if (!suppressExplorerClickRef.current) {
      return false;
    }
    suppressExplorerClickRef.current = false;
    return true;
  }, []);

  const canStartExplorerDrag = useCallback((node: BuffExplorerDragNode) => {
    if (filterKeyword.trim()) {
      return false;
    }
    if (node.kind === 'draft') {
      return Boolean(collapsedDraftIds[node.draftId]);
    }
    if (node.kind === 'item') {
      return Boolean(collapsedItems[getItemCollapseKey(node.draftId, node.itemKey)]);
    }
    return true;
  }, [collapsedDraftIds, collapsedItems, filterKeyword, getItemCollapseKey]);

  const isValidExplorerDropTarget = useCallback((source: BuffExplorerDragNode, target: BuffExplorerDragNode | null) => {
    if (!target || source.kind !== target.kind) {
      return false;
    }
    if (getExplorerDragNodeKey(source) === getExplorerDragNodeKey(target)) {
      return false;
    }
    if (target.kind === 'draft') {
      return canStartExplorerDrag(source) && canStartExplorerDrag(target);
    }
    if (target.kind === 'item') {
      return source.draftId === target.draftId && canStartExplorerDrag(source) && canStartExplorerDrag(target);
    }
    if (source.kind !== 'effect') {
      return false;
    }
    return source.draftId === target.draftId && source.itemKey === target.itemKey;
  }, [canStartExplorerDrag, getExplorerDragNodeKey]);

  const resolveExplorerDragNodeFromElement = useCallback((element: Element | null): BuffExplorerDragNode | null => {
    const row = element instanceof HTMLElement ? element.closest<HTMLElement>('[data-buff-drag-kind]') : null;
    if (!row) {
      return null;
    }
    const kind = row.dataset.buffDragKind;
    const draftId = row.dataset.buffDraftId;
    if (!kind || !draftId) {
      return null;
    }
    if (kind === 'draft') {
      return { kind: 'draft', draftId };
    }
    const itemKey = row.dataset.buffItemKey;
    if (!itemKey) {
      return null;
    }
    if (kind === 'item') {
      return { kind: 'item', draftId, itemKey };
    }
    const effectKey = row.dataset.buffEffectKey;
    if (!effectKey) {
      return null;
    }
    return { kind: 'effect', draftId, itemKey, effectKey };
  }, []);

  const applyExplorerReorder = useCallback((source: BuffExplorerDragNode, target: BuffExplorerDragNode) => {
    if (!isValidExplorerDropTarget(source, target)) {
      return;
    }

    if (source.kind === 'draft' && target.kind === 'draft') {
      const nextLibrary = reorderRecordEntries(localLibrary, source.draftId, target.draftId);
      persistLibraryState(nextLibrary, selectedLocalDraftId || source.draftId);
      setPendingFocusRowKey(`group-${source.draftId}`);
      return;
    }

    if (source.kind === 'item' && target.kind === 'item') {
      const targetDraft = localLibrary[source.draftId];
      if (!targetDraft) {
        return;
      }
      const nextDraft = cloneValue(targetDraft);
      nextDraft.items = reorderRecordEntries(nextDraft.items, source.itemKey, target.itemKey);
      const nextLibrary = { ...localLibrary, [source.draftId]: nextDraft };
      persistLibraryState(nextLibrary, selectedLocalDraftId || source.draftId);
      setPendingFocusRowKey(`item-${source.itemKey}`);
      return;
    }

    if (source.kind === 'effect' && target.kind === 'effect') {
      const targetDraft = localLibrary[source.draftId];
      const targetItem = targetDraft?.items[source.itemKey];
      if (!targetDraft || !targetItem) {
        return;
      }
      const nextDraft = cloneValue(targetDraft);
      nextDraft.items[source.itemKey].effects = reorderRecordEntries(
        nextDraft.items[source.itemKey].effects,
        source.effectKey,
        target.effectKey,
      );
      const nextLibrary = { ...localLibrary, [source.draftId]: nextDraft };
      persistLibraryState(nextLibrary, selectedLocalDraftId || source.draftId);
      setPendingFocusRowKey(`effect-${source.itemKey}-${source.effectKey}`);
    }
  }, [isValidExplorerDropTarget, localLibrary, persistLibraryState, selectedLocalDraftId]);

  const handleExplorerPointerDown = useCallback((event: React.PointerEvent, source: BuffExplorerDragNode) => {
    if (event.button !== 0 || !canStartExplorerDrag(source)) {
      return;
    }
    const target = event.target as HTMLElement | null;
    if (target?.closest('.buff-sheet-explorer-toggle')) {
      return;
    }
    clearPendingExplorerDrag();
    pendingDragSourceRef.current = {
      source,
      x: event.clientX,
      y: event.clientY,
    };
    dragHoldTimerRef.current = window.setTimeout(() => {
      suppressExplorerClickRef.current = true;
      setContextMenu(null);
      setDragState({ source, over: null, x: event.clientX, y: event.clientY });
      pendingDragSourceRef.current = null;
      dragHoldTimerRef.current = null;
    }, 220);
  }, [canStartExplorerDrag, clearPendingExplorerDrag]);

  useEffect(() => {
    if (!contextMenu) {
      return undefined;
    }
    const handlePointerDown = () => setContextMenu(null);
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setContextMenu(null);
      }
    };
    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleEscape);
    window.addEventListener('scroll', handlePointerDown, true);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleEscape);
      window.removeEventListener('scroll', handlePointerDown, true);
    };
  }, [contextMenu]);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const pending = pendingDragSourceRef.current;
      if (pending) {
        const distance = Math.hypot(event.clientX - pending.x, event.clientY - pending.y);
        if (distance > 6) {
          clearPendingExplorerDrag();
        }
      }
      if (!dragState) {
        return;
      }
      event.preventDefault();
      const hoveredNode = resolveExplorerDragNodeFromElement(document.elementFromPoint(event.clientX, event.clientY));
      setDragState((prev) => {
        if (!prev) {
          return prev;
        }
        const nextOver = isValidExplorerDropTarget(prev.source, hoveredNode) ? hoveredNode : null;
        const previousOverKey = prev.over ? getExplorerDragNodeKey(prev.over) : '';
        const nextOverKey = nextOver ? getExplorerDragNodeKey(nextOver) : '';
        if (previousOverKey === nextOverKey && prev.x === event.clientX && prev.y === event.clientY) {
          return prev;
        }
        return {
          ...prev,
          over: nextOver,
          x: event.clientX,
          y: event.clientY,
        };
      });
    };

    const finalizeDrag = () => {
      clearPendingExplorerDrag();
      setDragState((prev) => {
        if (prev?.over) {
          applyExplorerReorder(prev.source, prev.over);
        }
        return null;
      });
    };

    window.addEventListener('pointermove', handlePointerMove, true);
    window.addEventListener('pointerup', finalizeDrag, true);
    window.addEventListener('pointercancel', finalizeDrag, true);
    window.addEventListener('blur', finalizeDrag);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove, true);
      window.removeEventListener('pointerup', finalizeDrag, true);
      window.removeEventListener('pointercancel', finalizeDrag, true);
      window.removeEventListener('blur', finalizeDrag);
    };
  }, [applyExplorerReorder, clearPendingExplorerDrag, dragState, getExplorerDragNodeKey, isValidExplorerDropTarget, resolveExplorerDragNodeFromElement]);

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
    renderFormulaEditor,
    dragSourceKey,
    dragTargetKey,
    dragSourceLabel,
    dragTargetLabel,
    dragTargetKindLabel,
    currentContextMenuActions,
  };
}

export type BuffDraftPageController = ReturnType<typeof useBuffDraftPageController>;
