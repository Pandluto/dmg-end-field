import crypto from 'node:crypto';

// This is deliberately an in-memory authority. A sidecar restart discards
// every grant instead of attempting to reconstruct a Harness capability from
// caller-controlled values or a persisted timeline document.
export const HARNESS_READ_PROJECTION_LEASE_CONTRACT = 'HarnessReadProjectionLeaseV1';
export const HARNESS_READ_SESSION_POLICY_CONTRACT = 'HarnessReadSessionPolicyV1';

const MAX_PROVISION_TTL_MS = 60_000;
const MAX_ACTIVE_TTL_MS = 5 * 60_000;

function text(value) { return typeof value === 'string' ? value.trim() : ''; }
function same(left, right) { return text(left) && text(left) === text(right); }
function digest(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('base64url');
}

function safeCommitments(value = {}) {
  return {
    sourceTimelineId: text(value.sourceTimelineId),
    sourceCheckoutTargetType: text(value.sourceCheckoutTargetType),
    sourceCheckoutTargetId: text(value.sourceCheckoutTargetId),
    sourceCheckoutUpdatedAt: Number(value.sourceCheckoutUpdatedAt) || 0,
    sourcePayloadHash: text(value.sourcePayloadHash),
    sourceRevision: Number(value.sourceRevision) || 0,
    sourceProjectionHash: text(value.sourceProjectionHash),
    fixtureTimelineId: text(value.fixtureTimelineId),
    fixtureNodeId: text(value.fixtureNodeId),
    fixtureCheckoutUpdatedAt: Number(value.fixtureCheckoutUpdatedAt) || 0,
    fixturePayloadHash: text(value.fixturePayloadHash),
    fixtureRevision: Number(value.fixtureRevision) || 0,
  };
}

function safeSession(value = {}) {
  return {
    sessionId: text(value.sessionId),
    axisBindingId: text(value.axisBindingId),
    timelineId: text(value.timelineId),
    boundNodeId: text(value.boundNodeId),
    harnessCommitment: text(value.harnessCommitment),
    agentReleaseCommitment: text(value.agentReleaseCommitment),
  };
}

function sameSession(left, right) {
  return same(left.sessionId, right.sessionId)
    && same(left.axisBindingId, right.axisBindingId)
    && same(left.timelineId, right.timelineId)
    && left.boundNodeId === right.boundNodeId
    // Runtime gate callers obtain their first four fields from SQLite. The
    // harness/release commitments are checked at activation, then retained in
    // this private record; do not require a model-facing tool invocation to
    // echo a secret-ish integrity commitment merely to use its own binding.
    && (!right.harnessCommitment || same(left.harnessCommitment, right.harnessCommitment))
    && (!right.agentReleaseCommitment || same(left.agentReleaseCommitment, right.agentReleaseCommitment));
}

