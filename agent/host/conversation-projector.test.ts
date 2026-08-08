import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ConversationProjectionError,
  ConversationProjector,
  createConversationHostJournalSource,
  type ConversationHostJournalSource,
} from './conversation-projector.ts';
import {
  createConversationFixture,
  createFixtureRuntimeSnapshot,
  FIXTURE_ASSISTANT_MESSAGE_ID,
  FIXTURE_ERROR_PART_ID,
  FIXTURE_REASONING_PART_ID,
  FIXTURE_TEXT_PART_ID,
  FIXTURE_TOOL_PART_ID,
  FIXTURE_TURN_ID,
  hostInteractionRequested,
  hostInteractionResolved,
  hostToolError,
  hostToolRequested,
  hostToolResult,
  hostToolStarted,
} from './testing/conversation-fixtures.ts';
import {
  asConversationPartId,
  asConversationMessageId,
  asEngineSessionId,
  asDefSessionId,
  asDefTurnId,
  type ConversationPart,
  type ConversationEvent,
  type ConversationSnapshot,
  type DefEvent,
  type RuntimeTranscriptEvent,
  type RuntimeTranscriptMutation,
  type RuntimeTranscriptPart,
  type RuntimeTranscriptSnapshot,
  type RuntimeTranscriptSource,
} from '../core/contracts/index.ts';

const NOW = '2026-08-08T00:00:10.000Z';

function projector(
  fixture: ReturnType<typeof createConversationFixture>,
): ConversationProjector {
  return new ConversationProjector({
    runtime: fixture.runtime,
    host: fixture.host,
    epoch: 'fixture-epoch',
    now: () => NOW,
    createEpoch: (previous) => `${previous}-next`,
  });
}

function part<T extends ConversationPart['type']>(
  snapshot: { readonly parts: readonly ConversationPart[] },
  type: T,
): Extract<ConversationPart, { type: T }> {
  const value = snapshot.parts.find((candidate) => candidate.type === type);
  assert.ok(value, `expected part type ${type}`);
  return value as Extract<ConversationPart, { type: T }>;
}

test('composes Runtime transcript with Host Tool/Interaction state without Host text', async () => {
  const fixture = createConversationFixture();
  fixture.host.append(hostToolRequested(fixture.sessionId, 1));
  fixture.host.append(hostToolStarted(fixture.sessionId, 2));
  fixture.host.append(hostToolResult(fixture.sessionId, 3, { result: 'done' }));
  fixture.host.append(hostInteractionRequested(fixture.sessionId, 4));
  fixture.host.append(hostInteractionResolved(fixture.sessionId, 5));

  const projectorInstance = projector(fixture);
  const snapshot = await projectorInstance.getSnapshot(fixture.sessionId);
  assert.deepEqual(snapshot.cursor, {
    epoch: 'fixture-epoch',
    runtimeSequence: 6,
    hostSequence: 5,
  });
  assert.equal(snapshot.messages.length, 2);
  assert.equal(new Set(snapshot.messages.map((message) => message.id)).size, 2);
  assert.equal(new Set(snapshot.parts.map((partValue) => partValue.id)).size, snapshot.parts.length);
  assert.equal(part(snapshot, 'text').text, 'fixture text');
  assert.equal(part(snapshot, 'reasoning').text, 'fixture reasoning');
  assert.equal(part(snapshot, 'compaction').type, 'compaction');
  assert.equal(part(snapshot, 'file').type, 'file');
  assert.equal(part(snapshot, 'error').type, 'error');
  const tool = part(snapshot, 'tool');
  assert.equal(tool.state.status, 'completed');
  assert.deepEqual(tool.state.status === 'completed' ? tool.state.output : undefined, { result: 'done' });
  const interaction = part(snapshot, 'interaction');
  assert.equal(interaction.state.status, 'resolved');
  assert.deepEqual(interaction.payload, { details: { options: ['甲', '乙'] } });
  assert.deepEqual(snapshot.status, { status: 'idle' });
  const assistant = snapshot.messages.find((message) => message.id === FIXTURE_ASSISTANT_MESSAGE_ID)!;
  assert.equal(new Set(assistant.partIds).size, assistant.partIds.length);
  assert.ok(assistant.partIds.includes(FIXTURE_TOOL_PART_ID));

  const responseDelta: Extract<DefEvent, { type: 'response.delta' }> = {
    schemaVersion: 1,
    sequence: 6,
    occurredAt: NOW,
    defSessionId: fixture.sessionId,
    defTurnId: FIXTURE_TURN_ID,
    type: 'response.delta',
    payload: { delta: 'host must not become text' },
  };
  fixture.host.append(responseDelta);
  const events = [];
  for await (const event of projectorInstance.subscribe(fixture.sessionId, snapshot.cursor)) events.push(event);
  assert.equal(events.length, 1);
  assert.equal(events[0]?.type, 'session.status');
  const afterHostDelta = await projectorInstance.getSnapshot(fixture.sessionId);
  assert.equal(part(afterHostDelta, 'text').text, 'fixture text');
  assert.equal(afterHostDelta.cursor.hostSequence, 6);
});

test('projects Tool pending/running/completed/error from their two authoritative sources', async () => {
  for (const [event, expected] of [
    [hostToolRequested(asDefSessionId('tool-state-session'), 1), 'pending'],
    [hostToolStarted(asDefSessionId('tool-state-session'), 1), 'running'],
    [hostToolResult(asDefSessionId('tool-state-session'), 1), 'completed'],
    [hostToolError(asDefSessionId('tool-state-session'), 1), 'error'],
  ] as const) {
    const fixture = createConversationFixture({ sessionId: event.defSessionId });
    fixture.host.append(event);
    const snapshot = await projector(fixture).getSnapshot(fixture.sessionId);
    assert.equal(part(snapshot, 'tool').state.status, expected);
  }
});

