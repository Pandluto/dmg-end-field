import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import './WorkbookSheet.css';
import './BuffDraftPage.css';
import './OperatorDraftPage.css';
import { APP_ROUTE_PATHS, navigateToAppPath } from '../utils/appRoute';
import { normalizeAssetUrl, resolvePublicPath } from '../utils/assetResolver';
import { persistentLocalStorage } from '../platform/storage/persistentStorage';
import { buildDraftLibraryShareFileName } from '../utils/draftShare';
import { webImageLibrary, getWebImageUrl } from '../platform/resources/webImageLibrary';
import type { ImageAssetEntry } from './ImageManager/types';
import DeferredNumberInput from './DeferredNumberInput';
import BuffEffectEditorDrawer from './BuffEffectEditorDrawer';
import { WorkbookShareDialog } from './WorkbookShareDialog';
import { WorkbookToolButton } from './WorkbookToolButton';
import {
  ATTACK_GROWTH_MILESTONE_KEYS,
  LEVEL_KEYS,
  SKILL_KEYS,
  WEAPON_BUFF_TYPE_OPTIONS,
  type WeaponSkillKey,
} from './weaponDraftCatalog';
import {
  applyAttackGrowthInterpolation,
  applyEffectLevelsInterpolation,
  applyWeaponDrawerEffect,
  buildBuffTypeSearchText,
  buildNextCustomWeaponId,
  buildSearchIndex,
  buildWeaponEffectLevelsRowKey,
  buildWeaponSheetRows,
  cloneValue,
  createEmptyWeaponDraft,
  getBuffTypeDisplayLabel,
  normalizeWeaponDraft,
  projectWeaponEffectForLevel,
  reorderWeaponDraft,
  type WeaponDraft,
  type WeaponEffectBucket,
  type WeaponSheetRow,
} from './weaponDraftModel';
import {
  buildWeaponSheetColumns,
  buildWeaponWorkbookRows,
  columnIndexToLabel,
  type WeaponWorkbookRow,
} from './weaponDraftWorkbook';
import { createWeaponDraftRepository } from './weaponDraftPersistence';
import {
  buildWeaponDraftLibraryShareFile,
  mergeWeaponDraftLibraryShare,
  parseWeaponDraftLibraryShare,
  resolveWeaponDraftShareSelection,
  type WeaponDraftLibraryShareFile,
} from './weaponDraftShare';
import {
  buildWeaponFormulaBinding,
  type WeaponWorkbookSelection,
} from './weaponDraftFormula';
import {
  createWeaponEffect,
  deleteWeaponEffect,
  duplicateWeaponEffect,
  resolveWeaponDraftForEdit,
} from './weaponDraftEditing';
import {
  getWeaponExplorerDragNodeKey as getExplorerDragNodeKey,
  getWeaponExplorerDragNodeLabel,
  reorderWeaponExplorerLibrary,
  type WeaponExplorerDragNode,
  type WeaponExplorerDragPolicyState,
} from './weaponExplorerDragPolicy';
import { useWeaponExplorerDrag } from './useWeaponExplorerDrag';

const WEAPON_SHEET_PAGE_PATH = APP_ROUTE_PATHS.weaponSheet;
const weaponDraftRepository = createWeaponDraftRepository(persistentLocalStorage);

interface WeaponImageOption {
  key: string;
  fileName: string;
  baseName: string;
  relativePath: string;
  source: 'builtin' | 'user';
  displayUrl: string;
  searchText: string;
}

type WeaponSheetContextMenuState = {
  x: number;
  y: number;
  target: 'blank' | 'draft' | 'skill' | 'effect';
  draftId?: string;
  skillKey?: WeaponSkillKey;
  effectKey?: string;
  bucket?: WeaponEffectBucket;
};

type WeaponSheetContextMenuAction = {
  key: string;
  label: string;
  icon: 'new' | 'delete' | 'collapse' | 'expand' | 'open';
  onClick: () => void;
};

function isWeaponSheetPath(pathname: string) {
  return pathname === WEAPON_SHEET_PAGE_PATH;
}

function buildWeaponImageAssetUrl(entry: ImageAssetEntry) {
  const userUrl = getWebImageUrl(entry);
  if (userUrl) return userUrl;
  const isFileProtocol = window.location.protocol === 'file:';
  const path = isFileProtocol
    ? entry.relativePath
    : entry.relativePath.split('/').map(encodeURIComponent).join('/');
  return resolvePublicPath(path);
}

function buildWeaponImageOption(entry: ImageAssetEntry): WeaponImageOption | null {
  if (entry.kind === 'dir') return null;
  const displayUrl = buildWeaponImageAssetUrl(entry);
  const source = entry.source === 'release' || entry.source === 'user' ? 'user' : 'builtin';
  return {
    key: entry.relativePath,
    fileName: entry.fileName,
    baseName: entry.baseName,
    relativePath: entry.relativePath,
    source,
    displayUrl,
    searchText: buildSearchIndex([entry.fileName, entry.baseName, entry.relativePath, displayUrl, source]),
  };
}

/**
 * Sheet-Weapon 是表格式编辑器，不允许浏览器 number input 的默认 stepper 行为干扰单元格编辑语义。
 * 此函数用于拦截键盘事件，防止方向键、Backspace 等按键冒泡到外层的表格导航逻辑。
 */
