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
  type ApprovalCapabilityClaims,
  type InteractionRequest,
  type InteractionResponse,
  type InteractionStateBinding,
  type JsonValue,
} from '../contracts/index.ts';
import {
  InteractionBroker,
  InteractionBrokerError,
  type InteractionBrokerErrorCode,
} from './interaction-broker.ts';

let now = Date.parse('2026-08-07T00:00:00.000Z');

function advance(milliseconds: number): void {
  now += milliseconds;
}

function binding(overrides: Partial<InteractionStateBinding> = {}): InteractionStateBinding {
  return {
    workspaceId: asWorkspaceId('workspace-broker'),
    databaseGeneration: asDatabaseGeneration('generation-broker'),
    timelineId: asTimelineId('timeline-broker'),
    checkoutTargetId: 'node-broker',
    checkoutUpdatedAt: 17,
    contentRevision: 17,
    snapshotDigest: 'sha256:broker-snapshot',
    ...overrides,
  };
}

function question(
  id: string,
  overrides: Partial<Extract<InteractionRequest, { kind: 'question' }>> = {},
): Extract<InteractionRequest, { kind: 'question' }> {
  return {
    interactionId: asInteractionId(id),
    defSessionId: asDefSessionId('def-session-broker'),
    defTurnId: asDefTurnId('def-turn-broker'),
    toolCallId: asToolCallId(`tool-${id}`),
    kind: 'question',
    prompt: `Question ${id}`,
    createdAt: new Date(now - 1_000).toISOString(),
    expiresAt: new Date(now + 60_000).toISOString(),
    details: { source: 'test', id },
    ...overrides,
  };
}

function approval(
  id: string,
  overrides: Partial<Extract<InteractionRequest, { kind: 'approval' }>> = {},
): Extract<InteractionRequest, { kind: 'approval' }> {
  return {
    interactionId: asInteractionId(id),
    defSessionId: asDefSessionId('def-session-broker'),
    defTurnId: asDefTurnId('def-turn-broker'),
    toolCallId: asToolCallId(`tool-${id}`),
    kind: 'approval',
    prompt: `Approval ${id}`,
    createdAt: new Date(now - 1_000).toISOString(),
    expiresAt: new Date(now + 60_000).toISOString(),
    proposalHash: `sha256:proposal-${id}`,
    binding: binding(),
    scope: ['timeline:write', 'timeline:read'],
    proposal: { operation: 'update', id },
    ...overrides,
  };
}

function expectCode(action: () => unknown, code: InteractionBrokerErrorCode): void {
  assert.throws(action, (error: unknown) => (
    error instanceof InteractionBrokerError && error.code === code
  ));
}

function expectResponse(
  response: InteractionResponse | null,
  status: InteractionResponse['status'],
  value?: JsonValue,
): void {
  assert.ok(response);
  assert.equal(response.status, status);
  if (value === undefined) {
    assert.equal(Object.prototype.hasOwnProperty.call(response, 'value'), false);
  } else {
    assert.deepEqual(response.value, value);
  }
}

function expectCapabilityField(claims: ApprovalCapabilityClaims): void {
  assert.equal(claims.schemaVersion, 1);
  assert.equal(claims.audience, 'browser-product-gateway');
  assert.equal(claims.keyEpoch, 'epoch-broker');
  assert.equal(claims.nonce, 'nonce-1');
  assert.equal(claims.interactionId, asInteractionId('approval-capability'));
  assert.equal(claims.commandId, asCommandId('command-broker'));
  assert.equal(claims.defSessionId, asDefSessionId('def-session-broker'));
  assert.equal(claims.defTurnId, asDefTurnId('def-turn-broker'));
  assert.equal(claims.toolCallId, asToolCallId('tool-approval-capability'));
  assert.equal(claims.proposalHash, 'sha256:proposal-approval-capability');
  assert.deepEqual(claims.binding, binding());
  assert.deepEqual(claims.scope, ['timeline:write', 'timeline:read']);
}

const broker = new InteractionBroker({
  clock: () => now,
  keyEpoch: 'epoch-broker',
  nonceFactory: (() => {
    let nonceSequence = 0;
    return () => `nonce-${++nonceSequence}`;
  })(),
});

