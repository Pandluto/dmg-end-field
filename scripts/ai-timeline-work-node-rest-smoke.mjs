import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'def-work-node-rest-'));
const databasePath = path.join(tempDirectory, 'work-nodes.sqlite3');
const timelineRepositoryPath = path.join(tempDirectory, 'timeline-repository.sqlite3');
const legacyJsonPath = path.join(tempDirectory, 'legacy.json');
const port = 18000 + (process.pid % 1000);
const baseUrl = `http://127.0.0.1:${port}`;
const payload = {
  selectedCharacters: [],
  timelineData: { staffLines: [] },
  skillButtonTable: {},
  allBuffList: [],
};

fs.writeFileSync(legacyJsonPath, JSON.stringify({
  type: 'def.ai-timeline.worknodes.v1',
  schemaVersion: 1,
  nodes: [],
  commits: [],
}));

const server = spawn(process.execPath, ['scripts/ai-cli-rest-server.mjs'], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    AI_CLI_REST_PORT: String(port),
    AI_CLI_REST_STORAGE_MODE: 'runtime',
    AI_TIMELINE_WORK_NODE_DB_PATH: databasePath,
    AI_TIMELINE_WORK_NODE_LEGACY_PATH: legacyJsonPath,
    TIMELINE_REPOSITORY_DB_PATH: timelineRepositoryPath,
  },
  stdio: ['ignore', 'ignore', 'pipe'],
  windowsHide: true,
});

let stderr = '';
server.stderr.on('data', (chunk) => {
  stderr += chunk.toString();
});

async function request(method, pathname, body) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

async function waitForHealth() {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 20_000) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return;
    } catch {
      // Server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`REST server did not start. ${stderr}`);
}

async function createNode(id, parentNodeId) {
  const result = await request('POST', '/api/ai-timeline-worknodes/create', {
    id,
    saveId: 'save-rest',
    branchId: id,
    parentNodeId,
    label: id,
    basePayload: payload,
    workingPayload: payload,
  });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  return result.body.node;
}

try {
  await waitForHealth();
  const document = await request('POST', '/api/timeline-documents', { id: 'timeline-rest', label: 'REST 排轴' });
  assert.equal(document.status, 200, JSON.stringify(document.body));
  const snapshot = await request('POST', '/api/timeline-snapshots', {
    id: 'snapshot-rest', timelineId: 'timeline-rest', label: 'REST 快照', payload,
  });
  assert.equal(snapshot.status, 200, JSON.stringify(snapshot.body));
  const checkoutRef = await request('POST', '/api/timeline-checkout-ref', {
    timelineId: 'timeline-rest', targetType: 'snapshot', targetId: 'snapshot-rest',
  });
  assert.equal(checkoutRef.status, 200, JSON.stringify(checkoutRef.body));
  const snapshots = await request('GET', '/api/timeline-snapshots?timelineId=timeline-rest');
  assert.equal(snapshots.body.snapshots.length, 1);

  await createNode('root', null);
  await createNode('child', 'root');
  await createNode('branch', 'root');

  let list = await request('GET', '/api/ai-timeline-worknodes');
  assert.equal(list.status, 200);
  assert.equal(list.body.headNodeId, 'branch');
  assert.equal(list.body.nodes.find((node) => node.id === 'child')?.parentNodeId, 'root');
  assert.equal(list.body.nodes.some((node) => 'basePayload' in node || 'workingPayload' in node), false);

  const restored = await request('POST', '/api/ai-timeline-worknodes/branch/rollback-applied', {
    appliedBy: 'user',
    rationale: 'REST smoke restore',
  });
  assert.equal(restored.status, 200, JSON.stringify(restored.body));
  assert.equal(restored.body.node.parentNodeId, 'branch');
  assert.match(restored.body.node.label, /^\[restore\]/);

  const protectedDelete = await request('POST', '/api/ai-timeline-worknodes/root/delete', {});
  assert.notEqual(protectedDelete.status, 200);

  const grayDelete = await request('POST', '/api/ai-timeline-worknodes/child/delete', {});
  assert.equal(grayDelete.status, 200, JSON.stringify(grayDelete.body));
  assert.equal(grayDelete.body.nodes.some((node) => node.id === 'child'), false);

  list = await request('GET', '/api/ai-timeline-worknodes');
  assert.equal(list.body.nodes.length, 3);
  assert.equal(list.body.headNodeId, restored.body.node.id);
  console.log('AI timeline Work Node REST smoke passed.');
} finally {
  if (server.exitCode === null) {
    server.kill();
    await once(server, 'exit');
  }
  fs.rmSync(tempDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  if (stderr.trim() && !/ExperimentalWarning/.test(stderr)) console.error(stderr.trim());
}
