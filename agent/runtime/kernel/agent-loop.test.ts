import assert from 'node:assert/strict';
import test from 'node:test';
import { asClientTurnId, asDefTurnId, asToolCallId } from '../../core/contracts/ids.ts';
import type { JsonObject } from '../../core/contracts/json.ts';
import {
  asRuntimeContentId,
  asRuntimeEntryId,
  asRuntimeMessageId,
  asRuntimeRunId,
  asRuntimeSessionId,
  asRuntimeTurnId,
} from './ids.ts';
import { runAgentLoop } from './agent-loop.ts';
import { RuntimeRunController, RuntimeRunProtocolError } from './run-controller.ts';
import type {
  RuntimeAssistantMessage,
  RuntimeAssistantMessageDraft,
  RuntimeMessage,
  RuntimeToolResultMessage,
  RuntimeUserMessage,
} from './messages.ts';
import type { ProviderStreamEvent, RuntimeEvent } from './stream-events.ts';
import type { RuntimeToolResultPayload } from './messages.ts';
import type { RuntimeToolProjection } from './tool.ts';
import {
  FakeModelDriver,
  FakeModelStream,
  numberProviderEvents,
  type ProviderEventWithoutOrdinal,
} from './testing/fake-model-driver.ts';
import { DeferredToolSettlement, FakeToolBridge, projection } from './testing/fake-tool-bridge.ts';

const sessionId = asRuntimeSessionId('session-p2');
const runId = asRuntimeRunId('run-p2');
const defTurnId = asDefTurnId('def-turn-p2');
const userTurnId = asRuntimeTurnId('turn-p2-1');
const clientTurnId = asClientTurnId('client-turn-p2');

function userMessage(text = 'hello'): RuntimeUserMessage {
  return {
    schemaVersion: 1,
    id: asRuntimeMessageId('message-p2-user'),
    createdAt: '2026-08-08T00:00:00.000Z',
    defTurnId,
    turnId: userTurnId,
    role: 'user',
    clientTurnId,
    content: [{
      type: 'text',
      id: asRuntimeContentId('content-p2-user'),
      text,
    }],
  };
}

function usage(outputTokens = 1) {
  return { inputTokens: 3, outputTokens, totalTokens: 3 + outputTokens };
}

function done(stopReason: 'stop' | 'length' | 'tool-use' = 'stop'): ProviderEventWithoutOrdinal {
  return { type: 'response.done', stopReason, usage: usage() };
}

function textResponse(text: string): ProviderStreamEvent[] {
  return numberProviderEvents([
    { type: 'response.start', responseId: 'response-1', responseModel: 'fake-model' },
    { type: 'text.start', contentIndex: 0 },
    { type: 'text.delta', contentIndex: 0, delta: text },
    { type: 'text.end', contentIndex: 0, text },
    done(),
  ]);
}

function toolResponse(
  calls: readonly { id: string; name: string; arguments: JsonObject; raw?: string }[],
  stopReason: 'tool-use' | 'length' = 'tool-use',
): ProviderStreamEvent[] {
  const events: ProviderEventWithoutOrdinal[] = [
    { type: 'response.start', responseId: 'response-tool', responseModel: 'fake-model' },
  ];
  calls.forEach((call, index) => {
    events.push(
      {
        type: 'tool-call.start',
        contentIndex: index,
        toolCallId: asToolCallId(call.id),
        name: call.name,
      },
      {
        type: 'tool-call.delta',
        contentIndex: index,
        toolCallId: asToolCallId(call.id),
        nameDelta: '',
        argumentsDelta: call.raw ?? JSON.stringify(call.arguments),
      },
      {
        type: 'tool-call.end',
        contentIndex: index,
        toolCallId: asToolCallId(call.id),
        name: call.name,
        arguments: call.arguments,
      },
    );
  });
  events.push(done(stopReason));
  return numberProviderEvents(events);
}

function baseInput(overrides: Partial<Parameters<typeof runAgentLoop>[0]> = {}) {
  const modelDriver = overrides.modelDriver ?? new FakeModelDriver([textResponse('done')]);
  const toolBridge = overrides.toolBridge ?? new FakeToolBridge();
  return {
    sessionId,
    runId,
    defTurnId,
    systemPrompt: 'fixture system prompt',
    messages: [userMessage()] as readonly RuntimeMessage[],
    userMessage: userMessage(),
    connection: {
      providerId: 'fake-provider',
      modelId: 'fake-model',
      baseUrl: 'https://provider.invalid',
      apiKey: 'secret-fixture-key',
    },
    tools: projection(1, 'echo', 'first', 'second'),
    modelDriver,
    toolBridge,
    now: () => '2026-08-08T00:00:00.000Z',
    ...overrides,
  };
}

function failedResult(code = 'TOOL_FAILED'): RuntimeToolResultPayload {
  return { status: 'failed', code, message: 'fixture Tool failed' };
}

function assistantMessage(
  id = 'message-controller-assistant',
  turnId = userTurnId,
): RuntimeAssistantMessage {
  return {
    schemaVersion: 1,
    id: asRuntimeMessageId(id),
    createdAt: '2026-08-08T00:00:00.000Z',
    defTurnId,
    turnId,
    role: 'assistant',
    content: [],
    providerId: 'fake-provider',
    modelId: 'fake-model',
    usage: usage(),
    stopReason: 'stop',
    completedAt: '2026-08-08T00:00:00.000Z',
  };
}

function assistantDraft(message: RuntimeAssistantMessage): RuntimeAssistantMessageDraft {
  return {
    schemaVersion: 1,
    id: message.id,
    createdAt: message.createdAt,
    defTurnId: message.defTurnId,
    turnId: message.turnId,
    role: 'assistant',
    content: [],
    providerId: message.providerId,
    modelId: message.modelId,
  };
}

