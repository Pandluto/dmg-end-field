import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const projectRoot = process.cwd();
const fixtureRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'def-workbench-cleanup-')));
const workspaceRoot = path.join(fixtureRoot, 'dmg-end-field', 'def-agent-workspace');
const workbenchRoot = path.join(workspaceRoot, 'sessions', 'workbench');
const aiCliRoot = path.join(workspaceRoot, 'sessions', 'ai-cli');
const questionStorePath = path.join(fixtureRoot, 'questions.sqlite3');
const eventLog = [];
const openCodeSessions = new Map();
const axisBindings = new Map();
const unbindFailures = new Map();
let runtimeEnsureCount = 0;

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve(server.address().port);
    });
  });
}

async function reservePort() {
  const server = net.createServer();
  const port = await listen(server);
  await new Promise((resolve) => server.close(resolve));
  return port;
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      try { resolve(text ? JSON.parse(text) : {}); } catch (error) { reject(error); }
    });
    request.on('error', reject);
  });
}

function sendJson(response, status, body) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}

function sessionForDirectory(directory) {
  return [...openCodeSessions.values()].find((session) => session.directory === directory) || null;
}

const fakeOpenCode = http.createServer(async (request, response) => {
  const requestUrl = new URL(request.url || '/', 'http://127.0.0.1');
  if (request.method === 'POST' && requestUrl.pathname === '/__runtime-ensure') {
    runtimeEnsureCount += 1;
    sendJson(response, 200, { ok: true });
    return;
  }
  if (request.method === 'GET' && requestUrl.pathname === '/question') {
    const directory = requestUrl.searchParams.get('directory') || '';
    const session = sessionForDirectory(directory);
    eventLog.push(`questions:${session?.sessionID || 'unknown'}`);
    if (session?.slowQuestionLookup) {
      await new Promise((resolve) => setTimeout(resolve, 350));
    }
    sendJson(response, 200, session?.pendingQuestionId
      ? [{ id: session.pendingQuestionId, sessionID: session.sessionID, questions: [] }]
      : []);
    return;
  }
  const questionReject = /^\/question\/([^/]+)\/reject$/.exec(requestUrl.pathname);
  if (request.method === 'POST' && questionReject) {
    eventLog.push(`reject:${decodeURIComponent(questionReject[1])}`);
    sendJson(response, 200, { ok: true });
    return;
  }
  const sessionDelete = /^\/session\/([^/]+)$/.exec(requestUrl.pathname);
  if (request.method === 'DELETE' && sessionDelete) {
    const sessionID = decodeURIComponent(sessionDelete[1]);
    const session = openCodeSessions.get(sessionID);
    eventLog.push(`delete:${sessionID}`);
    if (!session) {
      sendJson(response, 404, { error: 'not-found' });
      return;
    }
    session.deleteAttempts += 1;
    if (session.networkFailureOnce && session.deleteAttempts === 1) {
      request.socket.destroy();
      return;
    }
    if (!session.exists) {
      sendJson(response, 404, { error: 'not-found' });
      return;
    }
    session.exists = false;
    sendJson(response, 200, { ok: true });
    return;
  }
  sendJson(response, 404, { error: 'not-found' });
});

