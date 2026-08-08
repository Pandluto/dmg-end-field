import assert from 'node:assert/strict';
import test from 'node:test';
import { AGENT_TRACE_LIMITS, parseAgentTrace } from './trace-schema.ts';
import { normalizePiTrace } from './trace-normalizer.ts';

function makeValidTrace(): Record<string, unknown> {
  return {
    schemaVersion: 2,
    scenario: 'single tool turn',
    source: {
      kind: 'pi-reference',
      repository: 'https://github.com/earendil-works/pi-mono',
      commit: 'e47b8e37a6211ebd0b2942fa87059d64f81eec02',
      version: '0.84.1',
      generatedBy: 'scripts/agent-runtime-pi-reference.mjs',
    },
    events: [
      { ordinal: 1, type: 'run.start', runId: 'run-1', data: {} },
      {
        ordinal: 2,
        type: 'turn.start',
        runId: 'run-1',
        turnId: 'turn-1',
        data: { contextItemCount: 1 },
      },
      {
        ordinal: 3,
        type: 'message.user',
        runId: 'run-1',
        turnId: 'turn-1',
        messageId: 'message-user-1',
        data: { text: 'inspect the fixture', attachmentCount: 0 },
      },
      {
        ordinal: 4,
        type: 'context.snapshot',
        runId: 'run-1',
        turnId: 'turn-1',
        data: {
          systemPrompt: 'fixture system prompt',
          toolNames: ['read_timeline'],
          items: [{ kind: 'user-text', messageId: 'message-user-1', text: 'inspect the fixture' }],
        },
      },
      {
        ordinal: 5,
        type: 'response.start',
        runId: 'run-1',
        turnId: 'turn-1',
        messageId: 'message-assistant-1',
        data: { providerId: 'fixture-provider', modelId: 'fixture-model' },
      },
      {
        ordinal: 6,
        type: 'tool.call',
        runId: 'run-1',
        turnId: 'turn-1',
        messageId: 'message-assistant-1',
        toolCallId: 'tool-1',
        data: {
          contentIndex: 0,
          name: 'read_timeline',
          arguments: { timelineId: 'fixture' },
          argumentDeltas: ['{"timelineId":"', 'fixture"}'],
        },
      },
      {
        ordinal: 7,
        type: 'message.assistant',
        runId: 'run-1',
        turnId: 'turn-1',
        messageId: 'message-assistant-1',
        data: {
          stopReason: 'tool-use',
          usage: { inputTokens: 12, outputTokens: 8, totalTokens: 20 },
          contentOrder: ['tool-call'],
        },
      },
      {
        ordinal: 8,
        type: 'tool.result',
        runId: 'run-1',
        turnId: 'turn-1',
        messageId: 'message-tool-1',
        toolCallId: 'tool-1',
        data: { status: 'succeeded', name: 'read_timeline', output: { found: true } },
      },
      {
        ordinal: 9,
        type: 'turn.end',
        runId: 'run-1',
        turnId: 'turn-1',
        data: { stopReason: 'tool-use', toolResultCount: 1 },
      },
      {
        ordinal: 10,
        type: 'turn.start',
        runId: 'run-1',
        turnId: 'turn-2',
        data: { contextItemCount: 3 },
      },
      {
        ordinal: 11,
        type: 'context.snapshot',
        runId: 'run-1',
        turnId: 'turn-2',
        data: {
          systemPrompt: 'fixture system prompt',
          toolNames: ['read_timeline'],
          items: [
            { kind: 'user-text', messageId: 'message-user-1', text: 'inspect the fixture' },
            {
              kind: 'assistant-tool-call',
              messageId: 'message-assistant-1',
              toolCallId: 'tool-1',
              name: 'read_timeline',
              arguments: { timelineId: 'fixture' },
            },
            {
              kind: 'tool-result',
              messageId: 'message-tool-1',
              toolCallId: 'tool-1',
              name: 'read_timeline',
              status: 'succeeded',
              output: { found: true },
            },
          ],
        },
      },
      {
        ordinal: 12,
        type: 'response.start',
        runId: 'run-1',
        turnId: 'turn-2',
        messageId: 'message-assistant-2',
        data: { providerId: 'fixture-provider', modelId: 'fixture-model' },
      },
      {
        ordinal: 13,
        type: 'content.text',
        runId: 'run-1',
        turnId: 'turn-2',
        messageId: 'message-assistant-2',
        data: {
          contentIndex: 0,
          text: 'The fixture exists.',
          deltas: ['The fixture ', 'exists.'],
        },
      },
      {
        ordinal: 14,
        type: 'message.assistant',
        runId: 'run-1',
        turnId: 'turn-2',
        messageId: 'message-assistant-2',
        data: {
          stopReason: 'stop',
          usage: { inputTokens: 20, outputTokens: 5, totalTokens: 25 },
          contentOrder: ['text'],
        },
      },
      {
        ordinal: 15,
        type: 'turn.end',
        runId: 'run-1',
        turnId: 'turn-2',
        data: { stopReason: 'stop', toolResultCount: 0 },
      },
      { ordinal: 16, type: 'run.end', runId: 'run-1', data: { status: 'completed' } },
    ],
  };
}

