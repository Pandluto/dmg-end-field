import {
  canonicalJson,
  type JsonValue,
} from '../../../agent/core/contracts/json.ts';
import {
  isPreparedWorkNodeCandidateRef,
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

// TimelineSnapshotPayload stores Buff attachment/state in three places: the
// top-level allBuffList/anomalyStateSnapshots archives, the mirrored
// timelineData button buffIds, and the skillButtonTable button state.  Keep
// this list explicit so a new persisted Buff control cannot silently fall
// through to timeline.structure.
const PREPARED_BUFF_ATTACHMENT_SEGMENTS = new Set([
  'allBuffList',
  'anomalyStateSnapshots',
  'buffIds',
  'selectedBuff',
  'selectedBuffIds',
  'selectedBuffs',
  'buffStackCounts',
  'buffStackCount',
  'buffStackCountsByHitKey',
  'currentStackCount',
  'currentStackCounts',
  'currentStackCountSources',
  'anomalyConfig',
  'selectedStatuses',
  'selectedDamages',
  'selectedStateSnapshotIds',
  'panelConfig',
  'globallyDisabledBuffIds',
  'manualDisabledBuffIdsBySegmentKey',
  'manualBuffStackCountsBySegmentKey',
  'manualDisabledHitKeys',
  'runtimeSnapshot',
  'buffMap',
  'buffList',
]);

const PREPARED_BUFF_RESISTANCE_SEGMENTS = new Set([
  'resistanceConfig',
  'targetResistance',
  'resistance',
]);

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

export type PreparedCandidateValidationResult =
  | {
      readonly ok: true;
      readonly candidate: DefPreparedWorkNodeCandidateRefV1;
      readonly diff: PreparedPayloadDiffResult;
      readonly scopeGate: PreparedScopeGateResult;
    }
  | {
      readonly ok: false;
      readonly issues: readonly string[];
    };

export type PreparedAtomicVerification = {
  readonly pass: boolean;
  readonly reason?: string;
  readonly postcondition?: unknown;
};

export class PreparedWorkNodeAtomicApplyError extends Error {
  readonly primaryError: Error;
  readonly rollbackError: Error | null;

  constructor(primaryError: unknown, rollbackError: unknown = null) {
    const primary = primaryError instanceof Error ? primaryError : new Error(String(primaryError));
    const rollback = rollbackError === null
      ? null
      : rollbackError instanceof Error ? rollbackError : new Error(String(rollbackError));
    super(
      `${primary.message}${rollback
        ? `；恢复 live checkout 失败：${rollback.message}`
        : '；已恢复 live checkout，候选节点保留供审计。'}`,
    );
    this.name = 'PreparedWorkNodeAtomicApplyError';
    this.primaryError = primary;
    this.rollbackError = rollback;
  }
}

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
  if (root === 'allBuffList' || root === 'anomalyStateSnapshots') return 'buff.attachments';
  if (root === 'skillButtonTable' || root === 'timelineData') {
    if (segments.some((segment) => PREPARED_BUFF_RESISTANCE_SEGMENTS.has(segment))) return 'buff.resistance';
    if (segments.some((segment) => PREPARED_BUFF_ATTACHMENT_SEGMENTS.has(segment))) return 'buff.attachments';
    return 'timeline.structure';
  }
  return null;
}

function collectPreparedValueScopes(value: JsonValue, path: string, scopes: Set<PreparedWorkNodeScope>): void {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      const scope = scopeForPreparedPath(path);
      if (scope) scopes.add(scope);
      return;
    }
    value.forEach((entry, index) => collectPreparedValueScopes(entry, appendPointer(path, String(index)), scopes));
    return;
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value);
    const meaningfulEntries = entries.filter(([key]) => !IGNORED_METADATA_KEYS.has(key));
    if (meaningfulEntries.length === 0) {
      const scope = scopeForPreparedPath(path);
      if (scope) scopes.add(scope);
      return;
    }
    meaningfulEntries.forEach(([key, entry]) => collectPreparedValueScopes(entry, appendPointer(path, key), scopes));
    return;
  }
  const scope = scopeForPreparedPath(path);
  if (scope) scopes.add(scope);
}

function scopesForPreparedChange(change: DefPreparedWorkNodePathChangeV1): PreparedWorkNodeScope[] {
  const scopes = new Set<PreparedWorkNodeScope>();
  if (change.before !== undefined) collectPreparedValueScopes(change.before, change.path, scopes);
  if (change.after !== undefined) collectPreparedValueScopes(change.after, change.path, scopes);
  if (scopes.size === 0) {
    const direct = scopeForPreparedPath(change.path);
    if (direct) scopes.add(direct);
  }
  return [...scopes];
}

