import type { JsonObject, JsonValue } from './json.ts';
import type { ProductBinding } from './product.ts';

export const PREPARED_WORK_NODE_SCHEMA_VERSION = 1 as const;

export const PREPARED_WORK_NODE_LIMITS = Object.freeze({
  maxIdCodeUnits: 256,
  maxDigestCodeUnits: 128,
  maxPathCodeUnits: 512,
  maxScopeEntries: 8,
  maxReviewChanges: 2_048,
  maxReviewCodeUnits: 256 * 1_024,
  maxJsonDepth: 32,
  maxJsonNodes: 20_000,
  maxJsonStringCodeUnits: 16_384,
  maxJsonArrayItems: 4_096,
  maxJsonObjectKeys: 4_096,
});

export type PreparedWorkNodeIntent = 'timeline' | 'buff' | 'selection' | 'loadout';
export type PreparedWorkNodeDestination = 'current-timeline' | 'new-temporary-workspace';
export type PreparedWorkNodeScope =
  | 'timeline.structure'
  | 'buff.attachments'
  | 'buff.resistance'
  | 'selection.roster'
  | 'loadout.config';

export const PREPARED_WORK_NODE_SCOPES: readonly PreparedWorkNodeScope[] = Object.freeze([
  'timeline.structure',
  'buff.attachments',
  'buff.resistance',
  'selection.roster',
  'loadout.config',
]);

export type PreparedWorkNodeDiffKind = 'added' | 'removed' | 'changed';

export interface DefPreparedWorkNodeCandidateRefV1 {
  readonly contract: 'DefPreparedWorkNodeCandidateRefV1';
  readonly schemaVersion: typeof PREPARED_WORK_NODE_SCHEMA_VERSION;
  readonly proposalId: string;
  readonly intent: PreparedWorkNodeIntent;
  readonly destination: PreparedWorkNodeDestination;
  readonly sourceTargetId: string;
  readonly sourceRevision: number;
  readonly candidateTimelineId: string;
  readonly nodeId: string;
  readonly nodeRevision: number;
  readonly basePayloadDigest: string;
  readonly workingPayloadDigest: string;
  readonly diffDigest: string;
  readonly proposalDigest: string;
  readonly scope: readonly PreparedWorkNodeScope[];
}

export interface DefPreparedWorkNodeSourceCheckoutV1 {
  readonly timelineId: string;
  readonly targetType: 'snapshot' | 'work-node';
  readonly targetId: string;
  readonly revision: number;
  readonly payloadDigest: string;
}

export interface DefPreparedWorkNodeReviewManifestV1 {
  readonly proposalId: string;
  readonly nodeId: string;
  readonly nodeRevision: number;
  readonly diffDigest: string;
  readonly proposalDigest: string;
  readonly scope: readonly PreparedWorkNodeScope[];
}

export interface DefPreparedWorkNodePathChangeV1 {
  readonly path: string;
  readonly kind: PreparedWorkNodeDiffKind;
  readonly before?: JsonValue;
  readonly after?: JsonValue;
}

export interface DefPreparedWorkNodeReviewV1 {
  readonly contract: 'DefPreparedWorkNodeReviewV1';
  readonly schemaVersion: typeof PREPARED_WORK_NODE_SCHEMA_VERSION;
  readonly manifest: DefPreparedWorkNodeReviewManifestV1;
  readonly summary: {
    readonly addedPathCount: number;
    readonly removedPathCount: number;
    readonly changedPathCount: number;
  };
  readonly changes: readonly DefPreparedWorkNodePathChangeV1[];
}

export interface DefPreparedWorkNodeProposalV1 extends Omit<DefPreparedWorkNodeCandidateRefV1, 'contract'> {
  readonly contract: 'DefPreparedWorkNodeProposalV1';
  readonly sourceBinding: ProductBinding;
  readonly sourceCheckout: DefPreparedWorkNodeSourceCheckoutV1;
  readonly structuralParentNodeId: string | null;
  readonly review: DefPreparedWorkNodeReviewV1;
  readonly liveCheckoutTouched: false;
}

