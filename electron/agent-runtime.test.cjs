'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  AGENT_BRIDGE_PREFIX,
  BROWSER_ORIGIN_HEADER,
  BROWSER_LAUNCH_PATH,
  GRANT_PATH,
  HEALTH_PATH,
  HOST_TOKEN_HEADER,
  SHUTDOWN_PATH,
  createAgentRuntime,
} = require('./agent-runtime.cjs');

class FakeUtilityProcess extends EventEmitter {
  constructor(pid) {
    super();
    this.pid = pid;
    this.killed = false;
  }

  kill() {
    this.killed = true;
    queueMicrotask(() => this.emit('exit', null, 'SIGTERM'));
    return true;
  }
}

function createClockAndTimers() {
  let now = 1_700_000_000_000;
  const timers = {
    setTimeout(callback, milliseconds) {
      const handle = setTimeout(() => {
        now += milliseconds;
        callback();
      }, milliseconds);
      return handle;
    },
    clearTimeout,
  };
  return {
    timers,
    clock: () => now,
    advance(milliseconds) {
      now += milliseconds;
    },
  };
}

function createResponse(status, payload, headers = {}) {
  const serialized = JSON.stringify(payload);
  const responseHeaders = new Map(Object.entries({
    'content-type': 'application/json; charset=utf-8',
    ...headers,
  }));
  return {
    status,
    ok: status >= 200 && status < 400,
    headers: { get: (name) => responseHeaders.get(String(name).toLowerCase()) || null },
    async json() { return payload; },
    async arrayBuffer() {
      return Buffer.from(serialized, 'utf8').buffer.slice(
        Buffer.from(serialized, 'utf8').byteOffset,
        Buffer.from(serialized, 'utf8').byteOffset + Buffer.byteLength(serialized),
      );
    },
  };
}

function createResponseCapture() {
  return {
    statusCode: 0,
    headers: {},
    headersSent: false,
    body: null,
    setHeader(name, value) { this.headers[String(name).toLowerCase()] = String(value); },
    end(value) { this.headersSent = true; this.body = value ? Buffer.from(value) : Buffer.alloc(0); },
    destroy(error) { this.destroyed = error || true; },
  };
}

function processIdentity(pid, generation = 'owned') {
  return `sha256:${crypto.createHash('sha256').update(`${pid}:${generation}`).digest('hex')}`;
}

function writeEngineProcessManifest(fixture, {
  hostPid,
  enginePid,
  hostGeneration = 'owned',
  engineGeneration = 'owned',
}) {
  const manifestPath = path.join(fixture.runtime.engineStoreRoot, 'process.json');
  fs.mkdirSync(fixture.runtime.engineStoreRoot, { recursive: true });
  fixture.setProcessIdentity(hostPid, processIdentity(hostPid, hostGeneration));
  fixture.setProcessIdentity(enginePid, processIdentity(enginePid, engineGeneration));
  fs.writeFileSync(manifestPath, JSON.stringify({
    schemaVersion: 2,
    hostPid,
    hostProcessIdentity: processIdentity(hostPid, hostGeneration),
    enginePid,
    engineProcessIdentity: processIdentity(enginePid, engineGeneration),
    processNonce: 'abcdefghijklmnopqrstuvwxyzABCDEF0123456789_-',
    runtimeVersion: '1.17.11-def.1',
  }), { mode: 0o600 });
  return manifestPath;
}

function createFakeFs(realFs) {
  return {
    existsSync: realFs.existsSync.bind(realFs),
    mkdirSync: realFs.mkdirSync.bind(realFs),
    readFileSync: realFs.readFileSync.bind(realFs),
    lstatSync: realFs.lstatSync.bind(realFs),
    unlinkSync: realFs.unlinkSync.bind(realFs),
  };
}