test('a durable stopped Turn overrides an interrupted active Tool after recovery', async () => {
  const fixture = createConversationFixture();
  fixture.host.append(hostToolStarted(fixture.sessionId, 1));
  fixture.host.append({
    schemaVersion: 1,
    sequence: 2,
    occurredAt: NOW,
    defSessionId: fixture.sessionId,
    defTurnId: FIXTURE_TURN_ID,
    type: 'turn.stopped',
    payload: { code: 'USER_STOPPED', message: 'Stopped by user' },
  });

  const projectorInstance = projector(fixture);
  const snapshot = await projectorInstance.getSnapshot(fixture.sessionId);
  assert.equal(part(snapshot, 'tool').state.status, 'running');
  assert.deepEqual(snapshot.status, { status: 'idle' });

  const nextTurn = asDefTurnId('conversation-after-stopped-tool');
  fixture.runtime.append({
    type: 'message.upsert',
    message: {
      id: asConversationMessageId('conversation-after-stopped-tool-message'),
      role: 'user',
      defTurnId: nextTurn,
      createdAt: NOW,
      completedAt: NOW,
      partIds: [],
    },
    index: snapshot.messages.length,
  }, 7);
  fixture.runtime.append({ type: 'session.status', status: { status: 'running' } }, 8);

  const resumed = await projectorInstance.getSnapshot(fixture.sessionId);
  assert.deepEqual(resumed.status, { status: 'running', defTurnId: nextTurn });
});

test('a pending user Interaction takes priority over its still-running Tool', async () => {
  const fixture = createConversationFixture();
  fixture.host.append(hostToolStarted(fixture.sessionId, 1));
  fixture.host.append(hostInteractionRequested(fixture.sessionId, 2));

  const snapshot = await projector(fixture).getSnapshot(fixture.sessionId);
  const interaction = part(snapshot, 'interaction');
  assert.deepEqual(snapshot.status, {
    status: 'waiting-interaction',
    defTurnId: FIXTURE_TURN_ID,
    interactionId: interaction.interactionId,
  });
});

test('keeps a Tool-backed Interaction on the Tool message after Runtime continues', async () => {
  const fixture = createConversationFixture();
  fixture.host.append(hostInteractionRequested(fixture.sessionId, 1));
  const projectorInstance = projector(fixture);
  const pending = await projectorInstance.getSnapshot(fixture.sessionId);
  const pendingInteraction = part(pending, 'interaction');
  assert.equal(pendingInteraction.messageId, FIXTURE_ASSISTANT_MESSAGE_ID);

  const continuationMessageId = asConversationMessageId('message-assistant-after-interaction');
  fixture.runtime.append({
    type: 'message.upsert',
    message: {
      id: continuationMessageId,
      role: 'assistant',
      defTurnId: FIXTURE_TURN_ID,
      createdAt: '2026-08-08T00:00:11.000Z',
      partIds: [],
    },
    index: pending.messages.length,
  }, 7, '2026-08-08T00:00:11.000Z');
  fixture.host.append(hostInteractionResolved(fixture.sessionId, 2));

  const recovered = await projectorInstance.getSnapshot(fixture.sessionId);
  const resolvedInteraction = part(recovered, 'interaction');
  assert.equal(resolvedInteraction.messageId, pendingInteraction.messageId);
  assert.equal(resolvedInteraction.state.status, 'resolved');
  assert.equal(recovered.messages.find((message) => message.id === continuationMessageId)?.partIds.length, 0);
});

test('captures Runtime/Host high-water marks before subscribe and advances one source at a time', async () => {
  const fixture = createConversationFixture({ live: true });
  const projectorInstance = projector(fixture);
  const snapshot = await projectorInstance.getSnapshot(fixture.sessionId);
  const delta: RuntimeTranscriptMutation = {
    type: 'part.delta',
    messageId: FIXTURE_ASSISTANT_MESSAGE_ID,
    partId: FIXTURE_TEXT_PART_ID,
    field: 'text',
    delta: ' + runtime',
  };
  fixture.runtime.append(delta, 7, NOW);
  fixture.host.append(hostToolStarted(fixture.sessionId, 1));

  const iterator = projectorInstance.subscribe(fixture.sessionId, snapshot.cursor)[Symbol.asyncIterator]();
  const first = await iterator.next();
  const second = await iterator.next();
  fixture.runtime.close();
  fixture.host.close();
  await iterator.return?.();
  const events = [first.value, second.value].filter((event): event is NonNullable<typeof event> => event !== undefined);
  assert.equal(events.length, 2);
  const cursors = events.map((event) => [event.source, event.sourceSequence, event.cursor.runtimeSequence, event.cursor.hostSequence]);
  if (events[0]?.source === 'runtime') {
    assert.deepEqual(cursors, [['runtime', 7, 7, 0], ['host', 1, 7, 1]]);
  } else {
    assert.deepEqual(cursors, [['host', 1, 6, 1], ['runtime', 7, 7, 1]]);
  }
});

