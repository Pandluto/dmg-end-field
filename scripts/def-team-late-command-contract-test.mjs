import assert from 'node:assert/strict';
import { assessAtomicTeamApplyCommand } from '../agent/runtime/def-tools/atomic-team-command-state.mjs';

// Model the real queue race: the first verification times out while the
// renderer still owns a pending command. It must never be labelled no-change.
const timedOut = assessAtomicTeamApplyCommand({ status: 'running', candidateLive: false, parentCanonical: true });
assert.deepEqual(timedOut, { kind: 'unresolved', code: 'team-loadout-apply-unresolved' });

// The same command later reaches a terminal result after C has appeared. The
// next reconciliation must restore/reconcile C, not preserve the old claim.
const lateWrite = assessAtomicTeamApplyCommand({ status: 'done', candidateLive: true, parentCanonical: false });
assert.deepEqual(lateWrite, { kind: 'rollback', code: 'team-loadout-apply-failed' });

const rejected = assessAtomicTeamApplyCommand({ status: 'error', candidateLive: false, parentCanonical: true });
assert.deepEqual(rejected, { kind: 'zero-change', code: 'team-loadout-apply-rejected' });

console.log('DEF team late-command contract: PASS (timeout unresolved; late C requires reconciliation)');
