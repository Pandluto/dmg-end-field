import type { TimelineCheckoutRef } from '../../core/domain/timeline';
import type { TimelineSnapshotPayload } from '../../utils/timelineSnapshotStorage';
import { digestJson } from './operatorConfigProposal';

export type WorkNodePayloadPostcondition = {
  pass: boolean;
  expected: {
    payloadDigest: string;
    timelineDigest: string;
    buttonDigest: string;
    buffDigest: string;
    resistanceDigest: string;
    operatorConfigDigest: string;
    visibleButtonIds: string[];
    checkout?: Pick<TimelineCheckoutRef, 'targetType' | 'targetId'>;
    nodeRevision?: number;
  };
  observed: {
    payloadDigest: string | null;
    timelineDigest: string | null;
    buttonDigest: string | null;
    buffDigest: string | null;
    resistanceDigest: string | null;
    operatorConfigDigest: string | null;
    visibleButtonIds: string[];
    checkout: Pick<TimelineCheckoutRef, 'targetType' | 'targetId'> | null;
    nodeRevision: number | null;
  };
  failures: string[];
};

export type WorkNodeRestoreVerification = {
  pass: boolean;
  reason?: string;
  observed?: unknown;
};

export type ReviewedWorkNodeIdentity = {
  nodeId: string;
  timelineId: string;
  nodeRevision: number;
  workingPayloadDigest: string;
  diffDigest: string;
};

export type ReviewedWorkNodeDeletionIdentity = {
  nodeId: string;
  timelineId: string;
  nodeRevision: number;
  subtreeNodeCount: number;
  subtreeNodeIds: string[];
  subtreeDigest: string;
};

export type ReviewedWorkNodeDeletionEntry = {
  id: string;
  timelineId: string;
  parentNodeId?: string | null;
  branchId?: string;
  label?: string;
  description?: string;
  status?: string;
  approvalPolicy?: string;
  contentRevision?: number;
  updatedAt?: number;
  riskFlags?: unknown;
};

export class WorkNodeAtomicRestoreError extends Error {
  readonly code = 'AI_WORKNODE_ATOMIC_RESTORE_FAILED';
  readonly primaryError: Error;
  readonly rollbackError: Error | null;

  constructor(primaryError: unknown, rollbackError: unknown = null) {
    const primary = asError(primaryError);
    const rollback = rollbackError === null ? null : asError(rollbackError);
    super(
      `${primary.message}${rollback
        ? `；恢复原状态失败：${rollback.message}`
        : '；已恢复原页面与 checkout。'}`,
    );
    this.name = 'WorkNodeAtomicRestoreError';
    this.primaryError = primary;
    this.rollbackError = rollback;
  }
}

type AtomicRestoreInput = {
  applyTarget: () => Promise<void>;
  verifyVisibleTarget: () => Promise<WorkNodeRestoreVerification>;
  persistCheckout: () => Promise<void>;
  persistRollbackLedger: () => Promise<{ rollbackApplied: boolean }>;
  verifyPersistedTarget: () => Promise<WorkNodeRestoreVerification>;
  restorePreviousState: () => Promise<void>;
  verifyPreviousState: () => Promise<WorkNodeRestoreVerification>;
};

/**
 * Runs the browser-side base restore transaction.  The callbacks are the only
 * effectful boundary: the order and failure contract stay testable without
 * rendering React or opening SQLite in a Node test.
 */
export async function runAtomicWorkNodeRestore(input: AtomicRestoreInput): Promise<void> {
  try {
    await input.applyTarget();
    await requirePassed(input.verifyVisibleTarget(), '目标 base payload 的可见状态校验失败');
    await input.persistCheckout();
    const rollback = await input.persistRollbackLedger();
    if (!rollback.rollbackApplied) {
      throw new Error('Work Node rollback ledger 没有返回 rollbackApplied=true。');
    }
    await requirePassed(input.verifyPersistedTarget(), '目标 checkout 或 rollback ledger 的最终校验失败');
  } catch (primaryError) {
    let rollbackError: Error | null = null;
    try {
      await input.restorePreviousState();
      await requirePassed(input.verifyPreviousState(), '原页面与 checkout 的恢复后置检查失败');
    } catch (error) {
      rollbackError = asError(error);
    }
    throw new WorkNodeAtomicRestoreError(primaryError, rollbackError);
  }
}

/**
 * Compares the persisted Work Node ledger after a subtree deletion.  The
 * caller must supply a freshly re-read ledger; a command response alone is
 * intentionally not accepted as evidence.
 */