async function createFixture({
  fetchImpl,
  manifestOverrides = {},
  proxyResponseDelayMs = 0,
  proxyTimeoutMs = 30_000,
  commandNextProxyTimeoutMs = 35_000,
  gracefulShutdown = true,
  engineIgnoresSigterm = false,
  engineIgnoresSigkill = false,
} = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'def-agent-runtime-test-'));
  const applicationRoot = path.join(root, 'app');
  const runtimeRoot = path.join(root, 'runtime');
  const servicePath = path.join(applicationRoot, 'dist', 'agent', 'host-entry.cjs');
  fs.mkdirSync(path.dirname(servicePath), { recursive: true });
  fs.writeFileSync(servicePath, '// test runtime\n', 'utf8');
  const lifecycleClock = createClockAndTimers();
  let pid = 40_001;
  let launchCount = 0;
  let currentChild = null;
  const calls = [];
  const grants = [];
  const fetchCalls = [];
  const killedProcesses = [];
  const deadPids = new Set();
  const processIdentities = new Map();

  const fakeFetch = fetchImpl || (async (url, requestOptions = {}) => {
    const parsed = new URL(url);
    fetchCalls.push({ url: String(url), options: requestOptions });
    if (parsed.pathname === HEALTH_PATH) {
      return createResponse(200, {
        service: 'def-agent-host',
        protocolVersion: 2,
        runtimeSchemaVersion: 1,
        state: 'ready',
        engine: { kind: 'pending', state: 'pending', reason: 'test' },
      });
    }
    if (parsed.pathname === GRANT_PATH) {
      grants.push(JSON.parse(requestOptions.body));
      return createResponse(201, { ok: true });
    }
    if (parsed.pathname === SHUTDOWN_PATH) {
      if (!gracefulShutdown) throw new Error('fixture graceful shutdown unavailable');
      queueMicrotask(() => currentChild?.emit('exit', 0, null));
      return createResponse(200, { ok: true });
    }
    if (parsed.pathname.startsWith(AGENT_BRIDGE_PREFIX)) {
      if (proxyResponseDelayMs > 0) {
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(resolve, proxyResponseDelayMs);
          requestOptions.signal?.addEventListener('abort', () => {
            clearTimeout(timeout);
            reject(requestOptions.signal.reason || new Error('proxy request aborted'));
          }, { once: true });
        });
      }
      return createResponse(200, { ok: true, path: parsed.pathname }, {
        'cache-control': 'no-store',
      });
    }
    return createResponse(404, { ok: false });
  });

  const runtime = createAgentRuntime({
    applicationRoot,
    runtimeRoot,
    servicePath,
    browserOrigin: 'http://127.0.0.1:31457',
    fs: createFakeFs(fs),
    timers: lifecycleClock.timers,
    clock: lifecycleClock.clock,
    fetch: fakeFetch,
    randomToken: (() => {
      let sequence = 0;
      return () => `test-token-${String(++sequence).padStart(2, '0')}-abcdefghijklmnop`;
    })(),
    pollIntervalMs: 1,
    readyTimeoutMs: 500,
    healthTimeoutMs: 100,
    proxyTimeoutMs,
    commandNextProxyTimeoutMs,
    stopTimeoutMs: 100,
    launchService({ env }) {
      launchCount += 1;
      calls.push({ env: { ...env } });
      currentChild = new FakeUtilityProcess(pid++);
      const child = currentChild;
      child.once('exit', () => deadPids.add(child.pid));
      setImmediate(() => {
        fs.mkdirSync(runtimeRoot, { recursive: true });
        fs.writeFileSync(
          runtime.readyFile,
          JSON.stringify({
            service: 'def-agent-host',
            protocolVersion: 2,
            runtimeSchemaVersion: 1,
            host: '127.0.0.1',
            port: 35_000 + launchCount,
            pid: child.pid,
            healthPath: '/internal/health',
            ...manifestOverrides,
          }),
          'utf8',
        );
      });
      return child;
    },
    processKill(pid, signal) {
      if (signal === 0) {
        if (deadPids.has(pid)) {
          const error = new Error('process does not exist');
          error.code = 'ESRCH';
          throw error;
        }
        return true;
      }
      killedProcesses.push({ pid, signal });
      if ((signal === 'SIGKILL' && !engineIgnoresSigkill) || (signal === 'SIGTERM' && !engineIgnoresSigterm)) {
        deadPids.add(pid);
      }
      return true;
    },
    inspectProcessIdentity(pid) {
      return processIdentities.get(pid) || processIdentity(pid);
    },
  });

  return {
    runtime,
    root,
    lifecycleClock,
    calls,
    grants,
    fetchCalls,
    killedProcesses,
    markDeadProcess(pid) { deadPids.add(pid); },
    setProcessIdentity(pid, identity) { processIdentities.set(pid, identity); },
    get launchCount() { return launchCount; },
    get child() { return currentChild; },
    cleanup() { fs.rmSync(root, { recursive: true, force: true }); },
  };
}

