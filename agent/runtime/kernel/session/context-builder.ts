/**
 * Rebuild the model context from the durable Runtime Session log.
 *
 * The log is the only durable transcript.  DEF and Product context is an
 * ephemeral request decoration: it is rendered into systemPrompt on every
 * build and is never copied into a Runtime message or a Session entry.
 */
import type { ProductBinding, ProductSnapshotEnvelope } from '../../../core/contracts/product.ts';
import type { JsonObject, JsonValue } from '../../../core/contracts/json.ts';
import {
  asRuntimeMessageId,
  type RuntimeEntryId,
} from '../ids.ts';
import type {
  RuntimeCompactionMessage,
  RuntimeMessage,
  RuntimeUserMessage,
} from '../messages.ts';
import type {
  RuntimeCompactionEntry,
  RuntimeSessionEntry,
} from './entries.ts';

const MAX_SYSTEM_PROMPT_CODE_UNITS = 64 * 1_024;
const MAX_INSTRUCTION_CODE_UNITS = 16 * 1_024;
const MAX_PRODUCT_SNAPSHOT_CODE_UNITS = 24 * 1_024;
const MAX_JSON_DEPTH = 8;
const MAX_JSON_ITEMS = 128;
const MAX_JSON_KEYS = 128;
const MAX_JSON_STRING_CODE_UNITS = 2_048;

const SECRET_KEY_PATTERN = /(?:api[-_ ]?key|access[-_ ]?token|refresh[-_ ]?token|authorization|bearer|cookie|credential|password|secret|private[-_ ]?key|client[-_ ]?secret|headers?)/iu;
const SECRET_TEXT_PATTERNS: readonly RegExp[] = [
  /authorization\s*:\s*\S+/iu,
  /\bbearer\s+[A-Za-z0-9._~+/=-]{8,}/iu,
  /\b(?:api[-_ ]?key|access[-_ ]?token|refresh[-_ ]?token|client[-_ ]?secret|password|secret)\s*[:=]\s*[^\s,;]{4,}/iu,
];

export interface RuntimeContextInstructions {
  readonly stableSystemPrompt: string;
  readonly defInstructions?: string;
  readonly harnessInstructions?: string;
}

export interface RuntimeProductContext {
  readonly binding: ProductBinding;
  /** The envelope is accepted so callers cannot accidentally persist it. */
  readonly snapshot?: ProductSnapshotEnvelope | JsonObject;
}

export interface RuntimeSessionEntrySource {
  readonly entries: readonly RuntimeSessionEntry[];
}

export type RuntimeSessionSource = readonly RuntimeSessionEntry[] | RuntimeSessionEntrySource;

export interface ContextBuilderInput extends RuntimeContextInstructions {
  /** `session` and `source` are aliases kept for small Runtime facades. */
  readonly entries?: RuntimeSessionSource;
  readonly session?: RuntimeSessionSource;
  readonly source?: RuntimeSessionSource;
  readonly product?: RuntimeProductContext;
  /** A new prompt may be projected for this request without being persisted. */
  readonly currentUserMessage?: RuntimeUserMessage;
}

export interface RuntimeContextProjection {
  readonly lineage: readonly RuntimeSessionEntry[];
  readonly latestCompaction?: RuntimeCompactionEntry;
  readonly firstKeptEntryId?: RuntimeEntryId;
  readonly retainedEntries: readonly RuntimeSessionEntry[];
  readonly messages: readonly RuntimeMessage[];
}

export interface BuiltRuntimeContext extends RuntimeContextProjection {
  readonly systemPrompt: string;
  readonly estimatedInputTokens: number;
}

export class ContextBuilderError extends Error {
  readonly code:
    | 'CONTEXT_SOURCE_MISSING'
    | 'CONTEXT_PARENT_INVALID'
    | 'CONTEXT_COMPACTION_INVALID'
    | 'CONTEXT_BOUNDARY_INVALID'
    | 'CONTEXT_PRODUCT_INVALID';

