/**
 * Stable, provider-neutral trace schema used to compare the pinned Pi reference
 * runner with the DEF Runtime. This file is DEF-original; event names reflect
 * the observable lifecycle shared by the pinned Pi Agent and the target kernel.
 */
import type { JsonObject, JsonValue } from '../../../core/contracts/json.ts';

export const AGENT_TRACE_SCHEMA_VERSION = 1 as const;

export const AGENT_TRACE_LIMITS = Object.freeze({
  maxEvents: 16_384,
  maxTraceCodeUnits: 8 * 1_024 * 1_024,
  maxStringCodeUnits: 256 * 1_024,
  maxDepth: 16,
  maxArrayItems: 4_096,
  maxObjectKeys: 256,
});

export interface AgentTraceSource {
  readonly kind: 'pi-reference' | 'def-runtime';
  readonly repository: string;
  readonly commit: string;
  readonly version: string;
  readonly generatedBy: string;
}

export interface AgentTraceUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
  readonly reasoningTokens?: number;
  readonly cacheReadTokens?: number;
  readonly cacheWriteTokens?: number;
}

export type AgentTraceStopReason = 'stop' | 'length' | 'tool-use' | 'error' | 'aborted';

export type AgentTraceContextItem =
  | { readonly kind: 'user-text'; readonly messageId: string; readonly text: string }
  | { readonly kind: 'assistant-text'; readonly messageId: string; readonly text: string }
  | { readonly kind: 'assistant-reasoning'; readonly messageId: string; readonly text: string }
  | {
      readonly kind: 'assistant-tool-call';
      readonly messageId: string;
      readonly toolCallId: string;
      readonly name: string;
      readonly arguments: JsonObject;
    }
  | {
      readonly kind: 'tool-result';
      readonly messageId: string;
      readonly toolCallId: string;
      readonly name: string;
      readonly status: 'succeeded' | 'failed';
      readonly output: JsonValue;
    }
  | { readonly kind: 'compaction'; readonly messageId: string; readonly summary: string };

export interface AgentTracePayloadMap {
  readonly 'run.start': Record<string, never>;
  readonly 'turn.start': { readonly contextItemCount: number };
  readonly 'message.user': { readonly text: string; readonly attachmentCount: number };
  readonly 'response.start': { readonly providerId: string; readonly modelId: string };
  readonly 'content.text': { readonly contentIndex: number; readonly text: string };
  readonly 'content.reasoning': {
    readonly contentIndex: number;
    readonly text: string;
    readonly redacted: boolean;
  };
  readonly 'tool.call': {
    readonly contentIndex: number;
    readonly name: string;
    readonly arguments: JsonObject;
  };
  readonly 'tool.result':
    | { readonly status: 'succeeded'; readonly name: string; readonly output: JsonValue }
    | {
        readonly status: 'failed';
        readonly name: string;
        readonly code: string;
        readonly message: string;
        readonly details?: JsonValue;
      };
  readonly 'message.assistant': {
    readonly stopReason: AgentTraceStopReason;
    readonly usage: AgentTraceUsage;
    readonly contentOrder: readonly ('text' | 'reasoning' | 'tool-call')[];
  };
  readonly compaction:
    | { readonly status: 'not-needed'; readonly reason: 'manual' | 'threshold' | 'overflow' }
    | {
        readonly status: 'completed';
        readonly reason: 'manual' | 'threshold' | 'overflow';
        readonly summary: string;
        readonly firstKeptItemIndex: number;
        readonly tokensBefore: number;
      }
    | {
        readonly status: 'failed';
        readonly reason: 'manual' | 'threshold' | 'overflow';
        readonly code: string;
        readonly message: string;
      };
  readonly retry: {
    readonly attempt: number;
    readonly delayMs: number;
    readonly code: string;
    readonly outcome: 'scheduled' | 'resumed' | 'failed' | 'aborted';
  };
  readonly 'context.snapshot': {
    readonly systemPrompt: string;
    readonly toolNames: readonly string[];
    readonly items: readonly AgentTraceContextItem[];
  };
  readonly 'turn.end': {
    readonly stopReason: AgentTraceStopReason;
    readonly toolResultCount: number;
  };
  readonly 'run.end':
    | { readonly status: 'completed' }
    | { readonly status: 'failed'; readonly code: string; readonly message: string }
    | { readonly status: 'aborted'; readonly code: string; readonly message?: string };
}