test('turns source gaps, duplicates, and epoch mismatches into reset/refetch signals', async () => {
  const gapFixture = createConversationFixture();
  const gapProjector = projector(gapFixture);
  const gapSnapshot = await gapProjector.getSnapshot(gapFixture.sessionId);
  gapFixture.runtime.append({
    type: 'part.delta',
    messageId: FIXTURE_ASSISTANT_MESSAGE_ID,
    partId: FIXTURE_TEXT_PART_ID,
    field: 'text',
    delta: ' gap',
  }, 8);
  const [gapEvent] = await collect(gapProjector.subscribe(gapFixture.sessionId, gapSnapshot.cursor));
  assert.equal(gapEvent?.type, 'conversation.reset-required');
  assert.equal(gapEvent?.reason, 'gap');
  assert.notEqual(gapEvent?.cursor.epoch, gapSnapshot.cursor.epoch);
  const refetched = await gapProjector.getSnapshot(gapFixture.sessionId);
  assert.equal(refetched.cursor.runtimeSequence, 8);
  assert.notEqual(refetched.cursor.epoch, gapSnapshot.cursor.epoch);

  const duplicateFixture = createConversationFixture();
  const duplicateProjector = projector(duplicateFixture);
  const duplicateSnapshot = await duplicateProjector.getSnapshot(duplicateFixture.sessionId);
  duplicateFixture.host.append(hostToolStarted(duplicateFixture.sessionId, 1));
  duplicateFixture.host.append(hostToolStarted(duplicateFixture.sessionId, 1));
  const duplicateEvents = await collect(duplicateProjector.subscribe(duplicateFixture.sessionId, duplicateSnapshot.cursor));
  const duplicateEvent = duplicateEvents.at(-1);
  assert.equal(duplicateEvent?.type, 'conversation.reset-required');
  assert.equal(duplicateEvent?.reason, 'gap');

  const outOfOrderFixture = createConversationFixture();
  outOfOrderFixture.host.append(hostToolStarted(outOfOrderFixture.sessionId, 1));
  outOfOrderFixture.host.append(hostToolStarted(outOfOrderFixture.sessionId, 2));
  const staleHostEvent = hostToolStarted(outOfOrderFixture.sessionId, 1);
  const staleHost: ConversationHostJournalSource = {
    getSession: (sessionId) => outOfOrderFixture.host.getSession(sessionId),
    getSnapshot: (sessionId) => outOfOrderFixture.host.getSnapshot(sessionId),
    subscribe: async function* () {
      yield staleHostEvent;
    },
  };
  const outOfOrderProjector = new ConversationProjector({
    runtime: outOfOrderFixture.runtime,
    host: staleHost,
    epoch: 'out-of-order-epoch',
    createEpoch: (previous) => `${previous}-next`,
  });
  const outOfOrderSnapshot = await outOfOrderProjector.getSnapshot(outOfOrderFixture.sessionId);
  const [outOfOrderEvent] = await collect(outOfOrderProjector.subscribe(outOfOrderFixture.sessionId, outOfOrderSnapshot.cursor));
  assert.equal(outOfOrderEvent?.type, 'conversation.reset-required');
  assert.equal(outOfOrderEvent?.reason, 'gap');

  const epochFixture = createConversationFixture();
  const epochProjector = projector(epochFixture);
  const epochSnapshot = await epochProjector.getSnapshot(epochFixture.sessionId);
  const [epochEvent] = await collect(epochProjector.subscribe(epochFixture.sessionId, {
    ...epochSnapshot.cursor,
    epoch: 'old-projector-epoch',
  }));
  assert.equal(epochEvent?.type, 'conversation.reset-required');
  assert.equal(epochEvent?.reason, 'epoch-changed');

  const invalidSnapshotFixture = createConversationFixture();
  invalidSnapshotFixture.host.append(hostToolStarted(invalidSnapshotFixture.sessionId, 2));
  await assert.rejects(
    () => projector(invalidSnapshotFixture).getSnapshot(invalidSnapshotFixture.sessionId),
    (error: unknown) => error instanceof ConversationProjectionError && error.code === 'SOURCE_GAP',
  );
});

test('supports part upsert/delta/remove while preserving stable parent identity', async () => {
  const fixture = createConversationFixture();
  const projectorInstance = projector(fixture);
  const snapshot = await projectorInstance.getSnapshot(fixture.sessionId);
  fixture.runtime.append({
    type: 'part.delta',
    messageId: FIXTURE_ASSISTANT_MESSAGE_ID,
    partId: FIXTURE_REASONING_PART_ID,
    field: 'text',
    delta: ' + delta',
  }, 7);
  fixture.runtime.append({
    type: 'part.remove',
    messageId: FIXTURE_ASSISTANT_MESSAGE_ID,
    partId: FIXTURE_ERROR_PART_ID,
  }, 8);
  const upsertedPartId = asConversationPartId('part-upsert-fixture');
  fixture.runtime.append({
    type: 'part.upsert',
    part: {
      id: upsertedPartId,
      messageId: FIXTURE_ASSISTANT_MESSAGE_ID,
      createdAt: NOW,
      type: 'text',
      text: 'upserted text',
    },
    index: 1,
  }, 9);
  const events = await collect(projectorInstance.subscribe(fixture.sessionId, snapshot.cursor));
  assert.deepEqual(events.map((event) => event.type), ['part.delta', 'part.remove', 'part.upsert']);
  assert.equal(events[0]?.sourceSequence, 7);
  const after = await projectorInstance.getSnapshot(fixture.sessionId);
  assert.equal(after.parts.some((partValue) => partValue.id === FIXTURE_ERROR_PART_ID), false);
  assert.equal(after.parts.some((partValue) => partValue.id === upsertedPartId), true);
  const reasoning = after.parts.find((partValue) => partValue.id === FIXTURE_REASONING_PART_ID);
  assert.equal(reasoning?.type === 'reasoning' ? reasoning.text : '', 'fixture reasoning + delta');
  assert.equal(new Set(after.messages.flatMap((message) => message.partIds)).size, after.parts.length);
});