test('lazy start, health reuse, private grant registration, and ordered stop', async () => {
  const fixture = await createFixture();
  try {
    assert.equal(fixture.runtime.state().state, 'not-started');
    assert.equal(fixture.launchCount, 0);

    const [first, concurrent] = await Promise.all([
      fixture.runtime.start(),
      fixture.runtime.start(),
    ]);
    assert.equal(first.ready, true);
    assert.equal(concurrent.ready, true);
    assert.equal(fixture.launchCount, 1);
    assert.equal(fixture.calls[0].env.DEF_AGENT_HOST_TOKEN, 'test-token-01-abcdefghijklmnop');
    assert.equal(fixture.calls[0].env.DEF_AGENT_BROWSER_ORIGIN, 'http://127.0.0.1:31457');
    assert.equal(fixture.calls[0].env.DEF_AGENT_READY_FILE, fixture.runtime.readyFile);
    assert.equal(fixture.calls[0].env.DEF_AGENT_ENGINE_ROOT, fixture.runtime.engineRoot);
    assert.equal(fixture.calls[0].env.DEF_AGENT_NATIVE_UI_ROOT, fixture.runtime.nativeUiRoot);
    assert.equal(fixture.calls[0].env.DEF_AGENT_ENGINE_STORE_ROOT, fixture.runtime.engineStoreRoot);
    assert.equal(fixture.calls[0].env.DEF_AGENT_SESSION_STORE_ROOT, fixture.runtime.sessionStoreRoot);
    assert.equal(
      fixture.calls[0].env.DEF_AGENT_PRODUCT_COMMAND_STORE_ROOT,
      fixture.runtime.productCommandStoreRoot,
    );
    assert.equal(fixture.calls[0].env.DEF_AGENT_ENGINE_PROFILE_PATH, fixture.runtime.engineProfilePath);
    assert.equal(fixture.calls[0].env.DEF_AGENT_ENGINE_DEFAULT_PROFILE_REF, 'default');
    assert.equal(fixture.calls[0].env.DEF_AGENT_PARENT_PID, String(process.pid));
    assert.doesNotMatch(JSON.stringify(first), /test-token/u);

    const reused = await fixture.runtime.start();
    assert.equal(reused.ready, true);
    assert.equal(fixture.launchCount, 1);

    const grant = await fixture.runtime.issueLaunchGrant();
    assert.equal(grant.audience, 'workbench-ai-mode');
    assert.equal(fixture.grants.length, 1);
    assert.equal(fixture.grants[0].origin, 'http://127.0.0.1:31457');
    const grantCall = fixture.fetchCalls.find((call) => new URL(call.url).pathname === GRANT_PATH);
    assert.equal(grantCall.options.headers[HOST_TOKEN_HEADER], 'test-token-01-abcdefghijklmnop');

    const stopped = await fixture.runtime.stop();
    assert.equal(stopped.state, 'stopped');
    assert.equal(stopped.running, false);
    assert.equal(fixture.child.killed, false, '正常 shutdown 应先让 Host 自己退出');
    assert.equal(fs.existsSync(fixture.runtime.readyFile), false);
  } finally {
    fixture.cleanup();
  }
});

