/**
 * Runtime Session JSON validator.
 *
 * The validator is deliberately independent from the file reader. It accepts
 * only the frozen F0 entry union, checks the append-only tree and lifecycle
 * invariants, and never performs a product-side replay or mutation.
 */
import type {
  ClientTurnId,
  DefTurnId,
  ToolCallId,
} from '../../../core/contracts/ids.ts';
import type { JsonObject } from '../../../core/contracts/json.ts';
import type {
  RuntimeAssistantContent,
  RuntimeAssistantMessage,
  RuntimeFileBlock,
  RuntimeMessage,
  RuntimeProviderDiagnostic,
  RuntimeTextBlock,
  RuntimeThinkingBlock,
  RuntimeToolCallBlock,
  RuntimeToolResultMessage,
  RuntimeToolResultPayload,
  RuntimeTurnMessage,
  RuntimeUsage,
  RuntimeUserContent,
  RuntimeUserMessage,
} from '../messages.ts';
import type {
  RuntimeContentId,
  RuntimeEntryId,
  RuntimeRunId,
  RuntimeTurnId,
} from '../ids.ts';
import {
  RUNTIME_SESSION_LIMITS,
  RUNTIME_SESSION_SCHEMA_VERSION,
  type RuntimeCompactionEntry,
  type RuntimeMessageEntry,
  type RuntimeModelChangeEntry,
  type RuntimeRunMarkerEntry,
  type RuntimeSessionEntry,
  type RuntimeSessionHeader,
  type RuntimeSessionRecord,
  type RuntimeThinkingChangeEntry,
  type RuntimeRunMarkerTerminal,
} from './entries.ts';

export type SessionLogErrorCode =
  | 'SESSION_APPEND_CONFLICT'
  | 'SESSION_EXISTS'
  | 'SESSION_INCOMPATIBLE'
  | 'SESSION_IO_ERROR'
  | 'SESSION_NOT_FOUND'
  | 'SESSION_PATH_INVALID'
  | 'SESSION_STALE';

/** Error type shared by the reader, validator and append-only log. */
export class SessionLogError extends Error {
  readonly code: SessionLogErrorCode;
  readonly recordIndex: number | undefined;

  constructor(code: SessionLogErrorCode, message: string, recordIndex?: number) {
    super(message);
    this.name = 'SessionLogError';
    this.code = code;
    this.recordIndex = recordIndex;
  }
}

export class SessionValidationError extends SessionLogError {
  constructor(message: string, recordIndex?: number) {
    super('SESSION_INCOMPATIBLE', message, recordIndex);
    this.name = 'SessionValidationError';
  }
}

export interface InterruptedRuntimeRun {
  readonly status: 'interrupted';
  readonly runId: RuntimeRunId;
  readonly defTurnId: DefTurnId;
  readonly turnId: RuntimeTurnId;
  readonly startEntryId: RuntimeEntryId;
  readonly endEntryId: RuntimeEntryId | null;
  readonly unresolvedToolCallIds: readonly ToolCallId[];
}

export interface RuntimeRunState {
  readonly runId: RuntimeRunId;
  readonly defTurnId: DefTurnId;
  readonly turnId: RuntimeTurnId;
  readonly startEntryId: RuntimeEntryId;
  readonly endEntryId: RuntimeEntryId | null;
  readonly status: RuntimeRunMarkerTerminal['status'] | 'active';
  readonly unresolvedToolCallIds: readonly ToolCallId[];
}

export interface ValidatedSession {
  readonly header: RuntimeSessionHeader;
  readonly entries: readonly RuntimeSessionEntry[];
  readonly records: readonly RuntimeSessionRecord[];
  /** Derived from the last valid entry; the header is never rewritten. */
  readonly updatedAt: string;
  /** The append cursor is the last valid entry in file order. */
  readonly leafId: RuntimeEntryId | null;
  readonly runs: readonly RuntimeRunState[];
  /** Unclosed runs are reported as interrupted after a crash/restart. */
  readonly interruptedRuns: readonly InterruptedRuntimeRun[];
}

const MAX_STRING_CODE_UNITS = RUNTIME_SESSION_LIMITS.maxLineCodeUnits;
const MAX_JSON_DEPTH = 16;
const MAX_JSON_ARRAY_ITEMS = 4_096;
const MAX_JSON_OBJECT_KEYS = 256;

const SECRET_TEXT_PATTERNS: readonly RegExp[] = [
  /authorization\s*:\s*\S+/iu,
  /\bbearer\s+[A-Za-z0-9._~+/=-]{8,}/iu,
  /\b(?:api[-_ ]?key|access[-_ ]?token|refresh[-_ ]?token|client[-_ ]?secret|password|secret)\s*[:=]\s*[^\s,;]{4,}/iu,
  /\b(?:sk|rk|pk|ghp|gho|ghs|ghr|xox[baprs]|pplx)-[A-Za-z0-9._~-]{8,}\b/iu,
  /\bAIza[A-Za-z0-9_-]{20,}\b/u,
];

const SECRET_FIELD_PATTERN = /(?:apikey|authorization|credential|password|secret|accesstoken|refreshtoken|bearertoken|privatekey|clientsecret|cookie)/u;

const MESSAGE_STOP_REASONS = new Set<RuntimeAssistantMessage['stopReason']>([
  'stop',
  'length',
  'tool-use',
  'error',
  'aborted',
]);

