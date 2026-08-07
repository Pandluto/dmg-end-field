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
} from '../core/contracts/index.ts';
import {
  ApprovalCapabilitySigner,
  verifyApprovalCapabilityToken,
} from './approval-capability-signer.ts';

const signer = new ApprovalCapabilitySigner({ keyEpoch: 'approval-contract-1' });
const claims: ApprovalCapabilityClaims = {
  schemaVersion: 1,
  audience: 'browser-product-gateway',
  keyEpoch: signer.verificationKey.keyEpoch,
  nonce: 'nonce-contract',
  issuedAt: '2026-08-07T00:00:00.000Z',
  expiresAt: '2026-08-07T00:15:00.000Z',
  interactionId: asInteractionId('interaction-contract'),
  commandId: asCommandId('command-contract'),
  defSessionId: asDefSessionId('def-session-contract'),
  defTurnId: asDefTurnId('def-turn-contract'),
  toolCallId: asToolCallId('tool-contract'),
  proposalHash: 'sha256:proposal-contract',
  binding: {
    workspaceId: asWorkspaceId('workspace-contract'),
    databaseGeneration: asDatabaseGeneration('generation-contract'),
    timelineId: asTimelineId('timeline-contract'),
    checkoutTargetId: 'node-contract',
    checkoutUpdatedAt: 1,
    contentRevision: 2,
    snapshotDigest: 'sha256:snapshot-contract',
  },
  scope: ['timeline.buttons'],
};

const token = signer.sign(claims);
assert.deepEqual(verifyApprovalCapabilityToken(token, signer.verificationKey), claims);
const segments = token.split('.');
const tamperedPayload = `${segments[0]}.${Buffer.from('{}').toString('base64url')}.${segments[2]}`;
assert.throws(() => verifyApprovalCapabilityToken(tamperedPayload, signer.verificationKey));
const otherSigner = new ApprovalCapabilitySigner({ keyEpoch: 'approval-contract-2' });
assert.throws(() => verifyApprovalCapabilityToken(token, otherSigner.verificationKey));
assert.throws(() => signer.sign({ ...claims, keyEpoch: 'approval-contract-x' }));

console.log('Approval capability signer contract passed');
