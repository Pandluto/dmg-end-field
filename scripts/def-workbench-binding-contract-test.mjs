import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createTimelineRepository } = require('../electron/timeline-repository.cjs');
const nativeToolSource = fs.readFileSync(path.join(process.cwd(), 'agent/runtime/def-tools/opencode/def.js'), 'utf8');
const nodeBindSource = nativeToolSource.slice(
  nativeToolSource.indexOf('export const node_bind'),
  nativeToolSource.indexOf('export const node_sync_validate'),
);
assert.match(nodeBindSource, /explicitlyRequestedNodeId/,
  'node bind must distinguish an explicitly named draft from checkout convergence');
assert.doesNotMatch(nodeBindSource, /Bind that active checkout instead of/,
  'an explicitly named same-timeline draft must not be rejected merely because it is not checked out');
assert.match(nodeBindSource, /checkoutPhase === 'checkout-changed'/,
  'an active checkout transition must still fail closed before binding another draft');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'def-workbench-binding-'));
const databasePath = path.join(root, 'timeline.sqlite');

try {
  const repository = createTimelineRepository({ databasePath });
  repository.ensureDocument({ id: 'formal-a', label: 'Formal A' });
  repository.ensureDocument({ id: 'formal-b', label: 'Formal B' });
  repository.ensureDocument({ id: 'temporary-a', label: 'Temporary A', isTemporary: true });

  const binding = repository.upsertSessionAxisBinding({
    id: 'axis-a', timelineId: 'formal-a', host: 'workbench', opencodeSessionId: 'session-a',
  });
  assert.equal(binding.timelineId, 'formal-a');
  assert.equal(repository.getSessionAxisBindingBySession('workbench', 'session-a')?.id, 'axis-a');
  assert.equal(repository.getSessionAxisContext('axis-a')?.document?.id, 'formal-a');
  const payload = { selectedCharacters: [], timelineData: { staffLines: [] }, skillButtonTable: {}, allBuffList: [], characterInputMap: {}, operatorConfigPageCache: {} };
  repository.importWorkNode({ id: 'node-a', timelineId: 'formal-a', branchId: 'main', label: 'Node A', status: 'ready', approvalPolicy: 'manual', basePayload: payload, workingPayload: payload });
  repository.importWorkNode({ id: 'node-b', timelineId: 'formal-a', parentNodeId: 'node-a', branchId: 'next', label: 'Node B', status: 'ready', approvalPolicy: 'manual', basePayload: payload, workingPayload: payload });
  repository.setCheckoutRef({ timelineId: 'formal-a', targetType: 'work-node', targetId: 'node-a', updatedAt: 1 });
  repository.upsertSessionAxisBinding({ id: 'axis-a', timelineId: 'formal-a', host: 'workbench', opencodeSessionId: 'session-a', boundNodeId: 'node-a' });
  assert.equal(repository.getSessionAxisContext('axis-a')?.binding?.boundNodeId, 'node-a');
  repository.setCheckoutRef({ timelineId: 'formal-a', targetType: 'work-node', targetId: 'node-b', updatedAt: 2 });
  repository.upsertSessionAxisBinding({ id: 'axis-a', timelineId: 'formal-a', host: 'workbench', opencodeSessionId: 'session-a', boundNodeId: 'node-b' });
  const convergedContext = repository.getSessionAxisContext('axis-a');
  assert.equal(convergedContext?.binding?.boundNodeId, convergedContext?.checkout?.targetId);

  assert.throws(() => repository.upsertSessionAxisBinding({
    id: 'axis-temp', timelineId: 'temporary-a', host: 'workbench', opencodeSessionId: 'session-temp',
  }), { code: 'blocked-temporary-workspace' });
  assert.throws(() => repository.upsertSessionAxisBinding({
    id: 'axis-missing', timelineId: 'missing', host: 'workbench', opencodeSessionId: 'session-missing',
  }), { code: 'blocked-binding' });
  assert.throws(() => repository.upsertSessionAxisBinding({
    id: 'axis-a', timelineId: 'formal-b', host: 'workbench', opencodeSessionId: 'session-a',
  }), { code: 'blocked-session-mismatch' });

  repository.deleteDocument('formal-a');
  assert.equal(repository.getSessionAxisContext('axis-a'), null);
  assert.equal(repository.getSessionAxisBindingBySession('workbench', 'session-a'), undefined);
  console.log('DEF Workbench binding contract: PASS');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
