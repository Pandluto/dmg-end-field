import assert from 'node:assert/strict';
import test from 'node:test';
import type { ProviderStreamEvent } from '../stream-events.ts';
import type { RuntimeModelRequest } from './model-driver.ts';
import { OpenAICompatibleDriver } from './openai-compatible-driver.ts';
import type { RetryTimers } from './retry-policy.ts';

async function collect(stream: AsyncIterable<ProviderStreamEvent>): Promise<ProviderStreamEvent[]> {
  const events: ProviderStreamEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

function makeRequest(
  signal: AbortSignal = new AbortController().signal,
  baseUrl = 'https://provider.test/v1',
): RuntimeModelRequest {
  return {
    runId: 'run-1',
    turnId: 'turn-1',
    connection: {
      providerId: 'deepseek',
      modelId: 'deepseek-reasoner',
      baseUrl,
      apiKey: 'sk-test-secret',
      headers: { 'X-Provider-Test': 'present' },
      outputLimit: 512,
    },
    systemPrompt: 'You are a deterministic test assistant.',
    messages: [{
      schemaVersion: 1,
      id: 'user-message-1',
      createdAt: '2026-08-08T00:00:00.000Z',
      defTurnId: 'def-turn-1',
      turnId: 'turn-1',
      role: 'user',
      clientTurnId: 'client-turn-1',
      content: [{ type: 'text', id: 'user-content-1', text: 'inspect the fixture' }],
    }],
    tools: [{
      name: 'read_timeline',
      description: 'Read timeline facts.',
      inputSchema: { type: 'object', properties: { timelineId: { type: 'string' } } },
      risk: 'read',
    }],
    signal,
  } as unknown as RuntimeModelRequest;
}

function sseData(value: unknown): string {
  return `data: ${typeof value === 'string' ? value : JSON.stringify(value)}\n\n`;
}

function oneByteChunks(value: string): Uint8Array[] {
  const encoded = new TextEncoder().encode(value);
  return Array.from({ length: encoded.length }, (_, index) => encoded.slice(index, index + 1));
}

function responseFromSse(values: readonly unknown[], splitBytes = false): Response {
  const text = values.map(sseData).join('');
  return responseFromChunks(splitBytes ? oneByteChunks(text) : [new TextEncoder().encode(text)]);
}

function responseFromChunks(chunks: readonly Uint8Array[], status = 200): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/event-stream' },
  });
}

function responseThatDropsAfter(value: string): Response {
  let sent = false;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (!sent) {
        sent = true;
        controller.enqueue(new TextEncoder().encode(value));
        return;
      }
      controller.error(new Error('network drop with Authorization: Bearer sk-test-secret'));
    },
  }, { highWaterMark: 0 });
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

function queuedFetch(replies: readonly (Response | Error)[]): {
  readonly fetch: typeof fetch;
  readonly calls: Array<{ input: RequestInfo | URL; init?: RequestInit }>;
} {
  let index = 0;
  const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    calls.push({ input, init });
    const reply = replies[Math.min(index++, replies.length - 1)];
    if (reply instanceof Error) throw reply;
    return reply!;
  };
  return { fetch, calls };
}

