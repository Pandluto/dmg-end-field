/**
 * Pure DEF Agent loop.
 *
 * This module is intentionally limited to the F0 Runtime ports. It assembles
 * Provider events into immutable Runtime messages, executes projected Tools in
 * source order, and starts the next model round only after a ToolBridge
 * settlement has returned both the result and next projection.
 */
import type { DefTurnId, ToolCallId } from '../../core/contracts/ids.ts';
import type { JsonObject, JsonValue } from '../../core/contracts/json.ts';
import {
  asRuntimeContentId,
  asRuntimeMessageId,
  asRuntimeTurnId,
  type RuntimeContentId,
  type RuntimeMessageId,
  type RuntimeRunId,
  type RuntimeSessionId,
  type RuntimeTurnId,
} from './ids.ts';
import type {
  RuntimeAssistantContent,
  RuntimeAssistantMessage,
  RuntimeAssistantMessageDraft,
  RuntimeAssistantStopReason,
  RuntimeMessage,
  RuntimeTextBlock,
  RuntimeToolCallBlock,
  RuntimeToolResultMessage,
  RuntimeToolResultPayload,
  RuntimeUsage,
  RuntimeUserMessage,
} from './messages.ts';
import type {
  ModelDriver,
  RuntimeModelConnection,
} from './provider/model-driver.ts';
import type {
  ProviderFailure,
  ProviderStreamEvent,
  RuntimeEvent,
  RuntimeMessageDelta,
  RuntimeRunTerminal,
} from './stream-events.ts';
import type {
  RuntimeToolBridge,
  RuntimeToolDescriptor,
  RuntimeToolInvocation,
  RuntimeToolProjection,
  RuntimeToolSettlement,
  RuntimeToolUpdate,
} from './tool.ts';
import {
  RuntimeRunController,
  RuntimeRunProtocolError,
  type RuntimeEventDraft,
  type RuntimeRunControllerOptions,
  type RuntimeRunMarkerListener,
} from './run-controller.ts';
import type { RuntimeEventListener } from './stream-events.ts';
import type { RuntimeRunMarkerEntry } from './session/entries.ts';

const ZERO_USAGE: RuntimeUsage = Object.freeze({
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
});

const DEFAULT_MAX_TURNS = 64;
const MAX_PROVIDER_STRING_CODE_UNITS = 1 * 1_024 * 1_024;
const MAX_PROVIDER_CONTENT_INDEX = 65_536;

export interface AgentLoopInput {
  readonly sessionId: RuntimeSessionId;
  readonly runId: RuntimeRunId;
  readonly defTurnId: DefTurnId;
  readonly systemPrompt: string;
  /** Existing Runtime context. A current user message may be supplied separately. */
  readonly messages: readonly RuntimeMessage[];
  readonly userMessage?: RuntimeUserMessage;
  readonly connection: RuntimeModelConnection;
  readonly tools: RuntimeToolProjection;
  readonly modelDriver: ModelDriver;
  readonly toolBridge: RuntimeToolBridge;
  readonly signal?: AbortSignal;
  readonly initialTurnId?: RuntimeTurnId;
  readonly maxTurns?: number;
  readonly now?: () => string;
  readonly listeners?: readonly RuntimeEventListener[];
  readonly markerListeners?: readonly RuntimeRunMarkerListener[];
  /** A fresh controller may be injected when the caller needs to abort it. */
  readonly controller?: RuntimeRunController;
}

export interface AgentLoopResult {
  readonly terminal: RuntimeRunTerminal;
  readonly messages: readonly RuntimeMessage[];
  readonly events: readonly RuntimeEvent[];
  readonly runMarkers: readonly RuntimeRunMarkerEntry[];
  readonly turns: readonly RuntimeTurnId[];
  readonly finalProjection: RuntimeToolProjection;
  readonly controller: RuntimeRunController;
}

export class AgentLoopProtocolError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'AgentLoopProtocolError';
    this.code = code;
  }
}

class AgentLoopAbortError extends Error {
  readonly code: string;
  readonly messageForTerminal: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'AgentLoopAbortError';
    this.code = code;
    this.messageForTerminal = message;
  }
}

class AgentLoopFailure extends Error {
  readonly code: string;
  readonly messageForTerminal: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'AgentLoopFailure';
    this.code = code;
    this.messageForTerminal = message;
  }
}

interface StreamAssistantResult {
  readonly message: RuntimeAssistantMessage;
  readonly toolCalls: readonly AssembledToolCall[];
  readonly terminal?: RuntimeRunTerminal;
}

interface AssembledToolCall {
  readonly block: RuntimeToolCallBlock;
  readonly rawArguments: string;
  readonly started: boolean;
  readonly ended: boolean;
  readonly malformedReason?: string;
}

interface MutableToolCall {
  block: RuntimeToolCallBlock;
  rawArguments: string;
  started: boolean;
  ended: boolean;
  malformedReason?: string;
}

interface MutableContentState {
  readonly contentIndex: number;
  readonly type: RuntimeAssistantContent['type'];
  readonly blockId: RuntimeContentId;
  text: string;
  emittedLength: number;
  ended: boolean;
  redacted?: boolean;
}

interface AssistantAccumulator {
  readonly assistantId: RuntimeMessageId;
  readonly defTurnId: DefTurnId;
  readonly turnId: RuntimeTurnId;
  readonly createdAt: string;
  readonly content: Array<RuntimeAssistantContent | null>;
  readonly states: Map<number, MutableContentState | MutableToolCall>;
  readonly toolCalls: MutableToolCall[];
  readonly toolCallIds: Set<ToolCallId>;
  providerId: string;
  modelId: string;
  responseId?: string;
  responseStarted: boolean;
  usage: RuntimeUsage;
  stopReason: RuntimeAssistantStopReason;
  diagnostic?: RuntimeAssistantMessage['diagnostic'];
}

