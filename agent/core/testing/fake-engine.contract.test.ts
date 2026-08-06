import assert from 'node:assert/strict';
import {
  AgentEngineProtocolError,
  DEF_EVENT_SCHEMA_VERSION,
  DEF_SESSION_SCHEMA_VERSION,
  asClientTurnId,
  asCommandId,
  asDatabaseGeneration,
  asDefSessionId,
  asDefTurnId,
  asEngineSessionId,
  asInteractionId,
  asTimelineId,
  asToolCallId,
  asWorkspaceId,
  isEngineTerminalEvent,
  type ApprovalCapabilityClaims,
  type DefEventEnvelope,
  type DefSessionId,
  type DefSessionV6,
  type EngineEvent,
  type EngineInteractionResultInput,
  type EngineSessionRef,
  type EngineToolProjectionInput,
  type EngineTurnInput,
  type ProductCommandEnvelope,
} from '../contracts/index.ts';
import { DeterministicFakeAgentEngine } from './fake-engine.ts';

async function nextEvent(iterator: AsyncIterator<EngineEvent>): Promise<EngineEvent> {
  const result = await iterator.next();
  assert.equal(result.done, false, 'expected another Engine event');
  return result.value;
}

async function expectProtocolError(
  action: () => Promise<unknown>,
  code: AgentEngineProtocolError['code'],
): Promise<void> {
  await assert.rejects(action, (error: unknown) => (
    error instanceof AgentEngineProtocolError && error.code === code
  ));
}

function createTurnInput(engineSession: EngineSessionRef, suffix: string): EngineTurnInput {
  return {
    engineSession,
    defSessionId: asDefSessionId(`def-session-${suffix}`),
    clientTurnId: asClientTurnId(`client-turn-${suffix}`),
    defTurnId: asDefTurnId(`def-turn-${suffix}`),
    systemContext: 'deterministic system context',
    userMessage: `turn ${suffix}`,
    providerProfileRef: 'fake-profile',
    toolProjection: {
      revision: 1,
      tools: [{
        name: 'read_workspace',
        description: 'Read deterministic workspace state',
        inputSchema: { type: 'object' },
        risk: 'read',
      }],
    },
    context: { fixture: suffix },
  };
}

const opaqueTurnId = asDefTurnId('opaque-turn');
// @ts-expect-error DefTurnId must not be assignable to DefSessionId.
const opaqueSessionId: DefSessionId = opaqueTurnId;
void opaqueSessionId;

const workspaceId = asWorkspaceId('workspace-a');
const databaseGeneration = asDatabaseGeneration('generation-a');
const timelineId = asTimelineId('timeline-a');
const defSessionId = asDefSessionId('def-session-contract');
const defTurnId = asDefTurnId('def-turn-contract');
const toolCallId = asToolCallId('tool-contract');
const interactionId = asInteractionId('interaction-contract');
const commandId = asCommandId('command-contract');

const contractEngineRef: EngineSessionRef = {
  kind: 'fake',
  sessionId: asEngineSessionId('fake-session-contract'),
  runtimeVersion: 'fake-1',
  storeSchemaVersion: 1,
};
const sessionContract: DefSessionV6 = {
  schemaVersion: DEF_SESSION_SCHEMA_VERSION,
  eventSchemaVersion: DEF_EVENT_SCHEMA_VERSION,
  defSessionId,
  host: 'workbench',
  status: 'ready',
  workspaceId,
  lastDatabaseGeneration: databaseGeneration,
  timelineId,
  axisBindingId: null,
  boundNodeId: null,
  engine: contractEngineRef,
  harness: { stateVersion: 1, revision: 'harness-r1' },
  createdAt: '2026-08-06T00:00:00.000Z',
  updatedAt: '2026-08-06T00:00:00.000Z',
};
assert.equal(sessionContract.host, 'workbench');

const sessionReadyEvent: DefEventEnvelope<'session.ready'> = {
  schemaVersion: DEF_EVENT_SCHEMA_VERSION,
  sequence: 1,
  occurredAt: '2026-08-06T00:00:00.500Z',
  defSessionId,
  type: 'session.ready',
  payload: { engineKind: 'fake', engineRuntimeVersion: 'fake-1' },
};
assert.equal(sessionReadyEvent.type, 'session.ready');

