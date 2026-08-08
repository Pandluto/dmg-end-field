import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertConversationEventTransition,
  conversationCursorEquals,
  parseConversationCursor,
  type ConversationEvent,
  type HostTranscriptPart,
  type RuntimeTranscriptPart,
} from './conversation.ts';
import { asDefSessionId, asDefTurnId } from './ids.ts';

const runtimeInteractionOwnership:
  Extract<RuntimeTranscriptPart, { type: 'interaction' }> extends never ? true : false = true;
const hostTextOwnership:
  Extract<HostTranscriptPart, { type: 'text' }> extends never ? true : false = true;

test('Conversation part ownership is frozen by source', () => {
  assert.equal(runtimeInteractionOwnership, true);
  assert.equal(hostTextOwnership, true);
});

test('Conversation cursor accepts only the composite high-water marks', () => {
  const cursor = parseConversationCursor({
    epoch: 'host-epoch_1',
    runtimeSequence: 17,
    hostSequence: 29,
  });

  assert.deepEqual(cursor, {
    epoch: 'host-epoch_1',
    runtimeSequence: 17,
    hostSequence: 29,
  });
  assert.equal(conversationCursorEquals(cursor, { ...cursor }), true);
  assert.equal(conversationCursorEquals(cursor, { ...cursor, hostSequence: 30 }), false);
});

test('Conversation cursor rejects missing, extra, unsafe, or invalid fields', () => {
  for (const value of [
    null,
    {},
    { epoch: 'a', runtimeSequence: 0 },
    { epoch: 'a', runtimeSequence: 0, hostSequence: 0, sequence: 0 },
    { epoch: '', runtimeSequence: 0, hostSequence: 0 },
    { epoch: 'contains space', runtimeSequence: 0, hostSequence: 0 },
    { epoch: 'a', runtimeSequence: -1, hostSequence: 0 },
    { epoch: 'a', runtimeSequence: 0.5, hostSequence: 0 },
    { epoch: 'a', runtimeSequence: 0, hostSequence: Number.MAX_SAFE_INTEGER + 1 },
  ]) {
    assert.throws(() => parseConversationCursor(value), TypeError);
  }
});

test('Conversation event transitions advance exactly one source cursor', () => {
  const defSessionId = asDefSessionId('session-1');
  const snapshotCursor = { epoch: 'epoch-1', runtimeSequence: 3, hostSequence: 7 };
  const snapshot: ConversationEvent = {
    schemaVersion: 1,
    type: 'conversation.snapshot',
    source: 'projector',
    sourceSequence: 0,
    defSessionId,
    occurredAt: '2026-08-08T00:00:00.000Z',
    cursor: snapshotCursor,
    snapshot: {
      schemaVersion: 1,
      defSessionId,
      cursor: snapshotCursor,
      status: { status: 'idle' },
      messages: [],
      parts: [],
    },
  };
  assert.doesNotThrow(() => assertConversationEventTransition(null, snapshot));

  const runtimeEvent: ConversationEvent = {
    schemaVersion: 1,
    type: 'session.status',
    source: 'runtime',
    sourceSequence: 4,
    defSessionId,
    occurredAt: '2026-08-08T00:00:01.000Z',
    cursor: { epoch: 'epoch-1', runtimeSequence: 4, hostSequence: 7 },
    status: { status: 'running', defTurnId: asDefTurnId('turn-1') },
  };
  assert.doesNotThrow(() => assertConversationEventTransition(snapshotCursor, runtimeEvent));

  const hostEvent: ConversationEvent = {
    schemaVersion: 1,
    type: 'session.status',
    source: 'host',
    sourceSequence: 8,
    defSessionId,
    occurredAt: '2026-08-08T00:00:02.000Z',
    cursor: { epoch: 'epoch-1', runtimeSequence: 4, hostSequence: 8 },
    status: { status: 'idle' },
  };
  assert.doesNotThrow(() => assertConversationEventTransition(runtimeEvent.cursor, hostEvent));
});

test('Conversation event transitions reject gaps, cross-source movement, and snapshot mismatch', () => {
  const defSessionId = asDefSessionId('session-1');
  const previous = { epoch: 'epoch-1', runtimeSequence: 3, hostSequence: 7 };
  const base = {
    schemaVersion: 1,
    type: 'session.status',
    source: 'runtime',
    sourceSequence: 5,
    defSessionId,
    occurredAt: '2026-08-08T00:00:01.000Z',
    status: { status: 'idle' },
  } as const;

  assert.throws(
    () => assertConversationEventTransition(previous, {
      ...base,
      cursor: { epoch: 'epoch-1', runtimeSequence: 5, hostSequence: 7 },
    }),
    /not contiguous/u,
  );
  assert.throws(
    () => assertConversationEventTransition(previous, {
      ...base,
      sourceSequence: 4,
      cursor: { epoch: 'epoch-1', runtimeSequence: 4, hostSequence: 8 },
    }),
    /changed hostSequence/u,
  );
  assert.throws(
    () => assertConversationEventTransition(previous, {
      ...base,
      sourceSequence: 4,
      cursor: { epoch: 'epoch-2', runtimeSequence: 4, hostSequence: 7 },
    }),
    /epoch changed/u,
  );

  const mismatchedSnapshot = {
    schemaVersion: 1,
    type: 'conversation.snapshot',
    source: 'projector',
    sourceSequence: 0,
    defSessionId,
    occurredAt: '2026-08-08T00:00:00.000Z',
    cursor: previous,
    snapshot: {
      schemaVersion: 1,
      defSessionId,
      cursor: { ...previous, hostSequence: 8 },
      status: { status: 'idle' },
      messages: [],
      parts: [],
    },
  } as ConversationEvent;
  assert.throws(
    () => assertConversationEventTransition(null, mismatchedSnapshot),
    /does not match/u,
  );
});