test('applies every live mutation atomically with effective status and equals a fresh causal snapshot', async () => {
  const fixture = createConversationFixture({ live: true });
  const projectorInstance = projector(fixture);
  const initial = await projectorInstance.getSnapshot(fixture.sessionId);
  let liveSnapshot = initial;
  const controller = new AbortController();
  const iterator = projectorInstance.subscribe(fixture.sessionId, initial.cursor, controller.signal)[Symbol.asyncIterator]();

  const applyNext = async (append: () => void): Promise<void> => {
    const pending = iterator.next();
    append();
    const result = await pending;
    assert.equal(result.done, false);
    const event = result.value!;
    assert.ok(event.source === 'runtime' || event.source === 'host');
    liveSnapshot = applyTestEvent(liveSnapshot, event);
    const fresh = await projectorInstance.getSnapshot(fixture.sessionId);
    assert.deepEqual(event.status, fresh.status);
    assert.deepEqual(liveSnapshot, fresh);
  };

  await applyNext(() => fixture.runtime.append({
    type: 'part.delta',
    messageId: FIXTURE_ASSISTANT_MESSAGE_ID,
    partId: FIXTURE_TEXT_PART_ID,
    field: 'text',
    delta: ' + live',
  }, 7));
  await applyNext(() => fixture.host.append(hostToolRequested(fixture.sessionId, 1)));
  await applyNext(() => fixture.host.append(hostToolStarted(fixture.sessionId, 2)));
  await applyNext(() => fixture.host.append(hostToolResult(fixture.sessionId, 3, { live: true })));
  await applyNext(() => fixture.host.append(hostInteractionRequested(fixture.sessionId, 4)));
  await applyNext(() => fixture.host.append(hostInteractionResolved(fixture.sessionId, 5)));
  await applyNext(() => fixture.runtime.append({ type: 'session.status', status: { status: 'idle' } }, 8));

  controller.abort();
  await iterator.return?.();
  assert.equal(fixture.runtime.metrics.active, 0);
  assert.equal(fixture.host.metrics.active, 0);
  assert.ok(fixture.runtime.metrics.aborts > 0);
  assert.ok(fixture.host.metrics.aborts > 0);
});

test('stale cursors reset only the requesting Session and cancellation emits no reset', async () => {
  const fixture = createConversationFixture({ live: true });
  const projectorInstance = projector(fixture);
  const snapshot = await projectorInstance.getSnapshot(fixture.sessionId);
  const stale = await collect(projectorInstance.subscribe(fixture.sessionId, {
    ...snapshot.cursor,
    runtimeSequence: snapshot.cursor.runtimeSequence - 1,
  }));
  assert.equal(stale.length, 1);
  assert.equal(stale[0]?.type, 'conversation.reset-required');
  assert.equal(stale[0]?.cursor.epoch, snapshot.cursor.epoch);
  const invalid = projectorInstance.subscribe(fixture.sessionId, {
    ...snapshot.cursor,
    epoch: 'bad epoch',
  });
  await assert.rejects(() => collect(invalid), /cursor epoch is invalid/u);

  const controller = new AbortController();
  const iterator = projectorInstance.subscribe(fixture.sessionId, snapshot.cursor, controller.signal)[Symbol.asyncIterator]();
  const pending = iterator.next();
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  controller.abort();
  const result = await pending;
  assert.equal(result.done, true);
  assert.equal(fixture.runtime.metrics.active, 0);
  assert.equal(fixture.host.metrics.active, 0);
  assert.equal(fixture.runtime.metrics.aborts > 0, true);
  assert.equal(fixture.host.metrics.aborts > 0, true);
});

test('text delta hot path touches only the target Part and never checkpoints history', async () => {
  const fixture = createConversationFixture({ live: true });
  const base = createFixtureRuntimeSnapshot(fixture.engineSession);
  const extraParts: RuntimeTranscriptPart[] = [];
  const extraPartIds: RuntimeTranscriptPart['id'][] = [];
  const historySize = 10_000;
  for (let index = base.parts.length; index < historySize; index += 1) {
    const id = asConversationPartId(`history-part-${index}`);
    extraPartIds.push(id);
    extraParts.push({
      id,
      messageId: FIXTURE_ASSISTANT_MESSAGE_ID,
      createdAt: NOW,
      type: 'text',
      text: 'history',
    });
  }
  const largeSnapshot = {
    ...base,
    messages: base.messages.map((message) => message.id === FIXTURE_ASSISTANT_MESSAGE_ID
      ? { ...message, partIds: [...message.partIds, ...extraPartIds] }
      : message),
    parts: [...base.parts, ...extraParts],
  };
  const runtime = new QueuedRuntimeSource(largeSnapshot);
  const incrementalCloneSamples: number[] = [];
  const boundaryCloneSamples: number[] = [];
  const incrementalTraversalSamples: number[] = [];
  const cacheCloneSamples: number[] = [];
  const projectorInstance = new ConversationProjector({
    runtime,
    host: fixture.host,
    epoch: 'scale-epoch',
    instrumentation: {
      onIncrementalStateClone: (elements) => incrementalCloneSamples.push(elements),
      onBoundaryStateClone: (elements) => boundaryCloneSamples.push(elements),
      onIncrementalTraversal: (elements) => incrementalTraversalSamples.push(elements),
      onCacheStateClone: (elements) => cacheCloneSamples.push(elements),
    },
  });
  const initial = await projectorInstance.getSnapshot(fixture.sessionId);
  const controller = new AbortController();
  const iterator = projectorInstance.subscribe(fixture.sessionId, initial.cursor, controller.signal)[Symbol.asyncIterator]();
  const deltaCount = 10_000;
  for (let index = 0; index < deltaCount; index += 1) {
    const pending = iterator.next();
    runtime.append({
      schemaVersion: 1,
      engineSession: fixture.engineSession,
      sequence: 7 + index,
      occurredAt: NOW,
      mutation: {
        type: 'part.delta',
        messageId: FIXTURE_ASSISTANT_MESSAGE_ID,
        partId: FIXTURE_TEXT_PART_ID,
        field: 'text',
        delta: 'x',
      },
    });
    const result = await pending;
    assert.equal(result.done, false);
    assert.equal(result.value?.type, 'part.delta');
  }
  controller.abort();
  await iterator.return?.();

  assert.equal(incrementalTraversalSamples.length, deltaCount);
  assert.equal(incrementalTraversalSamples.reduce((sum, count) => sum + count, 0), deltaCount * 2);
  assert.equal(Math.max(...incrementalTraversalSamples), 2);
  assert.deepEqual(boundaryCloneSamples, [initial.messages.length + initial.parts.length]);
  assert.ok(incrementalCloneSamples.every((count) => count === 0));
  assert.equal(cacheCloneSamples.length, 1);
  assert.equal(cacheCloneSamples[0], initial.messages.length + initial.parts.length);
});

