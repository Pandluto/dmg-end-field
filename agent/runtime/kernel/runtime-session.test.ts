import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  asClientTurnId,
  asDefTurnId,
  asToolCallId,
} from '../../core/contracts/ids.ts';
import { FakeModelDriver, FakeModelStream } from './testing/fake-model-driver.ts';
import { FakeToolBridge as FixtureToolBridge } from './testing/fake-tool-bridge.ts';
import {
  FIXTURE_CLIENT_TURN_ID,
  FIXTURE_CONNECTION,
  FIXTURE_DEF_SESSION_ID,
  FIXTURE_DEF_TURN_ID,
  FIXTURE_PROJECTION,
  FIXTURE_RUNTIME_SESSION_ID,
  FIXTURE_TIME,
  asFixtureRuntimeTurnId,
  createAbortableDeferredBridge,
  fixtureContext,
  fixtureSettlement,
  fixtureUserMessage,
  overflowResponse,
  textResponse,
  toolResponse,
} from './testing/runtime-fixtures.ts';
import {
  RuntimeSession,
  RuntimeSessionError,
  type RuntimeSessionCreateOptions,
} from './runtime-session.ts';
import type { RuntimeRunMarkerEntry, RuntimeSessionEntry } from './session/entries.ts';

function makeRoot(): string {
  return mkdtempSync(join(tmpdir(), 'def-runtime-session-p7-'));
}

function makeOptions(
  root: string,
  driver: FakeModelDriver,
  toolBridge: RuntimeSessionCreateOptions['toolBridge'] = new FixtureToolBridge(),
  context: RuntimeSessionCreateOptions['context'] = fixtureContext(),
  overrides: Partial<RuntimeSessionCreateOptions> = {},
): RuntimeSessionCreateOptions {
  return {
    filePath: join(root, 'runtime.jsonl'),
    rootDir: root,
    runtimeSessionId: FIXTURE_RUNTIME_SESSION_ID,
    defSessionId: FIXTURE_DEF_SESSION_ID,
    runtimeVersion: 'runtime-fixture-v1',
    providerProfileRef: 'profile-fixture',
    systemPromptVersion: 'prompt-fixture-v1',
    modelDriver: driver,
    connection: FIXTURE_CONNECTION,
    toolBridge,
    toolProjection: FIXTURE_PROJECTION,
    context,
    now: () => FIXTURE_TIME,
    ...overrides,
  };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let index = 0; index < 100; index += 1) {
    if (predicate()) return;
    await new Promise<void>((resolve) => queueMicrotask(resolve));
  }
  assert.fail('fixture did not reach the expected state');
}

function cleanup(root: string): void {
  rmSync(root, { recursive: true, force: true });
}

function messageEntries(session: RuntimeSession): Extract<RuntimeSessionEntry, { type: 'message' }>[] {
  return session.entries.filter(
    (entry): entry is Extract<RuntimeSessionEntry, { type: 'message' }> => entry.type === 'message',
  );
}

function marker(phase: 'start' | 'end', id: string, parentId: string | null, runId: string, turnId: string): RuntimeRunMarkerEntry {
  if (phase === 'start') {
    return {
      schemaVersion: 1,
      id: id as RuntimeRunMarkerEntry['id'],
      parentId: parentId as RuntimeRunMarkerEntry['parentId'],
      createdAt: FIXTURE_TIME,
      type: 'run-marker',
      phase,
      defTurnId: FIXTURE_DEF_TURN_ID,
      runId: runId as RuntimeRunMarkerEntry['runId'],
      turnId: turnId as RuntimeRunMarkerEntry['turnId'],
    };
  }
  return {
    schemaVersion: 1,
    id: id as RuntimeRunMarkerEntry['id'],
    parentId: parentId as RuntimeRunMarkerEntry['parentId'],
    createdAt: FIXTURE_TIME,
    type: 'run-marker',
    phase,
    defTurnId: FIXTURE_DEF_TURN_ID,
    runId: runId as RuntimeRunMarkerEntry['runId'],
    turnId: turnId as RuntimeRunMarkerEntry['turnId'],
    terminal: { status: 'completed' },
  };
}