/** Run a complete model/Tool loop and return the in-memory transcript. */
export async function runAgentLoop(input: AgentLoopInput): Promise<AgentLoopResult> {
  const controller = input.controller ?? new RuntimeRunController(createControllerOptions(input));
  const signal = combineAbortSignals(input.signal, controller.signal);
  const context = [...input.messages];
  const turns: RuntimeTurnId[] = [];
  let projection = cloneProjection(input.tools);
  let terminal: RuntimeRunTerminal = { status: 'failed', code: 'RUNTIME_FAILED', message: 'Run failed.' };
  let started = false;
  let currentTurn: RuntimeTurnId | null = null;
  let turnIndex = 0;
  let assistantIndex = 0;

  try {
    validateLoopInput(input, context, projection);
    await controller.start();
    started = true;

    if (signal.aborted) throw createAbortError(signal);

    const prompt = input.userMessage;
    if (prompt) {
      if (prompt.defTurnId !== input.defTurnId) {
        throw new AgentLoopFailure(
          'RUNTIME_MESSAGE_DEF_TURN_ID_CONFLICT',
          'The user message does not belong to this DEF turn.',
        );
      }
      if (!context.some((message) => message.id === prompt.id)) context.push(prompt);
    }

    let shouldContinue = true;
    while (shouldContinue) {
      if (signal.aborted) throw createAbortError(signal);
      turnIndex += 1;
      if (turnIndex > (input.maxTurns ?? DEFAULT_MAX_TURNS)) {
        throw new AgentLoopFailure('RUNTIME_MAX_TURNS', 'The Agent loop reached its bounded turn limit.');
      }

      currentTurn = turnIndex === 1 && (input.initialTurnId ?? prompt?.turnId)
        ? (input.initialTurnId ?? prompt?.turnId)!
        : turnIdFor(input.runId, turnIndex);
      turns.push(currentTurn);
      await emit(controller, {
        type: 'turn.start',
        runId: input.runId,
        defTurnId: input.defTurnId,
        turnId: currentTurn,
      });

      if (turnIndex === 1 && prompt) {
        await emit(controller, {
          type: 'message.start',
          runId: input.runId,
          defTurnId: input.defTurnId,
          message: prompt,
        });
        await emit(controller, {
          type: 'message.end',
          runId: input.runId,
          defTurnId: input.defTurnId,
          message: prompt,
        });
      }

      const assistant = await streamAssistantResponse({
        input,
        controller,
        context,
        projection,
        turnId: currentTurn,
        assistantId: messageIdFor(input.runId, 'assistant', assistantIndex),
        signal,
      });
      assistantIndex += 1;
      context.push(assistant.message);

      if (assistant.terminal) {
        await finishTurn(controller, input, currentTurn, assistant.message, []);
        terminal = assistant.terminal;
        break;
      }

      const toolResultMessages: RuntimeToolResultMessage[] = [];
      const toolCalls = assistant.toolCalls;
      for (const toolCall of toolCalls) {
        if (signal.aborted) throw createAbortError(signal);
        const execution = await executeToolCall({
          input,
          controller,
          signal,
          turnId: currentTurn,
          call: toolCall,
          projection,
        });
        projection = execution.projection;
        if (execution.message) {
          context.push(execution.message);
          toolResultMessages.push(execution.message);
        }
        if (execution.terminal) {
          await finishTurn(controller, input, currentTurn, assistant.message, toolResultMessages);
          terminal = execution.terminal;
          shouldContinue = false;
          break;
        }
      }

      if (terminal.status !== 'failed' || terminal.code !== 'RUNTIME_FAILED') {
        shouldContinue = false;
      }

      if (shouldContinue) {
        await finishTurn(controller, input, currentTurn, assistant.message, toolResultMessages);
        const hasToolWork = toolCalls.length > 0;
        if (!hasToolWork) {
          terminal = {
            status: 'completed',
            ...(assistantText(assistant.message) === '' ? {} : { output: assistantText(assistant.message) }),
          };
          shouldContinue = false;
        }
      }
    }
  } catch (error) {
    terminal = terminalFromError(error, signal);
    if (started && currentTurn !== null) {
      await closeOpenTurnAfterFailure(
        controller,
        input,
        currentTurn,
        context,
        terminal,
        assistantIndex,
        signal,
      );
    }
  } finally {
    signal.cleanup();
  }

  if (!started) {
    // start() can only fail before it has published a run. A fresh controller
    // is still returned so callers can inspect the deterministic failure.
    terminal = terminalFromError(
      new AgentLoopFailure('RUNTIME_RUN_START_FAILED', 'Runtime run could not start.'),
      signal,
    );
  }

  if (controller.status === 'running') {
    try {
      await controller.finish(terminal);
    } catch (error) {
      // A controller protocol failure is terminal itself; preserve the first
      // safe terminal rather than trying to emit a second run.end.
      terminal = terminalFromError(error, signal);
    }
  }

  controller.dispose();
  return {
    terminal: controller.terminal ?? terminal,
    messages: context.slice(),
    events: controller.events,
    runMarkers: controller.runMarkers,
    turns: turns.slice(),
    finalProjection: projection,
    controller,
  };
}

/** Alias used by small Runtime facades that prefer a shorter name. */
export const runAgent = runAgentLoop;

function createControllerOptions(input: AgentLoopInput): RuntimeRunControllerOptions {
  return {
    sessionId: input.sessionId,
    runId: input.runId,
    defTurnId: input.defTurnId,
    initialTurnId: input.initialTurnId ?? input.userMessage?.turnId,
    now: input.now,
    signal: input.signal,
    listeners: input.listeners,
    markerListeners: input.markerListeners,
  };
}

function validateLoopInput(
  input: AgentLoopInput,
  messages: readonly RuntimeMessage[],
  projection: RuntimeToolProjection,
): void {
  if (!input.systemPrompt || typeof input.systemPrompt !== 'string') {
    throw new AgentLoopFailure('RUNTIME_SYSTEM_PROMPT_INVALID', 'Runtime system prompt is invalid.');
  }
  if (!input.connection.providerId || !input.connection.modelId) {
    throw new AgentLoopFailure('RUNTIME_MODEL_CONNECTION_INVALID', 'Runtime model connection is invalid.');
  }
  validateProjection(projection);
  for (const message of messages) {
    if (message.role !== 'compaction' && !message.defTurnId) {
      throw new AgentLoopFailure('RUNTIME_MESSAGE_CORRELATION_INVALID', 'Runtime message correlation is invalid.');
    }
  }
}

