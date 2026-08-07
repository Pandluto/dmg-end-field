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
  type Phase2ProductOperationSchema,
  type DefEvent,
  type ProductBinding,
  type ProductGateway,
} from '../core/contracts/index.ts';
import { DeterministicFakeAgentEngine } from '../core/testing/fake-engine.ts';
import { DefAgentHost } from './def-agent-host.ts';
import { DefAgentHostError } from './errors.ts';
import { createMemoryDefAgentSessionStore } from './session-store.ts';

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
const store = createMemoryDefAgentSessionStore();
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

console.log('DEF Agent Host restart recovery contract passed');
