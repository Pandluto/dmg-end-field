import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ConversationProjectionError,
  ConversationProjector,
  type ConversationHostJournalSource,
} from './conversation-projector.ts';
import {
  createConversationFixture,
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
  asDefSessionId,
  type ConversationPart,
  type DefEvent,
  type RuntimeTranscriptMutation,
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
  assert.equal(part(snapshot, 'interaction').state.status, 'resolved');
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

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = [];
  for await (const value of iterable) values.push(value);
  return values;
}
