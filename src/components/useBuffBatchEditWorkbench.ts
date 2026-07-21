import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { getAllBuffList } from '../core/repositories';
import { getCharacterInputMap } from '../core/repositories/operatorConfigRepository';
import { decrementBuffStackOnButton, getBuffsByButtonId, loadBuffsToCache, removeBuffFromButton } from '../core/services/buffService';
import {
  dedupeLocalBuffSearchResults,
  filterBuffSearchEntriesBySourceMode,
  readCandidateBuffSearchEntries,
  readLocalBuffSearchEntries,
  type LocalBuffSearchResult,
} from './CanvasBoard/skillButton.shared';
import { useSkillButtonAnomaly } from './CanvasBoard/useSkillButtonAnomaly';
import { buildBuffSearchIndex, searchBuffs } from '../utils/buffFuzzySearch';
import { refreshSnapshotCandidateBuffsForCharacterIds } from '../core/services/operatorConfigCandidateBuffService';
import { refreshOperatorConfigSnapshotsForCharacters } from '../core/services/operatorConfigSnapshotRefreshService';
import { useAppContext } from '../context/AppContext';
import {
  getGridContentOffsetX,
  GRID_GROUP_HEIGHT,
  GRID_GROUP_GAP,
  GRID_STACK_PADDING_BOTTOM,
  GRID_STACK_PADDING_TOP,
} from '../core/calculators/gridSnapLayout';
import type { Character } from '../types';
import type { AnomalyStateSnapshot, PersistedSkillButton, SkillButtonBuff } from '../types/storage';
import {
  BUFF_EDIT_RIGHT_ZONE_WIDTH,
  BUFF_EDIT_SECONDARY_BUTTON_GAP,
  BUFF_EDIT_SECONDARY_BUTTON_LEFT_FALLBACK,
  BUFF_EDIT_SECONDARY_BUTTON_WIDTH,
  BUFF_EDIT_TOP_SPACER_HEIGHT,
  SKILL_BUTTON_HIT_HEIGHT,
  SKILL_BUTTON_HIT_WIDTH,
  SKILL_BUTTON_RADIUS,
  SKILL_BUTTON_VISUAL_OFFSET_X,
  SKILL_BUTTON_VISUAL_OFFSET_Y,
  addDraftBuffToButton,
  buffFromSearchResult,
  buffMatchesSourceFilter,
  buildButtonPosition,
  candidateBuffFromAnomalyStateSnapshot,
  compareBuffBySource,
  dedupeBuffIds,
  getCharacterWeaponName,
  getFallbackSkillButtons,
  getInitialSkillButtons,
  getNextCandidateAdderMode,
  getStaffGroupCount,
  intersects,
  isCandidateSourceMode,
  normalizeRect,
  readVisualSkillButtons,
  type BoxSelectRect,
  type CandidateAdderMode,
  type EditToolMode,
  type SourceFilter,
} from './buffBatchEditModel';