export type AgentTraceEventType = keyof AgentTracePayloadMap;

export const AGENT_TRACE_EVENT_TYPES = [
  'run.start',
  'turn.start',
  'message.user',
  'response.start',
  'content.text',
  'content.reasoning',
  'tool.call',
  'tool.result',
  'message.assistant',
  'compaction',
  'retry',
  'context.snapshot',
  'turn.end',
  'run.end',
] as const satisfies readonly AgentTraceEventType[];

interface AgentTraceEventBase<Type extends AgentTraceEventType> {
  readonly ordinal: number;
  readonly type: Type;
  readonly runId?: string;
  readonly turnId?: string;
  readonly messageId?: string;
  readonly toolCallId?: string;
  readonly data: AgentTracePayloadMap[Type];
}

export type AgentTraceEvent = {
  [Type in AgentTraceEventType]: AgentTraceEventBase<Type>;
}[AgentTraceEventType];

export interface AgentTrace {
  readonly schemaVersion: typeof AGENT_TRACE_SCHEMA_VERSION;
  readonly scenario: string;
  readonly source: AgentTraceSource;
  readonly events: readonly AgentTraceEvent[];
}

const EVENT_TYPES = new Set<AgentTraceEventType>(AGENT_TRACE_EVENT_TYPES);

const SECRET_TEXT_PATTERNS = [
  /authorization\s*:\s*\S+/iu,
  /\bbearer\s+[A-Za-z0-9._~+/=-]{8,}/iu,
  /\bsk-[A-Za-z0-9_-]{8,}\b/iu,
  /\b(?:api[-_ ]?key|access[-_ ]?token|refresh[-_ ]?token|password|secret)\s*[:=]\s*[^\s,;]{4,}/iu,
];

export function parseAgentTrace(value: unknown): AgentTrace {
  const trace = expectRecord(value, 'trace');
  expectExactKeys(trace, ['events', 'scenario', 'schemaVersion', 'source'], 'trace');
  if (trace.schemaVersion !== AGENT_TRACE_SCHEMA_VERSION) {
    throw new TypeError(`trace.schemaVersion must be ${AGENT_TRACE_SCHEMA_VERSION}`);
  }
  expectTraceString(trace.scenario, 'trace.scenario', 256);
  const source = parseSource(trace.source);
  if (!Array.isArray(trace.events) || trace.events.length > AGENT_TRACE_LIMITS.maxEvents) {
    throw new TypeError(`trace.events must be an array with at most ${AGENT_TRACE_LIMITS.maxEvents} items`);
  }
  const events = trace.events.map((event, index) => parseEvent(event, index));
  validateLifecycle(events);
  const serialized = JSON.stringify(value);
  if (serialized.length > AGENT_TRACE_LIMITS.maxTraceCodeUnits) {
    throw new TypeError('trace exceeds the maximum serialized size');
  }
  return {
    schemaVersion: AGENT_TRACE_SCHEMA_VERSION,
    scenario: trace.scenario as string,
    source,
    events,
  };
}

function parseSource(value: unknown): AgentTraceSource {
  const source = expectRecord(value, 'trace.source');
  expectExactKeys(source, ['commit', 'generatedBy', 'kind', 'repository', 'version'], 'trace.source');
  if (source.kind !== 'pi-reference' && source.kind !== 'def-runtime') {
    throw new TypeError('trace.source.kind is invalid');
  }
  expectBoundedString(source.repository, 'trace.source.repository', 1_024);
  if (typeof source.commit !== 'string' || !/^[0-9a-f]{40}$/u.test(source.commit)) {
    throw new TypeError('trace.source.commit must be a full lowercase Git commit');
  }
  expectBoundedString(source.version, 'trace.source.version', 128);
  expectBoundedString(source.generatedBy, 'trace.source.generatedBy', 256);
  return {
    kind: source.kind,
    repository: source.repository as string,
    commit: source.commit,
    version: source.version as string,
    generatedBy: source.generatedBy as string,
  };
}

