import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'def-workbench-raw-policy-'));
const port = 19300 + Math.floor(Math.random() * 300);
const token = 'raw-route-policy-native-transport';
const baseUrl = `http://127.0.0.1:${port}`;
const payload = {
  selectedCharacters: [], timelineData: { staffLines: [] }, skillButtonTable: {}, allBuffList: [],
  characterInputMap: {}, operatorConfigPageCache: {},
};

const child = spawn(process.execPath, ['scripts/ai-cli-rest-server.mjs'], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    AI_CLI_REST_PORT: String(port),
    AI_CLI_REST_STORAGE_MODE: 'runtime',
    AI_CLI_REST_STORAGE_DIR: path.join(root, 'runtime'),
    AI_CLI_REST_VITE_CACHE_DIR: path.join(root, 'vite'),
    AI_TIMELINE_WORK_NODE_DB_PATH: path.join(root, 'nodes.sqlite'),
    AI_TIMELINE_WORK_NODE_LEGACY_PATH: path.join(root, 'nodes.json'),
    TIMELINE_REPOSITORY_DB_PATH: path.join(root, 'timeline.sqlite'),
    DATA_MANAGEMENT_RUNTIME_ROOT: path.join(root, 'data'),
    DEF_INTERNAL_GOVERNANCE_TOKEN: token,
  },
  stdio: 'ignore',
});

async function waitForReady() {
  for (let index = 0; index < 80; index += 1) {
    try { if ((await fetch(`${baseUrl}/health`)).ok) return; } catch { /* starting */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Raw route policy server did not start.');
}

async function request(pathname, { method = 'GET', body, internal = false } = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(internal ? { 'x-def-internal-token': token } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: await response.json() };
}

try {
  await waitForReady();
  for (const [pathname, body] of [
    ['/api/timeline-documents', { id: 'forged-document', label: 'forged' }],
    ['/api/ai-timeline-worknodes/create', { timelineId: 'formal-a', basePayload: payload, workingPayload: payload }],
    ['/api/main-workbench/snapshot', { activeTimelineId: 'formal-a', timelineId: 'formal-a', updatedAt: Date.now() }],
    ['/api/timeline-checkout-ref', { timelineId: 'formal-a', targetType: 'work-node', targetId: 'forged' }],
  ]) {
    const denied = await request(pathname, { method: 'POST', body });
    assert.equal(denied.status, 403, `${pathname}: ${JSON.stringify(denied.body)}`);
    assert.equal(denied.body.error?.code, 'denied-internal-transport');
  }
  assert.equal((await request('/api/ai-timeline-worknodes')).status, 403, 'raw reads cannot reveal another workspace tree');
  assert.equal((await request('/api/timeline-documents')).status, 403, 'raw documents cannot reveal workspaces');

  const created = await request('/api/timeline-documents', { method: 'POST', internal: true, body: { id: 'formal-a', label: 'Formal A' } });
  assert.equal(created.status, 200, JSON.stringify(created.body));
  const snapshot = await request('/api/main-workbench/snapshot', {
    method: 'POST', internal: true,
    body: { activeTimelineId: 'formal-a', timelineId: 'formal-a', selectedCharacters: [], skillButtons: [], operatorConfigs: [], updatedAt: Date.now() },
  });
  assert.equal(snapshot.status, 200, JSON.stringify(snapshot.body));
  assert.equal((await request('/api/main-workbench/snapshot', { internal: true })).body.snapshot.timelineId, 'formal-a');

  const createNode = await request('/api/ai-timeline-worknodes/create', {
    method: 'POST', internal: true,
    body: { timelineId: 'formal-a', basePayload: payload, workingPayload: payload, approvalPolicy: 'manual' },
  });
  assert.equal(createNode.status, 200, JSON.stringify(createNode.body));
  const nodeId = createNode.body.node.id;
  assert.equal((await request(`/api/ai-timeline-worknodes/${encodeURIComponent(nodeId)}/delete`, { method: 'POST' })).status, 403, 'unbound raw delete remains denied');

  console.log('DEF Workbench raw route policy contract: PASS (unbound raw routes denied; native transport remains functional)');
} finally {
  child.kill('SIGTERM');
  await new Promise((resolve) => child.once('exit', resolve));
  fs.rmSync(root, { recursive: true, force: true });
}
