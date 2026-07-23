import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const adapter = require('../agent/runtime/def-opencode-adapter/index.cjs');
const serverModulePath = require.resolve('../agent/server/def-agent-server.cjs');
const authority = Object.freeze({
  provisionToken: 'hidden-fixture-one-shot-provision-token',
  mode: 'hidden-fixture',
});
const internalToken = 'internal-governance-contract-token';
const protectedTools = new Set([
  'def.workbench.assert_timeline_admission',
  'def.workbench.bind_session_axis',
  'def.workbench.assert_session_axis',
]);
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'def-native-projection-authority-'));
const restCalls = [];
const sessions = new Map();

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.once('error', reject);
    request.once('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch (error) {
        reject(error);
      }
    });
  });
}

function writeJson(response, status, body) {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}

const restServer = http.createServer(async (request, response) => {
  const requestUrl = new URL(request.url || '/', 'http://127.0.0.1');
  if (requestUrl.pathname === '/health') {
    writeJson(response, 200, { ok: true });
    return;
  }
  if (request.method === 'POST' && requestUrl.pathname === '/api/def-tools/call') {
    const body = await readBody(request);
    restCalls.push(body);
    if (body.tool === 'def.workbench.assert_timeline_admission') {
      writeJson(response, 200, { ok: true, result: { ok: true, document: { id: body.input.timelineId } } });
      return;
    }
    if (body.tool === 'def.workbench.bind_session_axis') {
      writeJson(response, 200, {
        ok: true,
        result: {
          ok: true,
          binding: { boundNodeId: body.input.boundNodeId || '' },
          context: { checkout: { targetType: 'timeline', targetId: body.input.timelineId } },
        },
      });
      return;
    }
    if (body.tool === 'def.workbench.assert_session_axis' || body.tool === 'def.native_catalog.register_session') {
      writeJson(response, 200, { ok: true, result: { ok: true } });
      return;
    }
    writeJson(response, 500, { ok: false, error: { message: `unexpected tool ${body.tool}` } });
    return;
  }
  if (request.method === 'POST' && requestUrl.pathname === '/api/main-workbench/harness-projection/register-native') {
    writeJson(response, 200, { ok: true });
    return;
  }
  if (request.method === 'POST' && requestUrl.pathname === '/api/main-workbench/harness-projection/activate') {
    const body = await readBody(request);
    writeJson(response, 200, { ok: true, contract: 'hidden-fixture-contract', mode: body.mode, expiresAt: 12345 });
    return;
  }
  writeJson(response, 404, { ok: false, error: 'unexpected-rest-route' });
});

await new Promise((resolve, reject) => {
  restServer.once('error', reject);
  restServer.listen(0, '127.0.0.1', resolve);
});
const restAddress = restServer.address();
assert(restAddress && typeof restAddress === 'object');
const restBaseUrl = `http://127.0.0.1:${restAddress.port}`;

const originalAdapter = {
  createNativeHostSession: adapter.createNativeHostSession,
  recoverNativeHostSession: adapter.recoverNativeHostSession,
  ensureNativeSessionAxisBinding: adapter.ensureNativeSessionAxisBinding,
  readNativeSessionBinding: adapter.readNativeSessionBinding,
  writeNativeWorkbenchContext: adapter.writeNativeWorkbenchContext,
};
const originalEnv = Object.fromEntries([
  'DEF_REST_BASE_URL',
  'DEF_INTERNAL_GOVERNANCE_TOKEN',
  'DEF_HARNESS_PROJECTION_ENABLED',
].map((key) => [key, process.env[key]]));

function makeSession({ sessionID, host = 'workbench', timelineId }) {
  const directory = path.join(root, sessionID);
  fs.mkdirSync(directory, { recursive: true });
  const session = { sessionID, host, timelineId, directory };
  sessions.set(sessionID, session);
  fs.writeFileSync(path.join(directory, '.def-session.json'), JSON.stringify(session), 'utf8');
  return session;
}