function toolResultMessage(
  id = 'message-controller-tool-result',
  turnId = userTurnId,
): RuntimeToolResultMessage {
  return {
    schemaVersion: 1,
    id: asRuntimeMessageId(id),
    createdAt: '2026-08-08T00:00:00.000Z',
    defTurnId,
    turnId,
    role: 'tool-result',
    toolCallId: asToolCallId(`${id}-call`),
    toolName: 'echo',
    result: { status: 'succeeded', output: null },
    completedAt: '2026-08-08T00:00:00.000Z',
  };
}

function succeededResult(output: unknown, revision: number, ...toolNames: string[]) {
  return {
    toolCallId: asToolCallId('unused'),
    result: { status: 'succeeded', output } as RuntimeToolResultPayload,
    nextProjection: projection(revision, ...toolNames),
  };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise<void>((resolve) => queueMicrotask(resolve));
  }
  assert.fail('fixture did not reach the expected state');
}

test('pure text emits one completed run with DefTurnId on messages, events, and markers', async () => {
  const driver = new FakeModelDriver([textResponse('hello world')]);
  const result = await runAgentLoop(baseInput({ modelDriver: driver }));

  assert.deepEqual(result.terminal, { status: 'completed', output: 'hello world' });
  assert.equal(driver.requests.length, 1);
  assert.equal(result.events.filter((event) => event.type === 'run.start').length, 1);
  assert.equal(result.events.filter((event) => event.type === 'run.end').length, 1);
  assert.equal(result.runMarkers.length, 2);
  assert.ok(result.runMarkers.every((marker) => marker.defTurnId === defTurnId));
  assert.ok(result.events.every((event) => event.type === 'compaction.start'
    || event.type === 'compaction.end'
    || event.defTurnId === defTurnId));
  assert.ok(result.messages.filter((message) => message.role !== 'compaction').every((message) => message.defTurnId === defTurnId));
  const assistant = result.messages.find((message) => message.role === 'assistant');
  assert.equal(assistant?.role, 'assistant');
  assert.deepEqual(assistant?.content, [{
    type: 'text',
    id: asRuntimeContentId('run-p2:assistant:0:content:0'),
    text: 'hello world',
  }]);
});

test('reasoning and text remain separate and preserve source order', async () => {
  const events = numberProviderEvents([
    { type: 'response.start', responseModel: 'fake-model' },
    { type: 'thinking.start', contentIndex: 0 },
    { type: 'thinking.delta', contentIndex: 0, delta: 'think' },
    { type: 'thinking.end', contentIndex: 0, text: 'think', redacted: true },
    { type: 'text.start', contentIndex: 1 },
    { type: 'text.delta', contentIndex: 1, delta: 'answer' },
    { type: 'text.end', contentIndex: 1, text: 'answer' },
    done(),
  ]);
  const result = await runAgentLoop(baseInput({ modelDriver: new FakeModelDriver([events]) }));
  const assistant = result.messages.find((message) => message.role === 'assistant');
  assert.equal(result.terminal.status, 'completed');
  assert.deepEqual(assistant?.role === 'assistant' ? assistant.content : [], [
    { type: 'thinking', id: asRuntimeContentId('run-p2:assistant:0:content:0'), text: 'think', redacted: true },
    { type: 'text', id: asRuntimeContentId('run-p2:assistant:0:content:1'), text: 'answer' },
  ]);
});

test('one Tool waits for an atomic result and next projection before the next model round', async () => {
  const order: string[] = [];
  const bridge = new FakeToolBridge();
  bridge.enqueue(async (input, _signal, onUpdate) => {
    order.push(`tool:${input.call.toolCallId}:start:${input.projectionRevision}`);
    const detail: JsonObject = { phase: 'working' };
    await onUpdate({ toolCallId: input.call.toolCallId, detail });
    detail.phase = 'mutated-after-acceptance';
    order.push('tool:settlement');
    return {
      toolCallId: input.call.toolCallId,
      result: { status: 'succeeded', output: { echoed: true } },
      nextProjection: projection(2, 'echo', 'next'),
    };
  });
  const driver = new FakeModelDriver([
    toolResponse([{ id: 'tool-1', name: 'echo', arguments: { value: 'x' } }]),
    textResponse('after tool'),
  ]);
  const result = await runAgentLoop(baseInput({ modelDriver: driver, toolBridge: bridge }));

  assert.equal(result.terminal.status, 'completed');
  assert.equal(bridge.invocations.length, 1);
  assert.deepEqual(driver.requests.map((request) => request.tools.map((tool) => tool.name)), [
    ['echo', 'first', 'second'],
    ['echo', 'next'],
  ]);
  assert.deepEqual(order, ['tool:tool-1:start:1', 'tool:settlement']);
  const update = result.events.find((event) => event.type === 'tool.update');
  assert.deepEqual(update?.type === 'tool.update' ? update.detail : undefined, { phase: 'working' });
  assert.equal(result.messages.filter((message) => message.role === 'tool-result').length, 1);
  assert.ok(result.events.find((event) => event.type === 'tool.end'));
});

