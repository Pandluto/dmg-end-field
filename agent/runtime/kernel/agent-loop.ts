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
  canonicalizeRuntimeMessage,
  RuntimeRunController,
  RuntimeRunProtocolError,
  type RuntimeDurableEventCommit,
  type RuntimeDurableTerminalCommit,
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
const MAX_TURNS = 256;
const MAX_INPUT_MESSAGES = 1_024;
const MAX_INPUT_CODE_UNITS = 4 * 1_024 * 1_024;
const MAX_SYSTEM_PROMPT_CODE_UNITS = 1 * 1_024 * 1_024;
const MAX_CONNECTION_HEADERS = 128;
const MAX_CONNECTION_STRING_CODE_UNITS = 64 * 1_024;
const MAX_PROVIDER_EVENTS = 32_768;
const MAX_PROVIDER_STRING_CODE_UNITS = 1 * 1_024 * 1_024;
const MAX_PROVIDER_CONTENT_INDEX = 65_536;
const MAX_PROVIDER_METADATA_CODE_UNITS = 4_096;
const MAX_TOOL_NAME_CODE_UNITS = 256;
const MAX_TOOL_ARGUMENT_CODE_UNITS = 256 * 1_024;
const MAX_TOOL_DESCRIPTION_CODE_UNITS = 16 * 1_024;
const MAX_TOOL_COUNT = 256;
const MAX_TOOL_UPDATES = 1_024;
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
  /** Best-effort observers; persistence uses the sole durable commit sink. */
  readonly listeners?: readonly RuntimeEventListener[];
  readonly markerListeners?: readonly RuntimeRunMarkerListener[];
  /** Atomic run.start pair + non-terminal Runtime event persistence. */
  readonly durableEventCommit?: RuntimeDurableEventCommit;
  /** Atomic durable commit for the end marker + run.end pair. */
  readonly terminalCommit?: RuntimeDurableTerminalCommit;
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
  readonly contentIndex: number;
  readonly block: RuntimeToolCallBlock;
  readonly rawArguments: string;
  readonly started: boolean;
  readonly ended: boolean;
  readonly malformedReason?: string;
  readonly malformedCode?: string;
}

interface MutableToolCall {
  readonly contentIndex: number;
  block: RuntimeToolCallBlock;
  rawArguments: string;
  started: boolean;
  ended: boolean;
  malformedReason?: string;
  malformedCode?: string;
  nameOverflow: boolean;
  argumentsOverflow: boolean;
}

interface MutableContentState {
  readonly contentIndex: number;
  readonly type: RuntimeAssistantContent['type'];
  readonly blockId: RuntimeContentId;
  text: string;
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
  responseIdRaw?: string;
  responseModelRaw?: string;
  responseStarted: boolean;
  contentCodeUnits: number;
  usage: RuntimeUsage;
  stopReason: RuntimeAssistantStopReason;
  diagnostic?: RuntimeAssistantMessage['diagnostic'];
}

interface AcceptedAgentLoopInput extends AgentLoopInput {
  readonly systemPrompt: string;
  readonly messages: readonly RuntimeMessage[];
  readonly userMessage?: RuntimeUserMessage;
  readonly connection: RuntimeModelConnection;
  readonly tools: RuntimeToolProjection;
  readonly maxTurns: number;
  readonly redactions: readonly string[];
}

/** Run a complete model/Tool loop and return the in-memory transcript. */
export async function runAgentLoop(input: AgentLoopInput): Promise<AgentLoopResult> {
  // Read the caller-owned envelope once through data descriptors. Accessors are
  // rejected before any getter can run or any async boundary can be crossed.
  input = snapshotAgentLoopEnvelope(input);
  // Everything that can cross an async boundary is accepted synchronously.
  // A validation failure is retained so it can still receive one failed
  // Runtime lifecycle after the controller starts.
  let accepted: AcceptedAgentLoopInput | undefined;
  let inputFailure: unknown;
  try {
    accepted = snapshotLoopInput(input);
  } catch (error) {
    inputFailure = error;
  }
  const redactions = accepted?.redactions ?? collectPotentialRedactions(input.connection);
  const controller = input.controller ?? new RuntimeRunController(createControllerOptions(accepted ?? input, redactions));
  const signal = combineAbortSignals(input.signal, controller.signal, redactions);
  const context: RuntimeMessage[] = accepted ? [...accepted.messages] : [];
  const turns: RuntimeTurnId[] = [];
  let projection: RuntimeToolProjection = Object.freeze({ revision: 0, tools: Object.freeze([]) });
  let terminal: RuntimeRunTerminal = { status: 'failed', code: 'RUNTIME_FAILED', message: 'Run failed.' };
  let started = false;
  let failedPath = false;
  let currentTurn: RuntimeTurnId | null = null;
  let turnIndex = 0;
  let assistantIndex = 0;
  let terminalPersistenceError: RuntimeRunProtocolError | undefined;

  try {
    await controller.start();
    started = true;
  } catch (error) {
    signal.cleanup();
    controller.dispose();
    throw error;
  }

  try {
    if (inputFailure !== undefined) throw inputFailure;
    if (!accepted) {
      throw new AgentLoopFailure('RUNTIME_INPUT_INVALID', 'Runtime Agent loop input was invalid.');
    }
    validateControllerCorrelation(controller, accepted);
    projection = accepted.tools;

    if (signal.aborted) throw createAbortError(signal);

    const prompt = accepted.userMessage;
    if (prompt) {
      if (!context.some((message) => message.id === prompt.id)) context.push(prompt);
    }

    let shouldContinue = true;
    while (shouldContinue) {
      if (signal.aborted) throw createAbortError(signal);
      turnIndex += 1;
      if (turnIndex > accepted.maxTurns) {
        throw new AgentLoopFailure('RUNTIME_MAX_TURNS', 'The Agent loop reached its bounded turn limit.');
      }

      currentTurn = turnIndex === 1 && (accepted.initialTurnId ?? prompt?.turnId)
        ? (accepted.initialTurnId ?? prompt?.turnId)!
        : turnIdFor(accepted.runId, turnIndex);
      turns.push(currentTurn);
      await emit(controller, {
        type: 'turn.start',
        runId: accepted.runId,
        defTurnId: accepted.defTurnId,
        turnId: currentTurn,
      });

      if (turnIndex === 1 && prompt) {
        await emit(controller, {
          type: 'message.start',
          runId: accepted.runId,
          defTurnId: accepted.defTurnId,
          message: prompt,
        });
        await emit(controller, {
          type: 'message.end',
          runId: accepted.runId,
          defTurnId: accepted.defTurnId,
          message: prompt,
        });
      }

      const assistant = await streamAssistantResponse({
        input: accepted,
        controller,
        context,
        projection,
        turnId: currentTurn,
        assistantId: messageIdFor(accepted.runId, 'assistant', assistantIndex),
        signal,
      });
      assistantIndex += 1;
      context.push(assistant.message);

      const toolResultMessages: RuntimeToolResultMessage[] = [];
      const toolCalls = assistant.toolCalls;
      let executionTerminal: RuntimeRunTerminal | undefined;
      for (const toolCall of toolCalls) {
        if (signal.aborted) throw createAbortError(signal);
        const execution = await executeToolCall({
          input: accepted,
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
          executionTerminal = execution.terminal;
          break;
        }
      }

      await finishTurn(controller, accepted, currentTurn, assistant.message, toolResultMessages);
      if (executionTerminal ?? assistant.terminal) {
        terminal = (executionTerminal ?? assistant.terminal)!;
        shouldContinue = false;
      } else if (toolCalls.length === 0) {
        terminal = {
          status: 'completed',
          ...(assistantText(assistant.message) === '' ? {} : { output: assistantText(assistant.message) }),
        };
        shouldContinue = false;
      }
    }
  } catch (error) {
    failedPath = true;
    terminal = terminalFromError(error, signal);
    if (started && accepted && currentTurn !== null) {
      try {
        await closeOpenTurnAfterFailure(
          controller,
          accepted,
          currentTurn,
          context,
          terminal,
          assistantIndex,
        );
      } catch (_repairError) {
        // Strict controller recovery below still guarantees the sole run.end.
      }
    }
  }

  if (controller.status === 'running') {
    try {
      if (failedPath) await controller.finishAfterFailure(nonCompletedTerminal(terminal));
      else await controller.finish(terminal);
    } catch (error) {
      if (error instanceof RuntimeRunProtocolError && error.code === 'RUNTIME_DURABLE_TERMINAL_FAILED') {
        terminalPersistenceError = error;
      }
      terminal = terminalFromError(error, signal);
      if (controller.status === 'running' && controller.terminalPersistenceFailure === undefined) {
        try {
          await controller.finishAfterFailure(nonCompletedTerminal(terminal));
        } catch (_repairError) {
          // A reserved terminal remains unique; no second publication is legal.
        }
      }
    }
  }

  signal.cleanup();
  controller.dispose();
  if (terminalPersistenceError ?? controller.terminalPersistenceFailure) {
    throw terminalPersistenceError ?? new RuntimeRunProtocolError(
      'RUNTIME_DURABLE_TERMINAL_FAILED',
      'The durable Runtime terminal commit failed.',
    );
  }
  return {
    terminal: controller.terminal ?? terminal,
    messages: Object.freeze(context.map((message) => canonicalizeRuntimeMessage(message, redactions))),
    events: controller.events,
    runMarkers: controller.runMarkers,
    turns: Object.freeze(turns.slice()),
    finalProjection: cloneProjection(projection, redactions),
    controller,
  };
}

/** Alias used by small Runtime facades that prefer a shorter name. */
export const runAgent = runAgentLoop;

function createControllerOptions(
  input: AgentLoopInput,
  redactions: readonly string[],
): RuntimeRunControllerOptions {
  return {
    sessionId: input.sessionId,
    runId: input.runId,
    defTurnId: input.defTurnId,
    initialTurnId: input.initialTurnId ?? dataProperty(input.userMessage, 'turnId') as RuntimeTurnId | undefined,
    now: input.now,
    signal: input.signal,
    listeners: input.listeners,
    markerListeners: input.markerListeners,
    durableEventCommit: input.durableEventCommit,
    terminalCommit: input.terminalCommit,
    redactions,
  };
}

function snapshotAgentLoopEnvelope(value: AgentLoopInput): AgentLoopInput {
  return snapshotPlainDataObject(
    value,
    [
      'sessionId',
      'runId',
      'defTurnId',
      'systemPrompt',
      'messages',
      'userMessage',
      'connection',
      'tools',
      'modelDriver',
      'toolBridge',
      'signal',
      'initialTurnId',
      'maxTurns',
      'now',
      'listeners',
      'markerListeners',
      'durableEventCommit',
      'terminalCommit',
      'controller',
    ],
    'RUNTIME_INPUT_INVALID',
    'Runtime Agent loop input was invalid.',
  ) as unknown as AgentLoopInput;
}

function snapshotPlainDataObject(
  value: unknown,
  allowedKeys: readonly string[],
  code: string,
  message: string,
): Readonly<Record<string, unknown>> {
  if (!isPlainDataContainer(value)) throw new AgentLoopFailure(code, message);
  let descriptors: Record<PropertyKey, PropertyDescriptor>;
  try {
    descriptors = Object.getOwnPropertyDescriptors(value) as unknown as Record<PropertyKey, PropertyDescriptor>;
  } catch (_error) {
    throw new AgentLoopFailure(code, message);
  }
  const allowed = new Set(allowedKeys);
  const output: Record<string, unknown> = {};
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== 'string' || !allowed.has(key)) throw new AgentLoopFailure(code, message);
    const descriptor = descriptors[key];
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
      throw new AgentLoopFailure(code, message);
    }
    Object.defineProperty(output, key, {
      value: descriptor.value,
      enumerable: true,
      configurable: false,
      writable: false,
    });
  }
  return Object.freeze(output);
}

