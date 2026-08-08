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
const MAX_PROVIDER_METADATA_CODE_UNITS = 4_096;
const MAX_TOOL_NAME_CODE_UNITS = 256;
const MAX_TOOL_ARGUMENT_CODE_UNITS = 256 * 1_024;
const MAX_TOOL_DESCRIPTION_CODE_UNITS = 16 * 1_024;
const MAX_TOOL_COUNT = 256;
const MAX_JSON_DEPTH = 16;
const MAX_JSON_NODES = 16_384;
const MAX_JSON_CONTAINER_ITEMS = 4_096;
const MAX_JSON_STRING_CODE_UNITS = 64 * 1_024;
const MAX_JSON_TOTAL_CODE_UNITS = 256 * 1_024;

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
  readonly malformedCode?: 'RUNTIME_TOOL_MALFORMED' | 'RUNTIME_TOOL_TRUNCATED';
}

interface MutableToolCall {
  block: RuntimeToolCallBlock;
  rawArguments: string;
  started: boolean;
  ended: boolean;
  malformedReason?: string;
  malformedCode?: 'RUNTIME_TOOL_MALFORMED' | 'RUNTIME_TOOL_TRUNCATED';
  nameOverflow: boolean;
  argumentsOverflow: boolean;
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
  contentCodeUnits: number;
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
  let projection: RuntimeToolProjection = { revision: 0, tools: [] };
  let terminal: RuntimeRunTerminal = { status: 'failed', code: 'RUNTIME_FAILED', message: 'Run failed.' };
  let started = false;
  let currentTurn: RuntimeTurnId | null = null;
  let turnIndex = 0;
  let assistantIndex = 0;

