import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import type { SkillButton as SkillButtonType, TimelineData } from '../../types';
import { SKILL_LABELS } from '../../types';
import {
  removeSkillButtonBuff,
  decrementSkillButtonBuffStack,
  getButtonBuffs,
  recomputeSkillButtonPanel,
  addSkillButtonBuff,
} from '../../hooks/useSkillButtonBuffs';
import type { HitResistanceInput, SkillButtonBuff, SkillLevelMode } from '../../types/storage';
import { getCharacterConfig } from '../../utils/storage';
import { getOperatorConfigPageCache } from '../../core/repositories/operatorConfigRepository';
import { getSkillButtonById, upsertSkillButton } from '../../core/repositories';
import { APP_ROUTE_PATHS, navigateToAppPath } from '../../utils/appRoute';
import { resolveSkillDamageTemplate } from '../../core/services/skillDamageTemplateResolver';
import type { ResolvedSkillDamageTemplate } from '../../core/calculators/skillDamage.types';
import { useAppContext } from '../../context/AppContext';
import { emitSkillButtonBuffAdded, emitSkillButtonBuffRemoved } from '../../core/events/buffEvents';
import { buildBuffSearchIndex, searchBuffs } from '../../utils/buffFuzzySearch';
import { refreshSnapshotCandidateBuffsForCharacterIds } from '../../core/services/operatorConfigCandidateBuffService';
import { refreshOperatorConfigSnapshotsForCharacters } from '../../core/services/operatorConfigSnapshotRefreshService';
import {
  dedupeLocalBuffSearchResults,
  getNormalHitSegmentKey,
  isExtraHitBuff,
  isModifierBuff,
  type LocalBuffSearchResult,
  type BuffSourceSearchMode,
  BUFF_SOURCE_SEARCH_MODE_OPTIONS,
  filterBuffSearchEntriesBySourceMode,
  readCandidateBuffSearchEntries,
  readLocalBuffSearchEntries,
} from './skillButton.shared';

const EMPTY_TARGET_RESISTANCE: Required<HitResistanceInput> = {
  physicalResistance: 0,
  fireResistance: 0,
  electricResistance: 0,
  iceResistance: 0,
  natureResistance: 0,
};

type BuffSearchMode = BuffSourceSearchMode | 'anomaly' | 'anomaly-state' | 'state';
type OperatorBuffGroupFilter = 'talent' | 'potential' | 'skill';

const BUFF_SEARCH_MODE_OPTIONS: Array<{ key: BuffSearchMode; label: string }> = [
  ...BUFF_SOURCE_SEARCH_MODE_OPTIONS,
  { key: 'anomaly', label: '异常伤害' },
  { key: 'anomaly-state', label: '异常状态区' },
  { key: 'state', label: '状态区' },
];

const SOURCE_BUFF_SEARCH_MODES = new Set<BuffSearchMode>(BUFF_SOURCE_SEARCH_MODE_OPTIONS.map((option) => option.key));
function isSourceBuffSearchMode(mode: BuffSearchMode): mode is BuffSourceSearchMode {
  return SOURCE_BUFF_SEARCH_MODES.has(mode);
}

function getNextBuffSearchMode(mode: BuffSearchMode): BuffSearchMode {
  const index = BUFF_SEARCH_MODE_OPTIONS.findIndex((option) => option.key === mode);
  return BUFF_SEARCH_MODE_OPTIONS[(index + 1) % BUFF_SEARCH_MODE_OPTIONS.length].key;
}

const CHINESE_POTENTIAL_NUMBERS: Record<string, number> = {
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
};

function getRequiredPotentialCount(buffName: string): number | null {
  const normalizedName = buffName.replace(/\s+/g, '');
  const suffixMatch = normalizedName.match(/潜能([1-6一二三四五六])/);
  const prefixMatch = normalizedName.match(/([1-6一二三四五六])潜/);
  const token = suffixMatch?.[1] ?? prefixMatch?.[1];
  if (!token) {
    return null;
  }
  return CHINESE_POTENTIAL_NUMBERS[token] ?? Number(token);
}

const BROWSE_MODE_SKILL_LABELS: Record<string, string> = {
  A: '重击',
  B: '战技',
  E: '连携技',
  Q: '终结技',
  Dot: '持续',
};