function immediateTimers(): RetryTimers {
  return {
    setTimeout: (callback) => {
      callback();
      return 0 as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimeout: () => undefined,
  };
}

function terminalEvents(events: readonly ProviderStreamEvent[]): ProviderStreamEvent[] {
  return events.filter((event) => event.type === 'response.done' || event.type === 'response.error');
}

function requireResponseError(events: readonly ProviderStreamEvent[]): Extract<ProviderStreamEvent, { type: 'response.error' }> {
  const event = terminalEvents(events).at(-1);
  assert.ok(event?.type === 'response.error');
  return event;
}

test('OpenAI-compatible driver preserves UTF-8, reasoning/text order, usage, and request mapping', async () => {
  const queued = queuedFetch([
    responseFromSse([
      {
        id: 'response-1',
        model: 'deepseek-reasoner',
        choices: [{ index: 0, delta: { role: 'assistant', reasoning_content: '思' } }],
      },
      { choices: [{ index: 0, delta: { reasoning_content: '考' } }] },
      { choices: [{ index: 0, delta: { content: '你好' } }] },
      { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
      {
        choices: [],
        usage: { prompt_tokens: 7, completion_tokens: 5, total_tokens: 12 },
      },
      '[DONE]',
    ], true),
  ]);
  const events = await collect(new OpenAICompatibleDriver({
    fetch: queued.fetch,
    retryPolicy: { maxRetries: 0 },
  }).stream(makeRequest()));

  assert.deepEqual(events.map((event) => event.type), [
    'response.start',
    'thinking.start',
    'thinking.delta',
    'thinking.delta',
    'thinking.end',
    'text.start',
    'text.delta',
    'text.end',
    'response.done',
  ]);
  const thinkingEnd = events.find((event) => event.type === 'thinking.end');
  const textEnd = events.find((event) => event.type === 'text.end');
  assert.equal(thinkingEnd?.type === 'thinking.end' ? thinkingEnd.text : '', '思考');
  assert.equal(textEnd?.type === 'text.end' ? textEnd.text : '', '你好');
  const done = events.find((event) => event.type === 'response.done');
  assert.equal(done?.type === 'response.done' ? done.stopReason : '', 'stop');
  assert.deepEqual(done?.type === 'response.done' ? done.usage : undefined, {
    inputTokens: 7,
    outputTokens: 5,
    totalTokens: 12,
  });
  assert.deepEqual(events.map((event) => event.ordinal), events.map((_, index) => index + 1));

  const call = queued.calls[0]!;
  assert.equal(String(call.input), 'https://provider.test/v1/chat/completions');
  const headers = new Headers(call.init?.headers);
  assert.equal(headers.get('authorization'), 'Bearer sk-test-secret');
  assert.equal(headers.get('accept'), 'text/event-stream');
  const body = JSON.parse(String(call.init?.body)) as Record<string, unknown>;
  assert.equal(body.model, 'deepseek-reasoner');
  assert.equal(body.stream, true);
  assert.deepEqual(body.stream_options, { include_usage: true });
  assert.equal(Array.isArray(body.tools), true);
  assert.equal(JSON.stringify(events).includes('sk-test-secret'), false);
});

test('OpenAI-compatible driver emits complete incremental tool calls only', async () => {
  const queued = queuedFetch([responseFromSse([
    {
      id: 'response-tool',
      choices: [{
        index: 0,
        delta: {
          tool_calls: [{
            index: 0,
            id: 'call-1',
            type: 'function',
            function: { name: 'read_', arguments: '{"timelineId":' },
          }],
        },
      }],
    },
    {
      choices: [{
        index: 0,
        delta: {
          tool_calls: [{ function: { name: 'timeline', arguments: '"a"}' } }],
        },
      }],
    },
    { choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] },
    { choices: [], usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 } },
    '[DONE]',
  ])]);
  const events = await collect(new OpenAICompatibleDriver({
    fetch: queued.fetch,
    retryPolicy: { maxRetries: 0 },
  }).stream(makeRequest()));

  const starts = events.filter((event): event is Extract<ProviderStreamEvent, { type: 'tool-call.start' }> => (
    event.type === 'tool-call.start'
  ));
  const deltas = events.filter((event): event is Extract<ProviderStreamEvent, { type: 'tool-call.delta' }> => (
    event.type === 'tool-call.delta'
  ));
  const ends = events.filter((event): event is Extract<ProviderStreamEvent, { type: 'tool-call.end' }> => (
    event.type === 'tool-call.end'
  ));
  assert.equal(starts.length, 1);
  assert.equal(deltas.length, 2);
  assert.equal(ends.length, 1);
  const reconstructedName = deltas.reduce((name, event) => name + event.nameDelta, starts[0]!.name);
  const reconstructedArguments = deltas.reduce(
    (argumentsJson, event) => argumentsJson + event.argumentsDelta,
    '',
  );
  assert.equal(starts[0]!.name, 'read_');
  assert.deepEqual(deltas.map((event) => event.nameDelta), ['', 'timeline']);
  assert.deepEqual(deltas.map((event) => event.argumentsDelta), ['{"timelineId":', '"a"}']);
  assert.equal(reconstructedName, 'read_timeline');
  assert.equal(reconstructedArguments, '{"timelineId":"a"}');
  assert.equal(ends[0]!.name, reconstructedName);
  assert.deepEqual(ends[0]!.arguments, {
    timelineId: 'a',
  });
  assert.equal(terminalEvents(events).length, 1);
  assert.equal(terminalEvents(events)[0]?.type, 'response.done');
  assert.equal((terminalEvents(events)[0] as Extract<ProviderStreamEvent, { type: 'response.done' }>).stopReason, 'tool-use');
});