export function useBuffBatchEditWorkbench(selectedCharacters: Character[]) {
  const { state, refreshSelectedCharacters } = useAppContext();
  const [selectedButtonIds, setSelectedButtonIds] = useState<string[]>([]);
  const [toolMode, setToolMode] = useState<EditToolMode>('normal');
  const [selectedFilterBuffIds, setSelectedFilterBuffIds] = useState<string[]>([]);
  const [pressedCharacterIds, setPressedCharacterIds] = useState<string[]>([]);
  const [activeSourceFilter, setActiveSourceFilter] = useState<SourceFilter | null>(null);
  const [activeAddBuffId, setActiveAddBuffId] = useState<string | null>(null);
  const [pendingAddByBuff, setPendingAddByBuff] = useState<Record<string, string[]>>({});
  const [candidateAddBuffs, setCandidateAddBuffs] = useState<SkillButtonBuff[]>([]);
  const [batchAnomalyStateSnapshots, setBatchAnomalyStateSnapshots] = useState<AnomalyStateSnapshot[]>([]);
  const nextBatchAnomalyStateSnapshotIdRef = useRef(1);
  const [isCandidateAdderOpen, setIsCandidateAdderOpen] = useState(false);
  const [candidateSearchKeyword, setCandidateSearchKeyword] = useState('');
  const [candidateBuffRefreshToken, setCandidateBuffRefreshToken] = useState(0);
  const [candidateAdderMode, setCandidateAdderMode] = useState<CandidateAdderMode>('buff-group');
  const [activeRemoveBuffId, setActiveRemoveBuffId] = useState<string | null>(null);
  const [pendingRemoveByBuff, setPendingRemoveByBuff] = useState<Record<string, string[]>>({});
  const [editAddByBuff, setEditAddByBuff] = useState<Record<string, string[]>>({});
  const [editRemoveByBuff, setEditRemoveByBuff] = useState<Record<string, string[]>>({});
  const [buffListVersion, setBuffListVersion] = useState(0);
  const [isBoxSelectArmed, setIsBoxSelectArmed] = useState(false);
  const [boxSelectRect, setBoxSelectRect] = useState<BoxSelectRect | null>(null);
  const layoutRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const [gridContentOffsetX, setGridContentOffsetX] = useState<number | null>(null);
  const [layoutWidth, setLayoutWidth] = useState<number | null>(null);
  const [visualButtons, setVisualButtons] = useState<PersistedSkillButton[]>(() => getInitialSkillButtons(selectedCharacters));
  const candidateSearchInputRef = useRef<HTMLInputElement | null>(null);
  const characterById = useMemo(() => {
    return new Map(selectedCharacters.flatMap((character) => [
      [character.id, character],
      [character.name, character],
    ]));
  }, [selectedCharacters]);
  const skillButtons = useMemo(() => {
    return visualButtons.length > 0 ? visualButtons : getFallbackSkillButtons();
  }, [visualButtons]);
  const allBuffs = useMemo(() => getAllBuffList(), [buffListVersion]);
  const addModeBuffs = useMemo(() => [...allBuffs, ...candidateAddBuffs], [allBuffs, candidateAddBuffs]);
  const sortedBuffs = useMemo(() => [...allBuffs].sort(compareBuffBySource), [allBuffs]);
  const visibleFilterBuffs = useMemo(
    () => sortedBuffs.filter((buff) => buffMatchesSourceFilter(buff, activeSourceFilter)),
    [activeSourceFilter, sortedBuffs]
  );
  const allCandidateSearchEntries = useMemo(() => [
    ...readLocalBuffSearchEntries(),
    ...readCandidateBuffSearchEntries(),
  ], [candidateBuffRefreshToken, isCandidateAdderOpen, candidateAddBuffs]);
  const candidateSearchEntries = useMemo(() => {
    if (!isCandidateSourceMode(candidateAdderMode)) {
      return [];
    }
    return filterBuffSearchEntriesBySourceMode(allCandidateSearchEntries, candidateAdderMode);
  }, [allCandidateSearchEntries, candidateAdderMode]);
  const candidateSearchIndex = useMemo(() => buildBuffSearchIndex(
    candidateSearchEntries,
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
  ), [candidateSearchEntries]);
  const candidateSearchResults = useMemo(() => {
    if (!candidateSearchKeyword.trim()) return [];
    return dedupeLocalBuffSearchResults(searchBuffs(candidateSearchKeyword, candidateSearchIndex)).slice(0, 50);
  }, [candidateSearchIndex, candidateSearchKeyword]);
  const characterInputMap = useMemo(() => getCharacterInputMap(), []);
  const weaponButtonItems = useMemo(() => selectedCharacters
    .map((character) => ({
      character,
      weaponName: getCharacterWeaponName(character, characterInputMap),
    }))
    .filter((item) => item.weaponName.length > 0)
    .slice(0, 4), [characterInputMap, selectedCharacters]);
  const selectedButtons = useMemo(() => {
    const selectedSet = new Set(selectedButtonIds);
    return skillButtons.filter((button) => selectedSet.has(button.id));
  }, [selectedButtonIds, skillButtons]);
  const selectedButtonBuffs = useMemo(() => (
    selectedButtons.flatMap((button) => getBuffsByButtonId(button.id))
  ), [selectedButtons, buffListVersion]);
  const buffById = useMemo(() => new Map(
    [...addModeBuffs, ...selectedButtonBuffs].map((buff) => [buff.id, buff])
  ), [addModeBuffs, selectedButtonBuffs]);
  const anomalyContextButton = selectedButtons[0] ?? skillButtons[0] ?? null;
  const selectedButtonBuffIdLists = useMemo(
    () => selectedButtons.map((button) => dedupeBuffIds(button.selectedBuff ?? [])),
    [selectedButtons]
  );
  const commonBuffIds = useMemo(() => {
    if (selectedButtonBuffIdLists.length === 0) {
      return [];
    }
    const [firstList, ...restLists] = selectedButtonBuffIdLists;
    return firstList.filter((buffId) => restLists.every((list) => list.includes(buffId)));
  }, [selectedButtonBuffIdLists]);
  const involvedBuffIds = useMemo(
    () => dedupeBuffIds(selectedButtonBuffIdLists.flat()),
    [selectedButtonBuffIdLists]
  );
  const usedNonCommonBuffIds = useMemo(
    () => involvedBuffIds.filter((buffId) => !commonBuffIds.includes(buffId)),
    [commonBuffIds, involvedBuffIds]
  );
  const unusedBuffIds = useMemo(
    () => sortedBuffs.map((buff) => buff.id).filter((buffId) => !involvedBuffIds.includes(buffId)),
    [involvedBuffIds, sortedBuffs]
  );
  const pendingAddCountByButton = useMemo(() => {
    const counts = new Map<string, number>();
    Object.values(pendingAddByBuff).forEach((buttonIds) => {
      buttonIds.forEach((buttonId) => {
        counts.set(buttonId, (counts.get(buttonId) ?? 0) + 1);
      });
    });
    return counts;
  }, [pendingAddByBuff]);
  const pendingRemoveCountByButton = useMemo(() => {
    const counts = new Map<string, number>();
    Object.values(pendingRemoveByBuff).forEach((buttonIds) => {
      buttonIds.forEach((buttonId) => {
        counts.set(buttonId, (counts.get(buttonId) ?? 0) + 1);
      });
    });
    return counts;
  }, [pendingRemoveByBuff]);
  const editAddCountByButton = useMemo(() => {
    const counts = new Map<string, number>();
    Object.values(editAddByBuff).forEach((buttonIds) => {
      buttonIds.forEach((buttonId) => counts.set(buttonId, (counts.get(buttonId) ?? 0) + 1));
    });
    return counts;
  }, [editAddByBuff]);
  const editRemoveCountByButton = useMemo(() => {
    const counts = new Map<string, number>();
    Object.values(editRemoveByBuff).forEach((buttonIds) => {
      buttonIds.forEach((buttonId) => counts.set(buttonId, (counts.get(buttonId) ?? 0) + 1));
    });
    return counts;
  }, [editRemoveByBuff]);
  const staffGroupCount = getStaffGroupCount(skillButtons);
  const canvasHeight = BUFF_EDIT_TOP_SPACER_HEIGHT + GRID_STACK_PADDING_TOP + staffGroupCount * GRID_GROUP_HEIGHT + Math.max(0, staffGroupCount - 1) * GRID_GROUP_GAP + GRID_STACK_PADDING_BOTTOM;
  const secondaryButtonLeft = useMemo(() => {
    if (layoutWidth === null || !Number.isFinite(layoutWidth)) {
      return BUFF_EDIT_SECONDARY_BUTTON_LEFT_FALLBACK;
    }
    return Math.max(
      0,
      layoutWidth - BUFF_EDIT_RIGHT_ZONE_WIDTH - BUFF_EDIT_SECONDARY_BUTTON_WIDTH - BUFF_EDIT_SECONDARY_BUTTON_GAP
    );
  }, [layoutWidth]);
  const anomalyContextBuffList = useMemo(() => {
    if (!anomalyContextButton) return [];
    return (anomalyContextButton.selectedBuff ?? [])
      .map((buffId) => buffById.get(buffId))
      .filter((buff): buff is SkillButtonBuff => Boolean(buff));
  }, [anomalyContextButton, buffById]);
  const anomalyStateWorkbench = useSkillButtonAnomaly({
    buttonId: anomalyContextButton?.id ?? '__buff-batch-edit-placeholder__',
    buttonCharacterId: anomalyContextButton?.characterId || anomalyContextButton?.characterName || '',
    buttonSkillType: anomalyContextButton?.skillType ?? 'A',
    characterName: anomalyContextButton?.characterName ?? '',
    selectedCharacters: selectedCharacters.map((character) => ({ id: character.id, name: character.name })),
    modifierBuffList: anomalyContextBuffList,
  });

  useEffect(() => {
    const measure = () => {
      const canvasElement = canvasRef.current;
      const gridStackElement = canvasElement?.querySelector('.canvas-grid-stack');
      if (!canvasElement || !gridStackElement) {
        return;
      }
      setGridContentOffsetX(getGridContentOffsetX(canvasElement, gridStackElement));
    };

    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  useEffect(() => {
    const layoutElement = layoutRef.current;
    if (!layoutElement) {
      return undefined;
    }

    const measure = () => {
      setLayoutWidth(layoutElement.getBoundingClientRect().width);
    };

    measure();

    const resizeObserver = typeof ResizeObserver === 'function'
      ? new ResizeObserver(() => {
        measure();
      })
      : null;

    resizeObserver?.observe(layoutElement);
    window.addEventListener('resize', measure);

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);

  useEffect(() => {
    setVisualButtons(readVisualSkillButtons(selectedCharacters, gridContentOffsetX));
  }, [gridContentOffsetX, selectedCharacters]);

  const toggleButton = (buttonId: string) => {
    if (toolMode === 'remove') {
      if (!activeRemoveBuffId) {
        return;
      }
      const button = skillButtons.find((item) => item.id === buttonId);
      if (!button || !button.selectedBuff?.includes(activeRemoveBuffId)) {
        return;
      }
      setPendingRemoveByBuff((current) => {
        const currentTargets = current[activeRemoveBuffId] ?? [];
        const nextTargets = currentTargets.includes(buttonId)
          ? currentTargets.filter((id) => id !== buttonId)
          : [...currentTargets, buttonId];
        return {
          ...current,
          [activeRemoveBuffId]: nextTargets,
        };
      });
      return;
    }

    if (toolMode === 'add') {
      if (!activeAddBuffId) {
        return;
      }
      const button = skillButtons.find((item) => item.id === buttonId);
      if (!button || button.selectedBuff?.includes(activeAddBuffId)) {
        return;
      }
      setPendingAddByBuff((current) => {
        const currentTargets = current[activeAddBuffId] ?? [];
        const nextTargets = currentTargets.includes(buttonId)
          ? currentTargets.filter((id) => id !== buttonId)
          : [...currentTargets, buttonId];
        return {
          ...current,
          [activeAddBuffId]: nextTargets,
        };
      });
      return;
    }

    if (toolMode !== 'normal') {
      return;
    }
    setSelectedButtonIds((current) => (
      current.includes(buttonId)
        ? current.filter((id) => id !== buttonId)
        : [...current, buttonId]
    ));
  };

  const applyFilterSelection = (buffIds: string[]) => {
    if (buffIds.length === 0) {
      setSelectedButtonIds([]);
      return;
    }
    const nextButtonIds = skillButtons
      .filter((button) => {
        const buttonBuffIds = button.selectedBuff ?? [];
        return buffIds.every((buffId) => buttonBuffIds.includes(buffId));
      })
      .map((button) => button.id);
    setSelectedButtonIds(nextButtonIds);
  };

  const toggleFilterBuff = (buffId: string) => {
    setSelectedFilterBuffIds((current) => {
      const next = current.includes(buffId)
        ? current.filter((id) => id !== buffId)
        : [...current, buffId];
      applyFilterSelection(next);
      return next;
    });
  };

  const toggleCharacterQuickSelect = (character: Character) => {
    const characterButtonIds = skillButtons
      .filter((button) => button.characterId === character.id || button.characterName === character.name)
      .map((button) => button.id);

    setPressedCharacterIds((current) => {
      const isPressed = current.includes(character.id);
      const nextPressed = isPressed
        ? current.filter((id) => id !== character.id)
        : [...current, character.id];

      setSelectedButtonIds((selectedIds) => {
        if (isPressed) {
          return selectedIds.filter((buttonId) => !characterButtonIds.includes(buttonId));
        }
        return Array.from(new Set([...selectedIds, ...characterButtonIds]));
      });

      return nextPressed;
    });
  };

  const toggleSourceFilter = (nextFilter: SourceFilter) => {
    setActiveSourceFilter((current) => (
      current?.kind === nextFilter.kind && current.id === nextFilter.id ? null : nextFilter
    ));
  };

  const handleAddCandidateSearchResult = (entry: LocalBuffSearchResult) => {
    const nextBuff = buffFromSearchResult(entry);
    addCandidateBuff(nextBuff);
    setIsCandidateAdderOpen(false);
    setCandidateSearchKeyword('');
  };

  const addCandidateBuff = (nextBuff: SkillButtonBuff) => {
    setCandidateAddBuffs((current) => {
      if (current.some((buff) => buff.id === nextBuff.id)) {
        return current;
      }
      return [...current, nextBuff];
    });
    setActiveAddBuffId(nextBuff.id);
  };

  const handleAddAnomalyStateSnapshotCandidate = (snapshot: AnomalyStateSnapshot) => {
    const nextBuff = candidateBuffFromAnomalyStateSnapshot(snapshot);
    if (!nextBuff) {
      return;
    }
    addCandidateBuff(nextBuff);
    setIsCandidateAdderOpen(false);
    setCandidateSearchKeyword('');
  };

  const handleCreateAnomalyStateCandidate = () => {
    const activeOption = anomalyStateWorkbench.activeAnomalyStateOption;
    const sourceCharacter = anomalyStateWorkbench.activeAnomalyStateSourceCharacter;
    const preview = anomalyStateWorkbench.activeAnomalyStatePreview;
    if (!activeOption || !sourceCharacter || !preview) {
      return;
    }

    const corrosionPreview = preview as typeof preview & {
      initialCorrosion?: number;
      tickCorrosionPerSecond?: number;
      maxCorrosion?: number;
      currentCorrosion?: number;
    };
    const snapshot: AnomalyStateSnapshot = {
      id: nextBatchAnomalyStateSnapshotIdRef.current++,
      key: activeOption.key,
      label: activeOption.label,
      level: anomalyStateWorkbench.activeAnomalyStateLevel,
      sourceButtonId: anomalyContextButton?.id ?? '__buff-batch-edit__',
      sourceCharacterId: sourceCharacter.id,
      sourceCharacterName: sourceCharacter.name,
      sourceSkillStrengthSnapshot: anomalyStateWorkbench.activeAnomalyStateSourceSkillBoost,
      effectValue: preview.effectValue,
      initialCorrosion: corrosionPreview.initialCorrosion,
      tickCorrosionPerSecond: corrosionPreview.tickCorrosionPerSecond,
      maxCorrosion: corrosionPreview.maxCorrosion,
      currentCorrosion: corrosionPreview.currentCorrosion,
      durationSeconds: activeOption.supportsDuration ? anomalyStateWorkbench.activeAnomalyStateDurationSeconds : undefined,
      primaryText: `${activeOption.label} Lv${anomalyStateWorkbench.activeAnomalyStateLevel} · 来源 ${sourceCharacter.name}`,
      secondaryText: preview.lines[5] ?? preview.lines[4] ?? activeOption.label,
      tertiaryText: activeOption.key === 'corrosion'
        ? `当前 ${anomalyStateWorkbench.activeAnomalyStateDurationSeconds}s`
        : activeOption.supportsDuration
          ? `持续 ${anomalyStateWorkbench.activeAnomalyStateDurationSeconds}s`
        : '快照生效',
      createdAt: Date.now(),
    };

    setBatchAnomalyStateSnapshots((current) => [...current, snapshot]);
    handleAddAnomalyStateSnapshotCandidate(snapshot);
  };

  const handleDeleteBatchAnomalyStateSnapshot = (snapshotId: number) => {
    setBatchAnomalyStateSnapshots((current) => current.filter((snapshot) => snapshot.id !== snapshotId));
    const candidateBuffId = `candidate-add-anomaly-state-snapshot-${snapshotId}`;
    setCandidateAddBuffs((current) => current.filter((buff) => buff.id !== candidateBuffId));
    setPendingAddByBuff((current) => {
      const { [candidateBuffId]: _removed, ...rest } = current;
      return rest;
    });
    setActiveAddBuffId((current) => current === candidateBuffId ? null : current);
  };

  const resetAddMode = () => {
    setActiveAddBuffId(null);
    setPendingAddByBuff({});
    setIsCandidateAdderOpen(false);
    setCandidateSearchKeyword('');
    setCandidateAdderMode('buff-group');
  };

  const resetRemoveMode = () => {
    setActiveRemoveBuffId(null);
    setPendingRemoveByBuff({});
  };

  const resetEditMode = () => {
    setEditAddByBuff({});
    setEditRemoveByBuff({});
  };

  const handleCancelAddMode = () => {
    resetAddMode();
    setIsBoxSelectArmed(false);
    setBoxSelectRect(null);
    setToolMode('normal');
  };

  const handleCancelRemoveMode = () => {
    resetRemoveMode();
    setIsBoxSelectArmed(false);
    setBoxSelectRect(null);
    setToolMode('normal');
  };

  const handleConfirmAddMode = () => {
    loadBuffsToCache();
    Object.entries(pendingAddByBuff).forEach(([buffId, buttonIds]) => {
      const buff = buffById.get(buffId);
      if (!buff) return;
      buttonIds.forEach((buttonId) => {
        const button = skillButtons.find((item) => item.id === buttonId);
        if (!button) {
          return;
        }
        addDraftBuffToButton(buttonId, buff);
      });
    });

    resetAddMode();
    setIsBoxSelectArmed(false);
    setBoxSelectRect(null);
    setSelectedButtonIds([]);
    setVisualButtons(readVisualSkillButtons(selectedCharacters, gridContentOffsetX));
    setBuffListVersion((version) => version + 1);
    setToolMode('normal');
  };

  const handleToggleAddMode = () => {
    if (toolMode === 'add') {
      handleConfirmAddMode();
      return;
    }
    setBoxSelectRect(null);
    setIsBoxSelectArmed(false);
    setActiveSourceFilter(null);
    setSelectedFilterBuffIds([]);
    setSelectedButtonIds([]);
    setCandidateAddBuffs([]);
    setIsCandidateAdderOpen(false);
    setCandidateSearchKeyword('');
    setCandidateAdderMode('buff-group');
    resetAddMode();
    resetRemoveMode();
    resetEditMode();
    setToolMode('add');
  };

  const handleConfirmRemoveMode = () => {
    loadBuffsToCache();
    Object.entries(pendingRemoveByBuff).forEach(([buffId, buttonIds]) => {
      buttonIds.forEach((buttonId) => {
        const button = skillButtons.find((item) => item.id === buttonId);
        if (!button || !button.selectedBuff?.includes(buffId)) {
          return;
        }
        decrementBuffStackOnButton(buttonId, buffId);
      });
    });

    resetRemoveMode();
    setIsBoxSelectArmed(false);
    setBoxSelectRect(null);
    setSelectedButtonIds([]);
    setVisualButtons(readVisualSkillButtons(selectedCharacters, gridContentOffsetX));
    setBuffListVersion((version) => version + 1);
    setToolMode('normal');
  };

  const handleCancelEditMode = () => {
    resetEditMode();
    setIsBoxSelectArmed(false);
    setBoxSelectRect(null);
    setToolMode('normal');
  };

  const handleConfirmEditMode = () => {
    loadBuffsToCache();
    Object.entries(editRemoveByBuff).forEach(([buffId, buttonIds]) => {
      buttonIds.forEach((buttonId) => {
        const button = skillButtons.find((item) => item.id === buttonId);
        if (button?.selectedBuff?.includes(buffId)) {
          removeBuffFromButton(buttonId, buffId);
        }
      });
    });

    Object.entries(editAddByBuff).forEach(([buffId, buttonIds]) => {
      const buff = buffById.get(buffId);
      if (!buff) return;
      buttonIds.forEach((buttonId) => {
        const button = skillButtons.find((item) => item.id === buttonId);
        if (button) {
          addDraftBuffToButton(buttonId, buff);
        }
      });
    });

    resetEditMode();
    setIsBoxSelectArmed(false);
    setBoxSelectRect(null);
    setSelectedButtonIds([]);
    setVisualButtons(readVisualSkillButtons(selectedCharacters, gridContentOffsetX));
    setBuffListVersion((version) => version + 1);
    setToolMode('normal');
  };

  const toggleEditRemoveBuff = (buffId: string) => {
    const targetIds = selectedButtons
      .filter((button) => button.selectedBuff?.includes(buffId))
      .map((button) => button.id);
    setEditRemoveByBuff((current) => {
      const currentTargets = current[buffId] ?? [];
      const isActive = targetIds.length > 0 && targetIds.every((id) => currentTargets.includes(id));
      return {
        ...current,
        [buffId]: isActive ? [] : targetIds,
      };
    });
  };

  const toggleEditAddBuff = (buffId: string) => {
    const targetIds = selectedButtons
      .filter((button) => !button.selectedBuff?.includes(buffId))
      .map((button) => button.id);
    setEditAddByBuff((current) => {
      const currentTargets = current[buffId] ?? [];
      const isActive = targetIds.length > 0 && targetIds.every((id) => currentTargets.includes(id));
      return {
        ...current,
        [buffId]: isActive ? [] : targetIds,
      };
    });
  };

  const handleToggleRemoveMode = () => {
    if (toolMode === 'remove') {
      handleConfirmRemoveMode();
      return;
    }
    setBoxSelectRect(null);
    setIsBoxSelectArmed(false);
    setActiveSourceFilter(null);
    setSelectedFilterBuffIds([]);
    setSelectedButtonIds([]);
    resetAddMode();
    resetRemoveMode();
    resetEditMode();
    setToolMode('remove');
  };

  const handleToggleFilterMode = () => {
    setBoxSelectRect(null);
    setIsBoxSelectArmed(false);
    setActiveSourceFilter(null);
    resetAddMode();
    resetRemoveMode();
    resetEditMode();
    setToolMode((current) => {
      const nextMode = current === 'filter' ? 'normal' : 'filter';
      if (nextMode === 'filter') {
        applyFilterSelection(selectedFilterBuffIds);
      }
      return nextMode;
    });
  };

  const handleToggleEditMode = () => {
    if (toolMode === 'edit') {
      handleConfirmEditMode();
      return;
    }
    setBoxSelectRect(null);
    setIsBoxSelectArmed(false);
    setActiveSourceFilter(null);
    resetAddMode();
    resetRemoveMode();
    resetEditMode();
    setToolMode('edit');
  };

  useEffect(() => {
    if (toolMode === 'normal') {
      return undefined;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && isCandidateAdderOpen) {
        event.preventDefault();
        setIsCandidateAdderOpen(false);
        setCandidateSearchKeyword('');
        return;
      }

      if (event.key === 'Escape') {
        event.preventDefault();
        if (toolMode === 'add') {
          handleCancelAddMode();
          return;
        }
        if (toolMode === 'remove') {
          handleCancelRemoveMode();
          return;
        }
        if (toolMode === 'edit') {
          handleCancelEditMode();
          return;
        }
        if (toolMode === 'filter') {
          setBoxSelectRect(null);
          setIsBoxSelectArmed(false);
          setToolMode('normal');
        }
        return;
      }

      if (toolMode !== 'add') {
        return;
      }

      if (event.key === 'Tab' && !event.shiftKey && isCandidateAdderOpen) {
        event.preventDefault();
        setCandidateAdderMode((current) => getNextCandidateAdderMode(current));
        setCandidateSearchKeyword('');
        return;
      }

      const target = event.target as HTMLElement | null;
      const isEditable =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        !!target?.closest('[contenteditable="true"]');

      if (event.key === 'Tab' && !event.shiftKey && !isEditable) {
        event.preventDefault();
        setIsCandidateAdderOpen(true);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isCandidateAdderOpen, toolMode]);

  useEffect(() => {
    if (!isCandidateAdderOpen) {
      return undefined;
    }
    refreshSelectedCharacters()
      .then(async (refreshedCharacters) => {
        const charactersForRefresh = refreshedCharacters.length > 0 ? refreshedCharacters : state.selectedCharacters;
        const characterIdsForRefresh = Array.from(new Set([
          ...selectedCharacters.map((character) => character.id).filter((id): id is string => Boolean(id)),
          ...charactersForRefresh.map((character) => character.id).filter((id): id is string => Boolean(id)),
        ]));
        await refreshOperatorConfigSnapshotsForCharacters(charactersForRefresh);
        return refreshSnapshotCandidateBuffsForCharacterIds(characterIdsForRefresh);
      })
      .then(() => setCandidateBuffRefreshToken((token) => token + 1))
      .catch((error) => console.error('刷新批量 Buff 候选列表失败:', error));
    const timer = window.setTimeout(() => {
      candidateSearchInputRef.current?.focus();
      candidateSearchInputRef.current?.select();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [candidateAdderMode, isCandidateAdderOpen, refreshSelectedCharacters, selectedCharacters, state.selectedCharacters]);

  const getCanvasPoint = (event: ReactMouseEvent | MouseEvent) => {
    const canvasElement = canvasRef.current;
    if (!canvasElement) {
      return null;
    }
    const rect = canvasElement.getBoundingClientRect();
    return {
      x: event.clientX - rect.left + canvasElement.scrollLeft,
      y: event.clientY - rect.top + canvasElement.scrollTop,
    };
  };

  const toggleAddTargetsInRect = (rect: BoxSelectRect) => {
    const normalizedRect = normalizeRect(rect);
    if (toolMode === 'add' && activeAddBuffId) {
      const hitIds = skillButtons
        .filter((button) => {
          if (button.selectedBuff?.includes(activeAddBuffId)) {
            return false;
          }
          const position = buildButtonPosition(button);
          const buttonRect = {
            left: position.x - SKILL_BUTTON_RADIUS - SKILL_BUTTON_VISUAL_OFFSET_X,
            top: position.y - SKILL_BUTTON_RADIUS - SKILL_BUTTON_VISUAL_OFFSET_Y,
            right: position.x - SKILL_BUTTON_RADIUS - SKILL_BUTTON_VISUAL_OFFSET_X + SKILL_BUTTON_HIT_WIDTH,
            bottom: position.y - SKILL_BUTTON_RADIUS - SKILL_BUTTON_VISUAL_OFFSET_Y + SKILL_BUTTON_HIT_HEIGHT,
          };
          return intersects(normalizedRect, buttonRect);
        })
        .map((button) => button.id);

      setPendingAddByBuff((current) => {
        const currentTargets = current[activeAddBuffId] ?? [];
        const hitSet = new Set(hitIds);
        const shouldRemove = hitIds.some((id) => currentTargets.includes(id));
        return {
          ...current,
          [activeAddBuffId]: shouldRemove
            ? currentTargets.filter((id) => !hitSet.has(id))
            : Array.from(new Set([...currentTargets, ...hitIds])),
        };
      });
      return;
    }

    if (toolMode === 'remove' && activeRemoveBuffId) {
      const hitIds = skillButtons
        .filter((button) => {
          if (!button.selectedBuff?.includes(activeRemoveBuffId)) {
            return false;
          }
          const position = buildButtonPosition(button);
          const buttonRect = {
            left: position.x - SKILL_BUTTON_RADIUS - SKILL_BUTTON_VISUAL_OFFSET_X,
            top: position.y - SKILL_BUTTON_RADIUS - SKILL_BUTTON_VISUAL_OFFSET_Y,
            right: position.x - SKILL_BUTTON_RADIUS - SKILL_BUTTON_VISUAL_OFFSET_X + SKILL_BUTTON_HIT_WIDTH,
            bottom: position.y - SKILL_BUTTON_RADIUS - SKILL_BUTTON_VISUAL_OFFSET_Y + SKILL_BUTTON_HIT_HEIGHT,
          };
          return intersects(normalizedRect, buttonRect);
        })
        .map((button) => button.id);

      setPendingRemoveByBuff((current) => {
        const currentTargets = current[activeRemoveBuffId] ?? [];
        const hitSet = new Set(hitIds);
        const shouldRemove = hitIds.some((id) => currentTargets.includes(id));
        return {
          ...current,
          [activeRemoveBuffId]: shouldRemove
            ? currentTargets.filter((id) => !hitSet.has(id))
            : Array.from(new Set([...currentTargets, ...hitIds])),
        };
      });
      return;
    }

    const hitIds = skillButtons
      .filter((button) => {
        const position = buildButtonPosition(button);
        const buttonRect = {
          left: position.x - SKILL_BUTTON_RADIUS - SKILL_BUTTON_VISUAL_OFFSET_X,
          top: position.y - SKILL_BUTTON_RADIUS - SKILL_BUTTON_VISUAL_OFFSET_Y,
          right: position.x - SKILL_BUTTON_RADIUS - SKILL_BUTTON_VISUAL_OFFSET_X + SKILL_BUTTON_HIT_WIDTH,
          bottom: position.y - SKILL_BUTTON_RADIUS - SKILL_BUTTON_VISUAL_OFFSET_Y + SKILL_BUTTON_HIT_HEIGHT,
        };
        return intersects(normalizedRect, buttonRect);
      })
      .map((button) => button.id);
    setSelectedButtonIds((current) => {
      const hitSet = new Set(hitIds);
      const shouldRemove = hitIds.some((id) => current.includes(id));
      return shouldRemove
        ? current.filter((id) => !hitSet.has(id))
        : Array.from(new Set([...current, ...hitIds]));
    });
  };

  const handleBoxSelectMouseDown = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (!['normal', 'add', 'remove'].includes(toolMode) || !isBoxSelectArmed || event.button !== 0) {
      return;
    }
    event.preventDefault();
    const point = getCanvasPoint(event);
    if (!point) {
      return;
    }
    setBoxSelectRect({
      startX: point.x,
      startY: point.y,
      currentX: point.x,
      currentY: point.y,
    });
  };

  useEffect(() => {
    if (!boxSelectRect) {
      return undefined;
    }

    const handleMouseMove = (event: MouseEvent) => {
      const point = getCanvasPoint(event);
      if (!point) {
        return;
      }
      setBoxSelectRect((current) => current ? {
        ...current,
        currentX: point.x,
        currentY: point.y,
      } : current);
    };

    const handleMouseUp = () => {
      toggleAddTargetsInRect(boxSelectRect);
      setBoxSelectRect(null);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [boxSelectRect, skillButtons]);

  const normalizedBoxSelectRect = boxSelectRect ? normalizeRect(boxSelectRect) : null;

  return {
    layout: {
      boxSelectRect,
      canvasHeight,
      canvasRef,
      handleBoxSelectMouseDown,
      isBoxSelectArmed,
      layoutRef,
      normalizedBoxSelectRect,
      secondaryButtonLeft,
      setBoxSelectRect,
      setIsBoxSelectArmed,
      staffGroupCount,
    },
    buttons: {
      characterById,
      editAddCountByButton,
      editRemoveCountByButton,
      pendingAddCountByButton,
      pendingRemoveCountByButton,
      pressedCharacterIds,
      selectedButtonIds,
      selectedButtons,
      setSelectedButtonIds,
      skillButtons,
      toggleButton,
      toggleCharacterQuickSelect,
    },
    filters: {
      activeSourceFilter,
      selectedFilterBuffIds,
      toggleFilterBuff,
      toggleSourceFilter,
      visibleFilterBuffs,
      weaponButtonItems,
    },
    modes: {
      activeAddBuffId,
      activeRemoveBuffId,
      commonBuffIds,
      editAddByBuff,
      editRemoveByBuff,
      handleCancelAddMode,
      handleCancelEditMode,
      handleCancelRemoveMode,
      handleToggleAddMode,
      handleToggleEditMode,
      handleToggleFilterMode,
      handleToggleRemoveMode,
      pendingAddByBuff,
      pendingRemoveByBuff,
      setActiveAddBuffId,
      setActiveRemoveBuffId,
      toolMode,
      toggleEditAddBuff,
      toggleEditRemoveBuff,
      unusedBuffIds,
      usedNonCommonBuffIds,
    },
    candidate: {
      anomalyStateWorkbench,
      batchAnomalyStateSnapshots,
      candidateAddBuffs,
      candidateAdderMode,
      candidateSearchInputRef,
      candidateSearchKeyword,
      candidateSearchResults,
      handleAddAnomalyStateSnapshotCandidate,
      handleAddCandidateSearchResult,
      handleCreateAnomalyStateCandidate,
      handleDeleteBatchAnomalyStateSnapshot,
      isCandidateAdderOpen,
      setCandidateAdderMode,
      setCandidateSearchKeyword,
      setIsCandidateAdderOpen,
    },
    catalog: {
      buffById,
    },
  };
}