// Registration is idempotent for the same request and rejects an ID replay with changed content.
const firstQuestion = question('question-registration');
const firstSnapshot = broker.register(firstQuestion);
assert.equal(firstSnapshot.status, 'pending');
assert.equal(firstSnapshot.capabilityState, 'not-applicable');
assert.deepEqual(broker.register({
  ...firstQuestion,
  details: { id: 'question-registration', source: 'test' },
}), firstSnapshot);
expectCode(
  () => broker.register({ ...firstQuestion, prompt: 'changed prompt' }),
  'INTERACTION_ID_CONFLICT',
);

const sessionTwo = broker.register(question('question-session-two', {
  defSessionId: asDefSessionId('def-session-two'),
}));
const turnTwo = broker.register(question('question-turn-two', {
  defTurnId: asDefTurnId('def-turn-two'),
}));
assert.deepEqual(
  broker.listPending({ defSessionId: asDefSessionId('def-session-broker') })
    .map((entry) => entry.request.interactionId),
  [asInteractionId('question-registration'), turnTwo.request.interactionId],
);
assert.deepEqual(
  broker.listPending({ defTurnId: asDefTurnId('def-turn-two') })
    .map((entry) => entry.request.interactionId),
  [turnTwo.request.interactionId],
);
assert.deepEqual(
  broker.listPending({ defSessionId: sessionTwo.request.defSessionId, kind: 'question' })
    .map((entry) => entry.request.interactionId),
  [sessionTwo.request.interactionId],
);
assert.equal(broker.get(asInteractionId('missing-interaction')), null);
expectCode(() => broker.require(asInteractionId('missing-interaction')), 'INTERACTION_NOT_FOUND');

// A question can only be answered, cancelled, expired or marked stale.
const questionAnswer = broker.register(question('question-answer'));
const answered = broker.answer(questionAnswer.request.interactionId, { answer: 'yes' });
expectResponse(answered.response, 'answered', { answer: 'yes' });
const answeredAgain = broker.answer(questionAnswer.request.interactionId, { answer: 'yes' });
assert.deepEqual(answeredAgain, answered, 'the same answer must be idempotent');
expectCode(
  () => broker.answer(questionAnswer.request.interactionId, { answer: 'no' }),
  'INTERACTION_RESPONSE_CONFLICT',
);
expectCode(
  () => broker.cancel(questionAnswer.request.interactionId),
  'INTERACTION_RESPONSE_CONFLICT',
);
expectCode(
  () => broker.reject(firstQuestion.interactionId),
  'INTERACTION_KIND_MISMATCH',
);
expectCode(
  () => broker.respond({
    interactionId: firstQuestion.interactionId,
    status: 'answered',
    resolvedAt: new Date(now).toISOString(),
  }),
  'INTERACTION_RESPONSE_INVALID',
);

const questionCancel = broker.register(question('question-cancel'));
assert.equal(broker.cancel(questionCancel.request.interactionId).status, 'cancelled');
assert.equal(broker.cancel(questionCancel.request.interactionId).status, 'cancelled');
const questionExpire = broker.register(question('question-expire'));
assert.equal(broker.expire(questionExpire.request.interactionId).status, 'expired');
const questionStale = broker.register(question('question-stale'));
assert.equal(broker.stale(questionStale.request.interactionId).status, 'stale');
assert.equal(broker.listPending().some((entry) => entry.status !== 'pending'), false);

// An approval follows the approval-only terminal transitions and issues one capability at most.
const approvalRecord = broker.register(approval('approval-capability'));
const approved = broker.approve(approvalRecord.request.interactionId, { confirmed: true });
expectResponse(approved.response, 'approved', { confirmed: true });
assert.equal(approved.capabilityState, 'not-issued');
assert.deepEqual(
  broker.approve(approvalRecord.request.interactionId, { confirmed: true }),
  approved,
  'the same approval decision must be idempotent',
);
expectCode(
  () => broker.approve(approvalRecord.request.interactionId, { confirmed: false }),
  'INTERACTION_RESPONSE_CONFLICT',
);
const claims = broker.issueApprovalCapability(
  approvalRecord.request.interactionId,
  asCommandId('command-broker'),
);
expectCapabilityField(claims);
assert.equal(broker.require(approvalRecord.request.interactionId).capabilityState, 'issued');
assert.deepEqual(
  broker.issueApprovalCapability(approvalRecord.request.interactionId, asCommandId('command-broker')),
  claims,
  'reissuing the same command capability must return the same claims',
);
expectCode(
  () => broker.issueApprovalCapability(approvalRecord.request.interactionId, asCommandId('command-other')),
  'INTERACTION_CAPABILITY_COMMAND_CONFLICT',
);

