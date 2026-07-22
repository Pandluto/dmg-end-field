import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  cleanupNativeAiCliSessions,
} = require('../agent/server/def-agent-server.cjs');
const {
  isAuthorizedNativeSessionCleanupRequest,
} = require('../agent/server/native-session-cleanup-auth.cjs');
const {
  WORKBENCH_RENDERER_CAPABILITY_HEADER,
  isAuthorizedWorkbenchRendererRequest,
} = require('../electron/workbench-renderer-transport.cjs');
const projectRoot = path.resolve(import.meta.dirname, '..');
const temporaryRoots = [];
const cleanupResultModule = { exports: {} };
vm.runInNewContext(
  fs.readFileSync(path.join(projectRoot, 'public/shell/native-session-cleanup-result.js'), 'utf8'),
  { module: cleanupResultModule, Error, String, Number, Array },
);
const nativeSessionCleanupResult = cleanupResultModule.exports;

async function reserveLoopbackPort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  return port;
}

async function waitForSidecar(port, child, readError) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`cleanup contract sidecar exited early: ${readError()}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok) return;
    } catch {
      // The child has not bound the reserved port yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`cleanup contract sidecar did not become ready: ${readError()}`);
}

async function stopSidecar(child) {
  if (!child || child.exitCode !== null) return;
  const exited = once(child, 'exit');
  child.kill('SIGTERM');
  await Promise.race([
    exited,
    new Promise((resolve) => setTimeout(resolve, 2000)),
  ]);
  if (child.exitCode === null) child.kill();
}

function createFixture(label) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `def-native-cleanup-${label}-`));
  temporaryRoots.push(root);
  const sessionsRoot = path.join(root, 'sessions');
  const aiCliRoot = path.join(sessionsRoot, 'ai-cli');
  const workbenchRoot = path.join(sessionsRoot, 'workbench');
  fs.mkdirSync(aiCliRoot, { recursive: true });
  fs.mkdirSync(workbenchRoot, { recursive: true });

  const addBinding = (host, sessionID, directoryName = sessionID) => {
    const directory = path.join(host === 'ai-cli' ? aiCliRoot : workbenchRoot, directoryName);
    fs.mkdirSync(directory, { recursive: true });
    const binding = { schemaVersion: 5, host, sessionID, directory, skillId: host === 'ai-cli' ? 'operator' : 'workbench' };
    fs.writeFileSync(path.join(directory, '.def-session.json'), `${JSON.stringify(binding, null, 2)}\n`, 'utf8');
    return binding;
  };

  const findBinding = (sessionID) => {
    for (const hostRoot of [aiCliRoot, workbenchRoot]) {
      if (!fs.existsSync(hostRoot)) continue;
      for (const entry of fs.readdirSync(hostRoot, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const directory = path.join(hostRoot, entry.name);
        try {
          const binding = JSON.parse(fs.readFileSync(path.join(directory, '.def-session.json'), 'utf8'));
          if (binding.sessionID === sessionID && path.resolve(binding.directory) === path.resolve(directory)) return binding;
        } catch {
          // Invalid bindings are intentionally invisible to the resolver.
        }
      }
    }
    return null;
  };

  return { root, sessionsRoot, aiCliRoot, workbenchRoot, addBinding, findBinding };
}

function cleanupOptions(fixture, failSessionIDs = new Set()) {
  const upstreamDeletes = [];
  return {
    upstreamDeletes,
    options: {
      bindingResolver: fixture.findBinding,
      aiCliSessionsRoot: fixture.aiCliRoot,
      runtime: { serverUrl: 'http://fake-opencode.invalid' },
      rejectQuestions: async () => [],
      deleteQuestionRecords: () => undefined,
      removeAxisBinding: async () => undefined,
      fetchImpl: async (url, init) => {
        assert.equal(init?.method, 'DELETE');
        const match = /\/session\/([^?]+)/.exec(String(url));
        const sessionID = decodeURIComponent(match?.[1] || '');
        upstreamDeletes.push(sessionID);
        return failSessionIDs.has(sessionID)
          ? { ok: false, status: 503 }
          : { ok: true, status: 200 };
      },
    },
  };
}

try {
  {
    const internalToken = 'native-session-cleanup-contract-token';
    assert.equal(isAuthorizedNativeSessionCleanupRequest({
      headers: { 'x-def-internal-token': internalToken },
    }, internalToken), true, 'the exact native loopback token is accepted');
    assert.equal(isAuthorizedNativeSessionCleanupRequest({ headers: {} }, internalToken), false,
      'a missing native loopback token is rejected');
    assert.equal(isAuthorizedNativeSessionCleanupRequest({
      headers: { 'x-def-internal-token': 'wrong-native-session-cleanup-contract-token' },
    }, internalToken), false, 'a wrong native loopback token is rejected');
  }

  {
    const partial = nativeSessionCleanupResult.summarize({
      ok: false,
      host: 'ai-cli',
      keptSessionID: 'ses-current',
      targetCount: 3,
      deletedCount: 1,
      alreadyDeletedCount: 1,
      failed: [{ sessionID: 'ses-failed', code: 'NATIVE_SESSION_DELETE_UPSTREAM_FAILED' }],
    }, 'ses-current');
    assert.equal(partial.failedCount, 1);
    assert.equal(partial.summary, '清理未完全完成：已删除 1，已不存在 1，失败 1。当前会话已保留。',
      'a structured partial result remains a user-visible deletion summary');
    const refreshFailure = nativeSessionCleanupResult.appendRefreshWarning(partial.summary, new Error('refresh unavailable'));
    assert.equal(refreshFailure, `${partial.summary} 清理结果已确认；刷新会话列表失败：refresh unavailable`,
      'a refresh failure appends a warning without replacing the partial deletion summary');
  }

  {
    const port = await reserveLoopbackPort();
    const internalToken = 'native-session-cleanup-http-contract-token';
    let stderr = '';
    const sidecar = spawn(process.execPath, [path.join(projectRoot, 'agent/server/def-agent-server.cjs')], {
      cwd: projectRoot,
      env: {
        ...process.env,
        DEF_AGENT_PORT: String(port),
        DEF_INTERNAL_GOVERNANCE_TOKEN: internalToken,
      },
      stdio: ['ignore', 'ignore', 'pipe'],
      windowsHide: true,
    });
    sidecar.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
    try {
      await waitForSidecar(port, sidecar, () => stderr);
      const headers = {
        'Content-Type': 'application/json',
        'x-def-internal-token': internalToken,
      };
      const malformed = await fetch(`http://127.0.0.1:${port}/api/native/sessions/cleanup`, {
        method: 'POST',
        headers,
        body: '{"host":',
      });
      assert.equal(malformed.status, 400);
      assert.equal(malformed.headers.has('access-control-allow-origin'), false,
        'invalid cleanup JSON is handled by the private non-CORS error writer');
      assert.equal((await malformed.json()).ok, false);

      const invalidKeep = await fetch(`http://127.0.0.1:${port}/api/native/sessions/cleanup`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ host: 'ai-cli', keepSessionID: 'ses-does-not-exist' }),
      });
      assert.equal(invalidKeep.status, 400);
      assert.equal(invalidKeep.headers.has('access-control-allow-origin'), false,
        'cleanup business errors are handled by the private non-CORS error writer');
      const invalidKeepPayload = await invalidKeep.json();
      assert.equal(invalidKeepPayload.ok, false);
      assert.equal(invalidKeepPayload.code, 'NATIVE_SESSION_CLEANUP_INVALID_KEEP');
    } finally {
      await stopSidecar(sidecar);
    }
  }

  {
    const rendererCapability = 'z'.repeat(43);
    const requestUrl = new URL('http://127.0.0.1:31457/def-agent/native-sessions/cleanup');
    assert.equal(isAuthorizedWorkbenchRendererRequest({
      headers: {
        origin: 'http://127.0.0.1:3030',
        [WORKBENCH_RENDERER_CAPABILITY_HEADER]: rendererCapability,
      },
    }, requestUrl, rendererCapability, { bridgeHost: '127.0.0.1', bridgePort: 31457 }), true,
    'the bridge accepts the Electron-injected capability from the trusted Shell origin');
    assert.equal(isAuthorizedWorkbenchRendererRequest({
      headers: { origin: 'http://127.0.0.1:3030' },
    }, requestUrl, rendererCapability, { bridgeHost: '127.0.0.1', bridgePort: 31457 }), false,
    'the bridge rejects a trusted origin without the capability');
    assert.equal(isAuthorizedWorkbenchRendererRequest({
      headers: {
        origin: 'http://malicious.invalid',
        [WORKBENCH_RENDERER_CAPABILITY_HEADER]: rendererCapability,
      },
    }, requestUrl, rendererCapability, { bridgeHost: '127.0.0.1', bridgePort: 31457 }), false,
    'the bridge rejects a capability from an untrusted origin');
  }

  {
    const fixture = createFixture('preserve');
    const current = fixture.addBinding('ai-cli', 'ses-current');
    const old = fixture.addBinding('ai-cli', 'ses-old');
    const workbench = fixture.addBinding('workbench', 'ses-workbench');
    const { options, upstreamDeletes } = cleanupOptions(fixture);

    const result = await cleanupNativeAiCliSessions({ host: 'ai-cli', keepSessionID: current.sessionID }, options);
    assert.deepEqual(result, {
      ok: true,
      host: 'ai-cli',
      keptSessionID: current.sessionID,
      targetCount: 1,
      deletedCount: 1,
      alreadyDeletedCount: 0,
      failed: [],
    });
    assert.equal(fs.existsSync(current.directory), true, 'the active ai-cli session must be preserved');
    assert.equal(fs.existsSync(old.directory), false, 'an old ai-cli session must be removed');
    assert.equal(fs.existsSync(workbench.directory), true, 'Workbench sessions must stay outside cleanup scope');
    assert.deepEqual(upstreamDeletes, [old.sessionID], 'the current and Workbench sessions must never reach delete');

    const repeated = await cleanupNativeAiCliSessions({ host: 'ai-cli', keepSessionID: current.sessionID }, options);
    assert.equal(repeated.ok, true);
    assert.equal(repeated.targetCount, 0, 'repeating cleanup after success is safe');
  }

  {
    const fixture = createFixture('invalid-keep');
    const current = fixture.addBinding('ai-cli', 'ses-current');
    const old = fixture.addBinding('ai-cli', 'ses-old');
    const { options, upstreamDeletes } = cleanupOptions(fixture);

    await assert.rejects(
      cleanupNativeAiCliSessions({ host: 'ai-cli', keepSessionID: 'ses-missing' }, options),
      (error) => error?.status === 400 && error?.code === 'NATIVE_SESSION_CLEANUP_INVALID_KEEP',
    );
    await assert.rejects(
      cleanupNativeAiCliSessions({ host: 'workbench', keepSessionID: current.sessionID }, options),
      (error) => error?.status === 400 && error?.code === 'NATIVE_SESSION_CLEANUP_INVALID_REQUEST',
    );
    await assert.rejects(
      cleanupNativeAiCliSessions({ host: 'ai-cli', keepSessionID: current.sessionID, directories: [old.directory] }, options),
      (error) => error?.status === 400 && error?.code === 'NATIVE_SESSION_CLEANUP_INVALID_REQUEST',
    );
    assert.equal(fs.existsSync(old.directory), true, 'fail-closed requests cannot delete an old session');
    assert.deepEqual(upstreamDeletes, [], 'invalid requests cannot reach the upstream delete path');
  }

  {
    const fixture = createFixture('partial');
    const current = fixture.addBinding('ai-cli', 'ses-current', '0-current');
    const first = fixture.addBinding('ai-cli', 'ses-good-first', '1-good');
    const failed = fixture.addBinding('ai-cli', 'ses-failed', '2-failed');
    const last = fixture.addBinding('ai-cli', 'ses-good-last', '3-good');
    const workbench = fixture.addBinding('workbench', 'ses-workbench');
    const { options, upstreamDeletes } = cleanupOptions(fixture, new Set([failed.sessionID]));

    const result = await cleanupNativeAiCliSessions({ host: 'ai-cli', keepSessionID: current.sessionID }, options);
    assert.equal(result.ok, false, 'a partial failure cannot report full success');
    assert.equal(result.targetCount, 3);
    assert.equal(result.deletedCount, 2);
    assert.equal(result.alreadyDeletedCount, 0);
    assert.deepEqual(result.failed, [{
      sessionID: failed.sessionID,
      code: 'NATIVE_SESSION_DELETE_UPSTREAM_FAILED',
      httpStatus: 503,
    }]);
    assert.deepEqual(upstreamDeletes, [first.sessionID, failed.sessionID, last.sessionID], 'one failure must not stop later targets');
    assert.equal(fs.existsSync(first.directory), false);
    assert.equal(fs.existsSync(failed.directory), true, 'a failed upstream delete preserves the local binding for retry');
    assert.equal(fs.existsSync(last.directory), false);
    assert.equal(fs.existsSync(workbench.directory), true);
  }

  {
    const fixture = createFixture('race');
    const current = fixture.addBinding('ai-cli', 'ses-current');
    const raced = fixture.addBinding('ai-cli', 'ses-raced');
    let racedLookups = 0;
    const bindingResolver = (sessionID) => {
      if (sessionID !== raced.sessionID) return fixture.findBinding(sessionID);
      racedLookups += 1;
      if (racedLookups === 1) return fixture.findBinding(sessionID);
      fs.rmSync(raced.directory, { recursive: true, force: true });
      return null;
    };
    const { options, upstreamDeletes } = cleanupOptions(fixture);
    options.bindingResolver = bindingResolver;

    const result = await cleanupNativeAiCliSessions({ host: 'ai-cli', keepSessionID: current.sessionID }, options);
    assert.equal(result.ok, true);
    assert.equal(result.targetCount, 1);
    assert.equal(result.deletedCount, 0);
    assert.equal(result.alreadyDeletedCount, 1, 'a target deleted after enumeration is counted as already deleted');
    assert.deepEqual(upstreamDeletes, [], 'an already-deleted race cannot reach upstream');
  }

  {
    const fixture = createFixture('upstream-404');
    const current = fixture.addBinding('ai-cli', 'ses-current');
    const stale = fixture.addBinding('ai-cli', 'ses-stale');
    const { options, upstreamDeletes } = cleanupOptions(fixture);
    options.fetchImpl = async (url) => {
      const match = /\/session\/([^?]+)/.exec(String(url));
      upstreamDeletes.push(decodeURIComponent(match?.[1] || ''));
      return { ok: false, status: 404 };
    };

    const result = await cleanupNativeAiCliSessions({ host: 'ai-cli', keepSessionID: current.sessionID }, options);
    assert.equal(result.deletedCount, 0);
    assert.equal(result.alreadyDeletedCount, 1, 'an upstream 404 means the Session was already absent');
    assert.equal(fs.existsSync(stale.directory), false, 'a stale local binding is still removed after upstream 404');
    assert.deepEqual(upstreamDeletes, [stale.sessionID]);
  }

  {
    const fixture = createFixture('binding-race');
    const current = fixture.addBinding('ai-cli', 'ses-current');
    const target = fixture.addBinding('ai-cli', 'ses-duplicate', 'old-ai-cli');
    const workbenchDuplicate = fixture.addBinding('workbench', 'ses-duplicate', 'same-id-workbench');
    let targetLookups = 0;
    const bindingResolver = (sessionID) => {
      if (sessionID !== target.sessionID) return fixture.findBinding(sessionID);
      targetLookups += 1;
      return targetLookups === 1 ? target : workbenchDuplicate;
    };
    const { options, upstreamDeletes } = cleanupOptions(fixture);
    options.bindingResolver = bindingResolver;

    const result = await cleanupNativeAiCliSessions({ host: 'ai-cli', keepSessionID: current.sessionID }, options);
    assert.equal(result.ok, false);
    assert.deepEqual(result.failed, [{
      sessionID: target.sessionID,
      code: 'NATIVE_SESSION_DELETE_BINDING_CHANGED',
    }]);
    assert.equal(fs.existsSync(target.directory), true);
    assert.equal(fs.existsSync(workbenchDuplicate.directory), true, 'a changed resolver must never delete a Workbench duplicate');
    assert.deepEqual(upstreamDeletes, [], 'binding identity is rechecked before upstream delete');
  }

  {
    const fixture = createFixture('redirects');
    const current = fixture.addBinding('ai-cli', 'ses-current');
    const forgedDirectory = path.join(fixture.aiCliRoot, 'forged-directory');
    const forgedOutside = path.join(fixture.root, 'outside-forged');
    fs.mkdirSync(forgedDirectory, { recursive: true });
    fs.mkdirSync(forgedOutside, { recursive: true });
    const forgedBinding = { host: 'ai-cli', sessionID: 'ses-forged', directory: forgedOutside };
    fs.writeFileSync(path.join(forgedDirectory, '.def-session.json'), JSON.stringify(forgedBinding), 'utf8');

    const externalDirectory = path.join(fixture.root, 'outside-junction-target');
    fs.mkdirSync(externalDirectory, { recursive: true });
    const externalBinding = { host: 'ai-cli', sessionID: 'ses-junction', directory: externalDirectory };
    fs.writeFileSync(path.join(externalDirectory, '.def-session.json'), JSON.stringify(externalBinding), 'utf8');
    const junctionDirectory = path.join(fixture.aiCliRoot, 'junction-entry');
    fs.symlinkSync(externalDirectory, junctionDirectory, 'junction');

    const bindingResolver = (sessionID) => {
      if (sessionID === forgedBinding.sessionID) return forgedBinding;
      if (sessionID === externalBinding.sessionID) return externalBinding;
      return fixture.findBinding(sessionID);
    };
    const { options, upstreamDeletes } = cleanupOptions(fixture);
    options.bindingResolver = bindingResolver;

    const result = await cleanupNativeAiCliSessions({ host: 'ai-cli', keepSessionID: current.sessionID }, options);
    assert.equal(result.targetCount, 0, 'redirected and forged directories are not valid cleanup targets');
    assert.equal(fs.existsSync(externalDirectory), true);
    assert.equal(fs.existsSync(forgedOutside), true);
    assert.deepEqual(upstreamDeletes, []);

    const redirectedSessions = path.join(fixture.root, 'redirected', 'sessions');
    fs.mkdirSync(redirectedSessions, { recursive: true });
    const redirectedRoot = path.join(redirectedSessions, 'ai-cli');
    fs.symlinkSync(fixture.aiCliRoot, redirectedRoot, 'junction');
    await assert.rejects(
      cleanupNativeAiCliSessions(
        { host: 'ai-cli', keepSessionID: current.sessionID },
        { ...options, aiCliSessionsRoot: redirectedRoot },
      ),
      (error) => error?.status === 400 && error?.code === 'NATIVE_SESSION_CLEANUP_INVALID_ROOT',
    );
  }

  {
    const fixture = createFixture('concurrent');
    const current = fixture.addBinding('ai-cli', 'ses-current');
    const old = fixture.addBinding('ai-cli', 'ses-old');
    const { options, upstreamDeletes } = cleanupOptions(fixture);
    let releaseUpstream;
    let markStarted;
    const started = new Promise((resolve) => { markStarted = resolve; });
    const upstreamGate = new Promise((resolve) => { releaseUpstream = resolve; });
    options.fetchImpl = async (url) => {
      const match = /\/session\/([^?]+)/.exec(String(url));
      upstreamDeletes.push(decodeURIComponent(match?.[1] || ''));
      markStarted();
      await upstreamGate;
      return { ok: true, status: 200 };
    };

    const first = cleanupNativeAiCliSessions({ host: 'ai-cli', keepSessionID: current.sessionID }, options);
    await started;
    const joined = cleanupNativeAiCliSessions({ host: 'ai-cli', keepSessionID: current.sessionID }, options);
    releaseUpstream();
    const [firstResult, joinedResult] = await Promise.all([first, joined]);
    assert.deepEqual(joinedResult, firstResult, 'overlapping requests for the same current Session join one cleanup');
    assert.deepEqual(upstreamDeletes, [old.sessionID], 'joined cleanup cannot issue a second upstream delete');
  }

  {
    const fixture = createFixture('concurrent-different-keep');
    const currentFirst = fixture.addBinding('ai-cli', 'ses-current-first', '0-current-first');
    const currentSecond = fixture.addBinding('ai-cli', 'ses-current-second', '1-current-second');
    const { options } = cleanupOptions(fixture);
    let releaseUpstream;
    let markStarted;
    const started = new Promise((resolve) => { markStarted = resolve; });
    const upstreamGate = new Promise((resolve) => { releaseUpstream = resolve; });
    options.fetchImpl = async () => {
      markStarted();
      await upstreamGate;
      return { ok: true, status: 200 };
    };

    const first = cleanupNativeAiCliSessions({ host: 'ai-cli', keepSessionID: currentFirst.sessionID }, options);
    await started;
    await assert.rejects(
      cleanupNativeAiCliSessions({ host: 'ai-cli', keepSessionID: currentSecond.sessionID }, options),
      (error) => error?.status === 409 && error?.code === 'NATIVE_SESSION_CLEANUP_BUSY',
    );
    releaseUpstream();
    await first;
  }

  const viewSource = fs.readFileSync(path.join(projectRoot, 'src/components/def-opencode/DefOpenCodeView.tsx'), 'utf8');
  const shellHtml = fs.readFileSync(path.join(projectRoot, 'public/shell/index.html'), 'utf8');
  const shellSource = fs.readFileSync(path.join(projectRoot, 'public/shell/shell.js'), 'utf8');
  const mainSource = fs.readFileSync(path.join(projectRoot, 'electron/main.cjs'), 'utf8');
  const sidecarSource = fs.readFileSync(path.join(projectRoot, 'agent/server/def-agent-server.cjs'), 'utf8')
    .replace(/\r\n?/g, '\n');
  const sidecarAuthSource = fs.readFileSync(path.join(projectRoot, 'agent/server/native-session-cleanup-auth.cjs'), 'utf8');
  assert.doesNotMatch(viewSource, /cleanupSessionHistory|native\/sessions\/cleanup/, 'the Web ai-cli view must not expose the Shell-only cleanup entry');
  assert.match(shellHtml, /id="native-ai-cli-keep-session"/);
  assert.match(shellHtml, /id="refresh-native-ai-cli-sessions"/);
  assert.match(shellHtml, /id="cleanup-native-ai-cli-sessions"/);
  assert.match(shellHtml, /native-session-cleanup-result\.js/);

  const refreshStart = shellSource.indexOf('const refreshNativeAiCliSessions = async');
  const cleanupStart = shellSource.indexOf('const cleanupNativeAiCliSessions = async');
  const refreshEnd = shellSource.indexOf('const cleanupNativeAiCliSessions = async', refreshStart);
  const cleanupEnd = shellSource.indexOf('const refreshAgentRecords = async', cleanupStart);
  assert(refreshStart >= 0 && refreshEnd > refreshStart && cleanupEnd > cleanupStart);
  const refreshSource = shellSource.slice(refreshStart, refreshEnd);
  const cleanupSource = shellSource.slice(cleanupStart, cleanupEnd);
  assert.match(refreshSource, /\/def-agent\/chat\/persisted-sessions\?limit=100/);
  assert.match(shellSource, /session\?\.host === 'ai-cli'/);
  assert.match(shellSource, /state\.nativeAiCliSessions\.some/);
  assert.match(shellSource, /sessionStorage\.setItem\(SHELL_RENDERER_CAPABILITY_STORAGE_KEY, injectedCapability\)/,
    'Shell persists the one-time Electron-injected renderer capability');
  assert.match(shellSource, /url\.searchParams\.delete\(WORKBENCH_RENDERER_CAPABILITY_QUERY\)/,
    'Shell removes the renderer capability from the visible URL');
  assert.match(shellSource, /window\.history\.replaceState\(/,
    'Shell updates browser history after removing the renderer capability URL parameter');
  assert.match(cleanupSource, /window\.confirm\(/);
  assert.match(cleanupSource, /无法恢复/);
  assert.match(cleanupSource, /Workbench 会话不会被处理/);
  assert.match(cleanupSource, /\/def-agent\/native-sessions\/cleanup/);
  assert.match(cleanupSource, /acceptOkFalse: true/,
    'cleanup explicitly accepts a structured HTTP 200 payload whose operation-level ok is false');
  assert.equal((shellSource.match(/acceptOkFalse: true/g) || []).length, 1,
    'the relaxed operation-level result handling is scoped only to destructive cleanup');
  assert.match(cleanupSource, /\[WORKBENCH_RENDERER_CAPABILITY_HEADER\]: shellRendererCapability/,
    'Shell supplies the renderer capability only for the destructive cleanup request');
  assert.match(cleanupSource, /body: JSON\.stringify\(\{ host: 'ai-cli', keepSessionID \}\)/);
  assert.doesNotMatch(cleanupSource, /createNativeSession\(/, 'Shell cleanup must retain an explicitly selected session, never replace it');
  const summaryIndex = cleanupSource.indexOf('nativeSessionCleanupResult.summarize');
  const refreshIndex = cleanupSource.indexOf('await refreshNativeAiCliSessions', summaryIndex);
  const refreshCatchIndex = cleanupSource.indexOf('catch (refreshError)', refreshIndex);
  assert(summaryIndex >= 0 && refreshIndex > summaryIndex && refreshCatchIndex > refreshIndex,
    'the backend deletion summary is established before the follow-up refresh');
  assert.match(cleanupSource, /nativeSessionCleanupResult\.appendRefreshWarning\(summary, refreshError\)/,
    'a failed refresh preserves the confirmed deletion summary and adds only a warning');

  const bridgeStart = mainSource.indexOf("requestUrl.pathname === '/def-agent/native-sessions/cleanup'");
  const bridgeEnd = mainSource.indexOf('const defAgentEventsMatch', bridgeStart);
  assert(bridgeStart >= 0 && bridgeEnd > bridgeStart);
  const bridgeSource = mainSource.slice(bridgeStart, bridgeEnd);
  const bridgeAuthorizationIndex = bridgeSource.indexOf('isAuthorizedWorkbenchRendererRequest');
  const bridgeStartAgentIndex = bridgeSource.indexOf('await startDefAgent()');
  assert(bridgeAuthorizationIndex >= 0 && bridgeStartAgentIndex > bridgeAuthorizationIndex,
    'the bridge rejects an untrusted cleanup request before starting or forwarding to the sidecar');
  assert.match(bridgeSource, /await startDefAgent\(\)/);
  assert.match(bridgeSource, /http:\/\/127\.0\.0\.1:17322\/api\/native\/sessions\/cleanup/);
  assert.match(bridgeSource, /requestNativeLoopbackJson\(/,
    'cleanup reaches the sidecar only over the native Node loopback transport');
  assert.match(bridgeSource, /'x-def-internal-token': defInternalGovernanceToken/,
    'the bridge adds internal authority only after renderer authorization');
  assert.doesNotMatch(bridgeSource, /postJsonUrl\(/,
    'cleanup never uses the browser-oriented generic transport');

  const sidecarGateStart = sidecarSource.indexOf("if (requestUrl.pathname === '/api/native/sessions/cleanup')");
  const sidecarOptionsStart = sidecarSource.indexOf("if (method === 'OPTIONS')", sidecarGateStart);
  const sidecarRouteStart = sidecarSource.indexOf("if (method === 'POST' && requestUrl.pathname === '/api/native/sessions/cleanup')");
  const sidecarRouteEnd = sidecarSource.indexOf('const nativeSessionDelete', sidecarRouteStart);
  assert(sidecarGateStart >= 0 && sidecarOptionsStart > sidecarGateStart && sidecarRouteStart > sidecarOptionsStart && sidecarRouteEnd > sidecarRouteStart,
    'the sidecar token gate runs before CORS preflight and the cleanup handler');
  const sidecarGateSource = sidecarSource.slice(sidecarGateStart, sidecarOptionsStart);
  const sidecarRouteSource = sidecarSource.slice(sidecarRouteStart, sidecarRouteEnd);
  const privateWriterStart = sidecarSource.indexOf('function writeNativeSessionCleanupJson');
  const privateWriterEnd = sidecarSource.indexOf('function buildEmbeddedProviderCatalog', privateWriterStart);
  assert(privateWriterStart >= 0 && privateWriterEnd > privateWriterStart);
  const privateWriterSource = sidecarSource.slice(privateWriterStart, privateWriterEnd);
  assert.match(sidecarGateSource, /isAuthorizedNativeSessionCleanupRequest\(request, defInternalGovernanceToken\)/,
    'the sidecar gates cleanup with the internal token');
  assert.match(sidecarAuthSource, /crypto\.timingSafeEqual\(/,
    'the sidecar cleanup token comparison is timing-safe');
  assert.match(sidecarGateSource, /writeNativeSessionCleanupJson\(response, 403/,
    'unauthorized cleanup does not inherit the sidecar-wide CORS response');
  assert.match(sidecarRouteSource, /writeNativeSessionCleanupJson\(response, 200, result\)/,
    'successful cleanup uses the non-CORS private response writer');
  assert.doesNotMatch(privateWriterSource, /Access-Control-Allow-Origin/,
    'the cleanup endpoint never advertises a browser CORS grant');
  const globalCatchStart = sidecarSource.lastIndexOf('} catch (error) {');
  const globalCatchEnd = sidecarSource.indexOf('\n  }\n});', globalCatchStart);
  assert(globalCatchStart >= 0 && globalCatchEnd > globalCatchStart);
  const globalCatchSource = sidecarSource.slice(globalCatchStart, globalCatchEnd);
  assert.match(globalCatchSource, /requestUrl\.pathname === '\/api\/native\/sessions\/cleanup'/);
  assert.match(globalCatchSource, /writeNativeSessionCleanupJson\(response, statusCode, payload\)/,
    'all cleanup parsing and business exceptions stay on the private response writer');

  console.log(JSON.stringify({
    ok: true,
    checks: [
      'current-session-preserved',
      'old-ai-cli-deleted',
      'workbench-isolated',
      'invalid-keep-fails-closed',
      'partial-failure-continues',
      'already-deleted-race-counted',
      'upstream-404-counted-as-already-deleted',
      'binding-identity-race-blocked',
      'junction-and-forged-paths-blocked',
      'concurrent-cleanup-joined',
      'different-keep-concurrency-rejected',
      'repeat-safe',
      'shell-capability-persisted-and-url-scrubbed',
      'bridge-cleanup-capability-gate-and-native-loopback',
      'sidecar-cleanup-internal-token-gate',
      'sidecar-cleanup-errors-remain-private-http',
      'partial-cleanup-summary-visible',
      'summary-survives-refresh-failure',
      'shell-ui-confirm-explicit-keep-and-bridge-scope',
    ],
  }));
} finally {
  for (const root of temporaryRoots.reverse()) fs.rmSync(root, { recursive: true, force: true });
}