function snapshotDenseDataArray(
  value: unknown,
  maxItems: number,
  code: string,
  message: string,
): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new AgentLoopFailure(code, message);
  }
  let descriptors: Record<PropertyKey, PropertyDescriptor>;
  let prototype: unknown;
  try {
    prototype = Object.getPrototypeOf(value);
    descriptors = Object.getOwnPropertyDescriptors(value) as unknown as Record<PropertyKey, PropertyDescriptor>;
  } catch (_error) {
    throw new AgentLoopFailure(code, message);
  }
  const lengthDescriptor = descriptors.length;
  if (
    prototype !== Array.prototype
    || !lengthDescriptor
    || !('value' in lengthDescriptor)
    || !Number.isSafeInteger(lengthDescriptor.value)
    || lengthDescriptor.value < 0
    || lengthDescriptor.value > maxItems
  ) {
    throw new AgentLoopFailure(code, message);
  }
  const length = lengthDescriptor.value as number;
  const indexed = new Map<number, unknown>();
  for (const key of Reflect.ownKeys(descriptors)) {
    if (key === 'length') continue;
    if (typeof key !== 'string' || !/^(?:0|[1-9][0-9]*)$/u.test(key)) {
      throw new AgentLoopFailure(code, message);
    }
    const index = Number(key);
    const descriptor = descriptors[key];
    if (
      !Number.isSafeInteger(index)
      || index < 0
      || index >= length
      || !descriptor
      || !descriptor.enumerable
      || !('value' in descriptor)
    ) {
      throw new AgentLoopFailure(code, message);
    }
    indexed.set(index, descriptor.value);
  }
  if (indexed.size !== length) throw new AgentLoopFailure(code, message);
  const output: unknown[] = [];
  for (let index = 0; index < length; index += 1) output.push(indexed.get(index));
  return Object.freeze(output);
}

function isPlainDataContainer(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch (_error) {
    return false;
  }
}

function dataProperty(value: unknown, key: string): unknown {
  if (!isPlainDataContainer(value)) return undefined;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && 'value' in descriptor ? descriptor.value : undefined;
  } catch (_error) {
    return undefined;
  }
}

