import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import './BuffDraftPage.css';
import './OperatorDraftPage.css';
import {
  buildDraftLibraryShareFile,
  buildDraftLibraryShareFileName,
  parseDraftLibraryShareFile,
  type DraftLibraryShareFile,
} from '../utils/draftShare';
import { imageBridge } from '../utils/imageBridge';
import type { ImageAssetEntry } from './ImageManager/types';
import { normalizeExtraHitConfig } from '../core/services/buffExtraHit';
import * as buffModel from './operatorDraftBuffModel';

import * as weaponDraftPageModel from './weaponDraftPageModel';
type WeaponSkillKey = weaponDraftPageModel.WeaponSkillKey;
type WeaponEffectBucket = weaponDraftPageModel.WeaponEffectBucket;
type RawWeaponDraft = weaponDraftPageModel.RawWeaponDraft;
type WeaponDraft = weaponDraftPageModel.WeaponDraft;
type WeaponImageOption = weaponDraftPageModel.WeaponImageOption;
type WeaponSheetRow = weaponDraftPageModel.WeaponSheetRow;
type WeaponWorkbookSelection = weaponDraftPageModel.WeaponWorkbookSelection;
type FormulaBinding = weaponDraftPageModel.FormulaBinding;
type WeaponExplorerDragNode = weaponDraftPageModel.WeaponExplorerDragNode;
type WeaponExplorerDragState = weaponDraftPageModel.WeaponExplorerDragState;
type WeaponSheetContextMenuState = weaponDraftPageModel.WeaponSheetContextMenuState;
type WeaponSheetContextMenuAction = weaponDraftPageModel.WeaponSheetContextMenuAction;


