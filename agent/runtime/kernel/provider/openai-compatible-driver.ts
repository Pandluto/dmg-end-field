/**
 * DEF-owned OpenAI-compatible Chat Completions transport.
 * Behaviorally derived from pi-mono
 * packages/ai/src/api/openai-completions.ts at
 * e47b8e37a6211ebd0b2942fa87059d64f81eec02.
 */
import type { RuntimeMessage } from '../messages.ts';
import type {
  ModelDriver,
  ModelStream,
  RuntimeModelRequest,
} from './model-driver.ts';
import type { ProviderFailure, ProviderStreamEvent } from '../stream-events.ts';
import {
  ProviderFailureError,
  ProviderHttpError,
  ProviderMalformedResponseError,
  abortedProviderFailure,
  badRequestProviderFailure,
  isAbortError,
  providerFailureFromUnknown,
} from './provider-errors.ts';
import {
  DEFAULT_RETRY_POLICY,
  RetryAbortedError,
  calculateRetryDelayMs,
  isRetryableProviderFailure,
  normalizeRetryPolicy,
  waitForRetry,
  type RetryPolicyInput,
  type RetryTimers,
} from './retry-policy.ts';
import { parseSseStream, SseParseError } from './sse-parser.ts';

type ToolCallId = Extract<
  ProviderStreamEvent,
  { readonly type: 'tool-call.start' }
>['toolCallId'];
type ToolArguments = Extract<
  ProviderStreamEvent,
  { readonly type: 'tool-call.end' }
>['arguments'];
type RuntimeUsage = Extract<
  ProviderStreamEvent,
  { readonly type: 'response.done' }
>['usage'];
type ProviderEventInput = {
  [Type in ProviderStreamEvent['type']]: Omit<
    Extract<ProviderStreamEvent, { readonly type: Type }>,
    'ordinal'
  >;
}[ProviderStreamEvent['type']];

type FetchImplementation = typeof fetch;

export interface OpenAICompatibleDriverOptions {
  readonly fetch?: FetchImplementation;
  readonly fetchImpl?: FetchImplementation;
  readonly retryPolicy?: RetryPolicyInput;
  readonly retry?: RetryPolicyInput;
  readonly timers?: RetryTimers;
  readonly random?: () => number;
  readonly maxSseBufferChars?: number;
  readonly onRetryScheduled?: (
    attempt: number,
    delayMs: number,
    failure: ProviderFailure,
  ) => void | Promise<void>;
  readonly onRetryStarted?: (attempt: number) => void | Promise<void>;
}

type DriverConstructorOptions = OpenAICompatibleDriverOptions | FetchImplementation;

export class OpenAICompatibleDriver implements ModelDriver {
  readonly kind = 'openai-compatible';

  private readonly fetchImpl: FetchImplementation;
  private readonly retryPolicy: ReturnType<typeof normalizeRetryPolicy>;
  private readonly timers: RetryTimers;
  private readonly random: () => number;
  private readonly maxSseBufferChars: number | undefined;
  private readonly onRetryScheduled: OpenAICompatibleDriverOptions['onRetryScheduled'];
  private readonly onRetryStarted: OpenAICompatibleDriverOptions['onRetryStarted'];

  constructor(options: DriverConstructorOptions = {}) {
    if (typeof options === 'function') {
      this.fetchImpl = options;
      this.retryPolicy = normalizeRetryPolicy(DEFAULT_RETRY_POLICY);
      this.timers = {};
      this.random = Math.random;
      this.maxSseBufferChars = undefined;
      this.onRetryScheduled = undefined;
      this.onRetryStarted = undefined;
      return;
    }

    this.fetchImpl = options.fetchImpl ?? options.fetch ?? defaultFetch();
    this.retryPolicy = normalizeRetryPolicy(options.retryPolicy ?? options.retry);
    this.timers = options.timers ?? {};
    this.random = options.random ?? Math.random;
    this.maxSseBufferChars = options.maxSseBufferChars;
    this.onRetryScheduled = options.onRetryScheduled;
    this.onRetryStarted = options.onRetryStarted;
  }

  stream(input: RuntimeModelRequest): ModelStream {
    return { [Symbol.asyncIterator]: () => this.events(input) };
  }

