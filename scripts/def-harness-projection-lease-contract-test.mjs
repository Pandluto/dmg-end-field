import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { createHarnessProjectionLeaseStore } from './def-core/harness-projection-lease.mjs';

const require = createRequire(import.meta.url);
const { createTimelineRepository } = require('../electron/timeline-repository.cjs');
const { createDefCodexInteropProtocol } = require('../agent/runtime/def-codex-interop.cjs');

let clock = 1_000;
const store = createHarnessProjectionLeaseStore({ now: () => clock, randomBytes: () => Buffer.alloc(32, 7), activeLimit: 2 });
const commitments = {
  sourceTimelineId: 'source', sourceCheckoutTargetType: 'work-node', sourceCheckoutTargetId: 'source-node', sourceCheckoutUpdatedAt: 10,
  sourcePayloadHash: 'source-payload', sourceRevision: 10, sourceProjectionHash: 'source-projection',
  fixtureTimelineId: 'fixture', fixtureNodeId: 'fixture-node', fixtureCheckoutUpdatedAt: 11, fixturePayloadHash: 'fixture-payload', fixtureRevision: 11,
};
assert.equal(store.provision({ mode: 'typo', commitments }).ok, false, 'unknown projection modes must not downgrade to fixture mode');
const provision = store.provision({ mode: 'hidden-fixture', commitments });
assert.equal(provision.ok, true);
const identity = { sessionId: 'fixture-session', axisBindingId: 'fixture-axis', timelineId: 'fixture', boundNodeId: 'fixture-node', harnessCommitment: 'sealed-harness', agentReleaseCommitment: 'sealed-release' };
assert.equal(store.activate({ token: provision.token, session: { ...identity, boundNodeId: '' } }).code, 'harness-activation-node-mismatch', 'missing node identity must not match a fixture lease');
assert.equal(store.activate({ token: provision.token, session: identity }).ok, true);
assert.equal(store.activate({ token: provision.token, session: identity }).code, 'harness-provision-invalid-or-consumed', 'provision token is one-shot');
assert.equal(store.resolve({ ...identity, harnessCommitment: '', agentReleaseCommitment: '' }).ok, true);
assert.equal(store.resolve({ ...identity, boundNodeId: '' }).ok, false, 'runtime lease lookup must retain exact bound node identity');
assert.equal(store.revoke(identity.sessionId).status, 'revoked');
assert.equal(store.resolve(identity).ok, false, 'revoke must fail closed before cleanup continues');
const ttlStore = createHarnessProjectionLeaseStore({ now: () => clock, activeLimit: 1 });
const ttlProvision = ttlStore.provision({ mode: 'hidden-fixture', commitments });
const ttlIdentity = { ...identity, sessionId: 'ttl-session', axisBindingId: 'ttl-axis' };
assert.equal(ttlStore.activate({ token: ttlProvision.token, session: ttlIdentity }).ok, true);
const concurrentProvision = ttlStore.provision({ mode: 'hidden-fixture', commitments });
assert.equal(ttlStore.activate({ token: concurrentProvision.token, session: { ...ttlIdentity, sessionId: 'parallel-session', axisBindingId: 'parallel-axis' } }).code, 'harness-active-limit', 'concurrent active leases obey the server-side limit');
clock += 5 * 60_000 + 1;
assert.equal(ttlStore.resolve(ttlIdentity).ok, false, 'expired leases must fail closed without a renewal path');
const restartStore = createHarnessProjectionLeaseStore();
assert.equal(restartStore.resolve(identity).ok, false, 'a sidecar restart must forget active Harness leases');

// Exercise the wire boundary separately from REST: a scenario-policy error is
// not an environmental block, and must preserve its established Harness run
// outcome vocabulary at the runner boundary.
const interop = createDefCodexInteropProtocol({
  profile: 'development', baseUrl: 'http://127.0.0.1:31457', sidecarUrl: 'http://127.0.0.1:17322',
  snapshotUrl: 'http://127.0.0.1:17321/api/main-workbench/snapshot', snapshotHeaders: { 'x-def-internal-token': 'test' }, auditFile: '',
  fetchJson: async () => ({ status: 200, body: { ok: true } }),
  postJson: async (url) => url.includes('/harness-projection/provision')
    ? { status: 400, body: { ok: false, error: { code: 'ERROR_SCENARIO', message: 'non-read-only onlyTools' } } }
    : { status: 500, body: { ok: false } },
  writeJson(response, status, body) { response.status = status; response.body = body; }, writeSse() {}, writeSseHeaders() {},
});
async function interopCall(method, pathname, body = {}, token = '') {
  const request = new EventEmitter();
  request.method = method; request.url = pathname; request.socket = { remoteAddress: '127.0.0.1' };
  request.headers = { host: '127.0.0.1:31457', ...(token ? { authorization: `Bearer ${token}` } : {}) };
  const response = {};
  await interop.handle(request, response, new URL(`http://127.0.0.1:31457${pathname}`), async () => body);
  return response;
}
const authorized = await interopCall('POST', '/def-agent/interop/v1/authorize');
const ui = await interopCall('POST', '/def-agent/interop/v1/ui/consumer', { host: 'workbench', sessionId: 'visible-source' });
assert.equal(ui.status, 200);
const badScenario = await interopCall('POST', '/def-agent/interop/v1/harness/sessions', {
  harnessSelector: 'stable', fixtureMode: 'active-current-readonly', scenarioToolAllowlist: ['def_team_loadout_plan_apply'],
}, authorized.body.token);
assert.equal(badScenario.status, 400);
assert.equal(badScenario.body.error.code, 'ERROR_SCENARIO', 'Interop must preserve Scenario policy failures instead of reporting BLOCKED_ENVIRONMENT');
const runnerSource = fs.readFileSync(new URL('./def-harness-native-runner.mjs', import.meta.url), 'utf8');
assert(runnerSource.includes("caught.code === 'ERROR_SCENARIO' ? 'ERROR_VERIFIER'"),
  'runner must map Scenario configuration errors to the established ERROR_VERIFIER status while retaining error.code');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'def-harness-projection-'));