const fakeDefRest = http.createServer(async (request, response) => {
  const requestUrl = new URL(request.url || '/', 'http://127.0.0.1');
  if (request.method === 'GET' && requestUrl.pathname === '/health') {
    sendJson(response, 200, { ok: true });
    return;
  }
  if (request.method === 'POST' && requestUrl.pathname === '/api/def-tools/call') {
    const body = await readBody(request);
    if (body.tool !== 'def.workbench.unbind_session_axis') {
      sendJson(response, 400, { ok: false, error: { code: 'unexpected-tool' } });
      return;
    }
    const bindingId = body.input?.sessionBindingId || '';
    const sessionID = body.input?.sessionID || '';
    eventLog.push(`unbind:${sessionID}`);
    const remainingFailures = unbindFailures.get(bindingId) || 0;
    if (remainingFailures > 0) {
      unbindFailures.set(bindingId, remainingFailures - 1);
      sendJson(response, 503, { ok: false, error: { code: 'synthetic-unbind-failure', message: 'synthetic unbind failure' } });
      return;
    }
    const current = axisBindings.get(bindingId);
    if (!current) {
      sendJson(response, 200, { ok: true, result: { ok: true, deleted: false, alreadyDeleted: true } });
      return;
    }
    if (current !== sessionID) {
      sendJson(response, 409, { ok: false, error: { code: 'blocked-session-mismatch' } });
      return;
    }
    axisBindings.delete(bindingId);
    sendJson(response, 200, { ok: true, result: { ok: true, deleted: true } });
    return;
  }
  sendJson(response, 404, { ok: false, error: { code: 'not-found' } });
});

function createBinding({
  sessionID,
  host = 'workbench',
  root = host === 'workbench' ? workbenchRoot : aiCliRoot,
  directoryName = sessionID,
  axisBindingId = host === 'workbench' ? `axis-${sessionID}` : null,
  timelineId = host === 'workbench' ? `timeline-${sessionID}` : null,
  exists = true,
  networkFailureOnce = false,
  pendingQuestionId = '',
  slowQuestionLookup = false,
} = {}) {
  const directory = path.join(root, directoryName);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, '.def-session.json'), `${JSON.stringify({
    schemaVersion: 4,
    sessionID,
    directory,
    agent: host === 'workbench' ? 'def-workbench' : 'def-operator',
    skillId: host === 'workbench' ? 'workbench' : 'operator',
    host,
    ...(axisBindingId ? { axisBindingId } : {}),
    ...(timelineId ? { timelineId } : {}),
    createdAt: Date.now(),
  }, null, 2)}\n`, 'utf8');
  if (axisBindingId) axisBindings.set(axisBindingId, sessionID);
  openCodeSessions.set(sessionID, {
    sessionID,
    directory,
    exists,
    networkFailureOnce,
    pendingQuestionId,
    slowQuestionLookup,
    deleteAttempts: 0,
  });
  return { sessionID, directory, axisBindingId };
}

let sidecar = null;
let fakeOpenCodePort = 0;
let fakeDefRestPort = 0;

async function waitForReady(baseUrl) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      if ((await fetch(`${baseUrl}/health`)).ok) return;
    } catch {
      // Starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Timed out waiting for cleanup contract sidecar.');
}

async function request(baseUrl, pathname, { method = 'POST', body } = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { response, payload: await response.json() };
}

