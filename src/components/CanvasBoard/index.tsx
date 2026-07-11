import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useAppContext } from '../../context/AppContext';
import { SkillSandbox } from './SkillSandbox';
import { MainWorkbenchAiPanel } from './MainWorkbenchAiPanel';
import { WorkNodeTreePanel } from './WorkNodeTreePanel';
import { useCanvasWidth } from './hooks/useCanvasWidth';
import { useSelectStart } from './hooks/useSelectStart';
import { useCanvasDrag } from './hooks/useCanvasDrag';
import { useTimelineData } from '../../hooks/useTimelineData';
import { CanvasArea } from './components/CanvasArea';
import { ToolPanel } from '../ToolPanel';
import { ReportTab } from '../ToolPanel/components/ReportTab';
import { DraggingOverlay } from './components/DraggingOverlay';
import { Toolbar } from './components/Toolbar';
import {
  Character,
  SandboxSkill,
  SkillButton,
  SkillButtonType,
  SkillButtonSkillChangePayload,
  SkillButtonSkillOption,
  TimelineData,
} from '../../types';
import { resolveSkillIconUrl } from '../../utils/assetResolver';
import { emitSkillButtonBuffAdded, onSkillButtonBuffAdded, onSkillButtonBuffRemoved } from '../../core/events/buffEvents';
import { generateId } from '../../utils/helpers';
import { calculateNodeNumber } from '../../utils/nodeNumbering';
import { SKILL_BUTTON_BASELINE_OFFSET_Y } from '../../constants/canvas-layout';
import {
  clampGridNodeIndex,
  clientToGridCoords,
  findNearestStaffIndex,
  getGridContentOffsetX,
  getGridGroupTop,
  getGridLineCenterY,
  getGridNodeCenterX,
  getOccupiedNodeIndicesForLine,
  gridToCanvasContentCoords,
  GRID_NODE_COUNT,
  resolveSnappedGridNode,
} from '../../core/calculators/gridSnapLayout';
import {
  getSkillButtonById,
  getSkillButtonTable,
  saveTimelineData as saveTimelineRepo,
  setSkillButtonTable,
  upsertSkillButton,
} from '../../core/repositories';
import {
  addBuffToButton,
  attachExistingBuffsToButton,
  getBuffsByButtonId,
  recomputeSkillButtonPanel,
  removeBuffFromButton,
} from '../../core/services/buffService';
import { refreshAvailableCandidateBuffsForCharacters } from '../../core/services/operatorConfigCandidateBuffService';
import {
  applyOperatorEquipmentSelectionsToSnapshot,
  refreshOperatorConfigSnapshotsForCharacters,
} from '../../core/services/operatorConfigSnapshotRefreshService';
import { APP_ROUTE_PATHS, navigateToAppPath } from '../../utils/appRoute';
import { STORAGE_KEYS } from '../../constants/storage-keys';
import {
  getOperatorConfigPageCache,
  getRuntimeOperatorTemplateById,
  safeSessionStorage,
  setOperatorConfigPageCache,
  setSelectedCharacterIds,
} from '../../utils/storage';
import {
  applyTimelineSnapshotPayload,
  buildTimelineBundleV2,
  buildTimelineShareFileName,
  clearLegacyTimelineSnapshotArchive,
  createTimelineSnapshotEntry,
  getCurrentTimelineSnapshotPayload,
  listTimelineSnapshots,
  parseTimelineShareFile,
  parseTimelineBundleV2,
  type TimelineSnapshotEntry,
  type TimelineSnapshotPayload,
  type TimelineBundleV2,
  type TimelineShareFile,
} from '../../utils/timelineSnapshotStorage';
import './CanvasBoard.css';
import { resolveRuntimeTemplateSkill } from '../../core/services/skillDamageTemplateResolver';
import { buildDamageReportSnapshot } from '../../core/services/damageReportService';
import type { PersistedSkillButton } from '../../types/storage';
import type { HitResistanceInput } from '../../types/storage';
import DeferredNumberInput from '../DeferredNumberInput';
import {
  getPendingMainWorkbenchCommands,
  enqueueMainWorkbenchCommand,
  patchMainWorkbenchCommand,
  pullRemoteMainWorkbenchCommands,
  pushMainWorkbenchCommandResult,
  pushMainWorkbenchSnapshot,
  readMainWorkbenchSnapshot,
  writeMainWorkbenchSnapshot,
  type MainWorkbenchCommand,
  type MainWorkbenchSnapshot,
} from '../../utils/mainWorkbenchControl';
import {
  createAiTimelineWorkNodeClient,
  diffTimelinePayloads,
  applyTimelineWorkNodePatch,
  validateTimelinePayload,
} from '../../agentKernel/timelineWorktree';
import { buildAiTimelineCheckoutDecision } from '../../agentKernel/timelineWorktree/checkoutDecision.mjs';
import { DEFAULT_TIMELINE_ID } from '../../core/domain/timeline';
import { createTimelineRepositoryClient } from '../../agentKernel/timelineRepository/localTimelineClient';
import type { TimelineRepositoryBundleWorkNode } from '../../agentKernel/timelineRepository/localTimelineClient';

const EMPTY_BATCH_TARGET_RESISTANCE: Required<HitResistanceInput> = {
  physicalResistance: 0,
  fireResistance: 0,
  electricResistance: 0,
  iceResistance: 0,
  natureResistance: 0,
};

const REFRESH_AVAILABLE_CANDIDATES_MIN_SPIN_MS = 920;

const BATCH_RESISTANCE_FIELDS: Array<[keyof HitResistanceInput, string]> = [
  ['physicalResistance', '物理'],
  ['fireResistance', '灼热'],
  ['electricResistance', '电磁'],
  ['iceResistance', '寒冷'],
  ['natureResistance', '自然'],
];

type PatchAiTimelineWorkNodeCommandResult =
  | {
      ok: true;
      nodeId: string;
      dryRun: boolean;
      operationsApplied: number;
      diff: unknown;
      diffSummary?: string;
      changedButtons?: ReturnType<typeof summarizeTimelineChangedButtons>;
      currentCheckoutTouched?: false;
      riskFlags: unknown[];
      summary: string[];
      status?: string;
      checkoutDecision?: unknown;
      path?: string;
    }
  | {
      ok: false;
      nodeId: string;
      dryRun: boolean;
      issues: Array<{ code: string; message: string; path?: string }>;
      riskFlags: unknown[];
    };

function formatTimelineDiffSummary(diff: ReturnType<typeof diffTimelinePayloads>) {
  const summary = diff.summary;
  const parts: string[] = [];
  if (summary.addedButtonCount) parts.push(`added ${summary.addedButtonCount} button(s)`);
  if (summary.removedButtonCount) parts.push(`removed ${summary.removedButtonCount} button(s)`);
  if (summary.changedButtonCount) parts.push(`changed ${summary.changedButtonCount} button(s)`);
  if (summary.addedBuffCount) parts.push(`added ${summary.addedBuffCount} buff(s)`);
  if (summary.removedBuffCount) parts.push(`removed ${summary.removedBuffCount} buff(s)`);
  if (diff.selectedCharactersChanged) parts.push('selected characters changed');
  return parts.length ? parts.join('; ') : 'no diff';
}

function summarizeTimelineChangedButtons(diff: ReturnType<typeof diffTimelinePayloads>) {
  return [
    ...diff.addedButtons.map((button) => ({
      kind: 'added' as const,
      buttonId: button.id,
      label: button.label,
      after: button,
    })),
    ...diff.removedButtons.map((button) => ({
      kind: 'removed' as const,
      buttonId: button.id,
      label: button.label,
      before: button,
    })),
    ...diff.changedButtons.map((change) => ({
      kind: 'changed' as const,
      buttonId: change.id,
      beforeLabel: change.before.label,
      afterLabel: change.after.label,
      changes: change.changes,
    })),
  ];
}

function buildTimelineButtonTargets(payload: NonNullable<ReturnType<typeof getCurrentTimelineSnapshotPayload>>) {
  return Object.values(payload.skillButtonTable || {})
    .map((button) => ({
      buttonId: button.id,
      label: `${button.characterName}-${button.skillDisplayName || button.skillType}@${button.staffIndex + 1}-${(button.nodeIndex ?? 0) + 1}`,
      characterName: button.characterName,
      skillType: button.skillType,
      skillDisplayName: button.skillDisplayName,
      staffIndex: button.staffIndex,
      nodeIndex: button.nodeIndex,
    }))
    .sort((left, right) => (left.staffIndex - right.staffIndex) || (left.nodeIndex - right.nodeIndex) || left.label.localeCompare(right.label));
}

function buildMainWorkbenchSnapshotSignature(
  selectedCharacters: MainWorkbenchSnapshot['selectedCharacters'],
  skillButtons: MainWorkbenchSnapshot['skillButtons'],
  operatorConfigs: MainWorkbenchSnapshot['operatorConfigs'] = [],
): string {
  return JSON.stringify({
    selectedCharacters: selectedCharacters.map((character) => ({
      id: character.id,
      name: character.name,
    })),
    skillButtons: [...skillButtons]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((button) => ({
        id: button.id,
        characterId: button.characterId,
        characterName: button.characterName,
        skillType: button.skillType,
        runtimeSkillId: button.runtimeSkillId,
        skillDisplayName: button.skillDisplayName,
        staffIndex: button.staffIndex,
        lineIndex: button.lineIndex,
        nodeIndex: button.nodeIndex,
        nodeNumber: button.nodeNumber,
        selectedBuffIds: [...button.selectedBuffIds].sort(),
      })),
    operatorConfigs: [...operatorConfigs]
      .sort((a, b) => a.characterId.localeCompare(b.characterId))
      .map((config) => ({
        characterId: config.characterId,
        characterName: config.characterName,
        weapon: config.weapon
          ? {
              id: config.weapon.id,
              name: config.weapon.name,
              level: config.weapon.level,
              potential: config.weapon.potential,
              attack: config.weapon.attack,
            }
          : null,
        equipment: [...config.equipment]
          .sort((a, b) => a.slotKey.localeCompare(b.slotKey))
          .map((piece) => ({
            slotKey: piece.slotKey,
            equipmentId: piece.equipmentId,
            name: piece.name,
            part: piece.part,
            effects: [...piece.effects]
              .sort((a, b) => a.effectId.localeCompare(b.effectId))
              .map((effect) => ({
                effectId: effect.effectId,
                typeKey: effect.typeKey,
                level: effect.level,
                value: effect.value,
              })),
          })),
      })),
  });
}

function clonePersistedSkillButtonConfig(button: PersistedSkillButton): Pick<
  PersistedSkillButton,
  'selectedBuff' | 'buffStackCounts' | 'anomalyConfig' | 'resistanceConfig' | 'panelConfig' | 'runtimeSnapshot'
> {
  return {
    selectedBuff: [...(button.selectedBuff ?? [])],
    buffStackCounts: { ...(button.buffStackCounts ?? {}) },
    anomalyConfig: button.anomalyConfig
      ? {
          selectedStatuses: button.anomalyConfig.selectedStatuses.map((card) => ({
            ...card,
            selectedBuffIds: [...card.selectedBuffIds],
          })),
          selectedDamages: button.anomalyConfig.selectedDamages.map((card) => ({
            ...card,
            selectedBuffIds: [...card.selectedBuffIds],
          })),
          selectedStateSnapshotIds: [...button.anomalyConfig.selectedStateSnapshotIds],
        }
      : undefined,
    resistanceConfig: button.resistanceConfig
      ? {
          targetResistance: { ...button.resistanceConfig.targetResistance },
        }
      : undefined,
    panelConfig: button.panelConfig
      ? {
          ...button.panelConfig,
          selectedBuff: [...button.panelConfig.selectedBuff],
          globallyDisabledBuffIds: [...(button.panelConfig.globallyDisabledBuffIds ?? [])],
          manualDisabledBuffIdsBySegmentKey: Object.fromEntries(
            Object.entries(button.panelConfig.manualDisabledBuffIdsBySegmentKey ?? {}).map(([segmentKey, buffIds]) => [
              segmentKey,
              [...buffIds],
            ])
          ),
          manualBuffStackCountsBySegmentKey: Object.fromEntries(
            Object.entries(button.panelConfig.manualBuffStackCountsBySegmentKey ?? {}).map(([segmentKey, stackCounts]) => [
              segmentKey,
              { ...stackCounts },
            ])
          ),
          manualDisabledHitKeys: [...(button.panelConfig.manualDisabledHitKeys ?? [])],
        }
      : undefined,
    runtimeSnapshot: button.runtimeSnapshot
      ? {
          ...button.runtimeSnapshot,
          characterComputed: button.runtimeSnapshot.characterComputed
            ? {
                ...button.runtimeSnapshot.characterComputed,
                panel: { ...button.runtimeSnapshot.characterComputed.panel },
                damageBonus: { ...button.runtimeSnapshot.characterComputed.damageBonus },
              }
            : button.runtimeSnapshot.characterComputed,
        }
      : null,
  };
}

function formatPreciseTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  const hours = `${date.getHours()}`.padStart(2, '0');
  const minutes = `${date.getMinutes()}`.padStart(2, '0');
  const seconds = `${date.getSeconds()}`.padStart(2, '0');
  const milliseconds = `${date.getMilliseconds()}`.padStart(3, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}.${milliseconds}`;
}

function buildSnapshotBuffPreview(snapshot: TimelineSnapshotEntry): string[] {
  const buffNames = snapshot.payload.allBuffList
    .map((buff) => buff.displayName?.trim() || buff.name?.trim() || buff.id)
    .filter((name, index, array) => Boolean(name) && array.indexOf(name) === index);

  if (buffNames.length === 0) {
    return ['无 Buff'];
  }

  const previewLimit = 8;
  const preview = buffNames.slice(0, previewLimit);
  if (buffNames.length > previewLimit) {
    preview.push(`... 其余 ${buffNames.length - previewLimit} 项`);
  }
  return preview;
}

function buildSandboxSkillsFromRuntimeTemplate(characterId: string): SandboxSkill[] {
  const template = getRuntimeOperatorTemplateById(characterId);
  if (!template) {
    return [];
  }

  return template.skills.map((skill) => ({
    id: skill.id,
    displayName: skill.displayName,
    buttonType: skill.buttonType,
    iconUrl: skill.iconUrl,
    hitCount: skill.hitCount,
    source: template.source,
    customHits: skill.hits.map((hit) => ({
      key: hit.key,
      displayName: hit.displayName,
      multiplier: hit.multiplier,
      element: hit.element,
      skillType: hit.skillType,
    })),
  }));
}

interface CanvasBoardProps {
  activeSkillButtonId?: string | null;
  workbenchMode?: 'selection' | 'timeline' | 'toolPanel';
  isToolPanelVisible?: boolean;
  isWorkbenchTopZoneOpen?: boolean;
  onWorkbenchTopZoneOpenChange?: (open: boolean) => void;
  onSkillButtonModalOpen?: () => void;
  onSkillButtonModalClose?: () => void;
  onOpenOperatorConfig?: (characterId: string) => void;
  workbenchControl?: React.ReactNode;
  bottomRightControl?: React.ReactNode;
}

export function CanvasBoard({
  activeSkillButtonId = null,
  workbenchMode: _workbenchMode = 'timeline',
  isToolPanelVisible = true,
  isWorkbenchTopZoneOpen = false,
  onWorkbenchTopZoneOpenChange,
  onSkillButtonModalOpen,
  onSkillButtonModalClose,
  onOpenOperatorConfig,
  workbenchControl,
  bottomRightControl,
}: CanvasBoardProps) {
  const isCandidatePanelEnabled = false;
  const { state, dispatch, refreshSelectedCharacters } = useAppContext();
  const { currentView, selectedCharacters, canvasConfig, skillButtons, loadedCharacters } = state;
  const canvasRef = useRef<HTMLDivElement>(null);
  const [staffCount, setStaffCount] = React.useState(canvasConfig.staffCount);
  const [isReportModalOpen, setIsReportModalOpen] = useState(false);
  const [isSnapshotModalOpen, setIsSnapshotModalOpen] = useState(false);
  const [isSaveSnapshotModalOpen, setIsSaveSnapshotModalOpen] = useState(false);
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);
  const [snapshotDraftName, setSnapshotDraftName] = useState('');
  const [shareDraftName, setShareDraftName] = useState('');
  const [shareScope, setShareScope] = useState<'snapshot' | 'branch' | 'document'>('snapshot');
  const [shareBranchRootId, setShareBranchRootId] = useState('');
  const [shareWorkNodes, setShareWorkNodes] = useState<TimelineRepositoryBundleWorkNode[]>([]);
  const [pendingRestoreSnapshot, setPendingRestoreSnapshot] = useState<TimelineSnapshotEntry | null>(null);
  const [pendingImportShare, setPendingImportShare] = useState<TimelineShareFile | null>(null);
  const [pendingImportBundle, setPendingImportBundle] = useState<TimelineBundleV2 | null>(null);
  const [pendingImportTimelineId, setPendingImportTimelineId] = useState('');
  const [timelineSnapshots, setTimelineSnapshots] = useState<TimelineSnapshotEntry[]>([]);
  const [isBrowseMode, setIsBrowseMode] = useState(false);
  const [isInspectMode, setIsInspectMode] = useState(false);
  const [isAiMode, setIsAiMode] = useState(false);
  const [isWorkNodePanelOpen, setIsWorkNodePanelOpen] = useState(false);
  const [workNodeRefreshKey, setWorkNodeRefreshKey] = useState(0);
  const [pendingWorkNodeCheckoutId, setPendingWorkNodeCheckoutId] = useState('');
  const [aiHoverZone, setAiHoverZone] = useState<'left' | 'right'>('right');
  const shouldRestoreTopZoneAfterAiRef = useRef(false);
  const [isRefreshingAvailableCandidates, setIsRefreshingAvailableCandidates] = useState(false);
  const [isBatchResistanceModalOpen, setIsBatchResistanceModalOpen] = useState(false);
  const [batchTargetResistance, setBatchTargetResistance] = useState<Required<HitResistanceInput>>(
    EMPTY_BATCH_TARGET_RESISTANCE
  );
  const [resistanceRevision, setResistanceRevision] = useState(0);
  const [checkoutBootstrapRevision, setCheckoutBootstrapRevision] = useState(0);
  const shareImportInputRef = useRef<HTMLInputElement>(null);
  const isProcessingWorkbenchCommandRef = useRef(false);
  const isCheckoutBootstrapPendingRef = useRef(true);

  const canvasWidth = useCanvasWidth(canvasConfig.canvasWidthPercent);
  useSelectStart();

  const enterAiMode = () => {
    shouldRestoreTopZoneAfterAiRef.current = isWorkbenchTopZoneOpen;
    if (isWorkbenchTopZoneOpen) {
      onWorkbenchTopZoneOpenChange?.(false);
    }
    setAiHoverZone('right');
    setIsAiMode(true);
  };

  const exitAiMode = () => {
    setIsAiMode(false);
    setAiHoverZone('right');
    if (shouldRestoreTopZoneAfterAiRef.current) {
      onWorkbenchTopZoneOpenChange?.(true);
    }
    shouldRestoreTopZoneAfterAiRef.current = false;
  };

  const toggleAiMode = () => {
    if (isAiMode) {
      exitAiMode();
      return;
    }
    enterAiMode();
  };

  const openWorkNodePanel = () => {
    setPendingWorkNodeCheckoutId('');
    setWorkNodeRefreshKey((current) => current + 1);
    setIsWorkNodePanelOpen(true);
  };

  const closeWorkNodePanel = () => {
    setIsWorkNodePanelOpen(false);
    if (!pendingWorkNodeCheckoutId) return;
    enqueueMainWorkbenchCommand({
      op: 'checkoutAiTimelineWorkNode',
      nodeId: pendingWorkNodeCheckoutId,
      reload: false,
      approval: {
        mode: 'manual',
        approvedBy: 'user',
        rationale: 'Selected from Work Node tree before closing.',
      },
    }, 'work-node-tree');
    setPendingWorkNodeCheckoutId('');
  };

  const refreshWorkNodePanel = () => {
    setWorkNodeRefreshKey((current) => current + 1);
  };

  const updateAiHoverZoneFromClientX = (clientX: number) => {
    const aiPanelWidth = Math.min(window.innerWidth * 0.5, 760, Math.max(0, window.innerWidth - 96));
    const nextHoverZone = clientX >= window.innerWidth - aiPanelWidth ? 'right' : 'left';
    setAiHoverZone((current) => (current === nextHoverZone ? current : nextHoverZone));
  };

  const handleAiLayoutMouseMove = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!isAiMode) return;
    updateAiHoverZoneFromClientX(event.clientX);
  };

  const {
    timelineData,
    addSkillButton: addTimelineButton,
    removeSkillButton: removeTimelineButton,
    updateSkillButtonPosition,
    moveSkillButtonToStaff,
    saveTimelineData,
    loadTimelineData,
    replaceTimelineData,
    normalizeTimelineData,
    updateSkillButtonType: updateTimelineButtonType,
  } = useTimelineData(selectedCharacters);

  const restoredSignatureRef = useRef<string | null>(null);
  const previousViewRef = useRef(currentView);

  const syncRuntimeSkillButtonsFromTimelineData = useCallback((dataToRestore: TimelineData, characters = selectedCharacters) => {
    const restoredButtons: SkillButton[] = [];
    const gridStackElement = canvasRef.current?.querySelector('.canvas-grid-stack');
    const gridContentOffsetX = canvasRef.current && gridStackElement
      ? getGridContentOffsetX(canvasRef.current, gridStackElement)
      : 0;
    dataToRestore.staffLines.forEach((staffLine) => {
      const buttons = Array.isArray(staffLine.buttons) ? staffLine.buttons : [];
      buttons.forEach((btn) => {
        const character = characters.find((item) => item.name === btn.characterName || item.id === btn.characterId);
        const lineIndex = characters.findIndex((item) => item.name === btn.characterName || item.id === btn.characterId);
        const restoredLineIndex = lineIndex >= 0 ? lineIndex : 0;
        const timelineNodeIndex = typeof btn.nodeIndex === 'number' && Number.isFinite(btn.nodeIndex) ? btn.nodeIndex : 0;
        const restoredStaffIndex = Number.isInteger(btn.staffIndex) && btn.staffIndex >= 0
          ? btn.staffIndex
          : staffLine.staffIndex;
        const restoredNodeIndex = timelineNodeIndex % GRID_NODE_COUNT;
        const position = {
          x: gridContentOffsetX + getGridNodeCenterX(restoredNodeIndex),
          y: getGridGroupTop(restoredStaffIndex) + getGridLineCenterY(restoredLineIndex) + SKILL_BUTTON_BASELINE_OFFSET_Y,
        };
        const restoredButtonCharacterId = character?.id ?? btn.characterId ?? btn.characterName;
        const resolvedRuntimeSkill = resolveRuntimeTemplateSkill({
          id: btn.id,
          characterId: restoredButtonCharacterId,
          characterName: btn.characterName,
          skillType: btn.skillType,
          position,
          staffIndex: restoredStaffIndex,
          lineIndex: restoredLineIndex,
          isDragging: false,
          isSelected: false,
          isFromSandbox: true,
          runtimeSkillId: btn.runtimeSkillId,
          skillDisplayName: btn.skillDisplayName,
          skillIconUrl: btn.skillIconUrl,
          customHits: btn.customHits,
          element: character?.element,
        });
        restoredButtons.push({
          id: btn.id,
          characterId: restoredButtonCharacterId,
          characterName: btn.characterName,
          skillType: btn.skillType,
          position,
          staffIndex: restoredStaffIndex,
          lineIndex: restoredLineIndex,
          nodeIndex: restoredNodeIndex,
          nodeNumber: calculateNodeNumber(restoredNodeIndex),
          isDragging: false,
          isSelected: false,
          isFromSandbox: true,
          runtimeSkillId: resolvedRuntimeSkill?.id ?? btn.runtimeSkillId,
          skillDisplayName: resolvedRuntimeSkill?.displayName || btn.skillDisplayName,
          skillIconUrl: resolvedRuntimeSkill?.iconUrl ?? btn.skillIconUrl ?? resolveSkillIconUrl(btn.characterName, btn.skillType),
          customHits: btn.customHits,
          element: character?.element,
        });
      });
    });
    dispatch({ type: 'SET_SKILL_BUTTONS', buttons: restoredButtons });
  }, [dispatch, selectedCharacters]);

  const hydrateCheckoutRuntime = useCallback((payload: TimelineSnapshotPayload) => {
    applyTimelineSnapshotPayload(payload);
    const nextCharacters = payload.selectedCharacters
      .map((id) => loadedCharacters.find((character) => character.id === id || character.name === id))
      .filter((character): character is Character => Boolean(character));
    const resolvedCharacters = nextCharacters.length === payload.selectedCharacters.length
      ? nextCharacters
      : selectedCharacters;
    if (resolvedCharacters.length === 0) {
      throw new Error('CHECKOUT_RUNTIME_HYDRATION_FAILED: 无法解析 checkout 中的干员。');
    }
    const normalizedSkillButtonTable = Object.fromEntries(
      Object.entries(payload.skillButtonTable).map(([buttonId, button]) => {
        const staffIndex = Number.isInteger(button.staffIndex)
          && button.staffIndex >= 0
          && button.staffIndex < resolvedCharacters.length
          ? button.staffIndex
          : resolvedCharacters.findIndex((character) => (
            character.id === button.characterId || character.name === button.characterName
          ));
        return [buttonId, {
          ...button,
          staffIndex: staffIndex >= 0 ? staffIndex : button.staffIndex,
          nodeNumber: calculateNodeNumber(button.nodeIndex),
        }];
      }),
    );
    const canonicalTimelineData: TimelineData = {
      ...payload.timelineData,
      staffLines: resolvedCharacters.map((character, staffIndex) => {
        const buttons = Object.values(normalizedSkillButtonTable)
          .filter((button) => button.staffIndex === staffIndex)
          .map((button) => ({
            id: button.id,
            characterId: button.characterId || character.id,
            characterName: button.characterName,
            skillType: button.skillType as SkillButtonType,
            staffIndex: button.staffIndex,
            nodeIndex: button.nodeIndex,
            nodeNumber: calculateNodeNumber(button.nodeIndex),
            position: button.position,
            runtimeSkillId: button.runtimeSkillId,
            skillDisplayName: button.skillDisplayName,
            skillIconUrl: button.skillIconUrl,
            customHits: button.customHits,
            buffIds: [...(button.selectedBuff || [])],
          }))
          .sort((left, right) => left.nodeIndex - right.nodeIndex);
        return {
          staffIndex,
          characterName: character.name,
          occupiedNodes: [...new Set(buttons.map((button) => button.nodeIndex))],
          buttons,
        };
      }),
    };
    setSkillButtonTable(normalizedSkillButtonTable);
    const normalizedTimelineData = normalizeTimelineData(canonicalTimelineData, resolvedCharacters);
    saveTimelineRepo(normalizedTimelineData);
    replaceTimelineData(normalizedTimelineData);
    dispatch({ type: 'SET_SELECTED_CHARACTERS', characters: resolvedCharacters });
    syncRuntimeSkillButtonsFromTimelineData(normalizedTimelineData, resolvedCharacters);
  }, [dispatch, loadedCharacters, normalizeTimelineData, replaceTimelineData, selectedCharacters, syncRuntimeSkillButtonsFromTimelineData]);

  useEffect(() => {
    if (!isCheckoutBootstrapPendingRef.current || loadedCharacters.length === 0) return;
    void (async () => {
      try {
        const repository = createTimelineRepositoryClient();
        const checkoutRef = await repository.getCheckoutRef(DEFAULT_TIMELINE_ID);
        if (!checkoutRef) return;
        const exported = await repository.exportDocumentBundle(DEFAULT_TIMELINE_ID);
        const payload = checkoutRef.targetType === 'snapshot'
          ? exported.snapshots.find((snapshot) => snapshot.id === checkoutRef.targetId)?.payload
          : exported.workNodes.find((node) => node.id === checkoutRef.targetId)?.workingPayload;
        if (payload) hydrateCheckoutRuntime(payload);
      } catch {
        // A first-run document legitimately has no checkout to hydrate.
      } finally {
        isCheckoutBootstrapPendingRef.current = false;
        setCheckoutBootstrapRevision((revision) => revision + 1);
      }
    })();
  }, [hydrateCheckoutRuntime, loadedCharacters.length]);

  const findCharacterForWorkbenchCommand = (command: Extract<MainWorkbenchCommand, { op: 'addSkillButton' | 'removeSkillButton' | 'addBuff' | 'removeBuff' | 'setOperatorWeapon' | 'setOperatorEquipment' }>) => {
    if ('characterId' in command && command.characterId) {
      const byId = selectedCharacters.find((character) => character.id === command.characterId);
      if (byId) return byId;
    }
    if ('characterName' in command && command.characterName) {
      const byName = selectedCharacters.find((character) => character.name === command.characterName);
      if (byName) return byName;
    }
    return null;
  };

  const normalizeWorkbenchWeaponPotential = (potential: string | undefined, fallback: string) => {
    if (!potential) return fallback;
    if (potential === 'P0') return '0潜';
    if (potential === 'PMAX') return '满潜';
    return potential;
  };

  const setOperatorWeaponFromWorkbenchCommand = async (command: Extract<MainWorkbenchCommand, { op: 'setOperatorWeapon' }>) => {
    const weaponName = command.weaponName?.trim();
    if (!weaponName) {
      throw new Error('setOperatorWeapon requires weaponName');
    }
    const character = findCharacterForWorkbenchCommand(command) ?? selectedCharacters[0] ?? null;
    if (!character) {
      throw new Error('未找到可设置武器的已选干员');
    }

    await refreshOperatorConfigSnapshotsForCharacters([character]);
    const cache = getOperatorConfigPageCache();
    const snapshot = cache[character.id];
    if (!snapshot) {
      throw new Error(`未找到干员配置快照: ${character.name}`);
    }

    const nextSnapshot = {
      ...snapshot,
      weapon: {
        ...snapshot.weapon,
        id: weaponName,
        name: weaponName,
        config: {
          ...snapshot.weapon.config,
          level: command.level ?? snapshot.weapon.config.level,
          potential: normalizeWorkbenchWeaponPotential(command.potential, snapshot.weapon.config.potential),
          skillLevels: {
            ...snapshot.weapon.config.skillLevels,
            ...(command.skillLevels ?? {}),
          },
        },
      },
    };
    setOperatorConfigPageCache({
      ...cache,
      [character.id]: nextSnapshot,
    });
    const refreshResult = await refreshOperatorConfigSnapshotsForCharacters([character]);
    await refreshAvailableCandidateBuffsForCharacters([character]);
    setResistanceRevision((value) => value + 1);
    const refreshedSnapshot = getOperatorConfigPageCache()[character.id] ?? nextSnapshot;

    return {
      characterId: character.id,
      characterName: character.name,
      weapon: {
        id: refreshedSnapshot.weapon.id,
        name: refreshedSnapshot.weapon.name,
        level: refreshedSnapshot.weapon.config.level,
        potential: refreshedSnapshot.weapon.config.potential,
        attack: refreshedSnapshot.weapon.attack,
      },
      refreshedCharacterIds: refreshResult.refreshedCharacterIds,
      skippedCharacterIds: refreshResult.skippedCharacterIds,
    };
  };

  const setOperatorEquipmentFromWorkbenchCommand = async (command: Extract<MainWorkbenchCommand, { op: 'setOperatorEquipment' }>) => {
    const character = findCharacterForWorkbenchCommand(command) ?? selectedCharacters[0] ?? null;
    if (!character) {
      throw new Error('未找到可设置装备的已选干员');
    }

    const selections = command.equipments?.length
      ? command.equipments.map((selection) => ({
          ...selection,
          gearSetId: selection.gearSetId ?? command.gearSetId,
          gearSetName: selection.gearSetName ?? command.gearSetName,
          entryLevel: selection.entryLevel ?? command.entryLevel,
          entryLevels: selection.entryLevels ?? command.entryLevels,
        }))
      : [{
          slotKey: command.slotKey,
          part: command.part,
          equipmentId: command.equipmentId,
          equipmentName: command.equipmentName,
          gearSetId: command.gearSetId,
          gearSetName: command.gearSetName,
          fillSlots: command.fillSlots,
          entryLevel: command.entryLevel,
          entryLevels: command.entryLevels,
        }];

    await refreshOperatorConfigSnapshotsForCharacters([character]);
    const cache = getOperatorConfigPageCache();
    const snapshot = cache[character.id];
    if (!snapshot) {
      throw new Error(`未找到干员配置快照: ${character.name}`);
    }

    const patchResult = applyOperatorEquipmentSelectionsToSnapshot(snapshot, selections);
    setOperatorConfigPageCache({
      ...cache,
      [character.id]: patchResult.snapshot,
    });
    const refreshResult = await refreshOperatorConfigSnapshotsForCharacters([character]);
    await refreshAvailableCandidateBuffsForCharacters([character]);
    setResistanceRevision((value) => value + 1);
    const refreshedSnapshot = getOperatorConfigPageCache()[character.id] ?? patchResult.snapshot;

    return {
      characterId: character.id,
      characterName: character.name,
      equipment: refreshedSnapshot.equipment.pieces.map((piece) => ({
        slotKey: piece.slotKey,
        equipmentId: piece.equipmentId,
        name: piece.name,
        part: piece.part,
        effects: piece.effects.map((effect) => ({
          effectId: effect.effectId,
          label: effect.label,
          typeKey: effect.typeKey,
          level: effect.level,
          value: effect.value,
        })),
      })),
      applied: patchResult.applied,
      setBuffs: refreshedSnapshot.equipment.setBuffs.map((buff) => ({
        gearSetId: buff.gearSetId,
        gearSetName: buff.gearSetName,
        effectId: buff.effectId,
        label: buff.label,
        typeKey: buff.typeKey,
        value: buff.value,
      })),
      refreshedCharacterIds: refreshResult.refreshedCharacterIds,
      skippedCharacterIds: refreshResult.skippedCharacterIds,
    };
  };

  const resolveWorkbenchCommandSkill = (
    character: Character,
    command: Extract<MainWorkbenchCommand, { op: 'addSkillButton' }>
  ): SandboxSkill => {
    const skills = Array.isArray(character.sandboxSkills) && character.sandboxSkills.length > 0
      ? character.sandboxSkills
      : buildSandboxSkillsFromRuntimeTemplate(character.id);
    const matched = skills.find((skill) => command.runtimeSkillId && skill.id === command.runtimeSkillId)
      ?? skills.find((skill) => command.skillDisplayName && skill.displayName === command.skillDisplayName)
      ?? skills.find((skill) => command.skillType && skill.buttonType === command.skillType)
      ?? skills[0];

    if (matched) {
      return matched;
    }

    const fallbackSkillType = command.skillType ?? 'A';
    return {
      id: `fallback-${character.id}-${fallbackSkillType}`,
      displayName: fallbackSkillType,
      buttonType: fallbackSkillType,
      iconUrl: character.skillIconMap?.[fallbackSkillType] ?? resolveSkillIconUrl(character.name, fallbackSkillType),
      hitCount: 1,
      source: character.librarySource ?? 'official',
    };
  };

  const getWorkbenchGridContentOffsetX = () => {
    const gridStackElement = canvasRef.current?.querySelector('.canvas-grid-stack');
    return canvasRef.current && gridStackElement
      ? getGridContentOffsetX(canvasRef.current, gridStackElement)
      : 0;
  };

  const buildWorkbenchButtonPosition = (staffIndex: number, lineIndex: number, nodeIndex: number) => {
    const gridStackElement = canvasRef.current?.querySelector('.canvas-grid-stack');
    const gridY = getGridGroupTop(staffIndex) + getGridLineCenterY(lineIndex) + SKILL_BUTTON_BASELINE_OFFSET_Y;
    const gridX = getGridNodeCenterX(nodeIndex);
    if (canvasRef.current && gridStackElement) {
      return gridToCanvasContentCoords(gridX, gridY, canvasRef.current, gridStackElement);
    }
    return { x: gridX, y: gridY };
  };

  const resolveWorkbenchNodeIndex = (staffIndex: number, lineIndex: number, requestedNodeIndex: unknown) => {
    const requested = typeof requestedNodeIndex === 'number' && Number.isFinite(requestedNodeIndex)
      ? clampGridNodeIndex(Math.floor(requestedNodeIndex))
      : null;
    const occupied = getOccupiedNodeIndicesForLine(
      skillButtons,
      staffIndex,
      lineIndex,
      null,
      getWorkbenchGridContentOffsetX()
    );
    if (requested !== null && !occupied.has(requested)) {
      return requested;
    }
    if (requested !== null && occupied.has(requested)) {
      const snapped = resolveSnappedGridNode(getGridNodeCenterX(requested), occupied);
      if (snapped) return snapped.nodeIndex;
    }
    for (let nodeIndex = 0; nodeIndex < GRID_NODE_COUNT; nodeIndex += 1) {
      if (!occupied.has(nodeIndex)) return nodeIndex;
    }
    throw new Error(`第 ${staffIndex + 1} 组第 ${lineIndex + 1} 行已无空节点`);
  };

  const addSkillButtonFromWorkbenchCommand = (command: Extract<MainWorkbenchCommand, { op: 'addSkillButton' }>) => {
    const character = findCharacterForWorkbenchCommand(command);
    if (!character) {
      throw new Error(`未找到已选干员: ${command.characterId || command.characterName || '(empty)'}`);
    }
    const lineIndex = selectedCharacters.findIndex((item) => item.id === character.id);
    if (lineIndex < 0) {
      throw new Error(`干员未在当前出战队列中: ${character.name}`);
    }
    const staffIndex = typeof command.staffIndex === 'number' && Number.isFinite(command.staffIndex)
      ? Math.max(0, Math.min(staffCount - 1, Math.floor(command.staffIndex)))
      : 0;
    const nodeIndex = resolveWorkbenchNodeIndex(staffIndex, lineIndex, command.nodeIndex);
    const position = buildWorkbenchButtonPosition(staffIndex, lineIndex, nodeIndex);
    const skill = resolveWorkbenchCommandSkill(character, command);
    const buttonId = command.buttonId?.trim() || generateId();
    const skillIconUrl = skill.iconUrl ?? character.skillIconMap?.[skill.buttonType] ?? resolveSkillIconUrl(character.name, skill.buttonType);

    const runtimeButton: SkillButton = {
      id: buttonId,
      characterId: character.id,
      characterName: character.name,
      skillType: skill.buttonType,
      position,
      staffIndex,
      lineIndex,
      nodeIndex,
      nodeNumber: calculateNodeNumber(nodeIndex),
      isDragging: false,
      isSelected: Boolean(command.select),
      isFromSandbox: true,
      runtimeSkillId: skill.id,
      skillDisplayName: skill.displayName,
      skillIconUrl,
      customHits: skill.customHits,
      element: character.element,
    };

    if (!skillButtons.some((button) => button.id === buttonId)) {
      dispatch({ type: 'ADD_SKILL_BUTTON', button: runtimeButton });
      addTimelineButton({
        characterId: character.id,
        characterName: character.name,
        skillType: skill.buttonType,
        staffIndex,
        nodeIndex,
        position,
        runtimeSkillId: skill.id,
        skillDisplayName: skill.displayName,
        skillIconUrl,
        customHits: skill.customHits,
      }, buttonId);
    }

    if (command.select) {
      dispatch({ type: 'SELECT_SKILL_BUTTON', buttonId });
      safeSessionStorage.setItem(STORAGE_KEYS.SELECTED_SKILL_BUTTON, buttonId);
    }

    return {
      buttonId,
      characterId: character.id,
      characterName: character.name,
      skillType: skill.buttonType,
      runtimeSkillId: skill.id,
      staffIndex,
      lineIndex,
      nodeIndex,
    };
  };

  const formatWorkbenchButtonLabel = (button: Pick<SkillButton, 'characterName' | 'skillDisplayName' | 'skillType' | 'staffIndex' | 'nodeIndex'>) => (
    `${button.characterName}-${button.skillDisplayName || button.skillType}@${button.staffIndex + 1}-${(button.nodeIndex ?? 0) + 1}`
  );

  const getWorkbenchButtonReferenceScope = () => {
    const byId = new Map(skillButtons.map((button) => [button.id, button]));
    timelineData.staffLines.forEach((staffLine) => {
      const buttons = Array.isArray(staffLine.buttons) ? staffLine.buttons : [];
      buttons.forEach((button) => {
        if (byId.has(button.id)) return;
        const character = selectedCharacters.find((item) => item.name === button.characterName || item.id === button.characterId);
        const lineIndex = selectedCharacters.findIndex((item) => item.name === button.characterName || item.id === button.characterId);
        const nodeIndex = typeof button.nodeIndex === 'number' && Number.isFinite(button.nodeIndex) ? button.nodeIndex : 0;
        const staffIndex = typeof button.staffIndex === 'number' ? button.staffIndex : staffLine.staffIndex;
        byId.set(button.id, {
          id: button.id,
          characterId: character?.id ?? button.characterId ?? button.characterName,
          characterName: button.characterName,
          skillType: button.skillType as SkillButtonType,
          position: button.position ?? buildWorkbenchButtonPosition(staffIndex, lineIndex >= 0 ? lineIndex : 0, nodeIndex),
          staffIndex,
          lineIndex: lineIndex >= 0 ? lineIndex : 0,
          nodeIndex,
          nodeNumber: button.nodeNumber ?? calculateNodeNumber(nodeIndex),
          isDragging: false,
          isSelected: false,
          isFromSandbox: true,
          runtimeSkillId: button.runtimeSkillId,
          skillDisplayName: button.skillDisplayName,
          skillIconUrl: button.skillIconUrl,
          customHits: button.customHits,
          element: character?.element,
        });
      });
    });
    Object.values(getSkillButtonTable()).forEach((button) => {
      if (byId.has(button.id)) return;
      const character = selectedCharacters.find((item) => item.name === button.characterName || item.id === button.characterId);
      const lineIndex = selectedCharacters.findIndex((item) => item.name === button.characterName || item.id === button.characterId);
      const nodeIndex = typeof button.nodeIndex === 'number' && Number.isFinite(button.nodeIndex) ? button.nodeIndex : 0;
      const staffIndex = typeof button.staffIndex === 'number' ? button.staffIndex : 0;
      byId.set(button.id, {
        id: button.id,
        characterId: character?.id ?? button.characterId ?? button.characterName,
        characterName: button.characterName,
        skillType: button.skillType as SkillButtonType,
        position: button.position ?? buildWorkbenchButtonPosition(staffIndex, lineIndex >= 0 ? lineIndex : 0, nodeIndex),
        staffIndex,
        lineIndex: lineIndex >= 0 ? lineIndex : 0,
        nodeIndex,
        nodeNumber: button.nodeNumber ?? calculateNodeNumber(nodeIndex),
        isDragging: false,
        isSelected: false,
        isFromSandbox: true,
        runtimeSkillId: button.runtimeSkillId,
        skillDisplayName: button.skillDisplayName,
        skillIconUrl: button.skillIconUrl,
        customHits: button.customHits,
        element: character?.element,
      });
    });
    return [...byId.values()];
  };

  const resolveWorkbenchButtonIdReference = (buttonId: string, scope = getWorkbenchButtonReferenceScope()) => {
    const normalizedButtonId = buttonId.trim();
    if (!normalizedButtonId) return null;
    const exactId = scope.find((button) => button.id === normalizedButtonId);
    if (exactId) return exactId;
    const labelMatches = scope.filter((button) => formatWorkbenchButtonLabel(button) === normalizedButtonId);
    if (labelMatches.length === 1) return labelMatches[0];
    if (labelMatches.length > 1) {
      throw new Error(`技能按钮标签不唯一: ${normalizedButtonId}`);
    }
    throw new Error(`技能按钮不存在: ${normalizedButtonId}`);
  };

  const findWorkbenchButtonId = (command: Extract<MainWorkbenchCommand, { op: 'addBuff' | 'removeBuff' }>) => {
    const buttonScope = getWorkbenchButtonReferenceScope();
    if (command.buttonId) {
      return resolveWorkbenchButtonIdReference(command.buttonId, buttonScope)?.id ?? null;
    }
    const character = findCharacterForWorkbenchCommand(command);
    const candidates = buttonScope.filter((button) => {
      if (character && button.characterId !== character.id && button.characterName !== character.name) return false;
      if (command.skillType && button.skillType !== command.skillType) return false;
      if (typeof command.nodeIndex === 'number' && button.nodeIndex !== command.nodeIndex) return false;
      return true;
    });
    if (candidates.length > 1) {
      throw new Error(`技能按钮定位不唯一: ${candidates.map(formatWorkbenchButtonLabel).join('、')}`);
    }
    return candidates[0]?.id ?? null;
  };

  const findWorkbenchBuffsForRemove = (buttonId: string, command: Extract<MainWorkbenchCommand, { op: 'removeBuff' }>) => {
    const buffs = getBuffsByButtonId(buttonId);
    const targetDisplayName = command.displayName || command.buffDisplayName;
    const hasSelector = Boolean(command.buffId || targetDisplayName || command.name);
    if (!hasSelector && !command.all) {
      throw new Error('removeBuff requires buffId/displayName/name/buffDisplayName, or all:true to remove every Buff on the button');
    }
    if (command.all) {
      const ordered = command.latest ? [...buffs].reverse() : buffs;
      const count = typeof command.count === 'number'
        ? Math.max(1, Math.min(command.count, ordered.length))
        : ordered.length;
      return ordered.slice(0, count);
    }
    const matched = buffs.filter((buff) => {
      if (command.buffId && buff.id !== command.buffId) return false;
      if (targetDisplayName && buff.displayName !== targetDisplayName) return false;
      if (command.name && buff.name !== command.name) return false;
      return true;
    });
    const ordered = command.latest ? [...matched].reverse() : matched;
    const count = Math.max(1, Math.min(command.count ?? 1, ordered.length));
    return ordered.slice(0, count);
  };

  const findWorkbenchButtonForRemove = (command: Extract<MainWorkbenchCommand, { op: 'removeSkillButton' }>) => {
    if (command.buttonId) {
      return resolveWorkbenchButtonIdReference(command.buttonId);
    }
    const character = findCharacterForWorkbenchCommand(command);
    const candidates = skillButtons.filter((button) => {
      if (character && button.characterId !== character.id && button.characterName !== character.name) return false;
      if (command.skillType && button.skillType !== command.skillType) return false;
      if (typeof command.nodeIndex === 'number' && button.nodeIndex !== command.nodeIndex) return false;
      return true;
    });
    if (candidates.length > 1 && !command.latest) {
      throw new Error(`技能按钮定位不唯一: ${candidates.map(formatWorkbenchButtonLabel).join('、')}`);
    }
    const sorted = [...candidates].sort((a, b) =>
      (b.staffIndex - a.staffIndex)
      || (b.lineIndex - a.lineIndex)
      || ((b.nodeIndex ?? 0) - (a.nodeIndex ?? 0))
    );
    return command.latest ? sorted[0] ?? null : candidates[0] ?? null;
  };

  const createAiTimelineWorkNodeFromCurrentCommand = async (
    command: Extract<MainWorkbenchCommand, { op: 'createAiTimelineWorkNodeFromCurrent' }>,
  ) => {
    saveTimelineData();
    setSelectedCharacterIds(selectedCharacters.map((character) => character.id));
    const payload = getCurrentTimelineSnapshotPayload();
    if (!payload) {
      throw new Error('当前没有可创建 AI work node 的排轴迁出态');
    }
    const validation = validateTimelinePayload(payload);
    if (!validation.ok) {
      throw new Error(`当前排轴 payload 校验失败：${validation.issues.map((issue) => issue.message).join('；')}`);
    }
    const now = Date.now();
    const client = createAiTimelineWorkNodeClient();
    const hasParentNodeInput = Object.prototype.hasOwnProperty.call(command, 'parentNodeId');
    const created = await client.create({
      timelineId: command.timelineId?.trim() || command.saveId?.trim() || DEFAULT_TIMELINE_ID,
      branchId: command.branchId?.trim() || `main-workbench-${now}`,
      ...(hasParentNodeInput ? {
        parentNodeId: command.parentNodeId === null ? null : (command.parentNodeId?.trim() || null),
      } : {}),
      label: command.label?.trim() || `Main Workbench ${new Date(now).toLocaleString()}`,
      basePayload: payload,
      workingPayload: payload,
      approvalPolicy: command.approvalPolicy || 'auto-low-risk',
      riskFlags: [],
    });
    return {
      nodeId: created.node.id,
      timelineId: created.node.timelineId,
      branchId: created.node.branchId,
      label: created.node.label,
      status: created.node.status,
      baseSummary: created.node.baseSummary,
      workingSummary: created.node.workingSummary,
      buttonTargets: buildTimelineButtonTargets(payload),
      path: created.path,
    };
  };

  const checkoutAiTimelineWorkNodeFromCommand = async (
    command: Extract<MainWorkbenchCommand, { op: 'checkoutAiTimelineWorkNode' }>,
  ) => {
    const nodeId = command.nodeId?.trim();
    if (!nodeId) {
      throw new Error('checkoutAiTimelineWorkNode requires nodeId');
    }
    const client = createAiTimelineWorkNodeClient();
    const { node } = await client.get(nodeId);
    const riskFlags = Array.isArray(node.riskFlags) ? node.riskFlags : [];
    const isManualApproval = command.approval?.mode === 'manual';
    const nodeDiff = diffTimelinePayloads(node.basePayload, node.workingPayload);
    const checkoutDecision = buildAiTimelineCheckoutDecision({
      approvalPolicy: node.approvalPolicy,
      riskFlags,
      diff: nodeDiff,
    }) as {
      status: 'auto' | 'needs-manual-approval' | 'blocked';
      approvalMode: 'auto' | 'manual';
      canAutoApprove: boolean;
      requiresManualApproval: boolean;
      rationale: string;
      reasons: string[];
    };
    if (!checkoutDecision.canAutoApprove && !isManualApproval) {
      throw new Error(`AI work node 需要 manual approval 后才能 checkout：${checkoutDecision.rationale}`);
    }

    const validation = validateTimelinePayload(node.workingPayload);
    if (!validation.ok) {
      throw new Error(`AI work node payload 校验失败：${validation.issues.map((issue) => issue.message).join('；')}`);
    }

    saveTimelineData();
    setSelectedCharacterIds(selectedCharacters.map((character) => character.id));
    const currentPayload = getCurrentTimelineSnapshotPayload();
    const currentDiff = currentPayload ? diffTimelinePayloads(currentPayload, node.workingPayload).summary : null;
    const commits = (await client.list()).commits
      .filter((commit) => commit.nodeId === node.id)
      .sort((left, right) => right.createdAt - left.createdAt);
    const requestedCommit = command.commitId
      ? commits.find((commit) => commit.id === command.commitId)
      : null;
    let commit = requestedCommit || commits[0] || null;
    if (!commit || commit.checkoutApplied) {
      const approvalMode = isManualApproval ? 'manual' : 'auto';
      const approval = {
        mode: approvalMode,
        approvedAt: Date.now(),
        approvedBy: command.approval?.approvedBy || (approvalMode === 'manual' ? 'user' : 'ai'),
        rationale: command.approval?.rationale || checkoutDecision.rationale,
      } as const;
      const committed = await client.commit(node.id, {
        label: `Checkout ${node.label}`,
        riskFlags,
        approval,
      });
      commit = committed.commit;
    }

    hydrateCheckoutRuntime(node.workingPayload);
    let applied: Awaited<ReturnType<ReturnType<typeof createAiTimelineWorkNodeClient>['markCheckoutApplied']>> | null = null;
    let checkoutMarkError: string | undefined;
    try {
      applied = await client.markCheckoutApplied(node.id, {
        commitId: commit.id,
        appliedAt: Date.now(),
        appliedBy: command.approval?.approvedBy || (isManualApproval ? 'user' : 'ai'),
        rationale: command.approval?.rationale || 'Renderer checkout applied to current main workbench timeline.',
      });
    } catch (error) {
      checkoutMarkError = error instanceof Error ? error.message : String(error);
    }

    if (command.reload === true) {
      window.setTimeout(() => window.location.reload(), 80);
    }

    return {
      nodeId: applied?.node.id || node.id,
      commitId: applied?.commit.id || commit.id,
      status: applied?.node.status || 'applied-unrecorded',
      checkoutApplied: Boolean(applied?.commit.checkoutApplied),
      checkoutMarkError,
      reloaded: command.reload === true,
      riskFlags: riskFlags.map((risk) => ({ severity: risk.severity, code: risk.code, message: risk.message })),
      checkoutDecision,
      currentDiff,
    };
  };

  const patchAiTimelineWorkNodeFromCommand = async (
    command: Extract<MainWorkbenchCommand, { op: 'patchAiTimelineWorkNode' }>,
  ): Promise<PatchAiTimelineWorkNodeCommandResult> => {
    const nodeId = command.nodeId?.trim();
    if (!nodeId) {
      throw new Error('patchAiTimelineWorkNode requires nodeId');
    }
    const client = createAiTimelineWorkNodeClient();
    const { node } = await client.get(nodeId);
    const patchResult = applyTimelineWorkNodePatch(node.workingPayload, command.patch, { dryRun: command.dryRun });
    if (!patchResult.ok) {
      return {
        nodeId,
        dryRun: command.dryRun === true,
        ok: false,
        issues: patchResult.issues,
        riskFlags: patchResult.riskFlags,
      };
    }
    const nextRiskFlags = [
      ...(Array.isArray(node.riskFlags) ? node.riskFlags : []),
      ...patchResult.riskFlags,
    ];
    if (command.dryRun === true) {
      return {
        nodeId,
        dryRun: true,
        ok: true,
        operationsApplied: patchResult.operationsApplied,
        diff: patchResult.diff,
        diffSummary: formatTimelineDiffSummary(patchResult.diff),
        changedButtons: summarizeTimelineChangedButtons(patchResult.diff),
        currentCheckoutTouched: false,
        riskFlags: nextRiskFlags,
        summary: patchResult.summary,
      };
    }
    const updated = await client.update(nodeId, {
      workingPayload: patchResult.workingPayload,
      status: 'ready',
      riskFlags: nextRiskFlags,
    });
    const checkoutDecision = buildAiTimelineCheckoutDecision({
      approvalPolicy: updated.node.approvalPolicy,
      riskFlags: nextRiskFlags,
      diff: patchResult.diff,
    });
    return {
      nodeId: updated.node.id,
      dryRun: false,
      ok: true,
      status: updated.node.status,
      operationsApplied: patchResult.operationsApplied,
      diff: patchResult.diff,
      diffSummary: formatTimelineDiffSummary(patchResult.diff),
      changedButtons: summarizeTimelineChangedButtons(patchResult.diff),
      currentCheckoutTouched: false,
      riskFlags: nextRiskFlags.map((risk) => ({ severity: risk.severity, code: risk.code, message: risk.message })),
      checkoutDecision,
      summary: patchResult.summary,
      path: updated.path,
    };
  };

  const patchAndValidateAiTimelineWorkNodeFromCommand = async (
    command: Extract<MainWorkbenchCommand, { op: 'patchAndValidateAiTimelineWorkNode' }>,
  ) => {
    if ((command as { checkout?: boolean }).checkout === true) {
      throw new Error('patchAndValidateAiTimelineWorkNode does not support checkout:true');
    }
    let created: Awaited<ReturnType<typeof createAiTimelineWorkNodeFromCurrentCommand>> | null = null;
    let nodeId = command.nodeId?.trim() || '';
    if (!nodeId) {
      created = await createAiTimelineWorkNodeFromCurrentCommand({
        op: 'createAiTimelineWorkNodeFromCurrent',
        timelineId: command.timelineId || command.saveId,
        branchId: command.branchId,
        ...(Object.prototype.hasOwnProperty.call(command, 'parentNodeId') ? { parentNodeId: command.parentNodeId } : {}),
        label: command.label,
        approvalPolicy: command.approvalPolicy,
      });
      nodeId = created.nodeId;
    }

    const patchResult = await patchAiTimelineWorkNodeFromCommand({
      op: 'patchAiTimelineWorkNode',
      nodeId,
      patch: command.patch,
      dryRun: command.dryRun,
    });
    if (!patchResult.ok) {
      return {
        ok: false,
        nodeId,
        created,
        dryRun: command.dryRun === true,
        patchApplied: false,
        validation: {
          ok: false,
          issues: patchResult.issues,
        },
        checkout: false,
        currentCheckoutTouched: false,
        completedSteps: created ? ['create-node', 'patch-failed'] : ['patch-failed'],
        issues: patchResult.issues,
        riskFlags: patchResult.riskFlags,
      };
    }

    const client = createAiTimelineWorkNodeClient();
    const { node } = await client.get(nodeId);
    const validation = validateTimelinePayload(command.dryRun === true ? node.workingPayload : node.workingPayload);
    const diff = patchResult.diff as ReturnType<typeof diffTimelinePayloads>;
    return {
      ok: validation.ok,
      nodeId,
      created,
      dryRun: command.dryRun === true,
      patchApplied: command.dryRun !== true,
      operationsApplied: patchResult.operationsApplied,
      validation,
      diffSummary: patchResult.diffSummary || formatTimelineDiffSummary(diff),
      diff: {
        summary: diff.summary,
        selectedCharactersChanged: diff.selectedCharactersChanged,
      },
      changedButtons: patchResult.changedButtons || summarizeTimelineChangedButtons(diff),
      checkout: false,
      currentCheckoutTouched: false,
      pollutionCheck: {
        pass: true,
        method: 'front-end work node update only; checkout path disabled',
      },
      riskFlags: patchResult.riskFlags,
      checkoutDecision: patchResult.checkoutDecision,
      completedSteps: created ? ['create-node', 'patch', 'validate', 'diff', 'pollution-check'] : ['patch', 'validate', 'diff', 'pollution-check'],
      nextActions: ['Use checkoutAiTimelineWorkNode only if the user explicitly wants to apply this work node.'],
    };
  };

  const restoreAiTimelineWorkNodeBaseFromCommand = async (
    command: Extract<MainWorkbenchCommand, { op: 'restoreAiTimelineWorkNodeBase' }>,
  ) => {
    const nodeId = command.nodeId?.trim();
    if (!nodeId) {
      throw new Error('restoreAiTimelineWorkNodeBase requires nodeId');
    }
    const client = createAiTimelineWorkNodeClient();
    const { node } = await client.get(nodeId);
    const validation = validateTimelinePayload(node.basePayload);
    if (!validation.ok) {
      throw new Error(`AI work node basePayload 校验失败：${validation.issues.map((issue) => issue.message).join('；')}`);
    }

    saveTimelineData();
    setSelectedCharacterIds(selectedCharacters.map((character) => character.id));
    const currentPayload = getCurrentTimelineSnapshotPayload();
    const currentDiff = currentPayload ? diffTimelinePayloads(currentPayload, node.basePayload).summary : null;
    hydrateCheckoutRuntime(node.basePayload);

    let rollbackApplied: Awaited<ReturnType<ReturnType<typeof createAiTimelineWorkNodeClient>['markRollbackApplied']>> | null = null;
    let rollbackMarkError: string | undefined;
    try {
      rollbackApplied = await client.markRollbackApplied(node.id, {
        appliedAt: Date.now(),
        appliedBy: command.approval?.approvedBy || 'ai',
        rationale: command.approval?.rationale || 'Renderer rollback applied from AI timeline work node basePayload.',
      });
    } catch (error) {
      rollbackMarkError = error instanceof Error ? error.message : String(error);
    }

    if (command.reload === true) {
      window.setTimeout(() => window.location.reload(), 80);
    }

    return {
      nodeId: rollbackApplied?.node.id || node.id,
      status: rollbackApplied?.node.status || 'rolled-back-unrecorded',
      rollbackApplied: Boolean(rollbackApplied),
      rollbackMarkError,
      reloaded: command.reload === true,
      currentDiff,
    };
  };

  const processMainWorkbenchCanvasCommand = async () => {
    if (isProcessingWorkbenchCommandRef.current) {
      return;
    }
    isProcessingWorkbenchCommandRef.current = true;
    try {
      await pullRemoteMainWorkbenchCommands();
      const commandEntry = getPendingMainWorkbenchCommands([
        'addSkillButton',
        'removeSkillButton',
        'addBuff',
        'addBuffToButtons',
        'removeBuff',
        'setTargetResistance',
        'calculateDamage',
        'saveTimelineSnapshot',
        'restoreTimelineSnapshot',
        'listTimelineSnapshots',
        'createAiTimelineWorkNodeFromCurrent',
        'diffAiTimelineWorkNode',
        'patchAiTimelineWorkNode',
        'patchAndValidateAiTimelineWorkNode',
        'checkoutAiTimelineWorkNode',
        'restoreAiTimelineWorkNodeBase',
        'refreshOperatorConfig',
        'setOperatorWeapon',
        'setOperatorEquipment',
        'refreshSnapshot',
      ])[0];
      if (!commandEntry) {
        return;
      }

      patchMainWorkbenchCommand(commandEntry.id, { status: 'running' });
      const command = commandEntry.command;
      try {
        if (command.op === 'addSkillButton') {
          const result = addSkillButtonFromWorkbenchCommand(command);
          const doneEntry = patchMainWorkbenchCommand(commandEntry.id, { status: 'done', result });
          if (doneEntry) void pushMainWorkbenchCommandResult(doneEntry);
          return;
        }

        if (command.op === 'removeSkillButton') {
          const button = findWorkbenchButtonForRemove(command);
          if (!button) {
            throw new Error('未找到可回退的技能按钮');
          }
          removeTimelineButton(button.lineIndex, button.id);
          dispatch({ type: 'REMOVE_SKILL_BUTTON', buttonId: button.id });
          const doneEntry = patchMainWorkbenchCommand(commandEntry.id, {
            status: 'done',
            result: {
              buttonId: button.id,
              label: formatWorkbenchButtonLabel(button),
              characterName: button.characterName,
              skillType: button.skillType,
              skillDisplayName: button.skillDisplayName,
              staffIndex: button.staffIndex,
              lineIndex: button.lineIndex,
              nodeIndex: button.nodeIndex,
            },
          });
          if (doneEntry) void pushMainWorkbenchCommandResult(doneEntry);
          return;
        }

        if (command.op === 'addBuff') {
          if (!command.buff || typeof command.buff !== 'object') {
            throw new Error('addBuff requires buff');
          }
          const buttonId = findWorkbenchButtonId(command);
          if (!buttonId) {
            throw new Error('未找到可添加 Buff 的技能按钮');
          }
          const result = addBuffToButton(buttonId, { ...command.buff, refCount: command.buff.refCount ?? 1 });
          if (!result.success) {
            throw new Error(`Buff 添加失败: ${command.buff.displayName || command.buff.name || '未命名 Buff'}`);
          }
          recomputeSkillButtonPanel(buttonId);
          setResistanceRevision((value) => value + 1);
          if (result.buffId) {
            emitSkillButtonBuffAdded(buttonId, result.buffId);
          }
          if (command.select) {
            dispatch({ type: 'SELECT_SKILL_BUTTON', buttonId });
            safeSessionStorage.setItem(STORAGE_KEYS.SELECTED_SKILL_BUTTON, buttonId);
          }
          const doneEntry = patchMainWorkbenchCommand(commandEntry.id, {
            status: 'done',
            result: { buttonId, buffId: result.buffId, duplicate: result.isDuplicate },
          });
          if (doneEntry) void pushMainWorkbenchCommandResult(doneEntry);
          return;
        }

        if (command.op === 'addBuffToButtons') {
          if (!command.buff || typeof command.buff !== 'object') {
            throw new Error('addBuffToButtons requires buff');
          }
          const targetButtons = command.buttonIds.map((buttonId) => {
            const button = resolveWorkbenchButtonIdReference(buttonId);
            if (!button) {
              throw new Error(`技能按钮不存在: ${buttonId}`);
            }
            return button;
          });
          const results = targetButtons.map((button) => {
            const result = addBuffToButton(button.id, { ...command.buff, refCount: command.buff.refCount ?? 1 });
            if (!result.success) {
              throw new Error(`Buff 添加失败: ${formatWorkbenchButtonLabel(button)} / ${command.buff.displayName || command.buff.name || '未命名 Buff'}`);
            }
            recomputeSkillButtonPanel(button.id);
            if (result.buffId) {
              emitSkillButtonBuffAdded(button.id, result.buffId);
            }
            return {
              buttonId: button.id,
              label: formatWorkbenchButtonLabel(button),
              buffId: result.buffId,
              duplicate: result.isDuplicate,
            };
          });
          setResistanceRevision((value) => value + 1);
          const doneEntry = patchMainWorkbenchCommand(commandEntry.id, {
            status: 'done',
            result: {
              requestedCount: command.buttonIds.length,
              appliedCount: results.filter((item) => !item.duplicate).length,
              duplicateCount: results.filter((item) => item.duplicate).length,
              results,
            },
          });
          if (doneEntry) void pushMainWorkbenchCommandResult(doneEntry);
          return;
        }

        if (command.op === 'removeBuff') {
          const buttonId = findWorkbenchButtonId(command);
          if (!buttonId) {
            throw new Error('未找到可回退 Buff 的技能按钮');
          }
          const buffs = findWorkbenchBuffsForRemove(buttonId, command);
          if (buffs.length === 0) {
            throw new Error('未找到可回退的 Buff');
          }
          buffs.forEach((buff) => removeBuffFromButton(buttonId, buff.id));
          recomputeSkillButtonPanel(buttonId);
          setResistanceRevision((value) => value + 1);
          const doneEntry = patchMainWorkbenchCommand(commandEntry.id, {
            status: 'done',
            result: {
              buttonId,
              removedBuffIds: buffs.map((buff) => buff.id),
              removedBuffNames: buffs.map((buff) => buff.displayName || buff.name),
            },
          });
          if (doneEntry) void pushMainWorkbenchCommandResult(doneEntry);
          return;
        }

        if (command.op === 'setTargetResistance') {
          const persistedButton = getSkillButtonById(command.buttonId);
          if (!persistedButton) {
            throw new Error(`技能按钮不存在: ${command.buttonId}`);
          }
          const nextResistance = {
            ...EMPTY_BATCH_TARGET_RESISTANCE,
            ...Object.fromEntries(
              Object.entries(command.targetResistance).filter(([, value]) => typeof value === 'number' && Number.isFinite(value))
            ),
          };
          upsertSkillButton({
            ...persistedButton,
            resistanceConfig: { targetResistance: nextResistance },
            updatedAt: Date.now(),
          });
          recomputeSkillButtonPanel(command.buttonId);
          setResistanceRevision((value) => value + 1);
          const doneEntry = patchMainWorkbenchCommand(commandEntry.id, {
            status: 'done',
            result: { buttonId: command.buttonId, targetResistance: nextResistance },
          });
          if (doneEntry) void pushMainWorkbenchCommandResult(doneEntry);
          return;
        }

        if (command.op === 'saveTimelineSnapshot') {
          saveTimelineData();
          setSelectedCharacterIds(selectedCharacters.map((character) => character.id));
          const snapshot = createTimelineSnapshotEntry(command.label);
          if (!snapshot) {
            throw new Error('当前没有可保存的排轴数据');
          }
          const repository = await saveLegacySnapshotsToRepository();
          await repository.saveSnapshot({
            id: snapshot.id,
            timelineId: DEFAULT_TIMELINE_ID,
            label: snapshot.label,
            payload: snapshot.payload,
            createdAt: snapshot.createdAt,
          });
          const doneEntry = patchMainWorkbenchCommand(commandEntry.id, {
            status: 'done',
            result: {
              snapshotId: snapshot.id,
              label: snapshot.label,
              summary: snapshot.summary,
            },
          });
          if (doneEntry) void pushMainWorkbenchCommandResult(doneEntry);
          return;
        }

        if (command.op === 'restoreTimelineSnapshot') {
          const repository = await saveLegacySnapshotsToRepository();
          const snapshots = (await repository.listSnapshots(DEFAULT_TIMELINE_ID)).map((entry) => {
            const payload = entry.payload!;
            return {
              id: entry.id,
              label: entry.label,
              createdAt: entry.createdAt,
              payload,
              summary: {
                characterCount: payload.selectedCharacters.length,
                buttonCount: Object.keys(payload.skillButtonTable).length,
                buffCount: payload.allBuffList.length,
              },
            };
          });
          const snapshot = command.snapshotId
            ? snapshots.find((entry) => entry.id === command.snapshotId)
            : command.label
              ? snapshots.find((entry) => entry.label === command.label)
              : command.latest
                ? snapshots[0]
                : null;
          if (!snapshot) {
            throw new Error('未找到可恢复的排轴快照');
          }
          const persisted = await repository.saveSnapshot({
            id: snapshot.id,
            timelineId: DEFAULT_TIMELINE_ID,
            label: snapshot.label,
            payload: snapshot.payload,
            createdAt: snapshot.createdAt,
          });
          await repository.setCheckoutRef({
            timelineId: DEFAULT_TIMELINE_ID,
            targetType: 'snapshot',
            targetId: persisted.snapshot.id,
            updatedAt: Date.now(),
          });
          applyTimelineSnapshotPayload(snapshot.payload);
          const doneEntry = patchMainWorkbenchCommand(commandEntry.id, {
            status: 'done',
            result: { snapshotId: snapshot.id, label: snapshot.label, reloaded: command.reload !== false },
          });
          if (doneEntry) void pushMainWorkbenchCommandResult(doneEntry);
          if (command.reload !== false) {
            window.setTimeout(() => window.location.reload(), 80);
          }
          return;
        }

        if (command.op === 'listTimelineSnapshots') {
          const repository = await saveLegacySnapshotsToRepository();
          const snapshots = (await repository.listSnapshots(DEFAULT_TIMELINE_ID)).map((snapshot) => ({
            id: snapshot.id,
            label: snapshot.label,
            createdAt: snapshot.createdAt,
            summary: {
              characterCount: snapshot.payload?.selectedCharacters.length || 0,
              buttonCount: Object.keys(snapshot.payload?.skillButtonTable || {}).length,
              buffCount: snapshot.payload?.allBuffList.length || 0,
            },
          }));
          const doneEntry = patchMainWorkbenchCommand(commandEntry.id, { status: 'done', result: { snapshots } });
          if (doneEntry) void pushMainWorkbenchCommandResult(doneEntry);
          return;
        }

        if (command.op === 'createAiTimelineWorkNodeFromCurrent') {
          const result = await createAiTimelineWorkNodeFromCurrentCommand(command);
          const doneEntry = patchMainWorkbenchCommand(commandEntry.id, { status: 'done', result });
          if (doneEntry) void pushMainWorkbenchCommandResult(doneEntry);
          return;
        }

        if (command.op === 'diffAiTimelineWorkNode') {
          const result = await createAiTimelineWorkNodeClient().diff(command.nodeId);
          const doneEntry = patchMainWorkbenchCommand(commandEntry.id, { status: 'done', result });
          if (doneEntry) void pushMainWorkbenchCommandResult(doneEntry);
          return;
        }

        if (command.op === 'patchAiTimelineWorkNode') {
          const result = await patchAiTimelineWorkNodeFromCommand(command);
          if ('issues' in result) {
            const doneEntry = patchMainWorkbenchCommand(commandEntry.id, {
              status: 'error',
              result,
              error: result.issues.map((issue) => issue.message).join('；'),
            });
            if (doneEntry) void pushMainWorkbenchCommandResult(doneEntry);
            return;
          }
          const doneEntry = patchMainWorkbenchCommand(commandEntry.id, { status: 'done', result });
          if (doneEntry) void pushMainWorkbenchCommandResult(doneEntry);
          return;
        }

        if (command.op === 'patchAndValidateAiTimelineWorkNode') {
          const result = await patchAndValidateAiTimelineWorkNodeFromCommand(command);
          const doneEntry = patchMainWorkbenchCommand(commandEntry.id, {
            status: result.ok ? 'done' : 'error',
            result,
            ...(result.ok ? {} : { error: result.issues?.map((issue) => issue.message).join('；') || 'patch_and_validate failed' }),
          });
          if (doneEntry) void pushMainWorkbenchCommandResult(doneEntry);
          return;
        }

        if (command.op === 'checkoutAiTimelineWorkNode') {
          const result = await checkoutAiTimelineWorkNodeFromCommand(command);
          const doneEntry = patchMainWorkbenchCommand(commandEntry.id, { status: 'done', result });
          if (doneEntry) void pushMainWorkbenchCommandResult(doneEntry);
          return;
        }

        if (command.op === 'restoreAiTimelineWorkNodeBase') {
          const result = await restoreAiTimelineWorkNodeBaseFromCommand(command);
          const doneEntry = patchMainWorkbenchCommand(commandEntry.id, { status: 'done', result });
          if (doneEntry) void pushMainWorkbenchCommandResult(doneEntry);
          return;
        }

        if (command.op === 'refreshOperatorConfig') {
          await handleRefreshAvailableCandidates();
          const doneEntry = patchMainWorkbenchCommand(commandEntry.id, {
            status: 'done',
            result: { refreshed: true, characterCount: selectedCharacters.length },
          });
          if (doneEntry) void pushMainWorkbenchCommandResult(doneEntry);
          return;
        }

        if (command.op === 'setOperatorWeapon') {
          const result = await setOperatorWeaponFromWorkbenchCommand(command);
          const doneEntry = patchMainWorkbenchCommand(commandEntry.id, { status: 'done', result });
          if (doneEntry) void pushMainWorkbenchCommandResult(doneEntry);
          return;
        }

        if (command.op === 'setOperatorEquipment') {
          const result = await setOperatorEquipmentFromWorkbenchCommand(command);
          const doneEntry = patchMainWorkbenchCommand(commandEntry.id, { status: 'done', result });
          if (doneEntry) void pushMainWorkbenchCommandResult(doneEntry);
          return;
        }

        if (command.op === 'refreshSnapshot') {
          const snapshot = readMainWorkbenchSnapshot();
          if (snapshot) {
            await pushMainWorkbenchSnapshot(snapshot);
          }
          const doneEntry = patchMainWorkbenchCommand(commandEntry.id, {
            status: 'done',
            result: {
              refreshed: true,
              updatedAt: snapshot?.updatedAt ?? Date.now(),
              selectedCharacterCount: snapshot?.selectedCharacters.length ?? selectedCharacters.length,
              skillButtonCount: snapshot?.skillButtons.length ?? skillButtons.length,
            },
          });
          if (doneEntry) void pushMainWorkbenchCommandResult(doneEntry);
          return;
        }

        let timelineSkillButtonIds = timelineData.staffLines.flatMap((staffLine) =>
          (Array.isArray(staffLine.buttons) ? staffLine.buttons : []).map((button) => button.id)
        );
        const mirroredSnapshot = readMainWorkbenchSnapshot();
        const mirroredSkillButtons = Array.isArray(mirroredSnapshot?.skillButtons) ? mirroredSnapshot.skillButtons : [];
        if (timelineSkillButtonIds.length === 0 && mirroredSkillButtons.length > 0) {
          const mirroredSkillButtonTable = Object.fromEntries(mirroredSkillButtons.map((button) => [button.id, {
            id: button.id,
            characterId: button.characterId,
            characterName: button.characterName,
            skillType: button.skillType,
            staffIndex: button.staffIndex,
            nodeIndex: button.nodeIndex ?? 0,
            nodeNumber: button.nodeNumber ?? ((button.nodeIndex ?? 0) + 1),
            position: { x: 80 + (button.nodeIndex ?? 0) * 22, y: 60 + button.staffIndex * 300 },
            runtimeSkillId: button.runtimeSkillId,
            skillDisplayName: button.skillDisplayName,
            selectedBuff: [...(button.selectedBuffIds ?? [])],
            panelConfig: { selectedBuff: [...(button.selectedBuffIds ?? [])] },
            runtimeSnapshot: null,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          }]));
          const repairedTimelineData: TimelineData = {
            version: '1.0.0',
            createdAt: Date.now(),
            updatedAt: Date.now(),
            staffLines: selectedCharacters.map((character, index) => {
              const buttons = mirroredSkillButtons
                .filter((button) => button.staffIndex === index || button.characterId === character.id || button.characterName === character.name)
                .map((button) => ({
                  id: button.id,
                  characterId: button.characterId,
                  characterName: button.characterName,
                  skillType: button.skillType as SkillButtonType,
                  staffIndex: button.staffIndex,
                  nodeIndex: button.nodeIndex ?? 0,
                  nodeNumber: button.nodeNumber ?? ((button.nodeIndex ?? 0) + 1),
                  position: { x: 80 + (button.nodeIndex ?? 0) * 22, y: 60 + button.staffIndex * 300 },
                  runtimeSkillId: button.runtimeSkillId,
                  skillDisplayName: button.skillDisplayName,
                  buffIds: [...(button.selectedBuffIds ?? [])],
                }))
                .sort((left, right) => left.nodeIndex - right.nodeIndex);
              return {
                staffIndex: index,
                characterName: character.name,
                occupiedNodes: buttons.map((button) => button.nodeIndex).sort((left, right) => left - right),
                buttons,
              };
            }),
          };
          setSkillButtonTable(mirroredSkillButtonTable);
          saveTimelineRepo(repairedTimelineData);
          timelineSkillButtonIds = repairedTimelineData.staffLines.flatMap((staffLine) => staffLine.buttons.map((button) => button.id));
        }
        const persistedSkillButtonTable = getSkillButtonTable();
        const persistedSkillButtonIds = Object.keys(persistedSkillButtonTable);
        if (timelineSkillButtonIds.length === 0 && persistedSkillButtonIds.length > 0) {
          const repairedTimelineData: TimelineData = {
            version: '1.0.0',
            createdAt: Date.now(),
            updatedAt: Date.now(),
            staffLines: selectedCharacters.map((character, index) => {
              const buttons = Object.values(persistedSkillButtonTable)
                .filter((button) => button.staffIndex === index || button.characterId === character.id || button.characterName === character.name)
                .map((button) => ({
                  id: button.id,
                  characterId: button.characterId,
                  characterName: button.characterName,
                  skillType: button.skillType as SkillButtonType,
                  staffIndex: button.staffIndex,
                  nodeIndex: button.nodeIndex,
                  nodeNumber: button.nodeNumber,
                  position: button.position,
                  runtimeSkillId: button.runtimeSkillId,
                  skillDisplayName: button.skillDisplayName,
                  skillIconUrl: button.skillIconUrl,
                  customHits: button.customHits,
                  buffIds: [...(button.selectedBuff ?? [])],
                }))
                .sort((left, right) => left.nodeIndex - right.nodeIndex);
              return {
                staffIndex: index,
                characterName: character.name,
                occupiedNodes: buttons.map((button) => button.nodeIndex).sort((left, right) => left - right),
                buttons,
              };
            }),
          };
          saveTimelineRepo(repairedTimelineData);
          timelineSkillButtonIds = repairedTimelineData.staffLines.flatMap((staffLine) => staffLine.buttons.map((button) => button.id));
        }
        const currentSkillButtonIds = skillButtons.length > 0
          ? skillButtons.map((button) => button.id)
          : timelineSkillButtonIds.length > 0
            ? timelineSkillButtonIds
            : persistedSkillButtonIds;
        const snapshot = buildDamageReportSnapshot({ buttonIds: currentSkillButtonIds });
        const result = command.op === 'calculateDamage' && command.buttonId
          ? {
              ...snapshot,
              buttons: snapshot.buttons.filter((button) => button.id === command.buttonId),
            }
          : snapshot;
        const doneEntry = patchMainWorkbenchCommand(commandEntry.id, { status: 'done', result });
        if (doneEntry) void pushMainWorkbenchCommandResult(doneEntry);
      } catch (error) {
        const errorEntry = patchMainWorkbenchCommand(commandEntry.id, {
          status: 'error',
          error: error instanceof Error ? error.message : String(error),
        });
        if (errorEntry) void pushMainWorkbenchCommandResult(errorEntry);
      }
    } finally {
      isProcessingWorkbenchCommandRef.current = false;
    }
  };

  useEffect(() => {
    const selectedCharacterSignature = selectedCharacters.map((character) => character.id).join('|');
    const isEnteringCanvas = previousViewRef.current !== 'canvas' && currentView === 'canvas';
    previousViewRef.current = currentView;

    if (selectedCharacters.length === 0) {
      restoredSignatureRef.current = null;
      dispatch({ type: 'CLEAR_SKILL_BUTTONS' });
      return;
    }

    if (currentView !== 'canvas') {
      return;
    }

    if (restoredSignatureRef.current === selectedCharacterSignature && !isEnteringCanvas) {
      return;
    }
    restoredSignatureRef.current = selectedCharacterSignature;

    const loadedData = loadTimelineData();
    if (!loadedData) {
      dispatch({ type: 'CLEAR_SKILL_BUTTONS' });
      return;
    }

    let dataToRestore = loadedData;
    if (loadedData.staffLines.length < selectedCharacters.length) {
      dataToRestore = normalizeTimelineData(loadedData, selectedCharacters);
    }

    const gridStackElement = canvasRef.current?.querySelector('.canvas-grid-stack');
    const restoredGridContentOffsetX =
      canvasRef.current && gridStackElement
        ? getGridContentOffsetX(canvasRef.current, gridStackElement)
        : null;

    const restoredButtons: SkillButton[] = [];
    const nextTimelineData = {
      ...dataToRestore,
      staffLines: dataToRestore.staffLines.map((staffLine) => ({
        ...staffLine,
        buttons: Array.isArray(staffLine.buttons) ? [...staffLine.buttons] : [],
      })),
    };
    const currentSkillButtonTable = getSkillButtonTable();
    const nextSkillButtonTable = { ...currentSkillButtonTable };
    let hasMetadataSync = false;

    dataToRestore.staffLines.forEach((staffLine, staffLineIndex) => {
      const buttons = Array.isArray(staffLine.buttons) ? staffLine.buttons : [];
      buttons.forEach((btn, buttonIndex) => {
        const character = selectedCharacters.find((item) => item.name === btn.characterName);
        const lineIndex = selectedCharacters.findIndex(
          character => character.name === btn.characterName
        );
        const restoredGroupIndex =
          typeof btn.nodeIndex === 'number' && Number.isFinite(btn.nodeIndex)
            ? Math.floor(btn.nodeIndex / GRID_NODE_COUNT)
            : 0;
        const restoredNodeIndex =
          typeof btn.nodeIndex === 'number' && Number.isFinite(btn.nodeIndex)
            ? btn.nodeIndex % GRID_NODE_COUNT
            : 0;
        const restoredLineIndex = lineIndex >= 0 ? lineIndex : 0;
        const normalizedPositionY =
          getGridGroupTop(restoredGroupIndex) +
          getGridLineCenterY(restoredLineIndex) +
          SKILL_BUTTON_BASELINE_OFFSET_Y;
        const normalizedPositionX =
          restoredGridContentOffsetX !== null
            ? restoredGridContentOffsetX + getGridNodeCenterX(restoredNodeIndex)
            : btn.position.x;
        const position = { x: normalizedPositionX, y: normalizedPositionY };
        const restoredButtonCharacterId = character?.id ?? btn.characterId ?? btn.characterName;
        const resolvedRuntimeSkill = resolveRuntimeTemplateSkill({
          id: btn.id,
          characterId: restoredButtonCharacterId,
          characterName: btn.characterName,
          skillType: btn.skillType,
          position,
          staffIndex: restoredGroupIndex,
          lineIndex: lineIndex >= 0 ? lineIndex : 0,
          isDragging: false,
          isSelected: false,
          isFromSandbox: true,
          runtimeSkillId: btn.runtimeSkillId,
          skillDisplayName: btn.skillDisplayName,
          skillIconUrl: btn.skillIconUrl,
          customHits: btn.customHits,
          element: character?.element,
        });
        const nextRuntimeSkillId = resolvedRuntimeSkill?.id ?? btn.runtimeSkillId;
        const nextSkillDisplayName = resolvedRuntimeSkill?.displayName || btn.skillDisplayName;
        const nextSkillIconUrl = resolvedRuntimeSkill?.iconUrl
          ?? btn.skillIconUrl
          ?? resolveSkillIconUrl(btn.characterName, btn.skillType);

        if (
          btn.runtimeSkillId !== nextRuntimeSkillId
          || btn.skillDisplayName !== nextSkillDisplayName
          || btn.skillIconUrl !== nextSkillIconUrl
        ) {
          hasMetadataSync = true;
          nextTimelineData.staffLines[staffLineIndex].buttons[buttonIndex] = {
            ...btn,
            runtimeSkillId: nextRuntimeSkillId,
            skillDisplayName: nextSkillDisplayName,
            skillIconUrl: nextSkillIconUrl,
          };
          const persistedButton = nextSkillButtonTable[btn.id];
          if (persistedButton) {
            nextSkillButtonTable[btn.id] = {
              ...persistedButton,
              runtimeSkillId: nextRuntimeSkillId,
              skillDisplayName: nextSkillDisplayName,
              skillIconUrl: nextSkillIconUrl,
              updatedAt: Date.now(),
            };
          }
        }

        restoredButtons.push({
          id: btn.id,
          characterId: restoredButtonCharacterId,
          characterName: btn.characterName,
          skillType: btn.skillType,
          position,
          staffIndex: restoredGroupIndex,
          lineIndex: lineIndex >= 0 ? lineIndex : 0,
          nodeIndex: restoredNodeIndex,
          nodeNumber: calculateNodeNumber(restoredNodeIndex),
          isDragging: false,
          isSelected: false,
          isFromSandbox: true,
          runtimeSkillId: nextRuntimeSkillId,
          skillDisplayName: nextSkillDisplayName,
          skillIconUrl: nextSkillIconUrl,
          customHits: btn.customHits,
          element: character?.element,
        });
      });
    });

    if (hasMetadataSync) {
      saveTimelineRepo(nextTimelineData);
      setSkillButtonTable(nextSkillButtonTable);
      console.log('[CanvasBoard] 恢复排轴时已按当前模板同步技能元数据', {
        buttonCount: restoredButtons.length,
      });
    }

    dispatch({ type: 'CLEAR_SKILL_BUTTONS' });
    restoredButtons.forEach((button) => {
      dispatch({ type: 'ADD_SKILL_BUTTON', button });
    });
  }, [currentView, dispatch, loadTimelineData, normalizeTimelineData, selectedCharacters]);

  useEffect(() => {
    return onSkillButtonBuffAdded(({ buttonId, buffId }) => {
      if (!buttonId || !buffId) return;
      console.log('[Buff event] added:', buttonId, buffId);
    });
  }, []);

  useEffect(() => {
    return onSkillButtonBuffRemoved(({ buttonId, buffId }) => {
      if (!buttonId || !buffId) return;
      console.log('[Buff event] removed:', buttonId, buffId);
    });
  }, []);

  const { draggingState, mousePosition, handleSandboxDragStart, handleButtonMouseDown } = useCanvasDrag({
    disabled: isAiMode,
    config: canvasConfig,
    canvasWidth,
    staffCount,
    selectedCharacters,
    skillButtons,
    canvasRef,
    dispatch,
    addTimelineButton,
    updateSkillButtonPosition,
    moveTimelineButtonToStaff: moveSkillButtonToStaff,
  });

  useEffect(() => {
    if (currentView !== 'canvas' || selectedCharacters.length === 0) {
      return undefined;
    }
    void processMainWorkbenchCanvasCommand();
    const handleControlEvent = () => {
      void processMainWorkbenchCanvasCommand();
    };
    const timer = window.setInterval(() => {
      void processMainWorkbenchCanvasCommand();
    }, 1200);
    window.addEventListener('def-main-workbench-control', handleControlEvent);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('def-main-workbench-control', handleControlEvent);
    };
  }, [currentView, selectedCharacters, skillButtons, staffCount]);

  useEffect(() => {
    if (!isAiMode) {
      return undefined;
    }

    const handlePointerMove = (event: PointerEvent) => {
      updateAiHoverZoneFromClientX(event.clientX);
    };

    window.addEventListener('pointermove', handlePointerMove, { passive: true });
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
    };
  }, [isAiMode]);

  useEffect(() => {
    if (currentView !== 'canvas') {
      return;
    }
    const timelineButtons = timelineData.staffLines.flatMap((staffLine) =>
      (Array.isArray(staffLine.buttons) ? staffLine.buttons : []).map((button) => ({
        ...button,
        staffIndex: staffLine.staffIndex,
      }))
    );
    const currentSkillButtonIds = skillButtons.length > 0
      ? skillButtons.map((button) => button.id)
      : timelineButtons.map((button) => button.id);
    const computedDamageReport = buildDamageReportSnapshot({ buttonIds: currentSkillButtonIds });
    const operatorConfigCache = getOperatorConfigPageCache();
    const persistedButtonTable = getSkillButtonTable();
    const mirroredButtons: MainWorkbenchSnapshot['skillButtons'] = skillButtons.length > 0
      ? skillButtons.map((button) => {
          const persistedButton = persistedButtonTable[button.id];
          return {
            id: button.id,
            characterId: button.characterId,
            characterName: button.characterName,
            skillType: button.skillType,
            runtimeSkillId: button.runtimeSkillId,
            skillDisplayName: button.skillDisplayName,
            staffIndex: button.staffIndex,
            lineIndex: button.lineIndex,
            nodeIndex: button.nodeIndex,
            nodeNumber: button.nodeNumber,
            selectedBuffIds: [...(persistedButton?.selectedBuff ?? [])],
            selectedBuffs: getBuffsByButtonId(button.id).map((buff) => ({
              id: buff.id,
              name: buff.name,
              displayName: buff.displayName,
              sourceName: buff.sourceName,
              level: buff.level,
              type: buff.type,
              value: buff.value,
              description: buff.description,
              source: buff.source,
              condition: buff.condition,
              category: buff.category,
              effectKind: buff.effectKind,
            })),
          };
        })
      : timelineButtons.length > 0
        ? timelineButtons.map((button) => {
          const persistedButton = persistedButtonTable[button.id];
          return {
            id: button.id,
            characterId: persistedButton?.characterId ?? button.characterName,
            characterName: button.characterName,
            skillType: button.skillType as SkillButtonType,
            runtimeSkillId: button.runtimeSkillId,
            skillDisplayName: button.skillDisplayName,
            staffIndex: button.staffIndex,
            lineIndex: selectedCharacters.findIndex((character) => character.name === button.characterName),
            nodeIndex: button.nodeIndex,
            nodeNumber: button.nodeNumber,
            selectedBuffIds: [...(persistedButton?.selectedBuff ?? [])],
            selectedBuffs: getBuffsByButtonId(button.id).map((buff) => ({
              id: buff.id,
              name: buff.name,
              displayName: buff.displayName,
              sourceName: buff.sourceName,
              level: buff.level,
              type: buff.type,
              value: buff.value,
              description: buff.description,
              source: buff.source,
              condition: buff.condition,
              category: buff.category,
              effectKind: buff.effectKind,
            })),
          };
        })
      : Object.values(persistedButtonTable).map((button) => ({
          id: button.id,
          characterId: button.characterId ?? '',
          characterName: button.characterName,
          skillType: button.skillType as SkillButtonType,
          runtimeSkillId: button.runtimeSkillId,
          skillDisplayName: button.skillDisplayName,
          staffIndex: button.staffIndex,
          lineIndex: selectedCharacters.findIndex((character) => (
            character.id === button.characterId || character.name === button.characterName
          )),
          nodeIndex: button.nodeIndex,
          nodeNumber: button.nodeNumber,
          selectedBuffIds: [...(button.selectedBuff ?? [])],
          selectedBuffs: getBuffsByButtonId(button.id).map((buff) => ({
            id: buff.id,
            name: buff.name,
            displayName: buff.displayName,
            sourceName: buff.sourceName,
            level: buff.level,
            type: buff.type,
            value: buff.value,
            description: buff.description,
            source: buff.source,
            condition: buff.condition,
            category: buff.category,
            effectKind: buff.effectKind,
          })),
        }));
    const mirroredSelectedCharacters: MainWorkbenchSnapshot['selectedCharacters'] = selectedCharacters.map((character) => ({
      id: character.id,
      name: character.name,
      element: character.element,
      profession: character.profession,
      librarySource: character.librarySource,
    }));
    const mirroredOperatorConfigs: MainWorkbenchSnapshot['operatorConfigs'] = selectedCharacters.flatMap((character) => {
      const configSnapshot = operatorConfigCache[character.id];
      if (!configSnapshot) return [];
      return [{
        characterId: character.id,
        characterName: character.name,
        weapon: {
          id: configSnapshot.weapon.id,
          name: configSnapshot.weapon.name,
          level: configSnapshot.weapon.config.level,
          potential: configSnapshot.weapon.config.potential,
          attack: configSnapshot.weapon.attack,
        },
        equipment: configSnapshot.equipment.pieces.map((piece) => ({
          slotKey: piece.slotKey,
          equipmentId: piece.equipmentId,
          name: piece.name,
          part: piece.part,
          effects: piece.effects.map((effect) => ({
            effectId: effect.effectId,
            label: effect.label,
            typeKey: effect.typeKey,
            level: effect.level,
            value: effect.value,
          })),
        })),
        setBuffs: configSnapshot.equipment.setBuffs.map((buff) => ({
          gearSetId: buff.gearSetId,
          gearSetName: buff.gearSetName,
          effectId: buff.effectId,
          label: buff.label,
          typeKey: buff.typeKey,
          value: buff.value,
          category: buff.category,
          effectKind: buff.effectKind,
        })),
      }];
    });
    if (isCheckoutBootstrapPendingRef.current) return;
    const previousSnapshot = readMainWorkbenchSnapshot();
    const currentSignature = buildMainWorkbenchSnapshotSignature(mirroredSelectedCharacters, mirroredButtons, mirroredOperatorConfigs);
    const previousSignature = previousSnapshot
      ? buildMainWorkbenchSnapshotSignature(previousSnapshot.selectedCharacters, previousSnapshot.skillButtons, previousSnapshot.operatorConfigs)
      : '';
    const canReusePreviousDamageReport = computedDamageReport.buttonCount === 0 &&
      mirroredButtons.length > 0 &&
      previousSnapshot?.damageReport &&
      previousSnapshot.damageReport.buttonCount === mirroredButtons.length &&
      previousSignature === currentSignature;
    const damageReport = canReusePreviousDamageReport && previousSnapshot?.damageReport
      ? previousSnapshot.damageReport
      : computedDamageReport;
    const snapshot = {
      schemaVersion: 1 as const,
      updatedAt: Date.now(),
      source: 'app' as const,
      currentView,
      selectedCharacters: mirroredSelectedCharacters,
      skillButtons: mirroredButtons,
      damageReport: {
        generatedAt: damageReport.generatedAt,
        totalExpected: damageReport.totalExpected,
        totalNonCrit: damageReport.totalNonCrit,
        buttonCount: damageReport.buttonCount,
        buttons: damageReport.buttons,
      },
      operatorConfigs: mirroredOperatorConfigs,
    };
    writeMainWorkbenchSnapshot(snapshot);
    void pushMainWorkbenchSnapshot(snapshot);
  }, [checkoutBootstrapRevision, currentView, selectedCharacters, skillButtons, timelineData, resistanceRevision]);

  const [contextMenuState, setContextMenuState] = useState<{
    buttonId: string;
    position: { x: number; y: number };
  } | null>(null);

  const [pendingCopy, setPendingCopy] = useState<{
    sourceButtonId: string;
    sourceButtonRuntime: SkillButton;
    sourceButtonConfig: ReturnType<typeof clonePersistedSkillButtonConfig>;
  } | null>(null);

  const [copyHintMousePosition, setCopyHintMousePosition] = useState({ x: 0, y: 0 });

  const findCharacterForButton = (button: SkillButton): Character | undefined => {
    return selectedCharacters.find((character) => character.id === button.characterId)
      ?? selectedCharacters.find((character) => character.name === button.characterName);
  };

  const getCharacterSkillList = (button: SkillButton): SandboxSkill[] => {
    const character = findCharacterForButton(button);
    if (Array.isArray(character?.sandboxSkills) && character.sandboxSkills.length > 0) {
      return character.sandboxSkills;
    }

    const runtimeSkills = buildSandboxSkillsFromRuntimeTemplate(character?.id ?? button.characterId);
    if (runtimeSkills.length > 0) {
      return runtimeSkills;
    }

    if (!character) {
      return [];
    }

    return (['A', 'B', 'E', 'Q'] as const).map((skillType) => ({
      id: `fallback-${character.id}-${skillType}`,
      displayName: skillType,
      buttonType: skillType,
      iconUrl: character.skillIconMap?.[skillType] ?? resolveSkillIconUrl(character.name, skillType),
      hitCount: 1,
      source: character.librarySource ?? 'official',
    }));
  };

  const isSameSkillOption = (button: SkillButton, option: SkillButtonSkillOption): boolean => {
    if (button.runtimeSkillId && option.nextRuntimeSkillId) {
      return button.runtimeSkillId === option.nextRuntimeSkillId;
    }

    if (button.skillDisplayName && option.nextSkillDisplayName) {
      return button.skillType === option.nextSkillType && button.skillDisplayName === option.nextSkillDisplayName;
    }

    return button.skillType === option.nextSkillType && !button.runtimeSkillId;
  };

  const getSkillChangeOptions = (button: SkillButton): SkillButtonSkillOption[] => {
    const character = findCharacterForButton(button);
    return getCharacterSkillList(button)
      .map((skill) => ({
        nextSkillType: skill.buttonType,
        nextRuntimeSkillId: skill.id,
        nextSkillDisplayName: skill.displayName,
        nextSkillIconUrl: skill.iconUrl
          ?? character?.skillIconMap?.[skill.buttonType]
          ?? resolveSkillIconUrl(button.characterName, skill.buttonType),
        nextCustomHits: skill.customHits,
      }))
      .filter((option) => !isSameSkillOption(button, option));
  };

  useEffect(() => {
    if (!pendingCopy) return;

    const handleMouseMove = (e: MouseEvent) => {
      setCopyHintMousePosition({ x: e.clientX, y: e.clientY });
    };

    window.addEventListener('mousemove', handleMouseMove);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
    };
  }, [pendingCopy]);

  const handleConfirmRemoveSkillButton = () => {
    if (!contextMenuState) return;
    const { buttonId } = contextMenuState;
    const button = skillButtons.find(item => item.id === buttonId);
    if (button?.isLocked) {
      return;
    }
    if (button && button.lineIndex !== undefined) {
      removeTimelineButton(button.lineIndex, buttonId);
    }
    dispatch({ type: 'REMOVE_SKILL_BUTTON', buttonId });
    setContextMenuState(null);
  };

  const handleCloseButtonContextMenu = () => {
    setContextMenuState(null);
  };

  const handleCopySkillButton = () => {
    if (!contextMenuState) return;
    const { buttonId } = contextMenuState;
    const buttonRuntime = skillButtons.find(item => item.id === buttonId);
    if (!buttonRuntime) return;

    const buttonStorage = getSkillButtonById(buttonId);
    if (!buttonStorage) return;

    setPendingCopy({
      sourceButtonId: buttonId,
      sourceButtonRuntime: buttonRuntime,
      sourceButtonConfig: clonePersistedSkillButtonConfig(buttonStorage),
    });
    setContextMenuState(null);
  };

  const handleBack = () => {
    dispatch({ type: 'SET_VIEW', view: 'selection' });
    dispatch({ type: 'SELECT_SKILL_BUTTON', buttonId: null });
    setPendingCopy(null);
  };

  const handleAddStaffGroup = () => {
    if (staffCount < 5) {
      setStaffCount(prev => prev + 1);
    }
  };

  const handleRemoveStaffGroup = () => {
    if (staffCount > 2) {
      setStaffCount(prev => prev - 1);
    }
  };

  const handleButtonContextMenu = (event: React.MouseEvent, buttonId: string) => {
    event.preventDefault();
    event.stopPropagation();

    const button = skillButtons.find(item => item.id === buttonId);
    if (button?.isLocked) {
      return;
    }

    dispatch({ type: 'SELECT_SKILL_BUTTON', buttonId });
    setContextMenuState({
      buttonId,
      position: { x: event.clientX, y: event.clientY },
    });
  };

  const handleChangeSkillType = (payload: SkillButtonSkillChangePayload) => {
    const button = skillButtons.find(item => item.id === payload.buttonId);
    if (!button) return;

    const resolvedTarget = getSkillChangeOptions(button).find((option) => {
      if (payload.nextRuntimeSkillId && option.nextRuntimeSkillId) {
        return option.nextRuntimeSkillId === payload.nextRuntimeSkillId;
      }
      if (payload.nextSkillDisplayName && option.nextSkillDisplayName) {
        return option.nextSkillType === payload.nextSkillType && option.nextSkillDisplayName === payload.nextSkillDisplayName;
      }
      return option.nextSkillType === payload.nextSkillType;
    });

    if (!resolvedTarget) {
      console.warn(`[改类型] 失败: 按钮 ${payload.buttonId} 未找到目标技能项`);
      return;
    }

    const result = updateTimelineButtonType({
      buttonId: payload.buttonId,
      ...resolvedTarget,
    });
    if (!result) {
      console.warn(`[改类型] 失败: 按钮 ${payload.buttonId} 不存在于 timelineData`);
      return;
    }

    dispatch({
      type: 'UPDATE_SKILL_BUTTON_TYPE',
      buttonId: payload.buttonId,
      skillType: result.skillType ?? resolvedTarget.nextSkillType,
      runtimeSkillId: result.runtimeSkillId,
      skillDisplayName: result.skillDisplayName,
      skillIconUrl: result.skillIconUrl,
      customHits: result.customHits,
    });

    console.log(
      `[改类型] buttonId=${payload.buttonId}, ${button.skillType} -> ${resolvedTarget.nextSkillType}, runtimeSkillId=${resolvedTarget.nextRuntimeSkillId ?? 'N/A'}`
    );
  };

  const handleCanvasClick = () => {
    dispatch({ type: 'SELECT_SKILL_BUTTON', buttonId: null });
    setContextMenuState(null);
  };

  const handleCanvasPlaceCopy = (e: React.MouseEvent) => {
    if (!pendingCopy) {
      dispatch({ type: 'SELECT_SKILL_BUTTON', buttonId: null });
      setContextMenuState(null);
      return;
    }
    if (!canvasRef.current) return;

    const canvasRect = canvasRef.current.getBoundingClientRect();
    const gridStackEl = canvasRef.current.querySelector('.canvas-grid-stack');
    if (!gridStackEl) return;

    const gridStackRect = gridStackEl.getBoundingClientRect();
    const { gridX, gridY } = clientToGridCoords(e.clientX, e.clientY, canvasRect, gridStackRect);

    const sourceLineIndex = pendingCopy.sourceButtonRuntime.lineIndex;
    const staffIndex = findNearestStaffIndex(gridY, staffCount);
    const lineY = getGridGroupTop(staffIndex) + getGridLineCenterY(sourceLineIndex);

    const gridContentOffsetX = getGridContentOffsetX(canvasRef.current, gridStackEl);
    const occupiedNodeIndices = getOccupiedNodeIndicesForLine(
      skillButtons,
      staffIndex,
      sourceLineIndex,
      null,
      gridContentOffsetX
    );

    const snappedResult = resolveSnappedGridNode(gridX, occupiedNodeIndices);
    if (!snappedResult) {
      console.log('[复制吸附] 满行无可用节点，取消复制');
      setPendingCopy(null);
      return;
    }

    const { nodeIndex: snappedNodeIndex, nodeCenterX } = snappedResult;

    const snappedPosition = gridToCanvasContentCoords(
      nodeCenterX,
      lineY,
      canvasRef.current,
      gridStackEl
    );

    handlePlaceCopiedButton(staffIndex, sourceLineIndex, snappedNodeIndex, snappedPosition);
  };

  const handlePlaceCopiedButton = (
    targetStaffIndex: number,
    targetLineIndex: number,
    targetNodeIndex: number,
    targetPosition: { x: number; y: number }
  ) => {
    if (!pendingCopy) return;

    const { sourceButtonRuntime, sourceButtonConfig } = pendingCopy;
    const newButtonId = generateId();

    const newButtonRuntime: SkillButton = {
      ...sourceButtonRuntime,
      id: newButtonId,
      staffIndex: targetStaffIndex,
      lineIndex: targetLineIndex,
      nodeIndex: targetNodeIndex,
      nodeNumber: calculateNodeNumber(targetNodeIndex),
      position: targetPosition,
      isDragging: false,
      isSelected: false,
    };

    dispatch({ type: 'ADD_SKILL_BUTTON', button: newButtonRuntime });

    const persistenceStaffIndex = targetLineIndex;
    const persistenceNodeIndex = targetStaffIndex * GRID_NODE_COUNT + targetNodeIndex;
    addTimelineButton({
      characterId: sourceButtonRuntime.characterId,
      characterName: sourceButtonRuntime.characterName,
      skillType: sourceButtonRuntime.skillType,
      staffIndex: persistenceStaffIndex,
      nodeIndex: persistenceNodeIndex,
      position: targetPosition,
      runtimeSkillId: sourceButtonRuntime.runtimeSkillId,
      skillDisplayName: sourceButtonRuntime.skillDisplayName,
      skillIconUrl: sourceButtonRuntime.skillIconUrl,
      customHits: sourceButtonRuntime.customHits,
    }, newButtonId);

    if (sourceButtonConfig.selectedBuff.length > 0) {
      attachExistingBuffsToButton(newButtonId, sourceButtonConfig.selectedBuff);
    }

    const createdButton = getSkillButtonById(newButtonId);
    if (createdButton) {
      upsertSkillButton({
        ...createdButton,
        selectedBuff: [...sourceButtonConfig.selectedBuff],
        buffStackCounts: { ...(sourceButtonConfig.buffStackCounts ?? {}) },
        anomalyConfig: sourceButtonConfig.anomalyConfig,
        resistanceConfig: sourceButtonConfig.resistanceConfig,
        panelConfig: sourceButtonConfig.panelConfig
          ? {
              ...sourceButtonConfig.panelConfig,
              selectedBuff: [...sourceButtonConfig.selectedBuff],
            }
          : {
              selectedBuff: [...sourceButtonConfig.selectedBuff],
            },
        runtimeSnapshot: sourceButtonConfig.runtimeSnapshot,
        updatedAt: Date.now(),
      });
      recomputeSkillButtonPanel(newButtonId);
    }

    setPendingCopy(null);
  };

  const handleAvatarDoubleClick = (characterId: string) => {
    safeSessionStorage.setItem(STORAGE_KEYS.OPERATOR_CONFIG_ACTIVE_CHARACTER, characterId);
    if (onOpenOperatorConfig) {
      onOpenOperatorConfig(characterId);
      return;
    }
    navigateToAppPath(APP_ROUTE_PATHS.operatorConfig);
  };

  const handleOpenBatchResistanceModal = () => {
    const firstButton = skillButtons[0] ? getSkillButtonById(skillButtons[0].id) : null;
    setBatchTargetResistance({
      ...EMPTY_BATCH_TARGET_RESISTANCE,
      ...(firstButton?.resistanceConfig?.targetResistance ?? {}),
    });
    setIsBatchResistanceModalOpen(true);
  };

  const handleCloseBatchResistanceModal = () => {
    setIsBatchResistanceModalOpen(false);
  };

  const handleApplyBatchResistance = () => {
    const currentTable = getSkillButtonTable();
    const updatedAt = Date.now();
    const targetResistance = { ...batchTargetResistance };
    let updatedCount = 0;

    skillButtons.forEach((button) => {
      const persistedButton = currentTable[button.id];
      if (!persistedButton) {
        return;
      }
      currentTable[button.id] = {
        ...persistedButton,
        resistanceConfig: { targetResistance: { ...targetResistance } },
        updatedAt,
      };
      updatedCount += 1;
    });

    if (updatedCount > 0) {
      setSkillButtonTable(currentTable);
      setResistanceRevision((revision) => revision + 1);
    }
    setIsBatchResistanceModalOpen(false);
  };

  const refreshTimelineSnapshotList = async () => {
    try {
      const repository = createTimelineRepositoryClient();
      await repository.ensureDocument({ id: DEFAULT_TIMELINE_ID, label: '主排轴' });
      const snapshots = await repository.listSnapshots(DEFAULT_TIMELINE_ID);
      const repositoryEntries = snapshots.map((snapshot) => {
        const payload = snapshot.payload!;
        const buttonCount = payload.timelineData.staffLines.reduce((count, line) => count + (line.buttons?.length || 0), 0);
        return { id: snapshot.id, createdAt: snapshot.createdAt, label: snapshot.label, payload,
          summary: { characterCount: payload.selectedCharacters.length, buttonCount, buffCount: payload.allBuffList.length } };
      });
      // Old browser archives remain visible until their first save/restore.  Do not
      // hide them merely because the repository is already available.
      const repositoryIds = new Set(repositoryEntries.map((snapshot) => snapshot.id));
      setTimelineSnapshots([...repositoryEntries, ...listTimelineSnapshots().filter((snapshot) => !repositoryIds.has(snapshot.id))]
        .sort((left, right) => right.createdAt - left.createdAt));
    } catch {
      setTimelineSnapshots(listTimelineSnapshots());
    }
  };

  const saveLegacySnapshotsToRepository = async () => {
    const repository = createTimelineRepositoryClient();
    await repository.ensureDocument({ id: DEFAULT_TIMELINE_ID, label: '主排轴' });
    const legacySnapshots = listTimelineSnapshots();
    for (const legacySnapshot of legacySnapshots) {
      await repository.saveSnapshot({
        id: legacySnapshot.id,
        timelineId: DEFAULT_TIMELINE_ID,
        label: legacySnapshot.label,
        payload: legacySnapshot.payload,
        createdAt: legacySnapshot.createdAt,
      });
    }
    if (legacySnapshots.length > 0) clearLegacyTimelineSnapshotArchive();
    return repository;
  };

  const handleOpenSaveSnapshotModal = () => {
    setSnapshotDraftName('');
    setIsSaveSnapshotModalOpen(true);
  };

  const handleCloseSaveSnapshotModal = () => {
    setIsSaveSnapshotModalOpen(false);
    setSnapshotDraftName('');
  };

  const handleSaveTimelineSnapshot = async () => {
    saveTimelineData();
    setSelectedCharacterIds(selectedCharacters.map((character) => character.id));

    const snapshot = createTimelineSnapshotEntry(snapshotDraftName);
    if (!snapshot) {
      alert('当前没有可保存的排轴数据');
      return;
    }

    try {
      // A new save is the migration boundary for pre-Spec-5 browser archives.
      // Import them first so future restores no longer depend on localStorage.
      const repository = await saveLegacySnapshotsToRepository();
      const saved = await repository.saveSnapshot({
        id: snapshot.id,
        timelineId: DEFAULT_TIMELINE_ID,
        label: snapshot.label,
        payload: snapshot.payload,
        createdAt: snapshot.createdAt,
      });
      const persistedSnapshot = { ...snapshot, id: saved.snapshot.id, label: saved.snapshot.label, createdAt: saved.snapshot.createdAt };
      setTimelineSnapshots((current) => [persistedSnapshot, ...current.filter((item) => item.id !== saved.snapshot.id)]);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      alert(`快照保存失败：${message}`);
      return;
    }
    handleCloseSaveSnapshotModal();
    alert(`快照已保存：${snapshot.label}`);
  };

  const handleOpenSnapshotModal = () => {
    void refreshTimelineSnapshotList();
    setIsSnapshotModalOpen(true);
  };

  const handleCloseSnapshotModal = () => {
    setIsSnapshotModalOpen(false);
    setPendingRestoreSnapshot(null);
  };

  const handleRequestRestoreSnapshot = (snapshot: TimelineSnapshotEntry) => {
    setPendingRestoreSnapshot(snapshot);
  };

  const handleCancelRestoreSnapshot = () => {
    setPendingRestoreSnapshot(null);
  };

  const handleConfirmRestoreSnapshot = async () => {
    if (!pendingRestoreSnapshot) {
      return;
    }

    try {
      // A snapshot shown from the legacy archive has no repository row yet.  Upsert
      // it before writing CheckoutRef so restoring an old save cannot fail with 404.
      const repository = await saveLegacySnapshotsToRepository();
      const persisted = await repository.saveSnapshot({
        id: pendingRestoreSnapshot.id,
        timelineId: DEFAULT_TIMELINE_ID,
        label: pendingRestoreSnapshot.label,
        payload: pendingRestoreSnapshot.payload,
        createdAt: pendingRestoreSnapshot.createdAt,
      });
      await repository.setCheckoutRef({
        timelineId: DEFAULT_TIMELINE_ID,
        targetType: 'snapshot',
        targetId: persisted.snapshot.id,
        updatedAt: Date.now(),
      });
      applyTimelineSnapshotPayload(pendingRestoreSnapshot.payload);
    } catch (error) {
      alert(`恢复失败：${error instanceof Error ? error.message : String(error)}`);
      return;
    }

    setPendingRestoreSnapshot(null);
    window.location.reload();
  };

  const handleDeleteSnapshot = async (snapshotId: string) => {
    try {
      await createTimelineRepositoryClient().archiveSnapshot(snapshotId);
      await refreshTimelineSnapshotList();
    } catch (error) {
      alert(`删除快照失败：${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const handleOpenShareModal = () => {
    setShareDraftName('');
    setShareScope('snapshot');
    setShareBranchRootId('');
    setShareWorkNodes([]);
    setIsShareModalOpen(true);
    void createTimelineRepositoryClient().exportDocumentBundle(DEFAULT_TIMELINE_ID)
      .then((exported) => {
        setShareWorkNodes(exported.workNodes);
        const firstRoot = exported.workNodes.find((node) => !node.parentNodeId);
        if (firstRoot) setShareBranchRootId(firstRoot.id);
      })
      .catch(() => undefined);
  };

  const handleCloseShareModal = () => {
    setIsShareModalOpen(false);
    setPendingImportShare(null);
    setPendingImportBundle(null);
    setPendingImportTimelineId('');
    if (shareImportInputRef.current) {
      shareImportInputRef.current.value = '';
    }
  };

  const handleExportTimelineJson = async () => {
    saveTimelineData();
    setSelectedCharacterIds(selectedCharacters.map((character) => character.id));

    const snapshot = createTimelineSnapshotEntry(shareDraftName);
    if (!snapshot) {
      alert('当前没有可导出的排轴数据');
      return;
    }
    if (shareScope === 'branch' && !shareBranchRootId) {
      alert('请选择要导出的 AI 分支根节点。');
      return;
    }
    let shareFile;
    try {
      const exported = await createTimelineRepositoryClient().exportDocumentBundle(DEFAULT_TIMELINE_ID);
      const snapshots = exported.snapshots.map((item) => ({
        id: item.id,
        label: item.label,
        createdAt: item.createdAt,
        payload: item.payload,
        summary: { characterCount: 0, buttonCount: 0, buffCount: 0 },
      } as TimelineSnapshotEntry));
      const branchNodeIds = new Set<string>();
      if (shareScope === 'branch' && shareBranchRootId) {
        const pendingNodeIds = [shareBranchRootId];
        while (pendingNodeIds.length) {
          const nodeId = pendingNodeIds.pop()!;
          if (branchNodeIds.has(nodeId)) continue;
          branchNodeIds.add(nodeId);
          exported.workNodes.filter((node) => node.parentNodeId === nodeId).forEach((node) => pendingNodeIds.push(node.id));
        }
      }
      const workNodes = shareScope === 'document'
        ? exported.workNodes
        : shareScope === 'branch'
          ? exported.workNodes.filter((node) => branchNodeIds.has(node.id))
          : [];
      shareFile = await buildTimelineBundleV2({
        timelineId: DEFAULT_TIMELINE_ID,
        label: shareDraftName,
        snapshot,
        snapshots: shareScope === 'document' && snapshots.length ? snapshots : [snapshot],
        ...(workNodes.length ? { workNodes } : {}),
        scope: shareScope,
      });
    } catch {
      if (shareScope !== 'snapshot') {
        alert('当前无法读取排轴文档，不能导出 AI 分支或完整文档。');
        return;
      }
      shareFile = await buildTimelineBundleV2({ timelineId: DEFAULT_TIMELINE_ID, label: shareDraftName, snapshot });
    }

    const blob = new Blob([JSON.stringify(shareFile, null, 2)], {
      type: 'application/json;charset=utf-8',
    });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = buildTimelineShareFileName(shareFile.manifest.label, shareFile.manifest.exportedAt);
    link.click();
    window.URL.revokeObjectURL(url);
  };

  const handleOpenShareImportPicker = () => {
    shareImportInputRef.current?.click();
  };

  const handleShareFileSelected = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    const rawText = await file.text();
    const bundle = await parseTimelineBundleV2(rawText);
    if (bundle) {
      const snapshot = bundle.snapshots[0];
      const payload = bundle.payloads[snapshot.payloadIndex];
      setPendingImportShare({ type: 'timeline-share.v1', exportedAt: bundle.manifest.exportedAt, label: bundle.manifest.label, payload });
      setPendingImportBundle(bundle);
      setPendingImportTimelineId(`imported-${Date.now()}`);
      event.target.value = '';
      return;
    }
    const parsed = parseTimelineShareFile(rawText);
    if (!parsed) {
      alert('导入失败：文件不是有效的排轴分享 JSON');
      event.target.value = '';
      return;
    }

    setPendingImportShare(parsed);
    setPendingImportBundle(null);
    event.target.value = '';
  };

  const handleCancelImportShare = () => {
    setPendingImportShare(null);
    setPendingImportBundle(null);
    setPendingImportTimelineId('');
  };

  const handleConfirmImportShare = async () => {
    if (!pendingImportShare) {
      return;
    }

    if (pendingImportTimelineId) {
      const repository = createTimelineRepositoryClient();
      const importedAt = Date.now();
      const bundleSnapshots = pendingImportBundle
        ? pendingImportBundle.snapshots.map((snapshot) => ({
          id: `imported-${snapshot.id}-${importedAt}`,
          label: snapshot.label,
          createdAt: snapshot.createdAt,
          payload: pendingImportBundle.payloads[snapshot.payloadIndex],
        }))
        : [{ id: `imported-snapshot-${importedAt}`, label: pendingImportShare.label, payload: pendingImportShare.payload }];
      const bundleWorkNodes = pendingImportBundle?.workNodes?.map((node) => ({
        id: `imported-${node.id}-${importedAt}`,
        ...(node.parentNodeId ? { parentNodeId: `imported-${node.parentNodeId}-${importedAt}` } : {}),
        branchId: node.branchId,
        label: node.label,
        status: node.status,
        approvalPolicy: node.approvalPolicy,
        riskFlags: node.riskFlags,
        logs: node.logs,
        createdAt: node.createdAt,
        updatedAt: node.updatedAt,
        basePayload: pendingImportBundle.payloads[node.basePayloadIndex],
        workingPayload: pendingImportBundle.payloads[node.workingPayloadIndex],
      }));
      await repository.importDocumentBundle({
        document: { id: pendingImportTimelineId, label: pendingImportShare.label },
        snapshots: bundleSnapshots,
        ...(bundleWorkNodes?.length ? { workNodes: bundleWorkNodes } : {}),
      });
      setPendingImportShare(null);
      setPendingImportBundle(null);
      setPendingImportTimelineId('');
      alert('已导入为新的排轴文档，当前排轴未被覆盖。');
      return;
    }
    applyTimelineSnapshotPayload(pendingImportShare.payload);
    setPendingImportShare(null);
    setPendingImportBundle(null);
    setPendingImportTimelineId('');
    window.location.reload();
  };

  const handleOpenDamageReport = () => {
    navigateToAppPath(APP_ROUTE_PATHS.damageReportPpt);
  };

  const handleCloseDamageReport = () => {
    setIsReportModalOpen(false);
  };

  const handleOpenReportSheet = () => {
    navigateToAppPath(APP_ROUTE_PATHS.damageSheet);
  };

  const handleSkillButtonModalOpen = () => {
    onSkillButtonModalOpen?.();
  };

  const handleSkillButtonModalClose = () => {
    onSkillButtonModalClose?.();
  };

  const handleRefreshAvailableCandidates = async () => {
    if (isRefreshingAvailableCandidates) {
      return;
    }
    const spinStartTime = Date.now();
    setIsRefreshingAvailableCandidates(true);
    try {
      const refreshedCharacters = await refreshSelectedCharacters();
      const charactersForRefresh = refreshedCharacters.length > 0 ? refreshedCharacters : selectedCharacters;
      await refreshOperatorConfigSnapshotsForCharacters(charactersForRefresh);
      await refreshAvailableCandidateBuffsForCharacters(
        charactersForRefresh.map((character) => ({
          id: character.id,
          name: character.name,
        })),
      );
    } catch (error) {
      console.error('刷新干员/武器/装备可用候选内容失败:', error);
    } finally {
      const remainingSpinTime = REFRESH_AVAILABLE_CANDIDATES_MIN_SPIN_MS - (Date.now() - spinStartTime);
      if (remainingSpinTime > 0) {
        await new Promise((resolve) => window.setTimeout(resolve, remainingSpinTime));
      }
      setIsRefreshingAvailableCandidates(false);
    }
  };

  const canvasBoardClassName = [
    'canvas-board',
    isWorkbenchTopZoneOpen ? 'has-top-zone' : '',
    isAiMode ? 'is-ai-mode' : '',
    isAiMode && aiHoverZone === 'left' ? 'is-ai-hover-left' : '',
    isAiMode && aiHoverZone === 'right' ? 'is-ai-hover-right' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const rightWorkbenchContent = isToolPanelVisible && isCandidatePanelEnabled ? (
    <ToolPanel widthPercent={100} />
  ) : (
    <SkillSandbox
      selectedCharacters={selectedCharacters}
      onDragStart={handleSandboxDragStart}
      onAvatarDoubleClick={handleAvatarDoubleClick}
      onSave={handleSaveTimelineSnapshot}
      onOpenResistance={handleOpenBatchResistanceModal}
      onRefreshAvailableCandidates={handleRefreshAvailableCandidates}
      isRefreshingAvailableCandidates={isRefreshingAvailableCandidates}
      isBrowseMode={isBrowseMode}
      onToggleBrowseMode={() => setIsBrowseMode((prev) => !prev)}
      isInspectMode={isInspectMode}
      onInspectStart={() => setIsInspectMode(true)}
      onInspectEnd={() => setIsInspectMode(false)}
      isAiMode={isAiMode}
      onToggleAiMode={toggleAiMode}
      onOpenWorkNodePanel={openWorkNodePanel}
    />
  );

  return (
    <div className={canvasBoardClassName}>
      <div className="canvas-layout" onMouseMove={handleAiLayoutMouseMove}>
        <div className="canvas-background-layer">
          <div className="skew-panel" />
          <div className="skew-panel-bottom" />
        </div>

        <div className="canvas-left-zone">
          <CanvasArea
            ref={canvasRef}
            activeSkillButtonId={activeSkillButtonId}
            config={canvasConfig}
            staffCount={staffCount}
            selectedCharacters={selectedCharacters}
            skillButtons={skillButtons}
            onButtonMouseDown={handleButtonMouseDown}
            onButtonContextMenu={handleButtonContextMenu}
            onCanvasClick={handleCanvasClick}
            onCanvasPlaceCopy={handleCanvasPlaceCopy}
            timelineData={timelineData}
            onSkillButtonModalOpen={handleSkillButtonModalOpen}
            onSkillButtonModalClose={handleSkillButtonModalClose}
            contextMenuState={contextMenuState}
            onConfirmRemove={handleConfirmRemoveSkillButton}
            onCloseContextMenu={handleCloseButtonContextMenu}
            onCopy={handleCopySkillButton}
            onChangeSkillType={handleChangeSkillType}
            getSkillChangeOptions={getSkillChangeOptions}
            isDraggingActive={Boolean(draggingState)}
            isBrowseMode={isBrowseMode}
            isInspectMode={isInspectMode}
            isDragDisabled={isAiMode}
            resistanceRevision={resistanceRevision}
          />
        </div>

        {isAiMode ? (
          <>
            <aside className={`canvas-right-zone is-ai-real-right ${isToolPanelVisible && isCandidatePanelEnabled ? 'is-tool-panel' : 'is-skill-sandbox'}`}>
              {rightWorkbenchContent}
            </aside>
            <aside className="canvas-right-zone is-ai-panel">
              <MainWorkbenchAiPanel
                selectedCharacters={selectedCharacters}
                skillButtons={skillButtons}
                onExit={exitAiMode}
                onOpenWorkNodePanel={openWorkNodePanel}
                onWorkNodeChanged={refreshWorkNodePanel}
              />
            </aside>
          </>
        ) : (
          <aside className={`canvas-right-zone ${isToolPanelVisible && isCandidatePanelEnabled ? 'is-tool-panel' : 'is-skill-sandbox'}`}>
            {rightWorkbenchContent}
          </aside>
        )}

        <div className="canvas-bottom-zone">
          <div className="canvas-bottom-zone-left">
            {workbenchControl}
            <Toolbar
              staffCount={staffCount}
              onBack={handleBack}
              onAddGroup={handleAddStaffGroup}
              onRemoveGroup={handleRemoveStaffGroup}
              onSave={handleOpenSaveSnapshotModal}
              onRestore={handleOpenSnapshotModal}
              onShare={handleOpenShareModal}
              onTable={handleOpenReportSheet}
              onCalculate={handleOpenDamageReport}
            />
          </div>
          <div className="canvas-bottom-zone-center" />
          <div className="canvas-bottom-zone-right">{bottomRightControl}</div>
        </div>
      </div>

      {isWorkNodePanelOpen && (
        <div className="work-node-modal-overlay" onClick={closeWorkNodePanel}>
          <div className="work-node-modal" onClick={(event) => event.stopPropagation()}>
            <div className="work-node-modal-head">
              <div>
                <h3>Work Node 节点树</h3>
                <p>查看 AI 与人工 checkpoint 的节点、差异、风险和 checkout / restore 证据。</p>
              </div>
              <button type="button" className="modal-close-btn" onClick={closeWorkNodePanel}>
                关闭
              </button>
            </div>
            <WorkNodeTreePanel
              refreshKey={workNodeRefreshKey}
              onSelectedNodeChange={setPendingWorkNodeCheckoutId}
            />
          </div>
        </div>
      )}

      <DraggingOverlay
        draggingState={draggingState ? { id: draggingState.id, skillType: draggingState.skillType } : null}
        mousePosition={mousePosition}
        buttonSize={canvasConfig.skillButtonSize}
      />

      {isBatchResistanceModalOpen && (
        <div className="timeline-snapshot-modal-overlay" onClick={handleCloseBatchResistanceModal}>
          <div
            className="timeline-snapshot-confirm-modal batch-resistance-modal"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="timeline-snapshot-modal-head">
              <div>
                <h3>批量设置敌方抗性</h3>
                <p>确认后将覆盖当前排轴中全部 {skillButtons.length} 个技能按钮的目标抗性。</p>
              </div>
              <button type="button" className="modal-close-btn" onClick={handleCloseBatchResistanceModal}>
                关闭
              </button>
            </div>

            <div className="batch-resistance-fields">
              {BATCH_RESISTANCE_FIELDS.map(([key, label]) => (
                <label key={key}>
                  <span>{label}</span>
                  <DeferredNumberInput
                    step="1"
                    value={batchTargetResistance[key]}
                    onCommit={(value) => {
                      setBatchTargetResistance((current) => ({
                        ...current,
                        [key]: value ?? 0,
                      }));
                    }}
                  />
                </label>
              ))}
            </div>

            <div className="timeline-snapshot-form-actions">
              <button type="button" className="btn-calculate" onClick={handleCloseBatchResistanceModal}>
                取消
              </button>
              <button
                type="button"
                className="btn-save"
                onClick={handleApplyBatchResistance}
                disabled={skillButtons.length === 0}
              >
                应用到全部按钮
              </button>
            </div>
          </div>
        </div>
      )}

      {isReportModalOpen && (
        <div className="damage-report-modal-overlay" onClick={handleCloseDamageReport}>
          <div className="damage-report-modal" onClick={(event) => event.stopPropagation()}>
            <div className="damage-report-modal-head">
              <div>
                <h3>伤害结算报表</h3>
                <p>独立报表窗口，不占用右侧陈列区</p>
              </div>
              <button type="button" className="modal-close-btn" onClick={handleCloseDamageReport}>
                关闭
              </button>
            </div>
            <ReportTab />
          </div>
        </div>
      )}


      {isSnapshotModalOpen && (
        <div className="timeline-snapshot-modal-overlay" onClick={handleCloseSnapshotModal}>
          <div className="timeline-snapshot-modal" onClick={(event) => event.stopPropagation()}>
            <div className="timeline-snapshot-modal-head">
              <div>
                <h3>恢复排轴快照</h3>
                <p>恢复会覆盖当前排轴缓存，并在写回后自动刷新界面。</p>
              </div>
              <button type="button" className="modal-close-btn" onClick={handleCloseSnapshotModal}>
                关闭
              </button>
            </div>

            {timelineSnapshots.length === 0 ? (
              <div className="timeline-snapshot-empty">
                当前还没有可恢复的快照。先点一次“保存”即可创建时间点。
              </div>
            ) : (
              <div className="timeline-snapshot-list">
                {timelineSnapshots.map((snapshot) => (
                  <div key={snapshot.id} className="timeline-snapshot-item">
                    <div className="timeline-snapshot-item-main">
                      <strong>{snapshot.label}</strong>
                      <span>
                        {snapshot.summary.characterCount} 干员 / {snapshot.summary.buttonCount} 按钮 / {snapshot.summary.buffCount} Buff
                      </span>
                    </div>
                    <div className="timeline-snapshot-hover-card">
                      <div className="timeline-snapshot-hover-title">快照详情</div>
                      <div className="timeline-snapshot-hover-line">保存时间：{formatPreciseTimestamp(snapshot.createdAt)}</div>
                      <div className="timeline-snapshot-hover-line">快照 ID：{snapshot.id}</div>
                      <div className="timeline-snapshot-hover-line">
                        干员 {snapshot.summary.characterCount} / 按钮 {snapshot.summary.buttonCount} / Buff {snapshot.summary.buffCount}
                      </div>
                      <div className="timeline-snapshot-hover-section">Buff 内容</div>
                      <div className="timeline-snapshot-hover-buffs">
                        {buildSnapshotBuffPreview(snapshot).map((buffName) => (
                          <span key={`${snapshot.id}-${buffName}`}>{buffName}</span>
                        ))}
                      </div>
                    </div>
                    <div className="timeline-snapshot-item-actions">
                      <button type="button" className="btn-save" onClick={() => handleRequestRestoreSnapshot(snapshot)}>
                        恢复
                      </button>
                      <button
                        type="button"
                        className="btn-calculate timeline-snapshot-delete-btn"
                        onClick={() => handleDeleteSnapshot(snapshot.id)}
                      >
                        删除
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {isSaveSnapshotModalOpen && (
        <div className="timeline-snapshot-modal-overlay" onClick={handleCloseSaveSnapshotModal}>
          <div className="timeline-snapshot-modal timeline-snapshot-save-modal" onClick={(event) => event.stopPropagation()}>
            <div className="timeline-snapshot-modal-head">
              <div>
                <h3>保存排轴快照</h3>
                <p>可自定义快照名称；留空时自动使用当前时间。</p>
              </div>
              <button type="button" className="modal-close-btn" onClick={handleCloseSaveSnapshotModal}>
                关闭
              </button>
            </div>

            <label className="timeline-snapshot-form-label" htmlFor="timeline-snapshot-name">
              快照名称
            </label>
            <input
              id="timeline-snapshot-name"
              className="timeline-snapshot-name-input"
              type="text"
              value={snapshotDraftName}
              onChange={(event) => setSnapshotDraftName(event.target.value)}
              placeholder="留空则使用时间戳"
              maxLength={60}
            />

            <label className="timeline-snapshot-form-label" htmlFor="timeline-share-scope">
              导出范围
            </label>
            <select
              id="timeline-share-scope"
              className="timeline-snapshot-name-input"
              value={shareScope}
              onChange={(event) => setShareScope(event.target.value as 'snapshot' | 'branch' | 'document')}
            >
              <option value="snapshot">当前排轴</option>
              <option value="branch" disabled={shareWorkNodes.length === 0}>指定 AI 分支</option>
              <option value="document" disabled={shareWorkNodes.length === 0}>完整排轴文档</option>
            </select>

            {shareScope === 'branch' && (
              <>
                <label className="timeline-snapshot-form-label" htmlFor="timeline-share-branch">
                  AI 分支根节点
                </label>
                <select
                  id="timeline-share-branch"
                  className="timeline-snapshot-name-input"
                  value={shareBranchRootId}
                  onChange={(event) => setShareBranchRootId(event.target.value)}
                >
                  {shareWorkNodes.filter((node) => !node.parentNodeId).map((node) => (
                    <option key={node.id} value={node.id}>{node.label}</option>
                  ))}
                </select>
              </>
            )}

            <div className="timeline-snapshot-form-actions">
              <button type="button" className="btn-calculate" onClick={handleCloseSaveSnapshotModal}>
                取消
              </button>
              <button type="button" className="btn-save" onClick={handleSaveTimelineSnapshot}>
                保存
              </button>
            </div>
          </div>
        </div>
      )}

      {pendingRestoreSnapshot && (
        <div className="timeline-snapshot-modal-overlay" onClick={handleCancelRestoreSnapshot}>
          <div className="timeline-snapshot-confirm-modal" onClick={(event) => event.stopPropagation()}>
            <div className="timeline-snapshot-modal-head">
              <div>
                <h3>确认恢复快照</h3>
                <p>将覆盖当前排轴缓存，并在恢复后自动刷新界面。</p>
              </div>
              <button type="button" className="modal-close-btn" onClick={handleCancelRestoreSnapshot}>
                关闭
              </button>
            </div>

            <div className="timeline-snapshot-confirm-body">
              <strong>{pendingRestoreSnapshot.label}</strong>
              <span>
                {pendingRestoreSnapshot.summary.characterCount} 干员 / {pendingRestoreSnapshot.summary.buttonCount} 按钮 / {pendingRestoreSnapshot.summary.buffCount} Buff
              </span>
            </div>

            <div className="timeline-snapshot-form-actions">
              <button type="button" className="btn-calculate" onClick={handleCancelRestoreSnapshot}>
                取消
              </button>
              <button type="button" className="btn-save" onClick={handleConfirmRestoreSnapshot}>
                确认恢复
              </button>
            </div>
          </div>
        </div>
      )}

      {isShareModalOpen && (
        <div className="timeline-snapshot-modal-overlay" onClick={handleCloseShareModal}>
          <div className="timeline-snapshot-modal timeline-snapshot-share-modal" onClick={(event) => event.stopPropagation()}>
            <div className="timeline-snapshot-modal-head">
              <div>
                <h3>排轴分享</h3>
                <p>导出当前排轴 JSON，用于分享或外部留档。</p>
              </div>
              <button type="button" className="modal-close-btn" onClick={handleCloseShareModal}>
                关闭
              </button>
            </div>

            <div className="timeline-snapshot-confirm-body">
              <strong>当前排轴导出</strong>
              <span>{selectedCharacters.length} 干员 / {skillButtons.length} 运行时按钮 / 导出 4 项恢复数据</span>
            </div>

            <label className="timeline-snapshot-form-label" htmlFor="timeline-share-name">
              导出文件名
            </label>
            <input
              id="timeline-share-name"
              className="timeline-snapshot-name-input"
              type="text"
              value={shareDraftName}
              onChange={(event) => setShareDraftName(event.target.value)}
              placeholder="留空则使用未命名"
              maxLength={60}
            />

            <input
              ref={shareImportInputRef}
              className="timeline-share-file-input"
              type="file"
              accept="application/json,.json"
              onChange={handleShareFileSelected}
            />

            <div className="timeline-snapshot-form-actions">
              <button type="button" className="btn-save" onClick={handleOpenShareImportPicker}>
                导入分享
              </button>
              <button type="button" className="btn-calculate" onClick={handleCloseShareModal}>
                取消
              </button>
              <button type="button" className="btn-save" onClick={handleExportTimelineJson}>
                一键导出 JSON
              </button>
            </div>
          </div>
        </div>
      )}

      {pendingImportShare && (
        <div className="timeline-snapshot-modal-overlay" onClick={handleCancelImportShare}>
          <div className="timeline-snapshot-confirm-modal" onClick={(event) => event.stopPropagation()}>
            <div className="timeline-snapshot-modal-head">
              <div>
                <h3>确认导入分享</h3>
                <p>导入会创建新的本地排轴文档，不会覆盖当前排轴。</p>
              </div>
              <button type="button" className="modal-close-btn" onClick={handleCancelImportShare}>
                关闭
              </button>
            </div>

            <div className="timeline-snapshot-confirm-body">
              <strong>{pendingImportShare.label}</strong>
              <span>
                {pendingImportShare.payload.selectedCharacters.length} 干员 / {pendingImportShare.payload.allBuffList.length} Buff / 分享时间 {new Date(pendingImportShare.exportedAt).toLocaleString()}
                {pendingImportBundle ? ` / v${pendingImportBundle.schemaVersion} / ${pendingImportBundle.snapshots.length} 快照 / ${pendingImportBundle.workNodes?.length || 0} 节点` : ' / 旧版单快照文件'}
              </span>
            </div>

            <div className="timeline-snapshot-form-actions">
              <button type="button" className="btn-calculate" onClick={handleCancelImportShare}>
                取消
              </button>
              <button type="button" className="btn-save" onClick={handleConfirmImportShare}>
                确认导入
              </button>
            </div>
          </div>
        </div>
      )}

      {pendingCopy && (
        <div
          style={{
            position: 'fixed',
            left: copyHintMousePosition.x + 16,
            top: copyHintMousePosition.y + 16,
            background: 'rgba(0, 0, 0, 0.8)',
            color: '#fff',
            padding: '8px 12px',
            borderRadius: 4,
            fontSize: 13,
            pointerEvents: 'none',
            zIndex: 9999,
            whiteSpace: 'nowrap',
          }}
        >
          已复制，点击目标位置放置
        </div>
      )}
    </div>
  );
}
