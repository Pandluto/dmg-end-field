import assert from 'node:assert/strict';
import {
  asCommandId,
  asDatabaseGeneration,
  asDefSessionId,
  asDefTurnId,
  asInteractionId,
  asTimelineId,
  asToolCallId,
  asWorkspaceId,
  type InteractionRequest,
  type InteractionStateBinding,
} from '../contracts/index.ts';
import {
  InteractionBroker,
  InteractionBrokerError,
} from './interaction-broker.ts';
import {
  ApprovalCapabilitySigner,
  verifyApprovalCapabilityToken,
} from '../../host/approval-capability-signer.ts';
import type {
  DefPreparedWorkNodeCandidateRefV1,
  DefPreparedWorkNodeReviewV1,
} from '../contracts/prepared-work-node.ts';

const digestA = `sha256:${'a'.repeat(64)}`;
const digestB = `sha256:${'b'.repeat(64)}`;
const now = Date.parse('2026-08-08T00:00:00.000Z');

function binding(overrides: Partial<InteractionStateBinding> = {}): InteractionStateBinding {
  return {
    workspaceId: asWorkspaceId('workspace-capability'),
    databaseGeneration: asDatabaseGeneration('generation-capability'),
    timelineId: asTimelineId('timeline-capability'),
    checkoutTargetId: 'source-node',
    checkoutUpdatedAt: 0,
    contentRevision: 0,
    snapshotDigest: digestA,
    ...overrides,
  };
}

const candidate: DefPreparedWorkNodeCandidateRefV1 = {
  contract: 'DefPreparedWorkNodeCandidateRefV1',
  schemaVersion: 1,
  proposalId: 'proposal-capability',
  intent: 'timeline',
  destination: 'current-timeline',
  sourceTargetId: 'source-node',
  sourceRevision: 0,
  candidateTimelineId: 'timeline-capability',
  nodeId: 'candidate-node',
  nodeRevision: 0,
  basePayloadDigest: digestA,
  workingPayloadDigest: digestB,
  diffDigest: digestA,
  proposalDigest: digestB,
  scope: ['timeline.structure'],
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
  summary: { addedPathCount: 0, removedPathCount: 0, changedPathCount: 1 },
  changes: [{ path: '/timelineData/button/nodeIndex', kind: 'changed', before: 0, after: 1 }],
};

function approval(id: string, overrides: Partial<Extract<InteractionRequest, { kind: 'approval' }>> = {}): Extract<InteractionRequest, { kind: 'approval' }> {
  return {
    interactionId: asInteractionId(id),
    defSessionId: asDefSessionId(`session-${id}`),
    defTurnId: asDefTurnId(`turn-${id}`),
    toolCallId: asToolCallId(`tool-${id}`),
    kind: 'approval',
    prompt: '确认候选变更',
    proposalHash: digestB,
    binding: binding(),
    scope: ['timeline.structure'],
    proposal: { operation: 'timeline.preview' },
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 60_000).toISOString(),
    candidate,
    candidateReview: review,
    ...overrides,
  };
}

function expectBrokerCode(action: () => unknown, code: string): void {
  assert.throws(action, (error: unknown) => error instanceof InteractionBrokerError && error.code === code);
}

const broker = new InteractionBroker({ clock: () => now, keyEpoch: 'epoch-capability-v2' });
const record = broker.register(approval('prepared'));
broker.approve(record.request.interactionId);
const claims = broker.issueApprovalCapability(record.request.interactionId, asCommandId('command-prepared'));
assert.equal(claims.schemaVersion, 2);
if (claims.schemaVersion !== 2) throw new Error('Expected a candidate-bound V2 capability');
assert.deepEqual(claims.candidate, candidate);
assert.deepEqual(
  broker.validatePreparedApprovalCapability(claims, candidate, {
    interactionId: record.request.interactionId,
    commandId: asCommandId('command-prepared'),
    binding: binding(),
  }),
  claims,
);

// A prepared capability binds every compact candidate field.
for (const [field, replacement] of [
  ['nodeId', 'forged-node'],
  ['nodeRevision', 1],
  ['diffDigest', digestB],
  ['scope', ['buff.attachments']],
] as const) {
  const forged = { ...claims, candidate: { ...claims.candidate, [field]: replacement } } as typeof claims;
  expectBrokerCode(
    () => broker.validatePreparedApprovalCapability(forged, candidate),
    'INTERACTION_CAPABILITY_INVALID',
  );
}
expectBrokerCode(
  () => broker.validateApprovalCapability(claims, { binding: binding({ contentRevision: 1 }) }),
  'INTERACTION_CAPABILITY_BINDING_MISMATCH',
);

// Legacy V1 remains valid on the old path but is rejected by prepared apply.
const legacy = broker.register(approval('legacy', {
  candidate: undefined,
  candidateReview: undefined,
}));
broker.approve(legacy.request.interactionId);
const legacyClaims = broker.issueApprovalCapability(legacy.request.interactionId, asCommandId('command-legacy'));
assert.equal(legacyClaims.schemaVersion, 1);
expectBrokerCode(
  () => broker.validatePreparedApprovalCapability(legacyClaims, candidate),
  'INTERACTION_CAPABILITY_VERSION_UNSUPPORTED',
);

// The full review is kept on the interaction; it is not copied into the signed token.
const largeReview = {
  ...review,
  changes: [{
    path: '/timelineData/button/description',
    kind: 'changed' as const,
    before: 'before',
    after: 'review-only-'.repeat(1_000),
  }],
  summary: { addedPathCount: 0, removedPathCount: 0, changedPathCount: 1 },
};
const largeRecord = broker.register(approval('large-review', { candidateReview: largeReview }));
assert.equal((largeRecord.request as Extract<InteractionRequest, { kind: 'approval' }>).candidateReview?.changes.length, 1);
broker.approve(largeRecord.request.interactionId);
const signer = new ApprovalCapabilitySigner({ keyEpoch: 'epoch-capability-v2' });
const largeClaims = broker.issueApprovalCapability(largeRecord.request.interactionId, asCommandId('command-large'));
const token = signer.sign(largeClaims);
assert.equal(token.includes('review-only-'), false);
assert.deepEqual(verifyApprovalCapabilityToken(token, signer.verificationKey), largeClaims);

console.log('[prepared-capability.contract.test] all assertions passed');