test('OpenAI-compatible driver keeps canonical Tool names behind provider-safe history aliases', async () => {
  const queued = queuedFetch([responseFromSse([
    {
      id: 'response-canonical-tool',
      choices: [{
        index: 0,
        delta: {
          tool_calls: [{
            index: 0,
            id: 'call-context',
            type: 'function',
            function: { name: 'def.node_crud_context', arguments: '{}' },
          }],
        },
      }],
    },
    { choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] },
    '[DONE]',
  ])]);
  const base = makeRequest();
  const request = {
    ...base,
    messages: [
      ...base.messages,
      {
        schemaVersion: 1,
        id: 'assistant-route-history',
        createdAt: '2026-08-08T00:00:01.000Z',
        completedAt: '2026-08-08T00:00:02.000Z',
        defTurnId: 'def-turn-1',
        turnId: 'turn-1',
        role: 'assistant',
        providerId: 'deepseek',
        modelId: 'deepseek-reasoner',
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        stopReason: 'tool-use',
        content: [{
          type: 'tool-call',
          id: 'route-content-history',
          toolCallId: 'call-route-history',
          name: 'def.harness.route',
          arguments: { businessId: 'calculation', operation: 'diagnose' },
        }],
      },
      {
        schemaVersion: 1,
        id: 'tool-route-history',
        createdAt: '2026-08-08T00:00:02.000Z',
        completedAt: '2026-08-08T00:00:02.000Z',
        defTurnId: 'def-turn-1',
        turnId: 'turn-1',
        role: 'tool-result',
        toolCallId: 'call-route-history',
        toolName: 'def.harness.route',
        result: { status: 'succeeded', output: { ok: true } },
      },
    ],
    tools: [{
      name: 'def.node.crud.context',
      description: 'Read current context.',
      inputSchema: { type: 'object', properties: {} },
      risk: 'read',
    }],
  } as unknown as RuntimeModelRequest;

  const events = await collect(new OpenAICompatibleDriver({
    fetch: queued.fetch,
    retryPolicy: { maxRetries: 0 },
  }).stream(request));
  const body = JSON.parse(String(queued.calls[0]?.init?.body)) as {
    tools: Array<{ function: { name: string } }>;
    messages: Array<{
      role: string;
      name?: string;
      tool_calls?: Array<{ function: { name: string } }>;
    }>;
  };
  assert.equal(body.tools[0]?.function.name, 'def_node_crud_context');
  assert.equal(body.messages.find((message) => message.role === 'assistant')?.tool_calls?.[0]?.function.name, 'def_harness_route');
  assert.equal(body.messages.find((message) => message.role === 'tool')?.name, 'def_harness_route');
  const toolEnd = events.find((event) => event.type === 'tool-call.end');
  assert.equal(toolEnd?.type === 'tool-call.end' ? toolEnd.name : '', 'def.node.crud.context');
});

test('malformed or truncated tool arguments never produce tool-call.end', async () => {
  const queued = queuedFetch([responseFromSse([
    {
      id: 'response-bad-tool',
      choices: [{
        index: 0,
        delta: {
          tool_calls: [{
            index: 0,
            id: 'call-bad',
            function: { name: 'read_timeline', arguments: '{"timelineId":' },
          }],
        },
      }],
    },
    { choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] },
    '[DONE]',
  ])]);
  const events = await collect(new OpenAICompatibleDriver({
    fetch: queued.fetch,
    retryPolicy: { maxRetries: 0 },
  }).stream(makeRequest()));

  assert.equal(events.some((event) => event.type === 'tool-call.end'), false);
  const terminals = terminalEvents(events);
  assert.equal(terminals.length, 1);
  assert.equal(terminals[0]?.type, 'response.error');
  assert.equal(terminals[0]?.type === 'response.error' ? terminals[0].failure.kind : '', 'malformed-response');
});