function parseEvent(value: unknown, index: number): AgentTraceEvent {
  const label = `trace.events[${index}]`;
  const event = expectRecord(value, label);
  expectAllowedKeys(
    event,
    ['data', 'messageId', 'ordinal', 'runId', 'toolCallId', 'turnId', 'type'],
    label,
  );
  if (event.ordinal !== index + 1) {
    throw new TypeError(`${label}.ordinal must be ${index + 1}`);
  }
  if (typeof event.type !== 'string' || !EVENT_TYPES.has(event.type as AgentTraceEventType)) {
    throw new TypeError(`${label}.type is invalid`);
  }
  for (const key of ['runId', 'turnId', 'messageId', 'toolCallId'] as const) {
    if (event[key] !== undefined) expectTraceString(event[key], `${label}.${key}`, 256);
  }
  requireCorrelations(event.type as AgentTraceEventType, event, label);
  const data = parsePayload(event.type as AgentTraceEventType, event.data, `${label}.data`);
  return {
    ordinal: event.ordinal,
    type: event.type,
    ...(event.runId === undefined ? {} : { runId: event.runId }),
    ...(event.turnId === undefined ? {} : { turnId: event.turnId }),
    ...(event.messageId === undefined ? {} : { messageId: event.messageId }),
    ...(event.toolCallId === undefined ? {} : { toolCallId: event.toolCallId }),
    data,
  } as AgentTraceEvent;
}

function requireCorrelations(
  type: AgentTraceEventType,
  event: Record<string, unknown>,
  label: string,
): void {
  if (event.runId === undefined) {
    throw new TypeError(`${label}.runId is required for ${type}`);
  }
  if (
    type !== 'run.start'
    && type !== 'run.end'
    && type !== 'compaction'
    && event.turnId === undefined
  ) {
    throw new TypeError(`${label}.turnId is required for ${type}`);
  }
  if (
    [
      'message.user',
      'response.start',
      'content.text',
      'content.reasoning',
      'message.assistant',
      'tool.call',
      'tool.result',
    ].includes(type)
    && event.messageId === undefined
  ) {
    throw new TypeError(`${label}.messageId is required for ${type}`);
  }
  if ((type === 'tool.call' || type === 'tool.result') && event.toolCallId === undefined) {
    throw new TypeError(`${label}.toolCallId is required for ${type}`);
  }
}

