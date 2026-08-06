import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  asClientTurnId,
  asDefSessionId,
  asDefTurnId,
  type EngineHealth,
  type EngineToolProjectionInput,
  type JsonObject,
} from '../../core/contracts/index.ts';
import { OpenCodeEngineAdapter, type OpenCodeRuntimeController } from './adapter.ts';
import { OpenCodeEngineError } from './errors.ts';
import { OpenCodePrivateBridge } from './private-bridge.ts';
import {
  FileOpenCodeProviderProfileSource,
  InMemoryOpenCodeProviderProfileSource,
  type OpenCodeProviderProfile,
} from './profile.ts';
import {
  OPENCODE_BINARY_VERSION,
  OPENCODE_RUNTIME_MANIFEST_SCHEMA_VERSION,
  OPENCODE_RUNTIME_VERSION,
  OPENCODE_SOURCE_REF,
  OPENCODE_UPSTREAM_VERSION,
  OpenCodeRuntimeSupervisor,
  verifyOpenCodeRuntime,
  type RunningOpenCodeRuntime,
  type VerifiedOpenCodeRuntime,
} from './runtime.ts';
import {
  OPENCODE_TOOL_BINDINGS,
  projectSafeToolNames,
  toDefCanonicalToolName,
  toOpenCodeSafeToolName,
} from './tool-bindings.ts';

const profile: OpenCodeProviderProfile = {
  ref: 'default',
  providerId: 'fixture',
  displayName: 'Fixture Provider',
  baseUrl: 'http://127.0.0.1:39000/v1',
  modelId: 'fixture-model',
  apiKey: 'fixture-secret',
};

assert.deepEqual(
  OPENCODE_TOOL_BINDINGS.map(([canonical, safe]) => [
    toDefCanonicalToolName(safe),
    toOpenCodeSafeToolName(canonical),
  ]),
  OPENCODE_TOOL_BINDINGS,
);
assert.equal(new Set(OPENCODE_TOOL_BINDINGS.map(([canonical]) => canonical)).size, 6);
assert.equal(new Set(OPENCODE_TOOL_BINDINGS.map(([, safe]) => safe)).size, 6);
assert.throws(() => toOpenCodeSafeToolName('def.unknown'), /Unsupported DEF Tool binding/u);

const routeProjection = projection(1, 'def.harness.route');
assert.deepEqual(projectSafeToolNames(routeProjection), ['def_harness_route']);
assert.deepEqual(projectSafeToolNames({ revision: 2, tools: [] }), []);

const temporary = await mkdtemp(join(tmpdir(), 'def-opencode-contract-'));

async function testProfiles(root: string): Promise<void> {
  const profilePath = join(root, 'profiles.json');
  const source = new FileOpenCodeProviderProfileSource(profilePath);
  assert.equal(await source.getProfile('default'), null);
  await writeFile(profilePath, JSON.stringify({ schemaVersion: 1, profiles: [profile] }));
  await chmod(profilePath, 0o600);
  assert.deepEqual(await source.getProfile('default'), profile);
  assert.equal(await source.getProfile('missing'), null);
  if (process.platform !== 'win32') {
    await chmod(profilePath, 0o644);
    await assert.rejects(() => source.getProfile('default'), /mode 0600/u);
    await chmod(profilePath, 0o600);
  }
  assert.throws(() => new InMemoryOpenCodeProviderProfileSource([{
    ...profile,
    baseUrl: 'http://provider.example/v1',
  }]), /must use HTTPS/u);
  assert.throws(() => new InMemoryOpenCodeProviderProfileSource([{
    ...profile,
    headers: { Host: 'attacker.invalid' },
  }]), /bounded string headers/u);
  await writeFile(profilePath, JSON.stringify({ schemaVersion: 1, profiles: [profile, profile] }));
  await chmod(profilePath, 0o600);
  await assert.rejects(() => source.getProfile('default'), /refs must be unique/u);
}