function snapshotLoopInput(input: AgentLoopInput): AcceptedAgentLoopInput {
  if (!isRecord(input)) throw new AgentLoopFailure('RUNTIME_INPUT_INVALID', 'Runtime Agent loop input was invalid.');
  for (const [value, label] of [
    [input.sessionId, 'sessionId'],
    [input.runId, 'runId'],
    [input.defTurnId, 'defTurnId'],
  ] as const) {
    if (!boundedNonEmptyString(value, 256)) {
      throw new AgentLoopFailure('RUNTIME_INPUT_INVALID', `Runtime ${label} was invalid.`);
    }
  }
  if (input.initialTurnId !== undefined && !boundedNonEmptyString(input.initialTurnId, 256)) {
    throw new AgentLoopFailure('RUNTIME_INPUT_INVALID', 'Runtime initial turnId was invalid.');
  }
  if (
    typeof input.systemPrompt !== 'string'
    || input.systemPrompt.length === 0
    || input.systemPrompt.length > MAX_SYSTEM_PROMPT_CODE_UNITS
  ) {
    throw new AgentLoopFailure('RUNTIME_SYSTEM_PROMPT_INVALID', 'Runtime system prompt is invalid.');
  }
  if (!input.modelDriver || typeof input.modelDriver.stream !== 'function') {
    throw new AgentLoopFailure('RUNTIME_MODEL_DRIVER_INVALID', 'Runtime ModelDriver is invalid.');
  }
  if (!input.toolBridge || typeof input.toolBridge.invoke !== 'function') {
    throw new AgentLoopFailure('RUNTIME_TOOL_BRIDGE_INVALID', 'Runtime ToolBridge is invalid.');
  }
  if (input.now !== undefined && typeof input.now !== 'function') {
    throw new AgentLoopFailure('RUNTIME_CLOCK_INVALID', 'Runtime clock is invalid.');
  }
  if (input.maxTurns !== undefined && !validMaxTurns(input.maxTurns)) {
    throw new AgentLoopFailure('RUNTIME_MAX_TURNS_INVALID', 'Runtime maxTurns is invalid.');
  }
  const connection = cloneConnection(input.connection);
  const redactions = collectPotentialRedactions(connection);
  const inputMessages = snapshotDenseDataArray(
    input.messages,
    MAX_INPUT_MESSAGES,
    'RUNTIME_MESSAGES_INVALID',
    'Runtime input messages are invalid.',
  );
  const messages = Object.freeze(inputMessages.map(
    (message) => canonicalizeRuntimeMessage(message as RuntimeMessage, redactions),
  ));
  assertInputBudget(messages);
  validateInputTranscript(messages);
  let userMessage: RuntimeUserMessage | undefined;
  if (input.userMessage !== undefined) {
    const acceptedUser = canonicalizeRuntimeMessage(input.userMessage, redactions);
    if (acceptedUser.role !== 'user') {
      throw new AgentLoopFailure('RUNTIME_USER_MESSAGE_INVALID', 'Runtime userMessage was invalid.');
    }
    userMessage = acceptedUser;
    if (userMessage.defTurnId !== input.defTurnId) {
      throw new AgentLoopFailure(
        'RUNTIME_MESSAGE_DEF_TURN_ID_CONFLICT',
        'The user message does not belong to this DEF turn.',
      );
    }
    const duplicate = messages.find((message) => message.id === userMessage?.id);
    if (duplicate !== undefined && !plainDeepEqual(duplicate, userMessage)) {
      throw new AgentLoopFailure('RUNTIME_MESSAGE_DUPLICATE', 'Runtime userMessage conflicted with input context.');
    }
    if (input.initialTurnId !== undefined && input.initialTurnId !== userMessage.turnId) {
      throw new AgentLoopFailure('RUNTIME_MESSAGE_CORRELATION_INVALID', 'Runtime userMessage changed the initial turn.');
    }
  }

  const tools = cloneProjection(input.tools, redactions);
  const listeners = snapshotCallbacks(input.listeners, 'Runtime event listeners');
  const markerListeners = snapshotCallbacks(input.markerListeners, 'Runtime marker listeners');
  if (input.terminalCommit !== undefined && typeof input.terminalCommit !== 'function') {
    throw new AgentLoopFailure('RUNTIME_LISTENER_INVALID', 'Runtime terminal commit is invalid.');
  }
  if (input.durableEventCommit !== undefined && typeof input.durableEventCommit !== 'function') {
    throw new AgentLoopFailure('RUNTIME_LISTENER_INVALID', 'Runtime durable event commit is invalid.');
  }
  if ((input.durableEventCommit === undefined) !== (input.terminalCommit === undefined)) {
    throw new AgentLoopFailure(
      'RUNTIME_DURABLE_CONFIG_INVALID',
      'Runtime durable event and terminal commits must be configured together.',
    );
  }
  if (input.controller !== undefined) validateControllerCorrelation(input.controller, input);

  return Object.freeze({
    sessionId: input.sessionId,
    runId: input.runId,
    defTurnId: input.defTurnId,
    systemPrompt: redactSecrets(input.systemPrompt, redactions),
    messages,
    ...(userMessage === undefined ? {} : { userMessage }),
    connection,
    tools,
    modelDriver: input.modelDriver,
    toolBridge: input.toolBridge,
    ...(input.signal === undefined ? {} : { signal: input.signal }),
    ...(input.initialTurnId === undefined ? {} : { initialTurnId: input.initialTurnId }),
    maxTurns: input.maxTurns ?? DEFAULT_MAX_TURNS,
    ...(input.now === undefined ? {} : { now: input.now }),
    ...(listeners === undefined ? {} : { listeners }),
    ...(markerListeners === undefined ? {} : { markerListeners }),
    ...(input.durableEventCommit === undefined ? {} : { durableEventCommit: input.durableEventCommit }),
    ...(input.terminalCommit === undefined ? {} : { terminalCommit: input.terminalCommit }),
    ...(input.controller === undefined ? {} : { controller: input.controller }),
    redactions,
  });
}

function cloneConnection(value: RuntimeModelConnection): RuntimeModelConnection {
  const source = snapshotPlainDataObject(
    value,
    ['providerId', 'modelId', 'baseUrl', 'apiKey', 'headers', 'contextLimit', 'outputLimit'],
    'RUNTIME_MODEL_CONNECTION_INVALID',
    'Runtime model connection is invalid.',
  ) as unknown as RuntimeModelConnection;
  for (const key of ['providerId', 'modelId', 'baseUrl', 'apiKey'] as const) {
    if (!boundedNonEmptyString(source[key], MAX_CONNECTION_STRING_CODE_UNITS)) {
      throw new AgentLoopFailure('RUNTIME_MODEL_CONNECTION_INVALID', 'Runtime model connection is invalid.');
    }
  }
  if (source.apiKey.length < 4) {
    throw new AgentLoopFailure('RUNTIME_MODEL_CONNECTION_INVALID', 'Runtime model connection is invalid.');
  }
  let parsed: URL;
  try {
    parsed = new URL(source.baseUrl);
  } catch (_error) {
    throw new AgentLoopFailure('RUNTIME_MODEL_CONNECTION_INVALID', 'Runtime model connection is invalid.');
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new AgentLoopFailure('RUNTIME_MODEL_CONNECTION_INVALID', 'Runtime model connection is invalid.');
  }
  const headers = source.headers === undefined ? undefined : cloneHeaders(source.headers);
  for (const limit of [source.contextLimit, source.outputLimit]) {
    if (limit !== undefined && (!isFinitePositiveInteger(limit) || limit > 100_000_000)) {
      throw new AgentLoopFailure('RUNTIME_MODEL_CONNECTION_INVALID', 'Runtime model connection is invalid.');
    }
  }
  return Object.freeze({
    providerId: source.providerId,
    modelId: source.modelId,
    baseUrl: source.baseUrl,
    apiKey: source.apiKey,
    ...(headers === undefined ? {} : { headers }),
    ...(source.contextLimit === undefined ? {} : { contextLimit: source.contextLimit }),
    ...(source.outputLimit === undefined ? {} : { outputLimit: source.outputLimit }),
  });
}

function cloneHeaders(value: Readonly<Record<string, string>>): Readonly<Record<string, string>> {
  if (!isPlainDataContainer(value)) {
    throw new AgentLoopFailure('RUNTIME_MODEL_CONNECTION_INVALID', 'Runtime connection headers are invalid.');
  }
  let descriptors: Record<PropertyKey, PropertyDescriptor>;
  try {
    descriptors = Object.getOwnPropertyDescriptors(value) as unknown as Record<PropertyKey, PropertyDescriptor>;
  } catch (_error) {
    throw new AgentLoopFailure('RUNTIME_MODEL_CONNECTION_INVALID', 'Runtime connection headers are invalid.');
  }
  if (Reflect.ownKeys(descriptors).some((key) => typeof key === 'symbol')) {
    throw new AgentLoopFailure('RUNTIME_MODEL_CONNECTION_INVALID', 'Runtime connection headers are invalid.');
  }
  const entries = Object.entries(descriptors);
  if (entries.length > MAX_CONNECTION_HEADERS) {
    throw new AgentLoopFailure('RUNTIME_MODEL_CONNECTION_INVALID', 'Runtime connection headers are invalid.');
  }
  const output: Record<string, string> = {};
  for (const [key, descriptor] of entries) {
    if (
      !('value' in descriptor)
      || !descriptor.enumerable
      || !boundedNonEmptyString(key, 256)
      || /[\u0000-\u001f\u007f]/u.test(key)
      || typeof descriptor.value !== 'string'
      || descriptor.value.length > MAX_CONNECTION_STRING_CODE_UNITS
      || /[\u0000\r\n]/u.test(descriptor.value)
    ) {
      throw new AgentLoopFailure('RUNTIME_MODEL_CONNECTION_INVALID', 'Runtime connection headers are invalid.');
    }
    if (sensitiveHeaderName(key) && headerCredential(descriptor.value).length < 4) {
      throw new AgentLoopFailure('RUNTIME_MODEL_CONNECTION_INVALID', 'Runtime connection headers are invalid.');
    }
    Object.defineProperty(output, key, {
      value: descriptor.value,
      enumerable: true,
      configurable: false,
      writable: false,
    });
  }
  return Object.freeze(output);
}