function parsePayload(type: AgentTraceEventType, value: unknown, label: string): AgentTracePayloadMap[AgentTraceEventType] {
  const data = expectRecord(value, label);
  switch (type) {
    case 'run.start':
      expectExactKeys(data, [], label);
      return data as unknown as AgentTracePayloadMap['run.start'];
    case 'turn.start':
      expectExactKeys(data, ['contextItemCount'], label);
      expectCount(data.contextItemCount, `${label}.contextItemCount`);
      return data as unknown as AgentTracePayloadMap['turn.start'];
    case 'message.user':
      expectExactKeys(data, ['attachmentCount', 'text'], label);
      expectTraceString(data.text, `${label}.text`, AGENT_TRACE_LIMITS.maxStringCodeUnits, true);
      expectCount(data.attachmentCount, `${label}.attachmentCount`);
      return data as unknown as AgentTracePayloadMap['message.user'];
    case 'response.start':
      expectExactKeys(data, ['modelId', 'providerId'], label);
      expectTraceString(data.providerId, `${label}.providerId`, 256);
      expectTraceString(data.modelId, `${label}.modelId`, 512);
      return data as unknown as AgentTracePayloadMap['response.start'];
    case 'content.text':
      expectExactKeys(data, ['contentIndex', 'text'], label);
      expectCount(data.contentIndex, `${label}.contentIndex`);
      expectTraceString(data.text, `${label}.text`, AGENT_TRACE_LIMITS.maxStringCodeUnits, true);
      return data as unknown as AgentTracePayloadMap['content.text'];
    case 'content.reasoning':
      expectExactKeys(data, ['contentIndex', 'redacted', 'text'], label);
      expectCount(data.contentIndex, `${label}.contentIndex`);
      expectTraceString(data.text, `${label}.text`, AGENT_TRACE_LIMITS.maxStringCodeUnits, true);
      if (typeof data.redacted !== 'boolean') throw new TypeError(`${label}.redacted must be boolean`);
      return data as unknown as AgentTracePayloadMap['content.reasoning'];
    case 'tool.call':
      expectExactKeys(data, ['arguments', 'contentIndex', 'name'], label);
      expectCount(data.contentIndex, `${label}.contentIndex`);
      expectTraceString(data.name, `${label}.name`, 256);
      validateJson(expectRecord(data.arguments, `${label}.arguments`), `${label}.arguments`, 0);
      return data as unknown as AgentTracePayloadMap['tool.call'];
    case 'tool.result':
      return parseToolResult(data, label);
    case 'message.assistant':
      expectExactKeys(data, ['contentOrder', 'stopReason', 'usage'], label);
      expectStopReason(data.stopReason, `${label}.stopReason`);
      parseUsage(data.usage, `${label}.usage`);
      if (!Array.isArray(data.contentOrder)) throw new TypeError(`${label}.contentOrder must be an array`);
      for (const [index, item] of data.contentOrder.entries()) {
        if (item !== 'text' && item !== 'reasoning' && item !== 'tool-call') {
          throw new TypeError(`${label}.contentOrder[${index}] is invalid`);
        }
      }
      return data as unknown as AgentTracePayloadMap['message.assistant'];
    case 'compaction':
      return parseCompaction(data, label);
    case 'retry':
      expectExactKeys(data, ['attempt', 'code', 'delayMs', 'outcome'], label);
      expectPositiveInteger(data.attempt, `${label}.attempt`);
      expectCount(data.delayMs, `${label}.delayMs`);
      expectTraceString(data.code, `${label}.code`, 256);
      if (!['scheduled', 'resumed', 'failed', 'aborted'].includes(String(data.outcome))) {
        throw new TypeError(`${label}.outcome is invalid`);
      }
      return data as unknown as AgentTracePayloadMap['retry'];
    case 'context.snapshot':
      return parseContextSnapshot(data, label);
    case 'turn.end':
      expectExactKeys(data, ['stopReason', 'toolResultCount'], label);
      expectStopReason(data.stopReason, `${label}.stopReason`);
      expectCount(data.toolResultCount, `${label}.toolResultCount`);
      return data as unknown as AgentTracePayloadMap['turn.end'];
    case 'run.end':
      return parseRunTerminal(data, label);
  }
}

function parseToolResult(
  data: Record<string, unknown>,
  label: string,
): AgentTracePayloadMap['tool.result'] {
  expectTraceString(data.name, `${label}.name`, 256);
  if (data.status === 'succeeded') {
    expectExactKeys(data, ['name', 'output', 'status'], label);
    validateJson(data.output, `${label}.output`, 0);
    return data as unknown as Extract<AgentTracePayloadMap['tool.result'], { status: 'succeeded' }>;
  }
  if (data.status === 'failed') {
    expectAllowedKeys(data, ['code', 'details', 'message', 'name', 'status'], label);
    for (const required of ['code', 'message', 'name', 'status']) {
      if (!(required in data)) throw new TypeError(`${label}.${required} is required`);
    }
    expectTraceString(data.code, `${label}.code`, 256);
    expectTraceString(data.message, `${label}.message`, AGENT_TRACE_LIMITS.maxStringCodeUnits);
    if (data.details !== undefined) validateJson(data.details, `${label}.details`, 0);
    return data as unknown as Extract<AgentTracePayloadMap['tool.result'], { status: 'failed' }>;
  }
  throw new TypeError(`${label}.status is invalid`);
}

function parseCompaction(
  data: Record<string, unknown>,
  label: string,
): AgentTracePayloadMap['compaction'] {
  expectCompactionReason(data.reason, `${label}.reason`);
  if (data.status === 'not-needed') {
    expectExactKeys(data, ['reason', 'status'], label);
  } else if (data.status === 'completed') {
    expectExactKeys(data, ['firstKeptItemIndex', 'reason', 'status', 'summary', 'tokensBefore'], label);
    expectTraceString(data.summary, `${label}.summary`, AGENT_TRACE_LIMITS.maxStringCodeUnits);
    expectCount(data.firstKeptItemIndex, `${label}.firstKeptItemIndex`);
    expectCount(data.tokensBefore, `${label}.tokensBefore`);
  } else if (data.status === 'failed') {
    expectExactKeys(data, ['code', 'message', 'reason', 'status'], label);
    expectTraceString(data.code, `${label}.code`, 256);
    expectTraceString(data.message, `${label}.message`, AGENT_TRACE_LIMITS.maxStringCodeUnits);
  } else {
    throw new TypeError(`${label}.status is invalid`);
  }
  return data as unknown as AgentTracePayloadMap['compaction'];
}