const THINKING_LEVELS = new Set<RuntimeThinkingChangeEntry['level']>([
  'off',
  'low',
  'medium',
  'high',
]);

const COMPACTION_REASONS = new Set<RuntimeCompactionEntry['reason']>([
  'manual',
  'threshold',
  'overflow',
]);

const TERMINAL_STATUSES = new Set<RuntimeRunMarkerTerminal['status']>([
  'completed',
  'failed',
  'aborted',
  'interrupted',
]);

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function invalid(label: string, reason?: string, recordIndex?: number): never {
  throw new SessionValidationError(
    `${label} is invalid${reason ? `: ${reason}` : ''}`,
    recordIndex,
  );
}

function expectRecord(value: unknown, label: string, recordIndex?: number): Record<string, unknown> {
  if (!isRecord(value)) invalid(label, 'expected an object', recordIndex);
  return value;
}

function expectExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  label: string,
  recordIndex?: number,
): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    invalid(label, 'unsupported or missing fields', recordIndex);
  }
}

function expectKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
  label: string,
  recordIndex?: number,
): void {
  const allowed = new Set([...required, ...optional]);
  if (Object.keys(value).some((key) => !allowed.has(key))) {
    invalid(label, 'unsupported fields', recordIndex);
  }
  if (required.some((key) => !hasOwn(value, key))) {
    invalid(label, 'missing fields', recordIndex);
  }
}

function expectBoundedString(
  value: unknown,
  label: string,
  maxCodeUnits = MAX_STRING_CODE_UNITS,
  allowEmpty = false,
  recordIndex?: number,
): asserts value is string {
  if (
    typeof value !== 'string'
    || (!allowEmpty && value.length === 0)
    || value.length > maxCodeUnits
    || value.trim() !== value
  ) {
    invalid(label, 'expected a bounded string', recordIndex);
  }
}

function expectIdentifier(value: unknown, label: string, recordIndex?: number): asserts value is string {
  expectBoundedString(value, label, 256, false, recordIndex);
}

function expectDateText(value: unknown, label: string, recordIndex?: number): asserts value is string {
  expectBoundedString(value, label, 128, false, recordIndex);
  if (Number.isNaN(Date.parse(value))) invalid(label, 'expected a date', recordIndex);
}

function isSecretFieldName(value: string): boolean {
  const normalized = value.toLowerCase().replace(/[^a-z0-9]/gu, '');
  return normalized === 'headers'
    || normalized.endsWith('headers')
    || SECRET_FIELD_PATTERN.test(normalized);
}

function expectSafeString(value: unknown, label: string, recordIndex?: number): asserts value is string {
  expectBoundedString(value, label, MAX_STRING_CODE_UNITS, false, recordIndex);
  for (const pattern of SECRET_TEXT_PATTERNS) {
    if (pattern.test(value)) invalid(label, 'secret-shaped content is not allowed', recordIndex);
  }
}

function expectSafeText(value: unknown, label: string, recordIndex?: number): asserts value is string {
  expectBoundedString(value, label, MAX_STRING_CODE_UNITS, true, recordIndex);
  for (const pattern of SECRET_TEXT_PATTERNS) {
    if (pattern.test(value)) invalid(label, 'secret-shaped content is not allowed', recordIndex);
  }
}

function validateJsonValue(value: unknown, label: string, depth: number, recordIndex?: number): void {
  if (depth > MAX_JSON_DEPTH) invalid(label, 'maximum depth exceeded', recordIndex);
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'string') {
    expectSafeText(value, label, recordIndex);
    return;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) invalid(label, 'number must be finite', recordIndex);
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_JSON_ARRAY_ITEMS) invalid(label, 'array is too large', recordIndex);
    value.forEach((item, index) => validateJsonValue(item, `${label}[${index}]`, depth + 1, recordIndex));
    return;
  }
  if (!isRecord(value)) invalid(label, 'not JSON-compatible', recordIndex);
  const keys = Object.keys(value);
  if (keys.length > MAX_JSON_OBJECT_KEYS) invalid(label, 'object is too large', recordIndex);
  for (const key of keys) {
    if (isSecretFieldName(key)) invalid(`${label}.${key}`, 'secret fields are not allowed', recordIndex);
    validateJsonValue(value[key], `${label}.${key}`, depth + 1, recordIndex);
  }
}

function expectJsonObject(value: unknown, label: string, recordIndex?: number): JsonObject {
  if (!isRecord(value)) invalid(label, 'expected a JSON object', recordIndex);
  validateJsonValue(value, label, 0, recordIndex);
  return value as JsonObject;
}

function expectNonNegativeSafeInteger(value: unknown, label: string, recordIndex?: number): asserts value is number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    invalid(label, 'expected a non-negative safe integer', recordIndex);
  }
}

function parseUsage(value: unknown, label: string, recordIndex?: number): RuntimeUsage {
  const usage = expectRecord(value, label, recordIndex);
  expectKeys(
    usage,
    ['inputTokens', 'outputTokens', 'totalTokens'],
    ['reasoningTokens', 'cacheReadTokens', 'cacheWriteTokens'],
    label,
    recordIndex,
  );
  for (const key of ['inputTokens', 'outputTokens', 'totalTokens', 'reasoningTokens', 'cacheReadTokens', 'cacheWriteTokens'] as const) {
    if (hasOwn(usage, key)) expectNonNegativeSafeInteger(usage[key], `${label}.${key}`, recordIndex);
  }
  return usage as unknown as RuntimeUsage;
}

