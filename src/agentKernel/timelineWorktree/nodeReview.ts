import type { TimelineCheckoutRef } from '../../core/domain/timeline';
import type { TimelineSnapshotPayload } from '../../utils/timelineSnapshotStorage';
import { buildAiTimelineCheckoutDecision } from './checkoutDecision.mjs';
import { diffTimelinePayloads } from './diff';
import type {
  AiTimelineCheckoutDecision,
  AiTimelineRiskFlag,
  AiTimelineValidationIssue,
  AiTimelineWorkNode,
  TimelinePayloadDiff,
} from './types';
import { validateTimelinePayload } from './validator';

export const AI_TIMELINE_NODE_SOURCE_FILES = [
  'selection.json',
  'timeline.json',
  'buffs.json',
  'inputs.json',
] as const;

export type AiTimelineNodeSourceFile = typeof AI_TIMELINE_NODE_SOURCE_FILES[number];

export type AiTimelineNodeSource = {
  schemaVersion: 1;
  selection: { selectedCharacters: string[] };
  timeline: {
    schemaVersion: 1;
    version: string;
    createdAt: number;
    staffLines: unknown[];
  };
  buffs: { allBuffList: unknown[] };
  inputs: {
    characterInputMap: Record<string, unknown>;
    operatorConfigPageCache: Record<string, unknown>;
  };
};

export type AiTimelineNodeReviewDiff = {
  file: `node/working/${AiTimelineNodeSourceFile}`;
  before: string;
  after: string;
  additions: number;
  deletions: number;
};

export type AiTimelineNodeReviewManifest = {
  schemaVersion: 1;
  nodeId: string;
  parentNodeId: string | null;
  timelineId: string;
  branchId: string;
  revision: number;
  status: AiTimelineWorkNode['status'];
  approvalPolicy: AiTimelineWorkNode['approvalPolicy'];
  label: string;
  description: string;
  createdAt: number;
  updatedAt: number;
  baseSummary: AiTimelineWorkNode['baseSummary'];
  workingSummary: AiTimelineWorkNode['workingSummary'];
};

export type AiTimelineNodeReviewSemanticChange = {
  kind: 'selection' | 'button' | 'buff' | 'input';
  id: string;
  change: 'added' | 'removed' | 'changed';
  before?: unknown;
  after?: unknown;
};

export type AiTimelineNodeReviewSemanticDiff = TimelinePayloadDiff & {
  changes: AiTimelineNodeReviewSemanticChange[];
};

export type AiTimelineNodeReviewReport = {
  manifest: AiTimelineNodeReviewManifest;
  validation: {
    valid: boolean;
    ok: boolean;
    issues: AiTimelineValidationIssue[];
  };
  semanticDiff: AiTimelineNodeReviewSemanticDiff;
  risk: {
    riskFlags: AiTimelineRiskFlag[];
    checkoutDecision: AiTimelineCheckoutDecision;
  };
};

/**
 * Browser-side equivalent of the old Native UI node review response.
 *
 * The projection deliberately contains only Work Node data and derived JSON;
 * it never reads the retired Node DB or a materialized filesystem workspace.
 */