test('multiple Tools execute strictly in assistant source order and Tool failure continues', async () => {
  const order: string[] = [];
  const bridge = new FakeToolBridge();
  bridge.enqueue(async (input) => {
    order.push(input.call.name);
    return {
      toolCallId: input.call.toolCallId,
      result: failedResult(),
      nextProjection: projection(2, 'first', 'second'),
    };
  });
  bridge.enqueue(async (input) => {
    order.push(input.call.name);
    return {
      toolCallId: input.call.toolCallId,
      result: { status: 'succeeded', output: 'second ok' },
      nextProjection: projection(3, 'first', 'second'),
    };
  });
  const driver = new FakeModelDriver([
    toolResponse([
      { id: 'tool-1', name: 'first', arguments: { value: 'one' } },
      { id: 'tool-2', name: 'second', arguments: { value: 'two' } },
    ]),
    textResponse('continued after failure'),
  ]);
  const result = await runAgentLoop(baseInput({ modelDriver: driver, toolBridge: bridge }));

  assert.deepEqual(order, ['first', 'second']);
  assert.deepEqual(bridge.projectionRevisions, [1, 2]);
  assert.equal(driver.requests.length, 2);
  assert.equal(result.terminal.status, 'completed');
  assert.deepEqual(result.messages.filter((message) => message.role === 'tool-result').map((message) => message.result.status), [
    'failed',
    'succeeded',
  ]);
});

test('malformed and output-truncated Tool calls are reported without execution', async () => {
  const bridge = new FakeToolBridge();
  const malformed = numberProviderEvents([
    { type: 'response.start' },
    { type: 'tool-call.start', contentIndex: 0, toolCallId: asToolCallId('tool-malformed'), name: 'echo' },
    { type: 'tool-call.delta', contentIndex: 0, toolCallId: asToolCallId('tool-malformed'), nameDelta: '', argumentsDelta: '{"value":' },
    { type: 'tool-call.end', contentIndex: 0, toolCallId: asToolCallId('tool-malformed'), name: 'echo', arguments: { value: 'ignored' } },
    done('tool-use'),
  ]);
  const truncated = toolResponse([{ id: 'tool-truncated', name: 'echo', arguments: { value: 'partial' } }], 'length');
  const result = await runAgentLoop(baseInput({
    modelDriver: new FakeModelDriver([malformed, truncated, textResponse('recovered')]),
    toolBridge: bridge,
  }));

  assert.equal(result.terminal.status, 'completed');
  assert.equal(bridge.invocations.length, 0);
  assert.equal(result.messages.filter((message) => message.role === 'tool-result').length, 2);
  assert.ok(result.messages.some((message) => message.role === 'tool-result' && message.result.status === 'failed'));
});

test('abort before stream does not call ModelDriver', async () => {
  const abort = new AbortController();
  abort.abort({ code: 'USER_STOP', message: 'user stopped' });
  const driver = new FakeModelDriver();
  const result = await runAgentLoop(baseInput({ modelDriver: driver, signal: abort.signal }));

  assert.deepEqual(result.terminal, { status: 'aborted', code: 'USER_STOP', message: 'user stopped' });
  assert.equal(driver.requests.length, 0);
  assert.deepEqual(result.events.map((event) => event.type), ['run.start', 'run.end']);
});

test('abort during stream closes the stream and rejects late provider progress', async () => {
  const stream = new FakeModelStream();
  const driver = new FakeModelDriver([stream]);
  const controller = new RuntimeRunController({ sessionId, runId, defTurnId, initialTurnId: userTurnId });
  const promise = runAgentLoop(baseInput({ modelDriver: driver, controller }));
  await waitFor(() => driver.requests.length === 1);
  stream.push({ ordinal: 1, type: 'response.start' });
  await waitFor(() => controller.events.some((event) => event.type === 'message.update') === false);
  controller.abort({ code: 'USER_STOP', message: 'during stream' });
  stream.push({ ordinal: 2, type: 'text.start', contentIndex: 0 });
  const result = await promise;

  assert.equal(result.terminal.status, 'aborted');
  assert.equal(driver.requests.length, 1);
  assert.equal(result.events.filter((event) => event.type === 'run.end').length, 1);
});

test('abort while waiting for a Tool prevents a late settlement from starting another model round', async () => {
  const deferred = new DeferredToolSettlement();
  const bridge = new FakeToolBridge();
  bridge.enqueue(async () => deferred.promise);
  const driver = new FakeModelDriver([
    toolResponse([{ id: 'tool-waiting', name: 'echo', arguments: { value: 'wait' } }]),
    textResponse('must not run'),
  ]);
  const controller = new RuntimeRunController({ sessionId, runId, defTurnId, initialTurnId: userTurnId });
  const promise = runAgentLoop(baseInput({ modelDriver: driver, toolBridge: bridge, controller }));
  await waitFor(() => bridge.invocations.length === 1);
  controller.abort({ code: 'USER_STOP', message: 'waiting tool' });
  deferred.resolve(succeededResult('late', 2, 'echo'));
  const result = await promise;

  assert.equal(result.terminal.status, 'aborted');
  assert.equal(driver.requests.length, 1);
  assert.equal(result.events.filter((event) => event.type === 'run.end').length, 1);
});

test('run.end is emitted only after every earlier listener has settled', async () => {
  let messageEndSettled = false;
  let runEndObservedBeforeSettlement = false;
  const listener = async (event: RuntimeEvent): Promise<void> => {
    if (event.type === 'message.end' && event.message.role === 'assistant') {
      await new Promise<void>((resolve) => setTimeout(resolve, 5));
      messageEndSettled = true;
    }
    if (event.type === 'run.end' && !messageEndSettled) runEndObservedBeforeSettlement = true;
  };
  const result = await runAgentLoop(baseInput({ listeners: [listener] }));

  assert.equal(result.terminal.status, 'completed');
  assert.equal(runEndObservedBeforeSettlement, false);
  assert.equal(messageEndSettled, true);
});