export type PreparedWorkNodeCleanupStatus =
  | 'pending'
  | 'abandoned'
  | 'deleted'
  | 'preserved'
  | 'failed';

export interface DefPreparedWorkNodeCleanupAuditV1 {
  readonly contract: 'DefPreparedWorkNodeCleanupAuditV1';
  readonly schemaVersion: typeof PREPARED_WORK_NODE_SCHEMA_VERSION;
  readonly proposalId: string;
  readonly nodeId: string;
  readonly candidateTimelineId: string;
  readonly status: PreparedWorkNodeCleanupStatus;
  readonly reason?: string;
}

const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const CANDIDATE_KEYS = [
  'contract', 'schemaVersion', 'proposalId', 'intent', 'destination',
  'sourceTargetId', 'sourceRevision', 'candidateTimelineId', 'nodeId', 'nodeRevision',
  'basePayloadDigest', 'workingPayloadDigest', 'diffDigest', 'proposalDigest', 'scope',
] as const;
const PROPOSAL_KEYS = [
  ...CANDIDATE_KEYS,
  'sourceBinding', 'sourceCheckout', 'structuralParentNodeId', 'review', 'liveCheckoutTouched',
] as const;
const SOURCE_BINDING_KEYS = [
  'workspaceId', 'databaseGeneration', 'timelineId', 'checkoutTargetId',
  'checkoutUpdatedAt', 'contentRevision', 'snapshotDigest',
] as const;
const SOURCE_CHECKOUT_KEYS = ['timelineId', 'targetType', 'targetId', 'revision', 'payloadDigest'] as const;
const REVIEW_KEYS = ['contract', 'schemaVersion', 'manifest', 'summary', 'changes'] as const;
const REVIEW_MANIFEST_KEYS = [
  'proposalId', 'nodeId', 'nodeRevision', 'diffDigest', 'proposalDigest', 'scope',
] as const;
const REVIEW_SUMMARY_KEYS = ['addedPathCount', 'removedPathCount', 'changedPathCount'] as const;

function own(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function exactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const keys = Object.keys(value);
  return required.every((key) => own(value, key))
    && keys.every((key) => required.includes(key) || optional.includes(key));
}

function boundedString(value: unknown, max: number = PREPARED_WORK_NODE_LIMITS.maxIdCodeUnits): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= max
    && !value.includes('\u0000');
}

function boundedOptionalString(value: unknown, max: number = PREPARED_WORK_NODE_LIMITS.maxIdCodeUnits): boolean {
  return value === undefined || boundedString(value, max);
}

