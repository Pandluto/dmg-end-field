import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { APP_ROUTE_PATHS, navigateToAppPath } from '../utils/appRoute';
import { normalizeAssetUrl, resolvePublicPath } from '../utils/assetResolver';
import { persistentLocalStorage } from '../platform/storage/persistentStorage';
import {
  buildDraftLibraryShareFile,
  buildDraftLibraryShareFileName,
  parseDraftLibraryShareFile,
  type DraftLibraryShareFile,
} from '../utils/draftShare';
import { webImageLibrary, getWebImageUrl } from '../platform/resources/webImageLibrary';
import type { ImageAssetEntry } from './ImageManager/types';
import BuffEffectEditorDrawer from './BuffEffectEditorDrawer';
import {
  BUFF_TYPE_LABELS,
  BUFF_TYPE_OPTIONS,
  createEmptyLibrary,
  drawerEffectToEquipmentBuff,
  EQUIPMENT_BUFF_BUSINESS_TYPE_OPTIONS,
  EQUIPMENT_PARTS,
  equipmentBuffToDrawer,
  getEffectEntries,
  getEquipmentBuffBusinessType,
  getEquipments,
  getEquipmentEffectShape,
  getEquipmentEffectTypeOptions,
  getGearSets,
  getSortedEquipments,
  LEVEL_KEYS,
  normalizeEquipmentLibrary,
  type EquipmentEffectId,
  type EquipmentGearSet,
  type EquipmentLevelKey,
  type EquipmentLibrary,
} from './equipmentSheetModel';
import {
  addEquipmentFixedStat,
  applyCellValueToLibrary,
  applyEquipmentEffectValueMapping,
  createEquipmentEffect,
  createEquipmentGearSet,
  createEquipmentItem,
  createEquipmentThreePieceEffect,
  deleteEquipmentNode,
  duplicateEquipmentEffect,
  duplicateEquipmentItem,
  duplicateEquipmentThreePieceEffect,
  normalizeEquipmentLibraryOrder,
  updateLibrarySet,
  type EquipmentEditingResult,
} from './equipmentSheetEditing';
import {
  buildEquipmentFormulaBinding,
  type EquipmentFormulaBinding,
} from './equipmentSheetFormula';
import {
  buildRows,
  buildWorkbookRows,
  COLUMNS,
  columnIndexToLabel,
  filterVisibleRows,
  getWorkbookRowClassName,
  type EquipmentRow,
  type EquipmentSheetColumn,
  type EquipmentWorkbookCell,
  type EquipmentWorkbookRow,
} from './equipmentSheetWorkbook';
import './BuffDraftPage.css';
import './OperatorDraftPage.css';
import './DamageSheetPage.css';
import './EquipmentSheetPage.css';

const EQUIPMENT_SHEET_PAGE_PATH = APP_ROUTE_PATHS.equipmentSheet;
const EQUIPMENT_DRAFT_STORAGE_KEY = 'def.equipment-sheet.draft.v1';
const EQUIPMENT_LIBRARY_STORAGE_KEY = 'def.equipment-sheet.library.v1';
const EQUIPMENT_LIBRARY_SHARE_TYPE = 'equipment-library-share.v1';
const EQUIPMENT_LIBRARY_PATH = 'data/equipments/equipments.json';

type EquipmentSelection = {
  address: string;
  sourceRowKey: string;
  columnKey: EquipmentSheetColumn['key'];
};

interface EquipmentImageOption {
  key: string;
  fileName: string;
  baseName: string;
  relativePath: string;
  source: 'builtin' | 'user';
  displayUrl: string;
  searchText: string;
}

type EquipmentExplorerNode =
  | { kind: 'set'; gearSetId: string }
  | { kind: 'threePieceBuffHeader'; gearSetId: string }
  | { kind: 'threePieceBuff'; gearSetId: string; effectId: string }
  | { kind: 'equipment'; gearSetId: string; equipmentId: string }
  | { kind: 'fixedStat'; gearSetId: string; equipmentId: string }
  | { kind: 'effect'; gearSetId: string; equipmentId: string; effectId: EquipmentEffectId };

type EquipmentContextMenuState = {
  x: number;
  y: number;
  target: 'blank' | EquipmentExplorerNode['kind'] | 'effectLevels';
  gearSetId?: string;
  equipmentId?: string;
  effectId?: string;
};

type EquipmentContextMenuAction = {
  key: string;
  label: string;
  icon: 'new' | 'delete' | 'collapse' | 'expand' | 'open';
  onClick: () => void;
};

const EMPTY_LIBRARY: EquipmentLibrary = {
  updatedAt: '',
  gearSets: {},
};

function isEquipmentSheetPath(pathname: string) {
  return pathname === EQUIPMENT_SHEET_PAGE_PATH;
}

function readLocalStorageJson<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') {
    return fallback;
  }
  try {
    const raw = persistentLocalStorage.getItem(key);
    return raw ? JSON.parse(raw) as T : fallback;
  } catch {
    return fallback;
  }
}

function writeLocalStorageJson<T>(key: string, value: T) {
  if (typeof window === 'undefined') {
    return;
  }
  persistentLocalStorage.setItem(key, JSON.stringify(value));
}

function buildEquipmentImageAssetUrl(entry: ImageAssetEntry) {
  const userUrl = getWebImageUrl(entry);
  if (userUrl) return userUrl;
  const isFileProtocol = window.location.protocol === 'file:';
  const path = isFileProtocol
    ? entry.relativePath
    : entry.relativePath.split('/').map(encodeURIComponent).join('/');
  return resolvePublicPath(path);
}

function buildEquipmentImageOption(entry: ImageAssetEntry): EquipmentImageOption | null {
  if (entry.kind === 'dir') return null;
  const displayUrl = buildEquipmentImageAssetUrl(entry);
  const source = entry.source === 'release' || entry.source === 'user' ? 'user' : 'builtin';
  return {
    key: entry.relativePath,
    fileName: entry.fileName,
    baseName: entry.baseName,
    relativePath: entry.relativePath,
    source,
    displayUrl,
    searchText: `${entry.fileName} ${entry.baseName} ${entry.relativePath} ${displayUrl} ${source}`.toLowerCase(),
  };
}

