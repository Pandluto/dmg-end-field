import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import './OperatorDraftPage.css';
import './WorkbookSheet.css';
import './BuffDraftPage.css';
import type { BuffCategory, BuffEffectKind } from '../core/domain/buff';
import { APP_ROUTE_PATHS, navigateToAppPath } from '../utils/appRoute';
import { persistentLocalStorage } from '../platform/storage/persistentStorage';
import { buildDraftLibraryShareFileName } from '../utils/draftShare';
import BuffEffectEditorDrawer from './BuffEffectEditorDrawer';
import { WorkbookShareDialog } from './WorkbookShareDialog';
import { WorkbookToolButton } from './WorkbookToolButton';
import {
  BUFF_CATEGORY_LABELS,
  BUFF_CATEGORY_OPTIONS,
  BUFF_EFFECT_KIND_OPTIONS,
  BUFF_TYPE_LABELS,
  BUFF_TYPE_OPTIONS,
  MULTIPLIER_SUPPORTED_BUFF_TYPES,
  getEffectKindLabel,
} from './buffDraftCatalog';
import {
  applyBuffCategory,
  applyBuffEffectKind,
  applyBuffType,
  applyDrawerEffectToBuffSheet,
  buffSheetEffectToDrawer,
  buildBuffSheetRows,
  buildCollapsedDraftState,
  buildCollapsedItemState,
  cloneValue,
  createDefaultBuffEffect,
  createDefaultBuffItem,
  createDefaultBuffName,
  createEmptyBuffDraft,
  formatBuffExplorerDragKindLabel,
  getBuffEffectMultiplier,
  getBuffTypeDisplayLabel,
  getNextDraftId,
  getNextEffectKey,
  getNextItemKey,
  normalizeBuffCategory,
  normalizeBuffDraft,
  normalizeBuffDraftLibrary,
  reorderDraftStructure,
  setBuffMaxStacks,
  setBuffMultiplierCoefficient,
  setBuffMultiplierEnabled,
  type BuffDraft,
  type BuffExplorerDragNode,
  type BuffEffectDraft,
  type BuffSheetRow,
} from './buffDraftModel';
import {
  getBuffExplorerDragNodeKey as getExplorerDragNodeKey,
  getBuffExplorerDragNodeLabel,
  reorderBuffExplorerLibrary,
} from './buffExplorerDragPolicy';
import { createBuffFormulaTextBinding } from './buffDraftFormula';
import { createBuffDraftRepository } from './buffDraftPersistence';
import {
  buildBuffDraftLibraryShareFile,
  mergeBuffDraftLibraryShare,
  parseBuffDraftLibraryShare,
  resolveBuffDraftShareSelection,
  type BuffDraftLibraryShareFile,
} from './buffDraftShare';
import {
  createBuffUndoRepository,
  formatBuffUndoLabel,
  type BuffUndoSnapshot,
} from './buffDraftUndo';
import {
  buildBuffSheetColumns,
  buildBuffWorkbookView,
  type BuffWorkbookCellView,
  type BuffWorkbookSelection,
} from './buffDraftWorkbook';
import { useBuffExplorerDrag } from './useBuffExplorerDrag';

const BUFF_SHEET_PAGE_PATH = APP_ROUTE_PATHS.buffSheet;
const buffDraftRepository = createBuffDraftRepository(persistentLocalStorage);
const buffUndoRepository = createBuffUndoRepository(persistentLocalStorage);

function isBuffSheetPath(pathname: string) {
  return pathname === BUFF_SHEET_PAGE_PATH;
}

async function copyText(text: string) {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
  }
}

type BuffSheetContextMenuState = {
  x: number;
  y: number;
  target: 'blank' | 'draft' | 'item' | 'effect';
  draftId?: string;
  itemKey?: string;
  effectKey?: string;
};

type BuffSheetContextMenuAction = {
  key: string;
  label: string;
  icon: 'new' | 'delete' | 'collapse' | 'expand' | 'open' | 'copy';
  onClick: () => void;
};