function stopEditingKeyPropagation(event: React.KeyboardEvent<HTMLInputElement>, options?: { isNumberInput?: boolean }) {
  const { isNumberInput = false } = options ?? {};

  // 对所有输入框：阻止 Backspace/Delete 冒泡，防止触发外层行为
  if (event.key === 'Backspace' || event.key === 'Delete') {
    event.stopPropagation();
    return;
  }

  // 对所有输入框：阻止 Home/End 冒泡
  if (event.key === 'Home' || event.key === 'End') {
    event.stopPropagation();
    return;
  }

  // 对 number input：阻止上下方向键的默认增减值行为，并阻止冒泡
  if (isNumberInput && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
    event.preventDefault();
    event.stopPropagation();
    return;
  }

  // 对所有输入框：阻止左右方向键冒泡（但保留默认光标移动行为）
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
    event.stopPropagation();
    return;
  }

  // 阻止上下方向键冒泡（文本输入框保留默认行为，只阻止冒泡）
  if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
    event.stopPropagation();
    return;
  }
}

function getWeaponWorkbookRowClassName(row: WeaponWorkbookRow) {
  if (row.kind === 'weapon') {
    return 'damage-sheet-excel-row is-button weapon-sheet-row-weapon';
  }
  if (row.kind === 'growth') {
    return 'damage-sheet-excel-row is-data weapon-sheet-row-growth';
  }
  if (row.kind === 'skill') {
    return 'damage-sheet-excel-row is-character weapon-sheet-row-skill';
  }
  if (row.kind === 'effectLevels') {
    return 'damage-sheet-excel-row is-data weapon-sheet-row-level';
  }
  return 'damage-sheet-excel-row is-data weapon-sheet-row-effect';
}

export { isWeaponSheetPath };