test('new Runtime Session runs two durable turns and refreshes ephemeral product context', async () => {
  const root = makeRoot();
  try {
    const driver = new FakeModelDriver([textResponse('first answer'), textResponse('second answer')]);
    let snapshotNumber = 0;
    const subscribedSequences: number[] = [];
    const session = RuntimeSession.create(makeOptions(root, driver, new FixtureToolBridge(), () => {
      snapshotNumber += 1;
      return fixtureContext(`snapshot-${snapshotNumber}`);
    }, {
      listeners: [
        (event) => {
          subscribedSequences.push(event.sequence);
        },
      ],
    }));

    const first = await session.startTurn({
      defTurnId: FIXTURE_DEF_TURN_ID,
      clientTurnId: FIXTURE_CLIENT_TURN_ID,
      text: 'first question',
    });
    const firstResult = await first.result;
    const second = await session.startTurn({
      defTurnId: asDefTurnId('def-turn-p7-second'),
      clientTurnId: asClientTurnId('client-turn-p7-second'),
      text: 'second question',
    });
    const secondResult = await second.result;

    assert.equal(firstResult.terminal.status, 'completed');
    assert.equal(secondResult.terminal.status, 'completed');
    assert.equal(driver.requests.length, 2);
    assert.equal(snapshotNumber, 2);
    assert.match(driver.requests[0]!.systemPrompt, /snapshot-1/u);
    assert.match(driver.requests[1]!.systemPrompt, /snapshot-2/u);
    assert.equal(JSON.stringify(session.entries).includes('snapshot-2'), false);
    assert.equal(driver.requests[1]!.messages.filter((message) => message.role === 'user').length, 2);
    assert.equal(messageEntries(session).length, 4);
    assert.deepEqual(
      subscribedSequences,
      subscribedSequences.map((_, index) => index + 1),
    );
    assert.equal(firstResult.events.some((event) => event.sequence === 1), true);
    assert.equal(secondResult.events.some((event) => event.sequence === 1), true);
    await session.waitForIdle();
    await session.close();
  } finally {
    cleanup(root);
  }
});

test('Pi-style steering injects one idempotent user message at the next model boundary', async () => {
  const root = makeRoot();
  try {
    const firstStream = new FakeModelStream();
    const driver = new FakeModelDriver([firstStream, textResponse('guided answer')]);
    const session = RuntimeSession.create(makeOptions(root, driver));
    const handle = await session.startTurn({
      defTurnId: FIXTURE_DEF_TURN_ID,
      clientTurnId: FIXTURE_CLIENT_TURN_ID,
      text: 'start the task',
    });
    await waitFor(() => driver.requests.length === 1);

    const steering = {
      clientTurnId: asClientTurnId('client-turn-p7-steer'),
      text: 'focus on the second node',
    };
    await handle.steer(steering);
    await handle.steer(steering);
    for (const event of textResponse('first response')) firstStream.push(event);
    firstStream.end();

    const result = await handle.result;
    assert.equal(result.terminal.status, 'completed');
    assert.equal(driver.requests.length, 2);
    assert.equal(
      driver.requests[1]!.messages.filter((message) => (
        message.role === 'user' && JSON.stringify(message).includes('focus on the second node')
      )).length,
      1,
    );
    assert.deepEqual(messageEntries(session).map((entry) => entry.message.role), [
      'user', 'assistant', 'user', 'assistant',
    ]);
    await assert.rejects(
      () => handle.steer({
        clientTurnId: asClientTurnId('client-turn-p7-steer-late'),
        text: 'too late',
      }),
      (error: unknown) => error instanceof RuntimeSessionError && error.code === 'RUNTIME_STEERING_INACTIVE',
    );
    await session.close();
  } finally {
    cleanup(root);
  }
});