function parseContextSnapshot(
  data: Record<string, unknown>,
  label: string,
): AgentTracePayloadMap['context.snapshot'] {
  expectExactKeys(data, ['items', 'systemPrompt', 'toolNames'], label);
  expectTraceString(data.systemPrompt, `${label}.systemPrompt`, AGENT_TRACE_LIMITS.maxStringCodeUnits, true);
  if (!Array.isArray(data.toolNames) || data.toolNames.length > AGENT_TRACE_LIMITS.maxArrayItems) {
    throw new TypeError(`${label}.toolNames is invalid`);
  }
  data.toolNames.forEach((name, index) => expectTraceString(name, `${label}.toolNames[${index}]`, 256));
  if (!Array.isArray(data.items) || data.items.length > AGENT_TRACE_LIMITS.maxArrayItems) {
    throw new TypeError(`${label}.items is invalid`);
  }
  data.items.forEach((item, index) => parseContextItem(item, `${label}.items[${index}]`));
  return data as unknown as AgentTracePayloadMap['context.snapshot'];
}

function parseContextItem(value: unknown, label: string): AgentTraceContextItem {
  const item = expectRecord(value, label);
  expectTraceString(item.messageId, `${label}.messageId`, 256);
  switch (item.kind) {
    case 'user-text':
    case 'assistant-text':
    case 'assistant-reasoning':
      expectExactKeys(item, ['kind', 'messageId', 'text'], label);
      expectTraceString(item.text, `${label}.text`, AGENT_TRACE_LIMITS.maxStringCodeUnits, true);
      break;
    case 'assistant-tool-call':
      expectExactKeys(item, ['arguments', 'kind', 'messageId', 'name', 'toolCallId'], label);
      expectTraceString(item.toolCallId, `${label}.toolCallId`, 256);
      expectTraceString(item.name, `${label}.name`, 256);
      validateJson(expectRecord(item.arguments, `${label}.arguments`), `${label}.arguments`, 0);
      break;
    case 'tool-result':
      expectExactKeys(item, ['kind', 'messageId', 'name', 'output', 'status', 'toolCallId'], label);
      expectTraceString(item.toolCallId, `${label}.toolCallId`, 256);
      expectTraceString(item.name, `${label}.name`, 256);
      if (item.status !== 'succeeded' && item.status !== 'failed') {
        throw new TypeError(`${label}.status is invalid`);
      }
      validateJson(item.output, `${label}.output`, 0);
      break;
    case 'compaction':
      expectExactKeys(item, ['kind', 'messageId', 'summary'], label);
      expectTraceString(item.summary, `${label}.summary`, AGENT_TRACE_LIMITS.maxStringCodeUnits);
      break;
    default:
      throw new TypeError(`${label}.kind is invalid`);
  }
  return item as unknown as AgentTraceContextItem;
}

function parseUsage(value: unknown, label: string): AgentTraceUsage {
  const usage = expectRecord(value, label);
  expectAllowedKeys(
    usage,
    ['cacheReadTokens', 'cacheWriteTokens', 'inputTokens', 'outputTokens', 'reasoningTokens', 'totalTokens'],
    label,
  );
  for (const required of ['inputTokens', 'outputTokens', 'totalTokens']) {
    if (!(required in usage)) throw new TypeError(`${label}.${required} is required`);
  }
  for (const key of Object.keys(usage)) expectCount(usage[key], `${label}.${key}`);
  if (Number(usage.totalTokens) < Number(usage.outputTokens)) {
    throw new TypeError(`${label}.totalTokens cannot be smaller than outputTokens`);
  }
  return usage as unknown as AgentTraceUsage;
}