test('forced Host shutdown terminates only its correlated OpenCode child', async () => {
  const fixture = await createFixture({ gracefulShutdown: false });
  try {
    await fixture.runtime.start();
    writeEngineProcessManifest(fixture, { hostPid: fixture.child.pid, enginePid: 51_234 });

    await fixture.runtime.stop();
    assert.deepEqual(fixture.killedProcesses, [{ pid: 51_234, signal: 'SIGTERM' }]);
    assert.equal(fs.existsSync(path.join(fixture.runtime.engineStoreRoot, 'process.json')), false);
  } finally {
    fixture.cleanup();
  }
});

test('forced Host shutdown escalates a stubborn OpenCode child and only removes the manifest after exit', async () => {
  const fixture = await createFixture({ gracefulShutdown: false, engineIgnoresSigterm: true });
  try {
    await fixture.runtime.start();
    writeEngineProcessManifest(fixture, { hostPid: fixture.child.pid, enginePid: 51_235 });

    await fixture.runtime.stop();
    assert.deepEqual(fixture.killedProcesses, [
      { pid: 51_235, signal: 'SIGTERM' },
      { pid: 51_235, signal: 'SIGKILL' },
    ]);
    assert.equal(fs.existsSync(path.join(fixture.runtime.engineStoreRoot, 'process.json')), false);
  } finally {
    fixture.cleanup();
  }
});

test('a fresh Host start cleans an engine owned by a dead prior Host before launching', async () => {
  const fixture = await createFixture();
  try {
    const staleHostPid = 49_999;
    fixture.markDeadProcess(staleHostPid);
    writeEngineProcessManifest(fixture, { hostPid: staleHostPid, enginePid: 51_236 });

    const started = await fixture.runtime.start();
    assert.equal(started.ready, true);
    assert.deepEqual(fixture.killedProcesses, [{ pid: 51_236, signal: 'SIGTERM' }]);
    assert.equal(fs.existsSync(path.join(fixture.runtime.engineStoreRoot, 'process.json')), false);
  } finally {
    await fixture.runtime.stop();
    fixture.cleanup();
  }
});

test('a reused stale engine PID is never signalled and only its obsolete manifest is removed', async () => {
  const fixture = await createFixture({ gracefulShutdown: false });
  try {
    await fixture.runtime.start();
    const enginePid = 51_238;
    const manifestPath = writeEngineProcessManifest(fixture, {
      hostPid: fixture.child.pid,
      enginePid,
    });
    fixture.setProcessIdentity(enginePid, processIdentity(enginePid, 'reused'));

    await fixture.runtime.stop();

    assert.deepEqual(fixture.killedProcesses, []);
    assert.equal(fs.existsSync(manifestPath), false);
  } finally {
    fixture.cleanup();
  }
});

test('shutdown retains ownership evidence and fails closed when an OpenCode child survives SIGKILL', async () => {
  const fixture = await createFixture({
    gracefulShutdown: false,
    engineIgnoresSigterm: true,
    engineIgnoresSigkill: true,
  });
  try {
    await fixture.runtime.start();
    const manifestPath = writeEngineProcessManifest(fixture, {
      hostPid: fixture.child.pid,
      enginePid: 51_237,
    });

    await assert.rejects(() => fixture.runtime.stop(), /ownership manifest was retained/u);
    assert.equal(fs.existsSync(manifestPath), true);
  } finally {
    fixture.markDeadProcess(51_237);
    await fixture.runtime.stop().catch(() => undefined);
    fixture.cleanup();
  }
});

