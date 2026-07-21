import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import {
  buildDraftLibraryShareFile,
  buildDraftLibraryShareFileName,
  parseDraftLibraryShareFile,
  type DraftLibraryShareFile,
} from '../utils/draftShare';
import { imageBridge } from '../utils/imageBridge';
import type { ImageAssetEntry } from './ImageManager/types';
import './BuffDraftPage.css';
import './OperatorDraftPage.css';
import './DamageSheetPage.css';
import './EquipmentSheetPage.css';

import * as equipmentSheetPageModel from './equipmentSheetPageModel';
type EquipmentEffectId = equipmentSheetPageModel.EquipmentEffectId;
type EquipmentLevelKey = equipmentSheetPageModel.EquipmentLevelKey;
type EquipmentGearSet = equipmentSheetPageModel.EquipmentGearSet;
type EquipmentLibrary = equipmentSheetPageModel.EquipmentLibrary;
type EquipmentRow = equipmentSheetPageModel.EquipmentRow;
type EquipmentSheetColumn = equipmentSheetPageModel.EquipmentSheetColumn;
type EquipmentWorkbookCell = equipmentSheetPageModel.EquipmentWorkbookCell;
type EquipmentWorkbookRow = equipmentSheetPageModel.EquipmentWorkbookRow;
type EquipmentSelection = equipmentSheetPageModel.EquipmentSelection;
type EquipmentFormulaBinding = equipmentSheetPageModel.EquipmentFormulaBinding;
type EquipmentImageOption = equipmentSheetPageModel.EquipmentImageOption;
type EquipmentContextMenuState = equipmentSheetPageModel.EquipmentContextMenuState;
type EquipmentContextMenuAction = equipmentSheetPageModel.EquipmentContextMenuAction;

const {
  EQUIPMENT_DRAFT_STORAGE_KEY,
  EQUIPMENT_LIBRARY_STORAGE_KEY,
  EQUIPMENT_LIBRARY_SHARE_TYPE,
  EQUIPMENT_PARTS,
  EFFECT_IDS,
  LEVEL_KEYS,
  COLUMNS,
  BUFF_TYPE_OPTIONS,
  BUFF_TYPE_LABELS,
  EMPTY_LIBRARY,
  writeLocalStorageJson,
  buildEquipmentImageOption,
  stopEditingKeyPropagation,
  EQUIPMENT_BUFF_BUSINESS_TYPE_OPTIONS,
  getEquipmentBuffBusinessType,
  DEFAULT_FIXED_STAT_BY_PART,
  getEquipmentEffectShape,
  getEquipmentEffectValuePreset,
  getEquipmentEffectTypeOptions,
  applyEffectValueCatalogForPart,
  normalizeEquipmentLibrary,
  readCachedEquipmentLibrary,
  readEquipmentLibraryFromFile,
  writeEquipmentLibraryToFile,
  createEmptyLibrary,
  getGearSets,
  getEquipments,
  getSortedEquipments,
  getEffectEntries,
  applyCellValueToLibrary,
  buildRows,
  filterVisibleRows,
  columnIndexToLabel,
  buildWorkbookRows,
  downloadJson,
  makeNextId,
  updateLibrarySet,
  updateLibraryEquipment,
} = equipmentSheetPageModel;