test('401 and 403 are sanitized and never retried', async () => {
  for (const status of [401, 403]) {
    const queued = queuedFetch([new Response('secret body sk-live-provider-key', { status })]);
    const events = await collect(new OpenAICompatibleDriver({
      fetch: queued.fetch,
      retryPolicy: { maxRetries: 2, baseDelayMs: 0, maxDelayMs: 0, jitterRatio: 0 },
      timers: immediateTimers(),
    }).stream(makeRequest()));
    assert.equal(queued.calls.length, 1);
    assert.equal(terminalEvents(events).length, 1);
    assert.equal(requireResponseError(events).failure.kind, 'authentication');
    assert.equal(JSON.stringify(events).includes('sk-live-provider-key'), false);
  }
});

test('429 and 5xx use bounded retries, while a pre-response network drop can resume', async () => {
  const rateLimit = queuedFetch([
    new Response(null, { status: 429, headers: { 'retry-after': '0' } }),
    responseFromSse([{ id: 'after-429', choices: [{ delta: { content: 'ok' } }] }, '[DONE]']),
  ]);
  const rateEvents = await collect(new OpenAICompatibleDriver({
    fetch: rateLimit.fetch,
    retryPolicy: { maxRetries: 1, baseDelayMs: 0, maxDelayMs: 0, jitterRatio: 0 },
    timers: immediateTimers(),
  }).stream(makeRequest()));
  assert.equal(rateLimit.calls.length, 2);
  assert.equal(terminalEvents(rateEvents)[0]?.type, 'response.done');

  const server = queuedFetch([
    new Response(null, { status: 503 }),
    new Response(null, { status: 503 }),
  ]);
  const serverEvents = await collect(new OpenAICompatibleDriver({
    fetch: server.fetch,
    retryPolicy: { maxRetries: 1, baseDelayMs: 0, maxDelayMs: 0, jitterRatio: 0 },
    timers: immediateTimers(),
  }).stream(makeRequest()));
  assert.equal(server.calls.length, 2);
  assert.equal(requireResponseError(serverEvents).failure.kind, 'server');

  const network = queuedFetch([
    new Error('network drop'),
    responseFromSse([{ id: 'after-network', choices: [{ delta: { content: 'ok' } }] }, '[DONE]']),
  ]);
  const networkEvents = await collect(new OpenAICompatibleDriver({
    fetch: network.fetch,
    retryPolicy: { maxRetries: 1, baseDelayMs: 0, maxDelayMs: 0, jitterRatio: 0 },
    timers: immediateTimers(),
  }).stream(makeRequest()));
  assert.equal(network.calls.length, 2);
  assert.equal(terminalEvents(networkEvents)[0]?.type, 'response.done');
});

test('mid-stream network drops produce one terminal and never duplicate partial output', async () => {
  const prefix = `${sseData({
    id: 'response-drop',
    choices: [{ index: 0, delta: { content: 'partial' } }],
  })}`;
  const queued = queuedFetch([responseThatDropsAfter(prefix)]);
  const events = await collect(new OpenAICompatibleDriver({
    fetch: queued.fetch,
    retryPolicy: { maxRetries: 2, baseDelayMs: 0, maxDelayMs: 0, jitterRatio: 0 },
    timers: immediateTimers(),
  }).stream(makeRequest()));
  assert.equal(queued.calls.length, 1);
  assert.equal(terminalEvents(events).length, 1);
  assert.equal(requireResponseError(events).failure.kind, 'network');
  assert.equal(events.filter((event) => event.type === 'text.delta').length, 1);
});

