import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import './BuffDraftPage.css';
import './OperatorDraftPage.css';
import { imageBridge } from '../utils/imageBridge';
import type { ImageAssetEntry } from './ImageManager/types';

import * as weaponDraftPageModel from './weaponDraftPageModel';
import { useWeaponExplorerDrag } from './useWeaponExplorerDrag';
import { useWeaponDraftShare } from './useWeaponDraftShare';
import { buildWeaponFormulaBinding } from './weaponDraftFormula';
type WeaponSkillKey = weaponDraftPageModel.WeaponSkillKey;
type WeaponEffectBucket = weaponDraftPageModel.WeaponEffectBucket;
type WeaponDraft = weaponDraftPageModel.WeaponDraft;
type WeaponImageOption = weaponDraftPageModel.WeaponImageOption;
type WeaponSheetRow = weaponDraftPageModel.WeaponSheetRow;
type WeaponWorkbookSelection = weaponDraftPageModel.WeaponWorkbookSelection;
type WeaponSheetContextMenuState = weaponDraftPageModel.WeaponSheetContextMenuState;
type WeaponSheetContextMenuAction = weaponDraftPageModel.WeaponSheetContextMenuAction;


const {
  WEAPON_DRAFT_STORAGE_KEY,
  WEAPON_LIBRARY_STORAGE_KEY,
  SKILL_KEYS,
  LEVEL_KEYS,
  WEAPON_BUFF_TYPE_OPTIONS,
  cloneValue,
  createEmptyWeaponDraft,
  normalizeWeaponDraft,
  projectWeaponEffectForLevel,
  buildNextCustomWeaponId,
  writeLocalStorageJson,
  loadLocalWeaponLibrary,
  loadDraftFromStorage,
  buildWeaponSheetColumns,
  buildBuffTypeSearchText,
  buildWeaponImageOption,
  applyAttackGrowthInterpolation,
  applyEffectLevelsInterpolation,
  buildWeaponEffectRowKey,
  buildWeaponEffectLevelsRowKey,
  buildWeaponSheetRows,
  buildWeaponWorkbookRows,
  reorderWeaponDraft,
} = weaponDraftPageModel;

