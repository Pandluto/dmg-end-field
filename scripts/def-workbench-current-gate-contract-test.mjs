import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createTimelineRepository } = require('../electron/timeline-repository.cjs');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'def-workbench-current-gate-'));
const port = 18300 + Math.floor(Math.random() * 400);
const databasePath = path.join(root, 'timeline.sqlite');
const internalToken = 'current-gate-contract-native-host';
const repository = createTimelineRepository({ databasePath });
const payload = {
  selectedCharacters: [],
  timelineData: { staffLines: [] },
  skillButtonTable: {},
  allBuffList: [],
  characterInputMap: {},
  operatorConfigPageCache: {},
};

function seedTimeline(id, nodeId) {
  const seededPayload = { ...payload, selectedCharacters: [`operator-${id.endsWith('-b') ? 'b' : 'a'}`] };
  repository.ensureDocument({ id, label: id });
  repository.importWorkNode({
    id: nodeId, timelineId: id, branchId: `${id}-main`, label: `${id} parent`,
    status: 'ready', approvalPolicy: 'manual', basePayload: seededPayload, workingPayload: seededPayload,
    contentRevision: 100,
  });
  repository.setCheckoutRef({ timelineId: id, targetType: 'work-node', targetId: nodeId, updatedAt: 100 });
}

seedTimeline('formal-a', 'node-a');
seedTimeline('formal-b', 'node-b');
const snapshotPayload = { ...payload, selectedCharacters: ['operator-snapshot'] };
repository.ensureDocument({ id: 'formal-snapshot', label: 'formal-snapshot' });
repository.createOrReuseSnapshot({
  id: 'snapshot-a', timelineId: 'formal-snapshot', label: 'snapshot-a', payload: snapshotPayload, createdAt: 100,
});
repository.setCheckoutRef({ timelineId: 'formal-snapshot', targetType: 'snapshot', targetId: 'snapshot-a', updatedAt: 100 });
repository.ensureDocument({ id: 'formal-no-checkout', label: 'formal-no-checkout' });
repository.ensureDocument({ id: 'temporary-a', label: 'temporary-a', isTemporary: true });
repository.upsertSessionAxisBinding({ id: 'axis-a', timelineId: 'formal-a', host: 'workbench', opencodeSessionId: 'session-a' });
repository.upsertSessionAxisBinding({ id: 'axis-snapshot', timelineId: 'formal-snapshot', host: 'workbench', opencodeSessionId: 'session-snapshot' });
repository.upsertSessionAxisBinding({ id: 'axis-no-checkout', timelineId: 'formal-no-checkout', host: 'workbench', opencodeSessionId: 'session-no-checkout' });

const child = spawn(process.execPath, ['scripts/ai-cli-rest-server.mjs'], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    AI_CLI_REST_PORT: String(port),
    AI_CLI_REST_STORAGE_MODE: 'runtime',
    AI_CLI_REST_STORAGE_DIR: path.join(root, 'rest'),
    AI_TIMELINE_WORK_NODE_DB_PATH: path.join(root, 'nodes.sqlite'),
    AI_TIMELINE_WORK_NODE_LEGACY_PATH: path.join(root, 'nodes.json'),
    TIMELINE_REPOSITORY_DB_PATH: databasePath,
    DATA_MANAGEMENT_RUNTIME_ROOT: path.join(root, 'data'),
    DEF_TOOL_GOVERNANCE_PATH: path.join(root, 'governance.json'),
    DEF_INTERNAL_GOVERNANCE_TOKEN: internalToken,
  },
  stdio: 'ignore',
});

async function waitForReady() {
  for (let index = 0; index < 80; index += 1) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) return;
    } catch {
      // Service is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Timed out waiting for current-gate contract server.');
}