test('a started response is not retried into a different response lifecycle', async () => {
  const queued = queuedFetch([
    responseThatDropsAfter(sseData({ id: 'first-response', choices: [] })),
    responseFromSse([{ id: 'second-response', choices: [{ delta: { content: 'wrong' } }] }, '[DONE]']),
  ]);
  const events = await collect(new OpenAICompatibleDriver({
    fetch: queued.fetch,
    retryPolicy: { maxRetries: 2, baseDelayMs: 0, maxDelayMs: 0, jitterRatio: 0 },
    timers: immediateTimers(),
  }).stream(makeRequest()));

  assert.equal(queued.calls.length, 1);
  assert.deepEqual(
    events.filter((event): event is Extract<ProviderStreamEvent, { type: 'response.start' }> => (
      event.type === 'response.start'
    )).map((event) => event.responseId),
    ['first-response'],
  );
  assert.equal(events.some((event) => event.type === 'response.done'), false);
  assert.equal(requireResponseError(events).failure.kind, 'network');
});

test('abort during a streamed response suppresses every late event and emits one sanitized terminal', async () => {
  const controller = new AbortController();
  const queued = queuedFetch([responseFromSse([
    { id: 'response-abort', choices: [{ index: 0, delta: { content: 'before abort' } }] },
    { choices: [{ index: 0, delta: { content: 'late content' } }] },
    { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
    '[DONE]',
  ])]);
  const iterator = new OpenAICompatibleDriver({
    fetch: queued.fetch,
    retryPolicy: { maxRetries: 0 },
  }).stream(makeRequest(controller.signal))[Symbol.asyncIterator]();
  const events: ProviderStreamEvent[] = [];

  for (;;) {
    const next = await iterator.next();
    if (next.done) break;
    events.push(next.value);
    if (next.value.type === 'text.delta') controller.abort();
  }

  assert.deepEqual(events.map((event) => event.type), [
    'response.start',
    'text.start',
    'text.delta',
    'response.error',
  ]);
  assert.equal(terminalEvents(events).length, 1);
  assert.equal(requireResponseError(events).failure.kind, 'aborted');
  assert.equal(events.some((event) => event.type === 'text.end' || event.type === 'response.done'), false);
  assert.equal(JSON.stringify(events).includes('late content'), false);
});

test('invalid UTF-8 becomes one malformed-response terminal', async () => {
  const queued = queuedFetch([responseFromChunks([
    new TextEncoder().encode('data: '),
    new Uint8Array([0xff]),
    new TextEncoder().encode('\n\n'),
  ])]);
  const events = await collect(new OpenAICompatibleDriver({
    fetch: queued.fetch,
    retryPolicy: { maxRetries: 0 },
  }).stream(makeRequest()));

  assert.equal(terminalEvents(events).length, 1);
  assert.equal(requireResponseError(events).failure.kind, 'malformed-response');
});

test('onRetryScheduled exceptions become one sanitized response.error', async () => {
  const secret = 'sk-scheduled-callback-secret';
  const queued = queuedFetch([new Response(null, { status: 429 })]);
  let events: ProviderStreamEvent[] = [];
  await assert.doesNotReject(async () => {
    events = await collect(new OpenAICompatibleDriver({
      fetch: queued.fetch,
      retryPolicy: { maxRetries: 1, baseDelayMs: 0, maxDelayMs: 0, jitterRatio: 0 },
      timers: immediateTimers(),
      onRetryScheduled: () => {
        throw new Error(`scheduled callback leaked ${secret}`);
      },
    }).stream(makeRequest()));
  });

  assert.equal(queued.calls.length, 1);
  assert.equal(terminalEvents(events).length, 1);
  assert.equal(requireResponseError(events).failure.kind, 'unknown');
  assert.equal(JSON.stringify(events).includes(secret), false);
  assert.equal(JSON.stringify(events).includes('sk-test-secret'), false);
});

test('onRetryStarted exceptions become aborted when the signal was aborted', async () => {
  const secret = 'sk-started-callback-secret';
  const controller = new AbortController();
  const queued = queuedFetch([new Response(null, { status: 503 })]);
  let events: ProviderStreamEvent[] = [];
  await assert.doesNotReject(async () => {
    events = await collect(new OpenAICompatibleDriver({
      fetch: queued.fetch,
      retryPolicy: { maxRetries: 1, baseDelayMs: 0, maxDelayMs: 0, jitterRatio: 0 },
      timers: immediateTimers(),
      onRetryStarted: () => {
        controller.abort();
        throw new Error(`started callback leaked ${secret}`);
      },
    }).stream(makeRequest(controller.signal)));
  });

  assert.equal(queued.calls.length, 1);
  assert.equal(terminalEvents(events).length, 1);
  assert.equal(requireResponseError(events).failure.kind, 'aborted');
  assert.equal(JSON.stringify(events).includes(secret), false);
  assert.equal(JSON.stringify(events).includes('sk-test-secret'), false);
});

test('abort before or during retry is terminal and does not leak the API key', async () => {
  const controller = new AbortController();
  const queued = queuedFetch([new Response(null, { status: 429 })]);
  const events = await collect(new OpenAICompatibleDriver({
    fetch: queued.fetch,
    retryPolicy: { maxRetries: 1, baseDelayMs: 10_000, maxDelayMs: 10_000, jitterRatio: 0 },
    onRetryScheduled: () => controller.abort(),
  }).stream(makeRequest(controller.signal)));
  assert.equal(queued.calls.length, 1);
  assert.equal(terminalEvents(events).length, 1);
  assert.equal(requireResponseError(events).failure.kind, 'aborted');
  assert.equal(JSON.stringify(events).includes('sk-test-secret'), false);
});

test('unknown transport errors are mapped without preserving credential-shaped text', async () => {
  const secret = 'sk-live-should-never-appear';
  const queued = queuedFetch([new Error(`fetch failed for Authorization: Bearer ${secret}`)]);
  const events = await collect(new OpenAICompatibleDriver({
    fetch: queued.fetch,
    retryPolicy: { maxRetries: 0 },
  }).stream(makeRequest()));
  assert.equal(terminalEvents(events).length, 1);
  assert.equal(events.at(-1)?.type, 'response.error');
  assert.equal(JSON.stringify(events).includes(secret), false);
  assert.equal(JSON.stringify(events).includes('Authorization'), false);
});

test('chat completions URL construction preserves base paths without duplication', async () => {
  for (const [baseUrl, expected] of [
    ['https://provider.test/v1/', 'https://provider.test/v1/chat/completions'],
    ['https://provider.test/chat/completions', 'https://provider.test/chat/completions'],
    ['https://provider.test/v1/chat/completions/', 'https://provider.test/v1/chat/completions'],
  ] as const) {
    const queued = queuedFetch([responseFromSse(['[DONE]'])]);
    const events = await collect(new OpenAICompatibleDriver({
      fetch: queued.fetch,
      retryPolicy: { maxRetries: 0 },
    }).stream(makeRequest(new AbortController().signal, baseUrl)));

    assert.equal(String(queued.calls[0]?.input), expected);
    assert.equal(terminalEvents(events).length, 1);
    assert.equal(terminalEvents(events)[0]?.type, 'response.done');
  }
});

test('chat completions URL construction rejects unsafe URLs without leaking them', async () => {
  const secret = 'sk-url-secret';
  const invalidBaseUrls = [
    `https://user:${secret}@provider.test/v1`,
    `https://provider.test/v1?api_key=${secret}`,
    `https://provider.test/v1#${secret}`,
    `file:///private/tmp/${secret}`,
    `not a URL ${secret}`,
  ];

  for (const baseUrl of invalidBaseUrls) {
    const queued = queuedFetch([responseFromSse(['[DONE]'])]);
    const events = await collect(new OpenAICompatibleDriver({
      fetch: queued.fetch,
      retryPolicy: { maxRetries: 0 },
    }).stream(makeRequest(new AbortController().signal, baseUrl)));

    assert.equal(queued.calls.length, 0);
    assert.equal(terminalEvents(events).length, 1);
    assert.equal(requireResponseError(events).failure.kind, 'bad-request');
    assert.equal(JSON.stringify(events).includes(secret), false);
    assert.equal(JSON.stringify(events).includes(baseUrl), false);
  }
});