function sensitiveHeaderName(value: string): boolean {
  return /(?:authorization|proxy-authorization|api[-_]?key|token|cookie|password|secret)/iu.test(value);
}

function headerCredential(value: string): string {
  const match = /^(?:Bearer|Basic)\s+(.+)$/iu.exec(value.trim());
  return match?.[1] ?? value.trim();
}

function collectPotentialRedactions(value: unknown): readonly string[] {
  const secrets = new Set<string>();
  try {
    if (isPlainDataContainer(value)) {
      const connectionDescriptors = Object.getOwnPropertyDescriptors(value);
      const apiKeyDescriptor = connectionDescriptors.apiKey;
      if (
        apiKeyDescriptor
        && 'value' in apiKeyDescriptor
        && typeof apiKeyDescriptor.value === 'string'
        && apiKeyDescriptor.value.length >= 4
        && apiKeyDescriptor.value.length <= MAX_CONNECTION_STRING_CODE_UNITS
      ) {
        secrets.add(apiKeyDescriptor.value);
      }
      const headersDescriptor = connectionDescriptors.headers;
      if (headersDescriptor && 'value' in headersDescriptor && isPlainDataContainer(headersDescriptor.value)) {
        const descriptors = Object.getOwnPropertyDescriptors(headersDescriptor.value);
        let accepted = 0;
        for (const descriptor of Object.values(descriptors)) {
          if (!descriptor.enumerable || !('value' in descriptor) || typeof descriptor.value !== 'string') continue;
          accepted += 1;
          if (accepted > MAX_CONNECTION_HEADERS) break;
          if (descriptor.value.length >= 4 && descriptor.value.length <= MAX_CONNECTION_STRING_CODE_UNITS) {
            secrets.add(descriptor.value);
            const credential = /^(?:Bearer|Basic)\s+(.+)$/iu.exec(descriptor.value);
            if (credential?.[1] && credential[1].length >= 4) secrets.add(credential[1]);
          }
        }
      }
    }
  } catch (_error) {
    // Invalid/hostile connection objects are rejected by cloneConnection. The
    // fallback redaction probe never invokes accessors and never propagates a
    // Proxy trap failure before the stable input lifecycle can be emitted.
  }
  return Object.freeze([...secrets].sort((left, right) => right.length - left.length));
}

function snapshotCallbacks<T extends (...args: never[]) => unknown>(
  value: readonly T[] | undefined,
  label: string,
): readonly T[] | undefined {
  if (value === undefined) return undefined;
  const callbacks = snapshotDenseDataArray(value, 64, 'RUNTIME_LISTENER_INVALID', `${label} are invalid.`);
  if (callbacks.some((callback) => typeof callback !== 'function')) {
    throw new AgentLoopFailure('RUNTIME_LISTENER_INVALID', `${label} are invalid.`);
  }
  return callbacks as readonly T[];
}

function validateControllerCorrelation(
  controller: RuntimeRunController,
  input: Pick<AgentLoopInput, 'sessionId' | 'runId' | 'defTurnId'>,
): void {
  if (
    controller.sessionId !== input.sessionId
    || controller.runId !== input.runId
    || controller.defTurnId !== input.defTurnId
  ) {
    throw new AgentLoopFailure('RUNTIME_CONTROLLER_CORRELATION_INVALID', 'Runtime controller correlation is invalid.');
  }
}

function validateInputTranscript(messages: readonly RuntimeMessage[]): void {
  const messageIds = new Set<string>();
  const calls = new Map<string, { readonly name: string; consumed: boolean }>();
  for (const message of messages) {
    if (messageIds.has(message.id)) {
      throw new AgentLoopFailure('RUNTIME_MESSAGE_DUPLICATE', 'Runtime input message IDs must be unique.');
    }
    messageIds.add(message.id);
    if (message.role === 'assistant') {
      for (const block of message.content) {
        if (block.type !== 'tool-call') continue;
        if (calls.has(block.toolCallId)) {
          throw new AgentLoopFailure('RUNTIME_TOOL_DUPLICATE', 'Runtime input Tool call IDs must be unique.');
        }
        calls.set(block.toolCallId, { name: block.name, consumed: false });
      }
    } else if (message.role === 'tool-result') {
      const call = calls.get(message.toolCallId);
      if (!call || call.consumed || call.name !== message.toolName) {
        throw new AgentLoopFailure('RUNTIME_TOOL_RESULT_INVALID', 'Runtime input Tool result pairing is invalid.');
      }
      call.consumed = true;
    }
  }
}

function assertInputBudget(messages: readonly RuntimeMessage[]): void {
  let codeUnits = 0;
  let nodes = 0;
  const stack: unknown[] = [...messages];
  while (stack.length > 0) {
    const value = stack.pop();
    nodes += 1;
    if (nodes > 65_536) throw new AgentLoopFailure('RUNTIME_MESSAGES_INVALID', 'Runtime input messages are too large.');
    if (typeof value === 'string') codeUnits += value.length;
    else if (Array.isArray(value)) stack.push(...value);
    else if (isRecord(value)) {
      for (const [key, child] of Object.entries(value)) {
        codeUnits += key.length;
        stack.push(child);
      }
    }
    if (codeUnits > MAX_INPUT_CODE_UNITS) {
      throw new AgentLoopFailure('RUNTIME_MESSAGES_INVALID', 'Runtime input messages are too large.');
    }
  }
}

function validMaxTurns(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= MAX_TURNS;
}

function nonCompletedTerminal(terminal: RuntimeRunTerminal): Exclude<RuntimeRunTerminal, { readonly status: 'completed' }> {
  return terminal.status === 'completed'
    ? { status: 'failed', code: 'RUNTIME_TERMINAL_REPAIR_FAILED', message: 'Runtime terminal repair failed.' }
    : terminal;
}

