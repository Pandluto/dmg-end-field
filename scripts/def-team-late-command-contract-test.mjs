import assert from 'node:assert/strict';
import { observeAtomicTeamApplyCommand } from '../agent/runtime/def-tools/atomic-team-command-state.mjs';

// This is a queue-level contract rather than two independent classifications:
// one exact command first times out, then the renderer completes it late and
// writes C.  The second observation must keep that command identity and route
// it to guarded rollback rather than preserve a stale idempotent no-op.
const commandId = 'cmd-delayed-apply';
const queue = new Map([[commandId, { id: commandId, status: 'running' }]]);
let candidateLive = false;
const observe = () => observeAtomicTeamApplyCommand({
  commandId,
  waitMs: 0,
  waitForCommand: async (id) => ({ commandId: id, result: queue.get(id), pass: false }),
  candidateIsLive: async () => candidateLive,
  parentIsCanonical: async () => !candidateLive,
});

const timedOut = await observe();
assert.equal(timedOut.commandState.kind, 'unresolved');
assert.equal(timedOut.commandVerification.commandId, commandId);

queue.delete(commandId);
const missing = await observe();
assert.equal(missing.commandState.kind, 'unresolved', 'a missing exact command is not a terminal P no-op');
queue.set(commandId, { id: commandId, status: 'running' });

// Simulate the real delayed renderer queue completing after the caller has
// already received RECONCILIATION_REQUIRED; this is deliberately asynchronous
// so the second read observes a later queue state, not a prebuilt fixture.
await new Promise((resolve) => setTimeout(() => {
  queue.set(commandId, { id: commandId, status: 'done' });
  candidateLive = true;
  resolve();
}, 15));
const lateWrite = await observe();
assert.equal(lateWrite.commandState.kind, 'rollback');
assert.equal(lateWrite.commandVerification.commandId, commandId);

queue.set(commandId, { id: commandId, status: 'error' });
candidateLive = false;
const rejected = await observe();
assert.equal(rejected.commandState.kind, 'zero-change');

console.log('DEF team late-command contract: PASS (one delayed queue command re-enters reconciliation and routes C to rollback)');