test('two consumers can resume the one current boundary cursor independently', async () => {
  const fixture = createConversationFixture({ live: true });
  const projectorInstance = projector(fixture);
  const snapshot = await projectorInstance.getSnapshot(fixture.sessionId);
  const firstController = new AbortController();
  const secondController = new AbortController();
  const first = projectorInstance.subscribe(fixture.sessionId, snapshot.cursor, firstController.signal)[Symbol.asyncIterator]();
  const second = projectorInstance.subscribe(fixture.sessionId, snapshot.cursor, secondController.signal)[Symbol.asyncIterator]();
  const firstPending = first.next();
  const secondPending = second.next();
  fixture.runtime.append({
    type: 'part.delta',
    messageId: FIXTURE_ASSISTANT_MESSAGE_ID,
    partId: FIXTURE_TEXT_PART_ID,
    field: 'text',
    delta: ' + both',
  }, 7);
  const [firstResult, secondResult] = await Promise.all([firstPending, secondPending]);
  assert.equal(firstResult.done, false);
  assert.equal(secondResult.done, false);
  assert.deepEqual(firstResult.value, secondResult.value);
  firstController.abort();
  secondController.abort();
  await Promise.all([first.return?.(), second.return?.()]);
});

test('old cursors return a same-epoch gap without affecting another Session', async () => {
  const sessionA = asDefSessionId('cache-session-a');
  const sessionB = asDefSessionId('cache-session-b');
  const fixtureA = createConversationFixture({
    sessionId: sessionA,
    engineSession: { ...createConversationFixture().engineSession, sessionId: asEngineSessionId('cache-engine-a') },
  });
  const fixtureB = createConversationFixture({
    sessionId: sessionB,
    engineSession: { ...createConversationFixture().engineSession, sessionId: asEngineSessionId('cache-engine-b') },
  });
  const runtime: RuntimeTranscriptSource = {
    getRuntimeSnapshot: (session) => session.sessionId === fixtureA.engineSession.sessionId
      ? fixtureA.runtime.getRuntimeSnapshot(session)
      : fixtureB.runtime.getRuntimeSnapshot(session),
    subscribeRuntime: (session, after, signal) => session.sessionId === fixtureA.engineSession.sessionId
      ? fixtureA.runtime.subscribeRuntime(session, after, signal)
      : fixtureB.runtime.subscribeRuntime(session, after, signal),
  };
  const host: ConversationHostJournalSource = {
    getSession: (session) => session === sessionA ? fixtureA.host.getSession(session) : fixtureB.host.getSession(session),
    getSnapshot: (session) => session === sessionA ? fixtureA.host.getSnapshot(session) : fixtureB.host.getSnapshot(session),
    subscribe: (session, after, signal) => session === sessionA
      ? fixtureA.host.subscribe(session, after, signal)
      : fixtureB.host.subscribe(session, after, signal),
  };
  const projectorInstance = new ConversationProjector({
    runtime,
    host,
    epoch: 'cache-epoch',
    createEpoch: (previous) => `${previous}-next`,
  });
  const initialA = await projectorInstance.getSnapshot(sessionA);
  const initialB = await projectorInstance.getSnapshot(sessionB);
  for (let index = 0; index < 9; index += 1) {
    fixtureA.runtime.append({
      type: 'part.delta',
      messageId: FIXTURE_ASSISTANT_MESSAGE_ID,
      partId: FIXTURE_TEXT_PART_ID,
      field: 'text',
      delta: 'x',
    }, 7 + index);
    await projectorInstance.getSnapshot(sessionA);
  }

  const [reset] = await collect(projectorInstance.subscribe(sessionA, initialA.cursor));
  assert.equal(reset?.type, 'conversation.reset-required');
  assert.equal(reset?.reason, 'gap');
  assert.equal(reset?.cursor.epoch, initialA.cursor.epoch);
  assert.deepEqual(await collect(projectorInstance.subscribe(sessionB, initialB.cursor)), []);
});