async function testRuntimeManifest(root: string): Promise<void> {
  const runtimeRoot = join(root, 'runtime');
  const binaryPath = join(runtimeRoot, 'bin', runtimeTarget(), 'opencode-fixture');
  const pluginPath = join(runtimeRoot, 'plugin.mjs');
  const licensePath = join(runtimeRoot, 'LICENSE');
  await mkdir(join(runtimeRoot, 'bin', runtimeTarget()), { recursive: true });
  await writeFile(binaryPath, `#!/bin/sh\necho ${OPENCODE_BINARY_VERSION}\n`);
  await chmod(binaryPath, 0o755);
  if (process.platform === 'darwin') {
    const signed = spawnSync('/usr/bin/codesign', ['--force', '--sign', '-', '--timestamp=none', binaryPath]);
    assert.equal(signed.status, 0, 'fixture code signing failed');
  }
  await writeFile(pluginPath, 'export default async () => ({ tool: {} });\n');
  await writeFile(licensePath, `MIT License\n${'x'.repeat(120)}\n`);
  const plugin = await import('node:fs/promises').then(({ readFile }) => readFile(pluginPath));
  const license = await import('node:fs/promises').then(({ readFile }) => readFile(licensePath));
  const binaryCode = await inspectFixtureCode(binaryPath, root);
  const manifest = {
    schemaVersion: OPENCODE_RUNTIME_MANIFEST_SCHEMA_VERSION,
    name: 'def-opencode-engine-runtime',
    engineKind: 'opencode',
    upstreamVersion: OPENCODE_UPSTREAM_VERSION,
    runtimeVersion: OPENCODE_RUNTIME_VERSION,
    storeSchemaVersion: 1,
    target: runtimeTarget(),
    sourceRef: OPENCODE_SOURCE_REF,
    binary: `bin/${runtimeTarget()}/opencode-fixture`,
    binaryVersion: OPENCODE_BINARY_VERSION,
    binaryCodeBytes: binaryCode.length,
    binaryCodeSha256: sha256(binaryCode),
    plugin: 'plugin.mjs',
    pluginSha256: sha256(plugin),
    license: 'LICENSE',
    licenseBytes: license.length,
    licenseSha256: sha256(license),
  };
  await writeFile(join(runtimeRoot, 'manifest.json'), JSON.stringify(manifest));
  const verified = await verifyOpenCodeRuntime(runtimeRoot);
  assert.equal(verified.manifest.runtimeVersion, OPENCODE_RUNTIME_VERSION);
  await writeFile(pluginPath, 'tampered');
  await assert.rejects(() => verifyOpenCodeRuntime(runtimeRoot), /plugin checksum/u);
}

async function testSupervisorDoesNotReplaceUnstoppableChild(root: string): Promise<void> {
  class StubbornChild extends EventEmitter {
    readonly pid = process.pid;
    readonly stdout = { resume: () => undefined };
    readonly stderr = { resume: () => undefined };
    readonly exitCode = null;
    readonly signalCode = null;

    kill(): boolean {
      return true;
    }
  }

  const child = new StubbornChild();
  let spawnCalls = 0;
  let releaseHealth!: () => void;
  let healthRequested!: () => void;
  const healthGate = new Promise<void>((resolve) => { releaseHealth = resolve; });
  const healthRequest = new Promise<void>((resolve) => { healthRequested = resolve; });
  const supervisor = new OpenCodeRuntimeSupervisor({
    runtimeRoot: join(process.cwd(), 'dist', 'agent', 'engine', 'opencode'),
    storeRoot: join(root, 'stubborn-runtime'),
    profileSource: new InMemoryOpenCodeProviderProfileSource([profile]),
    bridgeOrigin: () => 'http://127.0.0.1:39001',
    bridgeToken: () => 'bridge-token-abcdefghijklmnopqrstuvwxyz',
    expectPluginReady: async () => undefined,
    fetch: async () => {
      healthRequested();
      await healthGate;
      throw new Error('fixture health unavailable');
    },
    startupTimeoutMs: 25,
    stopGraceTimeoutMs: 1,
    stopKillTimeoutMs: 1,
    spawnProcess: (() => {
      spawnCalls += 1;
      return child as unknown as ReturnType<typeof spawn>;
    }) as typeof spawn,
  });

  const firstStart = supervisor.start('default');
  await healthRequest;
  const concurrentStart = supervisor.start('default');
  releaseHealth();
  const [firstResult, concurrentResult] = await Promise.allSettled([firstStart, concurrentStart]);
  assert.equal(firstResult.status, 'rejected');
  assert.equal(concurrentResult.status, 'rejected');
  if (firstResult.status === 'rejected' && concurrentResult.status === 'rejected') {
    assert.equal(firstResult.reason instanceof OpenCodeEngineError, true);
    assert.equal(concurrentResult.reason instanceof OpenCodeEngineError, true);
    assert.equal(firstResult.reason.code, 'OPENCODE_PROCESS_STOP_FAILED');
    assert.equal(concurrentResult.reason.code, 'OPENCODE_PROCESS_STOP_FAILED');
    assert.doesNotMatch(concurrentResult.reason.message, /previous OpenCode process/u);
  }
  await assert.rejects(
    () => supervisor.start('default'),
    (error: unknown) => error instanceof OpenCodeEngineError
      && error.code === 'OPENCODE_PROCESS_STOP_FAILED'
      && /previous OpenCode process is still alive/u.test(error.message),
  );
  assert.equal(spawnCalls, 1);
}

