import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import type { CSSProperties } from 'react';
import {
  SkillButton as SkillButtonType,
  SkillButtonSkillChangePayload,
  SkillButtonSkillOption,
  SKILL_LABELS,
  TimelineData,
} from '../../types';
import { getElementBackgroundColor, normalizeAssetUrl } from '../../utils/assetResolver';
import {
  removeSkillButtonBuff,
  setSelectedSkillButton,
  getButtonBuffs,
  recomputeSkillButtonPanel,
  addSkillButtonBuff,
} from '../../hooks/useSkillButtonBuffs';
import { SkillButtonBuff, SkillLevelMode } from '../../types/storage';
import { getCharacterConfig } from '../../utils/storage';
import { getCharacterComputedCache } from '../../core/repositories/operatorConfigRepository';
import { getSkillButtonById, upsertSkillButton } from '../../core/repositories';
import {
  buildSkillDamageModalViewModel,
} from '../../core/calculators/skillDamageModalViewModel';
import { calculateSkillButtonDamageV2 } from '../../core/calculators/skillButtonDamageCalculatorV2';
import type {
  AppliedBuffTagViewModel,
  ResolvedSkillDamageTemplate,
  SkillDamagePanelBase,
} from '../../core/calculators/skillDamage.types';
import { resolveSkillDamageTemplate } from '../../core/services/skillDamageTemplateResolver';
import { useAppContext } from '../../context/AppContext';
import { emitSkillButtonBuffAdded, emitSkillButtonBuffRemoved, onSkillButtonBuffAdded } from '../../core/events/buffEvents';
import { buildBuffSearchIndex, searchBuffs } from '../../utils/buffFuzzySearch';
import { refreshSnapshotCandidateBuffsForCharacterIds } from '../../core/services/operatorConfigCandidateBuffService';
import {
  type AnomalyDamageSegmentView,
  getNormalHitSegmentKey,
  isExtraHitBuff,
  isModifierBuff,
  type LocalBuffSearchResult,
  readCandidateBuffSearchEntries,
  readLocalBuffSearchEntries,
  buildAppliedBuffTags,
} from './skillButton.shared';
import {
  SkillButtonAnomalyPanel,
  SkillButtonAnomalyStatePanel,
  SkillButtonStatePanel,
} from './SkillButtonAnomalyPanels';
import { useSkillButtonAnomaly } from './useSkillButtonAnomaly';
import { buildAnomalyBuffOptionsBySegmentKey, buildAnomalyDamageSegments } from './skillButtonAnomalyDamage';
import './SkillButton.css';

interface SkillButtonProps {
  button: SkillButtonType & { nodeNumber?: number };
  size: number;
  onMouseDown: (e: React.MouseEvent) => void;
  onContextMenu: (e: React.MouseEvent) => void;
  timelineData?: TimelineData;
  onModalOpen?: () => void;
  onModalClose?: () => void;
  contextMenuState?: { buttonId: string; position: { x: number; y: number } } | null;
  onConfirmRemove?: () => void;
  onCloseContextMenu?: () => void;
  onCopy?: () => void;
  onChangeSkillType?: (payload: SkillButtonSkillChangePayload) => void;
  skillChangeOptions?: SkillButtonSkillOption[];
}