export type AiTimelineNodeReviewProjection = {
  bound: boolean;
  diffs: AiTimelineNodeReviewDiff[];
  report: AiTimelineNodeReviewReport | null;
};

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function jsonText(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function countChangedLines(before: string, after: string): Pick<AiTimelineNodeReviewDiff, 'additions' | 'deletions'> {
  const left = before.split('\n');
  const right = after.split('\n');
  const shared = Math.min(left.length, right.length);
  let changed = 0;
  for (let index = 0; index < shared; index += 1) {
    if (left[index] !== right[index]) changed += 1;
  }
  return {
    additions: changed + Math.max(0, right.length - left.length),
    deletions: changed + Math.max(0, left.length - right.length),
  };
}

function sourceButtonTable(payload: TimelineSnapshotPayload): Record<string, Record<string, unknown>> {
  return payload.skillButtonTable && typeof payload.skillButtonTable === 'object'
    ? payload.skillButtonTable as unknown as Record<string, Record<string, unknown>>
    : {};
}

/** Convert the canonical browser payload to the four JSON sources used by the old Native UI. */
export function buildAiTimelineNodeSource(payload: TimelineSnapshotPayload): AiTimelineNodeSource {
  const table = sourceButtonTable(payload);
  const timelineData = payload.timelineData || { version: '1.0', createdAt: 0, staffLines: [] };
  const staffLines = (Array.isArray(timelineData.staffLines) ? timelineData.staffLines : []).map((line) => ({
    staffIndex: line.staffIndex,
    characterName: line.characterName,
    buttons: (Array.isArray(line.buttons) ? line.buttons : [])
      .map((button) => table[button.id] || button)
      .map((button) => clone(button))
      .sort((left, right) => Number(left.nodeIndex ?? 0) - Number(right.nodeIndex ?? 0)),
  }));

  return {
    schemaVersion: 1,
    selection: { selectedCharacters: clone(payload.selectedCharacters || []) },
    timeline: {
      schemaVersion: 1,
      version: timelineData.version || '1.0',
      createdAt: timelineData.createdAt || 0,
      staffLines,
    },
    buffs: { allBuffList: clone(payload.allBuffList || []) },
    inputs: {
      characterInputMap: clone(payload.characterInputMap || {}),
      operatorConfigPageCache: clone(payload.operatorConfigPageCache || {}),
    },
  };
}

function sourceFileValue(source: AiTimelineNodeSource, file: AiTimelineNodeSourceFile): unknown {
  if (file === 'selection.json') return source.selection;
  if (file === 'timeline.json') return source.timeline;
  if (file === 'buffs.json') return source.buffs;
  return source.inputs;
}

export function buildAiTimelineNodeReviewDiffs(
  basePayload: TimelineSnapshotPayload,
  workingPayload: TimelineSnapshotPayload,
): AiTimelineNodeReviewDiff[] {
  const base = buildAiTimelineNodeSource(basePayload);
  const working = buildAiTimelineNodeSource(workingPayload);
  return AI_TIMELINE_NODE_SOURCE_FILES.flatMap((file) => {
    const before = jsonText(sourceFileValue(base, file));
    const after = jsonText(sourceFileValue(working, file));
    if (before === after) return [];
    return [{
      file: `node/working/${file}` as `node/working/${AiTimelineNodeSourceFile}`,
      before,
      after,
      ...countChangedLines(before, after),
    }];
  });
}

function buildSemanticChanges(diff: TimelinePayloadDiff): AiTimelineNodeReviewSemanticChange[] {
  const changes: AiTimelineNodeReviewSemanticChange[] = [];
  if (diff.selectedCharactersChanged) {
    changes.push({
      kind: 'selection',
      id: 'selectedCharacters',
      change: 'changed',
      before: diff.beforeSelectedCharacters,
      after: diff.afterSelectedCharacters,
    });
  }
  changes.push(
    ...diff.addedButtons.map((button) => ({ kind: 'button' as const, id: button.id, change: 'added' as const, after: button })),
    ...diff.removedButtons.map((button) => ({ kind: 'button' as const, id: button.id, change: 'removed' as const, before: button })),
    ...diff.changedButtons.map((button) => ({ kind: 'button' as const, id: button.id, change: 'changed' as const, before: button.before, after: button.after })),
    ...diff.addedBuffs.map((buff) => ({ kind: 'buff' as const, id: buff.id, change: 'added' as const, after: buff })),
    ...diff.removedBuffs.map((buff) => ({ kind: 'buff' as const, id: buff.id, change: 'removed' as const, before: buff })),
    ...diff.changedCharacterInputs.map((input) => ({ kind: 'input' as const, id: input.characterId, change: 'changed' as const, before: input.before, after: input.after })),
  );
  return changes;
}

function buildManifest(node: AiTimelineWorkNode): AiTimelineNodeReviewManifest {
  return {
    schemaVersion: 1,
    nodeId: node.id,
    parentNodeId: node.parentNodeId || null,
    timelineId: node.timelineId,
    branchId: node.branchId,
    revision: Number(node.contentRevision || node.updatedAt),
    status: node.status,
    approvalPolicy: node.approvalPolicy,
    label: node.label,
    description: node.description,
    createdAt: node.createdAt,
    updatedAt: node.updatedAt,
    baseSummary: node.baseSummary,
    workingSummary: node.workingSummary,
  };
}

export function emptyAiTimelineNodeReviewProjection(): AiTimelineNodeReviewProjection {
  return { bound: false, diffs: [], report: null };
}

export function buildAiTimelineNodeReviewProjection(
  node: AiTimelineWorkNode,
  checkout: Pick<TimelineCheckoutRef, 'timelineId' | 'targetType' | 'targetId'> | null,
): AiTimelineNodeReviewProjection {
  const diff = diffTimelinePayloads(node.basePayload, node.workingPayload);
  const validation = validateTimelinePayload(node.workingPayload);
  const checkoutDecision = buildAiTimelineCheckoutDecision({
    approvalPolicy: node.approvalPolicy,
    riskFlags: node.riskFlags,
    diff,
  }) as AiTimelineCheckoutDecision;
  const semanticDiff: AiTimelineNodeReviewSemanticDiff = {
    ...diff,
    changes: buildSemanticChanges(diff),
  };
  return {
    bound: checkout?.targetType === 'work-node'
      && checkout.timelineId === node.timelineId
      && checkout.targetId === node.id,
    diffs: buildAiTimelineNodeReviewDiffs(node.basePayload, node.workingPayload),
    report: {
      manifest: buildManifest(node),
      validation: {
        valid: validation.ok,
        ok: validation.ok,
        issues: validation.issues,
      },
      semanticDiff,
      risk: {
        riskFlags: clone(node.riskFlags),
        checkoutDecision,
      },
    },
  };
}