test('projector cancellation settles against uncooperative next and return methods', async () => {
  const fixture = createConversationFixture();
  const runtime: RuntimeTranscriptSource = {
    getRuntimeSnapshot: (session) => fixture.runtime.getRuntimeSnapshot(session),
    subscribeRuntime: () => neverAsyncIterable<RuntimeTranscriptEvent>(),
  };
  const host: ConversationHostJournalSource = {
    getSession: (session) => fixture.host.getSession(session),
    getSnapshot: (session) => fixture.host.getSnapshot(session),
    subscribe: () => neverAsyncIterable<DefEvent>(),
  };
  const projectorInstance = new ConversationProjector({ runtime, host, epoch: 'uncooperative-epoch' });
  const snapshot = await projectorInstance.getSnapshot(fixture.sessionId);
  const controller = new AbortController();
  const iterator = projectorInstance.subscribe(fixture.sessionId, snapshot.cursor, controller.signal)[Symbol.asyncIterator]();
  const pending = iterator.next();
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  controller.abort();
  const result = await settlesWithin(pending);
  assert.equal(result.done, true);
});

test('Host authority cannot regress and Runtime projection preserves Host-only parts', async () => {
  const fixture = createConversationFixture();
  fixture.host.append(hostToolRequested(fixture.sessionId, 1));
  fixture.host.append(hostToolStarted(fixture.sessionId, 2));
  fixture.host.append(hostToolResult(fixture.sessionId, 3, { authoritative: true }));
  const projectorInstance = projector(fixture);
  const completed = await projectorInstance.getSnapshot(fixture.sessionId);

  fixture.runtime.append({
    type: 'part.upsert',
    part: {
      id: FIXTURE_TOOL_PART_ID,
      messageId: FIXTURE_ASSISTANT_MESSAGE_ID,
      createdAt: NOW,
      type: 'tool',
      toolCallId: part(completed, 'tool').toolCallId,
      name: 'fixture.tool',
      state: { status: 'pending', input: { late: true } },
    },
    index: 2,
  }, 7);
  const [lateRuntime] = await collect(projectorInstance.subscribe(fixture.sessionId, completed.cursor));
  assert.equal(lateRuntime?.type, 'part.upsert');
  assert.equal(lateRuntime?.type === 'part.upsert' && lateRuntime.part.type === 'tool'
    ? lateRuntime.part.state.status
    : null, 'completed');
  let live = applyTestEvent(completed, lateRuntime as Extract<ConversationEvent, { source: 'runtime' | 'host' }>);
  assert.deepEqual(live, await projectorInstance.getSnapshot(fixture.sessionId));

  fixture.host.append(hostInteractionRequested(fixture.sessionId, 4));
  const withInteraction = await projectorInstance.getSnapshot(fixture.sessionId);
  const interaction = part(withInteraction, 'interaction');
  const runtimeMessage = fixture.runtimeSnapshot.messages.find((message) => message.id === FIXTURE_ASSISTANT_MESSAGE_ID)!;
  fixture.runtime.append({
    type: 'message.upsert',
    message: { ...runtimeMessage, partIds: runtimeMessage.partIds.filter((id) => id !== interaction.id) },
    index: 1,
  }, 8);
  const [messageEvent] = await collect(projectorInstance.subscribe(fixture.sessionId, withInteraction.cursor));
  assert.equal(messageEvent?.type, 'message.upsert');
  assert.equal(messageEvent?.type === 'message.upsert' && messageEvent.message.partIds.includes(interaction.id), true);
  live = applyTestEvent(withInteraction, messageEvent as Extract<ConversationEvent, { source: 'runtime' | 'host' }>);
  assert.deepEqual(live, await projectorInstance.getSnapshot(fixture.sessionId));
});

test('effective status updates atomically for Tool priority, Interaction, and a new Runtime Turn', async () => {
  const fixture = createConversationFixture();
  fixture.host.append(hostToolResult(fixture.sessionId, 1));
  const projectorInstance = projector(fixture);
  let boundary = await projectorInstance.getSnapshot(fixture.sessionId);
  assert.deepEqual(boundary.status, { status: 'idle' });

  fixture.host.append(hostInteractionRequested(fixture.sessionId, 2));
  const [interactionEvent] = await collect(projectorInstance.subscribe(fixture.sessionId, boundary.cursor));
  assert.equal(interactionEvent?.type, 'interaction.upsert');
  assert.deepEqual(interactionEvent?.source === 'host' ? interactionEvent.status : null, {
    status: 'waiting-interaction',
    defTurnId: FIXTURE_TURN_ID,
    interactionId: part(await projectorInstance.getSnapshot(fixture.sessionId), 'interaction').interactionId,
  });

  boundary = await projectorInstance.getSnapshot(fixture.sessionId);
  fixture.runtime.append({ type: 'session.status', status: { status: 'running' } }, 7);
  const [running] = await collect(projectorInstance.subscribe(fixture.sessionId, boundary.cursor));
  assert.deepEqual(running?.source === 'runtime' ? running.status : null, {
    status: 'waiting-interaction',
    defTurnId: FIXTURE_TURN_ID,
    interactionId: part(boundary, 'interaction').interactionId,
  });

  fixture.host.append(hostInteractionResolved(fixture.sessionId, 3));
  fixture.host.append({
    schemaVersion: 1,
    sequence: 4,
    occurredAt: NOW,
    defSessionId: fixture.sessionId,
    defTurnId: FIXTURE_TURN_ID,
    type: 'turn.completed',
    payload: {},
  });
  boundary = await projectorInstance.getSnapshot(fixture.sessionId);
  assert.deepEqual(boundary.status, { status: 'idle' });
  const nextTurn = asDefTurnId('conversation-next-turn');
  fixture.runtime.append({
    type: 'message.upsert',
    message: {
      id: asConversationMessageId('conversation-next-message'),
      role: 'assistant',
      defTurnId: nextTurn,
      createdAt: NOW,
      partIds: [],
    },
    index: boundary.messages.length,
  }, 8);
  const [newTurn] = await collect(projectorInstance.subscribe(fixture.sessionId, boundary.cursor));
  assert.equal(newTurn?.type, 'message.upsert');
  assert.deepEqual(newTurn?.source === 'runtime' ? newTurn.status : null, { status: 'running', defTurnId: nextTurn });
  assert.deepEqual(applyTestEvent(boundary, newTurn as Extract<ConversationEvent, { source: 'runtime' | 'host' }>), await projectorInstance.getSnapshot(fixture.sessionId));
});

