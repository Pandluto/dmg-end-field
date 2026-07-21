import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { useAppContext } from '../context/AppContext';
import { APP_ROUTE_PATHS, navigateToAppPath } from '../utils/appRoute';
import { getBuffById, getSkillButtonById, upsertSkillButton } from '../core/repositories';
import { addSkillButtonBuff, recomputeSkillButtonPanel } from '../hooks/useSkillButtonBuffs';
import {
  type LocalBuffSearchResult,
  isModifierBuff,
  readLocalBuffSearchEntries,
} from './CanvasBoard/skillButton.shared';
import {
  SkillButtonAnomalyPanel,
  SkillButtonAnomalyStatePanel,
  SkillButtonStatePanel,
} from './CanvasBoard/SkillButtonAnomalyPanels';
import { useSkillButtonAnomaly } from './CanvasBoard/useSkillButtonAnomaly';
import './DamageSheetPage.css';

import {
  ENABLE_ADVANCED_SHEET_SIDEBAR,
  buildColumns,
  buildFormulaText,
  buildSheetRows,
  buildWorkbookView,
  filterRelevantBuffsForColumn,
  formatHitBuffContribution,
  getButtonBuffs,
  getHighlightColumnKeyForBuff,
  getRelevantBuffsForColumn,
  summarizeBuffFrameStates,
  type BuffFrameSpan,
  type BuffFrameState,
  type CharacterGroupRow,
  type DamageSheetContextMenuAction,
  type HitValueRow,
  type SelectedWorkbookCell,
  type SheetContextMenuState,
  type SheetOrderMode,
  type SheetRow,
  type SheetSidebarTab,
  type WorkbookCellView,
  type WorkbookRowView,
} from './damageSheetPageModel';
import {
  buildUndoSnapshotHoverText,
  captureSessionSnapshot,
  formatUndoLabel,
  readUndoSnapshots,
  restoreUndoSnapshot,
  type UndoSnapshot,
} from './damageSheetUndoHistory';

function renderDamageSheetMenuIcon(icon: DamageSheetContextMenuAction['icon']) {
  switch (icon) {
    case 'delete':
      return (
        <>
          <path d="M4.25 5.25h7.5" />
          <path d="M6.25 2.75h3.5" />
          <path d="M5.25 5.25v6.5M8 5.25v6.5M10.75 5.25v6.5" />
          <path d="M4.75 5.25l.5 7h5.5l.5-7" />
        </>
      );
    case 'cancel':
      return (
        <>
          <path d="M4 4l8 8" />
          <path d="M12 4l-8 8" />
        </>
      );
    case 'confirm':
      return <path d="M6.25 8.25L7.4 9.4l2.35-2.55" />;
    default:
      return null;
  }
}

export function isDamageSheetPath(path: string): boolean {
  return path === APP_ROUTE_PATHS.damageSheet;
}

