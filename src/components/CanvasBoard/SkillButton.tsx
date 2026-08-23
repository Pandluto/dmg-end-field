import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import type { CSSProperties } from 'react';
import { createPortal } from 'react-dom';
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
  decrementSkillButtonBuffStack,
  setSelectedSkillButton,
  getButtonBuffs,
  recomputeSkillButtonPanel,
  addSkillButtonBuff,
} from '../../hooks/useSkillButtonBuffs';
import { AnomalyStateSnapshot, HitResistanceInput, SkillButtonBuff, SkillLevelMode } from '../../types/storage';
import { getCharacterConfig } from '../../utils/storage';
import {
  getCharacterComputedCache,
  getOperatorConfigPageCache,
} from '../../core/repositories/operatorConfigRepository';
import { getSkillButtonById, upsertSkillButton } from '../../core/repositories';
import {
  APP_ROUTE_PATHS,
  getTimelineSkillDetailPath,
  navigateToAppPath,
} from '../../utils/appRoute';
import {
  buildAttackFormulaLines,
  buildSkillDamageModalViewModel,
} from '../../core/calculators/skillDamageModalViewModel';
import { calculateSkillButtonDamageV2 } from '../../core/calculators/skillButtonDamageCalculatorV2';
import type {
  FormulaViewModel,
  ResolvedSkillDamageTemplate,
  SkillDamagePanelBase,
} from '../../core/calculators/skillDamage.types';
import { resolveSkillDamageTemplate } from '../../core/services/skillDamageTemplateResolver';
import { useAppContext } from '../../context/AppContext';
import { emitSkillButtonBuffAdded, emitSkillButtonBuffRemoved, onSkillButtonBuffAdded } from '../../core/events/buffEvents';
import { buildBuffSearchIndex, searchBuffs } from '../../utils/buffFuzzySearch';
import { refreshSnapshotCandidateBuffsForCharacterIds } from '../../core/services/operatorConfigCandidateBuffService';
import { refreshOperatorConfigSnapshotsForCharacters } from '../../core/services/operatorConfigSnapshotRefreshService';
import {
  type AnomalyDamageSegmentView,
  dedupeLocalBuffSearchResults,
  getNormalHitSegmentKey,
  isExtraHitBuff,
  isModifierBuff,
  type LocalBuffSearchResult,
  type BuffSourceSearchMode,
  BUFF_SOURCE_SEARCH_MODE_OPTIONS,
  filterBuffSearchEntriesBySourceMode,
  formatBuffCardSummary,
  getBuffSourceSearchModeLabel,
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
import { buildAnomalyDamageSegments } from './skillButtonAnomalyDamage';
import { TimelineSkillDetailWorkbench } from './TimelineSkillDetailWorkbench';
import './SkillButton.css';

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
const OPERATOR_BUFF_GROUP_FILTERS: Array<{ key: OperatorBuffGroupFilter; label: string }> = [
  { key: 'talent', label: '天赋' },
  { key: 'potential', label: '潜能' },
  { key: 'skill', label: '技能' },
];

function isSourceBuffSearchMode(mode: BuffSearchMode): mode is BuffSourceSearchMode {
  return SOURCE_BUFF_SEARCH_MODES.has(mode);
}

function getBuffSearchModeLabel(mode: BuffSearchMode): string {
  if (isSourceBuffSearchMode(mode)) {
    return getBuffSourceSearchModeLabel(mode);
  }
  return BUFF_SEARCH_MODE_OPTIONS.find((option) => option.key === mode)?.label || 'Buff组';
}

function getNextBuffSearchMode(mode: BuffSearchMode): BuffSearchMode {
  const index = BUFF_SEARCH_MODE_OPTIONS.findIndex((option) => option.key === mode);
  return BUFF_SEARCH_MODE_OPTIONS[(index + 1) % BUFF_SEARCH_MODE_OPTIONS.length].key;
}

function formatAnomalyStateSnapshotValue(snapshot: AnomalyStateSnapshot): string {
  if (snapshot.key === 'corrosion') {
    return `${(snapshot.currentCorrosion ?? snapshot.effectValue).toFixed(2)}点`;
  }
  return `${(snapshot.effectValue * 100).toFixed(1)}%`;
}

function formatAnomalyStateSnapshotField(snapshot: AnomalyStateSnapshot): string {
  switch (snapshot.key) {
    case 'conductive':
      return '法术易伤';
    case 'armor-break':
      return '物伤易伤';
    case 'corrosion':
      return '全属性降抗';
    default:
      return '快照';
  }
}

function formatAnomalyStateSnapshotName(snapshot: AnomalyStateSnapshot): string {
  const secondsText = snapshot.key === 'corrosion' && typeof snapshot.durationSeconds === 'number'
    ? `+${snapshot.durationSeconds.toFixed(0)}s`
    : '';
  return `${snapshot.label} Lv${snapshot.level}${secondsText} ${formatAnomalyStateSnapshotValue(snapshot)} (${formatAnomalyStateSnapshotField(snapshot)})`;
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

interface SkillButtonProps {
  isDetailRouteActive?: boolean;
  button: SkillButtonType & { nodeNumber?: number };
  size: number;
  onMouseDown: (e: React.MouseEvent) => void;
  onContextMenu: (e: React.MouseEvent) => void;
  timelineData?: TimelineData;
  contextMenuState?: { buttonId: string; position: { x: number; y: number } } | null;
  onConfirmRemove?: () => void;
  onCloseContextMenu?: () => void;
  onCopy?: () => void;
  onChangeSkillType?: (payload: SkillButtonSkillChangePayload) => void;
  skillChangeOptions?: SkillButtonSkillOption[];
  isBrowseMode?: boolean;
  isInspectMode?: boolean;
  isDragDisabled?: boolean;
  resistanceRevision?: number;
}

const BROWSE_MODE_SKILL_LABELS: Record<string, string> = {
  A: '重击',
  B: '战技',
  E: '连携技',
  Q: '终结技',
  Dot: '持续',
};

export function SkillButtonComponent({
  isDetailRouteActive = false,
  button,
  size,
  onMouseDown,
  onContextMenu,
  timelineData,
  contextMenuState,
  onConfirmRemove,
  onCloseContextMenu,
  onCopy,
  onChangeSkillType,
  skillChangeOptions = [],
  isBrowseMode = false,
  isInspectMode = false,
  isDragDisabled = false,
  resistanceRevision = 0,
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
  const browseModeDisplayName = BROWSE_MODE_SKILL_LABELS[skillType] ?? displayName;
  const isDotButton = button.skillType === 'Dot';
  const { state, dispatch, refreshSelectedCharacters } = useAppContext();
  const radius = size / 2;
  const baseWidth = 80;
  const baseHeight = 30;
  const baseCornerRadius = 11;
  const visualOffsetX = 40;
  const visualOffsetY = 15;
  const hitWidth = radius + baseWidth;
  const hitHeight = Math.max(size, radius + baseHeight);
  const outlinePadding = 4;
  const compositeOutlineViewBox = `${-radius - outlinePadding} ${-radius - outlinePadding} ${baseWidth + radius + outlinePadding * 2} ${baseHeight + radius + outlinePadding * 2}`;
  const compositeOutlinePath = [
    `M 0 ${-radius}`,
    `A ${radius} ${radius} 0 0 1 ${radius} 0`,
    `L ${baseWidth} 0`,
    `L ${baseWidth} ${baseHeight}`,
    `L 0 ${baseHeight}`,
    `L 0 ${radius}`,
    `A ${radius} ${radius} 0 1 1 0 ${-radius}`,
    'Z',
  ].join(' ');
  const liquidGlassCompositeOutlinePath = [
    `M 0 ${-radius}`,
    `A ${radius} ${radius} 0 0 1 ${radius} 0`,
    `L ${baseWidth - baseCornerRadius} 0`,
    `Q ${baseWidth} 0 ${baseWidth} ${baseCornerRadius}`,
    `L ${baseWidth} ${baseHeight - baseCornerRadius}`,
    `Q ${baseWidth} ${baseHeight} ${baseWidth - baseCornerRadius} ${baseHeight}`,
    `L 0 ${baseHeight}`,
    `L 0 ${radius}`,
    `A ${radius} ${radius} 0 1 1 0 ${-radius}`,
    'Z',
  ].join(' ');
  const liquidGlassOutlineGradientId = `liquid-glass-outline-${button.id.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
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
  // infoSnapshot 数据（从 sessionStorage 只读，不影响原数据）
  const [infoSnapshotLines, setInfoSnapshotLines] = useState<string[]>([]);
  // infoSnap JSON 数据（从 sessionStorage 只读，不影响原数据）
  const [infoSnap, setInfoSnap] = useState<Record<string, number>>({});
  const [selectedAnomalySegmentKey, setSelectedAnomalySegmentKey] = useState<string | null>(null);
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
  const runtimeDamageRevisionRef = useRef(resistanceRevision);
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
  }, []);

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
    removeSkillButtonBuff(button.id, buffId);
    loadPersistedManualBuffTweaks();
    loadBuffList(); // 重新加载列表
    loadPanelData();

    // 触发事件通知 CanvasBoard 从 timelineData 中移除 buffId
    emitSkillButtonBuffRemoved(button.id, buffId);
  }, [button.id, loadBuffList, loadPanelData, loadPersistedManualBuffTweaks]);

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
    burnDamageMode,
    setActiveAnomalyGroup,
    setActiveAnomalyKey,
    setActiveAnomalyLevel,
    setActiveAnomalySourceId,
    setActiveAnomalyStateDurationSeconds,
    setActiveAnomalyStateLevel,
    setActiveAnomalyStateSourceId,
    setActiveDurationSeconds,
    setBurnDamageMode,
    sourceCharacters,
    getEffectiveCharacterSourceSkillBoost,
    activeDurationSeconds,
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
      strength: computedPanel.strength,
      agility: computedPanel.agility,
      intelligence: computedPanel.intelligence,
      will: computedPanel.will,
      mainStatFinal: computedPanel.mainStatFinal,
      subStatFinal: computedPanel.subStatFinal,
      mainStatRaw: computedPanel.mainStatRaw,
      subStatRaw: computedPanel.subStatRaw,
      mainStatField: computedPanel.mainStatField,
      subStatField: computedPanel.subStatField,
      mainStatScale: computedPanel.mainStatScale,
      subStatScale: computedPanel.subStatScale,
      allStatScale: computedPanel.allStatScale,
    };
  }, [button.characterId, resistanceRevision]);
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
        buffStackCounts: buttonStackCounts,
        buffStackCountsByHitKey,
        panel: {
          atk: panelData.atk,
          critRate: panelData.critRate,
          critDmg: panelData.critDmg,
        },
        panelBase: panelBase ?? undefined,
      damageBonus: infoSnap as unknown as import('../../types/storage').DamageBonusSnapshot,
      targetResistance,
    });
  }, [resolvedTemplate, panelData, button.id, button.characterId, targetResistance, fullCombinedModifierBuffList, panelBase, infoSnap, buttonStackCounts, buffStackCountsByHitKey]);

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
        buffStackCounts: buttonStackCounts,
        buffStackCountsByHitKey,
        panel: {
          atk: panelData.atk,
          critRate: panelData.critRate,
          critDmg: panelData.critDmg,
        },
        panelBase: panelBase ?? undefined,
        disabledBuffIdsByHitKey,
        disabledHitKeys: manuallyDisabledHitKeys,
      damageBonus: infoSnap as unknown as import('../../types/storage').DamageBonusSnapshot,
      targetResistance,
    });
  }, [resolvedTemplate, panelData, button.id, button.characterId, targetResistance, fullCombinedModifierBuffList, panelBase, disabledBuffIdsByHitKey, manuallyDisabledHitKeys, infoSnap, buttonStackCounts, buffStackCountsByHitKey]);

  const damageViewModel = useMemo(() => {
    if (!resolvedTemplate || !damageResult || !panelData) {
      return null;
    }

    const activeHitPanel = selectedHitIndex !== null ? damageResult.hits[selectedHitIndex]?.panel ?? panelData : panelData;
    const activeHitStackCounts = selectedHitIndex !== null && resolvedTemplate.hits[selectedHitIndex]
      ? {
          ...buttonStackCounts,
          ...(manualBuffStackCountsBySegmentKey[getNormalHitSegmentKey(resolvedTemplate.hits[selectedHitIndex].key)] ?? {}),
        }
      : buttonStackCounts;
    return buildSkillDamageModalViewModel(
      resolvedTemplate,
      damageResult,
      selectedHitIndex,
      {
        atk: activeHitPanel.atk,
        critRate: activeHitPanel.critRate,
        critDmg: activeHitPanel.critDmg,
      },
      activeHitStackCounts,
      panelBase
    );
  }, [resolvedTemplate, damageResult, selectedHitIndex, panelData, buttonStackCounts, manualBuffStackCountsBySegmentKey, panelBase]);
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

  const getEffectiveSegmentStackCounts = useCallback((segmentKey: string) => ({
    ...buttonStackCounts,
    ...(manualBuffStackCountsBySegmentKey[segmentKey] ?? {}),
  }), [buttonStackCounts, manualBuffStackCountsBySegmentKey]);

  const adjustSegmentBuffStack = useCallback((segmentKey: string, buffId: string, delta: number) => {
    const buff = buffList.find((item) => item.id === buffId);
    if (!buff || buff.category !== 'countable') {
      return;
    }
    const maxStacks = typeof buff.maxStacks === 'number' && Number.isFinite(buff.maxStacks)
      ? Math.max(1, Math.floor(buff.maxStacks))
      : 1;
    setManualBuffStackCountsBySegmentKey((prev) => {
      const segmentCounts = prev[segmentKey] ?? {};
      const baseCount = segmentCounts[buffId] ?? buttonStackCounts[buffId] ?? maxStacks;
      const nextCount = Math.min(Math.max(Math.floor(baseCount) + delta, 1), maxStacks);
      const nextMap = {
        ...prev,
        [segmentKey]: {
          ...segmentCounts,
          [buffId]: nextCount,
        },
      };
      persistManualBuffStackCounts(nextMap);
      return nextMap;
    });
  }, [buffList, buttonStackCounts, persistManualBuffStackCounts]);

  const toggleManualHitDisabled = useCallback((hitKey: string) => {
    if (!hitKey) {
      return;
    }

    setManuallyDisabledHitKeys((prev) => {
      const next = prev.includes(hitKey)
        ? prev.filter((item) => item !== hitKey)
        : [...prev, hitKey];
      persistManualDisabledHitKeys(next);
      return next;
    });
  }, [persistManualDisabledHitKeys]);

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
      targetResistance,
      fullCombinedModifierBuffList,
      extraHitBuffList,
      buffStackCounts: buttonStackCounts,
      buffStackCountsBySegmentKey: manualBuffStackCountsBySegmentKey,
      manuallyDisabledBuffIdsBySegmentKey,
      disabledHitKeys: manuallyDisabledHitKeys,
      getEffectiveCharacterSourceSkillBoost,
    });
  }, [panelBase, panelData, damageViewModel, selectedAnomalyDamages, button.characterId, button.skillType, targetResistance, element, infoSnap, fullCombinedModifierBuffList, extraHitBuffList, buttonStackCounts, manualBuffStackCountsBySegmentKey, manuallyDisabledBuffIdsBySegmentKey, manuallyDisabledHitKeys, getEffectiveCharacterSourceSkillBoost]);

  useEffect(() => {
    if (!resolvedTemplate) {
      return;
    }

    const availableHitKeys = new Set([
      ...resolvedTemplate.hits.map((hit) => hit.key),
      ...anomalyDamageSegments.map((segment) => segment.key),
    ]);
    setManuallyDisabledHitKeys((prev) => {
      const next = prev.filter((hitKey) => availableHitKeys.has(hitKey));
      if (next.length === prev.length) {
        return prev;
      }
      persistManualDisabledHitKeys(next);
      return next;
    });
  }, [anomalyDamageSegments, persistManualDisabledHitKeys, resolvedTemplate]);

  const activeAnomalySegment = useMemo(
    () => (selectedAnomalySegmentKey ? anomalyDamageSegments.find((segment) => segment.key === selectedAnomalySegmentKey) ?? null : null),
    [anomalyDamageSegments, selectedAnomalySegmentKey]
  );
  const isShowingAnomalyDetail = Boolean(activeAnomalySegment) && selectedHitIndex === null;
  const activeAnomalyFormula = useMemo<FormulaViewModel | null>(() => {
    if (!activeAnomalySegment) {
      return null;
    }

    const appliedBuffIds = new Set(activeAnomalySegment.appliedBuffTags.map((buff) => buff.id));
    const appliedBuffs = fullCombinedModifierBuffList.filter((buff) => appliedBuffIds.has(buff.id));
    const segmentStackCounts = getEffectiveSegmentStackCounts(activeAnomalySegment.key);
    const panelLines = [
      `ATK: ${activeAnomalySegment.panelAtkText}`,
      `暴击率: ${activeAnomalySegment.critRateText}`,
      `暴击伤害: ${activeAnomalySegment.critDmgText}`,
    ];
    if (activeAnomalySegment.sourceKind === 'anomaly') {
      panelLines.push(
        `源石技艺强度: ${activeAnomalySegment.sourceSkillBoostText}`,
        `等级系数区: ${activeAnomalySegment.levelCoefficientText}`,
        `源石技艺强度区: ${activeAnomalySegment.sourceSkillZoneText}`
      );
    }

    return {
      title: `${activeAnomalySegment.title} 计算过程`,
      panelLines,
      attackLines: buildAttackFormulaLines(
        panelBase,
        {
          atk: Number(activeAnomalySegment.panelAtkText),
          critRate: Number.parseFloat(activeAnomalySegment.critRateText) / 100,
          critDmg: Number.parseFloat(activeAnomalySegment.critDmgText) / 100,
        },
        appliedBuffs,
        segmentStackCounts
      ),
      buffTags: activeAnomalySegment.appliedBuffTags,
      showNoBuff: activeAnomalySegment.appliedBuffTags.length === 0,
      baseMultiplierText: activeAnomalySegment.baseMultiplierText,
      multiplierFormulaText: activeAnomalySegment.multiplierFormulaText,
      formulaText: activeAnomalySegment.formulaText,
      elementBonusText: activeAnomalySegment.elementBonusText,
      skillBonusText: activeAnomalySegment.skillBonusText,
      allDamageBonusText: activeAnomalySegment.allDamageBonusText,
      damageBonusRateText: activeAnomalySegment.damageBonusRateText,
      damageBonusFormulaText: `1 + ${activeAnomalySegment.elementBonusText} + ${activeAnomalySegment.skillBonusText} + ${activeAnomalySegment.allDamageBonusText} = ${activeAnomalySegment.damageBonusRateText}`,
      resistanceEffectiveText: (Number(activeAnomalySegment.resistanceBaseText) - Number(activeAnomalySegment.corrosionText)).toFixed(1),
      resistanceFormulaText: activeAnomalySegment.resistanceFormulaText,
      amplifyFormulaText: activeAnomalySegment.amplifyFormulaText,
      fragileFormulaText: activeAnomalySegment.fragileFormulaText,
      vulnerabilityFormulaText: activeAnomalySegment.vulnerabilityFormulaText,
      comboFormulaText: activeAnomalySegment.comboFormulaText,
      imbalanceFormulaText: activeAnomalySegment.imbalanceFormulaText,
      defenseZoneText: activeAnomalySegment.defenseZoneText,
      nonCritFormulaText: activeAnomalySegment.nonCritFormulaText,
      expectedText: activeAnomalySegment.expectedText,
      critText: activeAnomalySegment.critText,
      nonCritText: activeAnomalySegment.nonCritText,
    };
  }, [activeAnomalySegment, fullCombinedModifierBuffList, getEffectiveSegmentStackCounts, panelBase]);
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
  const loadRuntimeDamageData = useCallback(() => {
    loadBuffList();
    setSkillLevelModeMap(loadSkillLevelModeMap());
    loadResolvedTemplate();
    loadPanelData();
    loadPersistedAnomalyCards();
    loadPersistedManualBuffTweaks();
  }, [
    loadBuffList,
    loadSkillLevelModeMap,
    loadResolvedTemplate,
    loadPanelData,
    loadPersistedAnomalyCards,
    loadPersistedManualBuffTweaks,
  ]);
  useEffect(() => {
    const hasRevisionChanged = runtimeDamageRevisionRef.current !== resistanceRevision;
    runtimeDamageRevisionRef.current = resistanceRevision;
    if (hasRevisionChanged && (isModalOpen || isInspectMode)) {
      loadRuntimeDamageData();
      return;
    }
    loadPersistedManualBuffTweaks();
  }, [isInspectMode, isModalOpen, loadPersistedManualBuffTweaks, loadRuntimeDamageData, resistanceRevision]);
  const inspectDamageSummary = useMemo(() => {
    if (!damageViewModel) {
      return { expected: '-', nonCrit: '-' };
    }
    return {
      expected: (Number(damageViewModel.summary.totalExpectedText) + anomalyDamageSummary.expected).toFixed(0),
      nonCrit: (Number(damageViewModel.summary.totalNonCritText) + anomalyDamageSummary.nonCrit).toFixed(0),
    };
  }, [anomalyDamageSummary.expected, anomalyDamageSummary.nonCrit, damageViewModel]);
  const totalNonCritSummaryFormula = useMemo(() => {
    if (!damageViewModel) {
      return '无';
    }
    const allParts = [
      ...damageViewModel.hitCards.map((hitCard) => `${hitCard.displayName} ${hitCard.nonCritText}`),
      ...anomalyDamageSegments.map((segment) => `${segment.sequenceTitle} ${segment.nonCritText}`),
    ];
    if (allParts.length === 0) {
      return '无';
    }
    return `${allParts.join(' + ')} = ${(Number(damageViewModel.summary.totalNonCritText) + anomalyDamageSummary.nonCrit).toFixed(0)}`;
  }, [anomalyDamageSegments, anomalyDamageSummary.nonCrit, damageViewModel]);
  const totalNonCritSummaryParts = useMemo(() => {
    if (!damageViewModel) {
      return [];
    }
    return [
      ...damageViewModel.hitCards.map((hitCard) => ({
        label: hitCard.displayName,
        value: hitCard.nonCritText,
      })),
      ...anomalyDamageSegments.map((segment) => ({
        label: segment.sequenceTitle,
        value: segment.nonCritText,
      })),
    ];
  }, [anomalyDamageSegments, damageViewModel]);

  useEffect(() => {
    if (!selectedAnomalySegmentKey) {
      return;
    }
    if (anomalyDamageSegments.some((segment) => segment.key === selectedAnomalySegmentKey)) {
      return;
    }
    setSelectedAnomalySegmentKey(null);
  }, [anomalyDamageSegments, selectedAnomalySegmentKey]);

  // 弹窗打开时加载数据，并设置当前选中的技能按钮
  useEffect(() => {
    if (isModalOpen && !wasModalOpenRef.current) {
      loadRuntimeDamageData();
      setSelectedHitIndex(0);
      setSelectedSkillButton(button.id);
      resetAnomalyDraftState();
      setSelectedAnomalySegmentKey(null);
    } else if (!isModalOpen && wasModalOpenRef.current) {
      setSelectedSkillButton(null);
    }

    wasModalOpenRef.current = isModalOpen;
  }, [isModalOpen, button.id, button.characterId, characterName, loadRuntimeDamageData, resetAnomalyDraftState]);

  useEffect(() => {
    if (!isInspectMode) {
      return;
    }
    loadRuntimeDamageData();
  }, [isInspectMode, loadRuntimeDamageData]);

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
    if (isBrowseMode || isDragDisabled) {
      return;
    }

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
  }, [isBrowseMode, isDragDisabled, onMouseDown]);

  useEffect(() => {
    if (!isDragDisabled) return;
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    isLongPressRef.current = false;
  }, [isDragDisabled]);

  /**
   * 处理点击事件（区分单击和双击）
   */
  const handleClick = useCallback(() => {
    if (isBrowseMode) return;
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

      navigateToAppPath(getTimelineSkillDetailPath(button.id));
    }
  }, [button.id, isBrowseMode]);

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

  const normalizedSkillIconUrl = skillIconUrl ? normalizeAssetUrl(skillIconUrl) : '';
  const hasVisibleSkillIcon = Boolean(skillIconUrl && !iconLoadFailed && !(isBrowseMode && isDotButton));

  return (
    <>
      <div
        className={`canvas-skill-button ${isSelected ? 'selected' : ''} ${isDragging ? 'dragging' : ''} ${isLocked ? 'locked' : ''} ${isBrowseMode ? 'is-browse-mode' : ''} ${isBrowseMode && isDotButton ? 'is-browse-dot' : ''} ${isInspectMode ? 'is-inspect-mode' : ''} ${isDragDisabled ? 'is-drag-disabled' : ''}`}
        data-liquid-glass-skill="true"
        data-skill-button-id={button.id}
        data-skill-type={skillType}
        aria-disabled={isDragDisabled}
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
        onContextMenu={isBrowseMode ? (event) => event.preventDefault() : onContextMenu}
      >
        <div className="skill-button-anchor">
          {!isInspectMode && !(isBrowseMode && isDotButton) ? (
            <svg
              className="skill-button-composite-outline"
              viewBox={compositeOutlineViewBox}
              style={{
                left: -radius - outlinePadding,
                top: -radius - outlinePadding,
                width: baseWidth + radius + outlinePadding * 2,
                height: baseHeight + radius + outlinePadding * 2,
              }}
              aria-hidden="true"
            >
              <defs>
                <linearGradient
                  id={liquidGlassOutlineGradientId}
                  x1={-radius}
                  y1={-radius}
                  x2={baseWidth}
                  y2={baseHeight}
                  gradientUnits="userSpaceOnUse"
                >
                  <stop offset="0%" stopColor="#ffffff" stopOpacity="0.98" />
                  <stop offset="34%" stopColor="#f7fbff" stopOpacity="0.74" />
                  <stop offset="66%" stopColor="#d3ddf7" stopOpacity="0.42" />
                  <stop offset="100%" stopColor="#6976aa" stopOpacity="0.48" />
                </linearGradient>
              </defs>
              <path className="skill-button-composite-outline-default-path" d={compositeOutlinePath} />
              <path className="skill-button-composite-outline-liquid-depth-path" d={liquidGlassCompositeOutlinePath} />
              <path
                className="skill-button-composite-outline-liquid-path"
                d={liquidGlassCompositeOutlinePath}
                style={{ stroke: `url(#${liquidGlassOutlineGradientId})` }}
              />
            </svg>
          ) : null}
          <div className="skill-button-base">
            <span className="skill-button-name">{isBrowseMode ? browseModeDisplayName : `${skillType} ${displayName}`}</span>
            {isLocked ? <span className="skill-button-lock">锁</span> : null}
            {isInspectMode ? (
              <span className="skill-button-inspect-damage">
                <span>{`期望=${inspectDamageSummary.expected}`}</span>
                <span>{`非暴=${inspectDamageSummary.nonCrit}`}</span>
              </span>
            ) : null}
          </div>
          <div
            className={`skill-button-orb${hasVisibleSkillIcon ? ' has-skill-icon-mask' : ''}`}
            title={`${characterName} - ${displayName}`}
            style={{
              '--skill-icon-mask': hasVisibleSkillIcon ? `url(${JSON.stringify(normalizedSkillIconUrl)})` : 'none',
            } as CSSProperties}
          >
            {/* skillIconUrl 有值且未失败时渲染图标 */}
            {hasVisibleSkillIcon ? (
              <img
                className="skill-icon"
                key={normalizedSkillIconUrl}
                src={normalizedSkillIconUrl}
                alt={displayName}
                onLoad={handleIconLoad}
                onError={handleIconError}
              />
            ) : null}
            {/* 兜底文字：图标加载失败或无图标时显示 */}
            <span className={`skill-label ${hasVisibleSkillIcon ? 'hidden' : ''}`}>{isBrowseMode && isDotButton ? '~' : skillType}</span>
          </div>
        </div>
      </div>

      {/* 右键上下文菜单 - portal 到 body，避免被右侧面板 stacking context 遮挡 */}
      {shouldRenderContextMenu ? createPortal(
        <div
          className="skill-button-context-menu"
          style={{
            left: contextMenuState.position.x,
            top: contextMenuState.position.y,
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
        </div>,
        document.body
      ) : null}

      {/* 技能信息弹窗 + 技能伤害弹窗 */}
      {isModalOpen && (
        <TimelineSkillDetailWorkbench
          searchLayer={isLocalBuffSearchOpen ? (
            <div className="skill-button-inline-buff-search-mask" onClick={closeLocalBuffSearch}>
              <div
                className="skill-button-inline-buff-search is-workbench-mode"
                onClick={(event) => event.stopPropagation()}
              >
                <div className="skill-button-inline-buff-search-head">
                  <h5>{getBuffSearchModeLabel(buffSearchMode)}</h5>
                  <span>Tab 切换入口 / Esc 关闭</span>
                </div>
                <div className="skill-button-inline-buff-search-modes">
                  {BUFF_SEARCH_MODE_OPTIONS.map((option) => (
                    <button
                      key={option.key}
                      type="button"
                      className={`skill-button-inline-buff-search-mode${buffSearchMode === option.key ? ' is-active' : ''}`}
                      onClick={() => setBuffSearchMode(option.key)}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                <div className={`skill-button-buff-workbench${isSourceBuffSearchMode(buffSearchMode) ? ' has-nearby-buffs' : ''}`}>
                  <div className="skill-button-buff-workbench-main">
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
                        burnDamageMode={burnDamageMode}
                        onSetActiveAnomalyGroup={setActiveAnomalyGroup}
                        onResetActiveAnomalyKey={() => setActiveAnomalyKey(null)}
                        onSelectAnomaly={handleSelectAnomaly}
                        onApplyActiveAnomaly={handleApplyActiveAnomaly}
                        onSetActiveAnomalyLevel={setActiveAnomalyLevel}
                        onSetActiveAnomalySourceId={setActiveAnomalySourceId}
                        onSetBurnDamageMode={setBurnDamageMode}
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
                        onSelectAnomalyState={handleSelectAnomalyState}
                        onCreateSnapshot={handleCreateAnomalyStateSnapshot}
                        onSetActiveAnomalyStateLevel={setActiveAnomalyStateLevel}
                        onSetActiveAnomalyStateSourceId={setActiveAnomalyStateSourceId}
                        onSetActiveAnomalyStateDurationSeconds={setActiveAnomalyStateDurationSeconds}
                        onRemoveAnomalyStateSnapshotCard={removeAnomalyStateSnapshotCard}
                      />
                    ) : buffSearchMode === 'state' ? (
                      <SkillButtonStatePanel
                        activeAnomaly={activeAnomaly}
                        activeAnomalyLevel={activeAnomalyLevel}
                        activeAnomalyPreview={activeAnomalyPreview}
                        activeSourceCharacter={activeSourceCharacter}
                        sourceCharacters={sourceCharacters}
                        selectedStatusCards={selectedStatusCards}
                        onSelectAnomaly={handleSelectAnomaly}
                        onApplyActiveAnomaly={handleApplyActiveAnomaly}
                        onSetActiveAnomalyLevel={setActiveAnomalyLevel}
                        onSetActiveAnomalySourceId={setActiveAnomalySourceId}
                        onRemoveAnomalyCard={removeAnomalyCard}
                      />
                    ) : (
                      <div className="skill-button-local-buff-panel">
                        <div className={`skill-button-inline-buff-search-bar${['operator', 'weapon', 'equipment'].includes(buffSearchMode) ? ' has-operator-filters' : ''}`}>
                          <input
                            ref={localBuffSearchInputRef}
                            className="skill-button-inline-buff-search-input"
                            value={localBuffSearchKeyword}
                            onChange={(event) => setLocalBuffSearchKeyword(event.target.value)}
                            placeholder="搜索组 / 项 / Buff / 类型 / 条件"
                          />
                          {['operator', 'weapon', 'equipment'].includes(buffSearchMode) ? (
                            <div className="operator-buff-search-filters">
                              <div className="operator-buff-character-filters" aria-label="按干员筛选">
                                {state.selectedCharacters.slice(0, 4).map((character) => (
                                  <button
                                    key={character.id}
                                    type="button"
                                    className={`operator-buff-character-filter${operatorCharacterFilter === character.id ? ' is-active' : ''}`}
                                    onClick={() => setOperatorCharacterFilter((current) => current === character.id ? null : character.id)}
                                    title={character.name}
                                    aria-label={`筛选干员 ${character.name}`}
                                    aria-pressed={operatorCharacterFilter === character.id}
                                  >
                                    {character.avatarUrl ? (
                                      <img src={normalizeAssetUrl(character.avatarUrl)} alt="" />
                                    ) : (
                                      <span>{character.name.slice(0, 1)}</span>
                                    )}
                                  </button>
                                ))}
                              </div>
                              {buffSearchMode === 'operator' ? (
                                <div className="operator-buff-group-filters" aria-label="按 Buff 来源分类筛选">
                                  {OPERATOR_BUFF_GROUP_FILTERS.map((option) => (
                                    <button
                                      key={option.key}
                                      type="button"
                                      className={operatorBuffGroupFilter === option.key ? 'is-active' : ''}
                                      onClick={() => setOperatorBuffGroupFilter((current) => current === option.key ? null : option.key)}
                                      aria-pressed={operatorBuffGroupFilter === option.key}
                                    >
                                      {option.label}
                                    </button>
                                  ))}
                                </div>
                              ) : null}
                            </div>
                          ) : null}
                        </div>
                        <div className="skill-button-inline-buff-search-results">
                          {localBuffSearchKeyword.trim().length === 0 ? (
                            localBuffSearchResults.length > 0 ? (
                              localBuffSearchResults.map((entry) => (
                                <button
                                  key={entry.key}
                                  type="button"
                                  className="skill-button-inline-buff-search-item"
                                  onClick={() => handleApplyLocalBuffSearchResult(entry)}
                                >
                                  <div className="local-buff-search-item-head">
                                    <strong>{entry.displayName}</strong>
                                    <span>{entry.effectKind === 'extraHit' ? '额外伤害段' : entry.type || '暂无'}</span>
                                  </div>
                                  <p className="local-buff-search-item-source">
                                    {entry.groupName}{entry.itemName ? ` / ${entry.itemName}` : ''}
                                  </p>
                                  <p>{formatBuffCardSummary(entry)}</p>
                                </button>
                              ))
                            ) : (
                              <div className="skill-button-inline-buff-search-empty">
                                输入关键词或选择筛选后显示{getBuffSearchModeLabel(buffSearchMode)}结果
                              </div>
                            )
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
                                  <span>{entry.effectKind === 'extraHit' ? '额外伤害段' : entry.type || '暂无'}</span>
                                </div>
                                <p className="local-buff-search-item-source">
                                  {entry.groupName}{entry.itemName ? ` / ${entry.itemName}` : ''}
                                </p>
                                <p>{formatBuffCardSummary(entry)}</p>
                              </button>
                            ))
                          ) : (
                            <div className="skill-button-inline-buff-search-empty">
                              没有匹配到{getBuffSearchModeLabel(buffSearchMode)}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                  {isSourceBuffSearchMode(buffSearchMode) ? (
                    <aside className="skill-button-buff-resource-rail nearby-buff-resource-rail">
                      <div className="skill-anomaly-board skill-anomaly-cache-board">
                        <div className="skill-anomaly-board-section">
                          <p className="skill-anomaly-board-title">附近 Buff</p>
                          <div className="skill-anomaly-board-list skill-anomaly-cache-list">
                            {nearbyBuffList.length === 0 ? (
                              <div className="skill-button-buff-empty">附近暂无可选 Buff</div>
                            ) : (
                              nearbyBuffList.map((buff) => (
                                <button
                                  key={`nearby-buff-${buff.id}`}
                                  type="button"
                                  className="anomaly-board-card nearby-buff-card"
                                  onClick={() => handleApplyNearbyBuff(buff)}
                                  title="添加到已选 Buff"
                                >
                                  <span className="anomaly-board-card-title buff-card-title-line">
                                    <span>{buff.displayName || buff.name}</span>
                                    <span className="buff-card-source">/ {buff.sourceName || buff.source || '未知来源'}</span>
                                  </span>
                                  <span>
                                    {formatBuffCardSummary(buff)}
                                  </span>
                                </button>
                              ))
                            )}
                          </div>
                        </div>
                      </div>
                    </aside>
                  ) : null}

                  <aside className="skill-button-buff-resource-rail">
                    <div className="skill-anomaly-board skill-anomaly-cache-board">
                      <div className="skill-anomaly-board-section">
                        <p className="skill-anomaly-board-title">
                          {isSourceBuffSearchMode(buffSearchMode) ? '已选 Buff' : buffSearchMode === 'anomaly-state' ? '缓存快照' : '资源栏'}
                        </p>
                        <div className="skill-anomaly-board-list skill-anomaly-cache-list">
                          {isSourceBuffSearchMode(buffSearchMode) ? (
                            usedLocalBuffList.length === 0 ? (
                              <div className="skill-button-buff-empty">暂无已选 Buff</div>
                            ) : (
                              usedLocalBuffList.map((buff) => (
                                <div
                                  key={`used-buff-${buff.id}`}
                                  className="anomaly-board-card selected-buff-card"
                                >
                                  <button
                                    type="button"
                                    className="selected-buff-card-remove"
                                    onClick={() => removeBuff(buff.id)}
                                    title="移除 Buff"
                                    aria-label={`移除 ${buff.displayName || buff.name}`}
                                  >
                                    <svg viewBox="0 0 24 24" aria-hidden="true">
                                      <path d="m6.4 5 5.6 5.6L17.6 5 19 6.4 13.4 12l5.6 5.6-1.4 1.4-5.6-5.6L6.4 19 5 17.6l5.6-5.6L5 6.4 6.4 5Z" />
                                    </svg>
                                  </button>
                                  <span className="anomaly-board-card-title buff-card-title-line">
                                    <span>{buff.displayName || buff.name}</span>
                                    <span className="buff-card-source">/ {buff.sourceName || buff.source || '未知来源'}</span>
                                  </span>
                                  <span>
                                    {formatBuffCardSummary(buff)}
                                  </span>
                                </div>
                              ))
                            )
                          ) : buffSearchMode === 'anomaly-state' ? (
                            availableAnomalyStateSnapshots.length === 0 ? (
                              <div className="skill-button-buff-empty">暂无缓存快照</div>
                            ) : (
                            availableAnomalyStateSnapshots.map((snapshot) => {
                              const usageCount = anomalyStateSnapshotUsageCounts.get(snapshot.id) ?? 0;
                              return (
                                <div
                                  key={`available-${snapshot.id}`}
                                  className="anomaly-board-card is-state"
                                  onClick={() => attachAnomalyStateSnapshotCard(snapshot.id)}
                                  title="单击挂载到当前角色"
                                >
                                  <div className="anomaly-board-card-topline">
                                    <span className="anomaly-board-card-title">{formatAnomalyStateSnapshotName(snapshot)}</span>
                                    <button
                                      type="button"
                                      className="anomaly-board-card-delete-btn"
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        deleteAnomalyStateSnapshotCard(snapshot.id);
                                      }}
                                      disabled={usageCount > 0}
                                      title={usageCount > 0 ? '该快照仍被界面中的项目引用，无法删除' : '删除缓存快照'}
                                    >
                                      删除
                                    </button>
                                  </div>
                                  <span>{snapshot.sourceCharacterName}</span>
                                </div>
                              );
                            })
                            )
                          ) : (
                            <div className="skill-button-buff-empty">当前页不需要右侧资源</div>
                          )}
                        </div>
                      </div>
                    </div>
                  </aside>
                </div>
              </div>
            </div>
          ) : null}
          characterName={characterName}
          skillLabel={`${skillType} / ${displayName} ${currentSkillLevelMode}`}
          positionLabel={(() => {
            const staffLine = timelineData?.staffLines?.find((item) => item.staffIndex === (button as SkillButtonType).lineIndex);
            const buttonData = staffLine?.buttons?.find((item) => item.id === button.id);
            return `干员 ${String((button as SkillButtonType).lineIndex ?? '-')} · 节点 ${String(buttonData?.nodeNumber ?? buttonData?.nodeIndex ?? '-')}`;
          })()}
          isLocked={Boolean(isLocked)}
          onToggleLock={() => dispatch({ type: 'TOGGLE_SKILL_BUTTON_LOCK', buttonId: button.id })}
          onClose={handleCloseModal}
          onOpenSearch={openLocalBuffSearch}
          targetResistance={targetResistance}
          onResistanceChange={updateTargetResistance}
          buffs={buffList}
          buffStackCounts={buttonStackCounts}
          onRemoveBuff={removeBuff}
          onToggleBuffDisabled={toggleGlobalBuffDisabled}
          isBuffDisabled={(buffId) => globallyDisabledBuffIds.includes(buffId)}
          onDecrementBuff={decrementBuffStack}
          onIncrementBuff={incrementBuffStack}
          onClearBuffs={clearAllBuffs}
          onEnableAllBuffs={enableAllBuffs}
          onDisableAllBuffs={disableAllBuffs}
          onResetBuffStacks={resetAllBuffStacks}
          statuses={[
            ...selectedStatusCards.map((card) => ({
              key: card.id,
              title: card.primaryText,
              detail: [card.secondaryText, card.tertiaryText].filter(Boolean).join(' · '),
              kind: '状态',
              onRemove: () => removeAnomalyCard('state', card.id),
            })),
            ...selectedAnomalyStateSnapshots.map((snapshot) => ({
              key: `snapshot-${snapshot.id}`,
              title: formatAnomalyStateSnapshotName(snapshot),
              detail: snapshot.sourceCharacterName,
              kind: '异常状态',
              onRemove: () => removeAnomalyStateSnapshotCard(snapshot.id),
            })),
            ...selectedAnomalyDamages.map((card) => ({
              key: card.id,
              title: card.primaryText,
              detail: [card.secondaryText, card.tertiaryText].filter(Boolean).join(' · '),
              kind: '异常伤害',
              onRemove: () => removeAnomalyCard('damage', card.id),
            })),
          ]}
          hits={[
            ...(damageViewModel?.hitCards.map((hitCard, index) => ({
              ...(() => {
                const hit = resolvedTemplate?.hits[index];
                const segmentKey = hit ? getNormalHitSegmentKey(hit.key) : null;
                const fullHitResult = fullDamageResult?.hits[index];
                const effectiveStackCounts = segmentKey
                  ? getEffectiveSegmentStackCounts(segmentKey)
                  : buttonStackCounts;
                const tuningBuffs = fullHitResult
                  ? buildAppliedBuffTags(fullHitResult.appliedBuffs, effectiveStackCounts)
                  : [];
                return {
                  tuning: segmentKey ? {
                    title: `${hitCard.displayName} 详情`,
                    stats: [],
                    buffs: tuningBuffs,
                    segmentKey,
                    disabled: hitCard.isDisabled,
                    onToggleDisabled: hit ? () => {
                      setManuallyDisabledHitKeys((prev) => {
                        const next = prev.includes(hit.key)
                          ? prev.filter((hitKey) => hitKey !== hit.key)
                          : [...prev, hit.key];
                        persistManualDisabledHitKeys(next);
                        return next;
                      });
                    } : undefined,
                    onToggleBuff: (buffId: string) => toggleManualBuff(segmentKey, buffId),
                    isBuffActive: (buffId: string) => isBuffManuallyActive(segmentKey, buffId),
                    onDecrementBuff: (buffId: string) => adjustSegmentBuffStack(segmentKey, buffId, -1),
                    onIncrementBuff: (buffId: string) => adjustSegmentBuffStack(segmentKey, buffId, 1),
                    onResetBuffs: () => resetManualBuffTweaks(segmentKey),
                  } : undefined,
                };
              })(),
              key: hitCard.key,
              title: hitCard.displayName,
              meta: `${hitCard.buffCountText} · ${hitCard.multiplierText}`,
              expected: hitCard.expectedText,
              crit: hitCard.critText,
              nonCrit: hitCard.nonCritText,
              selected: hitCard.isSelected,
              disabled: hitCard.isDisabled,
              onSelect: () => {
                const isCurrentHit = selectedHitIndex === index && selectedAnomalySegmentKey === null;
                setSelectedHitIndex(isCurrentHit ? null : index);
                setSelectedAnomalySegmentKey(null);
              },
            })) ?? []),
            ...anomalyDamageSegments.map((segment) => ({
              key: segment.key,
              title: segment.sequenceTitle,
              meta: `${segment.buffText} · ${segment.multiplierText}`,
              expected: segment.expectedText,
              crit: segment.critText,
              nonCrit: segment.nonCritText,
              selected: activeAnomalySegment?.key === segment.key,
              disabled: segment.isDisabled,
              tuning: {
                title: segment.title,
                stats: [],
                buffs: buildAppliedBuffTags(
                  fullCombinedModifierBuffList,
                  getEffectiveSegmentStackCounts(segment.key)
                ),
                segmentKey: segment.key,
                disabled: segment.isDisabled,
                onToggleDisabled: () => toggleManualHitDisabled(segment.key),
                onToggleBuff: (buffId: string) => toggleManualBuff(segment.key, buffId),
                isBuffActive: (buffId: string) => isBuffManuallyActive(segment.key, buffId),
                onDecrementBuff: (buffId: string) => adjustSegmentBuffStack(segment.key, buffId, -1),
                onIncrementBuff: (buffId: string) => adjustSegmentBuffStack(segment.key, buffId, 1),
                onResetBuffs: () => resetManualBuffTweaks(segment.key),
              },
              onSelect: () => {
                const isCurrentSegment = selectedHitIndex === null && selectedAnomalySegmentKey === segment.key;
                setSelectedHitIndex(null);
                setSelectedAnomalySegmentKey(isCurrentSegment ? null : segment.key);
              },
            })),
          ]}
          summary={damageViewModel ? {
            title: damageViewModel.header.fullText,
            expected: (Number(damageViewModel.summary.totalExpectedText) + anomalyDamageSummary.expected).toFixed(0),
            crit: (Number(damageViewModel.summary.totalCritText) + anomalyDamageSummary.crit).toFixed(0),
            nonCrit: (Number(damageViewModel.summary.totalNonCritText) + anomalyDamageSummary.nonCrit).toFixed(0),
            formula: totalNonCritSummaryFormula,
            parts: totalNonCritSummaryParts,
          } : null}
          formula={isShowingAnomalyDetail ? activeAnomalyFormula : damageViewModel?.activeHitFormula ?? null}
          infoLines={infoSnapshotLines}
        />
      )}
    </>
  );
}