function renderBuffSheetMenuIcon(icon: BuffSheetContextMenuAction['icon']) {
  switch (icon) {
    case 'new':
      return <path d="M8 3.25v9.5M3.25 8h9.5" />;
    case 'delete':
      return (
        <>
          <path d="M4.25 5.25h7.5" />
          <path d="M6.25 2.75h3.5" />
          <path d="M5.25 5.25v6.5M8 5.25v6.5M10.75 5.25v6.5" />
          <path d="M4.75 5.25l.5 7h5.5l.5-7" />
        </>
      );
    case 'collapse':
      return (
        <>
          <path d="M3.25 5.25h9.5" />
          <path d="M5.75 8h6.5" />
          <path d="M8.25 10.75h4" />
        </>
      );
    case 'expand':
      return (
        <>
          <path d="M3.25 5.25h9.5" />
          <path d="M3.25 8h9.5" />
          <path d="M3.25 10.75h9.5" />
        </>
      );
    case 'open':
      return (
        <>
          <path d="M3.25 4.25h3l1.25 1.5h5.25v6.5H3.25z" />
          <path d="M7.5 5.75h5.25" />
        </>
      );
    case 'copy':
      return (
        <>
          <path d="M5.25 4.25h5.5v7.5h-5.5z" />
          <path d="M8.75 4.25V3.25h-4.5v6.5h1" />
        </>
      );
    default:
      return null;
  }
}

type FormulaFocusSnapshot = {
  focusId: string;
  selectionStart?: number | null;
  selectionEnd?: number | null;
};

function renderBuffWorkbookCellContent(cell: BuffWorkbookCellView, sourceRow?: BuffSheetRow): ReactNode {
  if (!sourceRow) {
    return cell.value;
  }
  if (cell.columnKey !== 'name') {
    return cell.value;
  }
  if (sourceRow.kind === 'group') {
    return (
      <span className="buff-sheet-grid-title-wrap">
        <span className="buff-sheet-grid-title-main">
          {sourceRow.title}
          <span className="buff-sheet-grid-title-summary">{sourceRow.summary}</span>
        </span>
        <span className="buff-sheet-grid-title-sub">{sourceRow.key.replace(/^group-/, '')}</span>
      </span>
    );
  }
  if (sourceRow.kind === 'item') {
    return (
      <span className="buff-sheet-grid-title-wrap">
        <span className="buff-sheet-grid-title-main">{sourceRow.title}</span>
        <span className="buff-sheet-grid-title-sub">{sourceRow.idText}</span>
      </span>
    );
  }
  return cell.value;
}

export { isBuffSheetPath };

