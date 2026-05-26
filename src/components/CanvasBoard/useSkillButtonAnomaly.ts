import { useCallback, useMemo, useState } from 'react';
import { calculateBuffTotals } from '../../core/calculators/buffCalculator';
import { getCharacterSourceSkillBoostSnapshot } from '../../core/repositories/operatorConfigRepository';
import { buildAnomalyStateDerivedBuffs, buildAnomalyStateSnapshotBuffs } from '../../core/services/anomalyStateBuffs';
import {
  createAnomalyStateSnapshot,
  getAnomalyStateSnapshotsByIds,
  listAnomalyStateSnapshots,
  removeAnomalyStateSnapshot,
} from '../../core/services/anomalyStateSnapshotStorage';
import { getSkillButtonById, getSkillButtonTable, upsertSkillButton } from '../../core/repositories';
import type { SkillButtonBuff } from '../../types/storage';
import {
  ALL_ANOMALY_OPTIONS,
  ANOMALY_STATE_OPTIONS,
  createAnomalyCardId,
  getAnomalyDurationOptions,
  type AnomalyCardKind,
  type AnomalyCategory,
  type AnomalyOption,
  type BurnDamageMode,
  normalizePersistedAnomalyCard,
  type SelectedAnomalyCard,
} from './skillButton.shared';

interface CharacterRef {
  id: string;
  name: string;
}

interface UseSkillButtonAnomalyParams {
  buttonId: string;
  buttonCharacterId: string;
  buttonSkillType: string;
  characterName: string;
  selectedCharacters: CharacterRef[];
  modifierBuffList: SkillButtonBuff[];
}

function buildMockAnomalyCard(
  option: AnomalyOption,
  level: number,
  sourceName?: string,
  burnDamageMode: BurnDamageMode = 'initialOnly',
  durationSeconds?: number
): SelectedAnomalyCard {
  if (option.key === 'combo-state' || option.key === 'imbalance-state') {
    const comboSkillBonus = [30, 45, 60, 75][level - 1] ?? 30;
    const comboUltimateBonus = [20, 30, 40, 50][level - 1] ?? 20;
    return {
      id: createAnomalyCardId(option.key),
      key: option.key,
      label: option.label,
      kind: option.kind,
      category: option.category,
      level,
      primaryText: option.label,
      secondaryText: option.key === 'combo-state'
        ? `战技 +${comboSkillBonus}% / 终结技 +${comboUltimateBonus}%`
        : '状态区 +30%',
      tertiaryText: option.key === 'combo-state' ? `${level} 层连击` : '固定入口',
      selectedBuffIds: [],
    };
  }

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
    : option.key === 'armor-break'
      ? `${50 * (1 + level)}% 独立 hit`
      : option.key === 'shatter-ice'
        ? `${120 * (1 + level)}% 物理 hit`
        : option.key === 'conductive' || option.key === 'corrosion'
          ? `${80 * (1 + level)}% 初始 hit`
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
      includeDotInTotal: option.key === 'burn' ? burnDamageMode !== 'initialOnly' : undefined,
      burnDamageMode: option.key === 'burn' ? burnDamageMode : undefined,
      durationSeconds: option.supportsDuration ? durationSeconds : undefined,
      tertiaryText: option.key === 'burn'
        ? `${formatBurnDamageModeLabel(burnDamageMode)}${durationSeconds ? ` · ${durationSeconds}s` : ''}`
      : durationSeconds
        ? `持续 ${durationSeconds}s`
        : '等待真实计算接入',
    selectedBuffIds: [],
  };
}

function formatBurnDamageModeLabel(mode: BurnDamageMode): string {
  switch (mode) {
    case 'dotOnly':
      return '仅计入持续段';
    case 'splitDot':
      return '分开计入持续段';
    case 'initialOnly':
    default:
      return '仅计入初始段';
  }
}

