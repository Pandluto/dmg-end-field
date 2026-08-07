import assert from 'node:assert/strict';
import {
  asClientTurnId,
  asCommandId,
  asDatabaseGeneration,
  asDefSessionId,
  asDefTurnId,
  asInteractionId,
  asTimelineId,
  asToolCallId,
  asWorkspaceId,
  type EngineRecoveryResult,
  type EngineSessionRef,
  type Phase2ProductOperationSchema,
  type DefEvent,
  type DefSessionId,
  type ProductBinding,
  type ProductGateway,
} from '../core/contracts/index.ts';
import { DeterministicFakeAgentEngine } from '../core/testing/fake-engine.ts';
import { DefAgentHost } from './def-agent-host.ts';
import { DefAgentHostError } from './errors.ts';
import { MemoryDefAgentSessionStore } from './session-store.ts';

class CountingRecoveryEngine extends DeterministicFakeAgentEngine {
  readonly recoverCalls: string[] = [];
  readonly failRecoveryFor = new Set<string>();

  override async recoverSession(ref: EngineSessionRef): Promise<EngineRecoveryResult> {
    this.recoverCalls.push(ref.sessionId);
    if (this.failRecoveryFor.has(ref.sessionId)) {
      throw new Error(`recovery unavailable for ${ref.sessionId}`);
    }
    return super.recoverSession(ref);
  }
}

class GatedRecoveryEngine extends CountingRecoveryEngine {
  readonly started: Promise<void>;
  #resolveStarted: () => void = () => {};
  readonly #gate: Promise<void>;
  #releaseGate: () => void = () => {};

  constructor() {
    super();
    this.started = new Promise<void>((resolve) => {
      this.#resolveStarted = resolve;
    });
    this.#gate = new Promise<void>((resolve) => {
      this.#releaseGate = resolve;
    });
  }

  release(): void {
    this.#releaseGate();
  }

  override async recoverSession(ref: EngineSessionRef): Promise<EngineRecoveryResult> {
    this.#resolveStarted();
    await this.#gate;
    return super.recoverSession(ref);
  }
}

class FlushCountingMemoryDefAgentSessionStore extends MemoryDefAgentSessionStore {
  flushCalls = 0;

  override flush(defSessionId: DefSessionId): void {
    this.flushCalls += 1;
    super.flush(defSessionId);
  }
}

const binding: ProductBinding = {
  workspaceId: asWorkspaceId('workspace-recovery'),
  databaseGeneration: asDatabaseGeneration('generation-recovery'),
  timelineId: asTimelineId('timeline-recovery'),
  checkoutTargetId: 'node-recovery',
  checkoutUpdatedAt: 1_700_000_000_000,
  contentRevision: 9,
  snapshotDigest: 'sha256:recovery',
};

const unavailableGateway: ProductGateway<Phase2ProductOperationSchema> = {
  async getSnapshot() { throw new Error('not used'); },
  async dispatch() { throw new Error('not used'); },
  async awaitResult() { throw new Error('not used'); },
  async reconcile() { return null; },
};