const approvalClaims: ApprovalCapabilityClaims = {
  schemaVersion: 1,
  audience: 'browser-product-gateway',
  keyEpoch: 'epoch-1',
  nonce: 'nonce-1',
  issuedAt: '2026-08-06T00:00:00.000Z',
  expiresAt: '2026-08-06T00:15:00.000Z',
  interactionId,
  commandId,
  defSessionId,
  defTurnId,
  toolCallId,
  proposalHash: 'sha256:proposal',
  binding: {
    workspaceId,
    databaseGeneration,
    timelineId,
    checkoutTargetId: null,
    contentRevision: 1,
    snapshotDigest: 'sha256:snapshot',
  },
  scope: ['timeline:read'],
};
type ContractProductOperationSchema = {
  read_workspace: { scope: 'timeline' | 'workspace' };
  propose_change: { proposalHash: string };
};
const productCommand: ProductCommandEnvelope<ContractProductOperationSchema> = {
  protocolVersion: 1,
  commandId,
  defSessionId,
  defTurnId,
  toolCallId,
  expected: {
    workspaceId,
    databaseGeneration,
    timelineId,
    checkoutTargetId: null,
    checkoutUpdatedAt: 0,
    contentRevision: 1,
    snapshotDigest: 'sha256:snapshot',
  },
  command: { op: 'read_workspace', payload: { scope: 'timeline' } },
  approvalCapability: 'signed-token-placeholder',
};
assert.equal(approvalClaims.commandId, productCommand.commandId);

const toolRequestedEvent: DefEventEnvelope<'tool.requested'> = {
  schemaVersion: DEF_EVENT_SCHEMA_VERSION,
  sequence: 1,
  occurredAt: '2026-08-06T00:00:01.000Z',
  defSessionId,
  defTurnId,
  toolCallId,
  type: 'tool.requested',
  payload: {
    name: 'read_workspace',
    risk: 'read',
    input: { scope: 'timeline' },
  },
};
assert.equal(toolRequestedEvent.toolCallId, toolCallId);

// @ts-expect-error Tool events require a Tool correlation ID.
const invalidToolEvent: DefEventEnvelope<'tool.requested'> = {
  schemaVersion: DEF_EVENT_SCHEMA_VERSION,
  sequence: 2,
  occurredAt: '2026-08-06T00:00:02.000Z',
  defSessionId,
  defTurnId,
  type: 'tool.requested',
  payload: { name: 'read_workspace', risk: 'read', input: {} },
};
void invalidToolEvent;

const invalidProductCommand: ProductCommandEnvelope<ContractProductOperationSchema> = {
  ...productCommand,
  command: {
    op: 'read_workspace',
    // @ts-expect-error read_workspace payload must use its declared schema.
    payload: { proposalHash: 'wrong-operation-payload' },
  },
};
void invalidProductCommand;

const engine = new DeterministicFakeAgentEngine();
assert.deepEqual(await engine.probe(), {
  status: 'ready',
  kind: 'fake',
  runtimeVersion: 'fake-1',
});

const session = await engine.createSession({
  defSessionId: asDefSessionId('def-session-main'),
  providerProfileRef: 'fake-profile',
});
assert.equal(session.sessionId, 'fake-session-1');
assert.deepEqual(await engine.recoverSession(session), { status: 'recovered', ref: session });
assert.deepEqual(await engine.recoverSession({
  ...session,
  sessionId: asEngineSessionId('missing-session'),
}), { status: 'missing' });
assert.deepEqual(await engine.recoverSession({ ...session, kind: 'other' }), {
  status: 'incompatible',
  code: 'ENGINE_SESSION_INCOMPATIBLE',
  message: 'Fake Engine cannot use other@fake-1/schema-1',
});
assert.deepEqual(await engine.recoverSession({ ...session, storeSchemaVersion: 2 }), {
  status: 'incompatible',
  code: 'ENGINE_SESSION_INCOMPATIBLE',
  message: 'Fake Engine cannot use fake@fake-1/schema-2',
});
await expectProtocolError(
  () => engine.startTurn(createTurnInput({ ...session, runtimeVersion: 'fake-2' }, 'bad-runtime')),
  'ENGINE_SESSION_INCOMPATIBLE',
);
await expectProtocolError(
  () => engine.startTurn(createTurnInput({
    ...session,
    sessionId: asEngineSessionId('missing-session'),
  }, 'missing-session')),
  'ENGINE_SESSION_NOT_FOUND',
);
await expectProtocolError(
  () => engine.compact({ ...session, storeSchemaVersion: 2 }),
  'ENGINE_SESSION_INCOMPATIBLE',
);