async function testPrivateBridge(): Promise<void> {
  const bridge = new OpenCodePrivateBridge({ token: 'bridge-token-abcdefghijklmnopqrstuvwxyz' });
  const origin = await bridge.start();
  const pluginReady = bridge.expectPluginReady({
    protocolVersion: 1,
    buildId: 'def-opencode-engine-phase4-v1',
    processNonce: 'process-nonce-bridge',
    runtimeVersion: OPENCODE_RUNTIME_VERSION,
    directory: '/fixture/workspace',
  });
  const readyResponse = await fetch(`${origin}/v1/plugin-ready`, {
    method: 'POST',
    headers: {
      'x-def-opencode-bridge-token': bridge.token,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      protocolVersion: 1,
      buildId: 'def-opencode-engine-phase4-v1',
      processNonce: 'process-nonce-bridge',
      runtimeVersion: OPENCODE_RUNTIME_VERSION,
      directory: '/fixture/workspace',
    }),
  });
  assert.equal(readyResponse.status, 200);
  await pluginReady;
  const state: OpenCodeBridgeStateFixture = {
    engineTurnId: 'turn-bridge',
    turnLease: 'lease-bridge',
    userMessageId: 'msg_bridge',
    systemContext: 'fixture context',
    projectionRevision: 1,
    safeTools: ['def_harness_route'],
    projectedTools: [{
      safeName: 'def_harness_route',
      description: 'Fixture route',
      inputSchema: schemaFor('def.harness.route'),
      risk: 'read',
    }],
  };
  let requested = false;
  const controller = {
    state: () => state,
    requestTool: async () => {
      requested = true;
      return { status: 'succeeded' as const, result: { ok: true } };
    },
  };
  bridge.register('session-bridge', controller);
  const unauthorized = await fetch(`${origin}/v1/turn-state?sessionId=session-bridge`);
  assert.equal(unauthorized.status, 401);
  const headers = { 'x-def-opencode-bridge-token': bridge.token };
  const response = await fetch(`${origin}/v1/turn-state?sessionId=session-bridge`, { headers });
  assert.deepEqual(await response.json(), state);
  const tool = await fetch(`${origin}/v1/tool-call`, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({
      sessionId: 'session-bridge',
      messageId: 'message-bridge',
      callId: 'call-bridge',
      engineTurnId: state.engineTurnId,
      turnLease: state.turnLease,
      userMessageId: state.userMessageId,
      safeToolName: 'def_harness_route',
      input: { businessId: 'calculation', operation: 'calculate' },
      projectionRevision: 1,
    }),
  });
  assert.deepEqual(await tool.json(), { status: 'succeeded', result: { ok: true } });
  assert.equal(requested, true);
  bridge.unregister('session-bridge', controller);
  await bridge.stop();
}

