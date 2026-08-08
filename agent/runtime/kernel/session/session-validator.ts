/**
 * Runtime Session JSON validator.
 *
 * The validator is deliberately independent from the file reader. It accepts
 * only the frozen F0 entry union, checks the append-only chain and lifecycle
 * invariants, and never performs a product-side replay or mutation.
 * Behavioral provenance: Pi packages/coding-agent/src/core/session-manager.ts
 * and packages/coding-agent/src/core/messages.ts at pinned commit
 * e47b8e37a6211ebd0b2942fa87059d64f81eec02. DEF replaces Pi-specific records
 * with its frozen contracts and adds a linear parent chain, run lifecycle,
 * RuntimeTurn/DefTurn, Tool pairing, and compaction-boundary validation.
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
  /** Last RuntimeTurnId observed before interruption, not necessarily the start turn. */
  readonly turnId: RuntimeTurnId;
  readonly startEntryId: RuntimeEntryId;
  readonly endEntryId: RuntimeEntryId | null;
  readonly unresolvedToolCallIds: readonly ToolCallId[];
}

export interface RuntimeRunState {
  readonly runId: RuntimeRunId;
  readonly defTurnId: DefTurnId;
  /** Last RuntimeTurnId observed in the run, not necessarily the start turn. */
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
const MAX_JSON_FIELD_NAME_CODE_UNITS = 256;
const MAX_JSON_TOTAL_NODES = 16_384;
const MAX_JSON_TOTAL_FIELDS = 8_192;
const MAX_JSON_TOTAL_STRING_CODE_UNITS = RUNTIME_SESSION_LIMITS.maxMessageCodeUnits;

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
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    invalid(label, 'expected a plain data object', recordIndex);
  }
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      typeof key !== 'string'
      || !descriptor
      || !descriptor.enumerable
      || !('value' in descriptor)
    ) {
      invalid(label, 'accessors and non-JSON properties are not allowed', recordIndex);
    }
  }
  return value;
}

function expectPlainDataArray(
  value: unknown,
  label: string,
  maxItems: number,
  recordIndex?: number,
): readonly unknown[] {
  if (!Array.isArray(value) || value.length > maxItems || Object.getPrototypeOf(value) !== Array.prototype) {
    invalid(label, 'expected a bounded plain array', recordIndex);
  }
  const enumerableKeys = Object.keys(value);
  const ownKeys = Reflect.ownKeys(value);
  if (
    enumerableKeys.length !== value.length
    || enumerableKeys.some((key, index) => key !== String(index))
    || ownKeys.length !== value.length + 1
    || ownKeys.some((key) => typeof key !== 'string')
  ) {
    invalid(label, 'array accessors, holes, and non-JSON properties are not allowed', recordIndex);
  }
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
      invalid(label, 'array accessors are not allowed', recordIndex);
    }
  }
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

function expectExactBoundedText(
  value: unknown,
  label: string,
  maxCodeUnits = MAX_STRING_CODE_UNITS,
  allowEmpty = true,
  recordIndex?: number,
): asserts value is string {
  if (
    typeof value !== 'string'
    || (!allowEmpty && value.length === 0)
    || value.length > maxCodeUnits
  ) {
    invalid(label, 'expected bounded text', recordIndex);
  }
}

function expectTrimmedNonEmptyString(
  value: unknown,
  label: string,
  maxCodeUnits = MAX_STRING_CODE_UNITS,
  recordIndex?: number,
): asserts value is string {
  expectExactBoundedText(value, label, maxCodeUnits, false, recordIndex);
  if (value.trim() !== value) invalid(label, 'expected trimmed metadata', recordIndex);
}

function expectIdentifier(value: unknown, label: string, recordIndex?: number): asserts value is string {
  expectTrimmedNonEmptyString(value, label, 256, recordIndex);
}

function expectDateText(value: unknown, label: string, recordIndex?: number): asserts value is string {
  expectTrimmedNonEmptyString(value, label, 128, recordIndex);
  if (Number.isNaN(Date.parse(value))) invalid(label, 'expected a date', recordIndex);
}

function isSecretFieldName(value: string): boolean {
  const normalized = value.toLowerCase().replace(/[^a-z0-9]/gu, '');
  return normalized === 'headers'
    || normalized.endsWith('headers')
    || SECRET_FIELD_PATTERN.test(normalized);
}

function expectSafeMetadata(value: unknown, label: string, recordIndex?: number): asserts value is string {
  expectTrimmedNonEmptyString(value, label, MAX_STRING_CODE_UNITS, recordIndex);
  for (const pattern of SECRET_TEXT_PATTERNS) {
    if (pattern.test(value)) invalid(label, 'secret-shaped content is not allowed', recordIndex);
  }
}

function expectSafeJsonFieldName(value: string, label: string, recordIndex?: number): void {
  expectTrimmedNonEmptyString(value, label, MAX_JSON_FIELD_NAME_CODE_UNITS, recordIndex);
  if (isSecretFieldName(value)) invalid(label, 'secret fields are not allowed', recordIndex);
  for (const pattern of SECRET_TEXT_PATTERNS) {
    if (pattern.test(value)) invalid(label, 'secret-shaped fields are not allowed', recordIndex);
  }
}