function stopEditingKeyPropagation(event: React.KeyboardEvent<HTMLElement>) {
  if (['Backspace', 'Delete', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Tab', 'Enter', 'Escape'].includes(event.key)) {
    event.stopPropagation();
  }
}

function readCachedEquipmentLibrary(): EquipmentLibrary {
  const libraryCache = normalizeEquipmentLibrary(readLocalStorageJson(EQUIPMENT_LIBRARY_STORAGE_KEY, EMPTY_LIBRARY));
  if (Object.keys(libraryCache.gearSets).length > 0) {
    return libraryCache;
  }
  return normalizeEquipmentLibrary(readLocalStorageJson(EQUIPMENT_DRAFT_STORAGE_KEY, EMPTY_LIBRARY));
}

async function readEquipmentLibraryFromFile(): Promise<EquipmentLibrary> {
  const response = await fetch(resolvePublicPath(EQUIPMENT_LIBRARY_PATH), { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`读取装备库失败：HTTP ${response.status}`);
  }
  return normalizeEquipmentLibrary(await response.json());
}

function renderMenuIcon(icon: EquipmentContextMenuAction['icon']) {
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
      return <path d="M4 8h8" />;
    case 'expand':
      return <path d="M8 4v8M4 8h8" />;
    case 'open':
    default:
      return <path d="M5.75 4.25h6v6M11.75 4.25L4.25 11.75" />;
  }
}

