import { useCallback, useEffect, useMemo } from 'react';
import type { SkillButton as SkillButtonType } from '../../types';
import { setSelectedSkillButton } from '../../hooks/useSkillButtonBuffs';
import { getCharacterComputedCache } from '../../core/repositories/operatorConfigRepository';
import { buildAttackFormulaLines, buildSkillDamageModalViewModel } from '../../core/calculators/skillDamageModalViewModel';
import { calculateSkillButtonDamageV2 } from '../../core/calculators/skillButtonDamageCalculatorV2';
import type { AppliedBuffTagViewModel, FormulaViewModel, SkillDamagePanelBase } from '../../core/calculators/skillDamage.types';
import { onSkillButtonBuffAdded } from '../../core/events/buffEvents';
import {
  type AnomalyDamageSegmentView,
  getNormalHitSegmentKey,
  buildAppliedBuffTags,
} from './skillButton.shared';
import { buildAnomalyBuffOptionsBySegmentKey, buildAnomalyDamageSegments } from './skillButtonAnomalyDamage';
import type { useSkillButtonRuntime } from './useSkillButtonRuntime';
import type { useSkillButtonAnomaly } from './useSkillButtonAnomaly';

type SkillButtonRuntime = ReturnType<typeof useSkillButtonRuntime>;
type SkillButtonAnomalyRuntime = ReturnType<typeof useSkillButtonAnomaly>;

interface UseSkillButtonDamageRuntimeParams {
  button: SkillButtonType & { nodeNumber?: number };
  characterName: string;
  isInspectMode: boolean;
  resistanceRevision: number;
  runtime: SkillButtonRuntime;
  anomaly: SkillButtonAnomalyRuntime;
}

export function useSkillButtonDamageRuntime({
  button,
  characterName,
  isInspectMode,
  resistanceRevision,
  runtime,
  anomaly,
}: UseSkillButtonDamageRuntimeParams) {
  const {
    isModalOpen,
    element,
    resolvedTemplate,
    targetResistance,
    panelData,
    infoSnap,
    selectedHitIndex,
    setSelectedHitIndex,
    buttonStackCounts,
    buffStackCountsByHitKey,
    manuallyDisabledBuffIdsBySegmentKey,
    setManuallyDisabledBuffIdsBySegmentKey,
    manualBuffStackCountsBySegmentKey,
    setManualBuffStackCountsBySegmentKey,
    manuallyDisabledHitKeys,
    setManuallyDisabledHitKeys,
    persistManualBuffTweaks,
    persistManualBuffStackCounts,
    persistManualDisabledHitKeys,
    buffList,
    extraHitBuffList,
    loadBuffList,
    loadPanelData,
    loadPersistedManualBuffTweaks,
    loadResolvedTemplate,
    loadSkillLevelModeMap,
    setSkillLevelModeMap,
    selectedAnomalySegmentKey,
    setSelectedAnomalySegmentKey,
    setIsAnomalyFormulaExpanded,
    wasModalOpenRef,
    setIsExpanded,
    setIsTargetResistanceExpanded,
  } = runtime;
  const {
    fullCombinedModifierBuffList,
    selectedAnomalyDamages,
    getEffectiveCharacterSourceSkillBoost,
    loadPersistedAnomalyCards,
    resetAnomalyDraftState,
  } = anomaly;
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
  }, [button.characterId]);
  const activeNormalHitSegmentKey = useMemo(
    () => (selectedHitIndex !== null && resolvedTemplate?.hits[selectedHitIndex] ? getNormalHitSegmentKey(resolvedTemplate.hits[selectedHitIndex].key) : null),
    [resolvedTemplate, selectedHitIndex]
  );
  const activeNormalHitKey = useMemo(
    () => (selectedHitIndex !== null && resolvedTemplate?.hits[selectedHitIndex] ? resolvedTemplate.hits[selectedHitIndex].key : null),
    [resolvedTemplate, selectedHitIndex]
  );
  const isActiveNormalHitDisabled = activeNormalHitKey ? manuallyDisabledHitKeys.includes(activeNormalHitKey) : false;
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
  const activeHitBuffOptions = useMemo(() => {
    if (selectedHitIndex === null || !fullDamageResult) {
      return [];
    }
    const hitResult = fullDamageResult.hits[selectedHitIndex];
    return hitResult ? buildAppliedBuffTags(hitResult.appliedBuffs, buttonStackCounts) : [];
  }, [buttonStackCounts, fullDamageResult, selectedHitIndex]);
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

  const toggleActiveNormalHitDisabled = useCallback(() => {
    if (!activeNormalHitKey) {
      return;
    }

    setManuallyDisabledHitKeys((prev) => {
      const next = prev.includes(activeNormalHitKey)
        ? prev.filter((hitKey) => hitKey !== activeNormalHitKey)
        : [...prev, activeNormalHitKey];
      persistManualDisabledHitKeys(next);
      return next;
    });
  }, [activeNormalHitKey, persistManualDisabledHitKeys]);

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
  const anomalyBuffOptionsBySegmentKey = useMemo<Record<string, AppliedBuffTagViewModel[]>>(() => {
    return buildAnomalyBuffOptionsBySegmentKey(
      selectedAnomalyDamages,
      fullCombinedModifierBuffList,
      extraHitBuffList,
      buttonStackCounts
    );
  }, [buttonStackCounts, extraHitBuffList, fullCombinedModifierBuffList, selectedAnomalyDamages]);
  const activeAnomalyBuffOptions = useMemo(
    () => (activeAnomalySegment ? (anomalyBuffOptionsBySegmentKey[activeAnomalySegment.key] ?? activeAnomalySegment.appliedBuffTags) : []),
    [activeAnomalySegment, anomalyBuffOptionsBySegmentKey]
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
    loadPersistedManualBuffTweaks();
  }, [loadPersistedManualBuffTweaks, resistanceRevision]);
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
    setIsAnomalyFormulaExpanded(false);
  }, [anomalyDamageSegments, selectedAnomalySegmentKey]);

  // 弹窗打开时加载数据，并设置当前选中的技能按钮
  useEffect(() => {
    if (isModalOpen && !wasModalOpenRef.current) {
      loadRuntimeDamageData();
      setIsExpanded(false);
      setSelectedHitIndex(0);
      setSelectedSkillButton(button.id);
      resetAnomalyDraftState();
      setIsTargetResistanceExpanded(false);
      setSelectedAnomalySegmentKey(null);
      setIsAnomalyFormulaExpanded(false);
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

  return {
    activeNormalHitSegmentKey,
    activeNormalHitKey,
    isActiveNormalHitDisabled,
    fullDamageResult,
    damageResult,
    damageViewModel,
    activeHitBuffOptions,
    isBuffManuallyActive,
    toggleManualBuff,
    resetManualBuffTweaks,
    getEffectiveSegmentStackCounts,
    adjustSegmentBuffStack,
    toggleActiveNormalHitDisabled,
    toggleManualHitDisabled,
    anomalyDamageSegments,
    activeAnomalySegment,
    activeAnomalyBuffOptions,
    isShowingAnomalyDetail,
    activeAnomalyFormula,
    anomalyDamageSummary,
    inspectDamageSummary,
    totalNonCritSummaryFormula,
    totalNonCritSummaryParts,
  };
}