function mutableEvents(trace: Record<string, unknown>): Array<Record<string, unknown>> {
  return trace.events as Array<Record<string, unknown>>;
}

function findEvent(
  trace: Record<string, unknown>,
  type: string,
  occurrence = 0,
): Record<string, unknown> {
  const matches = mutableEvents(trace).filter((event) => event.type === type);
  assert.ok(matches[occurrence], `missing ${type} occurrence ${occurrence}`);
  return matches[occurrence];
}

test('Agent trace parser accepts a complete deterministic trace', () => {
  const parsed = parseAgentTrace(makeValidTrace());
  assert.equal(parsed.schemaVersion, 2);
  assert.equal(parsed.events.length, 16);
  assert.equal(parsed.events[5]?.type, 'tool.call');
});

test('Agent trace parser requires streaming deltas to reconstruct their final blocks', () => {
  const textMismatch = makeValidTrace();
  findEvent(textMismatch, 'content.text').data = {
    contentIndex: 0,
    text: 'The fixture exists.',
    deltas: ['The fixture ', 'wrong.'],
  };
  assert.throws(() => parseAgentTrace(textMismatch), /do not concatenate to final text/u);

  const reasoning = makeValidTrace();
  const content = findEvent(reasoning, 'content.text');
  content.type = 'content.reasoning';
  content.data = {
    contentIndex: 0,
    text: 'The fixture exists.',
    deltas: ['The fixture ', 'exists.'],
    redacted: false,
  };
  findEvent(reasoning, 'message.assistant', 1).data = {
    stopReason: 'stop',
    usage: { inputTokens: 20, outputTokens: 5, totalTokens: 25 },
    contentOrder: ['reasoning'],
  };
  assert.doesNotThrow(() => parseAgentTrace(reasoning));

  const toolMismatch = makeValidTrace();
  findEvent(toolMismatch, 'tool.call').data = {
    contentIndex: 0,
    name: 'read_timeline',
    arguments: { timelineId: 'fixture' },
    argumentDeltas: ['{"timelineId":"other"}'],
  };
  assert.throws(() => parseAgentTrace(toolMismatch), /JSON does not match final arguments/u);
});

test('Agent trace parser rejects an oversized delta stream before joining it', () => {
  const oversized = makeValidTrace();
  findEvent(oversized, 'content.text').data = {
    contentIndex: 0,
    text: '',
    deltas: ['x'.repeat(AGENT_TRACE_LIMITS.maxStringCodeUnits), 'x'],
  };
  assert.throws(() => parseAgentTrace(oversized), /streaming delta budget/u);
});

