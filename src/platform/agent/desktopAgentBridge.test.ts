import assert from 'node:assert/strict';
import {
  AGENT_LAUNCH_GRANT_FRAGMENT_KEY,
  AGENT_UI_CAPABILITY_HEADER,
  AGENT_UI_CAPABILITY_STORAGE_KEY,
} from '../../../agent/core/contracts/browser-protocol.ts';
import {
  asClientTurnId,
  asDatabaseGeneration,
  asDefSessionId,
  asDefTurnId,
  asTimelineId,
  asWorkspaceId,
} from '../../../agent/core/contracts/ids.ts';
import {
  createDesktopAgentBridge,
  createDesktopAgentConsumerController,
  DesktopAgentBridgeError,
  type AgentBridgeFetchResponse,
  type AgentBridgeHistory,
  type AgentBridgeStorage,
  type AgentConsumerControllerDocument,
  type AgentWorkspaceLease,
} from './desktopAgentBridge';

class MemoryStorage implements AgentBridgeStorage {
  readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) || null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

function makeLocation(raw: string) {
  const url = new URL(raw);
  return {
    get href() { return url.href; },
    get pathname() { return url.pathname; },
    get search() { return url.search; },
    get hash() { return url.hash; },
    replace(rawUrl: string) {
      const next = new URL(rawUrl, url.origin);
      url.href = next.href;
    },
  };
}

function makeHistory(location: ReturnType<typeof makeLocation>): AgentBridgeHistory & { lastUrl: string | null } {
  return {
    state: null,
    lastUrl: null,
    replaceState(_state, _unused, nextUrl) {
      this.lastUrl = String(nextUrl || '');
      location.replace(this.lastUrl);
    },
  };
}

function response(payload: unknown, status = 200): AgentBridgeFetchResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return payload; },
  };
}