function parseTextBlock(value: unknown, label: string, recordIndex?: number): RuntimeTextBlock {
  const block = expectRecord(value, label, recordIndex);
  expectExactKeys(block, ['type', 'id', 'text'], label, recordIndex);
  if (block.type !== 'text') invalid(`${label}.type`, 'expected text', recordIndex);
  expectIdentifier(block.id, `${label}.id`, recordIndex);
  expectSafeText(block.text, `${label}.text`, recordIndex);
  return block as unknown as RuntimeTextBlock;
}

function parseThinkingBlock(value: unknown, label: string, recordIndex?: number): RuntimeThinkingBlock {
  const block = expectRecord(value, label, recordIndex);
  expectKeys(block, ['type', 'id', 'text'], ['redacted'], label, recordIndex);
  if (block.type !== 'thinking') invalid(`${label}.type`, 'expected thinking', recordIndex);
  expectIdentifier(block.id, `${label}.id`, recordIndex);
  expectSafeText(block.text, `${label}.text`, recordIndex);
  if (hasOwn(block, 'redacted') && typeof block.redacted !== 'boolean') {
    invalid(`${label}.redacted`, 'expected a boolean', recordIndex);
  }
  return block as unknown as RuntimeThinkingBlock;
}

function parseFileBlock(value: unknown, label: string, recordIndex?: number): RuntimeFileBlock {
  const block = expectRecord(value, label, recordIndex);
  expectExactKeys(block, ['type', 'id', 'mime', 'filename', 'url'], label, recordIndex);
  if (block.type !== 'file') invalid(`${label}.type`, 'expected file', recordIndex);
  expectIdentifier(block.id, `${label}.id`, recordIndex);
  expectSafeString(block.mime, `${label}.mime`, recordIndex);
  expectSafeString(block.filename, `${label}.filename`, recordIndex);
  expectSafeString(block.url, `${label}.url`, recordIndex);
  if (!/^data:[^,\s]+,/u.test(block.url)) invalid(`${label}.url`, 'expected a bounded data URL', recordIndex);
  return block as unknown as RuntimeFileBlock;
}

function parseToolCallBlock(value: unknown, label: string, recordIndex?: number): RuntimeToolCallBlock {
  const block = expectRecord(value, label, recordIndex);
  expectExactKeys(block, ['type', 'id', 'toolCallId', 'name', 'arguments'], label, recordIndex);
  if (block.type !== 'tool-call') invalid(`${label}.type`, 'expected tool-call', recordIndex);
  expectIdentifier(block.id, `${label}.id`, recordIndex);
  expectIdentifier(block.toolCallId, `${label}.toolCallId`, recordIndex);
  expectSafeString(block.name, `${label}.name`, recordIndex);
  expectJsonObject(block.arguments, `${label}.arguments`, recordIndex);
  return block as unknown as RuntimeToolCallBlock;
}

function parseUserContent(value: unknown, label: string, recordIndex?: number): RuntimeUserContent {
  const record = expectRecord(value, label, recordIndex);
  if (record.type === 'text') return parseTextBlock(record, label, recordIndex);
  if (record.type === 'file') return parseFileBlock(record, label, recordIndex);
  invalid(`${label}.type`, 'unsupported user content type', recordIndex);
}

function parseAssistantContent(value: unknown, label: string, recordIndex?: number): RuntimeAssistantContent {
  const record = expectRecord(value, label, recordIndex);
  if (record.type === 'text') return parseTextBlock(record, label, recordIndex);
  if (record.type === 'thinking') return parseThinkingBlock(record, label, recordIndex);
  if (record.type === 'tool-call') return parseToolCallBlock(record, label, recordIndex);
  invalid(`${label}.type`, 'unsupported assistant content type', recordIndex);
}

function parseDiagnostic(value: unknown, label: string, recordIndex?: number): RuntimeProviderDiagnostic {
  const diagnostic = expectRecord(value, label, recordIndex);
  expectExactKeys(diagnostic, ['code', 'message', 'retryable'], label, recordIndex);
  expectSafeString(diagnostic.code, `${label}.code`, recordIndex);
  expectSafeString(diagnostic.message, `${label}.message`, recordIndex);
  if (typeof diagnostic.retryable !== 'boolean') invalid(`${label}.retryable`, 'expected a boolean', recordIndex);
  return diagnostic as unknown as RuntimeProviderDiagnostic;
}

function parseResult(value: unknown, label: string, recordIndex?: number): RuntimeToolResultPayload {
  const result = expectRecord(value, label, recordIndex);
  if (result.status === 'succeeded') {
    expectExactKeys(result, ['status', 'output'], label, recordIndex);
    validateJsonValue(result.output, `${label}.output`, 0, recordIndex);
    return result as unknown as RuntimeToolResultPayload;
  }
  if (result.status === 'failed') {
    expectKeys(result, ['status', 'code', 'message'], ['details'], label, recordIndex);
    expectSafeString(result.code, `${label}.code`, recordIndex);
    expectSafeString(result.message, `${label}.message`, recordIndex);
    if (hasOwn(result, 'details')) validateJsonValue(result.details, `${label}.details`, 0, recordIndex);
    return result as unknown as RuntimeToolResultPayload;
  }
  invalid(`${label}.status`, 'unsupported tool result status', recordIndex);
}