function expectSafeContentText(
  value: unknown,
  label: string,
  recordIndex?: number,
  maxCodeUnits = MAX_STRING_CODE_UNITS,
  allowEmpty = true,
): asserts value is string {
  expectExactBoundedText(value, label, maxCodeUnits, allowEmpty, recordIndex);
  for (const pattern of SECRET_TEXT_PATTERNS) {
    if (pattern.test(value)) invalid(label, 'secret-shaped content is not allowed', recordIndex);
  }
}

interface JsonValidationContext {
  nodes: number;
  fields: number;
  stringCodeUnits: number;
  readonly seen: WeakSet<object>;
}

function createJsonValidationContext(): JsonValidationContext {
  return {
    nodes: 0,
    fields: 0,
    stringCodeUnits: 0,
    seen: new WeakSet<object>(),
  };
}

function consumeJsonString(
  context: JsonValidationContext,
  codeUnits: number,
  label: string,
  recordIndex?: number,
): void {
  context.stringCodeUnits += codeUnits;
  if (context.stringCodeUnits > MAX_JSON_TOTAL_STRING_CODE_UNITS) {
    invalid(label, 'total JSON string budget exceeded', recordIndex);
  }
}

function ownJsonDataValue(
  container: object,
  key: string,
  label: string,
  recordIndex?: number,
): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(container, key);
  if (!descriptor || !('value' in descriptor)) {
    invalid(label, 'JSON accessors and inherited values are not allowed', recordIndex);
  }
  return descriptor.value;
}

function validateJsonValue(
  value: unknown,
  label: string,
  depth: number,
  context: JsonValidationContext,
  recordIndex?: number,
): void {
  context.nodes += 1;
  if (context.nodes > MAX_JSON_TOTAL_NODES) {
    invalid(label, 'total JSON node budget exceeded', recordIndex);
  }
  if (depth > MAX_JSON_DEPTH) invalid(label, 'maximum depth exceeded', recordIndex);
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'string') {
    consumeJsonString(context, value.length, label, recordIndex);
    expectSafeContentText(value, label, recordIndex);
    return;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) invalid(label, 'number must be finite', recordIndex);
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_JSON_ARRAY_ITEMS) invalid(label, 'array is too large', recordIndex);
    if (Object.getPrototypeOf(value) !== Array.prototype || context.seen.has(value)) {
      invalid(label, 'repeated or non-plain JSON containers are not allowed', recordIndex);
    }
    context.seen.add(value);
    const enumerableKeys = Object.keys(value);
    const ownKeys = Reflect.ownKeys(value);
    if (
      enumerableKeys.length !== value.length
      || enumerableKeys.some((key, index) => key !== String(index))
      || ownKeys.length !== value.length + 1
      || ownKeys.some((key) => typeof key !== 'string')
    ) {
      invalid(label, 'expected a dense plain JSON array', recordIndex);
    }
    for (let index = 0; index < value.length; index += 1) {
      const item = ownJsonDataValue(value, String(index), `${label}[${index}]`, recordIndex);
      validateJsonValue(item, `${label}[${index}]`, depth + 1, context, recordIndex);
    }
    return;
  }
  if (!isRecord(value)) invalid(label, 'not JSON-compatible', recordIndex);
  const prototype = Object.getPrototypeOf(value);
  if (
    (prototype !== Object.prototype && prototype !== null)
    || context.seen.has(value)
  ) {
    invalid(label, 'repeated or non-plain JSON containers are not allowed', recordIndex);
  }
  context.seen.add(value);
  const keys = Object.keys(value);
  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.length !== keys.length
    || ownKeys.some((key) => (
      typeof key !== 'string'
      || !Object.prototype.propertyIsEnumerable.call(value, key)
    ))
  ) {
    invalid(label, 'expected an enumerable plain JSON object', recordIndex);
  }
  if (keys.length > MAX_JSON_OBJECT_KEYS) invalid(label, 'object is too large', recordIndex);
  context.fields += keys.length;
  if (context.fields > MAX_JSON_TOTAL_FIELDS) {
    invalid(label, 'total JSON field budget exceeded', recordIndex);
  }
  for (const [index, key] of keys.entries()) {
    const keyLabel = `${label}.key[${index}]`;
    consumeJsonString(context, key.length, keyLabel, recordIndex);
    expectSafeJsonFieldName(key, keyLabel, recordIndex);
    const fieldValue = ownJsonDataValue(value, key, `${label}.value[${index}]`, recordIndex);
    validateJsonValue(fieldValue, `${label}.value[${index}]`, depth + 1, context, recordIndex);
  }
}

function expectJsonObject(
  value: unknown,
  label: string,
  context: JsonValidationContext,
  recordIndex?: number,
): JsonObject {
  if (!isRecord(value)) invalid(label, 'expected a JSON object', recordIndex);
  validateJsonValue(value, label, 0, context, recordIndex);
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
  expectSafeContentText(block.text, `${label}.text`, recordIndex);
  return block as unknown as RuntimeTextBlock;
}