try {
  fakeOpenCodePort = await listen(fakeOpenCode);
  fakeDefRestPort = await listen(fakeDefRest);
  const sidecarPort = await reservePort();
  const sidecarUrl = `http://127.0.0.1:${sidecarPort}`;

  const slow = createBinding({ sessionID: 'ses-00-slow', slowQuestionLookup: true });
  const success = createBinding({ sessionID: 'ses-a-success', pendingQuestionId: 'question-a' });
  const retryDelete = createBinding({ sessionID: 'ses-b-retry-delete', networkFailureOnce: true });
  const localResidue = createBinding({ sessionID: 'ses-c-local-residue', exists: false });
  const retryUnbind = createBinding({ sessionID: 'ses-d-retry-unbind' });
  unbindFailures.set(retryUnbind.axisBindingId, 1);

  const aiCli = createBinding({ sessionID: 'ses-ai-cli-preserved', host: 'ai-cli' });
  const invalidHostDirectory = createBinding({
    sessionID: 'ses-invalid-host-under-workbench',
    host: 'ai-cli',
    root: workbenchRoot,
    directoryName: 'invalid-host-under-workbench',
  });
  const externalRoot = path.join(fixtureRoot, 'external-managed-lookalike');
  const external = createBinding({
    sessionID: 'ses-external-preserved',
    root: externalRoot,
    directoryName: 'session',
  });
  fs.mkdirSync(workbenchRoot, { recursive: true });
  fs.symlinkSync(external.directory, path.join(workbenchRoot, 'external-link'), 'dir');
  const ordinaryDirectory = path.join(fixtureRoot, 'ordinary-opencode-session');
  fs.mkdirSync(ordinaryDirectory, { recursive: true });
  fs.writeFileSync(path.join(ordinaryDirectory, 'sentinel.txt'), 'ordinary session', 'utf8');
  const businessSentinel = path.join(fixtureRoot, 'timeline-worknode-business-data.json');
  fs.writeFileSync(businessSentinel, '{"untouched":true}\n', 'utf8');

  sidecar = spawn(process.execPath, ['scripts/def-agent-sidecar-cleanup-fixture.cjs'], {
    cwd: projectRoot,
    env: {
      ...process.env,
      TMPDIR: fixtureRoot,
      DEF_AGENT_PORT: String(sidecarPort),
      DEF_REST_BASE_URL: `http://127.0.0.1:${fakeDefRestPort}`,
      DEF_CLEANUP_FAKE_OPENCODE_URL: `http://127.0.0.1:${fakeOpenCodePort}`,
      DEF_AGENT_QUESTION_STORE_PATH: questionStorePath,
    },
    stdio: 'ignore',
  });
  await waitForReady(sidecarUrl);

  const rejectedBody = await request(sidecarUrl, '/api/native/workbench-sessions/cleanup', { body: { host: 'workbench' } });
  assert.equal(rejectedBody.response.status, 400, JSON.stringify(rejectedBody.payload));
  assert.equal(rejectedBody.payload.code, 'INVALID_WORKBENCH_SESSION_CLEANUP_REQUEST');

  const firstPromise = request(sidecarUrl, '/api/native/workbench-sessions/cleanup');
  await new Promise((resolve) => setTimeout(resolve, 75));
  const concurrent = await request(sidecarUrl, '/api/native/workbench-sessions/cleanup');
  assert.equal(concurrent.response.status, 409, JSON.stringify(concurrent.payload));
  assert.equal(concurrent.payload.code, 'WORKBENCH_SESSION_CLEANUP_IN_PROGRESS');

  const first = await firstPromise;
  assert.equal(first.response.status, 200, JSON.stringify(first.payload));
  assert.equal(first.payload.ok, false);
  assert.equal(first.payload.targetCount, 5);
  assert.equal(first.payload.deletedCount, 3);
  assert.deepEqual(first.payload.failed, [
    { sessionID: retryDelete.sessionID, code: 'OPENCODE_SESSION_DELETE_FAILED' },
    { sessionID: retryUnbind.sessionID, code: 'SESSION_AXIS_UNBIND_FAILED' },
  ]);
  assert.equal(runtimeEnsureCount, 1, 'one bulk request must ensure OpenCode exactly once');

  assert.equal(fs.existsSync(slow.directory), false);
  assert.equal(fs.existsSync(success.directory), false);
  assert.equal(fs.existsSync(localResidue.directory), false, 'OpenCode 404 must still clear local residue');
  assert.equal(fs.existsSync(retryDelete.directory), true, 'OpenCode network failure must preserve the retryable binding and directory');
  assert.equal(fs.existsSync(retryUnbind.directory), true, 'axis unbind failure must preserve the directory');
  assert.equal(axisBindings.has(retryDelete.axisBindingId), true);
  assert.equal(axisBindings.has(retryUnbind.axisBindingId), true);
  assert(eventLog.indexOf('reject:question-a') < eventLog.indexOf(`delete:${success.sessionID}`), 'pending question must be rejected before OpenCode deletion');

  const second = await request(sidecarUrl, '/api/native/workbench-sessions/cleanup');
  assert.equal(second.response.status, 200, JSON.stringify(second.payload));
  assert.deepEqual(second.payload, { ok: true, targetCount: 2, deletedCount: 2, failed: [] });
  assert.equal(runtimeEnsureCount, 2);
  assert.equal(fs.existsSync(retryDelete.directory), false);
  assert.equal(fs.existsSync(retryUnbind.directory), false);

  const empty = await request(sidecarUrl, '/api/native/workbench-sessions/cleanup');
  assert.equal(empty.response.status, 200, JSON.stringify(empty.payload));
  assert.deepEqual(empty.payload, { ok: true, targetCount: 0, deletedCount: 0, failed: [] });
  assert.equal(runtimeEnsureCount, 2, 'empty cleanup must not start or ensure OpenCode');

  const exact = createBinding({ sessionID: 'ses-exact-delete' });
  const exactDelete = await request(sidecarUrl, `/api/native/session/${encodeURIComponent(exact.sessionID)}`, { method: 'DELETE' });
  assert.equal(exactDelete.response.status, 200, JSON.stringify(exactDelete.payload));
  assert.equal(exactDelete.payload.ok, true);
  assert.equal(fs.existsSync(exact.directory), false);
  assert.equal(axisBindings.has(exact.axisBindingId), false);
  assert.equal(runtimeEnsureCount, 3);

  assert.equal(fs.existsSync(aiCli.directory), true, 'bulk cleanup must not enter sessions/ai-cli');
  assert.equal(fs.existsSync(invalidHostDirectory.directory), true, 'host-mismatched binding under workbench root must be ignored');
  assert.equal(fs.existsSync(external.directory), true, 'symlink escape must be ignored');
  assert.equal(fs.readFileSync(path.join(ordinaryDirectory, 'sentinel.txt'), 'utf8'), 'ordinary session');
  assert.equal(fs.readFileSync(businessSentinel, 'utf8'), '{"untouched":true}\n');
  assert.equal(openCodeSessions.get(aiCli.sessionID).deleteAttempts, 0);
  assert.equal(openCodeSessions.get(external.sessionID).deleteAttempts, 0);

  const electronSource = fs.readFileSync(path.join(projectRoot, 'electron/main.cjs'), 'utf8');
  const devSource = fs.readFileSync(path.join(projectRoot, 'agent/dev-agent.cjs'), 'utf8');
  const shellHtml = fs.readFileSync(path.join(projectRoot, 'public/shell/index.html'), 'utf8');
  const shellSource = fs.readFileSync(path.join(projectRoot, 'public/shell/shell.js'), 'utf8');
  for (const bridgeSource of [electronSource, devSource]) {
    assert.match(bridgeSource, /\/def-agent\/workbench-sessions\/cleanup/);
    assert.match(bridgeSource, /\/api\/native\/workbench-sessions\/cleanup/);
  }
  assert.equal((shellHtml.match(/清除全部 AI 模式会话/g) || []).length, 1);
  assert.match(shellSource, /window\.confirm/);
  assert.match(shellSource, /Timeline、Work Node 和业务数据不受影响/);
  assert.match(shellSource, /method:\s*'POST'/);

  console.log(JSON.stringify({
    ok: true,
    checks: [
      'empty-request-only',
      'no-auth-required',
      'single-flight-cleanup',
      'one-runtime-ensure-per-nonempty-bulk',
      'partial-failure-continues',
      'network-failure-retryable',
      'upstream-404-converges',
      'axis-unbind-failure-preserves-directory',
      'repeat-cleanup-converges',
      'single-delete-shares-exact-flow',
      'host-and-root-isolation',
      'business-data-preserved',
      'electron-and-dev-bridge-parity',
      'shell-confirmation-and-result-ui',
    ],
  }));
} finally {
  if (sidecar?.exitCode === null) {
    sidecar.kill('SIGTERM');
    await new Promise((resolve) => sidecar.once('exit', resolve));
  }
  await Promise.all([
    new Promise((resolve) => fakeOpenCode.close(resolve)),
    new Promise((resolve) => fakeDefRest.close(resolve)),
  ]);
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
}