test('each terminal is unique and late Runtime events are rejected', async () => {
  const controller = new RuntimeRunController({ sessionId, runId, defTurnId, initialTurnId: userTurnId });
  await controller.start();
  await controller.emit({ type: 'turn.start', runId, defTurnId, turnId: userTurnId });
  await assert.rejects(
    controller.finish({ status: 'completed' }),
    /open turn/u,
  );
  const assistant = assistantMessage();
  await controller.emit({ type: 'message.start', runId, defTurnId, message: assistantDraft(assistant) });
  await controller.emit({ type: 'message.end', runId, defTurnId, message: assistant });
  await controller.emit({
    type: 'turn.end',
    runId,
    defTurnId,
    turnId: userTurnId,
    assistantMessage: assistant,
    toolResultMessageIds: [],
  });
  await controller.finish({ status: 'completed' });
  await assert.rejects(
    controller.emit({ type: 'turn.start', runId, defTurnId, turnId: asRuntimeTurnId('late-turn') }),
    /after the run terminal/u,
  );
  await assert.rejects(controller.finish({ status: 'completed' }), /terminal is not unique/u);
  assert.equal(controller.events.filter((event) => event.type === 'run.end').length, 1);
});

test('a late Provider event after response terminal fails the run without a second terminal', async () => {
  const lateProviderEvent = numberProviderEvents([
    { type: 'response.start', responseId: 'response-late' },
    done(),
    { type: 'text.start', contentIndex: 0 },
  ]);
  const result = await runAgentLoop(baseInput({ modelDriver: new FakeModelDriver([lateProviderEvent]) }));

  assert.deepEqual(result.terminal, {
    status: 'failed',
    code: 'RUNTIME_PROVIDER_LATE_EVENT',
    message: 'The model emitted an event after its terminal.',
  });
  assert.equal(result.events.filter((event) => event.type === 'run.end').length, 1);
});

test('response.start is required once, before successful content and response.done', async (t) => {
  await t.test('missing before content', async () => {
    const result = await runAgentLoop(baseInput({
      modelDriver: new FakeModelDriver([numberProviderEvents([
        { type: 'text.start', contentIndex: 0 },
        done(),
      ])]),
    }));
    assert.equal(result.terminal.status, 'failed');
    assert.equal(result.terminal.status === 'failed' ? result.terminal.code : '', 'RUNTIME_PROVIDER_RESPONSE_START_MISSING');
  });

  await t.test('missing before done', async () => {
    const result = await runAgentLoop(baseInput({
      modelDriver: new FakeModelDriver([numberProviderEvents([done()])]),
    }));
    assert.equal(result.terminal.status === 'failed' ? result.terminal.code : '', 'RUNTIME_PROVIDER_RESPONSE_START_MISSING');
  });

  await t.test('duplicate', async () => {
    const result = await runAgentLoop(baseInput({
      modelDriver: new FakeModelDriver([numberProviderEvents([
        { type: 'response.start', responseId: 'first' },
        { type: 'response.start', responseId: 'second' },
        done(),
      ])]),
    }));
    assert.equal(result.terminal.status === 'failed' ? result.terminal.code : '', 'RUNTIME_PROVIDER_RESPONSE_START_DUPLICATE');
  });

  await t.test('late after terminal', async () => {
    const result = await runAgentLoop(baseInput({
      modelDriver: new FakeModelDriver([numberProviderEvents([
        { type: 'response.start' },
        done(),
        { type: 'response.start' },
      ])]),
    }));
    assert.equal(result.terminal.status === 'failed' ? result.terminal.code : '', 'RUNTIME_PROVIDER_LATE_EVENT');
  });
});

test('response.done rejects unfinished text and thinking blocks', async (t) => {
  for (const type of ['text', 'thinking'] as const) {
    await t.test(type, async () => {
      const result = await runAgentLoop(baseInput({
        modelDriver: new FakeModelDriver([numberProviderEvents([
          { type: 'response.start' },
          type === 'text'
            ? { type: 'text.start', contentIndex: 0 }
            : { type: 'thinking.start', contentIndex: 0 },
          done(),
        ])]),
      }));
      assert.equal(result.terminal.status === 'failed' ? result.terminal.code : '', 'RUNTIME_PROVIDER_CONTENT_UNFINISHED');
      assert.equal(result.events.filter((event) => event.type === 'run.end').length, 1);
    });
  }
});

test('response.error may terminate an HTTP failure without response.start', async () => {
  const result = await runAgentLoop(baseInput({
    modelDriver: new FakeModelDriver([numberProviderEvents([{
      type: 'response.error',
      failure: {
        kind: 'authentication',
        code: 'AUTH_FAILED',
        message: 'Authentication failed.',
        retryable: false,
        statusCode: 401,
      },
    }])]),
  }));

  assert.deepEqual(result.terminal, {
    status: 'failed',
    code: 'AUTH_FAILED',
    message: 'Authentication failed.',
  });
  assert.equal(result.events.filter((event) => event.type === 'run.end').length, 1);
});

test('tool-call.end without start becomes a visible failed Tool lifecycle and the loop continues', async () => {
  const bridge = new FakeToolBridge();
  const callId = asToolCallId('tool-end-only');
  const driver = new FakeModelDriver([
    numberProviderEvents([
      { type: 'response.start' },
      { type: 'tool-call.end', contentIndex: 0, toolCallId: callId, name: 'echo', arguments: { value: 'x' } },
      done('tool-use'),
    ]),
    textResponse('recovered after malformed call'),
  ]);
  const result = await runAgentLoop(baseInput({ modelDriver: driver, toolBridge: bridge }));

  assert.equal(result.terminal.status, 'completed');
  assert.equal(driver.requests.length, 2);
  assert.equal(bridge.invocations.length, 0);
  const lifecycle = result.events.filter((event) =>
    (event.type === 'tool.start' && event.call.toolCallId === callId)
    || (event.type === 'tool.end' && event.toolCallId === callId));
  assert.deepEqual(lifecycle.map((event) => event.type), ['tool.start', 'tool.end']);
  const toolResult = result.messages.find((message) => message.role === 'tool-result' && message.toolCallId === callId);
  assert.equal(toolResult?.role === 'tool-result' ? toolResult.result.status : '', 'failed');
});