async function streamAssistantResponse(options: {
  readonly input: AgentLoopInput;
  readonly controller: RuntimeRunController;
  readonly context: readonly RuntimeMessage[];
  readonly projection: RuntimeToolProjection;
  readonly turnId: RuntimeTurnId;
  readonly assistantId: RuntimeMessageId;
  readonly signal: CombinedAbortSignal;
}): Promise<StreamAssistantResult> {
  const { input, controller, context, projection, turnId, assistantId, signal } = options;
  const accumulator = createAccumulator(input, turnId, assistantId);
  const draft = assistantDraft(accumulator);
  await emit(controller, {
    type: 'message.start',
    runId: input.runId,
    defTurnId: input.defTurnId,
    message: draft,
  });

  if (signal.aborted) {
    const message = await finalizeAccumulator(accumulator, controller, input, signal, 'aborted');
    return { message, toolCalls: [], terminal: abortTerminal(signal) };
  }

  let stream: AsyncIterable<ProviderStreamEvent>;
  try {
    // ModelDriver.stream is deliberately synchronous by contract. Keeping the
    // call outside a Promise also makes abort-before-stream observable.
    stream = input.modelDriver.stream({
      runId: input.runId,
      turnId,
      connection: input.connection,
      systemPrompt: input.systemPrompt,
      messages: context,
      tools: projection.tools,
      signal,
    });
  } catch (_error) {
    const failure = new AgentLoopFailure('RUNTIME_MODEL_STREAM_FAILED', 'The model stream could not be started.');
    const message = await finalizeAccumulator(accumulator, controller, input, signal, 'error', failure);
    return {
      message,
      toolCalls: [],
      terminal: { status: 'failed', code: failure.code, message: failure.messageForTerminal },
    };
  }

  let iterator: AsyncIterator<ProviderStreamEvent>;
  try {
    iterator = stream[Symbol.asyncIterator]();
  } catch (_error) {
    const failure = new AgentLoopFailure('RUNTIME_MODEL_STREAM_FAILED', 'The model stream could not be read.');
    const message = await finalizeAccumulator(accumulator, controller, input, signal, 'error', failure);
    return {
      message,
      toolCalls: [],
      terminal: { status: 'failed', code: failure.code, message: failure.messageForTerminal },
    };
  }
  let providerTerminal: ProviderStreamEvent | null = null;
  let protocolFailure: AgentLoopFailure | undefined;
  let expectedOrdinal = 1;

  try {
    while (true) {
      if (signal.aborted) throw createAbortError(signal);
      const next = await nextWithAbort(iterator, signal);
      if (next.done) break;
      const event = validateProviderEvent(next.value);
      if (event.ordinal !== expectedOrdinal) {
        throw new AgentLoopFailure('RUNTIME_PROVIDER_ORDINAL_INVALID', 'The model event ordinal was not contiguous.');
      }
      expectedOrdinal += 1;
      if (providerTerminal !== null) {
        throw new AgentLoopFailure('RUNTIME_PROVIDER_LATE_EVENT', 'The model emitted an event after its terminal.');
      }
      if (event.type === 'response.done' || event.type === 'response.error') {
        providerTerminal = event;
        if (event.type === 'response.error') {
          accumulator.diagnostic = diagnosticFromFailure(event.failure, input.connection.apiKey);
          accumulator.stopReason = event.failure.kind === 'aborted' ? 'aborted' : 'error';
          accumulator.usage = ZERO_USAGE;
        } else {
          accumulator.providerId = input.connection.providerId;
          accumulator.modelId = event.responseModel?.trim() || accumulator.modelId;
          accumulator.usage = event.usage;
          accumulator.stopReason = event.stopReason;
          if (event.responseId !== undefined) accumulator.responseId = event.responseId;
        }
        continue;
      }
      await applyProviderEvent(accumulator, event, controller, input, signal);
    }
    if (providerTerminal === null) {
      throw new AgentLoopFailure('RUNTIME_PROVIDER_NO_TERMINAL', 'The model stream ended without a terminal event.');
    }
  } catch (error) {
    if (isAbortError(error) || signal.aborted) {
      protocolFailure = undefined;
      accumulator.stopReason = 'aborted';
      accumulator.diagnostic = undefined;
    } else {
      protocolFailure = error instanceof AgentLoopFailure
        ? error
        : new AgentLoopFailure('RUNTIME_PROVIDER_EVENT_INVALID', 'The model stream was malformed.');
      accumulator.stopReason = 'error';
      accumulator.diagnostic = {
        code: protocolFailure.code,
        message: protocolFailure.messageForTerminal,
        retryable: false,
      };
    }
    await closeIterator(iterator);
  }

  if (protocolFailure) {
    const message = await finalizeAccumulator(accumulator, controller, input, signal, 'error', protocolFailure);
    return {
      message,
      toolCalls: [],
      terminal: { status: 'failed', code: protocolFailure.code, message: protocolFailure.messageForTerminal },
    };
  }
  if (signal.aborted || accumulator.stopReason === 'aborted') {
    const message = await finalizeAccumulator(accumulator, controller, input, signal, 'aborted');
    return { message, toolCalls: [], terminal: abortTerminal(signal) };
  }

  if (providerTerminal?.type === 'response.error') {
    const failure = providerTerminal.failure;
    const terminal = failure.kind === 'aborted'
      ? abortTerminal(signal, failure.code)
      : {
          status: 'failed' as const,
          code: safeCode(failure.code, 'RUNTIME_PROVIDER_FAILED'),
          message: safeProviderMessage(failure.message, input.connection.apiKey),
        };
    const message = await finalizeAccumulator(accumulator, controller, input, signal, 'error');
    return { message, toolCalls: [], terminal };
  }

  const done = providerTerminal;
  if (!done || done.type !== 'response.done') {
    const failure = new AgentLoopFailure('RUNTIME_PROVIDER_NO_TERMINAL', 'The model stream ended without a terminal event.');
    const message = await finalizeAccumulator(accumulator, controller, input, signal, 'error', failure);
    return {
      message,
      toolCalls: [],
      terminal: { status: 'failed', code: failure.code, message: failure.messageForTerminal },
    };
  }

  const calls = finalizeToolCalls(accumulator, done.stopReason);
  const message = await finalizeAccumulator(accumulator, controller, input, signal, 'normal');
  return { message, toolCalls: calls };
}

function createAccumulator(
  input: AgentLoopInput,
  turnId: RuntimeTurnId,
  assistantId: RuntimeMessageId,
): AssistantAccumulator {
  return {
    assistantId,
    defTurnId: input.defTurnId,
    turnId,
    createdAt: (input.now ?? (() => new Date().toISOString()))(),
    content: [],
    states: new Map(),
    toolCalls: [],
    toolCallIds: new Set(),
    providerId: input.connection.providerId,
    modelId: input.connection.modelId,
    responseStarted: false,
    usage: ZERO_USAGE,
    stopReason: 'stop',
  };
}

function assistantDraft(accumulator: AssistantAccumulator): RuntimeAssistantMessageDraft {
  return {
    schemaVersion: 1,
    id: accumulator.assistantId,
    createdAt: accumulator.createdAt,
    defTurnId: accumulator.defTurnId,
    turnId: accumulator.turnId,
    role: 'assistant',
    content: [],
    providerId: accumulator.providerId,
    modelId: accumulator.modelId,
    ...(accumulator.responseId === undefined ? {} : { responseId: accumulator.responseId }),
  };
}

async function finalizeAccumulator(
  accumulator: AssistantAccumulator,
  controller: RuntimeRunController,
  input: AgentLoopInput,
  signal: CombinedAbortSignal,
  mode: 'normal' | 'error' | 'aborted',
  failure?: AgentLoopFailure,
): Promise<RuntimeAssistantMessage> {
  const content = accumulator.content.filter((block): block is RuntimeAssistantContent => block !== null);
  const stopReason = mode === 'aborted'
    ? 'aborted'
    : mode === 'error'
      ? 'error'
      : accumulator.stopReason;
  const message: RuntimeAssistantMessage = {
    schemaVersion: 1,
    id: accumulator.assistantId,
    createdAt: accumulator.createdAt,
    defTurnId: input.defTurnId,
    turnId: accumulator.turnId,
    role: 'assistant',
    content,
    providerId: accumulator.providerId,
    modelId: accumulator.modelId,
    ...(accumulator.responseId === undefined ? {} : { responseId: accumulator.responseId }),
    usage: accumulator.usage,
    stopReason,
    ...(failure
      ? {
          diagnostic: {
            code: failure.code,
            message: failure.messageForTerminal,
            retryable: false,
          },
        }
      : accumulator.diagnostic === undefined ? {} : { diagnostic: accumulator.diagnostic }),
    completedAt: (input.now ?? (() => new Date().toISOString()))(),
  };

  // `signal` is intentionally read here only to keep the finalization point
  // explicit. A late abort cannot change an already assembled normal message
  // into a second terminal event; the caller owns that decision.
  void signal;
  await emit(controller, {
    type: 'message.end',
    runId: input.runId,
    defTurnId: input.defTurnId,
    message,
  });
  return message;
}