export function verifyWorkNodeDeleteLedger(input: {
  requestedNodeId: string;
  expectedDeletedNodeIds: readonly string[];
  remainingNodeIds: readonly string[];
  actualDeletedNodeIds?: readonly string[];
}): WorkNodeRestoreVerification & {
  deletedNodeIds: string[];
  remainingNodeIds: string[];
} {
  const expected = [...new Set(input.expectedDeletedNodeIds)].sort();
  const remaining = [...new Set(input.remainingNodeIds)].sort();
  const deletedNodeIds = expected.filter((id) => !remaining.includes(id));
  const missingNodeIds = expected.filter((id) => remaining.includes(id));
  const actualDeletedNodeIds = [...new Set(input.actualDeletedNodeIds || deletedNodeIds)].sort();
  const unexpectedDeletedNodeIds = actualDeletedNodeIds.filter((id) => !expected.includes(id));
  const pass = Boolean(input.requestedNodeId)
    && expected.includes(input.requestedNodeId)
    && missingNodeIds.length === 0
    && unexpectedDeletedNodeIds.length === 0
    && actualDeletedNodeIds.join('|') === expected.join('|');
  return {
    pass,
    ...(pass ? {} : {
      reason: `删除后的 Work Node ledger 不精确：残留=${missingNodeIds.join(', ') || '无'}；额外删除=${unexpectedDeletedNodeIds.join(', ') || '无'}`,
    }),
    observed: { requestedNodeId: input.requestedNodeId, missingNodeIds, unexpectedDeletedNodeIds },
    deletedNodeIds,
    remainingNodeIds: remaining,
  };
}

/**
 * Freezes the exact Work Node version shown during review.  Checkout approval
 * must carry these fields back unchanged so a later edit cannot reuse an old
 * approval for different payload bytes.
 */
export async function buildReviewedWorkNodeIdentity(input: {
  nodeId: string;
  timelineId: string;
  nodeRevision: number;
  workingPayload: TimelineSnapshotPayload;
  diffChanges: unknown;
}): Promise<ReviewedWorkNodeIdentity> {
  if (!input.nodeId.trim() || !input.timelineId.trim()) {
    throw new Error('reviewed-worknode-identity-invalid: nodeId/timelineId 不可为空。');
  }
  if (!Number.isSafeInteger(input.nodeRevision) || input.nodeRevision < 0) {
    throw new Error('reviewed-worknode-identity-invalid: nodeRevision 必须是非负安全整数。');
  }
  const [workingPayloadDigest, diffDigest] = await Promise.all([
    digestJson(input.workingPayload),
    digestJson(input.diffChanges),
  ]);
  return {
    nodeId: input.nodeId,
    timelineId: input.timelineId,
    nodeRevision: input.nodeRevision,
    workingPayloadDigest,
    diffDigest,
  };
}

export function verifyReviewedWorkNodeIdentity(input: {
  expected: Pick<
    ReviewedWorkNodeIdentity,
    'nodeId' | 'nodeRevision' | 'workingPayloadDigest' | 'diffDigest'
  >;
  observed: ReviewedWorkNodeIdentity;
}): WorkNodeRestoreVerification {
  const failures: string[] = [];
  if (input.expected.nodeId !== input.observed.nodeId) failures.push('nodeId');
  if (input.expected.nodeRevision !== input.observed.nodeRevision) failures.push('nodeRevision');
  if (input.expected.workingPayloadDigest !== input.observed.workingPayloadDigest) {
    failures.push('workingPayloadDigest');
  }
  if (input.expected.diffDigest !== input.observed.diffDigest) failures.push('diffDigest');
  return failures.length === 0
    ? { pass: true, observed: input.observed }
    : {
      pass: false,
      reason: `已审阅 Work Node 已变化：${failures.join(', ')}`,
      observed: input.observed,
    };
}