  try {
    // Clone before the first await so a Host-side mutation cannot race initial
    // projection acceptance.
    projection = cloneProjection(input.tools);
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
      try {
        await closeOpenTurnAfterFailure(
          controller,
          input,
          currentTurn,
          context,
          terminal,
          assistantIndex,
        );
      } catch (_repairError) {
        // Strict controller recovery below still guarantees the sole run.end.
      }
    }
    if (!started && controller.status === 'created') {
      try {
        await controller.start();
        started = true;
      } catch (startError) {
        terminal = terminalFromError(startError, signal);
      }
    }
  } finally {
    signal.cleanup();
  }

  if (controller.status === 'running') {
    try {
      await controller.finish(terminal);
    } catch (error) {
      terminal = terminalFromError(error, signal);
      const failureTerminal = terminal.status === 'completed'
        ? { status: 'failed' as const, code: 'RUNTIME_TERMINAL_REPAIR_FAILED', message: 'Runtime terminal repair failed.' }
        : terminal;
      if (controller.status === 'running') {
        try {
          await controller.finishAfterFailure(failureTerminal);
        } catch (_repairError) {
          // finish() reserves before dispatch; if that happened, its terminal
          // remains the unique selection even if publication itself failed.
        }
      }
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
        if (event.type === 'response.done') validateSuccessfulProviderTerminal(accumulator, event.stopReason);
        providerTerminal = event;
        if (event.type === 'response.error') {
          accumulator.diagnostic = diagnosticFromFailure(event.failure, input.connection.apiKey);
          accumulator.stopReason = event.failure.kind === 'aborted' ? 'aborted' : 'error';
          accumulator.usage = ZERO_USAGE;
        } else {
          accumulator.providerId = input.connection.providerId;
          accumulator.modelId = event.responseModel?.trim() || accumulator.modelId;
          accumulator.usage = cloneUsage(event.usage);
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
    contentCodeUnits: 0,
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
  if (event.type !== 'response.start' && !accumulator.responseStarted) {
    throw new AgentLoopFailure(
      'RUNTIME_PROVIDER_RESPONSE_START_MISSING',
      'The model emitted response content before response.start.',
    );
  }
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
      if (state.block.toolCallId !== event.toolCallId) {
        throw new AgentLoopFailure('RUNTIME_PROVIDER_TOOL_ID_CONFLICT', 'The model changed a Tool call id.');
      }
      const acceptedNameDelta = appendToolNameDelta(state, event.nameDelta);
      const acceptedArgumentsDelta = appendToolArgumentsDelta(state, event.argumentsDelta);
      accumulator.content[event.contentIndex] = state.block;
      if (acceptedNameDelta || acceptedArgumentsDelta) {
        await emitProviderToolDelta(
          controller,
          input,
          accumulator.assistantId,
          state.block.id,
          event.toolCallId,
          acceptedNameDelta,
          acceptedArgumentsDelta,
        );
      }
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
  if (
    delta.length > MAX_PROVIDER_STRING_CODE_UNITS - state.text.length
    || delta.length > MAX_PROVIDER_STRING_CODE_UNITS - accumulator.contentCodeUnits
  ) {
    throw new AgentLoopFailure('RUNTIME_PROVIDER_CONTENT_TOO_LARGE', 'The model content exceeded the bounded stream size.');
  }
  state.text += delta;
  accumulator.contentCodeUnits += delta.length;
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
  if (accumulator.toolCalls.length >= MAX_TOOL_COUNT) {
    throw new AgentLoopFailure('RUNTIME_PROVIDER_TOOL_LIMIT', 'The model emitted too many Tool calls.');
  }
  const acceptedName = boundedToolName(name);
  const block: RuntimeToolCallBlock = {
    type: 'tool-call',
    id: asRuntimeContentId(contentIdFor(accumulator.assistantId, contentIndex)),
    toolCallId,
    name: acceptedName.value,
    arguments: {},
  };
  const state: MutableToolCall = {
    block,
    rawArguments: '',
    started: true,
    ended: false,
    nameOverflow: acceptedName.overflow,
    argumentsOverflow: false,
    ...(acceptedName.overflow || acceptedName.invalid
      ? {
          malformedReason: acceptedName.overflow
            ? 'Tool name exceeded the bounded stream size.'
            : 'Tool name contained invalid control characters.',
          malformedCode: 'RUNTIME_TOOL_MALFORMED' as const,
        }
      : {}),
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

function appendToolNameDelta(state: MutableToolCall, delta: string): string {
  if (state.nameOverflow) return '';
  const sanitized = delta.replace(/[\u0000-\u001f\u007f]/gu, '');
  if (sanitized !== delta) {
    markToolMalformed(state, 'RUNTIME_TOOL_MALFORMED', 'Tool name contained invalid control characters.');
  }
  const remaining = Math.max(0, MAX_TOOL_NAME_CODE_UNITS - state.block.name.length);
  const accepted = sanitized.slice(0, remaining);
  if (sanitized.length > remaining) {
    state.nameOverflow = true;
    markToolMalformed(state, 'RUNTIME_TOOL_MALFORMED', 'Tool name exceeded the bounded stream size.');
  }
  if (accepted) state.block = { ...state.block, name: state.block.name + accepted };
  return accepted;
}

function appendToolArgumentsDelta(state: MutableToolCall, delta: string): string {
  if (state.argumentsOverflow) return '';
  const remaining = Math.max(0, MAX_TOOL_ARGUMENT_CODE_UNITS - state.rawArguments.length);
  const accepted = delta.slice(0, remaining);
  if (accepted) state.rawArguments += accepted;
  if (delta.length > remaining) {
    state.argumentsOverflow = true;
    markToolMalformed(state, 'RUNTIME_TOOL_MALFORMED', 'Tool arguments exceeded the bounded stream size.');
  }
  return accepted;
}

function markToolMalformed(
  state: MutableToolCall,
  code: 'RUNTIME_TOOL_MALFORMED' | 'RUNTIME_TOOL_TRUNCATED',
  reason: string,
): void {
  if (state.malformedReason === undefined) state.malformedReason = reason;
  if (state.malformedCode === undefined) state.malformedCode = code;
}

function boundedToolName(value: string): {
  readonly value: string;
  readonly overflow: boolean;
  readonly invalid: boolean;
} {
  const bounded = value.slice(0, MAX_TOOL_NAME_CODE_UNITS);
  const safe = bounded.replace(/[\u0000-\u001f\u007f]/gu, '');
  return {
    value: safe,
    overflow: value.length > MAX_TOOL_NAME_CODE_UNITS,
    invalid: safe !== bounded,
  };
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
    if (accumulator.toolCalls.length >= MAX_TOOL_COUNT) {
      throw new AgentLoopFailure('RUNTIME_PROVIDER_TOOL_LIMIT', 'The model emitted too many Tool calls.');
    }
    const acceptedName = boundedToolName(name);
    const acceptedArguments = cloneBoundedJsonObject(rawArgumentsValue);
    const block: RuntimeToolCallBlock = {
      type: 'tool-call',
      id: asRuntimeContentId(contentIdFor(accumulator.assistantId, contentIndex)),
      toolCallId,
      name: acceptedName.value,
      arguments: acceptedArguments ?? {},
    };
    state = {
      block,
      rawArguments: '',
      started: false,
      ended: true,
      malformedReason: 'Tool call ended without tool-call.start.',
      malformedCode: 'RUNTIME_TOOL_MALFORMED',
      nameOverflow: acceptedName.overflow,
      argumentsOverflow: acceptedArguments === undefined,
    };
    accumulator.states.set(contentIndex, state);
    accumulator.toolCalls.push(state);
    accumulator.toolCallIds.add(toolCallId);
    accumulator.content[contentIndex] = block;
    return;
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
  const acceptedName = boundedToolName(name);
  if (acceptedName.overflow || acceptedName.invalid) {
    markToolMalformed(
      state,
      'RUNTIME_TOOL_MALFORMED',
      acceptedName.overflow
        ? 'Tool name exceeded the bounded stream size.'
        : 'Tool name contained invalid control characters.',
    );
  }
  const streamedName = state.block.name;
  const finalName = acceptedName.value || streamedName;
  if (acceptedName.value && streamedName && acceptedName.value !== streamedName) {
    markToolMalformed(state, 'RUNTIME_TOOL_MALFORMED', 'Tool name did not match its streamed name.');
  }
  if (!finalName.trim()) {
    markToolMalformed(state, 'RUNTIME_TOOL_MALFORMED', 'Tool name was empty after tool-call.end.');
  }
  const acceptedArguments = cloneBoundedJsonObject(rawArgumentsValue);
  if (acceptedArguments === undefined) {
    markToolMalformed(state, 'RUNTIME_TOOL_MALFORMED', 'Tool arguments were not bounded JSON.');
    state.block = { ...state.block, name: finalName };
    accumulator.content[contentIndex] = state.block;
  } else {
    state.block = { ...state.block, name: finalName, arguments: acceptedArguments };
    accumulator.content[contentIndex] = state.block;
  }
  if (state.argumentsOverflow) {
    markToolMalformed(state, 'RUNTIME_TOOL_MALFORMED', 'Tool arguments exceeded the bounded stream size.');
  } else if (state.rawArguments) {
    try {
      const parsed: unknown = JSON.parse(state.rawArguments);
      const acceptedParsed = cloneBoundedJsonObject(parsed);
      if (acceptedParsed === undefined || acceptedArguments === undefined || !jsonValuesEqual(acceptedParsed, acceptedArguments)) {
        markToolMalformed(state, 'RUNTIME_TOOL_MALFORMED', 'Tool arguments did not match their streamed JSON.');
      }
    } catch (_error) {
      markToolMalformed(state, 'RUNTIME_TOOL_MALFORMED', 'Tool arguments were malformed JSON.');
    }
  }
  state.ended = true;
}

function finalizeToolCalls(
  accumulator: AssistantAccumulator,
  stopReason: Exclude<RuntimeAssistantStopReason, 'error' | 'aborted'>,
): readonly AssembledToolCall[] {
  return accumulator.toolCalls.map((state) => {
    if (!state.ended) {
      markToolMalformed(state, 'RUNTIME_TOOL_TRUNCATED', 'Tool call was truncated before tool-call.end.');
    }
    if (!state.block.name.trim()) {
      markToolMalformed(state, 'RUNTIME_TOOL_MALFORMED', 'Tool name was empty after tool-call.end.');
    }
    if (stopReason === 'length') {
      state.malformedReason = 'Tool call was truncated by the model output limit.';
      state.malformedCode = 'RUNTIME_TOOL_TRUNCATED';
    }
    return {
      block: state.block,
      rawArguments: state.rawArguments,
      started: state.started,
      ended: state.ended,
      ...(state.malformedReason === undefined ? {} : { malformedReason: state.malformedReason }),
      ...(state.malformedCode === undefined ? {} : { malformedCode: state.malformedCode }),
    };
  });
}

function validateSuccessfulProviderTerminal(
  accumulator: AssistantAccumulator,
  stopReason: Exclude<RuntimeAssistantStopReason, 'error' | 'aborted'>,
): void {
  if (!accumulator.responseStarted) {
    throw new AgentLoopFailure(
      'RUNTIME_PROVIDER_RESPONSE_START_MISSING',
      'The model emitted response.done without response.start.',
    );
  }
  for (const state of accumulator.states.values()) {
    if ('type' in state && !state.ended) {
      throw new AgentLoopFailure(
        'RUNTIME_PROVIDER_CONTENT_UNFINISHED',
        'The model emitted response.done before ending every text or thinking block.',
      );
    }
  }
  const toolCount = accumulator.toolCalls.length;
  if (stopReason === 'tool-use' && toolCount === 0) {
    throw new AgentLoopFailure(
      'RUNTIME_PROVIDER_STOP_REASON_CONFLICT',
      'The model reported tool-use without a Tool call.',
    );
  }
  if (toolCount > 0 && stopReason !== 'tool-use' && stopReason !== 'length') {
    throw new AgentLoopFailure(
      'RUNTIME_PROVIDER_STOP_REASON_CONFLICT',
      'The model emitted Tool calls with an incompatible stop reason.',
    );
  }
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
  const argumentFailure = descriptor
    ? validateToolArguments(call.block.arguments, descriptor.inputSchema)
    : undefined;
  const invalidReason = call.malformedReason
    ?? (descriptor ? argumentFailure : 'Tool is not in the active projection.');
  const invalidCode = call.malformedCode
    ?? (descriptor ? 'RUNTIME_TOOL_ARGUMENTS_INVALID' : 'RUNTIME_TOOL_NOT_PROJECTED');
  if (invalidReason) {
    // Pi e47b8e37a6211ebd0b2942fa87059d64f81eec02 emits a deterministic
    // tool_execution_start -> tool_execution_end -> ToolResult lifecycle even
    // when preparation fails or a response was truncated. DEF keeps that UI
    // ordering while deliberately skipping the Host bridge.
    await emit(controller, {
      type: 'tool.start',
      runId: input.runId,
      defTurnId: input.defTurnId,
      turnId,
      call: call.block,
    });
    const message = createSyntheticToolFailureMessage(input, turnId, call.block, invalidCode, invalidReason);
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
    return { projection, message };
  }

  await emit(controller, {
    type: 'tool.start',
    runId: input.runId,
    defTurnId: input.defTurnId,
    turnId,
    call: call.block,
  });

  const updatePromises: Promise<void>[] = [];
  let acceptingUpdates = true;
  let updateFailure: AgentLoopFailure | undefined;
  const onUpdate = (update: RuntimeToolUpdate): void | Promise<void> => {
    if (!acceptingUpdates || signal.aborted) return;
    if (!isRecord(update) || update.toolCallId !== call.block.toolCallId) {
      updateFailure ??= new AgentLoopFailure(
        'RUNTIME_TOOL_UPDATE_INVALID',
        'The Tool bridge emitted an update for a different Tool call.',
      );
      return;
    }
    const detail = cloneBoundedJsonValue(update.detail);
    if (detail === undefined) {
      updateFailure ??= new AgentLoopFailure(
        'RUNTIME_TOOL_UPDATE_INVALID',
        'The Tool bridge emitted an update outside the bounded JSON contract.',
      );
      return;
    }
    const promise = emit(controller, {
      type: 'tool.update',
      runId: input.runId,
      defTurnId: input.defTurnId,
      turnId,
      toolCallId: update.toolCallId,
      detail,
    }).then(
      () => undefined,
      () => {
        updateFailure ??= new AgentLoopFailure(
          'RUNTIME_TOOL_UPDATE_INVALID',
          'The Tool bridge update could not be accepted by the Runtime.',
        );
      },
    );
    updatePromises.push(promise);
    return promise;
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
    const returnedSettlement = await awaitWithAbort(pending, signal);
    acceptingUpdates = false;
    await Promise.all(updatePromises);
    if (updateFailure) throw updateFailure;
    if (signal.aborted) throw createAbortError(signal);
    settlement = cloneSettlement(returnedSettlement, call.block.toolCallId, projection.revision);
  } catch (error) {
    acceptingUpdates = false;
    await Promise.all(updatePromises);
    const acceptedError = updateFailure ?? error;
    const terminal = isAbortError(acceptedError) || signal.aborted
      ? abortTerminal(signal)
      : {
          status: 'failed' as const,
          code: acceptedError instanceof AgentLoopFailure ? acceptedError.code : 'RUNTIME_TOOL_BRIDGE_FAILED',
          message: acceptedError instanceof AgentLoopFailure
            ? acceptedError.messageForTerminal
            : 'The Tool bridge failed before returning an atomic settlement.',
        };
    const reason = terminal.status === 'aborted'
      ? 'Run aborted while waiting for the Tool.'
      : terminal.status === 'failed'
        ? terminal.message
        : 'The Tool bridge failed before returning an atomic settlement.';
    const message = createSyntheticToolFailureMessage(
      input,
      turnId,
      call.block,
      terminal.status === 'aborted'
        ? 'RUNTIME_TOOL_ABORTED'
        : terminal.status === 'failed'
          ? terminal.code
          : 'RUNTIME_TOOL_FAILED',
      reason,
    );
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
  return { projection: settlement.nextProjection, message };
}

function createSyntheticToolFailureMessage(
  input: AgentLoopInput,
  turnId: RuntimeTurnId,
  call: RuntimeToolCallBlock,
  code: string,
  reason: string,
): RuntimeToolResultMessage {
  const result: RuntimeToolResultPayload = {
    status: 'failed',
    code: safeCode(code, 'RUNTIME_TOOL_FAILED'),
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
      if (
        !['stop', 'length', 'tool-use'].includes(event.stopReason)
        || !validUsage(event.usage)
        || !optionalBoundedProviderMetadata(event.responseId)
        || !optionalBoundedProviderMetadata(event.responseModel)
      ) {
        throw new AgentLoopFailure('RUNTIME_PROVIDER_TERMINAL_INVALID', 'The model terminal was malformed.');
      }
    } else if (!validProviderFailure(event.failure)) {
      throw new AgentLoopFailure('RUNTIME_PROVIDER_TERMINAL_INVALID', 'The model error terminal was malformed.');
    }
    return event;
  }
  if (event.type === 'response.start') {
    if (!optionalBoundedProviderMetadata(event.responseId) || !optionalBoundedProviderMetadata(event.responseModel)) {
      throw invalidProviderEvent();
    }
    return event;
  }
  if ('contentIndex' in event) validateContentIndex(event.contentIndex);
  switch (event.type) {
    case 'text.delta':
    case 'thinking.delta':
      if (typeof event.delta !== 'string' || event.delta.length > MAX_PROVIDER_STRING_CODE_UNITS) throw invalidProviderEvent();
      break;
    case 'text.end':
    case 'thinking.end':
      if (typeof event.text !== 'string' || event.text.length > MAX_PROVIDER_STRING_CODE_UNITS) throw invalidProviderEvent();
      if (event.type === 'thinking.end' && event.redacted !== undefined && typeof event.redacted !== 'boolean') {
        throw invalidProviderEvent();
      }
      break;
    case 'tool-call.start':
      if (typeof event.name !== 'string' || !boundedNonEmptyString(event.toolCallId, 256)) throw invalidProviderEvent();
      break;
    case 'tool-call.delta':
      if (!boundedNonEmptyString(event.toolCallId, 256) || typeof event.nameDelta !== 'string' || typeof event.argumentsDelta !== 'string') {
        throw invalidProviderEvent();
      }
      break;
    case 'tool-call.end':
      if (!boundedNonEmptyString(event.toolCallId, 256) || typeof event.name !== 'string') throw invalidProviderEvent();
      break;
    case 'text.start':
    case 'thinking.start':
      break;
    default:
      throw invalidProviderEvent();
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

function cloneUsage(value: RuntimeUsage): RuntimeUsage {
  return {
    inputTokens: value.inputTokens,
    outputTokens: value.outputTokens,
    totalTokens: value.totalTokens,
    ...(value.reasoningTokens === undefined ? {} : { reasoningTokens: value.reasoningTokens }),
    ...(value.cacheReadTokens === undefined ? {} : { cacheReadTokens: value.cacheReadTokens }),
    ...(value.cacheWriteTokens === undefined ? {} : { cacheWriteTokens: value.cacheWriteTokens }),
  };
}

function validProviderFailure(value: ProviderFailure): boolean {
  return isRecord(value)
    && ['authentication', 'bad-request', 'rate-limit', 'server', 'network', 'context-overflow', 'malformed-response', 'aborted', 'unknown'].includes(value.kind)
    && typeof value.code === 'string'
    && value.code.length <= 128
    && typeof value.message === 'string'
    && value.message.length <= MAX_PROVIDER_METADATA_CODE_UNITS
    && typeof value.retryable === 'boolean'
    && (value.statusCode === undefined || isNonNegativeInteger(value.statusCode));
}

function optionalBoundedProviderMetadata(value: unknown): boolean {
  return value === undefined
    || (typeof value === 'string' && value.length <= MAX_PROVIDER_METADATA_CODE_UNITS && !/[\u0000-\u001f\u007f]/u.test(value));
}

function validateContentIndex(value: unknown): asserts value is number {
  if (!isNonNegativeInteger(value) || value > MAX_PROVIDER_CONTENT_INDEX) {
    throw new AgentLoopFailure('RUNTIME_PROVIDER_CONTENT_INDEX_INVALID', 'The model content index was invalid.');
  }
}

function cloneSettlement(
  settlement: RuntimeToolSettlement,
  toolCallId: ToolCallId,
  currentProjectionRevision: number,
): RuntimeToolSettlement {
  if (!isRecord(settlement) || settlement.toolCallId !== toolCallId) {
    throw new AgentLoopFailure('RUNTIME_TOOL_SETTLEMENT_INVALID', 'The Tool bridge did not return an atomic settlement.');
  }
  const result = cloneToolResultPayload(settlement.result);
  const nextProjection = cloneProjection(settlement.nextProjection);
  if (nextProjection.revision < currentProjectionRevision) {
    throw new AgentLoopFailure(
      'RUNTIME_TOOL_PROJECTION_REVISION_REGRESSION',
      'The Tool bridge returned a projection revision older than the accepted projection.',
    );
  }
  return { toolCallId, result, nextProjection };
}

function validateProjection(projection: RuntimeToolProjection): void {
  void cloneProjection(projection);
}

function cloneToolResultPayload(value: unknown): RuntimeToolResultPayload {
  if (!isRecord(value)) throw invalidToolSettlement();
  if (value.status === 'succeeded') {
    const output = cloneBoundedJsonValue(value.output);
    if (output === undefined) throw invalidToolSettlement();
    return { status: 'succeeded', output };
  }
  if (
    value.status !== 'failed'
    || typeof value.code !== 'string'
    || !/^[A-Za-z0-9._-]{1,128}$/u.test(value.code)
    || typeof value.message !== 'string'
    || value.message.length > MAX_PROVIDER_METADATA_CODE_UNITS
  ) {
    throw invalidToolSettlement();
  }
  const details = value.details === undefined ? undefined : cloneBoundedJsonValue(value.details);
  if (value.details !== undefined && details === undefined) throw invalidToolSettlement();
  return {
    status: 'failed',
    code: value.code,
    message: value.message,
    ...(details === undefined ? {} : { details }),
  };
}

function invalidToolSettlement(): AgentLoopFailure {
  return new AgentLoopFailure('RUNTIME_TOOL_SETTLEMENT_INVALID', 'The Tool bridge result was malformed.');
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
  if (
    !isRecord(projection)
    || !isNonNegativeInteger(projection.revision)
    || !Array.isArray(projection.tools)
    || projection.tools.length > MAX_TOOL_COUNT
  ) {
    throw new AgentLoopFailure('RUNTIME_TOOL_PROJECTION_INVALID', 'The Tool projection was malformed.');
  }
  const names = new Set<string>();
  return {
    revision: projection.revision,
    tools: projection.tools.map((tool) => {
      if (
        !isRecord(tool)
        || typeof tool.name !== 'string'
        || !tool.name
        || tool.name !== tool.name.trim()
        || tool.name.length > MAX_TOOL_NAME_CODE_UNITS
        || /[\u0000-\u001f\u007f]/u.test(tool.name)
        || names.has(tool.name)
        || typeof tool.description !== 'string'
        || tool.description.length > MAX_TOOL_DESCRIPTION_CODE_UNITS
        || tool.description.includes('\u0000')
        || (tool.risk !== 'read' && tool.risk !== 'propose' && tool.risk !== 'mutate')
      ) {
        throw new AgentLoopFailure('RUNTIME_TOOL_PROJECTION_INVALID', 'The Tool projection was malformed.');
      }
      const inputSchema = cloneBoundedJsonObject(tool.inputSchema);
      if (inputSchema === undefined) {
        throw new AgentLoopFailure('RUNTIME_TOOL_PROJECTION_INVALID', 'The Tool projection was malformed.');
      }
      names.add(tool.name);
      return {
        name: tool.name,
        description: tool.description,
        inputSchema,
        risk: tool.risk,
      } satisfies RuntimeToolDescriptor;
    }),
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
  return isRecord(value) && cloneBoundedJsonObject(value) !== undefined;
}

interface JsonCloneBudget {
  nodes: number;
  codeUnits: number;
}

function cloneBoundedJsonValue(value: unknown): JsonValue | undefined {
  try {
    return cloneBoundedJsonNode(value, 0, { nodes: 0, codeUnits: 0 }, new WeakSet<object>());
  } catch (_error) {
    return undefined;
  }
}

function cloneBoundedJsonObject(value: unknown): JsonObject | undefined {
  const cloned = cloneBoundedJsonValue(value);
  return isRecord(cloned) ? cloned as JsonObject : undefined;
}

function cloneBoundedJsonNode(
  value: unknown,
  depth: number,
  budget: JsonCloneBudget,
  seen: WeakSet<object>,
): JsonValue | undefined {
  budget.nodes += 1;
  if (budget.nodes > MAX_JSON_NODES || depth > MAX_JSON_DEPTH) return undefined;
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string') {
    budget.codeUnits += value.length;
    return value.length <= MAX_JSON_STRING_CODE_UNITS && budget.codeUnits <= MAX_JSON_TOTAL_CODE_UNITS
      ? value
      : undefined;
  }
  if (typeof value !== 'object' || seen.has(value)) return undefined;
  seen.add(value);
  if (Array.isArray(value)) {
    if (value.length > MAX_JSON_CONTAINER_ITEMS) return undefined;
    const output: JsonValue[] = [];
    for (const item of value) {
      const cloned = cloneBoundedJsonNode(item, depth + 1, budget, seen);
      if (cloned === undefined) return undefined;
      output.push(cloned);
    }
    seen.delete(value);
    return output;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return undefined;
  const entries = Object.entries(value);
  if (entries.length > MAX_JSON_CONTAINER_ITEMS) return undefined;
  const output: Record<string, JsonValue> = {};
  for (const [key, item] of entries) {
    budget.codeUnits += key.length;
    if (key.length > MAX_JSON_STRING_CODE_UNITS || budget.codeUnits > MAX_JSON_TOTAL_CODE_UNITS) return undefined;
    const cloned = cloneBoundedJsonNode(item, depth + 1, budget, seen);
    if (cloned === undefined) return undefined;
    Object.defineProperty(output, key, {
      value: cloned,
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  seen.delete(value);
  return output;
}

function isJsonValue(value: unknown): value is JsonValue {
  return cloneBoundedJsonValue(value) !== undefined;
}

function jsonValuesEqual(left: unknown, right: unknown): boolean {
  if (!isJsonValue(left) || !isJsonValue(right)) return false;
  return acceptedJsonValuesEqual(left, right);
}

function acceptedJsonValuesEqual(left: JsonValue, right: JsonValue): boolean {
  if (left === right) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left)
      && Array.isArray(right)
      && left.length === right.length
      && left.every((value, index) => acceptedJsonValuesEqual(value, right[index]!));
  }
  if (isJsonObject(left) && isJsonObject(right)) {
    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();
    return leftKeys.length === rightKeys.length
      && leftKeys.every((key, index) => key === rightKeys[index] && acceptedJsonValuesEqual(left[key]!, right[key]!));
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

function boundedNonEmptyString(value: unknown, maxCodeUnits: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maxCodeUnits;
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
