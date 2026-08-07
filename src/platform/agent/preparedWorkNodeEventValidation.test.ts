import assert from 'node:assert/strict';
import { isSafeProductEventShape } from './desktopAgentEventValidation';

const candidate = {
  contract: 'DefPreparedWorkNodeCandidateRefV1',
  schemaVersion: 1,
  proposalId: 'proposal-event',
  intent: 'timeline',
  destination: 'current-timeline',
  sourceTargetId: 'source-event',
  sourceRevision: 0,
  candidateTimelineId: 'timeline-event',
  nodeId: 'node-event',
  nodeRevision: 0,
  basePayloadDigest: `sha256:${'a'.repeat(64)}`,
  workingPayloadDigest: `sha256:${'b'.repeat(64)}`,
  diffDigest: `sha256:${'a'.repeat(64)}`,
  proposalDigest: `sha256:${'b'.repeat(64)}`,
  scope: ['timeline.structure'],
};

const requestedEvent = {
  schemaVersion: 1,
  sequence: 1,
  occurredAt: new Date().toISOString(),
  defSessionId: 'session-event',
  defTurnId: 'turn-event',
  interactionId: 'interaction-event',
  type: 'interaction.requested',
  payload: {
    kind: 'approval',
    prompt: '确认候选变更',
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    candidate,
    cleanup: {
      contract: 'DefPreparedWorkNodeCleanupAuditV1',
      schemaVersion: 1,
      proposalId: candidate.proposalId,
      nodeId: candidate.nodeId,
      candidateTimelineId: candidate.candidateTimelineId,
      status: 'pending',
    },
  },
};

assert.equal(isSafeProductEventShape(requestedEvent), true);
assert.equal(isSafeProductEventShape({
  ...requestedEvent,
  payload: { ...requestedEvent.payload, kind: 'question' },
}), false, 'candidate audit fields must not appear on question events');
assert.equal(isSafeProductEventShape({
  ...requestedEvent,
  payload: { ...requestedEvent.payload, candidate: { ...candidate, nodeRevision: -1 } },
}), false, 'event validation must reject an invalid candidate revision');

console.log('[preparedWorkNodeEventValidation.test] all assertions passed');