export function useWeaponDraftPageController() {
  const [draft, setDraft] = useState<WeaponDraft>(() => loadDraftFromStorage());
  const [localLibrary, setLocalLibrary] = useState<Record<string, WeaponDraft>>(() => loadLocalWeaponLibrary());
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
  const [contextMenu, setContextMenu] = useState<WeaponSheetContextMenuState | null>(null);
  const [buffDrawerTarget, setBuffDrawerTarget] = useState<{ skillKey: WeaponSkillKey; effectKey: string; levelKey: string } | null>(null);
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
    writeLocalStorageJson(WEAPON_LIBRARY_STORAGE_KEY, nextLibrary);
    writeLocalStorageJson(WEAPON_DRAFT_STORAGE_KEY, nextDraft);
    setLocalLibrary(nextLibrary);
    setDraft(nextDraft);
    setSelectedLocalDraftId(nextSelectedId);
  }, []);

  const persistDraftToLibrary = useCallback((allowOverwrite: boolean) => {
    const nextDraft = commitFormulaInput(draft);
    const library = loadLocalWeaponLibrary();
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
      writeLocalStorageJson(WEAPON_DRAFT_STORAGE_KEY, draft);
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
    updater: (baseDraft: WeaponDraft) => WeaponDraft,
    options?: { focusRowKey?: string; selectAfter?: boolean },
  ) => {
    const baseDraft = draftId === selectedLocalDraftId ? commitFormulaInput(draft) : cloneValue(localLibrary[draftId]);
    if (!baseDraft) {
      return;
    }
    const nextDraft = normalizeWeaponDraft(updater(cloneValue(baseDraft)));
    const nextLibrary = {
      ...localLibrary,
      [draftId]: nextDraft,
    };
    if (draftId === selectedLocalDraftId || options?.selectAfter) {
      persistLibraryState(nextLibrary, nextDraft, draftId);
    } else {
      writeLocalStorageJson(WEAPON_LIBRARY_STORAGE_KEY, nextLibrary);
      setLocalLibrary(nextLibrary);
    }
    if (options?.focusRowKey) {
      setPendingFocusRowKey(options.focusRowKey);
    }
  }, [commitFormulaInput, draft, localLibrary, persistLibraryState, selectedLocalDraftId]);

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
    let createdEffectKey = 'effect1';
    updateLibraryDraft(draftId, (baseDraft) => {
      let effectIndex = 1;
      while (baseDraft.skills[skillKey].effects[`effect${effectIndex}`]) {
        effectIndex += 1;
      }
      const effectKey = `effect${effectIndex}`;
      createdEffectKey = effectKey;
      const nextEffects = { ...baseDraft.skills[skillKey].effects };
      const levels: Record<string, number> = {};
      LEVEL_KEYS.forEach((levelKey) => { levels[levelKey] = 0; });
      nextEffects[effectKey] = {
        schemaVersion: 2,
        effectId: effectKey,
        name: effectKey,
        type: '',
        category: 'condition',
        levels,
        valueMode: 'fixed',
        effectKind: 'modifier',
      };
      return {
        ...baseDraft,
        skills: {
          ...baseDraft.skills,
          [skillKey]: {
            ...baseDraft.skills[skillKey],
            effects: nextEffects,
          },
        },
      };
    }, {
      selectAfter: true,
      focusRowKey: buildWeaponEffectRowKey(skillKey, 'effect', `effect${Object.keys((localLibrary[draftId] ?? draft).skills[skillKey].effects).length + 1}`),
    });
    if (skillKey === 'skill3') setBuffDrawerTarget({ skillKey, effectKey: createdEffectKey, levelKey: '9' });
  }, [draft, localLibrary, updateLibraryDraft]);

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
    writeLocalStorageJson(WEAPON_LIBRARY_STORAGE_KEY, nextLibrary);
    setLocalLibrary(nextLibrary);
  }, [localLibrary, persistLibraryState, selectedLocalDraftId]);

  const handleDeleteDraftEffect = useCallback((draftId: string, skillKey: WeaponSkillKey, bucket: WeaponEffectBucket, effectKey: string) => {
    updateLibraryDraft(draftId, (baseDraft) => {
      if (bucket === 'value') {
        const nextLevels = { ...baseDraft.skills[skillKey].levels };
        LEVEL_KEYS.forEach((levelKey) => {
          nextLevels[levelKey] = { ...nextLevels[levelKey], value: undefined };
        });
        return {
          ...baseDraft,
          skills: {
            ...baseDraft.skills,
            [skillKey]: { ...baseDraft.skills[skillKey], levels: nextLevels },
          },
        };
      }
      const nextEffects = { ...baseDraft.skills[skillKey].effects };
      delete nextEffects[effectKey];
      return {
        ...baseDraft,
        skills: {
          ...baseDraft.skills,
          [skillKey]: { ...baseDraft.skills[skillKey], effects: nextEffects },
        },
      };
    }, {
      selectAfter: true,
      focusRowKey: `skill-${skillKey}`,
    });
  }, [updateLibraryDraft]);

  const handleDuplicateDraftEffect = useCallback((draftId: string, skillKey: WeaponSkillKey, bucket: WeaponEffectBucket, effectKey: string) => {
    const currentSkill = draft.skills[skillKey];
    if (bucket === 'value') {
      // value 效果不可复制
      return;
    }
    let effectIndex = 1;
    while (currentSkill.effects[`effect${effectIndex}`]) {
      effectIndex += 1;
    }
    const newEffectKey = `effect${effectIndex}`;
    const sourceEffect = currentSkill.effects[effectKey];
    if (!sourceEffect) return;

    updateLibraryDraft(draftId, (baseDraft) => {
      const nextEffects = { ...baseDraft.skills[skillKey].effects };
      nextEffects[newEffectKey] = { ...sourceEffect };
      return {
        ...baseDraft,
        skills: {
          ...baseDraft.skills,
          [skillKey]: { ...baseDraft.skills[skillKey], effects: nextEffects },
        },
      };
    }, {
      selectAfter: true,
      focusRowKey: buildWeaponEffectRowKey(skillKey, 'effect', newEffectKey),
    });
    if (skillKey === 'skill3') setBuffDrawerTarget({ skillKey, effectKey: newEffectKey, levelKey: '9' });
  }, [draft, updateLibraryDraft]);

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

  const {
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
    shareImportInputRef,
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
  } = useWeaponDraftShare({
    draft,
    localLibrary,
    persistLibraryState,
    selectedLocalDraftId,
  });

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

  const {
    dragState,
    suppressExplorerClickRef,
    getExplorerDragNodeKey,
    getExplorerDragNodeLabel,
    canStartExplorerDrag,
    handleExplorerPointerDown,
    formatWeaponExplorerDragKindLabel,
  } = useWeaponExplorerDrag({
    draft,
    filterKeyword,
    localLibrary,
    setContextMenu,
    setDraft,
    setLocalLibrary,
  });

  return {
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
  };
}

export type WeaponDraftPageController = ReturnType<typeof useWeaponDraftPageController>;