  private async *events(input: RuntimeModelRequest): AsyncGenerator<ProviderStreamEvent> {
    let ordinal = 0;
    let retryCount = 0;
    let responseStarted = false;
    let contentEventEmitted = false;

    for (;;) {
      if (input.signal.aborted) {
        yield makeFailureEvent(++ordinal, abortedProviderFailure());
        return;
      }

      try {
        for await (const event of this.runAttempt(input)) {
          if (event.type === 'response.start') {
            if (responseStarted) continue;
            responseStarted = true;
          } else {
            contentEventEmitted = true;
          }

          const orderedEvent = withOrdinal(event, ++ordinal);
          yield orderedEvent;
          if (event.type === 'response.done' || event.type === 'response.error') return;
        }

        // runAttempt only ends after a successful response.done. Reaching this
        // line means the attempt ended without a terminal provider event.
        throw new ProviderMalformedResponseError();
      } catch (error) {
        const normalizedError = normalizeAttemptError(error, input.signal);
        const failure = normalizedError.failure;
        const canRetry = (
          retryCount < this.retryPolicy.maxRetries &&
          !contentEventEmitted &&
          isRetryableProviderFailure(failure)
        );

        if (canRetry) {
          retryCount += 1;
          const delayMs = calculateRetryDelayMs(
            this.retryPolicy,
            retryCount,
            normalizedError.retryAfterMs,
            this.random,
          );
          try {
            await this.onRetryScheduled?.(retryCount, delayMs, failure);
          } catch (callbackError) {
            yield makeFailureEvent(
              ++ordinal,
              retryCallbackFailure(callbackError, input.signal),
            );
            return;
          }
          try {
            await waitForRetry(delayMs, input.signal, this.timers);
          } catch (retryError) {
            if (retryError instanceof RetryAbortedError || input.signal.aborted) {
              yield makeFailureEvent(++ordinal, abortedProviderFailure());
              return;
            }
            const retryFailure = providerFailureFromUnknown(retryError);
            yield makeFailureEvent(++ordinal, retryFailure);
            return;
          }
          try {
            await this.onRetryStarted?.(retryCount);
          } catch (callbackError) {
            yield makeFailureEvent(
              ++ordinal,
              retryCallbackFailure(callbackError, input.signal),
            );
            return;
          }
          continue;
        }

        yield makeFailureEvent(++ordinal, failure);
        return;
      }
    }
  }

  private async *runAttempt(input: RuntimeModelRequest): AsyncGenerator<ProviderStreamEvent> {
    if (!input.connection.apiKey) {
      throw new ProviderFailureError(badRequestProviderFailure());
    }

    const requestBody = buildRequestBody(input);
    const headers = new Headers(input.connection.headers ?? {});
    headers.set('Accept', 'text/event-stream');
    headers.set('Content-Type', 'application/json');
    headers.set('Authorization', `Bearer ${input.connection.apiKey}`);

    let response: Response;
    try {
      response = await this.fetchImpl(resolveChatCompletionsUrl(input.connection.baseUrl), {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody),
        signal: input.signal,
      });
    } catch (error) {
      throw normalizeAttemptError(error, input.signal);
    }

    const statusCode = response.status;
    const responseOk = typeof response.ok === 'boolean'
      ? response.ok
      : statusCode >= 200 && statusCode < 300;
    if (!responseOk || statusCode < 200 || statusCode >= 300) {
      throw new ProviderHttpError(statusCode, response.headers);
    }
    if (!response.body) throw new ProviderMalformedResponseError();

    const state = new CompletionState();
    let sawDoneMarker = false;

    try {
      for await (const sse of parseSseStream(
        response.body,
        input.signal,
        this.maxSseBufferChars === undefined
          ? undefined
          : { maxBufferChars: this.maxSseBufferChars },
      )) {
        if (sse.data.trim() === '[DONE]') {
          sawDoneMarker = true;
          break;
        }

        let payload: unknown;
        try {
          payload = JSON.parse(sse.data) as unknown;
        } catch {
          throw new ProviderMalformedResponseError();
        }

        for (const event of state.consume(payload)) yield event;
      }
    } catch (error) {
      if (error instanceof ProviderFailureError) throw error;
      if (error instanceof SseParseError) throw new ProviderMalformedResponseError();
      throw normalizeAttemptError(error, input.signal);
    }