export function useEquipmentSheetPageController() {
  const [library, setLibrary] = useState<EquipmentLibrary>(() => normalizeEquipmentLibrary(EMPTY_LIBRARY));
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

  useEffect(() => {
    let cancelled = false;
    readEquipmentLibraryFromFile()
      .then((fileLibrary) => {
        if (cancelled) return;
        const cached = readCachedEquipmentLibrary();
        const hasCachedData = Object.keys(cached.gearSets).length > 0;
        const shouldUseCached = !window.desktopRuntime?.readEquipmentLibrary && hasCachedData;
        const nextLibrary = shouldUseCached ? cached : fileLibrary;
        setLibrary(nextLibrary);
        setIsDirty(false);
        if (shouldUseCached) {
          setMessage('已从 localStorage 加载浏览器保存的装备库。');
          return;
        }
        setMessage(fileLibrary.migration?.reviewRequired ? '装备库已加载。迁移数据需要人工复核 typeKey 映射。' : '装备库已加载。');
      })
      .catch((error) => {
        if (cancelled) return;
        const cached = readCachedEquipmentLibrary();
        if (Object.keys(cached.gearSets).length > 0) {
          setLibrary(cached);
          setIsDirty(false);
          setMessage(`读取本地 JSON 失败，已使用 localStorage：${error instanceof Error ? error.message : String(error)}`);
        } else {
          setLibrary(createEmptyLibrary());
          setMessage(`读取装备库失败，已创建空库：${error instanceof Error ? error.message : String(error)}`);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setImageAssetsLoading(true);
    setImageAssetsError('');
    imageBridge.listAssets()
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
    setLibrary((prev) => {
      const next = { ...updater(prev), updatedAt: new Date().toISOString() };
      setIsDirty(true);
      return next;
    });
  }, []);

  const openEquipmentBuffDrawer = useCallback((gearSetId: string, effectId: string) => {
    setBuffDrawerTarget({ gearSetId, effectId });
  }, []);

  const createThreePieceEffectInSet = useCallback((gearSetId: string) => {
    let nextEffectId = 'effect1';
    mutateLibrary((prev) => updateLibrarySet(prev, gearSetId, (gearSet) => {
      const current = gearSet.threePieceBuffs || {};
      let index = 1;
      while (current[`effect${index}`]) {
        index += 1;
      }
      nextEffectId = `effect${index}`;
      return {
        ...gearSet,
        threePieceBuffs: {
          ...current,
          [nextEffectId]: {
            effectId: nextEffectId,
            name: '新建效果',
            category: '',
            typeKey: '',
            value: 0,
            unit: 'percent',
            raw: '',
          },
        },
      };
    }));
    setActiveGearSetId(gearSetId);
    setActiveEquipmentId(null);
    setCollapsedGearSetIds((prev) => ({ ...prev, [gearSetId]: false }));
    setCollapsedThreePieceBuffIds((prev) => ({ ...prev, [gearSetId]: false }));
    setSelectedRowKey(`three-piece-buff-${gearSetId}-${nextEffectId}`);
    setBuffDrawerTarget({ gearSetId, effectId: nextEffectId });
  }, [mutateLibrary]);

  const duplicateThreePieceEffect = useCallback((gearSetId: string, effectId: string) => {
    let nextEffectId = 'effect1';
    mutateLibrary((prev) => updateLibrarySet(prev, gearSetId, (gearSet) => {
      const source = gearSet.threePieceBuffs?.[effectId];
      if (!source) return gearSet;
      const current = gearSet.threePieceBuffs || {};
      let index = 1;
      while (current[`effect${index}`]) {
        index += 1;
      }
      nextEffectId = `effect${index}`;
      return {
        ...gearSet,
        threePieceBuffs: {
          ...current,
          [nextEffectId]: {
            ...JSON.parse(JSON.stringify(source)),
            effectId: nextEffectId,
            name: `${source.name} 副本`,
          },
        },
      };
    }));
    setActiveGearSetId(gearSetId);
    setActiveEquipmentId(null);
    setCollapsedGearSetIds((prev) => ({ ...prev, [gearSetId]: false }));
    setCollapsedThreePieceBuffIds((prev) => ({ ...prev, [gearSetId]: false }));
    setSelectedRowKey(`three-piece-buff-${gearSetId}-${nextEffectId}`);
    setBuffDrawerTarget({ gearSetId, effectId: nextEffectId });
  }, [mutateLibrary]);

  const handleCreateNew = useCallback(() => {
    if (selectedRow?.kind === 'threePieceBuffHeader' || selectedRow?.kind === 'threePieceBuff') {
      createThreePieceEffectInSet(selectedRow.gearSetId);
      return;
    }
    if (selectedRow?.kind === 'set') {
      const gearSet = library.gearSets[selectedRow.gearSetId];
      if (!gearSet) return;
      const equipmentId = makeNextId('equipment', Object.keys(gearSet.equipments));
      mutateLibrary((prev) => updateLibrarySet(prev, selectedRow.gearSetId, (target) => ({
        ...target,
        equipments: {
          ...target.equipments,
          [equipmentId]: {
            equipmentId,
            name: '新建装备',
            part: '护甲',
            imgUrl: '',
            fixedStat: DEFAULT_FIXED_STAT_BY_PART['护甲'],
            effects: {},
          },
        },
      })));
      setActiveGearSetId(selectedRow.gearSetId);
      setActiveEquipmentId(equipmentId);
      setCollapsedGearSetIds((prev) => ({ ...prev, [selectedRow.gearSetId]: false }));
      setSelectedRowKey(`equipment-${selectedRow.gearSetId}-${equipmentId}`);
      return;
    }
    if (selectedRow?.kind === 'equipment' || selectedRow?.kind === 'fixedStat' || selectedRow?.kind === 'effect' || selectedRow?.kind === 'effectLevels') {
      const gearSetId = selectedRow.gearSetId;
      const equipmentId = selectedRow.equipmentId;
      mutateLibrary((prev) => updateLibraryEquipment(prev, gearSetId, equipmentId, (equipment) => {
        const freeEffectId = EFFECT_IDS.find((effectId) => !equipment.effects[effectId]);
        if (!freeEffectId) return equipment;
        return {
          ...equipment,
          effects: {
            ...equipment.effects,
            [freeEffectId]: {
              effectId: freeEffectId,
              label: '新建增益',
              typeKey: '',
              category: 'buff',
              unit: 'flat',
              levels: {},
            },
          },
        };
      }));
      setActiveGearSetId(gearSetId);
      setActiveEquipmentId(equipmentId);
      setCollapsedGearSetIds((prev) => ({ ...prev, [gearSetId]: false }));
      setCollapsedEquipmentIds((prev) => ({ ...prev, [`${gearSetId}:${equipmentId}`]: false }));
      return;
    }
    const gearSetId = makeNextId('gear-set', Object.keys(library.gearSets));
    mutateLibrary((prev) => ({
      ...prev,
      gearSets: {
        ...prev.gearSets,
        [gearSetId]: {
          gearSetId,
          name: '新建套装',
          buffId: '',
          imgUrl: '',
          threePieceBuffs: {},
          equipments: {},
        },
      },
    }));
    setActiveGearSetId(gearSetId);
    setActiveEquipmentId(null);
    setSelectedRowKey(`set-${gearSetId}`);
  }, [createThreePieceEffectInSet, library.gearSets, mutateLibrary, selectedRow]);

  const createGearSet = useCallback(() => {
    const gearSetId = makeNextId('gear-set', Object.keys(library.gearSets));
    mutateLibrary((prev) => ({
      ...prev,
      gearSets: {
        ...prev.gearSets,
        [gearSetId]: {
          gearSetId,
          name: '新建套装',
          buffId: '',
          imgUrl: '',
          threePieceBuffs: {},
          equipments: {},
        },
      },
    }));
    setActiveGearSetId(gearSetId);
    setActiveEquipmentId(null);
    setSelectedRowKey(`set-${gearSetId}`);
  }, [library.gearSets, mutateLibrary]);

  const createEquipmentInSet = useCallback((gearSetId: string) => {
    const gearSet = library.gearSets[gearSetId];
    if (!gearSet) return;
    const equipmentId = makeNextId('equipment', Object.keys(gearSet.equipments));
    mutateLibrary((prev) => updateLibrarySet(prev, gearSetId, (target) => ({
      ...target,
      equipments: {
        ...target.equipments,
        [equipmentId]: {
          equipmentId,
          name: '新建装备',
          part: '护甲',
          imgUrl: '',
          fixedStat: DEFAULT_FIXED_STAT_BY_PART['护甲'],
          effects: {},
        },
      },
    })));
    setActiveGearSetId(gearSetId);
    setActiveEquipmentId(equipmentId);
    setCollapsedGearSetIds((prev) => ({ ...prev, [gearSetId]: false }));
    setSelectedRowKey(`equipment-${gearSetId}-${equipmentId}`);
  }, [library.gearSets, mutateLibrary]);

  const createEffectInEquipment = useCallback((gearSetId: string, equipmentId: string) => {
    let nextEffectId: EquipmentEffectId | null = null;
    mutateLibrary((prev) => updateLibraryEquipment(prev, gearSetId, equipmentId, (equipment) => {
      const freeEffectId = EFFECT_IDS.find((effectId) => !equipment.effects[effectId]);
      if (!freeEffectId) return equipment;
      nextEffectId = freeEffectId;
      return {
        ...equipment,
        effects: {
          ...equipment.effects,
          [freeEffectId]: {
            effectId: freeEffectId,
            label: '新建增益',
            typeKey: '',
            category: 'buff',
            unit: 'flat',
            levels: {},
          },
        },
      };
    }));
    setActiveGearSetId(gearSetId);
    setActiveEquipmentId(equipmentId);
    setCollapsedGearSetIds((prev) => ({ ...prev, [gearSetId]: false }));
    setCollapsedEquipmentIds((prev) => ({ ...prev, [`${gearSetId}:${equipmentId}`]: false }));
    if (nextEffectId) {
      setSelectedRowKey(`effect-${gearSetId}-${equipmentId}-${nextEffectId}`);
    }
  }, [mutateLibrary]);

  const handleNormalize = useCallback(() => {
    mutateLibrary((prev) => ({
      ...prev,
      gearSets: Object.fromEntries(
        getGearSets(prev)
          .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
          .map((gearSet) => [gearSet.gearSetId, {
            ...gearSet,
            equipments: Object.fromEntries(getSortedEquipments(gearSet).map((equipment) => [equipment.equipmentId, {
              ...equipment,
              effects: Object.fromEntries(getEffectEntries(equipment).map(([effectId, effect]) => [effectId, effect])),
            }])),
          }])
      ),
    }));
    setMessage('已整理：套装按名称，装备按护甲/护手/配件，effect 按 effect1-3。');
  }, [mutateLibrary]);

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
    mutateLibrary((prev) => updateLibraryEquipment(prev, gearSetId, equipmentId, (equipment) => equipment.fixedStat ? equipment : {
      ...equipment,
      fixedStat: DEFAULT_FIXED_STAT_BY_PART[equipment.part],
    }));
  }, [mutateLibrary]);

  const deleteNode = useCallback((state: EquipmentContextMenuState) => {
    if (state.target === 'set' && state.gearSetId) {
      mutateLibrary((prev) => {
        const nextGearSets = { ...prev.gearSets };
        delete nextGearSets[state.gearSetId!];
        return { ...prev, gearSets: nextGearSets };
      });
    }
    if (state.target === 'equipment' && state.gearSetId && state.equipmentId) {
      mutateLibrary((prev) => updateLibrarySet(prev, state.gearSetId!, (gearSet) => {
        const nextEquipments = { ...gearSet.equipments };
        delete nextEquipments[state.equipmentId!];
        return { ...gearSet, equipments: nextEquipments };
      }));
    }
    if (state.target === 'fixedStat' && state.gearSetId && state.equipmentId) {
      mutateLibrary((prev) => updateLibraryEquipment(prev, state.gearSetId!, state.equipmentId!, (equipment) => {
        const { fixedStat: _fixedStat, ...rest } = equipment;
        return rest;
      }));
    }
    if (state.target === 'effect' && state.gearSetId && state.equipmentId && state.effectId) {
      const effectId = state.effectId as EquipmentEffectId;
      mutateLibrary((prev) => updateLibraryEquipment(prev, state.gearSetId!, state.equipmentId!, (equipment) => {
        const nextEffects = { ...equipment.effects };
        delete nextEffects[effectId];
        return { ...equipment, effects: nextEffects };
      }));
    }
    if (state.target === 'threePieceBuff' && state.gearSetId) {
      const effectId = state.effectId!;
      mutateLibrary((prev) => updateLibrarySet(prev, state.gearSetId!, (gearSet) => {
        const nextThreePieceBuffs = { ...(gearSet.threePieceBuffs || {}) };
        delete nextThreePieceBuffs[effectId];
        return { ...gearSet, threePieceBuffs: nextThreePieceBuffs };
      }));
      setSelectedRowKey(`three-piece-buff-header-${state.gearSetId}`);
    }
    closeContextMenu();
  }, [closeContextMenu, mutateLibrary]);

  const duplicateEquipment = useCallback((gearSetId: string, equipmentId: string) => {
    mutateLibrary((prev) => updateLibrarySet(prev, gearSetId, (gearSet) => {
      const source = gearSet.equipments[equipmentId];
      if (!source) return gearSet;
      const nextId = makeNextId(`${equipmentId}-copy`, Object.keys(gearSet.equipments));
      return {
        ...gearSet,
        equipments: {
          ...gearSet.equipments,
          [nextId]: { ...JSON.parse(JSON.stringify(source)), equipmentId: nextId, name: `${source.name} 副本` },
        },
      };
    }));
  }, [mutateLibrary]);

  const duplicateEffect = useCallback((gearSetId: string, equipmentId: string, effectId: EquipmentEffectId) => {
    mutateLibrary((prev) => updateLibraryEquipment(prev, gearSetId, equipmentId, (equipment) => {
      const freeEffectId = EFFECT_IDS.find((candidate) => !equipment.effects[candidate]);
      const source = equipment.effects[effectId];
      if (!freeEffectId || !source) return equipment;
      return {
        ...equipment,
        effects: {
          ...equipment.effects,
          [freeEffectId]: { ...JSON.parse(JSON.stringify(source)), effectId: freeEffectId, label: `${source.label} 副本` },
        },
      };
    }));
  }, [mutateLibrary]);

  const copyJsonToClipboard = useCallback(async (value: unknown) => {
    const text = JSON.stringify(value, null, 2);
    await navigator.clipboard?.writeText(text);
    setMessage('已复制 JSON 到剪贴板。');
  }, []);

  const applyEffectValueMapping = useCallback((gearSetId: string, equipmentId: string, effectId: EquipmentEffectId) => {
    const equipment = library.gearSets[gearSetId]?.equipments[equipmentId];
    const effect = equipment?.effects[effectId];
    if (!equipment || !effect) return;
    const shape = getEquipmentEffectShape(equipment);
    if (!getEquipmentEffectValuePreset(equipment.part, effectId, effect.typeKey, shape)) {
      setMessage('当前词条没有可用的数值映射。');
      return;
    }
    mutateLibrary((prev) => updateLibraryEquipment(prev, gearSetId, equipmentId, (current) => {
      const currentEffect = current.effects[effectId];
      if (!currentEffect) return current;
      return {
        ...current,
        effects: {
          ...current.effects,
          [effectId]: applyEffectValueCatalogForPart(currentEffect, current.part, getEquipmentEffectShape(current)),
        },
      };
    }));
    setMessage('已按数值映射填充 Lv0–Lv3。');
  }, [library.gearSets, mutateLibrary]);

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
  const formulaBinding = useMemo<EquipmentFormulaBinding | null>(() => {
    if (!selectedWorkbookRow || !selectedWorkbookCell) {
      return null;
    }
    const row = selectedWorkbookRow.sourceRow;
    const columnKey = selectedWorkbookCell.columnKey;
    if (row.kind === 'effectLevels') {
      const levelKey = selectedCell?.address?.replace(/^Lv/, '') as EquipmentLevelKey;
      if (!LEVEL_KEYS.includes(levelKey)) {
        return null;
      }
      const effect = library.gearSets[row.gearSetId]?.equipments[row.equipmentId]?.effects[row.effectId];
      return {
        key: `${row.key}:${levelKey}`,
        value: effect?.levels[levelKey] == null ? '' : String(effect.levels[levelKey]),
        inputMode: 'number',
        placeholder: `Lv${levelKey}`,
        commit: (value) => updateCellValue(row, columnKey, `${levelKey}:${value}`),
      };
    }
    const editable =
      (row.kind === 'set' && ['name', 'effectKey', 'description'].includes(columnKey))
      || (row.kind === 'threePieceBuffHeader' && false)
      || (row.kind === 'threePieceBuff' && ['name', 'field', 'effectKey', 'valueText', 'description'].includes(columnKey))
      || (row.kind === 'equipment' && ['name', 'field', 'description'].includes(columnKey))
      || (row.kind === 'fixedStat' && ['name', 'effectKey', 'description'].includes(columnKey))
      || (row.kind === 'effect' && ['name', 'field', 'effectKey'].includes(columnKey));
    if (!editable) {
      return {
        key: `${row.key}:${columnKey}:readonly`,
        value: selectedWorkbookCell.value,
        inputMode: 'text',
        readOnly: true,
        commit: () => undefined,
      };
    }
    if ((row.kind === 'set' || row.kind === 'equipment') && columnKey === 'description') {
      const value = row.kind === 'set'
        ? library.gearSets[row.gearSetId]?.imgUrl ?? ''
        : library.gearSets[row.gearSetId]?.equipments[row.equipmentId]?.imgUrl ?? '';
      return {
        key: `${row.key}:imgUrl`,
        value,
        inputMode: 'text',
        control: 'image-search-select',
        placeholder: row.kind === 'set' ? '搜索套装配图' : '搜索装备配图',
        commit: (nextValue) => updateCellValue(row, columnKey, nextValue),
      };
    }
    if (row.kind === 'equipment' && columnKey === 'field') {
      return {
        key: `${row.key}:${columnKey}`,
        value: selectedWorkbookCell.value,
        inputMode: 'text',
        control: 'select',
        options: EQUIPMENT_PARTS.map((part) => ({ value: part, label: part })),
        commit: (value) => updateCellValue(row, columnKey, value),
      };
    }
    if (row.kind === 'threePieceBuff' && columnKey === 'field') {
      const selectedBuff = library.gearSets[row.gearSetId]?.threePieceBuffs?.[row.effectId];
      return {
        key: `${row.key}:${columnKey}`,
        value: getEquipmentBuffBusinessType(selectedBuff),
        inputMode: 'text',
        control: 'select',
        options: EQUIPMENT_BUFF_BUSINESS_TYPE_OPTIONS,
        commit: (value) => updateCellValue(row, columnKey, value),
      };
    }
    if (row.kind === 'fixedStat' && columnKey === 'effectKey') {
      return {
        key: `${row.key}:${columnKey}`,
        value: selectedWorkbookCell.value,
        inputMode: 'text',
        control: 'select',
        options: [
          { value: 'defense', label: '防御力 · defense' },
          { value: 'hp', label: '生命 · hp' },
          { value: 'flatAtk', label: '固定攻击力 · flatAtk' },
        ],
        commit: (value) => updateCellValue(row, columnKey, value),
      };
    }
    if (row.kind === 'effect' && columnKey === 'field') {
      return {
        key: `${row.key}:${columnKey}`,
        value: row.field === '能力值' ? 'ability' : 'buff',
        inputMode: 'text',
        control: 'select',
        options: [
          { value: 'ability', label: '能力值' },
          { value: 'buff', label: 'Buff类型' },
        ],
        commit: (value) => updateCellValue(row, columnKey, value),
      };
    }
    if ((row.kind === 'effect' || row.kind === 'threePieceBuff') && columnKey === 'effectKey') {
      if (row.kind === 'threePieceBuff' && library.gearSets[row.gearSetId]?.threePieceBuffs?.[row.effectId]?.effectKind === 'extraHit') {
        return {
          key: `${row.key}:${columnKey}:extra-hit-types`,
          value: selectedWorkbookCell.value,
          inputMode: 'text',
          readOnly: true,
          commit: () => undefined,
        };
      }
      const effectOptions = row.kind === 'effect'
        ? (() => {
            const equipment = library.gearSets[row.gearSetId]?.equipments[row.equipmentId];
            const effect = equipment?.effects[row.effectId];
            return equipment && effect
              ? getEquipmentEffectTypeOptions(equipment.part, row.effectId, effect.category, getEquipmentEffectShape(equipment)).map((typeKey) => ({
                  value: typeKey,
                  label: `${BUFF_TYPE_LABELS[typeKey] || typeKey} · ${typeKey}`,
                }))
              : BUFF_TYPE_OPTIONS.map((typeKey) => ({ value: typeKey, label: `${BUFF_TYPE_LABELS[typeKey] || typeKey} · ${typeKey}` }));
          })()
        : BUFF_TYPE_OPTIONS.map((typeKey) => ({ value: typeKey, label: `${BUFF_TYPE_LABELS[typeKey] || typeKey} · ${typeKey}` }));
      return {
        key: `${row.key}:${columnKey}`,
        value: selectedWorkbookCell.value,
        inputMode: 'text',
        control: 'search-select',
        options: effectOptions,
        commit: (value) => updateCellValue(row, columnKey, value),
      };
    }
    return {
      key: `${row.key}:${columnKey}`,
      value: selectedWorkbookCell.value,
      inputMode: columnKey === 'valueText' ? 'number' : 'text',
      commit: (value) => updateCellValue(row, columnKey, value),
    };
  }, [library.gearSets, selectedCell?.address, selectedWorkbookCell, selectedWorkbookRow, updateCellValue]);

  const hasUnsavedChanges = isDirty
    || Boolean(formulaBinding && !formulaBinding.readOnly && formulaInput !== formulaBinding.value);

  const handleSelectEquipmentImage = useCallback((displayUrl: string) => {
    if (!formulaBinding || formulaBinding.control !== 'image-search-select') return;
    formulaBinding.commit(displayUrl);
    setFormulaInput(displayUrl);
    setEquipmentImageQuery(displayUrl);
    setIsEquipmentImageDrawerOpen(false);
  }, [formulaBinding]);

  const handleClearEquipmentImage = useCallback(() => {
    if (!formulaBinding || formulaBinding.control !== 'image-search-select') return;
    formulaBinding.commit('');
    setFormulaInput('');
    setEquipmentImageQuery('');
    setIsEquipmentImageDrawerOpen(false);
  }, [formulaBinding]);

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
    if (!formulaBinding || formulaBinding.readOnly || formulaInput === formulaBinding.value || !selectedWorkbookRow || !selectedCell) {
      return baseLibrary;
    }
    const row = selectedWorkbookRow.sourceRow;
    if (row.kind === 'effectLevels') {
      const levelKey = selectedCell.address.replace(/^Lv/, '') as EquipmentLevelKey;
      return LEVEL_KEYS.includes(levelKey)
        ? applyCellValueToLibrary(baseLibrary, row, selectedCell.columnKey, `${levelKey}:${formulaInput}`)
        : baseLibrary;
    }
    return applyCellValueToLibrary(baseLibrary, row, selectedCell.columnKey, formulaInput);
  }, [formulaBinding, formulaInput, selectedCell, selectedWorkbookRow]);

  const commitFormulaInput = useCallback(() => {
    if (!formulaBinding || formulaBinding.readOnly) {
      return;
    }
    formulaBinding.commit(formulaInput);
  }, [formulaBinding, formulaInput]);

  const performSave = useCallback(async () => {
    const committedLibrary = buildLibraryWithCommittedFormulaInput(library);
    const emptyBuffSets = getGearSets(committedLibrary).filter((gearSet) => !gearSet.buffId?.trim()).length;
    const nextLibrary = { ...committedLibrary, updatedAt: new Date().toISOString() };
    const warning = emptyBuffSets > 0 ? ` ${emptyBuffSets} 个套装 buffId 为空，请后续补齐。` : '';
    if (committedLibrary !== library) {
      setLibrary(committedLibrary);
    }
    if (!window.desktopRuntime?.writeEquipmentLibrary) {
      writeLocalStorageJson(EQUIPMENT_LIBRARY_STORAGE_KEY, nextLibrary);
      writeLocalStorageJson(EQUIPMENT_DRAFT_STORAGE_KEY, nextLibrary);
      setLibrary(nextLibrary);
      setIsDirty(false);
      setIsSaveConfirmModalOpen(false);
      setMessage(`浏览器环境已保存到 localStorage 装备库。${warning}`);
      return;
    }
    const result = await writeEquipmentLibraryToFile(nextLibrary);
    if (result.ok) {
      writeLocalStorageJson(EQUIPMENT_LIBRARY_STORAGE_KEY, nextLibrary);
      writeLocalStorageJson(EQUIPMENT_DRAFT_STORAGE_KEY, nextLibrary);
      setLibrary(nextLibrary);
      setIsDirty(false);
      setIsSaveConfirmModalOpen(false);
    }
    setMessage(result.ok ? `已保存到本地 JSON。缓存已同步更新。${warning}` : `${result.error}${warning}`);
  }, [buildLibraryWithCommittedFormulaInput, library]);

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

  return {
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
    renderFormulaEditor,
    renderEditableCell,
    renderExplorer,
  };
}

export type EquipmentSheetPageController = ReturnType<typeof useEquipmentSheetPageController>;