function parseRunTerminal(
  data: Record<string, unknown>,
  label: string,
): AgentTracePayloadMap['run.end'] {
  if (data.status === 'completed') {
    expectExactKeys(data, ['status'], label);
  } else if (data.status === 'failed') {
    expectExactKeys(data, ['code', 'message', 'status'], label);
    expectTraceString(data.code, `${label}.code`, 256);
    expectTraceString(data.message, `${label}.message`, AGENT_TRACE_LIMITS.maxStringCodeUnits);
  } else if (data.status === 'aborted') {
    expectAllowedKeys(data, ['code', 'message', 'status'], label);
    if (!('code' in data) || !('status' in data)) throw new TypeError(`${label}.code is required`);
    expectTraceString(data.code, `${label}.code`, 256);
    if (data.message !== undefined) {
      expectTraceString(data.message, `${label}.message`, AGENT_TRACE_LIMITS.maxStringCodeUnits);
    }
  } else {
    throw new TypeError(`${label}.status is invalid`);
  }
  return data as unknown as AgentTracePayloadMap['run.end'];
}

function validateLifecycle(events: readonly AgentTraceEvent[]): void {
  if (events.length < 2 || events[0]?.type !== 'run.start' || events.at(-1)?.type !== 'run.end') {
    throw new TypeError('trace must start with run.start and end with run.end');
  }
  if (events.filter((event) => event.type === 'run.start').length !== 1) {
    throw new TypeError('trace must contain exactly one run.start');
  }
  if (events.filter((event) => event.type === 'run.end').length !== 1) {
    throw new TypeError('trace must contain exactly one run.end');
  }
  for (const requiredType of ['turn.start', 'message.user', 'context.snapshot', 'message.assistant', 'turn.end'] as const) {
    if (!events.some((event) => event.type === requiredType)) {
      throw new TypeError(`trace is missing required ${requiredType}`);
    }
  }
  const runId = events[0]!.runId!;
  for (const event of events) {
    if (event.runId !== runId) throw new TypeError(`trace event ${event.ordinal} changed runId`);
  }

  const knownToolCallIds = new Set<string>();
  const unresolvedToolCallIds = new Set<string>();
  let activeTurnId: string | null = null;
  let activeContextSnapshots = 0;
  let activeResponseStarts = 0;
  let activeAssistantMessageId: string | null = null;
  let activeAssistantStopReason: AgentTraceStopReason | null = null;
  let activeContentOrder: Array<'text' | 'reasoning' | 'tool-call'> = [];
  let activeToolCalls = new Map<string, {
    readonly assistantMessageId: string;
    readonly contentIndex: number;
    readonly name: string;
    settled: boolean;
  }>();
  let activeToolResultCount = 0;
  let lastTurnStopReason: AgentTraceStopReason | null = null;
  let lastTurnToolCallCount = 0;
  for (const event of events) {
    if (event.type === 'turn.start') {
      if (activeTurnId !== null) throw new TypeError(`turn.start overlaps active turn: ${activeTurnId}`);
      activeTurnId = event.turnId!;
      activeContextSnapshots = 0;
      activeResponseStarts = 0;
      activeAssistantMessageId = null;
      activeAssistantStopReason = null;
      activeContentOrder = [];
      activeToolCalls = new Map();
      activeToolResultCount = 0;
      continue;
    }
    if (event.type === 'turn.end') {
      if (activeTurnId === null || event.turnId !== activeTurnId) {
        throw new TypeError(`turn.end does not match active turn: ${event.turnId}`);
      }
      if (activeContextSnapshots !== 1) {
        throw new TypeError(`turn ${activeTurnId} must contain exactly one context.snapshot`);
      }
      if (activeAssistantStopReason === null) {
        throw new TypeError(`turn ${activeTurnId} is missing message.assistant`);
      }
      if (event.data.stopReason !== activeAssistantStopReason) {
        throw new TypeError(`turn ${activeTurnId} stopReason does not match assistant terminal`);
      }
      if (event.data.toolResultCount !== activeToolResultCount) {
        throw new TypeError(`turn ${activeTurnId} toolResultCount is invalid`);
      }
      lastTurnStopReason = activeAssistantStopReason;
      lastTurnToolCallCount = activeToolCalls.size;
      activeTurnId = null;
      continue;
    }
    if (event.type !== 'run.start' && event.type !== 'run.end' && event.type !== 'compaction') {
      if (activeTurnId === null || event.turnId !== activeTurnId) {
        throw new TypeError(`${event.type} is outside its active turn`);
      }
    }
    if (event.type === 'compaction' && event.turnId !== undefined && event.turnId !== activeTurnId) {
      throw new TypeError('compaction turnId does not match the active turn');
    }
    if (event.type === 'message.user' && (activeContextSnapshots > 0 || activeResponseStarts > 0)) {
      throw new TypeError('message.user appears after the turn context was frozen');
    }
    if (event.type === 'context.snapshot') {
      if (activeResponseStarts > 0 || activeAssistantStopReason !== null) {
        throw new TypeError('context.snapshot appears after the provider response started');
      }
      activeContextSnapshots += 1;
    }
    if (event.type === 'response.start') {
      if (activeAssistantStopReason !== null) throw new TypeError('response.start appears after assistant terminal');
      if (activeContextSnapshots !== 1) {
        throw new TypeError('response.start requires exactly one preceding context.snapshot');
      }
      activeResponseStarts += 1;
      if (activeResponseStarts !== 1) throw new TypeError(`turn ${activeTurnId} contains multiple response.start events`);
      activeAssistantMessageId = event.messageId!;
    }
    if (event.type === 'content.text' || event.type === 'content.reasoning' || event.type === 'tool.call') {
      if (activeAssistantStopReason !== null) throw new TypeError(`${event.type} appears after assistant terminal`);
      if (activeResponseStarts !== 1 || activeAssistantMessageId === null) {
        throw new TypeError(`${event.type} appears before response.start`);
      }
      if (event.messageId !== activeAssistantMessageId) {
        throw new TypeError(`${event.type} changed assistant messageId`);
      }
      if (event.data.contentIndex !== activeContentOrder.length) {
        throw new TypeError(`${event.type} contentIndex is not contiguous`);
      }
      activeContentOrder.push(
        event.type === 'content.text'
          ? 'text'
          : event.type === 'content.reasoning'
            ? 'reasoning'
            : 'tool-call',
      );
    }
    if (event.type === 'message.assistant') {
      if (activeAssistantStopReason !== null) {
        throw new TypeError(`turn ${activeTurnId} contains multiple assistant terminals`);
      }
      if (activeResponseStarts === 0) {
        if (event.data.stopReason !== 'error' && event.data.stopReason !== 'aborted') {
          throw new TypeError('successful assistant terminal is missing response.start');
        }
      } else if (event.messageId !== activeAssistantMessageId) {
        throw new TypeError('assistant terminal changed messageId');
      }
      if (
        event.data.contentOrder.length !== activeContentOrder.length
        || event.data.contentOrder.some((item, index) => item !== activeContentOrder[index])
      ) {
        throw new TypeError('assistant contentOrder does not match emitted content');
      }
      if (event.data.stopReason === 'tool-use' && activeToolCalls.size === 0) {
        throw new TypeError('assistant stopped for tool-use without a tool.call');
      }
      if (
        activeToolCalls.size > 0
        && event.data.stopReason !== 'tool-use'
        && event.data.stopReason !== 'length'
      ) {
        throw new TypeError('assistant emitted tool.call with an incompatible stopReason');
      }
      activeAssistantStopReason = event.data.stopReason;
    }
    if (event.type === 'tool.call') {
      if (knownToolCallIds.has(event.toolCallId!)) throw new TypeError(`duplicate tool.call: ${event.toolCallId}`);
      knownToolCallIds.add(event.toolCallId!);
      unresolvedToolCallIds.add(event.toolCallId!);
      activeToolCalls.set(event.toolCallId!, {
        assistantMessageId: event.messageId!,
        contentIndex: event.data.contentIndex,
        name: event.data.name,
        settled: false,
      });
    }
    if (event.type === 'tool.result') {
      if (activeAssistantStopReason === null) {
        throw new TypeError(`tool.result appears before assistant terminal: ${event.toolCallId}`);
      }
      const call = activeToolCalls.get(event.toolCallId!);
      if (!call) throw new TypeError(`tool.result has no tool.call in the active turn: ${event.toolCallId}`);
      if (call.settled) throw new TypeError(`duplicate tool.result: ${event.toolCallId}`);
      if (event.data.name !== call.name) throw new TypeError(`tool.result name does not match tool.call: ${event.toolCallId}`);
      call.settled = true;
      unresolvedToolCallIds.delete(event.toolCallId!);
      activeToolResultCount += 1;
    }
  }
  if (activeTurnId !== null) throw new TypeError(`trace ended with active turn: ${activeTurnId}`);
  const terminal = events.at(-1)!;
  const aborted = terminal.type === 'run.end' && terminal.data.status === 'aborted';
  if (!aborted) {
    const [missingToolResult] = unresolvedToolCallIds;
    if (missingToolResult) throw new TypeError(`tool.call is missing tool.result: ${missingToolResult}`);
  }
  if (
    terminal.type === 'run.end'
    && terminal.data.status === 'completed'
    && (lastTurnStopReason === 'error' || lastTurnStopReason === 'aborted' || lastTurnToolCallCount > 0)
  ) {
    throw new TypeError('completed run ended before the Agent loop reached a final assistant response');
  }
}