function parseThinkingBlock(value: unknown, label: string, recordIndex?: number): RuntimeThinkingBlock {
  const block = expectRecord(value, label, recordIndex);
  expectKeys(block, ['type', 'id', 'text'], ['redacted'], label, recordIndex);
  if (block.type !== 'thinking') invalid(`${label}.type`, 'expected thinking', recordIndex);
  expectIdentifier(block.id, `${label}.id`, recordIndex);
  expectSafeContentText(block.text, `${label}.text`, recordIndex);
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
  expectSafeMetadata(block.mime, `${label}.mime`, recordIndex);
  expectSafeMetadata(block.filename, `${label}.filename`, recordIndex);
  expectSafeMetadata(block.url, `${label}.url`, recordIndex);
  if (!/^data:[^,\s]+,/u.test(block.url)) invalid(`${label}.url`, 'expected a bounded data URL', recordIndex);
  return block as unknown as RuntimeFileBlock;
}

function parseToolCallBlock(
  value: unknown,
  label: string,
  jsonContext: JsonValidationContext,
  recordIndex?: number,
): RuntimeToolCallBlock {
  const block = expectRecord(value, label, recordIndex);
  expectExactKeys(block, ['type', 'id', 'toolCallId', 'name', 'arguments'], label, recordIndex);
  if (block.type !== 'tool-call') invalid(`${label}.type`, 'expected tool-call', recordIndex);
  expectIdentifier(block.id, `${label}.id`, recordIndex);
  expectIdentifier(block.toolCallId, `${label}.toolCallId`, recordIndex);
  expectSafeMetadata(block.name, `${label}.name`, recordIndex);
  expectJsonObject(block.arguments, `${label}.arguments`, jsonContext, recordIndex);
  return block as unknown as RuntimeToolCallBlock;
}

function parseUserContent(value: unknown, label: string, recordIndex?: number): RuntimeUserContent {
  const record = expectRecord(value, label, recordIndex);
  if (record.type === 'text') return parseTextBlock(record, label, recordIndex);
  if (record.type === 'file') return parseFileBlock(record, label, recordIndex);
  invalid(`${label}.type`, 'unsupported user content type', recordIndex);
}

function parseAssistantContent(
  value: unknown,
  label: string,
  jsonContext: JsonValidationContext,
  recordIndex?: number,
): RuntimeAssistantContent {
  const record = expectRecord(value, label, recordIndex);
  if (record.type === 'text') return parseTextBlock(record, label, recordIndex);
  if (record.type === 'thinking') return parseThinkingBlock(record, label, recordIndex);
  if (record.type === 'tool-call') return parseToolCallBlock(record, label, jsonContext, recordIndex);
  invalid(`${label}.type`, 'unsupported assistant content type', recordIndex);
}

function parseDiagnostic(value: unknown, label: string, recordIndex?: number): RuntimeProviderDiagnostic {
  const diagnostic = expectRecord(value, label, recordIndex);
  expectExactKeys(diagnostic, ['code', 'message', 'retryable'], label, recordIndex);
  expectSafeMetadata(diagnostic.code, `${label}.code`, recordIndex);
  expectSafeContentText(diagnostic.message, `${label}.message`, recordIndex, MAX_STRING_CODE_UNITS, false);
  if (typeof diagnostic.retryable !== 'boolean') invalid(`${label}.retryable`, 'expected a boolean', recordIndex);
  return diagnostic as unknown as RuntimeProviderDiagnostic;
}