export function useSkillButtonAnomaly({
  buttonId,
  buttonCharacterId,
  buttonSkillType,
  characterName,
  selectedCharacters,
  modifierBuffList,
}: UseSkillButtonAnomalyParams) {
  const [activeAnomalyGroup, setActiveAnomalyGroup] = useState<AnomalyCategory>('magic');
  const [activeAnomalyKey, setActiveAnomalyKey] = useState<string | null>(null);
  const [activeAnomalyLevel, setActiveAnomalyLevel] = useState(1);
  const [activeAnomalySourceId, setActiveAnomalySourceId] = useState<string | null>(null);
  const [burnDamageMode, setBurnDamageMode] = useState<BurnDamageMode>('dotOnly');
  const [activeDurationSeconds, setActiveDurationSeconds] = useState(0);
  const [activeAnomalyStateKey, setActiveAnomalyStateKey] = useState<'conductive' | 'corrosion' | 'armor-break' | null>(null);
  const [activeAnomalyStateLevel, setActiveAnomalyStateLevel] = useState(1);
  const [activeAnomalyStateSourceId, setActiveAnomalyStateSourceId] = useState<string | null>(null);
  const [activeAnomalyStateDurationSeconds, setActiveAnomalyStateDurationSeconds] = useState(0);
  const [selectedStatusCards, setSelectedStatusCards] = useState<SelectedAnomalyCard[]>([]);
  const [selectedAnomalyDamages, setSelectedAnomalyDamages] = useState<SelectedAnomalyCard[]>([]);
  const [selectedAnomalyStateSnapshotIds, setSelectedAnomalyStateSnapshotIds] = useState<number[]>([]);
  const [cachedAnomalyStateSnapshots, setCachedAnomalyStateSnapshots] = useState(listAnomalyStateSnapshots());

  const refreshCachedAnomalyStateSnapshots = useCallback(() => {
    setCachedAnomalyStateSnapshots(listAnomalyStateSnapshots());
  }, []);

  const loadPersistedAnomalyCards = useCallback(() => {
    const persistedButton = getSkillButtonById(buttonId);
    const selectedStatuses = persistedButton?.anomalyConfig?.selectedStatuses ?? [];
    const selectedDamages = persistedButton?.anomalyConfig?.selectedDamages ?? [];
    const selectedStateSnapshotIds = persistedButton?.anomalyConfig?.selectedStateSnapshotIds ?? [];
    setSelectedStatusCards(selectedStatuses.map(normalizePersistedAnomalyCard));
    setSelectedAnomalyDamages(selectedDamages.map(normalizePersistedAnomalyCard));
    setSelectedAnomalyStateSnapshotIds(selectedStateSnapshotIds);
    refreshCachedAnomalyStateSnapshots();
  }, [buttonId, refreshCachedAnomalyStateSnapshots]);

  const persistAnomalyCards = useCallback((nextStatuses: SelectedAnomalyCard[], nextDamages: SelectedAnomalyCard[], nextStateSnapshotIds: number[]) => {
    const persistedButton = getSkillButtonById(buttonId);
    if (!persistedButton) {
      return;
    }

    upsertSkillButton({
      ...persistedButton,
      anomalyConfig: {
        selectedStatuses: nextStatuses,
        selectedDamages: nextDamages,
        selectedStateSnapshotIds: nextStateSnapshotIds,
      },
      updatedAt: Date.now(),
    });
  }, [buttonId]);

  const applyAnomalyCards = useCallback((
    nextStatuses: SelectedAnomalyCard[],
    nextDamages: SelectedAnomalyCard[],
    nextStateSnapshotIds: number[],
    shouldPersist = true
  ) => {
    setSelectedStatusCards(nextStatuses);
    setSelectedAnomalyDamages(nextDamages);
    setSelectedAnomalyStateSnapshotIds(nextStateSnapshotIds);
    if (shouldPersist) {
      persistAnomalyCards(nextStatuses, nextDamages, nextStateSnapshotIds);
    }
  }, [persistAnomalyCards]);

  const selectedAnomalyStateSnapshots = useMemo(
    () => getAnomalyStateSnapshotsByIds(selectedAnomalyStateSnapshotIds),
    [selectedAnomalyStateSnapshotIds]
  );

  const stateDerivedBuffList = useMemo(
    () => [
      ...buildAnomalyStateDerivedBuffs(selectedStatusCards, buttonSkillType),
      ...buildAnomalyStateSnapshotBuffs(selectedAnomalyStateSnapshots),
    ],
    [buttonSkillType, selectedAnomalyStateSnapshots, selectedStatusCards]
  );

  const fullCombinedModifierBuffList = useMemo(
    () => [...modifierBuffList, ...stateDerivedBuffList],
    [modifierBuffList, stateDerivedBuffList]
  );

  const sourceCharacters = useMemo(() => {
    if (selectedCharacters.some((character) => character.id === buttonCharacterId)) {
      return selectedCharacters;
    }

    return [{ id: buttonCharacterId, name: characterName }, ...selectedCharacters];
  }, [buttonCharacterId, characterName, selectedCharacters]);

  const activeAnomaly = useMemo(
    () => ALL_ANOMALY_OPTIONS.find((item) => item.key === activeAnomalyKey) ?? null,
    [activeAnomalyKey]
  );

  const activeAnomalyStateOption = useMemo(
    () => ANOMALY_STATE_OPTIONS.find((item) => item.key === activeAnomalyStateKey) ?? null,
    [activeAnomalyStateKey]
  );

  const activeAnomalyStateSourceCharacter = useMemo(
    () => sourceCharacters.find((character) => character.id === activeAnomalyStateSourceId) ?? null,
    [activeAnomalyStateSourceId, sourceCharacters]
  );

  const activeSourceCharacter = useMemo(
    () => sourceCharacters.find((character) => character.id === activeAnomalySourceId) ?? null,
    [activeAnomalySourceId, sourceCharacters]
  );

  const getCharacterSourceSkillBoost = useCallback((characterId: string | null): number => {
    if (!characterId) return 0;
    return getCharacterSourceSkillBoostSnapshot(characterId);
  }, []);

  const getEffectiveCharacterSourceSkillBoost = useCallback((characterId: string | null, buffs: SkillButtonBuff[] = []): number => {
    const baseSourceSkillBoost = getCharacterSourceSkillBoost(characterId);
    if (buffs.length === 0) {
      return baseSourceSkillBoost;
    }
    return baseSourceSkillBoost + calculateBuffTotals(buffs).sourceSkillBoost;
  }, [getCharacterSourceSkillBoost]);

  const activeAnomalyStateSourceSkillBoost = useMemo(
    () => getEffectiveCharacterSourceSkillBoost(
      activeAnomalyStateSourceId,
      activeAnomalyStateSourceId === buttonCharacterId ? fullCombinedModifierBuffList : []
    ),
    [activeAnomalyStateSourceId, buttonCharacterId, fullCombinedModifierBuffList, getEffectiveCharacterSourceSkillBoost]
  );

  const activeAnomalyPreview = useMemo(() => {
    if (!activeAnomaly) return null;

    const currentOperatorLevel = 90;
    const currentCharacterSourceSkillBoost = getEffectiveCharacterSourceSkillBoost(buttonCharacterId, fullCombinedModifierBuffList);
    const levelCoefficient = activeAnomaly.category === 'magic'
      ? 1 + (currentOperatorLevel - 1) / 196
      : 1 + (currentOperatorLevel - 1) / 392;

    if (activeAnomaly.key === 'combo-state') {
      const comboSkillBonus = [30, 45, 60, 75][activeAnomalyLevel - 1] ?? 30;
      const comboUltimateBonus = [20, 30, 40, 50][activeAnomalyLevel - 1] ?? 20;
      return {
        lines: [
          '状态区入口',
          `连击层数: ${activeAnomalyLevel} 层`,
          `战技增伤: +${comboSkillBonus.toFixed(1)}%`,
          `终结技增伤: +${comboUltimateBonus.toFixed(1)}%`,
          `当前按钮类型: ${buttonSkillType}`,
        ],
      };
    }

    if (activeAnomaly.key === 'imbalance-state') {
      return {
        lines: [
          '状态区入口',
          '固定效果: 失衡 +30.0%',
          '当前实现: 独立失衡区乘算',
        ],
      };
    }

    const initialBaseMultiplierPercent = activeAnomaly.key === 'magic-burst'
      ? 160
      : activeAnomaly.key === 'smash'
        ? 150 * (1 + activeAnomalyLevel)
        : activeAnomaly.key === 'armor-break'
          ? 50 * (1 + activeAnomalyLevel)
          : activeAnomaly.key === 'shatter-ice'
            ? 120 * (1 + activeAnomalyLevel)
            : activeAnomaly.key === 'conductive' || activeAnomaly.key === 'corrosion'
              ? 80 * (1 + activeAnomalyLevel)
              : activeAnomaly.key === 'burn'
                ? 80 * (1 + activeAnomalyLevel)
                : activeAnomaly.key === 'freeze'
                  ? 80 * (1 + activeAnomalyLevel)
                  : activeAnomaly.key === 'knockdown' || activeAnomaly.key === 'launch'
                    ? 120
                    : 0;
    const burnTickMultiplierPercent = activeAnomaly.key === 'burn'
      ? 12 * (1 + activeAnomalyLevel)
      : 0;
    const burnDotMultiplierPercent = burnTickMultiplierPercent * activeDurationSeconds;
    const baseMultiplierPercent = activeAnomaly.key === 'burn' && burnDamageMode !== 'initialOnly'
      ? (burnDamageMode === 'splitDot' ? burnTickMultiplierPercent : burnDotMultiplierPercent)
      : initialBaseMultiplierPercent;
    const sourceSkillZone = 1 + currentCharacterSourceSkillBoost / 100;
    const finalMultiplierPercent = baseMultiplierPercent * levelCoefficient * sourceSkillZone;

    const imbalanceGain = activeAnomaly.key === 'knockdown' || activeAnomaly.key === 'launch'
      ? 10 + currentCharacterSourceSkillBoost * 0.5
      : null;
    return {
      lines: [
        `源石技艺强度: ${currentCharacterSourceSkillBoost.toFixed(1)}`,
        activeAnomaly.key === 'burn' && burnDamageMode === 'dotOnly'
          ? `基础倍率: ${(12 * (1 + activeAnomalyLevel)).toFixed(1)}% × ${activeDurationSeconds.toFixed(0)}s = ${baseMultiplierPercent.toFixed(1)}%`
          : activeAnomaly.key === 'burn' && burnDamageMode === 'splitDot'
            ? `单段倍率: ${(12 * (1 + activeAnomalyLevel)).toFixed(1)}% × ${activeDurationSeconds.toFixed(0)} hit`
          : `基础倍率: ${baseMultiplierPercent.toFixed(1)}%`,
        `等级系数区: × ${levelCoefficient.toFixed(3)}`,
        `源石技艺强度区: × ${sourceSkillZone.toFixed(3)}`,
        `最终倍率: ${baseMultiplierPercent.toFixed(1)}% × ${levelCoefficient.toFixed(3)} × ${sourceSkillZone.toFixed(3)} = ${finalMultiplierPercent.toFixed(1)}%`,
        imbalanceGain !== null ? `失衡值增强后: ${imbalanceGain.toFixed(1)}` : null,
        activeAnomaly.key === 'burn'
          ? `结果口径: ${formatBurnDamageModeLabel(burnDamageMode)}`
          : null,
      ].filter((line): line is string => Boolean(line)),
    };
  }, [activeAnomaly, activeAnomalyLevel, activeDurationSeconds, burnDamageMode, buttonCharacterId, buttonSkillType, fullCombinedModifierBuffList, getEffectiveCharacterSourceSkillBoost]);

  const activeAnomalyStatePreview = useMemo(() => {
    if (!activeAnomalyStateOption) {
      return null;
    }

    const effectEnhancement = activeAnomalyStateSourceSkillBoost > 0
      ? (2 * activeAnomalyStateSourceSkillBoost) / (activeAnomalyStateSourceSkillBoost + 300)
      : 0;

    if (activeAnomalyStateOption.key === 'conductive') {
      const baseRate = [0.12, 0.16, 0.2, 0.24][activeAnomalyStateLevel - 1] ?? 0.12;
      const effectValue = baseRate * (1 + effectEnhancement);
      return {
        effectValue,
        lines: [
          `来源角色: ${activeAnomalyStateSourceCharacter?.name ?? '未选择'}`,
          `源石技艺强度快照: ${activeAnomalyStateSourceSkillBoost.toFixed(1)}`,
          `源石技艺强度区: × ${(1 + effectEnhancement).toFixed(3)}`,
          `异常等级: ${activeAnomalyStateLevel} 层`,
          `快照效果: ${(effectValue * 100).toFixed(1)}% 法术易伤`,
        ],
      };
    }

    if (activeAnomalyStateOption.key === 'armor-break') {
      const baseRate = [0.12, 0.16, 0.2, 0.24][activeAnomalyStateLevel - 1] ?? 0.12;
      const effectValue = baseRate * (1 + effectEnhancement);
      return {
        effectValue,
        lines: [
          `来源角色: ${activeAnomalyStateSourceCharacter?.name ?? '未选择'}`,
          `源石技艺强度快照: ${activeAnomalyStateSourceSkillBoost.toFixed(1)}`,
          `源石技艺强度区: × ${(1 + effectEnhancement).toFixed(3)}`,
          `异常等级: ${activeAnomalyStateLevel} 层`,
          `快照效果: ${(effectValue * 100).toFixed(1)}% 物伤易伤`,
        ],
      };
    }

    const baseStart = [3.6, 4.8, 6, 7.2][activeAnomalyStateLevel - 1] ?? 3.6;
    const baseTick = [0.84, 1.12, 1.4, 1.68][activeAnomalyStateLevel - 1] ?? 0.84;
    const baseCap = [12, 16, 20, 24][activeAnomalyStateLevel - 1] ?? 12;
    return {
      effectValue: 0,
      lines: [
        `来源角色: ${activeAnomalyStateSourceCharacter?.name ?? '未选择'}`,
        `源石技艺强度快照: ${activeAnomalyStateSourceSkillBoost.toFixed(1)}`,
        `源石技艺强度区: × ${(1 + effectEnhancement).toFixed(3)}`,
        `异常等级: ${activeAnomalyStateLevel} 层`,
        `快照效果: 初始 ${(baseStart * (1 + effectEnhancement)).toFixed(2)} / 每秒 ${(baseTick * (1 + effectEnhancement)).toFixed(2)} / 上限 ${(baseCap * (1 + effectEnhancement)).toFixed(2)}`,
      ],
    };
  }, [activeAnomalyStateLevel, activeAnomalyStateOption, activeAnomalyStateSourceCharacter?.name, activeAnomalyStateSourceSkillBoost]);

  const availableAnomalyStateSnapshots = useMemo(() => {
    const selectedIdSet = new Set(selectedAnomalyStateSnapshotIds);
    return cachedAnomalyStateSnapshots.filter((snapshot) => !selectedIdSet.has(snapshot.id));
  }, [cachedAnomalyStateSnapshots, selectedAnomalyStateSnapshotIds]);

  const anomalyStateSnapshotUsageCounts = useMemo(() => {
    const usageCountMap = new Map<number, number>();
    Object.values(getSkillButtonTable()).forEach((skillButton) => {
      (skillButton.anomalyConfig?.selectedStateSnapshotIds ?? []).forEach((snapshotId) => {
        usageCountMap.set(snapshotId, (usageCountMap.get(snapshotId) ?? 0) + 1);
      });
    });
    return usageCountMap;
  }, [selectedAnomalyStateSnapshotIds]);

  const handleSelectAnomaly = useCallback((option: AnomalyOption) => {
    setActiveAnomalyKey((prev) => (prev === option.key ? null : option.key));
    setActiveAnomalyLevel(option.levelOptions[0] ?? 1);
    const durationOptions = getAnomalyDurationOptions(option);
    setActiveDurationSeconds(durationOptions[0] ?? 0);
    setBurnDamageMode(option.key === 'burn' ? 'dotOnly' : 'initialOnly');
    setActiveAnomalySourceId(option.supportsSource ? (sourceCharacters[0]?.id ?? buttonCharacterId) : null);
  }, [buttonCharacterId, sourceCharacters]);

  const handleSelectAnomalyState = useCallback((key: 'conductive' | 'corrosion' | 'armor-break') => {
    const option = ANOMALY_STATE_OPTIONS.find((item) => item.key === key) ?? null;
    setActiveAnomalyStateKey((prev) => (prev === key ? null : key));
    setActiveAnomalyStateLevel(option?.levelOptions[0] ?? 1);
    setActiveAnomalyStateDurationSeconds(option?.supportsDuration ? (getAnomalyDurationOptions({ ...option, kind: 'state', supportsSource: true } as AnomalyOption)[0] ?? 0) : 0);
    setActiveAnomalyStateSourceId(sourceCharacters[0]?.id ?? buttonCharacterId);
  }, [buttonCharacterId, sourceCharacters]);

  const handleApplyActiveAnomaly = useCallback(() => {
    if (!activeAnomaly) return;
    const sourceName = sourceCharacters.find((character) => character.id === activeAnomalySourceId)?.name;
    const nextCard = buildMockAnomalyCard(
      activeAnomaly,
      activeAnomalyLevel,
      sourceName,
      burnDamageMode,
      activeDurationSeconds
    );

    if (activeAnomaly.kind === 'state') {
      const nextStatuses = [
        ...selectedStatusCards.filter((card) => card.key !== activeAnomaly.key),
        nextCard,
      ];
      applyAnomalyCards(nextStatuses, selectedAnomalyDamages, selectedAnomalyStateSnapshotIds);
      return;
    }

    applyAnomalyCards(selectedStatusCards, [...selectedAnomalyDamages.filter((card) => card.key !== nextCard.key), nextCard], selectedAnomalyStateSnapshotIds);
  }, [activeAnomaly, activeAnomalyLevel, activeAnomalySourceId, burnDamageMode, activeDurationSeconds, sourceCharacters, selectedStatusCards, selectedAnomalyDamages, selectedAnomalyStateSnapshotIds, applyAnomalyCards]);

  const handleCreateAnomalyStateSnapshot = useCallback(() => {
    if (!activeAnomalyStateOption || !activeAnomalyStateSourceCharacter || !activeAnomalyStatePreview) {
      return;
    }
    const snapshot = createAnomalyStateSnapshot({
      key: activeAnomalyStateOption.key,
      label: activeAnomalyStateOption.label,
      level: activeAnomalyStateLevel,
      sourceButtonId: buttonId,
      sourceCharacterId: activeAnomalyStateSourceCharacter.id,
      sourceCharacterName: activeAnomalyStateSourceCharacter.name,
      sourceSkillStrengthSnapshot: activeAnomalyStateSourceSkillBoost,
      effectValue: activeAnomalyStatePreview.effectValue,
      durationSeconds: activeAnomalyStateOption.supportsDuration ? activeAnomalyStateDurationSeconds : undefined,
      primaryText: `${activeAnomalyStateOption.label} Lv${activeAnomalyStateLevel} · 来源 ${activeAnomalyStateSourceCharacter.name}`,
      secondaryText: activeAnomalyStatePreview.lines[4] ?? activeAnomalyStateOption.label,
      tertiaryText: activeAnomalyStateOption.supportsDuration ? `持续 ${activeAnomalyStateDurationSeconds}s` : '快照生效',
    });
    const nextIds = [
      ...selectedAnomalyStateSnapshotIds.filter((id) => {
        const existing = listAnomalyStateSnapshots().find((item) => item.id === id);
        return existing?.key !== snapshot.key;
      }),
      snapshot.id,
    ];
    refreshCachedAnomalyStateSnapshots();
    applyAnomalyCards(selectedStatusCards, selectedAnomalyDamages, nextIds);
  }, [activeAnomalyStateDurationSeconds, activeAnomalyStateLevel, activeAnomalyStateOption, activeAnomalyStatePreview, activeAnomalyStateSourceCharacter, activeAnomalyStateSourceSkillBoost, applyAnomalyCards, buttonId, refreshCachedAnomalyStateSnapshots, selectedAnomalyDamages, selectedAnomalyStateSnapshotIds, selectedStatusCards]);

  const removeAnomalyCard = useCallback((kind: AnomalyCardKind, cardId: string) => {
    if (kind === 'state') {
      applyAnomalyCards(selectedStatusCards.filter((card) => card.id !== cardId), selectedAnomalyDamages, selectedAnomalyStateSnapshotIds);
      return;
    }
    applyAnomalyCards(selectedStatusCards, selectedAnomalyDamages.filter((card) => card.id !== cardId), selectedAnomalyStateSnapshotIds);
  }, [selectedStatusCards, selectedAnomalyDamages, selectedAnomalyStateSnapshotIds, applyAnomalyCards]);

  const removeAnomalyStateSnapshotCard = useCallback((snapshotId: number) => {
    applyAnomalyCards(
      selectedStatusCards,
      selectedAnomalyDamages,
      selectedAnomalyStateSnapshotIds.filter((id) => id !== snapshotId)
    );
  }, [applyAnomalyCards, selectedAnomalyDamages, selectedAnomalyStateSnapshotIds, selectedStatusCards]);

  const attachAnomalyStateSnapshotCard = useCallback((snapshotId: number) => {
    const snapshot = cachedAnomalyStateSnapshots.find((item) => item.id === snapshotId);
    if (!snapshot) {
      return;
    }

    const nextIds = [
      ...selectedAnomalyStateSnapshotIds.filter((id) => {
        const existing = cachedAnomalyStateSnapshots.find((item) => item.id === id);
        return existing?.key !== snapshot.key;
      }),
      snapshot.id,
    ];

    applyAnomalyCards(selectedStatusCards, selectedAnomalyDamages, nextIds);
  }, [applyAnomalyCards, cachedAnomalyStateSnapshots, selectedAnomalyDamages, selectedAnomalyStateSnapshotIds, selectedStatusCards]);

  const deleteAnomalyStateSnapshotCard = useCallback((snapshotId: number) => {
    const usageCount = anomalyStateSnapshotUsageCounts.get(snapshotId) ?? 0;
    if (usageCount > 0) {
      window.alert('该快照仍被界面中的项目引用，需先全部卸载后才能删除。');
      return;
    }

    removeAnomalyStateSnapshot(snapshotId);
    refreshCachedAnomalyStateSnapshots();
  }, [anomalyStateSnapshotUsageCounts, refreshCachedAnomalyStateSnapshots]);

  const resetAnomalyDraftState = useCallback(() => {
    setActiveAnomalyGroup('magic');
    setActiveAnomalyKey(null);
    setActiveAnomalyLevel(1);
    setActiveAnomalySourceId(null);
    setActiveAnomalyStateKey(null);
    setActiveAnomalyStateLevel(1);
    setActiveAnomalyStateSourceId(null);
    setActiveAnomalyStateDurationSeconds(0);
    setBurnDamageMode('dotOnly');
    setActiveDurationSeconds(0);
  }, []);

  return {
    activeAnomaly,
    activeAnomalyGroup,
    activeAnomalyKey,
    activeAnomalyLevel,
    activeAnomalyPreview,
    activeSourceCharacter,
    activeAnomalySourceId,
    activeAnomalyStateDurationSeconds,
    activeAnomalyStateKey,
    activeAnomalyStateLevel,
    activeAnomalyStateOption,
    activeAnomalyStatePreview,
    activeAnomalyStateSourceCharacter,
    activeAnomalyStateSourceId,
    activeAnomalyStateSourceSkillBoost,
    anomalyStateSnapshotUsageCounts,
    applyAnomalyCards,
    attachAnomalyStateSnapshotCard,
    availableAnomalyStateSnapshots,
    deleteAnomalyStateSnapshotCard,
    handleApplyActiveAnomaly,
    handleCreateAnomalyStateSnapshot,
    handleSelectAnomaly,
    handleSelectAnomalyState,
    includeDotInTotal: burnDamageMode !== 'initialOnly',
    burnDamageMode,
    loadPersistedAnomalyCards,
    fullCombinedModifierBuffList,
    removeAnomalyCard,
    removeAnomalyStateSnapshotCard,
    resetAnomalyDraftState,
    selectedAnomalyDamages,
    selectedAnomalyStateSnapshotIds,
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
    setIncludeDotInTotal: (value: boolean) => setBurnDamageMode(value ? 'dotOnly' : 'initialOnly'),
    setBurnDamageMode,
    sourceCharacters,
    stateDerivedBuffList,
    getEffectiveCharacterSourceSkillBoost,
    activeDurationSeconds,
  };
}
