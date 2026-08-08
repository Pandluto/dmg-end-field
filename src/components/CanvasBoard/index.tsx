import React, { useCallback, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { useAppContext } from '../../context/AppContext';
import { loadLocalOperatorCharacters } from '../../core/services/localOperatorAdapter';
import { SkillSandbox } from './SkillSandbox';
import { WorkNodeTreePanel, type WorkbenchSelectedNodeContext } from './WorkNodeTreePanel';
import { useCanvasWidth } from './hooks/useCanvasWidth';
import { useSelectStart } from './hooks/useSelectStart';
import { useCanvasDrag } from './hooks/useCanvasDrag';
import { useTimelineData } from '../../hooks/useTimelineData';
import { CanvasArea } from './components/CanvasArea';
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
  DEFAULT_OPERATOR_SKILL_CONFIG,
  DEFAULT_WEAPON_LEVEL,
  DEFAULT_WEAPON_SKILL_LEVELS,
  getWeaponSkill3PotentialBonus,
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
import { getCandidateBuffList } from '../../core/repositories';
import {
  applyTimelineSnapshotPayload,
  buildTimelineBundleV2,
  buildTimelineShareFileName,
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
import { restoreUserWorkspaceSnapshot } from '../../utils/userWorkspaceBridge';
import './CanvasBoard.css';
import { resolveRuntimeTemplateSkill } from '../../core/services/skillDamageTemplateResolver';
import { buildDamageReportSnapshot } from '../../core/services/damageReportService';
import type { PersistedSkillButton } from '../../types/storage';
import type { HitResistanceInput } from '../../types/storage';
import DeferredNumberInput from '../DeferredNumberInput';
import {
  assertAgentWorkNodeCommandTimelineBoundary,
  assertMainWorkbenchWorkNodeTimeline,
  getPendingMainWorkbenchCommands,
  enqueueMainWorkbenchCommand,
  isAgentWorkNodeBrowserCommand,
  patchMainWorkbenchCommand,
  pullRemoteMainWorkbenchCommands,
  projectMainWorkbenchCandidateBuff,
  projectMainWorkbenchWorkNodeListToTimeline,
  pushMainWorkbenchCommandResult,
  pushMainWorkbenchSnapshot,
  projectMainWorkbenchButtonState,
  readMainWorkbenchSnapshot,
  writeMainWorkbenchSnapshot,
  type MainWorkbenchCommand,
  type MainWorkbenchSnapshot,
} from '../../utils/mainWorkbenchControl';
import {
  createAiTimelineWorkNodeClient,
  diffTimelinePayloads,
  applyTimelineWorkNodePatch,
  buildAiTimelineNodeReviewProjection,
  emptyAiTimelineNodeReviewProjection,
  restoreBuffScope,
  restoreResistanceScope,
  restoreTimelineScope,
  validateTimelinePayload,
} from '../../agentKernel/timelineWorktree';
import { buildAiTimelineCheckoutDecision } from '../../agentKernel/timelineWorktree/checkoutDecision.mjs';
import { planTimelineWorkNodeCheckoutLifecycle } from '../../agentKernel/timelineWorktree/checkoutLifecycle';
import { DEFAULT_TIMELINE_ID } from '../../core/domain/timeline';
import type { TimelineCheckoutRef, TimelineDocument } from '../../core/domain/timeline';
import { createTimelineRepositoryClient, formatTimelineOperationError } from '../../agentKernel/timelineRepository/localTimelineClient';
import type {
  TimelineArchiveSummary,
  TimelineRepositoryBundleWorkNode,
  TimelineSqliteWorkspace,
} from '../../agentKernel/timelineRepository/localTimelineClient';
import type { AiTimelineRiskFlag } from '../../agentKernel/timelineWorktree/types';
import { useTimelineSession } from '../../agentKernel/timelineRepository/useTimelineSession';
import { runTimelineArchiveConversionForReload } from './timelineArchiveConversionFlow';
import {
  browserAgentRuntime,
  enterDesktopAgentModeFromWorkbench,
  exitDesktopAgentModeToWorkbench,
} from '../../platform/agent/browserAgentRuntime';
import { isDesktopWebHost } from '../../platform/runtime/desktopWebHost';
import {
  buildOperatorConfigFinalConfig,
  buildOperatorConfigProposalDigest,
  buildTimelinePreservation,
  digestJson,
  equalOperatorConfigFinalConfig,
  normalizeOperatorConfigFinalConfig,
  rollbackOperatorConfigProposal,
} from '../../platform/agent/operatorConfigProposal';
import {
  buildReviewedWorkNodeDeletionIdentity,
  buildReviewedWorkNodeIdentity,
  buildWorkNodePayloadPostcondition,
  runAtomicWorkNodeRestore,
  verifyReviewedWorkNodeDeletionIdentity,
  verifyReviewedWorkNodeIdentity,
  verifyWorkNodeDeleteLedger,
} from '../../platform/agent/workNodeAtomicSettlement';
import {
  buildPreparedWorkNodeProposal,
  checkPreparedScope,
  diffPreparedPayloads,
  preparedWorkNodeCandidateRefFromProposal,
  runAtomicPreparedWorkNodeApply,
  sha256Json,
  scopeForPreparedPath,
  validatePreparedWorkNodeCandidate,
  validatePreparedWorkNodeProposal,
  PreparedWorkNodeAtomicApplyError,
} from '../../platform/agent/preparedWorkNodeProposal';
import { bindTrustedTimelineMutation } from '../../platform/agent/trustedTimelineMutation';
import type {
  PreparedWorkNodeScope,
} from '../../../agent/core/contracts/prepared-work-node.ts';
import type { ProductBinding } from '../../../agent/core/contracts/product.ts';
import { readPersistedWorkspaceCheckout } from '../../core/services/selectionWorkspaceTransition';

function getLegacySnapshotTimelineId(snapshotId: string): string {
  return `timeline-document-${snapshotId}`;
}

async function ensureTimelineDocumentExists(
  repository: ReturnType<typeof createTimelineRepositoryClient>,
  timelineId: string,
  label: string,
) {
  const existing = (await repository.listDocuments()).find((document) => document.id === timelineId);
  return existing || repository.ensureDocument({ id: timelineId, label });
}

/**
 * Checkpoint 只应记录内容变化，不应因每次落盘产生的 createdAt / updatedAt
 * 噪声而制造重复节点。Payload 是可序列化数据，故可用稳定序列化比较。
 */
function serializeCheckpointPayload(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(serializeCheckpointPayload).join(',')}]`;
  if (!value || typeof value !== 'object') return JSON.stringify(value);
  return `{${Object.entries(value)
    .filter(([key]) => key !== 'createdAt' && key !== 'updatedAt')
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${serializeCheckpointPayload(entry)}`)
    .join(',')}}`;
}

function hasCheckpointPayloadChanged(
  previousPayload: TimelineSnapshotPayload,
  nextPayload: TimelineSnapshotPayload,
): boolean {
  return serializeCheckpointPayload(previousPayload) !== serializeCheckpointPayload(nextPayload);
}

function checkoutIdentity(checkoutRef: TimelineCheckoutRef | null): string {
  if (!checkoutRef) return 'none';
  return `${checkoutRef.timelineId}:${checkoutRef.targetType}:${checkoutRef.targetId}`;
}

function samePreparedProductBinding(left: ProductBinding, right: ProductBinding): boolean {
  return left.workspaceId === right.workspaceId
    && left.databaseGeneration === right.databaseGeneration
    && left.timelineId === right.timelineId
    && left.checkoutTargetId === right.checkoutTargetId
    && left.checkoutUpdatedAt === right.checkoutUpdatedAt
    && left.contentRevision === right.contentRevision
    && left.snapshotDigest === right.snapshotDigest;
}

type PreparedRestoreSemanticScope = 'timeline.structure' | 'buff.attachments' | 'buff.resistance';

const PREPARED_RESTORE_PROPOSAL_SCOPES = Object.freeze({
  'timeline.structure': ['timeline.structure', 'buff.attachments', 'buff.resistance'],
  'buff.attachments': ['buff.attachments'],
  'buff.resistance': ['buff.resistance'],
} as const satisfies Record<PreparedRestoreSemanticScope, readonly PreparedWorkNodeScope[]>);

function samePreparedScope(
  left: readonly PreparedWorkNodeScope[],
  right: readonly PreparedWorkNodeScope[],
): boolean {
  return left.length === right.length && left.every((entry, index) => entry === right[index]);
}

function preparedRestoreBranchId(input: {
  readonly proposalId: string;
  readonly nodeId: string;
  readonly nodeRevision: number;
  readonly scope: PreparedRestoreSemanticScope;
}): string {
  return `prepared-${input.proposalId}-restore:${input.scope}:${input.nodeRevision}:${encodeURIComponent(input.nodeId)}`;
}

function parsePreparedRestoreBranchId(
  proposalId: string,
  branchId: string,
): { readonly nodeId: string; readonly nodeRevision: number; readonly scope: PreparedRestoreSemanticScope } | null {
  const prefix = `prepared-${proposalId}-restore:`;
  if (!branchId.startsWith(prefix)) return null;
  const encoded = branchId.slice(prefix.length);
  const firstSeparator = encoded.indexOf(':');
  const secondSeparator = encoded.indexOf(':', firstSeparator + 1);
  if (firstSeparator < 0 || secondSeparator < 0) return null;
  const scope = encoded.slice(0, firstSeparator) as PreparedRestoreSemanticScope;
  const revisionText = encoded.slice(firstSeparator + 1, secondSeparator);
  const nodeRevision = Number(revisionText);
  if (!(scope in PREPARED_RESTORE_PROPOSAL_SCOPES)
    || !Number.isSafeInteger(nodeRevision)
    || nodeRevision < 0) return null;
  try {
    const nodeId = decodeURIComponent(encoded.slice(secondSeparator + 1));
    return nodeId ? { nodeId, nodeRevision, scope } : null;
  } catch {
    return null;
  }
}

function applyPreparedRestoreScope(
  scope: PreparedRestoreSemanticScope,
  current: TimelineSnapshotPayload,
  baseline: TimelineSnapshotPayload,
) {
  if (scope === 'timeline.structure') return restoreTimelineScope(current, baseline);
  if (scope === 'buff.attachments') return restoreBuffScope(current, baseline);
  return restoreResistanceScope(current, baseline);
}

function authoritativePreparedNodeRevision(node: { readonly contentRevision?: number }): number {
  if (!Number.isSafeInteger(node.contentRevision) || Number(node.contentRevision) < 0) {
    throw new Error('prepared-node-revision-invalid: Work Node 没有权威 contentRevision。');
  }
  return Number(node.contentRevision);
}

function serializeWorkbenchSnapshotSemantics(value: unknown, path: readonly string[] = []): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => serializeWorkbenchSnapshotSemantics(entry, path)).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value as Record<string, unknown>)
      .filter((key) => key !== 'generatedAt'
        && (key !== 'updatedAt' || (path.length === 1 && path[0] === 'checkout')))
      .sort()
      .map((key) => `${JSON.stringify(key)}:${serializeWorkbenchSnapshotSemantics((value as Record<string, unknown>)[key], [...path, key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

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

// Kept as a separate typed extension so older Canvas dispatcher contracts can
// continue to enumerate the original mutation set while the browser-only
// Work Node management commands remain available to the same queue.
const CANVAS_WORK_NODE_MANAGEMENT_COMMANDS = [
  'listAiTimelineWorkNodes',
  'readAiTimelineWorkNode',
  'validateAiTimelineWorkNode',
  'deleteAiTimelineWorkNode',
] as const;

type CanvasWorkNodeManagementCommand = Extract<
  MainWorkbenchCommand,
  { op: typeof CANVAS_WORK_NODE_MANAGEMENT_COMMANDS[number] }
>;

function isCanvasWorkNodeManagementCommand(
  command: MainWorkbenchCommand,
): command is CanvasWorkNodeManagementCommand {
  return (CANVAS_WORK_NODE_MANAGEMENT_COMMANDS as readonly string[]).includes(command.op);
}

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
  if (summary.changedCharacterInputCount) parts.push(`changed ${summary.changedCharacterInputCount} character loadout(s)`);
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
  skillCatalog: MainWorkbenchSnapshot['skillCatalog'] = [],
  candidateBuffs: MainWorkbenchSnapshot['candidateBuffs'] = [],
): string {
  return JSON.stringify({
    selectedCharacters: selectedCharacters.map((character) => ({
      id: character.id,
      name: character.name,
    })),
    skillCatalog: [...skillCatalog]
      .sort((a, b) => `${a.characterId}:${a.skillId}`.localeCompare(`${b.characterId}:${b.skillId}`))
      .map((skill) => ({
        characterId: skill.characterId,
        characterName: skill.characterName,
        skillId: skill.skillId,
        skillType: skill.skillType,
        skillDisplayName: skill.skillDisplayName,
        source: skill.source,
      })),
    candidateBuffs: [...candidateBuffs]
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
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
        persistenceStaffIndex: button.lineIndex,
        persistenceNodeIndex: button.staffIndex * GRID_NODE_COUNT + (button.nodeIndex ?? 0),
        nodeIndex: button.nodeIndex,
        nodeNumber: button.nodeNumber,
        selectedBuffIds: [...button.selectedBuffIds].sort(),
        selectedBuffs: (button.selectedBuffs ?? []).map((buff) => ({
          ...buff,
          target: buff.target ? { ...buff.target } : null,
          multiplier: buff.multiplier ? { ...buff.multiplier } : null,
          derivedValue: buff.derivedValue ? { ...buff.derivedValue } : null,
          extraHitConfig: buff.extraHitConfig ? { ...buff.extraHitConfig } : null,
        })),
        currentStackCounts: Object.fromEntries(
          Object.entries(button.currentStackCounts ?? {}).sort(([left], [right]) => left.localeCompare(right)),
        ),
        currentStackCountSources: Object.fromEntries(
          Object.entries(button.currentStackCountSources ?? {}).sort(([left], [right]) => left.localeCompare(right)),
        ),
        globallyDisabledBuffIds: [...(button.globallyDisabledBuffIds ?? [])].sort(),
        manualDisabledBuffIdsBySegmentKey: Object.fromEntries(
          Object.entries(button.manualDisabledBuffIdsBySegmentKey ?? {})
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([key, ids]) => [key, [...ids].sort()]),
        ),
        manualBuffStackCountsBySegmentKey: Object.fromEntries(
          Object.entries(button.manualBuffStackCountsBySegmentKey ?? {})
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([key, counts]) => [
              key,
              Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right))),
            ]),
        ),
        manualDisabledHitKeys: [...(button.manualDisabledHitKeys ?? [])].sort(),
        targetResistance: Object.fromEntries(
          Object.entries(button.targetResistance ?? {}).sort(([left], [right]) => left.localeCompare(right)),
        ),
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

function buildVisibleTimelineMirrors(
  characters: Character[],
  visibleButtons: SkillButton[],
  previousPayload: TimelineSnapshotPayload,
): Pick<TimelineSnapshotPayload, 'timelineData' | 'skillButtonTable'> {
  const previousTable = previousPayload.skillButtonTable || {};
  const now = Date.now();
  const skillButtonTable = Object.fromEntries(visibleButtons.map((button) => {
    const lineIndex = button.lineIndex;
    const character = characters[lineIndex];
    if (!character || character.id !== button.characterId || character.name !== button.characterName) {
      throw new Error(`VISIBLE_TIMELINE_IDENTITY_MISMATCH: ${button.id} 无法解析到当前干员行。`);
    }
    const trustedSkill = resolveRuntimeTemplateSkill(button);
    if (!trustedSkill || trustedSkill.buttonType !== button.skillType) {
      throw new Error(`VISIBLE_TIMELINE_SKILL_UNTRUSTED: ${button.id} 的 ${button.skillType} 无法在干员技能目录中解析。`);
    }
    const previous = previousTable[button.id];
    const persistentNodeIndex = button.staffIndex * GRID_NODE_COUNT + (button.nodeIndex ?? 0);
    const selectedBuff = [...(previous?.selectedBuff ?? [])];
    const persisted: PersistedSkillButton = {
      id: button.id,
      characterId: button.characterId,
      characterName: button.characterName,
      skillType: button.skillType,
      staffIndex: lineIndex,
      lineIndex,
      nodeIndex: persistentNodeIndex,
      nodeNumber: persistentNodeIndex + 1,
      position: { ...button.position },
      runtimeSkillId: trustedSkill.id,
      skillDisplayName: trustedSkill.displayName,
      skillIconUrl: button.skillIconUrl,
      customHits: button.customHits,
      selectedBuff,
      ...(previous ? clonePersistedSkillButtonConfig(previous) : {}),
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
    };
    return [button.id, persisted];
  }));
  const timelineData: TimelineData = {
    version: previousPayload.timelineData.version || '1.0.0',
    createdAt: previousPayload.timelineData.createdAt || now,
    updatedAt: now,
    staffLines: characters.map((character, lineIndex) => {
      const buttons = Object.values(skillButtonTable)
        .filter((button) => button.staffIndex === lineIndex)
        .map((button) => ({
          id: button.id,
          characterId: button.characterId || character.id,
          characterName: button.characterName,
          skillType: button.skillType as SkillButtonType,
          staffIndex: lineIndex,
          lineIndex,
          nodeIndex: button.nodeIndex,
          nodeNumber: button.nodeNumber,
          position: { ...button.position },
          runtimeSkillId: button.runtimeSkillId,
          skillDisplayName: button.skillDisplayName,
          skillIconUrl: button.skillIconUrl,
          customHits: button.customHits,
          buffIds: [...button.selectedBuff],
        }))
        .sort((left, right) => left.nodeIndex - right.nodeIndex);
      return {
        staffIndex: lineIndex,
        characterName: character.name,
        occupiedNodes: buttons.map((button) => button.nodeIndex),
        buttons,
      };
    }),
  };
  return { timelineData, skillButtonTable };
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
  isWorkbenchTopZoneOpen?: boolean;
  isAgentMode?: boolean;
  agentModePanel?: React.ReactNode | ((controls: {
    onOpenWorkNodePanel?: () => void | Promise<void>;
  }) => React.ReactNode);
  onOpenOperatorConfig?: (characterId: string) => void;
  workbenchControl?: React.ReactNode;
  bottomRightControl?: React.ReactNode;
}

export function CanvasBoard({
  activeSkillButtonId = null,
  isWorkbenchTopZoneOpen = false,
  isAgentMode = false,
  agentModePanel = null,
  onOpenOperatorConfig,
  workbenchControl,
  bottomRightControl,
}: CanvasBoardProps) {
  const { state, dispatch, refreshSelectedCharacters } = useAppContext();
  const { currentView, selectedCharacters, canvasConfig, skillButtons, loadedCharacters } = state;
  const canvasRef = useRef<HTMLDivElement>(null);
  const [staffCount, setStaffCount] = React.useState(canvasConfig.staffCount);
  const [isSnapshotModalOpen, setIsSnapshotModalOpen] = useState(false);
  const [isSaveSnapshotModalOpen, setIsSaveSnapshotModalOpen] = useState(false);
  const [isTimelineNameModalOpen, setIsTimelineNameModalOpen] = useState(false);
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);
  const [snapshotDraftName, setSnapshotDraftName] = useState('');
  const [timelineNameDraft, setTimelineNameDraft] = useState('');
  const [timelineNameError, setTimelineNameError] = useState('');
  const [shareDraftName, setShareDraftName] = useState('');
  const [shareScope, setShareScope] = useState<'snapshot' | 'branch' | 'document'>('snapshot');
  const [shareBranchRootId, setShareBranchRootId] = useState('');
  const [shareWorkNodes, setShareWorkNodes] = useState<TimelineRepositoryBundleWorkNode[]>([]);
  const [projectionVisibilityRevision, setProjectionVisibilityRevision] = useState(0);
  const [pendingImportShare, setPendingImportShare] = useState<TimelineShareFile | null>(null);
  const [pendingImportBundle, setPendingImportBundle] = useState<TimelineBundleV2 | null>(null);
  const [localTimelineArchives, setLocalTimelineArchives] = useState<TimelineArchiveSummary[]>([]);
  const [sharedTimelineArchives, setSharedTimelineArchives] = useState<TimelineArchiveSummary[]>([]);
  const [sqliteTimelineWorkspaces, setSqliteTimelineWorkspaces] = useState<TimelineSqliteWorkspace[]>([]);
  const [restorePanelTab, setRestorePanelTab] = useState<'local' | 'shared' | 'sqlite'>('local');
  const [isBrowseMode, setIsBrowseMode] = useState(false);
  const [isInspectMode, setIsInspectMode] = useState(false);
  const [isAgentModeLaunching, setIsAgentModeLaunching] = useState(false);
  const [aiHoverZone, setAiHoverZone] = useState<'left' | 'right'>('right');
  const [isWorkNodePanelOpen, setIsWorkNodePanelOpen] = useState(false);
  const [workNodeRefreshKey, setWorkNodeRefreshKey] = useState(0);
  const [workNodeCameraResetKey, setWorkNodeCameraResetKey] = useState(0);
  const [workNodeSaveNotice, setWorkNodeSaveNotice] = useState('');
  const [pendingWorkNodeCheckoutId, setPendingWorkNodeCheckoutId] = useState('');
  const [isRefreshingAvailableCandidates, setIsRefreshingAvailableCandidates] = useState(false);
  const [isBatchResistanceModalOpen, setIsBatchResistanceModalOpen] = useState(false);
  const [batchTargetResistance, setBatchTargetResistance] = useState<Required<HitResistanceInput>>(
    EMPTY_BATCH_TARGET_RESISTANCE
  );
  const [resistanceRevision, setResistanceRevision] = useState(0);
  const [candidateBuffRevision, setCandidateBuffRevision] = useState(0);
  const [checkoutBootstrapRevision, setCheckoutBootstrapRevision] = useState(0);
  const [authoritativeCheckoutContentRevision, setAuthoritativeCheckoutContentRevision] = useState<number | null>(null);
  const [checkoutRenderRevision, setCheckoutRenderRevision] = useState(0);
  const [nodeReviewRefreshRevision, setNodeReviewRefreshRevision] = useState(0);
  const [isTimelineSessionReady, setIsTimelineSessionReady] = useState(false);
  const [timelineSessionError, setTimelineSessionError] = useState('');
  const activeTimelineArchiveLibrary = restorePanelTab === 'local'
    ? { title: '本地存档', emptyLabel: '本地', archives: localTimelineArchives, library: 'local' as const }
    : restorePanelTab === 'shared'
      ? { title: '共享存档', emptyLabel: '共享', archives: sharedTimelineArchives, library: 'shared' as const }
      : null;
  const {
    activeTimelineId,
    activeTimelineLabel,
    activeTimelineIsTemporary,
    checkoutRef: activeCheckoutRef,
    workingPayload: activeWorkingPayload,
    setWorkingPayload: setSessionWorkingPayload,
    activate: activateTimeline,
    refreshActiveDocument,
  } = useTimelineSession();
  const shareImportInputRef = useRef<HTMLInputElement>(null);
  const isProcessingWorkbenchCommandRef = useRef(false);
  const processMainWorkbenchCanvasCommandRef = useRef<(() => Promise<void>) | null>(null);
  const isCheckoutMutationPendingRef = useRef(false);
  const checkoutBootstrapIdentityRef = useRef<string | null>(null);
  const isCheckoutBootstrapPendingRef = useRef(true);
  const nodeReviewRef = useRef<MainWorkbenchSnapshot['nodeReview']>(null);
  const nodeReviewRequestRef = useRef(0);
  const timelineNameRequestRef = useRef<Promise<string | null> | null>(null);
  const timelineNameResolverRef = useRef<((value: string | null) => void) | null>(null);
  const activeTimelineIdentityRef = useRef({
    timelineId: activeTimelineId,
    checkout: checkoutIdentity(activeCheckoutRef),
    isTemporary: activeTimelineIsTemporary,
  });
  activeTimelineIdentityRef.current = {
    timelineId: activeTimelineId,
    checkout: checkoutIdentity(activeCheckoutRef),
    isTemporary: activeTimelineIsTemporary,
  };
  const temporaryPromotionRef = useRef(activeTimelineIsTemporary);

  const refreshCandidateBuffsForCharacters = useCallback(async (
    characters: Parameters<typeof refreshAvailableCandidateBuffsForCharacters>[0],
  ) => {
    const next = await refreshAvailableCandidateBuffsForCharacters(characters);
    setCandidateBuffRevision((revision) => revision + 1);
    return next;
  }, []);

  const canvasWidth = useCanvasWidth(canvasConfig.canvasWidthPercent);
  useSelectStart();

  const openWorkNodePanel = async () => {
    if (timelineSessionError) {
      setWorkNodeSaveNotice(timelineSessionError);
      window.setTimeout(() => setWorkNodeSaveNotice(''), 4200);
      return;
    }
    if (!await promoteTemporaryTimeline()) return;
    setPendingWorkNodeCheckoutId('');
    setWorkNodeRefreshKey((current) => current + 1);
    setIsWorkNodePanelOpen(true);
  };

  const handleWorkNodeSelection = useCallback((node: WorkbenchSelectedNodeContext) => {
    setPendingWorkNodeCheckoutId(node.nodeId);
  }, []);

  useEffect(() => {
    temporaryPromotionRef.current = activeTimelineIsTemporary;
  }, [activeTimelineIsTemporary]);

  useEffect(() => () => {
    timelineNameResolverRef.current?.(null);
    timelineNameResolverRef.current = null;
    timelineNameRequestRef.current = null;
  }, []);

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

  const buildRuntimeSkillButtonsFromTimelineData = useCallback((dataToRestore: TimelineData, characters = selectedCharacters) => {
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
        if (!character || lineIndex < 0 || (btn.characterId && btn.characterId !== character.id) || btn.characterName !== character.name) {
          throw new Error(`CHECKOUT_TIMELINE_IDENTITY_MISMATCH: ${btn.id} 无法解析到当前干员行。`);
        }
        const restoredLineIndex = lineIndex;
        const timelineNodeIndex = typeof btn.nodeIndex === 'number' && Number.isFinite(btn.nodeIndex) ? btn.nodeIndex : 0;
        // Persisted staffIndex identifies the character row. The horizontal
        // grid group is encoded in the global nodeIndex (0..14, 15..29, ...).
        // Treating staffIndex as the group index produces the characteristic
        // diagonal restore bug: character 1 only appears in group 1,
        // character 2 in group 2, and later groups disappear off-canvas.
        const restoredStaffIndex = Math.floor(timelineNodeIndex / GRID_NODE_COUNT);
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
        if (!resolvedRuntimeSkill || resolvedRuntimeSkill.buttonType !== btn.skillType) {
          throw new Error(`CHECKOUT_TIMELINE_SKILL_UNTRUSTED: ${btn.id} 的 ${btn.skillType} 无法在 ${character.name} 的可信技能目录中解析。`);
        }
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
          runtimeSkillId: resolvedRuntimeSkill.id,
          skillDisplayName: resolvedRuntimeSkill.displayName,
          skillIconUrl: resolvedRuntimeSkill.iconUrl ?? btn.skillIconUrl ?? resolveSkillIconUrl(btn.characterName, btn.skillType),
          customHits: btn.customHits,
          element: character?.element,
        });
      });
    });
    return restoredButtons;
  }, [selectedCharacters]);

  const hydrateCheckoutRuntime = useCallback((payload: TimelineSnapshotPayload, options: { flushRender?: boolean } = {}) => {
    const validation = validateTimelinePayload(payload);
    if (!validation.ok) {
      throw new Error(`CHECKOUT_RUNTIME_HYDRATION_FAILED: ${validation.issues.map((issue) => issue.message).join('；')}`);
    }
    const restorableCharacterMap = new Map<string, Character>();
    [...loadedCharacters, ...loadLocalOperatorCharacters()].forEach((character) => {
      restorableCharacterMap.set(character.id, character);
      restorableCharacterMap.set(character.name, character);
    });
    const resolvedCharacters = payload.selectedCharacters
      .map((id) => restorableCharacterMap.get(id))
      .filter((character): character is Character => Boolean(character));
    if (resolvedCharacters.length !== payload.selectedCharacters.length) {
      const resolvedIds = new Set(resolvedCharacters.flatMap((character) => [character.id, character.name]));
      const missingIds = payload.selectedCharacters.filter((id) => !resolvedIds.has(id));
      throw new Error(`CHECKOUT_RUNTIME_HYDRATION_FAILED: 无法解析 checkout 干员 ${missingIds.join('、') || 'unknown'}。`);
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
            lineIndex: button.lineIndex ?? button.staffIndex,
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
    const normalizedTimelineData = normalizeTimelineData(canonicalTimelineData, resolvedCharacters);
    // Build and validate every visible runtime button before mutating any
    // sessionStorage or React state. A trusted-skill/identity failure must
    // leave the previous checkout projection byte-for-byte intact.
    const restoredButtons = buildRuntimeSkillButtonsFromTimelineData(normalizedTimelineData, resolvedCharacters);
    setSessionWorkingPayload(payload, 'checkout');
    applyTimelineSnapshotPayload(payload);
    setSkillButtonTable(normalizedSkillButtonTable);
    saveTimelineRepo(normalizedTimelineData);
    const commitReactRuntime = () => {
      replaceTimelineData(normalizedTimelineData);
      dispatch({ type: 'SET_SELECTED_CHARACTERS', characters: resolvedCharacters });
      dispatch({ type: 'SET_SKILL_BUTTONS', buttons: restoredButtons });
    };
    // Renderer commands run inside a long-lived async queue callback. React
    // may otherwise retain these updates in its automatic batch while the
    // command is already polling the DOM, producing a false 0/old-button
    // postcondition and rolling the valid payload back. Only command-driven
    // visible checkout uses flushSync; bootstrap/effect hydration stays
    // deferred to avoid flushing from a lifecycle callback.
    if (options.flushRender) flushSync(commitReactRuntime);
    else commitReactRuntime();
  }, [buildRuntimeSkillButtonsFromTimelineData, dispatch, loadedCharacters, normalizeTimelineData, replaceTimelineData, selectedCharacters, setSessionWorkingPayload]);

  const readFormalCheckoutPayload = useCallback(async (
    timelineId: string,
    expectedCheckoutRef: TimelineCheckoutRef | null,
  ) => {
    if (!timelineId || !expectedCheckoutRef || expectedCheckoutRef.timelineId !== timelineId) {
      throw new Error('当前正式 SQLite 没有可恢复的 checkout。');
    }
    const repository = createTimelineRepositoryClient();
    const exported = await repository.exportDocumentBundle(timelineId);
    if (exported.document.id !== timelineId || exported.document.isTemporary || exported.document.archivedAt) {
      throw new Error('当前 SQLite 工作区不可恢复。');
    }
    const persistedCheckout = exported.checkoutRef;
    if (!persistedCheckout || checkoutIdentity(persistedCheckout) !== checkoutIdentity(expectedCheckoutRef)) {
      throw new Error('当前 checkout 已变化，请刷新后重试。');
    }
    const checkoutWorkNode = persistedCheckout.targetType === 'work-node'
      ? exported.workNodes.find((node) => node.id === persistedCheckout.targetId)
      : null;
    const payload = persistedCheckout.targetType === 'snapshot'
      ? exported.snapshots.find((snapshot) => snapshot.id === persistedCheckout.targetId)?.payload
      : checkoutWorkNode?.workingPayload;
    if (!payload) {
      throw new Error('当前 checkout payload 不存在。');
    }
    return {
      payload,
      checkoutRef: persistedCheckout,
    };
  }, []);

  const refreshWorkbenchAfterCheckout = useCallback(() => {
    // Re-mount the data-bound canvas/sandbox once after checkout hydration so
    // local layout caches cannot retain the previous operator set.
    setCheckoutRenderRevision((revision) => revision + 1);
    setWorkNodeRefreshKey((revision) => revision + 1);
  }, []);

  const waitForVisibleCanvasButtons = useCallback(async (expectedIds: string[], waitMs = 3000) => {
    const expected = [...expectedIds].sort();
    const deadline = Date.now() + waitMs;
    let actual: string[] = [];
    do {
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
      actual = [...(canvasRef.current?.querySelectorAll<HTMLElement>('[data-skill-button-id]') ?? [])]
        .map((element) => element.dataset.skillButtonId || '')
        .filter(Boolean)
        .sort();
      if (JSON.stringify(actual) === JSON.stringify(expected)) {
        return { pass: true, expected, actual };
      }
    } while (Date.now() < deadline && document.visibilityState === 'visible');
    return { pass: false, expected, actual };
  }, []);

  useEffect(() => {
    void refreshActiveDocument()
      .then(() => setTimelineSessionError(''))
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        setTimelineSessionError(`无法读取正式 SQLite 工作区：${message}。请从桌面 Shell 的“打开浏览器 Web”进入工作台后重试。`);
      })
      .finally(() => setIsTimelineSessionReady(true));
  }, [refreshActiveDocument]);

  useEffect(() => {
    let cancelled = false;
    const expectedTimelineId = activeTimelineId;
    const expectedCheckout = activeCheckoutRef;
    setAuthoritativeCheckoutContentRevision(null);
    if (!expectedCheckout || expectedCheckout.timelineId !== expectedTimelineId) return () => {
      cancelled = true;
    };
    void readPersistedWorkspaceCheckout(expectedTimelineId, expectedCheckout)
      .then((source) => {
        const current = activeTimelineIdentityRef.current;
        if (!cancelled
          && current.timelineId === expectedTimelineId
          && current.checkout === checkoutIdentity(expectedCheckout)) {
          setAuthoritativeCheckoutContentRevision(source.contentRevision);
        }
      })
      .catch(() => {
        // Fail closed: no writable Agent binding is published without the
        // target Work Node contentRevision / snapshot createdAt.
      });
    return () => {
      cancelled = true;
    };
  }, [activeCheckoutRef, activeTimelineId, checkoutBootstrapRevision, nodeReviewRefreshRevision]);

  useEffect(() => {
    if (!isTimelineSessionReady || loadedCharacters.length === 0) return;
    const bootstrapIdentity = `${activeTimelineId}:${checkoutIdentity(activeCheckoutRef)}:${activeTimelineIsTemporary ? 'temporary' : 'formal'}`;
    if (checkoutBootstrapIdentityRef.current === bootstrapIdentity) return;
    checkoutBootstrapIdentityRef.current = bootstrapIdentity;
    isCheckoutBootstrapPendingRef.current = true;
    if (activeTimelineIsTemporary) {
      // 临时 SQLite 的实时工作副本已由 user.sqlite 持久化。刷新或重启时
      // 不能用它创建时的空快照覆盖这份未保存的内容。
      isCheckoutBootstrapPendingRef.current = false;
      setCheckoutBootstrapRevision((revision) => revision + 1);
      return;
    }
    void (async () => {
      try {
        const { payload } = await readFormalCheckoutPayload(activeTimelineId, activeCheckoutRef);
        const currentIdentity = activeTimelineIdentityRef.current;
        if (currentIdentity.timelineId === activeTimelineId
          && currentIdentity.checkout === checkoutIdentity(activeCheckoutRef)
          && !currentIdentity.isTemporary) {
          hydrateCheckoutRuntime(payload);
        }
      } catch {
        // A first-run document legitimately has no checkout to hydrate.
      } finally {
        if (checkoutBootstrapIdentityRef.current === bootstrapIdentity) {
          isCheckoutBootstrapPendingRef.current = false;
          setCheckoutBootstrapRevision((revision) => revision + 1);
        }
      }
    })();
  }, [activeCheckoutRef, activeTimelineId, activeTimelineIsTemporary, hydrateCheckoutRuntime, isTimelineSessionReady, loadedCharacters.length, readFormalCheckoutPayload]);

  const findCharacterForWorkbenchCommand = (command: Extract<MainWorkbenchCommand, { op: 'addSkillButton' | 'removeSkillButton' | 'addBuff' | 'removeBuff' | 'setOperatorWeapon' | 'setOperatorEquipment' | 'setOperatorConfig' }>) => {
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

  const makeOperatorConfigCommandError = (code: string, message: string) => {
    const error = new Error(message) as Error & { code?: string };
    error.code = code;
    return error;
  };

  const resolveOperatorCharacterForWorkbenchCommand = (command: Extract<MainWorkbenchCommand, { op: 'setOperatorWeapon' | 'setOperatorEquipment' | 'setOperatorConfig' }>) => {
    const characterId = command.characterId?.trim() || '';
    const characterName = command.characterName?.trim() || '';
    if (!characterId && !characterName) {
      throw makeOperatorConfigCommandError('operator-config-target-required', `${command.op} requires an exact characterId or characterName.`);
    }
    const idMatches = characterId ? selectedCharacters.filter((character) => character.id === characterId) : [];
    const nameMatches = characterName ? selectedCharacters.filter((character) => character.name === characterName) : [];
    if (characterId && idMatches.length !== 1) {
      throw makeOperatorConfigCommandError('operator-config-target-not-found', `未找到已选干员 id: ${characterId}`);
    }
    if (characterName && nameMatches.length !== 1) {
      throw makeOperatorConfigCommandError(
        nameMatches.length > 1 ? 'operator-config-target-ambiguous' : 'operator-config-target-not-found',
        `未找到唯一的已选干员名称: ${characterName}`,
      );
    }
    const byId = idMatches[0];
    const byName = nameMatches[0];
    if (byId && byName && byId.id !== byName.id) {
      throw makeOperatorConfigCommandError('operator-config-target-mismatch', `干员 id ${characterId} 与名称 ${characterName} 不属于同一已选干员。`);
    }
    return byId || byName;
  };

  const prepareOperatorConfigCheckout = async () => {
    if (!activeCheckoutRef || activeCheckoutRef.targetType !== 'work-node') {
      throw makeOperatorConfigCommandError('operator-config-checkout-unavailable', '当前角色配置只能写入一个已检出的 Work Node；未找到可持久化的 checkout。');
    }
    const client = createAiTimelineWorkNodeClient();
    const { node } = await client.get(activeCheckoutRef.targetId);
    if (node.timelineId !== activeTimelineId || node.id !== activeCheckoutRef.targetId) {
      throw makeOperatorConfigCommandError('operator-config-checkout-conflict', '当前 Work Node checkout 已变化；请重新打开工作台后再应用角色配置。');
    }
    return node;
  };

  const persistOperatorConfigCheckout = async (checkoutNodeId: string) => {
    // This pre-approved path performed an unconditional full payload update.
    // Fail closed: typed DEF mutations must use preview -> child -> approval
    // -> revision-checked apply, never silently overwrite a Work Node.
    void checkoutNodeId;
    throw makeOperatorConfigCommandError('operator-config-legacy-route-retired', '旧角色配置写入链路已停用；请使用带原生审批的 def_operator_config_patch。');
  };

  const normalizeWorkbenchWeaponPotential = (potential: string | undefined, fallback: string) => {
    if (!potential) return fallback;
    if (potential === 'P0') return '0潜';
    if (potential === 'PMAX') return '满潜';
    return potential;
  };

  const buildOperatorConfigPreviewFromWorkbenchCommand = async (
    command: Extract<MainWorkbenchCommand, { op: 'setOperatorConfig' }>,
  ) => {
    const checkout = await prepareOperatorConfigCheckout();
    const character = resolveOperatorCharacterForWorkbenchCommand(command);
    const originalCache = getOperatorConfigPageCache();
    const originalPayload = getCurrentTimelineSnapshotPayload();
    if (!originalPayload) {
      throw makeOperatorConfigCommandError('operator-config-payload-unavailable', '无法读取当前角色配置的完整 checkout payload。');
    }
    const originalTimelineValidation = validateTimelinePayload(originalPayload);
    if (!originalTimelineValidation.ok) {
      throw makeOperatorConfigCommandError(
        'operator-config-timeline-invalid',
        `当前 checkout 排轴镜像不一致：${originalTimelineValidation.issues.map((issue) => issue.message).join('；')}`,
      );
    }
    const weaponName = command.weaponName?.trim() || '';
    const hasEquipment = Boolean(command.equipments?.length || command.equipmentId || command.equipmentName || command.gearSetId || command.gearSetName);
    const selections = hasEquipment
      ? (command.equipments?.length
        ? command.equipments.map((selection) => ({
            ...selection,
            gearSetId: selection.gearSetId ?? command.gearSetId,
            gearSetName: selection.gearSetName ?? command.gearSetName,
            entryLevel: selection.entryLevel ?? command.equipmentEntryLevel ?? command.entryLevel,
            entryLevels: selection.entryLevels ?? command.equipmentEntryLevels ?? command.entryLevels,
          }))
        : [{
            slotKey: command.slotKey,
            part: command.part,
            equipmentId: command.equipmentId,
            equipmentName: command.equipmentName,
            gearSetId: command.gearSetId,
            gearSetName: command.gearSetName,
            fillSlots: command.fillSlots,
            entryLevel: command.equipmentEntryLevel ?? command.entryLevel,
            entryLevels: command.equipmentEntryLevels ?? command.entryLevels,
          }])
      : [];

    try {
      // Refresh is used only to obtain the same canonical source data as the
      // configuration page.  Its temporary cache write is restored before the
      // preview command returns, so a preview cannot mutate live state.
      await refreshOperatorConfigSnapshotsForCharacters([character]);
      const snapshot = getOperatorConfigPageCache()[character.id];
      if (!snapshot) throw makeOperatorConfigCommandError('operator-config-snapshot-unavailable', `未找到干员配置快照: ${character.name}`);

      let nextSnapshot = snapshot;
      if (weaponName) {
        const potential = normalizeWorkbenchWeaponPotential(command.potential, '0潜');
        const requestedSkills = command.weaponSkillLevels ?? command.skillLevels ?? {};
        const skill3Base = requestedSkills.skill3 ?? DEFAULT_WEAPON_SKILL_LEVELS.skill3;
        nextSnapshot = {
          ...nextSnapshot,
          weapon: {
            ...nextSnapshot.weapon,
            id: weaponName,
            name: weaponName,
            config: {
              ...nextSnapshot.weapon.config,
              level: command.weaponLevel ?? command.level ?? DEFAULT_WEAPON_LEVEL,
              potential,
              skillLevels: {
                skill1: requestedSkills.skill1 ?? DEFAULT_WEAPON_SKILL_LEVELS.skill1,
                skill2: requestedSkills.skill2 ?? DEFAULT_WEAPON_SKILL_LEVELS.skill2,
                // skill3 is specified before potential.  Store the resolved
                // UI value once, never add the bonus again during apply.
                skill3: skill3Base + getWeaponSkill3PotentialBonus(potential),
              },
            },
          },
        };
      }
      const equipmentPatch = hasEquipment ? applyOperatorEquipmentSelectionsToSnapshot(nextSnapshot, selections) : null;
      if (equipmentPatch) nextSnapshot = equipmentPatch.snapshot;
      const operatorSkillLevels = {
        ...DEFAULT_OPERATOR_SKILL_CONFIG,
        ...(nextSnapshot.operator.skillConfig ?? {}),
        ...(command.operatorSkillLevels ?? {}),
      };
      nextSnapshot = {
        ...nextSnapshot,
        operator: { ...nextSnapshot.operator, skillConfig: operatorSkillLevels },
      };

      // Let the canonical refresher resolve weapon data/equipment calculations
      // against the page libraries, then immediately restore the live cache.
      setOperatorConfigPageCache({ ...originalCache, [character.id]: nextSnapshot });
      await refreshOperatorConfigSnapshotsForCharacters([character]);
      const resolvedSnapshot = getOperatorConfigPageCache()[character.id] ?? nextSnapshot;
      const preparedPayload = structuredClone(originalPayload);
      preparedPayload.operatorConfigPageCache = {
        ...preparedPayload.operatorConfigPageCache,
        [character.id]: resolvedSnapshot,
      };
      preparedPayload.characterInputMap = {
        ...preparedPayload.characterInputMap,
        [character.id]: {
          ...(preparedPayload.characterInputMap[character.id] ?? {}),
          skillLevels: {
            ...DEFAULT_OPERATOR_SKILL_CONFIG,
            ...(preparedPayload.characterInputMap[character.id]?.skillLevels ?? {}),
            ...operatorSkillLevels,
          } as typeof preparedPayload.characterInputMap[string]['skillLevels'],
        },
      };
      const preparedTimelineValidation = validateTimelinePayload(preparedPayload);
      if (!preparedTimelineValidation.ok) {
        throw makeOperatorConfigCommandError(
          'operator-config-timeline-invalid',
          `配置预览没有保留有效排轴：${preparedTimelineValidation.issues.map((issue) => issue.message).join('；')}`,
        );
      }
      const finalConfig = {
        characterId: character.id,
        characterName: character.name,
        weapon: {
          id: resolvedSnapshot.weapon.id,
          name: resolvedSnapshot.weapon.name,
          level: resolvedSnapshot.weapon.config.level,
          potential: resolvedSnapshot.weapon.config.potential,
          skillLevels: resolvedSnapshot.weapon.config.skillLevels,
        },
        equipment: resolvedSnapshot.equipment.pieces.map((piece) => ({
          slotKey: piece.slotKey,
          equipmentId: piece.equipmentId,
          name: piece.name,
          effects: piece.effects.map((effect) => ({ effectId: effect.effectId, label: effect.label, level: effect.level, value: effect.value })),
        })),
        operatorSkillLevels: resolvedSnapshot.operator.skillConfig,
      };
      return {
        parentNodeId: checkout.id,
        parentRevision: Number(checkout.contentRevision ?? checkout.updatedAt),
        preparedPayload,
        finalConfig,
      };
    } finally {
      setOperatorConfigPageCache(originalCache);
    }
  };

  const operatorConfigNodeRevision = (node: { contentRevision?: number; updatedAt: number }): number => (
    Number(node.contentRevision ?? node.updatedAt)
  );

  const sameOperatorConfigPayload = (left: TimelineSnapshotPayload, right: TimelineSnapshotPayload): boolean => (
    serializeCheckpointPayload(left) === serializeCheckpointPayload(right)
  );

  const makeOperatorConfigProposalError = (code: string, message: string) => {
    const error = new Error(message) as Error & { code?: string };
    error.code = code;
    return error;
  };

  const prepareOperatorConfigProposalFromWorkbenchCommand = async (
    command: Extract<MainWorkbenchCommand, { op: 'prepareOperatorConfigProposal' }>,
  ) => {
    const parent = await prepareOperatorConfigCheckout();
    const currentPayload = getCurrentTimelineSnapshotPayload();
    if (!currentPayload || !sameOperatorConfigPayload(currentPayload, parent.workingPayload)) {
      throw makeOperatorConfigProposalError(
        'operator-config-checkout-payload-stale',
        '当前 Canvas payload 与正式 checkout 不一致；未创建配装提案，请重新发布工作台快照。',
      );
    }
    const parentValidation = validateTimelinePayload(parent.workingPayload);
    if (!parentValidation.ok) {
      throw makeOperatorConfigProposalError(
        'operator-config-parent-invalid',
        `当前 checkout 排轴校验失败：${parentValidation.issues.map((issue) => issue.message).join('；')}`,
      );
    }

    const preview = await buildOperatorConfigPreviewFromWorkbenchCommand(command.request);
    if (preview.parentNodeId !== parent.id
      || preview.parentRevision !== operatorConfigNodeRevision(parent)) {
      throw makeOperatorConfigProposalError(
        'operator-config-parent-revision-drift',
        '配装预览期间正式 checkout 已变化；未创建配装提案。',
      );
    }
    const preparedValidation = validateTimelinePayload(preview.preparedPayload);
    if (!preparedValidation.ok) {
      throw makeOperatorConfigProposalError(
        'operator-config-prepared-invalid',
        `配装预览排轴校验失败：${preparedValidation.issues.map((issue) => issue.message).join('；')}`,
      );
    }
    const diff = diffTimelinePayloads(parent.workingPayload, preview.preparedPayload);
    if (diff.changedOperatorConfigs.length !== 1) {
      throw makeOperatorConfigProposalError(
        'operator-config-change-not-single-target',
        `配装提案必须只改变一个干员配置，实际检测到 ${diff.changedOperatorConfigs.length} 个配置变更。`,
      );
    }
    const characterId = diff.changedOperatorConfigs[0].characterId;
    const finalConfig = buildOperatorConfigFinalConfig(preview.preparedPayload, characterId);
    const previewFinalConfig = normalizeOperatorConfigFinalConfig(preview.finalConfig);
    if (!finalConfig || !previewFinalConfig || !equalOperatorConfigFinalConfig(finalConfig, previewFinalConfig)) {
      throw makeOperatorConfigProposalError(
        'operator-config-preview-authority-mismatch',
        '配装预览的用户配置与候选 payload 重算结果不一致；提案已拒绝。',
      );
    }
    const timelinePreservation = await buildTimelinePreservation(parent.workingPayload, preview.preparedPayload);
    if (!timelinePreservation.pass) {
      throw makeOperatorConfigProposalError(
        'operator-config-timeline-not-preserved',
        `配装预览改变了排轴内容：${timelinePreservation.changedPaths.join(', ')}`,
      );
    }

    const client = createAiTimelineWorkNodeClient();
    // This is intentionally a horizontal branch: the candidate is a sibling
    // of the current checkout in the Work Node tree, while its base payload is
    // still the exact current checkout payload.
    const candidateResponse = await client.create({
      timelineId: parent.timelineId,
      parentNodeId: parent.parentNodeId || null,
      branchId: `operator-config-${parent.id}-${Date.now()}`,
      label: command.label,
      description: command.description,
      basePayload: parent.workingPayload,
      workingPayload: preview.preparedPayload,
      approvalPolicy: 'manual',
      riskFlags: [],
    });
    const candidate = candidateResponse.node;
    const candidateRevision = operatorConfigNodeRevision(candidate);
    const candidateDiff = diffTimelinePayloads(candidate.basePayload, candidate.workingPayload);
    if (!sameOperatorConfigPayload(candidate.basePayload, parent.workingPayload)
      || !sameOperatorConfigPayload(candidate.workingPayload, preview.preparedPayload)
      || candidateDiff.changedOperatorConfigs.length !== 1) {
      throw makeOperatorConfigProposalError(
        'operator-config-candidate-payload-mismatch',
        '浏览器 SQLite 候选 Work Node payload 与预览不一致；提案已拒绝。',
      );
    }
    const candidateTimelinePreservation = await buildTimelinePreservation(candidate.basePayload, candidate.workingPayload);
    const proposalDigest = await buildOperatorConfigProposalDigest({
      parentNodeId: parent.id,
      parentRevision: operatorConfigNodeRevision(parent),
      nodeId: candidate.id,
      nodeRevision: candidateRevision,
      finalConfig,
      diff: candidateDiff,
      timelinePreservation: candidateTimelinePreservation,
      workingPayload: candidate.workingPayload,
    });
    return {
      ok: true,
      kind: 'operator-config-proposal',
      path: 'browser-sqlite://timeline-work-nodes',
      liveCheckoutTouched: false,
      parentNodeId: parent.id,
      parentRevision: operatorConfigNodeRevision(parent),
      nodeId: candidate.id,
      nodeRevision: candidateRevision,
      proposalDigest,
      finalConfig,
      diff: candidateDiff,
      timelinePreservation: candidateTimelinePreservation,
      candidatePayloadDigest: await digestJson(candidate.workingPayload),
    };
  };

  const applyPreparedOperatorConfigFromWorkbenchCommand = async (
    command: Extract<MainWorkbenchCommand, { op: 'applyPreparedOperatorConfig' }>,
  ) => {
    if (activeCheckoutRef?.targetType !== 'work-node' || activeCheckoutRef.targetId !== command.parentNodeId) {
      throw makeOperatorConfigCommandError('checkout-changed', '审批期间 checkout 已变化；未执行角色配置。');
    }
    const client = createAiTimelineWorkNodeClient();
    const parent = await client.get(command.parentNodeId);
    if (operatorConfigNodeRevision(parent.node) !== Number(command.parentRevision)) {
      throw makeOperatorConfigCommandError('checkout-changed', '审批期间 checkout revision 已变化；未执行角色配置。');
    }
    const child = await client.get(command.nodeId);
    if (operatorConfigNodeRevision(child.node) !== Number(command.nodeRevision)) {
      throw makeOperatorConfigCommandError('checkout-changed', '待审批 Work Node 已变化；未执行角色配置。');
    }
    const childTimelineValidation = validateTimelinePayload(child.node.workingPayload);
    if (!childTimelineValidation.ok) {
      throw makeOperatorConfigCommandError(
        'operator-config-timeline-invalid',
        `待审批配置分支排轴镜像不一致：${childTimelineValidation.issues.map((issue) => issue.message).join('；')}`,
      );
    }
    applyTimelineSnapshotPayload(child.node.workingPayload);
    setSessionWorkingPayload(child.node.workingPayload, 'checkout');
    setResistanceRevision((value) => value + 1);
    return {
      nodeId: child.node.id,
      nodeRevision: operatorConfigNodeRevision(child.node),
      parentNodeId: parent.node.id,
      parentRevision: operatorConfigNodeRevision(parent.node),
      appliedPayload: child.node.workingPayload,
    };
  };

  const applyPreparedOperatorConfigProposalFromWorkbenchCommand = async (
    command: Extract<MainWorkbenchCommand, { op: 'applyPreparedOperatorConfigProposal' }>,
  ) => {
    const parent = await prepareOperatorConfigCheckout();
    const repository = createTimelineRepositoryClient();
    const persistedParentCheckout = await repository.getCheckoutRef(parent.timelineId);
    const currentPayload = getCurrentTimelineSnapshotPayload();
    const parentRevision = operatorConfigNodeRevision(parent);
    if (parent.id !== command.parentNodeId
      || parentRevision !== command.parentRevision
      || persistedParentCheckout?.targetType !== 'work-node'
      || persistedParentCheckout.targetId !== parent.id
      || !currentPayload
      || !sameOperatorConfigPayload(currentPayload, parent.workingPayload)) {
      throw makeOperatorConfigProposalError(
        'operator-config-stale-parent',
        '正式 checkout、revision 或当前 Canvas payload 已变化；配装提案拒绝应用。',
      );
    }
    const client = createAiTimelineWorkNodeClient();
    const candidateResponse = await client.get(command.nodeId);
    const candidate = candidateResponse.node;
    const candidateRevision = operatorConfigNodeRevision(candidate);
    if (candidate.timelineId !== parent.timelineId
      || candidateRevision !== command.nodeRevision
      || (candidate.parentNodeId || null) !== (parent.parentNodeId || null)
      || !sameOperatorConfigPayload(candidate.basePayload, parent.workingPayload)) {
      throw makeOperatorConfigProposalError(
        'operator-config-stale-candidate',
        '待审批配装候选的 revision、结构父节点或 base payload 已变化；拒绝应用。',
      );
    }
    if (candidate.status !== 'open' && candidate.status !== 'ready') {
      throw makeOperatorConfigProposalError(
        'operator-config-candidate-not-available',
        `待审批配装候选状态为 ${candidate.status}，不能再次提交。`,
      );
    }
    const candidateValidation = validateTimelinePayload(candidate.workingPayload);
    if (!candidateValidation.ok) {
      throw makeOperatorConfigProposalError(
        'operator-config-candidate-invalid',
        `待审批配装候选排轴校验失败：${candidateValidation.issues.map((issue) => issue.message).join('；')}`,
      );
    }
    const diff = diffTimelinePayloads(candidate.basePayload, candidate.workingPayload);
    if (diff.changedOperatorConfigs.length !== 1) {
      throw makeOperatorConfigProposalError(
        'operator-config-change-not-single-target',
        `待审批配装必须只改变一个干员配置，实际检测到 ${diff.changedOperatorConfigs.length} 个配置变更。`,
      );
    }
    const characterId = diff.changedOperatorConfigs[0].characterId;
    const finalConfig = buildOperatorConfigFinalConfig(candidate.workingPayload, characterId);
    const submittedFinalConfig = normalizeOperatorConfigFinalConfig(command.finalConfig);
    if (!finalConfig || !submittedFinalConfig || !equalOperatorConfigFinalConfig(finalConfig, submittedFinalConfig)) {
      throw makeOperatorConfigProposalError(
        'operator-config-final-config-mismatch',
        '审批命令中的 finalConfig 与候选 payload 重算结果不一致；拒绝应用。',
      );
    }
    const timelinePreservation = await buildTimelinePreservation(candidate.basePayload, candidate.workingPayload);
    if (!timelinePreservation.pass) {
      throw makeOperatorConfigProposalError(
        'operator-config-timeline-not-preserved',
        `待审批配装改变了排轴内容：${timelinePreservation.changedPaths.join(', ')}`,
      );
    }
    const proposalDigest = await buildOperatorConfigProposalDigest({
      parentNodeId: parent.id,
      parentRevision,
      nodeId: candidate.id,
      nodeRevision: candidateRevision,
      finalConfig,
      diff,
      timelinePreservation,
      workingPayload: candidate.workingPayload,
    });
    if (proposalDigest !== command.proposalDigest) {
      throw makeOperatorConfigProposalError(
        'operator-config-proposal-digest-mismatch',
        '审批提案摘要与浏览器 SQLite 候选内容不一致；拒绝应用。',
      );
    }

    const commitResponse = await client.commit(candidate.id, {
      label: candidate.label,
      riskFlags: candidate.riskFlags,
      approval: {
        mode: 'manual',
        approvedAt: Date.now(),
        approvedBy: 'user',
        rationale: command.approval.rationale || '用户批准了配装 Work Node 的原子应用。',
      },
    });
    if (!sameOperatorConfigPayload(commitResponse.commit.appliedPayload, candidate.workingPayload)) {
      throw makeOperatorConfigProposalError(
        'operator-config-commit-payload-mismatch',
        'SQLite commit payload 与候选 payload 不一致；未触碰 live checkout。',
      );
    }

    let liveTouched = false;
    let rollbackError: string | undefined;
    try {
      // This existing helper performs the canonical renderer hydration. Mark
      // the live phase before entering it so a partial hydration is also
      // covered by the exact rollback path below.
      liveTouched = true;
      await applyPreparedOperatorConfigFromWorkbenchCommand({
        op: 'applyPreparedOperatorConfig',
        parentNodeId: parent.id,
        parentRevision,
        nodeId: candidate.id,
        nodeRevision: candidateRevision,
      });
      const livePayload = getCurrentTimelineSnapshotPayload();
      if (!livePayload || !sameOperatorConfigPayload(livePayload, candidate.workingPayload)) {
        throw makeOperatorConfigProposalError(
          'operator-config-live-payload-mismatch',
          'live Canvas payload 没有精确等于候选 payload。',
        );
      }
      const liveConfig = buildOperatorConfigFinalConfig(livePayload, characterId);
      if (!liveConfig || !equalOperatorConfigFinalConfig(liveConfig, finalConfig)) {
        throw makeOperatorConfigProposalError(
          'operator-config-live-config-mismatch',
          'live Canvas 配置没有精确等于候选 payload 重算配置。',
        );
      }
      const liveTimelinePreservation = await buildTimelinePreservation(parent.workingPayload, livePayload);
      if (!liveTimelinePreservation.pass) {
        throw makeOperatorConfigProposalError(
          'operator-config-live-timeline-mismatch',
          `live Canvas 改变了排轴内容：${liveTimelinePreservation.changedPaths.join(', ')}`,
        );
      }

      const appliedAt = Date.now();
      const checkoutRef: TimelineCheckoutRef = {
        timelineId: candidate.timelineId,
        targetType: 'work-node',
        targetId: candidate.id,
        updatedAt: appliedAt,
      };
      await repository.setCheckoutRef(checkoutRef);
      const checkoutApplied = await client.markCheckoutApplied(candidate.id, {
        commitId: commitResponse.commit.id,
        appliedAt,
        appliedBy: 'user',
        rationale: command.approval.rationale || '已验证 live 配置、候选 payload 与排轴保持后应用 checkout。',
      });
      if (!checkoutApplied.commit.checkoutApplied
        || checkoutApplied.commit.id !== commitResponse.commit.id
        || !sameOperatorConfigPayload(checkoutApplied.commit.appliedPayload, candidate.workingPayload)) {
        throw makeOperatorConfigProposalError(
          'operator-config-checkout-record-mismatch',
          'SQLite checkout-applied 记录没有精确绑定候选 commit。',
        );
      }
      const finalized = await finalizePreparedOperatorConfigFromWorkbenchCommand({
        op: 'finalizePreparedOperatorConfig',
        nodeId: candidate.id,
        commitId: commitResponse.commit.id,
      });
      const finalPayload = getCurrentTimelineSnapshotPayload();
      const finalCheckout = await repository.getCheckoutRef(candidate.timelineId);
      if (!finalPayload
        || !sameOperatorConfigPayload(finalPayload, candidate.workingPayload)
        || finalCheckout?.targetType !== 'work-node'
        || finalCheckout.targetId !== candidate.id) {
        throw makeOperatorConfigProposalError(
          'operator-config-finalize-postcondition-failed',
          'finalize 后的 Canvas payload 或正式 checkout 不精确。',
        );
      }
      const visiblePostcondition = {
        pass: true,
        expected: {
          checkoutTargetId: candidate.id,
          finalConfig,
          timelinePreservationPass: true,
        },
        observed: {
          checkoutTargetId: finalCheckout.targetId,
          checkoutUpdatedAt: finalCheckout.updatedAt,
          finalConfig,
          candidatePayloadDigest: await digestJson(candidate.workingPayload),
          commitPayloadDigest: await digestJson(checkoutApplied.commit.appliedPayload),
          commitPayloadEqualCandidate: true,
          timelinePreservationPass: true,
        },
      };
      return {
        ok: true,
        applied: true,
        nodeId: candidate.id,
        nodeRevision: candidateRevision,
        parentNodeId: parent.id,
        parentRevision,
        commitId: commitResponse.commit.id,
        proposalDigest,
        finalConfig,
        diff,
        timelinePreservation,
        checkout: finalized.checkout,
        checkoutApplied: true,
        finalized: finalized.finalized,
        visiblePostcondition,
      };
    } catch (error) {
      if (liveTouched) {
        try {
          const rollbackCheckoutRef: TimelineCheckoutRef = {
            timelineId: parent.timelineId,
            targetType: 'work-node',
            targetId: parent.id,
            updatedAt: Date.now(),
          };
          await rollbackOperatorConfigProposal({
            restoreLiveParent: async () => {
              hydrateCheckoutRuntime(parent.workingPayload, { flushRender: true });
              setSessionWorkingPayload(parent.workingPayload, 'checkout');
            },
            restoreCheckout: async () => {
              await repository.setCheckoutRef(rollbackCheckoutRef);
              const document = parent.timelineId === activeTimelineId
                ? { id: activeTimelineId, label: activeTimelineLabel }
                : (await repository.listDocuments()).find((entry) => entry.id === parent.timelineId)
                  || { id: parent.timelineId, label: parent.label };
              activateTimeline({ document, checkoutRef: rollbackCheckoutRef, workingPayload: parent.workingPayload });
              refreshWorkbenchAfterCheckout();
            },
            verifyParentRestored: async () => {
              const restoredPayload = getCurrentTimelineSnapshotPayload();
              return Boolean(restoredPayload && sameOperatorConfigPayload(restoredPayload, parent.workingPayload));
            },
            markCandidateRollback: async () => {
              await client.markRollbackApplied(candidate.id, {
                appliedAt: rollbackCheckoutRef.updatedAt,
                appliedBy: 'system',
                rationale: '配装原子应用失败，已恢复 exact parent checkout；候选节点保留供审计。',
              });
            },
          });
        } catch (rollbackFailure) {
          rollbackError = rollbackFailure instanceof Error ? rollbackFailure.message : String(rollbackFailure);
        }
      }
      const originalMessage = error instanceof Error ? error.message : String(error);
      throw makeOperatorConfigProposalError(
        'operator-config-atomic-apply-failed',
        `${originalMessage}${rollbackError ? `；回滚失败：${rollbackError}` : '；已恢复 exact parent checkout，候选节点保留供审计。'}`,
      );
    }
  };

  const finalizePreparedOperatorConfigFromWorkbenchCommand = async (
    command: Extract<MainWorkbenchCommand, { op: 'finalizePreparedOperatorConfig' }>,
  ) => {
    const client = createAiTimelineWorkNodeClient();
    const { node } = await client.get(command.nodeId);
    const commit = (await client.list()).commits.find((entry) => entry.id === command.commitId && entry.nodeId === node.id);
    if (!commit?.checkoutApplied) {
      throw makeOperatorConfigCommandError('checkout-changed', '审批后的 checkout commit 未处于已应用状态；未切换前端 checkout。');
    }
    const repository = createTimelineRepositoryClient();
    const persistedCheckout = await repository.getCheckoutRef(node.timelineId || activeTimelineId);
    if (persistedCheckout?.targetType !== 'work-node' || persistedCheckout.targetId !== node.id) {
      throw makeOperatorConfigCommandError('checkout-changed', '审批期间 checkout 已变化；未切换前端 checkout。');
    }
    const document = node.timelineId === activeTimelineId
      ? { id: activeTimelineId, label: activeTimelineLabel }
      : (await repository.listDocuments()).find((entry) => entry.id === node.timelineId) || { id: node.timelineId, label: node.label };
    activateTimeline({ document, checkoutRef: persistedCheckout, workingPayload: node.workingPayload });
    hydrateCheckoutRuntime(node.workingPayload);
    refreshWorkbenchAfterCheckout();
    return { nodeId: node.id, commitId: commit.id, checkout: persistedCheckout, finalized: true };
  };

  const restoreAtomicTeamParentFromWorkbenchCommand = async (
    command: Extract<MainWorkbenchCommand, { op: 'restoreAtomicTeamParent' }>,
  ) => {
    const client = createAiTimelineWorkNodeClient();
    const { node: parent } = await client.get(command.parentNodeId);
    const { node: candidate } = await client.get(command.candidateNodeId);
    if (parent.timelineId !== command.expectedTimelineId
      || operatorConfigNodeRevision(parent) !== Number(command.parentRevision)) {
      throw makeOperatorConfigCommandError('checkout-changed', 'Atomic team rollback parent changed; refusing to restore a different checkout.');
    }
    if (candidate.timelineId !== command.expectedTimelineId
      || operatorConfigNodeRevision(candidate) !== Number(command.candidateRevision)) {
      throw makeOperatorConfigCommandError('checkout-changed', 'Atomic team rollback candidate changed; refusing to restore a different checkout.');
    }
    const repository = createTimelineRepositoryClient();
    const persistedCheckout = await repository.getCheckoutRef(command.expectedTimelineId);
    if (persistedCheckout?.targetType !== 'work-node' || persistedCheckout.targetId !== command.expectedCheckoutNodeId
      || activeTimelineId !== command.expectedTimelineId
      || JSON.stringify(getCurrentTimelineSnapshotPayload()) !== JSON.stringify(candidate.workingPayload)) {
      throw makeOperatorConfigCommandError('rollback-stale', 'Atomic team rollback no longer owns the live candidate or checkout; no restoration was performed.');
    }
    // Hydrate P before altering its persisted checkout. If the live/session
    // payload is no longer exactly C, the check above exits without writes.
    hydrateCheckoutRuntime(parent.workingPayload);
    const sessionPayloadMatches = JSON.stringify(getCurrentTimelineSnapshotPayload()) === JSON.stringify(parent.workingPayload);
    if (!sessionPayloadMatches) {
      throw makeOperatorConfigCommandError('rollback-session-payload-mismatch', 'Atomic team rollback could not restore the session payload; checkout was left unchanged.');
    }
    const checkoutRef = {
      timelineId: parent.timelineId || activeTimelineId,
      targetType: 'work-node' as const,
      targetId: parent.id,
      updatedAt: Date.now(),
    };
    await repository.setCheckoutRef(checkoutRef);
    const document = parent.timelineId === activeTimelineId
      ? { id: activeTimelineId, label: activeTimelineLabel }
      : (await repository.listDocuments()).find((entry) => entry.id === parent.timelineId) || { id: parent.timelineId, label: parent.label };
    activateTimeline({ document, checkoutRef, workingPayload: parent.workingPayload });
    refreshWorkbenchAfterCheckout();
    return {
      restored: true,
      parentNodeId: parent.id,
      parentRevision: operatorConfigNodeRevision(parent),
      candidateNodeId: candidate.id,
      candidateRevision: operatorConfigNodeRevision(candidate),
      checkout: checkoutRef,
      sessionPayloadMatches,
    };
  };

  const setOperatorWeaponFromWorkbenchCommand = async (command: Extract<MainWorkbenchCommand, { op: 'setOperatorWeapon' }>) => {
    const weaponName = command.weaponName?.trim();
    if (!weaponName) {
      throw new Error('setOperatorWeapon requires weaponName');
    }
    const cache = getOperatorConfigPageCache();
    const checkout = await prepareOperatorConfigCheckout();
    const character = resolveOperatorCharacterForWorkbenchCommand(command);
    try {
      await refreshOperatorConfigSnapshotsForCharacters([character]);
      const snapshot = getOperatorConfigPageCache()[character.id];
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
        ...getOperatorConfigPageCache(),
        [character.id]: nextSnapshot,
      });
      const refreshResult = await refreshOperatorConfigSnapshotsForCharacters([character]);
      await refreshCandidateBuffsForCharacters([character]);
      const persistence = await persistOperatorConfigCheckout(checkout.id);
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
        persistence,
      };
    } catch (error) {
      setOperatorConfigPageCache(cache);
      await refreshCandidateBuffsForCharacters([character]);
      throw error;
    }
  };

  const setOperatorEquipmentFromWorkbenchCommand = async (command: Extract<MainWorkbenchCommand, { op: 'setOperatorEquipment' }>) => {
    const cache = getOperatorConfigPageCache();
    const checkout = await prepareOperatorConfigCheckout();
    const character = resolveOperatorCharacterForWorkbenchCommand(command);

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

    try {
      await refreshOperatorConfigSnapshotsForCharacters([character]);
      const snapshot = getOperatorConfigPageCache()[character.id];
      if (!snapshot) {
        throw new Error(`未找到干员配置快照: ${character.name}`);
      }

      const patchResult = applyOperatorEquipmentSelectionsToSnapshot(snapshot, selections);
      setOperatorConfigPageCache({
        ...getOperatorConfigPageCache(),
        [character.id]: patchResult.snapshot,
      });
      const refreshResult = await refreshOperatorConfigSnapshotsForCharacters([character]);
      await refreshCandidateBuffsForCharacters([character]);
      const persistence = await persistOperatorConfigCheckout(checkout.id);
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
        persistence,
      };
    } catch (error) {
      setOperatorConfigPageCache(cache);
      await refreshCandidateBuffsForCharacters([character]);
      throw error;
    }
  };

  const setOperatorConfigFromWorkbenchCommand = async (command: Extract<MainWorkbenchCommand, { op: 'setOperatorConfig' }>) => {
    const cache = getOperatorConfigPageCache();
    const checkout = await prepareOperatorConfigCheckout();
    const character = resolveOperatorCharacterForWorkbenchCommand(command);
    const weaponName = command.weaponName?.trim() || '';
    const hasEquipment = Boolean(
      command.equipments?.length
      || command.equipmentId
      || command.equipmentName
      || command.gearSetId
      || command.gearSetName,
    );
    const selections = hasEquipment
      ? (command.equipments?.length
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
          }])
      : [];

    try {
      await refreshOperatorConfigSnapshotsForCharacters([character]);
      const snapshot = getOperatorConfigPageCache()[character.id];
      if (!snapshot) {
        throw makeOperatorConfigCommandError('operator-config-snapshot-unavailable', `未找到干员配置快照: ${character.name}`);
      }

      let nextSnapshot = snapshot;
      if (weaponName) {
        nextSnapshot = {
          ...nextSnapshot,
          weapon: {
            ...nextSnapshot.weapon,
            id: weaponName,
            name: weaponName,
            config: {
              ...nextSnapshot.weapon.config,
              level: command.level ?? nextSnapshot.weapon.config.level,
              potential: normalizeWorkbenchWeaponPotential(command.potential, nextSnapshot.weapon.config.potential),
              skillLevels: {
                ...nextSnapshot.weapon.config.skillLevels,
                ...(command.skillLevels ?? {}),
              },
            },
          },
        };
      }
      const equipmentPatch = hasEquipment
        ? applyOperatorEquipmentSelectionsToSnapshot(nextSnapshot, selections)
        : null;
      if (equipmentPatch) nextSnapshot = equipmentPatch.snapshot;

      // This is deliberately one cache update followed by one Work Node write.
      // A combined weapon/loadout request can never persist a half-applied pair.
      setOperatorConfigPageCache({
        ...getOperatorConfigPageCache(),
        [character.id]: nextSnapshot,
      });
      const refreshResult = await refreshOperatorConfigSnapshotsForCharacters([character]);
      await refreshCandidateBuffsForCharacters([character]);
      const persistence = await persistOperatorConfigCheckout(checkout.id);
      setResistanceRevision((value) => value + 1);
      const refreshedSnapshot = getOperatorConfigPageCache()[character.id] ?? nextSnapshot;

      return {
        characterId: character.id,
        characterName: character.name,
        ...(weaponName ? {
          weapon: {
            id: refreshedSnapshot.weapon.id,
            name: refreshedSnapshot.weapon.name,
            level: refreshedSnapshot.weapon.config.level,
            potential: refreshedSnapshot.weapon.config.potential,
            attack: refreshedSnapshot.weapon.attack,
          },
        } : {}),
        ...(equipmentPatch ? {
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
          applied: equipmentPatch.applied,
          setBuffs: refreshedSnapshot.equipment.setBuffs.map((buff) => ({
            gearSetId: buff.gearSetId,
            gearSetName: buff.gearSetName,
            effectId: buff.effectId,
            label: buff.label,
            typeKey: buff.typeKey,
            value: buff.value,
          })),
        } : {}),
        refreshedCharacterIds: refreshResult.refreshedCharacterIds,
        skippedCharacterIds: refreshResult.skippedCharacterIds,
        persistence,
      };
    } catch (error) {
      setOperatorConfigPageCache(cache);
      await refreshCandidateBuffsForCharacters([character]);
      throw error;
    }
  };

  // These legacy command implementations remain only as private migration
  // references for old in-page state; they are intentionally not registered
  // in the Agent command queue. All Agent loadout writes use the proposal
  // Work Node path above, so no direct setOperatorConfig route is reachable.
  void restoreAtomicTeamParentFromWorkbenchCommand;
  void setOperatorWeaponFromWorkbenchCommand;
  void setOperatorEquipmentFromWorkbenchCommand;
  void setOperatorConfigFromWorkbenchCommand;

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
      timelineId: command.timelineId?.trim() || activeTimelineId,
      branchId: command.branchId?.trim() || `main-workbench-${now}`,
      ...(hasParentNodeInput ? {
        parentNodeId: command.parentNodeId === null ? null : (command.parentNodeId?.trim() || null),
      } : {}),
      label: command.label?.trim() || `Main Workbench ${new Date(now).toLocaleString()}`,
      description: command.description?.trim() || '',
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
    const hasReviewReceipt = command.expectedNodeRevision !== undefined
      || command.expectedWorkingPayloadDigest !== undefined
      || command.expectedDiffDigest !== undefined
      || command.expectedSemanticScope !== undefined;
    const nodeRevision = hasReviewReceipt
      ? authoritativePreparedNodeRevision(node)
      : operatorConfigNodeRevision(node);
    if (hasReviewReceipt) {
      if (command.expectedNodeRevision === undefined
        || !command.expectedWorkingPayloadDigest
        || !command.expectedDiffDigest
        || command.expectedSemanticScope?.length !== 2
        || command.expectedSemanticScope[0] !== 'buff.attachments'
        || command.expectedSemanticScope[1] !== 'buff.resistance') {
        throw new Error('AI_WORKNODE_REVIEW_RECEIPT_INCOMPLETE: Work Node 审阅凭据不完整。');
      }
      const observedIdentity = await buildReviewedWorkNodeIdentity({
        nodeId: node.id,
        timelineId: node.timelineId,
        nodeRevision,
        workingPayload: node.workingPayload,
        diffChanges: nodeDiff,
      });
      const reviewVerification = verifyReviewedWorkNodeIdentity({
        expected: {
          nodeId,
          nodeRevision: command.expectedNodeRevision,
          workingPayloadDigest: command.expectedWorkingPayloadDigest,
          diffDigest: command.expectedDiffDigest,
        },
        observed: observedIdentity,
      });
      if (!reviewVerification.pass) {
        throw new Error(`AI_WORKNODE_REVIEW_STALE: ${reviewVerification.reason || 'Work Node 已变化。'}`);
      }
      const semanticDiff = diffPreparedPayloads(node.basePayload, node.workingPayload);
      const semanticScopeGate = checkPreparedScope(semanticDiff, command.expectedSemanticScope);
      if (!semanticScopeGate.pass) {
        throw new Error(
          `AI_WORKNODE_SCOPE_OVERREACH: Buff Work Node 包含未批准范围：${semanticScopeGate.violations.map((violation) => violation.path).join('、')}`,
        );
      }
    }
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
    if (!currentPayload) {
      throw new Error('当前 Canvas runtime payload 不可用，checkout 未应用');
    }
    const currentDiff = currentPayload ? diffTimelinePayloads(currentPayload, node.workingPayload).summary : null;
    const commits = (await client.list()).commits
      .filter((commit) => commit.nodeId === node.id)
      .sort((left, right) => right.createdAt - left.createdAt);
    const lifecyclePlan = planTimelineWorkNodeCheckoutLifecycle({
      nodeStatus: node.status,
      commits,
      requestedCommitId: command.commitId,
    });
    let commit = lifecyclePlan.commit;
    if (lifecyclePlan.createCommit) {
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

    if (!commit) {
      throw new Error(`AI work node checkout commit missing: ${node.id}`);
    }

    if (document.visibilityState !== 'visible') {
      throw new Error('workbench-renderer-not-visible: 前台 Canvas 不可见，checkout 未应用');
    }
    const repository = createTimelineRepositoryClient();
    const previousCheckoutRef = activeCheckoutRef ? { ...activeCheckoutRef } : null;
    const previousDocument = { id: activeTimelineId, label: activeTimelineLabel };
    const expectedVisibleIds = Object.keys(node.workingPayload.skillButtonTable || {}).sort();
    let checkoutRefUpdated = false;
    let applied: Awaited<ReturnType<ReturnType<typeof createAiTimelineWorkNodeClient>['markCheckoutApplied']>> | null = null;
    let checkoutMarkError: string | undefined;
    let visiblePostcondition: Awaited<ReturnType<typeof buildWorkNodePayloadPostcondition>> | {
      pass: boolean;
      expected: string[];
      actual: string[];
    } = { pass: false, expected: expectedVisibleIds, actual: [] as string[] };
    let checkoutApplied = false;
    isCheckoutMutationPendingRef.current = true;
    try {
      // First prove that the foreground Canvas can hydrate and render the exact
      // reviewed ids. SQLite checkout/applied state is written only after this
      // visible postcondition succeeds.
      hydrateCheckoutRuntime(node.workingPayload, { flushRender: true });
      refreshWorkbenchAfterCheckout();
      visiblePostcondition = await waitForVisibleCanvasButtons(expectedVisibleIds);
      if (!visiblePostcondition.pass || document.visibilityState !== 'visible') {
        throw new Error(`checkout-visible-postcondition-failed: expected=${JSON.stringify(visiblePostcondition.expected)} actual=${JSON.stringify(visiblePostcondition.actual)}`);
      }
      const checkoutRef = {
        timelineId: node.timelineId || activeTimelineId,
        targetType: 'work-node',
        targetId: node.id,
        updatedAt: Date.now(),
      } as const;
      await repository.setCheckoutRef(checkoutRef);
      checkoutRefUpdated = true;
      const documentEntry = node.timelineId === activeTimelineId
        ? previousDocument
        : (await repository.listDocuments()).find((entry) => entry.id === node.timelineId)
          || { id: node.timelineId, label: node.label };
      activateTimeline({ document: documentEntry, checkoutRef, workingPayload: node.workingPayload });
      if (lifecyclePlan.markCheckoutApplied) {
        applied = await client.markCheckoutApplied(node.id, {
          commitId: commit.id,
          // Checkout identity includes updatedAt.  Reusing the exact value
          // already persisted above keeps the renderer projection and SQLite
          // checkout on one immutable identity.
          appliedAt: checkoutRef.updatedAt,
          appliedBy: command.approval?.approvedBy || (isManualApproval ? 'user' : 'ai'),
          rationale: command.approval?.rationale || 'Foreground renderer hydrated and displayed the exact reviewed timeline.',
        });
        if (Number(applied?.commit.checkout?.appliedAt) !== checkoutRef.updatedAt) {
          throw new Error('checkout-identity-drift: SQLite checkout did not retain the renderer checkout revision');
        }
      }
      checkoutApplied = lifecyclePlan.reuseAppliedCommit || Boolean(applied?.commit.checkoutApplied);
      if (!checkoutApplied) throw new Error('checkout-applied-record-missing: visible Canvas was restored but SQLite apply record did not commit');
      const persistedCheckout = await repository.getCheckoutRef(node.timelineId || activeTimelineId);
      if (!persistedCheckout
        || persistedCheckout.targetType !== 'work-node'
        || persistedCheckout.targetId !== node.id
        || persistedCheckout.updatedAt !== checkoutRef.updatedAt) {
        throw new Error('checkout-postcondition-failed: SQLite checkout ref 不再精确指向本次应用的 Work Node。');
      }
      const payloadPostcondition = await buildWorkNodePayloadPostcondition({
        expectedPayload: node.workingPayload,
        actualPayload: getCurrentTimelineSnapshotPayload(),
        expectedVisibleButtonIds: expectedVisibleIds,
        actualVisibleButtonIds: visiblePostcondition.actual,
        expectedCheckout: { targetType: 'work-node', targetId: node.id },
        observedCheckout: persistedCheckout,
        expectedNodeRevision: nodeRevision,
        observedNodeRevision: nodeRevision,
      });
      if (!payloadPostcondition.pass) {
        throw new Error(`checkout-exact-postcondition-failed: ${payloadPostcondition.failures.join('；')}`);
      }
      visiblePostcondition = {
        ...visiblePostcondition,
        ...payloadPostcondition,
      };
    } catch (error) {
      checkoutMarkError = error instanceof Error ? error.message : String(error);
      if (checkoutRefUpdated && previousCheckoutRef) {
        await repository.setCheckoutRef(previousCheckoutRef).catch(() => undefined);
      }
      activateTimeline({ document: previousDocument, checkoutRef: previousCheckoutRef, workingPayload: currentPayload });
      hydrateCheckoutRuntime(currentPayload, { flushRender: true });
      refreshWorkbenchAfterCheckout();
      await waitForVisibleCanvasButtons(Object.keys(currentPayload.skillButtonTable || {}));
      throw error;
    } finally {
      isCheckoutMutationPendingRef.current = false;
      setProjectionVisibilityRevision((revision) => revision + 1);
    }

    if (command.reload === true) {
      window.setTimeout(() => window.location.reload(), 80);
    }

    return {
      ok: true,
      done: true,
      nodeId: applied?.node.id || node.id,
      nodeRevision,
      commitId: applied?.commit.id || commit.id,
      status: applied?.node.status || node.status,
      checkoutApplied,
      checkout: await repository.getCheckoutRef(node.timelineId || activeTimelineId),
      checkoutTargetRevision: nodeRevision,
      checkoutMarkError,
      visiblePostcondition,
      reloaded: command.reload === true,
      riskFlags: riskFlags.map((risk) => ({ severity: risk.severity, code: risk.code, message: risk.message })),
      checkoutDecision,
      currentDiff,
    };
  };

  const ensureTimelineDocumentBaselineWorkNode = async (
    timelineId: string,
    payload: TimelineSnapshotPayload,
    documentLabel: string,
  ) => {
    const repository = createTimelineRepositoryClient();
    const existingNodes = await repository.listWorkNodes(timelineId);
    if (existingNodes.length > 0) {
      return existingNodes.find((node) => !node.parentNodeId) || existingNodes[0];
    }

    const createdAt = Date.now();
    const created = await createAiTimelineWorkNodeClient().create({
      timelineId,
      parentNodeId: null,
      branchId: `baseline-${createdAt}`,
      label: `[baseline] ${documentLabel}`,
      basePayload: payload,
      workingPayload: payload,
      approvalPolicy: 'auto-low-risk',
      riskFlags: [],
    });
    const checkout = await checkoutAiTimelineWorkNodeFromCommand({
      op: 'checkoutAiTimelineWorkNode',
      nodeId: created.node.id,
      reload: false,
      approval: {
        mode: 'manual',
        approvedBy: 'user',
        rationale: 'Created the baseline Work Node for a restored timeline document.',
      },
    });
    if (!checkout.checkoutApplied) {
      throw new Error(checkout.checkoutMarkError || '基线工作节点创建后未能完成 checkout');
    }
    return created.node;
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
      expectedContentRevision: authoritativePreparedNodeRevision(node),
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
        timelineId: command.timelineId,
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

  const assertPreparedCurrentBinding = (expectedTargetId?: string): ProductBinding => {
    const binding = browserAgentRuntime.getBinding();
    if (!binding) {
      throw new Error('prepared-binding-unavailable: 当前浏览器没有可验证的 Product binding。');
    }
    if (!activeCheckoutRef || activeCheckoutRef.timelineId !== activeTimelineId) {
      throw new Error('prepared-checkout-unavailable: 当前正式 SQLite 没有可验证的 checkout。');
    }
    if (binding.timelineId !== activeTimelineId
      || binding.checkoutTargetId !== activeCheckoutRef.targetId
      || binding.checkoutUpdatedAt !== activeCheckoutRef.updatedAt) {
      throw new Error('prepared-binding-stale: Product binding 与正式 checkout 不一致。');
    }
    if (expectedTargetId !== undefined && binding.checkoutTargetId !== expectedTargetId) {
      throw new Error('prepared-source-target-mismatch: 当前 binding 不再指向 candidate 的 source target。');
    }
    return binding;
  };

  const readPreparedFormalCheckout = async (expectedTargetId?: string) => {
    const checkoutRef = activeCheckoutRef;
    if (!checkoutRef || checkoutRef.timelineId !== activeTimelineId) {
      throw new Error('prepared-checkout-unavailable: 当前正式 SQLite 没有可验证的 checkout。');
    }
    const binding = assertPreparedCurrentBinding(expectedTargetId);
    const formal = await readFormalCheckoutPayload(activeTimelineId, checkoutRef);
    if (formal.checkoutRef.timelineId !== activeTimelineId
      || formal.checkoutRef.targetType !== checkoutRef.targetType
      || formal.checkoutRef.targetId !== checkoutRef.targetId
      || formal.checkoutRef.updatedAt !== checkoutRef.updatedAt) {
      throw new Error('prepared-checkout-drift: 读取正式 checkout 期间 target 或 revision 发生变化。');
    }
    const repository = createTimelineRepositoryClient();
    const bundle = await repository.exportDocumentBundle(activeTimelineId);
    const persistedCheckout = bundle.checkoutRef;
    if (!persistedCheckout
      || persistedCheckout.timelineId !== activeTimelineId
      || persistedCheckout.targetType !== checkoutRef.targetType
      || persistedCheckout.targetId !== checkoutRef.targetId
      || persistedCheckout.updatedAt !== checkoutRef.updatedAt) {
      throw new Error('prepared-checkout-drift: 正式 SQLite checkout 在校验期间发生变化。');
    }
    const sourceNode = checkoutRef.targetType === 'work-node'
      ? bundle.workNodes.find((node) => node.id === checkoutRef.targetId)
      : null;
    const sourceSnapshot = checkoutRef.targetType === 'snapshot'
      ? bundle.snapshots.find((snapshot) => snapshot.id === checkoutRef.targetId)
      : null;
    const bundlePayload = sourceNode?.workingPayload || sourceSnapshot?.payload;
    if (!bundlePayload) {
      throw new Error('prepared-source-payload-missing: 当前正式 checkout payload 不存在。');
    }
    const [formalDigest, bundleDigest] = await Promise.all([
      sha256Json(formal.payload),
      sha256Json(bundlePayload),
    ]);
    if (formalDigest !== bundleDigest) {
      throw new Error('prepared-source-payload-drift: 正式 checkout payload 在读取期间发生变化。');
    }
    const sourceRevision = sourceNode
      ? sourceNode.contentRevision
      : sourceSnapshot?.createdAt;
    if (typeof sourceRevision !== 'number' || !Number.isSafeInteger(sourceRevision) || sourceRevision < 0) {
      throw new Error('prepared-source-revision-invalid: 正式 checkout revision 无效。');
    }
    const resolvedSourceRevision = sourceRevision;
    if (binding.contentRevision !== resolvedSourceRevision) {
      throw new Error('prepared-binding-revision-mismatch: Product binding 没有绑定正式 target 的权威 contentRevision。');
    }
    return {
      binding,
      checkoutRef: persistedCheckout,
      payload: formal.payload,
      payloadDigest: formalDigest,
      sourceRevision: resolvedSourceRevision,
      structuralParentNodeId: sourceNode?.id || null,
      sourceNode,
      sourceSnapshot,
    };
  };

  const validatePreparedIntentAndScope = (
    intent: 'timeline' | 'buff' | 'selection',
    scope: readonly PreparedWorkNodeScope[],
    diff: ReturnType<typeof diffPreparedPayloads>,
  ) => {
    const scopeGate = checkPreparedScope(diff, scope);
    if (!scopeGate.pass) return { scopeGate, pass: false, reason: 'prepared-scope-overreach' } as const;
    const allowed = intent === 'timeline'
      ? new Set<PreparedWorkNodeScope>(['timeline.structure', 'buff.attachments', 'buff.resistance'])
      : intent === 'buff'
        ? new Set<PreparedWorkNodeScope>(['buff.attachments', 'buff.resistance'])
        : new Set<PreparedWorkNodeScope>();
    const intentViolations = diff.changes.filter((change) => {
      const required = scopeForPreparedPath(change.path);
      return required !== null && !allowed.has(required);
    });
    if (intentViolations.length > 0) {
      return {
        scopeGate,
        pass: false,
        reason: `prepared-intent-overreach: ${intent} 不能修改 ${intentViolations.map((change) => change.path).join(', ')}`,
      } as const;
    }
    return { scopeGate, pass: true } as const;
  };

  const preparedFailure = (
    operation: string,
    code: string,
    message: string,
    extra: Record<string, unknown> = {},
  ) => ({
    ok: false as const,
    applied: false,
    operation,
    code,
    message,
    liveCheckoutTouched: false as const,
    rollbackApplied: false,
    candidatePreserved: false,
    postcondition: {
      pass: true,
      checkoutUnchanged: true,
      liveCheckoutTouched: false,
      reason: message,
    },
    ...extra,
  });

  const prepareReviewedWorkNodeProposalFromCommand = async (
    command: Extract<MainWorkbenchCommand, { op: 'prepareReviewedWorkNodeProposal' }>,
  ) => {
    let createdCandidateId: string | null = null;
    const client = createAiTimelineWorkNodeClient();
    try {
      const formal = await readPreparedFormalCheckout();
      if (!samePreparedProductBinding(formal.binding, command.sourceBinding)) {
        return preparedFailure(
          command.operation,
          'prepared-source-binding-mismatch',
          'Host sourceBinding 与当前正式 Product binding 不完全一致；未创建 candidate。',
        );
      }
      if (command.sourceBinding.timelineId !== activeTimelineId
        || command.sourceBinding.checkoutTargetId !== formal.checkoutRef.targetId
        || command.sourceBinding.checkoutUpdatedAt !== formal.checkoutRef.updatedAt) {
        return preparedFailure(
          command.operation,
          'prepared-source-binding-mismatch',
          'sourceBinding 没有精确绑定当前正式 checkout；未创建 candidate。',
        );
      }
      if (command.intent === 'selection') {
        return preparedFailure(
          command.operation,
          'prepared-selection-owner-mismatch',
          'selection prepared command 由 AppContext 独立 owner 消费，Canvas 不执行该候选。',
        );
      }
      let workingPayload: TimelineSnapshotPayload;
      let riskFlags: AiTimelineRiskFlag[] = [];
      let restoreMetadata: {
        nodeId: string;
        nodeRevision: number;
        scope: PreparedRestoreSemanticScope;
      } | null = null;
      if (command.restore) {
        const expectedScope = PREPARED_RESTORE_PROPOSAL_SCOPES[command.restore.scope];
        if (!samePreparedScope(command.scope, expectedScope)
          || command.intent !== (command.restore.scope === 'timeline.structure' ? 'timeline' : 'buff')) {
          return preparedFailure(
            command.operation,
            'prepared-restore-scope-mismatch',
            'restore semantic scope、intent 与 proposal scope 的真实影响不一致。',
          );
        }
        const target = (await client.get(command.restore.nodeId)).node;
        const targetRevision = target.contentRevision;
        if (target.timelineId !== activeTimelineId
          || !Number.isSafeInteger(targetRevision)
          || Number(targetRevision) < 0) {
          return preparedFailure(
            command.operation,
            'prepared-restore-target-invalid',
            'restore target 不属于当前 timeline 或缺少权威 contentRevision。',
          );
        }
        const restored = applyPreparedRestoreScope(command.restore.scope, formal.payload, target.basePayload);
        if (!restored.ok) {
          return preparedFailure(
            command.operation,
            'prepared-restore-invalid',
            restored.message,
            { issues: restored.issues },
          );
        }
        workingPayload = restored.payload;
        restoreMetadata = {
          nodeId: target.id,
          nodeRevision: Number(targetRevision),
          scope: command.restore.scope,
        };
      } else {
        const trustedSkillCatalog = selectedCharacters.flatMap((character) => (
          buildSandboxSkillsFromRuntimeTemplate(character.id).map((skill) => ({
            characterId: character.id,
            characterName: character.name,
            skillId: skill.id,
            skillType: skill.buttonType,
            skillDisplayName: skill.displayName,
          }))
        ));
        const trustedPatch = bindTrustedTimelineMutation({
          payload: formal.payload,
          patch: command.patch,
          skillCatalog: trustedSkillCatalog,
          candidateBuffs: getCandidateBuffList(),
        });
        const patchResult = applyTimelineWorkNodePatch(formal.payload, trustedPatch, { dryRun: false });
        if (!patchResult.ok) {
          return preparedFailure(
            command.operation,
            'prepared-patch-invalid',
            patchResult.issues.map((issue) => issue.message).join('；'),
            { issues: patchResult.issues, riskFlags: patchResult.riskFlags },
          );
        }
        workingPayload = patchResult.workingPayload;
        riskFlags = patchResult.riskFlags;
      }
      const diff = diffPreparedPayloads(formal.payload, workingPayload);
      if (diff.changes.length === 0) {
        return preparedFailure(
          command.operation,
          'prepared-empty-diff',
          'prepare request 没有产生可审阅的 payload 变化；未创建空 candidate。',
        );
      }
      const intentScope = validatePreparedIntentAndScope(command.intent, command.scope, diff);
      if (!intentScope.pass) {
        return preparedFailure(
          command.operation,
          intentScope.reason.startsWith('prepared-scope') ? 'prepared-scope-overreach' : 'prepared-intent-overreach',
          intentScope.reason,
          { scopeGate: intentScope.scopeGate },
        );
      }
      const preparedValidation = validateTimelinePayload(workingPayload);
      if (!preparedValidation.ok) {
        return preparedFailure(
          command.operation,
          'prepared-working-payload-invalid',
          preparedValidation.issues.map((issue) => issue.message).join('；'),
          { validation: preparedValidation },
        );
      }

      const proposalId = `prepared-${generateId()}`;
      const candidateBranchId = restoreMetadata
        ? preparedRestoreBranchId({ proposalId, ...restoreMetadata })
        : `prepared-${proposalId}`;
      const candidateResponse = await client.create({
        timelineId: activeTimelineId,
        parentNodeId: formal.structuralParentNodeId,
        branchId: candidateBranchId,
        label: command.label,
        description: command.description,
        basePayload: formal.payload,
        workingPayload,
        approvalPolicy: 'manual',
        riskFlags,
      });
      createdCandidateId = candidateResponse.node.id;
      const readyResponse = await client.update(createdCandidateId, {
        status: 'ready',
        expectedContentRevision: authoritativePreparedNodeRevision(candidateResponse.node),
      });
      let candidateNode = readyResponse.node;
      const candidateRevision = authoritativePreparedNodeRevision(candidateNode);
      if (candidateNode.timelineId !== activeTimelineId
        || candidateNode.id !== createdCandidateId
        || candidateNode.branchId !== candidateBranchId
        || candidateRevision < 0
        || candidateNode.status !== 'ready') {
        throw new Error('prepared-candidate-proof-failed: 新 candidate 的身份或 revision 无法证明。');
      }
      const proposal = await buildPreparedWorkNodeProposal({
        operation: command.operation,
        proposalId,
        intent: command.intent,
        destination: 'current-timeline',
        sourceTargetId: formal.checkoutRef.targetId,
        sourceRevision: formal.sourceRevision,
        candidateTimelineId: activeTimelineId,
        nodeId: candidateNode.id,
        nodeRevision: candidateRevision,
        scope: [...command.scope],
        sourceBinding: command.sourceBinding,
        sourceCheckout: {
          timelineId: activeTimelineId,
          targetType: formal.checkoutRef.targetType,
          targetId: formal.checkoutRef.targetId,
          revision: formal.sourceRevision,
          payloadDigest: formal.payloadDigest,
        },
        structuralParentNodeId: formal.structuralParentNodeId,
        basePayload: candidateNode.basePayload,
        workingPayload: candidateNode.workingPayload,
      });
      const finalValidation = await validatePreparedWorkNodeProposal(proposal, {
        operation: command.operation,
        basePayload: candidateNode.basePayload,
        workingPayload: candidateNode.workingPayload,
      });
      if (!finalValidation.ok) {
        throw new Error(`prepared-proposal-proof-failed: ${finalValidation.issues.join('；')}`);
      }
      const candidate = preparedWorkNodeCandidateRefFromProposal(proposal);
      const candidateAuditMarker = `[prepared-candidate:v1:${proposalId}:${proposal.proposalDigest}]`;
      const markedResponse = await client.update(candidateNode.id, {
        status: 'ready',
        description: `${candidateAuditMarker} ${command.description}`,
      });
      candidateNode = markedResponse.node;
      if (candidateNode.id !== candidate.nodeId
        || candidateNode.timelineId !== activeTimelineId
        || candidateNode.branchId !== candidateBranchId
        || authoritativePreparedNodeRevision(candidateNode) !== candidate.nodeRevision
        || !candidateNode.description.startsWith(candidateAuditMarker)) {
        throw new Error('prepared-candidate-audit-marker-failed: candidate 的产品侧 provenance marker 无法证明。');
      }
      return {
        ok: true as const,
        kind: 'prepared-work-node-proposal' as const,
        operation: command.operation,
        liveCheckoutTouched: false as const,
        candidate,
        proposal,
        candidateNode: {
          nodeId: candidateNode.id,
          nodeRevision: candidateRevision,
          status: candidateNode.status,
          branchId: candidateNode.branchId,
        },
        postcondition: {
          pass: true,
          liveCheckoutTouched: false,
          checkoutUnchanged: true,
          candidateStored: true,
          reviewComplete: true,
          diffEntries: proposal.review.changes.length,
        },
        riskFlags,
      };
    } catch (error) {
      let cleanup: Record<string, unknown> = {
        status: 'failed',
        reason: 'candidate 未创建或无法证明可安全清理。',
      };
      if (createdCandidateId) {
        try {
          const current = await client.list();
          const node = current.nodes.find((entry) => entry.id === createdCandidateId);
          const descendants = current.nodes.filter((entry) => entry.parentNodeId === createdCandidateId);
          const checkout = await createTimelineRepositoryClient().getCheckoutRef(activeTimelineId);
          const commits = current.commits.filter((entry) => entry.nodeId === createdCandidateId);
          if (node && node.branchId.startsWith('prepared-') && descendants.length === 0
            && (!checkout || checkout.targetId !== createdCandidateId)
            && commits.length === 0) {
            const deleted = await client.delete(createdCandidateId);
            const preserved = deleted.nodes.some((entry) => entry.id === createdCandidateId);
            cleanup = preserved
              ? { status: 'failed', reason: 'candidate 删除后的 ledger 仍保留该节点。' }
              : { status: 'deleted', reason: 'prepare 失败后删除未 checkout 的空 candidate。' };
          } else {
            cleanup = {
              status: 'preserved',
              reason: 'candidate 存在 lineage、checkout 或 commit 证据，按 fail-closed 保留。',
            };
          }
        } catch (cleanupError) {
          cleanup = {
            status: 'failed',
            reason: `prepare 失败后的 candidate cleanup 失败：${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`,
          };
        }
      }
      const message = error instanceof Error ? error.message : String(error);
      return preparedFailure(command.operation, 'prepared-proposal-failed', message, { cleanup });
    }
  };

  const applyReviewedWorkNodeProposalFromCommand = async (
    command: Extract<MainWorkbenchCommand, { op: 'applyReviewedWorkNodeProposal' }>,
  ) => {
    const candidate = command.candidate;
    let liveCheckoutTouched = false;
    let commitId: string | null = null;
    let finalPostcondition: Awaited<ReturnType<typeof buildWorkNodePayloadPostcondition>> | null = null;
    let rollbackPostcondition: Awaited<ReturnType<typeof buildWorkNodePayloadPostcondition>> | null = null;
    let targetCheckoutRef: TimelineCheckoutRef | null = null;
    const client = createAiTimelineWorkNodeClient();
    try {
      if (candidate.destination !== 'current-timeline') {
        return preparedFailure(
          command.operation,
          'prepared-destination-unsupported',
          'prepared candidate destination 不是 current-timeline；拒绝 apply。',
          { candidate, candidatePreserved: true },
        );
      }
      if (candidate.intent !== 'timeline' && candidate.intent !== 'buff') {
        return preparedFailure(
          command.operation,
          'prepared-intent-unsupported',
          '当前产品侧 prepared apply 只接受 timeline 或 buff candidate。',
          { candidate, candidatePreserved: true },
        );
      }
      const formal = await readPreparedFormalCheckout(candidate.sourceTargetId);
      if (candidate.candidateTimelineId !== activeTimelineId
        || candidate.sourceTargetId !== formal.checkoutRef.targetId
        || candidate.sourceRevision !== formal.sourceRevision) {
        return preparedFailure(
          command.operation,
          'prepared-source-revision-mismatch',
          '当前 formal checkout 的 target/revision 与 candidate 不一致；live checkout 未触碰。',
          { candidate, candidatePreserved: true },
        );
      }
      const currentPayload = getCurrentTimelineSnapshotPayload();
      if (!currentPayload || !sameOperatorConfigPayload(currentPayload, formal.payload)) {
        return preparedFailure(
          command.operation,
          'prepared-live-source-mismatch',
          '当前 Canvas payload 与正式 source checkout 不一致；拒绝 apply。',
          { candidate, candidatePreserved: true },
        );
      }
      const candidateResponse = await client.get(candidate.nodeId);
      const candidateNode = candidateResponse.node;
      const candidateRevision = authoritativePreparedNodeRevision(candidateNode);
      const candidateAuditMarker = `[prepared-candidate:v1:${candidate.proposalId}:${candidate.proposalDigest}]`;
      const restoreMetadata = parsePreparedRestoreBranchId(candidate.proposalId, candidateNode.branchId);
      const branchIsProven = candidateNode.branchId === `prepared-${candidate.proposalId}`
        || restoreMetadata !== null;
      if (candidateNode.timelineId !== activeTimelineId
        || candidateNode.id !== candidate.nodeId
        || !branchIsProven
        || (candidateNode.parentNodeId || null) !== formal.structuralParentNodeId
        || candidateRevision !== candidate.nodeRevision
        || !candidateNode.description.startsWith(candidateAuditMarker)) {
        return preparedFailure(
          command.operation,
          'prepared-candidate-identity-mismatch',
          'candidate node 的 timeline、branch、parent、revision 或 provenance marker 已漂移；拒绝 apply。',
          { candidate, candidatePreserved: true, observedNodeRevision: candidateRevision },
        );
      }
      if (restoreMetadata) {
        const expectedScope = PREPARED_RESTORE_PROPOSAL_SCOPES[restoreMetadata.scope];
        const expectedIntent = restoreMetadata.scope === 'timeline.structure' ? 'timeline' : 'buff';
        if (candidate.intent !== expectedIntent || !samePreparedScope(candidate.scope, expectedScope)) {
          return preparedFailure(
            command.operation,
            'prepared-restore-scope-mismatch',
            'restore candidate 的 semantic scope、intent 与 proposal scope 不再一致。',
            { candidate, candidatePreserved: true },
          );
        }
        const restoreTarget = (await client.get(restoreMetadata.nodeId)).node;
        const restoreTargetRevision = authoritativePreparedNodeRevision(restoreTarget);
        if (restoreTarget.timelineId !== activeTimelineId
          || restoreTargetRevision !== restoreMetadata.nodeRevision) {
          return preparedFailure(
            command.operation,
            'prepared-restore-target-revision-mismatch',
            'restore baseline target 的 timeline/contentRevision 已漂移；拒绝 apply。',
            {
              candidate,
              candidatePreserved: true,
              expectedTargetRevision: restoreMetadata.nodeRevision,
              observedTargetRevision: restoreTargetRevision,
            },
          );
        }
        const rebuilt = applyPreparedRestoreScope(
          restoreMetadata.scope,
          formal.payload,
          restoreTarget.basePayload,
        );
        if (!rebuilt.ok || !sameOperatorConfigPayload(rebuilt.payload, candidateNode.workingPayload)) {
          return preparedFailure(
            command.operation,
            'prepared-restore-rebuild-mismatch',
            rebuilt.ok
              ? 'restore candidate 重新计算后不再等于已批准 working payload。'
              : rebuilt.message,
            { candidate, candidatePreserved: true, ...(!rebuilt.ok ? { issues: rebuilt.issues } : {}) },
          );
        }
      }
      if (candidateNode.status !== 'ready') {
        return preparedFailure(
          command.operation,
          'prepared-candidate-not-available',
          `candidate 当前状态为 ${candidateNode.status}，不能再次 apply。`,
          { candidate, candidatePreserved: true },
        );
      }
      const candidateValidation = validateTimelinePayload(candidateNode.workingPayload);
      if (!candidateValidation.ok) {
        return preparedFailure(
          command.operation,
          'prepared-candidate-payload-invalid',
          candidateValidation.issues.map((issue) => issue.message).join('；'),
          { candidate, candidatePreserved: true, validation: candidateValidation },
        );
      }
      const candidateDiff = diffPreparedPayloads(candidateNode.basePayload, candidateNode.workingPayload);
      if (candidateDiff.changes.length === 0) {
        return preparedFailure(
          command.operation,
          'prepared-empty-candidate',
          'candidate 没有可应用的 diff；拒绝 apply。',
          { candidate, candidatePreserved: true },
        );
      }
      const intentScope = validatePreparedIntentAndScope(candidate.intent, candidate.scope, candidateDiff);
      if (!intentScope.pass) {
        return preparedFailure(
          command.operation,
          intentScope.reason.startsWith('prepared-scope') ? 'prepared-scope-overreach' : 'prepared-intent-overreach',
          intentScope.reason,
          { candidate, candidatePreserved: true, scopeGate: intentScope.scopeGate },
        );
      }
      const candidateProof = await validatePreparedWorkNodeCandidate(candidate, {
        operation: command.operation,
        basePayload: candidateNode.basePayload,
        workingPayload: candidateNode.workingPayload,
        sourceTargetId: formal.checkoutRef.targetId,
        sourceRevision: formal.sourceRevision,
        candidateTimelineId: activeTimelineId,
        nodeId: candidateNode.id,
        nodeRevision: candidateRevision,
      });
      if (!candidateProof.ok) {
        return preparedFailure(
          command.operation,
          'prepared-candidate-digest-mismatch',
          candidateProof.issues.join('；'),
          { candidate, candidatePreserved: true, issues: candidateProof.issues },
        );
      }
      const sourceDigest = await sha256Json(formal.payload);
      const storedBaseDigest = await sha256Json(candidateNode.basePayload);
      if (sourceDigest !== storedBaseDigest) {
        return preparedFailure(
          command.operation,
          'prepared-base-payload-mismatch',
          'candidate base payload 不再等于当前 formal source payload；拒绝 apply。',
          { candidate, candidatePreserved: true },
        );
      }

      const committed = await client.commit(candidateNode.id, {
        label: `Apply ${candidateNode.label}`,
        riskFlags: candidateNode.riskFlags,
        approval: {
          mode: 'manual',
          approvedAt: Date.now(),
          approvedBy: 'user',
          rationale: 'V2 prepared candidate 已通过 Host capability、binding、revision、scope 与 digest 校验。',
        },
      });
      commitId = committed.commit.id;
      if (committed.commit.nodeId !== candidateNode.id
        || !sameOperatorConfigPayload(committed.commit.appliedPayload, candidateNode.workingPayload)
        || !sameOperatorConfigPayload(committed.commit.basePayload, candidateNode.basePayload)) {
        return preparedFailure(
          command.operation,
          'prepared-commit-payload-mismatch',
          'SQLite commit payload 没有精确绑定 candidate；live checkout 未触碰。',
          { candidate, candidatePreserved: true, commitId },
        );
      }

      const previousCheckoutRef = { ...formal.checkoutRef };
      const previousDocument = { id: activeTimelineId, label: activeTimelineLabel };
      const previousVisibleIds = Object.keys(formal.payload.skillButtonTable || {}).sort();
      const candidateVisibleIds = Object.keys(candidateNode.workingPayload.skillButtonTable || {}).sort();
      isCheckoutMutationPendingRef.current = true;
      liveCheckoutTouched = true;
      try {
        await runAtomicPreparedWorkNodeApply({
          applyTarget: async () => {
            hydrateCheckoutRuntime(candidateNode.workingPayload, { flushRender: true });
            refreshWorkbenchAfterCheckout();
          },
          verifyVisibleTarget: async () => {
            if (document.visibilityState !== 'visible') {
              return { pass: false, reason: '前台 Canvas 不可见' };
            }
            const visible = await waitForVisibleCanvasButtons(candidateVisibleIds);
            const postcondition = await buildWorkNodePayloadPostcondition({
              expectedPayload: candidateNode.workingPayload,
              actualPayload: getCurrentTimelineSnapshotPayload(),
              expectedVisibleButtonIds: candidateVisibleIds,
              actualVisibleButtonIds: visible.actual,
            });
            return postcondition.pass
              ? postcondition
              : { pass: false, reason: postcondition.failures.join('；'), observed: postcondition };
          },
          persistCheckout: async () => {
            targetCheckoutRef = {
              timelineId: activeTimelineId,
              targetType: 'work-node',
              targetId: candidateNode.id,
              updatedAt: Date.now(),
            };
            await createTimelineRepositoryClient().setCheckoutRef(targetCheckoutRef);
            activateTimeline({
              document: previousDocument,
              checkoutRef: targetCheckoutRef,
              workingPayload: candidateNode.workingPayload,
            });
          },
          persistAppliedLedger: async () => {
            if (!targetCheckoutRef) throw new Error('prepared checkout ref 未生成。');
            const marked = await client.markCheckoutApplied(candidateNode.id, {
              commitId: commitId!,
              appliedAt: targetCheckoutRef.updatedAt,
              appliedBy: 'user',
              rationale: 'prepared candidate visible postcondition 已通过，已原子应用正式 checkout。',
            });
            const applied = marked.node.id === candidateNode.id
              && marked.commit.id === commitId
              && marked.commit.checkoutApplied
              && Number(marked.commit.checkout?.appliedAt) === targetCheckoutRef.updatedAt
              && sameOperatorConfigPayload(marked.commit.appliedPayload, candidateNode.workingPayload);
            return { applied };
          },
          verifyPersistedTarget: async () => {
            if (!targetCheckoutRef) return { pass: false, reason: 'prepared checkout ref 未生成' };
            const repository = createTimelineRepositoryClient();
            const persistedCheckout = await repository.getCheckoutRef(activeTimelineId);
            const persistedNode = (await client.get(candidateNode.id)).node;
            const visible = await waitForVisibleCanvasButtons(candidateVisibleIds);
            finalPostcondition = await buildWorkNodePayloadPostcondition({
              expectedPayload: candidateNode.workingPayload,
              actualPayload: getCurrentTimelineSnapshotPayload(),
              expectedVisibleButtonIds: candidateVisibleIds,
              actualVisibleButtonIds: visible.actual,
              expectedCheckout: { targetType: 'work-node', targetId: candidateNode.id },
              observedCheckout: persistedCheckout,
              expectedNodeRevision: candidateRevision,
              observedNodeRevision: authoritativePreparedNodeRevision(persistedNode),
            });
            return finalPostcondition.pass
              ? finalPostcondition
              : { pass: false, reason: finalPostcondition.failures.join('；'), observed: finalPostcondition };
          },
          restorePreviousState: async () => {
            const failures: string[] = [];
            const repository = createTimelineRepositoryClient();
            try {
              await repository.setCheckoutRef(previousCheckoutRef);
            } catch (error) {
              failures.push(`恢复原 checkout 失败：${error instanceof Error ? error.message : String(error)}`);
            }
            try {
              activateTimeline({
                document: previousDocument,
                checkoutRef: previousCheckoutRef,
                workingPayload: formal.payload,
              });
              hydrateCheckoutRuntime(formal.payload, { flushRender: true });
              refreshWorkbenchAfterCheckout();
              const visible = await waitForVisibleCanvasButtons(previousVisibleIds);
              if (!visible.pass) failures.push('恢复原 live checkout 后可见按钮集合不一致。');
            } catch (error) {
              failures.push(`恢复原 live checkout 失败：${error instanceof Error ? error.message : String(error)}`);
            }
            try {
              await client.markRollbackApplied(candidateNode.id, {
                appliedAt: Date.now(),
                appliedBy: 'system',
                rationale: 'prepared candidate apply 失败，已恢复原 live checkout；候选保留供审计。',
              });
            } catch (error) {
              failures.push(`candidate rollback audit 失败：${error instanceof Error ? error.message : String(error)}`);
            }
            if (failures.length > 0) throw new Error(failures.join('；'));
          },
          verifyPreviousState: async () => {
            const repository = createTimelineRepositoryClient();
            const persistedCheckout = await repository.getCheckoutRef(activeTimelineId);
            const visible = await waitForVisibleCanvasButtons(previousVisibleIds);
            rollbackPostcondition = await buildWorkNodePayloadPostcondition({
              expectedPayload: formal.payload,
              actualPayload: getCurrentTimelineSnapshotPayload(),
              expectedVisibleButtonIds: previousVisibleIds,
              actualVisibleButtonIds: visible.actual,
              expectedCheckout: {
                targetType: previousCheckoutRef.targetType,
                targetId: previousCheckoutRef.targetId,
              },
              observedCheckout: persistedCheckout,
              expectedNodeRevision: formal.sourceRevision,
              observedNodeRevision: formal.sourceRevision,
            });
            return rollbackPostcondition.pass
              ? rollbackPostcondition
              : { pass: false, reason: rollbackPostcondition.failures.join('；'), observed: rollbackPostcondition };
          },
        });
      } finally {
        isCheckoutMutationPendingRef.current = false;
        setProjectionVisibilityRevision((revision) => revision + 1);
      }

      const receiptPostcondition = finalPostcondition as Awaited<ReturnType<typeof buildWorkNodePayloadPostcondition>> | null;
      if (!targetCheckoutRef || receiptPostcondition?.pass !== true) {
        throw new Error('prepared apply 成功后没有形成可验证的 checkout/postcondition receipt。');
      }
      return {
        ok: true as const,
        applied: true as const,
        operation: command.operation,
        liveCheckoutTouched: true as const,
        rollbackApplied: false as const,
        candidate,
        nodeId: candidateNode.id,
        nodeRevision: candidateRevision,
        commitId,
        basePayloadDigest: candidate.basePayloadDigest,
        workingPayloadDigest: candidate.workingPayloadDigest,
        diffDigest: candidate.diffDigest,
        proposalDigest: candidate.proposalDigest,
        checkout: targetCheckoutRef,
        checkoutApplied: true as const,
        postcondition: receiptPostcondition,
      };
    } catch (error) {
      const atomicError = error instanceof PreparedWorkNodeAtomicApplyError ? error : null;
      const rollbackApplied = Boolean(atomicError && !atomicError.rollbackError);
      const postcondition = atomicError
        ? (rollbackPostcondition || {
            pass: rollbackApplied,
            checkoutRestored: rollbackApplied,
            liveCheckoutTouched: true,
            reason: atomicError.message,
          })
        : {
            pass: true,
            checkoutUnchanged: !liveCheckoutTouched,
            liveCheckoutTouched,
            reason: error instanceof Error ? error.message : String(error),
          };
      return preparedFailure(
        command.operation,
        atomicError?.rollbackError
          ? 'prepared-atomic-rollback-failed'
          : atomicError
            ? 'prepared-atomic-apply-failed'
            : 'prepared-apply-preflight-failed',
        error instanceof Error ? error.message : String(error),
        {
          candidate,
          candidatePreserved: true,
          liveCheckoutTouched,
          rollbackApplied,
          commitId,
          postcondition,
        },
      );
    }
  };

  const abandonPreparedWorkNodeProposalFromCommand = async (
    command: Extract<MainWorkbenchCommand, { op: 'abandonPreparedWorkNodeProposal' }>,
  ) => {
    const candidate = command.candidate;
    const cleanup = (
      status: 'deleted' | 'preserved' | 'failed',
      reason: string,
    ) => ({
      contract: 'DefPreparedWorkNodeCleanupAuditV1' as const,
      schemaVersion: 1 as const,
      proposalId: candidate.proposalId,
      nodeId: candidate.nodeId,
      candidateTimelineId: candidate.candidateTimelineId,
      status,
      reason,
    });
    try {
      const binding = browserAgentRuntime.getBinding();
      if (!binding
        || binding.timelineId !== activeTimelineId
        || candidate.candidateTimelineId !== activeTimelineId
        || candidate.destination !== 'current-timeline'
        || (candidate.intent !== 'timeline' && candidate.intent !== 'buff')) {
        return {
          ok: false as const,
          liveCheckoutTouched: false as const,
          deleted: false as const,
          candidate,
          cleanup: cleanup('preserved', '候选不属于当前已绑定的 current-timeline，无法证明可安全清理。'),
          postcondition: { pass: true, liveCheckoutTouched: false, candidatePreserved: true },
        };
      }
      const client = createAiTimelineWorkNodeClient();
      const before = await client.list();
      const target = before.nodes.find((node) => node.id === candidate.nodeId);
      if (!target) {
        return {
          ok: true as const,
          liveCheckoutTouched: false as const,
          deleted: false as const,
          candidate,
          cleanup: cleanup('deleted', 'candidate 已不存在，无残留节点需要删除。'),
          postcondition: { pass: true, liveCheckoutTouched: false, candidateDeleted: true },
        };
      }
      if (target.timelineId !== candidate.candidateTimelineId || target.timelineId !== activeTimelineId) {
        return {
          ok: false as const,
          liveCheckoutTouched: false as const,
          deleted: false as const,
          candidate,
          cleanup: cleanup('preserved', 'candidate timeline 不匹配，按 fail-closed 保留。'),
          postcondition: { pass: true, liveCheckoutTouched: false, candidatePreserved: true },
        };
      }
      const repository = createTimelineRepositoryClient();
      const bundle = await repository.exportDocumentBundle(candidate.candidateTimelineId);
      const sourceNode = bundle.workNodes.find((node) => node.id === candidate.sourceTargetId);
      const sourceSnapshot = bundle.snapshots.find((snapshot) => snapshot.id === candidate.sourceTargetId);
      const sourcePayload = sourceNode?.workingPayload || sourceSnapshot?.payload;
      const sourceRevision = sourceNode
        ? authoritativePreparedNodeRevision(sourceNode)
        : sourceSnapshot?.createdAt;
      const expectedParentNodeId = sourceNode?.id || null;
      if (!sourcePayload || typeof sourceRevision !== 'number' || !Number.isSafeInteger(sourceRevision) || sourceRevision < 0
        || candidate.sourceRevision !== sourceRevision
        || (target.parentNodeId || null) !== expectedParentNodeId) {
        return {
          ok: false as const,
          liveCheckoutTouched: false as const,
          deleted: false as const,
          candidate,
          cleanup: cleanup('preserved', 'source target、source revision 或 structural parent 无法证明，按 fail-closed 保留。'),
          postcondition: { pass: true, liveCheckoutTouched: false, candidatePreserved: true },
        };
      }
      const fullTarget = (await client.get(target.id)).node;
      const [sourceDigest, baseDigest, workingDigest] = await Promise.all([
        sha256Json(sourcePayload),
        sha256Json(fullTarget.basePayload),
        sha256Json(fullTarget.workingPayload),
      ]);
      const candidateAuditMarker = `[prepared-candidate:v1:${candidate.proposalId}:${candidate.proposalDigest}]`;
      const diff = diffPreparedPayloads(fullTarget.basePayload, fullTarget.workingPayload);
      const diffDigest = await sha256Json(diff.changes);
      const scopeGate = checkPreparedScope(diff, candidate.scope);
      const restoreMetadata = parsePreparedRestoreBranchId(candidate.proposalId, fullTarget.branchId);
      const branchIsProven = fullTarget.branchId === `prepared-${candidate.proposalId}`
        || restoreMetadata !== null;
      let restoreProofPass = true;
      if (restoreMetadata) {
        const expectedScope = PREPARED_RESTORE_PROPOSAL_SCOPES[restoreMetadata.scope];
        const expectedIntent = restoreMetadata.scope === 'timeline.structure' ? 'timeline' : 'buff';
        const restoreTarget = (await client.get(restoreMetadata.nodeId)).node;
        const rebuilt = applyPreparedRestoreScope(
          restoreMetadata.scope,
          sourcePayload,
          restoreTarget.basePayload,
        );
        restoreProofPass = candidate.intent === expectedIntent
          && samePreparedScope(candidate.scope, expectedScope)
          && restoreTarget.timelineId === activeTimelineId
          && authoritativePreparedNodeRevision(restoreTarget) === restoreMetadata.nodeRevision
          && rebuilt.ok
          && sameOperatorConfigPayload(rebuilt.payload, fullTarget.workingPayload);
      }
      if (sourceDigest !== baseDigest
        || candidate.basePayloadDigest !== baseDigest
        || candidate.workingPayloadDigest !== workingDigest
        || candidate.diffDigest !== diffDigest
        || !scopeGate.pass
        || candidate.nodeRevision !== authoritativePreparedNodeRevision(fullTarget)
        || !branchIsProven
        || !restoreProofPass
        || fullTarget.status !== 'ready'
        || !fullTarget.description.startsWith(candidateAuditMarker)) {
        return {
          ok: false as const,
          liveCheckoutTouched: false as const,
          deleted: false as const,
          candidate,
          cleanup: cleanup('preserved', 'candidate payload、scope、branch、status、revision 或 provenance marker 无法与引用完整匹配，按 fail-closed 保留。'),
          postcondition: { pass: true, liveCheckoutTouched: false, candidatePreserved: true },
        };
      }
      const descendants = before.nodes.filter((node) => node.parentNodeId === target.id);
      const checkout = await repository.getCheckoutRef(candidate.candidateTimelineId);
      const commits = before.commits.filter((commit) => commit.nodeId === target.id);
      const auditEvents = await repository.listAuditEvents(candidate.candidateTimelineId, 500);
      const auditWindowComplete = auditEvents.length < 500;
      const hasHistoricalCheckout = auditEvents.some((event) => (
        event.subjectId === target.id
        && (event.subjectType === 'checkout' || event.eventType === 'checkout.updated' || event.eventType === 'work-node.base-restored')
      ));
      if (descendants.length > 0
        || (checkout?.targetType === 'work-node' && checkout.targetId === target.id)
        || commits.length > 0
        || !auditWindowComplete
        || hasHistoricalCheckout) {
        return {
          ok: false as const,
          liveCheckoutTouched: false as const,
          deleted: false as const,
          candidate,
          cleanup: cleanup('preserved', '存在 checkout、commit、后代或不完整的历史审计证据，绝不删除。'),
          postcondition: { pass: true, liveCheckoutTouched: false, candidatePreserved: true },
        };
      }
      const deleted = await client.delete(
        target.id,
        target.timelineId,
        {
          nodes: [{
            id: target.id,
            contentRevision: authoritativePreparedNodeRevision(target),
            updatedAt: target.updatedAt,
          }],
        },
      );
      const stillExists = deleted.nodes.some((node) => node.id === target.id);
      if (stillExists) {
        return {
          ok: false as const,
          liveCheckoutTouched: false as const,
          deleted: false as const,
          candidate,
          cleanup: cleanup('failed', '删除调用完成但 candidate 仍存在，未伪报成功。'),
          postcondition: { pass: true, liveCheckoutTouched: false, candidatePreserved: true },
        };
      }
      return {
        ok: true as const,
        liveCheckoutTouched: false as const,
        deleted: true as const,
        candidate,
        cleanup: cleanup('deleted', command.reason),
        postcondition: { pass: true, liveCheckoutTouched: false, candidateDeleted: true },
      };
    } catch (error) {
      return {
        ok: false as const,
        liveCheckoutTouched: false as const,
        deleted: false as const,
        candidate,
        cleanup: cleanup('failed', error instanceof Error ? error.message : String(error)),
        postcondition: { pass: true, liveCheckoutTouched: false, candidatePreserved: true },
      };
    }
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
    if (node.timelineId !== activeTimelineId) {
      throw new Error(`AI work node ${node.id} 不属于当前排轴，拒绝恢复。`);
    }
    const targetNodeRevision = operatorConfigNodeRevision(node);
    const validation = validateTimelinePayload(node.basePayload);
    if (!validation.ok) {
      throw new Error(`AI work node basePayload 校验失败：${validation.issues.map((issue) => issue.message).join('；')}`);
    }

    const repository = createTimelineRepositoryClient();
    saveTimelineData();
    setSelectedCharacterIds(selectedCharacters.map((character) => character.id));
    const currentPayload = getCurrentTimelineSnapshotPayload();
    if (!currentPayload) {
      throw new Error('当前 Canvas runtime payload 不可用，restore 未执行。');
    }
    const previousCheckoutRef = await repository.getCheckoutRef(activeTimelineId);
    if (!previousCheckoutRef) {
      throw new Error('当前正式 SQLite 没有可恢复的 checkout，restore 未执行。');
    }
    if (checkoutIdentity(activeCheckoutRef) !== checkoutIdentity(previousCheckoutRef)) {
      throw new Error('当前页面 checkout 与 SQLite checkout 不一致，拒绝执行 restore。');
    }
    if (previousCheckoutRef.targetType !== 'work-node' || previousCheckoutRef.targetId !== node.id) {
      throw new Error('restore 只能作用于当前 checkout 的 Work Node，目标节点已失去 checkout 所有权。');
    }
    const latestTargetNode = (await client.get(node.id)).node;
    if (operatorConfigNodeRevision(latestTargetNode) !== targetNodeRevision
      || latestTargetNode.timelineId !== node.timelineId
      || (latestTargetNode.parentNodeId || null) !== (node.parentNodeId || null)
      || !sameOperatorConfigPayload(latestTargetNode.basePayload, node.basePayload)
      || !sameOperatorConfigPayload(latestTargetNode.workingPayload, node.workingPayload)) {
      throw new Error('restore 目标 Work Node 在执行前发生 revision、lineage 或 payload 漂移，拒绝恢复。');
    }
    const formalBefore = await readFormalCheckoutPayload(activeTimelineId, previousCheckoutRef);
    if (!sameOperatorConfigPayload(currentPayload, formalBefore.payload)) {
      throw new Error('当前 Canvas payload 与正式 checkout 不一致，拒绝执行 restore。');
    }
    const currentDiff = diffTimelinePayloads(currentPayload, node.basePayload).summary;

    // A Work Node base belongs to its parent.  A root node has no parent, so
    // materialize the base as a browser SQLite snapshot instead of pointing a
    // checkout at a node whose working payload is still the candidate.
    let baseCheckoutTarget: {
      targetType: 'snapshot' | 'work-node';
      targetId: string;
      revision: number;
    };
    let createdRollbackSnapshotId: string | null = null;
    if (node.parentNodeId) {
      const { node: parent } = await client.get(node.parentNodeId);
      if (parent.timelineId !== node.timelineId
        || parent.id !== node.parentNodeId
        || !sameOperatorConfigPayload(parent.workingPayload, node.basePayload)) {
        throw new Error('restore target lineage/base payload 不一致，拒绝恢复。');
      }
      baseCheckoutTarget = {
        targetType: 'work-node',
        targetId: parent.id,
        revision: operatorConfigNodeRevision(parent),
      };
    } else if (sameOperatorConfigPayload(currentPayload, node.basePayload)) {
      const currentTargetRevision = operatorConfigNodeRevision((await client.get(previousCheckoutRef.targetId)).node);
      baseCheckoutTarget = {
        targetType: 'work-node',
        targetId: previousCheckoutRef.targetId,
        revision: currentTargetRevision,
      };
    } else {
      const baseSnapshot = await repository.saveSnapshot({
        id: `ai-rollback-base-${node.id}-${generateId()}`,
        timelineId: activeTimelineId,
        label: `[rollback base] ${node.label}`,
        payload: node.basePayload,
      });
      createdRollbackSnapshotId = baseSnapshot.reused ? null : baseSnapshot.snapshot.id;
      baseCheckoutTarget = {
        targetType: 'snapshot',
        targetId: baseSnapshot.snapshot.id,
        revision: baseSnapshot.snapshot.createdAt,
      };
    }

    let targetCheckoutRef: TimelineCheckoutRef | null = null;
    let finalPostcondition: Awaited<ReturnType<typeof buildWorkNodePayloadPostcondition>> | null = null;
    const previousDocument = { id: activeTimelineId, label: activeTimelineLabel };
    const previousVisibleIds = Object.keys(currentPayload.skillButtonTable || {}).sort();

    isCheckoutMutationPendingRef.current = true;
    try {
      await runAtomicWorkNodeRestore({
      applyTarget: async () => {
        hydrateCheckoutRuntime(node.basePayload, { flushRender: true });
        refreshWorkbenchAfterCheckout();
      },
      verifyVisibleTarget: async () => {
        if (document.visibilityState !== 'visible') {
          return { pass: false, reason: '前台 Canvas 不可见' };
        }
        const visible = await waitForVisibleCanvasButtons(Object.keys(node.basePayload.skillButtonTable || {}).sort());
        const postcondition = await buildWorkNodePayloadPostcondition({
          expectedPayload: node.basePayload,
          actualPayload: getCurrentTimelineSnapshotPayload(),
          expectedVisibleButtonIds: Object.keys(node.basePayload.skillButtonTable || {}).sort(),
          actualVisibleButtonIds: visible.actual,
        });
        return postcondition.pass
          ? postcondition
          : { pass: false, reason: postcondition.failures.join('；'), observed: postcondition };
      },
      persistCheckout: async () => {
        const nextCheckoutRef: TimelineCheckoutRef = {
          timelineId: activeTimelineId,
          targetType: baseCheckoutTarget.targetType,
          targetId: baseCheckoutTarget.targetId,
          updatedAt: Date.now(),
        };
        targetCheckoutRef = nextCheckoutRef;
        await repository.setCheckoutRef(nextCheckoutRef);
        activateTimeline({
          document: previousDocument,
          checkoutRef: nextCheckoutRef,
          workingPayload: node.basePayload,
        });
      },
      persistRollbackLedger: async () => {
        if (!targetCheckoutRef) {
          throw new Error('restore rollback ledger 缺少目标 checkout ref。');
        }
        const latestNode = (await client.get(node.id)).node;
        if (operatorConfigNodeRevision(latestNode) !== targetNodeRevision
          || !sameOperatorConfigPayload(latestNode.basePayload, node.basePayload)
          || !sameOperatorConfigPayload(latestNode.workingPayload, node.workingPayload)) {
          throw new Error('restore 目标 Work Node 在 rollback ledger 写入前发生 revision 或 payload 漂移。');
        }
        const marked = await client.markRollbackApplied(node.id, {
          appliedAt: targetCheckoutRef.updatedAt,
          appliedBy: command.approval?.approvedBy || 'ai',
          rationale: command.approval?.rationale || 'Renderer rollback applied from AI timeline work node basePayload.',
          checkout: targetCheckoutRef,
          basePayloadDigest: await digestJson(node.basePayload),
          baseRevision: baseCheckoutTarget.revision,
        });
        return {
          rollbackApplied: marked.node.id === node.id
            && marked.node.status === 'ready'
            && operatorConfigNodeRevision(marked.node) === targetNodeRevision,
        };
      },
      verifyPersistedTarget: async () => {
        if (!targetCheckoutRef) return { pass: false, reason: 'restore checkout ref 未生成' };
        const persistedCheckout = await repository.getCheckoutRef(activeTimelineId);
        const persistedNode = (await client.get(node.id)).node;
        const rollbackEvent = (await repository.listAuditEvents(activeTimelineId, 200)).find((event) => (
          event.eventType === 'work-node.base-restored'
          && event.subjectType === 'work-node'
          && event.subjectId === node.id
        ));
        const visible = await waitForVisibleCanvasButtons(Object.keys(node.basePayload.skillButtonTable || {}).sort());
        finalPostcondition = await buildWorkNodePayloadPostcondition({
          expectedPayload: node.basePayload,
          actualPayload: getCurrentTimelineSnapshotPayload(),
          expectedVisibleButtonIds: Object.keys(node.basePayload.skillButtonTable || {}).sort(),
          actualVisibleButtonIds: visible.actual,
          expectedCheckout: {
            targetType: targetCheckoutRef.targetType,
            targetId: targetCheckoutRef.targetId,
          },
          observedCheckout: persistedCheckout,
          expectedNodeRevision: baseCheckoutTarget.revision,
          observedNodeRevision: targetCheckoutRef.targetType === 'work-node'
            ? operatorConfigNodeRevision((await client.get(targetCheckoutRef.targetId)).node)
            : (await repository.exportDocumentBundle(activeTimelineId)).snapshots.find((snapshot) => snapshot.id === targetCheckoutRef?.targetId)?.createdAt || null,
        });
        if (persistedNode.status !== 'ready' || operatorConfigNodeRevision(persistedNode) !== targetNodeRevision) {
          return { pass: false, reason: `rollback ledger 状态/revision 不正确：status=${persistedNode.status} revision=${operatorConfigNodeRevision(persistedNode)}`, observed: persistedNode };
        }
        const rollbackDetails = rollbackEvent?.details || {};
        const rollbackCheckout = rollbackDetails.checkout as { targetType?: unknown; targetId?: unknown; updatedAt?: unknown } | undefined;
        if (!rollbackEvent
          || rollbackCheckout?.targetType !== targetCheckoutRef.targetType
          || rollbackCheckout.targetId !== targetCheckoutRef.targetId
          || rollbackCheckout.updatedAt !== targetCheckoutRef.updatedAt
          || rollbackDetails.basePayloadDigest !== finalPostcondition.expected.payloadDigest
          || rollbackDetails.baseRevision !== baseCheckoutTarget.revision) {
          return { pass: false, reason: 'rollback ledger 没有精确记录本次 checkout、revision 和 base payload digest', observed: rollbackEvent || null };
        }
        return finalPostcondition.pass
          ? finalPostcondition
          : { pass: false, reason: finalPostcondition.failures.join('；'), observed: finalPostcondition };
      },
      restorePreviousState: async () => {
        const rollbackFailures: string[] = [];
        try {
          await repository.setCheckoutRef(previousCheckoutRef);
        } catch (error) {
          rollbackFailures.push(`恢复原 checkout 失败：${error instanceof Error ? error.message : String(error)}`);
        }
        try {
          activateTimeline({
            document: previousDocument,
            checkoutRef: previousCheckoutRef,
            workingPayload: currentPayload,
          });
          hydrateCheckoutRuntime(currentPayload, { flushRender: true });
          refreshWorkbenchAfterCheckout();
          await waitForVisibleCanvasButtons(previousVisibleIds);
        } catch (error) {
          rollbackFailures.push(`恢复原页面失败：${error instanceof Error ? error.message : String(error)}`);
        }
        if (createdRollbackSnapshotId) {
          try {
            await repository.archiveSnapshot(createdRollbackSnapshotId);
          } catch (error) {
            rollbackFailures.push(`清理临时 rollback snapshot 失败：${error instanceof Error ? error.message : String(error)}`);
          }
        }
        if (rollbackFailures.length > 0) {
          throw new Error(rollbackFailures.join('；'));
        }
      },
      verifyPreviousState: async () => {
        const persistedCheckout = await repository.getCheckoutRef(activeTimelineId);
        const visible = await waitForVisibleCanvasButtons(previousVisibleIds);
        const previousRevision = operatorConfigNodeRevision((await client.get(previousCheckoutRef.targetId)).node);
        const postcondition = await buildWorkNodePayloadPostcondition({
          expectedPayload: currentPayload,
          actualPayload: getCurrentTimelineSnapshotPayload(),
          expectedVisibleButtonIds: previousVisibleIds,
          actualVisibleButtonIds: visible.actual,
          expectedCheckout: {
            targetType: previousCheckoutRef.targetType,
            targetId: previousCheckoutRef.targetId,
          },
          observedCheckout: persistedCheckout,
          expectedNodeRevision: previousRevision,
          observedNodeRevision: operatorConfigNodeRevision((await client.get(previousCheckoutRef.targetId)).node),
        });
        return postcondition.pass
          ? postcondition
          : { pass: false, reason: postcondition.failures.join('；'), observed: postcondition };
      },
      });
    } finally {
      isCheckoutMutationPendingRef.current = false;
      setProjectionVisibilityRevision((revision) => revision + 1);
    }

    const finalReceipt = finalPostcondition as Awaited<ReturnType<typeof buildWorkNodePayloadPostcondition>> | null;
    if (!targetCheckoutRef || !finalReceipt || !finalReceipt.pass) {
      throw new Error('restore 成功后没有形成可验证的 checkout/postcondition receipt。');
    }
    if (command.reload === true) {
      window.setTimeout(() => window.location.reload(), 80);
    }
    return {
      ok: true,
      done: true,
      nodeId: node.id,
      nodeRevision: targetNodeRevision,
      status: 'ready' as const,
      rollbackApplied: true,
      rollbackMarkError: null,
      checkout: targetCheckoutRef,
      checkoutTargetRevision: baseCheckoutTarget.revision,
      basePayloadDigest: finalReceipt.observed.payloadDigest,
      currentDiff,
      visiblePostcondition: finalReceipt,
      reloaded: command.reload === true,
    };
  };

  const processMainWorkbenchCanvasCommand = async () => {
    // Only the foreground Workbench may claim renderer commands. Hidden tabs
    // can carry stale sessionStorage and must never advance SQLite checkout.
    if (document.visibilityState !== 'visible') {
      return;
    }
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
        ...CANVAS_WORK_NODE_MANAGEMENT_COMMANDS,
        'patchAiTimelineWorkNode',
        'patchAndValidateAiTimelineWorkNode',
        'prepareReviewedWorkNodeProposal',
        'applyReviewedWorkNodeProposal',
        'abandonPreparedWorkNodeProposal',
        'applyApprovedWorkNodePatch',
        'checkoutAiTimelineWorkNode',
        'restoreAiTimelineWorkNodeBase',
        'refreshOperatorConfig',
        'prepareOperatorConfigProposal',
        'applyPreparedOperatorConfigProposal',
        'refreshSnapshot',
      ]).find((entry) => {
        if (entry.command.op === 'prepareReviewedWorkNodeProposal') {
          return entry.command.intent !== 'selection';
        }
        if (entry.command.op === 'applyReviewedWorkNodeProposal'
          || entry.command.op === 'abandonPreparedWorkNodeProposal') {
          return entry.command.candidate.intent !== 'selection';
        }
        return true;
      });
      if (!commandEntry) {
        return;
      }

      patchMainWorkbenchCommand(commandEntry.id, { status: 'running' });
      const command = commandEntry.command;
      const settleCommand = (patch: Parameters<typeof patchMainWorkbenchCommand>[1]) => {
        const settledEntry = patchMainWorkbenchCommand(commandEntry.id, patch);
        if (settledEntry) void pushMainWorkbenchCommandResult(settledEntry);
      };
      try {
        const agentWorkNodeTimelineId = commandEntry.source === 'agent-host'
          && isAgentWorkNodeBrowserCommand(command)
          ? await assertAgentWorkNodeCommandTimelineBoundary({
              entry: commandEntry,
              activeTimelineId,
              readNode: async (nodeId) => (await createAiTimelineWorkNodeClient().get(nodeId)).node,
            })
          : null;
        if (command.op === 'addSkillButton') {
          const result = addSkillButtonFromWorkbenchCommand(command);
          settleCommand({ status: 'done', result });
          return;
        }

        if (command.op === 'removeSkillButton') {
          const button = findWorkbenchButtonForRemove(command);
          if (!button) {
            throw new Error('未找到可回退的技能按钮');
          }
          removeTimelineButton(button.lineIndex, button.id);
          dispatch({ type: 'REMOVE_SKILL_BUTTON', buttonId: button.id });
          settleCommand({
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
          settleCommand({
            status: 'done',
            result: { buttonId, buffId: result.buffId, duplicate: result.isDuplicate },
          });
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
          settleCommand({
            status: 'done',
            result: {
              requestedCount: command.buttonIds.length,
              appliedCount: results.filter((item) => !item.duplicate).length,
              duplicateCount: results.filter((item) => item.duplicate).length,
              results,
            },
          });
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
          settleCommand({
            status: 'done',
            result: {
              buttonId,
              removedBuffIds: buffs.map((buff) => buff.id),
              removedBuffNames: buffs.map((buff) => buff.displayName || buff.name),
            },
          });
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
          settleCommand({
            status: 'done',
            result: { buttonId: command.buttonId, targetResistance: nextResistance },
          });
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
          await ensureTimelineDocumentExists(repository, activeTimelineId, snapshot.label || '主排轴');
          await repository.saveSnapshot({
            id: snapshot.id,
            timelineId: activeTimelineId,
            label: snapshot.label,
            payload: snapshot.payload,
            createdAt: snapshot.createdAt,
          });
          settleCommand({
            status: 'done',
            result: {
              snapshotId: snapshot.id,
              label: snapshot.label,
              summary: snapshot.summary,
            },
          });
          return;
        }

        if (command.op === 'restoreTimelineSnapshot') {
          const repository = await saveLegacySnapshotsToRepository();
          const documents = await repository.listDocuments();
          const sourceTimelineIds = [
            activeTimelineId,
            ...documents.map((document) => document.id).filter((timelineId) => timelineId !== activeTimelineId),
          ];
          const snapshots = (await Promise.all(sourceTimelineIds.map(async (timelineId) => (
            (await repository.listSnapshots(timelineId)).map((entry) => ({ ...entry, timelineId }))
          )))).flat().map((entry) => {
            const payload = entry.payload!;
            return {
              id: entry.id,
              timelineId: entry.timelineId,
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
          const targetTimelineId = snapshot.timelineId === DEFAULT_TIMELINE_ID
            ? getLegacySnapshotTimelineId(snapshot.id)
            : snapshot.timelineId;
          await ensureTimelineDocumentExists(repository, targetTimelineId, snapshot.label);
          const persisted = await repository.saveSnapshot({
            id: snapshot.id,
            timelineId: targetTimelineId,
            label: snapshot.label,
            payload: snapshot.payload,
            createdAt: snapshot.createdAt,
          });
          const restored = await restoreUserWorkspaceSnapshot({
            timelineId: targetTimelineId,
            snapshotId: persisted.snapshot.id,
            updatedAt: Date.now(),
          });
          const restoredPayload = restored.payload as TimelineSnapshotPayload;
          const restoredCheckoutRef = restored.checkoutRef as TimelineCheckoutRef;
          activateTimeline({
            document: { id: targetTimelineId, label: snapshot.label },
            checkoutRef: restoredCheckoutRef,
            workingPayload: restoredPayload,
          });
          hydrateCheckoutRuntime(restoredPayload);
          await ensureTimelineDocumentBaselineWorkNode(targetTimelineId, restoredPayload, snapshot.label);
          settleCommand({
            status: 'done',
            result: { snapshotId: snapshot.id, label: snapshot.label, reloaded: command.reload !== false },
          });
          if (command.reload !== false) {
            window.setTimeout(() => window.location.reload(), 80);
          }
          return;
        }

        if (command.op === 'listTimelineSnapshots') {
          const repository = await saveLegacySnapshotsToRepository();
          const documents = await repository.listDocuments();
          const snapshots = (await Promise.all(documents.map(async (document) => (
            (await repository.listSnapshots(document.id)).map((snapshot) => ({ ...snapshot, timelineId: document.id }))
          )))).flat().map((snapshot) => ({
            id: snapshot.id,
            timelineId: snapshot.timelineId,
            label: snapshot.label,
            createdAt: snapshot.createdAt,
            summary: {
              characterCount: snapshot.payload?.selectedCharacters.length || 0,
              buttonCount: Object.keys(snapshot.payload?.skillButtonTable || {}).length,
              buffCount: snapshot.payload?.allBuffList.length || 0,
            },
          }));
          settleCommand({ status: 'done', result: { snapshots } });
          return;
        }

        if (command.op === 'createAiTimelineWorkNodeFromCurrent') {
          const result = await createAiTimelineWorkNodeFromCurrentCommand(command);
          settleCommand({ status: 'done', result });
          return;
        }

        if (command.op === 'diffAiTimelineWorkNode') {
          const result = await createAiTimelineWorkNodeClient().diff(command.nodeId);
          settleCommand({ status: 'done', result });
          return;
        }

        if (isCanvasWorkNodeManagementCommand(command)) {
          switch (command.op) {
          case 'listAiTimelineWorkNodes': {
            const result = await createAiTimelineWorkNodeClient().list();
            const timelineId = agentWorkNodeTimelineId || command.timelineId?.trim() || '';
            const scopedResult = timelineId
              ? projectMainWorkbenchWorkNodeListToTimeline(result, timelineId)
              : result;
            settleCommand({
              status: 'done',
              result: {
                ...scopedResult,
                timelineId: timelineId || null,
              },
            });
            return;
          }
          case 'readAiTimelineWorkNode': {
            const client = createAiTimelineWorkNodeClient();
            const result = await client.get(command.nodeId);
            const list = await client.list();
            const listedTarget = list.nodes.find((node) => node.id === result.node.id);
            if (!listedTarget
              || authoritativePreparedNodeRevision(listedTarget) !== authoritativePreparedNodeRevision(result.node)
              || listedTarget.updatedAt !== result.node.updatedAt) {
              throw new Error('AI_WORKNODE_READ_STALE: Work Node 在读取期间发生变化，请重新审阅。');
            }
            const nodeRevision = authoritativePreparedNodeRevision(result.node);
            const diff = diffTimelinePayloads(result.node.basePayload, result.node.workingPayload);
            const reviewIdentity = await buildReviewedWorkNodeIdentity({
              nodeId: result.node.id,
              timelineId: result.node.timelineId,
              nodeRevision,
              workingPayload: result.node.workingPayload,
              diffChanges: diff,
            });
            const deletionIdentity = await buildReviewedWorkNodeDeletionIdentity({
              nodeId: result.node.id,
              nodes: list.nodes,
            });
            if (command.includePayload === false) {
              const { basePayload: _basePayload, workingPayload: _workingPayload, ...node } = result.node;
              settleCommand({
                status: 'done',
                result: { ...result, node, diffSummary: diff.summary, reviewIdentity, deletionIdentity },
              });
              return;
            }
            settleCommand({
              status: 'done',
              result: { ...result, diffSummary: diff.summary, reviewIdentity, deletionIdentity },
            });
            return;
          }
          case 'validateAiTimelineWorkNode': {
            const client = createAiTimelineWorkNodeClient();
            const { node } = await client.get(command.nodeId);
            const validation = validateTimelinePayload(node.workingPayload);
            let nextNode = node;
            let repairedStatus = false;
            // Validation is intentionally allowed to repair only the repository
            // lifecycle marker. It never changes payload or formal checkout.
            if (command.repairStatus !== false && validation.ok && node.status === 'open') {
              nextNode = (await client.update(node.id, { status: 'ready' })).node;
              repairedStatus = true;
              setNodeReviewRefreshRevision((revision) => revision + 1);
            }
            const diff = diffTimelinePayloads(nextNode.basePayload, nextNode.workingPayload);
            const checkoutDecision = buildAiTimelineCheckoutDecision({
              approvalPolicy: nextNode.approvalPolicy,
              riskFlags: nextNode.riskFlags,
              diff,
            });
            settleCommand({
              status: validation.ok ? 'done' : 'error',
              result: {
                ok: validation.ok,
                nodeId: nextNode.id,
                status: nextNode.status,
                contentRevision: nextNode.contentRevision,
                validation,
                repairedStatus,
                diff,
                checkoutDecision,
                path: 'browser-sqlite://timeline-work-nodes',
              },
              ...(validation.ok ? {} : {
                error: validation.issues.map((issue) => issue.message).join('；'),
              }),
            });
            return;
          }
          case 'deleteAiTimelineWorkNode': {
          const client = createAiTimelineWorkNodeClient();
          const before = await client.list();
          const target = before.nodes.find((node) => node.id === command.nodeId);
          if (!target) {
            const result = {
              ok: false as const,
              deleted: false as const,
              nodeId: command.nodeId,
              deletedNodeIds: [] as string[],
              protected: false as const,
              code: 'ai-worknode-not-found',
              message: `AI timeline work node not found: ${command.nodeId}`,
            };
            settleCommand({ status: 'error', result, error: result.message });
            return;
          }
          const deletionIdentity = await buildReviewedWorkNodeDeletionIdentity({
            nodeId: target.id,
            nodes: before.nodes,
          });
          const deletionVerification = verifyReviewedWorkNodeDeletionIdentity({
            expected: {
              nodeId: command.nodeId,
              nodeRevision: command.expectedNodeRevision,
              subtreeNodeCount: command.expectedSubtreeNodeCount,
              subtreeDigest: command.expectedSubtreeDigest,
            },
            observed: deletionIdentity,
          });
          if (!deletionVerification.pass) {
            throw new Error(
              `AI_WORKNODE_DELETE_REVIEW_STALE: ${deletionVerification.reason || 'Work Node 删除子树已变化。'}`,
            );
          }
          const deletedCandidateIds = new Set(deletionIdentity.subtreeNodeIds);
          if (agentWorkNodeTimelineId) {
            for (const node of before.nodes) {
              if (deletedCandidateIds.has(node.id)) {
                assertMainWorkbenchWorkNodeTimeline(node, agentWorkNodeTimelineId, command.op);
              }
            }
          }
          const checkout = await createTimelineRepositoryClient().getCheckoutRef(target.timelineId);
          if (checkout?.targetType === 'work-node' && deletedCandidateIds.has(checkout.targetId)) {
            const result = {
              ok: false as const,
              deleted: false as const,
              nodeId: command.nodeId,
              deletedNodeIds: [] as string[],
              protected: true as const,
              checkoutNodeId: checkout.targetId,
              code: 'timeline-work-node-current-checkout-protected',
              message: 'Cannot delete the current Work Node path. Checkout another target first.',
            };
            settleCommand({ status: 'error', result, error: result.message });
            return;
          }
          const deleteExpectationNodes = before.nodes
            .filter((node) => deletedCandidateIds.has(node.id))
            .map((node) => ({
              id: node.id,
              contentRevision: authoritativePreparedNodeRevision(node),
              updatedAt: node.updatedAt,
            }));
          const deleted = await client.delete(
            command.nodeId,
            target.timelineId,
            { nodes: deleteExpectationNodes },
          );
          const remainingIds = new Set(deleted.nodes.map((node) => node.id));
          const deletedNodeIds = before.nodes
            .filter((node) => !remainingIds.has(node.id))
            .map((node) => node.id);
          const ledgerPostcondition = verifyWorkNodeDeleteLedger({
            requestedNodeId: command.nodeId,
            expectedDeletedNodeIds: [...deletedCandidateIds],
            remainingNodeIds: deleted.nodes.map((node) => node.id),
            actualDeletedNodeIds: deletedNodeIds,
          });
          if (!ledgerPostcondition.pass) {
            const result = {
              ok: false as const,
              deleted: false as const,
              nodeId: command.nodeId,
              deletedNodeIds,
              protected: false as const,
              code: 'ai-worknode-delete-postcondition-failed',
              message: ledgerPostcondition.reason || 'Work Node 删除后的 SQLite ledger 校验失败。',
              ledgerPostcondition,
            };
            settleCommand({ status: 'error', result, error: result.message });
            return;
          }
          settleCommand({
            status: 'done',
            result: {
              ok: true,
              deleted: true,
              nodeId: command.nodeId,
              deletedNodeIds,
              protected: false,
              remainingNodeCount: deleted.nodes.length,
              path: deleted.path,
              ledgerPostcondition,
            },
          });
          return;
          }
          default:
            return;
          }
        }

        if (command.op === 'patchAiTimelineWorkNode') {
          const result = await patchAiTimelineWorkNodeFromCommand(command);
          if ('issues' in result) {
            settleCommand({
              status: 'error',
              result,
              error: result.issues.map((issue) => issue.message).join('；'),
            });
            return;
          }
          setNodeReviewRefreshRevision((revision) => revision + 1);
          settleCommand({ status: 'done', result });
          return;
        }

        if (command.op === 'patchAndValidateAiTimelineWorkNode') {
          const result = await patchAndValidateAiTimelineWorkNodeFromCommand(command);
          settleCommand({
            status: result.ok ? 'done' : 'error',
            result,
            ...(result.ok ? {} : { error: result.issues?.map((issue) => issue.message).join('；') || 'patch_and_validate failed' }),
          });
          if (result.ok) setNodeReviewRefreshRevision((revision) => revision + 1);
          return;
        }

        if (command.op === 'prepareReviewedWorkNodeProposal') {
          const result = await prepareReviewedWorkNodeProposalFromCommand(command);
          settleCommand({
            status: result.ok ? 'done' : 'error',
            result,
            ...(result.ok ? {} : { error: result.message }),
          });
          if (result.ok) setNodeReviewRefreshRevision((revision) => revision + 1);
          return;
        }

        if (command.op === 'applyReviewedWorkNodeProposal') {
          const result = await applyReviewedWorkNodeProposalFromCommand(command);
          settleCommand({
            status: result.ok ? 'done' : 'error',
            result,
            ...(result.ok ? {} : { error: result.message }),
          });
          if (result.ok) setNodeReviewRefreshRevision((revision) => revision + 1);
          return;
        }

        if (command.op === 'abandonPreparedWorkNodeProposal') {
          const result = await abandonPreparedWorkNodeProposalFromCommand(command);
          settleCommand({
            status: result.ok && result.cleanup.status === 'deleted' ? 'done' : 'error',
            result,
            ...(result.ok && result.cleanup.status === 'deleted' ? {} : { error: result.cleanup.reason }),
          });
          if (result.cleanup.status === 'deleted') setNodeReviewRefreshRevision((revision) => revision + 1);
          return;
        }

        if (command.op === 'applyApprovedWorkNodePatch') {
          const prepared = await patchAndValidateAiTimelineWorkNodeFromCommand({
            op: 'patchAndValidateAiTimelineWorkNode',
            patch: command.patch,
            label: command.label,
            description: command.description,
            approvalPolicy: 'manual',
          });
          if (!prepared.ok) {
            settleCommand({
              status: 'error',
              result: prepared,
              error: prepared.issues?.map((issue) => issue.message).join('；') || 'Work Node patch validation failed',
            });
            return;
          }
          const checkout = await checkoutAiTimelineWorkNodeFromCommand({
            op: 'checkoutAiTimelineWorkNode',
            nodeId: prepared.nodeId,
            reload: false,
            approval: {
              mode: 'manual',
              approvedBy: 'user',
              rationale: 'Approved in the embedded DEF AI mode.',
            },
          });
          if (!checkout.checkoutApplied) {
            throw new Error(checkout.checkoutMarkError || 'Work Node checkout was not applied');
          }
          settleCommand({
            status: 'done',
            result: {
              prepared,
              checkout,
              visiblePostcondition: checkout.visiblePostcondition,
            },
          });
          return;
        }

        if (command.op === 'checkoutAiTimelineWorkNode') {
          const result = await checkoutAiTimelineWorkNodeFromCommand(command);
          settleCommand({ status: 'done', result });
          return;
        }

        if (command.op === 'restoreAiTimelineWorkNodeBase') {
          const result = await restoreAiTimelineWorkNodeBaseFromCommand(command);
          setNodeReviewRefreshRevision((revision) => revision + 1);
          settleCommand({ status: 'done', result });
          return;
        }

        if (command.op === 'refreshOperatorConfig') {
          await handleRefreshAvailableCandidates();
          settleCommand({
            status: 'done',
            result: { refreshed: true, characterCount: selectedCharacters.length },
          });
          return;
        }

        if (command.op === 'prepareOperatorConfigProposal') {
          const result = await prepareOperatorConfigProposalFromWorkbenchCommand(command);
          settleCommand({ status: 'done', result });
          return;
        }

        if (command.op === 'applyPreparedOperatorConfigProposal') {
          const result = await applyPreparedOperatorConfigProposalFromWorkbenchCommand(command);
          settleCommand({ status: 'done', result });
          return;
        }

        if (command.op === 'refreshSnapshot') {
          const snapshot = readMainWorkbenchSnapshot();
          if (snapshot) {
            await pushMainWorkbenchSnapshot(snapshot);
          }
          settleCommand({
            status: 'done',
            result: {
              refreshed: true,
              updatedAt: snapshot?.updatedAt ?? Date.now(),
              selectedCharacterCount: snapshot?.selectedCharacters.length ?? selectedCharacters.length,
              skillButtonCount: snapshot?.skillButtons.length ?? skillButtons.length,
            },
          });
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
            staffIndex: button.persistenceStaffIndex,
            lineIndex: button.persistenceStaffIndex,
            nodeIndex: button.persistenceNodeIndex,
            nodeNumber: button.persistenceNodeIndex + 1,
            position: { x: 80 + (button.nodeIndex ?? 0) * 22, y: 60 + button.lineIndex * 300 },
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
                .filter((button) => button.persistenceStaffIndex === index && button.characterId === character.id)
                .map((button) => ({
                  id: button.id,
                  characterId: button.characterId,
                  characterName: button.characterName,
                  skillType: button.skillType as SkillButtonType,
                  staffIndex: button.persistenceStaffIndex,
                  lineIndex: button.persistenceStaffIndex,
                  nodeIndex: button.persistenceNodeIndex,
                  nodeNumber: button.persistenceNodeIndex + 1,
                  position: { x: 80 + (button.nodeIndex ?? 0) * 22, y: 60 + button.lineIndex * 300 },
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
                  lineIndex: button.lineIndex ?? button.staffIndex,
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
        settleCommand({ status: 'done', result });
      } catch (error) {
        const errorCode = typeof error === 'object' && error && 'code' in error && typeof error.code === 'string'
          ? error.code
          : '';
        settleCommand({
          status: 'error',
          error: `${errorCode ? `[${errorCode}] ` : ''}${error instanceof Error ? error.message : String(error)}`,
        });
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
    }

    dispatch({ type: 'CLEAR_SKILL_BUTTONS' });
    restoredButtons.forEach((button) => {
      dispatch({ type: 'ADD_SKILL_BUTTON', button });
    });
  }, [currentView, dispatch, loadTimelineData, normalizeTimelineData, selectedCharacters]);

  useEffect(() => {
    return onSkillButtonBuffAdded(({ buttonId, buffId }) => {
      if (!buttonId || !buffId) return;
      const payload = getCurrentTimelineSnapshotPayload();
      if (payload) setSessionWorkingPayload(payload, 'runtime');
    });
  }, [setSessionWorkingPayload]);

  useEffect(() => {
    return onSkillButtonBuffRemoved(({ buttonId, buffId }) => {
      if (!buttonId || !buffId) return;
      const payload = getCurrentTimelineSnapshotPayload();
      if (payload) setSessionWorkingPayload(payload, 'runtime');
    });
  }, [setSessionWorkingPayload]);

  const { draggingState, mousePosition, handleSandboxDragStart, handleButtonMouseDown } = useCanvasDrag({
    disabled: isAgentMode,
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

  processMainWorkbenchCanvasCommandRef.current = processMainWorkbenchCanvasCommand;

  useEffect(() => {
    if (!isAgentMode) {
      browserAgentRuntime.cancelCommandPull();
      return undefined;
    }
    let stopped = false;
    let running = false;
    let retryDelay = 100;
    let timer: number | null = null;
    const schedule = (delay: number) => {
      if (stopped || timer !== null) return;
      timer = window.setTimeout(() => {
        timer = null;
        void runOnce();
      }, Math.max(25, Math.min(delay, 1000)));
    };
    const runOnce = async () => {
      if (stopped || running || document.visibilityState !== 'visible') {
        if (!stopped && document.visibilityState !== 'visible') schedule(250);
        return;
      }
      running = true;
      try {
        await processMainWorkbenchCanvasCommandRef.current?.();
        retryDelay = 100;
        schedule(25);
      } catch (error) {
        if (!stopped) {
          console.warn('[CanvasBoard] Agent command pull failed; recovery path will retry.', error);
          schedule(retryDelay);
          retryDelay = Math.min(retryDelay * 2, 1000);
        }
      } finally {
        running = false;
      }
    };
    const handleControlEvent = () => {
      if (running) {
        schedule(50);
        return;
      }
      void runOnce();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void runOnce();
      }
    };
    void runOnce();
    window.addEventListener('def-main-workbench-control', handleControlEvent);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      stopped = true;
      if (timer !== null) window.clearTimeout(timer);
      browserAgentRuntime.cancelCommandPull();
      window.removeEventListener('def-main-workbench-control', handleControlEvent);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [isAgentMode]);

  useEffect(() => {
    const publishWhenVisible = () => {
      if (document.visibilityState === 'visible') setProjectionVisibilityRevision((revision) => revision + 1);
    };
    document.addEventListener('visibilitychange', publishWhenVisible);
    return () => document.removeEventListener('visibilitychange', publishWhenVisible);
  }, []);

  useEffect(() => {
    if (!isAgentMode) {
      setAiHoverZone('right');
      return undefined;
    }
    const updateHoverZone = (clientX: number) => {
      const panelWidth = Math.min(window.innerWidth * 0.5, 760, Math.max(0, window.innerWidth - 96));
      setAiHoverZone(clientX >= window.innerWidth - panelWidth ? 'right' : 'left');
    };
    const handlePointerMove = (event: PointerEvent) => updateHoverZone(event.clientX);
    window.addEventListener('pointermove', handlePointerMove, { passive: true });
    return () => window.removeEventListener('pointermove', handlePointerMove);
  }, [isAgentMode]);

  // The Native UI used to read node/working/* from a materialized Node DB.
  // The browser now owns the same review projection in SQLite. Every request
  // is keyed by the checkout identity and a local generation so a slower read
  // from the previous checkout cannot overwrite the current snapshot.
  useEffect(() => {
    const requestId = ++nodeReviewRequestRef.current;
    let cancelled = false;
    const checkout = activeCheckoutRef;
    const isCurrentWorkNode = checkout?.targetType === 'work-node';
    if (!isTimelineSessionReady || currentView !== 'canvas' || document.visibilityState !== 'visible' || !isCurrentWorkNode) {
      nodeReviewRef.current = isCurrentWorkNode ? null : emptyAiTimelineNodeReviewProjection();
      return () => {
        cancelled = true;
      };
    }

    nodeReviewRef.current = null;
    let latestReadId = 0;
    const refresh = async () => {
      const readId = ++latestReadId;
      try {
        const { node } = await createAiTimelineWorkNodeClient().get(checkout.targetId);
        const currentIdentity = activeTimelineIdentityRef.current;
        if (cancelled
          || requestId !== nodeReviewRequestRef.current
          || readId !== latestReadId
          || currentIdentity.timelineId !== activeTimelineId
          || currentIdentity.checkout !== checkoutIdentity(checkout)
          || node.timelineId !== activeTimelineId
          || node.id !== checkout.targetId) {
          return;
        }
        if (!Number.isSafeInteger(node.contentRevision) || Number(node.contentRevision) < 0) {
          setAuthoritativeCheckoutContentRevision(null);
          await browserAgentRuntime.suspendWritableBinding().catch(() => undefined);
          return;
        }
        const nodeRevision = Number(node.contentRevision);
        const runtimePayload = getCurrentTimelineSnapshotPayload();
        if (!runtimePayload || !sameOperatorConfigPayload(runtimePayload, node.workingPayload)) {
          setAuthoritativeCheckoutContentRevision(null);
          await browserAgentRuntime.suspendWritableBinding().catch(() => undefined);
          return;
        }
        const previousManifest = nodeReviewRef.current?.report?.manifest;
        if (previousManifest?.nodeId === node.id
          && previousManifest.revision === nodeRevision
          && previousManifest.updatedAt === node.updatedAt) {
          return;
        }
        const review = buildAiTimelineNodeReviewProjection(node, checkout);
        nodeReviewRef.current = review;
        setAuthoritativeCheckoutContentRevision(nodeRevision);
        const snapshot = readMainWorkbenchSnapshot();
        if (!snapshot || snapshot.checkout?.targetType !== 'work-node'
          || snapshot.checkout.targetId !== checkout.targetId
          || snapshot.activeTimelineId !== activeTimelineId) {
          return;
        }
        const nextSnapshot: MainWorkbenchSnapshot = {
          ...snapshot,
          updatedAt: Date.now(),
          checkout: {
            ...snapshot.checkout,
            contentRevision: nodeRevision,
            updatedAt: checkout.updatedAt,
          },
          nodeReview: review,
        };
        writeMainWorkbenchSnapshot(nextSnapshot);
        await pushMainWorkbenchSnapshot(nextSnapshot);
      } catch {
        // A deleted or concurrently replaced node is represented by the next
        // checkout/snapshot generation; do not publish an error as old data.
      }
    };
    void refresh();
    const revisionTimer = window.setInterval(() => {
      void refresh();
    }, 1500);
    return () => {
      cancelled = true;
      window.clearInterval(revisionTimer);
    };
  }, [activeCheckoutRef, activeTimelineId, checkoutBootstrapRevision, currentView, isTimelineSessionReady, nodeReviewRefreshRevision, projectionVisibilityRevision]);

  useEffect(() => {
    if (currentView !== 'canvas') {
      return;
    }
    // Multiple local Workbench tabs may remain mounted. Only the foreground
    // tab may publish the canonical projection; otherwise a hidden stale tab
    // can overwrite the active timeline and trip every session gate mid-turn.
    if (document.visibilityState !== 'visible') return;
    const timelineButtons = timelineData.staffLines.flatMap((staffLine) =>
      (Array.isArray(staffLine.buttons) ? staffLine.buttons : []).map((button) => ({
        ...button,
        staffIndex: staffLine.staffIndex,
      }))
    );
    const currentSkillButtonIds = skillButtons.length > 0
      ? skillButtons.map((button) => button.id)
      : timelineButtons.map((button) => button.id);
    let computedDamageReport: ReturnType<typeof buildDamageReportSnapshot> | null = null;
    let damageReportDiagnostic: MainWorkbenchSnapshot['damageReportDiagnostic'];
    try {
      computedDamageReport = buildDamageReportSnapshot({ buttonIds: currentSkillButtonIds });
    } catch (error) {
      damageReportDiagnostic = {
        status: 'formula-error',
        code: 'DAMAGE_REPORT_FORMULA_ERROR',
        message: (error instanceof Error ? error.message : String(error)).slice(0, 1_000),
      };
    }
    const operatorConfigCache = getOperatorConfigPageCache();
    const persistedButtonTable = getSkillButtonTable();
    const projectButtonState = (buttonId: string, persistedButton: PersistedSkillButton | undefined) => (
      projectMainWorkbenchButtonState({
        selectedBuffIds: persistedButton?.selectedBuff ?? [],
        selectedBuffs: getBuffsByButtonId(buttonId),
        buffStackCounts: persistedButton?.buffStackCounts,
        panelConfig: persistedButton?.panelConfig,
        targetResistance: persistedButton?.resistanceConfig?.targetResistance,
      })
    );
    const mirroredButtons: MainWorkbenchSnapshot['skillButtons'] = skillButtons.length > 0
      ? skillButtons.map((button) => {
          const persistedButton = persistedButtonTable[button.id];
          const buttonState = projectButtonState(button.id, persistedButton);
          return {
            id: button.id,
            characterId: button.characterId,
            characterName: button.characterName,
            skillType: button.skillType,
            runtimeSkillId: button.runtimeSkillId,
            skillDisplayName: button.skillDisplayName,
            staffIndex: button.staffIndex,
            lineIndex: button.lineIndex,
            persistenceStaffIndex: button.lineIndex,
            persistenceNodeIndex: button.staffIndex * GRID_NODE_COUNT + (button.nodeIndex ?? 0),
            nodeIndex: button.nodeIndex,
            nodeNumber: button.nodeNumber,
            ...buttonState,
          };
        })
        : timelineButtons.length > 0
        ? timelineButtons.map((button) => {
          const persistedButton = persistedButtonTable[button.id];
          const buttonState = projectButtonState(button.id, persistedButton);
          return {
            id: button.id,
            characterId: persistedButton?.characterId ?? button.characterName,
            characterName: button.characterName,
            skillType: button.skillType as SkillButtonType,
            runtimeSkillId: button.runtimeSkillId,
            skillDisplayName: button.skillDisplayName,
            staffIndex: Math.floor(button.nodeIndex / GRID_NODE_COUNT),
            lineIndex: button.staffIndex,
            persistenceStaffIndex: button.staffIndex,
            persistenceNodeIndex: button.nodeIndex,
            nodeIndex: button.nodeIndex % GRID_NODE_COUNT,
            nodeNumber: calculateNodeNumber(button.nodeIndex % GRID_NODE_COUNT),
            ...buttonState,
          };
        })
      : [];
    const mirroredSelectedCharacters: MainWorkbenchSnapshot['selectedCharacters'] = selectedCharacters.map((character) => ({
      id: character.id,
      name: character.name,
      element: character.element,
      profession: character.profession,
      librarySource: character.librarySource,
    }));
    const mirroredSkillCatalog: NonNullable<MainWorkbenchSnapshot['skillCatalog']> = selectedCharacters.flatMap((character) => {
      const skills = buildSandboxSkillsFromRuntimeTemplate(character.id);
      return skills.map((skill) => ({
        characterId: character.id,
        characterName: character.name,
        skillId: skill.id,
        skillType: skill.buttonType,
        skillDisplayName: skill.displayName,
        source: skill.source,
      }));
    });
    const mirroredCandidateBuffs: NonNullable<MainWorkbenchSnapshot['candidateBuffs']> = getCandidateBuffList()
      .map((buff) => projectMainWorkbenchCandidateBuff(buff));
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
          skillLevels: configSnapshot.weapon.config.skillLevels,
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
        operatorSkillLevels: configSnapshot.operator.skillConfig,
      }];
    });
    if (isCheckoutBootstrapPendingRef.current || isCheckoutMutationPendingRef.current) return;
    if (!activeCheckoutRef || authoritativeCheckoutContentRevision === null) {
      void browserAgentRuntime.suspendWritableBinding().catch(() => undefined);
      return;
    }
    const previousSnapshot = readMainWorkbenchSnapshot();
    const nodeReview = activeCheckoutRef?.targetType === 'work-node'
      ? (nodeReviewRef.current?.bound
        && nodeReviewRef.current.report?.manifest.nodeId === activeCheckoutRef.targetId
        && nodeReviewRef.current.report.manifest.timelineId === activeTimelineId
        ? nodeReviewRef.current
        : null)
      : emptyAiTimelineNodeReviewProjection();
    if (activeCheckoutRef.targetType === 'work-node'
      && nodeReview?.report?.manifest.revision !== authoritativeCheckoutContentRevision) {
      void browserAgentRuntime.suspendWritableBinding().catch(() => undefined);
      return;
    }
    const currentSignature = buildMainWorkbenchSnapshotSignature(
      mirroredSelectedCharacters,
      mirroredButtons,
      mirroredOperatorConfigs,
      mirroredSkillCatalog,
      mirroredCandidateBuffs,
    );
    const previousSignature = previousSnapshot
      ? buildMainWorkbenchSnapshotSignature(
          previousSnapshot.selectedCharacters,
          previousSnapshot.skillButtons,
          previousSnapshot.operatorConfigs,
          previousSnapshot.skillCatalog,
          previousSnapshot.candidateBuffs,
        )
      : '';
    const previousDamageReportIsComplete = Boolean(
      previousSnapshot?.damageReport
      && typeof previousSnapshot.damageReport.totalDamage === 'number'
      && Array.isArray(previousSnapshot.damageReport.characters),
    );
    const canReusePreviousDamageReport = computedDamageReport !== null &&
      computedDamageReport.buttonCount === 0 &&
      mirroredButtons.length > 0 &&
      previousDamageReportIsComplete &&
      previousSnapshot?.damageReport &&
      previousSnapshot.damageReport.buttonCount === mirroredButtons.length &&
      previousSignature === currentSignature;
    const damageReport = damageReportDiagnostic
      ? undefined
      : canReusePreviousDamageReport && previousSnapshot?.damageReport
        ? previousSnapshot.damageReport
        : computedDamageReport ?? undefined;
    const snapshot = {
      schemaVersion: 1 as const,
      updatedAt: Date.now(),
      source: 'app' as const,
      timelineId: activeTimelineId,
      activeTimelineId,
      checkout: {
        targetType: activeCheckoutRef.targetType,
        targetId: activeCheckoutRef.targetId,
        contentRevision: authoritativeCheckoutContentRevision,
        updatedAt: activeCheckoutRef.updatedAt,
      },
      currentView,
      selectedCharacters: mirroredSelectedCharacters,
      skillCatalog: mirroredSkillCatalog,
      candidateBuffs: mirroredCandidateBuffs,
      skillButtons: mirroredButtons,
      damageReportStatus: damageReportDiagnostic
        ? 'formula-error' as const
        : damageReport?.buttonCount === mirroredButtons.length
          ? 'ready' as const
          : 'placeholder' as const,
      ...(damageReport ? { damageReport } : {}),
      ...(damageReportDiagnostic ? { damageReportDiagnostic } : {}),
      operatorConfigs: mirroredOperatorConfigs,
      nodeReview,
    };
    if (previousSnapshot
      && serializeWorkbenchSnapshotSemantics(previousSnapshot) === serializeWorkbenchSnapshotSemantics(snapshot)) {
      if (isAgentMode && !browserAgentRuntime.getBinding()) {
        void pushMainWorkbenchSnapshot(snapshot);
      }
      return;
    }
    writeMainWorkbenchSnapshot(snapshot);
    void pushMainWorkbenchSnapshot(snapshot);
  }, [activeCheckoutRef, activeTimelineId, authoritativeCheckoutContentRevision, candidateBuffRevision, checkoutBootstrapRevision, currentView, isAgentMode, nodeReviewRefreshRevision, projectionVisibilityRevision, selectedCharacters, skillButtons, timelineData, resistanceRevision]);

  useEffect(() => {
    if (isCheckoutBootstrapPendingRef.current || currentView !== 'canvas') return undefined;
    const timer = window.setTimeout(() => {
      const payload = getCurrentTimelineSnapshotPayload();
      if (payload) setSessionWorkingPayload(payload, 'runtime');
    }, 380);
    return () => window.clearTimeout(timer);
  }, [checkoutBootstrapRevision, currentView, resistanceRevision, selectedCharacters, setSessionWorkingPayload, skillButtons, timelineData]);

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

  const refreshTimelineArchiveLibrary = async () => {
    const repository = createTimelineRepositoryClient();
    try {
      const [localArchives, sharedArchives, workspaces] = await Promise.all([
        repository.listTimelineArchives('local'),
        repository.listTimelineArchives('shared'),
        repository.listSqliteWorkspaces(),
      ]);
      setLocalTimelineArchives(localArchives);
      setSharedTimelineArchives(sharedArchives);
      setSqliteTimelineWorkspaces(workspaces.sort((left, right) => (
        Number(right.document.id === activeTimelineId) - Number(left.document.id === activeTimelineId)
        || right.document.updatedAt - left.document.updatedAt
      )));
    } catch (error) {
      setLocalTimelineArchives([]);
      setSharedTimelineArchives([]);
      setSqliteTimelineWorkspaces([]);
      throw error;
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
    // Keep browser-era media untouched after importing it. The data-management
    // migration records and backup policy own its eventual retirement.
    return repository;
  };

  async function promoteTemporaryTimeline(): Promise<boolean> {
    if (!temporaryPromotionRef.current) return true;

    const label = await requestTimelineName();
    if (!label) return false;

    try {
      const document = await createTimelineRepositoryClient().ensureDocument({
        id: activeTimelineId,
        label,
        isTemporary: false,
      });
      temporaryPromotionRef.current = false;
      activateTimeline({
        document,
        checkoutRef: activeCheckoutRef,
        workingPayload: activeWorkingPayload,
      });
      return true;
    } catch (error) {
      alert(`SQLite 工作区转正失败：${formatTimelineOperationError(error)}`);
      return false;
    }
  }

  function requestTimelineName(): Promise<string | null> {
    if (timelineNameRequestRef.current) return timelineNameRequestRef.current;
    setTimelineNameDraft('');
    setTimelineNameError('');
    setIsTimelineNameModalOpen(true);
    const request = new Promise<string | null>((resolve) => {
      timelineNameResolverRef.current = (value) => {
        timelineNameResolverRef.current = null;
        timelineNameRequestRef.current = null;
        resolve(value);
      };
    });
    timelineNameRequestRef.current = request;
    return request;
  }

  function closeTimelineNameModal(): void {
    setIsTimelineNameModalOpen(false);
    setTimelineNameError('');
    timelineNameResolverRef.current?.(null);
  }

  function confirmTimelineName(): void {
    const label = timelineNameDraft.trim();
    if (!label) {
      setTimelineNameError('请输入工作区名称。');
      return;
    }
    setIsTimelineNameModalOpen(false);
    setTimelineNameError('');
    timelineNameResolverRef.current?.(label);
  }

  const handleSaveWorkNodeCheckpoint = async (): Promise<boolean> => {
    if (!await promoteTemporaryTimeline()) return false;
    setSelectedCharacterIds(selectedCharacters.map((character) => character.id));
    if (!activeCheckoutRef) {
      const currentPayload = getCurrentTimelineSnapshotPayload();
      if (!currentPayload) {
        alert('当前没有可保存到工作树的排轴数据');
        return false;
      }
      try {
        const visibleMirrors = buildVisibleTimelineMirrors(selectedCharacters, skillButtons, currentPayload);
        const canonicalPayload = { ...currentPayload, ...visibleMirrors };
        const validation = validateTimelinePayload(canonicalPayload);
        if (!validation.ok) {
          throw new Error(validation.issues.map((issue) => issue.message).join('；'));
        }
        setSkillButtonTable(visibleMirrors.skillButtonTable);
        saveTimelineRepo(visibleMirrors.timelineData);
        replaceTimelineData(visibleMirrors.timelineData);
      } catch (error) {
        alert(`工作节点保存失败：${error instanceof Error ? error.message : String(error)}`);
        return false;
      }
    } else {
      saveTimelineData();
    }
    const payload = getCurrentTimelineSnapshotPayload();
    if (!payload) {
      alert('当前没有可保存到工作树的排轴数据');
      return false;
    }

    try {
      const repository = createTimelineRepositoryClient();
      await ensureTimelineDocumentExists(repository, activeTimelineId, activeTimelineLabel);
      const [documentBundle, checkoutRef] = await Promise.all([
        repository.exportDocumentBundle(activeTimelineId),
        repository.getCheckoutRef(activeTimelineId),
      ]);
      const nodes = documentBundle.workNodes;
      const checkoutPayload = checkoutRef?.targetType === 'work-node'
        ? nodes.find((node) => node.id === checkoutRef.targetId)?.workingPayload
        : checkoutRef?.targetType === 'snapshot'
          ? documentBundle.snapshots.find((snapshot) => snapshot.id === checkoutRef.targetId)?.payload
          : undefined;
      if (nodes.length > 0 && checkoutPayload && !hasCheckpointPayloadChanged(checkoutPayload, payload)) {
        setWorkNodeSaveNotice('当前工作区没有新改动，未新增工作节点');
        window.setTimeout(() => setWorkNodeSaveNotice(''), 2200);
        return true;
      }
      const checkoutParent = checkoutRef?.targetType === 'work-node'
        ? nodes.find((node) => node.id === checkoutRef.targetId)
        : undefined;
      const baselineParent = [...nodes]
        .filter((node) => !node.parentNodeId)
        .sort((left, right) => left.createdAt - right.createdAt)[0];
      const latestParent = [...nodes].sort((left, right) => right.updatedAt - left.updatedAt)[0];
      const parent = checkoutParent || baselineParent || latestParent;
      const createdAt = Date.now();
      const created = await createAiTimelineWorkNodeClient().create({
        timelineId: activeTimelineId,
        ...(parent ? { parentNodeId: parent.id } : { parentNodeId: null }),
        branchId: `manual-save-${createdAt}`,
        label: parent
          ? `[save] ${new Date(createdAt).toLocaleString('zh-CN', { hour12: false })}`
          : `[save] ${activeTimelineLabel} ${new Date(createdAt).toLocaleString('zh-CN', { hour12: false })}`,
        basePayload: parent?.workingPayload || payload,
        workingPayload: payload,
        approvalPolicy: 'auto-low-risk',
        riskFlags: [],
      });
      const checkout = await checkoutAiTimelineWorkNodeFromCommand({
        op: 'checkoutAiTimelineWorkNode',
        nodeId: created.node.id,
        reload: false,
        approval: {
          mode: 'manual',
          approvedBy: 'user',
          rationale: 'Saved from the main workbench disk button.',
        },
      });
      if (!checkout.checkoutApplied) {
        throw new Error(checkout.checkoutMarkError || '工作节点已创建，但 checkout 持久化失败');
      }
      setWorkNodeRefreshKey((current) => current + 1);
      setWorkNodeSaveNotice(parent ? '已保存为当前工作树的子节点' : '已保存为当前工作树的首个节点');
      window.setTimeout(() => setWorkNodeSaveNotice(''), 2200);
      return true;
    } catch (error) {
      alert(`工作节点保存失败：${formatTimelineOperationError(error)}`);
      return false;
    }
  };

  const handleOpenSaveSnapshotModal = async () => {
    if (!await promoteTemporaryTimeline()) return;
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
    try {
      // SQLite is the only directly usable form. Save the current working
      // state into its worktree before exporting an archive copy.
      if (!await handleSaveWorkNodeCheckpoint()) {
        return;
      }
      const result = await createTimelineRepositoryClient().exportSqliteWorkspaceArchive({
        timelineId: activeTimelineId,
        kind: 'local',
        label: snapshotDraftName.trim() || activeTimelineLabel,
      });
      await refreshTimelineArchiveLibrary();
      handleCloseSaveSnapshotModal();
      setWorkNodeSaveNotice(`已导出本地存档：${result.archive.label}`);
      window.setTimeout(() => setWorkNodeSaveNotice(''), 2200);
    } catch (error) {
      alert(`导出本地存档失败：${formatTimelineOperationError(error)}`);
    }
  };

  const handleOpenSnapshotModal = () => {
    setRestorePanelTab('local');
    void refreshTimelineArchiveLibrary().catch((error) => {
      setWorkNodeSaveNotice(`读取数据管理库失败：${formatTimelineOperationError(error)}`);
      window.setTimeout(() => setWorkNodeSaveNotice(''), 2600);
    });
    setIsSnapshotModalOpen(true);
  };

  const handleCloseSnapshotModal = () => {
    setIsSnapshotModalOpen(false);
  };

  const handleConvertTimelineArchive = async (archive: TimelineArchiveSummary, payloadOnly = false) => {
    const repository = createTimelineRepositoryClient();
    const outcome = await runTimelineArchiveConversionForReload({
      convert: () => repository.convertTimelineArchive({
        source: archive.library,
        archiveId: archive.archiveId,
        payloadOnly,
        updatedAt: Date.now(),
      }),
      activate: (converted) => {
        activateTimeline({
          document: converted.document as TimelineDocument,
          checkoutRef: converted.checkoutRef,
          workingPayload: converted.payload,
        });
      },
      // 转换接口已经把 checkout 的完整工作副本写入 user.sqlite。
      // 与“应用 SQLite 工作区”保持同一路径，让 AppContext 在新页面里
      // 根据新选中干员重建可信技能目录，避免旧运行时目录误拒绝有效技能。
      reload: () => window.location.reload(),
    });
    if (outcome.status === 'reloading') {
      return;
    }
    if (outcome.status === 'conversion-failed') {
      alert(`存档转换 SQLite 失败：${formatTimelineOperationError(outcome.error)}`);
      return;
    }

    // SQLite 已经创建成功；若活动工作区切换异常，仍刷新列表并明确
    // 告知用户数据已落盘，不能再误报成“转换失败”。
    try {
      await refreshTimelineArchiveLibrary();
      setRestorePanelTab('sqlite');
    } catch {
      // 下面的主错误已经足够指导用户刷新后从 SQLite 列表继续应用。
    }
    alert(`SQLite 工作区已创建，但自动应用失败：${formatTimelineOperationError(outcome.error)}。请刷新后从 SQLite 标签页继续应用。`);
  };

  const handleApplySqliteWorkspace = async (workspace: TimelineSqliteWorkspace) => {
    try {
      const repository = createTimelineRepositoryClient();
      const applied = await repository.applySqliteWorkspace(workspace.document.id, Date.now());
      activateTimeline({ document: applied.document as TimelineDocument, checkoutRef: applied.checkoutRef, workingPayload: applied.payload });
      // 应用接口已将完整工作副本写入 user.sqlite；直接刷新可让 AppContext、
      // Canvas 与技能按钮从同一份持久化数据重新初始化。
      window.location.reload();
    } catch (error) {
      alert(`应用 SQLite 工作区失败：${formatTimelineOperationError(error)}`);
    }
  };

  const handleExportSqliteWorkspace = async (workspace: TimelineSqliteWorkspace, kind: 'local' | 'shared') => {
    try {
      // 非当前工作区的 checkout 已是其权威状态；当前工作区则可能还有
      // 尚未写入节点树的编辑，导出前必须先建立 checkpoint。
      if (workspace.document.id === activeTimelineId && !await handleSaveWorkNodeCheckpoint()) {
        return;
      }
      const result = await createTimelineRepositoryClient().exportSqliteWorkspaceArchive({
        timelineId: workspace.document.id,
        kind,
      });
      await refreshTimelineArchiveLibrary();
      setWorkNodeSaveNotice(kind === 'shared'
        ? `已预存到共享存档：${result.archive.label}`
        : `已导出本地存档：${result.archive.label}`);
      window.setTimeout(() => setWorkNodeSaveNotice(''), 2400);
    } catch (error) {
      alert(`导出存档失败：${formatTimelineOperationError(error)}`);
    }
  };

  const handleTransferTimelineArchive = async (archive: TimelineArchiveSummary, to: 'local' | 'shared') => {
    const targetLabel = to === 'local' ? '本地存档' : '共享存档';
    const confirmed = window.confirm(`将“${archive.label}”转换为${targetLabel}？转换后会从原存档库移除。`);
    if (!confirmed) return;
    try {
      await createTimelineRepositoryClient().transferTimelineArchive({
        from: archive.library,
        to,
        archiveId: archive.archiveId,
      });
      await refreshTimelineArchiveLibrary();
      setWorkNodeSaveNotice(`已转换为${targetLabel}：${archive.label}`);
      window.setTimeout(() => setWorkNodeSaveNotice(''), 2200);
    } catch (error) {
      alert(`存档转换失败：${formatTimelineOperationError(error)}`);
    }
  };

  const handleDeleteTimelineArchive = async (archive: TimelineArchiveSummary) => {
    const libraryLabel = archive.library === 'shared' ? '共享存档' : '本地存档';
    const confirmed = window.confirm(`删除${libraryLabel}“${archive.label}”？此操作不会影响 SQLite 工作区，也不能撤销。`);
    if (!confirmed) return;
    try {
      await createTimelineRepositoryClient().deleteTimelineArchive({ library: archive.library, archiveId: archive.archiveId });
      await refreshTimelineArchiveLibrary();
      setWorkNodeSaveNotice(`已删除${libraryLabel}：${archive.label}`);
      window.setTimeout(() => setWorkNodeSaveNotice(''), 2200);
    } catch (error) {
      alert(`删除存档失败：${formatTimelineOperationError(error)}`);
    }
  };

  const handleDeleteSqliteWorkspace = async (workspace: TimelineSqliteWorkspace) => {
    if (workspace.document.id === activeTimelineId) {
      alert('当前正在应用此 SQLite 工作区。请先应用另一工作区，再删除它。');
      return;
    }
    const confirmed = window.confirm(`删除 SQLite 工作区“${workspace.document.label}”？其节点、恢复点和审计记录会一并删除；本地/共享存档不会受影响。`);
    if (!confirmed) return;
    try {
      await createTimelineRepositoryClient().deleteSqliteWorkspace(workspace.document.id);
      await refreshTimelineArchiveLibrary();
      setWorkNodeRefreshKey((current) => current + 1);
      setWorkNodeSaveNotice(`已删除 SQLite 工作区：${workspace.document.label}`);
      window.setTimeout(() => setWorkNodeSaveNotice(''), 2200);
    } catch (error) {
      alert(`删除 SQLite 工作区失败：${formatTimelineOperationError(error)}`);
    }
  };

  const handleOpenShareModal = () => {
    // New exports are TimelineArchive files. The old browser JSON share flow
    // stays as a hidden compatibility reader only; it must not become a new
    // direct-apply path around SQLite.
    setRestorePanelTab('sqlite');
    setShareWorkNodes([]);
    void refreshTimelineArchiveLibrary().catch((error) => {
      setWorkNodeSaveNotice(`读取 SQLite 工作区失败：${formatTimelineOperationError(error)}`);
      window.setTimeout(() => setWorkNodeSaveNotice(''), 2600);
    });
    setIsSnapshotModalOpen(true);
  };

  const handleCloseShareModal = () => {
    setIsShareModalOpen(false);
    setPendingImportShare(null);
    setPendingImportBundle(null);
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
      const exported = await createTimelineRepositoryClient().exportDocumentBundle(activeTimelineId);
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
        ? exported.workNodes
          .filter((node) => branchNodeIds.has(node.id))
          .map((node) => node.id === shareBranchRootId ? { ...node, parentNodeId: undefined } : node)
          : [];
      const includedNodeIds = new Set(workNodes.map((node) => node.id));
      const commits = shareScope === 'snapshot'
        ? []
        : exported.commits.filter((commit) => includedNodeIds.has(commit.nodeId));
      const bundledSnapshots = shareScope === 'document' && snapshots.length ? snapshots : [snapshot];
      const checkoutRef = shareScope === 'snapshot'
        ? { targetType: 'snapshot' as const, targetId: snapshot.id, updatedAt: snapshot.createdAt }
        : exported.checkoutRef && (
          exported.checkoutRef.targetType === 'snapshot'
            ? (shareScope === 'document' && snapshots.some((entry) => entry.id === exported.checkoutRef!.targetId))
            : includedNodeIds.has(exported.checkoutRef.targetId)
        )
          ? { targetType: exported.checkoutRef.targetType, targetId: exported.checkoutRef.targetId, updatedAt: exported.checkoutRef.updatedAt }
          : workNodes[0]
            ? { targetType: 'work-node' as const, targetId: workNodes[0].id, updatedAt: workNodes[0].updatedAt }
            : { targetType: 'snapshot' as const, targetId: bundledSnapshots[0].id, updatedAt: bundledSnapshots[0].createdAt };
      shareFile = await buildTimelineBundleV2({
        timelineId: activeTimelineId,
        label: shareDraftName,
        snapshot,
        snapshots: bundledSnapshots,
        ...(workNodes.length ? { workNodes } : {}),
        ...(commits.length ? { commits } : {}),
        checkoutRef,
        scope: shareScope,
      });
    } catch {
      if (shareScope !== 'snapshot') {
        alert('当前无法读取排轴文档，不能导出 AI 分支或完整文档。');
        return;
      }
      shareFile = await buildTimelineBundleV2({ timelineId: activeTimelineId, label: shareDraftName, snapshot });
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
  };

  const handleConfirmImportShare = async () => {
    if (!pendingImportShare) {
      return;
    }

    const importedAt = Date.now();
    const bundle = pendingImportBundle || {
      type: 'dmg.timeline-bundle.v2' as const,
      schemaVersion: 2 as const,
      manifest: {
        exportedAt: pendingImportShare.exportedAt,
        scope: 'snapshot' as const,
        timelineId: `legacy-share-${importedAt}`,
        label: pendingImportShare.label,
        payloadHash: 'legacy-timeline-share',
      },
      document: { id: `legacy-share-${importedAt}`, label: pendingImportShare.label },
      payloads: [pendingImportShare.payload],
      snapshots: [{ id: `legacy-share-snapshot-${importedAt}`, label: pendingImportShare.label, createdAt: pendingImportShare.exportedAt, payloadIndex: 0 }],
    };
    try {
      const imported = await createTimelineRepositoryClient().importLegacyTimelineBundle({ bundle, sourceName: `${pendingImportShare.label}.json` });
      setPendingImportShare(null);
      setPendingImportBundle(null);
      setIsShareModalOpen(false);
      setWorkNodeSaveNotice(`已归档为本地存档：${imported.archive.label}；请在恢复 → 存档库中转换为 SQLite`);
      window.setTimeout(() => setWorkNodeSaveNotice(''), 3200);
    } catch (error) {
      alert(`导入存档失败：${formatTimelineOperationError(error)}`);
    }
  };

  const handleOpenDamageReport = () => {
    navigateToAppPath(APP_ROUTE_PATHS.damageReportPpt);
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
      await refreshCandidateBuffsForCharacters(
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

  const handleToggleAgentMode = async () => {
    if (isAgentModeLaunching) return;
    setIsAgentModeLaunching(true);
    setWorkNodeSaveNotice(isAgentMode ? '正在退出 AI 模式…' : '正在启动 AI 模式…');
    try {
      if (isAgentMode) {
        browserAgentRuntime.cancelCommandPull();
        await exitDesktopAgentModeToWorkbench();
      }
      else await enterDesktopAgentModeFromWorkbench();
      setWorkNodeSaveNotice('');
    } catch (error) {
      setWorkNodeSaveNotice(error instanceof Error ? error.message : String(error));
      window.setTimeout(() => setWorkNodeSaveNotice(''), 4_200);
    } finally {
      setIsAgentModeLaunching(false);
    }
  };

  const canvasBoardClassName = [
    'canvas-board',
    isWorkbenchTopZoneOpen ? 'has-top-zone' : '',
    isAgentMode ? 'is-ai-mode' : '',
    isAgentMode && aiHoverZone === 'left' ? 'is-ai-hover-left' : '',
    isAgentMode && aiHoverZone === 'right' ? 'is-ai-hover-right' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const rightWorkbenchContent = (
    <SkillSandbox
      key={`checkout-${checkoutRenderRevision}`}
      selectedCharacters={selectedCharacters}
      onDragStart={handleSandboxDragStart}
      onAvatarDoubleClick={handleAvatarDoubleClick}
      onSave={handleSaveWorkNodeCheckpoint}
      onOpenResistance={handleOpenBatchResistanceModal}
      onRefreshAvailableCandidates={handleRefreshAvailableCandidates}
      isRefreshingAvailableCandidates={isRefreshingAvailableCandidates}
      isBrowseMode={isBrowseMode}
      onToggleBrowseMode={() => setIsBrowseMode((prev) => !prev)}
      isInspectMode={isInspectMode}
      onInspectStart={() => setIsInspectMode(true)}
      onInspectEnd={() => setIsInspectMode(false)}
      isAiMode={isAgentMode}
      showAiMode={isAgentMode || isDesktopWebHost()}
      onToggleAiMode={() => void handleToggleAgentMode()}
      onOpenWorkNodePanel={openWorkNodePanel}
    />
  );
  const renderedAgentModePanel = typeof agentModePanel === 'function'
    ? agentModePanel({ onOpenWorkNodePanel: openWorkNodePanel })
    : agentModePanel;

  return (
    <div className={canvasBoardClassName}>
      {workNodeSaveNotice && <div className="canvas-work-node-save-notice" role="status">{workNodeSaveNotice}</div>}
      <div className="canvas-layout">
        <div className="canvas-background-layer">
          <div className="skew-panel" />
          <div className="skew-panel-bottom" />
        </div>

        <div className="canvas-left-zone">
          <CanvasArea
            key={`checkout-${checkoutRenderRevision}`}
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
            contextMenuState={contextMenuState}
            onConfirmRemove={handleConfirmRemoveSkillButton}
            onCloseContextMenu={handleCloseButtonContextMenu}
            onCopy={handleCopySkillButton}
            onChangeSkillType={handleChangeSkillType}
            getSkillChangeOptions={getSkillChangeOptions}
            isDraggingActive={Boolean(draggingState)}
            isBrowseMode={isBrowseMode}
            isInspectMode={isInspectMode}
            isDragDisabled={isAgentMode}
            resistanceRevision={resistanceRevision}
          />
        </div>

        {isAgentMode ? (
          <>
            <aside className="canvas-right-zone is-ai-real-right is-skill-sandbox">
              {rightWorkbenchContent}
            </aside>
            <aside className="canvas-right-zone is-ai-panel">
              {renderedAgentModePanel}
            </aside>
          </>
        ) : (
          <aside className="canvas-right-zone is-skill-sandbox">
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
              <div className="work-node-modal-actions">
                <h3>Work Node 节点树 · {activeTimelineLabel}</h3>
                <p>查看 AI 与人工 checkpoint 的节点、差异、风险和 checkout / restore 证据。</p>
              </div>
              <div>
                <button type="button" className="modal-close-btn" onClick={() => setWorkNodeCameraResetKey((current) => current + 1)}>
                  归正
                </button>
                <button type="button" className="modal-close-btn" onClick={closeWorkNodePanel}>
                  关闭
                </button>
              </div>
            </div>
            <WorkNodeTreePanel
              timelineId={activeTimelineId}
              refreshKey={workNodeRefreshKey}
              cameraResetKey={workNodeCameraResetKey}
              onSelectedNodeChange={handleWorkNodeSelection}
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

      {isSnapshotModalOpen && (
        <div className="timeline-snapshot-modal-overlay" onClick={handleCloseSnapshotModal}>
          <div className="timeline-snapshot-modal" onClick={(event) => event.stopPropagation()}>
            <div className="timeline-snapshot-modal-head">
              <div>
                <h3>恢复排轴</h3>
                <p>存档不是可直接应用的状态：先转换为 SQLite 工作区；只有 SQLite 工作区可以直接应用。节点树仅显示数量。</p>
              </div>
              <button type="button" className="modal-close-btn" onClick={handleCloseSnapshotModal}>
                关闭
              </button>
            </div>

            <div className="timeline-restore-tabs" role="tablist" aria-label="恢复来源">
              {([
                ['local', '本地存档'],
                ['shared', '共享存档'],
                ['sqlite', 'SQLite'],
              ] as const).map(([tab, label]) => (
                <button
                  key={tab}
                  type="button"
                  role="tab"
                  aria-selected={restorePanelTab === tab}
                  className={restorePanelTab === tab ? 'is-active' : ''}
                  onClick={() => setRestorePanelTab(tab)}
                >
                  {label}
                </button>
              ))}
            </div>

            {activeTimelineArchiveLibrary && (
              <div className="timeline-snapshot-list timeline-document-list">
                <div className="timeline-snapshot-empty">{activeTimelineArchiveLibrary.title}</div>
                {activeTimelineArchiveLibrary.archives.length === 0 ? (
                  <div className="timeline-snapshot-empty">暂无{activeTimelineArchiveLibrary.emptyLabel}存档。</div>
                ) : activeTimelineArchiveLibrary.archives.map((archive) => (
                  <div key={`${activeTimelineArchiveLibrary.library}-${archive.archiveId}`} className="timeline-snapshot-item timeline-document-item">
                    <div className="timeline-snapshot-item-main">
                      <strong>{archive.label}</strong>
                      <span>{archive.summary.characterCount} 干员 / {archive.summary.buttonCount} 按钮 / {archive.summary.buffCount} Buff</span>
                      <span>{archive.nodeCount} 个节点{archive.hasCurrentNode ? ' / 含当前节点定位' : ''}{archive.releaseId ? ` / 发布 ${archive.releaseId}` : ''}</span>
                      {archive.worktreeDiagnostic && <span>节点树兼容问题：{archive.worktreeDiagnostic.message}</span>}
                      {archive.invalid && <span>存档无效：{archive.invalid.message}</span>}
                    </div>
                    <div className="timeline-snapshot-item-actions">
                      <button
                        type="button"
                        className="btn-save"
                        disabled={Boolean(archive.invalid)}
                        onClick={() => void handleConvertTimelineArchive(archive)}
                      >
                        转换为 SQLite
                      </button>
                      {archive.worktreeDiagnostic && (
                        <button type="button" className="btn-calculate" onClick={() => void handleConvertTimelineArchive(archive, true)}>
                          仅导入内容
                        </button>
                      )}
                      {archive.library === 'local' && (
                        <button type="button" className="btn-calculate" disabled={Boolean(archive.invalid)} onClick={() => void handleTransferTimelineArchive(archive, 'shared')}>
                          转为共享
                        </button>
                      )}
                      {archive.library === 'shared' && (
                        <button type="button" className="btn-calculate" disabled={Boolean(archive.invalid)} onClick={() => void handleTransferTimelineArchive(archive, 'local')}>
                          转为本地
                        </button>
                      )}
                      <button type="button" className="btn-calculate" onClick={() => void handleDeleteTimelineArchive(archive)}>
                        删除
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {restorePanelTab === 'sqlite' && (sqliteTimelineWorkspaces.length === 0 ? (
              <div className="timeline-snapshot-empty">
                SQLite 中还没有可直接应用的工作区。请先从存档库转换，或继续编辑当前工作区。
              </div>
            ) : (
              <div className="timeline-snapshot-list timeline-document-list">
                {sqliteTimelineWorkspaces.map((workspace) => (
                  <div
                    key={workspace.document.id}
                    className={`timeline-snapshot-item timeline-document-item${workspace.document.id === activeTimelineId ? ' is-active' : ''}`}
                  >
                    <div className="timeline-snapshot-item-main">
                      <strong>{workspace.document.label}{workspace.document.isTemporary ? '（临时）' : ''}</strong>
                      <span>
                        {workspace.summary.characterCount} 干员 / {workspace.summary.buttonCount} 按钮 / {workspace.summary.buffCount} Buff
                      </span>
                      <span>
                        {workspace.nodeCount} 个节点
                        {workspace.document.id === activeTimelineId ? ' / 当前应用' : ''}
                      </span>
                      {workspace.invalid && <span>工作区异常：{workspace.invalid.message}</span>}
                    </div>
                    <div className="timeline-snapshot-item-actions">
                      <button
                        type="button"
                        className="btn-save"
                        disabled={Boolean(workspace.invalid)}
                        onClick={() => void handleApplySqliteWorkspace(workspace)}
                      >
                        应用
                      </button>
                      <button
                        type="button"
                        className="btn-calculate"
                        disabled={Boolean(workspace.invalid)}
                        onClick={() => void handleExportSqliteWorkspace(workspace, 'local')}
                      >
                        导出本地存档
                      </button>
                      <button
                        type="button"
                        className="btn-calculate"
                        disabled={Boolean(workspace.invalid)}
                        onClick={() => void handleExportSqliteWorkspace(workspace, 'shared')}
                      >
                        预存到共享存档
                      </button>
                      <button
                        type="button"
                        className="btn-calculate"
                        disabled={workspace.document.id === activeTimelineId}
                        title={workspace.document.id === activeTimelineId ? '请先应用另一工作区，再删除当前工作区。' : undefined}
                        onClick={() => void handleDeleteSqliteWorkspace(workspace)}
                      >
                        删除
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      {isTimelineNameModalOpen && (
        <div className="timeline-snapshot-modal-overlay" onClick={closeTimelineNameModal}>
          <form
            className="timeline-snapshot-modal timeline-snapshot-save-modal"
            onClick={(event) => event.stopPropagation()}
            onSubmit={(event) => {
              event.preventDefault();
              confirmTimelineName();
            }}
          >
            <div className="timeline-snapshot-modal-head">
              <div>
                <h3>命名当前工作区</h3>
                <p>这是首次保存。名称会用于开始页、存档和工作节点记录。</p>
              </div>
              <button type="button" className="modal-close-btn" onClick={closeTimelineNameModal}>
                关闭
              </button>
            </div>

            <label className="timeline-snapshot-form-label" htmlFor="timeline-workspace-name">
              工作区名称
            </label>
            <input
              id="timeline-workspace-name"
              className="timeline-snapshot-name-input"
              type="text"
              value={timelineNameDraft}
              onChange={(event) => {
                setTimelineNameDraft(event.target.value);
                if (timelineNameError) setTimelineNameError('');
              }}
              placeholder="例如：别礼主力排轴"
              maxLength={60}
              autoFocus
            />
            {timelineNameError && <p className="form-error" role="alert">{timelineNameError}</p>}

            <div className="timeline-snapshot-form-actions">
              <button type="button" className="btn-calculate" onClick={closeTimelineNameModal}>
                取消
              </button>
              <button type="submit" className="btn-save">
                保存并继续
              </button>
            </div>
          </form>
        </div>
      )}

      {isSaveSnapshotModalOpen && (
        <div className="timeline-snapshot-modal-overlay" onClick={handleCloseSaveSnapshotModal}>
          <div className="timeline-snapshot-modal timeline-snapshot-save-modal" onClick={(event) => event.stopPropagation()}>
            <div className="timeline-snapshot-modal-head">
              <div>
                <h3>导出本地存档</h3>
                <p>先保存当前工作节点，再从 SQLite 工作区导出本地存档。</p>
              </div>
              <button type="button" className="modal-close-btn" onClick={handleCloseSaveSnapshotModal}>
                关闭
              </button>
            </div>

            <label className="timeline-snapshot-form-label" htmlFor="timeline-snapshot-name">
              存档名称
            </label>
            <input
              id="timeline-snapshot-name"
              className="timeline-snapshot-name-input"
              type="text"
              value={snapshotDraftName}
              onChange={(event) => setSnapshotDraftName(event.target.value)}
              placeholder="留空则使用当前工作区名称"
              maxLength={60}
            />

            <div className="timeline-snapshot-form-actions">
              <button type="button" className="btn-calculate" onClick={handleCloseSaveSnapshotModal}>
                取消
              </button>
              <button type="button" className="btn-save" onClick={handleSaveTimelineSnapshot}>
                导出本地存档
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
                  {shareWorkNodes.map((node) => (
                    <option key={node.id} value={node.id}>{node.parentNodeId ? `↳ ${node.label}` : node.label}</option>
                  ))}
                </select>
              </>
            )}

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