test('trace ingestion rejects 100,000 events before reading or mapping event entries', () => {
  let eventReads = 0;
  const events = new Array(100_000);
  Object.defineProperty(events, 0, {
    enumerable: true,
    get() {
      eventReads += 1;
      return { ordinal: 1, type: 'run.start', runId: 'run-1', data: {} };
    },
  });
  const oversized = { ...makeValidTrace(), events };

  assert.throws(() => parseAgentTrace(oversized), /event|array.*budget/iu);
  assert.equal(eventReads, 0, 'parser must reject from array length before reading index 0');
  assert.throws(
    () => normalizePiTrace(oversized as unknown as Parameters<typeof normalizePiTrace>[0]),
    /events.*at most/iu,
  );
  assert.equal(eventReads, 0, 'normalizer must reject from array length before reading index 0');
});

test('bounded walker rejects 1,001,000 nested nodes before visiting the budget-external getter', () => {
  let budgetExternalReads = 0;
  const millionNodes: unknown[] = Array.from(
    { length: 1_000 },
    () => new Array(1_000).fill(0),
  );
  Object.defineProperty(millionNodes, 1_000, {
    enumerable: true,
    get() {
      budgetExternalReads += 1;
      return [];
    },
  });
  const invalid = makeValidTrace();
  findEvent(invalid, 'tool.result').data = {
    status: 'succeeded',
    name: 'read_timeline',
    output: { millionNodes },
  };

  assert.throws(() => parseAgentTrace(invalid), /total node budget/u);
  assert.equal(budgetExternalReads, 0, 'walker must stop before reading node 1,001,001');
});

test('bounded walker rejects a 1 MiB field name before evaluating its value', () => {
  let valueReads = 0;
  const invalid: Record<string, unknown> = {};
  Object.defineProperty(invalid, 'x'.repeat(1_024 * 1_024), {
    enumerable: true,
    get() {
      valueReads += 1;
      return 'unreachable';
    },
  });
  Object.assign(invalid, makeValidTrace());

  assert.throws(() => parseAgentTrace(invalid), /field name.*per-field budget/u);
  assert.equal(valueReads, 0, 'field-name budget must be checked before property access');
});

test('bounded walker fails closed on cyclic JSON input', () => {
  const invalid = makeValidTrace();
  const cycle: Record<string, unknown> = {};
  cycle.self = cycle;
  findEvent(invalid, 'tool.result').data = {
    status: 'succeeded',
    name: 'read_timeline',
    output: cycle,
  };
  assert.throws(() => parseAgentTrace(invalid), /cycle/u);
});

test('Agent trace parser enforces contiguous one-based event ordinals', () => {
  const invalid = makeValidTrace();
  const events = invalid.events as Array<Record<string, unknown>>;
  events[1]!.ordinal = 7;
  assert.throws(() => parseAgentTrace(invalid), /ordinal must be 2/u);
});

test('Agent trace parser rejects semantically empty Tool and terminal events', () => {
  const emptyCall = makeValidTrace();
  findEvent(emptyCall, 'tool.call').data = {};
  assert.throws(() => parseAgentTrace(emptyCall), /fields are invalid/u);

  const missingTerminal = makeValidTrace();
  findEvent(missingTerminal, 'run.end').data = {};
  assert.throws(() => parseAgentTrace(missingTerminal), /status is invalid/u);
});

test('Agent trace parser rejects traces that omit context or assistant terminal semantics', () => {
  for (const omittedType of ['context.snapshot', 'message.assistant']) {
    const invalid = makeValidTrace();
    const events = (invalid.events as Array<Record<string, unknown>>)
      .filter((event) => event.type !== omittedType)
      .map((event, index) => ({ ...event, ordinal: index + 1 }));
    invalid.events = events;
    assert.throws(() => parseAgentTrace(invalid), new RegExp(`missing required ${omittedType}`, 'u'));
  }
});