test('an initially empty OpenAI Tool name may be completed by later nameDelta chunks', async () => {
  const bridge = new FakeToolBridge();
  const callId = asToolCallId('tool-late-name');
  bridge.enqueue(async (input) => ({
    toolCallId: input.call.toolCallId,
    result: { status: 'succeeded', output: 'ok' },
    nextProjection: projection(2, 'echo'),
  }));
  const driver = new FakeModelDriver([
    numberProviderEvents([
      { type: 'response.start' },
      { type: 'tool-call.start', contentIndex: 0, toolCallId: callId, name: '' },
      { type: 'tool-call.delta', contentIndex: 0, toolCallId: callId, nameDelta: 'ec', argumentsDelta: '{"value":"x"}' },
      { type: 'tool-call.delta', contentIndex: 0, toolCallId: callId, nameDelta: 'ho', argumentsDelta: '' },
      { type: 'tool-call.end', contentIndex: 0, toolCallId: callId, name: 'echo', arguments: { value: 'x' } },
      done('tool-use'),
    ]),
    textResponse('name assembled'),
  ]);
  const result = await runAgentLoop(baseInput({ modelDriver: driver, toolBridge: bridge }));

  assert.equal(result.terminal.status, 'completed');
  assert.equal(bridge.invocations.length, 1);
  assert.equal(bridge.invocations[0]?.call.name, 'echo');
});

test('tool-call.delta must retain the callId established by its contentIndex start', async () => {
  const bridge = new FakeToolBridge();
  const result = await runAgentLoop(baseInput({
    toolBridge: bridge,
    modelDriver: new FakeModelDriver([numberProviderEvents([
      { type: 'response.start' },
      { type: 'tool-call.start', contentIndex: 0, toolCallId: asToolCallId('tool-a'), name: 'echo' },
      {
        type: 'tool-call.delta',
        contentIndex: 0,
        toolCallId: asToolCallId('tool-b'),
        nameDelta: '',
        argumentsDelta: '{}',
      },
    ])]),
  }));

  assert.equal(result.terminal.status === 'failed' ? result.terminal.code : '', 'RUNTIME_PROVIDER_TOOL_ID_CONFLICT');
  assert.equal(bridge.invocations.length, 0);
});

test('Tool presence and provider stopReason must agree', async (t) => {
  await t.test('tool-use requires a Tool', async () => {
    const result = await runAgentLoop(baseInput({
      modelDriver: new FakeModelDriver([numberProviderEvents([
        { type: 'response.start' },
        done('tool-use'),
      ])]),
    }));
    assert.equal(result.terminal.status === 'failed' ? result.terminal.code : '', 'RUNTIME_PROVIDER_STOP_REASON_CONFLICT');
  });

  await t.test('a Tool rejects stop', async () => {
    const callId = asToolCallId('tool-stop-conflict');
    const result = await runAgentLoop(baseInput({
      modelDriver: new FakeModelDriver([numberProviderEvents([
        { type: 'response.start' },
        { type: 'tool-call.start', contentIndex: 0, toolCallId: callId, name: 'echo' },
        { type: 'tool-call.end', contentIndex: 0, toolCallId: callId, name: 'echo', arguments: {} },
        done('stop'),
      ])]),
    }));
    assert.equal(result.terminal.status === 'failed' ? result.terminal.code : '', 'RUNTIME_PROVIDER_STOP_REASON_CONFLICT');
  });
});

test('oversized Tool argument streams stay bounded, fail visibly, and never reach the bridge', async () => {
  const bridge = new FakeToolBridge();
  const callId = asToolCallId('tool-oversized');
  const oversized = `{"value":"${'x'.repeat(300 * 1_024)}"}`;
  const driver = new FakeModelDriver([
    numberProviderEvents([
      { type: 'response.start' },
      { type: 'tool-call.start', contentIndex: 0, toolCallId: callId, name: 'echo' },
      { type: 'tool-call.delta', contentIndex: 0, toolCallId: callId, nameDelta: '', argumentsDelta: oversized },
      { type: 'tool-call.end', contentIndex: 0, toolCallId: callId, name: 'echo', arguments: { value: 'ignored' } },
      done('tool-use'),
    ]),
    textResponse('continued after oversized call'),
  ]);
  const result = await runAgentLoop(baseInput({ modelDriver: driver, toolBridge: bridge }));

  assert.equal(result.terminal.status, 'completed');
  assert.equal(bridge.invocations.length, 0);
  const argumentDeltas = result.events
    .filter((event) => event.type === 'message.update' && event.delta.type === 'tool-call')
    .map((event) => event.type === 'message.update' && event.delta.type === 'tool-call' ? event.delta.argumentsDelta.length : 0);
  assert.ok(argumentDeltas.every((length) => length <= 256 * 1_024));
  assert.ok(result.events.some((event) => event.type === 'tool.end' && event.toolCallId === callId && event.result.status === 'failed'));
});