const port = 18700 + Math.floor(Math.random() * 300);
const token = 'projection-contract-native-token';
const databasePath = path.join(root, 'timeline.sqlite');
const repository = createTimelineRepository({ databasePath });
const payload = {
  selectedCharacters: [], timelineData: { staffLines: [] }, skillButtonTable: {}, allBuffList: [], characterInputMap: {}, operatorConfigPageCache: {},
};
repository.ensureDocument({ id: 'source', label: 'source' });
repository.importWorkNode({ id: 'source-node', timelineId: 'source', branchId: 'source-branch', label: 'source', status: 'ready', approvalPolicy: 'manual', basePayload: payload, workingPayload: payload, contentRevision: 100 });
repository.setCheckoutRef({ timelineId: 'source', targetType: 'work-node', targetId: 'source-node', updatedAt: 100 });
repository.upsertSessionAxisBinding({ id: 'source-axis', timelineId: 'source', host: 'workbench', opencodeSessionId: 'source-session', boundNodeId: 'source-node' });

const child = spawn(process.execPath, ['scripts/ai-cli-rest-server.mjs'], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    AI_CLI_REST_PORT: String(port), AI_CLI_REST_STORAGE_MODE: 'runtime', AI_CLI_REST_STORAGE_DIR: path.join(root, 'rest'),
    AI_TIMELINE_WORK_NODE_DB_PATH: path.join(root, 'nodes.sqlite'), AI_TIMELINE_WORK_NODE_LEGACY_PATH: path.join(root, 'nodes.json'),
    TIMELINE_REPOSITORY_DB_PATH: databasePath, DATA_MANAGEMENT_RUNTIME_ROOT: path.join(root, 'data'), DEF_TOOL_GOVERNANCE_PATH: path.join(root, 'governance.json'),
    DEF_INTERNAL_GOVERNANCE_TOKEN: token, DEF_HARNESS_PROJECTION_ENABLED: '1',
  },
  stdio: 'ignore',
});