const scriptedToolCallId = asToolCallId('tool-main');
const scriptedInteractionId = asInteractionId('interaction-main');
engine.enqueueScript([
  { type: 'text', delta: '准备读取' },
  {
    type: 'tool',
    toolCallId: scriptedToolCallId,
    name: 'read_workspace',
    input: { scope: 'timeline' },
  },
  { type: 'text', delta: '读取完成' },
  {
    type: 'interaction',
    interactionId: scriptedInteractionId,
    interactionKind: 'question',
    prompt: '继续吗？',
  },
  { type: 'projection', revision: 2 },
  { type: 'complete', output: { ok: true } },
]);

const mainHandle = await engine.startTurn(createTurnInput(session, 'main'));
const mainEvents = mainHandle.events[Symbol.asyncIterator]();

const firstDelta = await nextEvent(mainEvents);
assert.equal(firstDelta.type, 'response.delta');
if (firstDelta.type === 'response.delta') assert.equal(firstDelta.delta, '准备读取');

const toolRequest = await nextEvent(mainEvents);
assert.equal(toolRequest.type, 'tool.requested');
assert.deepEqual(engine.getTurnTrace(mainHandle.ref)?.pending, {
  kind: 'tool',
  correlationId: scriptedToolCallId,
});

await expectProtocolError(
  () => mainHandle.submitToolResult({
    toolCallId: asToolCallId('wrong-tool'),
    status: 'succeeded',
    result: null,
  }),
  'ENGINE_INPUT_UNEXPECTED',
);
const successfulToolResult = {
  toolCallId: scriptedToolCallId,
  status: 'succeeded' as const,
  result: { revision: 1 },
};
await mainHandle.submitToolResult(successfulToolResult);
await mainHandle.submitToolResult(successfulToolResult);
await expectProtocolError(
  () => mainHandle.submitToolResult({
    toolCallId: scriptedToolCallId,
    status: 'failed',
    code: 'CHANGED',
    message: 'different payload',
  }),
  'ENGINE_CORRELATION_CONFLICT',
);

const secondDelta = await nextEvent(mainEvents);
assert.equal(secondDelta.type, 'response.delta');
if (secondDelta.type === 'response.delta') assert.equal(secondDelta.delta, '读取完成');

const interactionRequest = await nextEvent(mainEvents);
assert.equal(interactionRequest.type, 'interaction.requested');
assert.deepEqual(engine.getTurnTrace(mainHandle.ref)?.pending, {
  kind: 'interaction',
  correlationId: scriptedInteractionId,
});

await expectProtocolError(
  () => mainHandle.submitInteractionResult({
    interactionId: asInteractionId('wrong-interaction'),
    interactionKind: 'question',
    resolution: 'answered',
    value: true,
  }),
  'ENGINE_INPUT_UNEXPECTED',
);
const answeredInteraction = {
  interactionId: scriptedInteractionId,
  interactionKind: 'question' as const,
  resolution: 'answered' as const,
  value: true,
};
await mainHandle.submitInteractionResult(answeredInteraction);
await mainHandle.submitInteractionResult(answeredInteraction);
await expectProtocolError(
  () => mainHandle.submitInteractionResult({
    interactionId: scriptedInteractionId,
    interactionKind: 'question',
    resolution: 'cancelled',
  }),
  'ENGINE_CORRELATION_CONFLICT',
);