let sequence = 0;
let nextCreateFailure = null;
adapter.createNativeHostSession = async ({ host, timelineId }) => {
  if (nextCreateFailure) throw nextCreateFailure;
  return makeSession({
    sessionID: `created-${++sequence}`,
    host,
    timelineId,
  });
};
adapter.recoverNativeHostSession = async ({ sessionID }) => sessions.get(sessionID);
adapter.ensureNativeSessionAxisBinding = (directory, sessionID) => {
  const session = sessions.get(sessionID);
  assert.equal(directory, session?.directory, 'axis binding must use the created session directory');
  return {
    ...session,
    axisBindingId: `axis-${sessionID}`,
  };
};
adapter.readNativeSessionBinding = (_directory, sessionID) => {
  const session = sessions.get(sessionID);
  return session ? {
    ...session,
    axisBindingId: `axis-${sessionID}`,
    harnessBinding: { harnessId: 'hidden-fixture', version: '1.0.0' },
    agentRelease: { releaseHash: 'release-hash' },
  } : null;
};
adapter.writeNativeWorkbenchContext = (directory, sessionID, context) => {
  fs.writeFileSync(path.join(directory, '.def-workbench-context.json'), JSON.stringify({ sessionID, context }), 'utf8');
  return context;
};
process.env.DEF_REST_BASE_URL = restBaseUrl;
process.env.DEF_INTERNAL_GOVERNANCE_TOKEN = internalToken;
process.env.DEF_HARNESS_PROJECTION_ENABLED = '1';
delete require.cache[serverModulePath];
const { server } = require(serverModulePath);
Object.assign(adapter, originalAdapter);

await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolve);
});
const sidecarAddress = server.address();
assert(sidecarAddress && typeof sidecarAddress === 'object');
const sidecarBaseUrl = `http://127.0.0.1:${sidecarAddress.port}`;