export function checkPreparedScope(
  diff: PreparedPayloadDiffResult,
  scope: readonly PreparedWorkNodeScope[],
): PreparedScopeGateResult {
  const granted = new Set(scope);
  const violations: PreparedScopeViolation[] = [];
  diff.changes.forEach((change) => {
    const requiredScopes = scopesForPreparedChange(change);
    if (requiredScopes.length === 0) {
      violations.push({
        path: change.path,
        requiredScope: null,
        reason: 'unscoped-path' as const,
      });
      return;
    }
    requiredScopes
      .filter((requiredScope) => !granted.has(requiredScope))
      .forEach((requiredScope) => violations.push({
        path: change.path,
        requiredScope,
        reason: 'scope-not-granted' as const,
      }));
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
  const candidate = preparedWorkNodeCandidateRefFromProposal(proposal);
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

/**
 * Re-validate the compact candidate reference against the payload currently
 * stored in the browser Work Node.  This is deliberately independent from a
 * model patch: apply callers can only provide the candidate reference and the
 * operation that was used to create its proposal digest.
 */
export async function validatePreparedWorkNodeCandidate(
  candidate: unknown,
  options: {
    readonly operation: string;
    readonly basePayload: unknown;
    readonly workingPayload: unknown;
    readonly sourceTargetId?: string;
    readonly sourceRevision?: number;
    readonly candidateTimelineId?: string;
    readonly nodeId?: string;
    readonly nodeRevision?: number;
  },
): Promise<PreparedCandidateValidationResult> {
  if (!isPreparedWorkNodeCandidateRef(candidate)) {
    return { ok: false, issues: ['candidate reference shape is invalid'] };
  }
  const issues: string[] = [];
  try {
    assertBoundedJson(options.basePayload, 'basePayload');
    assertBoundedJson(options.workingPayload, 'workingPayload');
    const diff = diffPreparedPayloads(options.basePayload, options.workingPayload);
    const scopeGate = checkPreparedScope(diff, candidate.scope);
    const [baseDigest, workingDigest, diffDigest, proposalDigest] = await Promise.all([
      sha256Json(options.basePayload),
      sha256Json(options.workingPayload),
      sha256Json(diff.changes),
      computePreparedWorkNodeProposalDigest(options.operation, candidate),
    ]);
    if (candidate.basePayloadDigest !== baseDigest) issues.push('base payload digest mismatch');
    if (candidate.workingPayloadDigest !== workingDigest) issues.push('working payload digest mismatch');
    if (candidate.diffDigest !== diffDigest) issues.push('diff digest mismatch');
    if (candidate.proposalDigest !== proposalDigest) issues.push('proposal digest mismatch');
    if (options.sourceTargetId !== undefined && candidate.sourceTargetId !== options.sourceTargetId) {
      issues.push('source target mismatch');
    }
    if (options.sourceRevision !== undefined && candidate.sourceRevision !== options.sourceRevision) {
      issues.push('source revision mismatch');
    }
    if (options.candidateTimelineId !== undefined && candidate.candidateTimelineId !== options.candidateTimelineId) {
      issues.push('candidate timeline mismatch');
    }
    if (options.nodeId !== undefined && candidate.nodeId !== options.nodeId) {
      issues.push('candidate node mismatch');
    }
    if (options.nodeRevision !== undefined && candidate.nodeRevision !== options.nodeRevision) {
      issues.push('candidate node revision mismatch');
    }
    if (!scopeGate.pass) issues.push('candidate diff exceeds its declared scope');
    return issues.length === 0
      ? { ok: true, candidate, diff, scopeGate }
      : { ok: false, issues };
  } catch (error) {
    return {
      ok: false,
      issues: [error instanceof Error ? error.message : String(error)],
    };
  }
}

export function preparedWorkNodeCandidateRefFromProposal(
  proposal: DefPreparedWorkNodeProposalV1,
): DefPreparedWorkNodeCandidateRefV1 {
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

export function samePreparedWorkNodeCandidate(
  left: DefPreparedWorkNodeCandidateRefV1,
  right: DefPreparedWorkNodeCandidateRefV1,
): boolean {
  return canonicalJson(left as unknown as JsonValue) === canonicalJson(right as unknown as JsonValue);
}

/**
 * The only live-state transaction primitive used by prepared apply.  Every
 * callback after `applyTarget` is covered by the same restore-and-verify path,
 * including failures while persisting the checkout marker itself.
 */
export async function runAtomicPreparedWorkNodeApply(input: {
  readonly applyTarget: () => Promise<void>;
  readonly verifyVisibleTarget: () => Promise<PreparedAtomicVerification>;
  readonly persistCheckout: () => Promise<void>;
  readonly persistAppliedLedger: () => Promise<{ readonly applied: boolean }>;
  readonly verifyPersistedTarget: () => Promise<PreparedAtomicVerification>;
  readonly restorePreviousState: () => Promise<void>;
  readonly verifyPreviousState: () => Promise<PreparedAtomicVerification>;
}): Promise<void> {
  try {
    await input.applyTarget();
    await requirePreparedVerification(input.verifyVisibleTarget(), '候选 payload 的可见状态校验失败');
    await input.persistCheckout();
    const ledger = await input.persistAppliedLedger();
    if (!ledger.applied) throw new Error('候选 checkout ledger 没有返回 applied=true。');
    await requirePreparedVerification(input.verifyPersistedTarget(), '候选 checkout 的最终后置条件未成立');
  } catch (primaryError) {
    let rollbackError: Error | null = null;
    try {
      await input.restorePreviousState();
      await requirePreparedVerification(input.verifyPreviousState(), '原 live checkout 的恢复后置条件未成立');
    } catch (error) {
      rollbackError = error instanceof Error ? error : new Error(String(error));
    }
    throw new PreparedWorkNodeAtomicApplyError(primaryError, rollbackError);
  }
}

async function requirePreparedVerification(
  verification: PreparedAtomicVerification | Promise<PreparedAtomicVerification>,
  prefix: string,
): Promise<void> {
  const result = await verification;
  if (!result.pass) throw new Error(`${prefix}${result.reason ? `：${result.reason}` : ''}`);
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