const engine = new DeterministicFakeAgentEngine();
const defSessionId = asDefSessionId('def-session-recovery');
const defTurnId = asDefTurnId('def-turn-recovery');
const clientTurnId = asClientTurnId('client-turn-recovery');
const interactionId = asInteractionId('interaction-recovery');
const toolCallId = asToolCallId('tool-recovery');
const commandId = asCommandId('command-recovery');
const engineSession = await engine.createSession({
  defSessionId,
  providerProfileRef: 'default',
});
const store = new FlushCountingMemoryDefAgentSessionStore();
store.create({
  session: {
    schemaVersion: 6,
    eventSchemaVersion: 1,
    defSessionId,
    host: 'workbench',
    status: 'ready',
    workspaceId: binding.workspaceId,
    lastDatabaseGeneration: binding.databaseGeneration,
    timelineId: binding.timelineId,
    axisBindingId: null,
    boundNodeId: binding.checkoutTargetId,
    engine: engineSession,
    harness: { stateVersion: 1, revision: 'recovery-contract-v1' },
    createdAt: '2026-08-07T00:00:00.000Z',
    updatedAt: '2026-08-07T00:00:00.000Z',
  },
  binding,
  providerProfileRef: 'default',
  acceptedClientTurns: [],
});
store.append(defSessionId, {
  schemaVersion: 1,
  sequence: 1,
  occurredAt: '2026-08-07T00:00:01.000Z',
  defSessionId,
  type: 'session.ready',
  payload: { engineKind: engineSession.kind, engineRuntimeVersion: engineSession.runtimeVersion },
});
store.append(defSessionId, {
  schemaVersion: 1,
  sequence: 2,
  occurredAt: '2026-08-07T00:00:02.000Z',
  defSessionId,
  defTurnId,
  type: 'turn.accepted',
  payload: { clientTurnId, userMessage: '继续上一次对话' },
});
store.append(defSessionId, {
  schemaVersion: 1,
  sequence: 3,
  occurredAt: '2026-08-07T00:00:03.000Z',
  defSessionId,
  defTurnId,
  interactionId,
  toolCallId,
  type: 'interaction.requested',
  payload: {
    kind: 'approval',
    prompt: '是否执行？',
    expiresAt: '2026-08-07T00:15:03.000Z',
  },
});
store.append(defSessionId, {
  schemaVersion: 1,
  sequence: 4,
  occurredAt: '2026-08-07T00:00:04.000Z',
  defSessionId,
  defTurnId,
  toolCallId,
  commandId,
  interactionId,
  type: 'command.queued',
  payload: {
    workspaceId: binding.workspaceId,
    databaseGeneration: binding.databaseGeneration,
    timelineId: binding.timelineId,
    checkoutTargetId: binding.checkoutTargetId,
    beforeRevision: binding.contentRevision,
    op: 'workbench.execute-command',
    afterRevision: null,
    browserReceiptDigest: null,
  },
});
store.acceptClientTurn(defSessionId, {
  clientTurnId,
  userMessage: '继续上一次对话',
  result: { defTurnId, clientTurnId },
  acceptedAt: '2026-08-07T00:00:02.000Z',
});
store.setActive(defSessionId);

const host = new DefAgentHost({
  engine,
  productGateway: unavailableGateway,
  sessionStore: store,
  requireConsumer: () => undefined,
  clock: () => 1_800_000_000_000,
});

await assert.rejects(
  () => host.createSession({ binding, providerProfileRef: 'default' }),
  (error: unknown) => error instanceof DefAgentHostError
    && error.code === 'AGENT_SESSION_RECOVERY_FAILED',
);
await host.initialize();

assert.equal(host.readSession(defSessionId).status, 'ready');
assert.equal(host.getActiveIds().defSessionId, defSessionId);
const recoveredEvents = host.readEvents(defSessionId, 0, 256);
assert.equal(recoveredEvents.filter((event) => event.type === 'interaction.resolved').length, 1);
assert.equal(
  recoveredEvents.find((event) => event.type === 'interaction.resolved')?.payload.status,
  'stale',
);
const interrupted = recoveredEvents.find((event) => event.type === 'turn.interrupted');
assert.deepEqual(interrupted?.payload.reconcileRequiredCommandIds, [commandId]);
assert.equal((await host.waitForTurnTerminal(defTurnId)).type, 'turn.interrupted');

const recoveredCommand = {
  protocolVersion: 1 as const,
  commandId,
  defSessionId,
  defTurnId,
  toolCallId,
  expected: binding,
  command: {
    op: 'workbench.execute-command' as const,
    payload: { command: { op: 'setSelection', characterNames: ['洛茜'] } },
  },
};
const recoveredResult = {
  commandId,
  status: 'not-executed' as const,
  code: 'AGENT_COMMAND_RECONCILE_NO_RECEIPT',
  message: 'browser journal has no terminal receipt',
  beforeRevision: binding.contentRevision,
  afterRevision: binding.contentRevision,
  completedAt: '2026-08-07T00:00:05.000Z',
};
assert.equal(host.recordReconciledProductCommandResult(recoveredCommand, recoveredResult), true);
assert.equal(host.recordReconciledProductCommandResult(recoveredCommand, recoveredResult), false);
const reconciled = host.readEvents(defSessionId, 0, 256).find((event): event is Extract<DefEvent, {
  type: 'command.reconciled';
}> => (
  event.type === 'command.reconciled' && event.commandId === commandId
));
assert.equal(reconciled?.payload.status, 'not-executed');
assert.equal(reconciled?.payload.afterRevision, binding.contentRevision);
assert.match(reconciled?.payload.browserReceiptDigest ?? '', /^[a-f0-9]{64}$/u);