async function testAdapterAtomicProjection(): Promise<void> {
  const bridge = new OpenCodePrivateBridge({ token: 'atomic-token-abcdefghijklmnopqrstuvwxyz' });
  const runtime = new FakeOpenCodeRuntimeController();
  const adapter = new OpenCodeEngineAdapter({
    runtimeRoot: '/unused',
    storeRoot: '/unused',
    profileSource: new InMemoryOpenCodeProviderProfileSource([profile]),
    bridge,
    runtimeSupervisor: runtime,
  });
  await assert.rejects(() => adapter.createSession({
    defSessionId: asDefSessionId('def-session-wrong-profile'),
    providerProfileRef: 'other',
  }), /only accepts provider profile default/u);
  const session = await adapter.createSession({
    defSessionId: asDefSessionId('def-session-contract'),
    providerProfileRef: 'default',
  });
  const turnInput = {
    engineSession: session,
    defSessionId: asDefSessionId('def-session-contract'),
    defTurnId: asDefTurnId('def-turn-contract'),
    clientTurnId: asClientTurnId('client-turn-contract'),
    providerProfileRef: 'default',
    systemContext: 'Route, then calculate.',
    userMessage: '算一下当前伤害',
    toolProjection: routeProjection,
  } as const;
  const handle = await adapter.startTurn(turnInput);
  const iterator = handle.events[Symbol.asyncIterator]();
  const headers = {
    'x-def-opencode-bridge-token': bridge.token,
    'content-type': 'application/json',
  };
  const activeState = await fetch(
    `${bridge.origin}/v1/turn-state?sessionId=${encodeURIComponent(session.sessionId)}`,
    { headers: { 'x-def-opencode-bridge-token': bridge.token } },
  ).then((response) => response.json()) as OpenCodeBridgeStateFixture;
  const toolResponsePromise = fetch(`${bridge.origin}/v1/tool-call`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      sessionId: session.sessionId,
      messageId: 'message-contract',
      callId: 'call-contract',
      engineTurnId: activeState.engineTurnId,
      turnLease: activeState.turnLease,
      userMessageId: activeState.userMessageId,
      safeToolName: 'def_harness_route',
      input: { businessId: 'calculation', operation: 'calculate' },
      projectionRevision: 1,
    }),
  });
  runtime.emit({
    directory: runtime.running.directory,
    payload: {
      type: 'message.updated',
      properties: {
        sessionID: session.sessionId,
        info: {
          id: 'message-contract',
          sessionID: session.sessionId,
          role: 'assistant',
          parentID: activeState.userMessageId,
          time: { created: 1 },
        },
      },
    },
  });
  const staleTool = await fetch(`${bridge.origin}/v1/tool-call`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      sessionId: session.sessionId,
      messageId: 'message-stale',
      callId: 'call-stale',
      engineTurnId: activeState.engineTurnId,
      turnLease: activeState.turnLease,
      userMessageId: activeState.userMessageId,
      safeToolName: 'def_harness_route',
      input: { businessId: 'calculation', operation: 'calculate' },
      projectionRevision: 1,
    }),
  });
  assert.equal(staleTool.status, 409);
  const requested = await nextEvent(iterator);
  assert.equal(requested.type, 'tool.requested');
  if (requested.type !== 'tool.requested') throw new Error('Expected Tool request');
  assert.equal(requested.name, 'def.harness.route');

  const nextProjection = projection(2, 'def.node.crud.context');
  await handle.submitToolResultAndUpdateProjection({
    toolCallId: requested.toolCallId,
    status: 'succeeded',
    result: { routed: true },
  }, nextProjection);
  const state = await fetch(
    `${bridge.origin}/v1/turn-state?sessionId=${encodeURIComponent(session.sessionId)}`,
    { headers: { 'x-def-opencode-bridge-token': bridge.token } },
  ).then((response) => response.json()) as { projectionRevision: number; safeTools: string[] };
  assert.equal(state.projectionRevision, 2);
  assert.deepEqual(state.safeTools, ['def_node_crud_context']);
  assert.equal((await nextEvent(iterator)).type, 'tool-projection.applied');
  assert.deepEqual(await toolResponsePromise.then((response) => response.json()), {
    status: 'succeeded',
    result: { routed: true },
  });
  await handle.submitToolResultAndUpdateProjection({
    toolCallId: requested.toolCallId,
    status: 'succeeded',
    result: { routed: true },
  }, nextProjection);
  await assert.rejects(() => handle.submitToolResultAndUpdateProjection({
    toolCallId: requested.toolCallId,
    status: 'succeeded',
    result: { routed: false },
  }, nextProjection), /conflicts/u);

  runtime.emit({
    directory: runtime.running.directory,
    payload: {
      type: 'message.part.delta',
      properties: {
        sessionID: session.sessionId,
        messageID: 'message-from-old-turn',
        partID: 'part-from-old-turn',
        field: 'text',
        delta: '不应出现',
      },
    },
  });
  runtime.emit({
    directory: runtime.running.directory,
    payload: {
      type: 'message.updated',
      properties: {
        sessionID: session.sessionId,
        info: {
          id: 'message-from-old-turn',
          sessionID: session.sessionId,
          role: 'assistant',
          parentID: 'msg_from_old_turn',
          time: { created: 1, completed: 2 },
        },
      },
    },
  });
  runtime.emit({
    directory: runtime.running.directory,
    payload: {
      type: 'session.status',
      properties: { sessionID: session.sessionId, status: { type: 'idle' } },
    },
  });

  await handle.updateToolProjection({ revision: 3, tools: [] });
  assert.equal((await nextEvent(iterator)).type, 'tool-projection.applied');

  runtime.emit({
    directory: runtime.running.directory,
    payload: {
      type: 'message.updated',
      properties: {
        sessionID: session.sessionId,
        info: {
          id: 'message-answer',
          sessionID: session.sessionId,
          role: 'assistant',
          parentID: activeState.userMessageId,
          time: { created: 1, completed: 2 },
        },
      },
    },
  });
  runtime.emit({
    directory: runtime.running.directory,
    payload: {
      type: 'message.part.delta',
      properties: {
        sessionID: session.sessionId,
        messageID: 'message-answer',
        partID: 'part-answer',
        field: 'text',
        delta: '完成',
      },
    },
  });
  runtime.emit({
    directory: runtime.running.directory,
    payload: {
      type: 'session.status',
      properties: { sessionID: session.sessionId, status: { type: 'idle' } },
    },
  });
  const delta = await nextEvent(iterator);
  assert.equal(delta.type, 'response.delta');
  const terminal = await nextEvent(iterator);
  assert.equal(terminal.type, 'turn.completed');
  assert.equal((await iterator.next()).done, true);
  runtime.crash();
  await assert.rejects(() => adapter.startTurn(turnInput), /detached/u);
  assert.deepEqual(await adapter.recoverSession(session), { status: 'recovered', ref: session });
  await adapter.shutdown();
}

