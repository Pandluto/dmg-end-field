import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import type { CSSProperties } from 'react';
import { SkillButton as SkillButtonType, SKILL_LABELS, TimelineData } from '../../types';
import { getElementBackgroundColor } from '../../utils/assetResolver';
import {
  removeSkillButtonBuff,
  setSelectedSkillButton,
  getButtonBuffs,
  recomputeSkillButtonPanel,
  addSkillButtonBuff,
} from '../../hooks/useSkillButtonBuffs';
import { PersistedAnomalyCard, SkillButtonBuff, SkillLevelMode } from '../../types/storage';
import { getCharacterConfig } from '../../utils/storage';
import { getCandidateBuffList, getSkillButtonById, upsertSkillButton } from '../../core/repositories';
import {
  buildSkillDamageModalViewModel,
} from '../../core/calculators/skillDamageModalViewModel';
import { calculateSkillButtonDamageV2 } from '../../core/calculators/skillButtonDamageCalculatorV2';
import {
  calculateAmplifyRate,
  calculateBuffTotals,
  calculateElementDmgBonus,
  calculateFragileRate,
  calculateSkillDmgBonus,
  calculateVulnerabilityRate,
} from '../../core/calculators/buffCalculator';
import type { ResolvedSkillDamageTemplate } from '../../core/calculators/skillDamage.types';
import { resolveSkillDamageTemplate } from '../../core/services/skillDamageTemplateResolver';
import { useAppContext } from '../../context/AppContext';
import { emitSkillButtonBuffRemoved, onSkillButtonBuffAdded } from '../../core/events/buffEvents';
import './SkillButton.css';

type AnomalyCardKind = 'state' | 'damage';
type AnomalyCategory = 'magic' | 'physical';

interface AnomalyOption {
  key: string;
  label: string;
  kind: AnomalyCardKind;
  category: AnomalyCategory;
  supportsSource: boolean;
  usesAnomalyLevel?: boolean;
  supportsDotToggle?: boolean;
  supportsDuration?: boolean;
  levelOptions: number[];
}

interface SelectedAnomalyCard {
  id: string;
  key: string;
  label: string;
  kind: AnomalyCardKind;
  category: AnomalyCategory;
  level: number;
  sourceName?: string;
  primaryText: string;
  secondaryText: string;
  tertiaryText?: string;
  selectedBuffIds: string[];
}

function normalizePersistedAnomalyCard(card: PersistedAnomalyCard): SelectedAnomalyCard {
  return {
    ...card,
    selectedBuffIds: Array.isArray(card.selectedBuffIds) ? card.selectedBuffIds : [],
  };
}

interface AnomalyDamageSegmentView {
  key: string;
  title: string;
  sequenceTitle: string;
  compactTitle: string;
  buffText: string;
  appliedBuffNames: string[];
  elementText: string;
  elementKey: string;
  skillTypeText: string;
  panelAtkText: string;
  critRateText: string;
  critDmgText: string;
  sourceSkillBoostText: string;
  levelCoefficientText: string;
  sourceSkillZoneText: string;
  baseMultiplierText: string;
  multiplierText: string;
  multiplierFormulaText: string;
  expectedText: string;
  critText: string;
  nonCritText: string;
  expectedValue: number;
  critValue: number;
  nonCritValue: number;
  formulaText: string;
  damageBonusRateText: string;
  amplifyRateText: string;
  fragileRateText: string;
  vulnerabilityRateText: string;
  comboDamageBonusText: string;
}

interface LocalBuffSearchResult {
  key: string;
  sourceKind: 'local' | 'candidate';
  groupId: string;
  groupName: string;
  itemId: string;
  itemName: string;
  effectId: string;
  displayName: string;
  name: string;
  type?: string;
  value?: number;
  description?: string;
  condition?: string;
  sourceName: string;
  source?: string;
  level?: string;
}

interface DropdownOption<T extends string | number> {
  value: T;
  label: string;
}

const ANOMALY_GROUPS: Array<{ key: AnomalyCategory; label: string; items: AnomalyOption[] }> = [
  {
    key: 'magic',
    label: '法术异常',
    items: [
      { key: 'conductive', label: '导电', kind: 'state', category: 'magic', supportsSource: true, levelOptions: [1, 2, 3, 4] },
      { key: 'corrosion', label: '腐蚀', kind: 'state', category: 'magic', supportsSource: true, supportsDuration: true, levelOptions: [1, 2, 3, 4] },
      { key: 'burn', label: '燃烧', kind: 'damage', category: 'magic', supportsSource: false, supportsDotToggle: true, supportsDuration: true, levelOptions: [1, 2, 3, 4] },
      { key: 'freeze', label: '冻结', kind: 'damage', category: 'magic', supportsSource: false, supportsDuration: true, levelOptions: [1, 2, 3, 4] },
      { key: 'shatter-ice', label: '碎冰', kind: 'damage', category: 'magic', supportsSource: false, levelOptions: [1, 2, 3, 4] },
      { key: 'magic-burst', label: '法术爆发', kind: 'damage', category: 'magic', supportsSource: false, usesAnomalyLevel: false, levelOptions: [1] },
    ],
  },
  {
    key: 'physical',
    label: '物理异常',
    items: [
      { key: 'knockdown', label: '倒地', kind: 'damage', category: 'physical', supportsSource: false, usesAnomalyLevel: false, levelOptions: [1] },
      { key: 'launch', label: '击飞', kind: 'damage', category: 'physical', supportsSource: false, usesAnomalyLevel: false, levelOptions: [1] },
      { key: 'armor-break', label: '碎甲', kind: 'state', category: 'physical', supportsSource: true, supportsDuration: true, levelOptions: [1, 2, 3, 4] },
      { key: 'smash', label: '猛击', kind: 'damage', category: 'physical', supportsSource: false, levelOptions: [1, 2, 3, 4] },
    ],
  },
];

function getAnomalyDurationOptions(option: AnomalyOption): number[] {
  switch (option.key) {
    case 'conductive':
    case 'armor-break':
      return [12, 18, 24, 30];
    case 'freeze':
      return [6, 7, 8, 9];
    case 'corrosion':
      return [15];
    case 'burn':
      return [10];
    default:
      return [];
  }
}