function parseUserMessage(value: Record<string, unknown>, label: string, recordIndex?: number): RuntimeUserMessage {
  expectExactKeys(
    value,
    ['schemaVersion', 'id', 'createdAt', 'defTurnId', 'turnId', 'role', 'clientTurnId', 'content'],
    label,
    recordIndex,
  );
  if (value.role !== 'user') invalid(`${label}.role`, 'expected user', recordIndex);
  const content = value.content;
  if (!Array.isArray(content) || content.length > MAX_JSON_ARRAY_ITEMS) {
    invalid(`${label}.content`, 'expected a bounded array', recordIndex);
  }
  return {
    schemaVersion: RUNTIME_SESSION_SCHEMA_VERSION,
    id: value.id as RuntimeMessage['id'],
    createdAt: value.createdAt as string,
    defTurnId: value.defTurnId as DefTurnId,
    turnId: value.turnId as RuntimeTurnId,
    role: 'user',
    clientTurnId: value.clientTurnId as ClientTurnId,
    content: content.map((item, index) => parseUserContent(item, `${label}.content[${index}]`, recordIndex)),
  };
}

function parseAssistantMessage(value: Record<string, unknown>, label: string, recordIndex?: number): RuntimeAssistantMessage {
  expectKeys(
    value,
    ['schemaVersion', 'id', 'createdAt', 'defTurnId', 'turnId', 'role', 'content', 'providerId', 'modelId', 'usage', 'stopReason', 'completedAt'],
    ['responseId', 'diagnostic'],
    label,
    recordIndex,
  );
  if (value.role !== 'assistant') invalid(`${label}.role`, 'expected assistant', recordIndex);
  if (!Array.isArray(value.content) || value.content.length > MAX_JSON_ARRAY_ITEMS) {
    invalid(`${label}.content`, 'expected a bounded array', recordIndex);
  }
  expectSafeString(value.providerId, `${label}.providerId`, recordIndex);
  expectSafeString(value.modelId, `${label}.modelId`, recordIndex);
  if (hasOwn(value, 'responseId')) expectSafeString(value.responseId, `${label}.responseId`, recordIndex);
  const usage = parseUsage(value.usage, `${label}.usage`, recordIndex);
  if (typeof value.stopReason !== 'string' || !MESSAGE_STOP_REASONS.has(value.stopReason as RuntimeAssistantMessage['stopReason'])) {
    invalid(`${label}.stopReason`, 'unsupported stop reason', recordIndex);
  }
  const diagnostic = hasOwn(value, 'diagnostic')
    ? parseDiagnostic(value.diagnostic, `${label}.diagnostic`, recordIndex)
    : undefined;
  expectDateText(value.completedAt, `${label}.completedAt`, recordIndex);
  return {
    schemaVersion: RUNTIME_SESSION_SCHEMA_VERSION,
    id: value.id as RuntimeMessage['id'],
    createdAt: value.createdAt as string,
    defTurnId: value.defTurnId as DefTurnId,
    turnId: value.turnId as RuntimeTurnId,
    role: 'assistant',
    content: value.content.map((item, index) => parseAssistantContent(item, `${label}.content[${index}]`, recordIndex)),
    providerId: value.providerId as string,
    modelId: value.modelId as string,
    ...(hasOwn(value, 'responseId') ? { responseId: value.responseId as string } : {}),
    usage,
    stopReason: value.stopReason as RuntimeAssistantMessage['stopReason'],
    ...(diagnostic ? { diagnostic } : {}),
    completedAt: value.completedAt as string,
  };
}

function parseToolResultMessage(value: Record<string, unknown>, label: string, recordIndex?: number): RuntimeToolResultMessage {
  expectExactKeys(
    value,
    ['schemaVersion', 'id', 'createdAt', 'defTurnId', 'turnId', 'role', 'toolCallId', 'toolName', 'result', 'completedAt'],
    label,
    recordIndex,
  );
  if (value.role !== 'tool-result') invalid(`${label}.role`, 'expected tool-result', recordIndex);
  expectIdentifier(value.toolCallId, `${label}.toolCallId`, recordIndex);
  expectSafeString(value.toolName, `${label}.toolName`, recordIndex);
  const result = parseResult(value.result, `${label}.result`, recordIndex);
  expectDateText(value.completedAt, `${label}.completedAt`, recordIndex);
  return {
    schemaVersion: RUNTIME_SESSION_SCHEMA_VERSION,
    id: value.id as RuntimeMessage['id'],
    createdAt: value.createdAt as string,
    defTurnId: value.defTurnId as DefTurnId,
    turnId: value.turnId as RuntimeTurnId,
    role: 'tool-result',
    toolCallId: value.toolCallId as ToolCallId,
    toolName: value.toolName as string,
    result,
    completedAt: value.completedAt as string,
  };
}