test('Host journal validation rejects sequence gaps, unknown variants, and terminal regressions', async () => {
  const gap = createConversationFixture();
  gap.host.append(hostToolRequested(gap.sessionId, 1));
  gap.host.append(hostToolResult(gap.sessionId, 3));
  await assert.rejects(() => projector(gap).getSnapshot(gap.sessionId), (error: unknown) => (
    error instanceof ConversationProjectionError && error.code === 'SOURCE_GAP'
  ));

  const unknown = createConversationFixture();
  unknown.host.append({
    ...hostToolRequested(unknown.sessionId, 1),
    type: 'tool.unknown',
  } as unknown as DefEvent);
  await assert.rejects(() => projector(unknown).getSnapshot(unknown.sessionId), (error: unknown) => (
    error instanceof ConversationProjectionError && error.code === 'SOURCE_INVALID'
  ));

  const toolRegression = createConversationFixture();
  toolRegression.host.append(hostToolResult(toolRegression.sessionId, 1));
  toolRegression.host.append(hostToolStarted(toolRegression.sessionId, 2));
  await assert.rejects(() => projector(toolRegression).getSnapshot(toolRegression.sessionId), (error: unknown) => (
    error instanceof ConversationProjectionError && error.code === 'SOURCE_INVALID'
  ));

  const interactionRegression = createConversationFixture();
  interactionRegression.host.append(hostInteractionRequested(interactionRegression.sessionId, 1));
  interactionRegression.host.append(hostInteractionResolved(interactionRegression.sessionId, 2));
  interactionRegression.host.append(hostInteractionRequested(interactionRegression.sessionId, 3));
  await assert.rejects(() => projector(interactionRegression).getSnapshot(interactionRegression.sessionId), (error: unknown) => (
    error instanceof ConversationProjectionError && error.code === 'SOURCE_INVALID'
  ));
});

test('Part identity remains frozen across Runtime upserts', async () => {
  const fixture = createConversationFixture();
  const projectorInstance = projector(fixture);
  const boundary = await projectorInstance.getSnapshot(fixture.sessionId);
  fixture.runtime.append({
    type: 'part.upsert',
    part: {
      id: FIXTURE_TEXT_PART_ID,
      messageId: FIXTURE_ASSISTANT_MESSAGE_ID,
      createdAt: NOW,
      type: 'tool',
      toolCallId: part(boundary, 'tool').toolCallId,
      name: 'identity-change',
      state: { status: 'pending', input: {} },
    },
    index: 0,
  }, 7);
  const [reset] = await collect(projectorInstance.subscribe(fixture.sessionId, boundary.cursor));
  assert.equal(reset?.type, 'conversation.reset-required');
  assert.equal(reset?.reason, 'gap');
});

test('SessionStore adapter pages Host journals and Session LRU re-entry receives a new epoch', async () => {
  const fixture = createConversationFixture();
  const journal = [hostToolRequested(fixture.sessionId, 1), hostToolResult(fixture.sessionId, 2)];
  let loadEventsCalls = 0;
  let loadPageCalls = 0;
  const source = createConversationHostJournalSource({
    loadSession: () => ({ session: { engine: fixture.engineSession } }) as never,
    loadEvents: () => {
      loadEventsCalls += 1;
      return journal;
    },
    loadEventPage: (_session, after, limit) => {
      loadPageCalls += 1;
      return journal.filter((event) => event.sequence > after).slice(0, limit);
    },
  });
  assert.equal((await source.getSnapshot(fixture.sessionId)).sequence, 2);
  assert.equal(loadEventsCalls, 0);
  assert.ok(loadPageCalls > 0);

  const fixtures = Array.from({ length: 66 }, (_, index) => createConversationFixture({
    sessionId: asDefSessionId(`lru-session-${index}`),
    engineSession: { ...fixture.engineSession, sessionId: asEngineSessionId(`lru-engine-${index}`) },
  }));
  const byEngine = new Map(fixtures.map((entry) => [entry.engineSession.sessionId, entry]));
  const bySession = new Map(fixtures.map((entry) => [entry.sessionId, entry]));
  const runtime: RuntimeTranscriptSource = {
    getRuntimeSnapshot: (engine) => byEngine.get(engine.sessionId)!.runtime.getRuntimeSnapshot(engine),
    subscribeRuntime: (engine, after, signal) => byEngine.get(engine.sessionId)!.runtime.subscribeRuntime(engine, after, signal),
  };
  const host: ConversationHostJournalSource = {
    getSession: (session) => bySession.get(session)?.host.getSession(session) ?? null,
    getSnapshot: (session) => bySession.get(session)!.host.getSnapshot(session),
    subscribe: (session, after, signal) => bySession.get(session)!.host.subscribe(session, after, signal),
  };
  const bounded = new ConversationProjector({ runtime, host, epoch: 'lru-epoch' });
  const first = await bounded.getSnapshot(fixtures[0]!.sessionId);
  for (const entry of fixtures.slice(1)) await bounded.getSnapshot(entry.sessionId);
  const reentered = await bounded.getSnapshot(fixtures[0]!.sessionId);
  assert.notEqual(reentered.cursor.epoch, first.cursor.epoch);
});

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = [];
  for await (const value of iterable) values.push(value);
  return values;
}