test('Tool chain persists one canonical assistant/tool result pair and blocks the next model round', async () => {
  const root = makeRoot();
  try {
    const toolCallId = asToolCallId('tool-call-p7');
    const driver = new FakeModelDriver([
      toolResponse([{ id: toolCallId, name: 'echo', arguments: { value: 7 } }]),
      textResponse('tool chain complete'),
    ]);
    const bridge = new FixtureToolBridge();
    bridge.enqueueSettlement(fixtureSettlement(toolCallId, { value: 7 }, {
      ...FIXTURE_PROJECTION,
      revision: 2,
    }));
    const session = RuntimeSession.create(makeOptions(root, driver, bridge));
    const handle = await session.startTurn({
      defTurnId: FIXTURE_DEF_TURN_ID,
      clientTurnId: FIXTURE_CLIENT_TURN_ID,
      text: 'use the tool',
    });
    const result = await handle.result;

    assert.equal(result.terminal.status, 'completed');
    assert.equal(driver.requests.length, 2);
    assert.equal(bridge.invocations.length, 1);
    assert.equal(driver.requests[1]!.messages.some((message) => message.role === 'tool-result'), true);
    assert.deepEqual(messageEntries(session).map((entry) => entry.message.role), [
      'user', 'assistant', 'tool-result', 'assistant',
    ]);
    await session.close();
  } finally {
    cleanup(root);
  }
});

test('recover marks an unfinished run interrupted and allows a later turn without replaying it', async () => {
  const root = makeRoot();
  try {
    const firstDriver = new FakeModelDriver([]);
    const first = RuntimeSession.create(makeOptions(root, firstDriver));
    const start = marker('start', 'crashed-run-start', null, 'crashed-run', 'crashed-turn');
    first.log.append(start);
    const crashedUser = fixtureUserMessage('before restart', {
      runId: 'crashed-run',
      defTurnId: FIXTURE_DEF_TURN_ID,
      clientTurnId: asClientTurnId('crashed-client-turn'),
      turnId: asFixtureRuntimeTurnId('crashed-turn'),
    });
    first.log.append({
      schemaVersion: 1,
      id: crashedUser.id as unknown as RuntimeSessionEntry['id'],
      parentId: start.id,
      createdAt: FIXTURE_TIME,
      type: 'message',
      message: crashedUser,
    });
    await first.close();

    const resumedDriver = new FakeModelDriver([textResponse('resumed')]);
    const resumed = RuntimeSession.recover(makeOptions(root, resumedDriver));
    assert.equal(resumed.log.interruptedRuns.length, 1);
    assert.notEqual(resumed.log.interruptedRuns[0]!.endEntryId, null);
    const handle = await resumed.startTurn({
      defTurnId: asDefTurnId('def-turn-p7-resumed'),
      clientTurnId: asClientTurnId('client-turn-p7-resumed'),
      text: 'continue after restart',
    });
    const result = await handle.result;
    assert.equal(result.terminal.status, 'completed');
    assert.equal(resumed.log.interruptedRuns[0]!.runId, 'crashed-run');
    assert.equal(messageEntries(resumed).filter((entry) => entry.message.id === crashedUser.id).length, 1);
    await resumed.close();
  } finally {
    cleanup(root);
  }
});