async function testAdapterAbortWithPendingTool(): Promise<void> {
  const bridge = new OpenCodePrivateBridge({ token: 'abort-token-abcdefghijklmnopqrstuvwxyz' });
  const runtime = new FakeOpenCodeRuntimeController();
  const adapter = new OpenCodeEngineAdapter({
    runtimeRoot: '/unused',
    storeRoot: '/unused',
    profileSource: new InMemoryOpenCodeProviderProfileSource([profile]),
    bridge,
    runtimeSupervisor: runtime,
  });
  const session = await adapter.createSession({
    defSessionId: asDefSessionId('def-session-abort'),
    providerProfileRef: 'default',
  });
  const handle = await adapter.startTurn({
    engineSession: session,
    defSessionId: asDefSessionId('def-session-abort'),
    defTurnId: asDefTurnId('def-turn-abort'),
    clientTurnId: asClientTurnId('client-turn-abort'),
    providerProfileRef: 'default',
    systemContext: 'Route only.',
    userMessage: '停止前先路由',
    toolProjection: routeProjection,
  });
  const iterator = handle.events[Symbol.asyncIterator]();
  const headers = {
    'x-def-opencode-bridge-token': bridge.token,
    'content-type': 'application/json',
  };
  const state = await fetch(
    `${bridge.origin}/v1/turn-state?sessionId=${encodeURIComponent(session.sessionId)}`,
    { headers },
  ).then((response) => response.json()) as OpenCodeBridgeStateFixture;
  const pendingTool = fetch(`${bridge.origin}/v1/tool-call`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      sessionId: session.sessionId,
      messageId: 'message-abort',
      callId: 'call-abort',
      engineTurnId: state.engineTurnId,
      turnLease: state.turnLease,
      userMessageId: state.userMessageId,
      safeToolName: 'def_harness_route',
      input: { businessId: 'selection', operation: 'inspect' },
      projectionRevision: 1,
    }),
  });
  runtime.emit({
    directory: runtime.running.directory,
    payload: {
      type: 'message.updated',
      properties: {
        sessionID: session.sessionId,
        info: {
          id: 'message-abort',
          sessionID: session.sessionId,
          role: 'assistant',
          parentID: state.userMessageId,
          time: { created: 1 },
        },
      },
    },
  });
  assert.equal((await nextEvent(iterator)).type, 'tool.requested');
  assert.deepEqual(await handle.abort({ code: 'USER_ABORTED' }), {
    status: 'aborted',
    terminalType: 'turn.aborted',
  });
  assert.deepEqual(await pendingTool.then((response) => response.json()), {
    status: 'failed',
    code: 'USER_ABORTED',
    message: 'DEF Turn was aborted',
  });
  assert.equal((await nextEvent(iterator)).type, 'turn.aborted');
  assert.equal((await iterator.next()).done, true);
  assert.deepEqual(await handle.abort({ code: 'LATE_ABORT' }), {
    status: 'already-terminal',
    terminalType: 'turn.aborted',
  });
  await adapter.shutdown();
}