test('RuntimeRunController rejects message role and turn correlation swaps', async (t) => {
  await t.test('role swap', async () => {
    const controller = new RuntimeRunController({ sessionId, runId, defTurnId, initialTurnId: userTurnId });
    await controller.start();
    await controller.emit({ type: 'turn.start', runId, defTurnId, turnId: userTurnId });
    const user = userMessage();
    await controller.emit({ type: 'message.start', runId, defTurnId, message: user });
    const forged = { ...assistantMessage(user.id), id: user.id };
    await assert.rejects(
      controller.emit({ type: 'message.end', runId, defTurnId, message: forged }),
      (error: unknown) => error instanceof RuntimeRunProtocolError && error.code === 'RUNTIME_MESSAGE_ROLE_CONFLICT',
    );
    await controller.emit({ type: 'message.end', runId, defTurnId, message: user });
    const assistant = assistantMessage('message-role-swap-cleanup');
    await controller.emit({ type: 'message.start', runId, defTurnId, message: assistantDraft(assistant) });
    await controller.emit({ type: 'message.end', runId, defTurnId, message: assistant });
    await controller.emit({
      type: 'turn.end',
      runId,
      defTurnId,
      turnId: userTurnId,
      assistantMessage: assistant,
      toolResultMessageIds: [],
    });
    await controller.finish({ status: 'completed' });
  });

  await t.test('turn swap', async () => {
    const controller = new RuntimeRunController({ sessionId, runId, defTurnId, initialTurnId: userTurnId });
    await controller.start();
    await controller.emit({ type: 'turn.start', runId, defTurnId, turnId: userTurnId });
    const assistant = assistantMessage('message-turn-swap');
    await controller.emit({ type: 'message.start', runId, defTurnId, message: assistantDraft(assistant) });
    const wrongTurn = { ...assistant, turnId: asRuntimeTurnId('turn-p2-wrong') };
    await assert.rejects(
      controller.emit({ type: 'message.end', runId, defTurnId, message: wrongTurn }),
      (error: unknown) => error instanceof RuntimeRunProtocolError && error.code === 'RUNTIME_MESSAGE_TURN_CONFLICT',
    );
    await controller.emit({ type: 'message.end', runId, defTurnId, message: assistant });
    await controller.emit({
      type: 'turn.end',
      runId,
      defTurnId,
      turnId: userTurnId,
      assistantMessage: assistant,
      toolResultMessageIds: [],
    });
    await controller.finish({ status: 'completed' });
  });
});

test('open messages prevent turn.end and run.end', async () => {
  const controller = new RuntimeRunController({ sessionId, runId, defTurnId, initialTurnId: userTurnId });
  await controller.start();
  await controller.emit({ type: 'turn.start', runId, defTurnId, turnId: userTurnId });
  const assistant = assistantMessage('message-open-assistant');
  await controller.emit({ type: 'message.start', runId, defTurnId, message: assistantDraft(assistant) });
  await assert.rejects(
    controller.emit({
      type: 'turn.end',
      runId,
      defTurnId,
      turnId: userTurnId,
      assistantMessage: assistant,
      toolResultMessageIds: [],
    }),
    (error: unknown) => error instanceof RuntimeRunProtocolError && error.code === 'RUNTIME_MESSAGE_OPEN',
  );
  await controller.emit({ type: 'message.end', runId, defTurnId, message: assistant });
  await controller.emit({
    type: 'turn.end',
    runId,
    defTurnId,
    turnId: userTurnId,
    assistantMessage: assistant,
    toolResultMessageIds: [],
  });

  const compaction = {
    schemaVersion: 1 as const,
    id: asRuntimeMessageId('message-open-compaction'),
    createdAt: '2026-08-08T00:00:00.000Z',
    role: 'compaction' as const,
    summary: 'bounded summary',
    firstKeptEntryId: asRuntimeEntryId('entry-kept'),
    tokensBefore: 10,
    reason: 'threshold' as const,
    completedAt: '2026-08-08T00:00:00.000Z',
  };
  await controller.emit({ type: 'message.start', runId, defTurnId, message: compaction });
  await assert.rejects(
    controller.finish({ status: 'completed' }),
    (error: unknown) => error instanceof RuntimeRunProtocolError && error.code === 'RUNTIME_RUN_OPEN_WORK',
  );
  await controller.emit({ type: 'message.end', runId, defTurnId, message: compaction });
  await controller.finish({ status: 'completed' });
});

test('turn.end rejects forged Tool result message IDs', async () => {
  const controller = new RuntimeRunController({ sessionId, runId, defTurnId, initialTurnId: userTurnId });
  await controller.start();
  await controller.emit({ type: 'turn.start', runId, defTurnId, turnId: userTurnId });
  const user = userMessage();
  await controller.emit({ type: 'message.start', runId, defTurnId, message: user });
  await controller.emit({ type: 'message.end', runId, defTurnId, message: user });
  const toolResult = toolResultMessage();
  await controller.emit({ type: 'message.start', runId, defTurnId, message: toolResult });
  await controller.emit({ type: 'message.end', runId, defTurnId, message: toolResult });
  const assistant = assistantMessage('message-forged-result-assistant');
  await controller.emit({ type: 'message.start', runId, defTurnId, message: assistantDraft(assistant) });
  await controller.emit({ type: 'message.end', runId, defTurnId, message: assistant });
  await assert.rejects(
    controller.emit({
      type: 'turn.end',
      runId,
      defTurnId,
      turnId: userTurnId,
      assistantMessage: assistant,
      toolResultMessageIds: [user.id],
    }),
    (error: unknown) => error instanceof RuntimeRunProtocolError && error.code === 'RUNTIME_TOOL_RESULT_INVALID',
  );
  await controller.emit({
    type: 'turn.end',
    runId,
    defTurnId,
    turnId: userTurnId,
    assistantMessage: assistant,
    toolResultMessageIds: [toolResult.id],
  });
  await controller.finish({ status: 'completed' });
});

test('RuntimeTurnId cannot repeat within one run', async () => {
  const controller = new RuntimeRunController({ sessionId, runId, defTurnId, initialTurnId: userTurnId });
  await controller.start();
  await controller.emit({ type: 'turn.start', runId, defTurnId, turnId: userTurnId });
  const assistant = assistantMessage('message-duplicate-turn');
  await controller.emit({ type: 'message.start', runId, defTurnId, message: assistantDraft(assistant) });
  await controller.emit({ type: 'message.end', runId, defTurnId, message: assistant });
  await controller.emit({
    type: 'turn.end',
    runId,
    defTurnId,
    turnId: userTurnId,
    assistantMessage: assistant,
    toolResultMessageIds: [],
  });
  await assert.rejects(
    controller.emit({ type: 'turn.start', runId, defTurnId, turnId: userTurnId }),
    (error: unknown) => error instanceof RuntimeRunProtocolError && error.code === 'RUNTIME_TURN_ID_DUPLICATE',
  );
  await controller.finish({ status: 'completed' });
});