async function applyProviderEvent(
  accumulator: AssistantAccumulator,
  event: Exclude<ProviderStreamEvent, { type: 'response.done' | 'response.error' }>,
  controller: RuntimeRunController,
  input: AgentLoopInput,
  signal: CombinedAbortSignal,
): Promise<void> {
  if (signal.aborted) throw createAbortError(signal);
  switch (event.type) {
    case 'response.start':
      if (accumulator.responseStarted) {
        throw new AgentLoopFailure('RUNTIME_PROVIDER_RESPONSE_START_DUPLICATE', 'The model emitted duplicate response.start events.');
      }
      accumulator.responseStarted = true;
      accumulator.responseId = event.responseId;
      accumulator.modelId = event.responseModel?.trim() || accumulator.modelId;
      return;
    case 'text.start':
      createTextState(accumulator, event.contentIndex, 'text');
      return;
    case 'text.delta': {
      const state = requireContentState(accumulator, event.contentIndex, 'text');
      await appendTextState(state, event.delta, accumulator, input, controller, 'text');
      return;
    }
    case 'text.end': {
      const state = requireContentState(accumulator, event.contentIndex, 'text');
      await finishTextState(state, event.text, accumulator, input, controller, 'text');
      return;
    }
    case 'thinking.start':
      createTextState(accumulator, event.contentIndex, 'thinking');
      return;
    case 'thinking.delta': {
      const state = requireContentState(accumulator, event.contentIndex, 'thinking');
      await appendTextState(state, event.delta, accumulator, input, controller, 'thinking');
      return;
    }
    case 'thinking.end': {
      const state = requireContentState(accumulator, event.contentIndex, 'thinking');
      state.redacted = event.redacted;
      await finishTextState(state, event.text, accumulator, input, controller, 'thinking');
      return;
    }
    case 'tool-call.start':
      startToolCall(accumulator, event.contentIndex, event.toolCallId, event.name);
      return;
    case 'tool-call.delta': {
      const state = requireToolState(accumulator, event.contentIndex);
      if (state.ended) throw new AgentLoopFailure('RUNTIME_PROVIDER_TOOL_LATE_EVENT', 'The model emitted Tool data after tool-call.end.');
      state.block = {
        ...state.block,
        name: state.block.name + event.nameDelta,
      };
      state.rawArguments += event.argumentsDelta;
      if (state.rawArguments.length > MAX_PROVIDER_STRING_CODE_UNITS) {
        state.malformedReason = 'Tool arguments exceeded the bounded stream size.';
      }
      await emitProviderToolDelta(
        controller,
        input,
        accumulator.assistantId,
        state.block.id,
        event.toolCallId,
        event.nameDelta,
        event.argumentsDelta,
      );
      return;
    }
    case 'tool-call.end':
      endToolCall(accumulator, event.contentIndex, event.toolCallId, event.name, event.arguments);
      return;
  }
}

function createTextState(
  accumulator: AssistantAccumulator,
  contentIndex: number,
  type: 'text' | 'thinking',
): MutableContentState {
  validateContentIndex(contentIndex);
  if (accumulator.states.has(contentIndex)) {
    throw new AgentLoopFailure('RUNTIME_PROVIDER_CONTENT_DUPLICATE', 'The model reused a content index.');
  }
  const blockId = asRuntimeContentId(contentIdFor(accumulator.assistantId, contentIndex));
  const state: MutableContentState = {
    contentIndex,
    type,
    blockId,
    text: '',
    emittedLength: 0,
    ended: false,
  };
  accumulator.states.set(contentIndex, state);
  accumulator.content[contentIndex] = type === 'text'
    ? { type: 'text', id: blockId, text: '' }
    : { type: 'thinking', id: blockId, text: '' };
  return state;
}

function requireContentState(
  accumulator: AssistantAccumulator,
  contentIndex: number,
  type: 'text' | 'thinking',
): MutableContentState {
  const state = accumulator.states.get(contentIndex);
  if (!state || !('type' in state) || state.type !== type) {
    throw new AgentLoopFailure('RUNTIME_PROVIDER_CONTENT_ORDER_INVALID', 'The model emitted content data before its start.');
  }
  if (state.ended) throw new AgentLoopFailure('RUNTIME_PROVIDER_CONTENT_LATE_EVENT', 'The model emitted content after its end.');
  return state;
}

async function appendTextState(
  state: MutableContentState,
  delta: string,
  accumulator: AssistantAccumulator,
  input: AgentLoopInput,
  controller: RuntimeRunController,
  type: 'text' | 'thinking',
): Promise<void> {
  state.text += delta;
  if (state.text.length > MAX_PROVIDER_STRING_CODE_UNITS) {
    throw new AgentLoopFailure('RUNTIME_PROVIDER_CONTENT_TOO_LARGE', 'The model content exceeded the bounded stream size.');
  }
  const block = accumulator.content[state.contentIndex];
  if (!block || (block.type !== 'text' && block.type !== 'thinking')) {
    throw new AgentLoopFailure('RUNTIME_PROVIDER_CONTENT_INVALID', 'The model content block was invalid.');
  }
  accumulator.content[state.contentIndex] = { ...block, text: state.text };
  const visibleDelta = state.text.slice(state.emittedLength);
  state.emittedLength = state.text.length;
  if (visibleDelta) await emitProviderDelta(controller, input, accumulator, state.blockId, type, visibleDelta);
}

async function finishTextState(
  state: MutableContentState,
  finalText: string,
  accumulator: AssistantAccumulator,
  input: AgentLoopInput,
  controller: RuntimeRunController,
  type: 'text' | 'thinking',
): Promise<void> {
  if (finalText.length > MAX_PROVIDER_STRING_CODE_UNITS) {
    throw new AgentLoopFailure('RUNTIME_PROVIDER_CONTENT_TOO_LARGE', 'The model content exceeded the bounded stream size.');
  }
  if (!finalText.startsWith(state.text)) {
    throw new AgentLoopFailure('RUNTIME_PROVIDER_CONTENT_MISMATCH', 'The model content end did not match its deltas.');
  }
  if (finalText.length > state.text.length) {
    await appendTextState(state, finalText.slice(state.text.length), accumulator, input, controller, type);
  }
  if (type === 'thinking' && state.redacted !== undefined) {
    const block = accumulator.content[state.contentIndex];
    if (block?.type === 'thinking') {
      accumulator.content[state.contentIndex] = { ...block, redacted: state.redacted };
    }
  }
  state.ended = true;
}

function startToolCall(
  accumulator: AssistantAccumulator,
  contentIndex: number,
  toolCallId: ToolCallId,
  name: string,
): void {
  validateContentIndex(contentIndex);
  if (accumulator.states.has(contentIndex) || accumulator.toolCallIds.has(toolCallId)) {
    throw new AgentLoopFailure('RUNTIME_PROVIDER_TOOL_DUPLICATE', 'The model emitted a duplicate Tool call.');
  }
  const block: RuntimeToolCallBlock = {
    type: 'tool-call',
    id: asRuntimeContentId(contentIdFor(accumulator.assistantId, contentIndex)),
    toolCallId,
    name,
    arguments: {},
  };
  const state: MutableToolCall = {
    block,
    rawArguments: '',
    started: true,
    ended: false,
    ...(name.trim() ? {} : { malformedReason: 'Tool name is empty.' }),
  };
  accumulator.states.set(contentIndex, state);
  accumulator.toolCalls.push(state);
  accumulator.toolCallIds.add(toolCallId);
  accumulator.content[contentIndex] = block;
}