export function createHarnessProjectionLeaseStore({
  now = () => Date.now(),
  randomBytes = (size) => crypto.randomBytes(size),
  activeLimit = 4,
} = {}) {
  const provisions = new Map();
  const activeBySession = new Map();
  const tombstones = new Map();

  function prune(at = now()) {
    for (const [hash, record] of provisions) {
      if (record.expiresAt <= at || record.state === 'consumed') provisions.delete(hash);
    }
    for (const [sessionId, record] of activeBySession) {
      if (record.expiresAt <= at) {
        activeBySession.delete(sessionId);
        tombstones.set(sessionId, { revokedAt: at, reason: 'expired', expiresAt: at + MAX_ACTIVE_TTL_MS });
      }
    }
    for (const [sessionId, record] of tombstones) if (record.expiresAt <= at) tombstones.delete(sessionId);
  }

  function provision({ mode, commitments, projection = null, allowedTools = [], ttlMs = MAX_PROVISION_TTL_MS } = {}) {
    prune();
    if (!['hidden-fixture', 'active-current-readonly'].includes(mode)) {
      return { ok: false, code: 'invalid-harness-projection-mode' };
    }
    const normalizedMode = mode;
    const evidence = safeCommitments(commitments);
    if (!evidence.sourceTimelineId || !evidence.sourceCheckoutTargetId || !evidence.sourcePayloadHash || !evidence.sourceProjectionHash) {
      return { ok: false, code: 'invalid-harness-provision-commitments' };
    }
    if (normalizedMode === 'hidden-fixture'
      && (!evidence.fixtureTimelineId || !evidence.fixtureNodeId || !evidence.fixturePayloadHash)) {
      return { ok: false, code: 'invalid-harness-fixture-commitments' };
    }
    const token = randomBytes(32).toString('base64url');
    const tokenHash = digest(token);
    const issuedAt = now();
    provisions.set(tokenHash, {
      contract: normalizedMode === 'hidden-fixture'
        ? HARNESS_READ_PROJECTION_LEASE_CONTRACT
        : HARNESS_READ_SESSION_POLICY_CONTRACT,
      state: 'provisioned',
      mode: normalizedMode,
      commitments: evidence,
      projection: projection && typeof projection === 'object' ? JSON.parse(JSON.stringify(projection)) : null,
      allowedTools: [...new Set((Array.isArray(allowedTools) ? allowedTools : []).map(text).filter(Boolean))].sort(),
      issuedAt,
      expiresAt: issuedAt + Math.max(1, Math.min(Number(ttlMs) || MAX_PROVISION_TTL_MS, MAX_PROVISION_TTL_MS)),
    });
    return { ok: true, token, expiresAt: provisions.get(tokenHash).expiresAt };
  }

  // A native session must prove a still-provisioned lease before its first
  // binding, but that proof must not consume the one-shot activation token.
  // Return only the public binding coordinates needed by the Host; never
  // expose the token, private projection, or full commitments.
  function assertProvision({ token, mode, timelineId, boundNodeId = '' } = {}) {
    const supplied = text(token);
    if (!supplied) return { ok: false, code: 'missing-harness-provision-token' };
    const tokenHash = digest(supplied);
    const record = provisions.get(tokenHash);
    if (!record || record.state !== 'provisioned') return { ok: false, code: 'harness-provision-invalid-or-consumed' };
    if (record.expiresAt <= now()) {
      provisions.delete(tokenHash);
      return { ok: false, code: 'harness-provision-expired' };
    }
    const requestedMode = text(mode);
    if (!requestedMode || requestedMode !== record.mode) return { ok: false, code: 'harness-provision-mode-mismatch' };
    const expectedTimelineId = record.mode === 'hidden-fixture'
      ? record.commitments.fixtureTimelineId
      : record.commitments.sourceTimelineId;
    const expectedBoundNodeId = record.mode === 'hidden-fixture'
      ? record.commitments.fixtureNodeId
      : (record.commitments.sourceCheckoutTargetType === 'work-node' ? record.commitments.sourceCheckoutTargetId : '');
    if (!same(timelineId, expectedTimelineId)) return { ok: false, code: 'harness-provision-timeline-mismatch' };
    const requestedBoundNodeId = text(boundNodeId);
    if (requestedBoundNodeId && requestedBoundNodeId !== expectedBoundNodeId) {
      return { ok: false, code: 'harness-provision-node-mismatch' };
    }
    return {
      ok: true,
      contract: record.contract,
      mode: record.mode,
      timelineId: expectedTimelineId,
      boundNodeId: expectedBoundNodeId,
      expiresAt: record.expiresAt,
    };
  }

  function activate({ token, session, ttlMs = MAX_ACTIVE_TTL_MS } = {}) {
    prune();
    const record = provisions.get(digest(token));
    if (!record || record.state !== 'provisioned') return { ok: false, code: 'harness-provision-invalid-or-consumed' };
    if (record.expiresAt <= now()) return { ok: false, code: 'harness-provision-expired' };
    const identity = safeSession(session);
    if (!identity.sessionId || !identity.axisBindingId || !identity.timelineId || !identity.harnessCommitment || !identity.agentReleaseCommitment) {
      return { ok: false, code: 'invalid-harness-activation-identity' };
    }
    if (identity.timelineId !== (record.mode === 'hidden-fixture'
      ? record.commitments.fixtureTimelineId
      : record.commitments.sourceTimelineId)) {
      return { ok: false, code: 'harness-activation-timeline-mismatch' };
    }
    if (record.mode === 'hidden-fixture' && !same(identity.boundNodeId, record.commitments.fixtureNodeId)) {
      return { ok: false, code: 'harness-activation-node-mismatch' };
    }
    if (record.mode === 'active-current-readonly') {
      const expectedNodeId = record.commitments.sourceCheckoutTargetType === 'work-node'
        ? record.commitments.sourceCheckoutTargetId
        : '';
      if (identity.boundNodeId !== expectedNodeId) return { ok: false, code: 'harness-activation-node-mismatch' };
    }
    if (activeBySession.has(identity.sessionId) || tombstones.has(identity.sessionId)) {
      return { ok: false, code: 'harness-session-already-revoked-or-active' };
    }
    if (activeBySession.size >= Math.max(1, Number(activeLimit) || 1)) return { ok: false, code: 'harness-active-limit' };
    // Consume before publishing the active record: a second concurrent caller
    // cannot replay the provision even if later validation/cleanup fails.
    record.state = 'consumed';
    const activatedAt = now();
    const active = {
      contract: record.contract,
      mode: record.mode,
      session: identity,
      commitments: record.commitments,
      projection: record.projection,
      allowedTools: record.allowedTools,
      activatedAt,
      expiresAt: activatedAt + Math.max(1, Math.min(Number(ttlMs) || MAX_ACTIVE_TTL_MS, MAX_ACTIVE_TTL_MS)),
    };
    activeBySession.set(identity.sessionId, active);
    return { ok: true, record: active };
  }

  function cancel({ token } = {}) {
    prune();
    const supplied = text(token);
    if (!supplied) return { ok: false, code: 'missing-harness-provision-token' };
    const tokenHash = digest(supplied);
    const record = provisions.get(tokenHash);
    if (!record || record.state !== 'provisioned') {
      return { ok: false, code: 'harness-provision-invalid-or-consumed' };
    }
    // Consume the capability before returning.  This is deliberately not a
    // best-effort marker: a cancelled provision cannot race a later activate.
    record.state = 'cancelled';
    provisions.delete(tokenHash);
    return { ok: true, status: 'cancelled' };
  }

  function resolve(session, { mode = '' } = {}) {
    prune();
    const identity = safeSession(session);
    const record = activeBySession.get(identity.sessionId);
    if (!record || (mode && record.mode !== mode) || !sameSession(record.session, identity)) {
      return { ok: false, code: 'harness-read-authority-unavailable' };
    }
    return { ok: true, record };
  }

  function revoke(sessionId, reason = 'cleanup') {
    prune();
    const id = text(sessionId);
    const record = activeBySession.get(id);
    if (record) activeBySession.delete(id);
    const at = now();
    tombstones.set(id, { revokedAt: at, reason: text(reason) || 'cleanup', expiresAt: at + MAX_ACTIVE_TTL_MS });
    return { ok: true, status: record ? 'revoked' : 'already-revoked' };
  }

  return { provision, assertProvision, activate, cancel, resolve, revoke, prune, MAX_PROVISION_TTL_MS, MAX_ACTIVE_TTL_MS };
}