async function waitReady() {
  for (let index = 0; index < 300; index += 1) {
    try { if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('projection contract REST server did not start');
}
async function post(pathname, body, internal = true) {
  const response = await fetch(`http://127.0.0.1:${port}${pathname}`, {
    method: 'POST', headers: { 'content-type': 'application/json', ...(internal ? { 'x-def-internal-token': token } : {}) }, body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}
async function get(pathname, internal = true) {
  const response = await fetch(`http://127.0.0.1:${port}${pathname}`, { headers: internal ? { 'x-def-internal-token': token } : {} });
  return { status: response.status, body: await response.json() };
}

try {
  await waitReady();
  const mirror = await post('/api/main-workbench/snapshot', {
    source: 'app', activeTimelineId: 'source', timelineId: 'source', checkout: repository.getCheckoutRef('source'),
    selectedCharacters: [], skillButtons: [], operatorConfigs: [], damageReport: { generatedAt: 1, totalExpected: 0, totalNonCrit: 0, buttonCount: 0, buttons: [] }, updatedAt: 100,
  });
  assert.equal(mirror.status, 200);
  const rawDenied = await post('/api/main-workbench/harness-projection/provision', { mode: 'hidden-fixture', sourceSessionId: 'source-session' }, false);
  assert.equal(rawDenied.status, 403, 'raw loopback callers cannot provision');
  const unknown = await post('/api/main-workbench/harness-projection/provision', { mode: 'unknown', sourceSessionId: 'source-session' });
  assert.equal(unknown.status, 400);
  const fixtureProvision = await post('/api/main-workbench/harness-projection/provision', { mode: 'hidden-fixture', sourceSessionId: 'source-session' });
  assert.equal(fixtureProvision.status, 201, JSON.stringify(fixtureProvision.body));
  const fixture = fixtureProvision.body.fixture;
  assert(fixture?.timelineId && fixture?.boundNodeId);
  repository.upsertSessionAxisBinding({ id: 'fixture-axis', timelineId: fixture.timelineId, host: 'workbench', opencodeSessionId: 'fixture-session', boundNodeId: fixture.boundNodeId });
  const spoof = await post('/api/main-workbench/harness-projection/activate', { provisionToken: fixtureProvision.body.provisionToken, mode: 'hidden-fixture', sessionId: 'fixture-session', harnessCommitment: 'forged', agentReleaseCommitment: 'forged' });
  assert.equal(spoof.status, 409, 'activation must require independently registered sealed identity');
  const registered = await post('/api/main-workbench/harness-projection/register-native', { sessionId: 'fixture-session', harnessCommitment: 'sealed-harness', agentReleaseCommitment: 'sealed-release' });
  assert.equal(registered.status, 201);
  const activated = await post('/api/main-workbench/harness-projection/activate', { provisionToken: fixtureProvision.body.provisionToken, mode: 'hidden-fixture', sessionId: 'fixture-session' });
  assert.equal(activated.status, 200, JSON.stringify(activated.body));
  assert.equal(Object.hasOwn(activated.body, 'provisionToken'), false, 'activation must not expose a bearer provision token');
  const visibleBefore = JSON.stringify((await get('/api/main-workbench/snapshot')).body.snapshot);
  const snapshotRead = await post('/api/def-tools/call', { tool: 'def.workbench.snapshot', sessionId: 'fixture-session', input: { sessionBindingId: 'fixture-axis' } });
  assert.equal(snapshotRead.status, 200, JSON.stringify(snapshotRead.body));
  assert.equal(snapshotRead.body.result.snapshot.source, 'harness-fixture');
  const previewDenied = await post('/api/def-tools/call', { tool: 'def.operator.config.preview', sessionId: 'fixture-session', input: {} });
  assert.equal(previewDenied.status, 403, 'hidden fixture must deny Canvas preview/queue reads');
  const mutationDenied = await post('/api/def-tools/call', { tool: 'def.team.selection.apply', sessionId: 'fixture-session', input: {} });
  assert.equal(mutationDenied.status, 403, 'hidden fixture must deny mutations');
  const visibleAfter = JSON.stringify((await get('/api/main-workbench/snapshot')).body.snapshot);
  assert.equal(visibleAfter, visibleBefore, 'hidden fixture reads must not overwrite the visible Canvas mirror');
  const replay = await post('/api/main-workbench/harness-projection/activate', { provisionToken: fixtureProvision.body.provisionToken, mode: 'hidden-fixture', sessionId: 'fixture-session' });
  assert.equal(replay.status, 409, 'activated provision cannot replay');
  const revoked = await post('/api/main-workbench/harness-projection/revoke', { sessionId: 'fixture-session' });
  assert.equal(revoked.status, 200);
  const afterRevoke = await post('/api/def-tools/call', { tool: 'def.workbench.snapshot', sessionId: 'fixture-session', input: { sessionBindingId: 'fixture-axis' } });
  assert.equal(afterRevoke.status, 409, 'revoked fixture lease must fail closed');

  const nonRead = await post('/api/main-workbench/harness-projection/provision', {
    mode: 'active-current-readonly', sourceSessionId: 'source-session', allowedTools: ['def_team_loadout_plan_apply'],
  });
  assert.equal(nonRead.status, 400, 'active scenario policy rejects native bindings that are not read-only');
  const activeProvision = await post('/api/main-workbench/harness-projection/provision', {
    mode: 'active-current-readonly', sourceSessionId: 'source-session', allowedTools: ['def_operator_config_preview'],
  });
  assert.equal(activeProvision.status, 201, JSON.stringify(activeProvision.body));
  repository.upsertSessionAxisBinding({ id: 'active-axis', timelineId: 'source', host: 'workbench', opencodeSessionId: 'active-session', boundNodeId: 'source-node' });
  await post('/api/main-workbench/harness-projection/register-native', { sessionId: 'active-session', harnessCommitment: 'active-harness', agentReleaseCommitment: 'active-release' });
  const active = await post('/api/main-workbench/harness-projection/activate', { provisionToken: activeProvision.body.provisionToken, mode: 'active-current-readonly', sessionId: 'active-session' });
  assert.equal(active.status, 200, JSON.stringify(active.body));
  const activePreview = await post('/api/def-tools/call', { tool: 'def.operator.config.preview', sessionId: 'active-session', input: {} });
  assert.notEqual(activePreview.status, 403, 'real visible Canvas policy allows its explicit read-only preview tool');
  const activeWrite = await post('/api/def-tools/call', { tool: 'def.team.selection.apply', sessionId: 'active-session', input: {} });
  assert.equal(activeWrite.status, 403, 'active current policy rejects all writes even when normal current gate passes');
} finally {
  child.kill('SIGTERM');
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    new Promise((resolve) => setTimeout(resolve, 1000)),
  ]);
  // DatabaseSync can retain a Windows handle briefly after the child exits.
  // This is test-only hygiene; never turn an otherwise successful contract
  // into a failure because the OS delayed releasing a temporary SQLite file.
  try { fs.rmSync(root, { recursive: true, force: true, maxRetries: 2, retryDelay: 50 }); } catch {}
}

process.stdout.write('[def-harness-projection-lease-contract-test] passed\n');