function requireToolState(accumulator: AssistantAccumulator, contentIndex: number): MutableToolCall {
  const state = accumulator.states.get(contentIndex);
  if (!state || !('block' in state)) {
    throw new AgentLoopFailure('RUNTIME_PROVIDER_TOOL_ORDER_INVALID', 'The model emitted Tool data before tool-call.start.');
  }
  return state;
}

function endToolCall(
  accumulator: AssistantAccumulator,
  contentIndex: number,
  toolCallId: ToolCallId,
  name: string,
  rawArgumentsValue: unknown,
): void {
  let state = accumulator.states.get(contentIndex);
  if (!state) {
    validateContentIndex(contentIndex);
    if (accumulator.toolCallIds.has(toolCallId)) {
      throw new AgentLoopFailure('RUNTIME_PROVIDER_TOOL_DUPLICATE', 'The model emitted a duplicate Tool call.');
    }
    const block: RuntimeToolCallBlock = {
      type: 'tool-call',
      id: asRuntimeContentId(contentIdFor(accumulator.assistantId, contentIndex)),
      toolCallId,
      name,
      arguments: isJsonObject(rawArgumentsValue) ? rawArgumentsValue : {},
    };
    state = {
      block,
      rawArguments: '',
      started: false,
      ended: true,
      malformedReason: 'Tool call ended without tool-call.start.',
    };
    accumulator.states.set(contentIndex, state);
    accumulator.toolCalls.push(state);
    accumulator.toolCallIds.add(toolCallId);
    accumulator.content[contentIndex] = block;
  }
  if (!('block' in state)) {
    throw new AgentLoopFailure('RUNTIME_PROVIDER_CONTENT_ORDER_INVALID', 'A Tool call reused a text content index.');
  }
  if (state.ended) {
    throw new AgentLoopFailure('RUNTIME_PROVIDER_TOOL_LATE_EVENT', 'The model emitted duplicate tool-call.end events.');
  }
  if (state.block.toolCallId !== toolCallId) {
    throw new AgentLoopFailure('RUNTIME_PROVIDER_TOOL_ID_CONFLICT', 'The model changed a Tool call id.');
  }
  if (name !== state.block.name) state.malformedReason = 'Tool name did not match its streamed name.';
  if (!isJsonObject(rawArgumentsValue)) {
    state.malformedReason = 'Tool arguments were not a JSON object.';
  } else {
    state.block = { ...state.block, name, arguments: rawArgumentsValue };
    accumulator.content[contentIndex] = state.block;
  }
  if (state.rawArguments) {
    try {
      const parsed: unknown = JSON.parse(state.rawArguments);
      if (!isJsonObject(parsed) || !jsonValuesEqual(parsed, rawArgumentsValue)) {
        state.malformedReason = 'Tool arguments did not match their streamed JSON.';
      }
    } catch (_error) {
      state.malformedReason = 'Tool arguments were malformed JSON.';
    }
  }
  state.ended = true;
}

function finalizeToolCalls(
  accumulator: AssistantAccumulator,
  stopReason: Exclude<RuntimeAssistantStopReason, 'error' | 'aborted'>,
): readonly AssembledToolCall[] {
  return accumulator.toolCalls.map((state) => {
    if (!state.ended) state.malformedReason = state.malformedReason ?? 'Tool call was truncated before tool-call.end.';
    if (stopReason === 'length') state.malformedReason = state.malformedReason ?? 'Tool call was truncated by the model output limit.';
    return {
      block: state.block,
      rawArguments: state.rawArguments,
      started: state.started,
      ended: state.ended,
      ...(state.malformedReason === undefined ? {} : { malformedReason: state.malformedReason }),
    };
  });
}

async function executeToolCall(options: {
  readonly input: AgentLoopInput;
  readonly controller: RuntimeRunController;
  readonly signal: CombinedAbortSignal;
  readonly turnId: RuntimeTurnId;
  readonly call: AssembledToolCall;
  readonly projection: RuntimeToolProjection;
}): Promise<{
  readonly projection: RuntimeToolProjection;
  readonly message?: RuntimeToolResultMessage;
  readonly terminal?: RuntimeRunTerminal;
}> {
  const { input, controller, signal, turnId, call, projection } = options;
  const descriptor = projection.tools.find((tool) => tool.name === call.block.name);
  const invalidReason = call.malformedReason
    ?? (descriptor ? validateToolArguments(call.block.arguments, descriptor.inputSchema) : 'Tool is not in the active projection.');
  if (invalidReason) {
    const message = createSyntheticToolFailureMessage(input, turnId, call.block, invalidReason);
    await emitToolResultMessage(controller, input, message);
    return { projection, message };
  }

  await emit(controller, {
    type: 'tool.start',
    runId: input.runId,
    defTurnId: input.defTurnId,
    turnId,
    call: call.block,
  });

  const updatePromises: Promise<unknown>[] = [];
  let acceptingUpdates = true;
  const onUpdate = (update: RuntimeToolUpdate): void | Promise<void> => {
    if (!acceptingUpdates || signal.aborted || update.toolCallId !== call.block.toolCallId) return;
    const promise = emit(controller, {
      type: 'tool.update',
      runId: input.runId,
      defTurnId: input.defTurnId,
      turnId,
      toolCallId: update.toolCallId,
      detail: update.detail,
    });
    updatePromises.push(promise);
    return promise.then(() => undefined);
  };

  let settlement: RuntimeToolSettlement;
  try {
    const pending = input.toolBridge.invoke(
      {
        sessionId: input.sessionId,
        defTurnId: input.defTurnId,
        runId: input.runId,
        turnId,
        call: call.block,
        projectionRevision: projection.revision,
      } satisfies RuntimeToolInvocation,
      signal,
      onUpdate,
    );
    settlement = await awaitWithAbort(pending, signal);
    acceptingUpdates = false;
    await Promise.allSettled(updatePromises);
    if (signal.aborted) throw createAbortError(signal);
    validateSettlement(settlement, call.block.toolCallId);
  } catch (error) {
    acceptingUpdates = false;
    await Promise.allSettled(updatePromises);
    const terminal = isAbortError(error) || signal.aborted
      ? abortTerminal(signal)
      : {
          status: 'failed' as const,
          code: error instanceof AgentLoopFailure ? error.code : 'RUNTIME_TOOL_BRIDGE_FAILED',
          message: error instanceof AgentLoopFailure
            ? error.messageForTerminal
            : 'The Tool bridge failed before returning an atomic settlement.',
        };
    const reason = terminal.status === 'aborted'
      ? 'Run aborted while waiting for the Tool.'
      : terminal.status === 'failed'
        ? terminal.message
        : 'The Tool bridge failed before returning an atomic settlement.';
    const message = createSyntheticToolFailureMessage(input, turnId, call.block, reason);
    await emit(controller, {
      type: 'tool.end',
      runId: input.runId,
      defTurnId: input.defTurnId,
      turnId,
      toolCallId: call.block.toolCallId,
      result: message.result,
      nextProjectionRevision: projection.revision,
    });
    await emitToolResultMessage(controller, input, message);
    return { projection, message, terminal };
  }

  const result = sanitizeToolResult(settlement.result, input.connection.apiKey);
  await emit(controller, {
    type: 'tool.end',
    runId: input.runId,
    defTurnId: input.defTurnId,
    turnId,
    toolCallId: call.block.toolCallId,
    result,
    nextProjectionRevision: settlement.nextProjection.revision,
  });
  const message = createToolResultMessage(input, turnId, call.block, result);
  await emit(controller, {
    type: 'message.start',
    runId: input.runId,
    defTurnId: input.defTurnId,
    message,
  });
  await emit(controller, {
    type: 'message.end',
    runId: input.runId,
    defTurnId: input.defTurnId,
    message,
  });
  return { projection: cloneProjection(settlement.nextProjection), message };
}

