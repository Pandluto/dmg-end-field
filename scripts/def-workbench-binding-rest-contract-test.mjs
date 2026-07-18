import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createTimelineRepository } = require('../electron/timeline-repository.cjs');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'def-workbench-rest-'));
const port = 18100 + Math.floor(Math.random() * 500);
const databasePath = path.join(root, 'timeline.sqlite');
const internalToken = 'binding-rest-contract-native-host';
const repository = createTimelineRepository({ databasePath });
repository.ensureDocument({ id: 'formal-a', label: 'Formal A' });
repository.ensureDocument({ id: 'formal-b', label: 'Formal B' });
repository.ensureDocument({ id: 'temporary-a', label: 'Temporary A', isTemporary: true });

const child = spawn(process.execPath, ['scripts/ai-cli-rest-server.mjs'], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    AI_CLI_REST_PORT: String(port),
    AI_CLI_REST_STORAGE_DIR: path.join(root, 'rest'),
    AI_CLI_REST_VITE_CACHE_DIR: path.join(root, 'vite'),
    AI_CLI_NOW_STORAGE_PATH: path.join(root, 'now-storage.json'),
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
  for (let index = 0; index < 50; index += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok) return;
    } catch {
      // Service has not started yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Timed out waiting for DEF REST contract server.');
}

async function call(tool, input) {
  const { sessionId, ...toolInput } = input || {};
  const response = await fetch(`http://127.0.0.1:${port}/api/def-tools/call`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-def-internal-token': internalToken }, body: JSON.stringify({ tool, input: toolInput, ...(sessionId ? { sessionId } : {}) }),
  });
  return { status: response.status, body: await response.json() };
}

try {
  await waitForReady();
  const missing = await call('def.workbench.assert_timeline_admission', {});
  assert.equal(missing.status, 400);
  assert.equal(missing.body.error.code, 'blocked-binding');
  const temporary = await call('def.workbench.assert_timeline_admission', { timelineId: 'temporary-a' });
  assert.equal(temporary.status, 409);
  assert.equal(temporary.body.error.code, 'blocked-temporary-workspace');

  const created = await call('def.workbench.bind_session_axis', {
    sessionBindingId: 'axis-a', sessionID: 'session-a', host: 'workbench', timelineId: 'formal-a',
  });
  assert.equal(created.status, 200);
  assert.equal(created.body.result.binding.timelineId, 'formal-a');
  const mismatched = await call('def.workbench.bind_session_axis', {
    sessionBindingId: 'axis-a', sessionID: 'session-a', host: 'workbench', timelineId: 'formal-b',
  });
  assert.equal(mismatched.status, 409);
  assert.equal(mismatched.body.error.code, 'blocked-session-mismatch');
  const crossTimelineTool = await call('def.worknode.list', { sessionId: 'session-a', timelineId: 'formal-b' });
  assert.equal(crossTimelineTool.status, 409);
  assert.equal(crossTimelineTool.body.error.code, 'blocked-session-mismatch');

  repository.deleteDocument('formal-a');
  const stale = await call('def.workbench.assert_session_axis', {
    sessionBindingId: 'axis-a', sessionID: 'session-a', host: 'workbench', timelineId: 'formal-a',
  });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.error.code, 'blocked-session-mismatch');
  console.log('DEF Workbench REST binding contract: PASS');
} finally {
  child.kill('SIGTERM');
  await new Promise((resolve) => child.once('exit', resolve));
  fs.rmSync(root, { recursive: true, force: true });
}
