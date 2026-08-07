import {
  canonicalJson,
  type JsonValue,
} from '../../../agent/core/contracts/json.ts';
import {
  isPreparedWorkNodeProposal,
  isPreparedWorkNodeReview,
  preparedWorkNodeReviewMatchesCandidate,
  type DefPreparedWorkNodeCandidateRefV1,
  type DefPreparedWorkNodePathChangeV1,
  type DefPreparedWorkNodeProposalV1,
  type DefPreparedWorkNodeReviewV1,
  type PreparedWorkNodeScope,
} from '../../../agent/core/contracts/prepared-work-node.ts';
import type { ProductBinding } from '../../../agent/core/contracts/product.ts';

const IGNORED_METADATA_KEYS = new Set(['createdAt', 'updatedAt']);
const MAX_DIFF_ENTRIES = 2_048;
const MAX_DEPTH = 32;
const MAX_NODES = 20_000;
const MAX_STRING_CODE_UNITS = 16_384;
const MAX_ARRAY_ITEMS = 4_096;
const MAX_OBJECT_KEYS = 4_096;

type Missing = typeof MISSING;
const MISSING = Symbol('prepared-work-node-missing');

export type PreparedWorkNodeCandidateSeed = Omit<
  DefPreparedWorkNodeCandidateRefV1,
  'contract' | 'schemaVersion' | 'basePayloadDigest' | 'workingPayloadDigest' | 'diffDigest' | 'proposalDigest'
>;

export interface PreparedWorkNodeProposalBuildInput extends PreparedWorkNodeCandidateSeed {
  readonly operation: string;
  readonly sourceBinding: ProductBinding;
  readonly sourceCheckout: DefPreparedWorkNodeProposalV1['sourceCheckout'];
  readonly structuralParentNodeId: string | null;
  readonly basePayload: unknown;
  readonly workingPayload: unknown;
}

export interface PreparedPayloadDiffResult {
  readonly changes: readonly DefPreparedWorkNodePathChangeV1[];
  readonly addedPathCount: number;
  readonly removedPathCount: number;
  readonly changedPathCount: number;
}

export interface PreparedScopeViolation {
  readonly path: string;
  readonly requiredScope: PreparedWorkNodeScope | null;
  readonly reason: 'scope-not-granted' | 'unscoped-path';
}

export interface PreparedScopeGateResult {
  readonly pass: boolean;
  readonly violations: readonly PreparedScopeViolation[];
}

export type PreparedProposalValidationResult =
  | {
      readonly ok: true;
      readonly diff: PreparedPayloadDiffResult;
      readonly scopeGate: PreparedScopeGateResult;
    }
  | {
      readonly ok: false;
      readonly issues: readonly string[];
    };