function createSyntheticToolFailureMessage(
  input: AgentLoopInput,
  turnId: RuntimeTurnId,
  call: RuntimeToolCallBlock,
  reason: string,
): RuntimeToolResultMessage {
  const result: RuntimeToolResultPayload = {
    status: 'failed',
    code: reason.includes('active projection')
      ? 'RUNTIME_TOOL_NOT_PROJECTED'
      : reason.includes('truncated') || reason.includes('output limit')
        ? 'RUNTIME_TOOL_TRUNCATED'
        : 'RUNTIME_TOOL_ARGUMENTS_INVALID',
    message: safeProviderMessage(reason, input.connection.apiKey),
  };
  return createToolResultMessage(input, turnId, call, result);
}

async function emitToolResultMessage(
  controller: RuntimeRunController,
  input: AgentLoopInput,
  message: RuntimeToolResultMessage,
): Promise<void> {
  await emit(controller, {
    type: 'message.start',
    runId: input.runId,
    defTurnId: input.defTurnId,
    message,
  });
  await emit(controller, { type: 'message.end', runId: input.runId, defTurnId: input.defTurnId, message });
}

function createToolResultMessage(
  input: AgentLoopInput,
  turnId: RuntimeTurnId,
  call: RuntimeToolCallBlock,
  result: RuntimeToolResultPayload,
): RuntimeToolResultMessage {
  return {
    schemaVersion: 1,
    id: messageIdForKey(input.runId, 'tool-result', `${turnId}:${call.toolCallId}`),
    createdAt: (input.now ?? (() => new Date().toISOString()))(),
    defTurnId: input.defTurnId,
    turnId,
    role: 'tool-result',
    toolCallId: call.toolCallId,
    toolName: call.name,
    result,
    completedAt: (input.now ?? (() => new Date().toISOString()))(),
  };
}

async function finishTurn(
  controller: RuntimeRunController,
  input: AgentLoopInput,
  turnId: RuntimeTurnId,
  assistantMessage: RuntimeAssistantMessage,
  toolResults: readonly RuntimeToolResultMessage[],
): Promise<void> {
  await emit(controller, {
    type: 'turn.end',
    runId: input.runId,
    defTurnId: input.defTurnId,
    turnId,
    assistantMessage,
    toolResultMessageIds: toolResults.map((message) => message.id),
  });
}

async function closeOpenTurnAfterFailure(
  controller: RuntimeRunController,
  input: AgentLoopInput,
  turnId: RuntimeTurnId,
  context: RuntimeMessage[],
  terminal: RuntimeRunTerminal,
  assistantIndex: number,
  signal: CombinedAbortSignal,
): Promise<void> {
  if (controller.status !== 'running') return;
  const existingAssistant = [...context].reverse().find(
    (message): message is RuntimeAssistantMessage => message.role === 'assistant' && message.turnId === turnId,
  );
  let assistant: RuntimeAssistantMessage;
  if (existingAssistant) {
    assistant = existingAssistant;
  } else {
    const id = messageIdFor(input.runId, 'assistant-failure', assistantIndex);
    assistant = {
      schemaVersion: 1,
      id: asRuntimeMessageId(id),
      createdAt: (input.now ?? (() => new Date().toISOString()))(),
      defTurnId: input.defTurnId,
      turnId,
      role: 'assistant',
      content: [],
      providerId: input.connection.providerId,
      modelId: input.connection.modelId,
      usage: ZERO_USAGE,
      stopReason: terminal.status === 'aborted' ? 'aborted' : 'error',
      diagnostic: {
        code: terminal.status === 'completed' ? 'RUNTIME_FAILED' : terminal.code,
        message: terminal.status === 'completed'
          ? 'Run failed.'
          : terminal.status === 'failed'
            ? terminal.message
            : terminal.message ?? 'Run aborted.',
        retryable: false,
      },
      completedAt: (input.now ?? (() => new Date().toISOString()))(),
    };
    context.push(assistant);
    await emit(controller, {
      type: 'message.start',
      runId: input.runId,
      defTurnId: input.defTurnId,
      message: {
        schemaVersion: 1,
        id: assistant.id,
        createdAt: assistant.createdAt,
        defTurnId: input.defTurnId,
        turnId,
        role: 'assistant',
        content: [],
        providerId: input.connection.providerId,
        modelId: input.connection.modelId,
      },
    });
    await emit(controller, {
      type: 'message.end',
      runId: input.runId,
      defTurnId: input.defTurnId,
      message: assistant,
    });
  }
  if (signal.aborted && terminal.status !== 'aborted') return;
  try {
    await finishTurn(controller, input, turnId, assistant, []);
  } catch (_error) {
    // The original terminal is safer than attempting a second lifecycle repair.
  }
}

async function emitProviderDelta(
  controller: RuntimeRunController,
  input: AgentLoopInput,
  accumulator: AssistantAccumulator,
  contentId: RuntimeContentId,
  type: 'text' | 'thinking',
  delta: string,
): Promise<void> {
  const runtimeDelta: RuntimeMessageDelta = {
    type,
    contentId,
    delta,
  };
  await emit(controller, {
    type: 'message.update',
    runId: input.runId,
    defTurnId: input.defTurnId,
    messageId: accumulator.assistantId,
    delta: runtimeDelta,
  });
}

async function emitProviderToolDelta(
  controller: RuntimeRunController,
  input: AgentLoopInput,
  messageId: RuntimeMessageId,
  contentId: RuntimeContentId,
  toolCallId: ToolCallId,
  nameDelta: string,
  argumentsDelta: string,
): Promise<void> {
  await emit(controller, {
    type: 'message.update',
    runId: input.runId,
    defTurnId: input.defTurnId,
    messageId,
    delta: {
      type: 'tool-call',
      contentId,
      toolCallId,
      nameDelta,
      argumentsDelta,
    },
  });
}

