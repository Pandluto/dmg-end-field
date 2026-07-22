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
const canvasSource = fs.readFileSync(path.join(process.cwd(), 'src/components/CanvasBoard/index.tsx'), 'utf8');
const workbenchControlSource = fs.readFileSync(path.join(process.cwd(), 'src/utils/mainWorkbenchControl.ts'), 'utf8');
assert.match(workbenchControlSource, /const memoryJsonStorage = new Map<string, unknown>\(\)/,
  'renderer command coordination needs an in-memory fallback when localStorage is full');
assert.match(workbenchControlSource, /memoryJsonStorage\.has\(key\)[\s\S]*canUseLocalStorage\(\)/,
  'the in-memory command copy must take precedence over the localStorage recovery mirror');
assert.match(workbenchControlSource, /memoryJsonStorage\.set\(key, value\)[\s\S]*localStorage\.setItem/,
  'transient command writes must survive localStorage quota failures');
assert.match(workbenchControlSource, /MAIN_WORKBENCH_REMOTE_SNAPSHOT_HEARTBEAT_MS[\s\S]*await pushMainWorkbenchSnapshot\(snapshot\)/,
  'a live renderer must republish its canonical snapshot after a sidecar reconnect');
assert.match(canvasSource, /document\.visibilityState !== 'visible'/,
  'hidden Workbench tabs must not overwrite the foreground projection');
assert.match(canvasSource, /projectionVisibilityRevision/,
  'returning a Workbench tab to the foreground must republish its projection');
assert.match(canvasSource, /isCheckoutMutationPendingRef\.current/,
  'transient hydrate state must not publish as a canonical projection');
assert.match(canvasSource, /flushSync\(commitReactRuntime\)/,
  'renderer checkout must commit React button state before polling the visible DOM');
assert.match(canvasSource, /loadLocalOperatorCharacters\(\)/,
  'renderer checkout must resolve operators from the local operator library used by the selection UI');
assert.match(canvasSource, /visibleSelectedCharacterIdsRef/,
  'renderer checkout must verify the visible operator roster, including empty-button timelines');
const checkoutHandlerSource = canvasSource.slice(
  canvasSource.indexOf('const checkoutAiTimelineWorkNodeFromCommand'),
  canvasSource.indexOf('const ensureTimelineDocumentBaselineWorkNode'),
);
assert.match(checkoutHandlerSource, /workbench-renderer-not-visible/,
  'a hidden renderer must fail closed before checkout');
assert(checkoutHandlerSource.indexOf('visiblePostcondition = await waitForVisibleCanvasButtons(expectedVisibleIds, expectedVisibleCharacterIds)')
  < checkoutHandlerSource.indexOf('client.markCheckoutApplied'),
  'foreground button and operator visibility must be proven before SQLite is marked checkout-applied');
const skillButtonSource = fs.readFileSync(path.join(process.cwd(), 'src/components/CanvasBoard/SkillButton.tsx'), 'utf8');
assert.match(skillButtonSource, /data-skill-button-id=\{button\.id\}/,
  'each rendered Canvas button needs a stable DOM identity for visible postconditions');
const restServerSource = fs.readFileSync(path.join(process.cwd(), 'scripts/ai-cli-rest-server.mjs'), 'utf8');
const workNodeApplyStart = restServerSource.indexOf('async function executeDefWorkNodeApplyAndVerify');
const workNodeApplyEnd = restServerSource.indexOf('async function executeDefDamageCalculateAndVerify', workNodeApplyStart);
const workNodeApplySource = restServerSource.slice(workNodeApplyStart, workNodeApplyEnd);
assert.match(workNodeApplySource, /const applied = commandVerification\.pass[\s\S]*snapshotVerification\.pass[\s\S]*staffIndexVerification\.pass/,
  'work-node success language must derive from the complete visible postcondition');
assert.match(workNodeApplySource, /message: applied[\s\S]*canonical visible projection matches the reviewed payload/,
  'a fully applied node must not emit a contradictory projection-mismatch warning');
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
    DEF_INTERNAL_GOVERNANCE_TOKEN: 'projection-bridge-native-host',
  },
  stdio: 'ignore',
});

const baseUrl = `http://127.0.0.1:${port}`;
const internalToken = 'projection-bridge-native-host';

async function request(pathname, { method = 'GET', body, internal = false } = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(internal ? { 'x-def-internal-token': internalToken } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: await response.json() };
}

async function waitForReady() {
  for (let index = 0; index < 300; index += 1) {
    try { if ((await fetch(`${baseUrl}/health`)).ok) return; } catch { /* starting */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Projection bridge server did not start.');
}

try {
  await waitForReady();
  const initial = await request('/api/main-workbench/snapshot', { internal: true });
  assert.equal(initial.status, 200);
  assert.equal(initial.body.snapshot, null, 'a restarted sidecar must fail closed instead of exposing stale now-storage projection data');
  for (let index = 0; index < 25; index += 1) {
    const snapshot = {
      activeTimelineId: 'formal-a', timelineId: 'formal-a',
      selectedCharacters: [{ id: 'operator-a', name: 'Operator A' }], skillButtons: [],
      marker: index, updatedAt: Date.now(),
    };
    const posted = await request('/api/main-workbench/snapshot', { method: 'POST', body: snapshot, internal: true });
    assert.equal(posted.status, 200, JSON.stringify(posted.body));
  }
  const current = await request('/api/main-workbench/snapshot', { internal: true });
  assert.equal(current.status, 200);
  assert.equal(current.body.snapshot.timelineId, 'formal-a');
  assert.equal(current.body.snapshot.marker, 24);
  assert.equal(digest(), beforeDigest, 'ephemeral projection writes must not rewrite formal now-storage');

  const direct = await request('/api/main-workbench/commands/enqueue', { method: 'POST', body: { command: { op: 'refreshSnapshot' } } });
  assert.equal(direct.status, 403);
  const unknownResult = await request('/api/main-workbench/commands/result', { method: 'POST', body: { id: 'forged-command', status: 'done', result: { ok: true } } });
  assert.equal(unknownResult.status, 403);
  const queue = await request('/api/main-workbench/commands', { internal: true });
  assert.deepEqual(queue.body.commands, []);

  console.log('DEF Workbench projection bridge contract: PASS (ephemeral snapshot, immutable now-storage, closed queue injection)');
} finally {
  child.kill('SIGTERM');
  await new Promise((resolve) => child.once('exit', resolve));
  fs.rmSync(root, { recursive: true, force: true });
}