export function SkillButtonComponent({
  button,
  size,
  onMouseDown,
  onContextMenu,
  timelineData,
  onModalOpen,
  onModalClose,
  contextMenuState,
  onConfirmRemove,
  onCloseContextMenu,
  onCopy,
  onChangeSkillType,
  skillChangeOptions = [],
}: SkillButtonProps) {
  /**
   * position.y 语义约定（v1.1.0+）：
   * - position.x: 按钮碰撞箱左边界（原始值，未做视觉偏移）
   * - position.y: 底座中线（不是圆心！）
   *   渲染时通过 `top: position.y - radius - visualOffsetY` 转换为 CSS top
   *   其中 visualOffsetY = 15，用于对齐谱线中心
   *
   * 恢复兼容性说明：
   * - timeline version < 1.1.0 时：CanvasBoard 恢复链直接使用缓存中的 position.y
   * - timeline version >= 1.1.0 时：CanvasBoard 恢复链按 nodeIndex + lineIndex 重建标准 Y
   * - 本组件只消费最终的 position.y，不再区分旧缓存/新缓存细节
   */
  const { position, skillType, isSelected, isDragging, characterName, skillIconUrl, element, isLocked, skillDisplayName } = button;
  const displayName = skillDisplayName || SKILL_LABELS[skillType];
  const { state, dispatch } = useAppContext();
  const radius = size / 2;
  const baseWidth = 80;
  const baseHeight = 30;
  const visualOffsetX = 40;
  const visualOffsetY = 15;
  const hitWidth = radius + baseWidth;
  const hitHeight = Math.max(size, radius + baseHeight);

  // 弹窗显示状态
  const [isModalOpen, setIsModalOpen] = useState(false);
  // 当前技能按钮的 Buff 列表
  const [buffList, setBuffList] = useState<SkillButtonBuff[]>([]);
  // 当前角色的技能等级模式 (L9/M3)
  const [skillLevelModeMap, setSkillLevelModeMap] = useState<Record<string, SkillLevelMode>>({ A: 'L9', B: 'L9', E: 'L9', Q: 'L9' });
  // 已解析的技能伤害模板（skill 是容器，hit 是计算单元）
  const [resolvedTemplate, setResolvedTemplate] = useState<ResolvedSkillDamageTemplate | null>(null);

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
  const [isLocalBuffSearchOpen, setIsLocalBuffSearchOpen] = useState(false);
  const [localBuffSearchKeyword, setLocalBuffSearchKeyword] = useState('');
  const [buffSearchMode, setBuffSearchMode] = useState<'local' | 'anomaly' | 'anomaly-state' | 'state'>('local');
  const [candidateBuffRefreshToken, setCandidateBuffRefreshToken] = useState(0);
  const [manuallyDisabledBuffIdsBySegmentKey, setManuallyDisabledBuffIdsBySegmentKey] = useState<Record<string, string[]>>({});

  // 图标加载失败状态，用于 CSS 类切换
  const [iconLoadFailed, setIconLoadFailed] = useState(false);

  // 用于区分单击/双击/长按的引用
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isLongPressRef = useRef(false);
  const clickCountRef = useRef(0);
  const wasModalOpenRef = useRef(false);
  const localBuffSearchInputRef = useRef<HTMLInputElement | null>(null);

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
  const activeBuffSearchEntries = localBuffSearchEntries;
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
    if (buffSearchMode === 'anomaly' || buffSearchMode === 'state' || buffSearchMode === 'anomaly-state') {
      return [];
    }
    if (!localBuffSearchKeyword.trim()) {
      return [];
    }
    return searchBuffs(localBuffSearchKeyword, activeBuffSearchIndex).slice(0, 50);
  }, [activeBuffSearchIndex, buffSearchMode, localBuffSearchKeyword]);

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
  }, [button.id]);

  const closeLocalBuffSearch = useCallback(() => {
    setIsLocalBuffSearchOpen(false);
    setLocalBuffSearchKeyword('');
  }, []);

  const openLocalBuffSearch = useCallback(() => {
    setIsLocalBuffSearchOpen(true);
    setBuffSearchMode('local');
  }, []);

  const handleCloseModal = useCallback(() => {
    setIsModalOpen(false);
    onModalClose?.();
  }, [onModalClose]);

  useEffect(() => {
    if (!isLocalBuffSearchOpen) {
      return;
    }
    refreshSnapshotCandidateBuffsForCharacterIds([button.characterId])
      .then(() => setCandidateBuffRefreshToken((token) => token + 1))
      .catch((error) => console.error('刷新技能按钮候选 Buff 失败:', error));
    const timer = window.setTimeout(() => {
      localBuffSearchInputRef.current?.focus();
      localBuffSearchInputRef.current?.select();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [button.characterId, isLocalBuffSearchOpen]);

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
          setBuffSearchMode((prev) => {
            if (prev === 'local') return 'anomaly';
            if (prev === 'anomaly') return 'anomaly-state';
            if (prev === 'anomaly-state') return 'state';
            return 'local';
          });
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

  /**
   * 从 sessionStorage 加载 skillLevelModeMap（角色技能等级配置）
   */
  const loadSkillLevelModeMap = useCallback((): Record<string, SkillLevelMode> => {
    const characterConfig = getCharacterConfig(button.characterId);
    if (characterConfig) {
      return characterConfig.skillLevelModeMap ?? { A: 'L9', B: 'L9', E: 'L9', Q: 'L9' };
    }
    return { A: 'L9', B: 'L9', E: 'L9', Q: 'L9' };
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
      const buttonSnapshot = buttonStorage?.panelSnapshot;
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
      effectKind: entry.effectKind,
      extraHitConfig: entry.extraHitConfig,
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
      closeLocalBuffSearch();
    }
  }, [button.id, closeLocalBuffSearch, loadBuffList, loadPanelData]);

  /**
   * 移除指定 Buff
   * 同时触发事件通知 CanvasBoard 更新 timelineData
   * @param buffId - Buff ID
   */
  const removeBuff = useCallback((buffId: string) => {
    removeSkillButtonBuff(button.id, buffId);
    loadBuffList(); // 重新加载列表
    loadPanelData();

    // 触发事件通知 CanvasBoard 从 timelineData 中移除 buffId
    emitSkillButtonBuffRemoved(button.id, buffId);
  }, [button.id, loadBuffList, loadPanelData]);

  const modifierBuffList = useMemo(
    () => buffList.filter(isModifierBuff),
    [buffList]
  );
  const extraHitBuffList = useMemo(
    () => buffList.filter(isExtraHitBuff),
    [buffList]
  );
  const {
    activeAnomaly,
    activeAnomalyGroup,
    activeAnomalyLevel,
    activeAnomalyPreview,
    activeSourceCharacter,
    activeAnomalyStateDurationSeconds,
    activeAnomalyStateLevel,
    activeAnomalyStateOption,
    activeAnomalyStatePreview,
    activeAnomalyStateSourceCharacter,
    anomalyStateSnapshotUsageCounts,
    attachAnomalyStateSnapshotCard,
    availableAnomalyStateSnapshots,
    deleteAnomalyStateSnapshotCard,
    fullCombinedModifierBuffList,
    handleApplyActiveAnomaly,
    handleCreateAnomalyStateSnapshot,
    handleSelectAnomaly,
    handleSelectAnomalyState,
    loadPersistedAnomalyCards,
    removeAnomalyCard,
    removeAnomalyStateSnapshotCard,
    resetAnomalyDraftState,
    selectedAnomalyDamages,
    selectedAnomalyStateSnapshots,
    selectedStatusCards,
    setActiveAnomalyGroup,
    setActiveAnomalyKey,
    setActiveAnomalyLevel,
    setActiveAnomalySourceId,
    setActiveAnomalyStateDurationSeconds,
    setActiveAnomalyStateLevel,
    setActiveAnomalyStateSourceId,
    setActiveDurationSeconds,
    setIncludeDotInTotal,
    sourceCharacters,
    getEffectiveCharacterSourceSkillBoost,
    activeDurationSeconds,
    includeDotInTotal,
  } = useSkillButtonAnomaly({
    buttonId: button.id,
    buttonCharacterId: button.characterId,
    buttonSkillType: button.skillType,
    characterName,
    selectedCharacters: state.selectedCharacters.map((character) => ({
      id: character.id,
      name: character.name,
    })),
    modifierBuffList,
  });
  const panelBase = useMemo<SkillDamagePanelBase | null>(() => {
    const computedPanel = getCharacterComputedCache(button.characterId)?.panel;
    if (!computedPanel) {
      return null;
    }

    return {
      baseAtk: computedPanel.baseAtk,
      characterAtk: computedPanel.characterAtk,
      weaponAtk: computedPanel.weaponAtk,
      weaponAtkPercent: computedPanel.weaponAtkPercent,
      abilityBonus: computedPanel.abilityBonus,
      critRate: computedPanel.critRate ?? 0.05,
      critDmg: computedPanel.critDmg ?? 0.5,
    };
  }, [button.characterId]);
  const activeNormalHitSegmentKey = useMemo(
    () => (selectedHitIndex !== null && resolvedTemplate?.hits[selectedHitIndex] ? getNormalHitSegmentKey(resolvedTemplate.hits[selectedHitIndex].key) : null),
    [resolvedTemplate, selectedHitIndex]
  );
  const disabledBuffIdsByHitKey = useMemo(() => {
    if (!resolvedTemplate) {
      return {};
    }

    return resolvedTemplate.hits.reduce<Record<string, string[]>>((acc, hit) => {
      const segmentKey = getNormalHitSegmentKey(hit.key);
      acc[hit.key] = manuallyDisabledBuffIdsBySegmentKey[segmentKey] ?? [];
      return acc;
    }, {});
  }, [manuallyDisabledBuffIdsBySegmentKey, resolvedTemplate]);

  const fullDamageResult = useMemo(() => {
    if (!resolvedTemplate || resolvedTemplate.hits.length === 0 || !panelData) {
      return null;
    }

    return calculateSkillButtonDamageV2({
        buttonId: button.id,
        characterId: button.characterId,
        runtimeSkillId: resolvedTemplate.runtimeSkillId,
        template: resolvedTemplate,
        buffs: fullCombinedModifierBuffList,
        panel: {
          atk: panelData.atk,
          critRate: panelData.critRate,
          critDmg: panelData.critDmg,
        },
        panelBase: panelBase ?? undefined,
      damageBonus: infoSnap as unknown as import('../../types/storage').DamageBonusSnapshot,
    });
  }, [resolvedTemplate, panelData, button.id, button.characterId, fullCombinedModifierBuffList, panelBase, infoSnap]);

  const damageResult = useMemo(() => {
    if (!resolvedTemplate || resolvedTemplate.hits.length === 0 || !panelData) {
      return null;
    }

    return calculateSkillButtonDamageV2({
        buttonId: button.id,
        characterId: button.characterId,
        runtimeSkillId: resolvedTemplate.runtimeSkillId,
        template: resolvedTemplate,
        buffs: fullCombinedModifierBuffList,
        panel: {
          atk: panelData.atk,
          critRate: panelData.critRate,
          critDmg: panelData.critDmg,
        },
        panelBase: panelBase ?? undefined,
        disabledBuffIdsByHitKey,
      damageBonus: infoSnap as unknown as import('../../types/storage').DamageBonusSnapshot,
    });
  }, [resolvedTemplate, panelData, button.id, button.characterId, fullCombinedModifierBuffList, panelBase, disabledBuffIdsByHitKey, infoSnap]);

  const damageViewModel = useMemo(() => {
    if (!resolvedTemplate || !damageResult || !panelData) {
      return null;
    }

    const activeHitPanel = selectedHitIndex !== null ? damageResult.hits[selectedHitIndex]?.panel ?? panelData : panelData;
    return buildSkillDamageModalViewModel(
      resolvedTemplate,
      damageResult,
      selectedHitIndex,
      {
        atk: activeHitPanel.atk,
        critRate: activeHitPanel.critRate,
        critDmg: activeHitPanel.critDmg,
      }
    );
  }, [resolvedTemplate, damageResult, selectedHitIndex, panelData]);
  const activeHitBuffOptions = useMemo(() => {
    if (selectedHitIndex === null || !fullDamageResult) {
      return [];
    }
    const hitResult = fullDamageResult.hits[selectedHitIndex];
    return hitResult ? buildAppliedBuffTags(hitResult.appliedBuffs) : [];
  }, [fullDamageResult, selectedHitIndex]);
  const manualBuffOptionIdsBySegmentKey = useMemo<Record<string, Set<string>>>(() => {
    const nextMap: Record<string, Set<string>> = {};

    if (fullDamageResult) {
      fullDamageResult.hits.forEach((hit) => {
        nextMap[getNormalHitSegmentKey(hit.hit.key)] = new Set(hit.appliedBuffs.map((buff) => buff.id));
      });
    }

    selectedAnomalyDamages.forEach((card) => {
      const appliedBuffs = card.selectedBuffIds.length === 0
        ? [...fullCombinedModifierBuffList]
        : [...fullCombinedModifierBuffList.filter((buff) => card.selectedBuffIds.includes(buff.id) || buff.source === 'anomaly_state')];
      nextMap[card.id] = new Set(appliedBuffs.map((buff) => buff.id));
    });

    extraHitBuffList.forEach((buff) => {
      nextMap[`buff-extra-hit-${buff.id}`] = new Set(fullCombinedModifierBuffList.map((item) => item.id));
    });

    return nextMap;
  }, [extraHitBuffList, fullCombinedModifierBuffList, fullDamageResult, selectedAnomalyDamages]);

  useEffect(() => {
    setManuallyDisabledBuffIdsBySegmentKey((prev) => {
      const nextEntries = Object.entries(prev).flatMap(([segmentKey, buffIds]) => {
        const availableIds = manualBuffOptionIdsBySegmentKey[segmentKey];
        if (!availableIds) {
          return [];
        }
        const nextBuffIds = buffIds.filter((buffId) => availableIds.has(buffId));
        return nextBuffIds.length > 0 ? [[segmentKey, nextBuffIds] as const] : [];
      });
      return Object.fromEntries(nextEntries);
    });
  }, [manualBuffOptionIdsBySegmentKey]);

  const isBuffManuallyActive = useCallback((segmentKey: string, buffId: string) => {
    const disabledIds = manuallyDisabledBuffIdsBySegmentKey[segmentKey] ?? [];
    return !disabledIds.includes(buffId);
  }, [manuallyDisabledBuffIdsBySegmentKey]);

  const toggleManualBuff = useCallback((segmentKey: string, buffId: string) => {
    setManuallyDisabledBuffIdsBySegmentKey((prev) => {
      const current = prev[segmentKey] ?? [];
      const next = current.includes(buffId)
        ? current.filter((id) => id !== buffId)
        : [...current, buffId];
      const nextMap = next.length === 0 ? (() => {
        const { [segmentKey]: _removed, ...rest } = prev;
        return rest;
      })() : {
        ...prev,
        [segmentKey]: next,
      };
      persistManualBuffTweaks(nextMap);
      return nextMap;
    });
  }, [persistManualBuffTweaks]);

  const resetManualBuffTweaks = useCallback((segmentKey: string) => {
    setManuallyDisabledBuffIdsBySegmentKey((prev) => {
      if (!(segmentKey in prev)) {
        return prev;
      }
      const { [segmentKey]: _removed, ...rest } = prev;
      persistManualBuffTweaks(rest);
      return rest;
    });
  }, [persistManualBuffTweaks]);

  const anomalyDamageSegments = useMemo<AnomalyDamageSegmentView[]>(() => {
    if (!panelData || !damageViewModel) {
      return [];
    }
    return buildAnomalyDamageSegments({
      panelBase,
      panelData,
      hitCards: damageViewModel.hitCards,
      selectedAnomalyDamages,
      buttonCharacterId: button.characterId,
      element,
      damageBonus: infoSnap as unknown as import('../../types/storage').DamageBonusSnapshot,
      fullCombinedModifierBuffList,
      extraHitBuffList,
      manuallyDisabledBuffIdsBySegmentKey,
      getEffectiveCharacterSourceSkillBoost,
    });
  }, [panelBase, panelData, damageViewModel, selectedAnomalyDamages, button.characterId, button.skillType, element, infoSnap, fullCombinedModifierBuffList, extraHitBuffList, manuallyDisabledBuffIdsBySegmentKey, getEffectiveCharacterSourceSkillBoost]);

  const activeAnomalySegment = useMemo(
    () => (selectedAnomalySegmentKey ? anomalyDamageSegments.find((segment) => segment.key === selectedAnomalySegmentKey) ?? null : null),
    [anomalyDamageSegments, selectedAnomalySegmentKey]
  );
  const anomalyBuffOptionsBySegmentKey = useMemo<Record<string, AppliedBuffTagViewModel[]>>(() => {
    return buildAnomalyBuffOptionsBySegmentKey(
      selectedAnomalyDamages,
      fullCombinedModifierBuffList,
      extraHitBuffList
    );
  }, [extraHitBuffList, fullCombinedModifierBuffList, selectedAnomalyDamages]);
  const activeAnomalyBuffOptions = useMemo(
    () => (activeAnomalySegment ? (anomalyBuffOptionsBySegmentKey[activeAnomalySegment.key] ?? activeAnomalySegment.appliedBuffTags) : []),
    [activeAnomalySegment, anomalyBuffOptionsBySegmentKey]
  );
  const isShowingAnomalyDetail = Boolean(activeAnomalySegment) && selectedHitIndex === null;
  const anomalyDamageSummary = useMemo(() => {
    return anomalyDamageSegments.reduce(
      (sum, segment) => {
        sum.expected += segment.expectedValue;
        sum.crit += segment.critValue;
        sum.nonCrit += segment.nonCritValue;
        return sum;
      },
      { expected: 0, crit: 0, nonCrit: 0 }
    );
  }, [anomalyDamageSegments]);
  const totalNonCritSummaryFormula = useMemo(() => {
    if (!damageViewModel) {
      return '无';
    }
    const normalParts = damageViewModel.hitCards.map((hitCard) => `${hitCard.displayName} ${hitCard.nonCritText}`);
    const anomalyParts = anomalyDamageSegments.map((segment) => `${segment.sequenceTitle} ${segment.nonCritText}`);
    const allParts = [...normalParts, ...anomalyParts];
    if (allParts.length === 0) {
      return '无';
    }
    return `${allParts.join(' + ')} = ${(Number(damageViewModel.summary.totalNonCritText) + anomalyDamageSummary.nonCrit).toFixed(0)}`;
  }, [anomalyDamageSegments, anomalyDamageSummary.nonCrit, damageViewModel]);

  useEffect(() => {
    if (!selectedAnomalySegmentKey) {
      return;
    }
    if (anomalyDamageSegments.some((segment) => segment.key === selectedAnomalySegmentKey)) {
      return;
    }
    setSelectedAnomalySegmentKey(null);
    setIsAnomalyFormulaExpanded(false);
  }, [anomalyDamageSegments, selectedAnomalySegmentKey]);

  // 弹窗打开时加载数据，并设置当前选中的技能按钮
  useEffect(() => {
    if (isModalOpen && !wasModalOpenRef.current) {
      loadBuffList();
      setSkillLevelModeMap(loadSkillLevelModeMap());
      loadResolvedTemplate();
      loadPanelData();
      setIsExpanded(false);
      setSelectedHitIndex(0);
      setSelectedSkillButton(button.id);
      resetAnomalyDraftState();
      loadPersistedAnomalyCards();
      loadPersistedManualBuffTweaks();
      setSelectedAnomalySegmentKey(null);
      setIsAnomalyFormulaExpanded(false);
    } else if (!isModalOpen && wasModalOpenRef.current) {
      setSelectedSkillButton(null);
    }

    wasModalOpenRef.current = isModalOpen;
  }, [isModalOpen, button.id, button.characterId, characterName, loadBuffList, loadSkillLevelModeMap, loadResolvedTemplate, loadPanelData, loadPersistedAnomalyCards, loadPersistedManualBuffTweaks, resetAnomalyDraftState]);

  const renderAppliedBuffButtons = useCallback((segmentKey: string | null, buffTags: AppliedBuffTagViewModel[]) => {
    if (buffTags.length === 0) {
      return <span className="no-buff">无</span>;
    }

    return buffTags.map((buff) => {
      const isSelected = segmentKey ? isBuffManuallyActive(segmentKey, buff.id) : true;
      return (
        <button
          type="button"
          key={buff.id}
          className={`buff-tag buff-tag-selectable${isSelected ? ' is-selected' : ''}`}
          onClick={() => {
            if (!segmentKey) {
              return;
            }
            toggleManualBuff(segmentKey, buff.id);
          }}
          title={`${isSelected ? '点击停用' : '点击恢复'}：${buff.label} / ${buff.sourceName}`}
        >
          {buff.label}
        </button>
      );
    });
  }, [isBuffManuallyActive, toggleManualBuff]);

  // 监听 Buff 添加事件，实时刷新 Buff 列表
  useEffect(() => {
    // 使用 events 层封装监听 Buff 添加事件
    const unsubscribe = onSkillButtonBuffAdded(({ buttonId }) => {
      // 只有当 Buff 是添加到当前按钮时才刷新
      if (buttonId === button.id) {
        loadBuffList();
        loadPanelData();
      }
    });

    return unsubscribe;
  }, [button.id, loadBuffList, loadPanelData]);

  /**
   * 处理鼠标按下事件
   * 启动长按检测，0.2秒后触发拖拽
   */
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();

    // 重置长按标志
    isLongPressRef.current = false;

    // 启动长按定时器（0.2秒 = 200ms）
    longPressTimerRef.current = setTimeout(() => {
      isLongPressRef.current = true;
      // 长按触发拖拽
      onMouseDown(e);
    }, 200);

    // 添加全局鼠标释放监听，用于清除定时器
    const handleMouseUp = () => {
      if (longPressTimerRef.current) {
        clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
      }
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mouseup', handleMouseUp);
  }, [onMouseDown]);

  /**
   * 处理点击事件（区分单击和双击）
   */
  const handleClick = useCallback(() => {
    // 如果是长按，不处理点击
    if (isLongPressRef.current) return;

    clickCountRef.current += 1;

    // 单击检测：等待一段时间确认不是双击
    if (clickCountRef.current === 1) {
      clickTimerRef.current = setTimeout(() => {
        // 单击处理（目前无操作）
        clickCountRef.current = 0;
      }, 250); // 250ms 内无第二次点击视为单击
    } else if (clickCountRef.current === 2) {
      // 双击处理
      if (clickTimerRef.current) {
        clearTimeout(clickTimerRef.current);
        clickTimerRef.current = null;
      }
      clickCountRef.current = 0;

      // 打开居中弹窗
      setIsModalOpen(true);
      // 通知父组件弹窗已打开（用于强制显示 ToolPanel）
      onModalOpen?.();
      console.log('双击技能按钮，打开弹窗:', button.id);

      // 输出总数据结构到控制台
      if (timelineData) {
        console.log('【排轴数据】当前总数据结构:', timelineData);
      }
    }
  }, [button.id, timelineData]);

  /**
   * 图标加载成功时：隐藏圆形图标内的兜底技能字母，底座文字继续显示。
   */
  const handleIconLoad = () => {
    setIconLoadFailed(false);
  };

  /**
   * 图标加载失败时：标记失败状态，CSS 类切换显示兜底文字
   */
  const handleIconError = () => {
    setIconLoadFailed(true);
  };

  return (
    <>
      <div
        className={`canvas-skill-button ${isSelected ? 'selected' : ''} ${isDragging ? 'dragging' : ''} ${isLocked ? 'locked' : ''}`}
        style={{
          left: position.x - radius - visualOffsetX,
          top: position.y - radius - visualOffsetY,
          width: hitWidth,
          height: hitHeight,
          '--skill-button-size': `${size}px`,
          '--skill-button-radius': `${radius}px`,
          '--skill-button-element-color': getElementBackgroundColor(element ?? ''),
        } as CSSProperties}
        onMouseDown={handleMouseDown}
        onClick={handleClick}
        onContextMenu={onContextMenu}
      >
        <div className="skill-button-anchor">
          <div className="skill-button-base">
            <span className="skill-button-name">{skillType} {displayName}</span>
            {isLocked ? <span className="skill-button-lock">锁</span> : null}
          </div>
          <div className="skill-button-orb" title={`${characterName} - ${displayName}`}>
            {/* skillIconUrl 有值且未失败时渲染图标 */}
            {skillIconUrl && !iconLoadFailed ? (
              <img
                className="skill-icon"
                key={normalizeAssetUrl(skillIconUrl)}
                src={normalizeAssetUrl(skillIconUrl)}
                alt={displayName}
                onLoad={handleIconLoad}
                onError={handleIconError}
              />
            ) : null}
            {/* 兜底文字：图标加载失败或无图标时显示 */}
            <span className={`skill-label ${!iconLoadFailed && skillIconUrl ? 'hidden' : ''}`}>{skillType}</span>
          </div>
        </div>
      </div>

      {/* 右键上下文菜单 - 贴着按钮右侧，垂直中段对齐 */}
      {contextMenuState?.buttonId === button.id && (
        <div
          className="skill-button-context-menu"
          style={{
            left: position.x + visualOffsetX,
            top: position.y + radius - visualOffsetY,
          }}
        >
          <button
            className="context-menu-item"
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              onCloseContextMenu?.();
            }}
          >
            取消
          </button>
          <div className="context-menu-item-submenu">
            <div className="context-menu-item context-menu-submenu-trigger">
              <span>编辑</span>
              <span className="context-menu-submenu-arrow">▶</span>
            </div>
            <div className="context-menu-submenu">
              {skillChangeOptions.map((option, index) => (
                <button
                  key={`${option.nextRuntimeSkillId ?? option.nextSkillType}-${index}`}
                  className="context-menu-item"
                  onClick={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    onChangeSkillType?.({
                      buttonId: button.id,
                      ...option,
                    });
                    onCloseContextMenu?.();
                  }}
                >
                  {`改为${option.nextSkillType} / ${option.nextSkillDisplayName ?? option.nextSkillType}`}
                </button>
              ))}
            </div>
          </div>
          <button
            className="context-menu-item"
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              onCopy?.();
            }}
          >
            复制
          </button>
          <button
            className="context-menu-item context-menu-item-danger"
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              onConfirmRemove?.();
            }}
          >
            删除
          </button>
        </div>
      )}

      {/* 技能信息弹窗 + 技能伤害弹窗 */}
      {isModalOpen && (
        <div className="skill-button-modal-overlay">
          {isLocalBuffSearchOpen ? (
            <div className="skill-button-inline-buff-search-mask" onClick={closeLocalBuffSearch}>
              <div className={`skill-button-inline-buff-search${buffSearchMode === 'anomaly' ? ' is-anomaly-mode' : ''}`} onClick={(event) => event.stopPropagation()}>
                <div className="skill-button-inline-buff-search-head">
                <h5>{buffSearchMode === 'local' ? '本地 Buff' : buffSearchMode === 'anomaly' ? '异常伤害' : buffSearchMode === 'anomaly-state' ? '异常状态区' : '状态区'}</h5>
                  <span>Tab 切换入口 / Esc 关闭</span>
                </div>
                <div className="skill-button-inline-buff-search-modes">
                  <button
                    type="button"
                    className={`skill-button-inline-buff-search-mode${buffSearchMode === 'local' ? ' is-active' : ''}`}
                    onClick={() => setBuffSearchMode('local')}
                  >
                    本地 Buff
                  </button>
                  <button
                    type="button"
                    className={`skill-button-inline-buff-search-mode${buffSearchMode === 'anomaly' ? ' is-active' : ''}`}
                    onClick={() => setBuffSearchMode('anomaly')}
                  >
                    异常伤害
                  </button>
                  <button
                    type="button"
                    className={`skill-button-inline-buff-search-mode${buffSearchMode === 'anomaly-state' ? ' is-active' : ''}`}
                    onClick={() => setBuffSearchMode('anomaly-state')}
                  >
                    异常状态区
                  </button>
                  <button
                    type="button"
                    className={`skill-button-inline-buff-search-mode${buffSearchMode === 'state' ? ' is-active' : ''}`}
                    onClick={() => setBuffSearchMode('state')}
                  >
                    状态区
                  </button>
                </div>
                {buffSearchMode === 'anomaly' ? (
                  <SkillButtonAnomalyPanel
                    activeAnomaly={activeAnomaly}
                    activeAnomalyGroup={activeAnomalyGroup}
                    activeAnomalyLevel={activeAnomalyLevel}
                    activeAnomalyPreview={activeAnomalyPreview}
                    activeSourceCharacter={activeSourceCharacter}
                    sourceCharacters={sourceCharacters}
                    selectedAnomalyDamages={selectedAnomalyDamages}
                    activeDurationSeconds={activeDurationSeconds}
                    includeDotInTotal={includeDotInTotal}
                    onSetActiveAnomalyGroup={setActiveAnomalyGroup}
                    onResetActiveAnomalyKey={() => setActiveAnomalyKey(null)}
                    onSelectAnomaly={handleSelectAnomaly}
                    onApplyActiveAnomaly={handleApplyActiveAnomaly}
                    onSetActiveAnomalyLevel={setActiveAnomalyLevel}
                    onSetActiveAnomalySourceId={setActiveAnomalySourceId}
                    onSetIncludeDotInTotal={setIncludeDotInTotal}
                    onSetActiveDurationSeconds={setActiveDurationSeconds}
                    onRemoveAnomalyCard={removeAnomalyCard}
                  />
                ) : buffSearchMode === 'anomaly-state' ? (
                  <SkillButtonAnomalyStatePanel
                    activeAnomalyStateOption={activeAnomalyStateOption}
                    activeAnomalyStateLevel={activeAnomalyStateLevel}
                    activeAnomalyStateDurationSeconds={activeAnomalyStateDurationSeconds}
                    activeAnomalyStatePreview={activeAnomalyStatePreview}
                    activeAnomalyStateSourceCharacter={activeAnomalyStateSourceCharacter}
                    sourceCharacters={sourceCharacters}
                    selectedAnomalyStateSnapshots={selectedAnomalyStateSnapshots}
                    availableAnomalyStateSnapshots={availableAnomalyStateSnapshots}
                    anomalyStateSnapshotUsageCounts={anomalyStateSnapshotUsageCounts}
                    onSelectAnomalyState={handleSelectAnomalyState}
                    onCreateSnapshot={handleCreateAnomalyStateSnapshot}
                    onSetActiveAnomalyStateLevel={setActiveAnomalyStateLevel}
                    onSetActiveAnomalyStateSourceId={setActiveAnomalyStateSourceId}
                    onSetActiveAnomalyStateDurationSeconds={setActiveAnomalyStateDurationSeconds}
                    onRemoveAnomalyStateSnapshotCard={removeAnomalyStateSnapshotCard}
                    onAttachAnomalyStateSnapshotCard={attachAnomalyStateSnapshotCard}
                    onDeleteAnomalyStateSnapshotCard={deleteAnomalyStateSnapshotCard}
                  />
                ) : buffSearchMode === 'state' ? (
                  <SkillButtonStatePanel
                    activeAnomaly={activeAnomaly}
                    activeAnomalyLevel={activeAnomalyLevel}
                    activeAnomalyPreview={activeAnomalyPreview}
                    selectedStatusCards={selectedStatusCards}
                    onSelectAnomaly={handleSelectAnomaly}
                    onApplyActiveAnomaly={handleApplyActiveAnomaly}
                    onSetActiveAnomalyLevel={setActiveAnomalyLevel}
                    onRemoveAnomalyCard={removeAnomalyCard}
                  />
                ) : (
                  <>
                    <input
                      ref={localBuffSearchInputRef}
                      className="skill-button-inline-buff-search-input"
                      value={localBuffSearchKeyword}
                      onChange={(event) => setLocalBuffSearchKeyword(event.target.value)}
                      placeholder="搜索组 / 项 / Buff / 类型 / 条件"
                    />
                    <div className="skill-button-inline-buff-search-results">
                      {localBuffSearchKeyword.trim().length === 0 ? (
                        <div className="skill-button-inline-buff-search-empty">
                          输入关键词后再显示本地 Buff 结果
                        </div>
                      ) : localBuffSearchResults.length > 0 ? (
                        localBuffSearchResults.map((entry) => (
                          <button
                            key={entry.key}
                            type="button"
                            className="skill-button-inline-buff-search-item"
                            onClick={() => handleApplyLocalBuffSearchResult(entry)}
                          >
                            <div className="local-buff-search-item-head">
                              <strong>{entry.displayName}</strong>
                              <span>{entry.type || '暂无'}</span>
                            </div>
                            <p>{entry.groupName}{entry.itemName ? ` / ${entry.itemName}` : ''}</p>
                            <p>数值: {entry.value ?? '-'}{entry.condition ? ` / ${entry.condition}` : ''}</p>
                          </button>
                        ))
                      ) : (
                        <div className="skill-button-inline-buff-search-empty">
                          没有匹配到本地 Buff
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>
          ) : null}
          <div className={`skill-button-modal-pair${isLocalBuffSearchOpen ? ' is-buff-search-open' : ''}`}>
            {/* 弹窗1：技能信息 */}
            <div className="skill-button-modal skill-button-modal-info">
              {/* 独立标题区 */}
              <div className="modal-header">
                <h4 className="modal-title">技能信息</h4>
                <button
                  className={`lock-control ${isLocked ? 'is-locked' : ''}`}
                  onClick={() => dispatch({ type: 'TOGGLE_SKILL_BUTTON_LOCK', buttonId: button.id })}
                  title={isLocked ? '点击解锁，解锁后可右键删除' : '点击锁定，锁定后右键不能删除'}
                >
                  <span className="lock-icon">{isLocked ? '🔒' : '🔓'}</span>
                  <span className="lock-text">{isLocked ? '已锁定' : '未锁定'}</span>
                </button>
              </div>
              <div className="modal-content">
                <p><strong>角色:</strong> {characterName}</p>
                <p><strong>技能:</strong> {skillType} / {displayName} <strong>L{skillLevelModeMap[skillType].replace('L', '')}</strong></p>
                <p><strong>干员索引:</strong> {(button as SkillButtonType).lineIndex}</p>
                {(() => {
                  const staffLine = timelineData?.staffLines?.find(s => s.staffIndex === (button as SkillButtonType).lineIndex);
                  const btnData = staffLine?.buttons?.find(b => b.id === button.id);
                  if (btnData) {
                    return (
                      <>
                        <p><strong>节点索引:</strong> {btnData.nodeIndex}</p>
                        <p><strong>节点编号:</strong> {btnData.nodeNumber}</p>
                      </>
                    );
                  }
                  return null;
                })()}
              </div>

              {/* Buff 列表 */}
              <div className="skill-button-buff-section">
                <h5>已选 Buff</h5>
                <div className="skill-button-buff-list">
                  {buffList.length === 0 ? (
                    <div className="skill-button-buff-empty">单击陈列区或搜索抽屉的 Buff 添加</div>
                  ) : (
                    buffList.map((buff) => (
                      <div
                        key={buff.id}
                        className="skill-button-buff-item"
                        title={`${buff.displayName} (${buff.sourceName})`}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          removeBuff(buff.id);
                        }}
                      >
                        {buff.displayName}
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div className="skill-button-buff-section skill-button-anomaly-summary-section">
                <h5>已选状态 / 异常</h5>
                <div className="skill-button-anomaly-summary-list">
                  {[...selectedStatusCards, ...selectedAnomalyStateSnapshots, ...selectedAnomalyDamages].length === 0 ? (
                    <div className="skill-button-buff-empty">按 Tab 打开状态区、异常状态区或异常伤害页勾选要演示的项</div>
                  ) : (
                    [
                      ...selectedStatusCards,
                      ...selectedAnomalyStateSnapshots.map((snapshot) => ({
                        ...snapshot,
                        kind: 'state' as const,
                      })),
                      ...selectedAnomalyDamages,
                    ].map((card) => (
                      <div
                        key={card.id}
                        className={`skill-button-anomaly-summary-card is-${card.kind}`}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          if (typeof card.id === 'number') {
                            removeAnomalyStateSnapshotCard(card.id);
                            return;
                          }
                          removeAnomalyCard(card.kind, card.id);
                        }}
                        title="右键移除"
                      >
                        <div className="anomaly-summary-head">
                          <span className="anomaly-summary-kind">{card.kind === 'state' ? '状态' : '伤害'}</span>
                          <span className="anomaly-summary-title">{card.primaryText}</span>
                        </div>
                        <p>{card.secondaryText}</p>
                        {card.tertiaryText ? <p>{card.tertiaryText}</p> : null}
                      </div>
                    ))
                  )}
                </div>
              </div>

              <button className="modal-close-btn" onClick={handleCloseModal}>关闭</button>
            </div>

            {/* 弹窗2：技能伤害 - Hit 主导版本 */}
            <div className="skill-button-modal skill-button-modal-damage">
              <h4>技能伤害</h4>
              <div className="modal-content">
                {damageResult ? (
                  (() => {
                    if (!damageViewModel) {
                      return <p className="skill-damage-empty">加载技能数据中...</p>;
                    }

                    return (
                      <>
                        {/* 总览区 */}
                        <div className="skill-damage-summary">
                          <p className="skill-damage-title">{damageViewModel.header.fullText}</p>
                          <div className="skill-damage-total">
                            <span>总伤(期望): {(Number(damageViewModel.summary.totalExpectedText) + anomalyDamageSummary.expected).toFixed(0)}</span>
                            <span>总伤(暴击): {(Number(damageViewModel.summary.totalCritText) + anomalyDamageSummary.crit).toFixed(0)}</span>
                            <span>总伤(非暴): {(Number(damageViewModel.summary.totalNonCritText) + anomalyDamageSummary.nonCrit).toFixed(0)}</span>
                          </div>
                          <p className="skill-damage-total-formula">总伤(非暴)步骤: {totalNonCritSummaryFormula}</p>
                        </div>

                        {/* Hit 列表区 */}
                        <div className="skill-damage-hits">
                          {damageViewModel.hitCards.map((hitCard, index) => (
                            <div
                              key={hitCard.key}
                              className={`skill-damage-hit-card ${hitCard.isSelected ? 'selected' : ''}`}
                              onClick={() => {
                                setSelectedHitIndex(index);
                                setSelectedAnomalySegmentKey(null);
                                setIsAnomalyFormulaExpanded(false);
                              }}
                            >
                              <div className="hit-card-header">
                                <div className="hit-card-title-group">
                                  <span className="hit-name">{hitCard.displayName}</span>
                                  <span className="buff-count">{hitCard.buffCountText}</span>
                                </div>
                                <span className="hit-multiplier">{hitCard.multiplierText}</span>
                              </div>
                              <div className="hit-card-damage">
                                <span className="damage-line">期望: <span className="damage-expected">{hitCard.expectedText}</span></span>
                                <span className="damage-line">暴击: <span className="damage-crit">{hitCard.critText}</span></span>
                                <span className="damage-line">非暴: <span className="damage-non-crit">{hitCard.nonCritText}</span></span>
                              </div>
                            </div>
                          ))}
                          {anomalyDamageSegments.map((segment) => (
                            <div
                              key={segment.key}
                              className={`skill-damage-hit-card${activeAnomalySegment?.key === segment.key ? ' selected' : ''}`}
                              onClick={() => {
                                setSelectedHitIndex(null);
                                setSelectedAnomalySegmentKey(segment.key);
                                setIsAnomalyFormulaExpanded(false);
                              }}
                            >
                              <div className="hit-card-header">
                                <div className="hit-card-title-group">
                                  <span className="hit-name">{segment.sequenceTitle}</span>
                                  <span className="buff-count">{segment.buffText}</span>
                                  <span className="buff-count">{segment.compactTitle}</span>
                                  <span className="buff-count">{segment.skillTypeText ? `${segment.skillTypeText} / ${segment.elementText}` : segment.elementText}</span>
                                </div>
                                <span className="hit-multiplier">{segment.multiplierText}</span>
                              </div>
                              <div className="hit-card-damage">
                                <span className="damage-line">期望: <span className="damage-expected">{segment.expectedText}</span></span>
                                <span className="damage-line">暴击: <span className="damage-crit">{segment.critText}</span></span>
                                <span className="damage-line">非暴: <span className="damage-non-crit">{segment.nonCritText}</span></span>
                              </div>
                            </div>
                          ))}
                        </div>

                        {/* Hit 详情区 */}
                        {!isShowingAnomalyDetail && damageViewModel.activeHitDetail && (
                          <div className="skill-damage-hit-detail">
                            <p className="hit-detail-title">{damageViewModel.activeHitDetail.title}</p>
                            <div className="hit-detail-stats">
                              <p>倍率: {damageViewModel.activeHitDetail.multiplierText}</p>
                              <p>元素: {damageViewModel.activeHitDetail.elementText}</p>
                              <p>期望伤害: {damageViewModel.activeHitDetail.expectedText}</p>
                              <p>暴击伤害: {damageViewModel.activeHitDetail.critText}</p>
                              <p>非暴击伤害: {damageViewModel.activeHitDetail.nonCritText}</p>
                            </div>
                            <div className="hit-detail-buffs">
                              <div className="hit-detail-buffs-head">
                                <p className="buff-section-title">生效 Buff:</p>
                                {activeNormalHitSegmentKey && (manuallyDisabledBuffIdsBySegmentKey[activeNormalHitSegmentKey]?.length ?? 0) > 0 ? (
                                  <button type="button" className="buff-reset-btn" onClick={() => resetManualBuffTweaks(activeNormalHitSegmentKey)}>重置微调</button>
                                ) : null}
                              </div>
                              <p className="buff-section-tip">点按按钮可临时启停本次计算</p>
                              {renderAppliedBuffButtons(activeNormalHitSegmentKey, activeHitBuffOptions)}
                            </div>
                          </div>
                        )}

                        {isShowingAnomalyDetail && activeAnomalySegment && (
                          <div className="skill-damage-hit-detail">
                            <p className="hit-detail-title">{activeAnomalySegment.title}</p>
                            <div className="hit-detail-stats">
                              <p>ATK: {activeAnomalySegment.panelAtkText}</p>
                              <p>暴击率: {activeAnomalySegment.critRateText}</p>
                              <p>暴击伤害: {activeAnomalySegment.critDmgText}</p>
                              <p>技能类型: {activeAnomalySegment.skillTypeText || '-'}</p>
                              <p>伤害类型: {activeAnomalySegment.elementText}</p>
                              <p>最终倍率: {activeAnomalySegment.multiplierText}</p>
                              {activeAnomalySegment.sourceKind === 'buff-extra-hit' && (
                                <>
                                  <p>来源 Buff: {activeAnomalySegment.sourceBuffName || '-'}</p>
                                  <p>失衡值: {activeAnomalySegment.imbalanceText || '-'}</p>
                                  <p>冷却文案: {activeAnomalySegment.cooldownText || '-'}</p>
                                </>
                              )}
                              <p>期望伤害: {activeAnomalySegment.expectedText}</p>
                              <p>暴击伤害: {activeAnomalySegment.critText}</p>
                              <p>非暴击伤害: {activeAnomalySegment.nonCritText}</p>
                            </div>
                            <div className="hit-detail-buffs">
                              <div className="hit-detail-buffs-head">
                                <p className="buff-section-title">生效 Buff:</p>
                                {(manuallyDisabledBuffIdsBySegmentKey[activeAnomalySegment.key]?.length ?? 0) > 0 ? (
                                  <button type="button" className="buff-reset-btn" onClick={() => resetManualBuffTweaks(activeAnomalySegment.key)}>重置微调</button>
                                ) : null}
                              </div>
                              <p className="buff-section-tip">点按按钮可临时启停本次计算</p>
                              {renderAppliedBuffButtons(activeAnomalySegment.key, activeAnomalyBuffOptions)}
                            </div>
                          </div>
                        )}

                        {/* 展开计算过程 - 基于当前选中的 activeHit */}
                        {!isShowingAnomalyDetail && isExpanded && damageViewModel.activeHitFormula && (
                          <div className="skill-damage-expanded">
                            <p className="skill-damage-expand-title">{damageViewModel.activeHitFormula.title}</p>
                            <div className="skill-damage-formula">
                              <p className="formula-section-title">【面板属性】</p>
                              {damageViewModel.activeHitFormula.panelLines.map((line) => (
                                <p key={line}>{line}</p>
                              ))}
                              <p className="formula-section-title">【生效 Buff】</p>
                              {damageViewModel.activeHitFormula.buffTags.length > 0 ? (
                                <div className="formula-buff-tags">
                                  {damageViewModel.activeHitFormula.buffTags.map((buffName) => (
                                    <span key={buffName} className="buff-tag">{buffName}</span>
                                  ))}
                                </div>
                              ) : (
                                <p>无</p>
                              )}

                              <div className="formula-zone-section">
                                <p className="formula-section-title">【倍率区】</p>
                                <p>基础倍率: {damageViewModel.activeHitFormula.baseMultiplierText}</p>
                                <p>倍率 Buff 加算: {damageViewModel.activeHitFormula.multiplierFormulaText}</p>
                                <p className="formula-zone-total">最终倍率 = {damageViewModel.activeHitFormula.formulaText}</p>
                              </div>

                              <div className="formula-zone-section">
                                <p className="formula-section-title">【加成区】</p>
                                <p>元素伤害加成 {damageViewModel.activeHitFormula.elementBonusText}</p>
                                <p>技能伤害加成 {damageViewModel.activeHitFormula.skillBonusText}</p>
                                <p>全伤害加成 {damageViewModel.activeHitFormula.allDamageBonusText}</p>
                                <p className="formula-zone-total">加成区系数 = 1 + {damageViewModel.activeHitFormula.elementBonusText} + {damageViewModel.activeHitFormula.skillBonusText} + {damageViewModel.activeHitFormula.allDamageBonusText} = {damageViewModel.activeHitFormula.damageBonusRateText}</p>
                              </div>

                              <div className="formula-zone-section">
                                <p className="formula-section-title">【增幅区】</p>
                                <p>法术/元素增幅</p>
                                <p className="formula-zone-total">增幅区 = {damageViewModel.activeHitFormula.amplifyFormulaText}</p>
                              </div>

                              <div className="formula-zone-section">
                                <p className="formula-section-title">【脆弱区】</p>
                                <p>脆弱效果</p>
                                <p className="formula-zone-total">脆弱区 = {damageViewModel.activeHitFormula.fragileFormulaText}</p>
                              </div>

                              <div className="formula-zone-section">
                                <p className="formula-section-title">【易伤区】</p>
                                <p>易伤效果</p>
                                <p className="formula-zone-total">易伤区 = {damageViewModel.activeHitFormula.vulnerabilityFormulaText}</p>
                              </div>

                              <div className="formula-zone-section">
                                <p className="formula-section-title">【连击区】</p>
                                <p>连击增伤</p>
                                <p className="formula-zone-total">连击区 = {damageViewModel.activeHitFormula.comboFormulaText}</p>
                              </div>

                              <div className="formula-zone-section">
                                <p className="formula-section-title">【失衡区】</p>
                                <p>失衡增伤</p>
                                <p className="formula-zone-total">失衡区 = {damageViewModel.activeHitFormula.imbalanceFormulaText}</p>
                              </div>

                              <div className="formula-zone-section">
                                <p className="formula-section-title">【防御区】</p>
                                <p>防御减免系数</p>
                                <p className="formula-zone-total">防御区 = {damageViewModel.activeHitFormula.defenseZoneText}</p>
                              </div>

                              <p className="formula-section-title">【结果】</p>
                              <p>非暴击总伤 = {damageViewModel.activeHitFormula.nonCritFormulaText}</p>
                              <p>期望伤害: {damageViewModel.activeHitFormula.expectedText}</p>
                              <p>暴击伤害: {damageViewModel.activeHitFormula.critText}</p>
                              <p>非暴击伤害: {damageViewModel.activeHitFormula.nonCritText}</p>
                            </div>
                          </div>
                        )}

                        {isShowingAnomalyDetail && activeAnomalySegment && isAnomalyFormulaExpanded && (
                          <div className="skill-damage-expanded">
                            <p className="skill-damage-expand-title">{activeAnomalySegment.title} 计算过程</p>
                            <div className="skill-damage-formula">
                              <p className="formula-section-title">【面板属性】</p>
                              <p>ATK: {activeAnomalySegment.panelAtkText}</p>
                              <p>暴击率: {activeAnomalySegment.critRateText}</p>
                              <p>暴击伤害: {activeAnomalySegment.critDmgText}</p>

                              <p className="formula-section-title">【生效 Buff】</p>
                              {activeAnomalySegment.appliedBuffTags.length > 0 ? (
                                <div className="formula-buff-tags">
                                  {activeAnomalySegment.appliedBuffTags.map((buff) => (
                                    <span key={buff.id} className="buff-tag">{buff.label}</span>
                                  ))}
                                </div>
                              ) : (
                                <p>无</p>
                              )}

                              <div className="formula-zone-section">
                                <p className="formula-section-title">【倍率区】</p>
                                <p>基础倍率: {activeAnomalySegment.baseMultiplierText}</p>
                                <p>倍率 Buff 加算: {activeAnomalySegment.multiplierFormulaText}</p>
                                {activeAnomalySegment.sourceKind === 'anomaly' && (
                                  <>
                                    <p>源石技艺强度: {activeAnomalySegment.sourceSkillBoostText}</p>
                                    <p>等级系数区: × {activeAnomalySegment.levelCoefficientText}</p>
                                    <p>源石技艺强度区: × {activeAnomalySegment.sourceSkillZoneText}</p>
                                  </>
                                )}
                                <p className="formula-zone-total">最终倍率 = {activeAnomalySegment.formulaText}</p>
                              </div>

                              <div className="formula-zone-section">
                                <p className="formula-section-title">【加成区】</p>
                                <p>元素伤害加成 {activeAnomalySegment.elementBonusText}</p>
                                <p>技能伤害加成 {activeAnomalySegment.skillBonusText}</p>
                                <p>全伤害加成 {activeAnomalySegment.allDamageBonusText}</p>
                                <p className="formula-zone-total">加成区系数 = 1 + {activeAnomalySegment.elementBonusText} + {activeAnomalySegment.skillBonusText} + {activeAnomalySegment.allDamageBonusText} = {activeAnomalySegment.damageBonusRateText}</p>
                              </div>

                              <div className="formula-zone-section">
                                <p className="formula-section-title">【增幅区】</p>
                                <p>法术/元素增幅</p>
                                <p className="formula-zone-total">增幅区 = {activeAnomalySegment.amplifyFormulaText}</p>
                              </div>

                              <div className="formula-zone-section">
                                <p className="formula-section-title">【脆弱区】</p>
                                <p>脆弱效果</p>
                                <p className="formula-zone-total">脆弱区 = {activeAnomalySegment.fragileFormulaText}</p>
                              </div>

                              <div className="formula-zone-section">
                                <p className="formula-section-title">【易伤区】</p>
                                <p>易伤效果</p>
                                <p className="formula-zone-total">易伤区 = {activeAnomalySegment.vulnerabilityFormulaText}</p>
                              </div>

                              <div className="formula-zone-section">
                                <p className="formula-section-title">【连击区】</p>
                                <p>连击增伤</p>
                                <p className="formula-zone-total">连击区 = {activeAnomalySegment.comboFormulaText}</p>
                              </div>

                              <div className="formula-zone-section">
                                <p className="formula-section-title">【失衡区】</p>
                                <p>失衡增伤</p>
                                <p className="formula-zone-total">失衡区 = {activeAnomalySegment.imbalanceFormulaText}</p>
                              </div>

                              <div className="formula-zone-section">
                                <p className="formula-section-title">【防御区】</p>
                                <p>防御减免系数</p>
                                <p className="formula-zone-total">防御区 = {activeAnomalySegment.defenseZoneText}</p>
                              </div>

                              {activeAnomalySegment.sourceKind === 'buff-extra-hit' && (
                                <div className="formula-zone-section">
                                  <p className="formula-section-title">【附加信息】</p>
                                  <p>来源 Buff: {activeAnomalySegment.sourceBuffName || '-'}</p>
                                  <p>失衡值: {activeAnomalySegment.imbalanceText || '-'}</p>
                                  <p>冷却文案: {activeAnomalySegment.cooldownText || '-'}</p>
                                </div>
                              )}

                              <p className="formula-section-title">【结果】</p>
                              <p>非暴击总伤 = {activeAnomalySegment.nonCritFormulaText}</p>
                              <p>期望伤害: {activeAnomalySegment.expectedText}</p>
                              <p>暴击伤害: {activeAnomalySegment.critText}</p>
                              <p>非暴击伤害: {activeAnomalySegment.nonCritText}</p>
                            </div>
                          </div>
                        )}

                        <button
                          className="skill-damage-expand-btn"
                          onClick={() => {
                            if (isShowingAnomalyDetail) {
                              setIsAnomalyFormulaExpanded(!isAnomalyFormulaExpanded);
                              return;
                            }
                            setIsExpanded(!isExpanded);
                          }}
                        >
                          {isShowingAnomalyDetail
                            ? (isAnomalyFormulaExpanded ? '收起异常计算过程' : '展开异常计算过程')
                            : (isExpanded ? '收起计算过程' : '展开计算过程')}
                        </button>
                      </>
                    );
                  })()
                ) : (
                  <p className="skill-damage-empty">{!panelData ? '加载面板数据...' : '加载技能模板中...'}</p>
                )}
              </div>
            </div>

            {/* 弹窗4：信息快照 */}
            <div className="skill-button-modal skill-button-modal-info-snapshot">
              <h4>信息</h4>
              <div className="modal-content">
                {infoSnapshotLines.length > 0 ? (
                  <pre className="skill-info-snapshot-content">{infoSnapshotLines.join('\n')}</pre>
                ) : (
                  <p className="skill-info-snapshot-empty">暂无信息快照</p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