/** Builds the complete, deterministic subtree that a delete approval covers. */
export async function buildReviewedWorkNodeDeletionIdentity(input: {
  nodeId: string;
  nodes: readonly ReviewedWorkNodeDeletionEntry[];
}): Promise<ReviewedWorkNodeDeletionIdentity> {
  const target = input.nodes.find((node) => node.id === input.nodeId);
  if (!target) throw new Error(`reviewed-worknode-delete-target-missing: ${input.nodeId}`);
  if (!target.timelineId.trim()) {
    throw new Error('reviewed-worknode-delete-identity-invalid: timelineId 不可为空。');
  }
  if (!Number.isSafeInteger(target.contentRevision) || Number(target.contentRevision) < 0) {
    throw new Error('reviewed-worknode-delete-identity-invalid: nodeRevision 必须是非负安全整数。');
  }
  const scopedNodes = input.nodes.filter((node) => node.timelineId === target.timelineId);
  const subtreeIds = new Set<string>([target.id]);
  let expanded = true;
  while (expanded) {
    expanded = false;
    for (const node of scopedNodes) {
      if (node.parentNodeId && subtreeIds.has(node.parentNodeId) && !subtreeIds.has(node.id)) {
        subtreeIds.add(node.id);
        expanded = true;
      }
    }
  }
  const subtree = scopedNodes
    .filter((node) => subtreeIds.has(node.id))
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((node) => {
      if (!Number.isSafeInteger(node.contentRevision) || Number(node.contentRevision) < 0) {
        throw new Error(`reviewed-worknode-delete-identity-invalid: ${node.id} 缺少 contentRevision。`);
      }
      if (!Number.isSafeInteger(node.updatedAt) || Number(node.updatedAt) < 0) {
        throw new Error(`reviewed-worknode-delete-identity-invalid: ${node.id} 缺少 updatedAt。`);
      }
      return {
        id: node.id,
        timelineId: node.timelineId,
        parentNodeId: node.parentNodeId || null,
        branchId: node.branchId || '',
        label: node.label || '',
        description: node.description || '',
        status: node.status || '',
        approvalPolicy: node.approvalPolicy || '',
        contentRevision: Number(node.contentRevision),
        updatedAt: Number(node.updatedAt),
        riskFlags: node.riskFlags || [],
      };
    });
  const subtreeNodeIds = subtree.map((node) => node.id);
  return {
    nodeId: target.id,
    timelineId: target.timelineId,
    nodeRevision: Number(target.contentRevision),
    subtreeNodeCount: subtree.length,
    subtreeNodeIds,
    subtreeDigest: await digestJson(subtree),
  };
}

export function verifyReviewedWorkNodeDeletionIdentity(input: {
  expected: Pick<
    ReviewedWorkNodeDeletionIdentity,
    'nodeId' | 'nodeRevision' | 'subtreeNodeCount' | 'subtreeDigest'
  >;
  observed: ReviewedWorkNodeDeletionIdentity;
}): WorkNodeRestoreVerification {
  const failures: string[] = [];
  if (input.expected.nodeId !== input.observed.nodeId) failures.push('nodeId');
  if (input.expected.nodeRevision !== input.observed.nodeRevision) failures.push('nodeRevision');
  if (input.expected.subtreeNodeCount !== input.observed.subtreeNodeCount) failures.push('subtreeNodeCount');
  if (input.expected.subtreeDigest !== input.observed.subtreeDigest) failures.push('subtreeDigest');
  return failures.length === 0
    ? { pass: true, observed: input.observed }
    : {
      pass: false,
      reason: `已审阅删除子树已变化：${failures.join(', ')}`,
      observed: input.observed,
    };
}

function comparableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(comparableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== 'createdAt' && key !== 'updatedAt')
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, comparableValue(entry)]),
  );
}

function payloadPathProjection(payload: TimelineSnapshotPayload, path: keyof TimelineSnapshotPayload): unknown {
  return comparableValue(payload[path]);
}

function buttonIds(payload: TimelineSnapshotPayload | null): string[] {
  return payload
    ? Object.keys(payload.skillButtonTable || {}).sort()
    : [];
}

function buffProjection(payload: TimelineSnapshotPayload): unknown {
  return {
    allBuffList: comparableValue(payload.allBuffList),
    buttonBuffs: Object.entries(payload.skillButtonTable || {})
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([id, button]) => [id, comparableValue({
        selectedBuff: (button as { selectedBuff?: unknown }).selectedBuff,
        selectedBuffIds: (button as { selectedBuffIds?: unknown }).selectedBuffIds,
        buffStackCounts: (button as { buffStackCounts?: unknown }).buffStackCounts,
      })]),
  };
}

function resistanceProjection(payload: TimelineSnapshotPayload): unknown {
  return Object.entries(payload.skillButtonTable || {})
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([id, button]) => [id, comparableValue((button as { resistanceConfig?: { targetResistance?: unknown } }).resistanceConfig?.targetResistance ?? null)]);
}

/**
 * Builds one exact, path-level receipt for a hydrated checkout.  Generated
 * timestamps are ignored, but buttons, Buff attachments/stacks, resistances,
 * operator config and timeline content are all independently compared.
 */