function settleAsyncWork(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function binding() {
  return {
    workspaceId: asWorkspaceId('workspace-test'),
    databaseGeneration: asDatabaseGeneration('generation-test'),
    timelineId: asTimelineId('timeline-test'),
    checkoutTargetId: null,
    checkoutUpdatedAt: 10,
    contentRevision: 2,
    snapshotDigest: 'sha256:test-snapshot',
  };
}

const EVENT_TEST_SESSION_ID = asDefSessionId('def-session-product');

function productSession() {
  return {
    schemaVersion: 6,
    eventSchemaVersion: 1,
    defSessionId: EVENT_TEST_SESSION_ID,
    host: 'workbench' as const,
    status: 'ready' as const,
    workspaceId: asWorkspaceId('workspace-test'),
    lastDatabaseGeneration: asDatabaseGeneration('generation-test'),
    timelineId: asTimelineId('timeline-test'),
    axisBindingId: null,
    boundNodeId: null,
    engine: { kind: 'engine-adapter', runtimeVersion: '1.0.0' },
    harness: { stateVersion: 1, revision: 'harness-test' },
    createdAt: '2026-08-07T00:00:00.000Z',
    updatedAt: '2026-08-07T00:00:00.000Z',
  };
}

function bridgeForEventPage(page: unknown) {
  const location = makeLocation('http://127.0.0.1:31457/#/timeline/ai');
  const storage = new MemoryStorage();
  storage.setItem(AGENT_UI_CAPABILITY_STORAGE_KEY, 'ui-capability-12345678901234567890');
  const session = productSession();
  const bridge = createDesktopAgentBridge({
    location,
    sessionStorage: storage,
    fetch: async () => response(page),
  });
  return { bridge, session };
}

class FakeDocument implements AgentConsumerControllerDocument {
  visibilityState: 'visible' | 'hidden' = 'visible';
  readonly listeners = new Map<string, Set<() => void>>();

  addEventListener(type: 'visibilitychange' | 'pagehide' | 'beforeunload', listener: () => void): void {
    const listeners = this.listeners.get(type) || new Set<() => void>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: 'visibilitychange' | 'pagehide' | 'beforeunload', listener: () => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  emit(type: 'visibilitychange' | 'pagehide' | 'beforeunload'): void {
    for (const listener of this.listeners.get(type) || []) listener();
  }
}

class FakeLease implements AgentWorkspaceLease {
  role: 'writer' | 'reader' = 'writer';
  readonly listeners = new Set<(role: 'writer' | 'reader') => void>();

  getRole(): 'writer' | 'reader' {
    return this.role;
  }

  subscribe(listener: (role: 'writer' | 'reader') => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

{
  const location = makeLocation(
    `http://127.0.0.1:31457/#/timeline/ai?${AGENT_LAUNCH_GRANT_FRAGMENT_KEY}=launch-grant-12345678901234567890&keep=1`,
  );
  const history = makeHistory(location);
  const storage = new MemoryStorage();
  const bridge = createDesktopAgentBridge({ location, history, sessionStorage: storage });

  assert.equal(bridge.isAgentModeRoute(), true);
  assert.equal(bridge.captureLaunchGrant(), 'launch-grant-12345678901234567890');
  assert.equal(history.lastUrl, '/#/timeline/ai?keep=1');
  assert.equal(location.hash, '#/timeline/ai?keep=1');
  assert.equal(storage.getItem(AGENT_UI_CAPABILITY_STORAGE_KEY), null);
  assert.equal(bridge.captureLaunchGrant(), null);
}

{
  const location = makeLocation('http://127.0.0.1:31457/#/timeline/ai?__agent_launch_grant=short');
  const history = makeHistory(location);
  const storage = new MemoryStorage();
  const bridge = createDesktopAgentBridge({ location, history, sessionStorage: storage });

  assert.equal(bridge.captureLaunchGrant(), null);
  assert.equal(history.lastUrl, '/#/timeline/ai');
  assert.equal(storage.getItem(AGENT_UI_CAPABILITY_STORAGE_KEY), null);
}

{
  const location = makeLocation(
    `http://127.0.0.1:31457/?${AGENT_LAUNCH_GRANT_FRAGMENT_KEY}=launch-grant-12345678901234567890#/timeline/ai`,
  );
  const history = makeHistory(location);
  const bridge = createDesktopAgentBridge({ location, history, sessionStorage: new MemoryStorage() });

  assert.equal(bridge.captureLaunchGrant(), null, 'launch grants in the query string must never be accepted');
  assert.equal(history.lastUrl, '/#/timeline/ai');
}

{
  const location = makeLocation(
    `http://127.0.0.1:31457/#/timeline/ai?${AGENT_LAUNCH_GRANT_FRAGMENT_KEY}=launch-grant-12345678901234567890`,
  );
  const history = makeHistory(location);
  const storage = new MemoryStorage();
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const bridge = createDesktopAgentBridge({
    location,
    history,
    sessionStorage: storage,
    now: () => 1_000,
    fetch: async (url, init) => {
      calls.push({ url, init });
      if (url.endsWith('/health')) {
        return response({
          service: 'def-agent-host',
          protocolVersion: 2,
          runtimeSchemaVersion: 1,
          state: 'ready',
          engine: { kind: 'opencode-placeholder', state: 'pending', reason: 'engine not attached' },
        });
      }
      if (url.endsWith('/ui/session')) {
        return response({
          ok: true,
          protocolVersion: 2,
          capability: 'ui-capability-12345678901234567890',
          audience: 'workbench-ai-mode',
          expiresAt: 10_000,
        });
      }
      return response({
        protocolVersion: 2,
        engine: { kind: 'opencode-placeholder', state: 'pending', reason: 'engine not attached' },
        consumer: null,
        activeDefSessionId: null,
        activeDefTurnId: null,
      });
    },
  });

  const firstInitialize = bridge.initialize();
  const strictModeInitialize = bridge.initialize();
  assert.equal(strictModeInitialize, firstInitialize, 'concurrent StrictMode initialization must share one grant exchange');
  const [state, strictModeState] = await Promise.all([firstInitialize, strictModeInitialize]);
  assert.equal(state.authorization, 'authorized');
  assert.equal(strictModeState.authorization, 'authorized');
  assert.equal(state.host, 'ready');
  assert.equal(storage.getItem(AGENT_UI_CAPABILITY_STORAGE_KEY), 'ui-capability-12345678901234567890');
  assert.equal(history.lastUrl, '/#/timeline/ai');
  assert.equal(calls.some((call) => call.init?.body?.toString().includes('launch-grant')), true);
  assert.equal(calls.filter((call) => call.url.endsWith('/ui/session')).length, 1);
  assert.equal(storage.values.size, 1);
  assert.equal(storage.values.has('dmg.desktop.agent-launch-grant.v1'), false);
  await assert.rejects(
    bridge.exchangeLaunchGrant('launch-grant-12345678901234567890'),
    (error: unknown) => error instanceof DesktopAgentBridgeError && error.code === 'AGENT_LAUNCH_GRANT_CONSUMED',
  );
}

{
  const location = makeLocation(
    `http://127.0.0.1:31457/#/timeline?${AGENT_LAUNCH_GRANT_FRAGMENT_KEY}=launch-grant-12345678901234567890`,
  );
  const storage = new MemoryStorage();
  let fetchCount = 0;
  const bridge = createDesktopAgentBridge({
    location,
    sessionStorage: storage,
    fetch: async () => {
      fetchCount += 1;
      return response({ ok: true });
    },
  });

  const state = await bridge.initialize();
  assert.equal(state.authorization, 'missing');
  assert.equal(fetchCount, 0);
  assert.equal(storage.values.size, 0);
}

{
  const location = makeLocation('http://127.0.0.1:31457/#/timeline/ai');
  const history = makeHistory(location);
  const storage = new MemoryStorage();
  storage.setItem(AGENT_UI_CAPABILITY_STORAGE_KEY, 'ui-capability-12345678901234567890');
  const document = new FakeDocument();
  const lease = new FakeLease();
  let nextTimer = 1;
  let heartbeat: (() => void) | null = null;
  const calls: string[] = [];
  const bridge = createDesktopAgentBridge({
    location,
    history,
    sessionStorage: storage,
    fetch: async (url) => {
      calls.push(url);
      if (url.endsWith('/workbench/register')) {
        return response({
          consumer: {
            consumerId: 'consumer-test',
            executorLeaseId: 'executor-test',
            binding: binding(),
            registeredAt: 1,
            heartbeatExpiresAt: 20_000,
          },
        });
      }
      if (url.endsWith('/workbench/heartbeat')) {
        return response({
          consumer: {
            consumerId: 'consumer-test',
            executorLeaseId: 'executor-test',
            binding: binding(),
            registeredAt: 1,
            heartbeatExpiresAt: 30_000,
          },
        });
      }
      return response({ ok: true });
    },
  });
  const controller = createDesktopAgentConsumerController({
    bridge,
    workspaceLease: lease,
    document,
    getBinding: binding,
    consumerId: 'consumer-test',
    executorLeaseId: 'executor-test',
    heartbeatIntervalMs: 15_000,
    setInterval: (handler) => {
      heartbeat = handler;
      return nextTimer++;
    },
    clearInterval: () => undefined,
  });

  await controller.start();
  assert.equal(controller.getState().state, 'registered');
  assert.equal(calls.filter((url) => url.endsWith('/workbench/register')).length, 1);
  heartbeat?.();
  await Promise.resolve();
  assert.equal(calls.filter((url) => url.endsWith('/workbench/heartbeat')).length, 1);

  document.visibilityState = 'hidden';
  document.emit('visibilitychange');
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(calls.filter((url) => url.endsWith('/workbench/close')).length, 1);
  assert.equal(controller.getState().state, 'blocked');

  await controller.stop();
}

// A new checkout/revision must update the active consumer immediately instead of
// waiting for the periodic heartbeat before a Product Turn can use the snapshot.
{
  const location = makeLocation('http://127.0.0.1:31457/#/timeline/ai');
  const storage = new MemoryStorage();
  storage.setItem(AGENT_UI_CAPABILITY_STORAGE_KEY, 'ui-capability-12345678901234567890');
  const document = new FakeDocument();
  const lease = new FakeLease();
  let currentBinding: ReturnType<typeof binding> | null = binding();
  let closeCount = 0;
  const heartbeatBindings: ReturnType<typeof binding>[] = [];
  const bridge = createDesktopAgentBridge({
    location,
    sessionStorage: storage,
    fetch: async (url, init) => {
      if (url.endsWith('/workbench/register')) {
        return response({
          consumer: {
            consumerId: 'consumer-binding-refresh',
            executorLeaseId: 'executor-binding-refresh',
            binding: currentBinding,
            registeredAt: 1,
            heartbeatExpiresAt: 20_000,
          },
        });
      }
      if (url.endsWith('/workbench/heartbeat')) {
        const body = JSON.parse(String(init?.body)) as { binding: ReturnType<typeof binding> };
        heartbeatBindings.push(body.binding);
        return response({
          consumer: {
            consumerId: 'consumer-binding-refresh',
            executorLeaseId: 'executor-binding-refresh',
            binding: body.binding,
            registeredAt: 1,
            heartbeatExpiresAt: 30_000,
          },
        });
      }
      if (url.endsWith('/workbench/close')) closeCount += 1;
      return response({ ok: true });
    },
  });
  const controller = createDesktopAgentConsumerController({
    bridge,
    workspaceLease: lease,
    document,
    getBinding: () => currentBinding,
    consumerId: 'consumer-binding-refresh',
    executorLeaseId: 'executor-binding-refresh',
    setInterval: () => 1,
    clearInterval: () => undefined,
  });

  await controller.start();
  currentBinding = {
    ...currentBinding,
    checkoutTargetId: 'node-updated',
    checkoutUpdatedAt: 11,
    contentRevision: 3,
    snapshotDigest: 'sha256:updated-snapshot',
  };
  await controller.refreshEligibility();
  assert.deepEqual(heartbeatBindings, [currentBinding]);
  assert.deepEqual(controller.getState().consumer?.binding, currentBinding);
  currentBinding = null;
  await controller.refreshEligibility();
  assert.equal(closeCount, 1, 'a missing authoritative binding must close the active consumer');
  assert.equal(controller.getState().consumer, null);
  assert.equal(controller.getState().state, 'blocked');
  await controller.stop();
}

// Product Session/Turn/Event calls use only the scoped Product protocol.
{
  const location = makeLocation('http://127.0.0.1:31457/#/timeline/ai');
  const storage = new MemoryStorage();
  storage.setItem(AGENT_UI_CAPABILITY_STORAGE_KEY, 'ui-capability-12345678901234567890');
  const calls: Array<{ url: URL; init?: RequestInit }> = [];
  const session = productSession();
  const defTurnId = asDefTurnId('def-turn-product');
  const clientTurnId = asClientTurnId('client-turn-product');
  const bridge = createDesktopAgentBridge({
    location,
    sessionStorage: storage,
    fetch: async (rawUrl, init) => {
      const url = new URL(rawUrl);
      calls.push({ url, init });
      if (url.pathname === '/agent-host/sessions' && (init?.method || 'GET') === 'GET') {
        return response({ protocolVersion: 2, sessions: [session] });
      }
      if (url.pathname === '/agent-host/sessions' && init?.method === 'POST') {
        return response({ protocolVersion: 2, session }, 201);
      }
      if (url.pathname === `/agent-host/sessions/${session.defSessionId}`) {
        return response({ protocolVersion: 2, session });
      }
      if (url.pathname.endsWith('/events')) {
        return response({
          protocolVersion: 2,
          defSessionId: session.defSessionId,
          afterSequence: 0,
          nextSequence: 1,
          hasMore: false,
          events: [{
            schemaVersion: 1,
            sequence: 1,
            occurredAt: '2026-08-07T00:00:01.000Z',
            defSessionId: session.defSessionId,
            defTurnId,
            type: 'turn.accepted',
            payload: { clientTurnId, userMessage: '检查当前工作区' },
          }],
        });
      }
      if (url.pathname.endsWith('/turns')) {
        return response({
          protocolVersion: 2,
          defSessionId: session.defSessionId,
          defTurnId,
          clientTurnId,
        }, 202);
      }
      if (url.pathname === `/agent-host/turns/${defTurnId}/abort`) {
        return response({ protocolVersion: 2, defTurnId, stopped: true });
      }
      return response({ error: { message: 'unexpected request' } }, 404);
    },
  });

  assert.equal((await bridge.listSessions())[0].defSessionId, session.defSessionId);
  assert.equal((await bridge.createSession({ providerProfileRef: 'default' })).defSessionId, session.defSessionId);
  assert.equal((await bridge.getSession(session.defSessionId)).engine.runtimeVersion, '1.0.0');
  assert.equal((await bridge.readSessionEvents(session.defSessionId)).events[0].type, 'turn.accepted');
  assert.equal((await bridge.startTurn(session.defSessionId, {
    clientTurnId,
    userMessage: '检查当前工作区',
  })).defTurnId, defTurnId);
  assert.equal((await bridge.abortTurn(defTurnId)).stopped, true);

  const createCall = calls.find((call) => (
    call.url.pathname === '/agent-host/sessions' && call.init?.method === 'POST'
  ));
  assert.deepEqual(JSON.parse(String(createCall?.init?.body)), { providerProfileRef: 'default' });
  const turnCall = calls.find((call) => call.url.pathname.endsWith('/turns'));
  assert.deepEqual(JSON.parse(String(turnCall?.init?.body)), {
    clientTurnId,
    userMessage: '检查当前工作区',
  });
  assert.equal(calls.every((call) => {
    const body = String(call.init?.body || '');
    return !body.includes('workspaceId') && !body.includes('databaseGeneration') && !body.includes('engine');
  }), true, 'the browser must not submit ProductBinding or engine-private fields');
  assert.equal(calls.every((call) => (
    (call.init?.headers as Record<string, string>)[AGENT_UI_CAPABILITY_HEADER]
      === 'ui-capability-12345678901234567890'
  )), true);
}

// A Turn response must echo the request clientTurnId exactly.
{
  const location = makeLocation('http://127.0.0.1:31457/#/timeline/ai');
  const storage = new MemoryStorage();
  storage.setItem(AGENT_UI_CAPABILITY_STORAGE_KEY, 'ui-capability-12345678901234567890');
  const session = productSession();
  const requestedClientTurnId = asClientTurnId('client-turn-requested');
  const bridge = createDesktopAgentBridge({
    location,
    sessionStorage: storage,
    fetch: async () => response({
      protocolVersion: 2,
      defSessionId: session.defSessionId,
      defTurnId: asDefTurnId('def-turn-mismatched-client'),
      clientTurnId: asClientTurnId('client-turn-wrong'),
    }, 202),
  });
  await assert.rejects(
    bridge.startTurn(session.defSessionId, {
      clientTurnId: requestedClientTurnId,
      userMessage: '严格核对请求身份',
    }),
    (error: unknown) => error instanceof DesktopAgentBridgeError && error.code === 'INVALID_HOST_RESPONSE',
  );
}

// Engine-private identities in a Product response fail closed.
{
  const location = makeLocation('http://127.0.0.1:31457/#/timeline/ai');
  const storage = new MemoryStorage();
  storage.setItem(AGENT_UI_CAPABILITY_STORAGE_KEY, 'ui-capability-12345678901234567890');
  const session = productSession();
  const bridge = createDesktopAgentBridge({
    location,
    sessionStorage: storage,
    fetch: async () => response({
      protocolVersion: 2,
      session: {
        ...session,
        engine: { ...session.engine, sessionId: 'private-engine-session' },
      },
    }),
  });
  await assert.rejects(
    bridge.getSession(session.defSessionId),
    (error: unknown) => error instanceof DesktopAgentBridgeError && error.code === 'INVALID_HOST_RESPONSE',
  );
}

// A page that claims more events must advance its cursor.
{
  const { bridge, session } = bridgeForEventPage({
    protocolVersion: 2,
    defSessionId: EVENT_TEST_SESSION_ID,
    afterSequence: 0,
    nextSequence: 0,
    hasMore: true,
    events: [],
  });
  await assert.rejects(
    bridge.readSessionEvents(session.defSessionId),
    (error: unknown) => error instanceof DesktopAgentBridgeError && error.code === 'INVALID_HOST_RESPONSE',
  );
}

// Event diagnostics cannot smuggle Engine identities into the Product UI.
{
  const location = makeLocation('http://127.0.0.1:31457/#/timeline/ai');
  const storage = new MemoryStorage();
  storage.setItem(AGENT_UI_CAPABILITY_STORAGE_KEY, 'ui-capability-12345678901234567890');
  const session = productSession();
  const bridge = createDesktopAgentBridge({
    location,
    sessionStorage: storage,
    fetch: async () => response({
      protocolVersion: 2,
      defSessionId: session.defSessionId,
      afterSequence: 0,
      nextSequence: 1,
      hasMore: false,
      events: [{
        schemaVersion: 1,
        sequence: 1,
        occurredAt: '2026-08-07T00:00:01.000Z',
        defSessionId: session.defSessionId,
        defTurnId: 'def-turn-private-diagnostics',
        type: 'response.delta',
        payload: { delta: 'unsafe' },
        diagnostics: { engineSessionId: 'private-engine-session' },
      }],
    }),
  });
  await assert.rejects(
    bridge.readSessionEvents(session.defSessionId),
    (error: unknown) => error instanceof DesktopAgentBridgeError && error.code === 'INVALID_HOST_RESPONSE',
  );
}

// Event pages reject sequence gaps instead of accepting merely increasing cursors.
{
  const { bridge, session } = bridgeForEventPage({
    protocolVersion: 2,
    defSessionId: EVENT_TEST_SESSION_ID,
    afterSequence: 0,
    nextSequence: 3,
    hasMore: false,
    events: [
      {
        schemaVersion: 1,
        sequence: 1,
        occurredAt: '2026-08-07T00:00:01.000Z',
        defSessionId: EVENT_TEST_SESSION_ID,
        defTurnId: 'def-turn-sequence-gap',
        type: 'response.delta',
        payload: { delta: 'first' },
      },
      {
        schemaVersion: 1,
        sequence: 3,
        occurredAt: '2026-08-07T00:00:03.000Z',
        defSessionId: EVENT_TEST_SESSION_ID,
        defTurnId: 'def-turn-sequence-gap',
        type: 'response.delta',
        payload: { delta: 'third' },
      },
    ],
  });
  await assert.rejects(
    bridge.readSessionEvents(session.defSessionId),
    (error: unknown) => error instanceof DesktopAgentBridgeError && error.code === 'INVALID_HOST_RESPONSE',
  );
}

// Event envelopes reject private top-level fields.
{
  const { bridge, session } = bridgeForEventPage({
    protocolVersion: 2,
    defSessionId: EVENT_TEST_SESSION_ID,
    afterSequence: 0,
    nextSequence: 1,
    hasMore: false,
    events: [{
      schemaVersion: 1,
      sequence: 1,
      occurredAt: '2026-08-07T00:00:01.000Z',
      defSessionId: EVENT_TEST_SESSION_ID,
      defTurnId: 'def-turn-private-top-level',
      type: 'turn.accepted',
      payload: { clientTurnId: 'client-turn-private-top-level', userMessage: 'safe' },
      privateTopLevelField: 'must be rejected',
    }],
  });
  await assert.rejects(
    bridge.readSessionEvents(session.defSessionId),
    (error: unknown) => error instanceof DesktopAgentBridgeError && error.code === 'INVALID_HOST_RESPONSE',
  );
}

// Event payloads reject private fields even when the declared fields are valid.
{
  const { bridge, session } = bridgeForEventPage({
    protocolVersion: 2,
    defSessionId: EVENT_TEST_SESSION_ID,
    afterSequence: 0,
    nextSequence: 1,
    hasMore: false,
    events: [{
      schemaVersion: 1,
      sequence: 1,
      occurredAt: '2026-08-07T00:00:01.000Z',
      defSessionId: EVENT_TEST_SESSION_ID,
      defTurnId: 'def-turn-private-payload',
      type: 'response.delta',
      payload: { delta: 'safe', privatePayloadField: 'must be rejected' },
    }],
  });
  await assert.rejects(
    bridge.readSessionEvents(session.defSessionId),
    (error: unknown) => error instanceof DesktopAgentBridgeError && error.code === 'INVALID_HOST_RESPONSE',
  );
}

// Contract-declared optional correlation and payload fields remain accepted.
{
  const { bridge, session } = bridgeForEventPage({
    protocolVersion: 2,
    defSessionId: EVENT_TEST_SESSION_ID,
    afterSequence: 0,
    nextSequence: 3,
    hasMore: false,
    events: [
      {
        schemaVersion: 1,
        sequence: 1,
        occurredAt: '2026-08-07T00:00:01.000Z',
        defSessionId: EVENT_TEST_SESSION_ID,
        defTurnId: 'def-turn-optional-fields',
        interactionId: 'interaction-optional-fields',
        toolCallId: 'tool-optional-fields',
        type: 'interaction.requested',
        payload: {
          kind: 'question',
          prompt: '继续吗？',
          expiresAt: '2026-08-07T00:15:01.000Z',
        },
      },
      {
        schemaVersion: 1,
        sequence: 2,
        occurredAt: '2026-08-07T00:00:02.000Z',
        defSessionId: EVENT_TEST_SESSION_ID,
        defTurnId: 'def-turn-optional-fields',
        interactionId: 'interaction-optional-fields',
        type: 'interaction.resolved',
        payload: { status: 'answered', value: { answer: 'yes' } },
      },
      {
        schemaVersion: 1,
        sequence: 3,
        occurredAt: '2026-08-07T00:00:03.000Z',
        defSessionId: EVENT_TEST_SESSION_ID,
        defTurnId: 'def-turn-optional-fields',
        toolCallId: 'tool-optional-fields',
        type: 'tool.error',
        payload: {
          code: 'TEST_ERROR',
          message: 'expected test error',
          details: { retryable: false },
        },
      },
    ],
  });
  const page = await bridge.readSessionEvents(session.defSessionId);
  assert.equal(page.events.length, 3);
  assert.deepEqual(page.events[1].payload, { status: 'answered', value: { answer: 'yes' } });
}

// Safe Host conflict codes remain typed for the UI without clearing a valid capability.
{
  const location = makeLocation('http://127.0.0.1:31457/#/timeline/ai');
  const storage = new MemoryStorage();
  storage.setItem(AGENT_UI_CAPABILITY_STORAGE_KEY, 'ui-capability-12345678901234567890');
  const bridge = createDesktopAgentBridge({
    location,
    sessionStorage: storage,
    fetch: async () => response({
      error: { code: 'AGENT_CLIENT_TURN_CONFLICT', message: 'client turn conflict' },
    }, 409),
  });
  await assert.rejects(
    bridge.startTurn(asDefSessionId('def-session-conflict'), {
      clientTurnId: asClientTurnId('client-turn-conflict'),
      userMessage: 'conflict',
    }),
    (error: unknown) => (
      error instanceof DesktopAgentBridgeError
      && error.code === 'AGENT_CLIENT_TURN_CONFLICT'
      && error.status === 409
    ),
  );
  assert.equal(storage.getItem(AGENT_UI_CAPABILITY_STORAGE_KEY), 'ui-capability-12345678901234567890');
}

// A rejected capability is removed from this tab immediately.
{
  const location = makeLocation('http://127.0.0.1:31457/#/timeline/ai');
  const storage = new MemoryStorage();
  storage.setItem(AGENT_UI_CAPABILITY_STORAGE_KEY, 'ui-capability-12345678901234567890');
  const bridge = createDesktopAgentBridge({
    location,
    sessionStorage: storage,
    fetch: async () => response({ error: { message: 'capability expired' } }, 403),
  });
  await assert.rejects(
    bridge.listSessions(),
    (error: unknown) => error instanceof DesktopAgentBridgeError && error.code === 'AGENT_UNAUTHORIZED',
  );
  assert.equal(storage.getItem(AGENT_UI_CAPABILITY_STORAGE_KEY), null);
  assert.equal(bridge.getState().authorization, 'missing');
}

// A stale heartbeat after sleep must re-register without a visibility event or reload.
{
  const location = makeLocation('http://127.0.0.1:31457/#/timeline/ai');
  const storage = new MemoryStorage();
  storage.setItem(AGENT_UI_CAPABILITY_STORAGE_KEY, 'ui-capability-12345678901234567890');
  const document = new FakeDocument();
  const lease = new FakeLease();
  let heartbeat: (() => void) | null = null;
  let registerCount = 0;
  let heartbeatCount = 0;
  const bridge = createDesktopAgentBridge({
    location,
    sessionStorage: storage,
    fetch: async (url) => {
      if (url.endsWith('/workbench/register')) {
        registerCount += 1;
        return response({
          consumer: {
            consumerId: 'consumer-recovery',
            executorLeaseId: 'executor-recovery',
            binding: binding(),
            registeredAt: 1,
            heartbeatExpiresAt: 20_000 + registerCount,
          },
        });
      }
      if (url.endsWith('/workbench/heartbeat')) {
        heartbeatCount += 1;
        if (heartbeatCount === 1) {
          return response({ error: { message: 'Browser Workbench consumer is stale' } }, 409);
        }
        return response({
          consumer: {
            consumerId: 'consumer-recovery',
            executorLeaseId: 'executor-recovery',
            binding: binding(),
            registeredAt: 1,
            heartbeatExpiresAt: 30_000,
          },
        });
      }
      return response({ ok: true });
    },
  });
  const controller = createDesktopAgentConsumerController({
    bridge,
    workspaceLease: lease,
    document,
    getBinding: binding,
    consumerId: 'consumer-recovery',
    executorLeaseId: 'executor-recovery',
    heartbeatIntervalMs: 15_000,
    setInterval: (handler) => {
      heartbeat = handler;
      return handler;
    },
    clearInterval: () => undefined,
  });

  await controller.start();
  assert.equal(registerCount, 1);
  heartbeat?.();
  await settleAsyncWork();
  assert.equal(heartbeatCount, 1);
  assert.equal(registerCount, 2, 'stale heartbeat must trigger an automatic re-registration');
  assert.equal(controller.getState().state, 'registered');
  assert.equal(controller.getState().error, null);

  heartbeat?.();
  await settleAsyncWork();
  assert.equal(heartbeatCount, 2, 'heartbeat scheduling must continue after recovery');
  assert.equal(controller.getState().state, 'registered');
  await controller.stop();
}

{
  const location = makeLocation('http://127.0.0.1:31457/#/timeline/ai');
  const storage = new MemoryStorage();
  storage.setItem(AGENT_UI_CAPABILITY_STORAGE_KEY, 'ui-capability-12345678901234567890');
  const document = new FakeDocument();
  const lease = new FakeLease();
  const calls: string[] = [];
  let releaseRegister!: () => void;
  const registerGate = new Promise<void>((resolve) => { releaseRegister = resolve; });
  const bridge = createDesktopAgentBridge({
    location,
    sessionStorage: storage,
    fetch: async (url) => {
      calls.push(url);
      if (url.endsWith('/workbench/register')) {
        await registerGate;
        return response({
          consumer: {
            consumerId: 'consumer-concurrent',
            executorLeaseId: 'executor-concurrent',
            binding: binding(),
            registeredAt: 1,
            heartbeatExpiresAt: 20_000,
          },
        });
      }
      return response({ ok: true });
    },
  });
  const controller = createDesktopAgentConsumerController({
    bridge,
    workspaceLease: lease,
    document,
    getBinding: binding,
    consumerId: 'consumer-concurrent',
    executorLeaseId: 'executor-concurrent',
    setInterval: () => 1,
    clearInterval: () => undefined,
  });

  const start = controller.start();
  const firstRefresh = controller.refreshEligibility();
  const secondRefresh = controller.refreshEligibility();
  await Promise.resolve();
  assert.equal(
    calls.filter((url) => url.endsWith('/workbench/register')).length,
    1,
    'concurrent eligibility refreshes must share one registration',
  );
  releaseRegister();
  await Promise.all([start, firstRefresh, secondRefresh]);
  assert.equal(controller.getState().state, 'registered');
  assert.equal(calls.filter((url) => url.endsWith('/workbench/register')).length, 1);
  assert.equal(
    calls.filter((url) => url.endsWith('/workbench/close')).length,
    0,
    'a stale concurrent register must not close the winning consumer',
  );
  await controller.stop();
}

{
  const location = makeLocation('http://127.0.0.1:31457/#/timeline/ai');
  const storage = new MemoryStorage();
  storage.setItem(AGENT_UI_CAPABILITY_STORAGE_KEY, 'ui-capability-12345678901234567890');
  const document = new FakeDocument();
  document.visibilityState = 'hidden';
  const lease = new FakeLease();
  const calls: string[] = [];
  const bridge = createDesktopAgentBridge({
    location,
    sessionStorage: storage,
    fetch: async (url) => {
      calls.push(url);
      return response({ ok: true });
    },
  });
  const controller = createDesktopAgentConsumerController({
    bridge,
    workspaceLease: lease,
    document,
    getBinding: binding,
    consumerId: 'consumer-hidden',
    executorLeaseId: 'executor-hidden',
  });

  await controller.start();
  assert.equal(controller.getState().state, 'blocked');
  assert.equal(calls.length, 0);
  await controller.stop();
}
