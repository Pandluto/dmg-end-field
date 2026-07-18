import assert from 'node:assert/strict';
import { assessAtomicRollbackConvergence, assessAtomicRollbackPrecondition } from '../agent/runtime/def-tools/atomic-team-rollback.mjs';

const identity = { timelineId: 'formal-a', parentNodeId: 'P', candidateNodeId: 'C' };
assert.deepEqual(assessAtomicRollbackPrecondition({ ...identity, candidateLive: false, checkout: { timelineId: 'formal-a', targetType: 'work-node', targetId: 'P' } }), { attempt: false, reason: 'candidate-not-live' }, 'apply-before-touch checkout rejection must be zero-operation');
assert.deepEqual(assessAtomicRollbackPrecondition({ ...identity, candidateLive: true, checkout: { timelineId: 'formal-b', targetType: 'work-node', targetId: 'B' } }), { attempt: false, reason: 'checkout-not-owned' }, 'A→B switch must never be pulled back to P');
assert.deepEqual(assessAtomicRollbackPrecondition({ ...identity, candidateLive: true, checkout: { timelineId: 'formal-a', targetType: 'work-node', targetId: 'C' } }), { attempt: true, expectedCheckoutNodeId: 'C' }, 'post-checkout C failure is eligible for guarded restore');

const restored = { commandRestored: true, sessionPayloadMatches: true, projectionRestored: true, damageRestored: true, lifecycleRestored: true, checkout: { targetType: 'work-node', targetId: 'P' }, parentNodeId: 'P' };
assert.equal(assessAtomicRollbackConvergence(restored), true, 'only complete P convergence is rolled back');
for (const field of ['sessionPayloadMatches', 'projectionRestored', 'damageRestored', 'lifecycleRestored']) {
  assert.equal(assessAtomicRollbackConvergence({ ...restored, [field]: false }), false, `${field} failure requires reconciliation`);
}
assert.equal(assessAtomicRollbackConvergence({ ...restored, checkout: { targetType: 'work-node', targetId: 'C' } }), false, 'C applied lifecycle cannot be reported as restored');
console.log('DEF team rollback contract: PASS (before-touch no-op, A→B protection, full convergence required)');