function parseRuntimeMessage(value: unknown, label: string, recordIndex?: number): RuntimeTurnMessage {
  const message = expectRecord(value, label, recordIndex);
  if (message.schemaVersion !== RUNTIME_SESSION_SCHEMA_VERSION) invalid(`${label}.schemaVersion`, 'unsupported schema', recordIndex);
  expectIdentifier(message.id, `${label}.id`, recordIndex);
  expectDateText(message.createdAt, `${label}.createdAt`, recordIndex);
  expectIdentifier(message.defTurnId, `${label}.defTurnId`, recordIndex);
  expectIdentifier(message.turnId, `${label}.turnId`, recordIndex);
  let parsed: RuntimeTurnMessage;
  if (message.role === 'user') {
    expectIdentifier(message.clientTurnId, `${label}.clientTurnId`, recordIndex);
    parsed = parseUserMessage(message, label, recordIndex);
  } else if (message.role === 'assistant') {
    parsed = parseAssistantMessage(message, label, recordIndex);
  } else if (message.role === 'tool-result') {
    parsed = parseToolResultMessage(message, label, recordIndex);
  } else {
    invalid(`${label}.role`, 'unsupported message role', recordIndex);
  }
  const serialized = JSON.stringify(parsed);
  if (serialized === undefined || serialized.length > RUNTIME_SESSION_LIMITS.maxMessageCodeUnits) {
    invalid(label, 'message is too large', recordIndex);
  }
  return parsed;
}

function parseHeader(value: unknown, label = 'record[0]', recordIndex = 0): RuntimeSessionHeader {
  const header = expectRecord(value, label, recordIndex);
  expectExactKeys(
    header,
    ['type', 'schemaVersion', 'runtimeSessionId', 'defSessionId', 'runtimeVersion', 'providerProfileRef', 'systemPromptVersion', 'createdAt'],
    label,
    recordIndex,
  );
  if (header.type !== 'session') invalid(`${label}.type`, 'expected session header', recordIndex);
  if (header.schemaVersion !== RUNTIME_SESSION_SCHEMA_VERSION) invalid(`${label}.schemaVersion`, 'unsupported schema', recordIndex);
  expectIdentifier(header.runtimeSessionId, `${label}.runtimeSessionId`, recordIndex);
  expectIdentifier(header.defSessionId, `${label}.defSessionId`, recordIndex);
  expectSafeString(header.runtimeVersion, `${label}.runtimeVersion`, recordIndex);
  expectSafeString(header.providerProfileRef, `${label}.providerProfileRef`, recordIndex);
  expectSafeString(header.systemPromptVersion, `${label}.systemPromptVersion`, recordIndex);
  expectDateText(header.createdAt, `${label}.createdAt`, recordIndex);
  return header as unknown as RuntimeSessionHeader;
}

function parseEntryBase(value: Record<string, unknown>, label: string, recordIndex?: number): void {
  if (value.schemaVersion !== RUNTIME_SESSION_SCHEMA_VERSION) invalid(`${label}.schemaVersion`, 'unsupported schema', recordIndex);
  expectIdentifier(value.id, `${label}.id`, recordIndex);
  if (value.parentId !== null) expectIdentifier(value.parentId, `${label}.parentId`, recordIndex);
  expectDateText(value.createdAt, `${label}.createdAt`, recordIndex);
}

function parseEntry(value: unknown, label: string, recordIndex?: number): RuntimeSessionEntry {
  const entry = expectRecord(value, label, recordIndex);
  if (entry.type === 'session') invalid(`${label}.type`, 'header is only allowed as the first record', recordIndex);
  if (typeof entry.type !== 'string') invalid(`${label}.type`, 'expected a record type', recordIndex);
  parseEntryBase(entry, label, recordIndex);
  if (entry.type === 'message') {
    expectExactKeys(entry, ['schemaVersion', 'id', 'parentId', 'createdAt', 'type', 'message'], label, recordIndex);
    parseRuntimeMessage(entry.message, `${label}.message`, recordIndex);
    return entry as unknown as RuntimeMessageEntry & { message: RuntimeTurnMessage };
  }
  if (entry.type === 'model-change') {
    expectExactKeys(entry, ['schemaVersion', 'id', 'parentId', 'createdAt', 'type', 'providerProfileRef', 'providerId', 'modelId'], label, recordIndex);
    expectSafeString(entry.providerProfileRef, `${label}.providerProfileRef`, recordIndex);
    expectSafeString(entry.providerId, `${label}.providerId`, recordIndex);
    expectSafeString(entry.modelId, `${label}.modelId`, recordIndex);
    return entry as unknown as RuntimeModelChangeEntry;
  }
  if (entry.type === 'thinking-change') {
    expectExactKeys(entry, ['schemaVersion', 'id', 'parentId', 'createdAt', 'type', 'level'], label, recordIndex);
    if (typeof entry.level !== 'string' || !THINKING_LEVELS.has(entry.level as RuntimeThinkingChangeEntry['level'])) {
      invalid(`${label}.level`, 'unsupported thinking level', recordIndex);
    }
    return entry as unknown as RuntimeThinkingChangeEntry;
  }
  if (entry.type === 'compaction') {
    expectKeys(entry, ['schemaVersion', 'id', 'parentId', 'createdAt', 'type', 'summary', 'firstKeptEntryId', 'tokensBefore', 'reason'], ['usage'], label, recordIndex);
    expectSafeString(entry.summary, `${label}.summary`, recordIndex);
    if (entry.summary.length > RUNTIME_SESSION_LIMITS.maxSummaryCodeUnits) invalid(`${label}.summary`, 'summary is too large', recordIndex);
    expectIdentifier(entry.firstKeptEntryId, `${label}.firstKeptEntryId`, recordIndex);
    expectNonNegativeSafeInteger(entry.tokensBefore, `${label}.tokensBefore`, recordIndex);
    if (typeof entry.reason !== 'string' || !COMPACTION_REASONS.has(entry.reason as RuntimeCompactionEntry['reason'])) {
      invalid(`${label}.reason`, 'unsupported compaction reason', recordIndex);
    }
    if (hasOwn(entry, 'usage')) parseUsage(entry.usage, `${label}.usage`, recordIndex);
    return entry as unknown as RuntimeCompactionEntry;
  }
  if (entry.type === 'run-marker') {
    if (entry.phase === 'start') {
      expectExactKeys(entry, ['schemaVersion', 'id', 'parentId', 'createdAt', 'type', 'phase', 'defTurnId', 'runId', 'turnId'], label, recordIndex);
      expectIdentifier(entry.defTurnId, `${label}.defTurnId`, recordIndex);
      expectIdentifier(entry.runId, `${label}.runId`, recordIndex);
      expectIdentifier(entry.turnId, `${label}.turnId`, recordIndex);
      return entry as unknown as RuntimeRunMarkerEntry;
    }
    if (entry.phase === 'end') {
      expectExactKeys(entry, ['schemaVersion', 'id', 'parentId', 'createdAt', 'type', 'phase', 'defTurnId', 'runId', 'turnId', 'terminal'], label, recordIndex);
      expectIdentifier(entry.defTurnId, `${label}.defTurnId`, recordIndex);
      expectIdentifier(entry.runId, `${label}.runId`, recordIndex);
      expectIdentifier(entry.turnId, `${label}.turnId`, recordIndex);
      parseTerminal(entry.terminal, `${label}.terminal`, recordIndex);
      return entry as unknown as RuntimeRunMarkerEntry;
    }
    invalid(`${label}.phase`, 'unsupported run marker phase', recordIndex);
  }
  invalid(`${label}.type`, 'unsupported entry type', recordIndex);
}

