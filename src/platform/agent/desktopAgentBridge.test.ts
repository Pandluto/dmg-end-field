import assert from 'node:assert/strict';
import {
  AGENT_LAUNCH_GRANT_FRAGMENT_KEY,
  AGENT_UI_CAPABILITY_STORAGE_KEY,
} from '../../../agent/core/contracts/browser-protocol.ts';
import {
  asDatabaseGeneration,
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

  const state = await bridge.initialize();
  assert.equal(state.authorization, 'authorized');
  assert.equal(state.host, 'ready');
  assert.equal(storage.getItem(AGENT_UI_CAPABILITY_STORAGE_KEY), 'ui-capability-12345678901234567890');
  assert.equal(history.lastUrl, '/#/timeline/ai');
  assert.equal(calls.some((call) => call.init?.body?.toString().includes('launch-grant')), true);
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