const replay = await host.startTurn({
  defSessionId,
  clientTurnId,
  userMessage: '继续上一次对话',
  systemContext: 'unused for idempotent retry',
  toolProjection: { revision: 1, tools: [] },
});
assert.deepEqual(replay, { defTurnId, clientTurnId });

const eventCountAfterFirstRecovery = store.loadEvents(defSessionId).length;
await host.initialize();
assert.equal(store.loadEvents(defSessionId).length, eventCountAfterFirstRecovery);

host.archiveSession(defSessionId, binding);
assert.equal(store.loadSession(defSessionId)?.session.status, 'archived');

const restarted = new DefAgentHost({
  engine,
  productGateway: unavailableGateway,
  sessionStore: store,
  requireConsumer: () => undefined,
  clock: () => 1_800_000_001_000,
});
await restarted.initialize();
assert.equal(restarted.readSession(defSessionId).status, 'archived');
await restarted.restoreSession(defSessionId, binding);
assert.equal(store.loadSession(defSessionId)?.session.status, 'ready');
await restarted.deleteSession(defSessionId, binding);
assert.equal(store.load().sessions.length, 0);

const streamedSession = await restarted.createSession({ binding, providerProfileRef: 'default' });
const responseDeltaCount = 65;
engine.enqueueScript([
  ...Array.from({ length: responseDeltaCount }, (_, index) => ({
    type: 'text' as const,
    delta: `stream-${index}`,
  })),
  { type: 'complete' as const },
]);
const flushCallsBeforeStream = store.flushCalls;
const streamedTurn = await restarted.startTurn({
  defSessionId: streamedSession.defSessionId,
  clientTurnId: asClientTurnId('client-turn-streamed'),
  userMessage: '验证流式日志持久化',
  systemContext: 'streaming durability contract',
  toolProjection: { revision: 1, tools: [] },
});
assert.equal((await restarted.waitForTurnTerminal(streamedTurn.defTurnId)).type, 'turn.completed');
const streamedFlushCalls = store.flushCalls - flushCallsBeforeStream;
assert.ok(streamedFlushCalls >= 1, 'streaming output must periodically flush buffered deltas');
assert.ok(
  streamedFlushCalls < responseDeltaCount,
  'streaming response.delta must not flush once per delta',
);
assert.equal(
  restarted.readEvents(streamedSession.defSessionId, 0, 256)
    .filter((event) => event.type === 'response.delta').length,
  responseDeltaCount,
);
await restarted.shutdown();

async function seedStoredSession(
  engine: DeterministicFakeAgentEngine,
  store: MemoryDefAgentSessionStore,
  defSessionId: DefSessionId,
  status: 'ready' | 'archived',
): Promise<EngineSessionRef> {
  const engineSession = await engine.createSession({
    defSessionId,
    providerProfileRef: 'default',
  });
  store.create({
    session: {
      schemaVersion: 6,
      eventSchemaVersion: 1,
      defSessionId,
      host: 'workbench',
      status,
      workspaceId: binding.workspaceId,
      lastDatabaseGeneration: binding.databaseGeneration,
      timelineId: binding.timelineId,
      axisBindingId: null,
      boundNodeId: binding.checkoutTargetId,
      engine: engineSession,
      harness: { stateVersion: 1, revision: 'recovery-contract-v1' },
      createdAt: '2026-08-07T00:00:00.000Z',
      updatedAt: '2026-08-07T00:00:00.000Z',
    },
    binding,
    providerProfileRef: 'default',
    acceptedClientTurns: [],
  });
  store.append(defSessionId, {
    schemaVersion: 1,
    sequence: 1,
    occurredAt: '2026-08-07T00:00:01.000Z',
    defSessionId,
    type: 'session.ready',
    payload: { engineKind: engineSession.kind, engineRuntimeVersion: engineSession.runtimeVersion },
  });
  return engineSession;
}