async function testAdapterProcessCrashAndProviderRedaction(): Promise<void> {
  const makeAdapter = () => {
    const runtime = new FakeOpenCodeRuntimeController();
    const adapter = new OpenCodeEngineAdapter({
      runtimeRoot: '/unused',
      storeRoot: '/unused',
      profileSource: new InMemoryOpenCodeProviderProfileSource([profile]),
      bridge: new OpenCodePrivateBridge({ token: `failure-token-${cryptoToken()}` }),
      runtimeSupervisor: runtime,
    });
    return { adapter, runtime };
  };
  const start = async (adapter: OpenCodeEngineAdapter, suffix: string) => {
    const session = await adapter.createSession({
      defSessionId: asDefSessionId(`def-session-${suffix}`),
      providerProfileRef: 'default',
    });
    const input = {
      engineSession: session,
      defSessionId: asDefSessionId(`def-session-${suffix}`),
      defTurnId: asDefTurnId(`def-turn-${suffix}`),
      clientTurnId: asClientTurnId(`client-turn-${suffix}`),
      providerProfileRef: 'default',
      systemContext: 'Failure contract.',
      userMessage: '测试失败边界',
      toolProjection: routeProjection,
    } as const;
    return { session, input, handle: await adapter.startTurn(input) };
  };

  const crashed = makeAdapter();
  const crashTurn = await start(crashed.adapter, 'crash');
  const crashEvents = crashTurn.handle.events[Symbol.asyncIterator]();
  crashed.runtime.crash();
  const crashTerminal = await nextEvent(crashEvents);
  assert.equal(crashTerminal.type, 'turn.failed');
  if (crashTerminal.type === 'turn.failed') assert.equal(crashTerminal.code, 'OPENCODE_PROCESS_EXITED');
  await assert.rejects(() => crashed.adapter.startTurn(crashTurn.input), /detached/u);
  await crashed.adapter.shutdown();

  const providerFailed = makeAdapter();
  const providerTurn = await start(providerFailed.adapter, 'provider');
  const providerEvents = providerTurn.handle.events[Symbol.asyncIterator]();
  providerFailed.runtime.emit({
    directory: providerFailed.runtime.running.directory,
    payload: {
      type: 'session.error',
      properties: {
        sessionID: providerTurn.session.sessionId,
        error: { data: { message: 'secret-api-key-should-never-escape' } },
      },
    },
  });
  const providerTerminal = await nextEvent(providerEvents);
  assert.equal(providerTerminal.type, 'turn.failed');
  if (providerTerminal.type === 'turn.failed') {
    assert.equal(providerTerminal.message, 'OpenCode provider request failed');
    assert.doesNotMatch(providerTerminal.message, /secret-api-key/u);
  }
  await providerFailed.adapter.shutdown();
}

async function testAdapterStreamQuarantineAndRecovery(): Promise<void> {
  const bridge = new OpenCodePrivateBridge({ token: 'stream-token-abcdefghijklmnopqrstuvwxyz' });
  const runtime = new FakeOpenCodeRuntimeController();
  const adapter = new OpenCodeEngineAdapter({
    runtimeRoot: '/unused',
    storeRoot: '/unused',
    profileSource: new InMemoryOpenCodeProviderProfileSource([profile]),
    bridge,
    runtimeSupervisor: runtime,
  });
  const session = await adapter.createSession({
    defSessionId: asDefSessionId('def-session-stream'),
    providerProfileRef: 'default',
  });
  const handle = await adapter.startTurn({
    engineSession: session,
    defSessionId: asDefSessionId('def-session-stream'),
    defTurnId: asDefTurnId('def-turn-stream'),
    clientTurnId: asClientTurnId('client-turn-stream'),
    providerProfileRef: 'default',
    systemContext: 'Stream recovery contract.',
    userMessage: '测试事件流断开',
    toolProjection: routeProjection,
  });
  const events = handle.events[Symbol.asyncIterator]();
  await runtime.endEventStream();
  const terminal = await nextEvent(events);
  assert.equal(terminal.type, 'turn.failed');
  if (terminal.type === 'turn.failed') assert.equal(terminal.code, 'OPENCODE_EVENT_STREAM_FAILED');
  assert.equal(runtime.abortRequests, 1, 'SSE 异常必须先停止远端推理');
  await assert.rejects(() => adapter.startTurn({
    engineSession: session,
    defSessionId: asDefSessionId('def-session-stream'),
    defTurnId: asDefTurnId('def-turn-stream-stale'),
    clientTurnId: asClientTurnId('client-turn-stream-stale'),
    providerProfileRef: 'default',
    systemContext: 'No stale restart.',
    userMessage: '不应直接恢复',
    toolProjection: routeProjection,
  }), /detached/u);
  assert.deepEqual(await adapter.recoverSession(session), { status: 'recovered', ref: session });
  assert.equal(runtime.abortRequests, 2, '恢复前必须再次幂等停止远端推理');
  assert.equal(runtime.statusRequests, 1, '恢复前必须确认 Session 已 idle');
  await adapter.shutdown();
}