async function streamAssistantResponse(options: {
  readonly input: AcceptedAgentLoopInput;
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
    stream = input.modelDriver.stream(Object.freeze({
      runId: input.runId,
      turnId,
      connection: input.connection,
      systemPrompt: input.systemPrompt,
      messages: Object.freeze(context.slice()),
      tools: Object.freeze(projection.tools.slice()),
      signal,
    }));
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
      if (expectedOrdinal > MAX_PROVIDER_EVENTS + 1) {
        throw new AgentLoopFailure('RUNTIME_PROVIDER_EVENT_LIMIT', 'The model emitted too many events.');
      }
      if (providerTerminal !== null) {
        throw new AgentLoopFailure('RUNTIME_PROVIDER_LATE_EVENT', 'The model emitted an event after its terminal.');
      }
      if (event.type === 'response.done' || event.type === 'response.error') {
        validateProviderTerminalIdentity(accumulator, event);
        if (event.type === 'response.done') validateSuccessfulProviderTerminal(accumulator, event.stopReason);
        providerTerminal = event;
        if (event.type === 'response.error') {
          accumulator.diagnostic = diagnosticFromFailure(event.failure, input.redactions);
          accumulator.stopReason = event.failure.kind === 'aborted' ? 'aborted' : 'error';
          accumulator.usage = ZERO_USAGE;
        } else {
          accumulator.usage = cloneUsage(event.usage);
          accumulator.stopReason = event.stopReason;
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
    closeIteratorDetached(iterator);
  }

  if (protocolFailure) {
    invalidateObservedToolCalls(accumulator, protocolFailure);
    const calls = finalizeToolCalls(accumulator, undefined, input.redactions);
    const message = await finalizeAccumulator(accumulator, controller, input, signal, 'error', protocolFailure);
    return {
      message,
      toolCalls: calls,
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
          message: safeProviderMessage(failure.message, input.redactions),
        };
    if (accumulator.toolCalls.length > 0) {
      invalidateObservedToolCalls(
        accumulator,
        new AgentLoopFailure(
          safeCode(failure.code, 'RUNTIME_PROVIDER_FAILED'),
          'Tool call was not trusted because the provider response failed.',
        ),
      );
    }
    const calls = finalizeToolCalls(accumulator, undefined, input.redactions);
    const message = await finalizeAccumulator(accumulator, controller, input, signal, 'error');
    return { message, toolCalls: calls, terminal };
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

  const calls = finalizeToolCalls(accumulator, done.stopReason, input.redactions);
  const message = await finalizeAccumulator(accumulator, controller, input, signal, 'normal');
  return { message, toolCalls: calls };
}

function createAccumulator(
  input: AcceptedAgentLoopInput,
  turnId: RuntimeTurnId,
  assistantId: RuntimeMessageId,
): AssistantAccumulator {
  return {
    assistantId,
    defTurnId: input.defTurnId,
    turnId,
    createdAt: safeLoopTimestamp((input.now ?? (() => new Date().toISOString()))()),
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
  input: AcceptedAgentLoopInput,
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
    completedAt: safeLoopTimestamp((input.now ?? (() => new Date().toISOString()))()),
  };

  // `signal` is intentionally read here only to keep the finalization point
  // explicit. A late abort cannot change an already assembled normal message
  // into a second terminal event; the caller owns that decision.
  void signal;
  const canonical = canonicalizeRuntimeMessage(message, input.redactions);
  if (canonical.role !== 'assistant') {
    throw new AgentLoopFailure('RUNTIME_MESSAGE_INVALID', 'Runtime assistant message was invalid.');
  }
  await emit(controller, {
    type: 'message.end',
    runId: input.runId,
    defTurnId: input.defTurnId,
    message: canonical,
  });
  return canonical;
}

async function applyProviderEvent(
  accumulator: AssistantAccumulator,
  event: Exclude<ProviderStreamEvent, { type: 'response.done' | 'response.error' }>,
  controller: RuntimeRunController,
  input: AcceptedAgentLoopInput,
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
      accumulator.responseIdRaw = event.responseId;
      accumulator.responseModelRaw = event.responseModel;
      accumulator.responseId = event.responseId === undefined
        ? undefined
        : redactSecrets(event.responseId, input.redactions);
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
      appendToolNameDelta(state, event.nameDelta);
      appendToolArgumentsDelta(state, event.argumentsDelta);
      accumulator.content[event.contentIndex] = state.block;
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
  input: AcceptedAgentLoopInput,
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
  accumulator.content[state.contentIndex] = {
    ...block,
    text: redactSecrets(state.text, input.redactions),
  };
  void controller;
  void type;
}

async function finishTextState(
  state: MutableContentState,
  finalText: string,
  accumulator: AssistantAccumulator,
  input: AcceptedAgentLoopInput,
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
  const visibleText = redactSecrets(state.text, input.redactions);
  if (visibleText) {
    await emitProviderDelta(controller, input, accumulator, state.blockId, type, visibleText);
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
    contentIndex,
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
  code: string,
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
      contentIndex,
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
  stopReason: Exclude<RuntimeAssistantStopReason, 'error' | 'aborted'> | undefined,
  redactions: readonly string[],
): readonly AssembledToolCall[] {
  const ordered = accumulator.toolCalls.slice().sort((left, right) => left.contentIndex - right.contentIndex);
  return Object.freeze(ordered.map((state) => {
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
    const block = Object.freeze({
      ...state.block,
      name: redactSecrets(state.block.name, redactions),
      arguments: cloneBoundedJsonObject(state.block.arguments, redactions) ?? {},
    });
    state.block = block;
    accumulator.content[state.contentIndex] = block;
    return Object.freeze({
      contentIndex: state.contentIndex,
      block,
      rawArguments: redactSecrets(state.rawArguments, redactions),
      started: state.started,
      ended: state.ended,
      ...(state.malformedReason === undefined ? {} : { malformedReason: state.malformedReason }),
      ...(state.malformedCode === undefined ? {} : { malformedCode: state.malformedCode }),
    });
  }));
}

function invalidateObservedToolCalls(
  accumulator: AssistantAccumulator,
  failure: AgentLoopFailure,
): void {
  for (const state of accumulator.toolCalls) {
    state.malformedReason = 'Tool call was not trusted because the provider stream violated its protocol.';
    state.malformedCode = safeCode(failure.code, 'RUNTIME_PROVIDER_PROTOCOL_ERROR');
  }
}

function validateProviderTerminalIdentity(
  accumulator: AssistantAccumulator,
  event: Extract<ProviderStreamEvent, { readonly type: 'response.done' | 'response.error' }>,
): void {
  if (event.type === 'response.done') {
    if (event.responseId !== accumulator.responseIdRaw) {
      throw new AgentLoopFailure(
        'RUNTIME_PROVIDER_RESPONSE_ID_CONFLICT',
        'The model changed its response identity after response.start.',
      );
    }
    if (
      accumulator.responseModelRaw !== undefined
      && event.responseModel !== undefined
      && event.responseModel !== accumulator.responseModelRaw
    ) {
      throw new AgentLoopFailure(
        'RUNTIME_PROVIDER_RESPONSE_ID_CONFLICT',
        'The model changed its response identity after response.start.',
      );
    }
    return;
  }
  // response.error has no responseId in the F0 Provider contract. It is valid
  // without response.start for HTTP/auth failures; after an identified start,
  // accepting it would lose the identity binding and therefore fails closed.
  if (accumulator.responseStarted && accumulator.responseIdRaw !== undefined) {
    throw new AgentLoopFailure(
      'RUNTIME_PROVIDER_RESPONSE_ID_CONFLICT',
      'The model error terminal could not retain its response identity.',
    );
  }
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
  readonly input: AcceptedAgentLoopInput;
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
  let updateCount = 0;
  let acceptingUpdates = true;
  let updateFailure: AgentLoopFailure | undefined;
  const onUpdate = (update: RuntimeToolUpdate): void | Promise<void> => {
    if (!acceptingUpdates || signal.aborted) return;
    updateCount += 1;
    if (updateCount > MAX_TOOL_UPDATES) {
      updateFailure ??= new AgentLoopFailure(
        'RUNTIME_TOOL_UPDATE_LIMIT',
        'The Tool bridge emitted too many updates.',
      );
      return;
    }
    let updateSource: Readonly<Record<string, unknown>>;
    try {
      updateSource = snapshotPlainDataObject(
        update,
        ['toolCallId', 'detail'],
        'RUNTIME_TOOL_UPDATE_INVALID',
        'The Tool bridge emitted an invalid update.',
      );
    } catch (_error) {
      updateFailure ??= new AgentLoopFailure(
        'RUNTIME_TOOL_UPDATE_INVALID',
        'The Tool bridge emitted an update outside the bounded data contract.',
      );
      return;
    }
    if (
      updateSource.toolCallId !== call.block.toolCallId
      || !Object.prototype.hasOwnProperty.call(updateSource, 'detail')
    ) {
      updateFailure ??= new AgentLoopFailure(
        'RUNTIME_TOOL_UPDATE_INVALID',
        'The Tool bridge emitted an update for a different Tool call.',
      );
      return;
    }
    const detail = cloneBoundedJsonValue(updateSource.detail, input.redactions);
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
      toolCallId: call.block.toolCallId,
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
      Object.freeze({
        sessionId: input.sessionId,
        defTurnId: input.defTurnId,
        runId: input.runId,
        turnId,
        call: call.block,
        projectionRevision: projection.revision,
      } satisfies RuntimeToolInvocation),
      signal,
      onUpdate,
    );
    const returnedSettlement = await awaitWithAbort(pending, signal);
    acceptingUpdates = false;
    await Promise.all(updatePromises);
    if (updateFailure) throw updateFailure;
    if (signal.aborted) throw createAbortError(signal);
    settlement = cloneSettlement(
      returnedSettlement,
      call.block.toolCallId,
      projection.revision,
      input.redactions,
    );
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

  const result = sanitizeToolResult(settlement.result, input.redactions);
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
  input: AcceptedAgentLoopInput,
  turnId: RuntimeTurnId,
  call: RuntimeToolCallBlock,
  code: string,
  reason: string,
): RuntimeToolResultMessage {
  const result: RuntimeToolResultPayload = {
    status: 'failed',
    code: safeCode(code, 'RUNTIME_TOOL_FAILED'),
    message: safeProviderMessage(reason, input.redactions),
  };
  return createToolResultMessage(input, turnId, call, result);
}

async function emitToolResultMessage(
  controller: RuntimeRunController,
  input: AcceptedAgentLoopInput,
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
  input: AcceptedAgentLoopInput,
  turnId: RuntimeTurnId,
  call: RuntimeToolCallBlock,
  result: RuntimeToolResultPayload,
): RuntimeToolResultMessage {
  const message: RuntimeToolResultMessage = {
    schemaVersion: 1,
    id: messageIdForKey(input.runId, 'tool-result', `${turnId}:${call.toolCallId}`),
    createdAt: safeLoopTimestamp((input.now ?? (() => new Date().toISOString()))()),
    defTurnId: input.defTurnId,
    turnId,
    role: 'tool-result',
    toolCallId: call.toolCallId,
    toolName: call.name,
    result,
    completedAt: safeLoopTimestamp((input.now ?? (() => new Date().toISOString()))()),
  };
  const canonical = canonicalizeRuntimeMessage(message, input.redactions);
  if (canonical.role !== 'tool-result') {
    throw new AgentLoopFailure('RUNTIME_TOOL_RESULT_INVALID', 'Runtime Tool result message was invalid.');
  }
  return canonical;
}

async function finishTurn(
  controller: RuntimeRunController,
  input: AcceptedAgentLoopInput,
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
  input: AcceptedAgentLoopInput,
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
    context.push(assistant);
  }
  try {
    await finishTurn(controller, input, turnId, assistant, []);
  } catch (_error) {
    // The original terminal is safer than attempting a second lifecycle repair.
  }
}

async function emitProviderDelta(
  controller: RuntimeRunController,
  input: AcceptedAgentLoopInput,
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

function validateProviderEvent(value: ProviderStreamEvent): ProviderStreamEvent {
  const event = snapshotPlainDataObject(
    value,
    [
      'ordinal', 'type', 'responseId', 'responseModel', 'stopReason', 'usage', 'failure',
      'contentIndex', 'delta', 'text', 'redacted', 'toolCallId', 'name', 'nameDelta',
      'argumentsDelta', 'arguments',
    ],
    'RUNTIME_PROVIDER_EVENT_INVALID',
    'The model emitted a malformed event.',
  ) as unknown as ProviderStreamEvent;
  if (!isFinitePositiveInteger(event.ordinal) || typeof event.type !== 'string') {
    throw invalidProviderEvent();
  }
  switch (event.type) {
    case 'response.start':
      assertProviderKeys(event, ['ordinal', 'type'], ['responseId', 'responseModel']);
      if (
        !optionalBoundedProviderMetadata(event.responseId)
        || !optionalBoundedProviderMetadata(event.responseModel)
      ) {
        throw invalidProviderEvent();
      }
      return Object.freeze({
        ordinal: event.ordinal,
        type: event.type,
        ...(event.responseId === undefined ? {} : { responseId: event.responseId }),
        ...(event.responseModel === undefined ? {} : { responseModel: event.responseModel }),
      });
    case 'response.done':
      assertProviderKeys(event, ['ordinal', 'type', 'stopReason', 'usage'], ['responseId', 'responseModel']);
      {
        const acceptedUsage = snapshotProviderUsage(event.usage);
      if (
        !['stop', 'length', 'tool-use'].includes(event.stopReason)
        || acceptedUsage === undefined
        || !optionalBoundedProviderMetadata(event.responseId)
        || !optionalBoundedProviderMetadata(event.responseModel)
      ) {
        throw new AgentLoopFailure('RUNTIME_PROVIDER_TERMINAL_INVALID', 'The model terminal was malformed.');
      }
      return Object.freeze({
        ordinal: event.ordinal,
        type: event.type,
        stopReason: event.stopReason,
        usage: acceptedUsage,
        ...(event.responseId === undefined ? {} : { responseId: event.responseId }),
        ...(event.responseModel === undefined ? {} : { responseModel: event.responseModel }),
      });
      }
    case 'response.error':
      assertProviderKeys(event, ['ordinal', 'type', 'failure']);
      {
      const acceptedFailure = snapshotProviderFailure(event.failure);
      if (acceptedFailure === undefined) {
        throw new AgentLoopFailure('RUNTIME_PROVIDER_TERMINAL_INVALID', 'The model error terminal was malformed.');
      }
      return Object.freeze({
        ordinal: event.ordinal,
        type: event.type,
        failure: acceptedFailure,
      });
      }
    case 'text.start':
    case 'thinking.start':
      assertProviderKeys(event, ['ordinal', 'type', 'contentIndex']);
      validateContentIndex(event.contentIndex);
      return Object.freeze({ ordinal: event.ordinal, type: event.type, contentIndex: event.contentIndex });
    case 'text.delta':
    case 'thinking.delta':
      assertProviderKeys(event, ['ordinal', 'type', 'contentIndex', 'delta']);
      validateContentIndex(event.contentIndex);
      if (typeof event.delta !== 'string' || event.delta.length > MAX_PROVIDER_STRING_CODE_UNITS) {
        throw invalidProviderEvent();
      }
      return Object.freeze({ ordinal: event.ordinal, type: event.type, contentIndex: event.contentIndex, delta: event.delta });
    case 'text.end':
      assertProviderKeys(event, ['ordinal', 'type', 'contentIndex', 'text']);
      validateContentIndex(event.contentIndex);
      if (typeof event.text !== 'string' || event.text.length > MAX_PROVIDER_STRING_CODE_UNITS) throw invalidProviderEvent();
      return Object.freeze({ ordinal: event.ordinal, type: event.type, contentIndex: event.contentIndex, text: event.text });
    case 'thinking.end':
      assertProviderKeys(event, ['ordinal', 'type', 'contentIndex', 'text'], ['redacted']);
      validateContentIndex(event.contentIndex);
      if (
        typeof event.text !== 'string'
        || event.text.length > MAX_PROVIDER_STRING_CODE_UNITS
        || (event.redacted !== undefined && typeof event.redacted !== 'boolean')
      ) throw invalidProviderEvent();
      return Object.freeze({
        ordinal: event.ordinal,
        type: event.type,
        contentIndex: event.contentIndex,
        text: event.text,
        ...(event.redacted === undefined ? {} : { redacted: event.redacted }),
      });
    case 'tool-call.start':
      assertProviderKeys(event, ['ordinal', 'type', 'contentIndex', 'toolCallId', 'name']);
      validateContentIndex(event.contentIndex);
      if (typeof event.name !== 'string' || !boundedNonEmptyString(event.toolCallId, 256)) throw invalidProviderEvent();
      return Object.freeze({
        ordinal: event.ordinal,
        type: event.type,
        contentIndex: event.contentIndex,
        toolCallId: event.toolCallId,
        name: event.name,
      });
    case 'tool-call.delta':
      assertProviderKeys(event, ['ordinal', 'type', 'contentIndex', 'toolCallId', 'nameDelta', 'argumentsDelta']);
      validateContentIndex(event.contentIndex);
      if (
        !boundedNonEmptyString(event.toolCallId, 256)
        || typeof event.nameDelta !== 'string'
        || event.nameDelta.length > MAX_PROVIDER_STRING_CODE_UNITS
        || typeof event.argumentsDelta !== 'string'
        || event.argumentsDelta.length > MAX_PROVIDER_STRING_CODE_UNITS
      ) {
        throw invalidProviderEvent();
      }
      return Object.freeze({
        ordinal: event.ordinal,
        type: event.type,
        contentIndex: event.contentIndex,
        toolCallId: event.toolCallId,
        nameDelta: event.nameDelta,
        argumentsDelta: event.argumentsDelta,
      });
    case 'tool-call.end':
      assertProviderKeys(event, ['ordinal', 'type', 'contentIndex', 'toolCallId', 'name', 'arguments']);
      validateContentIndex(event.contentIndex);
      if (!boundedNonEmptyString(event.toolCallId, 256) || typeof event.name !== 'string') throw invalidProviderEvent();
      {
        const args = cloneBoundedJsonObject(event.arguments);
        if (args === undefined) throw invalidProviderEvent();
        return Object.freeze({
          ordinal: event.ordinal,
          type: event.type,
          contentIndex: event.contentIndex,
          toolCallId: event.toolCallId,
          name: event.name,
          arguments: args,
        });
      }
    default:
      throw invalidProviderEvent();
  }
}

function assertProviderKeys(
  value: object,
  required: readonly string[],
  optional: readonly string[] = [],
): void {
  const allowed = new Set([...required, ...optional]);
  if (required.some((key) => !(key in value)) || Object.keys(value).some((key) => !allowed.has(key))) {
    throw invalidProviderEvent();
  }
}

function invalidProviderEvent(): AgentLoopFailure {
  return new AgentLoopFailure('RUNTIME_PROVIDER_EVENT_INVALID', 'The model emitted a malformed event.');
}

function snapshotProviderUsage(value: RuntimeUsage): RuntimeUsage | undefined {
  try {
    const source = snapshotPlainDataObject(
      value,
      ['inputTokens', 'outputTokens', 'totalTokens', 'reasoningTokens', 'cacheReadTokens', 'cacheWriteTokens'],
      'RUNTIME_PROVIDER_TERMINAL_INVALID',
      'The model terminal was malformed.',
    );
    if (
      !isNonNegativeInteger(source.inputTokens)
      || !isNonNegativeInteger(source.outputTokens)
      || !isNonNegativeInteger(source.totalTokens)
      || !optionalUsageNumber(source.reasoningTokens)
      || !optionalUsageNumber(source.cacheReadTokens)
      || !optionalUsageNumber(source.cacheWriteTokens)
    ) return undefined;
    return Object.freeze({
      inputTokens: source.inputTokens,
      outputTokens: source.outputTokens,
      totalTokens: source.totalTokens,
      ...(source.reasoningTokens === undefined ? {} : { reasoningTokens: source.reasoningTokens as number }),
      ...(source.cacheReadTokens === undefined ? {} : { cacheReadTokens: source.cacheReadTokens as number }),
      ...(source.cacheWriteTokens === undefined ? {} : { cacheWriteTokens: source.cacheWriteTokens as number }),
    });
  } catch (_error) {
    return undefined;
  }
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

function snapshotProviderFailure(value: ProviderFailure): ProviderFailure | undefined {
  try {
    const source = snapshotPlainDataObject(
      value,
      ['kind', 'code', 'message', 'retryable', 'statusCode'],
      'RUNTIME_PROVIDER_TERMINAL_INVALID',
      'The model error terminal was malformed.',
    );
    if (
      !['authentication', 'bad-request', 'rate-limit', 'server', 'network', 'context-overflow', 'malformed-response', 'aborted', 'unknown'].includes(String(source.kind))
      || typeof source.code !== 'string'
      || source.code.length > 128
      || typeof source.message !== 'string'
      || source.message.length > MAX_PROVIDER_METADATA_CODE_UNITS
      || typeof source.retryable !== 'boolean'
      || (source.statusCode !== undefined && !isNonNegativeInteger(source.statusCode))
    ) return undefined;
    return Object.freeze({
      kind: source.kind as ProviderFailure['kind'],
      code: source.code,
      message: source.message,
      retryable: source.retryable,
      ...(source.statusCode === undefined ? {} : { statusCode: source.statusCode }),
    });
  } catch (_error) {
    return undefined;
  }
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
  redactions: readonly string[],
): RuntimeToolSettlement {
  const source = snapshotPlainDataObject(
    settlement,
    ['toolCallId', 'result', 'nextProjection'],
    'RUNTIME_TOOL_SETTLEMENT_INVALID',
    'The Tool bridge did not return an atomic settlement.',
  );
  if (
    source.toolCallId !== toolCallId
    || !Object.prototype.hasOwnProperty.call(source, 'result')
    || !Object.prototype.hasOwnProperty.call(source, 'nextProjection')
  ) {
    throw new AgentLoopFailure('RUNTIME_TOOL_SETTLEMENT_INVALID', 'The Tool bridge did not return an atomic settlement.');
  }
  const result = cloneToolResultPayload(source.result, redactions);
  const nextProjection = cloneProjection(source.nextProjection as RuntimeToolProjection, redactions);
  if (nextProjection.revision < currentProjectionRevision) {
    throw new AgentLoopFailure(
      'RUNTIME_TOOL_PROJECTION_REVISION_REGRESSION',
      'The Tool bridge returned a projection revision older than the accepted projection.',
    );
  }
  return Object.freeze({ toolCallId, result, nextProjection });
}

function cloneToolResultPayload(
  value: unknown,
  redactions: readonly string[],
): RuntimeToolResultPayload {
  const source = snapshotPlainDataObject(
    value,
    ['status', 'output', 'code', 'message', 'details'],
    'RUNTIME_TOOL_SETTLEMENT_INVALID',
    'The Tool bridge result was malformed.',
  );
  if (source.status === 'succeeded') {
    if (
      Object.keys(source).some((key) => key !== 'status' && key !== 'output')
      || !Object.prototype.hasOwnProperty.call(source, 'output')
    ) throw invalidToolSettlement();
    const output = cloneBoundedJsonValue(source.output, redactions);
    if (output === undefined) throw invalidToolSettlement();
    return Object.freeze({ status: 'succeeded', output });
  }
  if (
    source.status !== 'failed'
    || Object.keys(source).some((key) => !['status', 'code', 'message', 'details'].includes(key))
    || typeof source.code !== 'string'
    || !/^[A-Za-z0-9._-]{1,128}$/u.test(source.code)
    || typeof source.message !== 'string'
    || source.message.length > MAX_PROVIDER_METADATA_CODE_UNITS
  ) {
    throw invalidToolSettlement();
  }
  const details = source.details === undefined ? undefined : cloneBoundedJsonValue(source.details, redactions);
  if (source.details !== undefined && details === undefined) throw invalidToolSettlement();
  return Object.freeze({
    status: 'failed',
    code: source.code,
    message: safeProviderMessage(source.message, redactions),
    ...(details === undefined ? {} : { details }),
  });
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

function cloneProjection(
  projection: RuntimeToolProjection,
  redactions: readonly string[] = [],
): RuntimeToolProjection {
  const source = snapshotPlainDataObject(
    projection,
    ['revision', 'tools'],
    'RUNTIME_TOOL_PROJECTION_INVALID',
    'The Tool projection was malformed.',
  );
  if (
    !isNonNegativeInteger(source.revision)
    || !Array.isArray(source.tools)
  ) {
    throw new AgentLoopFailure('RUNTIME_TOOL_PROJECTION_INVALID', 'The Tool projection was malformed.');
  }
  const projectedTools = snapshotDenseDataArray(
    source.tools,
    MAX_TOOL_COUNT,
    'RUNTIME_TOOL_PROJECTION_INVALID',
    'The Tool projection was malformed.',
  );
  const names = new Set<string>();
  const tools = projectedTools.map((tool) => {
      const descriptor = snapshotPlainDataObject(
        tool,
        ['name', 'description', 'inputSchema', 'risk'],
        'RUNTIME_TOOL_PROJECTION_INVALID',
        'The Tool projection was malformed.',
      );
      if (
        typeof descriptor.name !== 'string'
        || !descriptor.name
        || descriptor.name !== descriptor.name.trim()
        || descriptor.name.length > MAX_TOOL_NAME_CODE_UNITS
        || /[\u0000-\u001f\u007f]/u.test(descriptor.name)
        || names.has(descriptor.name)
        || typeof descriptor.description !== 'string'
        || descriptor.description.length > MAX_TOOL_DESCRIPTION_CODE_UNITS
        || descriptor.description.includes('\u0000')
        || (descriptor.risk !== 'read' && descriptor.risk !== 'propose' && descriptor.risk !== 'mutate')
      ) {
        throw new AgentLoopFailure('RUNTIME_TOOL_PROJECTION_INVALID', 'The Tool projection was malformed.');
      }
      const acceptedName = redactSecrets(descriptor.name, redactions);
      const inputSchema = cloneBoundedJsonObject(descriptor.inputSchema, redactions);
      if (inputSchema === undefined || !acceptedName || names.has(acceptedName)) {
        throw new AgentLoopFailure('RUNTIME_TOOL_PROJECTION_INVALID', 'The Tool projection was malformed.');
      }
      names.add(acceptedName);
      return Object.freeze({
        name: acceptedName,
        description: redactSecrets(descriptor.description, redactions),
        inputSchema,
        risk: descriptor.risk,
      } satisfies RuntimeToolDescriptor);
    });
  return Object.freeze({
    revision: source.revision,
    tools: Object.freeze(tools),
  });
}

function sanitizeToolResult(
  result: RuntimeToolResultPayload,
  redactions: readonly string[],
): RuntimeToolResultPayload {
  return cloneToolResultPayload(result, redactions);
}

function createAbortError(signal: CombinedAbortSignal): AgentLoopAbortError {
  const reason = signal.reason;
  if (isRecord(reason) && typeof reason.code === 'string') {
    return new AgentLoopAbortError(
      safeCode(reason.code, 'RUNTIME_ABORTED'),
      safeProviderMessage(
        typeof reason.message === 'string' ? reason.message : 'Run aborted.',
        signal.redactions,
      ),
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

function diagnosticFromFailure(
  failure: ProviderFailure,
  redactions: readonly string[],
): RuntimeAssistantMessage['diagnostic'] {
  return {
    code: safeCode(failure.code, 'RUNTIME_PROVIDER_FAILED'),
    message: safeProviderMessage(failure.message, redactions),
    retryable: failure.retryable,
  };
}

function safeProviderMessage(value: string, redactions: readonly string[]): string {
  return redactSecrets(value, redactions)
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
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

interface JsonCloneBudget {
  nodes: number;
  codeUnits: number;
}

function cloneBoundedJsonValue(
  value: unknown,
  redactions: readonly string[] = [],
): JsonValue | undefined {
  try {
    return cloneBoundedJsonNode(value, redactions, 0, { nodes: 0, codeUnits: 0 }, new WeakSet<object>());
  } catch (_error) {
    return undefined;
  }
}

function cloneBoundedJsonObject(
  value: unknown,
  redactions: readonly string[] = [],
): JsonObject | undefined {
  const cloned = cloneBoundedJsonValue(value, redactions);
  return isRecord(cloned) ? cloned as JsonObject : undefined;
}

function cloneBoundedJsonNode(
  value: unknown,
  redactions: readonly string[],
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
      ? redactSecrets(value, redactions)
      : undefined;
  }
  if (typeof value !== 'object' || seen.has(value)) return undefined;
  seen.add(value);
  if (Array.isArray(value)) {
    const descriptors = boundedJsonArrayDescriptors(value);
    if (descriptors === undefined) return undefined;
    const output: JsonValue[] = [];
    for (const descriptor of descriptors) {
      const cloned = cloneBoundedJsonNode(descriptor.value, redactions, depth + 1, budget, seen);
      if (cloned === undefined) return undefined;
      output.push(cloned);
    }
    seen.delete(value);
    return Object.freeze(output) as unknown as JsonValue[];
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return undefined;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Object.getOwnPropertySymbols(value).some((symbol) => Object.prototype.propertyIsEnumerable.call(value, symbol))) {
    return undefined;
  }
  const entries = Object.entries(descriptors).filter(([, descriptor]) => descriptor.enumerable);
  if (entries.length > MAX_JSON_CONTAINER_ITEMS) return undefined;
  const output: Record<string, JsonValue> = {};
  for (const [rawKey, descriptor] of entries) {
    if (!('value' in descriptor) || descriptor.value === undefined) return undefined;
    budget.codeUnits += rawKey.length;
    if (rawKey.length > MAX_JSON_STRING_CODE_UNITS || budget.codeUnits > MAX_JSON_TOTAL_CODE_UNITS) return undefined;
    const key = redactJsonKey(rawKey, redactions);
    if (Object.prototype.hasOwnProperty.call(output, key)) return undefined;
    const cloned = cloneBoundedJsonNode(descriptor.value, redactions, depth + 1, budget, seen);
    if (cloned === undefined) return undefined;
    Object.defineProperty(output, key, {
      value: cloned,
      enumerable: true,
      configurable: false,
      writable: false,
    });
  }
  seen.delete(value);
  return Object.freeze(output);
}

function boundedJsonArrayDescriptors(value: readonly unknown[]): readonly PropertyDescriptor[] | undefined {
  let descriptors: Record<PropertyKey, PropertyDescriptor>;
  let prototype: unknown;
  try {
    prototype = Object.getPrototypeOf(value);
    descriptors = Object.getOwnPropertyDescriptors(value) as unknown as Record<PropertyKey, PropertyDescriptor>;
  } catch (_error) {
    return undefined;
  }
  const lengthDescriptor = descriptors.length;
  if (
    prototype !== Array.prototype
    || !lengthDescriptor
    || !('value' in lengthDescriptor)
    || !Number.isSafeInteger(lengthDescriptor.value)
    || lengthDescriptor.value < 0
    || lengthDescriptor.value > MAX_JSON_CONTAINER_ITEMS
  ) return undefined;
  const length = lengthDescriptor.value as number;
  const indexed = new Map<number, PropertyDescriptor>();
  for (const key of Reflect.ownKeys(descriptors)) {
    if (key === 'length') continue;
    if (typeof key !== 'string' || !/^(?:0|[1-9][0-9]*)$/u.test(key)) return undefined;
    const index = Number(key);
    const descriptor = descriptors[key];
    if (
      !Number.isSafeInteger(index)
      || index < 0
      || index >= length
      || !descriptor
      || !descriptor.enumerable
      || !('value' in descriptor)
    ) return undefined;
    indexed.set(index, descriptor);
  }
  if (indexed.size !== length) return undefined;
  const output: PropertyDescriptor[] = [];
  for (let index = 0; index < length; index += 1) output.push(indexed.get(index)!);
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

function redactSecrets(value: string, redactions: readonly string[]): string {
  let output = value;
  for (const secret of redactions) output = output.split(secret).join('[redacted]');
  return output
    .replace(/authorization\s*:\s*\S+/giu, 'authorization: [redacted]')
    .replace(/bearer\s+[A-Za-z0-9._~+/=-]{8,}/giu, 'bearer [redacted]')
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/giu, '[redacted]')
    .replace(/((?:api[-_ ]?key|access[-_ ]?token|refresh[-_ ]?token|password|secret)\s*[:=])\s*[^\s,;]+/giu, '$1 [redacted]');
}

function redactJsonKey(value: string, redactions: readonly string[]): string {
  const redacted = redactSecrets(value, redactions);
  return /(?:authorization|api[-_ ]?key|access[-_ ]?token|refresh[-_ ]?token|password|secret)/iu.test(redacted)
    ? '[redacted-key]'
    : redacted;
}

function plainDeepEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left)
      && Array.isArray(right)
      && left.length === right.length
      && left.every((child, index) => plainDeepEqual(child, right[index]));
  }
  if (!isRecord(left) || !isRecord(right)) return false;
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key) => Object.prototype.hasOwnProperty.call(right, key) && plainDeepEqual(left[key], right[key]));
}

function safeLoopTimestamp(value: unknown): string {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > 128
    || !Number.isFinite(Date.parse(value))
  ) {
    throw new AgentLoopFailure('RUNTIME_CLOCK_INVALID', 'Runtime clock returned an invalid timestamp.');
  }
  return value;
}

interface CombinedAbortSignal extends AbortSignal {
  readonly cleanup: () => void;
  readonly redactions: readonly string[];
}

function combineAbortSignals(
  external: AbortSignal | undefined,
  controller: AbortSignal,
  redactions: readonly string[],
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
  Object.defineProperty(combined, 'redactions', {
    value: redactions,
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

function closeIteratorDetached<T>(iterator: AsyncIterator<T>): void {
  try {
    const cleanup = iterator.return?.();
    if (cleanup) void Promise.resolve(cleanup).catch(() => undefined);
  } catch (_error) {
    // Provider cleanup cannot replace the already selected safe terminal.
  }
}