const lazyEngine = new CountingRecoveryEngine();
const lazyStore = new MemoryDefAgentSessionStore();
const lazyActiveId = asDefSessionId('def-session-lazy-active');
const lazyHistoryId = asDefSessionId('def-session-lazy-history');
const lazyArchivedId = asDefSessionId('def-session-lazy-archived');
const lazyActiveEngineSession = await seedStoredSession(lazyEngine, lazyStore, lazyActiveId, 'ready');
const lazyHistoryEngineSession = await seedStoredSession(lazyEngine, lazyStore, lazyHistoryId, 'ready');
const lazyArchivedEngineSession = await seedStoredSession(lazyEngine, lazyStore, lazyArchivedId, 'archived');
lazyStore.setActive(lazyActiveId);

const lazyHost = new DefAgentHost({
  engine: lazyEngine,
  productGateway: unavailableGateway,
  sessionStore: lazyStore,
  requireConsumer: () => undefined,
});
await lazyHost.initialize();

// Startup only recovers the active Session. Historical and archived Sessions
// must remain untouched until the user actually selects them.
assert.deepEqual(lazyEngine.recoverCalls, [lazyActiveEngineSession.sessionId]);
assert.equal(lazyHost.readSession(lazyHistoryId).status, 'ready');
assert.equal(lazyHost.readSession(lazyArchivedId).status, 'archived');
assert.equal(
  lazyHost.readEvents(lazyArchivedId, 0, 256).filter((event) => event.type === 'session.recovered').length,
  0,
);

// The first real use of a historical Session performs one lazy recovery. A
// later turn uses the recovered ref and does not call Engine recovery again.
lazyEngine.enqueueScript([{ type: 'complete' }, { type: 'complete' }]);
const lazyFirstTurn = await lazyHost.startTurn({
  defSessionId: lazyHistoryId,
  clientTurnId: asClientTurnId('client-turn-lazy-first'),
  userMessage: '首次使用历史会话',
  systemContext: 'lazy recovery contract',
  toolProjection: { revision: 1, tools: [] },
});
assert.equal((await lazyHost.waitForTurnTerminal(lazyFirstTurn.defTurnId)).type, 'turn.completed');
const lazySecondTurn = await lazyHost.startTurn({
  defSessionId: lazyHistoryId,
  clientTurnId: asClientTurnId('client-turn-lazy-second'),
  userMessage: '再次使用历史会话',
  systemContext: 'lazy recovery contract',
  toolProjection: { revision: 1, tools: [] },
});
assert.equal((await lazyHost.waitForTurnTerminal(lazySecondTurn.defTurnId)).type, 'turn.completed');
assert.deepEqual(lazyEngine.recoverCalls, [
  lazyActiveEngineSession.sessionId,
  lazyHistoryEngineSession.sessionId,
]);

// Archived recovery is an explicit restore operation, never an initialization
// side effect.
await lazyHost.restoreSession(lazyArchivedId, binding);
assert.equal(lazyHost.readSession(lazyArchivedId).status, 'ready');
assert.equal(
  lazyHost.readEvents(lazyArchivedId, 0, 256).filter((event) => event.type === 'session.recovered').length,
  1,
);
assert.deepEqual(lazyEngine.recoverCalls, [
  lazyActiveEngineSession.sessionId,
  lazyHistoryEngineSession.sessionId,
  lazyArchivedEngineSession.sessionId,
]);
await lazyHost.shutdown();