async function request(pathname, body) {
  const response = await fetch(`http://127.0.0.1:${port}${pathname}`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-def-internal-token': internalToken }, body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

async function tool(tool, input = {}, sessionId = '') {
  return request('/api/def-tools/call', { tool, input, ...(sessionId ? { sessionId } : {}) });
}

async function mirror(timelineId) {
  const checkout = repository.getCheckoutRef(timelineId);
  const response = await request('/api/main-workbench/snapshot', {
    source: 'app',
    activeTimelineId: timelineId,
    timelineId,
    checkout,
    selectedCharacters: [{ id: 'operator-a', name: 'Operator A' }],
    skillButtons: [],
    operatorConfigs: [],
    damageReport: { generatedAt: 1, totalExpected: 0, totalNonCrit: 0, buttonCount: 0, buttons: [] },
    updatedAt: Date.now(),
  });
  assert.equal(response.status, 200, JSON.stringify(response.body));
}

function nodeIds(timelineId) {
  return repository.listWorkNodes(timelineId).map((node) => node.id).sort();
}

try {
  await waitForReady();

  await mirror('formal-a');

  // Snapshot checkouts are a normal formal-workspace state.  They must pass
  // the same payload, identity, and complete-Canvas checks as Work Nodes.
  const forgedSnapshotProjection = await request('/api/main-workbench/snapshot', {
    source: 'app', activeTimelineId: 'formal-snapshot', timelineId: 'formal-snapshot', checkout: repository.getCheckoutRef('formal-snapshot'),
    selectedCharacters: [{ id: 'operator-forged', name: 'Operator forged' }], skillButtons: [], operatorConfigs: [],
    damageReport: { generatedAt: 1, totalExpected: 0, totalNonCrit: 0, buttonCount: 0, buttons: [] }, updatedAt: Date.now(),
  });
  assert.equal(forgedSnapshotProjection.status, 200, JSON.stringify(forgedSnapshotProjection.body));
  const forgedSnapshotRead = await tool('def.team.loadouts.read', {}, 'session-snapshot');
  assert.equal(forgedSnapshotRead.status, 409, JSON.stringify(forgedSnapshotRead.body));
  assert.equal(forgedSnapshotRead.body.error.code, 'blocked-session-mismatch');

  const nonCanvasSnapshotProjection = await request('/api/main-workbench/snapshot', {
    source: 'rest', activeTimelineId: 'formal-snapshot', timelineId: 'formal-snapshot', checkout: repository.getCheckoutRef('formal-snapshot'),
    selectedCharacters: [{ id: 'operator-snapshot', name: 'Operator snapshot' }], skillButtons: [], operatorConfigs: [],
    damageReport: { generatedAt: 1, totalExpected: 0, totalNonCrit: 0, buttonCount: 0, buttons: [] }, updatedAt: Date.now(),
  });
  assert.equal(nonCanvasSnapshotProjection.status, 200, JSON.stringify(nonCanvasSnapshotProjection.body));
  const nonCanvasSnapshotRead = await tool('def.team.loadouts.read', {}, 'session-snapshot');
  assert.equal(nonCanvasSnapshotRead.status, 409, JSON.stringify(nonCanvasSnapshotRead.body));

  const validSnapshotProjection = await request('/api/main-workbench/snapshot', {
    source: 'app', activeTimelineId: 'formal-snapshot', timelineId: 'formal-snapshot', checkout: repository.getCheckoutRef('formal-snapshot'),
    selectedCharacters: [{ id: 'operator-snapshot', name: 'Operator snapshot' }], skillButtons: [], operatorConfigs: [],
    damageReport: { generatedAt: 1, totalExpected: 0, totalNonCrit: 0, buttonCount: 0, buttons: [] }, updatedAt: Date.now(),
  });
  assert.equal(validSnapshotProjection.status, 200, JSON.stringify(validSnapshotProjection.body));
  const validSnapshotRead = await tool('def.team.loadouts.read', {}, 'session-snapshot');
  assert.equal(validSnapshotRead.status, 200, JSON.stringify(validSnapshotRead.body));
  assert.deepEqual(validSnapshotRead.body.result.operators.map((operator) => operator.characterId), ['operator-snapshot']);

  const noCheckoutProjection = await request('/api/main-workbench/snapshot', {
    source: 'app', activeTimelineId: 'formal-no-checkout', timelineId: 'formal-no-checkout', checkout: null,
    selectedCharacters: [], skillButtons: [], operatorConfigs: [],
    damageReport: { generatedAt: 1, totalExpected: 0, totalNonCrit: 0, buttonCount: 0, buttons: [] }, updatedAt: Date.now(),
  });
  assert.equal(noCheckoutProjection.status, 200, JSON.stringify(noCheckoutProjection.body));
  const noCheckoutRead = await tool('def.team.loadouts.read', {}, 'session-no-checkout');
  assert.equal(noCheckoutRead.status, 409, JSON.stringify(noCheckoutRead.body));
  assert.equal(noCheckoutRead.body.error.code, 'blocked-session-mismatch');

  await mirror('formal-a');
  const currentRead = await tool('def.worknode.list', {}, 'session-a');
  assert.equal(currentRead.status, 200, JSON.stringify(currentRead.body));
  assert.deepEqual(currentRead.body.result.nodes.map((node) => node.id), ['node-a']);

  // Matching payload content is insufficient: a projection published for an
  // older checkout revision must not become current merely because the node's
  // working payload happens to be unchanged.
  repository.setCheckoutRef({ timelineId: 'formal-a', targetType: 'work-node', targetId: 'node-a', updatedAt: 101 });
  const staleCheckoutIdentity = await tool('def.worknode.list', {}, 'session-a');
  assert.equal(staleCheckoutIdentity.status, 409, JSON.stringify(staleCheckoutIdentity.body));
  assert.equal(staleCheckoutIdentity.body.error.code, 'blocked-session-mismatch');
  repository.setCheckoutRef({ timelineId: 'formal-a', targetType: 'work-node', targetId: 'node-a', updatedAt: 100 });
  await mirror('formal-a');

  // A checkout-shaped projection without the Canvas damage/runtime envelope is
  // not a valid current projection, even when its team payload matches.
  const incomplete = await request('/api/main-workbench/snapshot', {
    source: 'app', activeTimelineId: 'formal-a', timelineId: 'formal-a', checkout: repository.getCheckoutRef('formal-a'),
    selectedCharacters: [{ id: 'operator-a', name: 'Operator A' }], skillButtons: [], operatorConfigs: [], updatedAt: Date.now(),
  });
  assert.equal(incomplete.status, 200, JSON.stringify(incomplete.body));
  const incompleteRead = await tool('def.worknode.list', {}, 'session-a');
  assert.equal(incompleteRead.status, 409, JSON.stringify(incompleteRead.body));
  assert.equal(incompleteRead.body.error.code, 'blocked-session-mismatch');
  await mirror('formal-a');

  const fork = await tool('def.worknode.create_from_current', { label: 'same-tree fork' }, 'session-a');
  assert.equal(fork.status, 200, JSON.stringify(fork.body));
  assert.equal(fork.body.result.node.timelineId, 'formal-a');
  assert.equal(fork.body.result.node.parentNodeId, 'node-a');
  const afterSameTreeFork = nodeIds('formal-a');

  // The exact regression: binding remains A while the renderer projection is
  // B. Reads and forks must fail before inspecting B's payload or writing A.
  await mirror('formal-b');
  const mismatchRead = await tool('def.team.loadouts.read', {}, 'session-a');
  assert.equal(mismatchRead.status, 409, JSON.stringify(mismatchRead.body));
  assert.equal(mismatchRead.body.error.code, 'blocked-session-mismatch');
  const mismatchFork = await tool('def.worknode.create_from_current', { label: 'must-not-fork-b-into-a' }, 'session-a');
  assert.equal(mismatchFork.status, 409, JSON.stringify(mismatchFork.body));
  assert.equal(mismatchFork.body.error.code, 'blocked-session-mismatch');
  assert.deepEqual(nodeIds('formal-a'), afterSameTreeFork, 'cross-projection fork must not write A');
  assert.deepEqual(nodeIds('formal-b'), ['node-b'], 'cross-projection fork must not write B');

  // No Workbench binding means no current workspace resources, while public
  // allowlisted knowledge remains available to AI CLI callers.
  const unboundCurrent = await tool('def.team.loadouts.read');
  assert.equal(unboundCurrent.status, 403, JSON.stringify(unboundCurrent.body));
  assert.equal(unboundCurrent.body.error.code, 'blocked-binding');
  const publicKnowledge = await tool('def.knowledge.game.search', { query: '伤害' });
  assert.equal(publicKnowledge.status, 200, JSON.stringify(publicKnowledge.body));

  const temporary = await tool('def.workbench.assert_timeline_admission', { timelineId: 'temporary-a' });
  assert.equal(temporary.status, 409, JSON.stringify(temporary.body));
  assert.equal(temporary.body.error.code, 'blocked-temporary-workspace');

  console.log('DEF Workbench canonical current gate contract: PASS');
} finally {
  child.kill('SIGTERM');
  await new Promise((resolve) => child.once('exit', resolve));
  fs.rmSync(root, { recursive: true, force: true });
}