function parseTerminal(value: unknown, label: string, recordIndex?: number): RuntimeRunMarkerTerminal {
  const terminal = expectRecord(value, label, recordIndex);
  if (typeof terminal.status !== 'string' || !TERMINAL_STATUSES.has(terminal.status as RuntimeRunMarkerTerminal['status'])) {
    invalid(`${label}.status`, 'unsupported terminal status', recordIndex);
  }
  if (terminal.status === 'completed') {
    expectExactKeys(terminal, ['status'], label, recordIndex);
    return terminal as unknown as RuntimeRunMarkerTerminal;
  }
  if (terminal.status === 'failed' || terminal.status === 'interrupted') {
    expectExactKeys(terminal, ['status', 'code', 'message'], label, recordIndex);
    expectSafeString(terminal.code, `${label}.code`, recordIndex);
    expectSafeString(terminal.message, `${label}.message`, recordIndex);
    return terminal as unknown as RuntimeRunMarkerTerminal;
  }
  expectKeys(terminal, ['status', 'code'], ['message'], label, recordIndex);
  expectSafeString(terminal.code, `${label}.code`, recordIndex);
  if (hasOwn(terminal, 'message')) expectSafeString(terminal.message, `${label}.message`, recordIndex);
  return terminal as unknown as RuntimeRunMarkerTerminal;
}

/** Parse one untrusted JSON value into the frozen Runtime Session union. */
export function parseRuntimeSessionRecord(value: unknown, recordIndex = 0): RuntimeSessionRecord {
  const record = expectRecord(value, `record[${recordIndex}]`, recordIndex);
  if (record.type === 'session') return parseHeader(record, `record[${recordIndex}]`, recordIndex);
  return parseEntry(record, `record[${recordIndex}]`, recordIndex);
}

export const parseSessionRecord = parseRuntimeSessionRecord;

export function validateRuntimeSessionHeader(value: unknown): RuntimeSessionHeader {
  const record = parseRuntimeSessionRecord(value);
  if (record.type !== 'session') invalid('session header', 'expected a session header');
  return record;
}

export const validateSessionHeader = validateRuntimeSessionHeader;

interface MutableRunState {
  readonly runId: RuntimeRunId;
  readonly defTurnId: DefTurnId;
  readonly turnId: RuntimeTurnId;
  readonly startEntryId: RuntimeEntryId;
  endEntryId: RuntimeEntryId | null;
  status: RuntimeRunState['status'];
  unresolvedToolCallIds: ToolCallId[];
}

interface ToolCallReference {
  readonly runId: RuntimeRunId;
  readonly defTurnId: DefTurnId;
  readonly turnId: RuntimeTurnId;
  readonly name: string;
}

function immutableRunState(run: MutableRunState): RuntimeRunState {
  return {
    runId: run.runId,
    defTurnId: run.defTurnId,
    turnId: run.turnId,
    startEntryId: run.startEntryId,
    endEntryId: run.endEntryId,
    status: run.status,
    unresolvedToolCallIds: [...run.unresolvedToolCallIds],
  };
}

function immutableInterruptedRun(run: MutableRunState): InterruptedRuntimeRun {
  return {
    status: 'interrupted',
    runId: run.runId,
    defTurnId: run.defTurnId,
    turnId: run.turnId,
    startEntryId: run.startEntryId,
    endEntryId: run.endEntryId,
    unresolvedToolCallIds: [...run.unresolvedToolCallIds],
  };
}

