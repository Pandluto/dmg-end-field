import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createTimelineRepository } = require('../electron/timeline-repository.cjs');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'def-team-pending-reconciliation-'));
const port = 19600 + Math.floor(Math.random() * 200);
const token = 'pending-reconciliation-contract-native-host';
const baseUrl = `http://127.0.0.1:${port}`;
const databasePath = path.join(root, 'timeline.sqlite');
const repository = createTimelineRepository({ databasePath });

const parentPayload = {
  selectedCharacters: ['char-a'], timelineData: { staffLines: [] }, skillButtonTable: {}, allBuffList: [], characterInputMap: {},
  operatorConfigPageCache: { 'char-a': { weapon: { id: 'weapon-a', config: { level: 1, potential: 0 } }, equipment: { pieces: [{ slotKey: 'armor', equipmentId: 'armor-p' }] } } },
};
const candidatePayload = structuredClone(parentPayload);
candidatePayload.operatorConfigPageCache['char-a'].equipment.pieces = [{ slotKey: 'armor', equipmentId: 'armor-c' }];
repository.ensureDocument({ id: 'formal-a', label: 'Formal A' });
repository.importWorkNode({ id: 'parent-p', timelineId: 'formal-a', branchId: 'main', label: 'P', status: 'ready', approvalPolicy: 'manual', basePayload: parentPayload, workingPayload: parentPayload, contentRevision: 101 });
repository.importWorkNode({ id: 'candidate-c', timelineId: 'formal-a', parentNodeId: 'parent-p', branchId: 'candidate', label: 'C', status: 'open', approvalPolicy: 'manual', basePayload: parentPayload, workingPayload: candidatePayload, contentRevision: 102 });
repository.setCheckoutRef({ timelineId: 'formal-a', targetType: 'work-node', targetId: 'parent-p', updatedAt: 101 });
repository.upsertSessionAxisBinding({ id: 'axis-a', timelineId: 'formal-a', host: 'workbench', opencodeSessionId: 'session-a' });

const child = spawn(process.execPath, ['scripts/ai-cli-rest-server.mjs'], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    DEF_CONTRACT_TEST_MODE: '1',
    AI_CLI_REST_PORT: String(port), AI_CLI_REST_STORAGE_MODE: 'runtime',
    AI_CLI_REST_STORAGE_DIR: path.join(root, 'rest'), AI_CLI_REST_VITE_CACHE_DIR: path.join(root, 'vite'),
    AI_TIMELINE_WORK_NODE_DB_PATH: path.join(root, 'nodes.sqlite'), AI_TIMELINE_WORK_NODE_LEGACY_PATH: path.join(root, 'nodes.json'),
    TIMELINE_REPOSITORY_DB_PATH: databasePath, DATA_MANAGEMENT_RUNTIME_ROOT: path.join(root, 'data'),
    DEF_TOOL_GOVERNANCE_PATH: path.join(root, 'governance.json'), DEF_INTERNAL_GOVERNANCE_TOKEN: token,
  },
  stdio: 'ignore',
});

const snapshotFor = (payload) => ({
  source: 'app', activeTimelineId: 'formal-a', timelineId: 'formal-a', checkout: repository.getCheckoutRef('formal-a'),
  selectedCharacters: [{ id: 'char-a', name: 'Character A' }], skillButtons: [],
  operatorConfigs: [{ characterId: 'char-a', weapon: { id: 'weapon-a', level: 1, potential: 0 }, equipment: payload.operatorConfigPageCache['char-a'].equipment.pieces }],
  damageReport: { totalExpected: 10, totalNonCrit: 9, buttonCount: 0, buttons: [] }, updatedAt: Date.now(),
});

async function waitForReady() {
  for (let index = 0; index < 80; index += 1) {
    try { if ((await fetch(`${baseUrl}/health`)).ok) return; } catch { /* starting */ }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('Pending reconciliation contract server did not start.');
}

async function request(pathname, { method = 'POST', body } = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: { 'content-type': 'application/json', 'x-def-internal-token': token },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: await response.json() };
}

async function tool(name, input = {}) {
  return request('/api/def-tools/call', { body: { tool: name, input, sessionId: 'session-a' } });
}

try {
  await waitForReady();
  assert.equal((await request('/api/main-workbench/snapshot', { body: snapshotFor(parentPayload) })).status, 200);

  const seededIdle = await request('/api/def-contract-test/pending-team-reconciliation', {
    body: { planHash: 'a'.repeat(64), sessionId: 'session-a', timelineId: 'formal-a', axisBindingId: 'axis-a', parentNodeId: 'parent-p', candidateNodeId: 'candidate-c' },
  });
  assert.equal(seededIdle.status, 200, JSON.stringify(seededIdle.body));
  const idle = await tool('def.team.loadout.plan.apply.reconcile', { planHash: 'a'.repeat(64) });
  assert.equal(idle.status, 200, JSON.stringify(idle.body));
  assert.equal(idle.body.result.state, 'NOT_PENDING', JSON.stringify(idle.body));

  const seeded = await request('/api/def-contract-test/pending-team-reconciliation', {
    body: { planHash: 'a'.repeat(64), sessionId: 'session-a', timelineId: 'formal-a', axisBindingId: 'axis-a', parentNodeId: 'parent-p', candidateNodeId: 'candidate-c', pendingCommandId: 'late-command-c' },
  });
  assert.equal(seeded.status, 200, JSON.stringify(seeded.body));
  assert.equal((await request('/api/main-workbench/snapshot', { body: snapshotFor(candidatePayload) })).status, 200);

  // The normal public apply remains closed by the ordinary canonical gate.
  const ordinary = await tool('def.team.loadout.plan.apply', { planHash: 'a'.repeat(64) });
  assert.equal(ordinary.status, 409, JSON.stringify(ordinary.body));
  assert.equal(ordinary.body.error.code, 'blocked-session-mismatch');

  // The private continuation passes policy with checkout=P/projection=C,
  // observes the already-terminal exact command, and sends guarded restore.
  const pending = tool('def.team.loadout.plan.apply.reconcile', { planHash: 'a'.repeat(64) });
  let restore = null;
  for (let index = 0; index < 80 && !restore; index += 1) {
    const commands = await request('/api/main-workbench/commands', { method: 'GET' });
    restore = commands.body.commands.find((entry) => entry.command?.op === 'restoreAtomicTeamParent') || null;
    if (!restore) await new Promise((resolve) => setTimeout(resolve, 25));
  }
  if (!restore) {
    const early = await pending;
    assert.fail(`reconciliation must enqueue guarded P restore after late C: ${JSON.stringify(early.body)}`);
  }
  await request('/api/main-workbench/snapshot', { body: snapshotFor(parentPayload) });
  await request('/api/main-workbench/commands/result', {
    body: { id: restore.id, status: 'done', result: { parentNodeId: 'parent-p', parentRevision: 101, sessionPayloadMatches: true } },
  });
  const reconciled = await pending;
  assert.equal(reconciled.status, 200, JSON.stringify(reconciled.body));
  assert.equal(reconciled.body.result.state, 'ROLLED_BACK', JSON.stringify(reconciled.body));
  assert.equal(reconciled.body.result.reconciliation.rollback.restored, true);
  assert.equal(repository.getCheckoutRef('formal-a').targetId, 'parent-p');
  console.log('DEF pending team reconciliation REST contract: PASS (public gate blocks P/C; exact pending continuation restores P)');
} finally {
  child.kill('SIGTERM');
  await new Promise((resolve) => child.once('exit', resolve));
  repository.close();
  fs.rmSync(root, { recursive: true, force: true });
}