function downloadJson(fileName: string, content: string) {
  const blob = new Blob([content], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export {
  isEquipmentSheetPath,
};

export function EquipmentSheetPage() {
  const [library, setLibraryState] = useState<EquipmentLibrary>(() => normalizeEquipmentLibrary(EMPTY_LIBRARY));
  const libraryRef = useRef(library);
  const [selectedRowKey, setSelectedRowKey] = useState('');
  const [selectedCell, setSelectedCell] = useState<EquipmentSelection | null>(null);
  const [filterKeyword, setFilterKeyword] = useState('');
  const [activeGearSetId, setActiveGearSetId] = useState<string | null>(null);
  const [activeEquipmentId, setActiveEquipmentId] = useState<string | null>(null);
  const [collapsedGearSetIds, setCollapsedGearSetIds] = useState<Record<string, boolean>>({});
  const [collapsedEquipmentIds, setCollapsedEquipmentIds] = useState<Record<string, boolean>>({});
  const [collapsedEffectIds, setCollapsedEffectIds] = useState<Record<string, boolean>>({});
  const [collapsedThreePieceBuffIds, setCollapsedThreePieceBuffIds] = useState<Record<string, boolean>>({});
  const [isOverwriteProtectionEnabled, setIsOverwriteProtectionEnabled] = useState(true);
  const [contextMenu, setContextMenu] = useState<EquipmentContextMenuState | null>(null);
  const [buffDrawerTarget, setBuffDrawerTarget] = useState<{ gearSetId: string; effectId: string } | null>(null);
  const [message, setMessage] = useState('正在读取装备库...');
  const [formulaInput, setFormulaInput] = useState('');
  const [buffTypeQuery, setBuffTypeQuery] = useState('');
  const [imageAssets, setImageAssets] = useState<ImageAssetEntry[]>([]);
  const [imageAssetsLoading, setImageAssetsLoading] = useState(false);
  const [imageAssetsError, setImageAssetsError] = useState('');
  const [equipmentImageQuery, setEquipmentImageQuery] = useState('');
  const [isEquipmentImageDrawerOpen, setIsEquipmentImageDrawerOpen] = useState(false);
  const [equipmentImageLoadFailed, setEquipmentImageLoadFailed] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [isSaveConfirmModalOpen, setIsSaveConfirmModalOpen] = useState(false);
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);
  const [shareModalMode, setShareModalMode] = useState<'export' | 'import'>('export');
  const [shareImportText, setShareImportText] = useState('');
  const [shareImportError, setShareImportError] = useState('');
  const [pendingImportShare, setPendingImportShare] = useState<DraftLibraryShareFile<EquipmentGearSet> | null>(null);
  const [exportScope, setExportScope] = useState<'current' | 'all'>('current');
  const shareImportInputRef = useRef<HTMLInputElement>(null);
  const tableScrollRef = useRef<HTMLDivElement>(null);
  const equipmentImageFormulaRef = useRef<HTMLDivElement>(null);

  const replaceLibrary = useCallback((nextLibrary: EquipmentLibrary) => {
    libraryRef.current = nextLibrary;
    setLibraryState(nextLibrary);
  }, []);

  useEffect(() => {
    let cancelled = false;
    readEquipmentLibraryFromFile()
      .then((fileLibrary) => {
        if (cancelled) return;
        const cached = readCachedEquipmentLibrary();
        const hasCachedData = Object.keys(cached.gearSets).length > 0;
        const shouldUseCached = hasCachedData;
        const nextLibrary = shouldUseCached ? cached : fileLibrary;
        replaceLibrary(nextLibrary);
        setIsDirty(false);
        if (shouldUseCached) {
          setMessage('已从浏览器 SQLite 加载装备库。');
          return;
        }
        setMessage(fileLibrary.migration?.reviewRequired ? '装备库已加载。迁移数据需要人工复核 typeKey 映射。' : '装备库已加载。');
      })
      .catch((error) => {
        if (cancelled) return;
        const cached = readCachedEquipmentLibrary();
        if (Object.keys(cached.gearSets).length > 0) {
          replaceLibrary(cached);
          setIsDirty(false);
          setMessage(`读取内置资料失败，已使用浏览器 SQLite：${error instanceof Error ? error.message : String(error)}`);
        } else {
          replaceLibrary(createEmptyLibrary());
          setMessage(`读取装备库失败，已创建空库：${error instanceof Error ? error.message : String(error)}`);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [replaceLibrary]);

  useEffect(() => {
    let cancelled = false;
    setImageAssetsLoading(true);
    setImageAssetsError('');
    webImageLibrary.listAssets()
      .then((assets) => {
        if (cancelled) return;
        setImageAssets(assets);
      })
      .catch((error) => {
        if (cancelled) return;
        setImageAssets([]);
        setImageAssetsError(error instanceof Error ? error.message : '图片资源加载失败');
      })
      .finally(() => {
        if (!cancelled) {
          setImageAssetsLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const filteredGearSets = useMemo(() => {
    const keyword = filterKeyword.trim().toLowerCase();
    const sets = getGearSets(library);
    if (!keyword) return sets;
    return sets
      .map((gearSet) => {
        const equipments = Object.fromEntries(
          getEquipments(gearSet)
            .filter((equipment) => {
              const effectText = getEffectEntries(equipment).map(([, effect]) => `${effect.label} ${effect.typeKey}`).join(' ');
              return `${gearSet.name} ${gearSet.gearSetId} ${equipment.name} ${equipment.equipmentId} ${equipment.part} ${effectText}`.toLowerCase().includes(keyword);
            })
            .map((equipment) => [equipment.equipmentId, equipment])
        );
        if (`${gearSet.name} ${gearSet.gearSetId} ${gearSet.buffId || ''}`.toLowerCase().includes(keyword) || Object.keys(equipments).length > 0) {
          return { ...gearSet, equipments };
        }
        return null;
      })
      .filter((gearSet): gearSet is EquipmentGearSet => Boolean(gearSet));
  }, [filterKeyword, library]);

  const tableGearSets = useMemo(() => {
    if (activeGearSetId) {
      const activeGearSet = filteredGearSets.find((gearSet) => gearSet.gearSetId === activeGearSetId) ?? library.gearSets[activeGearSetId];
      if (!activeGearSet) return [];
      if (!activeEquipmentId) return [activeGearSet];
      const activeEquipment = activeGearSet.equipments[activeEquipmentId] ?? library.gearSets[activeGearSetId]?.equipments[activeEquipmentId];
      return activeEquipment
        ? [{ ...activeGearSet, equipments: { [activeEquipment.equipmentId]: activeEquipment } }]
        : [activeGearSet];
    }
    return filteredGearSets.map((gearSet) => ({ ...gearSet, equipments: {} }));
  }, [activeEquipmentId, activeGearSetId, filteredGearSets, library.gearSets]);
  const rows = useMemo(() => buildRows({ ...library, gearSets: Object.fromEntries(tableGearSets.map((gearSet) => [gearSet.gearSetId, gearSet])) }), [library, tableGearSets]);
  const visibleRows = useMemo(
    () => filterVisibleRows(rows, collapsedGearSetIds, collapsedEquipmentIds, collapsedEffectIds, collapsedThreePieceBuffIds),
    [collapsedEffectIds, collapsedEquipmentIds, collapsedGearSetIds, collapsedThreePieceBuffIds, rows],
  );
  const workbookRows = useMemo(() => buildWorkbookRows(visibleRows), [visibleRows]);
  const selectedRow = useMemo(() => visibleRows.find((row) => row.key === selectedRowKey) ?? visibleRows[0] ?? null, [selectedRowKey, visibleRows]);
  const previewImageMeta = useMemo(() => {
    if (!selectedRow) {
      return { imgUrl: '', title: '装备配图预览', alt: '装备配图' };
    }
    if (
      selectedRow.kind === 'set'
      || selectedRow.kind === 'threePieceBuffHeader'
      || selectedRow.kind === 'threePieceBuff'
    ) {
      const gearSet = library.gearSets[selectedRow.gearSetId];
      return {
        imgUrl: gearSet?.imgUrl?.trim() || '',
        title: gearSet?.imgUrl?.trim() || '套装配图预览',
        alt: gearSet?.name || '套装配图',
      };
    }
    const gearSet = library.gearSets[selectedRow.gearSetId];
    const equipment = gearSet?.equipments[selectedRow.equipmentId];
    return {
      imgUrl: equipment?.imgUrl?.trim() || '',
      title: equipment?.imgUrl?.trim() || '装备配图预览',
      alt: equipment?.name || '装备配图',
    };
  }, [library.gearSets, selectedRow]);
  const equipmentImageOptions = useMemo(
    () => imageAssets.map(buildEquipmentImageOption).filter((option): option is EquipmentImageOption => option !== null),
    [imageAssets],
  );
  const filteredEquipmentImageOptions = useMemo(() => {
    const keyword = equipmentImageQuery.trim().toLowerCase();
    if (!keyword) return equipmentImageOptions;
    return equipmentImageOptions.filter((option) => option.searchText.includes(keyword));
  }, [equipmentImageOptions, equipmentImageQuery]);
  const currentShareFile = useMemo(() => {
    const payload = exportScope === 'current' && selectedRow?.gearSetId && library.gearSets[selectedRow.gearSetId]
      ? { [selectedRow.gearSetId]: library.gearSets[selectedRow.gearSetId] }
      : library.gearSets;
    return buildDraftLibraryShareFile(EQUIPMENT_LIBRARY_SHARE_TYPE, payload, exportScope === 'current' ? selectedRow?.title : 'equipment-library');
  }, [exportScope, library.gearSets, selectedRow]);
  const currentShareText = useMemo(() => JSON.stringify(currentShareFile, null, 2), [currentShareFile]);

  useEffect(() => {
    if (activeGearSetId && !library.gearSets[activeGearSetId]) {
      setActiveGearSetId(null);
      setActiveEquipmentId(null);
      return;
    }
    if (activeGearSetId && activeEquipmentId && !library.gearSets[activeGearSetId]?.equipments[activeEquipmentId]) {
      setActiveEquipmentId(null);
    }
  }, [activeEquipmentId, activeGearSetId, library.gearSets]);

  useEffect(() => {
    if (!selectedRow && visibleRows[0]) {
      setSelectedRowKey(visibleRows[0].key);
    }
  }, [selectedRow, visibleRows]);

  const mutateLibrary = useCallback((updater: (prev: EquipmentLibrary) => EquipmentLibrary) => {
    const next = { ...updater(libraryRef.current), updatedAt: new Date().toISOString() };
    libraryRef.current = next;
    setLibraryState(next);
    setIsDirty(true);
    return next;
  }, []);

  const commitEditingTransaction = useCallback((transaction: (current: EquipmentLibrary) => EquipmentEditingResult) => {
    const result = transaction(libraryRef.current);
    if (!result.changed) return false;
    const nextLibrary = { ...result.library, updatedAt: new Date().toISOString() };
    libraryRef.current = nextLibrary;
    setLibraryState(nextLibrary);
    setIsDirty(true);
    return { ...result, library: nextLibrary };
  }, []);

  const selectEditingRow = useCallback((rowKey: string | undefined) => {
    if (!rowKey) return;
    setSelectedRowKey(rowKey);
    setSelectedCell(null);
  }, []);

  const openEquipmentBuffDrawer = useCallback((gearSetId: string, effectId: string) => {
    setBuffDrawerTarget({ gearSetId, effectId });
  }, []);

  const createThreePieceEffectInSet = useCallback((gearSetId: string) => {
    const result = commitEditingTransaction((current) => createEquipmentThreePieceEffect(current, gearSetId));
    if (!result || !result.effectId) return;
    setActiveGearSetId(gearSetId);
    setActiveEquipmentId(null);
    setCollapsedGearSetIds((prev) => ({ ...prev, [gearSetId]: false }));
    setCollapsedThreePieceBuffIds((prev) => ({ ...prev, [gearSetId]: false }));
    selectEditingRow(result.selectedRowKey);
    setBuffDrawerTarget({ gearSetId, effectId: result.effectId });
  }, [commitEditingTransaction, selectEditingRow]);

  const duplicateThreePieceEffect = useCallback((gearSetId: string, effectId: string) => {
    const result = commitEditingTransaction((current) => duplicateEquipmentThreePieceEffect(current, gearSetId, effectId));
    if (!result || !result.effectId) return;
    setActiveGearSetId(gearSetId);
    setActiveEquipmentId(null);
    setCollapsedGearSetIds((prev) => ({ ...prev, [gearSetId]: false }));
    setCollapsedThreePieceBuffIds((prev) => ({ ...prev, [gearSetId]: false }));
    selectEditingRow(result.selectedRowKey);
    setBuffDrawerTarget({ gearSetId, effectId: result.effectId });
  }, [commitEditingTransaction, selectEditingRow]);

  const createGearSet = useCallback(() => {
    const result = commitEditingTransaction(createEquipmentGearSet);
    if (!result || !result.gearSetId) return;
    setActiveGearSetId(result.gearSetId);
    setActiveEquipmentId(null);
    selectEditingRow(result.selectedRowKey);
  }, [commitEditingTransaction, selectEditingRow]);

  const createEquipmentInSet = useCallback((gearSetId: string) => {
    const result = commitEditingTransaction((current) => createEquipmentItem(current, gearSetId));
    if (!result || !result.equipmentId) return;
    setActiveGearSetId(gearSetId);
    setActiveEquipmentId(result.equipmentId);
    setCollapsedGearSetIds((prev) => ({ ...prev, [gearSetId]: false }));
    selectEditingRow(result.selectedRowKey);
  }, [commitEditingTransaction, selectEditingRow]);

  const createEffectInEquipment = useCallback((gearSetId: string, equipmentId: string) => {
    const result = commitEditingTransaction((current) => createEquipmentEffect(current, gearSetId, equipmentId));
    if (!result) return;
    setActiveGearSetId(gearSetId);
    setActiveEquipmentId(equipmentId);
    setCollapsedGearSetIds((prev) => ({ ...prev, [gearSetId]: false }));
    setCollapsedEquipmentIds((prev) => ({ ...prev, [`${gearSetId}:${equipmentId}`]: false }));
    selectEditingRow(result.selectedRowKey);
  }, [commitEditingTransaction, selectEditingRow]);

  const handleCreateNew = useCallback(() => {
    if (selectedRow?.kind === 'threePieceBuffHeader' || selectedRow?.kind === 'threePieceBuff') {
      createThreePieceEffectInSet(selectedRow.gearSetId);
    } else if (selectedRow?.kind === 'set') {
      createEquipmentInSet(selectedRow.gearSetId);
    } else if (selectedRow?.kind === 'equipment' || selectedRow?.kind === 'fixedStat' || selectedRow?.kind === 'effect' || selectedRow?.kind === 'effectLevels') {
      createEffectInEquipment(selectedRow.gearSetId, selectedRow.equipmentId);
    } else {
      createGearSet();
    }
  }, [createEffectInEquipment, createEquipmentInSet, createGearSet, createThreePieceEffectInSet, selectedRow]);

  const handleNormalize = useCallback(() => {
    commitEditingTransaction(normalizeEquipmentLibraryOrder);
    setMessage('已整理：套装按名称，装备按护甲/护手/配件，effect 按 effect1-3。');
  }, [commitEditingTransaction]);

  const openContextMenu = useCallback((event: ReactMouseEvent, state: EquipmentContextMenuState) => {
    event.preventDefault();
    setContextMenu(state);
  }, []);

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  const focusRow = useCallback((rowKey: string, options: { expandAncestors?: boolean; scroll?: boolean } = {}) => {
    const row = rows.find((candidate) => candidate.key === rowKey);
    if (row) {
      setActiveGearSetId(row.gearSetId);
      setActiveEquipmentId(
        row.kind === 'equipment' || row.kind === 'fixedStat' || row.kind === 'effect' || row.kind === 'effectLevels'
          ? row.equipmentId
          : null,
      );
    }
    if (options.expandAncestors && row) {
      setCollapsedGearSetIds((prev) => ({ ...prev, [row.gearSetId]: false }));
      if (row.kind === 'equipment' || row.kind === 'fixedStat' || row.kind === 'effect' || row.kind === 'effectLevels') {
        setCollapsedEquipmentIds((prev) => ({ ...prev, [`${row.gearSetId}:${row.equipmentId}`]: false }));
      }
      if (row.kind === 'effect' || row.kind === 'effectLevels') {
        setCollapsedEffectIds((prev) => ({ ...prev, [`${row.gearSetId}:${row.equipmentId}:${row.effectId}`]: false }));
      }
    }
    setSelectedRowKey(rowKey);
    setSelectedCell(null);
    if (options.scroll) {
      window.requestAnimationFrame(() => {
        tableScrollRef.current
          ?.querySelector<HTMLElement>(`[data-equipment-row-key="${CSS.escape(rowKey)}"]`)
          ?.scrollIntoView({ block: 'nearest' });
      });
    }
  }, [rows]);

  const toggleRowCollapsed = useCallback((row: EquipmentRow) => {
    if (row.kind === 'set') {
      setCollapsedGearSetIds((prev) => ({ ...prev, [row.gearSetId]: prev[row.gearSetId] === false }));
    } else if (row.kind === 'equipment') {
      const key = `${row.gearSetId}:${row.equipmentId}`;
      setCollapsedEquipmentIds((prev) => ({ ...prev, [key]: prev[key] === false }));
    } else if (row.kind === 'threePieceBuffHeader') {
      setCollapsedThreePieceBuffIds((prev) => ({ ...prev, [row.gearSetId]: prev[row.gearSetId] !== true }));
    } else if (row.kind === 'effect') {
      const key = `${row.gearSetId}:${row.equipmentId}:${row.effectId}`;
      setCollapsedEffectIds((prev) => ({ ...prev, [key]: prev[key] === false }));
    }
  }, []);

  const isRowCollapsed = useCallback((row: EquipmentRow) => {
    if (row.kind === 'set') {
      return collapsedGearSetIds[row.gearSetId] !== false;
    }
    if (row.kind === 'equipment') {
      return collapsedEquipmentIds[`${row.gearSetId}:${row.equipmentId}`] !== false;
    }
    if (row.kind === 'threePieceBuffHeader') {
      return collapsedThreePieceBuffIds[row.gearSetId] === true;
    }
    if (row.kind === 'effect') {
      return collapsedEffectIds[`${row.gearSetId}:${row.equipmentId}:${row.effectId}`] !== false;
    }
    return false;
  }, [collapsedEffectIds, collapsedEquipmentIds, collapsedGearSetIds, collapsedThreePieceBuffIds]);

  const collapseAll = useCallback(() => {
    setCollapsedGearSetIds({});
    setCollapsedEquipmentIds({});
    setCollapsedEffectIds({});
    setCollapsedThreePieceBuffIds({});
  }, []);

  const expandAll = useCallback(() => {
    const nextGearSets: Record<string, boolean> = {};
    const nextEquipments: Record<string, boolean> = {};
    const nextEffects: Record<string, boolean> = {};
    const nextThreePieceBuffs: Record<string, boolean> = {};
    getGearSets(library).forEach((gearSet) => {
      nextGearSets[gearSet.gearSetId] = false;
      if (Object.keys(gearSet.threePieceBuffs || {}).length > 0) {
        nextThreePieceBuffs[gearSet.gearSetId] = false;
      }
      getEquipments(gearSet).forEach((equipment) => {
        nextEquipments[`${gearSet.gearSetId}:${equipment.equipmentId}`] = false;
        getEffectEntries(equipment).forEach(([effectId]) => {
          nextEffects[`${gearSet.gearSetId}:${equipment.equipmentId}:${effectId}`] = false;
        });
      });
    });
    setCollapsedGearSetIds(nextGearSets);
    setCollapsedEquipmentIds(nextEquipments);
    setCollapsedEffectIds(nextEffects);
    setCollapsedThreePieceBuffIds(nextThreePieceBuffs);
  }, [library]);

  const expandCurrentEquipment = useCallback((gearSetId: string, equipmentId: string) => {
    const equipment = library.gearSets[gearSetId]?.equipments[equipmentId];
    if (!equipment) return;
    setActiveGearSetId(gearSetId);
    setActiveEquipmentId(equipmentId);
    setCollapsedGearSetIds((prev) => ({ ...prev, [gearSetId]: false }));
    setCollapsedEquipmentIds((prev) => ({ ...prev, [`${gearSetId}:${equipmentId}`]: false }));
    setCollapsedEffectIds((prev) => {
      const next = { ...prev };
      getEffectEntries(equipment).forEach(([effectId]) => {
        next[`${gearSetId}:${equipmentId}:${effectId}`] = false;
      });
      return next;
    });
  }, [library.gearSets]);

  const addFixedStat = useCallback((gearSetId: string, equipmentId: string) => {
    commitEditingTransaction((current) => addEquipmentFixedStat(current, gearSetId, equipmentId));
  }, [commitEditingTransaction]);

  const deleteNode = useCallback((state: EquipmentContextMenuState) => {
    let transaction: ((current: EquipmentLibrary) => EquipmentEditingResult) | null = null;
    if (state.target === 'set' && state.gearSetId) {
      transaction = (current) => deleteEquipmentNode(current, { kind: 'set', gearSetId: state.gearSetId! });
    } else if (state.target === 'equipment' && state.gearSetId && state.equipmentId) {
      transaction = (current) => deleteEquipmentNode(current, {
        kind: 'equipment',
        gearSetId: state.gearSetId!,
        equipmentId: state.equipmentId!,
      });
    } else if (state.target === 'fixedStat' && state.gearSetId && state.equipmentId) {
      transaction = (current) => deleteEquipmentNode(current, {
        kind: 'fixedStat',
        gearSetId: state.gearSetId!,
        equipmentId: state.equipmentId!,
      });
    } else if (state.target === 'effect' && state.gearSetId && state.equipmentId && state.effectId) {
      transaction = (current) => deleteEquipmentNode(current, {
        kind: 'effect',
        gearSetId: state.gearSetId!,
        equipmentId: state.equipmentId!,
        effectId: state.effectId as EquipmentEffectId,
      });
    } else if (state.target === 'threePieceBuff' && state.gearSetId && state.effectId) {
      transaction = (current) => deleteEquipmentNode(current, {
        kind: 'threePieceBuff',
        gearSetId: state.gearSetId!,
        effectId: state.effectId!,
      });
    }
    if (transaction) {
      const result = commitEditingTransaction(transaction);
      if (result) selectEditingRow(result.selectedRowKey);
    }
    closeContextMenu();
  }, [closeContextMenu, commitEditingTransaction, selectEditingRow]);

  const duplicateEquipment = useCallback((gearSetId: string, equipmentId: string) => {
    const result = commitEditingTransaction((current) => duplicateEquipmentItem(current, gearSetId, equipmentId));
    if (!result || !result.equipmentId) return;
    setActiveGearSetId(gearSetId);
    setActiveEquipmentId(result.equipmentId);
    setCollapsedGearSetIds((prev) => ({ ...prev, [gearSetId]: false }));
    selectEditingRow(result.selectedRowKey);
  }, [commitEditingTransaction, selectEditingRow]);

  const duplicateEffect = useCallback((gearSetId: string, equipmentId: string, effectId: EquipmentEffectId) => {
    const result = commitEditingTransaction((current) => duplicateEquipmentEffect(current, gearSetId, equipmentId, effectId));
    if (!result) return;
    setActiveGearSetId(gearSetId);
    setActiveEquipmentId(equipmentId);
    setCollapsedGearSetIds((prev) => ({ ...prev, [gearSetId]: false }));
    setCollapsedEquipmentIds((prev) => ({ ...prev, [`${gearSetId}:${equipmentId}`]: false }));
    selectEditingRow(result.selectedRowKey);
  }, [commitEditingTransaction, selectEditingRow]);

  const copyJsonToClipboard = useCallback(async (value: unknown) => {
    const text = JSON.stringify(value, null, 2);
    await navigator.clipboard?.writeText(text);
    setMessage('已复制 JSON 到剪贴板。');
  }, []);

  const applyEffectValueMapping = useCallback((gearSetId: string, equipmentId: string, effectId: EquipmentEffectId) => {
    const result = commitEditingTransaction((current) => applyEquipmentEffectValueMapping(current, gearSetId, equipmentId, effectId));
    if (!result) {
      setMessage('当前词条没有可用的数值映射。');
      return;
    }
    setMessage('已按数值映射填充 Lv0–Lv3。');
  }, [commitEditingTransaction]);

  const buildContextMenuActions = useCallback((state: EquipmentContextMenuState): EquipmentContextMenuAction[] => {
    const actions: EquipmentContextMenuAction[] = [];
    if (state.target === 'blank') {
      actions.push(
        { key: 'new-set', label: '新增套装', icon: 'new', onClick: createGearSet },
        { key: 'collapse-all', label: '全部折叠', icon: 'collapse', onClick: collapseAll },
        { key: 'expand-all', label: '全部展开', icon: 'expand', onClick: expandAll },
      );
    }
    if (state.target === 'set' && state.gearSetId) {
      const gearSet = library.gearSets[state.gearSetId];
      actions.push(
        { key: 'new-equipment', label: '新增装备', icon: 'new', onClick: () => createEquipmentInSet(state.gearSetId!) },
        {
          key: 'toggle-set',
          label: collapsedGearSetIds[state.gearSetId] === false ? '折叠套装' : '展开套装',
          icon: collapsedGearSetIds[state.gearSetId] === false ? 'collapse' : 'expand',
          onClick: () => setCollapsedGearSetIds((prev) => ({ ...prev, [state.gearSetId!]: prev[state.gearSetId!] === false })),
        },
        { key: 'export-set', label: '导出当前套装', icon: 'open', onClick: () => gearSet && downloadJson(`${gearSet.gearSetId}.json`, JSON.stringify(buildDraftLibraryShareFile(EQUIPMENT_LIBRARY_SHARE_TYPE, { [gearSet.gearSetId]: gearSet }, gearSet.name), null, 2)) },
        { key: 'delete-set', label: '删除套装', icon: 'delete', onClick: () => deleteNode(state) },
      );
    }
    if (state.target === 'threePieceBuffHeader' && state.gearSetId) {
      const gearSet = library.gearSets[state.gearSetId];
      const hasEffects = Object.keys(gearSet?.threePieceBuffs || {}).length > 0;
      const isCollapsed = collapsedThreePieceBuffIds[state.gearSetId] === true;
      actions.push(
        { key: 'new-three-piece-effect', label: '添加 effect', icon: 'new', onClick: () => createThreePieceEffectInSet(state.gearSetId!) },
        ...(hasEffects
          ? [{ key: 'toggle-three-piece-effect', label: isCollapsed ? '展开 effect' : '折叠 effect', icon: isCollapsed ? 'expand' as const : 'collapse' as const, onClick: () => setCollapsedThreePieceBuffIds((prev) => ({ ...prev, [state.gearSetId!]: !isCollapsed })) }]
          : []),
      );
    }
    if (state.target === 'threePieceBuff' && state.gearSetId && state.effectId) {
      actions.push(
        { key: 'edit-three-piece-effect', label: '编辑 Buff', icon: 'open', onClick: () => openEquipmentBuffDrawer(state.gearSetId!, state.effectId!) },
        { key: 'copy-three-piece-effect', label: '复制 effect', icon: 'new', onClick: () => duplicateThreePieceEffect(state.gearSetId!, state.effectId!) },
        { key: 'delete-three-piece-effect', label: '删除 effect', icon: 'delete', onClick: () => deleteNode(state) },
      );
    }
    if (state.target === 'equipment' && state.gearSetId && state.equipmentId) {
      const equipment = library.gearSets[state.gearSetId]?.equipments[state.equipmentId];
      if (equipment && !equipment.fixedStat) {
        actions.push({ key: 'add-fixed', label: '新增固定数值', icon: 'new', onClick: () => addFixedStat(state.gearSetId!, state.equipmentId!) });
      }
      if (equipment && getEffectEntries(equipment).length < 3) {
        actions.push({ key: 'add-effect', label: '新增 effect', icon: 'new', onClick: () => createEffectInEquipment(state.gearSetId!, state.equipmentId!) });
      }
      const isCollapsed = collapsedEquipmentIds[`${state.gearSetId}:${state.equipmentId}`] !== false;
      actions.push(
        { key: 'expand-current-equipment', label: '全部展开当前装备', icon: 'expand', onClick: () => expandCurrentEquipment(state.gearSetId!, state.equipmentId!) },
        { key: 'toggle-equipment', label: isCollapsed ? '展开装备' : '折叠装备', icon: isCollapsed ? 'expand' : 'collapse', onClick: () => setCollapsedEquipmentIds((prev) => ({ ...prev, [`${state.gearSetId}:${state.equipmentId}`]: !isCollapsed })) },
        { key: 'copy-equipment', label: '复制装备', icon: 'new', onClick: () => duplicateEquipment(state.gearSetId!, state.equipmentId!) },
        { key: 'delete-equipment', label: '删除装备', icon: 'delete', onClick: () => deleteNode(state) },
      );
    }
    if (state.target === 'fixedStat' && state.gearSetId && state.equipmentId) {
      const fixedStat = library.gearSets[state.gearSetId]?.equipments[state.equipmentId]?.fixedStat;
      actions.push(
        { key: 'expand-current-equipment', label: '全部展开当前装备', icon: 'expand', onClick: () => expandCurrentEquipment(state.gearSetId!, state.equipmentId!) },
        { key: 'copy-fixed-json', label: '复制 fixedStat JSON', icon: 'open', onClick: () => copyJsonToClipboard(fixedStat ?? {}) },
        { key: 'delete-fixed', label: '删除 fixedStat', icon: 'delete', onClick: () => deleteNode(state) },
      );
    }
    if ((state.target === 'effect' || state.target === 'effectLevels') && state.gearSetId && state.equipmentId && state.effectId) {
      const effectId = state.effectId as EquipmentEffectId;
      const effect = library.gearSets[state.gearSetId]?.equipments[state.equipmentId]?.effects[effectId];
      const effectCollapseKey = `${state.gearSetId}:${state.equipmentId}:${state.effectId}`;
      const isCollapsed = collapsedEffectIds[effectCollapseKey] !== false;
      actions.push(
        { key: 'expand-current-equipment', label: '全部展开当前装备', icon: 'expand', onClick: () => expandCurrentEquipment(state.gearSetId!, state.equipmentId!) },
        { key: 'toggle-effect', label: isCollapsed ? '展开等级' : '折叠等级', icon: isCollapsed ? 'expand' : 'collapse', onClick: () => setCollapsedEffectIds((prev) => ({ ...prev, [effectCollapseKey]: !isCollapsed })) },
        { key: 'apply-effect-value-mapping', label: '数值映射', icon: 'open', onClick: () => applyEffectValueMapping(state.gearSetId!, state.equipmentId!, effectId) },
        { key: 'copy-effect', label: '复制 effect', icon: 'new', onClick: () => duplicateEffect(state.gearSetId!, state.equipmentId!, effectId) },
        { key: 'copy-level-json', label: '复制等级 JSON', icon: 'open', onClick: () => copyJsonToClipboard(effect?.levels ?? {}) },
        { key: 'delete-effect', label: '删除 effect', icon: 'delete', onClick: () => deleteNode({ ...state, target: 'effect' }) },
      );
    }
    return actions;
  }, [addFixedStat, applyEffectValueMapping, collapsedEffectIds, collapsedEquipmentIds, collapsedGearSetIds, collapsedThreePieceBuffIds, collapseAll, copyJsonToClipboard, createEffectInEquipment, createEquipmentInSet, createGearSet, createThreePieceEffectInSet, deleteNode, duplicateEffect, duplicateEquipment, duplicateThreePieceEffect, expandAll, expandCurrentEquipment, handleCreateNew, library.gearSets, openEquipmentBuffDrawer]);

  const updateCellValue = useCallback((row: EquipmentRow, columnKey: EquipmentSheetColumn['key'], rawValue: string) => {
    mutateLibrary((prev) => applyCellValueToLibrary(prev, row, columnKey, rawValue));
  }, [mutateLibrary]);

  const selectedWorkbookRow = useMemo(
    () => workbookRows.find((row) => row.sourceRow.key === selectedCell?.sourceRowKey) ?? null,
    [selectedCell?.sourceRowKey, workbookRows],
  );
  const selectedWorkbookCell = useMemo(
    () => selectedWorkbookRow?.cells.find((cell) => cell.columnKey === selectedCell?.columnKey) ?? null,
    [selectedCell?.columnKey, selectedWorkbookRow],
  );
  const formulaBinding = useMemo<EquipmentFormulaBinding | null>(() => buildEquipmentFormulaBinding(
    library,
    selectedCell && selectedWorkbookCell
      ? { ...selectedCell, value: selectedWorkbookCell.value }
      : null,
    selectedWorkbookRow?.sourceRow,
  ), [library, selectedCell, selectedWorkbookCell, selectedWorkbookRow]);

  const hasUnsavedChanges = isDirty
    || Boolean(formulaBinding && !formulaBinding.readOnly && formulaInput !== formulaBinding.value);

  const applyFormulaValue = useCallback((rawValue: string) => {
    if (!formulaBinding || formulaBinding.readOnly) return false;
    mutateLibrary((current) => formulaBinding.apply(current, rawValue));
    return true;
  }, [formulaBinding, mutateLibrary]);

  const handleSelectEquipmentImage = useCallback((displayUrl: string) => {
    if (!formulaBinding || formulaBinding.control !== 'image-search-select') return;
    applyFormulaValue(displayUrl);
    setFormulaInput(displayUrl);
    setEquipmentImageQuery(displayUrl);
    setIsEquipmentImageDrawerOpen(false);
  }, [applyFormulaValue, formulaBinding]);

  const handleClearEquipmentImage = useCallback(() => {
    if (!formulaBinding || formulaBinding.control !== 'image-search-select') return;
    applyFormulaValue('');
    setFormulaInput('');
    setEquipmentImageQuery('');
    setIsEquipmentImageDrawerOpen(false);
  }, [applyFormulaValue, formulaBinding]);

  useEffect(() => {
    setFormulaInput(formulaBinding?.value ?? '');
    if (formulaBinding?.control !== 'search-select') {
      setBuffTypeQuery('');
    }
    setEquipmentImageQuery(formulaBinding?.control === 'image-search-select' ? (formulaBinding.value ?? '') : '');
    setIsEquipmentImageDrawerOpen(false);
  }, [formulaBinding?.key, formulaBinding?.value, formulaBinding?.control]);

  useEffect(() => {
    if (!isEquipmentImageDrawerOpen) {
      return undefined;
    }
    const handlePointerDown = (event: PointerEvent) => {
      if (equipmentImageFormulaRef.current?.contains(event.target as Node)) {
        return;
      }
      setIsEquipmentImageDrawerOpen(false);
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsEquipmentImageDrawerOpen(false);
      }
    };
    window.addEventListener('pointerdown', handlePointerDown, true);
    window.addEventListener('keydown', handleEscape, true);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown, true);
      window.removeEventListener('keydown', handleEscape, true);
    };
  }, [isEquipmentImageDrawerOpen]);

  useEffect(() => {
    setEquipmentImageLoadFailed(false);
  }, [previewImageMeta.imgUrl]);

  const buildLibraryWithCommittedFormulaInput = useCallback((baseLibrary: EquipmentLibrary) => {
    if (!formulaBinding || formulaBinding.readOnly || formulaInput === formulaBinding.value) {
      return baseLibrary;
    }
    return formulaBinding.apply(baseLibrary, formulaInput);
  }, [formulaBinding, formulaInput]);

  const commitFormulaInput = useCallback(() => {
    if (!formulaBinding || formulaBinding.readOnly) {
      return;
    }
    applyFormulaValue(formulaInput);
  }, [applyFormulaValue, formulaBinding, formulaInput]);

  const performSave = useCallback(async () => {
    const committedLibrary = buildLibraryWithCommittedFormulaInput(libraryRef.current);
    const emptyBuffSets = getGearSets(committedLibrary).filter((gearSet) => !gearSet.buffId?.trim()).length;
    const nextLibrary = { ...committedLibrary, updatedAt: new Date().toISOString() };
    const warning = emptyBuffSets > 0 ? ` ${emptyBuffSets} 个套装 buffId 为空，请后续补齐。` : '';
    writeLocalStorageJson(EQUIPMENT_LIBRARY_STORAGE_KEY, nextLibrary);
    writeLocalStorageJson(EQUIPMENT_DRAFT_STORAGE_KEY, nextLibrary);
    replaceLibrary(nextLibrary);
    setIsDirty(false);
    setIsSaveConfirmModalOpen(false);
    setMessage(`已保存到浏览器 SQLite 装备库。${warning}`);
  }, [buildLibraryWithCommittedFormulaInput, replaceLibrary]);

  const handleSave = useCallback(() => {
    if (isOverwriteProtectionEnabled) {
      setIsSaveConfirmModalOpen(true);
      return;
    }
    void performSave();
  }, [isOverwriteProtectionEnabled, performSave]);

  const handleConfirmSave = useCallback(() => {
    setIsSaveConfirmModalOpen(false);
    void performSave();
  }, [performSave]);

  const clearSelectedCell = useCallback(() => {
    if (!selectedWorkbookRow || !selectedCell) {
      return;
    }
    const row = selectedWorkbookRow.sourceRow;
    const columnKey = selectedCell.columnKey;
    if (columnKey === 'idText' || (row.kind === 'equipment' && columnKey === 'field')) {
      return;
    }
    if (row.kind === 'effectLevels') {
      const levelKey = selectedCell.address.replace(/^Lv/, '') as EquipmentLevelKey;
      if (LEVEL_KEYS.includes(levelKey)) {
        updateCellValue(row, columnKey, `${levelKey}:`);
      }
      return;
    }
    const editable =
      (row.kind === 'set' && ['name', 'effectKey', 'description'].includes(columnKey))
      || (row.kind === 'threePieceBuffHeader' && false)
      || (row.kind === 'threePieceBuff' && ['name', 'field', 'effectKey', 'valueText', 'description'].includes(columnKey))
      || (row.kind === 'equipment' && ['name', 'description'].includes(columnKey))
      || (row.kind === 'fixedStat' && ['name', 'effectKey', 'description'].includes(columnKey))
      || (row.kind === 'effect' && ['name', 'effectKey'].includes(columnKey));
    if (editable) {
      updateCellValue(row, columnKey, '');
    }
  }, [selectedCell, selectedWorkbookRow, updateCellValue]);

  useEffect(() => {
    const handleSaveShortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        handleSave();
      }
    };
    window.addEventListener('keydown', handleSaveShortcut);
    return () => window.removeEventListener('keydown', handleSaveShortcut);
  }, [handleSave]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) {
        return;
      }
      if (!selectedCell) {
        return;
      }
      const currentRowIndex = workbookRows.findIndex((row) => row.sourceRow.key === selectedCell.sourceRowKey);
      const currentColumnIndex = COLUMNS.findIndex((column) => column.key === selectedCell.columnKey);
      if (currentRowIndex < 0 || currentColumnIndex < 0) {
        return;
      }
      const selectByIndex = (rowIndex: number, columnIndex: number) => {
        const nextRow = workbookRows[Math.max(0, Math.min(workbookRows.length - 1, rowIndex))];
        const nextColumn = COLUMNS[Math.max(0, Math.min(COLUMNS.length - 1, columnIndex))];
        if (!nextRow || !nextColumn) return;
        setSelectedRowKey(nextRow.sourceRow.key);
        setSelectedCell({
          address: `${columnIndexToLabel(COLUMNS.indexOf(nextColumn))}${nextRow.rowNumber}`,
          sourceRowKey: nextRow.sourceRow.key,
          columnKey: nextColumn.key,
        });
      };
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        selectByIndex(currentRowIndex - 1, currentColumnIndex);
      } else if (event.key === 'ArrowDown') {
        event.preventDefault();
        selectByIndex(currentRowIndex + 1, currentColumnIndex);
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        selectByIndex(currentRowIndex, currentColumnIndex - 1);
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        selectByIndex(currentRowIndex, currentColumnIndex + 1);
      } else if (event.key === 'Tab') {
        event.preventDefault();
        const direction = event.shiftKey ? -1 : 1;
        let nextRowIndex = currentRowIndex;
        let nextColumnIndex = currentColumnIndex + direction;
        if (nextColumnIndex >= COLUMNS.length) {
          nextColumnIndex = 0;
          nextRowIndex += 1;
        }
        if (nextColumnIndex < 0) {
          nextColumnIndex = COLUMNS.length - 1;
          nextRowIndex -= 1;
        }
        selectByIndex(nextRowIndex, nextColumnIndex);
      } else if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        clearSelectedCell();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [clearSelectedCell, selectedCell, workbookRows]);

  const openShareModal = useCallback((mode: 'export' | 'import') => {
    setShareModalMode(mode);
    setIsShareModalOpen(true);
    setShareImportError('');
    if (mode === 'import') {
      setPendingImportShare(null);
    }
  }, []);

  const closeShareModal = useCallback(() => {
    setIsShareModalOpen(false);
    setShareImportError('');
    setPendingImportShare(null);
  }, []);

  const handleCopyShareJson = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(currentShareText);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = currentShareText;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    }
  }, [currentShareText]);

  const prepareImportShare = useCallback((rawText: string) => {
    const parsed = parseDraftLibraryShareFile(rawText, EQUIPMENT_LIBRARY_SHARE_TYPE);
    if (!parsed) {
      setPendingImportShare(null);
      setShareImportError('导入失败：文件不是有效的装备库分享 JSON。');
      return;
    }
    const normalizedPayload = normalizeEquipmentLibrary({
      gearSets: parsed.payload,
    }).gearSets;
    if (Object.keys(normalizedPayload).length === 0) {
      setPendingImportShare(null);
      setShareImportError('JSON 中没有可导入的有效套装。');
      return;
    }
    setShareImportError('');
    setPendingImportShare({
      ...parsed,
      payload: normalizedPayload,
    } as DraftLibraryShareFile<EquipmentGearSet>);
  }, []);

  const handleExportLocalLibrary = useCallback(() => {
    downloadJson(buildDraftLibraryShareFileName(currentShareFile.label, currentShareFile.exportedAt), currentShareText);
  }, [currentShareFile.exportedAt, currentShareFile.label, currentShareText]);

  const handleOpenShareImportPicker = useCallback(() => {
    shareImportInputRef.current?.click();
  }, []);

  const handleParseImportText = useCallback(() => {
    prepareImportShare(shareImportText);
  }, [prepareImportShare, shareImportText]);

  const handleCancelImportShare = useCallback(() => {
    setPendingImportShare(null);
    setShareImportError('');
  }, []);

  const handleShareFileSelected = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const text = await file.text();
    setShareImportText(text);
    prepareImportShare(text);
  }, [prepareImportShare]);

  const handleConfirmImportShare = useCallback(() => {
    if (!pendingImportShare) return;
    mutateLibrary((prev) => normalizeEquipmentLibrary({
      ...prev,
      gearSets: {
        ...prev.gearSets,
        ...pendingImportShare.payload,
      },
    }));
    setMessage(`已导入 ${Object.keys(pendingImportShare.payload).length} 个套装。`);
    closeShareModal();
  }, [closeShareModal, mutateLibrary, pendingImportShare]);

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
          onChange={(event) => applyFormulaValue(event.target.value)}
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
            onChange={(event) => applyFormulaValue(event.target.value)}
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