await Promise.resolve();
assert.deepEqual(engine.getTurnTrace(mainHandle.ref)?.pending, { kind: 'projection', revision: 2 });
await expectProtocolError(
  () => mainHandle.updateToolProjection({ revision: 1, tools: [] }),
  'ENGINE_PROJECTION_STALE',
);
await expectProtocolError(
  () => mainHandle.updateToolProjection({ revision: 3, tools: [] }),
  'ENGINE_INPUT_UNEXPECTED',
);
const secondProjection: EngineToolProjectionInput = {
  revision: 2,
  tools: [{
    name: 'propose_change',
    description: 'Create a deterministic proposal',
    inputSchema: { type: 'object' },
    risk: 'propose',
  }],
};
await mainHandle.updateToolProjection(secondProjection);
await mainHandle.updateToolProjection(secondProjection);

const projectionApplied = await nextEvent(mainEvents);
assert.equal(projectionApplied.type, 'tool-projection.applied');
const completed = await nextEvent(mainEvents);
assert.equal(completed.type, 'turn.completed');
assert.equal((await mainEvents.next()).done, true);

await expectProtocolError(
  () => mainHandle.submitToolResult({
    toolCallId: asToolCallId('late-tool'),
    status: 'succeeded',
    result: null,
  }),
  'ENGINE_TURN_TERMINAL',
);
await expectProtocolError(
  () => mainHandle.submitInteractionResult({
    interactionId: asInteractionId('late-interaction'),
    interactionKind: 'question',
    resolution: 'answered',
    value: null,
  }),
  'ENGINE_TURN_TERMINAL',
);
await expectProtocolError(
  () => mainHandle.updateToolProjection({ revision: 3, tools: [] }),
  'ENGINE_TURN_TERMINAL',
);
const mainTrace = engine.getTurnTrace(mainHandle.ref);
assert.ok(mainTrace);
assert.deepEqual(mainTrace.events.map((event) => event.ordinal), [1, 2, 3, 4, 5, 6]);
assert.equal(mainTrace.events.filter(isEngineTerminalEvent).length, 1);
assert.equal(mainTrace.toolResults.length, 1);
assert.equal(mainTrace.interactionResults.length, 1);
assert.equal(mainTrace.toolProjections.length, 1);
assert.deepEqual(await engine.compact(session), {
  status: 'compacted',
  summaryRef: 'fake-compaction-1',
});

const atomicToolCallId = asToolCallId('tool-atomic-projection');
engine.enqueueScript([
  { type: 'tool', toolCallId: atomicToolCallId, name: 'route_once', input: {} },
  { type: 'projection', revision: 2 },
  { type: 'complete', output: { atomic: true } },
]);
const atomicHandle = await engine.startTurn(createTurnInput(session, 'atomic-projection'));
const atomicEvents = atomicHandle.events[Symbol.asyncIterator]();
assert.equal((await nextEvent(atomicEvents)).type, 'tool.requested');
const atomicResult = {
  toolCallId: atomicToolCallId,
  status: 'succeeded' as const,
  result: { routed: true },
};
const atomicProjection: EngineToolProjectionInput = {
  revision: 2,
  tools: [{
    name: 'read_once',
    description: 'Read one projected resource',
    inputSchema: { type: 'object' },
    risk: 'read',
  }],
};
await atomicHandle.submitToolResultAndUpdateProjection(atomicResult, atomicProjection);
await atomicHandle.submitToolResultAndUpdateProjection(atomicResult, atomicProjection);
assert.equal((await nextEvent(atomicEvents)).type, 'tool-projection.applied');
assert.equal((await nextEvent(atomicEvents)).type, 'turn.completed');
assert.equal((await atomicEvents.next()).done, true);
assert.deepEqual(engine.getTurnTrace(atomicHandle.ref)?.toolResults, [atomicResult]);
assert.deepEqual(engine.getTurnTrace(atomicHandle.ref)?.toolProjections, [atomicProjection]);