const expectedClaims = {
  interactionId: asInteractionId('approval-capability'),
  commandId: asCommandId('command-broker'),
  defSessionId: asDefSessionId('def-session-broker'),
  defTurnId: asDefTurnId('def-turn-broker'),
  toolCallId: asToolCallId('tool-approval-capability'),
  proposalHash: 'sha256:proposal-approval-capability',
  binding: binding(),
  scope: ['timeline:write', 'timeline:read'],
} as const;
assert.deepEqual(broker.validateApprovalCapability(claims, expectedClaims), claims);
for (const [field, expected] of [
  ['interactionId', asInteractionId('different-interaction')],
  ['commandId', asCommandId('different-command')],
  ['defSessionId', asDefSessionId('different-session')],
  ['defTurnId', asDefTurnId('different-turn')],
  ['toolCallId', asToolCallId('different-tool')],
  ['proposalHash', 'sha256:different-proposal'],
] as const) {
  expectCode(
    () => broker.validateApprovalCapability(claims, { [field]: expected }),
    'INTERACTION_CAPABILITY_BINDING_MISMATCH',
  );
}
expectCode(
  () => broker.validateApprovalCapability(claims, { binding: binding({ contentRevision: 18 }) }),
  'INTERACTION_CAPABILITY_BINDING_MISMATCH',
);
expectCode(
  () => broker.validateApprovalCapability(claims, { binding: binding({ checkoutUpdatedAt: 18 }) }),
  'INTERACTION_CAPABILITY_BINDING_MISMATCH',
);
expectCode(
  () => broker.validateApprovalCapability(claims, { scope: ['timeline:read'] }),
  'INTERACTION_CAPABILITY_BINDING_MISMATCH',
);

const consumed = broker.consumeApprovalCapability(claims, expectedClaims);
assert.deepEqual(consumed, claims);
assert.equal(broker.require(approvalRecord.request.interactionId).capabilityState, 'consumed');
expectCode(
  () => broker.validateApprovalCapability(claims),
  'INTERACTION_CAPABILITY_CONSUMED',
);
expectCode(
  () => broker.consumeApprovalCapability(claims),
  'INTERACTION_CAPABILITY_CONSUMED',
);
expectCode(
  () => broker.issueApprovalCapability(approvalRecord.request.interactionId, asCommandId('command-broker')),
  'INTERACTION_CAPABILITY_CONSUMED',
);

// Rejected approvals cannot issue capabilities, and all terminal transitions are one-shot.
const approvalReject = broker.register(approval('approval-reject'));
assert.equal(broker.reject(approvalReject.request.interactionId, { reason: 'no' }).status, 'rejected');
assert.equal(broker.reject(approvalReject.request.interactionId, { reason: 'no' }).status, 'rejected');
expectCode(
  () => broker.approve(approvalReject.request.interactionId),
  'INTERACTION_RESPONSE_CONFLICT',
);
expectCode(
  () => broker.issueApprovalCapability(approvalReject.request.interactionId, asCommandId('command-rejected')),
  'INTERACTION_CAPABILITY_UNAVAILABLE',
);

const approvalCancel = broker.register(approval('approval-cancel'));
assert.equal(broker.cancel(approvalCancel.request.interactionId).status, 'cancelled');
const approvalStale = broker.register(approval('approval-stale'));
assert.equal(broker.stale(approvalStale.request.interactionId).status, 'stale');