function revision(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function digest(value: unknown): value is string {
  return typeof value === 'string'
    && value.length <= PREPARED_WORK_NODE_LIMITS.maxDigestCodeUnits
    && DIGEST_PATTERN.test(value);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isJsonSafe(value: unknown, depth = 0, state = { nodes: 0 }): value is JsonValue {
  if (depth > PREPARED_WORK_NODE_LIMITS.maxJsonDepth) return false;
  state.nodes += 1;
  if (state.nodes > PREPARED_WORK_NODE_LIMITS.maxJsonNodes) return false;
  if (value === null || typeof value === 'boolean') return true;
  if (typeof value === 'string') {
    return value.length <= PREPARED_WORK_NODE_LIMITS.maxJsonStringCodeUnits;
  }
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) {
    return value.length <= PREPARED_WORK_NODE_LIMITS.maxJsonArrayItems
      && value.every((entry) => isJsonSafe(entry, depth + 1, state));
  }
  if (!isPlainRecord(value)) return false;
  const keys = Object.keys(value);
  return keys.length <= PREPARED_WORK_NODE_LIMITS.maxJsonObjectKeys
    && keys.every((key) => key.length <= PREPARED_WORK_NODE_LIMITS.maxJsonStringCodeUnits
      && isJsonSafe(value[key], depth + 1, state));
}

function isScope(value: unknown): value is PreparedWorkNodeScope {
  return typeof value === 'string'
    && (PREPARED_WORK_NODE_SCOPES as readonly string[]).includes(value);
}

function isScopeList(value: unknown): value is readonly PreparedWorkNodeScope[] {
  return Array.isArray(value)
    && value.length > 0
    && value.length <= PREPARED_WORK_NODE_LIMITS.maxScopeEntries
    && value.every(isScope)
    && new Set(value).size === value.length;
}

function isSourceBinding(value: unknown): value is ProductBinding {
  if (!isPlainRecord(value) || !exactKeys(value, SOURCE_BINDING_KEYS)) return false;
  return boundedString(value.workspaceId)
    && boundedString(value.databaseGeneration)
    && boundedString(value.timelineId)
    && (value.checkoutTargetId === null || boundedString(value.checkoutTargetId))
    && Number.isFinite(value.checkoutUpdatedAt)
    && revision(value.contentRevision)
    && boundedString(value.snapshotDigest, PREPARED_WORK_NODE_LIMITS.maxDigestCodeUnits);
}

function isSourceCheckout(value: unknown): value is DefPreparedWorkNodeSourceCheckoutV1 {
  if (!isPlainRecord(value) || !exactKeys(value, SOURCE_CHECKOUT_KEYS)) return false;
  return boundedString(value.timelineId)
    && (value.targetType === 'snapshot' || value.targetType === 'work-node')
    && boundedString(value.targetId)
    && revision(value.revision)
    && digest(value.payloadDigest);
}

function isPathChange(value: unknown): value is DefPreparedWorkNodePathChangeV1 {
  if (!isPlainRecord(value) || !exactKeys(value, ['path', 'kind'], ['before', 'after'])) return false;
  if (!boundedString(value.path, PREPARED_WORK_NODE_LIMITS.maxPathCodeUnits)
    || !value.path.startsWith('/')
    || !['added', 'removed', 'changed'].includes(String(value.kind))) return false;
  const hasBefore = own(value, 'before');
  const hasAfter = own(value, 'after');
  if (value.kind === 'added' && (!hasAfter || hasBefore)) return false;
  if (value.kind === 'removed' && (!hasBefore || hasAfter)) return false;
  if (value.kind === 'changed' && (!hasBefore || !hasAfter)) return false;
  return (!hasBefore || isJsonSafe(value.before)) && (!hasAfter || isJsonSafe(value.after));
}

function isReviewManifest(value: unknown): value is DefPreparedWorkNodeReviewManifestV1 {
  if (!isPlainRecord(value) || !exactKeys(value, REVIEW_MANIFEST_KEYS)) return false;
  return boundedString(value.proposalId)
    && boundedString(value.nodeId)
    && revision(value.nodeRevision)
    && digest(value.diffDigest)
    && digest(value.proposalDigest)
    && isScopeList(value.scope);
}

export function isPreparedWorkNodeCandidateRef(
  value: unknown,
): value is DefPreparedWorkNodeCandidateRefV1 {
  if (!isPlainRecord(value) || !exactKeys(value, CANDIDATE_KEYS)) return false;
  return value.contract === 'DefPreparedWorkNodeCandidateRefV1'
    && value.schemaVersion === PREPARED_WORK_NODE_SCHEMA_VERSION
    && boundedString(value.proposalId)
    && ['timeline', 'buff', 'selection', 'loadout'].includes(String(value.intent))
    && ['current-timeline', 'new-temporary-workspace'].includes(String(value.destination))
    && boundedString(value.sourceTargetId)
    && revision(value.sourceRevision)
    && boundedString(value.candidateTimelineId)
    && boundedString(value.nodeId)
    && revision(value.nodeRevision)
    && digest(value.basePayloadDigest)
    && digest(value.workingPayloadDigest)
    && digest(value.diffDigest)
    && digest(value.proposalDigest)
    && isScopeList(value.scope);
}

export function isPreparedWorkNodeReview(value: unknown): value is DefPreparedWorkNodeReviewV1 {
  if (!isPlainRecord(value) || !exactKeys(value, REVIEW_KEYS)) return false;
  if (
    value.contract !== 'DefPreparedWorkNodeReviewV1'
    || value.schemaVersion !== PREPARED_WORK_NODE_SCHEMA_VERSION
    || !isReviewManifest(value.manifest)
    || !isPlainRecord(value.summary)
    || !exactKeys(value.summary, REVIEW_SUMMARY_KEYS)
    || !revision(value.summary.addedPathCount)
    || !revision(value.summary.removedPathCount)
    || !revision(value.summary.changedPathCount)
    || !Array.isArray(value.changes)
    || value.changes.length > PREPARED_WORK_NODE_LIMITS.maxReviewChanges
    || !value.changes.every(isPathChange)
  ) return false;
  try {
    return JSON.stringify(value).length <= PREPARED_WORK_NODE_LIMITS.maxReviewCodeUnits;
  } catch {
    return false;
  }
}

export function preparedWorkNodeReviewMatchesCandidate(
  candidate: DefPreparedWorkNodeCandidateRefV1,
  review: DefPreparedWorkNodeReviewV1,
): boolean {
  const manifest = review.manifest;
  return manifest.proposalId === candidate.proposalId
    && manifest.nodeId === candidate.nodeId
    && manifest.nodeRevision === candidate.nodeRevision
    && manifest.diffDigest === candidate.diffDigest
    && manifest.proposalDigest === candidate.proposalDigest
    && sameStringArray(manifest.scope, candidate.scope);
}

export function isPreparedWorkNodeProposal(value: unknown): value is DefPreparedWorkNodeProposalV1 {
  if (!isPlainRecord(value) || !exactKeys(value, PROPOSAL_KEYS)) return false;
  const candidateRef = Object.fromEntries(
    CANDIDATE_KEYS.map((key) => [key, value[key]]),
  );
  const candidate = { ...candidateRef, contract: 'DefPreparedWorkNodeCandidateRefV1' };
  if (
    value.contract !== 'DefPreparedWorkNodeProposalV1'
    || value.schemaVersion !== PREPARED_WORK_NODE_SCHEMA_VERSION
    || !isPreparedWorkNodeCandidateRef(candidate)
    || !isSourceBinding(value.sourceBinding)
    || !isSourceCheckout(value.sourceCheckout)
    || (value.structuralParentNodeId !== null && !boundedString(value.structuralParentNodeId))
    || !isPreparedWorkNodeReview(value.review)
    || value.liveCheckoutTouched !== false
  ) return false;
  return preparedWorkNodeReviewMatchesCandidate(candidate, value.review);
}

export function isPreparedWorkNodeCleanupAudit(
  value: unknown,
): value is DefPreparedWorkNodeCleanupAuditV1 {
  if (!isPlainRecord(value) || !exactKeys(value, ['contract', 'schemaVersion', 'proposalId', 'nodeId', 'candidateTimelineId', 'status'], ['reason'])) return false;
  return value.contract === 'DefPreparedWorkNodeCleanupAuditV1'
    && value.schemaVersion === PREPARED_WORK_NODE_SCHEMA_VERSION
    && boundedString(value.proposalId)
    && boundedString(value.nodeId)
    && boundedString(value.candidateTimelineId)
    && ['pending', 'abandoned', 'deleted', 'preserved', 'failed'].includes(String(value.status))
    && boundedOptionalString(value.reason, PREPARED_WORK_NODE_LIMITS.maxJsonStringCodeUnits);
}

export function clonePreparedWorkNodeCandidateRef(
  candidate: DefPreparedWorkNodeCandidateRefV1,
): DefPreparedWorkNodeCandidateRefV1 {
  return { ...candidate, scope: [...candidate.scope] };
}

export function clonePreparedWorkNodeReview(
  review: DefPreparedWorkNodeReviewV1,
): DefPreparedWorkNodeReviewV1 {
  return {
    ...review,
    manifest: { ...review.manifest, scope: [...review.manifest.scope] },
    summary: { ...review.summary },
    changes: review.changes.map((change) => ({
      ...change,
      ...(own(change, 'before') ? { before: cloneJson(change.before!) } : {}),
      ...(own(change, 'after') ? { after: cloneJson(change.after!) } : {}),
    })),
  };
}

function cloneJson(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(cloneJson);
  if (value !== null && typeof value === 'object') {
    const clone: JsonObject = {};
    for (const [key, entry] of Object.entries(value)) clone[key] = cloneJson(entry);
    return clone;
  }
  return value;
}

function sameStringArray(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