async function testAdapterRejectsOversizedMultilineSseFrame(): Promise<void> {
  const runtime = new FakeOpenCodeRuntimeController();
  const adapter = new OpenCodeEngineAdapter({
    runtimeRoot: '/unused',
    storeRoot: '/unused',
    profileSource: new InMemoryOpenCodeProviderProfileSource([profile]),
    bridge: new OpenCodePrivateBridge({ token: 'sse-size-token-abcdefghijklmnopqrstuvwxyz' }),
    runtimeSupervisor: runtime,
  });
  const session = await adapter.createSession({
    defSessionId: asDefSessionId('def-session-sse-size'),
    providerProfileRef: 'default',
  });
  const handle = await adapter.startTurn({
    engineSession: session,
    defSessionId: asDefSessionId('def-session-sse-size'),
    defTurnId: asDefTurnId('def-turn-sse-size'),
    clientTurnId: asClientTurnId('client-turn-sse-size'),
    providerProfileRef: 'default',
    systemContext: 'SSE frame limit contract.',
    userMessage: '测试多行大帧',
    toolProjection: routeProjection,
  });
  const events = handle.events[Symbol.asyncIterator]();
  await runtime.emitOversizedMultilineFrame();
  const terminal = await nextEvent(events);
  assert.equal(terminal.type, 'turn.failed');
  if (terminal.type === 'turn.failed') assert.equal(terminal.code, 'OPENCODE_EVENT_STREAM_FAILED');
  await adapter.shutdown();
}

class FakeOpenCodeRuntimeController implements OpenCodeRuntimeController {
  readonly #stream = new TransformStream<Uint8Array, Uint8Array>();
  readonly #writer = this.#stream.writable.getWriter();
  readonly #encoder = new TextEncoder();
  running: RunningOpenCodeRuntime;
  abortRequests = 0;
  statusRequests = 0;
  #exitHandler: (error: OpenCodeEngineError) => void = () => {};

  constructor() {
    const verified: VerifiedOpenCodeRuntime = {
      root: '/fixture',
      binaryPath: '/fixture/opencode',
      pluginPath: '/fixture/plugin.mjs',
      licensePath: '/fixture/LICENSE',
      manifest: {
        schemaVersion: 1,
        name: 'def-opencode-engine-runtime',
        engineKind: 'opencode',
        upstreamVersion: OPENCODE_UPSTREAM_VERSION,
        runtimeVersion: OPENCODE_RUNTIME_VERSION,
        storeSchemaVersion: 1,
        target: runtimeTarget(),
        sourceRef: OPENCODE_SOURCE_REF,
        binary: 'opencode',
        binaryVersion: OPENCODE_BINARY_VERSION,
        binaryCodeBytes: 1,
        binaryCodeSha256: '0'.repeat(64),
        plugin: 'plugin.mjs',
        pluginSha256: '1'.repeat(64),
        license: 'LICENSE',
        licenseBytes: 128,
        licenseSha256: '2'.repeat(64),
      },
    };
    this.running = {
      epoch: 1,
      origin: 'http://127.0.0.1:1',
      authorization: 'Basic fixture',
      directory: '/fixture/workspace',
      profileRef: 'default',
      verified,
      request: (pathname, init) => this.request(pathname, init),
    };
  }

  async probe(_profileRef: string): Promise<EngineHealth> {
    return { status: 'ready', kind: 'opencode', runtimeVersion: 'fixture-def.1' };
  }

  async start(_profileRef: string): Promise<RunningOpenCodeRuntime> {
    return this.running;
  }

  async shutdown(): Promise<void> {
    await this.#writer.close().catch(() => undefined);
  }

  setExitHandler(handler: (error: OpenCodeEngineError) => void): void {
    this.#exitHandler = handler;
  }

  crash(): void {
    const previous = this.running;
    this.running = { ...previous, epoch: previous.epoch + 1 };
    this.#exitHandler(new OpenCodeEngineError('OPENCODE_PROCESS_EXITED', 'fixture runtime crashed'));
  }