export async function buildWorkNodePayloadPostcondition(input: {
  expectedPayload: TimelineSnapshotPayload;
  actualPayload: TimelineSnapshotPayload | null;
  expectedVisibleButtonIds?: readonly string[];
  actualVisibleButtonIds?: readonly string[];
  expectedCheckout?: Pick<TimelineCheckoutRef, 'targetType' | 'targetId'>;
  observedCheckout?: Pick<TimelineCheckoutRef, 'targetType' | 'targetId'> | null;
  expectedNodeRevision?: number;
  observedNodeRevision?: number | null;
}): Promise<WorkNodePayloadPostcondition> {
  const expected = input.expectedPayload;
  const actual = input.actualPayload;
  const expectedVisibleButtonIds = [...(input.expectedVisibleButtonIds || buttonIds(expected))].sort();
  const actualVisibleButtonIds = [...(input.actualVisibleButtonIds || buttonIds(actual))].sort();
  const expectedCheckout = input.expectedCheckout;
  const observedCheckout = input.observedCheckout || null;

  const expectedProjection = comparableValue(expected);
  const actualProjection = actual ? comparableValue(actual) : null;
  const expectedDigests = await Promise.all([
    digestJson(expectedProjection),
    digestJson(payloadPathProjection(expected, 'timelineData')),
    digestJson(payloadPathProjection(expected, 'skillButtonTable')),
    digestJson(buffProjection(expected)),
    digestJson(resistanceProjection(expected)),
    digestJson(payloadPathProjection(expected, 'operatorConfigPageCache')),
  ]);
  const actualDigests = actual
    ? await Promise.all([
      digestJson(actualProjection),
      digestJson(payloadPathProjection(actual, 'timelineData')),
      digestJson(payloadPathProjection(actual, 'skillButtonTable')),
      digestJson(buffProjection(actual)),
      digestJson(resistanceProjection(actual)),
      digestJson(payloadPathProjection(actual, 'operatorConfigPageCache')),
    ])
    : [null, null, null, null, null, null] as const;

  const [
    expectedPayloadDigest,
    expectedTimelineDigest,
    expectedButtonDigest,
    expectedBuffDigest,
    expectedResistanceDigest,
    expectedOperatorConfigDigest,
  ] = expectedDigests;
  const [
    actualPayloadDigest,
    actualTimelineDigest,
    actualButtonDigest,
    actualBuffDigest,
    actualResistanceDigest,
    actualOperatorConfigDigest,
  ] = actualDigests;
  const failures: string[] = [];
  if (!actual) failures.push('Canvas 当前 payload 不可读');
  if (actualPayloadDigest !== expectedPayloadDigest) failures.push('payload digest 不一致');
  if (actualTimelineDigest !== expectedTimelineDigest) failures.push('timeline digest 不一致');
  if (actualButtonDigest !== expectedButtonDigest) failures.push('技能按钮状态不一致');
  if (actualBuffDigest !== expectedBuffDigest) failures.push('Buff 状态不一致');
  if (actualResistanceDigest !== expectedResistanceDigest) failures.push('抗性状态不一致');
  if (actualOperatorConfigDigest !== expectedOperatorConfigDigest) failures.push('operator config 不一致');
  if (expectedVisibleButtonIds.join('|') !== actualVisibleButtonIds.join('|')) failures.push('可见按钮集合不一致');
  if (expectedCheckout && (!observedCheckout
    || expectedCheckout.targetType !== observedCheckout.targetType
    || expectedCheckout.targetId !== observedCheckout.targetId)) {
    failures.push('checkout target 不一致');
  }
  if (input.expectedNodeRevision !== undefined && input.expectedNodeRevision !== input.observedNodeRevision) {
    failures.push('checkout node revision 不一致');
  }
  return {
    pass: failures.length === 0,
    expected: {
      payloadDigest: expectedPayloadDigest,
      timelineDigest: expectedTimelineDigest,
      buttonDigest: expectedButtonDigest,
      buffDigest: expectedBuffDigest,
      resistanceDigest: expectedResistanceDigest,
      operatorConfigDigest: expectedOperatorConfigDigest,
      visibleButtonIds: expectedVisibleButtonIds,
      ...(expectedCheckout ? { checkout: expectedCheckout } : {}),
      ...(input.expectedNodeRevision === undefined ? {} : { nodeRevision: input.expectedNodeRevision }),
    },
    observed: {
      payloadDigest: actualPayloadDigest,
      timelineDigest: actualTimelineDigest,
      buttonDigest: actualButtonDigest,
      buffDigest: actualBuffDigest,
      resistanceDigest: actualResistanceDigest,
      operatorConfigDigest: actualOperatorConfigDigest,
      visibleButtonIds: actualVisibleButtonIds,
      checkout: observedCheckout,
      nodeRevision: input.observedNodeRevision ?? null,
    },
    failures,
  };
}

async function requirePassed(
  verification: WorkNodeRestoreVerification | Promise<WorkNodeRestoreVerification>,
  prefix: string,
): Promise<void> {
  const result = await verification;
  if (!result.pass) {
    throw new Error(`${prefix}${result.reason ? `：${result.reason}` : ''}`);
  }
}

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}