function createAnomalyCardId(baseKey: string): string {
  return `${baseKey}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

const LOCAL_BUFF_LIBRARY_KEY = 'ddd.buff-editor.library.v1';

function readLocalBuffSearchEntries(): LocalBuffSearchResult[] {
  if (typeof window === 'undefined') {
    return [];
  }
  try {
    const raw = window.localStorage.getItem(LOCAL_BUFF_LIBRARY_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as Record<string, {
      id?: string;
      name?: string;
      sourceName?: string;
      items?: Record<string, {
        id?: string;
        name?: string;
        sourceName?: string;
        effects?: Record<string, {
          id?: string;
          displayName?: string;
          name?: string;
          type?: string;
          value?: number;
          description?: string;
          condition?: string;
          sourceName?: string;
          source?: string;
          level?: string;
        }>;
      }>;
    }>;

    return Object.entries(parsed).flatMap(([groupId, group]) =>
      Object.entries(group.items || {}).flatMap(([itemId, item]) =>
        Object.entries(item.effects || {}).map(([effectId, effect]) => ({
          key: `${groupId}/${itemId}/${effectId}`,
          sourceKind: 'local',
          groupId,
          groupName: group.name || groupId,
          itemId,
          itemName: item.name || itemId,
          effectId,
          displayName: effect.displayName || effectId,
          name: effect.name || effectId,
          type: effect.type,
          value: effect.value,
          description: effect.description,
          condition: effect.condition,
          sourceName: effect.sourceName || item.sourceName || group.sourceName || group.name || groupId,
          source: effect.source || 'local_custom',
          level: effect.level || '',
        }))
      )
    );
  } catch {
    return [];
  }
}

function readCandidateBuffSearchEntries(): LocalBuffSearchResult[] {
  return getCandidateBuffList().map((buff, index) => ({
    key: `candidate-${index}-${buff.name}-${buff.displayName}`,
    sourceKind: 'candidate',
    groupId: '',
    groupName: '陈列区 Buff',
    itemId: '',
    itemName: buff.sourceName || buff.source || '候选 Buff',
    effectId: '',
    displayName: buff.displayName,
    name: buff.name,
    type: buff.type,
    value: buff.value,
    description: buff.description,
    condition: buff.condition,
    sourceName: buff.sourceName,
    source: buff.source,
    level: buff.level || '',
  }));
}

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
  onChangeSkillType?: (buttonId: string, nextSkillType: 'A' | 'B' | 'E' | 'Q') => void;
}

export function SkillButtonComponent({ button, size, onMouseDown, onContextMenu, timelineData, onModalOpen, onModalClose, contextMenuState, onConfirmRemove, onCloseContextMenu, onCopy, onChangeSkillType }: SkillButtonProps) {
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
  const [activeAnomalyGroup, setActiveAnomalyGroup] = useState<AnomalyCategory>('magic');
  const [activeAnomalyKey, setActiveAnomalyKey] = useState<string | null>(null);
  const [activeAnomalyLevel, setActiveAnomalyLevel] = useState(1);
  const [activeAnomalySourceId, setActiveAnomalySourceId] = useState<string | null>(null);
  const [includeDotInTotal, setIncludeDotInTotal] = useState(true);
  const [activeDurationSeconds, setActiveDurationSeconds] = useState(0);
  const [selectedAnomalyStates, setSelectedAnomalyStates] = useState<SelectedAnomalyCard[]>([]);
  const [selectedAnomalyDamages, setSelectedAnomalyDamages] = useState<SelectedAnomalyCard[]>([]);
  const [openDropdownKey, setOpenDropdownKey] = useState<string | null>(null);
  const [selectedAnomalySegmentKey, setSelectedAnomalySegmentKey] = useState<string | null>(null);
  const [isAnomalyFormulaExpanded, setIsAnomalyFormulaExpanded] = useState(false);
  const [isLocalBuffSearchOpen, setIsLocalBuffSearchOpen] = useState(false);
  const [localBuffSearchKeyword, setLocalBuffSearchKeyword] = useState('');
  const [buffSearchMode, setBuffSearchMode] = useState<'local' | 'candidate' | 'anomaly'>('local');

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

  const localBuffSearchEntries = useMemo(() => readLocalBuffSearchEntries(), [isModalOpen]);
  const candidateBuffSearchEntries = useMemo(() => readCandidateBuffSearchEntries(), [isModalOpen]);
  const activeBuffSearchEntries = buffSearchMode === 'candidate'
    ? candidateBuffSearchEntries
    : localBuffSearchEntries;
  const localBuffSearchResults = useMemo(() => {
    if (buffSearchMode === 'anomaly') {
      return [];
    }
    const keyword = localBuffSearchKeyword.trim().toLowerCase();
    if (!keyword) {
      return [];
    }
    return activeBuffSearchEntries.filter((entry) => {
      const haystack = [
        entry.displayName,
        entry.name,
        entry.groupName,
        entry.itemName,
        entry.type || '',
        entry.description || '',
        entry.condition || '',
        entry.sourceName,
      ].join('|').toLowerCase();
      return haystack.includes(keyword);
    }).slice(0, 50);
  }, [activeBuffSearchEntries, buffSearchMode, localBuffSearchKeyword]);

  const loadPersistedAnomalyCards = useCallback(() => {
    const persistedButton = getSkillButtonById(button.id);
    const selectedStates = persistedButton?.anomalyConfig?.selectedStates ?? [];
    const selectedDamages = persistedButton?.anomalyConfig?.selectedDamages ?? [];
    setSelectedAnomalyStates(selectedStates.map(normalizePersistedAnomalyCard));
    setSelectedAnomalyDamages(selectedDamages.map(normalizePersistedAnomalyCard));
  }, [button.id]);

  const closeLocalBuffSearch = useCallback(() => {
    setIsLocalBuffSearchOpen(false);
    setLocalBuffSearchKeyword('');
  }, []);

  const openLocalBuffSearch = useCallback(() => {
    setIsLocalBuffSearchOpen(true);
    setBuffSearchMode('local');
  }, []);

  useEffect(() => {
    if (!isLocalBuffSearchOpen) {
      return;
    }
    const timer = window.setTimeout(() => {
      localBuffSearchInputRef.current?.focus();
      localBuffSearchInputRef.current?.select();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [isLocalBuffSearchOpen]);

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
            if (prev === 'local') return 'candidate';
            if (prev === 'candidate') return 'anomaly';
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

      if (event.key === 'Tab' && !event.shiftKey && !isEditable) {
        event.preventDefault();
        openLocalBuffSearch();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [closeLocalBuffSearch, isLocalBuffSearchOpen, isModalOpen, openLocalBuffSearch]);

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
      refCount: 1,
    });

    if (result.success) {
      recomputeSkillButtonPanel(button.id);
      loadBuffList();
      closeLocalBuffSearch();
    }
  }, [button.id, closeLocalBuffSearch, loadBuffList]);

  const persistAnomalyCards = useCallback((nextStates: SelectedAnomalyCard[], nextDamages: SelectedAnomalyCard[]) => {
    const persistedButton = getSkillButtonById(button.id);
    if (!persistedButton) {
      return;
    }

    upsertSkillButton({
      ...persistedButton,
      anomalyConfig: {
        selectedStates: nextStates,
        selectedDamages: nextDamages,
      },
      updatedAt: Date.now(),
    });
  }, [button.id]);

  const applyAnomalyCards = useCallback((
    nextStates: SelectedAnomalyCard[],
    nextDamages: SelectedAnomalyCard[],
    shouldPersist = true
  ) => {
    setSelectedAnomalyStates(nextStates);
    setSelectedAnomalyDamages(nextDamages);
    if (shouldPersist) {
      persistAnomalyCards(nextStates, nextDamages);
    }
  }, [persistAnomalyCards]);

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

  const damageResult = useMemo(() => {
    if (!resolvedTemplate || resolvedTemplate.hits.length === 0 || !panelData) {
      return null;
    }

    return calculateSkillButtonDamageV2({
      buttonId: button.id,
      characterId: button.characterId,
      runtimeSkillId: resolvedTemplate.runtimeSkillId,
      template: resolvedTemplate,
      buffs: buffList,
      panel: {
        atk: panelData.atk,
        critRate: panelData.critRate,
        critDmg: panelData.critDmg,
      },
      damageBonus: infoSnap as unknown as import('../../types/storage').DamageBonusSnapshot,
    });
  }, [resolvedTemplate, panelData, button.id, button.characterId, buffList, infoSnap]);

  const damageViewModel = useMemo(() => {
    if (!resolvedTemplate || !damageResult || !panelData) {
      return null;
    }

    return buildSkillDamageModalViewModel(
      resolvedTemplate,
      damageResult,
      selectedHitIndex,
      {
        atk: panelData.atk,
        critRate: panelData.critRate,
        critDmg: panelData.critDmg,
      }
    );
  }, [resolvedTemplate, damageResult, selectedHitIndex, panelData]);

  const sourceCharacters = useMemo(() => {
    const selected = state.selectedCharacters.map((character) => ({
      id: character.id,
      name: character.name,
    }));

    if (selected.some((character) => character.id === button.characterId)) {
      return selected;
    }

    return [{ id: button.characterId, name: characterName }, ...selected];
  }, [state.selectedCharacters, button.characterId, characterName]);

  const activeAnomaly = useMemo(
    () => ANOMALY_GROUPS.flatMap((group) => group.items).find((item) => item.key === activeAnomalyKey) ?? null,
    [activeAnomalyKey]
  );

  const activeSourceCharacter = useMemo(
    () => sourceCharacters.find((character) => character.id === activeAnomalySourceId) ?? null,
    [sourceCharacters, activeAnomalySourceId]
  );

  const getCharacterSourceSkillBoost = useCallback((characterId: string | null): number => {
    if (!characterId) return 0;
    const config = getCharacterConfig(characterId);
    return config?.equipment?.sourceSkillBoost ?? 0;
  }, []);

  const activeSourceSkillBoost = useMemo(
    () => getCharacterSourceSkillBoost(activeAnomalySourceId),
    [activeAnomalySourceId, getCharacterSourceSkillBoost]
  );

  const activeAnomalyPreview = useMemo(() => {
    if (!activeAnomaly) return null;

    const currentOperatorLevel = 90;
    const currentCharacterSourceSkillBoost = getCharacterSourceSkillBoost(button.characterId);
    const effectEnhancement = activeSourceSkillBoost > 0
      ? (2 * activeSourceSkillBoost) / (activeSourceSkillBoost + 300)
      : 0;
    const levelCoefficient = activeAnomaly.category === 'magic'
      ? 1 + (currentOperatorLevel - 1) / 196
      : 1 + (currentOperatorLevel - 1) / 392;

    if (activeAnomaly.key === 'conductive') {
      const baseRate = [0.12, 0.16, 0.2, 0.24][activeAnomalyLevel - 1] ?? 0.12;
      const amplifiedRate = baseRate * (1 + effectEnhancement);
      return {
        lines: [
          `来源角色: ${activeSourceCharacter?.name ?? '未选择'}`,
          `源石技艺强度: ${activeSourceSkillBoost.toFixed(1)}`,
          `等级系数区: × ${levelCoefficient.toFixed(3)}`,
          `源石技艺强度区: × ${(1 + activeSourceSkillBoost / 100).toFixed(3)}`,
          `附带效果: ${(amplifiedRate * 100).toFixed(1)}% 法术易伤`,
        ],
      };
    }

    if (activeAnomaly.key === 'armor-break') {
      const baseRate = [0.12, 0.16, 0.2, 0.24][activeAnomalyLevel - 1] ?? 0.12;
      return {
        lines: [
          `来源角色: ${activeSourceCharacter?.name ?? '未选择'}`,
          `源石技艺强度: ${activeSourceSkillBoost.toFixed(1)}`,
          `等级系数区: × ${levelCoefficient.toFixed(3)}`,
          `源石技艺强度区: × ${(1 + activeSourceSkillBoost / 100).toFixed(3)}`,
          `附带效果: ${(baseRate * (1 + effectEnhancement) * 100).toFixed(1)}% 物伤易伤`,
        ],
      };
    }

    if (activeAnomaly.key === 'corrosion') {
      const baseStart = [3.6, 4.8, 6, 7.2][activeAnomalyLevel - 1] ?? 3.6;
      const baseTick = [0.84, 1.12, 1.4, 1.68][activeAnomalyLevel - 1] ?? 0.84;
      const baseCap = [12, 16, 20, 24][activeAnomalyLevel - 1] ?? 12;
      return {
        lines: [
          `来源角色: ${activeSourceCharacter?.name ?? '未选择'}`,
          `源石技艺强度: ${activeSourceSkillBoost.toFixed(1)}`,
          `等级系数区: × ${levelCoefficient.toFixed(3)}`,
          `源石技艺强度区: × ${(1 + activeSourceSkillBoost / 100).toFixed(3)}`,
          `附带效果: 初始 ${(baseStart * (1 + effectEnhancement)).toFixed(2)} / 每秒 ${(baseTick * (1 + effectEnhancement)).toFixed(2)} / 上限 ${(baseCap * (1 + effectEnhancement)).toFixed(2)}`,
        ],
      };
    }

    const baseMultiplierPercent = activeAnomaly.key === 'magic-burst'
      ? 160
      : activeAnomaly.key === 'smash'
        ? 150 * (1 + activeAnomalyLevel)
        : activeAnomaly.key === 'shatter-ice'
          ? 120 * (1 + activeAnomalyLevel)
          : activeAnomaly.key === 'burn'
            ? 80 * (1 + activeAnomalyLevel)
            : activeAnomaly.key === 'freeze'
              ? 80 * (1 + activeAnomalyLevel)
              : activeAnomaly.key === 'knockdown' || activeAnomaly.key === 'launch'
                ? 120
                : 0;
    const sourceSkillZone = 1 + currentCharacterSourceSkillBoost / 100;
    const finalMultiplierPercent = baseMultiplierPercent * levelCoefficient * sourceSkillZone;

    const imbalanceGain = activeAnomaly.key === 'knockdown' || activeAnomaly.key === 'launch'
      ? 10 + currentCharacterSourceSkillBoost * 0.5
      : null;
    return {
      lines: [
        `源石技艺强度: ${currentCharacterSourceSkillBoost.toFixed(1)}`,
        `基础倍率: ${baseMultiplierPercent.toFixed(1)}%`,
        `等级系数区: × ${levelCoefficient.toFixed(3)}`,
        `源石技艺强度区: × ${sourceSkillZone.toFixed(3)}`,
        `最终倍率: ${baseMultiplierPercent.toFixed(1)}% × ${levelCoefficient.toFixed(3)} × ${sourceSkillZone.toFixed(3)} = ${finalMultiplierPercent.toFixed(1)}%`,
        imbalanceGain !== null ? `失衡值增强后: ${imbalanceGain.toFixed(1)}` : null,
        activeAnomaly.key === 'burn'
          ? `持续段倍率: ${(12 * (1 + activeAnomalyLevel)).toFixed(0)}%${includeDotInTotal ? '，总伤计入持续段' : '，总伤仅看初始段'}`
          : null,
      ].filter((line): line is string => Boolean(line)),
    };
  }, [activeAnomaly, activeAnomalyLevel, activeAnomalySourceId, activeSourceCharacter?.name, activeSourceSkillBoost, button.characterId, getCharacterSourceSkillBoost, includeDotInTotal]);

  const buildMockAnomalyCard = useCallback((
    option: AnomalyOption,
    level: number,
    sourceName?: string,
    includeDot?: boolean,
    durationSeconds?: number
  ): SelectedAnomalyCard => {
    if (option.kind === 'state') {
      const stateValue = option.key === 'conductive'
        ? `${8 + level * 4}% 法术易伤`
        : option.key === 'corrosion'
          ? `降抗 ${3 + level * 2}/${12 + level * 4} 上限`
          : `${8 + level * 4}% 物伤易伤`;
      const titleText = option.usesAnomalyLevel === false
        ? `${option.label}${sourceName ? ` · 来源 ${sourceName}` : ''}`
        : `${option.label} Lv${level}${sourceName ? ` · 来源 ${sourceName}` : ''}`;

      return {
        id: createAnomalyCardId(option.key),
        key: option.key,
        label: option.label,
        kind: option.kind,
        category: option.category,
        level,
        sourceName,
        primaryText: titleText,
        secondaryText: stateValue,
        tertiaryText: durationSeconds ? `持续 ${durationSeconds}s` : '等待真实计算接入',
      selectedBuffIds: [],
      };
    }

    const baseHit = option.key === 'smash'
      ? `${150 * (1 + level)}% 独立 hit`
      : option.key === 'shatter-ice'
        ? `${120 * (1 + level)}% 物理 hit`
        : option.key === 'magic-burst'
          ? '160% 法术爆发 hit'
          : option.key === 'burn'
            ? `${80 * (1 + level)}% 初始 hit`
            : `${120 * (option.key === 'freeze' ? 1 + level / 2 : 1)}% 独立 hit`;

    return {
      id: createAnomalyCardId(option.key),
      key: option.key,
      label: option.label,
      kind: option.kind,
      category: option.category,
      level,
      primaryText: option.usesAnomalyLevel === false ? option.label : `${option.label} Lv${level}`,
      secondaryText: baseHit,
      tertiaryText: option.key === 'burn'
        ? `${includeDot ? '计入持续段' : '不计持续段'}${durationSeconds ? ` · ${durationSeconds}s` : ''}`
        : durationSeconds
          ? `持续 ${durationSeconds}s`
          : '等待真实计算接入',
      selectedBuffIds: [],
    };
  }, []);

  const anomalyDamageSegments = useMemo<AnomalyDamageSegmentView[]>(() => {
    if (!panelData || !damageViewModel || selectedAnomalyDamages.length === 0) {
      return [];
    }

    const currentOperatorLevel = 90;
    const currentCharacterSourceSkillBoost = getCharacterSourceSkillBoost(button.characterId);
    const sourceSkillZone = 1 + currentCharacterSourceSkillBoost / 100;
    const parsedDamageBonus = infoSnap as unknown as import('../../types/storage').DamageBonusSnapshot;
    const parsedDamageBonusRecord = parsedDamageBonus as unknown as Record<string, number>;

    const resolveBaseMultiplierPercent = (card: SelectedAnomalyCard): number => {
      switch (card.key) {
        case 'magic-burst':
          return 160;
        case 'smash':
          return 150 * (1 + card.level);
        case 'shatter-ice':
          return 120 * (1 + card.level);
        case 'burn':
          return 80 * (1 + card.level);
        case 'freeze':
          return 80 * (1 + card.level);
        case 'knockdown':
        case 'launch':
          return 120;
        default:
          return 0;
      }
    };

    const resolveLevelCoefficient = (card: SelectedAnomalyCard): number => {
      if (card.key === 'shatter-ice' || card.category === 'magic') {
        return 1 + (currentOperatorLevel - 1) / 196;
      }
      return 1 + (currentOperatorLevel - 1) / 392;
    };

    const resolveElementText = (card: SelectedAnomalyCard): string => {
      switch (card.key) {
        case 'smash':
        case 'knockdown':
        case 'launch':
        case 'shatter-ice':
          return '物理';
        case 'conductive':
          return '电磁';
        case 'corrosion':
          return '自然';
        case 'burn':
          return '灼热';
        case 'freeze':
          return '寒冷';
        case 'magic-burst':
          return element === 'electric'
            ? '电磁'
            : element === 'fire'
              ? '灼热'
              : element === 'ice'
                ? '寒冷'
                : element === 'nature'
                  ? '自然'
                  : '法术';
        default:
          return '异常';
      }
    };

    const resolveElementKey = (card: SelectedAnomalyCard): string => {
      switch (card.key) {
        case 'smash':
        case 'knockdown':
        case 'launch':
        case 'shatter-ice':
        case 'armor-break':
          return 'physical';
        case 'conductive':
          return 'electric';
        case 'corrosion':
          return 'nature';
        case 'burn':
          return 'fire';
        case 'freeze':
          return 'ice';
        case 'magic-burst':
          return element ?? 'magic';
        default:
          return element ?? 'magic';
      }
    };

    const calculateBreakdown = (
      panelAtk: number,
      multiplierValue: number,
      critFactor: number,
      damageBonusRate: number,
      defenseZone: number,
      amplifyRate: number,
      fragileRate: number,
      vulnerabilityRate: number,
      comboDamageBonus: number
    ): number => {
      const base = panelAtk * multiplierValue;
      const afterCrit = base * critFactor;
      const afterBonus = afterCrit * damageBonusRate;
      const afterDefense = afterBonus * defenseZone;
      const afterAmplify = afterDefense * (1 + amplifyRate);
      const afterFragile = afterAmplify * (1 + fragileRate);
      const afterVulnerability = afterFragile * (1 + vulnerabilityRate);
      return afterVulnerability * (1 + comboDamageBonus);
    };

    return selectedAnomalyDamages.map((card, index) => {
      const baseMultiplierPercent = resolveBaseMultiplierPercent(card);
      const levelCoefficient = resolveLevelCoefficient(card);
      const elementKey = resolveElementKey(card);
      const appliedBuffs = buffList.filter((buff) => card.selectedBuffIds.includes(buff.id));
      const appliedBuffNames = appliedBuffs.map((buff) => buff.displayName);
      const buffTotals = calculateBuffTotals(appliedBuffs);
      const anomalyAtk = panelData.atk * (1 + buffTotals.atkPercentBoost) + buffTotals.flatAtk;
      const anomalyCritRate = panelData.critRate + buffTotals.critRateBoost;
      const anomalyCritDmg = panelData.critDmg + buffTotals.critDmgBonusBoost;
      const anomalyCritMultiplier = 1 + anomalyCritDmg;
      const anomalyExpectedMultiplier = 1 + anomalyCritRate * anomalyCritDmg;
      const anomalyBaseMultiplier = (baseMultiplierPercent / 100) * levelCoefficient * sourceSkillZone;
      const multiplierAfterBonus = anomalyBaseMultiplier + buffTotals.multiplierBonus;
      const finalMultiplier = multiplierAfterBonus * buffTotals.multiplierMultiplier;
      const allDamageBonus = elementKey === 'physical' ? (parsedDamageBonus.allDmgBonus || 0) : 0;
      const damageBonusRate = 1
        + calculateElementDmgBonus(elementKey, parsedDamageBonusRecord, buffTotals)
        + calculateSkillDmgBonus(button.skillType, parsedDamageBonusRecord, buffTotals)
        + allDamageBonus;
      const amplifyRate = calculateAmplifyRate(elementKey, buffTotals);
      const fragileRate = calculateVulnerabilityRate(elementKey, buffTotals);
      const vulnerabilityRate = calculateFragileRate(elementKey, buffTotals);
      const comboDamageBonus = buffTotals.comboDamageBonus;
      const defenseZone = 0.5;
      const nonCrit = calculateBreakdown(
        anomalyAtk,
        finalMultiplier,
        1,
        damageBonusRate,
        defenseZone,
        amplifyRate,
        fragileRate,
        vulnerabilityRate,
        comboDamageBonus
      );
      const crit = calculateBreakdown(
        anomalyAtk,
        finalMultiplier,
        anomalyCritMultiplier,
        damageBonusRate,
        defenseZone,
        amplifyRate,
        fragileRate,
        vulnerabilityRate,
        comboDamageBonus
      );
      const expected = calculateBreakdown(
        anomalyAtk,
        finalMultiplier,
        anomalyExpectedMultiplier,
        damageBonusRate,
        defenseZone,
        amplifyRate,
        fragileRate,
        vulnerabilityRate,
        comboDamageBonus
      );
      const sequenceNumber = damageViewModel.hitCards.length + index + 1;

      return {
        key: card.id,
        title: `${sequenceNumber}段 · ${card.label}`,
        sequenceTitle: `${sequenceNumber}段`,
        compactTitle: `${card.label}`,
        buffText: appliedBuffNames.length > 0 ? `+${appliedBuffNames.length} Buff` : '无 Buff',
        appliedBuffNames,
        elementText: resolveElementText(card),
        elementKey,
        skillTypeText: button.skillType,
        panelAtkText: anomalyAtk.toFixed(0),
        critRateText: `${(anomalyCritRate * 100).toFixed(1)}%`,
        critDmgText: `${(anomalyCritDmg * 100).toFixed(1)}%`,
        sourceSkillBoostText: currentCharacterSourceSkillBoost.toFixed(1),
        levelCoefficientText: levelCoefficient.toFixed(3),
        sourceSkillZoneText: sourceSkillZone.toFixed(3),
        baseMultiplierText: `${baseMultiplierPercent.toFixed(1)}%`,
        multiplierText: `${(finalMultiplier * 100).toFixed(1)}%`,
        multiplierFormulaText: `(${(anomalyBaseMultiplier * 100).toFixed(1)}% + ${(buffTotals.multiplierBonus * 100).toFixed(1)}%) × ${buffTotals.multiplierMultiplier.toFixed(3)}`,
        expectedText: expected.toFixed(0),
        critText: crit.toFixed(0),
        nonCritText: nonCrit.toFixed(0),
        expectedValue: expected,
        critValue: crit,
        nonCritValue: nonCrit,
        formulaText: `(${baseMultiplierPercent.toFixed(1)}% × ${levelCoefficient.toFixed(3)} × ${sourceSkillZone.toFixed(3)} + ${(buffTotals.multiplierBonus * 100).toFixed(1)}%) × ${buffTotals.multiplierMultiplier.toFixed(3)} = ${(finalMultiplier * 100).toFixed(1)}%`,
        damageBonusRateText: damageBonusRate.toFixed(3),
        amplifyRateText: amplifyRate.toFixed(3),
        fragileRateText: fragileRate.toFixed(3),
        vulnerabilityRateText: vulnerabilityRate.toFixed(3),
        comboDamageBonusText: comboDamageBonus.toFixed(3),
      };
    });
  }, [panelData, damageViewModel, selectedAnomalyDamages, getCharacterSourceSkillBoost, button.characterId, button.skillType, element, infoSnap, buffList]);

  const activeAnomalySegment = useMemo(
    () => (selectedAnomalySegmentKey ? anomalyDamageSegments.find((segment) => segment.key === selectedAnomalySegmentKey) ?? null : null),
    [anomalyDamageSegments, selectedAnomalySegmentKey]
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
      setActiveAnomalyGroup('magic');
      setActiveAnomalyKey(null);
      setActiveAnomalyLevel(1);
      setActiveAnomalySourceId(null);
      setIncludeDotInTotal(true);
      setActiveDurationSeconds(0);
      loadPersistedAnomalyCards();
      setOpenDropdownKey(null);
      setSelectedAnomalySegmentKey(null);
      setIsAnomalyFormulaExpanded(false);
    } else if (!isModalOpen && wasModalOpenRef.current) {
      setSelectedSkillButton(null);
    }

    wasModalOpenRef.current = isModalOpen;
  }, [isModalOpen, button.id, button.characterId, characterName, loadBuffList, loadSkillLevelModeMap, loadResolvedTemplate, loadPanelData, buildMockAnomalyCard, loadPersistedAnomalyCards]);

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
   * 关闭弹窗
   */
  const handleCloseModal = useCallback(() => {
    setIsModalOpen(false);
    onModalClose?.();
  }, [onModalClose]);

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

  const handleSelectAnomaly = useCallback((option: AnomalyOption) => {
    setActiveAnomalyKey((prev) => (prev === option.key ? null : option.key));
    setActiveAnomalyLevel(option.levelOptions[0] ?? 1);
    const durationOptions = getAnomalyDurationOptions(option);
    setActiveDurationSeconds(durationOptions[0] ?? 0);
    setIncludeDotInTotal(option.key === 'burn');
    setActiveAnomalySourceId(option.supportsSource ? (sourceCharacters[0]?.id ?? button.characterId) : null);
  }, [button.characterId, sourceCharacters]);

  const handleApplyActiveAnomaly = useCallback(() => {
    if (!activeAnomaly) return;
    const sourceName = sourceCharacters.find((character) => character.id === activeAnomalySourceId)?.name;
    const nextCard = buildMockAnomalyCard(
      activeAnomaly,
      activeAnomalyLevel,
      sourceName,
      includeDotInTotal,
      activeDurationSeconds
    );

    if (activeAnomaly.kind === 'state') {
      const nextStates = [
        ...selectedAnomalyStates.filter((card) => card.key !== activeAnomaly.key),
        nextCard,
      ];
      applyAnomalyCards(nextStates, selectedAnomalyDamages);
      return;
    }

    applyAnomalyCards(selectedAnomalyStates, [...selectedAnomalyDamages, nextCard]);
  }, [activeAnomaly, activeAnomalyLevel, activeAnomalySourceId, includeDotInTotal, activeDurationSeconds, sourceCharacters, buildMockAnomalyCard, selectedAnomalyStates, selectedAnomalyDamages, applyAnomalyCards]);

  const removeAnomalyCard = useCallback((kind: AnomalyCardKind, cardId: string) => {
    if (kind === 'state') {
      applyAnomalyCards(selectedAnomalyStates.filter((card) => card.id !== cardId), selectedAnomalyDamages);
      return;
    }
    applyAnomalyCards(selectedAnomalyStates, selectedAnomalyDamages.filter((card) => card.id !== cardId));
  }, [selectedAnomalyStates, selectedAnomalyDamages, applyAnomalyCards]);

  const toggleAnomalyDamageBuff = useCallback((cardId: string, buffId: string) => {
    const nextDamages = selectedAnomalyDamages.map((card) => {
      if (card.id !== cardId) {
        return card;
      }
      const hasBuff = card.selectedBuffIds.includes(buffId);
      return {
        ...card,
        selectedBuffIds: hasBuff
          ? card.selectedBuffIds.filter((id) => id !== buffId)
          : [...card.selectedBuffIds, buffId],
      };
    });
    applyAnomalyCards(selectedAnomalyStates, nextDamages);
  }, [selectedAnomalyStates, selectedAnomalyDamages, applyAnomalyCards]);

  const renderAnomalyDropdown = useCallback(<T extends string | number>(
    dropdownKey: string,
    label: string,
    valueLabel: string,
    options: Array<DropdownOption<T>>,
    onSelect: (value: T) => void,
    disabled = false
  ) => (
    <div className="anomaly-inline-control">
      <p className="anomaly-config-label">{label}</p>
      <div className={`anomaly-select-wrap${disabled ? ' is-disabled' : ''}`}>
        <button
          type="button"
          className="anomaly-select-trigger"
          onClick={() => {
            if (disabled) return;
            setOpenDropdownKey((prev) => prev === dropdownKey ? null : dropdownKey);
          }}
          disabled={disabled}
        >
          <span className="anomaly-select-value">{valueLabel}</span>
          <span className="anomaly-select-arrow">{openDropdownKey === dropdownKey ? '▲' : '▼'}</span>
        </button>
        {!disabled && openDropdownKey === dropdownKey ? (
          <div className="anomaly-select-menu">
            {options.map((option) => (
              <button
                type="button"
                key={`${dropdownKey}-${option.value}`}
                className="anomaly-select-option"
                onClick={() => {
                  onSelect(option.value);
                  setOpenDropdownKey(null);
                }}
              >
                {option.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  ), [openDropdownKey]);

  const renderAnomalyPanel = useCallback(() => (
    <div className="modal-content skill-anomaly-layout">
      <div className="skill-anomaly-tree">
        <div className="anomaly-category-tabs">
          {ANOMALY_GROUPS.map((group) => (
            <button
              key={group.key}
              className={`anomaly-category-tab${activeAnomalyGroup === group.key ? ' is-active' : ''}`}
              onClick={() => {
                setActiveAnomalyGroup(group.key);
                setActiveAnomalyKey(null);
              }}
            >
              {group.label}
            </button>
          ))}
        </div>

        <div className="anomaly-button-strip">
          {ANOMALY_GROUPS.find((group) => group.key === activeAnomalyGroup)?.items.map((option) => (
            <button
              key={option.key}
              className={`anomaly-strip-button${activeAnomaly?.key === option.key ? ' is-active' : ''}`}
              onClick={() => handleSelectAnomaly(option)}
            >
              <span>{option.label}</span>
            </button>
          ))}
        </div>

        {activeAnomaly && (
          <div className="anomaly-inline-panel">
            <div className="anomaly-inline-panel-head">
              <div>
                <p className="anomaly-config-title">{activeAnomaly.label}</p>
                <p className="anomaly-config-subtitle">{activeAnomaly.kind === 'state' ? '状态型异常演示' : '独立异常 hit 演示'}</p>
              </div>
              <button className="anomaly-apply-btn" onClick={handleApplyActiveAnomaly}>加入蓝框</button>
            </div>

            <div className="anomaly-inline-control-grid">
              {activeAnomaly.usesAnomalyLevel !== false
                ? renderAnomalyDropdown(
                  `${activeAnomaly.key}-level`,
                  '异常等级',
                  `${activeAnomalyLevel} 层`,
                  activeAnomaly.levelOptions.map((level) => ({ value: level, label: `${level} 层` })),
                  (value) => setActiveAnomalyLevel(Number(value))
                )
                : renderAnomalyDropdown(
                  `${activeAnomaly.key}-level`,
                  '异常等级',
                  '不适用',
                  [],
                  () => {},
                  true
                )}

              {activeAnomaly.supportsSource
                ? renderAnomalyDropdown(
                  `${activeAnomaly.key}-source`,
                  '来源角色',
                  activeSourceCharacter?.name ?? '未选择',
                  sourceCharacters.map((character) => ({ value: character.id, label: character.name })),
                  (value) => setActiveAnomalySourceId(String(value))
                )
                : activeAnomaly.supportsDotToggle
                  ? renderAnomalyDropdown(
                    `${activeAnomaly.key}-mode`,
                    '结果口径',
                    includeDotInTotal ? '计入持续段' : '仅初始段',
                    [
                      { value: 'include', label: '计入持续段' },
                      { value: 'initial', label: '仅初始段' },
                    ],
                    (value) => setIncludeDotInTotal(value === 'include')
                  )
                  : renderAnomalyDropdown(
                    `${activeAnomaly.key}-mode`,
                    '结果口径',
                    '独立 hit',
                    [],
                    () => {},
                    true
                  )}

              {activeAnomaly.supportsDuration && (
                renderAnomalyDropdown(
                  `${activeAnomaly.key}-duration`,
                  '持续时间',
                  `${activeDurationSeconds || 0}s`,
                  getAnomalyDurationOptions(activeAnomaly).map((seconds) => ({ value: seconds, label: `${seconds}s` })),
                  (value) => setActiveDurationSeconds(Number(value))
                )
              )}
            </div>

            <div className="anomaly-live-preview">
              {activeAnomalyPreview ? (
                activeAnomalyPreview.lines.map((line) => (
                  <p key={line} className="anomaly-live-line">{line}</p>
                ))
              ) : (
                <p className="anomaly-live-line">请选择异常项</p>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="skill-anomaly-config">
        <div className="skill-anomaly-board skill-anomaly-board-fixed">
          <div className="skill-anomaly-board-section">
            <p className="skill-anomaly-board-title">已选异常状态</p>
            <div className="skill-anomaly-board-list">
              {selectedAnomalyStates.length === 0 ? (
                <div className="skill-button-buff-empty">导电 / 腐蚀 / 碎甲 会显示在这里</div>
              ) : (
                selectedAnomalyStates.map((card) => (
                  <div
                    key={card.id}
                    className="anomaly-board-card is-state"
                    onContextMenu={(e) => {
                      e.preventDefault();
                      removeAnomalyCard('state', card.id);
                    }}
                    title="右键移除"
                  >
                    <span className="anomaly-board-card-title">{card.primaryText}</span>
                    <span>{card.secondaryText}</span>
                    {card.tertiaryText ? <span>{card.tertiaryText}</span> : null}
                  </div>
                ))
              )}
            </div>
          </div>
          <div className="skill-anomaly-board-section">
            <p className="skill-anomaly-board-title">已选异常伤害</p>
            <div className="skill-anomaly-board-list">
              {selectedAnomalyDamages.length === 0 ? (
                <div className="skill-button-buff-empty">猛击 / 碎冰 / 燃烧 / 法爆 会显示在这里</div>
              ) : (
                selectedAnomalyDamages.map((card) => (
                  <div
                    key={card.id}
                    className="anomaly-board-card is-damage"
                    onContextMenu={(e) => {
                      e.preventDefault();
                      removeAnomalyCard('damage', card.id);
                    }}
                    title="右键移除"
                  >
                    <span className="anomaly-board-card-title">{card.primaryText}</span>
                    <span>{card.secondaryText}</span>
                    {card.tertiaryText ? <span>{card.tertiaryText}</span> : null}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  ), [
    activeAnomaly,
    activeAnomalyGroup,
    activeAnomalyLevel,
    activeAnomalyPreview,
    activeDurationSeconds,
    activeSourceCharacter?.name,
    handleApplyActiveAnomaly,
    handleSelectAnomaly,
    includeDotInTotal,
    removeAnomalyCard,
    renderAnomalyDropdown,
    selectedAnomalyDamages,
    selectedAnomalyStates,
    sourceCharacters,
  ]);

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
                key={skillIconUrl}
                src={skillIconUrl}
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
              {(['A', 'B', 'E', 'Q'] as const).filter(type => type !== skillType).map((type) => (
                <button
                  key={type}
                  className="context-menu-item"
                  onClick={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    onChangeSkillType?.(button.id, type);
                    onCloseContextMenu?.();
                  }}
                >
                  {`改为${type}`}
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
                  <h5>{buffSearchMode === 'local' ? '本地 Buff' : buffSearchMode === 'candidate' ? '陈列区 Buff' : '异常伤害'}</h5>
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
                    className={`skill-button-inline-buff-search-mode${buffSearchMode === 'candidate' ? ' is-active' : ''}`}
                    onClick={() => setBuffSearchMode('candidate')}
                  >
                    陈列区 Buff
                  </button>
                  <button
                    type="button"
                    className={`skill-button-inline-buff-search-mode${buffSearchMode === 'anomaly' ? ' is-active' : ''}`}
                    onClick={() => setBuffSearchMode('anomaly')}
                  >
                    异常伤害
                  </button>
                </div>
                {buffSearchMode === 'anomaly' ? renderAnomalyPanel() : (
                  <>
                    <input
                      ref={localBuffSearchInputRef}
                      className="skill-button-inline-buff-search-input"
                      value={localBuffSearchKeyword}
                      onChange={(event) => setLocalBuffSearchKeyword(event.target.value)}
                      placeholder={buffSearchMode === 'local' ? '搜索组 / 项 / Buff / 类型 / 条件' : '搜索陈列区 Buff / 来源 / 类型 / 条件'}
                    />
                    <div className="skill-button-inline-buff-search-results">
                      {localBuffSearchKeyword.trim().length === 0 ? (
                        <div className="skill-button-inline-buff-search-empty">
                          {buffSearchMode === 'local' ? '输入关键词后再显示本地 Buff 结果' : '输入关键词后再显示陈列区 Buff 结果'}
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
                          {buffSearchMode === 'local' ? '没有匹配到本地 Buff' : '没有匹配到陈列区 Buff'}
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
                <h5>已选异常</h5>
                <div className="skill-button-anomaly-summary-list">
                  {[...selectedAnomalyStates, ...selectedAnomalyDamages].length === 0 ? (
                    <div className="skill-button-buff-empty">按 Tab 打开异常伤害页勾选要演示的异常项</div>
                  ) : (
                    [...selectedAnomalyStates, ...selectedAnomalyDamages].map((card) => (
                      <div key={card.id} className={`skill-button-anomaly-summary-card is-${card.kind}`}>
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
                                  <span className="buff-count">{segment.skillTypeText} / {segment.elementText}</span>
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
                              <p className="buff-section-title">生效 Buff:</p>
                              {damageViewModel.activeHitDetail.appliedBuffTags.length > 0 ? (
                                damageViewModel.activeHitDetail.appliedBuffTags.map((buffName) => (
                                  <span key={buffName} className="buff-tag">{buffName}</span>
                                ))
                              ) : (
                                <span className="no-buff">无</span>
                              )}
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
                              <p>技能类型: {activeAnomalySegment.skillTypeText}</p>
                              <p>伤害类型: {activeAnomalySegment.elementText}</p>
                              <p>最终倍率: {activeAnomalySegment.multiplierText}</p>
                              <p>期望伤害: {activeAnomalySegment.expectedText}</p>
                              <p>暴击伤害: {activeAnomalySegment.critText}</p>
                              <p>非暴击伤害: {activeAnomalySegment.nonCritText}</p>
                            </div>
                            <div className="hit-detail-buffs">
                              <p className="buff-section-title">生效 Buff:</p>
                              {activeAnomalySegment.appliedBuffNames.length > 0 ? (
                                activeAnomalySegment.appliedBuffNames.map((buffName) => (
                                  <span key={buffName} className="buff-tag">{buffName}</span>
                                ))
                              ) : (
                                <span className="no-buff">无</span>
                              )}
                            </div>
                            <div className="hit-detail-buffs">
                              <p className="buff-section-title">异常段 Buff 选择:</p>
                              {buffList.length > 0 ? (
                                buffList.map((buff) => {
                                  const activeDamageCard = selectedAnomalyDamages.find((card) => card.id === activeAnomalySegment.key);
                                  const isSelected = activeDamageCard?.selectedBuffIds.includes(buff.id) ?? false;
                                  return (
                                    <button
                                      key={buff.id}
                                      type="button"
                                      className={`buff-tag buff-tag-selectable${isSelected ? ' is-selected' : ''}`}
                                      onClick={() => toggleAnomalyDamageBuff(activeAnomalySegment.key, buff.id)}
                                    >
                                      {buff.displayName}
                                    </button>
                                  );
                                })
                              ) : (
                                <span className="no-buff">当前按钮没有可选 Buff</span>
                              )}
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
                              {damageViewModel.activeHitFormula.zoneSections.map((section) => (
                                <div key={section.title} className="formula-zone-section">
                                  <p className="formula-section-title">{section.title}</p>
                                  {section.lines.map((line) => (
                                    <p key={line}>{line}</p>
                                  ))}
                                  <p className="formula-zone-total">{section.totalText}</p>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {isShowingAnomalyDetail && activeAnomalySegment && isAnomalyFormulaExpanded && (
                          <div className="skill-damage-expanded">
                            <p className="skill-damage-expand-title">{activeAnomalySegment.title} 计算过程</p>
                            <div className="skill-damage-formula">
                              <p className="formula-section-title">【{activeAnomalySegment.title}】</p>
                              <p>ATK: {activeAnomalySegment.panelAtkText}</p>
                              <p>暴击率: {activeAnomalySegment.critRateText}</p>
                              <p>暴击伤害: {activeAnomalySegment.critDmgText}</p>
                              <p>源石技艺强度: {activeAnomalySegment.sourceSkillBoostText}</p>
                              <p>基础倍率: {activeAnomalySegment.baseMultiplierText}</p>
                              <p>等级系数区: × {activeAnomalySegment.levelCoefficientText}</p>
                              <p>源石技艺强度区: × {activeAnomalySegment.sourceSkillZoneText}</p>
                              <p>倍率Buff加算: {activeAnomalySegment.multiplierFormulaText}</p>
                              <p className="formula-zone-total">最终倍率 = {activeAnomalySegment.formulaText}</p>
                              <p>伤害加成区 = {activeAnomalySegment.damageBonusRateText}</p>
                              <p>增幅区 = {activeAnomalySegment.amplifyRateText}</p>
                              <p>脆弱区 = {activeAnomalySegment.fragileRateText}</p>
                              <p>易伤区 = {activeAnomalySegment.vulnerabilityRateText}</p>
                              <p>异常区 = {activeAnomalySegment.comboDamageBonusText}</p>
                              <p>期望伤害: {activeAnomalySegment.expectedText}</p>
                              <p>暴击伤害: {activeAnomalySegment.critText}</p>
                              <p>非暴击伤害: {activeAnomalySegment.nonCritText}</p>
                              <p>生效 Buff: {activeAnomalySegment.appliedBuffNames.length > 0 ? activeAnomalySegment.appliedBuffNames.join(' / ') : '无'}</p>
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