    if (!sawDoneMarker && !state.hasFinishReason) {
      throw new ProviderMalformedResponseError();
    }

    for (const event of state.finish()) yield event;
  }
}

export { OpenAICompatibleDriver as OpenAICompatibleModelDriver };
export default OpenAICompatibleDriver;

function buildRequestBody(input: RuntimeModelRequest): Record<string, unknown> {
  const messages: ProviderMessage[] = [];
  if (input.systemPrompt) messages.push({ role: 'system', content: input.systemPrompt });
  for (const message of input.messages) messages.push(...toProviderMessages(message));

  const tools = input.tools.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
    },
  }));

  return {
    model: input.connection.modelId,
    messages,
    stream: true,
    stream_options: { include_usage: true },
    ...(input.connection.outputLimit === undefined
      ? {}
      : { max_tokens: input.connection.outputLimit }),
    ...(tools.length === 0 ? {} : { tools }),
  };
}

function toProviderMessages(message: RuntimeMessage): ProviderMessage[] {
  switch (message.role) {
    case 'user': {
      const text = message.content.map((block) => {
        if (block.type === 'text') return block.text;
        throw new ProviderFailureError(badRequestProviderFailure());
      }).join('');
      return [{ role: 'user', content: text }];
    }
    case 'assistant': {
      const textParts: string[] = [];
      const thinkingParts: string[] = [];
      const toolCalls: ProviderToolCall[] = [];
      for (const block of message.content) {
        if (block.type === 'text') textParts.push(block.text);
        else if (block.type === 'thinking' && !block.redacted) thinkingParts.push(block.text);
        else if (block.type === 'tool-call') {
          toolCalls.push({
            id: String(block.toolCallId),
            type: 'function',
            function: { name: block.name, arguments: JSON.stringify(block.arguments) },
          });
        }
      }

      return [{
        role: 'assistant',
        content: textParts.length > 0 ? textParts.join('') : null,
        ...(thinkingParts.length > 0 ? { reasoning_content: thinkingParts.join('') } : {}),
        ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
      }];
    }
    case 'tool-result': {
      const result = message.result.status === 'succeeded'
        ? message.result.output
        : {
            error: {
              code: message.result.code,
              message: message.result.message,
              ...(message.result.details === undefined ? {} : { details: message.result.details }),
            },
          };
      return [{
        role: 'tool',
        tool_call_id: String(message.toolCallId),
        name: message.toolName,
        content: JSON.stringify(result) ?? 'null',
      }];
    }
    case 'compaction':
      return [{ role: 'system', content: message.summary }];
    default:
      return assertNever(message);
  }
}