function applyTestEvent(
  snapshot: ConversationSnapshot,
  event: Extract<ConversationEvent, { source: 'runtime' | 'host' }>,
): ConversationSnapshot {
  const next: ConversationSnapshot = {
    ...snapshot,
    cursor: structuredClone(event.cursor),
    status: structuredClone(event.status),
    messages: snapshot.messages,
    parts: snapshot.parts,
  };
  if (event.type === 'message.upsert') {
    const messages = snapshot.messages.filter((message) => message.id !== event.message.id);
    messages.splice(Math.min(event.index, messages.length), 0, structuredClone(event.message));
    return { ...next, messages };
  }
  if (event.type === 'message.remove') {
    return {
      ...next,
      messages: snapshot.messages.filter((message) => message.id !== event.messageId),
      parts: snapshot.parts.filter((part) => part.messageId !== event.messageId),
    };
  }
  if (event.type === 'part.upsert' || event.type === 'interaction.upsert') {
    const parts = snapshot.parts.filter((part) => part.id !== event.part.id);
    parts.splice(Math.min(event.index, parts.length), 0, structuredClone(event.part));
    return { ...next, messages: addTestPartId(snapshot.messages, event.part.messageId, event.part.id), parts };
  }
  if (event.type === 'part.delta') {
    const parts = snapshot.parts.map((part) => part.id === event.partId
      && (part.type === 'text' || part.type === 'reasoning')
      ? { ...part, text: part.text + event.delta }
      : part);
    return { ...next, parts };
  }
  if (event.type === 'part.remove' || event.type === 'interaction.remove') {
    return {
      ...next,
      parts: snapshot.parts.filter((part) => part.id !== event.partId),
      messages: removeTestPartId(snapshot.messages, event.messageId, event.partId),
    };
  }
  return next;
}

function addTestPartId(
  messages: ConversationSnapshot['messages'],
  messageId: ConversationSnapshot['messages'][number]['id'],
  partId: ConversationSnapshot['parts'][number]['id'],
): ConversationSnapshot['messages'] {
  return messages.map((message) => message.id === messageId && !message.partIds.includes(partId)
    ? { ...message, partIds: [...message.partIds, partId] }
    : message);
}

function removeTestPartId(
  messages: ConversationSnapshot['messages'],
  messageId: ConversationSnapshot['messages'][number]['id'],
  partId: ConversationSnapshot['parts'][number]['id'],
): ConversationSnapshot['messages'] {
  return messages.map((message) => message.id === messageId
    ? { ...message, partIds: message.partIds.filter((candidate) => candidate !== partId) }
    : message);
}

/** Test source whose append path does not copy the large transcript. */
class QueuedRuntimeSource implements RuntimeTranscriptSource {
  readonly #snapshot: RuntimeTranscriptSnapshot;
  readonly #events: RuntimeTranscriptEvent[] = [];
  readonly #waiters: Array<() => void> = [];
  #closed = false;

  constructor(snapshot: RuntimeTranscriptSnapshot) {
    this.#snapshot = structuredClone(snapshot);
  }

  getRuntimeSnapshot(): Promise<RuntimeTranscriptSnapshot> {
    return Promise.resolve(structuredClone(this.#snapshot));
  }

  subscribeRuntime(
    _session: RuntimeTranscriptEvent['engineSession'],
    afterRuntimeSequence: number,
    signal?: AbortSignal,
  ): AsyncIterable<RuntimeTranscriptEvent> {
    return this.#subscribe(afterRuntimeSequence, signal);
  }

  append(event: RuntimeTranscriptEvent): void {
    this.#events.push(structuredClone(event));
    this.#wake();
  }

  async *#subscribe(afterRuntimeSequence: number, signal?: AbortSignal): AsyncIterable<RuntimeTranscriptEvent> {
    const onAbort = () => this.#wake();
    signal?.addEventListener('abort', onAbort, { once: true });
    let cursor = afterRuntimeSequence;
    let eventIndex = 0;
    try {
      while (!this.#closed && !signal?.aborted) {
        while (this.#events[eventIndex] && this.#events[eventIndex]!.sequence <= cursor) eventIndex += 1;
        const event = this.#events[eventIndex];
        if (event) {
          eventIndex += 1;
          cursor = event.sequence;
          yield structuredClone(event);
          continue;
        }
        await new Promise<void>((resolve) => this.#waiters.push(resolve));
      }
    } finally {
      signal?.removeEventListener('abort', onAbort);
    }
  }

  #wake(): void {
    const waiters = this.#waiters.splice(0);
    for (const resolve of waiters) resolve();
  }
}

function neverAsyncIterable<T>(): AsyncIterable<T> {
  const iterator: AsyncIterator<T> = {
    next: () => new Promise<IteratorResult<T>>(() => {}),
    return: () => new Promise<IteratorResult<T>>(() => {}),
  };
  return { [Symbol.asyncIterator]: () => iterator };
}

async function settlesWithin<T>(promise: Promise<T>, limitMs = 1_000): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`promise did not settle within ${limitMs}ms`)), limitMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