test('listener re-entrant emit/finish are rejected without deadlock while abort remains callable', async () => {
  let controller!: RuntimeRunController;
  const reentrantCodes: string[] = [];
  const listener = async (event: RuntimeEvent): Promise<void> => {
    if (event.type !== 'turn.start') return;
    assert.equal(controller.abort({ code: 'LISTENER_STOP', message: 'listener requested abort' }), true);
    for (const operation of [
      () => controller.emit({
        type: 'retry.scheduled',
        runId,
        defTurnId,
        attempt: 1,
        delayMs: 0,
        failure: {
          kind: 'network',
          code: 'NETWORK_FAILED',
          message: 'network failed',
          retryable: true,
        },
      }),
      () => controller.finish({ status: 'completed' }),
    ]) {
      try {
        await operation();
      } catch (error) {
        if (error instanceof RuntimeRunProtocolError) reentrantCodes.push(error.code);
        else throw error;
      }
    }
  };
  controller = new RuntimeRunController({ sessionId, runId, defTurnId, initialTurnId: userTurnId, listeners: [listener] });
  await controller.start();
  await Promise.race([
    controller.emit({ type: 'turn.start', runId, defTurnId, turnId: userTurnId }),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('re-entrant listener deadlocked')), 250)),
  ]);
  assert.equal(controller.signal.aborted, true);
  assert.deepEqual(reentrantCodes, ['RUNTIME_LISTENER_REENTRANT', 'RUNTIME_LISTENER_REENTRANT']);
  const assistant = assistantMessage('message-reentrant-listener');
  await controller.emit({ type: 'message.start', runId, defTurnId, message: assistantDraft(assistant) });
  await controller.emit({ type: 'message.end', runId, defTurnId, message: assistant });
  await controller.emit({
    type: 'turn.end',
    runId,
    defTurnId,
    turnId: userTurnId,
    assistantMessage: assistant,
    toolResultMessageIds: [],
  });
  await controller.finish({ status: 'aborted', code: 'LISTENER_STOP', message: 'listener requested abort' });
  assert.equal(controller.events.filter((event) => event.type === 'run.end').length, 1);
});

test('a Tool name that remains empty at tool-call.end fails without bridge execution', async () => {
  const bridge = new FakeToolBridge();
  const callId = asToolCallId('tool-empty-name');
  const driver = new FakeModelDriver([
    numberProviderEvents([
      { type: 'response.start' },
      { type: 'tool-call.start', contentIndex: 0, toolCallId: callId, name: '' },
      { type: 'tool-call.delta', contentIndex: 0, toolCallId: callId, nameDelta: '', argumentsDelta: '{}' },
      { type: 'tool-call.end', contentIndex: 0, toolCallId: callId, name: '', arguments: {} },
      done('tool-use'),
    ]),
    textResponse('empty name recovered'),
  ]);
  const result = await runAgentLoop(baseInput({ modelDriver: driver, toolBridge: bridge }));

  assert.equal(result.terminal.status, 'completed');
  assert.equal(bridge.invocations.length, 0);
  assert.ok(result.events.some(
    (event) => event.type === 'tool.end' && event.toolCallId === callId && event.result.status === 'failed',
  ));
});

test('not-projected and schema-invalid Tools receive complete failed lifecycles without Host calls', async () => {
  const bridge = new FakeToolBridge();
  const notProjected = asToolCallId('tool-not-projected');
  const invalidArguments = asToolCallId('tool-invalid-arguments');
  const strictProjection: RuntimeToolProjection = {
    revision: 1,
    tools: [{
      name: 'echo',
      description: 'strict echo',
      risk: 'read',
      inputSchema: {
        type: 'object',
        required: ['value'],
        properties: { value: { type: 'string' } },
        additionalProperties: false,
      },
    }],
  };
  const driver = new FakeModelDriver([
    toolResponse([{ id: notProjected, name: 'missing', arguments: {} }]),
    toolResponse([{ id: invalidArguments, name: 'echo', arguments: { value: 1 } }]),
    textResponse('recovered after local Tool failures'),
  ]);
  const result = await runAgentLoop(baseInput({
    modelDriver: driver,
    toolBridge: bridge,
    tools: strictProjection,
  }));

  assert.equal(result.terminal.status, 'completed');
  assert.equal(bridge.invocations.length, 0);
  for (const callId of [notProjected, invalidArguments]) {
    const lifecycle = result.events.filter((event) =>
      (event.type === 'tool.start' && event.call.toolCallId === callId)
      || (event.type === 'tool.end' && event.toolCallId === callId));
    assert.deepEqual(lifecycle.map((event) => event.type), ['tool.start', 'tool.end']);
  }
});