test('Agent trace parser rejects secret fields and credential-shaped strings', () => {
  const secretHeader = makeValidTrace();
  findEvent(secretHeader, 'tool.call').data = {
    contentIndex: 0,
    name: 'read_timeline',
    arguments: { headers: { 'x-api-key': 'secret-value' } },
    argumentDeltas: ['{"headers":{"x-api-key":"secret-value"}}'],
  };
  assert.throws(() => parseAgentTrace(secretHeader), /forbidden secret field/u);

  const authorization = makeValidTrace();
  findEvent(authorization, 'message.user').data = {
    text: 'Authorization: Bearer abcdefghijklmnop',
    attachmentCount: 0,
  };
  assert.throws(() => parseAgentTrace(authorization), /secret-shaped text/u);

  const rawKey = makeValidTrace();
  findEvent(rawKey, 'tool.result').data = {
    status: 'succeeded',
    name: 'read_timeline',
    output: { value: 'sk-fixturecredential1234' },
  };
  assert.throws(() => parseAgentTrace(rawKey), /secret-shaped text/u);

  for (const fieldName of ['nested_api_key_value', 'requestAuthorizationHeader', 'prefix-sk-credential123']) {
    const secretName = makeValidTrace();
    findEvent(secretName, 'tool.result').data = {
      status: 'succeeded',
      name: 'read_timeline',
      output: { nested: { [fieldName]: 'redacted' } },
    };
    assert.throws(() => parseAgentTrace(secretName), /forbidden secret field/u);
  }
});

test('Agent trace parser rejects local, credentialed, queried, or unpinned source metadata', () => {
  for (const repository of [
    '/Users/example/pi-mono',
    '/tmp/pi-mono',
    'file:///tmp/pi-mono',
    'https://user:pass@github.com/earendil-works/pi-mono',
    'https://github.com/earendil-works/pi-mono?token=redacted',
    'http://github.com/earendil-works/pi-mono',
    'https://github.com/example/pi-mono',
  ]) {
    const invalid = makeValidTrace();
    (invalid.source as Record<string, unknown>).repository = repository;
    assert.throws(() => parseAgentTrace(invalid), /repository/u);
  }

  for (const generatedBy of [
    '/Users/example/runner.mjs',
    '/tmp/runner.mjs',
    'file:///tmp/runner.mjs',
    'scripts/runner.mjs?token=redacted',
    'scripts/../runner.mjs',
    'scripts/sk-credential123.mjs',
  ]) {
    const invalid = makeValidTrace();
    (invalid.source as Record<string, unknown>).generatedBy = generatedBy;
    assert.throws(() => parseAgentTrace(invalid), /generatedBy|secret-shaped/iu);
  }
});

test('Agent trace parser requires Tool results unless the run was aborted', () => {
  const invalid = makeValidTrace();
  const events: Array<Record<string, unknown>> = (invalid.events as Array<Record<string, unknown>>)
    .filter((event) => event.type !== 'tool.result')
    .map((event, index) => ({ ...event, ordinal: index + 1 }));
  const turnEnd = events.find((event) => event.type === 'turn.end' && event.turnId === 'turn-1')!;
  turnEnd.data = { stopReason: 'tool-use', toolResultCount: 0 };
  invalid.events = events;
  assert.throws(() => parseAgentTrace(invalid), /missing tool.result/u);
});

test('Agent trace parser rejects run, turn, and assistant terminal correlation drift', () => {
  const changedRun = makeValidTrace();
  findEvent(changedRun, 'tool.call').runId = 'run-2';
  assert.throws(() => parseAgentTrace(changedRun), /changed runId/u);

  const outsideTurn = makeValidTrace();
  findEvent(outsideTurn, 'tool.result').turnId = 'turn-2';
  assert.throws(() => parseAgentTrace(outsideTurn), /outside its active turn/u);

  const stopMismatch = makeValidTrace();
  findEvent(stopMismatch, 'turn.end').data = { stopReason: 'stop', toolResultCount: 1 };
  assert.throws(() => parseAgentTrace(stopMismatch), /stopReason does not match/u);
});