export function DamageSheetPage() {
  const { state } = useAppContext();
  const [isGenerating, setIsGenerating] = useState(false);
  const [rows, setRows] = useState<SheetRow[]>([]);
  const [totalHitCount, setTotalHitCount] = useState(0);
  const [selectedWorkbookCell, setSelectedWorkbookCell] = useState<SelectedWorkbookCell | null>(null);
  const [undoSnapshots, setUndoSnapshots] = useState<UndoSnapshot[]>([]);
  const [isUndoMenuOpen, setIsUndoMenuOpen] = useState(false);
  const [sidebarTab, setSidebarTab] = useState<SheetSidebarTab>('related');
  const [buffSearchKeyword, setBuffSearchKeyword] = useState('');
  const [selectedRelevantBuffId, setSelectedRelevantBuffId] = useState<string | null>(null);
  const [framedRelevantBuffId, setFramedRelevantBuffId] = useState<string | null>(null);
  const [orderMode, setOrderMode] = useState<SheetOrderMode>('character');
  const [collapsedCharacterIds, setCollapsedCharacterIds] = useState<Record<string, boolean>>({});
  const [collapsedColumnGroups, setCollapsedColumnGroups] = useState<Record<string, boolean>>({});
  const [contextMenu, setContextMenu] = useState<SheetContextMenuState | null>(null);

  const columns = useMemo(() => buildColumns(), []);
  const collapsibleColumnGroups = useMemo(
    () => Array.from(new Set(columns.map((column) => column.group).filter((group) => group !== '索引'))),
    [columns]
  );
  const characterRowIds = useMemo(
    () => rows.filter((row): row is CharacterGroupRow => row.kind === 'character').map((row) => row.characterId),
    [rows]
  );
  const visibleColumns = useMemo(
    () => columns.filter((column, index) => {
      if (!collapsedColumnGroups[column.group]) {
        return true;
      }
      return columns.findIndex((candidate) => candidate.group === column.group) === index;
    }),
    [collapsedColumnGroups, columns]
  );
  const visibleRows = useMemo(() => (
    rows.filter((row) => {
      if (orderMode === 'cast') {
        return true;
      }
      if (row.kind === 'character') {
        return true;
      }
      return !collapsedCharacterIds[row.characterId];
    })
  ), [collapsedCharacterIds, orderMode, rows]);
  const workbookRows = useMemo(() => buildWorkbookView(visibleRows, visibleColumns), [visibleColumns, visibleRows]);

  const handleGenerate = useCallback(() => {
    setIsGenerating(true);
    try {
      const next = buildSheetRows(
        state.selectedCharacters.map((character) => ({
          id: character.id,
          name: character.name,
        })),
        orderMode
      );
      setRows(next.rows);
      setTotalHitCount(next.totalHitCount);
      const firstWorkbookDataRow = buildWorkbookView(
        next.rows.filter((row) => {
          if (orderMode === 'cast') {
            return true;
          }
          if (row.kind === 'character') {
            return true;
          }
          return !collapsedCharacterIds[row.characterId];
        }),
        visibleColumns
      ).find((row) => row.kind === 'data');
      const firstWorkbookDataCell = firstWorkbookDataRow?.cells[0];
      setSelectedWorkbookCell(firstWorkbookDataCell ? {
        address: firstWorkbookDataCell.address,
        value: firstWorkbookDataCell.value,
        sourceRowId: firstWorkbookDataCell.sourceRowId,
        columnKey: firstWorkbookDataCell.columnKey,
      } : null);
    } finally {
      setIsGenerating(false);
    }
  }, [collapsedCharacterIds, orderMode, state.selectedCharacters, visibleColumns]);

  useEffect(() => {
    handleGenerate();
  }, [handleGenerate]);
  const selectedHitRow = useMemo(() => (
    selectedWorkbookCell?.sourceRowId
      ? rows.find((row): row is HitValueRow => row.kind === 'hit' && row.id === selectedWorkbookCell.sourceRowId) ?? null
      : null
  ), [rows, selectedWorkbookCell]);
  const selectedValue = buildFormulaText(
    selectedHitRow,
    selectedWorkbookCell?.columnKey,
    selectedWorkbookCell?.value ?? '未选择单元格'
  );
  const selectedAddress = selectedWorkbookCell?.address ?? '-';
  const selectedPersistedButton = useMemo(
    () => (selectedHitRow ? getSkillButtonById(selectedHitRow.buttonId) : null),
    [selectedHitRow]
  );
  const selectedSegmentKey = selectedHitRow ? `normal-hit-${selectedHitRow.detail.hit.key}` : null;
  const manuallyDisabledBuffIds = useMemo(() => {
    if (!selectedPersistedButton || !selectedSegmentKey) {
      return [];
    }
    return selectedPersistedButton.panelConfig?.manualDisabledBuffIdsBySegmentKey?.[selectedSegmentKey] ?? [];
  }, [selectedPersistedButton, selectedSegmentKey]);
  const relevantBuffs = useMemo(() => {
    if (!selectedHitRow || !selectedWorkbookCell?.columnKey) {
      return [];
    }

    const enabledRelevantBuffs = getRelevantBuffsForColumn(selectedHitRow, selectedWorkbookCell.columnKey);
    if (!selectedPersistedButton || manuallyDisabledBuffIds.length === 0) {
      return enabledRelevantBuffs;
    }

    const disabledRelevantBuffs = filterRelevantBuffsForColumn(
      getButtonBuffs(selectedPersistedButton).filter((buff) => manuallyDisabledBuffIds.includes(buff.id)),
      selectedHitRow.detail.hit,
      selectedWorkbookCell.columnKey
    );

    const merged = [...enabledRelevantBuffs];
    disabledRelevantBuffs.forEach((buff) => {
      if (!merged.some((entry) => entry.id === buff.id)) {
        merged.push(buff);
      }
    });
    return merged;
  }, [manuallyDisabledBuffIds, selectedHitRow, selectedPersistedButton, selectedWorkbookCell]);
  const selectedRelevantBuff = useMemo(
    () => relevantBuffs.find((buff) => buff.id === selectedRelevantBuffId) ?? null,
    [relevantBuffs, selectedRelevantBuffId]
  );
  const framedRelevantBuff = useMemo(
    () => relevantBuffs.find((buff) => buff.id === framedRelevantBuffId) ?? getBuffById(framedRelevantBuffId || ''),
    [framedRelevantBuffId, relevantBuffs]
  );
  const framedRelevantBuffColumnKey = useMemo(
    () => getHighlightColumnKeyForBuff(framedRelevantBuff ?? null),
    [framedRelevantBuff]
  );
  const framedRelevantBuffButtonIds = useMemo(() => {
    if (!framedRelevantBuffId) {
      return new Set<string>();
    }

    const matchedButtonIds = new Set<string>();
    rows.forEach((row) => {
      if (row.kind !== 'button' && row.kind !== 'hit') {
        return;
      }
      if (matchedButtonIds.has(row.buttonId)) {
        return;
      }
      const persistedButton = getSkillButtonById(row.buttonId);
      if (persistedButton?.selectedBuff?.includes(framedRelevantBuffId)) {
        matchedButtonIds.add(row.buttonId);
      }
    });
    return matchedButtonIds;
  }, [framedRelevantBuffId, rows]);
  const framedRelevantBuffRowStateByRowId = useMemo(() => {
    if (!framedRelevantBuffId) {
      return {} as Record<string, BuffFrameState>;
    }

    const hitStateByRowId = rows.reduce<Record<string, BuffFrameState>>((accumulator, row) => {
      if (row.kind !== 'hit' || !framedRelevantBuffButtonIds.has(row.buttonId)) {
        return accumulator;
      }
      const persistedButton = getSkillButtonById(row.buttonId);
      const disabledBuffIds = persistedButton?.panelConfig?.manualDisabledBuffIdsBySegmentKey?.[`normal-hit-${row.detail.hit.key}`] ?? [];
      accumulator[row.id] = disabledBuffIds.includes(framedRelevantBuffId) ? 'disabled' : 'enabled';
      return accumulator;
    }, {});

    rows.forEach((row) => {
      if (row.kind === 'button') {
        const buttonHitRows = rows.filter(
          (candidate): candidate is HitValueRow => candidate.kind === 'hit' && candidate.buttonId === row.buttonId
        );
        const childStates = buttonHitRows
          .map((candidate) => hitStateByRowId[candidate.id])
          .filter((state): state is BuffFrameState => Boolean(state));
        const summary = childStates.length === buttonHitRows.length ? summarizeBuffFrameStates(childStates) : null;
        if (summary) {
          hitStateByRowId[row.id] = summary;
        }
      }
      if (row.kind === 'character') {
        const characterHitRows = rows.filter(
          (candidate): candidate is HitValueRow => candidate.kind === 'hit' && candidate.characterId === row.characterId
        );
        const childStates = characterHitRows
          .map((candidate) => hitStateByRowId[candidate.id])
          .filter((state): state is BuffFrameState => Boolean(state));
        if (childStates.length > 0 && childStates.length === characterHitRows.length) {
          const summary = summarizeBuffFrameStates(childStates);
          if (summary) {
            hitStateByRowId[row.id] = summary;
          }
        }
      }
    });

    return hitStateByRowId;
  }, [framedRelevantBuffButtonIds, framedRelevantBuffId, rows]);
  const framedRelevantBuffRowSpanByRowId = useMemo(() => {
    if (!framedRelevantBuffColumnKey) {
      return {} as Record<string, BuffFrameSpan>;
    }

    const highlightedRowIds = visibleRows
      .map((row) => row.id)
      .filter((rowId) => Boolean(framedRelevantBuffRowStateByRowId[rowId]));

    return visibleRows.reduce<Record<string, BuffFrameSpan>>((accumulator, row, index) => {
      if (!framedRelevantBuffRowStateByRowId[row.id]) {
        return accumulator;
      }
      const previousRow = visibleRows[index - 1];
      const nextRow = visibleRows[index + 1];
      const hasPrevious = previousRow ? highlightedRowIds.includes(previousRow.id) : false;
      const hasNext = nextRow ? highlightedRowIds.includes(nextRow.id) : false;
      if (hasPrevious && hasNext) {
        accumulator[row.id] = 'middle';
      } else if (hasPrevious) {
        accumulator[row.id] = 'end';
      } else if (hasNext) {
        accumulator[row.id] = 'start';
      } else {
        accumulator[row.id] = 'single';
      }
      return accumulator;
    }, {});
  }, [framedRelevantBuffColumnKey, framedRelevantBuffRowStateByRowId, visibleRows]);
  const framedRelevantBuffOverlay = useMemo(() => {
    if (!framedRelevantBuffColumnKey) {
      return null;
    }
    const columnIndex = visibleColumns.findIndex((column) => column.key === framedRelevantBuffColumnKey);
    if (columnIndex < 0) {
      return null;
    }
    const left = visibleColumns
      .slice(0, columnIndex)
      .reduce((sum, column) => sum + column.width, 0);
    return {
      left,
      width: visibleColumns[columnIndex].width,
    };
  }, [framedRelevantBuffColumnKey, visibleColumns]);
  useEffect(() => {
    if (selectedRelevantBuffId && relevantBuffs.some((buff) => buff.id === selectedRelevantBuffId)) {
      return;
    }
    setSelectedRelevantBuffId(relevantBuffs[0]?.id ?? null);
  }, [relevantBuffs, selectedRelevantBuffId]);
  useEffect(() => {
    if (framedRelevantBuffId && relevantBuffs.some((buff) => buff.id === framedRelevantBuffId)) {
      setSelectedRelevantBuffId(framedRelevantBuffId);
    }
  }, [framedRelevantBuffId, relevantBuffs]);
  const localBuffSearchEntries = useMemo(() => readLocalBuffSearchEntries(), []);
  const filteredLocalBuffSearchResults = useMemo(() => {
    const keyword = buffSearchKeyword.trim().toLowerCase();
    if (!keyword) {
      return [];
    }
    return localBuffSearchEntries.filter((entry) => (
      [
        entry.displayName,
        entry.name,
        entry.itemName,
        entry.groupName,
        entry.sourceName,
        entry.type,
        entry.description,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(keyword))
    ));
  }, [buffSearchKeyword, localBuffSearchEntries]);

  const anomalyModifierBuffList = useMemo(
    () => (selectedPersistedButton ? getButtonBuffs(selectedPersistedButton).filter(isModifierBuff) : []),
    [selectedPersistedButton]
  );

  const anomalyState = useSkillButtonAnomaly({
    buttonId: selectedPersistedButton?.id ?? '__sheet-empty__',
    buttonCharacterId: selectedPersistedButton?.characterId ?? '',
    buttonSkillType: selectedPersistedButton?.skillType ?? 'A',
    characterName: selectedHitRow?.detail.characterName ?? '',
    selectedCharacters: state.selectedCharacters.map((character) => ({
      id: character.id,
      name: character.name,
    })),
    modifierBuffList: anomalyModifierBuffList,
  });
  const {
    loadPersistedAnomalyCards,
  } = anomalyState;

  const totalCharacterCount = state.selectedCharacters.length;
  const totalButtonCount = visibleRows.filter((row) => row.kind === 'button').length;

  const toggleCharacterCollapsed = useCallback((characterId: string) => {
    setCollapsedCharacterIds((prev) => ({ ...prev, [characterId]: !prev[characterId] }));
  }, []);

  const toggleColumnGroupCollapsed = useCallback((group: string) => {
    if (group === '索引') {
      return;
    }
    setCollapsedColumnGroups((prev) => ({ ...prev, [group]: !prev[group] }));
  }, []);

  const setAllCharactersCollapsed = useCallback((collapsed: boolean) => {
    setCollapsedCharacterIds(
      characterRowIds.reduce<Record<string, boolean>>((accumulator, characterId) => {
        accumulator[characterId] = collapsed;
        return accumulator;
      }, {})
    );
  }, [characterRowIds]);

  const setAllColumnGroupsCollapsed = useCallback((collapsed: boolean) => {
    setCollapsedColumnGroups(
      collapsibleColumnGroups.reduce<Record<string, boolean>>((accumulator, group) => {
        accumulator[group] = collapsed;
        return accumulator;
      }, {})
    );
  }, [collapsibleColumnGroups]);

  const handleOpenContextMenu = useCallback((event: ReactMouseEvent, nextMenu: SheetContextMenuState) => {
    event.preventDefault();
    event.stopPropagation();
    setContextMenu(nextMenu);
  }, []);

  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

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

  const renderRowNumberCell = useCallback((row: WorkbookRowView) => {
    const sourceRow = row.sourceRow;
    if (orderMode === 'character' && sourceRow?.kind === 'character') {
      return (
        <button
          type="button"
          className="damage-sheet-row-toggle"
          onClick={() => toggleCharacterCollapsed(sourceRow.characterId)}
          onContextMenu={(event) => handleOpenContextMenu(event, {
            x: event.clientX,
            y: event.clientY,
            target: 'character',
            characterId: sourceRow.characterId,
          })}
        >
          {collapsedCharacterIds[sourceRow.characterId] ? '[+]' : '[-]'}
        </button>
      );
    }

    return row.rowNumber;
  }, [collapsedCharacterIds, handleOpenContextMenu, orderMode, toggleCharacterCollapsed]);

  const renderWorkbookCellContent = useCallback((row: WorkbookRowView, cell: WorkbookCellView) => {
    if (row.kind === 'group' && cell.value !== '索引') {
      return (
        <span className="damage-sheet-group-header">
          <button
            type="button"
            className="damage-sheet-row-toggle damage-sheet-group-toggle"
            onClick={(event) => {
              event.stopPropagation();
              toggleColumnGroupCollapsed(cell.value);
            }}
            onContextMenu={(event) => handleOpenContextMenu(event, {
              x: event.clientX,
              y: event.clientY,
              target: 'group',
              group: cell.value,
            })}
          >
            {collapsedColumnGroups[cell.value] ? '[+]' : '[-]'}
          </button>
          <span className="damage-sheet-group-header-label">{cell.value}</span>
        </span>
      );
    }
    return cell.value;
  }, [collapsedColumnGroups, handleOpenContextMenu, toggleColumnGroupCollapsed]);
  const getWorkbookCellBuffFrameMeta = useCallback((row: WorkbookRowView, cell: WorkbookCellView) => {
    const sourceRow = row.sourceRow;
    if (!sourceRow || !framedRelevantBuffColumnKey) {
      return { className: '', style: undefined as CSSProperties | undefined };
    }

    const rowState = framedRelevantBuffRowStateByRowId[sourceRow.id];
    if (!rowState) {
      return { className: '', style: undefined as CSSProperties | undefined };
    }

    const rowSpan = framedRelevantBuffRowSpanByRowId[sourceRow.id] ?? 'single';
    const frameClassName = `${rowState === 'enabled' ? ' is-buff-linked' : ' is-buff-linked-muted'} is-buff-span-${rowSpan}`;

    if (sourceRow.kind === 'hit') {
      if (cell.columnKey !== framedRelevantBuffColumnKey) {
        return { className: '', style: undefined as CSSProperties | undefined };
      }
      return { className: frameClassName, style: undefined as CSSProperties | undefined };
    }

    if ((sourceRow.kind === 'button' || sourceRow.kind === 'character') && cell.colSpan > 1 && framedRelevantBuffOverlay) {
      return {
        className: `${frameClassName} is-buff-linked-bridge`,
        style: {
          ['--buff-frame-left' as string]: `${framedRelevantBuffOverlay.left}px`,
          ['--buff-frame-width' as string]: `${framedRelevantBuffOverlay.width}px`,
        } as CSSProperties,
      };
    }

    return { className: '', style: undefined as CSSProperties | undefined };
  }, [
    framedRelevantBuffColumnKey,
    framedRelevantBuffOverlay,
    framedRelevantBuffRowSpanByRowId,
    framedRelevantBuffRowStateByRowId,
  ]);

  const persistManualBuffTweaks = useCallback((nextMap: Record<string, string[]>) => {
    if (!selectedPersistedButton) {
      return;
    }
    upsertSkillButton({
      ...selectedPersistedButton,
      panelConfig: {
        ...(selectedPersistedButton.panelConfig ?? { selectedBuff: [...(selectedPersistedButton.selectedBuff ?? [])] }),
        selectedBuff: [...(selectedPersistedButton.selectedBuff ?? [])],
        manualDisabledBuffIdsBySegmentKey: nextMap,
      },
      updatedAt: Date.now(),
    });
  }, [selectedPersistedButton]);

  const handleRefreshAndKeepSelection = useCallback(() => {
    handleGenerate();
    setUndoSnapshots(readUndoSnapshots());
  }, [handleGenerate]);

  const setManualBuffDisabledForSelectedHit = useCallback((buffId: string, disabled: boolean) => {
    if (!selectedPersistedButton || !selectedSegmentKey) {
      return;
    }

    const currentMap = selectedPersistedButton.panelConfig?.manualDisabledBuffIdsBySegmentKey ?? {};
    const currentIds = currentMap[selectedSegmentKey] ?? [];
    const isCurrentlyDisabled = currentIds.includes(buffId);
    if (isCurrentlyDisabled === disabled) {
      return;
    }

    captureSessionSnapshot(`${disabled ? '取消勾选' : '勾选'} Buff 命中项 · ${selectedHitRow?.detail.buttonName ?? selectedPersistedButton.skillDisplayName ?? selectedPersistedButton.skillType}`);
    const nextMap = {
      ...currentMap,
      [selectedSegmentKey]: disabled
        ? [...currentIds, buffId]
        : currentIds.filter((id) => id !== buffId),
    };
    persistManualBuffTweaks(nextMap);
    recomputeSkillButtonPanel(selectedPersistedButton.id);
    handleRefreshAndKeepSelection();
  }, [handleRefreshAndKeepSelection, persistManualBuffTweaks, selectedHitRow?.detail.buttonName, selectedPersistedButton, selectedSegmentKey]);

  const handleApplyLocalBuffSearchResult = useCallback((entry: LocalBuffSearchResult) => {
    if (!selectedPersistedButton) {
      return;
    }

    captureSessionSnapshot(`添加 Buff · ${entry.displayName}`);
    const result = addSkillButtonBuff(selectedPersistedButton.id, {
      name: entry.name,
      displayName: entry.displayName,
      sourceName: entry.sourceName,
      level: entry.level || '',
      type: entry.type,
      value: entry.value,
      description: entry.description,
      source: entry.source,
      condition: entry.condition,
      category: entry.category,
      maxStacks: entry.maxStacks,
      ownerBuffDomain: entry.ownerBuffDomain,
      ownerCharacterId: entry.ownerCharacterId,
      ownerBuffGroup: entry.ownerBuffGroup,
      valueMode: entry.valueMode,
      derivedValue: entry.derivedValue,
      effectKind: entry.effectKind,
      extraHitConfig: entry.extraHitConfig,
      multiplier: entry.multiplier,
      refCount: 1,
    });

    if (result.success) {
      recomputeSkillButtonPanel(selectedPersistedButton.id);
      setBuffSearchKeyword('');
      handleRefreshAndKeepSelection();
    }
  }, [handleRefreshAndKeepSelection, selectedPersistedButton]);

  const handleRestoreUndoSnapshot = useCallback((snapshotId: string) => {
    const restored = restoreUndoSnapshot(snapshotId);
    if (!restored) {
      return;
    }
    setIsUndoMenuOpen(false);
    handleGenerate();
    setUndoSnapshots(readUndoSnapshots());
  }, [handleGenerate]);

  useEffect(() => {
    setUndoSnapshots(readUndoSnapshots());
  }, []);

  useEffect(() => {
    if (!selectedPersistedButton) {
      return;
    }
    loadPersistedAnomalyCards();
  }, [loadPersistedAnomalyCards, selectedPersistedButton?.id]);

  const withUndo = useCallback((label: string, fn: () => void) => {
    captureSessionSnapshot(label);
    fn();
    handleRefreshAndKeepSelection();
  }, [handleRefreshAndKeepSelection]);

  const contextMenuActions = useMemo(() => {
    if (!contextMenu) {
      return [];
    }

    const actions: DamageSheetContextMenuAction[] = [];
    if (contextMenu.target === 'buff' && contextMenu.buffId) {
      const isDisabled = manuallyDisabledBuffIds.includes(contextMenu.buffId);
      const isFramed = framedRelevantBuffId === contextMenu.buffId;
      actions.push({
        key: isFramed ? 'clear-buff-frame' : 'frame-buff',
        label: isFramed ? '取消框选' : '框选',
        icon: isFramed ? 'cancel' : 'confirm',
        onSelect: () => setFramedRelevantBuffId(isFramed ? null : contextMenu.buffId!),
      });
      actions.push({
        key: isDisabled ? 'enable-buff' : 'disable-buff',
        label: isDisabled ? '勾选' : '取消勾选',
        icon: isDisabled ? 'confirm' : 'delete',
        onSelect: () => setManualBuffDisabledForSelectedHit(contextMenu.buffId!, !isDisabled),
      });
      actions.push({
        key: 'cancel',
        label: '取消',
        icon: 'cancel',
        onSelect: () => closeContextMenu(),
      });
      return actions;
    }

    if (contextMenu.target === 'character' && orderMode === 'character' && contextMenu.characterId) {
      const isCollapsed = collapsedCharacterIds[contextMenu.characterId];
      actions.push({
        key: 'toggle-character',
      label: isCollapsed ? '展开当前干员' : '折叠当前干员',
        icon: 'cancel',
        onSelect: () => toggleCharacterCollapsed(contextMenu.characterId!),
      });
      actions.push({
        key: 'collapse-all-characters',
      label: '折叠全部干员',
        icon: 'cancel',
        onSelect: () => setAllCharactersCollapsed(true),
      });
      actions.push({
        key: 'expand-all-characters',
      label: '展开全部干员',
        icon: 'cancel',
        onSelect: () => setAllCharactersCollapsed(false),
      });
    }

    if (contextMenu.target === 'sheet' && orderMode === 'character') {
      actions.push({
        key: 'collapse-all-characters',
      label: '折叠全部干员',
        icon: 'cancel',
        onSelect: () => setAllCharactersCollapsed(true),
      });
      actions.push({
        key: 'expand-all-characters',
      label: '展开全部干员',
        icon: 'cancel',
        onSelect: () => setAllCharactersCollapsed(false),
      });
    }

    if (contextMenu.target === 'group' && contextMenu.group) {
      const isCollapsed = collapsedColumnGroups[contextMenu.group];
      actions.push({
        key: 'toggle-group',
        label: isCollapsed ? `展开${contextMenu.group}` : `折叠${contextMenu.group}`,
        icon: 'cancel',
        onSelect: () => toggleColumnGroupCollapsed(contextMenu.group!),
      });
    }

    actions.push({
      key: 'collapse-all-groups',
      label: '折叠全部列区',
      icon: 'cancel',
      onSelect: () => setAllColumnGroupsCollapsed(true),
    });
    actions.push({
      key: 'expand-all-groups',
      label: '展开全部列区',
      icon: 'cancel',
      onSelect: () => setAllColumnGroupsCollapsed(false),
    });

    return actions;
  }, [
    collapsedCharacterIds,
    collapsedColumnGroups,
    contextMenu,
    framedRelevantBuffId,
    manuallyDisabledBuffIds,
    orderMode,
    setAllCharactersCollapsed,
    setAllColumnGroupsCollapsed,
    closeContextMenu,
    setManualBuffDisabledForSelectedHit,
    setFramedRelevantBuffId,
    toggleCharacterCollapsed,
    toggleColumnGroupCollapsed,
  ]);

  return (
    <div className="damage-sheet-page">
      <header className="damage-sheet-topbar">
        <div className="damage-sheet-topbar-left">
          <button type="button" className="damage-sheet-back-button" onClick={() => navigateToAppPath(APP_ROUTE_PATHS.home)}>
            返回主界面
          </button>
          <div className="damage-sheet-title-block">
            <h1>伤害过程表</h1>
            <p>基于业务数据直接生成的伤害过程视图。</p>
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
                    title={buildUndoSnapshotHoverText(snapshot)}
                  >
                    <strong>{formatUndoLabel(snapshot.createdAt)}</strong>
                    <span>{snapshot.label}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <button type="button" className="damage-sheet-action-button" onClick={handleGenerate} disabled={isGenerating}>
            {isGenerating ? '刷新中...' : '刷新表格'}
          </button>
          <button type="button" className="damage-sheet-action-button" disabled>
            复制
          </button>
          <button type="button" className="damage-sheet-action-button" disabled>
            出图
          </button>
        </div>
      </header>

      <section className="damage-sheet-ribbon">
        <div className="damage-sheet-ribbon-card">
          <span className="damage-sheet-ribbon-label">干员</span>
          <strong>{totalCharacterCount}</strong>
        </div>
        <div className="damage-sheet-ribbon-card">
          <span className="damage-sheet-ribbon-label">按钮</span>
          <strong>{totalButtonCount}</strong>
        </div>
        <div className="damage-sheet-ribbon-card">
          <span className="damage-sheet-ribbon-label">命中</span>
          <strong>{totalHitCount}</strong>
        </div>
        <div className="damage-sheet-formula-bar">
          <span className="damage-sheet-formula-address">{selectedAddress}</span>
          <span className="damage-sheet-formula-label">fx</span>
          <div className="damage-sheet-formula-value">{selectedValue}</div>
        </div>
      </section>

      <main className="damage-sheet-workspace">
        <aside className="damage-sheet-sidebar">
          <div className="damage-sheet-sidebar-title">工作表</div>
          <button type="button" className="damage-sheet-sheet-tab is-active">
            伤害过程
          </button>
          <div className="damage-sheet-sidebar-title">格子明细</div>
          {ENABLE_ADVANCED_SHEET_SIDEBAR ? (
            <div className="damage-sheet-sidebar-tabs">
              <button type="button" className={`damage-sheet-mini-tab${sidebarTab === 'related' ? ' is-active' : ''}`} onClick={() => setSidebarTab('related')}>相关</button>
              <button type="button" className={`damage-sheet-mini-tab${sidebarTab === 'local' ? ' is-active' : ''}`} onClick={() => setSidebarTab('local')}>本地</button>
              <button type="button" className={`damage-sheet-mini-tab${sidebarTab === 'anomaly' ? ' is-active' : ''}`} onClick={() => setSidebarTab('anomaly')}>异常</button>
              <button type="button" className={`damage-sheet-mini-tab${sidebarTab === 'state' ? ' is-active' : ''}`} onClick={() => setSidebarTab('state')}>状态</button>
              <button type="button" className={`damage-sheet-mini-tab${sidebarTab === 'anomaly-state' ? ' is-active' : ''}`} onClick={() => setSidebarTab('anomaly-state')}>快照</button>
            </div>
          ) : null}
          <div className="damage-sheet-sidebar-note">
            {selectedWorkbookCell?.columnKey && selectedHitRow
              ? `${selectedWorkbookCell.address} · ${selectedHitRow.detail.buttonName} · ${selectedHitRow.detail.hitLabel}${selectedRelevantBuff ? ` · ${selectedRelevantBuff.displayName}` : ''}`
              : '点击任意命中单元格后，这里显示当前格子的相关 Buff。'}
          </div>
          {(!ENABLE_ADVANCED_SHEET_SIDEBAR || sidebarTab === 'related') ? (
            <div className="damage-sheet-buff-grid">
              {selectedHitRow ? (
                relevantBuffs.length > 0 ? relevantBuffs.map((buff) => {
                  const isDisabled = manuallyDisabledBuffIds.includes(buff.id);
                  const isSelected = selectedRelevantBuffId === buff.id;
                  const isFramed = framedRelevantBuffId === buff.id;
                  return (
                    <div key={buff.id} className={`damage-sheet-buff-card${isDisabled ? ' is-muted' : ''}`} title={`来源：${buff.sourceName || buff.source || '未知'}\n类型：${buff.type || '未标注'}\n${buff.description || buff.condition || ''}`}>
                      <button
                        type="button"
                        className={`damage-sheet-buff-tag${isDisabled ? '' : ' is-active'}${isSelected ? ' is-selected' : ''}${isFramed ? ' is-framed' : ''}`}
                        onClick={() => setSelectedRelevantBuffId(buff.id)}
                        onContextMenu={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          setSelectedRelevantBuffId(buff.id);
                          handleOpenContextMenu(event, {
                            x: event.clientX,
                            y: event.clientY,
                            target: 'buff',
                            buffId: buff.id,
                          });
                        }}
                      >
                        <span className="damage-sheet-buff-name">{buff.displayName}</span>
                        <span className="damage-sheet-buff-effect">{formatHitBuffContribution(selectedHitRow.detail.hitResult, buff)}</span>
                      </button>
                    </div>
                  );
                }) : (
                  <div className="damage-sheet-detail-empty">当前格子没有命中相关 Buff。</div>
                )
              ) : (
                <div className="damage-sheet-detail-empty">先选中一个命中格子。</div>
              )}
            </div>
          ) : null}
          {ENABLE_ADVANCED_SHEET_SIDEBAR && sidebarTab === 'local' ? (
            selectedPersistedButton ? (
              <div className="damage-sheet-local-panel">
                <input
                  className="damage-sheet-local-search"
                  value={buffSearchKeyword}
                  onChange={(event) => setBuffSearchKeyword(event.target.value)}
                  placeholder="输入关键词后显示本地 Buff"
                />
                {buffSearchKeyword.trim() ? (
                  filteredLocalBuffSearchResults.length > 0 ? (
                    <div className="damage-sheet-local-results">
                      {filteredLocalBuffSearchResults.map((entry) => (
                        <button key={entry.key} type="button" className="damage-sheet-local-item" onClick={() => handleApplyLocalBuffSearchResult(entry)}>
                          <strong>{entry.displayName}</strong>
                          <span>{entry.sourceName || entry.groupName}</span>
                          <span>{entry.type || 'Buff'}{typeof entry.value === 'number' ? ` ${entry.value >= 0 ? '+' : ''}${(entry.value * 100).toFixed(1)}%` : ''}</span>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="damage-sheet-detail-empty">没有匹配到本地 Buff。</div>
                  )
                ) : (
                  <div className="damage-sheet-detail-empty">输入关键词后再显示本地 Buff 结果。</div>
                )}
              </div>
            ) : (
              <div className="damage-sheet-detail-empty">先选中一个命中格子。</div>
            )
          ) : null}
          {ENABLE_ADVANCED_SHEET_SIDEBAR && sidebarTab === 'anomaly' ? (
            selectedPersistedButton ? (
              <div className="damage-sheet-embedded-panel">
                <SkillButtonAnomalyPanel
                  activeAnomaly={anomalyState.activeAnomaly}
                  activeAnomalyGroup={anomalyState.activeAnomalyGroup}
                  activeAnomalyLevel={anomalyState.activeAnomalyLevel}
                  activeAnomalyPreview={anomalyState.activeAnomalyPreview}
                  activeSourceCharacter={anomalyState.activeSourceCharacter}
                  sourceCharacters={anomalyState.sourceCharacters}
                  selectedAnomalyDamages={anomalyState.selectedAnomalyDamages}
                  activeDurationSeconds={anomalyState.activeDurationSeconds}
                  burnDamageMode={anomalyState.burnDamageMode}
                  onSetActiveAnomalyGroup={anomalyState.setActiveAnomalyGroup}
                  onResetActiveAnomalyKey={() => anomalyState.setActiveAnomalyKey(null)}
                  onSelectAnomaly={anomalyState.handleSelectAnomaly}
                  onApplyActiveAnomaly={() => withUndo(`异常区调整 · ${selectedPersistedButton.skillDisplayName ?? selectedPersistedButton.skillType}`, anomalyState.handleApplyActiveAnomaly)}
                  onSetActiveAnomalyLevel={anomalyState.setActiveAnomalyLevel}
                  onSetActiveAnomalySourceId={anomalyState.setActiveAnomalySourceId}
                  onSetBurnDamageMode={anomalyState.setBurnDamageMode}
                  onSetActiveDurationSeconds={anomalyState.setActiveDurationSeconds}
                  onRemoveAnomalyCard={(kind, cardId) => withUndo(`移除异常卡 · ${selectedPersistedButton.skillDisplayName ?? selectedPersistedButton.skillType}`, () => anomalyState.removeAnomalyCard(kind, cardId))}
                />
              </div>
            ) : (
              <div className="damage-sheet-detail-empty">先选中一个命中格子。</div>
            )
          ) : null}
          {ENABLE_ADVANCED_SHEET_SIDEBAR && sidebarTab === 'state' ? (
            selectedPersistedButton ? (
              <div className="damage-sheet-embedded-panel">
                <SkillButtonStatePanel
                  activeAnomaly={anomalyState.activeAnomaly}
                  activeAnomalyLevel={anomalyState.activeAnomalyLevel}
                  activeAnomalyPreview={anomalyState.activeAnomalyPreview}
                  selectedStatusCards={anomalyState.selectedStatusCards}
                  onSelectAnomaly={anomalyState.handleSelectAnomaly}
                  onApplyActiveAnomaly={() => withUndo(`状态区调整 · ${selectedPersistedButton.skillDisplayName ?? selectedPersistedButton.skillType}`, anomalyState.handleApplyActiveAnomaly)}
                  onSetActiveAnomalyLevel={anomalyState.setActiveAnomalyLevel}
                  onRemoveAnomalyCard={(kind, cardId) => withUndo(`移除状态卡 · ${selectedPersistedButton.skillDisplayName ?? selectedPersistedButton.skillType}`, () => anomalyState.removeAnomalyCard(kind, cardId))}
                />
              </div>
            ) : (
              <div className="damage-sheet-detail-empty">先选中一个命中格子。</div>
            )
          ) : null}
          {ENABLE_ADVANCED_SHEET_SIDEBAR && sidebarTab === 'anomaly-state' ? (
            selectedPersistedButton ? (
              <div className="damage-sheet-embedded-panel">
                <SkillButtonAnomalyStatePanel
                  activeAnomalyStateOption={anomalyState.activeAnomalyStateOption}
                  activeAnomalyStateLevel={anomalyState.activeAnomalyStateLevel}
                  activeAnomalyStateDurationSeconds={anomalyState.activeAnomalyStateDurationSeconds}
                  activeAnomalyStatePreview={anomalyState.activeAnomalyStatePreview}
                  activeAnomalyStateSourceCharacter={anomalyState.activeAnomalyStateSourceCharacter}
                  sourceCharacters={anomalyState.sourceCharacters}
                  selectedAnomalyStateSnapshots={anomalyState.selectedAnomalyStateSnapshots}
                  onSelectAnomalyState={anomalyState.handleSelectAnomalyState}
                  onCreateSnapshot={() => withUndo(`创建异常快照 · ${selectedPersistedButton.skillDisplayName ?? selectedPersistedButton.skillType}`, anomalyState.handleCreateAnomalyStateSnapshot)}
                  onSetActiveAnomalyStateLevel={anomalyState.setActiveAnomalyStateLevel}
                  onSetActiveAnomalyStateSourceId={anomalyState.setActiveAnomalyStateSourceId}
                  onSetActiveAnomalyStateDurationSeconds={anomalyState.setActiveAnomalyStateDurationSeconds}
                  onRemoveAnomalyStateSnapshotCard={(snapshotId) => withUndo(`卸载异常快照 · ${selectedPersistedButton.skillDisplayName ?? selectedPersistedButton.skillType}`, () => anomalyState.removeAnomalyStateSnapshotCard(snapshotId))}
                />
              </div>
            ) : (
              <div className="damage-sheet-detail-empty">先选中一个命中格子。</div>
            )
          ) : null}
        </aside>
        <section className="damage-sheet-excel-shell">
          <div
            className="damage-sheet-excel-scroll"
            onContextMenu={(event) => handleOpenContextMenu(event, {
              x: event.clientX,
              y: event.clientY,
              target: 'sheet',
            })}
          >
            {workbookRows.length === 0 ? (
              <div className="damage-sheet-empty-state">
                <h2>当前没有可展示的伤害数据</h2>
            <p>先保证时间轴中有干员和按钮，再刷新这张表。</p>
              </div>
            ) : (
              workbookRows.map((row) => (
                <div
                  key={row.key}
                  className={`damage-sheet-excel-row is-${row.kind}`}
                  onContextMenu={(event) => {
                    if (orderMode === 'character' && row.sourceRow?.kind === 'character') {
                      handleOpenContextMenu(event, {
                        x: event.clientX,
                        y: event.clientY,
                        target: 'character',
                        characterId: row.sourceRow.characterId,
                      });
                      return;
                    }
                    handleOpenContextMenu(event, {
                      x: event.clientX,
                      y: event.clientY,
                      target: 'sheet',
                    });
                  }}
                >
                  <div className="damage-sheet-excel-row-number">{renderRowNumberCell(row)}</div>
                  <div className="damage-sheet-excel-row-cells">
                    {row.cells.map((cell) => {
                      const buffFrameMeta = getWorkbookCellBuffFrameMeta(row, cell);
                      return (
                        <div
                          key={cell.key}
                          className={`damage-sheet-excel-cell is-${cell.kind} is-${cell.align}${selectedWorkbookCell?.address === cell.address ? ' is-active' : ''}${buffFrameMeta.className}`}
                          style={{ width: `${cell.width}px`, ...buffFrameMeta.style }}
                          onClick={() => {
                            if (row.kind === 'group' && cell.value !== '索引') {
                              toggleColumnGroupCollapsed(cell.value);
                              return;
                            }
                            setSelectedWorkbookCell({
                              address: cell.address,
                              value: cell.value,
                              sourceRowId: cell.sourceRowId,
                              columnKey: cell.columnKey,
                            });
                          }}
                          onContextMenu={(event) => {
                            if (row.kind === 'group' && cell.value !== '索引') {
                              handleOpenContextMenu(event, {
                                x: event.clientX,
                                y: event.clientY,
                                target: 'group',
                                group: cell.value,
                              });
                              return;
                            }
                            if (orderMode === 'character' && row.sourceRow?.kind === 'character') {
                              handleOpenContextMenu(event, {
                                x: event.clientX,
                                y: event.clientY,
                                target: 'character',
                                characterId: row.sourceRow.characterId,
                              });
                              return;
                            }
                            handleOpenContextMenu(event, {
                              x: event.clientX,
                              y: event.clientY,
                              target: 'sheet',
                            });
                          }}
                        >
                          {renderWorkbookCellContent(row, cell)}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))
            )}
            {contextMenu && contextMenuActions.length > 0 ? (
              <div
                className="damage-sheet-context-menu"
                style={{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }}
                onPointerDown={(event) => event.stopPropagation()}
                onContextMenu={(event) => event.preventDefault()}
              >
                {contextMenuActions.map((action) => (
                  <button
                    key={action.key}
                    type="button"
                    className="damage-sheet-context-menu-item"
                    onClick={() => {
                      action.onSelect();
                      closeContextMenu();
                    }}
                  >
                    <span className="damage-sheet-context-menu-icon" aria-hidden="true">
                      <svg className="damage-sheet-context-menu-svg" viewBox="0 0 16 16" focusable="false">
                        {renderDamageSheetMenuIcon(action.icon)}
                      </svg>
                    </span>
                    <span className="damage-sheet-context-menu-label">{action.label}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <div className="damage-sheet-workspace-footer">
            <div className="damage-sheet-view-group">
              <span className="damage-sheet-ribbon-label">排序方式</span>
              <button
                type="button"
                className={`damage-sheet-mini-tab${orderMode === 'character' ? ' is-active' : ''}`}
                onClick={() => setOrderMode('character')}
              >
                按干员
              </button>
              <button
                type="button"
                className={`damage-sheet-mini-tab${orderMode === 'cast' ? ' is-active' : ''}`}
                onClick={() => setOrderMode('cast')}
              >
                按施放
              </button>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