test('crashed Host is visible and a later start creates a fresh private runtime', async () => {
  const fixture = await createFixture();
  try {
    await fixture.runtime.start();
    const oldChild = fixture.child;
    oldChild.emit('exit', 17, null);
    assert.equal(fixture.runtime.state().state, 'error');
    assert.equal(fixture.runtime.state().running, false);
    assert.match(fixture.runtime.state().reason, /退出/u);

    const restarted = await fixture.runtime.start();
    assert.equal(restarted.ready, true);
    assert.equal(fixture.launchCount, 2);
    assert.notEqual(fixture.calls[0].env.DEF_AGENT_HOST_TOKEN, fixture.calls[1].env.DEF_AGENT_HOST_TOKEN);
  } finally {
    await fixture.runtime.stop();
    fixture.cleanup();
  }
});

test('browser proxy only owns /agent-host/**, enforces origin, and never forwards a private token to the browser', async () => {
  const fixture = await createFixture();
  try {
    await fixture.runtime.start();
    const request = {
      method: 'GET',
      url: '/agent-host/health?from=test',
      headers: {
        origin: 'http://127.0.0.1:31457',
        'x-dmg-agent-ui-capability': 'ui-capability-for-test',
      },
    };
    const response = createResponseCapture();
    assert.equal(await fixture.runtime.handleBrowserRequest(request, response), true);
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers['cache-control'], 'no-store');
    assert.equal(response.headers['access-control-allow-origin'], 'http://127.0.0.1:31457');
    const proxyCall = fixture.fetchCalls.find((call) => call.url.includes('/agent-host/health?from=test'));
    assert.ok(proxyCall);
    assert.equal(proxyCall.options.headers['x-dmg-agent-ui-capability'], 'ui-capability-for-test');
    assert.equal(proxyCall.options.headers[HOST_TOKEN_HEADER], 'test-token-01-abcdefghijklmnop');
    assert.equal(proxyCall.options.headers[BROWSER_ORIGIN_HEADER], 'http://127.0.0.1:31457');
    assert.equal(proxyCall.options.headers.origin, 'http://127.0.0.1:31457');
    assert.doesNotMatch(response.body.toString('utf8'), /test-token-01-abcdefghijklmnop/u);

    const preflight = createResponseCapture();
    assert.equal(await fixture.runtime.handleBrowserRequest({
      url: '/agent-host/ui/session',
      method: 'OPTIONS',
      headers: { origin: 'http://127.0.0.1:31457' },
    }, preflight), true);
    assert.equal(preflight.statusCode, 204);
    assert.equal(preflight.headers['access-control-allow-origin'], 'http://127.0.0.1:31457');
    assert.notEqual(preflight.headers['access-control-allow-origin'], '*');

    const ignored = createResponseCapture();
    assert.equal(await fixture.runtime.handleBrowserRequest({ url: '/ordinary', method: 'GET' }, ignored), false);
    assert.equal(ignored.headersSent, false);

    const denied = createResponseCapture();
    assert.equal(await fixture.runtime.handleBrowserRequest({
      url: '/agent-host/health',
      method: 'GET',
      headers: { origin: 'http://attacker.invalid' },
    }, denied), true);
    assert.equal(denied.statusCode, 403);
    assert.match(denied.body.toString('utf8'), /agent-origin-denied/u);
  } finally {
    await fixture.runtime.stop();
    fixture.cleanup();
  }
});

