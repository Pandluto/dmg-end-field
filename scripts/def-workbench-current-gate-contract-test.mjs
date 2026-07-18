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
repository.ensureDocument({ id: 'temporary-a', label: 'temporary-a', isTemporary: true });
repository.upsertSessionAxisBinding({ id: 'axis-a', timelineId: 'formal-a', host: 'workbench', opencodeSessionId: 'session-a' });

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
  const response = await request('/api/main-workbench/snapshot', {
    activeTimelineId: timelineId,
    timelineId,
    selectedCharacters: [{ id: 'operator-a', name: 'Operator A' }],
    skillButtons: [],
    operatorConfigs: [],
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
  const currentRead = await tool('def.worknode.list', {}, 'session-a');
  assert.equal(currentRead.status, 200, JSON.stringify(currentRead.body));
  assert.deepEqual(currentRead.body.result.nodes.map((node) => node.id), ['node-a']);

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
