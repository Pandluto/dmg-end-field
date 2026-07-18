import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'def-projection-bridge-'));
const port = 19000 + Math.floor(Math.random() * 300);
const nowStoragePath = path.join(root, 'now-storage.json');
const archive = {
  type: 'def.localdata.archive.v1', schemaVersion: 1, id: 'now-storage', name: 'now-storage',
  createdAt: new Date(0).toISOString(), exportedAt: new Date(0).toISOString(), sections: ['all'],
  storage: {
    local: {
      'large-formal-workspace-fixture': 'x'.repeat(4 * 1024 * 1024),
      'def.main-workbench.snapshot.v1': { activeTimelineId: 'old', timelineId: 'old', selectedCharacters: [], skillButtons: [] },
    },
    session: {},
  },
};
fs.writeFileSync(nowStoragePath, `${JSON.stringify(archive)}\n`);

const digest = () => createHash('sha256').update(fs.readFileSync(nowStoragePath)).digest('hex');
const beforeDigest = digest();
const child = spawn(process.execPath, ['scripts/ai-cli-rest-server.mjs'], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    AI_CLI_REST_PORT: String(port),
    AI_CLI_REST_STORAGE_MODE: 'now-storage',
    AI_CLI_REST_STORAGE_DIR: path.join(root, 'runtime'),
    AI_CLI_REST_VITE_CACHE_DIR: path.join(root, 'vite'),
    AI_CLI_NOW_STORAGE_PATH: nowStoragePath,
    AI_TIMELINE_WORK_NODE_DB_PATH: path.join(root, 'nodes.sqlite'),
    TIMELINE_REPOSITORY_DB_PATH: path.join(root, 'timeline.sqlite'),
    DATA_MANAGEMENT_RUNTIME_ROOT: path.join(root, 'data'),
  },
  stdio: 'ignore',
});

const baseUrl = `http://127.0.0.1:${port}`;

async function request(pathname, { method = 'GET', body } = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  });
  return { status: response.status, body: await response.json() };
}

async function waitForReady() {
  for (let index = 0; index < 80; index += 1) {
    try { if ((await fetch(`${baseUrl}/health`)).ok) return; } catch { /* starting */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Projection bridge server did not start.');
}

try {
  await waitForReady();
  for (let index = 0; index < 25; index += 1) {
    const snapshot = {
      activeTimelineId: 'formal-a', timelineId: 'formal-a',
      selectedCharacters: [{ id: 'operator-a', name: 'Operator A' }], skillButtons: [],
      marker: index, updatedAt: Date.now(),
    };
    const posted = await request('/api/main-workbench/snapshot', { method: 'POST', body: snapshot });
    assert.equal(posted.status, 200, JSON.stringify(posted.body));
  }
  const current = await request('/api/main-workbench/snapshot');
  assert.equal(current.status, 200);
  assert.equal(current.body.snapshot.timelineId, 'formal-a');
  assert.equal(current.body.snapshot.marker, 24);
  assert.equal(digest(), beforeDigest, 'ephemeral projection writes must not rewrite formal now-storage');

  const direct = await request('/api/main-workbench/commands/enqueue', { method: 'POST', body: { command: { op: 'refreshSnapshot' } } });
  assert.equal(direct.status, 403);
  const unknownResult = await request('/api/main-workbench/commands/result', { method: 'POST', body: { id: 'forged-command', status: 'done', result: { ok: true } } });
  assert.equal(unknownResult.status, 404);
  const queue = await request('/api/main-workbench/commands');
  assert.deepEqual(queue.body.commands, []);

  console.log('DEF Workbench projection bridge contract: PASS (ephemeral snapshot, immutable now-storage, closed queue injection)');
} finally {
  child.kill('SIGTERM');
  await new Promise((resolve) => child.once('exit', resolve));
  fs.rmSync(root, { recursive: true, force: true });
}
