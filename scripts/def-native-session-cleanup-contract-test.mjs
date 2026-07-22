import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  cleanupNativeAiCliSessions,
} = require('../agent/server/def-agent-server.cjs');
const projectRoot = path.resolve(import.meta.dirname, '..');
const temporaryRoots = [];

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
  const cleanupStart = viewSource.indexOf('const cleanupSessionHistory = async () =>');
  const cleanupEnd = viewSource.indexOf('const frameSrc = useMemo', cleanupStart);
  assert(cleanupStart >= 0 && cleanupEnd > cleanupStart);
  const cleanupSource = viewSource.slice(cleanupStart, cleanupEnd);
  assert.match(cleanupSource, /window\.confirm\([^)]*无法恢复[^)]*当前会话会保留/);
  assert.match(cleanupSource, /\/api\/native\/sessions\/cleanup/);
  assert.match(cleanupSource, /keepSessionID: session\.id/);
  assert.doesNotMatch(cleanupSource, /createNativeSession\(/, 'cleanup must retain, not replace, the active session');
  assert.match(viewSource, /host === 'ai-cli'[\s\S]*清理会话记录/);
  assert.match(viewSource, /disabled=\{cleanupInProgress \|\| !session\}/);
  assert.match(viewSource, /key=\{`\$\{origin\}:\$\{session\.id\}:\$\{frameRevision\}`\}/);
  assert.match(cleanupSource, /signal: controller\.signal/);
  assert.match(viewSource, /cleanupAbortRef\.current\?\.abort\(\)/);
  assert.match(viewSource, /role=\{cleanupResult\.kind === 'error' \? 'alert' : 'status'\}/);

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
      'ui-confirm-host-scope-and-iframe-refresh',
    ],
  }));
} finally {
  for (const root of temporaryRoots.reverse()) fs.rmSync(root, { recursive: true, force: true });
}