interface UseSkillButtonRuntimeParams {
  button: SkillButtonType & { nodeNumber?: number };
  size: number;
  timelineData?: TimelineData;
  isDetailRouteActive: boolean;
  isBrowseMode: boolean;
  contextMenuState?: { buttonId: string; position: { x: number; y: number } } | null;
  onModalClose?: () => void;
}

export function useSkillButtonRuntime({
  button,
  size,
  timelineData,
  isDetailRouteActive,
  isBrowseMode,
  contextMenuState,
  onModalClose,
}: UseSkillButtonRuntimeParams) {
  const { position, skillType, isSelected, isDragging, characterName, skillIconUrl, element, isLocked, skillDisplayName } = button;
  const displayName = skillDisplayName || SKILL_LABELS[skillType];
  const browseModeDisplayName = BROWSE_MODE_SKILL_LABELS[skillType] ?? displayName;
  const isDotButton = button.skillType === 'Dot';
  const { state, dispatch, refreshSelectedCharacters } = useAppContext();
  const radius = size / 2;
  const baseWidth = 80;
  const baseHeight = 30;
  const visualOffsetX = 40;
  const visualOffsetY = 15;
  const hitWidth = radius + baseWidth;
  const hitHeight = Math.max(size, radius + baseHeight);
  const shouldRenderContextMenu = !isBrowseMode && contextMenuState?.buttonId === button.id && typeof document !== 'undefined';

  const isModalOpen = isDetailRouteActive;
  // 当前技能按钮的 Buff 列表
  const [buffList, setBuffList] = useState<SkillButtonBuff[]>([]);
  // 当前角色的技能等级模式 (L9/M3)
  const [skillLevelModeMap, setSkillLevelModeMap] = useState<Record<string, SkillLevelMode>>({ A: 'L9', B: 'L9', E: 'L9', Q: 'L9', Dot: 'M3' });
  const currentSkillLevelMode = skillLevelModeMap[skillType] ?? 'M3';
  // 已解析的技能伤害模板（skill 是容器，hit 是计算单元）
  const [resolvedTemplate, setResolvedTemplate] = useState<ResolvedSkillDamageTemplate | null>(null);
  const [targetResistance, setTargetResistance] = useState<Required<HitResistanceInput>>(EMPTY_TARGET_RESISTANCE);

  // 当前选中的 hit（用于详情展示）
  const [selectedHitIndex, setSelectedHitIndex] = useState<number | null>(null);

  // 面板数据 (ATK、暴击、伤害加成等)
  const [panelData, setPanelData] = useState<{
    atk: number;
    critRate: number;
    critDmg: number;
    physicalDmgBonus: number;
    fireDmgBonus: number;
    electricDmgBonus: number;
    iceDmgBonus: number;
    natureDmgBonus: number;
    skillDmgBonus: number;
    chainSkillDmgBonus: number;
    ultimateDmgBonus: number;
    allSkillDmgBonus: number;
    allDmgBonus: number;
  } | null>(null);
  // 计算过程展开状态
  const [isExpanded, setIsExpanded] = useState(false);
  // infoSnapshot 数据（从 sessionStorage 只读，不影响原数据）
  const [infoSnapshotLines, setInfoSnapshotLines] = useState<string[]>([]);
  // infoSnap JSON 数据（从 sessionStorage 只读，不影响原数据）
  const [infoSnap, setInfoSnap] = useState<Record<string, number>>({});
  const [selectedAnomalySegmentKey, setSelectedAnomalySegmentKey] = useState<string | null>(null);
  const [isAnomalyFormulaExpanded, setIsAnomalyFormulaExpanded] = useState(false);
  const [isTargetResistanceExpanded, setIsTargetResistanceExpanded] = useState(false);
  const [isLocalBuffSearchOpen, setIsLocalBuffSearchOpen] = useState(false);
  const [localBuffSearchKeyword, setLocalBuffSearchKeyword] = useState('');
  const [buffSearchMode, setBuffSearchMode] = useState<BuffSearchMode>('buff-group');
  const [operatorCharacterFilter, setOperatorCharacterFilter] = useState<string | null>(null);
  const [operatorBuffGroupFilter, setOperatorBuffGroupFilter] = useState<OperatorBuffGroupFilter | null>(null);
  const [candidateBuffRefreshToken, setCandidateBuffRefreshToken] = useState(0);
  const [manuallyDisabledBuffIdsBySegmentKey, setManuallyDisabledBuffIdsBySegmentKey] = useState<Record<string, string[]>>({});
  const [globallyDisabledBuffIds, setGloballyDisabledBuffIds] = useState<string[]>([]);
  const [manualBuffStackCountsBySegmentKey, setManualBuffStackCountsBySegmentKey] = useState<Record<string, Record<string, number>>>({});
  const [manuallyDisabledHitKeys, setManuallyDisabledHitKeys] = useState<string[]>([]);

  // 图标加载失败状态，用于 CSS 类切换
  const [iconLoadFailed, setIconLoadFailed] = useState(false);

  // 用于区分单击/双击/长按的引用
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isLongPressRef = useRef(false);
  const clickCountRef = useRef(0);
  const wasModalOpenRef = useRef(false);
  const localBuffSearchInputRef = useRef<HTMLInputElement | null>(null);
  const selectedTeamCharacterIds = useMemo(() => {
    const ids = state.selectedCharacters
      .map((character) => character.id)
      .filter((id): id is string => Boolean(id));
    if (button.characterId && !ids.includes(button.characterId)) {
      ids.push(button.characterId);
    }
    return ids;
  }, [button.characterId, state.selectedCharacters]);

  // skillIconUrl 变化时重置图标加载失败状态
  useEffect(() => {
    setIconLoadFailed(false);
  }, [skillIconUrl]);

  /**
   * 从 buffCache 加载 Buff 列表
   */
  const loadBuffList = useCallback(() => {
    const buffs = getButtonBuffs(button.id);
    setBuffList(buffs);
  }, [button.id]);

  const localBuffSearchEntries = useMemo(() => {
    if (!isModalOpen) return [];
    return [
      ...readLocalBuffSearchEntries(),
      ...readCandidateBuffSearchEntries(),
    ];
  }, [candidateBuffRefreshToken, isModalOpen, isLocalBuffSearchOpen]);
  const activeBuffSearchEntries = useMemo(() => {
    if (!isSourceBuffSearchMode(buffSearchMode)) {
      return [];
    }
    const entries = filterBuffSearchEntriesBySourceMode(localBuffSearchEntries, buffSearchMode);
    if (buffSearchMode === 'buff-group') {
      return entries;
    }
    const operatorConfigCache = getOperatorConfigPageCache();
    return entries.filter((entry) => {
      if (operatorCharacterFilter && entry.ownerCharacterId !== operatorCharacterFilter) {
        return false;
      }
      if (buffSearchMode === 'operator' && operatorBuffGroupFilter && entry.ownerBuffGroup !== operatorBuffGroupFilter) {
        return false;
      }
      if (buffSearchMode !== 'operator' || entry.ownerBuffGroup !== 'potential') {
        return true;
      }

      const requiredPotentialCount = getRequiredPotentialCount(entry.displayName || entry.name);
      if (requiredPotentialCount === null) {
        return true;
      }
      const cachedPotentialCount = entry.ownerCharacterId
        ? operatorConfigCache[entry.ownerCharacterId]?.operator.potentialCount ?? 0
        : 0;
      return cachedPotentialCount > requiredPotentialCount;
    });
  }, [
    buffSearchMode,
    candidateBuffRefreshToken,
    localBuffSearchEntries,
    operatorBuffGroupFilter,
    operatorCharacterFilter,
  ]);
  const activeBuffSearchIndex = useMemo(() => buildBuffSearchIndex(
    activeBuffSearchEntries,
    (entry) => [
      entry.displayName,
      entry.name,
      entry.groupName,
      entry.itemName,
      entry.type,
      entry.description,
      entry.condition,
      entry.sourceName,
    ]
  ), [activeBuffSearchEntries]);
  const localBuffSearchResults = useMemo(() => {
    if (!isSourceBuffSearchMode(buffSearchMode)) {
      return [];
    }
    if (!localBuffSearchKeyword.trim()) {
      return ['operator', 'weapon', 'equipment'].includes(buffSearchMode)
        && (operatorCharacterFilter || (buffSearchMode === 'operator' && operatorBuffGroupFilter))
        ? dedupeLocalBuffSearchResults(activeBuffSearchEntries).slice(0, 50)
        : [];
    }
    return dedupeLocalBuffSearchResults(searchBuffs(localBuffSearchKeyword, activeBuffSearchIndex)).slice(0, 50);
  }, [
    activeBuffSearchEntries,
    activeBuffSearchIndex,
    buffSearchMode,
    localBuffSearchKeyword,
    operatorBuffGroupFilter,
    operatorCharacterFilter,
  ]);

  const loadPersistedManualBuffTweaks = useCallback(() => {
    const persistedButton = getSkillButtonById(button.id);
    const persistedMap = persistedButton?.panelConfig?.manualDisabledBuffIdsBySegmentKey ?? {};
    const normalizedMap = Object.fromEntries(
      Object.entries(persistedMap).map(([segmentKey, buffIds]) => [
        segmentKey,
        Array.isArray(buffIds) ? buffIds : [],
      ])
    );
    setManuallyDisabledBuffIdsBySegmentKey(normalizedMap);
    setGloballyDisabledBuffIds(
      Array.isArray(persistedButton?.panelConfig?.globallyDisabledBuffIds)
        ? persistedButton.panelConfig.globallyDisabledBuffIds
        : []
    );
    setManualBuffStackCountsBySegmentKey(
      Object.fromEntries(
        Object.entries(persistedButton?.panelConfig?.manualBuffStackCountsBySegmentKey ?? {}).map(([segmentKey, stackCounts]) => [
          segmentKey,
          { ...stackCounts },
        ])
      )
    );
    setManuallyDisabledHitKeys(
      Array.isArray(persistedButton?.panelConfig?.manualDisabledHitKeys)
        ? persistedButton.panelConfig.manualDisabledHitKeys.filter((hitKey): hitKey is string => typeof hitKey === 'string')
        : []
    );
    setTargetResistance({
      ...EMPTY_TARGET_RESISTANCE,
      ...(persistedButton?.resistanceConfig?.targetResistance ?? {}),
    });
  }, [button.id]);

  const closeLocalBuffSearch = useCallback(() => {
    setIsLocalBuffSearchOpen(false);
    setLocalBuffSearchKeyword('');
  }, []);

  const openLocalBuffSearch = useCallback(() => {
    setIsLocalBuffSearchOpen(true);
    setBuffSearchMode('buff-group');
  }, []);

  const handleCloseModal = useCallback(() => {
    navigateToAppPath(APP_ROUTE_PATHS.home);
    onModalClose?.();
  }, [onModalClose]);

  useEffect(() => {
    if (!isLocalBuffSearchOpen) {
      return;
    }
    refreshSelectedCharacters()
      .then(async (refreshedCharacters) => {
        const charactersForRefresh = refreshedCharacters.length > 0 ? refreshedCharacters : state.selectedCharacters;
        const characterIdsForRefresh = Array.from(new Set([
          ...selectedTeamCharacterIds,
          ...charactersForRefresh.map((character) => character.id),
        ]));
        await refreshOperatorConfigSnapshotsForCharacters(charactersForRefresh);
        return refreshSnapshotCandidateBuffsForCharacterIds(characterIdsForRefresh);
      })
      .then(() => setCandidateBuffRefreshToken((token) => token + 1))
      .catch((error) => console.error('刷新技能按钮候选 Buff 失败:', error));
    const timer = window.setTimeout(() => {
      localBuffSearchInputRef.current?.focus();
      localBuffSearchInputRef.current?.select();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [isLocalBuffSearchOpen, refreshSelectedCharacters, selectedTeamCharacterIds, state.selectedCharacters]);

  useEffect(() => {
    if (!isModalOpen) {
      if (isLocalBuffSearchOpen) {
        closeLocalBuffSearch();
      }
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isEditable =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        !!target?.closest('[contenteditable="true"]');

      if (isLocalBuffSearchOpen) {
        if (event.key === 'Tab' && !event.shiftKey) {
          event.preventDefault();
          setBuffSearchMode((prev) => getNextBuffSearchMode(prev));
          return;
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          closeLocalBuffSearch();
        }
        return;
      }

      if (event.key === 'Escape') {
        event.preventDefault();
        handleCloseModal();
        return;
      }

      if (event.key === 'Tab' && !event.shiftKey && !isEditable) {
        event.preventDefault();
        openLocalBuffSearch();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [closeLocalBuffSearch, handleCloseModal, isLocalBuffSearchOpen, isModalOpen, openLocalBuffSearch]);

  const persistManualBuffTweaks = useCallback((nextMap: Record<string, string[]>) => {
    const persistedButton = getSkillButtonById(button.id);
    if (!persistedButton) {
      return;
    }

    upsertSkillButton({
      ...persistedButton,
      panelConfig: {
        ...(persistedButton.panelConfig ?? { selectedBuff: [...(persistedButton.selectedBuff ?? [])] }),
        selectedBuff: [...(persistedButton.selectedBuff ?? [])],
        manualDisabledBuffIdsBySegmentKey: nextMap,
      },
      updatedAt: Date.now(),
    });
  }, [button.id]);

  const updateTargetResistance = useCallback((key: keyof HitResistanceInput, value: number) => {
    const nextValue = Number.isFinite(value) ? value : 0;
    setTargetResistance((prev) => {
      const next = { ...prev, [key]: nextValue };
      const persistedButton = getSkillButtonById(button.id);
      if (persistedButton) {
        upsertSkillButton({
          ...persistedButton,
          resistanceConfig: {
            targetResistance: next,
          },
        });
      }
      return next;
    });
  }, [button.id]);

  const persistManualDisabledHitKeys = useCallback((nextHitKeys: string[]) => {
    const persistedButton = getSkillButtonById(button.id);
    if (!persistedButton) {
      return;
    }

    upsertSkillButton({
      ...persistedButton,
      panelConfig: {
        ...(persistedButton.panelConfig ?? { selectedBuff: [...(persistedButton.selectedBuff ?? [])] }),
        selectedBuff: [...(persistedButton.selectedBuff ?? [])],
        manualDisabledHitKeys: nextHitKeys,
      },
      updatedAt: Date.now(),
    });
  }, [button.id]);

  const toggleGlobalBuffDisabled = useCallback((buffId: string) => {
    setGloballyDisabledBuffIds((prev) => {
      const next = prev.includes(buffId)
        ? prev.filter((id) => id !== buffId)
        : [...prev, buffId];
      const persistedButton = getSkillButtonById(button.id);
      if (persistedButton) {
        upsertSkillButton({
          ...persistedButton,
          panelConfig: {
            ...(persistedButton.panelConfig ?? { selectedBuff: [...(persistedButton.selectedBuff ?? [])] }),
            selectedBuff: [...(persistedButton.selectedBuff ?? [])],
            globallyDisabledBuffIds: next,
          },
          updatedAt: Date.now(),
        });
        recomputeSkillButtonPanel(button.id);
      }
      return next;
    });
  }, [button.id]);

  const persistManualBuffStackCounts = useCallback((nextMap: Record<string, Record<string, number>>) => {
    const persistedButton = getSkillButtonById(button.id);
    if (!persistedButton) {
      return;
    }
    upsertSkillButton({
      ...persistedButton,
      panelConfig: {
        ...(persistedButton.panelConfig ?? { selectedBuff: [...(persistedButton.selectedBuff ?? [])] }),
        selectedBuff: [...(persistedButton.selectedBuff ?? [])],
        manualBuffStackCountsBySegmentKey: nextMap,
      },
      updatedAt: Date.now(),
    });
  }, [button.id]);

  const clearManualBuffStackCountForBuff = useCallback((buffId: string) => {
    setManualBuffStackCountsBySegmentKey((prev) => {
      const nextMap = Object.fromEntries(
        Object.entries(prev).flatMap(([segmentKey, stackCounts]) => {
          if (!(buffId in stackCounts)) {
            return [[segmentKey, stackCounts] as const];
          }
          const { [buffId]: _removed, ...remainingCounts } = stackCounts;
          return Object.keys(remainingCounts).length > 0
            ? [[segmentKey, remainingCounts] as const]
            : [];
        })
      );
      persistManualBuffStackCounts(nextMap);
      return nextMap;
    });
  }, [persistManualBuffStackCounts]);

  /**
   * 从 sessionStorage 加载 skillLevelModeMap（角色技能等级配置）
   */
  const loadSkillLevelModeMap = useCallback((): Record<string, SkillLevelMode> => {
    const characterConfig = getCharacterConfig(button.characterId);
    if (characterConfig) {
      return characterConfig.skillLevelModeMap ?? { A: 'L9', B: 'L9', E: 'L9', Q: 'L9', Dot: 'M3' };
    }
    return { A: 'L9', B: 'L9', E: 'L9', Q: 'L9', Dot: 'M3' };
  }, [button.characterId]);

  const loadResolvedTemplate = useCallback(() => {
    const template = resolveSkillDamageTemplate(button);
    if (!template) {
      setResolvedTemplate(null);
      return;
    }

    setResolvedTemplate(template);
    console.log(`[SkillButton] 已加载解析模板: ${template.displayName} ${template.buttonType}, hits: ${template.hits.length}`);
  }, [button]);

  /**
   * 从 sessionStorage 加载面板数据
   */
  const loadPanelData = useCallback(() => {
    recomputeSkillButtonPanel(button.id);
    const buttonStorage = getSkillButtonById(button.id);
    const characterConfig = getCharacterConfig(button.characterId);
    if (characterConfig?.panelSnapshot) {
    const buttonSnapshot = buttonStorage?.runtimeSnapshot;
      const snapshot = characterConfig.panelSnapshot;
      const equipment = characterConfig.equipment ?? {};
      setPanelData({
        atk: buttonSnapshot?.atk ?? snapshot.atk ?? 0,
        critRate: buttonSnapshot?.critRate ?? snapshot.critRate ?? (0.05 + (equipment.critRateBoost ?? 0)),
        critDmg: buttonSnapshot?.critDmg ?? snapshot.critDmg ?? (0.5 + (equipment.critDmgBonusBoost ?? 0)),
        physicalDmgBonus: equipment.physicalDmgBonus ?? 0,
        fireDmgBonus: equipment.fireDmgBonus ?? 0,
        electricDmgBonus: equipment.electricDmgBonus ?? 0,
        iceDmgBonus: equipment.iceDmgBonus ?? 0,
        natureDmgBonus: equipment.natureDmgBonus ?? 0,
        skillDmgBonus: equipment.skillDmgBonus ?? 0,
        chainSkillDmgBonus: equipment.chainSkillDmgBonus ?? 0,
        ultimateDmgBonus: equipment.ultimateDmgBonus ?? 0,
        allSkillDmgBonus: (equipment.allSkillDmgBonus ?? 0) + (snapshot.weaponAllSkillDmgBonus ?? 0),
        allDmgBonus: equipment.allDmgBonus ?? 0,
      });
      setInfoSnapshotLines(characterConfig.infoSnapshot ?? []);
      setInfoSnap((characterConfig.infoSnap ?? {}) as unknown as Record<string, number>);
    } else {
      // 当前按钮没有有效快照时，清空状态，避免显示上一个按钮的数据
      setPanelData(null);
      setInfoSnapshotLines([]);
      setInfoSnap({});
    }
  }, [button.characterId, button.id]);

  const handleApplyLocalBuffSearchResult = useCallback((entry: LocalBuffSearchResult) => {
    const result = addSkillButtonBuff(button.id, {
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
      recomputeSkillButtonPanel(button.id);
      if (result.buffId) {
        emitSkillButtonBuffAdded(button.id, result.buffId);
      } else {
        // 防御兜底：极端情况下没有 buffId 时，仍然同步当前弹窗本地状态
        loadBuffList();
        loadPanelData();
      }
    }
  }, [button.id, loadBuffList, loadPanelData]);

  const handleApplyNearbyBuff = useCallback((buff: SkillButtonBuff) => {
    const { id: _id, refCount: _refCount, ...buffWithoutRuntimeFields } = buff;
    const result = addSkillButtonBuff(button.id, {
      ...buffWithoutRuntimeFields,
      refCount: 1,
    });
    if (!result.success) {
      return;
    }
    recomputeSkillButtonPanel(button.id);
    if (result.buffId) {
      emitSkillButtonBuffAdded(button.id, result.buffId);
      return;
    }
    loadBuffList();
    loadPanelData();
  }, [button.id, loadBuffList, loadPanelData]);

  /**
   * 移除指定 Buff
   * 同时触发事件通知 CanvasBoard 更新 timelineData
   * @param buffId - Buff ID
   */
  const removeBuff = useCallback((buffId: string) => {
    setGloballyDisabledBuffIds((prev) => prev.filter((id) => id !== buffId));
    removeSkillButtonBuff(button.id, buffId);
    loadBuffList(); // 重新加载列表
    loadPanelData();

    // 触发事件通知 CanvasBoard 从 timelineData 中移除 buffId
    emitSkillButtonBuffRemoved(button.id, buffId);
  }, [button.id, loadBuffList, loadPanelData]);

  const clearAllBuffs = useCallback(() => {
    const currentBuffs = getButtonBuffs(button.id);
    if (currentBuffs.length === 0) {
      return;
    }
    currentBuffs.forEach((buff) => {
      removeSkillButtonBuff(button.id, buff.id);
      emitSkillButtonBuffRemoved(button.id, buff.id);
    });
    setGloballyDisabledBuffIds([]);
    setManuallyDisabledBuffIdsBySegmentKey({});
    setManualBuffStackCountsBySegmentKey({});
    persistManualBuffTweaks({});
    persistManualBuffStackCounts({});
    const persistedButton = getSkillButtonById(button.id);
    if (persistedButton) {
      upsertSkillButton({
        ...persistedButton,
        panelConfig: {
          ...(persistedButton.panelConfig ?? { selectedBuff: [...(persistedButton.selectedBuff ?? [])] }),
          selectedBuff: [...(persistedButton.selectedBuff ?? [])],
          globallyDisabledBuffIds: [],
          manualDisabledBuffIdsBySegmentKey: {},
          manualBuffStackCountsBySegmentKey: {},
        },
        updatedAt: Date.now(),
      });
      recomputeSkillButtonPanel(button.id);
    }
    loadBuffList();
    loadPanelData();
  }, [button.id, loadBuffList, loadPanelData, persistManualBuffStackCounts, persistManualBuffTweaks]);

  const enableAllBuffs = useCallback(() => {
    const persistedButton = getSkillButtonById(button.id);
    if (persistedButton) {
      upsertSkillButton({
        ...persistedButton,
        panelConfig: {
          ...(persistedButton.panelConfig ?? { selectedBuff: [...(persistedButton.selectedBuff ?? [])] }),
          selectedBuff: [...(persistedButton.selectedBuff ?? [])],
          globallyDisabledBuffIds: [],
        },
        updatedAt: Date.now(),
      });
      recomputeSkillButtonPanel(button.id);
    }
    setGloballyDisabledBuffIds([]);
    loadPanelData();
  }, [button.id, loadPanelData]);

  const disableAllBuffs = useCallback(() => {
    const currentBuffs = getButtonBuffs(button.id);
    const nextDisabledIds = currentBuffs.map((buff) => buff.id);
    const persistedButton = getSkillButtonById(button.id);
    if (persistedButton) {
      upsertSkillButton({
        ...persistedButton,
        panelConfig: {
          ...(persistedButton.panelConfig ?? { selectedBuff: [...(persistedButton.selectedBuff ?? [])] }),
          selectedBuff: [...(persistedButton.selectedBuff ?? [])],
          globallyDisabledBuffIds: nextDisabledIds,
        },
        updatedAt: Date.now(),
      });
      recomputeSkillButtonPanel(button.id);
    }
    setGloballyDisabledBuffIds(nextDisabledIds);
    loadPanelData();
  }, [button.id, loadPanelData]);

  const resetAllBuffStacks = useCallback(() => {
    setManualBuffStackCountsBySegmentKey({});
    persistManualBuffStackCounts({});
    loadPanelData();
  }, [loadPanelData, persistManualBuffStackCounts]);

  const decrementBuffStack = useCallback((buffId: string) => {
    clearManualBuffStackCountForBuff(buffId);
    decrementSkillButtonBuffStack(button.id, buffId);
    loadBuffList();
    loadPanelData();
  }, [button.id, clearManualBuffStackCountForBuff, loadBuffList, loadPanelData]);

  const incrementBuffStack = useCallback((buff: SkillButtonBuff) => {
    clearManualBuffStackCountForBuff(buff.id);
    const { id: _id, refCount: _refCount, ...buffWithoutRuntimeFields } = buff;
    addSkillButtonBuff(button.id, { ...buffWithoutRuntimeFields, refCount: 1 });
    loadBuffList();
    loadPanelData();
  }, [button.id, clearManualBuffStackCountForBuff, loadBuffList, loadPanelData]);

  const modifierBuffList = useMemo(
    () => buffList.filter((buff) => isModifierBuff(buff) && !globallyDisabledBuffIds.includes(buff.id)),
    [buffList, globallyDisabledBuffIds]
  );
  const buttonStackCounts = useMemo(
    () => getSkillButtonById(button.id)?.buffStackCounts ?? {},
    [button.id, buffList]
  );
  const buffStackCountsByHitKey = useMemo(() => {
    if (!resolvedTemplate) {
      return {};
    }
    return Object.fromEntries(
      resolvedTemplate.hits.map((hit) => [
        hit.key,
        manualBuffStackCountsBySegmentKey[getNormalHitSegmentKey(hit.key)] ?? {},
      ])
    );
  }, [manualBuffStackCountsBySegmentKey, resolvedTemplate]);
  const extraHitBuffList = useMemo(
    () => buffList.filter(isExtraHitBuff).filter((buff) => !globallyDisabledBuffIds.includes(buff.id)),
    [buffList, globallyDisabledBuffIds]
  );
  const usedLocalBuffList = useMemo(
    () => buffList.filter((buff) => buff.source !== 'anomaly_state'),
    [buffList]
  );
  const nearbyBuffList = useMemo(() => {
    if (!timelineData || !isSourceBuffSearchMode(buffSearchMode)) {
      return [];
    }

    const timelineButton = timelineData.staffLines
      .flatMap((staffLine) => staffLine.buttons)
      .find((item) => item.id === button.id);
    const currentNodeIndex = timelineButton?.nodeIndex ?? button.nodeIndex;
    if (typeof currentNodeIndex !== 'number') {
      return [];
    }

    const selectedBuffIds = new Set(usedLocalBuffList.map((buff) => buff.id));
    const nearbyBuffs = new Map<string, SkillButtonBuff>();
    timelineData.staffLines.forEach((staffLine) => {
      staffLine.buttons.forEach((nearbyButton) => {
        if (
          nearbyButton.id === button.id
          || Math.abs(nearbyButton.nodeIndex - currentNodeIndex) !== 1
        ) {
          return;
        }
        getButtonBuffs(nearbyButton.id).forEach((buff) => {
          if (buff.source !== 'anomaly_state' && !selectedBuffIds.has(buff.id)) {
            nearbyBuffs.set(buff.id, buff);
          }
        });
      });
    });
    return Array.from(nearbyBuffs.values());
  }, [buffSearchMode, button.id, button.nodeIndex, timelineData, usedLocalBuffList]);

  return {
    position,
    skillType,
    isSelected,
    isDragging,
    characterName,
    skillIconUrl,
    element,
    isLocked,
    displayName,
    browseModeDisplayName,
    isDotButton,
    state,
    dispatch,
    radius,
    visualOffsetX,
    visualOffsetY,
    hitWidth,
    hitHeight,
    shouldRenderContextMenu,
    isModalOpen,
    buffList,
    setSkillLevelModeMap,
    currentSkillLevelMode,
    resolvedTemplate,
    targetResistance,
    selectedHitIndex,
    setSelectedHitIndex,
    panelData,
    isExpanded,
    setIsExpanded,
    infoSnapshotLines,
    infoSnap,
    selectedAnomalySegmentKey,
    setSelectedAnomalySegmentKey,
    isAnomalyFormulaExpanded,
    setIsAnomalyFormulaExpanded,
    isTargetResistanceExpanded,
    setIsTargetResistanceExpanded,
    isLocalBuffSearchOpen,
    localBuffSearchKeyword,
    setLocalBuffSearchKeyword,
    buffSearchMode,
    setBuffSearchMode,
    operatorCharacterFilter,
    setOperatorCharacterFilter,
    operatorBuffGroupFilter,
    setOperatorBuffGroupFilter,
    manuallyDisabledBuffIdsBySegmentKey,
    setManuallyDisabledBuffIdsBySegmentKey,
    globallyDisabledBuffIds,
    manualBuffStackCountsBySegmentKey,
    setManualBuffStackCountsBySegmentKey,
    manuallyDisabledHitKeys,
    setManuallyDisabledHitKeys,
    iconLoadFailed,
    setIconLoadFailed,
    clickTimerRef,
    longPressTimerRef,
    isLongPressRef,
    clickCountRef,
    wasModalOpenRef,
    localBuffSearchInputRef,
    loadBuffList,
    localBuffSearchResults,
    loadPersistedManualBuffTweaks,
    closeLocalBuffSearch,
    openLocalBuffSearch,
    handleCloseModal,
    persistManualBuffTweaks,
    updateTargetResistance,
    persistManualDisabledHitKeys,
    toggleGlobalBuffDisabled,
    persistManualBuffStackCounts,
    loadSkillLevelModeMap,
    loadResolvedTemplate,
    loadPanelData,
    handleApplyLocalBuffSearchResult,
    handleApplyNearbyBuff,
    removeBuff,
    clearAllBuffs,
    enableAllBuffs,
    disableAllBuffs,
    resetAllBuffStacks,
    decrementBuffStack,
    incrementBuffStack,
    modifierBuffList,
    buttonStackCounts,
    buffStackCountsByHitKey,
    extraHitBuffList,
    usedLocalBuffList,
    nearbyBuffList,
  };
}