const approvalInteractionId = asInteractionId('interaction-approval');
engine.enqueueScript([
  {
    type: 'interaction',
    interactionId: approvalInteractionId,
    interactionKind: 'approval',
    prompt: '批准这项变更吗？',
  },
  { type: 'complete' },
]);
const approvalHandle = await engine.startTurn(createTurnInput(session, 'approval'));
const approvalEvents = approvalHandle.events[Symbol.asyncIterator]();
assert.equal((await nextEvent(approvalEvents)).type, 'interaction.requested');
await expectProtocolError(
  () => approvalHandle.submitInteractionResult({
    interactionId: approvalInteractionId,
    interactionKind: 'question',
    resolution: 'answered',
    value: true,
  }),
  'ENGINE_INTERACTION_KIND_MISMATCH',
);
const invalidApprovalRuntimeResult = {
  interactionId: approvalInteractionId,
  interactionKind: 'approval',
  resolution: 'answered',
  value: true,
} as unknown as EngineInteractionResultInput;
await expectProtocolError(
  () => approvalHandle.submitInteractionResult(invalidApprovalRuntimeResult),
  'ENGINE_INTERACTION_RESOLUTION_INVALID',
);
const approvedInteraction = {
  interactionId: approvalInteractionId,
  interactionKind: 'approval' as const,
  resolution: 'approved' as const,
  value: { capability: 'test-only' },
};
await approvalHandle.submitInteractionResult(approvedInteraction);
await approvalHandle.submitInteractionResult(approvedInteraction);
await expectProtocolError(
  () => approvalHandle.submitInteractionResult({
    interactionId: approvalInteractionId,
    interactionKind: 'approval',
    resolution: 'rejected',
  }),
  'ENGINE_CORRELATION_CONFLICT',
);
assert.equal((await nextEvent(approvalEvents)).type, 'turn.completed');
assert.equal((await approvalEvents.next()).done, true);

// @ts-expect-error Approval interactions cannot be resolved as ordinary answers.
const invalidApprovalCompileResult: EngineInteractionResultInput = {
  interactionId: approvalInteractionId,
  interactionKind: 'approval',
  resolution: 'answered',
  value: true,
};
void invalidApprovalCompileResult;

const abortToolCallId = asToolCallId('tool-abort');
engine.enqueueScript([
  { type: 'tool', toolCallId: abortToolCallId, name: 'wait_forever', input: {} },
  { type: 'complete' },
]);
const abortHandle = await engine.startTurn(createTurnInput(session, 'abort'));
const abortEvents = abortHandle.events[Symbol.asyncIterator]();
assert.equal((await nextEvent(abortEvents)).type, 'tool.requested');
assert.deepEqual(await abortHandle.abort({ code: 'USER_STOPPED', message: 'stop now' }), {
  status: 'aborted',
  terminalType: 'turn.aborted',
});
assert.equal((await nextEvent(abortEvents)).type, 'turn.aborted');
assert.equal((await abortEvents.next()).done, true);
assert.deepEqual(await abortHandle.abort({ code: 'USER_STOPPED' }), {
  status: 'already-terminal',
  terminalType: 'turn.aborted',
});
await expectProtocolError(
  () => abortHandle.submitToolResult({
    toolCallId: abortToolCallId,
    status: 'succeeded',
    result: null,
  }),
  'ENGINE_TURN_TERMINAL',
);
assert.equal(engine.getTurnTrace(abortHandle.ref)?.events.filter(isEngineTerminalEvent).length, 1);

const resultFirstRaceToolId = asToolCallId('tool-race-result-first');
engine.enqueueScript([
  { type: 'tool', toolCallId: resultFirstRaceToolId, name: 'race_result_first', input: {} },
  { type: 'complete' },
]);
const resultFirstRaceHandle = await engine.startTurn(createTurnInput(session, 'race-result-first'));
const resultFirstRaceEvents = resultFirstRaceHandle.events[Symbol.asyncIterator]();
assert.equal((await nextEvent(resultFirstRaceEvents)).type, 'tool.requested');
const resultFirstSubmission = resultFirstRaceHandle.submitToolResult({
  toolCallId: resultFirstRaceToolId,
  status: 'succeeded',
  result: true,
});
const resultFirstAbort = resultFirstRaceHandle.abort({ code: 'RACE_ABORT' });
await resultFirstSubmission;
assert.deepEqual(await resultFirstAbort, {
  status: 'aborted',
  terminalType: 'turn.aborted',
});
assert.equal((await nextEvent(resultFirstRaceEvents)).type, 'turn.aborted');
assert.equal(
  engine.getTurnTrace(resultFirstRaceHandle.ref)?.events.filter(isEngineTerminalEvent).length,
  1,
);