function resolveChatCompletionsUrl(baseUrl: string): string {
  let resolved: URL;
  try {
    const normalized = baseUrl.trim();
    if (!normalized) throw new TypeError('empty base URL');
    resolved = new URL(normalized);
  } catch {
    throw new ProviderFailureError(badRequestProviderFailure());
  }

  if (
    (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') ||
    resolved.username !== '' ||
    resolved.password !== '' ||
    resolved.search !== '' ||
    resolved.hash !== '' ||
    resolved.href.includes('?') ||
    resolved.href.includes('#')
  ) {
    throw new ProviderFailureError(badRequestProviderFailure());
  }

  const normalizedPath = resolved.pathname.replace(/\/+$/u, '');
  resolved.pathname = normalizedPath.endsWith('/chat/completions')
    ? normalizedPath
    : `${normalizedPath}/chat/completions`;
  return resolved.toString();
}

function normalizeAttemptError(error: unknown, signal: AbortSignal): ProviderFailureError {
  if (error instanceof ProviderFailureError) return error;
  if (signal.aborted || isAbortError(error)) return new ProviderFailureError(abortedProviderFailure());
  if (error instanceof SseParseError) return new ProviderMalformedResponseError();
  return new ProviderFailureError(providerFailureFromUnknown(error));
}

function retryCallbackFailure(error: unknown, signal: AbortSignal): ProviderFailure {
  if (signal.aborted || isAbortError(error)) return abortedProviderFailure();
  // Retry hooks are control-plane callbacks. Their arbitrary exception text is
  // never a provider diagnostic because it may contain request credentials.
  return providerFailureFromUnknown(undefined);
}

function makeFailureEvent(ordinal: number, failure: ProviderFailure): ProviderStreamEvent {
  return { ordinal, type: 'response.error', failure };
}

function withOrdinal(event: ProviderStreamEvent, ordinal: number): ProviderStreamEvent {
  return { ...event, ordinal };
}

function defaultFetch(): FetchImplementation {
  if (typeof globalThis.fetch === 'function') return globalThis.fetch.bind(globalThis);
  return async () => {
    throw new Error('Fetch is unavailable.');
  };
}

interface ProviderMessage {
  readonly role: 'system' | 'user' | 'assistant' | 'tool';
  readonly content: unknown;
  readonly [key: string]: unknown;
}

interface ProviderToolCall {
  readonly id: string;
  readonly type: 'function';
  readonly function: { readonly name: string; readonly arguments: string };
}

type TextBlock = {
  readonly kind: 'text' | 'thinking';
  readonly contentIndex: number;
  text: string;
  ended: boolean;
};

type ToolBlock = {
  readonly kind: 'tool';
  readonly contentIndex: number;
  readonly key: string;
  toolCallId: ToolCallId;
  name: string;
  arguments: string;
  ended: boolean;
};

type ContentBlockState = TextBlock | ToolBlock;

class CompletionState {
  private ordinal = 0;
  private responseStarted = false;
  private responseId: string | undefined;
  private responseModel: string | undefined;
  private contentIndex = 0;
  private activeText: TextBlock | undefined;
  private readonly blocks: ContentBlockState[] = [];
  private readonly toolsByKey = new Map<string, ToolBlock>();
  private finishReason: string | undefined;
  private usage: RuntimeUsage = {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
  };

  get hasFinishReason(): boolean {
    return this.finishReason !== undefined;
  }

  consume(payload: unknown): ProviderStreamEvent[] {
    if (!isRecord(payload)) throw new ProviderMalformedResponseError();

    const events: ProviderStreamEvent[] = [];
    const id = readString(payload.id);
    const model = readString(payload.model);
    if (id && this.responseId === undefined) this.responseId = id;
    if (model && this.responseModel === undefined) this.responseModel = model;
    if (!this.responseStarted) {
      this.responseStarted = true;
      events.push(this.emit({
        type: 'response.start',
        ...(this.responseId === undefined ? {} : { responseId: this.responseId }),
        ...(this.responseModel === undefined ? {} : { responseModel: this.responseModel }),
      }));
    }

    const usage = readUsage(payload.usage);
    if (usage) this.usage = usage;

    const choices = Array.isArray(payload.choices) ? payload.choices : [];
    const choice = choices.length > 0 && isRecord(choices[0]) ? choices[0] : undefined;
    if (!choice) return events;

    const finishReason = readString(choice.finish_reason) ?? readString(choice.finishReason);
    if (finishReason) this.finishReason = finishReason;

    const delta = isRecord(choice.delta)
      ? choice.delta
      : isRecord(choice.message)
        ? choice.message
        : {};
    const choiceIndex = readNonNegativeInteger(choice.index) ?? 0;

    const reasoning = readDeltaText(
      delta.reasoning_content ?? delta.reasoning ?? delta.thinking,
    );
    if (reasoning) events.push(...this.appendText('thinking', reasoning));

    const text = readDeltaText(delta.content);
    if (text) events.push(...this.appendText('text', text));

    const toolDeltas = readToolDeltas(delta);
    for (const [position, toolDelta] of toolDeltas.entries()) {
      events.push(...this.appendTool(choiceIndex, position, toolDelta));
    }

    return events;
  }

  finish(): ProviderStreamEvent[] {
    const events: ProviderStreamEvent[] = [];
    const parsedArguments = new Map<string, ToolArguments>();
    for (const block of this.blocks) {
      if (block.kind !== 'tool' || block.ended) continue;
      const parsed = parseToolArguments(block.arguments);
      if (!parsed || !block.name.trim()) throw new ProviderMalformedResponseError();
      parsedArguments.set(block.key, parsed);
    }

    if (!this.responseStarted) {
      this.responseStarted = true;
      events.push(this.emit({ type: 'response.start' }));
    }

    for (const block of this.blocks) {
      if ((block.kind === 'text' || block.kind === 'thinking') && !block.ended) {
        block.ended = true;
        events.push(this.emit({
          type: block.kind === 'text' ? 'text.end' : 'thinking.end',
          contentIndex: block.contentIndex,
          text: block.text,
          ...(block.kind === 'thinking' ? { redacted: false } : {}),
        } as ProviderEventInput));
      } else if (block.kind === 'tool' && !block.ended) {
        block.ended = true;
        events.push(this.emit({
          type: 'tool-call.end',
          contentIndex: block.contentIndex,
          toolCallId: block.toolCallId,
          name: block.name,
          arguments: parsedArguments.get(block.key) as ToolArguments,
        }));
      }
    }

    const stopReason = mapStopReason(this.finishReason, this.toolsByKey.size > 0);
    events.push(this.emit({
      type: 'response.done',
      ...(this.responseId === undefined ? {} : { responseId: this.responseId }),
      ...(this.responseModel === undefined ? {} : { responseModel: this.responseModel }),
      stopReason,
      usage: this.usage,
    }));
    return events;
  }

  private appendText(kind: 'text' | 'thinking', delta: string): ProviderStreamEvent[] {
    const events: ProviderStreamEvent[] = [];
    events.push(...this.closeOpenTools());
    if (this.activeText?.kind !== kind) {
      events.push(...this.closeActiveText());
      const block: TextBlock = {
        kind,
        contentIndex: this.contentIndex++,
        text: '',
        ended: false,
      };
      this.activeText = block;
      this.blocks.push(block);
      events.push(this.emit({
        type: kind === 'text' ? 'text.start' : 'thinking.start',
        contentIndex: block.contentIndex,
      }));
    }

    const block = this.activeText;
    if (!block) throw new ProviderMalformedResponseError();
    block.text += delta;
    events.push(this.emit({
      type: kind === 'text' ? 'text.delta' : 'thinking.delta',
      contentIndex: block.contentIndex,
      delta,
    }));
    return events;
  }

  private appendTool(
    choiceIndex: number,
    position: number,
    raw: Record<string, unknown>,
  ): ProviderStreamEvent[] {
    const events: ProviderStreamEvent[] = [];
    events.push(...this.closeActiveText());

    const toolIndex = readNonNegativeInteger(raw.index) ?? position;
    const key = `${choiceIndex}:${toolIndex}`;
    const functionPart = isRecord(raw.function) ? raw.function : raw;
    const nameDelta = readString(functionPart.name) ?? '';
    const argumentsDelta = readJsonDelta(functionPart.arguments);
    let emittedNameDelta = nameDelta;
    let block = this.toolsByKey.get(key);
    if (!block) {
      const providerId = readString(raw.id);
      block = {
        kind: 'tool',
        contentIndex: this.contentIndex++,
        key,
        toolCallId: asToolCallId(providerId ?? `tool-call-${choiceIndex}-${toolIndex}`),
        name: nameDelta,
        arguments: '',
        ended: false,
      };
      this.toolsByKey.set(key, block);
      this.blocks.push(block);
      events.push(this.emit({
        type: 'tool-call.start',
        contentIndex: block.contentIndex,
        toolCallId: block.toolCallId,
        name: nameDelta,
      }));
      emittedNameDelta = '';
    } else {
      block.name += nameDelta;
    }

    block.arguments += argumentsDelta;
    if (emittedNameDelta || argumentsDelta) {
      events.push(this.emit({
        type: 'tool-call.delta',
        contentIndex: block.contentIndex,
        toolCallId: block.toolCallId,
        nameDelta: emittedNameDelta,
        argumentsDelta,
      }));
    }
    return events;
  }

  private closeActiveText(): ProviderStreamEvent[] {
    const block = this.activeText;
    if (!block) return [];
    block.ended = true;
    this.activeText = undefined;
    return [this.emit({
      type: block.kind === 'text' ? 'text.end' : 'thinking.end',
      contentIndex: block.contentIndex,
      text: block.text,
      ...(block.kind === 'thinking' ? { redacted: false } : {}),
    } as ProviderEventInput)];
  }

  private closeOpenTools(): ProviderStreamEvent[] {
    const openTools = this.blocks.filter((block): block is ToolBlock => (
      block.kind === 'tool' && !block.ended
    ));
    if (openTools.length === 0) return [];

    const parsed = openTools.map((block) => ({ block, arguments: parseToolArguments(block.arguments) }));
    if (parsed.some((entry) => entry.arguments === undefined || !entry.block.name.trim())) {
      throw new ProviderMalformedResponseError();
    }

    return parsed.map(({ block, arguments: argumentsValue }) => {
      block.ended = true;
      return this.emit({
        type: 'tool-call.end',
        contentIndex: block.contentIndex,
        toolCallId: block.toolCallId,
        name: block.name,
        arguments: argumentsValue as ToolArguments,
      });
    });
  }

  private emit(event: ProviderEventInput): ProviderStreamEvent {
    return { ordinal: ++this.ordinal, ...event } as ProviderStreamEvent;
  }
}

function readToolDeltas(delta: Record<string, unknown>): Record<string, unknown>[] {
  if (Array.isArray(delta.tool_calls)) {
    return delta.tool_calls.filter(isRecord);
  }
  if (isRecord(delta.tool_calls)) return [delta.tool_calls];
  if (isRecord(delta.function_call)) return [delta.function_call];
  return [];
}

function readDeltaText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return '';
  return value.map((part) => {
    if (!isRecord(part)) return '';
    return typeof part.text === 'string' ? part.text : '';
  }).join('');
}