test('consumer abort and close both settle a pending Provider or Tool wait', async () => {
  const root = makeRoot();
  try {
    const stream = new FakeModelStream();
    const driver = new FakeModelDriver([stream]);
    const session = RuntimeSession.create(makeOptions(root, driver));
    const handle = await session.startTurn({
      defTurnId: FIXTURE_DEF_TURN_ID,
      clientTurnId: FIXTURE_CLIENT_TURN_ID,
      text: 'stop this request',
    });
    await waitFor(() => driver.requests.length === 1);
    const terminal = await session.abort({ code: 'CONSUMER_STOP' });
    assert.equal(terminal.status, 'aborted');
    assert.equal((await handle.result).terminal.status, 'aborted');
    await session.close();

    const toolRoot = makeRoot();
    try {
      const toolDriver = new FakeModelDriver([
        toolResponse([{ id: 'close-tool-call', name: 'echo', arguments: {} }]),
      ]);
      const deferred = createAbortableDeferredBridge();
      const toolSession = RuntimeSession.create(makeOptions(toolRoot, toolDriver, deferred.bridge));
      const toolHandle = await toolSession.startTurn({
        defTurnId: asDefTurnId('def-turn-p7-close'),
        clientTurnId: asClientTurnId('client-turn-p7-close'),
        text: 'close while tool waits',
      });
      await waitFor(() => deferred.invocations.length === 1);
      await toolSession.close();
      assert.equal((await toolHandle.result).terminal.status, 'aborted');
      await toolSession.waitForIdle();
    } finally {
      cleanup(toolRoot);
    }
  } finally {
    cleanup(root);
  }
});

test('the same Runtime Session rejects a second active run', async () => {
  const root = makeRoot();
  try {
    const stream = new FakeModelStream();
    const driver = new FakeModelDriver([stream]);
    const session = RuntimeSession.create(makeOptions(root, driver));
    const first = await session.startTurn({
      defTurnId: FIXTURE_DEF_TURN_ID,
      clientTurnId: FIXTURE_CLIENT_TURN_ID,
      text: 'active',
    });
    await assert.rejects(
      () => session.startTurn({
        defTurnId: asDefTurnId('def-turn-p7-rejected'),
        clientTurnId: asClientTurnId('client-turn-p7-rejected'),
        text: 'must wait',
      }),
      (error: unknown) => error instanceof RuntimeSessionError && error.code === 'RUNTIME_ACTIVE_RUN',
    );
    await session.abort({ code: 'TEST_STOP' });
    assert.equal((await first.result).terminal.status, 'aborted');
    await session.close();
  } finally {
    cleanup(root);
  }
});

test('threshold compacts before the model request and overflow retries exactly once without duplicating the user', async () => {
  const root = makeRoot();
  try {
    const driver = new FakeModelDriver([
      textResponse('history-answer-1', 'response-history-1'),
      textResponse('history-answer-2', 'response-history-2'),
      textResponse('history-answer-3', 'response-history-3'),
      textResponse('THRESHOLD_SUMMARY', 'response-threshold-summary'),
      textResponse('threshold continued', 'response-threshold-run'),
      overflowResponse(),
      textResponse('OVERFLOW_SUMMARY', 'response-overflow-summary'),
      textResponse('overflow recovered', 'response-overflow-retry'),
    ]);
    const eventKinds: string[] = [];
    const session = RuntimeSession.create(makeOptions(root, driver, new FixtureToolBridge(), fixtureContext(), {
      retainLastMessages: 1,
      thresholdTokens: 100_000,
      listeners: [
        (event) => {
          eventKinds.push(`${event.type}:${'reason' in event ? event.reason : ''}`);
        },
      ],
    }));

    for (let index = 1; index <= 3; index += 1) {
      const history = await session.startTurn({
        defTurnId: asDefTurnId(`def-turn-p7-threshold-history-${index}`),
        clientTurnId: asClientTurnId(`client-turn-p7-threshold-history-${index}`),
        text: `compressible-history-${index}`,
      });
      assert.equal((await history.result).terminal.status, 'completed');
    }

    const threshold = await session.startTurn({
      defTurnId: asDefTurnId('def-turn-p7-threshold'),
      clientTurnId: asClientTurnId('client-turn-p7-threshold'),
      text: 'threshold-trigger',
      currentInputTokens: 100,
      contextLimit: 128,
      thresholdTokens: 1,
    });
    assert.equal((await threshold.result).terminal.status, 'completed');
    assert.equal(driver.requests.length, 5);
    assert.equal(driver.requests[3]!.messages.length, 0);
    assert.match(JSON.stringify(driver.requests[4]!.messages), /threshold-trigger/u);

    const thresholdStart = eventKinds.indexOf('compaction.start:threshold');
    const thresholdEnd = eventKinds.indexOf('compaction.end:threshold');
    const thresholdRunStart = eventKinds.findIndex(
      (kind, index) => index > thresholdEnd && kind === 'run.start:',
    );
    assert.ok(thresholdStart >= 0);
    assert.ok(thresholdEnd > thresholdStart);
    assert.ok(thresholdRunStart > thresholdEnd);
    assert.equal(session.entries.filter((entry) => entry.type === 'compaction' && entry.reason === 'threshold').length, 1);

    const overflow = await session.startTurn({
      defTurnId: asDefTurnId('def-turn-p7-overflow'),
      clientTurnId: asClientTurnId('client-turn-p7-overflow'),
      text: 'overflow-once',
      currentInputTokens: 0,
      contextLimit: 128,
      thresholdTokens: 100_000,
    });
    const overflowResult = await overflow.result;
    assert.equal(overflowResult.terminal.status, 'completed');
    assert.equal(overflowResult.attempt, 2);
    assert.equal(driver.requests.length, 8);
    assert.equal(eventKinds.filter((kind) => kind === 'compaction.start:overflow').length, 1);
    assert.equal(eventKinds.filter((kind) => kind === 'compaction.end:overflow').length, 1);
    assert.equal(session.entries.filter((entry) => entry.type === 'compaction').length, 2);
    assert.equal(
      messageEntries(session).filter(
        (entry) => entry.message.role === 'user' && JSON.stringify(entry.message).includes('overflow-once'),
      ).length,
      1,
    );
    assert.match(JSON.stringify(driver.requests[5]!.messages), /overflow-once/u);
    assert.match(JSON.stringify(driver.requests[7]!.messages), /OVERFLOW_SUMMARY/u);
    await session.close();
  } finally {
    cleanup(root);
  }
});