const failedRecoveryEngine = new CountingRecoveryEngine();
const failedRecoveryStore = new MemoryDefAgentSessionStore();
const failedRecoveryId = asDefSessionId('def-session-lazy-failed');
const failedRecoveryEngineSession = await seedStoredSession(
  failedRecoveryEngine,
  failedRecoveryStore,
  failedRecoveryId,
  'ready',
);
failedRecoveryEngine.failRecoveryFor.add(failedRecoveryEngineSession.sessionId);
const failedRecoveryHost = new DefAgentHost({
  engine: failedRecoveryEngine,
  productGateway: unavailableGateway,
  sessionStore: failedRecoveryStore,
  requireConsumer: () => undefined,
});
await failedRecoveryHost.initialize();
assert.deepEqual(failedRecoveryEngine.recoverCalls, []);
await assert.rejects(
  () => failedRecoveryHost.startTurn({
    defSessionId: failedRecoveryId,
    clientTurnId: asClientTurnId('client-turn-lazy-failed-1'),
    userMessage: '触发失败恢复',
    systemContext: 'lazy recovery failure contract',
    toolProjection: { revision: 1, tools: [] },
  }),
  (error: unknown) => error instanceof DefAgentHostError
    && error.code === 'AGENT_SESSION_RECOVERY_FAILED',
);
assert.equal(failedRecoveryHost.readSession(failedRecoveryId).status, 'engine-unavailable');
const failedEvent = failedRecoveryHost.readEvents(failedRecoveryId, 0, 256)
  .find((event) => event.type === 'session.orphaned');
assert.equal(failedEvent?.type, 'session.orphaned');
if (failedEvent?.type === 'session.orphaned') {
  assert.equal(failedEvent.payload.code, 'ENGINE_RECOVERY_UNAVAILABLE');
}
failedRecoveryEngine.failRecoveryFor.delete(failedRecoveryEngineSession.sessionId);
failedRecoveryEngine.enqueueScript([{ type: 'complete' }]);
const recoveredAfterFailure = await failedRecoveryHost.startTurn({
  defSessionId: failedRecoveryId,
  clientTurnId: asClientTurnId('client-turn-lazy-failed-2'),
  userMessage: '失败后重试恢复',
  systemContext: 'lazy recovery failure contract',
  toolProjection: { revision: 1, tools: [] },
});
assert.equal((await failedRecoveryHost.waitForTurnTerminal(recoveredAfterFailure.defTurnId)).type, 'turn.completed');
assert.deepEqual(failedRecoveryEngine.recoverCalls, [
  failedRecoveryEngineSession.sessionId,
  failedRecoveryEngineSession.sessionId,
]);
await failedRecoveryHost.shutdown();

const gatedRecoveryEngine = new GatedRecoveryEngine();
const gatedRecoveryStore = new MemoryDefAgentSessionStore();
const gatedRecoveryId = asDefSessionId('def-session-gated-recovery');
await seedStoredSession(gatedRecoveryEngine, gatedRecoveryStore, gatedRecoveryId, 'ready');
const gatedRecoveryHost = new DefAgentHost({
  engine: gatedRecoveryEngine,
  productGateway: unavailableGateway,
  sessionStore: gatedRecoveryStore,
  requireConsumer: () => undefined,
});
await gatedRecoveryHost.initialize();
const gatedTurn = gatedRecoveryHost.startTurn({
  defSessionId: gatedRecoveryId,
  clientTurnId: asClientTurnId('client-turn-gated-recovery'),
  userMessage: '验证关闭期间的恢复竞态',
  systemContext: 'shutdown recovery contract',
  toolProjection: { revision: 1, tools: [] },
});
await gatedRecoveryEngine.started;
await assert.rejects(
  () => gatedRecoveryHost.deleteSession(gatedRecoveryId, binding),
  (error: unknown) => error instanceof DefAgentHostError && error.code === 'AGENT_TURN_BUSY',
);
const gatedShutdown = gatedRecoveryHost.shutdown();
gatedRecoveryEngine.release();
await assert.rejects(gatedTurn);
await gatedShutdown;
assert.equal(
  gatedRecoveryHost.readEvents(gatedRecoveryId, 0, 256)
    .filter((event) => event.type === 'session.recovered').length,
  0,
);

console.log('DEF Agent Host restart recovery contract passed');