const abortFirstRaceToolId = asToolCallId('tool-race-abort-first');
engine.enqueueScript([
  { type: 'tool', toolCallId: abortFirstRaceToolId, name: 'race_abort_first', input: {} },
  { type: 'complete' },
]);
const abortFirstRaceHandle = await engine.startTurn(createTurnInput(session, 'race-abort-first'));
const abortFirstRaceEvents = abortFirstRaceHandle.events[Symbol.asyncIterator]();
assert.equal((await nextEvent(abortFirstRaceEvents)).type, 'tool.requested');
const abortFirstResult = abortFirstRaceHandle.abort({ code: 'RACE_ABORT' });
await expectProtocolError(
  () => abortFirstRaceHandle.submitToolResult({
    toolCallId: abortFirstRaceToolId,
    status: 'succeeded',
    result: true,
  }),
  'ENGINE_TURN_TERMINAL',
);
assert.deepEqual(await abortFirstResult, {
  status: 'aborted',
  terminalType: 'turn.aborted',
});
assert.equal((await nextEvent(abortFirstRaceEvents)).type, 'turn.aborted');
assert.equal(
  engine.getTurnTrace(abortFirstRaceHandle.ref)?.events.filter(isEngineTerminalEvent).length,
  1,
);

engine.enqueueScript([{ type: 'fail', code: 'SCRIPTED_FAILURE', message: 'expected failure' }]);
const failedHandle = await engine.startTurn(createTurnInput(session, 'failed'));
const failedEvents = failedHandle.events[Symbol.asyncIterator]();
const failed = await nextEvent(failedEvents);
assert.equal(failed.type, 'turn.failed');
assert.equal((await failedEvents.next()).done, true);
assert.equal(engine.getTurnTrace(failedHandle.ref)?.events.filter(isEngineTerminalEvent).length, 1);

const disposableSession = await engine.createSession({
  defSessionId: asDefSessionId('def-session-dispose'),
  providerProfileRef: 'fake-profile',
});
const disposeInteractionId = asInteractionId('interaction-dispose');
engine.enqueueScript([
  {
    type: 'interaction',
    interactionId: disposeInteractionId,
    interactionKind: 'approval',
    prompt: 'approve disposal test',
  },
]);
const disposeHandle = await engine.startTurn(createTurnInput(disposableSession, 'dispose'));
const disposeEvents = disposeHandle.events[Symbol.asyncIterator]();
assert.equal((await nextEvent(disposeEvents)).type, 'interaction.requested');
await engine.disposeSession(disposableSession);
assert.equal((await nextEvent(disposeEvents)).type, 'turn.aborted');
assert.deepEqual(await engine.recoverSession(disposableSession), { status: 'missing' });

const shutdownSession = await engine.createSession({
  defSessionId: asDefSessionId('def-session-shutdown'),
  providerProfileRef: 'fake-profile',
});
const shutdownToolCallId = asToolCallId('tool-shutdown');
engine.enqueueScript([
  { type: 'tool', toolCallId: shutdownToolCallId, name: 'shutdown_wait', input: {} },
]);
const shutdownHandle = await engine.startTurn(createTurnInput(shutdownSession, 'shutdown'));
const shutdownEvents = shutdownHandle.events[Symbol.asyncIterator]();
assert.equal((await nextEvent(shutdownEvents)).type, 'tool.requested');
await engine.shutdown();
assert.equal((await nextEvent(shutdownEvents)).type, 'turn.aborted');
await engine.shutdown();
assert.deepEqual(await engine.probe(), {
  status: 'unavailable',
  kind: 'fake',
  code: 'ENGINE_SHUTDOWN',
  message: 'Fake Engine is shut down',
});
await expectProtocolError(
  () => engine.createSession({
    defSessionId: asDefSessionId('after-shutdown'),
    providerProfileRef: 'fake-profile',
  }),
  'ENGINE_SHUTDOWN',
);

console.log('DEF_AGENT_CORE_FAKE_ENGINE_CONTRACT_OK');