test('the embedded workbench button obtains one one-time grant from Electron and rejects every other origin', async () => {
  const fixture = await createFixture();
  try {
    const denied = createResponseCapture();
    assert.equal(await fixture.runtime.handleBrowserRequest({
      method: 'POST',
      url: BROWSER_LAUNCH_PATH,
      headers: {},
    }, denied), true);
    assert.equal(denied.statusCode, 403);
    assert.equal(fixture.launchCount, 0, 'a missing browser origin must never lazy-start the Host');

    const response = createResponseCapture();
    assert.equal(await fixture.runtime.handleBrowserRequest({
      method: 'POST',
      url: BROWSER_LAUNCH_PATH,
      headers: { origin: 'http://127.0.0.1:31457' },
    }, response), true);
    assert.equal(response.statusCode, 201);
    assert.equal(response.headers['access-control-allow-origin'], 'http://127.0.0.1:31457');
    assert.equal(fixture.launchCount, 1);
    assert.equal(fixture.grants.length, 1);
    const payload = JSON.parse(response.body.toString('utf8'));
    assert.equal(payload.ok, true);
    assert.equal(payload.launch.audience, 'workbench-ai-mode');
    assert.match(payload.launch.grant, /^[A-Za-z0-9_-]{20,200}$/u);
    assert.doesNotMatch(JSON.stringify(fixture.runtime.state()), new RegExp(payload.launch.grant, 'u'));

    const methodDenied = createResponseCapture();
    assert.equal(await fixture.runtime.handleBrowserRequest({
      method: 'GET',
      url: BROWSER_LAUNCH_PATH,
      headers: { origin: 'http://127.0.0.1:31457' },
    }, methodDenied), true);
    assert.equal(methodDenied.statusCode, 405);
    assert.equal(fixture.grants.length, 1);
  } finally {
    await fixture.runtime.stop();
    fixture.cleanup();
  }
});

test('the default browser proxy timeout allows a real asynchronous Host response', async () => {
  const fixture = await createFixture({ proxyResponseDelayMs: 10 });
  try {
    await fixture.runtime.start();
    const response = createResponseCapture();
    assert.equal(await fixture.runtime.handleBrowserRequest({
      method: 'GET',
      url: '/agent-host/health',
      headers: { origin: 'http://127.0.0.1:31457' },
    }, response), true);
    assert.equal(response.statusCode, 200);
    assert.match(response.body.toString('utf8'), /agent-host\/health/u);
  } finally {
    await fixture.runtime.stop();
    fixture.cleanup();
  }
});

test('the Product command long-poll proxy uses its extended timeout', async () => {
  const fixture = await createFixture({
    proxyResponseDelayMs: 30,
    proxyTimeoutMs: 10,
    commandNextProxyTimeoutMs: 100,
  });
  try {
    await fixture.runtime.start();
    const response = createResponseCapture();
    assert.equal(await fixture.runtime.handleBrowserRequest({
      method: 'GET',
      url: '/agent-host/workbench/commands/next?waitMs=25000',
      headers: { origin: 'http://127.0.0.1:31457' },
    }, response), true);
    assert.equal(response.statusCode, 200);
    assert.match(response.body.toString('utf8'), /workbench\/commands\/next/u);
  } finally {
    await fixture.runtime.stop();
    fixture.cleanup();
  }
});

test('an unauthorised browser request does not lazily spawn the private Host', async () => {
  const fixture = await createFixture();
  try {
    const response = createResponseCapture();
    assert.equal(await fixture.runtime.handleBrowserRequest({
      method: 'GET',
      url: '/agent-host/health',
      headers: { origin: 'http://127.0.0.1:31457' },
    }, response), true);
    assert.equal(response.statusCode, 503);
    assert.equal(fixture.launchCount, 0);
  } finally {
    fixture.cleanup();
  }
});

test('invalid ready manifest cannot turn a non-loopback or fixed public host into a ready runtime', async () => {
  const fixture = await createFixture({ manifestOverrides: { host: '192.168.1.10' } });
  try {
    const originalLaunch = fixture.child;
    assert.equal(originalLaunch, null);
    const result = await fixture.runtime.start();
    assert.equal(result.ready, false);
    assert.equal(result.state, 'error');
    assert.match(result.reason, /loopback|就绪清单/u);
  } finally {
    await fixture.runtime.stop();
    fixture.cleanup();
  }
});