test('a second compaction is incremental and keeps the latest summary plus tail', async () => {
  const root = makeRoot();
  try {
    const driver = new FakeModelDriver([
      textResponse('answer-1'),
      textResponse('answer-2'),
      textResponse('answer-3'),
      textResponse('summary-1'),
      textResponse('answer-4'),
      textResponse('answer-5'),
      textResponse('answer-6'),
      textResponse('summary-2'),
    ]);
    const session = RuntimeSession.create(makeOptions(root, driver, new FixtureToolBridge(), fixtureContext()));
    for (let index = 1; index <= 3; index += 1) {
      const handle = await session.startTurn({
        defTurnId: asDefTurnId(`def-turn-p7-${index}`),
        clientTurnId: asClientTurnId(`client-turn-p7-${index}`),
        text: `history-${index}`,
      });
      assert.equal((await handle.result).terminal.status, 'completed');
    }

    const first = await session.compact({
      reason: 'manual',
      summary: 'SUMMARY_ONE replaces the first history.',
      firstKeptEntryId: messageEntries(session)[2]!.id,
    });
    assert.equal(first.status, 'compacted');
    for (const index of [4, 5]) {
      const next = await session.startTurn({
        defTurnId: asDefTurnId(`def-turn-p7-${index}`),
        clientTurnId: asClientTurnId(`client-turn-p7-${index}`),
        text: `history-${index}`,
      });
      assert.equal((await next.result).terminal.status, 'completed');
    }
    const second = await session.compact({
      reason: 'manual',
      summary: 'SUMMARY_TWO keeps only the latest summary and tail.',
      firstKeptEntryId: messageEntries(session).at(-1)!.id,
    });
    assert.equal(second.status, 'compacted');
    const transcript = await session.readTranscript();
    assert.equal(session.entries.filter((entry) => entry.type === 'compaction').length, 2);
    assert.equal(transcript.messages.filter((message) => message.role === 'compaction').length, 1);
    assert.match(JSON.stringify(transcript.messages), /SUMMARY_TWO/u);
    assert.equal(JSON.stringify(transcript.messages).includes('history-1'), false);
    await session.close();
  } finally {
    cleanup(root);
  }
});