function validateJson(value: unknown, label: string, depth: number): void {
  if (depth > AGENT_TRACE_LIMITS.maxDepth) throw new TypeError(`${label} exceeds maximum depth`);
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError(`${label} contains a non-finite number`);
    return;
  }
  if (typeof value === 'string') {
    expectTraceString(value, label, AGENT_TRACE_LIMITS.maxStringCodeUnits, true);
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > AGENT_TRACE_LIMITS.maxArrayItems) {
      throw new TypeError(`${label} exceeds maximum array length`);
    }
    value.forEach((item, index) => validateJson(item, `${label}[${index}]`, depth + 1));
    return;
  }
  if (!isRecord(value)) throw new TypeError(`${label} is not JSON-compatible`);
  const keys = Object.keys(value);
  if (keys.length > AGENT_TRACE_LIMITS.maxObjectKeys) {
    throw new TypeError(`${label} exceeds maximum object keys`);
  }
  for (const key of keys) {
    if (isSecretFieldName(key)) throw new TypeError(`${label}.${key} is a forbidden secret field`);
    validateJson(value[key], `${label}.${key}`, depth + 1);
  }
}

function isSecretFieldName(value: string): boolean {
  const normalized = value.toLowerCase().replace(/[^a-z0-9]/gu, '');
  return normalized === 'headers'
    || normalized.endsWith('headers')
    || /(?:apikey|authorization|credential|password|secret|accesstoken|refreshtoken|bearertoken|cookie)/u.test(normalized);
}

function expectRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new TypeError(`${label} must be an object`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function expectAllowedKeys(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedSet.has(key)) throw new TypeError(`${label}.${key} is not supported`);
  }
}

function expectExactKeys(value: Record<string, unknown>, expected: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  if (actual.length !== sortedExpected.length || actual.some((key, index) => key !== sortedExpected[index])) {
    throw new TypeError(`${label} fields are invalid`);
  }
}

function expectTraceString(
  value: unknown,
  label: string,
  maxCodeUnits: number,
  allowEmpty = false,
): asserts value is string {
  expectBoundedString(value, label, maxCodeUnits, allowEmpty);
  for (const pattern of SECRET_TEXT_PATTERNS) {
    if (pattern.test(value)) throw new TypeError(`${label} contains secret-shaped text`);
  }
}

function expectBoundedString(
  value: unknown,
  label: string,
  maxCodeUnits: number,
  allowEmpty = false,
): asserts value is string {
  if (typeof value !== 'string' || (!allowEmpty && !value) || value.length > maxCodeUnits) {
    throw new TypeError(`${label} must be ${allowEmpty ? 'a' : 'a non-empty'} bounded string`);
  }
}

function expectCount(value: unknown, label: string): asserts value is number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new TypeError(`${label} must be a non-negative safe integer`);
  }
}

function expectPositiveInteger(value: unknown, label: string): asserts value is number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) {
    throw new TypeError(`${label} must be a positive safe integer`);
  }
}

function expectStopReason(value: unknown, label: string): asserts value is AgentTraceStopReason {
  if (!['stop', 'length', 'tool-use', 'error', 'aborted'].includes(String(value))) {
    throw new TypeError(`${label} is invalid`);
  }
}

function expectCompactionReason(
  value: unknown,
  label: string,
): asserts value is 'manual' | 'threshold' | 'overflow' {
  if (value !== 'manual' && value !== 'threshold' && value !== 'overflow') {
    throw new TypeError(`${label} is invalid`);
  }
}