  constructor(
    code: ContextBuilderError['code'],
    message: string,
  ) {
    super(message);
    this.name = 'ContextBuilderError';
    this.code = code;
  }
}

/**
 * A small state-free facade is convenient for a Runtime Session that keeps
 * its stable prompt version in one place.  Dynamic inputs still belong to
 * each call to build().
 */
export class ContextBuilder {
  readonly #instructions: RuntimeContextInstructions;

  constructor(instructions: RuntimeContextInstructions) {
    this.#instructions = { ...instructions };
  }

  build(input: Omit<ContextBuilderInput, keyof RuntimeContextInstructions>): BuiltRuntimeContext {
    return buildContext({ ...this.#instructions, ...input });
  }
}

/** Build the exact model-facing context for one request. */
export function buildContext(input: ContextBuilderInput): BuiltRuntimeContext {
  const projection = projectSessionContext(resolveEntries(input));
  const messages = input.currentUserMessage === undefined
    || projection.messages.some((message) => message.id === input.currentUserMessage!.id)
    ? projection.messages
    : Object.freeze([...projection.messages, input.currentUserMessage]);
  const systemPrompt = buildSystemPrompt(input);

  return {
    ...projection,
    messages,
    systemPrompt,
    estimatedInputTokens: estimateRuntimeContextTokens(systemPrompt, messages),
  };
}

/** Alias used by callers that name the output after the P1 port. */
export const buildModelContext = buildContext;

/**
 * Project the latest valid compaction and its retained tail.  Control entries
 * remain in retainedEntries for boundary/audit reasoning, while only durable
 * messages are sent to the ModelDriver.
 */
export function projectSessionContext(source: RuntimeSessionSource): RuntimeContextProjection {
  const entries = resolveEntriesFromSource(source);
  const lineage = activeLineage(entries);
  const indexById = new Map(lineage.map((entry, index) => [entry.id, index]));
  const latestCompaction = findLatestCompaction(lineage);

  let firstKeptIndex = 0;
  let firstKeptEntryId: RuntimeEntryId | undefined;
  if (latestCompaction) {
    const compactionIndex = indexById.get(latestCompaction.id);
    const anchorIndex = indexById.get(latestCompaction.firstKeptEntryId);
    if (compactionIndex === undefined || anchorIndex === undefined || anchorIndex >= compactionIndex) {
      throw new ContextBuilderError(
        'CONTEXT_COMPACTION_INVALID',
        'The latest compaction anchor is not an earlier ancestor of the compaction entry.',
      );
    }
    const atomicIndex = atomicBoundaryIndex(lineage, anchorIndex);
    if (atomicIndex !== anchorIndex) {
      throw new ContextBuilderError(
        'CONTEXT_BOUNDARY_INVALID',
        'The latest compaction anchor would split an atomic Tool interaction.',
      );
    }
    firstKeptIndex = anchorIndex;
    firstKeptEntryId = latestCompaction.firstKeptEntryId;
  }

  const retainedEntries = Object.freeze(lineage.slice(firstKeptIndex));
  const messages: RuntimeMessage[] = [];
  if (latestCompaction) messages.push(compactionMessage(latestCompaction));
  for (const entry of retainedEntries) {
    if (entry.type === 'message') messages.push(entry.message);
  }

  return {
    lineage: Object.freeze(lineage.slice()),
    ...(latestCompaction === undefined ? {} : { latestCompaction }),
    ...(firstKeptEntryId === undefined ? {} : { firstKeptEntryId }),
    retainedEntries,
    messages: Object.freeze(messages),
  };
}

/** Return a rough, deterministic token estimate for a request context. */
export function estimateRuntimeContextTokens(
  systemPrompt: string,
  messages: readonly RuntimeMessage[],
): number {
  const serialized = JSON.stringify({ systemPrompt, messages });
  return Math.max(1, Math.ceil((serialized?.length ?? 0) / 4));
}

/** Return the entries exposed by either a SessionLog-like object or an array. */
export function resolveEntriesFromSource(source: RuntimeSessionSource): readonly RuntimeSessionEntry[] {
  if (Array.isArray(source)) return source;
  if (source && Array.isArray(source.entries)) return source.entries;
  throw new ContextBuilderError('CONTEXT_SOURCE_MISSING', 'A Runtime Session entry source is required.');
}

function resolveEntries(input: ContextBuilderInput): RuntimeSessionSource {
  const source = input.entries ?? input.session ?? input.source;
  if (source === undefined) {
    throw new ContextBuilderError('CONTEXT_SOURCE_MISSING', 'ContextBuilder requires Session entries.');
  }
  return source;
}

function activeLineage(entries: readonly RuntimeSessionEntry[]): RuntimeSessionEntry[] {
  if (entries.length === 0) return [];
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const visited = new Set<RuntimeEntryId>();
  const result: RuntimeSessionEntry[] = [];
  let current: RuntimeSessionEntry | undefined = entries.at(-1);
  while (current) {
    if (visited.has(current.id)) {
      throw new ContextBuilderError('CONTEXT_PARENT_INVALID', 'The active Session parent chain contains a cycle.');
    }
    visited.add(current.id);
    result.push(current);
    current = current.parentId === null ? undefined : byId.get(current.parentId);
    if (current === undefined && result.at(-1)?.parentId !== null) {
      throw new ContextBuilderError('CONTEXT_PARENT_INVALID', 'The active Session parent chain contains an unknown ancestor.');
    }
  }
  result.reverse();
  return result;
}

function findLatestCompaction(lineage: readonly RuntimeSessionEntry[]): RuntimeCompactionEntry | undefined {
  for (let index = lineage.length - 1; index >= 0; index -= 1) {
    const entry = lineage[index];
    if (entry?.type === 'compaction') return entry;
  }
  return undefined;
}

function compactionMessage(entry: RuntimeCompactionEntry): RuntimeCompactionMessage {
  return {
    schemaVersion: 1,
    id: asRuntimeMessageId(String(entry.id)),
    createdAt: entry.createdAt,
    role: 'compaction',
    summary: entry.summary,
    firstKeptEntryId: entry.firstKeptEntryId,
    tokensBefore: entry.tokensBefore,
    reason: entry.reason,
    completedAt: entry.createdAt,
  };
}

interface ToolPair {
  readonly callIndex: number;
  readonly resultIndex: number;
}

function atomicBoundaryIndex(
  lineage: readonly RuntimeSessionEntry[],
  requestedIndex: number,
): number {
  const pairs: ToolPair[] = [];
  const calls = new Map<string, number>();
  for (const [index, entry] of lineage.entries()) {
    if (entry.type !== 'message') continue;
    if (entry.message.role === 'assistant') {
      for (const block of entry.message.content) {
        if (block.type === 'tool-call') calls.set(String(block.toolCallId), index);
      }
    } else if (entry.message.role === 'tool-result') {
      const callIndex = calls.get(String(entry.message.toolCallId));
      if (callIndex !== undefined) pairs.push({ callIndex, resultIndex: index });
    }
  }

  let boundary = requestedIndex;
  for (;;) {
    const split = pairs.find((pair) => pair.callIndex < boundary && pair.resultIndex >= boundary);
    if (!split || split.callIndex === boundary) return boundary;
    boundary = split.callIndex;
  }
}

function buildSystemPrompt(input: RuntimeContextInstructions & { readonly product?: RuntimeProductContext }): string {
  const sections: string[] = [];
  const stable = boundedText(input.stableSystemPrompt, MAX_SYSTEM_PROMPT_CODE_UNITS);
  if (stable) sections.push(stable);

  addInstructionSection(sections, 'Current DEF instructions', input.defInstructions);
  addInstructionSection(sections, 'Current Harness instructions', input.harnessInstructions);

  if (input.product) {
    const binding = safeJsonText(input.product.binding, MAX_INSTRUCTION_CODE_UNITS);
    if (!binding) {
      throw new ContextBuilderError('CONTEXT_PRODUCT_INVALID', 'The current ProductBinding could not be rendered.');
    }
    sections.push(`Current ProductBinding (ephemeral; refresh every request):\n${binding}`);

    if (input.product.snapshot !== undefined) {
      const payload = isProductSnapshotEnvelope(input.product.snapshot)
        ? input.product.snapshot.payload
        : input.product.snapshot;
      const snapshot = safeJsonText(payload, MAX_PRODUCT_SNAPSHOT_CODE_UNITS);
      sections.push(
        `Current bounded Product snapshot (ephemeral; never durable history):\n${snapshot || '[empty]'}`,
      );
    }
  }

  return boundedText(sections.join('\n\n'), MAX_SYSTEM_PROMPT_CODE_UNITS);
}

function addInstructionSection(sections: string[], label: string, value: string | undefined): void {
  if (value === undefined) return;
  const bounded = boundedText(value, MAX_INSTRUCTION_CODE_UNITS);
  if (bounded) sections.push(`${label}:\n${bounded}`);
}

function isProductSnapshotEnvelope(value: ProductSnapshotEnvelope | JsonObject): value is ProductSnapshotEnvelope {
  return typeof value === 'object'
    && value !== null
    && !Array.isArray(value)
    && 'payload' in value
    && typeof value.payload === 'object'
    && value.payload !== null
    && !Array.isArray(value.payload);
}

function boundedText(value: string, maximum: number): string {
  const redacted = redactSecrets(value);
  if (redacted.length <= maximum) return redacted;
  return `${redacted.slice(0, Math.max(0, maximum - 24))}\n[context truncated]`;
}

function redactSecrets(value: string): string {
  let result = value;
  for (const pattern of SECRET_TEXT_PATTERNS) result = result.replace(pattern, '[redacted]');
  return result;
}

function safeJsonText(value: unknown, maximum: number): string {
  const seen = new WeakSet<object>();
  const text = encodeJson(value, 0, seen);
  if (text.length <= maximum) return text;
  return `${text.slice(0, Math.max(0, maximum - 24))}\n[context truncated]`;
}

function encodeJson(value: unknown, depth: number, seen: WeakSet<object>): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(redactSecrets(value.slice(0, MAX_JSON_STRING_CODE_UNITS)));
  if (typeof value === 'number' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value !== 'object') return 'null';
  if (depth >= MAX_JSON_DEPTH) return '"[depth limited]"';
  if (seen.has(value)) return '"[cycle omitted]"';
  seen.add(value);

  let encoded: string;
  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_JSON_ITEMS).map((item) => encodeJson(item, depth + 1, seen));
    if (value.length > MAX_JSON_ITEMS) items.push('"[items omitted]"');
    encoded = `[${items.join(',')}]`;
  } else {
    const keys = Object.keys(value).sort().slice(0, MAX_JSON_KEYS);
    const fields: string[] = [];
    for (const key of keys) {
      if (SECRET_KEY_PATTERN.test(key)) continue;
      fields.push(`${JSON.stringify(key)}:${encodeJson((value as Record<string, unknown>)[key], depth + 1, seen)}`);
    }
    if (Object.keys(value).length > MAX_JSON_KEYS) fields.push('"[keys omitted]":"[bounded]"');
    encoded = `{${fields.join(',')}}`;
  }
  seen.delete(value);
  return encoded;
}

// Keep the JsonValue import exercised as a compile-time contract for Product
// payloads without widening the runtime serializer to arbitrary values.
export type RuntimeProductJsonValue = JsonValue;
