import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ConversationProjector,
} from '../../agent/host/conversation-projector.ts';
import {
  createConversationFixture,
  FIXTURE_ASSISTANT_MESSAGE_ID,
  FIXTURE_ERROR_PART_ID,
  FIXTURE_TEXT_PART_ID,
  hostInteractionRequested,
  hostInteractionResolved,
  hostToolStarted,
} from '../../agent/host/testing/conversation-fixtures.ts';
import {
  BrowserConversationStore,
  ConversationStoreError,
  reduceConversationEvent,
} from './conversation-store.ts';
import type {
  ConversationEvent,
  ConversationProjector as ConversationProjectorContract,
  ConversationSnapshot,
  DefSessionId,
} from '../../agent/core/contracts/index.ts';

test('reduces snapshot and deltas without duplicate Message/Part rows', async () => {
  const fixture = createConversationFixture();
  const projector = new ConversationProjector({
    runtime: fixture.runtime,
    host: fixture.host,
    epoch: 'store-epoch',
    createEpoch: (previous) => `${previous}-next`,
  });
  const store = new BrowserConversationStore(projector);
  const snapshot = await store.load(fixture.sessionId);
  assert.equal(store.state.status, 'ready');
  assert.deepEqual(store.state.cursor, snapshot.cursor);

  fixture.runtime.append({
    type: 'part.delta',
    messageId: FIXTURE_ASSISTANT_MESSAGE_ID,
    partId: FIXTURE_TEXT_PART_ID,
    field: 'text',
    delta: ' + browser',
  }, 7);
  fixture.host.append(hostToolStarted(fixture.sessionId, 1));
  const events = await collect(projector.subscribe(fixture.sessionId, snapshot.cursor));
  assert.equal(events.length, 2);
  for (const event of events) store.apply(event);
  const after = store.snapshot!;
  assert.equal(after.cursor.runtimeSequence, 7);
  assert.equal(after.cursor.hostSequence, 1);
  assert.equal(after.parts.filter((part) => part.id === FIXTURE_TEXT_PART_ID).length, 1);
  assert.equal(after.parts.filter((part) => part.id === 'part-tool-fixture').length, 1);
  const textPart = after.parts.find((part) => part.id === FIXTURE_TEXT_PART_ID);
  assert.equal(textPart?.type, 'text');
  assert.equal(textPart?.type === 'text' ? textPart.text : '', 'fixture text + browser');

  const duplicate = events[0]!;
  const beforeDuplicate = store.snapshot;
  assert.deepEqual(store.apply(duplicate), beforeDuplicate);
  assert.deepEqual(store.snapshot?.parts.map((part) => part.id), after.parts.map((part) => part.id));

  const removed = makeRuntimeEventLike(events.find((event) => event.type === 'part.remove') ?? {
    schemaVersion: 1,
    source: 'runtime',
    sourceSequence: 8,
    defSessionId: fixture.sessionId,
    occurredAt: '2026-08-08T00:00:00.000Z',
    cursor: { ...after.cursor, runtimeSequence: 8 },
    type: 'part.remove',
    messageId: FIXTURE_ASSISTANT_MESSAGE_ID,
    partId: FIXTURE_ERROR_PART_ID,
  });
  const removedSnapshot = reduceConversationEvent(after, removed);
  assert.equal(removedSnapshot?.parts.some((part) => part.id === FIXTURE_ERROR_PART_ID), false);
  assert.equal(removedSnapshot?.messages[1]?.partIds.includes(FIXTURE_ERROR_PART_ID), false);
});

test('reduces interaction upsert/resolution and keeps interaction identity stable', async () => {
  const fixture = createConversationFixture();
  const projector = new ConversationProjector({ runtime: fixture.runtime, host: fixture.host, epoch: 'interaction-store' });
  const store = new BrowserConversationStore(projector);
  const snapshot = await store.load(fixture.sessionId);
  fixture.host.append(hostInteractionRequested(fixture.sessionId, 1));
  fixture.host.append(hostInteractionResolved(fixture.sessionId, 2));
  const events = await collect(projector.subscribe(fixture.sessionId, snapshot.cursor));
  assert.deepEqual(events.map((event) => event.type), ['interaction.upsert', 'interaction.upsert']);
  store.apply(events[0]!);
  const pendingId = store.snapshot?.parts.find((part) => part.type === 'interaction')?.id;
  store.apply(events[1]!);
  const resolved = store.snapshot?.parts.find((part) => part.type === 'interaction');
  assert.equal(resolved?.id, pendingId);
  assert.equal(resolved?.type === 'interaction' ? resolved.state.status : '', 'resolved');
  assert.equal(store.snapshot?.messages[1]?.partIds.filter((id) => id === pendingId).length, 1);
});