function validateRelations(
  header: RuntimeSessionHeader,
  entries: readonly RuntimeSessionEntry[],
  records: readonly RuntimeSessionRecord[],
): ValidatedSession {
  const entryIndex = new Map<RuntimeEntryId, number>();
  for (const [index, entry] of entries.entries()) {
    if (entryIndex.has(entry.id)) invalid(`record[${index + 1}].id`, 'duplicate entry id', index + 1);
    entryIndex.set(entry.id, index);
  }

  for (const [index, entry] of entries.entries()) {
    if (entry.parentId === null) {
      continue;
    }
    const parentIndex = entryIndex.get(entry.parentId);
    if (parentIndex === undefined) invalid(`record[${index + 1}].parentId`, 'unknown parent', index + 1);
    if (entry.parentId === entry.id) invalid(`record[${index + 1}].parentId`, 'parent cycle', index + 1);
  }

  // Walk every parent chain even though append ordering normally makes cycles
  // impossible. This keeps validation correct for hand-written/imported logs.
  for (const [index, entry] of entries.entries()) {
    const visited = new Set<RuntimeEntryId>();
    let current: RuntimeSessionEntry | undefined = entry;
    while (current?.parentId !== null && current?.parentId !== undefined) {
      if (visited.has(current.id)) invalid(`record[${index + 1}].parentId`, 'parent cycle', index + 1);
      visited.add(current.id);
      const parentIndex = entryIndex.get(current.parentId);
      if (parentIndex === undefined) invalid(`record[${index + 1}].parentId`, 'unknown parent', index + 1);
      current = entries[parentIndex];
    }
  }
  for (const [index, entry] of entries.entries()) {
    if (entry.parentId === null) continue;
    const parentIndex = entryIndex.get(entry.parentId);
    if (parentIndex === undefined) invalid(`record[${index + 1}].parentId`, 'unknown parent', index + 1);
    if (parentIndex >= index) invalid(`record[${index + 1}].parentId`, 'parent must precede child', index + 1);
  }
  if (entries.length > 0 && entries[0].parentId !== null) {
    invalid('record[1].parentId', 'the first entry must be the root', 1);
  }
  for (const [index, entry] of entries.entries()) {
    if (entry.parentId === null && index !== 0) {
      invalid(`record[${index + 1}].parentId`, 'multiple roots are not allowed', index + 1);
    }
  }

  for (const [index, entry] of entries.entries()) {
    if (entry.type !== 'compaction') continue;
    if (!entryIndex.has(entry.firstKeptEntryId)) {
      invalid(`record[${index + 1}].firstKeptEntryId`, 'unknown entry', index + 1);
    }
  }

  const messageIds = new Set<string>();
  const contentIds = new Set<RuntimeContentId>();
  const toolCallIds = new Set<ToolCallId>();
  const openToolCalls = new Map<ToolCallId, ToolCallReference>();
  const runIds = new Set<RuntimeRunId>();
  const defToRuntime = new Map<DefTurnId, RuntimeTurnId>();
  const runtimeToDef = new Map<RuntimeTurnId, DefTurnId>();
  const runs: MutableRunState[] = [];
  const interruptedRuns: InterruptedRuntimeRun[] = [];
  let activeRun: MutableRunState | null = null;

  const associateTurn = (defTurnId: DefTurnId, turnId: RuntimeTurnId, index: number): void => {
    const previousRuntimeTurn = defToRuntime.get(defTurnId);
    if (previousRuntimeTurn !== undefined && previousRuntimeTurn !== turnId) {
      invalid(`record[${index}].defTurnId`, 'DefTurnId maps to multiple RuntimeTurnIds', index);
    }
    const previousDefTurn = runtimeToDef.get(turnId);
    if (previousDefTurn !== undefined && previousDefTurn !== defTurnId) {
      invalid(`record[${index}].turnId`, 'RuntimeTurnId maps to multiple DefTurnIds', index);
    }
    defToRuntime.set(defTurnId, turnId);
    runtimeToDef.set(turnId, defTurnId);
  };

  const assertActiveMessage = (message: RuntimeTurnMessage, index: number): void => {
    if (!activeRun) invalid(`record[${index}].message`, 'message is outside a run', index);
    if (message.defTurnId !== activeRun.defTurnId || message.turnId !== activeRun.turnId) {
      invalid(`record[${index}].message`, 'message turn does not match the active run', index);
    }
    associateTurn(message.defTurnId, message.turnId, index);
  };

  const openCallsForRun = (runId: RuntimeRunId): Array<[ToolCallId, ToolCallReference]> => (
    [...openToolCalls.entries()].filter(([, reference]) => reference.runId === runId)
  );

  for (const [zeroBasedIndex, entry] of entries.entries()) {
    const index = zeroBasedIndex + 1;
    if (entry.type === 'run-marker') {
      if (entry.phase === 'start') {
        if (activeRun) invalid(`record[${index}].runId`, 'runs cannot overlap', index);
        if (runIds.has(entry.runId)) invalid(`record[${index}].runId`, 'duplicate run id', index);
        associateTurn(entry.defTurnId, entry.turnId, index);
        runIds.add(entry.runId);
        activeRun = {
          runId: entry.runId,
          defTurnId: entry.defTurnId,
          turnId: entry.turnId,
          startEntryId: entry.id,
          endEntryId: null,
          status: 'active',
          unresolvedToolCallIds: [],
        };
        runs.push(activeRun);
        continue;
      }

      if (!activeRun) invalid(`record[${index}].runId`, 'run end has no active start', index);
      if (
        entry.runId !== activeRun.runId
        || entry.defTurnId !== activeRun.defTurnId
        || entry.turnId !== activeRun.turnId
      ) {
        invalid(`record[${index}].runId`, 'run end does not match its start', index);
      }
      const openCalls = openCallsForRun(activeRun.runId);
      const terminalStatus = entry.terminal.status;
      if (openCalls.length > 0 && terminalStatus !== 'aborted' && terminalStatus !== 'interrupted') {
        invalid(`record[${index}].terminal`, 'run ended with an unmatched tool call', index);
      }
      activeRun.endEntryId = entry.id;
      activeRun.status = terminalStatus;
      activeRun.unresolvedToolCallIds = openCalls.map(([toolCallId]) => toolCallId);
      if (terminalStatus === 'interrupted') interruptedRuns.push(immutableInterruptedRun(activeRun));
      for (const [toolCallId, reference] of openToolCalls.entries()) {
        if (reference.runId === activeRun.runId) openToolCalls.delete(toolCallId);
      }
      activeRun = null;
      continue;
    }

    if (entry.type !== 'message') continue;
    const message = entry.message;
    if (messageIds.has(message.id)) invalid(`record[${index}].message.id`, 'duplicate message id', index);
    messageIds.add(message.id);
    assertActiveMessage(message, index);

    if (message.role === 'assistant') {
      for (const block of message.content) {
        if (contentIds.has(block.id)) invalid(`record[${index}].message`, 'duplicate content id', index);
        contentIds.add(block.id);
        if (block.type !== 'tool-call') continue;
        if (toolCallIds.has(block.toolCallId)) invalid(`record[${index}].message`, 'duplicate tool call id', index);
        toolCallIds.add(block.toolCallId);
        openToolCalls.set(block.toolCallId, {
          runId: activeRun!.runId,
          defTurnId: activeRun!.defTurnId,
          turnId: activeRun!.turnId,
          name: block.name,
        });
      }
      continue;
    }

    if (message.role === 'user') {
      for (const block of message.content) {
        if (contentIds.has(block.id)) invalid(`record[${index}].message`, 'duplicate content id', index);
        contentIds.add(block.id);
      }
    }

    if (message.role !== 'tool-result') continue;
    const call = openToolCalls.get(message.toolCallId);
    if (!call) invalid(`record[${index}].message.toolCallId`, 'unknown or already paired tool call', index);
    if (
      call.runId !== activeRun!.runId
      || call.defTurnId !== message.defTurnId
      || call.turnId !== message.turnId
      || call.name !== message.toolName
    ) {
      invalid(`record[${index}].message`, 'tool result does not match its call', index);
    }
    openToolCalls.delete(message.toolCallId);
  }

  if (activeRun) {
    activeRun.status = 'interrupted';
    activeRun.unresolvedToolCallIds = openCallsForRun(activeRun.runId).map(([toolCallId]) => toolCallId);
    interruptedRuns.push(immutableInterruptedRun(activeRun));
  }
  if (!activeRun && openToolCalls.size > 0) {
    invalid('session.toolCalls', 'unmatched tool calls remain', entries.length);
  }

  const immutableRuns = runs.map(immutableRunState);
  const lastEntry = entries.at(-1);
  return {
    header,
    entries: [...entries],
    records: [...records],
    updatedAt: lastEntry?.createdAt ?? header.createdAt,
    leafId: lastEntry?.id ?? null,
    runs: immutableRuns,
    interruptedRuns: [...interruptedRuns],
  };
}