test('Agent trace parser binds Tool calls to one turn, name, message, and content order', () => {
  const wrongName = makeValidTrace();
  findEvent(wrongName, 'tool.result').data = {
    status: 'succeeded',
    name: 'different_tool',
    output: { found: true },
  };
  assert.throws(() => parseAgentTrace(wrongName), /name does not match/u);

  const wrongMessage = makeValidTrace();
  findEvent(wrongMessage, 'tool.call').messageId = 'message-assistant-other';
  assert.throws(() => parseAgentTrace(wrongMessage), /changed assistant messageId/u);

  const wrongOrder = makeValidTrace();
  const assistant = findEvent(wrongOrder, 'message.assistant');
  assistant.data = {
    stopReason: 'tool-use',
    usage: { inputTokens: 12, outputTokens: 8, totalTokens: 20 },
    contentOrder: ['text'],
  };
  assert.throws(() => parseAgentTrace(wrongOrder), /contentOrder does not match/u);

  const wrongTurn = makeValidTrace();
  findEvent(wrongTurn, 'tool.result').turnId = 'turn-2';
  assert.throws(() => parseAgentTrace(wrongTurn), /outside its active turn/u);
});

test('Agent trace parser rejects a completed run that stops immediately after Tool use', () => {
  const invalid = makeValidTrace();
  const events = mutableEvents(invalid).filter((event) => (
    event.turnId !== 'turn-2' && event.type !== 'run.end'
  ));
  events.push({
    ordinal: events.length + 1,
    type: 'run.end',
    runId: 'run-1',
    data: { status: 'completed' },
  });
  invalid.events = events.map((event, index) => ({ ...event, ordinal: index + 1 }));
  assert.throws(() => parseAgentTrace(invalid), /final assistant response/u);
});

test('run.end status is bound to the last assistant and turn terminal semantics', () => {
  const abortedLabelOnly = makeValidTrace();
  findEvent(abortedLabelOnly, 'run.end').data = {
    status: 'aborted',
    code: 'CONTROLLED_ABORT',
  };
  assert.throws(() => parseAgentTrace(abortedLabelOnly), /aborted run must end/iu);

  const failedLabelOnly = makeValidTrace();
  findEvent(failedLabelOnly, 'run.end').data = {
    status: 'failed',
    code: 'CONTROLLED_FAILURE',
    message: 'controlled failure',
  };
  assert.throws(() => parseAgentTrace(failedLabelOnly), /failed run must end/iu);

  const completedError = makeValidTrace();
  findEvent(completedError, 'message.assistant', 1).data = {
    stopReason: 'error',
    usage: { inputTokens: 20, outputTokens: 5, totalTokens: 25 },
    contentOrder: ['text'],
  };
  findEvent(completedError, 'turn.end', 1).data = { stopReason: 'error', toolResultCount: 0 };
  assert.throws(() => parseAgentTrace(completedError), /completed run ended/iu);
});

test('aborted terminal requires a started response and at least one recorded real delta', () => {
  const validAbort = makeValidTrace();
  findEvent(validAbort, 'message.assistant', 1).data = {
    stopReason: 'aborted',
    usage: { inputTokens: 20, outputTokens: 5, totalTokens: 25 },
    contentOrder: ['text'],
  };
  findEvent(validAbort, 'turn.end', 1).data = { stopReason: 'aborted', toolResultCount: 0 };
  findEvent(validAbort, 'run.end').data = {
    status: 'aborted',
    code: 'CONTROLLED_ABORT',
  };
  assert.doesNotThrow(() => parseAgentTrace(validAbort));

  const noDelta = makeValidTrace();
  findEvent(noDelta, 'content.text').data = { contentIndex: 0, text: '', deltas: [] };
  findEvent(noDelta, 'message.assistant', 1).data = {
    stopReason: 'aborted',
    usage: { inputTokens: 20, outputTokens: 0, totalTokens: 20 },
    contentOrder: ['text'],
  };
  findEvent(noDelta, 'turn.end', 1).data = { stopReason: 'aborted', toolResultCount: 0 };
  findEvent(noDelta, 'run.end').data = {
    status: 'aborted',
    code: 'CONTROLLED_ABORT',
  };
  assert.throws(() => parseAgentTrace(noDelta), /real partial delta/iu);
});

test('Agent trace parser requires a pinned full Git commit', () => {
  const invalid = makeValidTrace();
  const source = invalid.source as Record<string, unknown>;
  source.commit = 'main';
  assert.throws(() => parseAgentTrace(invalid), /full lowercase Git commit/u);
});