function parseResult(
  value: unknown,
  label: string,
  jsonContext: JsonValidationContext,
  recordIndex?: number,
): RuntimeToolResultPayload {
  const result = expectRecord(value, label, recordIndex);
  if (result.status === 'succeeded') {
    expectExactKeys(result, ['status', 'output'], label, recordIndex);
    validateJsonValue(result.output, `${label}.output`, 0, jsonContext, recordIndex);
    return result as unknown as RuntimeToolResultPayload;
  }
  if (result.status === 'failed') {
    expectKeys(result, ['status', 'code', 'message'], ['details'], label, recordIndex);
    expectSafeMetadata(result.code, `${label}.code`, recordIndex);
    expectSafeContentText(result.message, `${label}.message`, recordIndex, MAX_STRING_CODE_UNITS, false);
    if (hasOwn(result, 'details')) {
      validateJsonValue(result.details, `${label}.details`, 0, jsonContext, recordIndex);
    }
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
  const content = expectPlainDataArray(
    value.content,
    `${label}.content`,
    MAX_JSON_ARRAY_ITEMS,
    recordIndex,
  );
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

function parseAssistantMessage(
  value: Record<string, unknown>,
  label: string,
  jsonContext: JsonValidationContext,
  recordIndex?: number,
): RuntimeAssistantMessage {
  expectKeys(
    value,
    ['schemaVersion', 'id', 'createdAt', 'defTurnId', 'turnId', 'role', 'content', 'providerId', 'modelId', 'usage', 'stopReason', 'completedAt'],
    ['responseId', 'diagnostic'],
    label,
    recordIndex,
  );
  if (value.role !== 'assistant') invalid(`${label}.role`, 'expected assistant', recordIndex);
  const untrustedContent = expectPlainDataArray(
    value.content,
    `${label}.content`,
    MAX_JSON_ARRAY_ITEMS,
    recordIndex,
  );
  const content = untrustedContent.map((item, index) => (
    parseAssistantContent(item, `${label}.content[${index}]`, jsonContext, recordIndex)
  ));
  expectSafeMetadata(value.providerId, `${label}.providerId`, recordIndex);
  expectSafeMetadata(value.modelId, `${label}.modelId`, recordIndex);
  if (hasOwn(value, 'responseId')) expectSafeMetadata(value.responseId, `${label}.responseId`, recordIndex);
  const usage = parseUsage(value.usage, `${label}.usage`, recordIndex);
  if (typeof value.stopReason !== 'string' || !MESSAGE_STOP_REASONS.has(value.stopReason as RuntimeAssistantMessage['stopReason'])) {
    invalid(`${label}.stopReason`, 'unsupported stop reason', recordIndex);
  }
  const stopReason = value.stopReason as RuntimeAssistantMessage['stopReason'];
  const hasToolCall = content.some((block) => block.type === 'tool-call');
  if (stopReason === 'tool-use' && !hasToolCall) {
    invalid(`${label}.stopReason`, 'tool-use requires a Tool call', recordIndex);
  }
  if (stopReason !== 'tool-use' && hasToolCall) {
    invalid(`${label}.stopReason`, 'Tool calls require tool-use', recordIndex);
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
    content,
    providerId: value.providerId as string,
    modelId: value.modelId as string,
    ...(hasOwn(value, 'responseId') ? { responseId: value.responseId as string } : {}),
    usage,
    stopReason,
    ...(diagnostic ? { diagnostic } : {}),
    completedAt: value.completedAt as string,
  };
}

function parseToolResultMessage(
  value: Record<string, unknown>,
  label: string,
  jsonContext: JsonValidationContext,
  recordIndex?: number,
): RuntimeToolResultMessage {
  expectExactKeys(
    value,
    ['schemaVersion', 'id', 'createdAt', 'defTurnId', 'turnId', 'role', 'toolCallId', 'toolName', 'result', 'completedAt'],
    label,
    recordIndex,
  );
  if (value.role !== 'tool-result') invalid(`${label}.role`, 'expected tool-result', recordIndex);
  expectIdentifier(value.toolCallId, `${label}.toolCallId`, recordIndex);
  expectSafeMetadata(value.toolName, `${label}.toolName`, recordIndex);
  const result = parseResult(value.result, `${label}.result`, jsonContext, recordIndex);
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

function parseRuntimeMessage(
  value: unknown,
  label: string,
  jsonContext: JsonValidationContext,
  recordIndex?: number,
): RuntimeTurnMessage {
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
    parsed = parseAssistantMessage(message, label, jsonContext, recordIndex);
  } else if (message.role === 'tool-result') {
    parsed = parseToolResultMessage(message, label, jsonContext, recordIndex);
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
  expectSafeMetadata(header.runtimeVersion, `${label}.runtimeVersion`, recordIndex);
  expectSafeMetadata(header.providerProfileRef, `${label}.providerProfileRef`, recordIndex);
  expectSafeMetadata(header.systemPromptVersion, `${label}.systemPromptVersion`, recordIndex);
  expectDateText(header.createdAt, `${label}.createdAt`, recordIndex);
  return header as unknown as RuntimeSessionHeader;
}

function parseEntryBase(value: Record<string, unknown>, label: string, recordIndex?: number): void {
  if (value.schemaVersion !== RUNTIME_SESSION_SCHEMA_VERSION) invalid(`${label}.schemaVersion`, 'unsupported schema', recordIndex);
  expectIdentifier(value.id, `${label}.id`, recordIndex);
  if (value.parentId !== null) expectIdentifier(value.parentId, `${label}.parentId`, recordIndex);
  expectDateText(value.createdAt, `${label}.createdAt`, recordIndex);
}

function parseEntry(
  value: unknown,
  label: string,
  jsonContext: JsonValidationContext,
  recordIndex?: number,
): RuntimeSessionEntry {
  const entry = expectRecord(value, label, recordIndex);
  if (entry.type === 'session') invalid(`${label}.type`, 'header is only allowed as the first record', recordIndex);
  if (typeof entry.type !== 'string') invalid(`${label}.type`, 'expected a record type', recordIndex);
  parseEntryBase(entry, label, recordIndex);
  if (entry.type === 'message') {
    expectExactKeys(entry, ['schemaVersion', 'id', 'parentId', 'createdAt', 'type', 'message'], label, recordIndex);
    parseRuntimeMessage(entry.message, `${label}.message`, jsonContext, recordIndex);
    return entry as unknown as RuntimeMessageEntry & { message: RuntimeTurnMessage };
  }
  if (entry.type === 'model-change') {
    expectExactKeys(entry, ['schemaVersion', 'id', 'parentId', 'createdAt', 'type', 'providerProfileRef', 'providerId', 'modelId'], label, recordIndex);
    expectSafeMetadata(entry.providerProfileRef, `${label}.providerProfileRef`, recordIndex);
    expectSafeMetadata(entry.providerId, `${label}.providerId`, recordIndex);
    expectSafeMetadata(entry.modelId, `${label}.modelId`, recordIndex);
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
    expectSafeContentText(
      entry.summary,
      `${label}.summary`,
      recordIndex,
      RUNTIME_SESSION_LIMITS.maxSummaryCodeUnits,
      false,
    );
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
    expectSafeMetadata(terminal.code, `${label}.code`, recordIndex);
    expectSafeContentText(terminal.message, `${label}.message`, recordIndex, MAX_STRING_CODE_UNITS, false);
    return terminal as unknown as RuntimeRunMarkerTerminal;
  }
  expectKeys(terminal, ['status', 'code'], ['message'], label, recordIndex);
  expectSafeMetadata(terminal.code, `${label}.code`, recordIndex);
  if (hasOwn(terminal, 'message')) {
    expectSafeContentText(terminal.message, `${label}.message`, recordIndex, MAX_STRING_CODE_UNITS, false);
  }
  return terminal as unknown as RuntimeRunMarkerTerminal;
}

/** Parse one untrusted JSON value into the frozen Runtime Session union. */
function parseRuntimeSessionRecordUnsafe(value: unknown, recordIndex = 0): RuntimeSessionRecord {
  const record = expectRecord(value, `record[${recordIndex}]`, recordIndex);
  if (record.type === 'session') return parseHeader(record, `record[${recordIndex}]`, recordIndex);
  return parseEntry(
    record,
    `record[${recordIndex}]`,
    createJsonValidationContext(),
    recordIndex,
  );
}

export function parseRuntimeSessionRecord(value: unknown, recordIndex = 0): RuntimeSessionRecord {
  return parseRuntimeSessionRecordUnsafe(value, recordIndex);
}

export const parseSessionRecord = parseRuntimeSessionRecord;

export function validateRuntimeSessionHeader(value: unknown): RuntimeSessionHeader {
  const record = parseRuntimeSessionRecordUnsafe(value);
  if (record.type !== 'session') invalid('session header', 'expected a session header');
  return record;
}

export const validateSessionHeader = validateRuntimeSessionHeader;

interface MutableRunState {
  readonly runId: RuntimeRunId;
  readonly defTurnId: DefTurnId;
  turnId: RuntimeTurnId;
  readonly startEntryId: RuntimeEntryId;
  endEntryId: RuntimeEntryId | null;
  status: RuntimeRunState['status'];
  unresolvedToolCallIds: ToolCallId[];
  readonly seenTurnIds: Set<RuntimeTurnId>;
}

interface ToolCallReference {
  readonly toolCallId: ToolCallId;
  readonly runId: RuntimeRunId;
  readonly defTurnId: DefTurnId;
  readonly turnId: RuntimeTurnId;
  readonly name: string;
  readonly entryIndex: number;
}

interface CompletedToolPair {
  readonly callIndex: number;
  readonly resultIndex: number;
}

export interface SessionValidationMetrics {
  parsedRecords: number;
  relationEntries: number;
  committedEntries: number;
  projectedEntries: number;
}

export function createSessionValidationMetrics(): SessionValidationMetrics {
  return { parsedRecords: 0, relationEntries: 0, committedEntries: 0, projectedEntries: 0 };
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

function preflightParentGraph(entries: readonly RuntimeSessionEntry[]): void {
  const indices = new Map<RuntimeEntryId, number>();
  for (const [index, entry] of entries.entries()) {
    if (indices.has(entry.id)) invalid(`record[${index + 1}].id`, 'duplicate entry id', index + 1);
    indices.set(entry.id, index);
  }
  const parents = new Int32Array(entries.length);
  parents.fill(-1);
  for (const [index, entry] of entries.entries()) {
    if (entry.parentId === null) continue;
    const parent = indices.get(entry.parentId);
    if (parent === undefined) invalid(`record[${index + 1}].parentId`, 'unknown parent', index + 1);
    parents[index] = parent;
  }
  const state = new Uint8Array(entries.length);
  for (let start = 0; start < entries.length; start += 1) {
    if (state[start] !== 0) continue;
    const path: number[] = [];
    let current = start;
    while (current >= 0 && state[current] === 0) {
      state[current] = 1;
      path.push(current);
      current = parents[current]!;
    }
    if (current >= 0 && state[current] === 1) {
      invalid(`record[${start + 1}].parentId`, 'parent cycle', start + 1);
    }
    for (const index of path) state[index] = 2;
  }
}

export interface PreparedSessionEntry {
  readonly entry: RuntimeSessionEntry;
  commit(): void;
}

/**
 * Mutable append cursor used after one O(n) reopen validation. Every prepare /
 * commit touches only the incoming entry plus bounded indexes; it never copies
 * or revalidates the durable prefix.
 */
export class SessionValidationCursor {
  readonly #header: RuntimeSessionHeader;
  readonly #entries: RuntimeSessionEntry[] = [];
  readonly #records: RuntimeSessionRecord[];
  readonly #entryIndex = new Map<RuntimeEntryId, number>();
  readonly #messageIds = new Set<string>();
  readonly #clientTurnIds = new Set<ClientTurnId>();
  readonly #contentIds = new Set<RuntimeContentId>();
  readonly #toolCallIds = new Set<ToolCallId>();
  readonly #pendingToolCalls: ToolCallReference[] = [];
  readonly #unresolvedToolCalls = new Set<ToolCallId>();
  readonly #completedToolPairs: CompletedToolPair[] = [];
  readonly #runIds = new Set<RuntimeRunId>();
  readonly #runtimeToDef = new Map<RuntimeTurnId, DefTurnId>();
  readonly #runs: MutableRunState[] = [];
  readonly #interruptedRuns: InterruptedRuntimeRun[] = [];
  readonly #metrics: SessionValidationMetrics;
  #activeRun: MutableRunState | null = null;

  constructor(header: RuntimeSessionHeader, metrics = createSessionValidationMetrics()) {
    this.#header = header;
    this.#records = [header];
    this.#metrics = metrics;
  }

  get header(): RuntimeSessionHeader {
    return this.#header;
  }

  get entries(): readonly RuntimeSessionEntry[] {
    return this.#entries;
  }

  get records(): readonly RuntimeSessionRecord[] {
    return this.#records;
  }

  get leafId(): RuntimeEntryId | null {
    return this.#entries.at(-1)?.id ?? null;
  }

  get updatedAt(): string {
    return this.#entries.at(-1)?.createdAt ?? this.#header.createdAt;
  }

  get metrics(): SessionValidationMetrics {
    return this.#metrics;
  }

  prepare(value: unknown, recordIndex = this.#records.length): PreparedSessionEntry {
    const parsed = parseRuntimeSessionRecordUnsafe(value, recordIndex);
    this.#metrics.parsedRecords += 1;
    if (parsed.type === 'session') {
      invalid(`record[${recordIndex}]`, 'a session header cannot be appended', recordIndex);
    }
    return this.#prepareParsed(parsed, recordIndex);
  }

  #prepareParsed(entry: RuntimeSessionEntry, recordIndex: number): PreparedSessionEntry {
    this.#metrics.relationEntries += 1;
    const zeroBasedIndex = this.#entries.length;
    if (this.#entryIndex.has(entry.id)) invalid(`record[${recordIndex}].id`, 'duplicate entry id', recordIndex);
    const expectedParent = this.#entries.at(-1)?.id ?? null;
    if (entry.parentId !== expectedParent) {
      if (entry.parentId === entry.id) invalid(`record[${recordIndex}].parentId`, 'parent cycle', recordIndex);
      if (entry.parentId !== null && !this.#entryIndex.has(entry.parentId)) {
        invalid(`record[${recordIndex}].parentId`, 'unknown parent', recordIndex);
      }
      invalid(`record[${recordIndex}].parentId`, 'parent must equal the current leaf', recordIndex);
    }

    const updates: Array<() => void> = [];
    const associateRuntimeTurn = (defTurnId: DefTurnId, turnId: RuntimeTurnId): void => {
      const previous = this.#runtimeToDef.get(turnId);
      if (previous !== undefined && previous !== defTurnId) {
        invalid(`record[${recordIndex}].turnId`, 'RuntimeTurnId maps to multiple DefTurnIds', recordIndex);
      }
      if (previous === undefined) updates.push(() => this.#runtimeToDef.set(turnId, defTurnId));
    };

    let nextTurn: RuntimeTurnId | null = null;
    const assertActiveMessage = (message: RuntimeTurnMessage): MutableRunState => {
      const run = this.#activeRun;
      if (!run) invalid(`record[${recordIndex}].message`, 'message is outside a run', recordIndex);
      if (message.defTurnId !== run.defTurnId) {
        invalid(`record[${recordIndex}].message`, 'message DefTurnId does not match the active run', recordIndex);
      }
      associateRuntimeTurn(message.defTurnId, message.turnId);
      if (message.turnId !== run.turnId) {
        if (run.seenTurnIds.has(message.turnId)) {
          invalid(`record[${recordIndex}].message.turnId`, 'a prior RuntimeTurn cannot resume', recordIndex);
        }
        nextTurn = message.turnId;
        updates.push(() => {
          run.seenTurnIds.add(message.turnId);
          run.turnId = message.turnId;
        });
      }
      return run;
    };

    if (entry.type === 'compaction') {
      if (this.#pendingToolCalls.length > 0 || this.#unresolvedToolCalls.size > 0) {
        invalid(`record[${recordIndex}]`, 'compaction cannot cross an unresolved Tool call', recordIndex);
      }
      const anchorIndex = this.#entryIndex.get(entry.firstKeptEntryId);
      if (anchorIndex === undefined) {
        invalid(`record[${recordIndex}].firstKeptEntryId`, 'unknown entry', recordIndex);
      }
      if (anchorIndex >= zeroBasedIndex) {
        invalid(`record[${recordIndex}].firstKeptEntryId`, 'anchor must precede compaction', recordIndex);
      }
      // The first format is deliberately linear. Consequently every earlier
      // entry is on the selected parent lineage, but an anchor still may not
      // split a completed Tool call/result interval.
      let low = 0;
      let high = this.#completedToolPairs.length;
      while (low < high) {
        const middle = (low + high) >>> 1;
        if (this.#completedToolPairs[middle]!.callIndex < anchorIndex) low = middle + 1;
        else high = middle;
      }
      const pair = this.#completedToolPairs[low - 1];
      if (pair && pair.callIndex < anchorIndex && pair.resultIndex >= anchorIndex) {
        invalid(`record[${recordIndex}].firstKeptEntryId`, 'anchor cuts a Tool call/result pair', recordIndex);
      }
    } else if (entry.type === 'run-marker') {
      if (entry.phase === 'start') {
        if (this.#pendingToolCalls.length > 0) {
          invalid(`record[${recordIndex}]`, 'a Tool result is required before another entry', recordIndex);
        }
        if (this.#activeRun) invalid(`record[${recordIndex}].runId`, 'runs cannot overlap', recordIndex);
        if (this.#runIds.has(entry.runId)) invalid(`record[${recordIndex}].runId`, 'duplicate run id', recordIndex);
        associateRuntimeTurn(entry.defTurnId, entry.turnId);
        const run: MutableRunState = {
          runId: entry.runId,
          defTurnId: entry.defTurnId,
          turnId: entry.turnId,
          startEntryId: entry.id,
          endEntryId: null,
          status: 'active',
          unresolvedToolCallIds: [],
          seenTurnIds: new Set([entry.turnId]),
        };
        updates.push(() => {
          this.#runIds.add(entry.runId);
          this.#runs.push(run);
          this.#activeRun = run;
        });
      } else {
        const run = this.#activeRun;
        if (!run) invalid(`record[${recordIndex}].runId`, 'run end has no active start', recordIndex);
        if (entry.runId !== run.runId || entry.defTurnId !== run.defTurnId || entry.turnId !== run.turnId) {
          invalid(`record[${recordIndex}].runId`, 'run end does not match the active run and its last observed turn', recordIndex);
        }
        const status = entry.terminal.status;
        if (this.#pendingToolCalls.length > 0 && status !== 'aborted' && status !== 'interrupted') {
          invalid(`record[${recordIndex}].terminal`, 'run ended with an unmatched tool call', recordIndex);
        }
        const unresolved = this.#pendingToolCalls.map((call) => call.toolCallId);
        updates.push(() => {
          run.endEntryId = entry.id;
          run.status = status;
          run.unresolvedToolCallIds = unresolved;
          if (status === 'interrupted') this.#interruptedRuns.push(immutableInterruptedRun(run));
          for (const toolCallId of unresolved) this.#unresolvedToolCalls.add(toolCallId);
          this.#pendingToolCalls.length = 0;
          this.#activeRun = null;
        });
      }
    } else if (entry.type === 'message') {
      const message = entry.message;
      if (this.#messageIds.has(message.id)) {
        invalid(`record[${recordIndex}].message.id`, 'duplicate message id', recordIndex);
      }
      const run = assertActiveMessage(message);
      updates.push(() => this.#messageIds.add(message.id));

      if (message.role !== 'tool-result' && this.#pendingToolCalls.length > 0) {
        invalid(`record[${recordIndex}].message`, 'a Tool result is required before another message', recordIndex);
      }

      if (message.role === 'user') {
        if (this.#clientTurnIds.has(message.clientTurnId)) {
          invalid(`record[${recordIndex}].message.clientTurnId`, 'duplicate client turn id', recordIndex);
        }
        updates.push(() => this.#clientTurnIds.add(message.clientTurnId));
      }

      if (message.role === 'assistant' || message.role === 'user') {
        const localContentIds = new Set<RuntimeContentId>();
        const localToolCallIds = new Set<ToolCallId>();
        const calls: ToolCallReference[] = [];
        for (const block of message.content) {
          if (this.#contentIds.has(block.id) || localContentIds.has(block.id)) {
            invalid(`record[${recordIndex}].message`, 'duplicate content id', recordIndex);
          }
          localContentIds.add(block.id);
          if (message.role !== 'assistant' || block.type !== 'tool-call') continue;
          if (this.#toolCallIds.has(block.toolCallId) || localToolCallIds.has(block.toolCallId)) {
            invalid(`record[${recordIndex}].message`, 'duplicate tool call id', recordIndex);
          }
          localToolCallIds.add(block.toolCallId);
          calls.push({
            toolCallId: block.toolCallId,
            runId: run.runId,
            defTurnId: run.defTurnId,
            // Pi's message ordering is retained, while DEF binds each call to
            // the RuntimeTurn that emitted it rather than the run's first turn.
            turnId: message.turnId,
            name: block.name,
            entryIndex: zeroBasedIndex,
          });
        }
        updates.push(() => {
          for (const id of localContentIds) this.#contentIds.add(id);
          for (const id of localToolCallIds) this.#toolCallIds.add(id);
          this.#pendingToolCalls.push(...calls);
        });
      } else {
        const call = this.#pendingToolCalls[0];
        if (!call || call.toolCallId !== message.toolCallId) {
          invalid(`record[${recordIndex}].message.toolCallId`, 'Tool results must follow call order', recordIndex);
        }
        const observedTurn = nextTurn ?? run.turnId;
        if (
          call.runId !== run.runId
          || call.defTurnId !== message.defTurnId
          || call.turnId !== message.turnId
          || call.turnId !== observedTurn
          || call.name !== message.toolName
        ) {
          invalid(`record[${recordIndex}].message`, 'tool result does not match its call', recordIndex);
        }
        updates.push(() => {
          this.#pendingToolCalls.shift();
          this.#completedToolPairs.push({ callIndex: call.entryIndex, resultIndex: zeroBasedIndex });
        });
      }
    } else if (this.#pendingToolCalls.length > 0) {
      invalid(`record[${recordIndex}]`, 'a Tool result is required before another entry', recordIndex);
    }

    const expectedLength = this.#entries.length;
    let committed = false;
    return {
      entry,
      commit: (): void => {
        if (committed || this.#entries.length !== expectedLength) {
          throw new SessionValidationError('Prepared Session entry is stale.', recordIndex);
        }
        for (const update of updates) update();
        this.#entryIndex.set(entry.id, zeroBasedIndex);
        this.#entries.push(entry);
        this.#records.push(entry);
        this.#metrics.committedEntries += 1;
        committed = true;
      },
    };
  }

  snapshot(): ValidatedSession {
    this.#metrics.projectedEntries += this.#entries.length;
    const lifecycle = this.lifecycleSnapshot();
    return {
      header: this.#header,
      entries: [...this.#entries],
      records: [...this.#records],
      updatedAt: this.updatedAt,
      leafId: this.leafId,
      ...lifecycle,
    };
  }

  lifecycleSnapshot(): Pick<ValidatedSession, 'runs' | 'interruptedRuns'> {
    const runs = this.#runs.map((run) => {
      const immutable = immutableRunState(run);
      return run === this.#activeRun ? { ...immutable, status: 'interrupted' as const } : immutable;
    });
    const interruptedRuns = [...this.#interruptedRuns];
    if (this.#activeRun) {
      interruptedRuns.push(immutableInterruptedRun({
        ...this.#activeRun,
        unresolvedToolCallIds: this.#pendingToolCalls.map((call) => call.toolCallId),
      }));
    }
    return { runs, interruptedRuns };
  }
}

function createSessionValidationCursorUnsafe(
  value: unknown,
  metrics = createSessionValidationMetrics(),
): SessionValidationCursor {
  if (!Array.isArray(value) || value.length === 0) {
    invalid('session.records', 'expected a non-empty array');
  }
  const untrustedRecords = expectPlainDataArray(
    value,
    'session.records',
    RUNTIME_SESSION_LIMITS.maxEntries + 1,
  );
  const records: RuntimeSessionRecord[] = [];
  for (const [index, record] of untrustedRecords.entries()) {
    const parsed = parseRuntimeSessionRecordUnsafe(record, index);
    metrics.parsedRecords += 1;
    if (index > 0 && parsed.type === 'session') {
      invalid(`record[${index}]`, 'only the first record may be a session header', index);
    }
    records.push(parsed);
  }
  const header = records[0];
  if (!header || header.type !== 'session') invalid('record[0]', 'session header is required', 0);
  const entries = records.slice(1) as RuntimeSessionEntry[];
  preflightParentGraph(entries);
  const cursor = new SessionValidationCursor(header, metrics);
  for (const [index, entry] of entries.entries()) cursor.prepare(entry, index + 1).commit();
  return cursor;
}

export function createSessionValidationCursor(
  value: unknown,
  metrics = createSessionValidationMetrics(),
): SessionValidationCursor {
  return createSessionValidationCursorUnsafe(value, metrics);
}

/** Validate a complete in-memory session, including all cross-record links. */
export function validateSessionRecords(value: unknown): ValidatedSession {
  return createSessionValidationCursor(value).snapshot();
}

export const validateSession = validateSessionRecords;

/** Validate a single entry before it is considered for append. */
export function validateRuntimeSessionEntry(value: unknown, recordIndex = 1): RuntimeSessionEntry {
  const record = parseRuntimeSessionRecordUnsafe(value, recordIndex);
  if (record.type === 'session') invalid(`record[${recordIndex}]`, 'a session header cannot be appended', recordIndex);
  return record;
}

export const validateSessionEntry = validateRuntimeSessionEntry;

export function containsSecretShapedContent(value: unknown): boolean {
  try {
    validateJsonValue(value, 'value', 0, createJsonValidationContext());
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