function validateProviderEvent(event: ProviderStreamEvent): ProviderStreamEvent {
  if (!isRecord(event) || !isFinitePositiveInteger(event.ordinal) || typeof event.type !== 'string') {
    throw new AgentLoopFailure('RUNTIME_PROVIDER_EVENT_INVALID', 'The model emitted a malformed event.');
  }
  if (event.type === 'response.done' || event.type === 'response.error') {
    if (event.type === 'response.done') {
      if (!['stop', 'length', 'tool-use'].includes(event.stopReason) || !validUsage(event.usage)) {
        throw new AgentLoopFailure('RUNTIME_PROVIDER_TERMINAL_INVALID', 'The model terminal was malformed.');
      }
    } else if (!validProviderFailure(event.failure)) {
      throw new AgentLoopFailure('RUNTIME_PROVIDER_TERMINAL_INVALID', 'The model error terminal was malformed.');
    }
    return event;
  }
  if (event.type === 'response.start') {
    if (event.responseId !== undefined && typeof event.responseId !== 'string') throw invalidProviderEvent();
    if (event.responseModel !== undefined && typeof event.responseModel !== 'string') throw invalidProviderEvent();
    return event;
  }
  if ('contentIndex' in event) validateContentIndex(event.contentIndex);
  switch (event.type) {
    case 'text.delta':
    case 'thinking.delta':
      if (typeof event.delta !== 'string') throw invalidProviderEvent();
      break;
    case 'text.end':
    case 'thinking.end':
      if (typeof event.text !== 'string') throw invalidProviderEvent();
      break;
    case 'tool-call.start':
      if (typeof event.name !== 'string' || !nonEmptyString(event.toolCallId)) throw invalidProviderEvent();
      break;
    case 'tool-call.delta':
      if (!nonEmptyString(event.toolCallId) || typeof event.nameDelta !== 'string' || typeof event.argumentsDelta !== 'string') {
        throw invalidProviderEvent();
      }
      break;
    case 'tool-call.end':
      if (!nonEmptyString(event.toolCallId) || typeof event.name !== 'string') throw invalidProviderEvent();
      break;
    case 'text.start':
    case 'thinking.start':
      break;
  }
  return event;
}

function invalidProviderEvent(): AgentLoopFailure {
  return new AgentLoopFailure('RUNTIME_PROVIDER_EVENT_INVALID', 'The model emitted a malformed event.');
}

function validUsage(value: RuntimeUsage): boolean {
  if (!isRecord(value)) return false;
  return isNonNegativeInteger(value.inputTokens)
    && isNonNegativeInteger(value.outputTokens)
    && isNonNegativeInteger(value.totalTokens)
    && optionalUsageNumber(value.reasoningTokens)
    && optionalUsageNumber(value.cacheReadTokens)
    && optionalUsageNumber(value.cacheWriteTokens);
}

function optionalUsageNumber(value: unknown): boolean {
  return value === undefined || isNonNegativeInteger(value);
}

function validProviderFailure(value: ProviderFailure): boolean {
  return isRecord(value)
    && typeof value.kind === 'string'
    && typeof value.code === 'string'
    && typeof value.message === 'string'
    && typeof value.retryable === 'boolean'
    && (value.statusCode === undefined || isNonNegativeInteger(value.statusCode));
}

function validateContentIndex(value: unknown): asserts value is number {
  if (!isNonNegativeInteger(value) || value > MAX_PROVIDER_CONTENT_INDEX) {
    throw new AgentLoopFailure('RUNTIME_PROVIDER_CONTENT_INDEX_INVALID', 'The model content index was invalid.');
  }
}

function validateSettlement(settlement: RuntimeToolSettlement, toolCallId: ToolCallId): void {
  if (!isRecord(settlement) || settlement.toolCallId !== toolCallId || !isRecord(settlement.nextProjection)) {
    throw new AgentLoopFailure('RUNTIME_TOOL_SETTLEMENT_INVALID', 'The Tool bridge did not return an atomic settlement.');
  }
  if (!isToolResultPayload(settlement.result)) {
    throw new AgentLoopFailure('RUNTIME_TOOL_SETTLEMENT_INVALID', 'The Tool bridge result was malformed.');
  }
  validateProjection(settlement.nextProjection);
}

function validateProjection(projection: RuntimeToolProjection): void {
  if (!isRecord(projection) || !isNonNegativeInteger(projection.revision) || !Array.isArray(projection.tools)) {
    throw new AgentLoopFailure('RUNTIME_TOOL_PROJECTION_INVALID', 'The Tool projection was malformed.');
  }
  const names = new Set<string>();
  for (const tool of projection.tools) {
    if (!isRecord(tool) || typeof tool.name !== 'string' || !tool.name || names.has(tool.name) || !isRecord(tool.inputSchema)) {
      throw new AgentLoopFailure('RUNTIME_TOOL_PROJECTION_INVALID', 'The Tool projection was malformed.');
    }
    names.add(tool.name);
  }
}

function isToolResultPayload(value: unknown): value is RuntimeToolResultPayload {
  if (!isRecord(value) || (value.status !== 'succeeded' && value.status !== 'failed')) return false;
  if (value.status === 'succeeded') return isJsonValue(value.output);
  return typeof value.code === 'string'
    && typeof value.message === 'string'
    && (value.details === undefined || isJsonValue(value.details));
}

function validateToolArguments(value: JsonObject, schema: JsonObject): string | undefined {
  if (!isJsonObject(value)) return 'Tool arguments were not a JSON object.';
  return validateSchemaValue(value, schema, '$');
}

function validateSchemaValue(value: JsonValue, schema: JsonObject, path: string): string | undefined {
  const type = typeof schema.type === 'string' ? schema.type : undefined;
  if (type && !schemaTypeMatches(value, type)) return `Tool arguments did not match the projected schema at ${path}.`;
  if (Array.isArray(schema.enum) && !schema.enum.some((candidate) => jsonValuesEqual(candidate, value))) {
    return `Tool arguments did not match the projected schema at ${path}.`;
  }
  if (type === 'object' && isJsonObject(value)) {
    if (Array.isArray(schema.required)) {
      for (const required of schema.required) {
        if (typeof required === 'string' && !(required in value)) return `Tool arguments are missing a required field at ${path}.`;
      }
    }
    if (isJsonObject(schema.properties)) {
      for (const [key, childSchema] of Object.entries(schema.properties)) {
        if (key in value && isJsonObject(childSchema)) {
          const error = validateSchemaValue(value[key]!, childSchema, `${path}.${key}`);
          if (error) return error;
        }
      }
    }
    if (schema.additionalProperties === false && isJsonObject(schema.properties)) {
      for (const key of Object.keys(value)) if (!(key in schema.properties)) return `Tool arguments contain an unknown field at ${path}.`;
    }
  }
  if (type === 'array' && Array.isArray(value) && isJsonObject(schema.items)) {
    for (const [index, item] of value.entries()) {
      const error = validateSchemaValue(item, schema.items, `${path}[${index}]`);
      if (error) return error;
    }
  }
  return undefined;
}

function schemaTypeMatches(value: JsonValue, type: string): boolean {
  switch (type) {
    case 'object': return isJsonObject(value);
    case 'array': return Array.isArray(value);
    case 'string': return typeof value === 'string';
    case 'number': return typeof value === 'number' && Number.isFinite(value);
    case 'integer': return typeof value === 'number' && Number.isSafeInteger(value);
    case 'boolean': return typeof value === 'boolean';
    case 'null': return value === null;
    default: return true;
  }
}

function cloneProjection(projection: RuntimeToolProjection): RuntimeToolProjection {
  return {
    revision: projection.revision,
    tools: projection.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      risk: tool.risk,
    } satisfies RuntimeToolDescriptor)),
  };
}

function sanitizeToolResult(result: RuntimeToolResultPayload, apiKey: string): RuntimeToolResultPayload {
  if (result.status === 'succeeded') return result;
  return {
    ...result,
    message: safeProviderMessage(result.message, apiKey),
  };
}

