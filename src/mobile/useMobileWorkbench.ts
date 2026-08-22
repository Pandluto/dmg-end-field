import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Character } from '../types';
import {
  createDefaultMobileOperatorConfig,
  createEmptyMobileSlot,
  normalizeMobileDraft,
  readMobileDraft,
  writeMobileDraft,
} from './mobileDraft';
import type {
  MobileCatalog,
  MobileDraft,
  MobileOperatorConfig,
  MobilePageId,
  MobileRuntimeState,
  MobileTimelineAction,
} from './model';
import { buildMobileRuntimeState } from './mobileRuntime';

const EMPTY_RUNTIME: MobileRuntimeState = {
  operatorSnapshots: {},
  slotCalculations: {},
  availableBuffs: [],
  report: {
    totalExpected: 0,
    totalCrit: 0,
    totalNonCrit: 0,
    slotCount: 0,
    byOperator: [],
    bySkill: [],
  },
};

function findCharacter(catalog: MobileCatalog, characterId: string): Character | null {
  return catalog.characters.find((character) => character.id === characterId) ?? null;
}

function reconcileDraftWithCatalog(draft: MobileDraft, catalog: MobileCatalog): MobileDraft {
  const availableIds = new Set(catalog.characters.map((character) => character.id));
  const selectedOperatorIds = draft.selectedOperatorIds
    .filter((operatorId) => availableIds.has(operatorId))
    .slice(0, 4);
  const selectedSet = new Set(selectedOperatorIds);
  let operatorConfigs = draft.operatorConfigs;
  selectedOperatorIds.forEach((operatorId) => {
    if (operatorConfigs[operatorId]) return;
    const character = findCharacter(catalog, operatorId);
    if (character) {
      if (operatorConfigs === draft.operatorConfigs) operatorConfigs = { ...draft.operatorConfigs };
      operatorConfigs[operatorId] = createDefaultMobileOperatorConfig(character);
    }
  });
  const slots = draft.slots.map((slot) => (
    slot.action && !selectedSet.has(slot.action.operatorId)
      ? { ...slot, action: null }
      : slot
  ));
  const activeOperatorId = selectedSet.has(draft.activeOperatorId)
    ? draft.activeOperatorId
    : selectedOperatorIds[0] || '';
  if (
    selectedOperatorIds.join('|') === draft.selectedOperatorIds.join('|')
    && operatorConfigs === draft.operatorConfigs
    && slots.every((slot, index) => slot === draft.slots[index])
    && activeOperatorId === draft.activeOperatorId
  ) {
    return draft;
  }
  return {
    ...draft,
    selectedOperatorIds,
    operatorConfigs,
    slots,
    activeOperatorId,
    updatedAt: Date.now(),
  };
}