test('projection and settlement JSON are deeply cloned at their acceptance boundaries', async () => {
  const initialSchema: JsonObject = {
    type: 'object',
    properties: { value: { type: 'string' } },
  };
  const nextSchema: JsonObject = {
    type: 'object',
    properties: { count: { type: 'number' } },
  };
  const initialProjection: RuntimeToolProjection = {
    revision: 1,
    tools: [{ name: 'echo', description: 'initial echo', inputSchema: initialSchema, risk: 'read' }],
  };
  const nextProjection: RuntimeToolProjection = {
    revision: 2,
    tools: [{ name: 'echo', description: 'next echo', inputSchema: nextSchema, risk: 'read' }],
  };
  const settlementOutput: JsonObject = { nested: { accepted: true } };
  const bridge = new FakeToolBridge();
  bridge.enqueue(async (input) => ({
    toolCallId: input.call.toolCallId,
    result: { status: 'succeeded', output: settlementOutput },
    nextProjection,
  }));
  const driver = new FakeModelDriver([
    toolResponse([{ id: 'tool-clone', name: 'echo', arguments: { value: 'x' } }]),
    textResponse('cloned'),
  ]);
  const pending = runAgentLoop(baseInput({
    modelDriver: driver,
    toolBridge: bridge,
    tools: initialProjection,
  }));
  ((initialSchema.properties as JsonObject).value as JsonObject).type = 'boolean';
  const result = await pending;
  ((nextSchema.properties as JsonObject).count as JsonObject).type = 'string';
  (settlementOutput.nested as JsonObject).accepted = false;

  assert.equal(
    (((driver.requests[0]?.tools[0]?.inputSchema.properties as JsonObject).value as JsonObject).type),
    'string',
  );
  assert.equal(
    (((driver.requests[1]?.tools[0]?.inputSchema.properties as JsonObject).count as JsonObject).type),
    'number',
  );
  assert.equal(
    (((result.finalProjection.tools[0]?.inputSchema.properties as JsonObject).count as JsonObject).type),
    'number',
  );
  const toolResult = result.messages.find((message) => message.role === 'tool-result');
  assert.deepEqual(toolResult?.role === 'tool-result' ? toolResult.result : undefined, {
    status: 'succeeded',
    output: { nested: { accepted: true } },
  });
});

test('Tool settlement projection revisions cannot move backwards', async () => {
  const bridge = new FakeToolBridge();
  bridge.enqueue(async (input) => ({
    toolCallId: input.call.toolCallId,
    result: { status: 'succeeded', output: 'ignored' },
    nextProjection: projection(0, 'echo'),
  }));
  const driver = new FakeModelDriver([
    toolResponse([{ id: 'tool-revision-regression', name: 'echo', arguments: {} }]),
    textResponse('must not run'),
  ]);
  const result = await runAgentLoop(baseInput({ modelDriver: driver, toolBridge: bridge }));

  assert.equal(
    result.terminal.status === 'failed' ? result.terminal.code : '',
    'RUNTIME_TOOL_PROJECTION_REVISION_REGRESSION',
  );
  assert.equal(driver.requests.length, 1);
  assert.equal(result.events.filter((event) => event.type === 'run.end').length, 1);
});

test('invalid Tool updates fail the active run instead of being swallowed', async (t) => {
  await t.test('callId mismatch', async () => {
    const bridge = new FakeToolBridge();
    bridge.enqueue(async (input, _signal, onUpdate) => {
      await onUpdate({ toolCallId: asToolCallId('different-call'), detail: { phase: 'invalid' } });
      return {
        toolCallId: input.call.toolCallId,
        result: { status: 'succeeded', output: 'ignored' },
        nextProjection: projection(2, 'echo'),
      };
    });
    const driver = new FakeModelDriver([
      toolResponse([{ id: 'tool-update-id', name: 'echo', arguments: {} }]),
      textResponse('must not run'),
    ]);
    const result = await runAgentLoop(baseInput({ modelDriver: driver, toolBridge: bridge }));
    assert.equal(result.terminal.status === 'failed' ? result.terminal.code : '', 'RUNTIME_TOOL_UPDATE_INVALID');
    assert.equal(driver.requests.length, 1);
  });

  await t.test('detail outside bounded JSON', async () => {
    const bridge = new FakeToolBridge();
    bridge.enqueue(async (input, _signal, onUpdate) => {
      await onUpdate({
        toolCallId: input.call.toolCallId,
        detail: { payload: 'x'.repeat(70 * 1_024) },
      });
      return {
        toolCallId: input.call.toolCallId,
        result: { status: 'succeeded', output: 'ignored' },
        nextProjection: projection(2, 'echo'),
      };
    });
    const driver = new FakeModelDriver([
      toolResponse([{ id: 'tool-update-detail', name: 'echo', arguments: {} }]),
      textResponse('must not run'),
    ]);
    const result = await runAgentLoop(baseInput({ modelDriver: driver, toolBridge: bridge }));
    assert.equal(result.terminal.status === 'failed' ? result.terminal.code : '', 'RUNTIME_TOOL_UPDATE_INVALID');
    assert.equal(driver.requests.length, 1);
    assert.equal(result.events.filter((event) => event.type === 'tool.update').length, 0);
  });
});

test('projection descriptor fields and inputSchema obey bounded unique JSON contracts', async () => {
  const cyclicSchema: Record<string, unknown> = { type: 'object' };
  cyclicSchema.self = cyclicSchema;
  const invalidProjections: unknown[] = [
    {
      revision: 1,
      tools: [
        { name: 'echo', description: 'one', inputSchema: {}, risk: 'read' },
        { name: 'echo', description: 'two', inputSchema: {}, risk: 'read' },
      ],
    },
    { revision: 1, tools: [{ name: 'echo', description: 'x', inputSchema: {}, risk: 'unknown' }] },
    { revision: 1, tools: [{ name: 'echo', description: 'x'.repeat(17 * 1_024), inputSchema: {}, risk: 'read' }] },
    { revision: 1, tools: [{ name: 'echo', description: 'x', inputSchema: cyclicSchema, risk: 'read' }] },
  ];

  for (const tools of invalidProjections) {
    const result = await runAgentLoop(baseInput({ tools: tools as RuntimeToolProjection }));
    assert.equal(result.terminal.status === 'failed' ? result.terminal.code : '', 'RUNTIME_TOOL_PROJECTION_INVALID');
    assert.equal(result.events.filter((event) => event.type === 'run.end').length, 1);
  }
});
