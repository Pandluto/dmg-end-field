import type {
  TimelineAuditEvent,
  TimelineCheckoutRef,
  TimelineDocument,
  TimelineSnapshot,
} from '../../core/domain/timeline';
import type {
  TimelineBundleV2,
  TimelineSnapshotPayload,
} from '../../utils/timelineSnapshotStorage';
import { replaceUserWorkspaceWithTimelinePayload } from '../../utils/userWorkspaceBridge';
import { buildAiTimelineCheckoutDecision } from '../../agentKernel/timelineWorktree/checkoutDecision.mjs';
import { diffTimelinePayloads, summarizeTimelinePayload } from '../../agentKernel/timelineWorktree/diff';
import type {
  AiTimelineApproval,
  AiTimelineApprovalPolicy,
  AiTimelineCheckout,
  AiTimelineCheckoutDecision,
  AiTimelineRiskFlag,
  AiTimelineWorkNode,
  AiTimelineWorkNodeCommit,
  AiTimelineWorkNodeStatus,
  TimelinePayloadDiff,
  TimelinePayloadDiffSummary,
  TimelinePayloadSummary,
} from '../../agentKernel/timelineWorktree/types';
import { validateTimelinePayload } from '../../agentKernel/timelineWorktree/validator';
import {
  webDatabase,
  type SqlPrimitive,
  type SqlBatchResult,
  type SqlStatement,
} from '../database/webDatabase';
import {
  normalizeCompatibleTimelinePayload,
  TimelinePayloadCompatibilityError,
  type TimelinePayloadCompatibilityRepair,
} from './timelinePayloadCompatibility';

type Row = Record<string, SqlPrimitive>;

export class BrowserTimelineStoreError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'BrowserTimelineStoreError';
  }
}

export type BrowserTimelineWorkNode = AiTimelineWorkNode & {
  contentRevision: number;
};

export type BrowserTimelineWorkNodePatch = {
  id: string;
  timelineId: string;
  nodeId: string;
  patch: Array<{ op?: string }>;
  validation: { ok?: boolean; issues?: unknown[] };
  diffSummary: Record<string, unknown>;
  riskFlags: unknown[];
  createdAt: number;
};

export type TimelineArchiveSource = 'local' | 'shared';
export type TimelineArchiveLibrary = TimelineArchiveSource;

export type BrowserTimelineArchiveSummary = {
  archiveId: string;
  label: string;
  source: TimelineArchiveSource;
  library: TimelineArchiveLibrary;
  archiveVersion: number;
  createdAt: string;
  payloadHash?: string;
  summary: TimelinePayloadSummary;
  nodeCount: number;
  hasCurrentNode: boolean;
  releaseId?: string;
  invalid?: { code: string; message: string };
  worktreeDiagnostic?: { code: string; message: string };
};

export type LegacyTimelineArchive = {
  type: 'dmg.timeline-archive.v1';
  archiveVersion: 1;
  source: TimelineArchiveSource | 'reference';
  archiveId: string;
  label: string;
  createdAt: string;
  payload: TimelineSnapshotPayload;
  worktree?: {
    nodes: Array<{
      id: string;
      parentNodeId?: string;
      branchId?: string;
      label?: string;
      description?: string;
      status?: string;
      approvalPolicy?: string;
      riskFlags?: unknown[];
      logs?: unknown[];
      createdAt?: number;
      updatedAt?: number;
      contentRevision?: number;
      basePayload: TimelineSnapshotPayload;
      workingPayload: TimelineSnapshotPayload;
    }>;
    currentNodeId?: string | null;
    nodeCount?: number;
    rootPayloadHash?: string | null;
    currentPayloadHash?: string | null;
  };
};

export type BrowserTimelineSqliteWorkspace = {
  document: TimelineDocument;
  checkoutRef: TimelineCheckoutRef | null;
  summary: TimelinePayloadSummary;
  nodeCount: number;
  invalid?: { code: string; message: string };
};

export type TimelineWorkspaceApplyResult = {
  document: Pick<TimelineDocument, 'id' | 'label'>;
  payload: TimelineSnapshotPayload;
  checkoutRef: TimelineCheckoutRef;
  workspace: { values: Record<string, string | null>; updatedAt: number };
};

export type BrowserTimelineBundle = {
  document: TimelineDocument;
  snapshots: TimelineSnapshot[];
  workNodes: BrowserTimelineWorkNode[];
  commits: AiTimelineWorkNodeCommit[];
  checkoutRef: TimelineCheckoutRef | null;
};

export type ImportDocumentBundleInput = {
  document: Pick<TimelineDocument, 'id' | 'label'> &
    Partial<Pick<TimelineDocument, 'createdAt' | 'isTemporary'>>;
  snapshots: Array<{
    id: string;
    label: string;
    createdAt?: number;
    payload: TimelineSnapshotPayload;
  }>;
  workNodes?: Array<{
    id: string;
    parentNodeId?: string;
    branchId: string;
    label: string;
    description?: string;
    status: string;
    approvalPolicy: string;
    riskFlags?: unknown[];
    logs?: unknown[];
    createdAt?: number;
    updatedAt?: number;
    contentRevision?: number;
    basePayload: TimelineSnapshotPayload;
    workingPayload: TimelineSnapshotPayload;
  }>;
  commits?: Array<AiTimelineWorkNodeCommit>;
  checkoutRef?: Omit<TimelineCheckoutRef, 'timelineId'>;
};

const WORK_NODE_STATUSES = new Set<AiTimelineWorkNodeStatus>([
  'open',
  'ready',
  'committed',
  'applied',
  'abandoned',
]);

function fail(code: string, status: number, message: string, details?: unknown): never {
  throw new BrowserTimelineStoreError(message, status, code, details);
}

async function batchWithRequiredChanges(
  statements: SqlStatement[],
  failure: { code: string; message: string; details?: unknown },
): Promise<SqlBatchResult> {
  try {
    return await webDatabase.batch(statements);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('WEB_DATABASE_REQUIRED_CHANGE:')) {
      fail(failure.code, 409, failure.message, failure.details);
    }
    throw error;
  }
}

function compatiblePayload(
  payload: unknown,
  context: string,
): {
  payload: TimelineSnapshotPayload;
  changed: boolean;
  repairs: TimelinePayloadCompatibilityRepair[];
} {
  try {
    return normalizeCompatibleTimelinePayload(payload);
  } catch (error) {
    if (error instanceof TimelinePayloadCompatibilityError) {
      fail(
        'invalid-compatible-timeline-payload',
        400,
        `${context} 无法转换为可保存的排轴：${error.message}`,
        { context, issues: error.issues },
      );
    }
    throw error;
  }
}

function canonicalizeBrowserTimelineBundle(
  bundle: BrowserTimelineBundle,
  context: string,
): {
  bundle: BrowserTimelineBundle;
  changed: boolean;
  repairs: TimelinePayloadCompatibilityRepair[];
} {
  let changed = false;
  const repairs: TimelinePayloadCompatibilityRepair[] = [];
  const normalize = (payload: unknown, payloadContext: string): TimelineSnapshotPayload => {
    const result = compatiblePayload(payload, `${context} / ${payloadContext}`);
    changed ||= result.changed;
    repairs.push(...result.repairs);
    return result.payload;
  };
  const snapshots = bundle.snapshots.map((snapshot) => {
    if (!snapshot.payload) {
      fail(
        'timeline-archive-snapshot-has-no-payload',
        400,
        `${context} / 快照 ${snapshot.label || snapshot.id} 缺少 payload。`,
      );
    }
    return {
      ...snapshot,
      payload: normalize(snapshot.payload, `快照 ${snapshot.label || snapshot.id}`),
    };
  });
  const workNodes = bundle.workNodes.map((node) => {
    const basePayload = normalize(node.basePayload, `工作节点 ${node.label || node.id} base`);
    const workingPayload = normalize(node.workingPayload, `工作节点 ${node.label || node.id} working`);
    return {
      ...node,
      basePayload,
      workingPayload,
      baseSummary: summarizeTimelinePayload(basePayload),
      workingSummary: summarizeTimelinePayload(workingPayload),
    };
  });
  const commits = bundle.commits.map((commit) => ({
    ...commit,
    basePayload: normalize(commit.basePayload, `提交 ${commit.label || commit.id} base`),
    appliedPayload: normalize(commit.appliedPayload, `提交 ${commit.label || commit.id} applied`),
  }));
  return {
    bundle: { ...bundle, snapshots, workNodes, commits },
    changed,
    repairs,
  };
}

function canonicalizeImportDocumentBundle(
  input: ImportDocumentBundleInput,
): {
  input: ImportDocumentBundleInput;
  repairs: TimelinePayloadCompatibilityRepair[];
} {
  const repairs: TimelinePayloadCompatibilityRepair[] = [];
  const normalize = (payload: unknown, context: string): TimelineSnapshotPayload => {
    const result = compatiblePayload(payload, context);
    repairs.push(...result.repairs);
    return result.payload;
  };
  return {
    input: {
      ...input,
      snapshots: input.snapshots.map((snapshot) => ({
        ...snapshot,
        payload: normalize(snapshot.payload, `SQLite 导入快照 ${snapshot.label || snapshot.id}`),
      })),
      workNodes: input.workNodes?.map((node) => ({
        ...node,
        basePayload: normalize(node.basePayload, `SQLite 导入工作节点 ${node.label || node.id} base`),
        workingPayload: normalize(node.workingPayload, `SQLite 导入工作节点 ${node.label || node.id} working`),
      })),
      commits: input.commits?.map((commit) => ({
        ...commit,
        basePayload: normalize(commit.basePayload, `SQLite 导入提交 ${commit.label || commit.id} base`),
        appliedPayload: normalize(commit.appliedPayload, `SQLite 导入提交 ${commit.label || commit.id} applied`),
      })),
    },
    repairs,
  };
}