// Expiry is automatic for pending requests and closes issued capabilities fail-closed.
const expiredOnRegister = broker.register(approval('approval-expired-on-register', {
  createdAt: new Date(now - 2_000).toISOString(),
  expiresAt: new Date(now).toISOString(),
}));
assert.equal(expiredOnRegister.status, 'expired');
const approvalExpiry = broker.register(approval('approval-expiry'));
broker.approve(approvalExpiry.request.interactionId);
const expiringClaims = broker.issueApprovalCapability(
  approvalExpiry.request.interactionId,
  asCommandId('command-expiry'),
);
advance(60_000);
assert.equal(broker.listPending().some((entry) => entry.request.interactionId === approvalExpiry.request.interactionId), false);
assert.equal(broker.require(approvalExpiry.request.interactionId).capabilityState, 'invalidated');
expectCode(
  () => broker.validateApprovalCapability(expiringClaims),
  'INTERACTION_CAPABILITY_EXPIRED',
);
expectCode(
  () => broker.consumeApprovalCapability(expiringClaims),
  'INTERACTION_CAPABILITY_EXPIRED',
);

// Explicit invalidation is idempotent, but it cannot be bypassed by a forged claims object.
now = Date.parse('2026-08-07T00:00:00.000Z');
const approvalInvalidate = broker.register(approval('approval-invalidate'));
broker.approve(approvalInvalidate.request.interactionId);
const invalidatedClaims = broker.issueApprovalCapability(
  approvalInvalidate.request.interactionId,
  asCommandId('command-invalidate'),
);
broker.invalidateApprovalCapability(invalidatedClaims);
broker.invalidateApprovalCapability(invalidatedClaims);
assert.equal(broker.require(approvalInvalidate.request.interactionId).capabilityState, 'invalidated');
expectCode(
  () => broker.validateApprovalCapability(invalidatedClaims),
  'INTERACTION_CAPABILITY_INVALIDATED',
);
expectCode(
  () => broker.validateApprovalCapability({ ...invalidatedClaims, nonce: 'forged-nonce' }),
  'INTERACTION_CAPABILITY_INVALID',
);

// A capability without a Tool Call binding cannot be issued.
const approvalWithoutTool = broker.register(approval('approval-without-tool', { toolCallId: undefined }));
broker.approve(approvalWithoutTool.request.interactionId);
expectCode(
  () => broker.issueApprovalCapability(approvalWithoutTool.request.interactionId, asCommandId('command-no-tool')),
  'INTERACTION_CAPABILITY_UNAVAILABLE',
);

const nonceBroker = new InteractionBroker({
  clock: () => now,
  keyEpoch: 'epoch-nonce',
  nonceFactory: () => 'duplicate-nonce',
});
const nonceApprovalOne = nonceBroker.register(approval('approval-nonce-one'));
nonceBroker.approve(nonceApprovalOne.request.interactionId);
nonceBroker.issueApprovalCapability(nonceApprovalOne.request.interactionId, asCommandId('command-nonce-one'));
const nonceApprovalTwo = nonceBroker.register(approval('approval-nonce-two'));
nonceBroker.approve(nonceApprovalTwo.request.interactionId);
expectCode(
  () => nonceBroker.issueApprovalCapability(nonceApprovalTwo.request.interactionId, asCommandId('command-nonce-two')),
  'INTERACTION_NONCE_CONFLICT',
);

// Promise scheduling cannot create a double terminal transition or double capability consumption.
const raceQuestion = broker.register(question('question-race'));
const raceResponses = await Promise.allSettled([
  Promise.resolve().then(() => broker.answer(raceQuestion.request.interactionId, 'first')),
  Promise.resolve().then(() => broker.cancel(raceQuestion.request.interactionId)),
]);
assert.equal(raceResponses.filter((result) => result.status === 'fulfilled').length, 1);
assert.equal(raceResponses.filter((result) => result.status === 'rejected').length, 1);
assert.equal(broker.require(raceQuestion.request.interactionId).status, 'answered');

const raceApproval = broker.register(approval('approval-race'));
broker.approve(raceApproval.request.interactionId);
const raceClaims = broker.issueApprovalCapability(
  raceApproval.request.interactionId,
  asCommandId('command-race'),
);
const raceConsumes = await Promise.allSettled([
  Promise.resolve().then(() => broker.consumeApprovalCapability(raceClaims)),
  Promise.resolve().then(() => broker.consumeApprovalCapability(raceClaims)),
]);
assert.equal(raceConsumes.filter((result) => result.status === 'fulfilled').length, 1);
assert.equal(raceConsumes.filter((result) => result.status === 'rejected').length, 1);
assert.equal(broker.require(raceApproval.request.interactionId).capabilityState, 'consumed');

console.log('[interaction-broker.test] all assertions passed');