function createAbortError(signal: CombinedAbortSignal): AgentLoopAbortError {
  const reason = signal.reason;
  if (isRecord(reason) && typeof reason.code === 'string') {
    return new AgentLoopAbortError(
      safeCode(reason.code, 'RUNTIME_ABORTED'),
      safeProviderMessage(typeof reason.message === 'string' ? reason.message : 'Run aborted.', ''),
    );
  }
  return new AgentLoopAbortError('RUNTIME_ABORTED', 'Run aborted.');
}

function abortTerminal(signal: CombinedAbortSignal, fallbackCode = 'RUNTIME_ABORTED'): RuntimeRunTerminal {
  const error = createAbortError(signal);
  return { status: 'aborted', code: safeCode(error.code, fallbackCode), message: error.messageForTerminal };
}

function terminalFromError(error: unknown, signal: CombinedAbortSignal): RuntimeRunTerminal {
  if (isAbortError(error) || signal.aborted) return abortTerminal(signal);
  if (error instanceof AgentLoopFailure) {
    return { status: 'failed', code: error.code, message: error.messageForTerminal };
  }
  if (error instanceof RuntimeRunProtocolError) {
    return { status: 'failed', code: error.code, message: error.message };
  }
  return { status: 'failed', code: 'RUNTIME_LOOP_FAILED', message: 'The Agent loop failed.' };
}

function isAbortError(error: unknown): error is AgentLoopAbortError {
  return error instanceof AgentLoopAbortError;
}

function assistantText(message: RuntimeAssistantMessage): string {
  return message.content
    .filter((block): block is RuntimeTextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('');
}

function diagnosticFromFailure(failure: ProviderFailure, apiKey: string): RuntimeAssistantMessage['diagnostic'] {
  return {
    code: safeCode(failure.code, 'RUNTIME_PROVIDER_FAILED'),
    message: safeProviderMessage(failure.message, apiKey),
    retryable: failure.retryable,
  };
}

function safeProviderMessage(value: string, apiKey: string): string {
  const withKeyRedacted = apiKey ? value.split(apiKey).join('[redacted]') : value;
  return withKeyRedacted
    .slice(0, 4_096)
    .replace(/authorization\s*:\s*\S+/giu, 'authorization: [redacted]')
    .replace(/bearer\s+[A-Za-z0-9._~+/=-]{8,}/giu, 'bearer [redacted]')
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/giu, '[redacted]')
    .replace(/((?:api[-_ ]?key|access[-_ ]?token|refresh[-_ ]?token|password|secret)\s*[:=])\s*[^\s,;]+/giu, '$1 [redacted]');
}

function safeCode(value: string, fallback: string): string {
  return /^[A-Za-z0-9._-]{1,128}$/u.test(value) ? value : fallback;
}

function messageIdFor(runId: RuntimeRunId, kind: string, index: number): RuntimeMessageId {
  return asRuntimeMessageId(boundedId(`${runId}:${kind}:${index}`));
}

function messageIdForKey(runId: RuntimeRunId, kind: string, key: string): RuntimeMessageId {
  return asRuntimeMessageId(boundedId(`${runId}:${kind}:${key}`));
}

function contentIdFor(messageId: RuntimeMessageId, contentIndex: number): RuntimeContentId {
  return asRuntimeContentId(boundedId(`${messageId}:content:${contentIndex}`));
}

function turnIdFor(runId: RuntimeRunId, turnIndex: number): RuntimeTurnId {
  return asRuntimeTurnId(boundedId(`${runId}:turn:${turnIndex}`));
}

function boundedId(value: string): string {
  if (value.length <= 256) return value;
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  return `${value.slice(0, 224)}:${hash.toString(16)}`;
}

function emit<T extends RuntimeEventDraft>(controller: RuntimeRunController, draft: T): Promise<RuntimeEvent> {
  return controller.emit(draft);
}

function isJsonObject(value: unknown): value is JsonObject {
  if (!isRecord(value)) return false;
  return isJsonValue(value);
}

function isJsonValue(value: unknown, depth = 0, seen = new WeakSet<object>()): value is JsonValue {
  if (depth > 16) return false;
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'object') return false;
  if (seen.has(value)) return false;
  seen.add(value);
  if (Array.isArray(value)) return value.every((item) => isJsonValue(item, depth + 1, seen));
  return Object.values(value).every((item) => isJsonValue(item, depth + 1, seen));
}

function jsonValuesEqual(left: unknown, right: unknown): boolean {
  if (!isJsonValue(left) || !isJsonValue(right)) return false;
  if (left === right) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left)
      && Array.isArray(right)
      && left.length === right.length
      && left.every((value, index) => jsonValuesEqual(value, right[index]));
  }
  if (isJsonObject(left) && isJsonObject(right)) {
    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();
    return leftKeys.length === rightKeys.length
      && leftKeys.every((key, index) => key === rightKeys[index] && jsonValuesEqual(left[key], right[key]));
  }
  return false;
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFinitePositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

interface CombinedAbortSignal extends AbortSignal {
  readonly cleanup: () => void;
}

function combineAbortSignals(
  external: AbortSignal | undefined,
  controller: AbortSignal,
): CombinedAbortSignal {
  const local = new AbortController();
  const forward = (signal: AbortSignal): void => {
    if (!local.signal.aborted) local.abort(signal.reason);
  };
  const listeners: Array<() => void> = [];
  for (const signal of [external, controller]) {
    if (!signal) continue;
    if (signal.aborted) forward(signal);
    else {
      const onAbort = (): void => forward(signal);
      signal.addEventListener('abort', onAbort, { once: true });
      listeners.push(() => signal.removeEventListener('abort', onAbort));
    }
  }
  const combined = local.signal as CombinedAbortSignal;
  Object.defineProperty(combined, 'cleanup', {
    value: () => {
      for (const remove of listeners) remove();
    },
    enumerable: false,
  });
  return combined;
}

async function nextWithAbort<T>(
  iterator: AsyncIterator<T>,
  signal: CombinedAbortSignal,
): Promise<IteratorResult<T>> {
  if (signal.aborted) throw createAbortError(signal);
  let remove = (): void => undefined;
  const abort = new Promise<never>((_, reject) => {
    const onAbort = (): void => reject(createAbortError(signal));
    signal.addEventListener('abort', onAbort, { once: true });
    remove = () => signal.removeEventListener('abort', onAbort);
  });
  try {
    return await Promise.race([iterator.next(), abort]);
  } finally {
    remove();
  }
}

async function awaitWithAbort<T>(promise: Promise<T>, signal: CombinedAbortSignal): Promise<T> {
  if (signal.aborted) throw createAbortError(signal);
  let remove = (): void => undefined;
  const abort = new Promise<never>((_, reject) => {
    const onAbort = (): void => reject(createAbortError(signal));
    signal.addEventListener('abort', onAbort, { once: true });
    remove = () => signal.removeEventListener('abort', onAbort);
  });
  try {
    return await Promise.race([promise, abort]);
  } finally {
    remove();
  }
}

async function closeIterator<T>(iterator: AsyncIterator<T>): Promise<void> {
  try {
    await iterator.return?.();
  } catch (_error) {
    // Provider cleanup cannot replace the already selected safe terminal.
  }
}
