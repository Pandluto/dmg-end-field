import assert from 'node:assert/strict';
import test from 'node:test';
import { parseAgentTrace } from './trace-schema.ts';

function makeValidTrace(): Record<string, unknown> {
  return {
    schemaVersion: 1,
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
        data: { contentIndex: 0, name: 'read_timeline', arguments: { timelineId: 'fixture' } },
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
        data: { contentIndex: 0, text: 'The fixture exists.' },
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
  assert.equal(parsed.schemaVersion, 1);
  assert.equal(parsed.events.length, 16);
  assert.equal(parsed.events[5]?.type, 'tool.call');
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

test('Agent trace parser requires a pinned full Git commit', () => {
  const invalid = makeValidTrace();
  const source = invalid.source as Record<string, unknown>;
  source.commit = 'main';
  assert.throws(() => parseAgentTrace(invalid), /full lowercase Git commit/u);
});