test('connect refetches after projector reset or a forward source gap', async () => {
  const fixture = createConversationFixture();
  const base = await new ConversationProjector({ runtime: fixture.runtime, host: fixture.host, epoch: 'base' }).getSnapshot(fixture.sessionId);
  const refetched: ConversationSnapshot = {
    ...base,
    cursor: { epoch: 'refetched', runtimeSequence: 8, hostSequence: 0 },
  };
  const reset = resetEvent(fixture.sessionId, { epoch: 'next', runtimeSequence: 6, hostSequence: 0 }, 'gap');
  const source = scriptedSource(fixture.sessionId, base, refetched, [reset]);
  const store = new BrowserConversationStore(source);
  await store.connect(fixture.sessionId);
  assert.equal(source.getSnapshotCalls, 2);
  assert.equal(store.state.status, 'disconnected');
  assert.equal(store.snapshot?.cursor.epoch, 'refetched');
  assert.equal(store.snapshot?.cursor.runtimeSequence, 8);

  const gapSource = scriptedSource(fixture.sessionId, base, refetched, [{
    schemaVersion: 1,
    source: 'runtime',
    sourceSequence: 8,
    defSessionId: fixture.sessionId,
    occurredAt: '2026-08-08T00:00:00.000Z',
    cursor: { epoch: base.cursor.epoch, runtimeSequence: 8, hostSequence: 0 },
    type: 'session.status',
    status: { status: 'idle' },
  }]);
  const gapStore = new BrowserConversationStore(gapSource);
  await gapStore.connect(fixture.sessionId);
  assert.equal(gapSource.getSnapshotCalls, 2);
  assert.equal(gapStore.snapshot?.cursor.epoch, 'refetched');
});

test('epoch changes are fail-closed for direct reducer callers', async () => {
  const fixture = createConversationFixture();
  const projector = new ConversationProjector({ runtime: fixture.runtime, host: fixture.host, epoch: 'store-epoch' });
  const store = new BrowserConversationStore(projector);
  const snapshot = await store.load(fixture.sessionId);
  const event: ConversationEvent = {
    schemaVersion: 1,
    source: 'runtime',
    sourceSequence: snapshot.cursor.runtimeSequence + 1,
    defSessionId: fixture.sessionId,
    occurredAt: '2026-08-08T00:00:00.000Z',
    cursor: {
      epoch: 'new-projector',
      runtimeSequence: snapshot.cursor.runtimeSequence + 1,
      hostSequence: snapshot.cursor.hostSequence,
    },
    type: 'session.status',
    status: { status: 'idle' },
  };
  assert.throws(() => store.apply(event), (error: unknown) => (
    error instanceof ConversationStoreError && error.code === 'EPOCH_CHANGED'
  ));
});

function scriptedSource(
  sessionId: DefSessionId,
  initial: ConversationSnapshot,
  refetched: ConversationSnapshot,
  events: readonly ConversationEvent[],
): ConversationProjectorContract & { readonly getSnapshotCalls: number } {
  let getSnapshotCalls = 0;
  let subscribed = false;
  return {
    get getSnapshotCalls() {
      return getSnapshotCalls;
    },
    async getSnapshot(requestedSessionId) {
      assert.equal(requestedSessionId, sessionId);
      getSnapshotCalls += 1;
      return getSnapshotCalls === 1 ? structuredClone(initial) : structuredClone(refetched);
    },
    subscribe(requestedSessionId) {
      assert.equal(requestedSessionId, sessionId);
      if (subscribed) return emptyAsyncIterable<ConversationEvent>();
      subscribed = true;
      return finiteAsyncIterable(events);
    },
  };
}

function resetEvent(
  sessionId: DefSessionId,
  cursor: ConversationSnapshot['cursor'],
  reason: 'epoch-changed' | 'gap',
): ConversationEvent {
  return {
    schemaVersion: 1,
    source: 'projector',
    sourceSequence: 0,
    defSessionId: sessionId,
    occurredAt: '2026-08-08T00:00:00.000Z',
    cursor,
    type: 'conversation.reset-required',
    reason,
  };
}

function makeRuntimeEventLike(event: ConversationEvent): ConversationEvent {
  return event;
}

function finiteAsyncIterable<T>(values: readonly T[]): AsyncIterable<T> {
  return {
    async *[Symbol.asyncIterator](): AsyncIterator<T> {
      yield* values;
    },
  };
}

function emptyAsyncIterable<T>(): AsyncIterable<T> {
  return {
    async *[Symbol.asyncIterator](): AsyncIterator<T> {
      return;
    },
  };
}

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = [];
  for await (const value of iterable) values.push(value);
  return values;
}