export function WeaponDraftSheetPage() {
  const [draft, setDraft] = useState<WeaponDraft>(() => weaponDraftRepository.loadDraft());
  const [localLibrary, setLocalLibrary] = useState<Record<string, WeaponDraft>>(() => weaponDraftRepository.loadLibrary());
  const [imageAssets, setImageAssets] = useState<ImageAssetEntry[]>([]);
  const [imageAssetsLoading, setImageAssetsLoading] = useState(false);
  const [imageAssetsError, setImageAssetsError] = useState('');
  const [selectedLocalDraftId, setSelectedLocalDraftId] = useState('');
  const [filterKeyword, setFilterKeyword] = useState('');
  const [buffTypeQuery, setBuffTypeQuery] = useState('');
  const [weaponImageQuery, setWeaponImageQuery] = useState('');
  const [isWeaponImageDrawerOpen, setIsWeaponImageDrawerOpen] = useState(false);
  const [weaponImageLoadFailed, setWeaponImageLoadFailed] = useState(false);
  const [formulaInput, setFormulaInput] = useState('');
  const [selectedWorkbookCell, setSelectedWorkbookCell] = useState<WeaponWorkbookSelection | null>(null);
  const [pendingFocusRowKey, setPendingFocusRowKey] = useState<string | null>(null);
  const [inlineEditingCellKey, setInlineEditingCellKey] = useState<string | null>(null);
  const [inlineEditingValue, setInlineEditingValue] = useState('');
  const [collapsedDraftIds, setCollapsedDraftIds] = useState<Record<string, boolean>>({});
  const [collapsedSkills, setCollapsedSkills] = useState<Record<string, boolean>>({});
  const [collapsedLevels, setCollapsedLevels] = useState<Record<string, boolean>>({});
  const [isOverwriteProtectionEnabled, setIsOverwriteProtectionEnabled] = useState(true);
  const [isOverwriteDraftModalOpen, setIsOverwriteDraftModalOpen] = useState(false);
  const [shareImportError, setShareImportError] = useState('');
  const [pendingImportShare, setPendingImportShare] = useState<WeaponDraftLibraryShareFile | null>(null);
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);
  const [shareModalMode, setShareModalMode] = useState<'export' | 'import'>('export');
  const [shareImportText, setShareImportText] = useState('');
  const [exportScope, setExportScope] = useState<'current' | 'all'>('current');
  const [contextMenu, setContextMenu] = useState<WeaponSheetContextMenuState | null>(null);
  const [buffDrawerTarget, setBuffDrawerTarget] = useState<{ skillKey: WeaponSkillKey; effectKey: string; levelKey: string } | null>(null);
  const shareImportInputRef = useRef<HTMLInputElement>(null);
  const weaponImageFormulaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!selectedLocalDraftId && draft.id && localLibrary[draft.id]) {
      setSelectedLocalDraftId(draft.id);
    }
  }, [draft.id, localLibrary, selectedLocalDraftId]);

  const columns = useMemo(() => buildWeaponSheetColumns(), []);
  const activeDraftId = selectedLocalDraftId || draft.id;
  const rows = useMemo(() => buildWeaponSheetRows(draft), [draft]);
  const visibleRows = useMemo(() => {
    const structuralRows = rows.filter((row) => {
      if ((row.kind === 'effect' || row.kind === 'effectLevels') && collapsedSkills[`${activeDraftId}:${row.skillKey}`]) {
        return false;
      }
      if (row.kind === 'effectLevels' && collapsedLevels[`${activeDraftId}:${row.skillKey}:${row.bucket}:${row.sourceEffectKey}`]) {
        return false;
      }
      return true;
    });
    // 搜索只影响左侧资源管理器，不影响右侧表格
    return structuralRows;
  }, [activeDraftId, collapsedLevels, collapsedSkills, rows]);
  const workbookRows = useMemo(() => buildWeaponWorkbookRows(draft, visibleRows, columns), [columns, draft, visibleRows]);
  const filteredBuffTypeOptions = useMemo(() => {
    const keyword = buffTypeQuery.trim().toLowerCase();
    if (!keyword) {
      return WEAPON_BUFF_TYPE_OPTIONS;
    }
    return WEAPON_BUFF_TYPE_OPTIONS.filter((option) => buildBuffTypeSearchText(option).toLowerCase().includes(keyword));
  }, [buffTypeQuery]);
  const weaponImageOptions = useMemo(
    () => imageAssets.map(buildWeaponImageOption).filter((option): option is WeaponImageOption => option !== null),
    [imageAssets],
  );
  const filteredWeaponImageOptions = useMemo(() => {
    const keyword = weaponImageQuery.trim().toLowerCase();
    if (!keyword) {
      return weaponImageOptions;
    }
    return weaponImageOptions.filter((option) => option.searchText.toLowerCase().includes(keyword));
  }, [weaponImageOptions, weaponImageQuery]);
  const selectedWorkbookSummary = selectedWorkbookCell?.sourceRowKey
    ? visibleRows.find((row) => row.key === selectedWorkbookCell.sourceRowKey) ?? null
    : null;
  const selectedSummaryKey = selectedWorkbookSummary?.key ?? '';
  const drawerWeaponEffect = buffDrawerTarget
    ? draft.skills[buffDrawerTarget.skillKey].effects[buffDrawerTarget.effectKey] ?? null
    : null;
  const projectedDrawerEffect = buffDrawerTarget && drawerWeaponEffect
    ? projectWeaponEffectForLevel(buffDrawerTarget.effectKey, drawerWeaponEffect, buffDrawerTarget.levelKey)
    : null;
  const openWeaponBuffDrawer = useCallback((skillKey: WeaponSkillKey, effectKey: string, levelKey = '9') => {
    if (skillKey !== 'skill3') return;
    setBuffDrawerTarget({ skillKey, effectKey, levelKey });
  }, []);

  const formulaBinding = useMemo(
    () => buildWeaponFormulaBinding(draft, selectedWorkbookCell, selectedWorkbookSummary),
    [draft, selectedWorkbookCell, selectedWorkbookSummary],
  );

  useEffect(() => {
    setFormulaInput(formulaBinding?.value ?? '');
  }, [formulaBinding?.key, formulaBinding?.value]);

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

  useEffect(() => {
    setBuffTypeQuery('');
    setWeaponImageQuery(formulaBinding?.control === 'image-search-select' ? (formulaBinding.value ?? '') : '');
    setIsWeaponImageDrawerOpen(false);
  }, [formulaBinding?.control, formulaBinding?.key, formulaBinding?.value]);

  useEffect(() => {
    setWeaponImageLoadFailed(false);
  }, [draft.imgUrl]);

  useEffect(() => {
    if (!isWeaponImageDrawerOpen) {
      return undefined;
    }
    const handlePointerDown = (event: PointerEvent) => {
      if (weaponImageFormulaRef.current?.contains(event.target as Node)) {
        return;
      }
      setIsWeaponImageDrawerOpen(false);
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsWeaponImageDrawerOpen(false);
      }
    };
    window.addEventListener('pointerdown', handlePointerDown, true);
    window.addEventListener('keydown', handleEscape, true);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown, true);
      window.removeEventListener('keydown', handleEscape, true);
    };
  }, [isWeaponImageDrawerOpen]);

  useEffect(() => {
    const firstDataRow = workbookRows[0];
    if (!firstDataRow) {
      setSelectedWorkbookCell(null);
      return;
    }
    if (pendingFocusRowKey) {
      const targetRow = workbookRows.find((row) => row.sourceRow.key === pendingFocusRowKey);
      if (targetRow) {
        const targetCell = targetRow.cells[0];
        setSelectedWorkbookCell({
          address: targetCell.address,
          sourceRowKey: targetCell.sourceRowKey,
          columnKey: targetCell.columnKey,
        });
        setPendingFocusRowKey(null);
        return;
      }
    }
    if (!selectedWorkbookCell) {
      const firstCell = firstDataRow.cells[0];
      setSelectedWorkbookCell({
        address: firstCell.address,
        sourceRowKey: firstCell.sourceRowKey,
        columnKey: firstCell.columnKey,
      });
    }
  }, [pendingFocusRowKey, selectedWorkbookCell, workbookRows]);

  const commitFormulaInput = useCallback((baseDraft: WeaponDraft) => {
    if (!formulaBinding || formulaInput === formulaBinding.value) {
      return baseDraft;
    }
    return normalizeWeaponDraft(formulaBinding.apply(baseDraft, formulaInput));
  }, [formulaBinding, formulaInput]);

  const persistLibraryState = useCallback((nextLibrary: Record<string, WeaponDraft>, nextDraft: WeaponDraft, nextSelectedId: string) => {
    weaponDraftRepository.saveLibrary(nextLibrary);
    weaponDraftRepository.saveDraft(nextDraft);
    setLocalLibrary(nextLibrary);
    setDraft(nextDraft);
    setSelectedLocalDraftId(nextSelectedId);
  }, []);

  const persistDraftToLibrary = useCallback((allowOverwrite: boolean) => {
    const nextDraft = commitFormulaInput(draft);
    const library = weaponDraftRepository.loadLibrary();
    const nextDraftId = nextDraft.id.trim() || buildNextCustomWeaponId(Object.keys(library));

    if (library[nextDraftId] && !allowOverwrite) {
      setIsOverwriteDraftModalOpen(true);
      return false;
    }

    const finalDraft = { ...nextDraft, id: nextDraftId };
    const nextLibrary = {
      ...library,
      [nextDraftId]: finalDraft,
    };

    persistLibraryState(nextLibrary, finalDraft, nextDraftId);
    setPendingFocusRowKey(`weapon-${nextDraftId}`);
    setIsOverwriteDraftModalOpen(false);
    return true;
  }, [commitFormulaInput, draft, persistLibraryState, selectedLocalDraftId]);

  const handleSaveDraft = useCallback(() => {
    persistDraftToLibrary(!isOverwriteProtectionEnabled);
  }, [isOverwriteProtectionEnabled, persistDraftToLibrary]);

  const handleNormalizeDraft = useCallback(() => {
    const nextDraft = reorderWeaponDraft(draft);
    const nextLibrary = { ...localLibrary, [nextDraft.id]: nextDraft };
    persistLibraryState(nextLibrary, nextDraft, nextDraft.id);
  }, [draft, localLibrary, persistLibraryState]);

  const handleConfirmOverwriteDraft = useCallback(() => {
    persistDraftToLibrary(true);
  }, [persistDraftToLibrary]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        handleSaveDraft();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleSaveDraft]);

  // Auto-persist draft on changes (debounced)
  useEffect(() => {
    const timer = setTimeout(() => {
      weaponDraftRepository.saveDraft(draft);
    }, 400);
    return () => clearTimeout(timer);
  }, [draft]);

  const handleCreateNewDraft = useCallback(() => {
    const nextDraftId = buildNextCustomWeaponId(Object.keys(localLibrary));
    const nextDraft = createEmptyWeaponDraft(nextDraftId);
    persistLibraryState({
      ...localLibrary,
      [nextDraftId]: nextDraft,
    }, nextDraft, nextDraftId);
    setPendingFocusRowKey(`weapon-${nextDraft.id}`);
  }, [localLibrary, persistLibraryState]);

  const handleLoadLocalDraft = useCallback((draftId: string) => {
    const nextDraft = localLibrary[draftId];
    if (!nextDraft) {
      return;
    }
    setDraft(cloneValue(nextDraft));
    setSelectedLocalDraftId(draftId);
    setPendingFocusRowKey(`weapon-${draftId}`);
  }, [localLibrary]);

  const setDraftCollapsed = useCallback((draftId: string, nextCollapsed: boolean) => {
    setCollapsedDraftIds((prev) => ({ ...prev, [draftId]: nextCollapsed }));
  }, []);

  const toggleSkillCollapsed = useCallback((draftId: string, skillKey: WeaponSkillKey) => {
    const collapseKey = `${draftId}:${skillKey}`;
    setCollapsedSkills((prev) => ({ ...prev, [collapseKey]: !prev[collapseKey] }));
  }, []);

  const setSkillCollapsed = useCallback((draftId: string, skillKey: WeaponSkillKey, nextCollapsed: boolean) => {
    const collapseKey = `${draftId}:${skillKey}`;
    setCollapsedSkills((prev) => ({ ...prev, [collapseKey]: nextCollapsed }));
  }, []);

  const toggleLevelCollapsed = useCallback((draftId: string, skillKey: WeaponSkillKey, bucket: WeaponEffectBucket, effectKey: string) => {
    const collapseKey = `${draftId}:${skillKey}:${bucket}:${effectKey}`;
    setCollapsedLevels((prev) => ({ ...prev, [collapseKey]: !prev[collapseKey] }));
  }, []);

  const setLevelCollapsed = useCallback((draftId: string, skillKey: WeaponSkillKey, bucket: WeaponEffectBucket, effectKey: string, nextCollapsed: boolean) => {
    const collapseKey = `${draftId}:${skillKey}:${bucket}:${effectKey}`;
    setCollapsedLevels((prev) => ({ ...prev, [collapseKey]: nextCollapsed }));
  }, []);

  const isExplorerDraftCollapsed = useCallback((draftId: string) => collapsedDraftIds[draftId] ?? true, [collapsedDraftIds]);

  const isExplorerSkillCollapsed = useCallback(
    (draftId: string, skillKey: WeaponSkillKey) => collapsedSkills[`${draftId}:${skillKey}`] ?? true,
    [collapsedSkills]
  );

  const isExplorerLevelCollapsed = useCallback(
    (draftId: string, skillKey: WeaponSkillKey, bucket: WeaponEffectBucket, effectKey: string) => (
      collapsedLevels[`${draftId}:${skillKey}:${bucket}:${effectKey}`] ?? true
    ),
    [collapsedLevels]
  );

  const handleCollapseAllExplorer = useCallback(() => {
    const entries = { ...localLibrary };
    if (draft.id && !entries[draft.id]) {
      entries[draft.id] = cloneValue(draft);
    }
    const nextDraftCollapsed: Record<string, boolean> = {};
    const nextSkillCollapsed: Record<string, boolean> = {};
    const nextLevelCollapsed: Record<string, boolean> = {};

    Object.values(entries).forEach((entry) => {
      nextDraftCollapsed[entry.id] = true;
      SKILL_KEYS.forEach((skillKey) => {
        nextSkillCollapsed[`${entry.id}:${skillKey}`] = true;
        const effectRows = buildWeaponSheetRows(entry)
          .filter((row): row is Extract<WeaponSheetRow, { kind: 'effect' }> => row.kind === 'effect')
          .filter((row) => row.skillKey === skillKey);
        effectRows.forEach((row) => {
          nextLevelCollapsed[`${entry.id}:${skillKey}:${row.bucket}:${row.sourceEffectKey}`] = true;
        });
      });
    });

    setCollapsedDraftIds(nextDraftCollapsed);
    setCollapsedSkills(nextSkillCollapsed);
    setCollapsedLevels(nextLevelCollapsed);
  }, [draft, localLibrary]);

  const handleExpandAllExplorer = useCallback(() => {
    const entries = { ...localLibrary };
    if (draft.id && !entries[draft.id]) {
      entries[draft.id] = cloneValue(draft);
    }
    const nextDraftCollapsed: Record<string, boolean> = {};
    const nextSkillCollapsed: Record<string, boolean> = {};
    const nextLevelCollapsed: Record<string, boolean> = {};

    Object.values(entries).forEach((entry) => {
      nextDraftCollapsed[entry.id] = false;
      SKILL_KEYS.forEach((skillKey) => {
        nextSkillCollapsed[`${entry.id}:${skillKey}`] = false;
        const effectRows = buildWeaponSheetRows(entry)
          .filter((row): row is Extract<WeaponSheetRow, { kind: 'effect' }> => row.kind === 'effect')
          .filter((row) => row.skillKey === skillKey);
        effectRows.forEach((row) => {
          nextLevelCollapsed[`${entry.id}:${skillKey}:${row.bucket}:${row.sourceEffectKey}`] = false;
        });
      });
    });

    setCollapsedDraftIds(nextDraftCollapsed);
    setCollapsedSkills(nextSkillCollapsed);
    setCollapsedLevels(nextLevelCollapsed);
  }, [draft, localLibrary]);

  const handleAttackGrowthChange = useCallback((levelKey: string, nextValue: number | undefined) => {
    setDraft((prev) => {
      const nextAttackGrowth = { ...prev.attackGrowth };
      if (typeof nextValue === 'number' && Number.isFinite(nextValue)) {
        nextAttackGrowth[levelKey] = nextValue;
      } else {
        delete nextAttackGrowth[levelKey];
      }
      return {
        ...prev,
        attackGrowth: nextAttackGrowth,
      };
    });
  }, []);

  const handleEffectLevelCommit = useCallback((
    sourceRow: Extract<WeaponSheetRow, { kind: 'effectLevels' }>,
    levelKey: string,
    nextValue: number | undefined,
  ) => {
    setDraft((prev) => {
      if (sourceRow.bucket === 'value') {
        const nextLevels = { ...prev.skills[sourceRow.skillKey].levels };
        nextLevels[levelKey] = {
          ...nextLevels[levelKey],
          value: nextValue,
        };
        return {
          ...prev,
          skills: {
            ...prev.skills,
            [sourceRow.skillKey]: {
              ...prev.skills[sourceRow.skillKey],
              levels: nextLevels,
            },
          },
        };
      }

      const nextEffects = { ...prev.skills[sourceRow.skillKey].effects };
      if (nextEffects[sourceRow.sourceEffectKey]) {
        const nextLevels = { ...nextEffects[sourceRow.sourceEffectKey].levels };
        if (typeof nextValue === 'number' && Number.isFinite(nextValue)) {
          nextLevels[levelKey] = nextValue;
        } else {
          delete nextLevels[levelKey];
        }
        nextEffects[sourceRow.sourceEffectKey] = {
          ...nextEffects[sourceRow.sourceEffectKey],
          levels: nextLevels,
        };
      }

      return {
        ...prev,
        skills: {
          ...prev.skills,
          [sourceRow.skillKey]: {
            ...prev.skills[sourceRow.skillKey],
            effects: nextEffects,
          },
        },
      };
    });
  }, []);

  const updateLibraryDraft = useCallback((
    draftId: string,
    updater: (baseDraft: WeaponDraft) => WeaponDraft | null,
    options?: { focusRowKey?: string; selectAfter?: boolean },
  ) => {
    const currentDraft = draftId === activeDraftId ? commitFormulaInput(draft) : draft;
    const baseDraft = resolveWeaponDraftForEdit({
      library: localLibrary,
      currentDraft,
      activeDraftKey: activeDraftId,
    }, draftId);
    if (!baseDraft) {
      return null;
    }
    const updatedDraft = updater(baseDraft);
    if (!updatedDraft) {
      return null;
    }
    const nextDraft = normalizeWeaponDraft(updatedDraft);
    const nextLibrary = {
      ...localLibrary,
      [draftId]: nextDraft,
    };
    if (draftId === activeDraftId || options?.selectAfter) {
      persistLibraryState(nextLibrary, nextDraft, draftId);
    } else {
      weaponDraftRepository.saveLibrary(nextLibrary);
      setLocalLibrary(nextLibrary);
    }
    if (options?.focusRowKey) {
      setPendingFocusRowKey(options.focusRowKey);
    }
    return nextDraft;
  }, [activeDraftId, commitFormulaInput, draft, localLibrary, persistLibraryState]);

  const handleAutoFillAttackGrowth = useCallback((draftId: string) => {
    updateLibraryDraft(draftId, (baseDraft) => applyAttackGrowthInterpolation(baseDraft), {
      selectAfter: true,
      focusRowKey: `growth-${draftId}`,
    });
  }, [updateLibraryDraft]);

  const handleAutoFillEffectLevels = useCallback((draftId: string, skillKey: WeaponSkillKey, bucket: WeaponEffectBucket, effectKey: string) => {
    updateLibraryDraft(draftId, (baseDraft) => applyEffectLevelsInterpolation(baseDraft, skillKey, bucket, effectKey), {
      selectAfter: true,
      focusRowKey: buildWeaponEffectLevelsRowKey(skillKey, bucket, effectKey),
    });
  }, [updateLibraryDraft]);

  const handleCreateDraftEffect = useCallback((draftId: string, skillKey: WeaponSkillKey) => {
    let createdEffectKey = '';
    let focusRowKey = '';
    const nextDraft = updateLibraryDraft(draftId, (baseDraft) => {
      const result = createWeaponEffect(baseDraft, skillKey);
      if (!result) {
        return null;
      }
      createdEffectKey = result.effectKey;
      focusRowKey = result.focusRowKey;
      return result.nextDraft;
    }, { selectAfter: true });
    if (!nextDraft || !createdEffectKey) {
      return;
    }
    setPendingFocusRowKey(focusRowKey);
    if (skillKey === 'skill3') setBuffDrawerTarget({ skillKey, effectKey: createdEffectKey, levelKey: '9' });
  }, [updateLibraryDraft]);

  const handleDeleteDraftGroup = useCallback((draftId: string) => {
    if (!localLibrary[draftId]) {
      return;
    }
    const nextLibrary = { ...localLibrary };
    delete nextLibrary[draftId];
    const remainingIds = Object.keys(nextLibrary).sort();
    if (selectedLocalDraftId === draftId) {
      const nextSelectedId = remainingIds[0] ?? '';
      const nextDraft = nextSelectedId ? cloneValue(nextLibrary[nextSelectedId]) : createEmptyWeaponDraft(buildNextCustomWeaponId(remainingIds));
      persistLibraryState(nextLibrary, nextDraft, nextSelectedId);
      setPendingFocusRowKey(`weapon-${nextDraft.id}`);
      return;
    }
    weaponDraftRepository.saveLibrary(nextLibrary);
    setLocalLibrary(nextLibrary);
  }, [localLibrary, persistLibraryState, selectedLocalDraftId]);

  const handleDeleteDraftEffect = useCallback((draftId: string, skillKey: WeaponSkillKey, bucket: WeaponEffectBucket, effectKey: string) => {
    updateLibraryDraft(draftId, (baseDraft) => (
      deleteWeaponEffect(baseDraft, skillKey, bucket, effectKey)?.nextDraft ?? null
    ), {
      selectAfter: true,
      focusRowKey: `skill-${skillKey}`,
    });
  }, [updateLibraryDraft]);

  const handleDuplicateDraftEffect = useCallback((draftId: string, skillKey: WeaponSkillKey, bucket: WeaponEffectBucket, effectKey: string) => {
    let duplicatedEffectKey = '';
    let focusRowKey = '';
    const nextDraft = updateLibraryDraft(draftId, (baseDraft) => {
      const result = duplicateWeaponEffect(baseDraft, skillKey, bucket, effectKey);
      if (!result) {
        return null;
      }
      duplicatedEffectKey = result.effectKey;
      focusRowKey = result.focusRowKey;
      return result.nextDraft;
    }, { selectAfter: true });
    if (!nextDraft || !duplicatedEffectKey) {
      return;
    }
    setPendingFocusRowKey(focusRowKey);
    if (skillKey === 'skill3') setBuffDrawerTarget({ skillKey, effectKey: duplicatedEffectKey, levelKey: '9' });
  }, [updateLibraryDraft]);

  const handleSelectWeaponImage = useCallback((displayUrl: string) => {
    setDraft((prev) => normalizeWeaponDraft({ ...prev, imgUrl: displayUrl }));
    setWeaponImageLoadFailed(false);
    setIsWeaponImageDrawerOpen(false);
  }, []);

  const handleClearWeaponImage = useCallback(() => {
    setDraft((prev) => normalizeWeaponDraft({ ...prev, imgUrl: '' }));
    setWeaponImageLoadFailed(false);
    setIsWeaponImageDrawerOpen(false);
  }, []);

  const currentShareFile = useMemo(() => buildWeaponDraftLibraryShareFile({
    draft,
    library: localLibrary,
    scope: exportScope,
  }), [draft, exportScope, localLibrary]);

  const currentShareText = useMemo(() => JSON.stringify(currentShareFile, null, 2), [currentShareFile]);

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
    const result = parseWeaponDraftLibraryShare(rawText);
    if (!result.ok) {
      setPendingImportShare(null);
      setShareImportError(result.error);
      return;
    }
    setShareImportError('');
    setPendingImportShare(result.shareFile);
  }, []);

  const handleExportLocalLibrary = useCallback(() => {
    const blob = new Blob([JSON.stringify(currentShareFile, null, 2)], {
      type: 'application/json;charset=utf-8',
    });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = buildDraftLibraryShareFileName(currentShareFile.label, currentShareFile.exportedAt);
    link.click();
    window.URL.revokeObjectURL(url);
  }, [currentShareFile]);

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
    if (!file) {
      return;
    }
    const rawText = await file.text();
    setShareImportText(rawText);
    prepareImportShare(rawText);
    event.target.value = '';
  }, [prepareImportShare]);

  const handleConfirmImportShare = useCallback(() => {
    if (!pendingImportShare) {
      return;
    }
    const nextLibrary = mergeWeaponDraftLibraryShare(localLibrary, pendingImportShare);
    const nextDraftId = resolveWeaponDraftShareSelection(
      pendingImportShare.payload,
      selectedLocalDraftId,
      draft.id,
    );
    const nextDraft = nextDraftId && nextLibrary[nextDraftId]
      ? nextLibrary[nextDraftId]
      : draft;
    persistLibraryState(nextLibrary, nextDraft, nextDraftId);
    setPendingImportShare(null);
    setShareImportText('');
    setShareImportError('');
    setIsShareModalOpen(false);
  }, [draft, localLibrary, pendingImportShare, persistLibraryState, selectedLocalDraftId]);

  const openContextMenu = useCallback((event: ReactMouseEvent, nextMenu: WeaponSheetContextMenuState) => {
    event.preventDefault();
    event.stopPropagation();
    setContextMenu(nextMenu);
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

  const openWorkbookContextMenu = useCallback((
    event: ReactMouseEvent,
    sourceRow?: WeaponSheetRow,
    selectedCell?: WeaponWorkbookSelection,
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
    if (sourceRow.kind === 'weapon' || sourceRow.kind === 'growth') {
      openContextMenu(event, {
        x: event.clientX,
        y: event.clientY,
        target: 'draft',
        draftId: activeDraftId,
      });
      return;
    }
    if (sourceRow.kind === 'skill') {
      openContextMenu(event, {
        x: event.clientX,
        y: event.clientY,
        target: 'skill',
        draftId: activeDraftId,
        skillKey: sourceRow.skillKey,
      });
      return;
    }
    openContextMenu(event, {
      x: event.clientX,
      y: event.clientY,
      target: 'effect',
      draftId: activeDraftId,
      skillKey: sourceRow.skillKey,
      effectKey: sourceRow.sourceEffectKey,
      bucket: sourceRow.bucket,
    });
  }, [activeDraftId, openContextMenu]);

  const currentContextMenuActions = useMemo<WeaponSheetContextMenuAction[]>(() => {
    if (!contextMenu) {
      return [];
    }
    if (contextMenu.target === 'blank') {
      return [
        { key: 'new-weapon', label: '新建武器', icon: 'new', onClick: () => handleCreateNewDraft() },
        { key: 'collapse-all', label: '全部折叠', icon: 'collapse', onClick: () => handleCollapseAllExplorer() },
        { key: 'expand-all', label: '全部展开', icon: 'expand', onClick: () => handleExpandAllExplorer() },
      ];
    }
    if (contextMenu.target === 'draft' && contextMenu.draftId) {
      const isCollapsed = isExplorerDraftCollapsed(contextMenu.draftId);
      return [
        { key: 'open-draft', label: '打开武器', icon: 'open', onClick: () => handleLoadLocalDraft(contextMenu.draftId!) },
        { key: 'fill-attack-growth', label: '按 1/90 补全攻击成长', icon: 'new', onClick: () => handleAutoFillAttackGrowth(contextMenu.draftId!) },
        {
          key: 'toggle-draft-collapse',
          label: isCollapsed ? '展开此武器' : '折叠此武器',
          icon: isCollapsed ? 'expand' : 'collapse',
          onClick: () => setDraftCollapsed(contextMenu.draftId!, !isCollapsed),
        },
        { key: 'delete-draft', label: '删除武器', icon: 'delete', onClick: () => handleDeleteDraftGroup(contextMenu.draftId!) },
      ];
    }
    if (contextMenu.target === 'skill' && contextMenu.draftId && contextMenu.skillKey) {
      const isCollapsed = isExplorerSkillCollapsed(contextMenu.draftId, contextMenu.skillKey);
      return [
        ...(contextMenu.skillKey === 'skill3'
          ? [{ key: 'create-effect', label: '新建效果', icon: 'new' as const, onClick: () => handleCreateDraftEffect(contextMenu.draftId!, contextMenu.skillKey!) }]
          : []),
        {
          key: 'toggle-skill-collapse',
          label: isCollapsed ? '展开此技能' : '折叠此技能',
          icon: isCollapsed ? 'expand' : 'collapse',
          onClick: () => setSkillCollapsed(contextMenu.draftId!, contextMenu.skillKey!, !isCollapsed),
        },
      ];
    }
    if (contextMenu.target === 'effect' && contextMenu.draftId && contextMenu.skillKey && contextMenu.effectKey && contextMenu.bucket) {
      const isCollapsed = isExplorerLevelCollapsed(contextMenu.draftId, contextMenu.skillKey, contextMenu.bucket, contextMenu.effectKey);
      return [
        {
          key: 'fill-effect-levels',
          label: '按 Lv1/Lv9 补全等级',
          icon: 'new',
          onClick: () => handleAutoFillEffectLevels(
            contextMenu.draftId!,
            contextMenu.skillKey!,
            contextMenu.bucket!,
            contextMenu.effectKey!,
          ),
        },
        {
          key: 'toggle-effect-levels',
          label: isCollapsed ? '展开等级' : '折叠等级',
          icon: isCollapsed ? 'expand' : 'collapse',
          onClick: () => setLevelCollapsed(contextMenu.draftId!, contextMenu.skillKey!, contextMenu.bucket!, contextMenu.effectKey!, !isCollapsed),
        },
        ...(contextMenu.skillKey === 'skill3'
          ? [
              { key: 'edit-effect', label: '编辑 Buff', icon: 'open' as const, onClick: () => openWeaponBuffDrawer(contextMenu.skillKey!, contextMenu.effectKey!) },
              { key: 'copy-effect', label: '复制效果', icon: 'new' as const, onClick: () => handleDuplicateDraftEffect(contextMenu.draftId!, contextMenu.skillKey!, contextMenu.bucket!, contextMenu.effectKey!) },
              { key: 'delete-effect', label: '删除效果', icon: 'delete' as const, onClick: () => handleDeleteDraftEffect(contextMenu.draftId!, contextMenu.skillKey!, contextMenu.bucket!, contextMenu.effectKey!) },
            ]
          : []),
      ];
    }
    return [];
  }, [
    contextMenu,
    handleCreateDraftEffect,
    handleCreateNewDraft,
    handleAutoFillAttackGrowth,
    handleAutoFillEffectLevels,
    handleCollapseAllExplorer,
    handleDeleteDraftEffect,
    handleDeleteDraftGroup,
    handleDuplicateDraftEffect,
    handleExpandAllExplorer,
    isExplorerDraftCollapsed,
    isExplorerLevelCollapsed,
    isExplorerSkillCollapsed,
    handleLoadLocalDraft,
    openWeaponBuffDrawer,
    setDraftCollapsed,
    setSkillCollapsed,
    setLevelCollapsed,
  ]);

  const explorerEntries = useMemo(() => {
    const entries = { ...localLibrary };
    if (draft.id && !entries[draft.id]) {
      entries[draft.id] = cloneValue(draft);
    }
    return Object.values(entries).sort((left, right) => left.name.localeCompare(right.name, 'zh-Hans-CN'));
  }, [draft, localLibrary]);

  const filteredExplorerEntries = useMemo(() => {
    const keyword = filterKeyword.trim().toLowerCase();
    if (!keyword) {
      return explorerEntries;
    }
    // 搜索只按武器名称匹配，不影响右侧表格
    return explorerEntries.filter((entry) => entry.name.trim().toLowerCase().includes(keyword));
  }, [explorerEntries, filterKeyword]);

  // Explorer drag helpers
  const explorerDragPolicyState = useMemo<WeaponExplorerDragPolicyState>(() => ({
    filterKeyword,
  }), [filterKeyword]);

  const getExplorerDragNodeLabel = useCallback((node: WeaponExplorerDragNode) => {
    return getWeaponExplorerDragNodeLabel(localLibrary, node);
  }, [localLibrary]);

  const applyExplorerReorder = useCallback((source: WeaponExplorerDragNode, target: WeaponExplorerDragNode) => {
    const result = reorderWeaponExplorerLibrary(localLibrary, draft, activeDraftId, source, target);
    if (!result) {
      return;
    }
    if (result.shouldUpdateCurrentDraft) {
      setDraft(result.nextDraft);
      weaponDraftRepository.saveDraft(result.nextDraft);
    }
    setLocalLibrary(result.nextLibrary);
    weaponDraftRepository.saveLibrary(result.nextLibrary);
  }, [activeDraftId, draft, localLibrary]);

  const handleExplorerDragStart = useCallback(() => {
    setContextMenu(null);
  }, []);

  const {
    dragState,
    consumeSuppressedExplorerClick,
    canStartExplorerDrag,
    handleExplorerPointerDown,
  } = useWeaponExplorerDrag({
    policyState: explorerDragPolicyState,
    onReorder: applyExplorerReorder,
    onDragStart: handleExplorerDragStart,
  });

  const formatWeaponExplorerDragKindLabel = (kind: WeaponExplorerDragNode['kind']): string => {
    if (kind === 'draft') {
      return '武器';
    }
    if (kind === 'skill') {
      return '技能';
    }
    return '效果';
  };

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
          <WorkbookToolButton icon="new" label="新建" title="新建武器" onClick={handleCreateNewDraft} />
          <WorkbookToolButton icon="save" label="保存" title="保存当前武器" onClick={handleSaveDraft} />
          <WorkbookToolButton icon="normalize" label="整理" title="整理技能与效果顺序" onClick={handleNormalizeDraft} />
          <WorkbookToolButton
            icon="protect"
            label={isOverwriteProtectionEnabled ? '保护开' : '保护关'}
            title="切换覆盖保护"
            active={isOverwriteProtectionEnabled}
            onClick={() => setIsOverwriteProtectionEnabled((prev) => !prev)}
          />
          <WorkbookToolButton icon="export" label="导出" title="导出本地武器库" onClick={() => openShareModal('export')} />
          <WorkbookToolButton icon="import" label="导入" title="导入武器分享" onClick={() => openShareModal('import')} />
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
                      if (consumeSuppressedExplorerClick()) {
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
                                if (consumeSuppressedExplorerClick()) {
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
                                          if (consumeSuppressedExplorerClick()) {
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

      <WorkbookShareDialog
        open={isShareModalOpen}
        mode={shareModalMode}
        onModeChange={setShareModalMode}
        onClose={closeShareModal}
        exportPanel={{
          preview: currentShareText,
          scope: {
            value: exportScope,
            options: [
              { value: 'current', label: '导出当前' },
              { value: 'all', label: '导出全部' },
            ],
            onChange: (value) => setExportScope(value as 'current' | 'all'),
          },
          onCopy: handleCopyShareJson,
          onDownload: handleExportLocalLibrary,
        }}
        importPanel={{
          text: shareImportText,
          error: shareImportError,
          placeholder: '把武器分享 JSON 粘贴到这里，或点击右上角导入文件。',
          onTextChange: (value) => {
            setShareImportText(value);
            if (shareImportError) setShareImportError('');
          },
          onPickFile: handleOpenShareImportPicker,
          onParse: handleParseImportText,
          preview: pendingImportShare ? {
            details: [
              `名称：${pendingImportShare.label}`,
              `武器数：${Object.keys(pendingImportShare.payload).length}`,
            ],
            onClear: handleCancelImportShare,
            onConfirm: handleConfirmImportShare,
          } : undefined,
        }}
      />

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