export function useMobileWorkbench(catalog: MobileCatalog) {
  const [draft, setDraft] = useState<MobileDraft>(() => readMobileDraft());
  const [interactionLocked, setInteractionLocked] = useState(false);

  useEffect(() => {
    setDraft((current) => reconcileDraftWithCatalog(current, catalog));
  }, [catalog]);

  useEffect(() => {
    writeMobileDraft(draft);
  }, [draft]);

  const runtimeResult = useMemo(() => {
    try {
      return { state: buildMobileRuntimeState(draft, catalog), error: '' };
    } catch (error) {
      return {
        state: EMPTY_RUNTIME,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }, [catalog, draft]);

  const setActivePage = useCallback((activePage: MobilePageId) => {
    setDraft((current) => ({ ...current, activePage, updatedAt: Date.now() }));
  }, []);

  const restoreDraft = useCallback((snapshot: MobileDraft) => {
    const restored = reconcileDraftWithCatalog(normalizeMobileDraft(snapshot), catalog);
    setDraft({ ...restored, updatedAt: Date.now() });
  }, [catalog]);

  const setSelection = useCallback((operatorIds: string[]) => {
    setDraft((current) => {
      const availableIds = new Set(catalog.characters.map((character) => character.id));
      const selectedOperatorIds = operatorIds
        .filter((operatorId) => availableIds.has(operatorId))
        .filter((operatorId, index, ids) => ids.indexOf(operatorId) === index)
        .slice(0, 4);
      const selectedSet = new Set(selectedOperatorIds);
      const operatorConfigs = { ...current.operatorConfigs };
      selectedOperatorIds.forEach((operatorId) => {
        if (operatorConfigs[operatorId]) return;
        const character = findCharacter(catalog, operatorId);
        if (character) operatorConfigs[operatorId] = createDefaultMobileOperatorConfig(character);
      });
      return {
        ...current,
        selectedOperatorIds,
        operatorConfigs,
        slots: current.slots.map((slot) => (
          slot.action && !selectedSet.has(slot.action.operatorId)
            ? { ...slot, action: null }
            : slot
        )),
        activeOperatorId: selectedSet.has(current.activeOperatorId)
          ? current.activeOperatorId
          : selectedOperatorIds[0] || '',
        updatedAt: Date.now(),
      };
    });
  }, [catalog]);

  const setActiveOperatorId = useCallback((activeOperatorId: string) => {
    setDraft((current) => current.selectedOperatorIds.includes(activeOperatorId)
      ? { ...current, activeOperatorId, updatedAt: Date.now() }
      : current);
  }, []);

  const updateOperatorConfig = useCallback((
    operatorId: string,
    updater: MobileOperatorConfig | ((current: MobileOperatorConfig) => MobileOperatorConfig),
  ) => {
    setDraft((current) => {
      const existing = current.operatorConfigs[operatorId];
      if (!existing) return current;
      const nextConfig = typeof updater === 'function' ? updater(existing) : updater;
      return {
        ...current,
        operatorConfigs: { ...current.operatorConfigs, [operatorId]: nextConfig },
        updatedAt: Date.now(),
      };
    });
  }, []);

  const addSlot = useCallback(() => {
    setDraft((current) => ({
      ...current,
      slots: [...current.slots, createEmptyMobileSlot()],
      updatedAt: Date.now(),
    }));
  }, []);

  const setSlotAction = useCallback((slotId: string, action: MobileTimelineAction) => {
    setDraft((current) => ({
      ...current,
      slots: current.slots.map((slot) => slot.id === slotId ? { ...slot, action } : slot),
      updatedAt: Date.now(),
    }));
  }, []);

  const deleteSlotAction = useCallback((slotId: string) => {
    setDraft((current) => ({
      ...current,
      slots: current.slots.map((slot) => slot.id === slotId ? { ...slot, action: null } : slot),
      updatedAt: Date.now(),
    }));
  }, []);

  const updateSlotAction = useCallback((
    slotId: string,
    updater: MobileTimelineAction | ((current: MobileTimelineAction) => MobileTimelineAction),
  ) => {
    setDraft((current) => ({
      ...current,
      slots: current.slots.map((slot) => {
        if (slot.id !== slotId || !slot.action) return slot;
        return {
          ...slot,
          action: typeof updater === 'function' ? updater(slot.action) : updater,
        };
      }),
      updatedAt: Date.now(),
    }));
  }, []);

  const moveSlotAction = useCallback((sourceSlotId: string, targetSlotId: string) => {
    if (sourceSlotId === targetSlotId) return;
    setDraft((current) => {
      const sourceIndex = current.slots.findIndex((slot) => slot.id === sourceSlotId);
      const targetIndex = current.slots.findIndex((slot) => slot.id === targetSlotId);
      const sourceAction = current.slots[sourceIndex]?.action;
      if (sourceIndex < 0 || targetIndex < 0 || !sourceAction) return current;

      const slots = current.slots.map((slot) => ({ ...slot }));
      slots[sourceIndex].action = null;
      if (!slots[targetIndex].action) {
        slots[targetIndex].action = sourceAction;
      } else {
        let emptyIndex = slots.findIndex((slot, index) => index > targetIndex && !slot.action);
        if (emptyIndex < 0) {
          slots.push(createEmptyMobileSlot());
          emptyIndex = slots.length - 1;
        }
        for (let index = emptyIndex; index > targetIndex; index -= 1) {
          slots[index].action = slots[index - 1].action;
        }
        slots[targetIndex].action = sourceAction;
      }
      return { ...current, slots, updatedAt: Date.now() };
    });
  }, []);

  const setReportNotes = useCallback((reportNotes: Record<string, string>) => {
    setDraft((current) => ({
      ...current,
      reportNotes,
      updatedAt: Date.now(),
    }));
  }, []);

  return {
    draft,
    runtime: runtimeResult.state,
    runtimeError: runtimeResult.error,
    interactionLocked,
    setInteractionLocked,
    restoreDraft,
    setActivePage,
    setSelection,
    setActiveOperatorId,
    updateOperatorConfig,
    addSlot,
    setSlotAction,
    deleteSlotAction,
    updateSlotAction,
    moveSlotAction,
    setReportNotes,
  };
}