const {
  WEAPON_DRAFT_STORAGE_KEY,
  WEAPON_LIBRARY_STORAGE_KEY,
  WEAPON_LIBRARY_SHARE_TYPE,
  SKILL_KEYS,
  LEVEL_KEYS,
  SKILL1_OPTIONS,
  SKILL2_OPTIONS,
  WEAPON_BUFF_TYPE_OPTIONS,
  cloneValue,
  buildWeaponIdFromName,
  createEmptyWeaponDraft,
  normalizeWeaponDraft,
  projectWeaponEffectForLevel,
  applyWeaponDrawerEffect,
  buildNextCustomWeaponId,
  writeLocalStorageJson,
  loadLocalWeaponLibrary,
  loadDraftFromStorage,
  buildWeaponSheetColumns,
  getBuffTypeDisplayLabel,
  buildBuffTypeSearchText,
  buildWeaponImageOption,
  EFFECT_CATEGORY_OPTIONS,
  getEffectCategory,
  applyAttackGrowthInterpolation,
  applyEffectLevelsInterpolation,
  buildWeaponEffectRowKey,
  buildWeaponEffectLevelsRowKey,
  parseInlineLevelAddress,
  buildWeaponSheetRows,
  buildWeaponWorkbookRows,
  moveRecordEntry,
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
  const [shareImportError, setShareImportError] = useState('');
  const [shareDraftName] = useState('');
  const [pendingImportShare, setPendingImportShare] = useState<DraftLibraryShareFile<WeaponDraft> | null>(null);
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);
  const [shareModalMode, setShareModalMode] = useState<'export' | 'import'>('export');
  const [shareImportText, setShareImportText] = useState('');
  const [exportScope, setExportScope] = useState<'current' | 'all'>('current');
  const [contextMenu, setContextMenu] = useState<WeaponSheetContextMenuState | null>(null);
  const [dragState, setDragState] = useState<WeaponExplorerDragState | null>(null);
  const [buffDrawerTarget, setBuffDrawerTarget] = useState<{ skillKey: WeaponSkillKey; effectKey: string; levelKey: string } | null>(null);
  const shareImportInputRef = useRef<HTMLInputElement>(null);
  const weaponImageFormulaRef = useRef<HTMLDivElement>(null);
  const pendingDragSourceRef = useRef<{ source: WeaponExplorerDragNode; x: number; y: number } | null>(null);
  const dragHoldTimerRef = useRef<number | null>(null);
  const suppressExplorerClickRef = useRef(false);

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

  const formulaBinding = useMemo<FormulaBinding | null>(() => {
    if (!selectedWorkbookSummary) {
      return null;
    }

    // 对于 effectLevels 类型，必须解析 address 来确定具体的 level
    const inlineLevelKey = selectedWorkbookSummary.kind === 'effectLevels'
      ? parseInlineLevelAddress(selectedWorkbookCell?.address)
      : '';

    if (selectedWorkbookSummary.kind === 'weapon') {
      if (selectedWorkbookCell?.columnKey === 'slot') {
        return {
          key: 'weapon:imgUrl',
          focusId: 'weapon-img-url',
          inputMode: 'text',
          control: 'image-search-select',
          value: draft.imgUrl,
          placeholder: '搜索武器主图',
          apply: (baseDraft, rawInput) => ({ ...baseDraft, imgUrl: rawInput.trim() }),
        };
      }
      if (selectedWorkbookCell?.columnKey === 'idText') {
        return {
          key: 'weapon:id',
          focusId: 'weapon-id',
          inputMode: 'text',
          value: draft.id,
          placeholder: '武器 ID',
          apply: (baseDraft, rawInput) => ({ ...baseDraft, id: rawInput.trim() || baseDraft.id }),
        };
      }
      if (selectedWorkbookCell?.columnKey === 'valueText') {
        return {
          key: 'weapon:rarity',
          focusId: 'weapon-rarity',
          inputMode: 'number',
          value: String(draft.rarity),
          placeholder: '稀有度',
          apply: (baseDraft, rawInput) => {
            const parsed = Number(rawInput);
            return { ...baseDraft, rarity: Number.isFinite(parsed) ? parsed : baseDraft.rarity };
          },
        };
      }
      if (selectedWorkbookCell?.columnKey === 'description') {
        return {
          key: 'weapon:description',
          focusId: 'weapon-description',
          inputMode: 'text',
          value: draft.description,
          placeholder: '武器描述',
          apply: (baseDraft, rawInput) => ({ ...baseDraft, description: rawInput }),
        };
      }
      return {
        key: 'weapon:name',
        focusId: 'weapon-name',
        inputMode: 'text',
        value: draft.name,
        placeholder: '武器名称',
        apply: (baseDraft, rawInput) => ({
          ...baseDraft,
          name: rawInput,
          id: buildWeaponIdFromName(rawInput) || baseDraft.id,
        }),
      };
    }

    if (selectedWorkbookSummary.kind === 'growth') {
      return null;
    }

    if (selectedWorkbookSummary.kind === 'skill') {
      const targetSkill = draft.skills[selectedWorkbookSummary.skillKey];
      const skillKey = selectedWorkbookSummary.skillKey;
      const statOptions = skillKey === 'skill1'
        ? SKILL1_OPTIONS.map((value) => ({ value, label: value }))
        : skillKey === 'skill2'
          ? SKILL2_OPTIONS.map((value) => ({ value, label: value }))
          : null;
      if (selectedWorkbookCell?.columnKey === 'slot') {
        return {
          key: `${skillKey}:statType`,
          focusId: 'skill-stat-type',
          inputMode: 'text',
          control: statOptions ? 'select' : 'input',
          value: targetSkill.statType,
          placeholder: 'skill statType',
          options: statOptions ?? undefined,
          apply: (baseDraft, rawInput) => ({
            ...baseDraft,
            skills: {
              ...baseDraft.skills,
              [skillKey]: {
                ...baseDraft.skills[skillKey],
                statType: rawInput,
              },
            },
          }),
        };
      }
      return {
        key: `${skillKey}:name`,
        focusId: 'skill-name',
        inputMode: 'text',
        value: targetSkill.name,
        placeholder: 'skill 名称',
        readOnly: skillKey !== 'skill3',
        apply: (baseDraft, rawInput) => ({
          ...baseDraft,
          skills: {
            ...baseDraft.skills,
            [skillKey]: {
              ...baseDraft.skills[skillKey],
              name: rawInput,
            },
          },
        }),
      };
    }

    if (selectedWorkbookSummary.kind === 'effect') {
      const { skillKey, bucket, sourceEffectKey } = selectedWorkbookSummary;
      const fixedStatOptions = skillKey === 'skill1'
        ? SKILL1_OPTIONS.map((value) => ({ value, label: value }))
        : skillKey === 'skill2'
          ? SKILL2_OPTIONS.map((value) => ({ value, label: value }))
          : null;
      const buffTypeOptions = [
        { value: '', label: '未设置类型' },
        ...WEAPON_BUFF_TYPE_OPTIONS.map((value) => ({ value, label: getBuffTypeDisplayLabel(value) })),
      ];
      if (
        selectedWorkbookCell?.columnKey === 'name'
        || selectedWorkbookCell?.columnKey === 'idText'
        || selectedWorkbookCell?.columnKey === 'slot'
      ) {
        if (selectedWorkbookCell?.columnKey === 'name') {
          if (fixedStatOptions && bucket === 'value') {
            return {
              key: `${skillKey}:fixed-effect-name`,
              focusId: 'fixed-effect-name',
              inputMode: 'text',
              control: 'select',
              value: draft.skills[skillKey].statType,
              placeholder: '',
              options: fixedStatOptions,
              apply: (baseDraft, rawInput) => ({
                ...baseDraft,
                skills: {
                  ...baseDraft.skills,
                  [skillKey]: {
                    ...baseDraft.skills[skillKey],
                    statType: rawInput,
                  },
                },
              }),
            };
          }
          return {
            key: `${skillKey}:effect-name`,
            focusId: 'effect-name',
            inputMode: 'text',
            value: draft.skills[skillKey].effects[sourceEffectKey].name,
            placeholder: '效果名称',
            readOnly: bucket === 'value',
            apply: (baseDraft, rawInput) => {
              if (bucket === 'value') {
                return baseDraft;
              }
              const trimmed = rawInput.trim();
              if (!trimmed) {
                return baseDraft;
              }
              const nextEffects = { ...baseDraft.skills[skillKey].effects };
              if (nextEffects[sourceEffectKey]) {
                nextEffects[sourceEffectKey] = {
                  ...nextEffects[sourceEffectKey],
                  name: trimmed,
                };
              }
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
            },
          };
        }
        if (selectedWorkbookCell?.columnKey === 'slot' && skillKey === 'skill3' && bucket !== 'value') {
          return {
            key: `${skillKey}:effect:${sourceEffectKey}:effect-category`,
            focusId: 'effect-category',
            inputMode: 'text',
            control: 'select',
            value: getEffectCategory(skillKey, draft.skills[skillKey], sourceEffectKey),
            placeholder: '',
            options: EFFECT_CATEGORY_OPTIONS,
            apply: (baseDraft, rawInput) => {
              const businessType = buffModel.OPERATOR_BUFF_BUSINESS_TYPES.includes(rawInput as buffModel.OperatorBuffBusinessType)
                ? rawInput as buffModel.OperatorBuffBusinessType
                : 'condition';
              const nextEffects = { ...baseDraft.skills[skillKey].effects };
              const current = nextEffects[sourceEffectKey];
              if (!current) return baseDraft;
              const projected = projectWeaponEffectForLevel(sourceEffectKey, current, '9');
              const nextEffect = buffModel.applyBuffBusinessType(projected, businessType, sourceEffectKey);
              nextEffects[sourceEffectKey] = applyWeaponDrawerEffect(current, '9', nextEffect);
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
            },
          };
        }
        return {
          key: `${skillKey}:${bucket}:${sourceEffectKey}:${selectedWorkbookCell?.columnKey}`,
          focusId: `effect-${selectedWorkbookCell?.columnKey}`,
          inputMode: 'text',
          readOnly: true,
          value:
            selectedWorkbookCell?.columnKey === 'idText'
                ? selectedWorkbookSummary.idText
                : selectedWorkbookCell?.columnKey === 'slot'
                  ? selectedWorkbookSummary.slot
                  : '',
          placeholder: '',
          apply: (baseDraft) => baseDraft,
        };
      }

      if (selectedWorkbookCell?.columnKey === 'effectKey') {
        if (bucket === 'value') {
          return {
            key: `${skillKey}:value:key`,
            focusId: 'effect-key',
            inputMode: 'text',
            readOnly: true,
            value: 'value',
            placeholder: '',
            apply: (baseDraft) => baseDraft,
          };
        }
        if (skillKey === 'skill3') {
          const selectedEffect = draft.skills[skillKey].effects[sourceEffectKey];
          if (selectedEffect?.effectKind === 'extraHit') {
            const config = normalizeExtraHitConfig(selectedEffect.extraHitConfig, `${sourceEffectKey}-extra-hit`);
            return {
              key: `${skillKey}:effect:${sourceEffectKey}:extra-hit-types`,
              focusId: 'effect-extra-hit-types',
              inputMode: 'text',
              readOnly: true,
              value: `${config.damageType} / ${config.skillType || '空'}`,
              placeholder: '',
              apply: (baseDraft) => baseDraft,
            };
          }
          return {
            key: `${skillKey}:effect:${sourceEffectKey}:buff-type`,
            focusId: 'effect-buff-type',
            inputMode: 'text',
            control: 'search-select',
            value: draft.skills[skillKey].effects[sourceEffectKey]?.type ?? '',
            placeholder: '',
            options: buffTypeOptions,
            apply: (baseDraft, rawInput) => {
              const trimmed = rawInput.trim();
              const nextEffects = { ...baseDraft.skills[skillKey].effects };
              if (nextEffects[sourceEffectKey]) {
                nextEffects[sourceEffectKey] = {
                  ...nextEffects[sourceEffectKey],
                  type: trimmed,
                };
              }
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
            },
          };
        }
        return {
          key: `${skillKey}:${bucket}:${sourceEffectKey}:key`,
          focusId: 'effect-key',
          inputMode: 'text',
          value: sourceEffectKey,
          placeholder: '效果键',
          readOnly: true,
          apply: (baseDraft) => baseDraft,
        };
      }

      if (selectedWorkbookCell?.columnKey === 'description') {
        return {
          key: `${skillKey}:${bucket}:${sourceEffectKey}:description`,
          focusId: 'effect-description',
          inputMode: 'text',
          value: '',
          placeholder: '效果描述',
          readOnly: true,
          apply: (baseDraft) => baseDraft,
        };
      }

      return null;
    }

    if (selectedWorkbookSummary.kind === 'effectLevels') {
      if (inlineLevelKey) {
        const rawValue = selectedWorkbookSummary.bucket === 'value'
          ? draft.skills[selectedWorkbookSummary.skillKey].levels[inlineLevelKey]?.value
          : draft.skills[selectedWorkbookSummary.skillKey].effects[selectedWorkbookSummary.sourceEffectKey]?.levels[inlineLevelKey];
        return {
          key: `${selectedWorkbookSummary.skillKey}:${selectedWorkbookSummary.bucket}:${selectedWorkbookSummary.sourceEffectKey}:level:${inlineLevelKey}:${selectedWorkbookCell?.address ?? ''}`,
          focusId: 'effect-level-value',
          inputMode: 'number',
          value: rawValue == null ? '' : String(rawValue),
          placeholder: '',
          apply: (baseDraft, rawInput) => {
            const parsed = Number(rawInput);
            if (selectedWorkbookSummary.bucket === 'value') {
              const nextLevels = { ...baseDraft.skills[selectedWorkbookSummary.skillKey].levels };
              nextLevels[inlineLevelKey] = {
                ...nextLevels[inlineLevelKey],
                value: rawInput.trim() && Number.isFinite(parsed) ? parsed : undefined,
              };
              return {
                ...baseDraft,
                skills: {
                  ...baseDraft.skills,
                  [selectedWorkbookSummary.skillKey]: {
                    ...baseDraft.skills[selectedWorkbookSummary.skillKey],
                    levels: nextLevels,
                  },
                },
              };
            }
            const nextEffects = { ...baseDraft.skills[selectedWorkbookSummary.skillKey].effects };
            if (nextEffects[selectedWorkbookSummary.sourceEffectKey]) {
              const nextLevels = { ...nextEffects[selectedWorkbookSummary.sourceEffectKey].levels };
              if (rawInput.trim() && Number.isFinite(parsed)) {
                nextLevels[inlineLevelKey] = parsed;
              } else {
                delete nextLevels[inlineLevelKey];
              }
              nextEffects[selectedWorkbookSummary.sourceEffectKey] = {
                ...nextEffects[selectedWorkbookSummary.sourceEffectKey],
                levels: nextLevels,
              };
            }
            return {
              ...baseDraft,
              skills: {
                ...baseDraft.skills,
                [selectedWorkbookSummary.skillKey]: {
                  ...baseDraft.skills[selectedWorkbookSummary.skillKey],
                  effects: nextEffects,
                },
              },
            };
          },
        };
      }
      return {
        key: `${selectedWorkbookSummary.skillKey}:${selectedWorkbookSummary.bucket}:${selectedWorkbookSummary.sourceEffectKey}:levels`,
        focusId: 'effect-levels',
        inputMode: 'text',
        readOnly: true,
        value: 'Lv1~Lv9',
        placeholder: '',
        apply: (baseDraft) => baseDraft,
      };
    }

    return null;
  }, [draft, selectedWorkbookCell?.columnKey, selectedWorkbookCell?.address, selectedWorkbookCell?.sourceRowKey, selectedWorkbookSummary]);

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

  const currentShareFile = useMemo(() => {
    // 根据导出范围生成 payload
    let payload: Record<string, WeaponDraft>;
    let label: string;
    if (exportScope === 'current') {
      // 导出当前：payload 只包含当前 draft
      payload = draft.id ? { [draft.id]: draft } : {};
      label = draft.name || 'weapon';
    } else {
      // 导出全部：payload 为整个 localLibrary，当前 draft 覆盖同 id 条目
      payload = { ...localLibrary };
      if (draft.id) {
        payload[draft.id] = draft;
      }
      label = shareDraftName || draft.name || 'weapon-library';
    }
    return buildDraftLibraryShareFile(
      WEAPON_LIBRARY_SHARE_TYPE,
      payload,
      label,
    );
  }, [draft, exportScope, localLibrary, shareDraftName]);

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
    const parsed = parseDraftLibraryShareFile(rawText, WEAPON_LIBRARY_SHARE_TYPE);
    if (!parsed) {
      setPendingImportShare(null);
      setShareImportError('导入失败：文件不是有效的武器库分享 JSON。');
      return;
    }
    const normalizedPayload = Object.fromEntries(
      Object.entries(parsed.payload).map(([draftId, draftValue]) => [draftId, normalizeWeaponDraft({ ...(draftValue as RawWeaponDraft), id: draftId })]),
    ) as Record<string, WeaponDraft>;
    if (Object.keys(normalizedPayload).length === 0) {
      setPendingImportShare(null);
      setShareImportError('JSON 中没有可导入的有效武器。');
      return;
    }
    setShareImportError('');
    setPendingImportShare({
      ...parsed,
      payload: normalizedPayload,
    } as DraftLibraryShareFile<WeaponDraft>);
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
    const nextLibrary = {
      ...localLibrary,
      ...pendingImportShare.payload,
    };
    const nextDraftId = Object.keys(pendingImportShare.payload)[0] ?? '';
    const nextDraft = nextDraftId && nextLibrary[nextDraftId]
      ? nextLibrary[nextDraftId]
      : draft;
    persistLibraryState(nextLibrary, nextDraft, nextDraftId || selectedLocalDraftId || draft.id);
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
  const getExplorerDragNodeKey = useCallback((node: WeaponExplorerDragNode) => {
    if (node.kind === 'draft') {
      return `draft:${node.draftId}`;
    }
    if (node.kind === 'skill') {
      return `skill:${node.draftId}:${node.skillKey}`;
    }
    return `effect:${node.draftId}:${node.skillKey}:${node.bucket}:${node.effectKey}`;
  }, []);

  const getExplorerDragNodeLabel = useCallback((node: WeaponExplorerDragNode) => {
    const targetDraft = localLibrary[node.draftId];
    if (!targetDraft) {
      return node.draftId;
    }
    if (node.kind === 'draft') {
      return targetDraft.name || node.draftId;
    }
    if (node.kind === 'skill') {
      return targetDraft.skills[node.skillKey]?.name || node.skillKey;
    }
    const skill = targetDraft.skills[node.skillKey];
    if (!skill) {
      return node.effectKey;
    }
    //这里对了
    return skill.effects[node.effectKey].name;
    
  }, [localLibrary]);

  const clearPendingExplorerDrag = useCallback(() => {
    if (dragHoldTimerRef.current !== null) {
      window.clearTimeout(dragHoldTimerRef.current);
      dragHoldTimerRef.current = null;
    }
    pendingDragSourceRef.current = null;
  }, []);

  const canStartExplorerDrag = useCallback((node: WeaponExplorerDragNode) => {
    if (filterKeyword.trim()) {
      return false;
    }
    // 只允许 skill3 的 effect 拖拽
    if (node.kind === 'effect') {
      return node.skillKey === 'skill3';
    }
    // draft 和 skill 不允许拖拽
    return false;
  }, [filterKeyword]);

  const isValidExplorerDropTarget = useCallback((source: WeaponExplorerDragNode, target: WeaponExplorerDragNode | null) => {
    if (!target || source.kind !== target.kind) {
      return false;
    }
    if (getExplorerDragNodeKey(source) === getExplorerDragNodeKey(target)) {
      return false;
    }
    if (target.kind === 'draft') {
      return canStartExplorerDrag(source) && canStartExplorerDrag(target);
    }
    if (target.kind === 'skill') {
      return source.draftId === target.draftId && canStartExplorerDrag(source) && canStartExplorerDrag(target);
    }
    if (source.kind !== 'effect') {
      return false;
    }
    return source.draftId === target.draftId && source.skillKey === target.skillKey && source.bucket === target.bucket && source.bucket !== 'value';
  }, [canStartExplorerDrag, getExplorerDragNodeKey]);

  const resolveExplorerDragNodeFromElement = useCallback((element: Element | null): WeaponExplorerDragNode | null => {
    const row = element instanceof HTMLElement ? element.closest<HTMLElement>('[data-weapon-drag-kind]') : null;
    if (!row) {
      return null;
    }
    const kind = row.dataset.weaponDragKind as WeaponExplorerDragNode['kind'] | undefined;
    const draftId = row.dataset.weaponDraftId;
    if (!kind || !draftId) {
      return null;
    }
    if (kind === 'draft') {
      return { kind, draftId };
    }
    const skillKey = row.dataset.weaponSkillKey as WeaponSkillKey | undefined;
    if (!skillKey) {
      return null;
    }
    if (kind === 'skill') {
      return { kind, draftId, skillKey };
    }
    const bucket = row.dataset.weaponBucket as WeaponEffectBucket | undefined;
    const effectKey = row.dataset.weaponEffectKey;
    if (!bucket || !effectKey) {
      return null;
    }
    return { kind: 'effect', draftId, skillKey, bucket, effectKey };
  }, []);

  const applyExplorerReorder = useCallback((source: WeaponExplorerDragNode, target: WeaponExplorerDragNode) => {
    if (!isValidExplorerDropTarget(source, target)) {
      return;
    }

    if (source.kind === 'draft' && target.kind === 'draft') {
      // Reorder drafts in library
      const nextLibrary = moveRecordEntry(localLibrary, source.draftId, target.draftId);
      setLocalLibrary(nextLibrary);
      window.localStorage.setItem(WEAPON_LIBRARY_STORAGE_KEY, JSON.stringify(nextLibrary));
    } else if (source.kind === 'skill' && target.kind === 'skill' && source.draftId === target.draftId) {
      // Reorder skills within a draft (SKILL_KEYS is fixed order, so we need to reorder effectTypes instead)
      const targetDraft = localLibrary[source.draftId] || draft;
      const nextDraft = { ...targetDraft };
      // Skills are fixed (skill1, skill2, skill3), so we reorder their effectTypes
      // This is a simplified implementation
      setDraft(nextDraft);
      window.localStorage.setItem(WEAPON_DRAFT_STORAGE_KEY, JSON.stringify(nextDraft));
    } else if (source.kind === 'effect' && target.kind === 'effect' && source.draftId === target.draftId && source.skillKey === target.skillKey && source.bucket === target.bucket && source.bucket !== 'value') {
      // effects record 的插入顺序即显示顺序，拖拽直接移动 entry
      const targetDraft = localLibrary[source.draftId] || draft;
      const nextEffects = moveRecordEntry(targetDraft.skills[source.skillKey].effects, source.effectKey, target.effectKey);
      const nextDraft: WeaponDraft = {
        ...targetDraft,
        skills: {
          ...targetDraft.skills,
          [source.skillKey]: {
            ...targetDraft.skills[source.skillKey],
            effects: nextEffects,
          },
        },
      };
      if (targetDraft.id === draft.id) {
        setDraft(nextDraft);
      }
      const nextLibrary = { ...localLibrary, [source.draftId]: nextDraft };
      setLocalLibrary(nextLibrary);
      window.localStorage.setItem(WEAPON_LIBRARY_STORAGE_KEY, JSON.stringify(nextLibrary));
    }
  }, [draft, isValidExplorerDropTarget, localLibrary]);

  const handleExplorerPointerDown = useCallback((event: React.PointerEvent, source: WeaponExplorerDragNode) => {
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

  const formatWeaponExplorerDragKindLabel = (kind: WeaponExplorerDragNode['kind']): string => {
    if (kind === 'draft') {
      return '武器';
    }
    if (kind === 'skill') {
      return '技能';
    }
    return '效果';
  };

  // Explorer drag global event listeners
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