function readJsonDelta(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === undefined || value === null) return '';
  try {
    return JSON.stringify(value) ?? '';
  } catch {
    throw new ProviderMalformedResponseError();
  }
}

function parseToolArguments(value: string): ToolArguments | undefined {
  if (!value.trim()) return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    return isRecord(parsed) ? parsed as ToolArguments : undefined;
  } catch {
    return undefined;
  }
}

function readUsage(value: unknown): RuntimeUsage | undefined {
  if (!isRecord(value)) return undefined;
  const promptDetails = isRecord(value.prompt_tokens_details) ? value.prompt_tokens_details : {};
  const completionDetails = isRecord(value.completion_tokens_details)
    ? value.completion_tokens_details
    : isRecord(value.output_tokens_details)
      ? value.output_tokens_details
      : {};
  const inputTokens = readToken(value.prompt_tokens ?? value.input_tokens) ?? 0;
  const outputTokens = readToken(value.completion_tokens ?? value.output_tokens) ?? 0;
  const totalTokens = readToken(value.total_tokens) ?? inputTokens + outputTokens;
  const reasoningTokens = readToken(
    value.reasoning_tokens ?? completionDetails.reasoning_tokens,
  );
  const cacheReadTokens = readToken(
    value.cache_read_input_tokens ?? promptDetails.cached_tokens,
  );
  const cacheWriteTokens = readToken(value.cache_creation_input_tokens);

  return {
    inputTokens,
    outputTokens,
    totalTokens,
    ...(reasoningTokens === undefined ? {} : { reasoningTokens }),
    ...(cacheReadTokens === undefined ? {} : { cacheReadTokens }),
    ...(cacheWriteTokens === undefined ? {} : { cacheWriteTokens }),
  };
}

function readToken(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return undefined;
  return Math.floor(value);
}

function mapStopReason(
  finishReason: string | undefined,
  hasToolCalls: boolean,
): Extract<ProviderStreamEvent, { readonly type: 'response.done' }>['stopReason'] {
  switch (finishReason) {
    case 'length':
      return 'length';
    case 'tool_calls':
    case 'function_call':
      return 'tool-use';
    case 'stop':
    case 'content_filter':
      return 'stop';
    default:
      return hasToolCalls ? 'tool-use' : 'stop';
  }
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function readNonNegativeInteger(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) return undefined;
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asToolCallId(value: string): ToolCallId {
  return value as ToolCallId;
}

function assertNever(value: never): never {
  void value;
  throw new ProviderFailureError(badRequestProviderFailure());
}