export function BuffDraftSheetPage() {
  const [draft, setDraft] = useState<BuffDraft>(() => buffDraftRepository.loadDraft());
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
  const [pendingImportShare, setPendingImportShare] = useState<BuffDraftLibraryShareFile | null>(null);
  const [contextMenu, setContextMenu] = useState<BuffSheetContextMenuState | null>(null);
  const [buffDrawerTarget, setBuffDrawerTarget] = useState<{ itemKey: string; effectKey: string } | null>(null);
  const columns = useMemo(() => buildBuffSheetColumns(), []);
  const getItemCollapseKey = useCallback((draftId: string, itemKey: string) => `${draftId}:${itemKey}`, []);
  const shareImportInputRef = useRef<HTMLInputElement>(null);
  const formulaBarRef = useRef<HTMLDivElement>(null);
  const pendingFormulaFocusRef = useRef<FormulaFocusSnapshot | null>(null);
  const [formulaFocusRestoreToken, setFormulaFocusRestoreToken] = useState(0);

  const applyExplorerDefaultCollapse = useCallback((nextLibrary: Record<string, BuffDraft>) => {
    setCollapsedDraftIds(buildCollapsedDraftState(nextLibrary));
    setCollapsedItems(buildCollapsedItemState(nextLibrary, getItemCollapseKey));
  }, [getItemCollapseKey]);

  const syncUndoSnapshots = useCallback(() => {
    setUndoSnapshots(buffUndoRepository.readSnapshots());
  }, []);

  const withUndo = useCallback((label: string, fn: () => void) => {
    buffUndoRepository.captureSnapshot(label, {
      selectedDraftId: selectedLocalDraftId || draft.id || undefined,
    });
    fn();
    syncUndoSnapshots();
  }, [draft.id, selectedLocalDraftId, syncUndoSnapshots]);

  const handleRestoreUndoSnapshot = useCallback((snapshotId: string) => {
    const restored = buffUndoRepository.restoreSnapshot(snapshotId);
    if (!restored) {
      return;
    }

    const nextLibrary = buffDraftRepository.loadLibrary();
    const nextDraftFromStorage = buffDraftRepository.loadDraft();
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
      ...buffDraftRepository.loadLibrary(),
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

  const downloadSheetShareFile = useCallback((shareFile: BuffDraftLibraryShareFile) => {
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

  const currentSheetShareFile = useMemo(() => buildBuffDraftLibraryShareFile(
    localLibrary,
    draft.name || selectedLocalDraftId || 'buff-library',
  ), [draft.name, localLibrary, selectedLocalDraftId]);
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
    const draftCount = Object.keys(localLibrary).length;
    if (draftCount === 0) {
      return;
    }
    const shareFile = buildBuffDraftLibraryShareFile(
      localLibrary,
      draft.name || selectedLocalDraftId || 'buff-library',
    );
    downloadSheetShareFile(shareFile);
  }, [downloadSheetShareFile, draft.name, localLibrary, selectedLocalDraftId]);

  const handleOpenSheetShareImportPicker = useCallback(() => {
    shareImportInputRef.current?.click();
  }, []);

  const prepareSheetImportShare = useCallback((rawText: string) => {
    const parsedShare = parseBuffDraftLibraryShare(rawText);
    if (!parsedShare.ok) {
      setPendingImportShare(null);
      setShareImportError(parsedShare.error);
      return;
    }
    setShareImportError('');
    setPendingImportShare(parsedShare.shareFile);
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
    const nextLibrary = mergeBuffDraftLibraryShare(localLibrary, pendingImportShare);
    buffDraftRepository.saveLibrary(nextLibrary);
    setLocalLibrary(nextLibrary);
    applyExplorerDefaultCollapse(nextLibrary);
    const nextSelectedId = resolveBuffDraftShareSelection(
      selectedLocalDraftId,
      nextLibrary,
      pendingImportShare.payload,
    );
    if (nextSelectedId && nextLibrary[nextSelectedId]) {
      setSelectedLocalDraftId(nextSelectedId);
      setDraft(nextLibrary[nextSelectedId]);
      setPendingFocusRowKey(`group-${nextSelectedId}`);
    }
    setPendingImportShare(null);
    setShareImportText('');
    setShareImportError('');
    setIsShareModalOpen(false);
  }, [applyExplorerDefaultCollapse, localLibrary, pendingImportShare, selectedLocalDraftId]);

  useEffect(() => {
    const nextLibrary = {
      ...buffDraftRepository.loadLibrary(),
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
    return createBuffFormulaTextBinding({
      selectedWorkbookSummary,
      selectedWorkbookCell,
      draft,
    });
  }, [
    draft,
    selectedWorkbookCell,
    selectedWorkbookSummary,
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

  const applyFormulaTextInput = useCallback((baseDraft: BuffDraft) => {
    if (!formulaTextBinding || formulaTextInput === formulaTextBinding.value) {
      return baseDraft;
    }
    return formulaTextBinding.apply(baseDraft, formulaTextInput);
  }, [formulaTextBinding, formulaTextInput]);

  const persistDraftToLibrary = useCallback((allowOverwrite: boolean, focusRowKey?: string | null, draftOverride?: BuffDraft) => {
    const library = buffDraftRepository.loadLibrary();
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
    buffDraftRepository.saveLibrary(normalizedLibrary);
    buffDraftRepository.saveDraft(nextDraft);
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
    const nextDraft = applyFormulaTextInput(draft);
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
  }, [applyFormulaTextInput, draft, isOverwriteProtectionEnabled, persistDraftToLibrary, selectedWorkbookCell]);

  const handleConfirmOverwriteDraft = useCallback(() => {
    const nextDraft = applyFormulaTextInput(draft);
    if (nextDraft !== draft) {
      setDraft(nextDraft);
    }
    persistDraftToLibrary(true, selectedWorkbookCell?.sourceRowKey ?? null, nextDraft);
  }, [applyFormulaTextInput, draft, persistDraftToLibrary, selectedWorkbookCell]);

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
    buffDraftRepository.saveLibrary(normalizedLibrary);
    setLocalLibrary(normalizedLibrary);
    if (nextSelectedId) {
      setSelectedLocalDraftId(nextSelectedId);
      if (normalizedLibrary[nextSelectedId]) {
        setDraft(normalizedLibrary[nextSelectedId]);
        buffDraftRepository.saveDraft(normalizedLibrary[nextSelectedId]);
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
      buffDraftRepository.saveLibrary(normalizedLibrary);
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

  const getExplorerDragNodeLabel = useCallback((node: BuffExplorerDragNode) => {
    return getBuffExplorerDragNodeLabel(localLibrary, node);
  }, [localLibrary]);

  const explorerDragPolicyState = useMemo(() => ({
    filterKeyword,
    collapsedDraftIds,
    collapsedItems,
    getItemCollapseKey,
  }), [collapsedDraftIds, collapsedItems, filterKeyword, getItemCollapseKey]);

  const applyExplorerReorder = useCallback((source: BuffExplorerDragNode, target: BuffExplorerDragNode) => {
    const result = reorderBuffExplorerLibrary(localLibrary, source, target);
    if (!result) {
      return;
    }
    persistLibraryState(result.nextLibrary, selectedLocalDraftId || source.draftId);
    setPendingFocusRowKey(result.focusRowKey);
  }, [localLibrary, persistLibraryState, selectedLocalDraftId]);

  const handleExplorerDragStart = useCallback(() => setContextMenu(null), []);
  const {
    dragState,
    consumeSuppressedExplorerClick,
    canStartExplorerDrag,
    handleExplorerPointerDown,
  } = useBuffExplorerDrag({
    policyState: explorerDragPolicyState,
    onReorder: applyExplorerReorder,
    onDragStart: handleExplorerDragStart,
  });

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
      const nextDraft = applyFormulaTextInput(draft);
      if (nextDraft !== draft) {
        setDraft(nextDraft);
      }
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
          <WorkbookToolButton icon="new" label="新建" title="新建组" onClick={handleCreateNewDraft} />
          <WorkbookToolButton icon="save" label="保存" title="保存当前组" onClick={handleSaveDraft} />
          <WorkbookToolButton icon="normalize" label="整理" title="整理项与效果顺序" onClick={handleNormalizeDraft} />
          <WorkbookToolButton
            icon="protect"
            label={isOverwriteProtectionEnabled ? '保护开' : '保护关'}
            title="切换覆盖保护"
            active={isOverwriteProtectionEnabled}
            onClick={() => setIsOverwriteProtectionEnabled((prev) => !prev)}
          />
          <WorkbookToolButton icon="export" label="导出" title="导出本地 Buff 库" onClick={() => openSheetShareModal('export')} />
          <WorkbookToolButton icon="import" label="导入" title="导入 Buff 分享" onClick={() => openSheetShareModal('import')} />
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
      <WorkbookShareDialog
        open={isShareModalOpen}
        mode={shareModalMode}
        onModeChange={setShareModalMode}
        onClose={closeSheetShareModal}
        exportPanel={{
          preview: currentSheetShareText,
          hint: '预览当前本地 Buff 库分享 JSON',
          onCopy: handleCopySheetShareJson,
          onDownload: handleExportSheetLibraryShare,
        }}
        importPanel={{
          text: shareImportText,
          error: shareImportError,
          placeholder: '把 Buff 分享 JSON 粘贴到这里，或点击右上角导入文件。',
          onTextChange: (value) => {
            setShareImportText(value);
            if (shareImportError) setShareImportError('');
          },
          onPickFile: handleOpenSheetShareImportPicker,
          onParse: handleParseSheetImportText,
          preview: pendingImportShare ? {
            details: [
              `名称：${pendingImportShare.label}`,
              `分组数：${Object.keys(pendingImportShare.payload).length}`,
            ],
            onClear: handleCancelSheetImportShare,
            onConfirm: handleConfirmSheetImportShare,
          } : undefined,
        }}
      />
    </main>
  );
}
