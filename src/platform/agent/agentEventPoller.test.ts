import assert from 'node:assert/strict';
import type { AgentEventPage } from '../../../agent/core/contracts/browser-protocol.ts';
import type { DefEvent } from '../../../agent/core/contracts/events.ts';
import {
  asClientTurnId,
  asDefSessionId,
  asDefTurnId,
  type DefSessionId,
} from '../../../agent/core/contracts/ids.ts';
import { AgentEventPoller, type AgentEventReader } from './agentEventPoller';

function acceptedEvent(defSessionId: DefSessionId, sequence: number, suffix: string): DefEvent {
  return {
    schemaVersion: 1,
    sequence,
    occurredAt: '2026-08-07T00:00:00.000Z',
    defSessionId,
    type: 'turn.accepted',
    defTurnId: asDefTurnId(`turn-${suffix}`),
    payload: {
      clientTurnId: asClientTurnId(`client-${suffix}`),
      userMessage: `message-${suffix}`,
    },
  };
}

// A defensive client-side ceiling prevents an incompatible Host from growing the transcript forever.
{
  const defSessionId = asDefSessionId('poller-session-capacity');
  let scheduledRetries = 0;
  const poller = new AgentEventPoller({
    reader: {
      async readSessionEvents(_session, afterSequence = 0) {
        return page(defSessionId, afterSequence, [
          acceptedEvent(defSessionId, 1, 'capacity-one'),
          acceptedEvent(defSessionId, 2, 'capacity-two'),
          acceptedEvent(defSessionId, 3, 'capacity-three'),
        ]);
      },
    },
    maxEvents: 2,
    setTimeout: () => { scheduledRetries += 1; return 1; },
    clearTimeout: () => undefined,
  });
  poller.setSession(defSessionId);
  poller.start();
  await poller.refresh();
  assert.equal(poller.getState().status, 'error');
  assert.match(poller.getState().error ?? '', /2 条内存上限/);
  assert.equal(poller.getState().events.length, 0);
  assert.equal(scheduledRetries, 0, 'a terminal capacity error must not retry forever');
  poller.stop();
}

// The transcript also has a serialized-size ceiling, not only an event-count ceiling.
{
  const defSessionId = asDefSessionId('poller-session-byte-capacity');
  const poller = new AgentEventPoller({
    reader: {
      async readSessionEvents(_session, afterSequence = 0) {
        return page(defSessionId, afterSequence, [acceptedEvent(defSessionId, 1, 'large')]);
      },
    },
    maxEvents: 10,
    maxEventCodeUnits: 10,
    setTimeout: () => 1,
    clearTimeout: () => undefined,
  });
  poller.setSession(defSessionId);
  poller.start();
  await poller.refresh();
  assert.equal(poller.getState().status, 'error');
  assert.match(poller.getState().error ?? '', /10 字符内存上限/);
  assert.equal(poller.getState().events.length, 0);
  poller.stop();
}

function page(
  defSessionId: DefSessionId,
  afterSequence: number,
  events: readonly DefEvent[],
  hasMore = false,
): AgentEventPage {
  return {
    protocolVersion: 2,
    defSessionId,
    afterSequence,
    nextSequence: events.at(-1)?.sequence ?? afterSequence,
    hasMore,
    events,
  };
}

{
  const defSessionId = asDefSessionId('poller-session');
  const calls: number[] = [];
  const scheduled = new Map<number, () => void>();
  let nextTimer = 1;
  const reader: AgentEventReader = {
    async readSessionEvents(_session, afterSequence = 0) {
      calls.push(afterSequence);
      if (afterSequence === 0) {
        return page(defSessionId, 0, [
          acceptedEvent(defSessionId, 1, 'one'),
          acceptedEvent(defSessionId, 2, 'two'),
        ], true);
      }
      if (afterSequence === 2) {
        return page(defSessionId, 2, [acceptedEvent(defSessionId, 3, 'three')]);
      }
      return page(defSessionId, afterSequence, []);
    },
  };
  const poller = new AgentEventPoller({
    reader,
    setTimeout: (handler) => {
      const id = nextTimer++;
      scheduled.set(id, handler);
      return id;
    },
    clearTimeout: (handle) => scheduled.delete(handle as number),
  });

  poller.setSession(defSessionId);
  poller.start();
  await poller.refresh();
  assert.deepEqual(calls, [0, 2]);
  assert.equal(poller.getState().cursor, 3);
  assert.equal(poller.getState().events.length, 3);
  poller.stop();
  assert.equal(poller.getState().cursor, 3, 'stopping must preserve the resume cursor');
  assert.equal(poller.getState().status, 'idle');
}

// Switching sessions while an old request is in flight must never append stale events.
{
  const sessionA = asDefSessionId('poller-session-a');
  const sessionB = asDefSessionId('poller-session-b');
  let releaseA!: () => void;
  const gateA = new Promise<void>((resolve) => { releaseA = resolve; });
  const calls: string[] = [];
  const reader: AgentEventReader = {
    async readSessionEvents(defSessionId, afterSequence = 0) {
      calls.push(`${defSessionId}:${afterSequence}`);
      if (defSessionId === sessionA) {
        await gateA;
        return page(sessionA, afterSequence, [acceptedEvent(sessionA, 1, 'stale')]);
      }
      return page(sessionB, afterSequence, [acceptedEvent(sessionB, 1, 'current')]);
    },
  };
  const poller = new AgentEventPoller({
    reader,
    setTimeout: () => 1,
    clearTimeout: () => undefined,
  });

  poller.setSession(sessionA);
  poller.start();
  await Promise.resolve();
  poller.setSession(sessionB);
  const currentRefresh = poller.refresh();
  releaseA();
  await currentRefresh;
  assert.deepEqual(calls, ['poller-session-a:0', 'poller-session-b:0']);
  assert.equal(poller.getState().defSessionId, sessionB);
  assert.equal(poller.getState().events[0].defSessionId, sessionB);
  poller.stop();
}

// A failed page schedules the slower retry and recovers from the same cursor.
{
  const defSessionId = asDefSessionId('poller-session-retry');
  let attempts = 0;
  let retryHandler: (() => void) | null = null;
  let retryTimeout = 0;
  const poller = new AgentEventPoller({
    reader: {
      async readSessionEvents(_session, afterSequence = 0) {
        attempts += 1;
        if (attempts === 1) throw new Error('temporary failure');
        return page(defSessionId, afterSequence, [acceptedEvent(defSessionId, 1, 'retry')]);
      },
    },
    intervalMs: 300,
    errorIntervalMs: 1_000,
    setTimeout: (handler, timeout) => {
      retryHandler = handler;
      retryTimeout = timeout;
      return 1;
    },
    clearTimeout: () => undefined,
  });

  poller.setSession(defSessionId);
  poller.start();
  await poller.refresh();
  assert.equal(poller.getState().status, 'error');
  assert.equal(retryTimeout, 1_000);
  const scheduledRetry = retryHandler as (() => void) | null;
  assert.ok(scheduledRetry);
  scheduledRetry();
  await poller.refresh();
  assert.equal(poller.getState().status, 'ready');
  assert.equal(poller.getState().cursor, 1);
  poller.stop();
}