/** Validate a complete in-memory session, including all cross-record links. */
export function validateSessionRecords(value: unknown): ValidatedSession {
  if (!Array.isArray(value) || value.length === 0) {
    invalid('session.records', 'expected a non-empty array');
  }
  if (value.length > RUNTIME_SESSION_LIMITS.maxEntries + 1) {
    invalid('session.records', 'too many records');
  }
  const records: RuntimeSessionRecord[] = [];
  for (const [index, record] of value.entries()) {
    if (index > 0 && isRecord(record) && record.type === 'session') {
      invalid(`record[${index}]`, 'only the first record may be a session header', index);
    }
    records.push(parseRuntimeSessionRecord(record, index));
  }
  const header = records[0];
  if (!header || header.type !== 'session') invalid('record[0]', 'session header is required', 0);
  const entries = records.slice(1) as RuntimeSessionEntry[];
  return validateRelations(header, entries, records);
}

export const validateSession = validateSessionRecords;

/** Validate a single entry before it is considered for append. */
export function validateRuntimeSessionEntry(value: unknown, recordIndex = 1): RuntimeSessionEntry {
  const record = parseRuntimeSessionRecord(value, recordIndex);
  if (record.type === 'session') invalid(`record[${recordIndex}]`, 'a session header cannot be appended', recordIndex);
  return record;
}

export const validateSessionEntry = validateRuntimeSessionEntry;

export function containsSecretShapedContent(value: unknown): boolean {
  try {
    validateJsonValue(value, 'value', 0);
    return false;
  } catch (error) {
    return error instanceof SessionValidationError && /secret/iu.test(error.message);
  }
}

export function isRuntimeSessionRecord(value: unknown): value is RuntimeSessionRecord {
  try {
    parseRuntimeSessionRecord(value);
    return true;
  } catch {
    return false;
  }
}