async function postNative(pathname, body, headers = {}) {
  const response = await fetch(`${sidecarBaseUrl}${pathname}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

function protectedCallsSince(index) {
  return restCalls.slice(index).filter((call) => protectedTools.has(call.tool));
}

function assertNoSecret(value, label) {
  assert.doesNotMatch(JSON.stringify(value), new RegExp(authority.provisionToken), `${label} must not expose the provision token`);
}

async function postHiddenCreateFailure(error) {
  nextCreateFailure = error;
  try {
    return await postNative('/api/native/session', {
      host: 'workbench',
      timelineId: 'failed-hidden-fixture-timeline',
      harnessProjection: authority,
    }, { 'x-def-internal-token': internalToken });
  } finally {
    nextCreateFailure = null;
  }
}

try {
  const hiddenStart = restCalls.length;
  const hidden = await postNative('/api/native/session', {
    host: 'workbench',
    timelineId: 'hidden-fixture-timeline',
    harnessProjection: authority,
  }, { 'x-def-internal-token': internalToken });
  assert.equal(hidden.status, 200, JSON.stringify(hidden.body));
  assert.equal(hidden.body.session.harnessProjection.mode, authority.mode);
  assertNoSecret(hidden.body, 'hidden fixture response');
  const hiddenProtected = protectedCallsSince(hiddenStart);
  assert.deepEqual(hiddenProtected.map((call) => call.tool), [
    'def.workbench.assert_timeline_admission',
    'def.workbench.bind_session_axis',
    'def.workbench.assert_session_axis',
  ], 'a hidden fixture must carry authority through admission, first bind, and bind assertion');
  for (const call of hiddenProtected) {
    assert.deepEqual(call.input.harnessProjection, authority, `${call.tool} must receive the exact governed authority`);
  }

  const uncoded = await postHiddenCreateFailure(new Error(`uncoded failure leaked ${authority.provisionToken}`));
  assert.equal(uncoded.status, 500);
  assert.equal(uncoded.body.error.code, 'NATIVE_SESSION_CREATE_FAILED');
  assert.equal(uncoded.body.error.status, 500);
  assert.equal(Object.hasOwn(uncoded.body.error, 'upstreamCode'), false, 'an uncoded failure has no promoted upstream classification');
  assertNoSecret(uncoded.body, 'uncoded create failure');

  const unknown = new Error(`unknown failure leaked ${authority.provisionToken}`);
  unknown.code = 'UPSTREAM_EXPERIMENTAL_FAILURE';
  unknown.status = 418;
  const unknownFailure = await postHiddenCreateFailure(unknown);
  assert.equal(unknownFailure.status, 500, 'unknown upstream codes cannot control the public status');
  assert.equal(unknownFailure.body.error.code, 'NATIVE_SESSION_CREATE_FAILED');
  assert.equal(unknownFailure.body.error.upstreamCode, 'UPSTREAM_EXPERIMENTAL_FAILURE', 'an unknown code remains bounded diagnostic context only');
  assertNoSecret(unknownFailure.body, 'unknown create failure');

  const sealFailure = new Error(`seal failure leaked ${authority.provisionToken}`);
  sealFailure.code = 'HARNESS_PROJECTION_SEAL_INVALID';
  sealFailure.status = 409;
  const sealed = await postHiddenCreateFailure(sealFailure);
  assert.equal(sealed.status, 409);
  assert.equal(sealed.body.error.code, 'HARNESS_PROJECTION_SEAL_INVALID');
  assertNoSecret(sealed.body, 'classified seal failure');

  const environmentFailure = new Error(`environment failure leaked ${authority.provisionToken}`);
  environmentFailure.code = 'BLOCKED_ENVIRONMENT';
  environmentFailure.status = 503;
  const environment = await postHiddenCreateFailure(environmentFailure);
  assert.equal(environment.status, 503);
  assert.equal(environment.body.error.code, 'BLOCKED_ENVIRONMENT');
  assertNoSecret(environment.body, 'classified environment failure');

  const transportFailure = new Error(`transport failure leaked ${authority.provisionToken}`);
  transportFailure.code = 'OPENCODE_REQUEST_TIMEOUT';
  transportFailure.status = 504;
  const transport = await postHiddenCreateFailure(transportFailure);
  assert.equal(transport.status, 504);
  assert.equal(transport.body.error.code, 'OPENCODE_REQUEST_TIMEOUT');
  assertNoSecret(transport.body, 'classified transport failure');

  const ordinaryStart = restCalls.length;
  const ordinary = await postNative('/api/native/session', {
    host: 'workbench', timelineId: 'ordinary-timeline',
  });
  assert.equal(ordinary.status, 200, JSON.stringify(ordinary.body));
  for (const call of protectedCallsSince(ordinaryStart)) {
    assert.equal(Object.hasOwn(call.input, 'harnessProjection'), false, `ordinary ${call.tool} must not receive projection authority`);
  }

  const recoverySession = makeSession({ sessionID: 'recovery-session', timelineId: 'recovery-timeline' });
  const recoveryStart = restCalls.length;
  const recovered = await postNative(`/api/native/session/${recoverySession.sessionID}/recover`, {
    directory: recoverySession.directory,
  });
  assert.equal(recovered.status, 200, JSON.stringify(recovered.body));
  for (const call of protectedCallsSince(recoveryStart)) {
    assert.equal(Object.hasOwn(call.input, 'harnessProjection'), false, `recovery ${call.tool} must not self-elevate from timeline identity`);
  }

  const deniedStart = restCalls.length;
  const denied = await postNative('/api/native/session', {
    host: 'workbench', timelineId: 'denied-timeline', harnessProjection: authority,
  });
  assert.equal(denied.status, 403);
  assert.equal(denied.body.code, 'HARNESS_PROJECTION_FORBIDDEN');
  assert.equal(protectedCallsSince(deniedStart).length, 0, 'an ungoverned request must not forward projection authority');
  assertNoSecret(denied.body, 'authorization error');

  for (const session of sessions.values()) {
    for (const entry of fs.readdirSync(session.directory)) {
      assertNoSecret(fs.readFileSync(path.join(session.directory, entry), 'utf8'), `session file ${entry}`);
    }
  }
  console.log('DEF native harness projection authority contract: PASS');
} finally {
  await new Promise((resolve) => server.close(resolve));
  await new Promise((resolve) => restServer.close(resolve));
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  fs.rmSync(root, { recursive: true, force: true });
}
