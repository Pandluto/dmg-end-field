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
import {
  asConversationMessageId,
  asConversationPartId,
  asDefTurnId,
  type ConversationEvent,
  type ConversationProjector as ConversationProjectorContract,
  type ConversationSnapshot,
  type DefSessionId,
} from '../../agent/core/contracts/index.ts';
import { selectConversationTurns } from './components/session-model.ts';

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
    status: { status: 'idle' },
    messageId: FIXTURE_ASSISTANT_MESSAGE_ID,
    partId: FIXTURE_ERROR_PART_ID,
  });
  const removedSnapshot = reduceConversationEvent(after, removed);
  assert.equal(removedSnapshot?.parts.some((part) => part.id === FIXTURE_ERROR_PART_ID), false);
  assert.equal(removedSnapshot?.messages[1]?.partIds.includes(FIXTURE_ERROR_PART_ID), false);
});

test('session read model projects every persisted Turn in transcript order', async () => {
  const fixture = createConversationFixture();
  const base = await new ConversationProjector({
    runtime: fixture.runtime,
    host: fixture.host,
    epoch: 'all-turns',
  }).getSnapshot(fixture.sessionId);
  const secondTurnId = asDefTurnId('conversation-second-turn');
  const secondUserId = asConversationMessageId('message-user-second');
  const secondAssistantId = asConversationMessageId('message-assistant-second');
  const secondTextId = asConversationPartId('part-text-second');
  const snapshot: ConversationSnapshot = {
    ...base,
    messages: [
      ...base.messages,
      {
        id: secondUserId,
        role: 'user',
        defTurnId: secondTurnId,
        createdAt: '2026-08-08T00:01:00.000Z',
        completedAt: '2026-08-08T00:01:00.000Z',
        partIds: [],
      },
      {
        id: secondAssistantId,
        role: 'assistant',
        defTurnId: secondTurnId,
        createdAt: '2026-08-08T00:01:01.000Z',
        completedAt: '2026-08-08T00:01:02.000Z',
        partIds: [secondTextId],
      },
    ],
    parts: [
      ...base.parts,
      {
        id: secondTextId,
        messageId: secondAssistantId,
        createdAt: '2026-08-08T00:01:01.000Z',
        completedAt: '2026-08-08T00:01:02.000Z',
        type: 'text',
        text: 'second reply',
      },
    ],
  };

  const turns = selectConversationTurns(snapshot);
  assert.equal(turns.length, 2);
  assert.equal(turns[0]?.turnId, base.messages[0]?.defTurnId);
  assert.equal(turns[1]?.turnId, secondTurnId);
  assert.equal(turns[1]?.assistantMessages[0]?.id, secondAssistantId);
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

test('a cursor produced by live progress is a same-epoch gap after reconnect, then Store refetches', async () => {
  const fixture = createConversationFixture();
  const projector = new ConversationProjector({
    runtime: fixture.runtime,
    host: fixture.host,
    epoch: 'boundary-gap',
  });
  const initial = await projector.getSnapshot(fixture.sessionId);
  fixture.runtime.append({
    type: 'part.delta',
    messageId: FIXTURE_ASSISTANT_MESSAGE_ID,
    partId: FIXTURE_TEXT_PART_ID,
    field: 'text',
    delta: ' + live reconnect',
  }, 7);
  const [liveEvent] = await collect(projector.subscribe(fixture.sessionId, initial.cursor));
  assert.ok(liveEvent && liveEvent.source !== 'projector');
  const [gap] = await collect(projector.subscribe(fixture.sessionId, liveEvent!.cursor));
  assert.equal(gap?.type, 'conversation.reset-required');
  assert.equal(gap?.reason, 'gap');
  assert.equal(gap?.cursor.epoch, initial.cursor.epoch);

  const fresh = await projector.getSnapshot(fixture.sessionId);
  const source = scriptedSource(
    fixture.sessionId,
    initial,
    fresh,
    [resetEvent(fixture.sessionId, liveEvent!.cursor, 'gap')],
  );
  const store = new BrowserConversationStore(source);
  await store.connect(fixture.sessionId);
  assert.equal(source.getSnapshotCalls, 2);
  assert.deepEqual(store.snapshot, fresh);
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

test('disconnect settles when the source ignores abort and never settles next or return', async () => {
  const fixture = createConversationFixture();
  const snapshot = await new ConversationProjector({
    runtime: fixture.runtime,
    host: fixture.host,
    epoch: 'store-uncooperative',
  }).getSnapshot(fixture.sessionId);
  const source: ConversationProjectorContract = {
    async getSnapshot() {
      return structuredClone(snapshot);
    },
    subscribe() {
      return neverAsyncIterable<ConversationEvent>();
    },
  };
  const store = new BrowserConversationStore(source);
  const connection = store.connect(fixture.sessionId);
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  store.disconnect();
  await settlesWithin(connection);
  assert.equal(store.state.status, 'disconnected');
});

test('listeners receive isolated immutable views and one throwing listener cannot poison connection state', async () => {
  const fixture = createConversationFixture();
  const projector = new ConversationProjector({ runtime: fixture.runtime, host: fixture.host, epoch: 'listener-isolation' });
  const store = new BrowserConversationStore(projector);
  const seen: Array<ReturnType<typeof store.getState>> = [];
  store.subscribe((state) => {
    if (state.snapshot) assert.throws(() => (state.snapshot!.parts as ConversationSnapshot['parts'] & unknown[]).push({} as never), TypeError);
    throw new Error('listener failure must be isolated');
  });
  store.subscribe((state) => seen.push(state));
  await store.load(fixture.sessionId);
  assert.equal(store.state.status, 'ready');
  assert.ok(seen.length > 0);
  assert.equal(seen.at(-1)?.snapshot?.parts.length, store.snapshot?.parts.length);
  assert.notEqual(seen.at(-1), store.state);
});

test('Store rejects Part identity changes', async () => {
  const fixture = createConversationFixture();
  const projector = new ConversationProjector({ runtime: fixture.runtime, host: fixture.host, epoch: 'store-identity' });
  const store = new BrowserConversationStore(projector);
  const snapshot = await store.load(fixture.sessionId);
  const identityChange: ConversationEvent = {
    schemaVersion: 1,
    source: 'runtime',
    sourceSequence: snapshot.cursor.runtimeSequence + 1,
    defSessionId: fixture.sessionId,
    occurredAt: '2026-08-08T00:00:00.000Z',
    cursor: { ...snapshot.cursor, runtimeSequence: snapshot.cursor.runtimeSequence + 1 },
    status: snapshot.status,
    type: 'part.upsert',
    index: 0,
    part: {
      id: FIXTURE_TEXT_PART_ID,
      messageId: FIXTURE_ASSISTANT_MESSAGE_ID,
      createdAt: '2026-08-08T00:00:00.000Z',
      type: 'file',
      mime: 'text/plain',
      filename: 'changed.txt',
      url: 'data:text/plain,changed',
    },
  };
  assert.throws(() => store.apply(identityChange), (error: unknown) => (
    error instanceof ConversationStoreError && error.code === 'INVALID_EVENT'
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
