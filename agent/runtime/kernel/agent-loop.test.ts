import assert from 'node:assert/strict';
import test from 'node:test';
import { asClientTurnId, asDefTurnId, asToolCallId } from '../../core/contracts/ids.ts';
import type { JsonObject } from '../../core/contracts/json.ts';
import {
  asRuntimeContentId,
  asRuntimeMessageId,
  asRuntimeRunId,
  asRuntimeSessionId,
  asRuntimeTurnId,
} from './ids.ts';
import { runAgentLoop } from './agent-loop.ts';
import { RuntimeRunController } from './run-controller.ts';
import type { RuntimeMessage, RuntimeUserMessage } from './messages.ts';
import type { ProviderStreamEvent, RuntimeEvent } from './stream-events.ts';
import type { RuntimeToolResultPayload } from './messages.ts';
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
    await onUpdate({ toolCallId: input.call.toolCallId, detail: { phase: 'working' } });
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
  const assistant = {
    schemaVersion: 1 as const,
    id: asRuntimeMessageId('message-controller-assistant'),
    createdAt: '2026-08-08T00:00:00.000Z',
    defTurnId,
    turnId: userTurnId,
    role: 'assistant' as const,
    content: [],
    providerId: 'fake-provider',
    modelId: 'fake-model',
    usage: usage(),
    stopReason: 'stop' as const,
    completedAt: '2026-08-08T00:00:00.000Z',
  };
  await controller.emit({ type: 'message.start', runId, defTurnId, message: { ...assistant, content: [] } });
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
  await assert.rejects(controller.finish({ status: 'completed' }), /requires a running run/u);
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