export async function sha256Json(value: unknown): Promise<string> {
  assertBoundedJson(value, 'value');
  if (!globalThis.crypto?.subtle) throw new Error('Web Crypto is required for prepared Work Node proposals.');
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(canonicalJson(value as JsonValue)),
  );
  return `sha256:${[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

/** Full recursive diff. Only object keys named createdAt/updatedAt are ignored. */
export function diffPreparedPayloads(base: unknown, working: unknown): PreparedPayloadDiffResult {
  assertBoundedJson(base, 'basePayload');
  assertBoundedJson(working, 'workingPayload');
  const changes: DefPreparedWorkNodePathChangeV1[] = [];
  diffValue(base as JsonValue, working as JsonValue, '/', changes);
  return {
    changes,
    addedPathCount: changes.filter((change) => change.kind === 'added').length,
    removedPathCount: changes.filter((change) => change.kind === 'removed').length,
    changedPathCount: changes.filter((change) => change.kind === 'changed').length,
  };
}

export function scopeForPreparedPath(path: string): PreparedWorkNodeScope | null {
  const segments = decodePointer(path);
  const root = segments[0];
  if (root === 'selectedCharacters') return 'selection.roster';
  if (root === 'operatorConfigPageCache' || root === 'characterInputMap' || root === 'characterComputedMap' || root === 'characterDisplayCacheMap') {
    return 'loadout.config';
  }
  if (root === 'allBuffList') return 'buff.attachments';
  if (root === 'anomalyStateSnapshots') return null;
  if (root === 'skillButtonTable' || root === 'timelineData') {
    if (segments.some((segment) => (
      segment === 'resistanceConfig' || segment === 'targetResistance' || segment === 'resistance'
    ))) return 'buff.resistance';
    if (segments.some((segment) => (
      segment === 'selectedBuff'
      || segment === 'selectedBuffIds'
      || segment === 'buffStackCounts'
      || segment === 'buffStackCountsByHitKey'
      || segment === 'selectedBuffs'
      || segment === 'buffMap'
    ))) return 'buff.attachments';
    return 'timeline.structure';
  }
  return null;
}

export function checkPreparedScope(
  diff: PreparedPayloadDiffResult,
  scope: readonly PreparedWorkNodeScope[],
): PreparedScopeGateResult {
  const granted = new Set(scope);
  const violations = diff.changes.flatMap((change) => {
    const requiredScope = scopeForPreparedPath(change.path);
    if (requiredScope !== null && granted.has(requiredScope)) return [];
    return [{
      path: change.path,
      requiredScope,
      reason: requiredScope === null ? 'unscoped-path' as const : 'scope-not-granted' as const,
    }];
  });
  return { pass: violations.length === 0, violations };
}

export async function computePreparedWorkNodeProposalDigest(
  operation: string,
  candidate: DefPreparedWorkNodeCandidateRefV1,
): Promise<string> {
  if (!operation.trim() || operation.length > 256) throw new Error('Prepared proposal operation is invalid.');
  const { proposalDigest: _proposalDigest, ...candidateWithoutProposalDigest } = candidate;
  return sha256Json({
    operation,
    intent: candidate.intent,
    candidate: candidateWithoutProposalDigest,
    scope: [...candidate.scope],
  });
}

export async function buildPreparedWorkNodeProposal(
  input: PreparedWorkNodeProposalBuildInput,
): Promise<DefPreparedWorkNodeProposalV1> {
  const diff = diffPreparedPayloads(input.basePayload, input.workingPayload);
  const [basePayloadDigest, workingPayloadDigest, diffDigest] = await Promise.all([
    sha256Json(input.basePayload),
    sha256Json(input.workingPayload),
    sha256Json(diff.changes),
  ]);
  if (input.sourceCheckout.payloadDigest !== basePayloadDigest) {
    throw new Error('Prepared source checkout payload digest does not match the base payload.');
  }
  const candidateWithoutProposalDigest: Omit<DefPreparedWorkNodeCandidateRefV1, 'proposalDigest'> = {
    contract: 'DefPreparedWorkNodeCandidateRefV1',
    schemaVersion: 1,
    proposalId: input.proposalId,
    intent: input.intent,
    destination: input.destination,
    sourceTargetId: input.sourceTargetId,
    sourceRevision: input.sourceRevision,
    candidateTimelineId: input.candidateTimelineId,
    nodeId: input.nodeId,
    nodeRevision: input.nodeRevision,
    basePayloadDigest,
    workingPayloadDigest,
    diffDigest,
    scope: [...input.scope],
  };
  const proposalDigest = await computePreparedWorkNodeProposalDigest(
    input.operation,
    { ...candidateWithoutProposalDigest, proposalDigest: 'sha256:' + '0'.repeat(64) },
  );
  const candidate: DefPreparedWorkNodeCandidateRefV1 = {
    ...candidateWithoutProposalDigest,
    proposalDigest,
  };
  const review: DefPreparedWorkNodeReviewV1 = {
    contract: 'DefPreparedWorkNodeReviewV1',
    schemaVersion: 1,
    manifest: {
      proposalId: candidate.proposalId,
      nodeId: candidate.nodeId,
      nodeRevision: candidate.nodeRevision,
      diffDigest: candidate.diffDigest,
      proposalDigest: candidate.proposalDigest,
      scope: [...candidate.scope],
    },
    summary: {
      addedPathCount: diff.addedPathCount,
      removedPathCount: diff.removedPathCount,
      changedPathCount: diff.changedPathCount,
    },
    changes: diff.changes,
  };
  const proposal: DefPreparedWorkNodeProposalV1 = {
    ...candidate,
    contract: 'DefPreparedWorkNodeProposalV1',
    sourceBinding: { ...input.sourceBinding },
    sourceCheckout: {
      ...input.sourceCheckout,
      payloadDigest: basePayloadDigest,
    },
    structuralParentNodeId: input.structuralParentNodeId,
    review,
    liveCheckoutTouched: false,
  };
  const validation = await validatePreparedWorkNodeProposal(proposal, {
    operation: input.operation,
    basePayload: input.basePayload,
    workingPayload: input.workingPayload,
  });
  if (!validation.ok) throw new Error(`Prepared proposal build validation failed: ${validation.issues.join('; ')}`);
  return proposal;
}

export async function validatePreparedWorkNodeProposal(
  proposal: unknown,
  options: {
    readonly operation: string;
    readonly basePayload: unknown;
    readonly workingPayload: unknown;
  },
): Promise<PreparedProposalValidationResult> {
  const issues: string[] = [];
  if (!isPreparedWorkNodeProposal(proposal)) {
    return { ok: false, issues: ['proposal shape is invalid or exceeds the bounded JSON contract'] };
  }
  assertBoundedJson(options.basePayload, 'basePayload');
  assertBoundedJson(options.workingPayload, 'workingPayload');
  const candidate = candidateRefFromProposal(proposal);
  const diff = diffPreparedPayloads(options.basePayload, options.workingPayload);
  const scopeGate = checkPreparedScope(diff, proposal.scope);
  const [baseDigest, workingDigest, diffDigest, proposalDigest] = await Promise.all([
    sha256Json(options.basePayload),
    sha256Json(options.workingPayload),
    sha256Json(diff.changes),
    computePreparedWorkNodeProposalDigest(options.operation, candidate),
  ]);
  if (proposal.sourceCheckout.payloadDigest !== baseDigest) issues.push('source checkout payload digest mismatch');
  if (proposal.basePayloadDigest !== baseDigest) issues.push('base payload digest mismatch');
  if (proposal.workingPayloadDigest !== workingDigest) issues.push('working payload digest mismatch');
  if (proposal.diffDigest !== diffDigest) issues.push('diff digest mismatch');
  if (proposal.proposalDigest !== proposalDigest) issues.push('proposal digest mismatch');
  if (proposal.sourceCheckout.timelineId !== proposal.sourceBinding.timelineId) issues.push('source checkout timeline mismatch');
  if (proposal.sourceCheckout.targetId !== proposal.sourceTargetId) issues.push('source checkout target mismatch');
  if (proposal.sourceCheckout.revision !== proposal.sourceRevision) issues.push('source checkout revision mismatch');
  if (!preparedWorkNodeReviewMatchesCandidate(candidate, proposal.review)) issues.push('review manifest does not match candidate');
  if (!isPreparedWorkNodeReview(proposal.review)) issues.push('review is invalid');
  if (canonicalJson(proposal.review.changes as unknown as JsonValue) !== canonicalJson(diff.changes as unknown as JsonValue)) {
    issues.push('review changes do not match the complete recursive payload diff');
  }
  if (
    proposal.review.summary.addedPathCount !== diff.addedPathCount
    || proposal.review.summary.removedPathCount !== diff.removedPathCount
    || proposal.review.summary.changedPathCount !== diff.changedPathCount
  ) issues.push('review summary does not match the complete recursive payload diff');
  if (!scopeGate.pass) issues.push('proposal diff exceeds its declared scope');
  return issues.length === 0 ? { ok: true, diff, scopeGate } : { ok: false, issues };
}

export function assertBoundedJson(value: unknown, label: string): asserts value is JsonValue {
  const state = { nodes: 0 };
  if (!isBoundedJson(value, 0, state)) throw new Error(`${label} is not bounded JSON-safe data.`);
}

function isBoundedJson(value: unknown, depth: number, state: { nodes: number }): value is JsonValue {
  if (depth > MAX_DEPTH || ++state.nodes > MAX_NODES) return false;
  if (value === null || typeof value === 'boolean') return true;
  if (typeof value === 'string') return value.length <= MAX_STRING_CODE_UNITS;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) {
    return value.length <= MAX_ARRAY_ITEMS && value.every((entry) => isBoundedJson(entry, depth + 1, state));
  }
  if (typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) return false;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  return keys.length <= MAX_OBJECT_KEYS
    && keys.every((key) => key.length <= MAX_STRING_CODE_UNITS && isBoundedJson(record[key], depth + 1, state));
}

function diffValue(
  before: JsonValue | Missing,
  after: JsonValue | Missing,
  path: string,
  changes: DefPreparedWorkNodePathChangeV1[],
): void {
  if (before === MISSING) {
    pushChange(changes, { path, kind: 'added', after: cloneJson(after as JsonValue) });
    return;
  }
  if (after === MISSING) {
    pushChange(changes, { path, kind: 'removed', before: cloneJson(before) });
    return;
  }
  if (isRecord(before) && isRecord(after)) {
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
    for (const key of keys) {
      if (IGNORED_METADATA_KEYS.has(key)) continue;
      diffValue(
        Object.prototype.hasOwnProperty.call(before, key) ? before[key]! : MISSING,
        Object.prototype.hasOwnProperty.call(after, key) ? after[key]! : MISSING,
        appendPointer(path, key),
        changes,
      );
    }
    return;
  }
  if (Array.isArray(before) && Array.isArray(after)) {
    const length = Math.max(before.length, after.length);
    for (let index = 0; index < length; index += 1) {
      diffValue(
        index < before.length ? before[index]! : MISSING,
        index < after.length ? after[index]! : MISSING,
        appendPointer(path, String(index)),
        changes,
      );
    }
    return;
  }
  if (canonicalJson(before) !== canonicalJson(after)) {
    pushChange(changes, {
      path,
      kind: 'changed',
      before: cloneJson(before),
      after: cloneJson(after),
    });
  }
}

function pushChange(
  changes: DefPreparedWorkNodePathChangeV1[],
  change: DefPreparedWorkNodePathChangeV1,
): void {
  if (changes.length >= MAX_DIFF_ENTRIES) throw new Error('Prepared payload diff exceeds the bounded change limit.');
  changes.push(change);
}

function isRecord(value: JsonValue | Missing): value is Record<string, JsonValue> {
  return value !== MISSING && value !== null && typeof value === 'object' && !Array.isArray(value);
}

function appendPointer(path: string, segment: string): string {
  const escaped = segment.replace(/~/g, '~0').replace(/\//g, '~1');
  return path === '/' ? `/${escaped}` : `${path}/${escaped}`;
}

function decodePointer(path: string): string[] {
  if (path === '/') return [];
  return path.slice(1).split('/').map((segment) => segment.replace(/~1/g, '/').replace(/~0/g, '~'));
}

function cloneJson(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(cloneJson);
  if (value !== null && typeof value === 'object') {
    const result: { [key: string]: JsonValue } = {};
    for (const [key, entry] of Object.entries(value)) result[key] = cloneJson(entry);
    return result;
  }
  return value;
}

function candidateRefFromProposal(proposal: DefPreparedWorkNodeProposalV1): DefPreparedWorkNodeCandidateRefV1 {
  return {
    contract: 'DefPreparedWorkNodeCandidateRefV1',
    schemaVersion: 1,
    proposalId: proposal.proposalId,
    intent: proposal.intent,
    destination: proposal.destination,
    sourceTargetId: proposal.sourceTargetId,
    sourceRevision: proposal.sourceRevision,
    candidateTimelineId: proposal.candidateTimelineId,
    nodeId: proposal.nodeId,
    nodeRevision: proposal.nodeRevision,
    basePayloadDigest: proposal.basePayloadDigest,
    workingPayloadDigest: proposal.workingPayloadDigest,
    diffDigest: proposal.diffDigest,
    proposalDigest: proposal.proposalDigest,
    scope: [...proposal.scope],
  };
}