function textValue(value: SqlPrimitive | undefined, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function numberValue(value: SqlPrimitive | undefined, fallback = 0): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function parseJson<T>(value: SqlPrimitive | undefined, fallback: T): T {
  if (typeof value !== 'string') return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function serialize(value: unknown): string {
  return JSON.stringify(value ?? null);
}

function makeId(prefix: string): string {
  const suffix = typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
  return `${prefix}-${suffix}`;
}

async function hashPayload(payload: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(serialize(payload));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hex = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  return `sha256:${hex}`;
}

function normalizeStatus(value: unknown): AiTimelineWorkNodeStatus {
  return WORK_NODE_STATUSES.has(value as AiTimelineWorkNodeStatus)
    ? value as AiTimelineWorkNodeStatus
    : 'open';
}

function normalizeApprovalPolicy(value: unknown): AiTimelineApprovalPolicy {
  return value === 'manual' || value === 'ask-on-risk' || value === 'auto-low-risk'
    ? value
    : 'auto-low-risk';
}

function normalizeRiskFlags(value: unknown): AiTimelineRiskFlag[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
    .map((item) => ({
      id: typeof item.id === 'string' && item.id.trim() ? item.id : makeId('timeline-risk'),
      severity: item.severity === 'info' || item.severity === 'blocker' ? item.severity : 'warning',
      code: typeof item.code === 'string' && item.code.trim() ? item.code : 'unspecified-risk',
      message: typeof item.message === 'string' && item.message.trim()
        ? item.message
        : '未说明的排轴风险。',
      ...(typeof item.path === 'string' && item.path.trim() ? { path: item.path } : {}),
    }));
}

function makeLog(
  level: 'info' | 'warning' | 'error',
  message: string,
): BrowserTimelineWorkNode['logs'][number] {
  return { id: makeId('timeline-log'), at: Date.now(), level, message };
}

function documentFromRow(row: Row): TimelineDocument {
  return {
    id: textValue(row.id),
    label: textValue(row.label),
    isTemporary: numberValue(row.is_temporary) === 1,
    createdAt: numberValue(row.created_at),
    updatedAt: numberValue(row.updated_at),
    archivedAt: null,
  };
}

function snapshotFromRow(row: Row): TimelineSnapshot {
  return {
    id: textValue(row.id),
    timelineId: textValue(row.timeline_id),
    label: textValue(row.label),
    payloadHash: textValue(row.payload_hash),
    createdAt: numberValue(row.created_at),
    archivedAt: numberValue(row.archived) === 1 ? numberValue(row.created_at) : null,
    payload: parseJson<TimelineSnapshotPayload>(row.payload_json, {} as TimelineSnapshotPayload),
  };
}

function workNodeFromRow(row: Row): BrowserTimelineWorkNode {
  const basePayload = parseJson<TimelineSnapshotPayload>(
    row.base_payload_json,
    {} as TimelineSnapshotPayload,
  );
  const workingPayload = parseJson<TimelineSnapshotPayload>(
    row.working_payload_json,
    {} as TimelineSnapshotPayload,
  );
  return {
    id: textValue(row.id),
    ...(textValue(row.parent_node_id) ? { parentNodeId: textValue(row.parent_node_id) } : {}),
    timelineId: textValue(row.timeline_id),
    branchId: textValue(row.branch_id),
    label: textValue(row.label),
    description: textValue(row.description),
    status: normalizeStatus(row.status),
    approvalPolicy: normalizeApprovalPolicy(row.approval_policy),
    riskFlags: normalizeRiskFlags(parseJson(row.risk_flags_json, [])),
    logs: parseJson<BrowserTimelineWorkNode['logs']>(row.logs_json, []),
    basePayload,
    workingPayload,
    baseSummary: summarizeTimelinePayload(basePayload),
    workingSummary: summarizeTimelinePayload(workingPayload),
    contentRevision: numberValue(row.content_revision, numberValue(row.updated_at)),
    createdAt: numberValue(row.created_at),
    updatedAt: numberValue(row.updated_at),
  };
}

function commitFromRow(row: Row): AiTimelineWorkNodeCommit {
  const checkout = parseJson<AiTimelineCheckout | null>(row.checkout_json, null);
  return {
    id: textValue(row.id),
    nodeId: textValue(row.node_id),
    timelineId: textValue(row.timeline_id),
    branchId: textValue(row.branch_id),
    label: textValue(row.label),
    summary: parseJson<TimelinePayloadDiffSummary>(
      row.summary_json,
      {} as TimelinePayloadDiffSummary,
    ),
    riskFlags: normalizeRiskFlags(parseJson(row.risk_flags_json, [])),
    approval: parseJson<AiTimelineApproval>(row.approval_json, {
      mode: 'auto',
      approvedAt: numberValue(row.created_at),
      approvedBy: 'system',
      rationale: '浏览器排轴仓库默认批准。',
    }),
    checkoutApplied: numberValue(row.checkout_applied) === 1,
    ...(checkout ? { checkout } : {}),
    basePayload: parseJson<TimelineSnapshotPayload>(
      row.base_payload_json,
      {} as TimelineSnapshotPayload,
    ),
    appliedPayload: parseJson<TimelineSnapshotPayload>(
      row.applied_payload_json,
      {} as TimelineSnapshotPayload,
    ),
    createdAt: numberValue(row.created_at),
  };
}

function checkoutFromRow(row: Row | undefined): TimelineCheckoutRef | null {
  if (!row) return null;
  const targetType = textValue(row.target_type);
  if (targetType !== 'snapshot' && targetType !== 'work-node') return null;
  return {
    timelineId: textValue(row.timeline_id),
    targetType,
    targetId: textValue(row.target_id),
    updatedAt: numberValue(row.updated_at),
  };
}

function auditStatement(input: {
  timelineId: string;
  eventType: string;
  subjectType: TimelineAuditEvent['subjectType'];
  subjectId: string;
  details?: Record<string, unknown>;
  createdAt?: number;
  when?: { sql: string; bind?: SqlPrimitive[] };
}): SqlStatement {
  const createdAt = input.createdAt ?? Date.now();
  const values: SqlPrimitive[] = [
    makeId('timeline-audit'),
    input.timelineId,
    input.eventType,
    serialize({
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      details: input.details || {},
    }),
    createdAt,
  ];
  if (input.when) {
    return {
      sql: `
        INSERT INTO timeline_audit_events(
          id, timeline_id, event_type, payload_json, created_at
        )
        SELECT ?, ?, ?, ?, ?
        WHERE ${input.when.sql}
      `,
      bind: [...values, ...(input.when.bind || [])],
    };
  }
  return {
    sql: `
      INSERT INTO timeline_audit_events(id, timeline_id, event_type, payload_json, created_at)
      VALUES (?, ?, ?, ?, ?)
    `,
    bind: values,
  };
}

async function requireDocument(timelineId: string): Promise<TimelineDocument> {
  const rows = await webDatabase.query<Row>(
    'SELECT * FROM timeline_documents WHERE id = ?',
    [timelineId],
  );
  if (!rows[0]) {
    fail('timeline-document-not-found', 404, `Timeline document not found: ${timelineId}`);
  }
  return documentFromRow(rows[0]);
}

async function getWorkNodeRow(id: string, timelineId?: string): Promise<Row | undefined> {
  const rows = await webDatabase.query<Row>(
    timelineId
      ? 'SELECT * FROM timeline_work_nodes WHERE timeline_id = ? AND id = ?'
      : 'SELECT * FROM timeline_work_nodes WHERE id = ?',
    timelineId ? [timelineId, id] : [id],
  );
  return rows[0];
}

export async function listDocuments(): Promise<TimelineDocument[]> {
  const rows = await webDatabase.query<Row>(
    'SELECT * FROM timeline_documents ORDER BY updated_at DESC',
  );
  return rows.map(documentFromRow);
}

export async function ensureDocument(
  input: Pick<TimelineDocument, 'id' | 'label'> &
    Partial<Pick<TimelineDocument, 'createdAt' | 'isTemporary'>> & {
      preserveExistingLabel?: boolean;
    },
): Promise<TimelineDocument> {
  if (!input.id?.trim() || !input.label?.trim()) {
    fail('invalid-timeline-document', 400, 'Timeline document requires id and label.');
  }
  const createdAt = input.createdAt ?? Date.now();
  const updatedAt = Date.now();
  const hasTemporaryState = Object.prototype.hasOwnProperty.call(input, 'isTemporary');
  await webDatabase.execute(
    `
      INSERT INTO timeline_documents(id, label, created_at, updated_at, is_temporary)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        label = CASE WHEN ? = 1 THEN timeline_documents.label ELSE excluded.label END,
        is_temporary = CASE WHEN ? = 1 THEN excluded.is_temporary ELSE timeline_documents.is_temporary END,
        updated_at = excluded.updated_at
    `,
    [
      input.id,
      input.label.trim(),
      createdAt,
      updatedAt,
      input.isTemporary ? 1 : 0,
      input.preserveExistingLabel ? 1 : 0,
      hasTemporaryState ? 1 : 0,
    ],
  );
  return requireDocument(input.id);
}

export async function listSnapshots(timelineId: string): Promise<TimelineSnapshot[]> {
  const rows = await webDatabase.query<Row>(
    `
      SELECT * FROM timeline_snapshots
      WHERE timeline_id = ? AND archived = 0
      ORDER BY created_at DESC
    `,
    [timelineId],
  );
  return rows.map(snapshotFromRow);
}

export async function saveSnapshot(input: {
  id: string;
  timelineId: string;
  label: string;
  payload: TimelineSnapshotPayload;
  createdAt?: number;
}): Promise<{ snapshot: TimelineSnapshot; reused: boolean }> {
  if (!input.id || !input.timelineId || !input.label) {
    fail(
      'invalid-timeline-snapshot',
      400,
      'Timeline snapshot requires id, timelineId, and label.',
    );
  }
  const compatible = compatiblePayload(input.payload, `保存快照 ${input.label || input.id}`);
  input = { ...input, payload: compatible.payload };
  await requireDocument(input.timelineId);
  const createdAt = input.createdAt ?? Date.now();
  const payloadJson = serialize(input.payload);
  const payloadHash = await hashPayload(input.payload);
  const matchingRows = await webDatabase.query<Row>(
    `
      SELECT * FROM timeline_snapshots
      WHERE timeline_id = ? AND payload_hash = ?
      ORDER BY created_at DESC LIMIT 1
    `,
    [input.timelineId, payloadHash],
  );
  const matching = matchingRows[0];
  if (matching) {
    if (numberValue(matching.archived) === 1) {
      await webDatabase.batch([
        {
          sql: `
            UPDATE timeline_snapshots
            SET archived = 0, label = ?
            WHERE timeline_id = ? AND id = ?
          `,
          bind: [input.label, input.timelineId, textValue(matching.id)],
        },
        auditStatement({
          timelineId: input.timelineId,
          eventType: 'snapshot.unarchived',
          subjectType: 'snapshot',
          subjectId: textValue(matching.id),
          details: { payloadHash },
          createdAt,
        }),
      ]);
    }
    const refreshed = await webDatabase.query<Row>(
      'SELECT * FROM timeline_snapshots WHERE timeline_id = ? AND id = ?',
      [input.timelineId, textValue(matching.id)],
    );
    return { snapshot: snapshotFromRow(refreshed[0]), reused: true };
  }

  let snapshotId = input.id;
  const idOwner = await webDatabase.query<Row>(
    'SELECT id FROM timeline_snapshots WHERE id = ?',
    [snapshotId],
  );
  if (idOwner[0]) snapshotId = `${input.id}-${payloadHash.slice(-12)}-${makeId('copy').slice(-8)}`;
  await webDatabase.batch([
    {
      sql: `
        INSERT INTO timeline_snapshots(
          id, timeline_id, label, payload_json, payload_hash, created_at, archived
        ) VALUES (?, ?, ?, ?, ?, ?, 0)
      `,
      bind: [
        snapshotId,
        input.timelineId,
        input.label,
        payloadJson,
        payloadHash,
        createdAt,
      ],
    },
    {
      sql: 'UPDATE timeline_documents SET updated_at = ? WHERE id = ?',
      bind: [Date.now(), input.timelineId],
    },
    auditStatement({
      timelineId: input.timelineId,
      eventType: 'snapshot.saved',
      subjectType: 'snapshot',
      subjectId: snapshotId,
      details: { payloadHash },
      createdAt,
    }),
  ]);
  const rows = await webDatabase.query<Row>(
    'SELECT * FROM timeline_snapshots WHERE timeline_id = ? AND id = ?',
    [input.timelineId, snapshotId],
  );
  return { snapshot: snapshotFromRow(rows[0]), reused: false };
}

export async function getCheckoutRef(timelineId: string): Promise<TimelineCheckoutRef | null> {
  const rows = await webDatabase.query<Row>(
    'SELECT * FROM timeline_checkout_refs WHERE timeline_id = ?',
    [timelineId],
  );
  return checkoutFromRow(rows[0]);
}

export type SetTimelineCheckoutRefInput = TimelineCheckoutRef & {
  /** The checkout observed by the caller. Omit to use the value read immediately before the CAS. */
  expected?: TimelineCheckoutRef | null;
};

function sameCheckout(
  left: TimelineCheckoutRef | null,
  right: TimelineCheckoutRef | null,
): boolean {
  if (!left || !right) return left === right;
  return left.timelineId === right.timelineId
    && left.targetType === right.targetType
    && left.targetId === right.targetId
    && left.updatedAt === right.updatedAt;
}

export async function setCheckoutRef(
  input: SetTimelineCheckoutRefInput,
): Promise<TimelineCheckoutRef> {
  await requireDocument(input.timelineId);
  const table = input.targetType === 'snapshot'
    ? 'timeline_snapshots'
    : 'timeline_work_nodes';
  const rows = await webDatabase.query<Row>(
    `SELECT timeline_id FROM ${table} WHERE timeline_id = ? AND id = ?`,
    [input.timelineId, input.targetId],
  );
  if (!rows[0]) {
    fail(
      'timeline-checkout-target-not-found',
      404,
      `Timeline checkout target not found: ${input.targetId}`,
    );
  }
  const observedCheckout = await getCheckoutRef(input.timelineId);
  const hasExplicitExpected = Object.prototype.hasOwnProperty.call(input, 'expected');
  const expectedCheckout = hasExplicitExpected ? input.expected! : observedCheckout;
  if (hasExplicitExpected && !sameCheckout(observedCheckout, expectedCheckout)) {
    fail(
      'timeline-checkout-conflict',
      409,
      'Timeline checkout changed before this update could be applied.',
      { expected: expectedCheckout, actual: observedCheckout },
    );
  }
  const updatedAt = input.updatedAt ?? Date.now();
  const checkoutStatement: SqlStatement = expectedCheckout
    ? {
      sql: `
        INSERT INTO timeline_checkout_refs(timeline_id, target_type, target_id, updated_at)
        SELECT ?, ?, ?, ?
        WHERE EXISTS (
          SELECT 1 FROM timeline_checkout_refs
          WHERE timeline_id = ? AND target_type = ? AND target_id = ? AND updated_at = ?
        )
        AND EXISTS (
          SELECT 1 FROM ${table}
          WHERE timeline_id = ? AND id = ?
        )
        ON CONFLICT(timeline_id) DO UPDATE SET
          target_type = excluded.target_type,
          target_id = excluded.target_id,
          updated_at = excluded.updated_at
        WHERE timeline_checkout_refs.target_type = ?
          AND timeline_checkout_refs.target_id = ?
          AND timeline_checkout_refs.updated_at = ?
      `,
      bind: [
        input.timelineId,
        input.targetType,
        input.targetId,
        updatedAt,
        input.timelineId,
        expectedCheckout.targetType,
        expectedCheckout.targetId,
        expectedCheckout.updatedAt,
        input.timelineId,
        input.targetId,
        expectedCheckout.targetType,
        expectedCheckout.targetId,
        expectedCheckout.updatedAt,
      ],
    }
    : {
      sql: `
        INSERT INTO timeline_checkout_refs(timeline_id, target_type, target_id, updated_at)
        SELECT ?, ?, ?, ?
        WHERE NOT EXISTS (
          SELECT 1 FROM timeline_checkout_refs WHERE timeline_id = ?
        )
        AND EXISTS (
          SELECT 1 FROM ${table}
          WHERE timeline_id = ? AND id = ?
        )
      `,
      bind: [
        input.timelineId,
        input.targetType,
        input.targetId,
        updatedAt,
        input.timelineId,
        input.timelineId,
        input.targetId,
      ],
    };
  checkoutStatement.requireChanges = true;
  const result = await batchWithRequiredChanges([
    checkoutStatement,
    {
      sql: `
        UPDATE timeline_documents SET updated_at = ?
        WHERE id = ? AND changes() > 0
      `,
      bind: [updatedAt, input.timelineId],
    },
    auditStatement({
      timelineId: input.timelineId,
      eventType: 'checkout.updated',
      subjectType: 'checkout',
      subjectId: input.targetId,
      details: { targetType: input.targetType },
      createdAt: updatedAt,
      when: { sql: 'changes() > 0' },
    }),
  ], {
    code: 'timeline-checkout-conflict',
    message: 'Timeline checkout changed before this update could be applied.',
    details: { expected: expectedCheckout },
  });
  if (!result.statementChanges[0]) {
    fail(
      'timeline-checkout-conflict',
      409,
      'Timeline checkout changed before this update could be applied.',
      { expected: expectedCheckout, actual: await getCheckoutRef(input.timelineId) },
    );
  }
  return {
    timelineId: input.timelineId,
    targetType: input.targetType,
    targetId: input.targetId,
    updatedAt,
  };
}

export async function listWorkNodes(timelineId: string): Promise<BrowserTimelineWorkNode[]> {
  const rows = await webDatabase.query<Row>(
    'SELECT * FROM timeline_work_nodes WHERE timeline_id = ? ORDER BY created_at ASC',
    [timelineId],
  );
  return rows.map(workNodeFromRow);
}

export async function listWorkNodeCommits(
  timelineId: string,
): Promise<AiTimelineWorkNodeCommit[]> {
  const rows = await webDatabase.query<Row>(
    `
      SELECT * FROM timeline_work_node_commits
      WHERE timeline_id = ? ORDER BY created_at DESC
    `,
    [timelineId],
  );
  return rows.map(commitFromRow);
}

export function listWorkNodePatches(
  timelineId: string,
  nodeId: string,
  limit?: number,
): Promise<BrowserTimelineWorkNodePatch[]>;
export function listWorkNodePatches(
  nodeId: string,
  limit?: number,
): Promise<BrowserTimelineWorkNodePatch[]>;
export async function listWorkNodePatches(
  timelineIdOrNodeId: string,
  nodeIdOrLimit: string | number = 100,
  maybeLimit = 100,
): Promise<BrowserTimelineWorkNodePatch[]> {
  const explicitTimelineId = typeof nodeIdOrLimit === 'string' ? timelineIdOrNodeId : undefined;
  const nodeId = explicitTimelineId ? String(nodeIdOrLimit) : timelineIdOrNodeId;
  const limit = typeof nodeIdOrLimit === 'number' ? nodeIdOrLimit : maybeLimit;
  const timelineId = explicitTimelineId
    || textValue((await getWorkNodeRow(nodeId))?.timeline_id);
  if (!timelineId) {
    fail('ai-worknode-not-found', 404, `AI timeline work node not found: ${nodeId}`);
  }
  const rows = await webDatabase.query<Row>(
    `
      SELECT * FROM timeline_work_node_patches
      WHERE timeline_id = ? AND node_id = ? ORDER BY created_at DESC LIMIT ?
    `,
    [timelineId, nodeId, Math.max(1, Math.min(limit, 500))],
  );
  return rows.map((row) => ({
    id: textValue(row.id),
    timelineId: textValue(row.timeline_id),
    nodeId: textValue(row.node_id),
    patch: parseJson(row.patch_json, []),
    validation: parseJson(row.validation_json, {}),
    diffSummary: parseJson(row.diff_summary_json, {}),
    riskFlags: parseJson(row.risk_flags_json, []),
    createdAt: numberValue(row.created_at),
  }));
}

export async function listAuditEvents(
  timelineId: string,
  limit = 100,
): Promise<TimelineAuditEvent[]> {
  const rows = await webDatabase.query<Row>(
    `
      SELECT * FROM timeline_audit_events
      WHERE timeline_id = ? ORDER BY created_at DESC LIMIT ?
    `,
    [timelineId, Math.max(1, Math.min(limit, 500))],
  );
  return rows.map((row) => {
    const payload = parseJson<{
      subjectType?: TimelineAuditEvent['subjectType'];
      subjectId?: string;
      details?: Record<string, unknown>;
    }>(row.payload_json, {});
    return {
      id: textValue(row.id),
      timelineId: textValue(row.timeline_id),
      eventType: textValue(row.event_type),
      subjectType: payload.subjectType || 'checkout',
      subjectId: payload.subjectId || '',
      details: payload.details || {},
      createdAt: numberValue(row.created_at),
    };
  });
}

export async function exportDocumentBundle(timelineId: string): Promise<BrowserTimelineBundle> {
  const [document, snapshots, workNodes, commits, checkoutRef] = await Promise.all([
    requireDocument(timelineId),
    listSnapshots(timelineId),
    listWorkNodes(timelineId),
    listWorkNodeCommits(timelineId),
    getCheckoutRef(timelineId),
  ]);
  return { document, snapshots, workNodes, commits, checkoutRef };
}

export async function importDocumentBundle(
  input: ImportDocumentBundleInput,
): Promise<{ document: TimelineDocument; snapshots: TimelineSnapshot[] }> {
  if (!input.document?.id || !input.document.label || !input.snapshots?.length) {
    fail(
      'invalid-timeline-document-bundle',
      400,
      'Timeline document bundle requires a document and at least one snapshot.',
    );
  }
  input = canonicalizeImportDocumentBundle(input).input;
  const createdAt = input.document.createdAt ?? Date.now();
  const snapshotRows = await Promise.all(input.snapshots.map(async (snapshot) => ({
    ...snapshot,
    createdAt: snapshot.createdAt ?? createdAt,
    payloadJson: serialize(snapshot.payload),
    payloadHash: await hashPayload(snapshot.payload),
  })));
  const statements: SqlStatement[] = [
    {
      sql: `
        INSERT INTO timeline_documents(id, label, created_at, updated_at, is_temporary)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          label = excluded.label,
          updated_at = excluded.updated_at,
          is_temporary = excluded.is_temporary
      `,
      bind: [
        input.document.id,
        input.document.label,
        createdAt,
        createdAt,
        input.document.isTemporary ? 1 : 0,
      ],
    },
  ];
  for (const snapshot of snapshotRows) {
    statements.push({
      sql: `
        INSERT INTO timeline_snapshots(
          id, timeline_id, label, payload_json, payload_hash, created_at, archived
        ) VALUES (?, ?, ?, ?, ?, ?, 0)
        ON CONFLICT(id) DO UPDATE SET
          label = excluded.label,
          payload_json = excluded.payload_json,
          payload_hash = excluded.payload_hash,
          archived = 0
        WHERE timeline_snapshots.timeline_id = excluded.timeline_id
      `,
      bind: [
        snapshot.id,
        input.document.id,
        snapshot.label,
        snapshot.payloadJson,
        snapshot.payloadHash,
        snapshot.createdAt,
      ],
    });
  }
  for (const node of input.workNodes || []) {
    const nodeCreatedAt = node.createdAt ?? createdAt;
    const nodeUpdatedAt = node.updatedAt ?? nodeCreatedAt;
    statements.push({
      sql: `
        INSERT INTO timeline_work_nodes(
          id, timeline_id, parent_node_id, branch_id, label, description, status,
          approval_policy, risk_flags_json, logs_json, base_payload_json,
          working_payload_json, content_revision, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          parent_node_id = excluded.parent_node_id,
          branch_id = excluded.branch_id,
          label = excluded.label,
          description = excluded.description,
          status = excluded.status,
          approval_policy = excluded.approval_policy,
          risk_flags_json = excluded.risk_flags_json,
          logs_json = excluded.logs_json,
          base_payload_json = excluded.base_payload_json,
          working_payload_json = excluded.working_payload_json,
          content_revision = excluded.content_revision,
          updated_at = excluded.updated_at
        WHERE timeline_work_nodes.timeline_id = excluded.timeline_id
      `,
      bind: [
        node.id,
        input.document.id,
        node.parentNodeId || null,
        node.branchId || node.id,
        node.label || node.id,
        node.description || '',
        normalizeStatus(node.status),
        normalizeApprovalPolicy(node.approvalPolicy),
        serialize(normalizeRiskFlags(node.riskFlags)),
        serialize(Array.isArray(node.logs) ? node.logs : []),
        serialize(node.basePayload),
        serialize(node.workingPayload),
        node.contentRevision ?? nodeUpdatedAt,
        nodeCreatedAt,
        nodeUpdatedAt,
      ],
    });
  }
  for (const commit of input.commits || []) {
    statements.push({
      sql: `
        INSERT INTO timeline_work_node_commits(
          id, node_id, timeline_id, branch_id, label, summary_json,
          risk_flags_json, approval_json, checkout_applied, checkout_json,
          base_payload_json, applied_payload_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          label = excluded.label,
          summary_json = excluded.summary_json,
          risk_flags_json = excluded.risk_flags_json,
          approval_json = excluded.approval_json,
          checkout_applied = excluded.checkout_applied,
          checkout_json = excluded.checkout_json
        WHERE timeline_work_node_commits.timeline_id = excluded.timeline_id
      `,
      bind: [
        commit.id,
        commit.nodeId,
        input.document.id,
        commit.branchId,
        commit.label,
        serialize(commit.summary),
        serialize(commit.riskFlags),
        serialize(commit.approval),
        commit.checkoutApplied ? 1 : 0,
        commit.checkout ? serialize(commit.checkout) : null,
        serialize(commit.basePayload),
        serialize(commit.appliedPayload),
        commit.createdAt,
      ],
    });
  }
  if (input.checkoutRef) {
    const checkoutTable = input.checkoutRef.targetType === 'snapshot'
      ? 'timeline_snapshots'
      : 'timeline_work_nodes';
    statements.push({
      sql: `
        INSERT INTO timeline_checkout_refs(timeline_id, target_type, target_id, updated_at)
        SELECT ?, ?, ?, ?
        WHERE EXISTS (
          SELECT 1 FROM ${checkoutTable}
          WHERE timeline_id = ? AND id = ?
        )
        ON CONFLICT(timeline_id) DO UPDATE SET
          target_type = excluded.target_type,
          target_id = excluded.target_id,
          updated_at = excluded.updated_at
        WHERE timeline_checkout_refs.timeline_id = excluded.timeline_id
      `,
      bind: [
        input.document.id,
        input.checkoutRef.targetType,
        input.checkoutRef.targetId,
        input.checkoutRef.updatedAt,
        input.document.id,
        input.checkoutRef.targetId,
      ],
    });
  }
  statements.push(auditStatement({
    timelineId: input.document.id,
    eventType: 'document.imported',
    subjectType: 'checkout',
    subjectId: input.checkoutRef?.targetId || input.snapshots[0].id,
    details: {
      snapshotCount: input.snapshots.length,
      workNodeCount: input.workNodes?.length || 0,
    },
    createdAt,
  }));
  await webDatabase.batch(statements);
  return {
    document: await requireDocument(input.document.id),
    snapshots: await listSnapshots(input.document.id),
  };
}

export async function archiveSnapshot(
  snapshotId: string,
  expectedTimelineId?: string,
): Promise<{ id: string; archived: boolean }> {
  const rows = await webDatabase.query<Row>(
    expectedTimelineId
      ? 'SELECT * FROM timeline_snapshots WHERE timeline_id = ? AND id = ? AND archived = 0'
      : 'SELECT * FROM timeline_snapshots WHERE id = ? AND archived = 0',
    expectedTimelineId ? [expectedTimelineId, snapshotId] : [snapshotId],
  );
  const snapshot = rows[0];
  if (!snapshot) {
    fail('timeline-snapshot-not-found', 404, `Timeline snapshot not found: ${snapshotId}`);
  }
  const timelineId = textValue(snapshot.timeline_id);
  if (expectedTimelineId && timelineId !== expectedTimelineId) {
    fail('timeline-snapshot-not-found', 404, `Timeline snapshot not found: ${snapshotId}`);
  }
  const checkout = await getCheckoutRef(timelineId);
  if (checkout?.targetType === 'snapshot' && checkout.targetId === snapshotId) {
    fail(
      'timeline-snapshot-current-checkout-protected',
      409,
      'Cannot delete the current timeline snapshot. Restore another target first.',
    );
  }
  const result = await batchWithRequiredChanges([
    {
      sql: `
        UPDATE timeline_snapshots
        SET archived = 1
        WHERE timeline_id = ? AND id = ? AND archived = 0
          AND NOT EXISTS (
            SELECT 1 FROM timeline_checkout_refs
            WHERE timeline_id = ? AND target_type = 'snapshot' AND target_id = ?
          )
      `,
      bind: [timelineId, snapshotId, timelineId, snapshotId],
      requireChanges: true,
    },
    auditStatement({
      timelineId,
      eventType: 'snapshot.archived',
      subjectType: 'snapshot',
      subjectId: snapshotId,
      details: { payloadHash: textValue(snapshot.payload_hash) },
      when: { sql: 'changes() > 0' },
    }),
  ], {
    code: 'timeline-snapshot-conflict',
    message: 'Timeline snapshot changed before it could be archived.',
    details: { timelineId, snapshotId },
  });
  if (!result.statementChanges[0]) {
    const currentCheckout = await getCheckoutRef(timelineId);
    if (currentCheckout?.targetType === 'snapshot' && currentCheckout.targetId === snapshotId) {
      fail(
        'timeline-snapshot-current-checkout-protected',
        409,
        'Cannot delete the current timeline snapshot. Restore another target first.',
      );
    }
    fail('timeline-snapshot-conflict', 409, 'Timeline snapshot changed before it could be archived.');
  }
  return { id: snapshotId, archived: true };
}

export async function deleteWorkNode(
  nodeId: string,
  expectedTimelineId?: string,
): Promise<{ deletedNodeIds: string[] }> {
  const targetRows = await webDatabase.query<Row>(
    expectedTimelineId
      ? 'SELECT id, timeline_id FROM timeline_work_nodes WHERE timeline_id = ? AND id = ?'
      : 'SELECT id, timeline_id FROM timeline_work_nodes WHERE id = ?',
    expectedTimelineId ? [expectedTimelineId, nodeId] : [nodeId],
  );
  const target = targetRows[0];
  if (!target) {
    fail('timeline-work-node-not-found', 404, `Timeline work node not found: ${nodeId}`);
  }
  const timelineId = textValue(target.timeline_id);
  const descendantRows = await webDatabase.query<Row>(
    `
      WITH RECURSIVE descendants(id) AS (
        SELECT id FROM timeline_work_nodes WHERE timeline_id = ? AND id = ?
        UNION ALL
        SELECT node.id FROM timeline_work_nodes node
        JOIN descendants parent
          ON node.timeline_id = ? AND node.parent_node_id = parent.id
      )
      SELECT id FROM descendants
    `,
    [timelineId, nodeId, timelineId],
  );
  const deletedNodeIds = descendantRows.map((row) => textValue(row.id));
  const checkout = await getCheckoutRef(timelineId);
  if (checkout?.targetType === 'work-node' && deletedNodeIds.includes(checkout.targetId)) {
    fail(
      'timeline-work-node-current-checkout-protected',
      409,
      'Cannot delete the current Work Node path. Checkout another target first.',
    );
  }
  const placeholders = deletedNodeIds.map(() => '?').join(', ');
  const result = await batchWithRequiredChanges([
    {
      sql: `
        DELETE FROM timeline_work_nodes
        WHERE timeline_id = ? AND id IN (${placeholders})
          AND NOT EXISTS (
            SELECT 1 FROM timeline_checkout_refs
            WHERE timeline_id = ? AND target_type = 'work-node' AND target_id IN (${placeholders})
          )
      `,
      bind: [timelineId, ...deletedNodeIds, timelineId, ...deletedNodeIds],
      requireChanges: true,
    },
    auditStatement({
      timelineId,
      eventType: 'work-node.deleted',
      subjectType: 'work-node',
      subjectId: nodeId,
      details: { deletedNodeIds },
      when: { sql: 'changes() > 0' },
    }),
  ], {
    code: 'timeline-work-node-conflict',
    message: 'Timeline Work Node changed before it could be deleted.',
    details: { timelineId, nodeId },
  });
  if (!result.statementChanges[0]) {
    const currentCheckout = await getCheckoutRef(timelineId);
    if (currentCheckout?.targetType === 'work-node' && deletedNodeIds.includes(currentCheckout.targetId)) {
      fail(
        'timeline-work-node-current-checkout-protected',
        409,
        'Cannot delete the current Work Node path. Checkout another target first.',
      );
    }
    fail('timeline-work-node-conflict', 409, 'Timeline Work Node changed before it could be deleted.');
  }
  return { deletedNodeIds };
}

export async function deleteDocument(timelineId: string): Promise<{
  document: TimelineDocument;
  deletedNodeIds: string[];
  deletedSnapshotCount: number;
}> {
  const document = await requireDocument(timelineId);
  const [nodes, snapshotRows] = await Promise.all([
    listWorkNodes(timelineId),
    webDatabase.query<Row>(
      'SELECT COUNT(*) AS count FROM timeline_snapshots WHERE timeline_id = ?',
      [timelineId],
    ),
  ]);
  await webDatabase.execute('DELETE FROM timeline_documents WHERE id = ?', [timelineId]);
  return {
    document,
    deletedNodeIds: nodes.map((node) => node.id),
    deletedSnapshotCount: numberValue(snapshotRows[0]?.count),
  };
}

export async function listAllWorkNodes(): Promise<BrowserTimelineWorkNode[]> {
  const rows = await webDatabase.query<Row>(
    'SELECT * FROM timeline_work_nodes ORDER BY updated_at DESC',
  );
  return rows.map(workNodeFromRow);
}

export async function listAllWorkNodeCommits(): Promise<AiTimelineWorkNodeCommit[]> {
  const rows = await webDatabase.query<Row>(
    'SELECT * FROM timeline_work_node_commits ORDER BY created_at DESC',
  );
  return rows.map(commitFromRow);
}

export async function getWorkNode(
  id: string,
  timelineId?: string,
): Promise<BrowserTimelineWorkNode> {
  const row = await getWorkNodeRow(id, timelineId);
  if (!row) {
    fail('ai-worknode-not-found', 404, `AI timeline work node not found: ${id}`);
  }
  return workNodeFromRow(row);
}

async function assertParent(
  timelineId: string,
  parentNodeId: string | null | undefined,
  nodeId?: string,
): Promise<void> {
  if (!parentNodeId) return;
  if (parentNodeId === nodeId) {
    fail(
      'timeline-work-node-parent-cycle',
      409,
      'Timeline Work Node cannot be its own parent.',
    );
  }
  const parentRows = await webDatabase.query<Row>(
    'SELECT timeline_id FROM timeline_work_nodes WHERE timeline_id = ? AND id = ?',
    [timelineId, parentNodeId],
  );
  if (!parentRows[0]) {
    fail(
      'timeline-work-node-parent-not-found',
      404,
      `Timeline Work Node parent not found: ${parentNodeId}`,
    );
  }
  if (textValue(parentRows[0].timeline_id) !== timelineId) {
    fail(
      'timeline-work-node-cross-document-parent',
      409,
      'Timeline Work Node parent must belong to the same document.',
    );
  }
  if (!nodeId) return;
  const descendants = await webDatabase.query<Row>(
    `
      WITH RECURSIVE tree(id) AS (
        SELECT id FROM timeline_work_nodes
        WHERE timeline_id = ? AND parent_node_id = ?
        UNION ALL
        SELECT node.id FROM timeline_work_nodes node
        JOIN tree parent
          ON node.timeline_id = ? AND node.parent_node_id = parent.id
      )
      SELECT 1 AS found FROM tree WHERE id = ? LIMIT 1
    `,
    [timelineId, nodeId, timelineId, parentNodeId],
  );
  if (descendants[0]) {
    fail(
      'timeline-work-node-parent-cycle',
      409,
      'Timeline Work Node parent would create a cycle.',
    );
  }
}

function assertPayload(payload: TimelineSnapshotPayload, fieldName: string): void {
  const validation = validateTimelinePayload(payload);
  if (!validation.ok) {
    fail(
      `invalid-ai-worknode-${fieldName.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`,
      400,
      validation.issues.map((issue) => issue.message).join('；'),
      { issues: validation.issues },
    );
  }
}

export type CreateBrowserWorkNodeInput = {
  timelineId: string;
  branchId?: string;
  id?: string;
  parentNodeId?: string | null;
  label?: string;
  description?: string;
  basePayload: TimelineSnapshotPayload;
  workingPayload?: TimelineSnapshotPayload;
  approvalPolicy?: AiTimelineApprovalPolicy;
  riskFlags?: AiTimelineRiskFlag[];
};

export async function createWorkNode(
  input: CreateBrowserWorkNodeInput,
): Promise<BrowserTimelineWorkNode> {
  if (!input.timelineId?.trim()) {
    fail(
      'missing-ai-worknode-timeline-id',
      400,
      'AI work node create requires timelineId.',
    );
  }
  await requireDocument(input.timelineId);
  assertPayload(input.basePayload, 'basePayload');
  const workingPayload = input.workingPayload || input.basePayload;
  assertPayload(workingPayload, 'workingPayload');
  const hasParent = Object.prototype.hasOwnProperty.call(input, 'parentNodeId');
  const checkout = hasParent ? null : await getCheckoutRef(input.timelineId);
  const parentNodeId = hasParent
    ? input.parentNodeId || undefined
    : checkout?.targetType === 'work-node' ? checkout.targetId : undefined;
  await assertParent(input.timelineId, parentNodeId);
  const id = input.id?.trim() || makeId('ai-timeline-node');
  if (await getWorkNodeRow(id)) {
    fail(
      'timeline-work-node-id-conflict',
      409,
      `Timeline Work Node id already exists: ${id}`,
    );
  }
  const now = Date.now();
  const logs = [makeLog('info', '已从当前 checkout 创建排轴工作节点。')];
  await webDatabase.batch([
    {
      sql: `
        INSERT INTO timeline_work_nodes(
          id, timeline_id, parent_node_id, branch_id, label, description, status,
          approval_policy, risk_flags_json, logs_json, base_payload_json,
          working_payload_json, content_revision, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      bind: [
        id,
        input.timelineId,
        parentNodeId || null,
        input.branchId?.trim() || makeId('branch'),
        input.label?.trim().slice(0, 120) || '排轴工作节点',
        input.description?.trim().slice(0, 240) || '',
        normalizeApprovalPolicy(input.approvalPolicy),
        serialize(normalizeRiskFlags(input.riskFlags)),
        serialize(logs),
        serialize(input.basePayload),
        serialize(workingPayload),
        now,
        now,
        now,
      ],
    },
    {
      sql: 'UPDATE timeline_documents SET updated_at = ? WHERE id = ?',
      bind: [now, input.timelineId],
    },
    auditStatement({
      timelineId: input.timelineId,
      eventType: 'work-node.created',
      subjectType: 'work-node',
      subjectId: id,
      details: { parentNodeId: parentNodeId || null },
      createdAt: now,
    }),
  ]);
  return getWorkNode(id);
}

export type UpdateBrowserWorkNodeInput = {
  parentNodeId?: string;
  label?: string;
  description?: string;
  workingPayload?: TimelineSnapshotPayload;
  expectedContentRevision?: number;
  status?: AiTimelineWorkNodeStatus;
  riskFlags?: AiTimelineRiskFlag[];
};

export async function updateWorkNode(
  id: string,
  input: UpdateBrowserWorkNodeInput,
): Promise<BrowserTimelineWorkNode> {
  const node = await getWorkNode(id);
  const hasPayload = Object.prototype.hasOwnProperty.call(input, 'workingPayload');
  if (hasPayload) {
    if (!Number.isFinite(input.expectedContentRevision)) {
      fail(
        'ai-worknode-content-revision-required',
        409,
        'Replacing a Work Node working payload requires expectedContentRevision.',
      );
    }
    if (input.expectedContentRevision !== node.contentRevision) {
      fail(
        'ai-worknode-content-revision-conflict',
        409,
        'Work Node content changed before this payload update could be applied.',
      );
    }
    assertPayload(input.workingPayload!, 'workingPayload');
  }
  const hasParent = Object.prototype.hasOwnProperty.call(input, 'parentNodeId');
  if (hasParent) await assertParent(node.timelineId, input.parentNodeId, node.id);
  if (input.status && !WORK_NODE_STATUSES.has(input.status)) {
    fail(
      'invalid-timeline-work-node-status',
      400,
      `Unsupported AI Work Node status: ${String(input.status)}`,
    );
  }
  const workingPayload = input.workingPayload || node.workingPayload;
  const contentChanged = serialize(workingPayload) !== serialize(node.workingPayload);
  const updatedAt = Math.max(Date.now(), node.updatedAt + 1);
  const nextRevision = contentChanged ? node.contentRevision + 1 : node.contentRevision;
  const expectedRevision = hasPayload ? input.expectedContentRevision! : node.contentRevision;
  const riskFlags = Object.prototype.hasOwnProperty.call(input, 'riskFlags')
    ? normalizeRiskFlags(input.riskFlags)
    : node.riskFlags;
  const logs = [
    makeLog('info', contentChanged ? '已更新工作节点内容。' : '已更新工作节点元数据。'),
    ...node.logs,
  ];
  const statements: SqlStatement[] = [
    {
      sql: `
        UPDATE timeline_work_nodes SET
          parent_node_id = ?,
          label = ?,
          description = ?,
          status = ?,
          risk_flags_json = ?,
          logs_json = ?,
          working_payload_json = ?,
          content_revision = ?,
          updated_at = ?
        WHERE timeline_id = ? AND id = ?
          AND content_revision = ? AND updated_at = ?
      `,
      bind: [
        hasParent ? input.parentNodeId || null : node.parentNodeId || null,
        input.label?.trim().slice(0, 120) || node.label,
        Object.prototype.hasOwnProperty.call(input, 'description')
          ? input.description?.trim().slice(0, 240) || ''
          : node.description,
        input.status || node.status,
        serialize(riskFlags),
        serialize(logs),
        serialize(workingPayload),
        nextRevision,
        updatedAt,
        node.timelineId,
        id,
        expectedRevision,
        node.updatedAt,
      ],
      requireChanges: true,
    },
    {
      sql: `
        UPDATE timeline_documents SET updated_at = ?
        WHERE id = ? AND changes() > 0
      `,
      bind: [updatedAt, node.timelineId],
    },
    auditStatement({
      timelineId: node.timelineId,
      eventType: 'work-node.updated',
      subjectType: 'work-node',
      subjectId: id,
      details: { contentChanged, contentRevision: nextRevision },
      createdAt: updatedAt,
      when: { sql: 'changes() > 0' },
    }),
  ];
  if (contentChanged) {
    const diff = diffTimelinePayloads(node.workingPayload, workingPayload);
    const validation = validateTimelinePayload(workingPayload);
    statements.push({
      sql: `
        INSERT INTO timeline_work_node_patches(
          id, timeline_id, node_id, patch_json, validation_json,
          diff_summary_json, risk_flags_json, created_at
        )
        SELECT ?, ?, ?, ?, ?, ?, ?, ?
        WHERE changes() > 0 AND EXISTS (
          SELECT 1 FROM timeline_work_nodes
          WHERE timeline_id = ? AND id = ?
            AND content_revision = ? AND updated_at = ?
        )
      `,
      bind: [
        makeId('timeline-patch'),
        node.timelineId,
        id,
        serialize([{ op: 'replace', path: '/', revision: nextRevision }]),
        serialize(validation),
        serialize(diff.summary),
        serialize(riskFlags),
        updatedAt,
        node.timelineId,
        id,
        nextRevision,
        updatedAt,
      ],
    });
  }
  const result = await batchWithRequiredChanges(statements, {
    code: 'ai-worknode-content-revision-conflict',
    message: 'Work Node changed before this update could be applied.',
    details: { timelineId: node.timelineId, nodeId: id, expectedContentRevision: expectedRevision },
  });
  if (!result.statementChanges[0]) {
    fail(
      'ai-worknode-content-revision-conflict',
      409,
      'Work Node changed before this update could be applied.',
      { timelineId: node.timelineId, nodeId: id, expectedContentRevision: expectedRevision },
    );
  }
  return getWorkNode(id, node.timelineId);
}

export async function diffWorkNode(id: string): Promise<{
  node: BrowserTimelineWorkNode;
  diff: TimelinePayloadDiff;
  riskFlags: AiTimelineRiskFlag[];
  readyToCheckout: boolean;
  checkoutDecision: AiTimelineCheckoutDecision;
}> {
  const node = await getWorkNode(id);
  const diff = diffTimelinePayloads(node.basePayload, node.workingPayload);
  const checkoutDecision = buildAiTimelineCheckoutDecision({
    approvalPolicy: node.approvalPolicy,
    riskFlags: node.riskFlags,
    diff,
  }) as AiTimelineCheckoutDecision;
  return {
    node,
    diff,
    riskFlags: node.riskFlags,
    readyToCheckout:
      checkoutDecision.canAutoApprove || !checkoutDecision.requiresManualApproval,
    checkoutDecision,
  };
}

function normalizeApproval(
  input: AiTimelineApproval | undefined,
  fallbackMode: 'auto' | 'manual',
): AiTimelineApproval {
  const mode = input?.mode === 'manual' ? 'manual' : fallbackMode;
  return {
    mode,
    approvedAt: Number.isFinite(input?.approvedAt) ? input!.approvedAt : Date.now(),
    approvedBy: input?.approvedBy || (mode === 'manual' ? 'user' : 'system'),
    rationale: input?.rationale?.trim()
      || (mode === 'manual'
        ? '用户明确批准了该排轴工作节点。'
        : '低风险策略自动批准了该排轴工作节点。'),
  };
}

export type CommitBrowserWorkNodeInput = {
  commitId?: string;
  label?: string;
  riskFlags?: AiTimelineRiskFlag[];
  approval?: AiTimelineApproval;
};

export async function commitWorkNode(
  id: string,
  input: CommitBrowserWorkNodeInput = {},
): Promise<{ node: BrowserTimelineWorkNode; commit: AiTimelineWorkNodeCommit }> {
  const node = await getWorkNode(id);
  const riskFlags = Object.prototype.hasOwnProperty.call(input, 'riskFlags')
    ? normalizeRiskFlags(input.riskFlags)
    : node.riskFlags;
  const explicitApproval = Boolean(input.approval);
  if (node.approvalPolicy === 'manual' && !explicitApproval) {
    fail(
      'ai-worknode-requires-manual-approval',
      409,
      'Manual approval policy requires explicit approval before commit.',
    );
  }
  if (riskFlags.some((risk) => risk.severity === 'blocker') && !explicitApproval) {
    fail(
      'ai-worknode-blocked-by-risk',
      409,
      'Blocker risk flags require explicit approval before commit.',
      { riskFlags },
    );
  }
  const commitId = input.commitId?.trim() || makeId('ai-timeline-commit');
  const existing = await webDatabase.query<Row>(
    'SELECT id FROM timeline_work_node_commits WHERE timeline_id = ? AND id = ?',
    [node.timelineId, commitId],
  );
  if (existing[0]) {
    fail(
      'ai-worknode-commit-id-conflict',
      409,
      `AI Work Node commit id already exists: ${commitId}`,
    );
  }
  const createdAt = Math.max(Date.now(), node.updatedAt + 1);
  const approval = normalizeApproval(
    input.approval,
    explicitApproval ? 'manual' : 'auto',
  );
  const commit: AiTimelineWorkNodeCommit = {
    id: commitId,
    nodeId: node.id,
    timelineId: node.timelineId,
    branchId: node.branchId,
    createdAt,
    label: input.label?.trim() || node.label,
    summary: diffTimelinePayloads(node.basePayload, node.workingPayload).summary,
    basePayload: node.basePayload,
    appliedPayload: node.workingPayload,
    riskFlags,
    approval,
    checkoutApplied: false,
  };
  const logs = [
    makeLog('info', `已提交工作节点：${commit.id}`),
    ...node.logs,
  ];
  const result = await batchWithRequiredChanges([
    {
      sql: `
        UPDATE timeline_work_nodes
        SET status = 'committed', risk_flags_json = ?, logs_json = ?, updated_at = ?
        WHERE timeline_id = ? AND id = ?
          AND content_revision = ? AND updated_at = ?
      `,
      bind: [
        serialize(riskFlags),
        serialize(logs),
        createdAt,
        node.timelineId,
        id,
        node.contentRevision,
        node.updatedAt,
      ],
      requireChanges: true,
    },
    {
      sql: `
        INSERT INTO timeline_work_node_commits(
          id, node_id, timeline_id, branch_id, label, summary_json,
          risk_flags_json, approval_json, checkout_applied, checkout_json,
          base_payload_json, applied_payload_json, created_at
        )
        SELECT ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, ?, ?
        WHERE changes() > 0
      `,
      bind: [
        commit.id,
        commit.nodeId,
        commit.timelineId,
        commit.branchId,
        commit.label,
        serialize(commit.summary),
        serialize(commit.riskFlags),
        serialize(commit.approval),
        serialize(commit.basePayload),
        serialize(commit.appliedPayload),
        commit.createdAt,
      ],
    },
    auditStatement({
      timelineId: node.timelineId,
      eventType: 'work-node.committed',
      subjectType: 'work-node',
      subjectId: id,
      details: { commitId },
      createdAt,
      when: { sql: 'changes() > 0' },
    }),
  ], {
    code: 'ai-worknode-content-revision-conflict',
    message: 'Work Node changed before this commit could be applied.',
    details: { timelineId: node.timelineId, nodeId: id, expectedContentRevision: node.contentRevision },
  });
  if (!result.statementChanges[0]) {
    fail(
      'ai-worknode-content-revision-conflict',
      409,
      'Work Node changed before this commit could be applied.',
      { timelineId: node.timelineId, nodeId: id, expectedContentRevision: node.contentRevision },
    );
  }
  return { node: await getWorkNode(id, node.timelineId), commit };
}

export async function markWorkNodeCheckoutApplied(
  id: string,
  input: {
    commitId?: string;
    appliedAt?: number;
    appliedBy?: 'ai' | 'user' | 'system';
    rationale?: string;
  } = {},
): Promise<{ node: BrowserTimelineWorkNode; commit: AiTimelineWorkNodeCommit }> {
  const node = await getWorkNode(id);
  const rows = input.commitId
    ? await webDatabase.query<Row>(
      `
        SELECT * FROM timeline_work_node_commits
        WHERE timeline_id = ? AND id = ? AND node_id = ?
      `,
      [node.timelineId, input.commitId, id],
    )
    : await webDatabase.query<Row>(
      `
        SELECT * FROM timeline_work_node_commits
        WHERE timeline_id = ? AND node_id = ?
        ORDER BY created_at DESC LIMIT 1
      `,
      [node.timelineId, id],
    );
  if (!rows[0]) {
    fail(
      'ai-worknode-commit-not-found',
      404,
      `AI timeline work node commit not found for node: ${id}`,
    );
  }
  const commit = commitFromRow(rows[0]);
  const appliedAt = Math.max(input.appliedAt ?? Date.now(), node.updatedAt + 1);
  const checkout: AiTimelineCheckout = {
    appliedAt,
    appliedBy: input.appliedBy || 'system',
    rationale: input.rationale?.trim()
      || '排轴工作节点已应用到当前浏览器工作区。',
  };
  const logs = [
    makeLog('info', `已应用工作节点 checkout：${commit.id}`),
    ...node.logs,
  ];
  const observedCheckout = await getCheckoutRef(node.timelineId);
  const checkoutStatement: SqlStatement = observedCheckout
    ? {
      sql: `
        INSERT INTO timeline_checkout_refs(timeline_id, target_type, target_id, updated_at)
        SELECT ?, 'work-node', ?, ?
        WHERE EXISTS (
          SELECT 1 FROM timeline_checkout_refs
          WHERE timeline_id = ? AND target_type = ? AND target_id = ? AND updated_at = ?
        )
        AND EXISTS (
          SELECT 1 FROM timeline_work_node_commits
          WHERE timeline_id = ? AND id = ? AND node_id = ?
        )
        AND EXISTS (
          SELECT 1 FROM timeline_work_nodes
          WHERE timeline_id = ? AND id = ?
            AND content_revision = ? AND updated_at = ?
        )
        ON CONFLICT(timeline_id) DO UPDATE SET
          target_type = excluded.target_type,
          target_id = excluded.target_id,
          updated_at = excluded.updated_at
        WHERE timeline_checkout_refs.target_type = ?
          AND timeline_checkout_refs.target_id = ?
          AND timeline_checkout_refs.updated_at = ?
      `,
      bind: [
        node.timelineId,
        id,
        appliedAt,
        node.timelineId,
        observedCheckout.targetType,
        observedCheckout.targetId,
        observedCheckout.updatedAt,
        node.timelineId,
        commit.id,
        id,
        node.timelineId,
        id,
        node.contentRevision,
        node.updatedAt,
        observedCheckout.targetType,
        observedCheckout.targetId,
        observedCheckout.updatedAt,
      ],
    }
    : {
      sql: `
        INSERT INTO timeline_checkout_refs(timeline_id, target_type, target_id, updated_at)
        SELECT ?, 'work-node', ?, ?
        WHERE NOT EXISTS (
          SELECT 1 FROM timeline_checkout_refs WHERE timeline_id = ?
        )
        AND EXISTS (
          SELECT 1 FROM timeline_work_node_commits
          WHERE timeline_id = ? AND id = ? AND node_id = ?
        )
        AND EXISTS (
          SELECT 1 FROM timeline_work_nodes
          WHERE timeline_id = ? AND id = ?
            AND content_revision = ? AND updated_at = ?
        )
      `,
      bind: [
        node.timelineId,
        id,
        appliedAt,
        node.timelineId,
        node.timelineId,
        commit.id,
        id,
        node.timelineId,
        id,
        node.contentRevision,
        node.updatedAt,
      ],
    };
  checkoutStatement.requireChanges = true;
  const result = await batchWithRequiredChanges([
    checkoutStatement,
    {
      sql: `
        UPDATE timeline_work_node_commits
        SET checkout_applied = 1, checkout_json = ?
        WHERE timeline_id = ? AND id = ? AND node_id = ?
          AND changes() > 0
      `,
      bind: [serialize(checkout), node.timelineId, commit.id, id],
    },
    {
      sql: `
        UPDATE timeline_work_nodes
        SET status = 'applied', logs_json = ?, updated_at = ?
        WHERE timeline_id = ? AND id = ?
          AND content_revision = ? AND updated_at = ? AND changes() > 0
      `,
      bind: [serialize(logs), appliedAt, node.timelineId, id, node.contentRevision, node.updatedAt],
      requireChanges: true,
    },
    {
      sql: `
        UPDATE timeline_documents SET updated_at = ?
        WHERE id = ? AND changes() > 0
      `,
      bind: [appliedAt, node.timelineId],
    },
    auditStatement({
      timelineId: node.timelineId,
      eventType: 'checkout.updated',
      subjectType: 'checkout',
      subjectId: id,
      details: { targetType: 'work-node', commitId: commit.id },
      createdAt: appliedAt,
      when: { sql: 'changes() > 0' },
    }),
  ], {
    code: 'timeline-checkout-conflict',
    message: 'Timeline checkout changed before the Work Node could be applied.',
    details: { timelineId: node.timelineId, nodeId: id, expected: observedCheckout },
  });
  if (!result.statementChanges[0]) {
    fail(
      'timeline-checkout-conflict',
      409,
      'Timeline checkout changed before the Work Node could be applied.',
      { timelineId: node.timelineId, nodeId: id, expected: observedCheckout },
    );
  }
  return {
    node: await getWorkNode(id, node.timelineId),
    commit: { ...commit, checkoutApplied: true, checkout },
  };
}

export async function markWorkNodeRollbackApplied(
  id: string,
  input: {
    appliedAt?: number;
    appliedBy?: 'ai' | 'user' | 'system';
    rationale?: string;
    checkout?: {
      targetType: 'snapshot' | 'work-node';
      targetId: string;
      updatedAt: number;
    };
    basePayloadDigest?: string;
    baseRevision?: number;
  } = {},
): Promise<BrowserTimelineWorkNode> {
  const node = await getWorkNode(id);
  const appliedAt = Math.max(input.appliedAt ?? Date.now(), node.updatedAt + 1);
  if (Number.isSafeInteger(input.baseRevision) && input.baseRevision !== node.contentRevision) {
    fail(
      'ai-worknode-content-revision-conflict',
      409,
      'Work Node changed before its base payload could be restored.',
      { expectedContentRevision: input.baseRevision, actualContentRevision: node.contentRevision },
    );
  }
  const logs = [
    makeLog('info', '已从工作节点 base payload 恢复当前工作区。'),
    ...node.logs,
  ];
  const result = await batchWithRequiredChanges([
    {
      sql: `
        UPDATE timeline_work_nodes
        SET status = 'ready', logs_json = ?, updated_at = ?
        WHERE timeline_id = ? AND id = ?
          AND content_revision = ? AND updated_at = ?
      `,
      bind: [serialize(logs), appliedAt, node.timelineId, id, node.contentRevision, node.updatedAt],
      requireChanges: true,
    },
    auditStatement({
      timelineId: node.timelineId,
      eventType: 'work-node.base-restored',
      subjectType: 'work-node',
      subjectId: id,
      details: {
        appliedBy: input.appliedBy || 'system',
        rationale: input.rationale || '从工作节点 base payload 恢复。',
        ...(input.checkout ? { checkout: input.checkout } : {}),
        ...(input.basePayloadDigest ? { basePayloadDigest: input.basePayloadDigest } : {}),
        ...(Number.isSafeInteger(input.baseRevision) ? { baseRevision: input.baseRevision } : {}),
      },
      createdAt: appliedAt,
      when: { sql: 'changes() > 0' },
    }),
  ], {
    code: 'ai-worknode-content-revision-conflict',
    message: 'Work Node changed before its base payload could be restored.',
    details: { timelineId: node.timelineId, nodeId: id, expectedContentRevision: node.contentRevision },
  });
  if (!result.statementChanges[0]) {
    fail(
      'ai-worknode-content-revision-conflict',
      409,
      'Work Node changed before its base payload could be restored.',
      { timelineId: node.timelineId, nodeId: id, expectedContentRevision: node.contentRevision },
    );
  }
  return getWorkNode(id, node.timelineId);
}

export async function listWorkNodeHeads(): Promise<{
  heads: Record<string, { nodeId: string; revision: number }>;
  headNodeId: string;
  revision: number;
}> {
  const rows = await webDatabase.query<Row>(
    `
      SELECT document.id AS timeline_id, checkout.target_type, checkout.target_id,
             checkout.updated_at AS checkout_updated_at,
             node.id AS head_node_id,
             node.content_revision AS node_content_revision
      FROM timeline_documents document
      LEFT JOIN timeline_checkout_refs checkout ON checkout.timeline_id = document.id
      LEFT JOIN timeline_work_nodes node
        ON node.timeline_id = document.id
        AND checkout.target_type = 'work-node'
        AND node.id = checkout.target_id
    `,
  );
  const heads = Object.fromEntries(rows.map((row) => [
    textValue(row.timeline_id),
    {
      nodeId: textValue(row.target_type) === 'work-node' ? textValue(row.head_node_id) : '',
      revision: textValue(row.target_type) === 'work-node' && textValue(row.head_node_id)
        ? numberValue(row.node_content_revision)
        : 0,
    },
  ]));
  const latestRow = [...rows]
    .filter((row) => textValue(row.target_type) === 'work-node' && textValue(row.head_node_id))
    .sort((left, right) => numberValue(right.checkout_updated_at) - numberValue(left.checkout_updated_at))[0];
  const latestTimelineId = textValue(latestRow?.timeline_id);
  const latest = latestTimelineId ? heads[latestTimelineId] : undefined;
  return {
    heads,
    headNodeId: latest?.nodeId ?? '',
    revision: latest?.revision ?? 0,
  };
}

function resolveBundlePayload(bundle: BrowserTimelineBundle): {
  payload: TimelineSnapshotPayload | null;
  checkoutRef: TimelineCheckoutRef | null;
} {
  const checkoutRef = bundle.checkoutRef;
  if (checkoutRef?.targetType === 'work-node') {
    const node = bundle.workNodes.find((entry) => entry.id === checkoutRef.targetId);
    if (node) return { payload: node.workingPayload, checkoutRef };
  }
  if (checkoutRef?.targetType === 'snapshot') {
    const snapshot = bundle.snapshots.find((entry) => entry.id === checkoutRef.targetId);
    if (snapshot?.payload) return { payload: snapshot.payload, checkoutRef };
  }
  const newestSnapshot = [...bundle.snapshots].sort((left, right) => right.createdAt - left.createdAt)[0];
  if (newestSnapshot?.payload) {
    return {
      payload: newestSnapshot.payload,
      checkoutRef: {
        timelineId: bundle.document.id,
        targetType: 'snapshot',
        targetId: newestSnapshot.id,
        updatedAt: newestSnapshot.createdAt,
      },
    };
  }
  return { payload: null, checkoutRef: null };
}

function archiveFromRow(row: Row): BrowserTimelineArchiveSummary {
  const library = textValue(row.library) === 'shared' ? 'shared' : 'local';
  const bundle = parseJson<BrowserTimelineBundle | null>(row.bundle_json, null);
  return {
    archiveId: textValue(row.archive_id),
    label: textValue(row.label),
    source: library,
    library,
    archiveVersion: 1,
    createdAt: textValue(row.created_at),
    ...(textValue(row.payload_hash) ? { payloadHash: textValue(row.payload_hash) } : {}),
    summary: parseJson<TimelinePayloadSummary>(row.summary_json, {
      characterCount: 0,
      buttonCount: 0,
      buffCount: 0,
    }),
    nodeCount: numberValue(row.node_count),
    hasCurrentNode: bundle?.checkoutRef?.targetType === 'work-node',
  };
}

async function readArchive(
  library: TimelineArchiveLibrary,
  archiveId: string,
): Promise<{
  summary: BrowserTimelineArchiveSummary;
  bundle: BrowserTimelineBundle;
  compatibility: TimelinePayloadCompatibilityRepair[];
}> {
  const rows = await webDatabase.query<Row>(
    'SELECT * FROM timeline_archives WHERE archive_id = ? AND library = ?',
    [archiveId, library],
  );
  if (!rows[0]) {
    fail(
      'timeline-archive-not-found',
      404,
      `Timeline archive not found: ${archiveId}`,
    );
  }
  const bundle = parseJson<BrowserTimelineBundle | null>(rows[0].bundle_json, null);
  if (!bundle) {
    fail(
      'invalid-timeline-archive',
      400,
      `Timeline archive payload is invalid: ${archiveId}`,
    );
  }
  const canonical = canonicalizeBrowserTimelineBundle(
    bundle,
    `存档 ${textValue(rows[0].label, archiveId)}`,
  );
  return {
    summary: archiveFromRow(rows[0]),
    bundle: canonical.bundle,
    compatibility: canonical.repairs,
  };
}

async function storeArchive(input: {
  library: TimelineArchiveLibrary;
  label: string;
  bundle: BrowserTimelineBundle;
  archiveId?: string;
  createdAt?: string;
}): Promise<BrowserTimelineArchiveSummary> {
  const canonical = canonicalizeBrowserTimelineBundle(input.bundle, `存档 ${input.label}`);
  input = { ...input, bundle: canonical.bundle };
  const resolved = resolveBundlePayload(input.bundle);
  if (!resolved.payload) {
    fail(
      'timeline-archive-has-no-payload',
      409,
      'Timeline archive requires at least one checkout payload.',
    );
  }
  const archiveId = input.archiveId || makeId('timeline-archive');
  const createdAt = input.createdAt || new Date().toISOString();
  const payloadHash = await hashPayload(resolved.payload);
  const summary = summarizeTimelinePayload(resolved.payload);
  await webDatabase.execute(
    `
      INSERT INTO timeline_archives(
        archive_id, library, label, bundle_json, payload_hash,
        summary_json, node_count, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(archive_id) DO UPDATE SET
        library = excluded.library,
        label = excluded.label,
        bundle_json = excluded.bundle_json,
        payload_hash = excluded.payload_hash,
        summary_json = excluded.summary_json,
        node_count = excluded.node_count,
        created_at = excluded.created_at
    `,
    [
      archiveId,
      input.library,
      input.label,
      serialize(input.bundle),
      payloadHash,
      serialize(summary),
      input.bundle.workNodes.length,
      createdAt,
    ],
  );
  const rows = await webDatabase.query<Row>(
    'SELECT * FROM timeline_archives WHERE archive_id = ?',
    [archiveId],
  );
  return archiveFromRow(rows[0]);
}

function legacyTimelineArchiveToBundle(
  archive: LegacyTimelineArchive,
): BrowserTimelineBundle {
  if (
    archive?.type !== 'dmg.timeline-archive.v1'
    || archive.archiveVersion !== 1
    || !archive.archiveId?.trim()
    || !archive.label?.trim()
    || !archive.payload
    || typeof archive.payload !== 'object'
  ) {
    fail(
      'invalid-timeline-archive',
      400,
      '排轴存档类型、版本或内容无效。',
    );
  }
  const createdAt = Date.parse(archive.createdAt) || Date.now();
  const timelineId = archive.archiveId;
  const snapshotId = `${timelineId}-snapshot`;
  const nodes = Array.isArray(archive.worktree?.nodes)
    ? archive.worktree.nodes
    : [];
  const workNodes: BrowserTimelineWorkNode[] = nodes
    .filter((node) => (
      Boolean(node?.id?.trim())
      && Boolean(node.basePayload)
      && Boolean(node.workingPayload)
    ))
    .map((node) => {
      const nodeCreatedAt = Number(node.createdAt) || createdAt;
      const nodeUpdatedAt = typeof node.updatedAt === 'number' && Number.isFinite(node.updatedAt)
        ? node.updatedAt
        : nodeCreatedAt;
      return {
        id: node.id.trim(),
        ...(node.parentNodeId?.trim() ? { parentNodeId: node.parentNodeId.trim() } : {}),
        timelineId,
        branchId: node.branchId?.trim() || node.id.trim(),
        label: node.label?.trim() || node.id.trim(),
        description: node.description || '',
        status: normalizeStatus(node.status),
        approvalPolicy: normalizeApprovalPolicy(node.approvalPolicy),
        riskFlags: normalizeRiskFlags(node.riskFlags),
        logs: Array.isArray(node.logs)
          ? node.logs as BrowserTimelineWorkNode['logs']
          : [],
        basePayload: node.basePayload,
        workingPayload: node.workingPayload,
        baseSummary: summarizeTimelinePayload(node.basePayload),
        workingSummary: summarizeTimelinePayload(node.workingPayload),
        contentRevision: typeof node.contentRevision === 'number' && Number.isFinite(node.contentRevision)
          ? node.contentRevision
          : nodeUpdatedAt,
        createdAt: nodeCreatedAt,
        updatedAt: nodeUpdatedAt,
      };
    });
  const currentNodeId = archive.worktree?.currentNodeId;
  const hasCurrentNode = Boolean(
    currentNodeId && workNodes.some((node) => node.id === currentNodeId),
  );
  return {
    document: {
      id: timelineId,
      label: archive.label.trim(),
      isTemporary: false,
      createdAt,
      updatedAt: createdAt,
      archivedAt: null,
    },
    snapshots: [{
      id: snapshotId,
      timelineId,
      label: archive.label.trim(),
      payloadHash: '',
      createdAt,
      archivedAt: null,
      payload: archive.payload,
    }],
    workNodes,
    commits: [],
    checkoutRef: hasCurrentNode
      ? {
        timelineId,
        targetType: 'work-node',
        targetId: currentNodeId!,
        updatedAt: createdAt,
      }
      : {
        timelineId,
        targetType: 'snapshot',
        targetId: snapshotId,
        updatedAt: createdAt,
      },
  };
}

export async function importLegacyTimelineArchive(
  archive: LegacyTimelineArchive,
  library: TimelineArchiveLibrary = 'shared',
): Promise<{
  imported: boolean;
  reused: boolean;
  archive: BrowserTimelineArchiveSummary;
}> {
  const canonical = canonicalizeBrowserTimelineBundle(
    legacyTimelineArchiveToBundle(archive),
    `旧存档 ${archive.label}`,
  );
  const bundle = canonical.bundle;
  const resolved = resolveBundlePayload(bundle);
  if (!resolved.payload) {
    fail(
      'timeline-archive-has-no-payload',
      409,
      'Timeline archive requires at least one checkout payload.',
    );
  }
  const payloadHash = await hashPayload(resolved.payload);
  const existingByHash = await webDatabase.query<Row>(
    'SELECT * FROM timeline_archives WHERE payload_hash = ? AND library = ? LIMIT 1',
    [payloadHash, library],
  );
  if (existingByHash[0]) {
    return {
      imported: false,
      reused: true,
      archive: archiveFromRow(existingByHash[0]),
    };
  }

  let archiveId = archive.archiveId;
  const existingById = await webDatabase.query<Row>(
    'SELECT payload_hash FROM timeline_archives WHERE archive_id = ? LIMIT 1',
    [archiveId],
  );
  if (existingById[0]) {
    archiveId = `${archiveId}-${payloadHash.replace(/^sha256:/, '').slice(0, 10)}`;
  }
  const stored = await storeArchive({
    library,
    label: archive.label,
    bundle,
    archiveId,
    createdAt: archive.createdAt,
  });
  return { imported: true, reused: false, archive: stored };
}

export async function exportLegacyTimelineArchives(
  library: TimelineArchiveLibrary,
): Promise<LegacyTimelineArchive[]> {
  const rows = await webDatabase.query<Row>(
    'SELECT * FROM timeline_archives WHERE library = ? ORDER BY created_at ASC',
    [library],
  );
  return rows.flatMap((row) => {
    const bundle = parseJson<BrowserTimelineBundle | null>(row.bundle_json, null);
    if (!bundle) return [];
    const resolved = resolveBundlePayload(bundle);
    if (!resolved.payload) return [];
    const currentNodeId = bundle.checkoutRef?.targetType === 'work-node'
      ? bundle.checkoutRef.targetId
      : null;
    return [{
      type: 'dmg.timeline-archive.v1' as const,
      archiveVersion: 1 as const,
      source: library,
      archiveId: textValue(row.archive_id),
      label: textValue(row.label),
      createdAt: textValue(row.created_at),
      payload: resolved.payload,
      ...(bundle.workNodes.length > 0 ? {
        worktree: {
          nodes: bundle.workNodes.map((node) => ({
            id: node.id,
            ...(node.parentNodeId ? { parentNodeId: node.parentNodeId } : {}),
            branchId: node.branchId,
            label: node.label,
            description: node.description,
            status: node.status,
            approvalPolicy: node.approvalPolicy,
            riskFlags: node.riskFlags,
            logs: node.logs,
            createdAt: node.createdAt,
            updatedAt: node.updatedAt,
            contentRevision: node.contentRevision,
            basePayload: node.basePayload,
            workingPayload: node.workingPayload,
          })),
          currentNodeId,
          nodeCount: bundle.workNodes.length,
        },
      } : {}),
    }];
  });
}

export async function listTimelineArchives(
  library: TimelineArchiveLibrary,
): Promise<BrowserTimelineArchiveSummary[]> {
  const rows = await webDatabase.query<Row>(
    `
      SELECT * FROM timeline_archives
      WHERE library = ? ORDER BY created_at DESC
    `,
    [library],
  );
  return rows.map(archiveFromRow);
}

export async function listSqliteWorkspaces(): Promise<BrowserTimelineSqliteWorkspace[]> {
  const documents = await listDocuments();
  return Promise.all(documents.map(async (document) => {
    const bundle = await exportDocumentBundle(document.id);
    const resolved = resolveBundlePayload(bundle);
    return {
      document,
      checkoutRef: resolved.checkoutRef,
      summary: resolved.payload
        ? summarizeTimelinePayload(resolved.payload)
        : { characterCount: 0, buttonCount: 0, buffCount: 0 },
      nodeCount: bundle.workNodes.length,
      ...(!resolved.payload ? {
        invalid: {
          code: 'timeline-workspace-has-no-payload',
          message: '此工作区还没有可应用的排轴快照或工作节点。',
        },
      } : {}),
    };
  }));
}

async function persistCanonicalBundlePayloads(
  bundle: BrowserTimelineBundle,
  repairs: TimelinePayloadCompatibilityRepair[],
  updatedAt: number,
): Promise<void> {
  const snapshotRows = await Promise.all(bundle.snapshots.map(async (snapshot) => ({
    id: snapshot.id,
    payload: snapshot.payload!,
    payloadHash: await hashPayload(snapshot.payload),
    expectedPayloadHash: snapshot.payloadHash,
  })));
  const statements: SqlStatement[] = snapshotRows.map((snapshot) => ({
    sql: `
      UPDATE timeline_snapshots
      SET payload_json = ?, payload_hash = ?
      WHERE id = ? AND timeline_id = ? AND payload_hash = ?
    `,
    bind: [
      serialize(snapshot.payload),
      snapshot.payloadHash,
      snapshot.id,
      bundle.document.id,
      snapshot.expectedPayloadHash,
    ],
    requireChanges: true,
  }));
  bundle.workNodes.forEach((node) => {
    statements.push({
      sql: `
        UPDATE timeline_work_nodes
        SET base_payload_json = ?, working_payload_json = ?
        WHERE id = ? AND timeline_id = ?
          AND content_revision = ? AND updated_at = ?
      `,
      bind: [
        serialize(node.basePayload),
        serialize(node.workingPayload),
        node.id,
        bundle.document.id,
        node.contentRevision,
        node.updatedAt,
      ],
      requireChanges: true,
    });
  });
  bundle.commits.forEach((commit) => {
    statements.push({
      sql: `
        UPDATE timeline_work_node_commits
        SET base_payload_json = ?, applied_payload_json = ?
        WHERE id = ? AND timeline_id = ?
      `,
      bind: [
        serialize(commit.basePayload),
        serialize(commit.appliedPayload),
        commit.id,
        bundle.document.id,
      ],
      requireChanges: true,
    });
  });
  statements.push(auditStatement({
    timelineId: bundle.document.id,
    eventType: 'timeline.compatibility-repaired',
    subjectType: 'checkout',
    subjectId: bundle.checkoutRef?.targetId || bundle.snapshots[0]?.id || bundle.document.id,
    details: { repairs },
    createdAt: updatedAt,
    when: { sql: 'changes() > 0' },
  }));
  const result = await batchWithRequiredChanges(statements, {
    code: 'timeline-content-revision-conflict',
    message: 'Timeline content changed before compatibility repair could be persisted.',
    details: { timelineId: bundle.document.id },
  });
  const mutationCount = statements.length - 1;
  if (result.statementChanges.slice(0, mutationCount).some((changes) => changes === 0)) {
    fail(
      'timeline-content-revision-conflict',
      409,
      'Timeline content changed before compatibility repair could be persisted.',
      { timelineId: bundle.document.id },
    );
  }
}

export async function applySqliteWorkspace(
  timelineId: string,
  updatedAt = Date.now(),
): Promise<TimelineWorkspaceApplyResult> {
  const exportedBundle = await exportDocumentBundle(timelineId);
  const canonical = canonicalizeBrowserTimelineBundle(
    exportedBundle,
    `SQLite 工作区 ${exportedBundle.document.label}`,
  );
  const bundle = canonical.bundle;
  const resolved = resolveBundlePayload(bundle);
  if (!resolved.payload || !resolved.checkoutRef) {
    fail(
      'timeline-workspace-has-no-payload',
      409,
      'This timeline workspace has no payload to apply.',
    );
  }
  if (canonical.changed) {
    await persistCanonicalBundlePayloads(bundle, canonical.repairs, updatedAt);
  }
  const checkoutRef = await setCheckoutRef({
    ...resolved.checkoutRef,
    timelineId,
    updatedAt,
    expected: bundle.checkoutRef,
  });
  const workspace = await replaceUserWorkspaceWithTimelinePayload(
    resolved.payload as unknown as Record<string, unknown>,
    updatedAt,
  );
  return {
    document: { id: bundle.document.id, label: bundle.document.label },
    payload: resolved.payload,
    checkoutRef,
    workspace,
  };
}

export async function exportSqliteWorkspaceArchive(input: {
  timelineId: string;
  kind: TimelineArchiveSource;
  label?: string;
}): Promise<{
  kind: TimelineArchiveSource;
  outbox: boolean;
  filePath: string;
  archive: BrowserTimelineArchiveSummary;
}> {
  const bundle = await exportDocumentBundle(input.timelineId);
  const resolved = resolveBundlePayload(bundle);
  if (!resolved.payload || !resolved.checkoutRef) {
    fail(
      'timeline-workspace-has-no-payload',
      409,
      'This timeline workspace has no payload to archive.',
    );
  }
  let archiveBundle = bundle;
  if (!archiveBundle.snapshots.length) {
    const snapshotId = makeId('archive-snapshot');
    const payloadHash = await hashPayload(resolved.payload);
    archiveBundle = {
      ...bundle,
      snapshots: [{
        id: snapshotId,
        timelineId: bundle.document.id,
        label: '存档 checkout',
        payloadHash,
        createdAt: Date.now(),
        archivedAt: null,
        payload: resolved.payload,
      }],
    };
  }
  const archive = await storeArchive({
    library: input.kind,
    label: input.label?.trim() || bundle.document.label,
    bundle: archiveBundle,
  });
  return {
    kind: input.kind,
    outbox: false,
    filePath: `browser://timeline-archives/${archive.archiveId}`,
    archive,
  };
}

function portableBundleToRepositoryBundle(bundle: TimelineBundleV2): BrowserTimelineBundle {
  if (
    bundle.type !== 'dmg.timeline-bundle.v2'
    || bundle.schemaVersion !== 2
    || !bundle.document?.id
    || !Array.isArray(bundle.payloads)
    || !Array.isArray(bundle.snapshots)
  ) {
    fail(
      'unsupported-timeline-import',
      400,
      '网页版 1.8 只接受当前的 dmg.timeline-bundle.v2 文件。',
    );
  }
  const createdAt = Number(bundle.manifest?.exportedAt) || Date.now();
  const document: TimelineDocument = {
    id: bundle.document.id,
    label: bundle.document.label || bundle.manifest.label || '导入排轴',
    isTemporary: false,
    createdAt,
    updatedAt: createdAt,
    archivedAt: null,
  };
  const snapshots: TimelineSnapshot[] = bundle.snapshots.map((snapshot) => {
    const payload = bundle.payloads[snapshot.payloadIndex];
    if (!payload) {
      fail(
        'invalid-timeline-bundle-payload-index',
        400,
        `Snapshot payload index is invalid: ${snapshot.payloadIndex}`,
      );
    }
    return {
      id: snapshot.id,
      timelineId: document.id,
      label: snapshot.label,
      payloadHash: '',
      createdAt: snapshot.createdAt,
      archivedAt: null,
      payload,
    };
  });
  const workNodes: BrowserTimelineWorkNode[] = (bundle.workNodes || []).map((node) => {
    const basePayload = bundle.payloads[node.basePayloadIndex];
    const workingPayload = bundle.payloads[node.workingPayloadIndex];
    if (!basePayload || !workingPayload) {
      fail(
        'invalid-timeline-bundle-payload-index',
        400,
        `Work Node payload index is invalid: ${node.id}`,
      );
    }
    return {
      id: node.id,
      ...(node.parentNodeId ? { parentNodeId: node.parentNodeId } : {}),
      timelineId: document.id,
      branchId: node.branchId,
      label: node.label,
      description: node.description || '',
      status: normalizeStatus(node.status),
      approvalPolicy: normalizeApprovalPolicy(node.approvalPolicy),
      riskFlags: normalizeRiskFlags(node.riskFlags),
      logs: Array.isArray(node.logs)
        ? node.logs as BrowserTimelineWorkNode['logs']
        : [],
      basePayload,
      workingPayload,
      baseSummary: summarizeTimelinePayload(basePayload),
      workingSummary: summarizeTimelinePayload(workingPayload),
      contentRevision: Number.isFinite(Number((node as unknown as { contentRevision?: unknown }).contentRevision))
        ? Number((node as unknown as { contentRevision?: unknown }).contentRevision)
        : node.updatedAt,
      createdAt: node.createdAt,
      updatedAt: node.updatedAt,
    };
  });
  const commits: AiTimelineWorkNodeCommit[] = (bundle.commits || []).map((commit) => {
    const basePayload = bundle.payloads[commit.basePayloadIndex];
    const appliedPayload = bundle.payloads[commit.appliedPayloadIndex];
    if (!basePayload || !appliedPayload) {
      fail(
        'invalid-timeline-bundle-payload-index',
        400,
        `Commit payload index is invalid: ${commit.id}`,
      );
    }
    return {
      id: commit.id,
      nodeId: commit.nodeId,
      timelineId: document.id,
      branchId: commit.branchId,
      label: commit.label,
      createdAt: commit.createdAt,
      summary: commit.summary as TimelinePayloadDiffSummary,
      riskFlags: normalizeRiskFlags(commit.riskFlags),
      approval: commit.approval as AiTimelineApproval,
      checkoutApplied: Boolean(commit.checkoutApplied),
      ...(commit.checkout ? { checkout: commit.checkout as AiTimelineCheckout } : {}),
      basePayload,
      appliedPayload,
    };
  });
  return {
    document,
    snapshots,
    workNodes,
    commits,
    checkoutRef: bundle.checkoutRef
      ? { timelineId: document.id, ...bundle.checkoutRef }
      : null,
  };
}

export async function importPortableTimelineBundle(input: {
  bundle: unknown;
  sourceName?: string;
}): Promise<{
  imported: boolean;
  reused: boolean;
  archive: BrowserTimelineArchiveSummary;
}> {
  const canonical = canonicalizeBrowserTimelineBundle(
    portableBundleToRepositoryBundle(input.bundle as TimelineBundleV2),
    `导入文件 ${input.sourceName || '排轴 JSON'}`,
  );
  const bundle = canonical.bundle;
  const resolved = resolveBundlePayload(bundle);
  if (!resolved.payload) {
    fail(
      'timeline-archive-has-no-payload',
      409,
      'Timeline archive requires at least one checkout payload.',
    );
  }
  const payloadHash = await hashPayload(resolved.payload);
  const existing = await webDatabase.query<Row>(
    'SELECT * FROM timeline_archives WHERE payload_hash = ? AND library = ? LIMIT 1',
    [payloadHash, 'local'],
  );
  if (existing[0]) {
    return { imported: false, reused: true, archive: archiveFromRow(existing[0]) };
  }
  const archive = await storeArchive({
    library: 'local',
    label: bundle.document.label || input.sourceName || '导入排轴',
    bundle,
  });
  return { imported: true, reused: false, archive };
}

export async function deleteTimelineArchive(input: {
  library: TimelineArchiveLibrary;
  archiveId: string;
}): Promise<{
  library: TimelineArchiveLibrary;
  archiveId: string;
  deleted: boolean;
}> {
  const result = await webDatabase.execute(
    'DELETE FROM timeline_archives WHERE archive_id = ? AND library = ?',
    [input.archiveId, input.library],
  );
  if (!result.changes) {
    fail(
      'timeline-archive-not-found',
      404,
      `Timeline archive not found: ${input.archiveId}`,
    );
  }
  return { ...input, deleted: true };
}

export async function transferTimelineArchive(input: {
  from: TimelineArchiveLibrary;
  to: TimelineArchiveLibrary;
  archiveId: string;
}): Promise<{
  from: TimelineArchiveLibrary;
  to: TimelineArchiveLibrary;
  archive: BrowserTimelineArchiveSummary;
  moved: boolean;
}> {
  if (input.from === input.to) {
    const current = await readArchive(input.from, input.archiveId);
    return { ...input, archive: current.summary, moved: false };
  }
  await readArchive(input.from, input.archiveId);
  await webDatabase.execute(
    'UPDATE timeline_archives SET library = ? WHERE archive_id = ? AND library = ?',
    [input.to, input.archiveId, input.from],
  );
  const moved = await readArchive(input.to, input.archiveId);
  return { ...input, archive: moved.summary, moved: true };
}

export async function convertTimelineArchive(input: {
  source: TimelineArchiveLibrary;
  archiveId: string;
  payloadOnly?: boolean;
  label?: string;
  updatedAt?: number;
}): Promise<TimelineWorkspaceApplyResult & {
  rootNodeId: string;
  importedNodeCount: number;
  totalNodeCount: number;
  compatibility: Array<{ code: string; message: string }>;
}> {
  const { bundle, compatibility } = await readArchive(input.source, input.archiveId);
  const resolved = resolveBundlePayload(bundle);
  if (!resolved.payload) {
    fail(
      'timeline-archive-has-no-payload',
      409,
      'Timeline archive has no payload to convert.',
    );
  }
  const createdAt = input.updatedAt ?? Date.now();
  const timelineId = makeId('timeline');
  const label = input.label?.trim() || bundle.document.label;
  const snapshotIdMap = new Map(
    bundle.snapshots.map((snapshot) => [snapshot.id, `${timelineId}-snapshot-${makeId('item').slice(-8)}`]),
  );
  const nodeIdMap = new Map(
    bundle.workNodes.map((node) => [node.id, `${timelineId}-node-${makeId('item').slice(-8)}`]),
  );
  const snapshots = input.payloadOnly
    ? [{
      id: `${timelineId}-snapshot`,
      label,
      createdAt,
      payload: resolved.payload,
    }]
    : bundle.snapshots.map((snapshot) => ({
      id: snapshotIdMap.get(snapshot.id)!,
      label: snapshot.label,
      createdAt: snapshot.createdAt,
      payload: snapshot.payload!,
    }));
  if (!snapshots.length) {
    snapshots.push({
      id: `${timelineId}-snapshot`,
      label,
      createdAt,
      payload: resolved.payload,
    });
  }
  const workNodes = input.payloadOnly
    ? []
    : bundle.workNodes.map((node) => ({
      ...node,
      id: nodeIdMap.get(node.id)!,
      timelineId,
      parentNodeId: node.parentNodeId ? nodeIdMap.get(node.parentNodeId) : undefined,
    }));
  const commits = input.payloadOnly
    ? []
    : bundle.commits
      .filter((commit) => nodeIdMap.has(commit.nodeId))
      .map((commit) => ({
        ...commit,
        id: `${timelineId}-commit-${makeId('item').slice(-8)}`,
        timelineId,
        nodeId: nodeIdMap.get(commit.nodeId)!,
      }));
  const sourceCheckout = bundle.checkoutRef;
  const checkoutRef = input.payloadOnly
    ? {
      targetType: 'snapshot' as const,
      targetId: snapshots[0].id,
      updatedAt: createdAt,
    }
    : sourceCheckout?.targetType === 'work-node' && nodeIdMap.has(sourceCheckout.targetId)
      ? {
        targetType: 'work-node' as const,
        targetId: nodeIdMap.get(sourceCheckout.targetId)!,
        updatedAt: createdAt,
      }
      : sourceCheckout?.targetType === 'snapshot' && snapshotIdMap.has(sourceCheckout.targetId)
        ? {
          targetType: 'snapshot' as const,
          targetId: snapshotIdMap.get(sourceCheckout.targetId)!,
          updatedAt: createdAt,
        }
        : {
          targetType: 'snapshot' as const,
          targetId: snapshots[0].id,
          updatedAt: createdAt,
        };
  await importDocumentBundle({
    document: { id: timelineId, label, createdAt, isTemporary: false },
    snapshots,
    workNodes,
    commits,
    checkoutRef,
  });
  const applied = await applySqliteWorkspace(timelineId, createdAt);
  return {
    ...applied,
    rootNodeId: workNodes.find((node) => !node.parentNodeId)?.id || '',
    importedNodeCount: workNodes.length,
    totalNodeCount: workNodes.length,
    compatibility: [...new Map(
      compatibility.map((repair) => [`${repair.code}\u0000${repair.message}`, repair]),
    ).values()],
  };
}