  emit(value: unknown): void {
    void this.#writer.write(this.#encoder.encode(`data: ${JSON.stringify(value)}\n\n`)).catch(() => undefined);
  }

  async endEventStream(): Promise<void> {
    await this.#writer.close();
  }

  async emitOversizedMultilineFrame(): Promise<void> {
    const line = this.#encoder.encode(`data: ${'x'.repeat(1_024)}\n`);
    for (let index = 0; index < 4_100; index += 1) {
      try {
        await this.#writer.write(line);
      } catch {
        return;
      }
    }
  }

  async request(pathname: string, _init?: RequestInit): Promise<Response> {
    if (pathname === '/session') return Response.json({ id: 'opencode-session-contract' });
    if (pathname === '/session/opencode-session-contract' && _init?.method !== 'DELETE') {
      return Response.json({ id: 'opencode-session-contract' });
    }
    if (pathname === '/global/event') {
      queueMicrotask(() => this.emit({ payload: { type: 'server.connected', properties: {} } }));
      return new Response(this.#stream.readable, { headers: { 'content-type': 'text/event-stream' } });
    }
    if (pathname.endsWith('/prompt_async')) return new Response(null, { status: 204 });
    if (pathname.endsWith('/abort')) {
      this.abortRequests += 1;
      return Response.json(true);
    }
    if (pathname === '/session/status') {
      this.statusRequests += 1;
      return Response.json({});
    }
    if (_init?.method === 'DELETE') return Response.json(true);
    return new Response(null, { status: 404 });
  }
}

type OpenCodeBridgeStateFixture = {
  readonly engineTurnId: string;
  readonly turnLease: string;
  readonly userMessageId: string;
  readonly systemContext: string;
  readonly projectionRevision: number;
  readonly safeTools: readonly ['def_harness_route'];
  readonly projectedTools: readonly [{
    readonly safeName: 'def_harness_route';
    readonly description: string;
    readonly inputSchema: JsonObject;
    readonly risk: 'read';
  }];
};

function projection(revision: number, name: string): EngineToolProjectionInput {
  return {
    revision,
    tools: [{
      name,
      description: `Fixture ${name}`,
      risk: 'read',
      inputSchema: schemaFor(name),
    }],
  };
}

function schemaFor(name: string): JsonObject {
  if (name === 'def.harness.route') {
    return {
      type: 'object',
      additionalProperties: false,
      required: ['businessId', 'operation'],
      properties: {
        businessId: { enum: ['selection', 'loadout', 'timeline', 'buff', 'calculation'] },
        operation: { enum: ['inspect', 'current', 'resolve', 'calculate'] },
      },
    };
  }
  if (name === 'def.data.resource.buff') {
    return {
      type: 'object',
      additionalProperties: false,
      properties: {
        query: { type: 'string', maxLength: 200 },
        buttonId: { type: 'string', maxLength: 200 },
      },
    };
  }
  return { type: 'object', additionalProperties: false, properties: {} };
}

async function nextEvent(iterator: AsyncIterator<import('../../core/contracts/index.ts').EngineEvent>) {
  const next = await iterator.next();
  assert.equal(next.done, false);
  if (next.done) throw new Error('Engine event stream ended early');
  return next.value;
}

function runtimeTarget(): string {
  return `${process.platform === 'win32' ? 'win32' : process.platform}-${process.arch}`;
}

function sha256(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

async function inspectFixtureCode(binaryPath: string, root: string): Promise<Uint8Array> {
  if (process.platform !== 'darwin') return readFile(binaryPath);
  const unsignedPath = join(root, 'unsigned-fixture');
  await copyFile(binaryPath, unsignedPath);
  const removed = spawnSync('/usr/bin/codesign', ['--remove-signature', unsignedPath]);
  assert.equal(removed.status, 0, 'fixture signature normalization failed');
  return readFile(unsignedPath);
}

function cryptoToken(): string {
  return createHash('sha256').update(String(Math.random())).digest('base64url');
}

try {
  await testProfiles(temporary);
  await testRuntimeManifest(temporary);
  await testSupervisorDoesNotReplaceUnstoppableChild(temporary);
  await testPrivateBridge();
  await testAdapterAtomicProjection();
  await testAdapterAbortWithPendingTool();
  await testAdapterProcessCrashAndProviderRedaction();
  await testAdapterStreamQuarantineAndRecovery();
  await testAdapterRejectsOversizedMultilineSseFrame();
} finally {
  await rm(temporary, { recursive: true, force: true });
}

console.log('OpenCode Engine contract tests passed.');
