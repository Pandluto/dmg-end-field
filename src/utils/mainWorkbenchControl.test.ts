import assert from 'node:assert/strict';
import {
  enqueueMainWorkbenchCommand,
  enqueueMainWorkbenchCommands,
  getPendingMainWorkbenchCommands,
  installMainWorkbenchTransport,
  patchMainWorkbenchCommand,
  pullRemoteMainWorkbenchCommands,
  pushMainWorkbenchCommandResult,
  pushMainWorkbenchSnapshot,
  readMainWorkbenchCommandQueue,
  writeMainWorkbenchCommandQueue,
} from './mainWorkbenchControl';

writeMainWorkbenchCommandQueue([]);

const first = enqueueMainWorkbenchCommand(
  { op: 'refreshSnapshot' },
  'contract-test',
  'command-refresh',
);
assert.equal(first.status, 'pending');
assert.equal(first.source, 'contract-test');
assert.equal(readMainWorkbenchCommandQueue().length, 1);
assert.deepEqual(
  getPendingMainWorkbenchCommands(['refreshSnapshot']).map((entry) => entry.id),
  ['command-refresh'],
);
assert.deepEqual(getPendingMainWorkbenchCommands(['calculateDamage']), []);

const duplicate = enqueueMainWorkbenchCommand(
  { op: 'calculateDamage' },
  'duplicate-must-not-replace',
  'command-refresh',
);
assert.deepEqual(
  {
    id: duplicate.id,
    command: duplicate.command,
    status: duplicate.status,
    source: duplicate.source,
    createdAt: duplicate.createdAt,
    updatedAt: duplicate.updatedAt,
  },
  first,
  'a retried command id must remain idempotent',
);
assert.equal(readMainWorkbenchCommandQueue().length, 1);

const running = patchMainWorkbenchCommand('command-refresh', { status: 'running' });
assert.equal(running?.status, 'running');
assert.equal(getPendingMainWorkbenchCommands(['refreshSnapshot']).length, 0);

const result = { refreshed: true, selectedCharacterCount: 4 };
const done = patchMainWorkbenchCommand('command-refresh', { status: 'done', result });
assert.equal(done?.status, 'done');
assert.deepEqual(done?.result, result);
assert.equal(done?.error, undefined);
assert.deepEqual(readMainWorkbenchCommandQueue()[0].result, result);

assert.equal(
  patchMainWorkbenchCommand('missing-command', { status: 'error', error: 'missing' }),
  null,
  'settling an unknown command must be a no-op',
);

const batch = enqueueMainWorkbenchCommands([
  { op: 'refreshOperatorConfig' },
  { op: 'calculateDamage' },
  { op: 'listTimelineSnapshots' },
], 'batch-contract');
assert.equal(batch.length, 3);
assert.equal(new Set(batch.map((entry) => entry.batchId)).size, 1);
assert.deepEqual(batch.map((entry) => entry.batchIndex), [0, 1, 2]);
assert.deepEqual(batch.map((entry) => entry.batchSize), [3, 3, 3]);
assert.deepEqual(
  getPendingMainWorkbenchCommands(['calculateDamage', 'listTimelineSnapshots'])
    .map((entry) => entry.command.op),
  ['calculateDamage', 'listTimelineSnapshots'],
);

const failed = patchMainWorkbenchCommand(batch[0].id, {
  status: 'error',
  error: '[operator-config-target-required] missing target',
});
assert.equal(failed?.status, 'error');
assert.equal(failed?.error, '[operator-config-target-required] missing target');
assert.equal(
  getPendingMainWorkbenchCommands(['refreshOperatorConfig']).length,
  0,
  'error results must not be claimed again',
);

const transportCalls: string[] = [];
const restoreTransport = installMainWorkbenchTransport({
  pullCommands: () => { transportCalls.push('pull'); },
  pushCommandResult: (entry) => { transportCalls.push(`result:${entry.id}`); },
  pushSnapshot: (snapshot) => { transportCalls.push(`snapshot:${snapshot.schemaVersion}`); },
});
await pullRemoteMainWorkbenchCommands();
await pushMainWorkbenchCommandResult(first);
await pushMainWorkbenchSnapshot({
  schemaVersion: 1,
  updatedAt: Date.now(),
  source: 'app',
  selectedCharacters: [],
  skillButtons: [],
});
restoreTransport();
assert.deepEqual(transportCalls, ['pull', 'result:command-refresh', 'snapshot:1']);

console.log('Main Workbench command queue lifecycle contract: PASS');
