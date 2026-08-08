/**
 * Lightweight durable Session compaction.
 *
 * Compaction is append-only: a summary is generated first, then one validated
 * RuntimeCompactionEntry is appended.  The original transcript is never
 * rewritten or deleted, so a Provider/summary failure cannot lose history.
 */
import { randomUUID } from 'node:crypto';
import type { DefTurnId } from '../../../core/contracts/ids.ts';
import type {
  RuntimeCompactionMessage,
  RuntimeCompactionReason,
  RuntimeMessage,
  RuntimeUsage,
} from '../messages.ts';
import {
  asRuntimeEntryId,
  asRuntimeMessageId,
  asRuntimeRunId,
  asRuntimeTurnId,
  type RuntimeEntryId,
  type RuntimeRunId,
  type RuntimeTurnId,
} from '../ids.ts';
import type {
  ModelDriver,
  RuntimeModelConnection,
  RuntimeModelRequest,
} from '../provider/model-driver.ts';
import type {
  RuntimeCompactionEntry,
  RuntimeMessageEntry,
  RuntimeSessionEntry,
} from './entries.ts';
import {
  buildCompactionPrompt,
  normalizeCompactionSummary,
} from './compaction-prompt.ts';
import {
  estimateRuntimeContextTokens,
  projectSessionContext,
  type RuntimeSessionSource,
} from './context-builder.ts';

const DEFAULT_THRESHOLD_RATIO = 0.8;
const DEFAULT_RETAIN_LAST_MESSAGES = 4;

export interface CompactionSession {
  readonly entries: readonly RuntimeSessionEntry[];
  append(entry: RuntimeSessionEntry): RuntimeEntryId;
}

export interface CompactionThresholdInput {
  /** Current request usage only; never read from a historical compaction. */
  readonly currentInputTokens?: number;
  readonly currentUsage?: RuntimeUsage;
  readonly contextLimit?: number;
  readonly thresholdTokens?: number;
  readonly thresholdRatio?: number;
  readonly reserveTokens?: number;
}

export interface CompactionThresholdDecision {
  readonly shouldCompact: boolean;
  readonly inputTokens: number | undefined;
  readonly thresholdTokens: number | undefined;
}

export interface CompactionSummaryInput {
  readonly prompt: string;
  readonly messages: readonly RuntimeMessage[];
  readonly signal: AbortSignal;
}

export type CompactionSummarizer = (
  prompt: string,
  signal: AbortSignal,
  messages: readonly RuntimeMessage[],
) => Promise<string> | string;

export interface CompactionOptions extends CompactionThresholdInput {
  readonly session: CompactionSession;
  readonly reason: RuntimeCompactionReason;
  /** A deterministic summary shortcut is useful to a manual caller/test. */
  readonly summary?: string;
  readonly summarize?: CompactionSummarizer;
  readonly modelDriver?: ModelDriver;
  /** Used only for summary generation; it is never persisted. */
  readonly connection?: RuntimeModelConnection;
  readonly signal?: AbortSignal;
  readonly runId?: RuntimeRunId;
  readonly turnId?: RuntimeTurnId;
  readonly defTurnId?: DefTurnId;
  readonly systemPrompt?: string;
  readonly firstKeptEntryId?: RuntimeEntryId;
  readonly retainLastMessages?: number;
  readonly retainTokens?: number;
  readonly summaryEntryId?: RuntimeEntryId;
  readonly now?: () => string;
}

export interface CompactionPlan {
  readonly firstKeptEntryId: RuntimeEntryId;
  readonly firstKeptIndex: number;
  readonly sourceEntries: readonly RuntimeSessionEntry[];
  readonly summaryMessages: readonly RuntimeMessage[];
  readonly prompt: string;
  readonly tokensBefore: number;
}

export type CompactionOutcome =
  | {
      readonly status: 'compacted';
      readonly reason: RuntimeCompactionReason;
      readonly entry: RuntimeCompactionEntry;
      readonly firstKeptEntryId: RuntimeEntryId;
      readonly summary: string;
      readonly tokensBefore: number;
    }
  | {
      readonly status: 'not-needed';
      readonly reason: RuntimeCompactionReason;
      readonly inputTokens?: number;
      readonly thresholdTokens?: number;
    }
  | {
      readonly status: 'failed';
      readonly reason: RuntimeCompactionReason;
      readonly code: string;
      readonly message: string;
    };

export class CompactionError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'CompactionError';
    this.code = code;
  }
}

/** Check only the current request usage. Historical entry.usage is ignored. */
export function checkCompactionThreshold(input: CompactionThresholdInput): CompactionThresholdDecision {
  const inputTokens = nonNegativeInteger(input.currentInputTokens)
    ?? nonNegativeInteger(input.currentUsage?.inputTokens);
  const contextLimit = positiveInteger(input.contextLimit);
  if (inputTokens === undefined || contextLimit === undefined) {
    return { shouldCompact: false, inputTokens, thresholdTokens: undefined };
  }

  const reserve = nonNegativeInteger(input.reserveTokens) ?? 0;
  const usableLimit = Math.max(1, contextLimit - reserve);
  const explicitThreshold = nonNegativeInteger(input.thresholdTokens);
  const ratio = finiteRatio(input.thresholdRatio) ?? DEFAULT_THRESHOLD_RATIO;
  const thresholdTokens = explicitThreshold ?? Math.max(1, Math.floor(usableLimit * ratio));
  return {
    shouldCompact: inputTokens >= thresholdTokens,
    inputTokens,
    thresholdTokens,
  };
}

export function shouldCompact(input: CompactionThresholdInput): boolean {
  return checkCompactionThreshold(input).shouldCompact;
}

/** Build a summary plan without performing any write or Provider call. */
export function createCompactionPlan(options: Pick<CompactionOptions, 'session' | 'firstKeptEntryId' | 'retainLastMessages' | 'retainTokens' | 'currentInputTokens' | 'currentUsage' | 'systemPrompt'>): CompactionPlan | undefined {
  const projection = projectSessionContext(options.session as RuntimeSessionSource);
  const lineage = projection.lineage;
  const indexById = new Map(lineage.map((entry, index) => [entry.id, index]));
  const latestCompactionIndex = projection.latestCompaction === undefined
    ? -1
    : indexById.get(projection.latestCompaction.id) ?? -1;
  const minimumNewHistoryIndex = latestCompactionIndex + 1;
  const firstKeptIndex = selectFirstKeptIndex(
    lineage,
    minimumNewHistoryIndex,
    options.firstKeptEntryId,
    options.retainLastMessages,
    options.retainTokens,
  );
  if (firstKeptIndex === undefined || firstKeptIndex <= minimumNewHistoryIndex || firstKeptIndex >= lineage.length) {
    return undefined;
  }

  const newHistoryEntries = lineage.slice(minimumNewHistoryIndex, firstKeptIndex);
  const compactedMessages = newHistoryEntries
    .filter((entry): entry is RuntimeMessageEntry => entry.type === 'message')
    .map((entry) => entry.message);
  if (compactedMessages.length === 0) return undefined;

  let sourceEntries: readonly RuntimeSessionEntry[];
  if (projection.latestCompaction === undefined) {
    sourceEntries = Object.freeze(lineage.slice(0, firstKeptIndex));
  } else {
    const previousFirstKeptIndex = indexById.get(projection.latestCompaction.firstKeptEntryId);
    if (previousFirstKeptIndex === undefined) {
      throw new CompactionError('COMPACTION_CONTEXT_INVALID', 'The latest compaction anchor is unavailable.');
    }
    // The latest summary already replaces everything before its anchor. Feed
    // that summary plus only the retained tail and the newly compacted prefix.
    sourceEntries = Object.freeze([
      projection.latestCompaction,
      ...lineage
        .slice(previousFirstKeptIndex, latestCompactionIndex)
        .filter((entry) => entry.type !== 'compaction'),
      ...newHistoryEntries,
    ]);
  }
  const sourceMessages = Object.freeze(sourceEntries.flatMap((entry): readonly RuntimeMessage[] => {
    if (entry.type === 'message') return [entry.message];
    if (entry.type === 'compaction') return [compactionEntryMessage(entry)];
    return [];
  }));

  const prompt = buildCompactionPrompt({ entries: sourceEntries });
  const tokensBefore = nonNegativeInteger(options.currentInputTokens)
    ?? nonNegativeInteger(options.currentUsage?.inputTokens)
    ?? estimateRuntimeContextTokens(options.systemPrompt ?? '', projection.messages);
  const firstKept = lineage[firstKeptIndex];
  if (!firstKept) return undefined;
  return {
    firstKeptEntryId: firstKept.id,
    firstKeptIndex,
    sourceEntries,
    summaryMessages: sourceMessages,
    prompt,
    tokensBefore,
  };
}

/** Generate, validate, and append one compaction entry. */
export async function compactSession(options: CompactionOptions): Promise<CompactionOutcome> {
  const decision = checkCompactionThreshold(options);
  if (options.reason === 'threshold' && !decision.shouldCompact) {
    return {
      status: 'not-needed',
      reason: options.reason,
      ...(decision.inputTokens === undefined ? {} : { inputTokens: decision.inputTokens }),
      ...(decision.thresholdTokens === undefined ? {} : { thresholdTokens: decision.thresholdTokens }),
    };
  }

  let plan: CompactionPlan | undefined;
  try {
    plan = createCompactionPlan(options);
  } catch {
    return failedOutcome(options.reason, 'COMPACTION_CONTEXT_INVALID', 'The current Session context could not be compacted.');
  }
  if (!plan) {
    return {
      status: 'not-needed',
      reason: options.reason,
      ...(decision.inputTokens === undefined ? {} : { inputTokens: decision.inputTokens }),
      ...(decision.thresholdTokens === undefined ? {} : { thresholdTokens: decision.thresholdTokens }),
    };
  }

  const signal = options.signal ?? new AbortController().signal;
  let summary: string | undefined;
  try {
    if (signal.aborted) throw new CompactionError('COMPACTION_ABORTED', 'Compaction was aborted.');
    summary = options.summary === undefined
      ? await generateSummary(options, plan, signal)
      : normalizeCompactionSummary(options.summary);
  } catch (error) {
    if (error instanceof CompactionError && error.code === 'COMPACTION_ABORTED') {
      return failedOutcome(options.reason, error.code, 'Compaction was aborted.');
    }
    return failedOutcome(options.reason, 'COMPACTION_SUMMARY_FAILED', 'Compaction summary generation failed; the Session was left unchanged.');
  }
  if (!summary) {
    return failedOutcome(options.reason, 'COMPACTION_SUMMARY_INVALID', 'Compaction returned an empty or oversized summary; the Session was left unchanged.');
  }

  const summaryEntryId = options.summaryEntryId
    ?? asRuntimeEntryId(`runtime-compaction-${randomUUID()}`);
  const entry: RuntimeCompactionEntry = {
    schemaVersion: 1,
    id: summaryEntryId,
    parentId: options.session.entries.at(-1)?.id ?? null,
    createdAt: options.now?.() ?? new Date().toISOString(),
    type: 'compaction',
    summary,
    firstKeptEntryId: plan.firstKeptEntryId,
    tokensBefore: plan.tokensBefore,
    reason: options.reason,
    ...(options.currentUsage === undefined ? {} : { usage: { ...options.currentUsage } }),
  };

  try {
    options.session.append(entry);
  } catch {
    return failedOutcome(options.reason, 'COMPACTION_APPEND_FAILED', 'Compaction could not be committed; the original Session remains available.');
  }
  return {
    status: 'compacted',
    reason: options.reason,
    entry,
    firstKeptEntryId: entry.firstKeptEntryId,
    summary: entry.summary,
    tokensBefore: entry.tokensBefore,
  };
}

/** Alias for facades that use the noun before the operation. */
export const compactRuntimeSession = compactSession;

async function generateSummary(
  options: CompactionOptions,
  plan: CompactionPlan,
  signal: AbortSignal,
): Promise<string | undefined> {
  if (options.summarize) {
    const generated = await options.summarize(plan.prompt, signal, plan.summaryMessages);
    return normalizeCompactionSummary(generated);
  }
  if (!options.modelDriver || !options.connection) {
    throw new CompactionError('COMPACTION_SUMMARIZER_MISSING', 'A compaction summarizer is required.');
  }

  const summaryEntryId = options.summaryEntryId
    ?? asRuntimeEntryId(`runtime-compaction-${randomUUID()}`);
  const request: RuntimeModelRequest = {
    runId: options.runId ?? asRuntimeRunId(`runtime-compaction-run-${summaryEntryId}`),
    turnId: options.turnId ?? asRuntimeTurnId(`runtime-compaction-turn-${summaryEntryId}`),
    connection: options.connection,
    systemPrompt: plan.prompt,
    messages: Object.freeze([]),
    tools: Object.freeze([]),
    signal,
  };
  const stream = options.modelDriver.stream(request);
  const deltas = new Map<number, string>();
  const completed = new Map<number, string>();
  let sawDone = false;
  for await (const event of stream) {
    if (signal.aborted) throw new CompactionError('COMPACTION_ABORTED', 'Compaction was aborted.');
    if (event.type === 'text.delta') {
      deltas.set(event.contentIndex, `${deltas.get(event.contentIndex) ?? ''}${event.delta}`);
    } else if (event.type === 'text.end') {
      completed.set(event.contentIndex, event.text);
    } else if (event.type === 'response.done') {
      sawDone = true;
    } else if (event.type === 'response.error') {
      throw new CompactionError('COMPACTION_PROVIDER_FAILED', 'The Provider failed while creating a compaction summary.');
    }
  }
  if (!sawDone && completed.size === 0 && deltas.size === 0) return undefined;
  const indexes = new Set([...deltas.keys(), ...completed.keys()]);
  return [...indexes].sort((left, right) => left - right)
    .map((index) => completed.get(index) ?? deltas.get(index) ?? '')
    .join('');
}

function selectFirstKeptIndex(
  lineage: readonly RuntimeSessionEntry[],
  minimumNewHistoryIndex: number,
  explicit: RuntimeEntryId | undefined,
  retainLastMessages: number | undefined,
  retainTokens: number | undefined,
): number | undefined {
  if (explicit !== undefined) {
    const index = lineage.findIndex((entry) => entry.id === explicit);
    if (index < 0 || index <= minimumNewHistoryIndex || index >= lineage.length) return undefined;
    const atomic = atomicBoundaryIndex(lineage, index);
    return atomic === index ? index : atomic;
  }

  const candidates = lineage
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry, index }) => index >= minimumNewHistoryIndex && entry.type === 'message');
  if (candidates.length < 2) return undefined;

  if (retainTokens !== undefined && Number.isFinite(retainTokens) && retainTokens >= 0) {
    let total = 0;
    let selectedStart = candidates.length - 1;
    for (; selectedStart >= 0; selectedStart -= 1) {
      total += entryTokenEstimate(candidates[selectedStart]!.entry);
      if (total >= Math.floor(retainTokens)) break;
    }
    const selected = candidates[Math.max(0, selectedStart)];
    return selected?.index;
  }

  const keep = Math.max(
    1,
    Math.floor(nonNegativeInteger(retainLastMessages) ?? DEFAULT_RETAIN_LAST_MESSAGES),
  );
  const selected = candidates[Math.max(0, candidates.length - keep)];
  return selected?.index;
}

interface ToolPair {
  readonly callIndex: number;
  readonly resultIndex: number;
}

function atomicBoundaryIndex(
  lineage: readonly RuntimeSessionEntry[],
  requestedIndex: number,
): number {
  const calls = new Map<string, number>();
  const pairs: ToolPair[] = [];
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

function entryTokenEstimate(entry: RuntimeSessionEntry): number {
  if (entry.type !== 'message') return 1;
  const serialized = JSON.stringify(entry.message);
  return Math.max(1, Math.ceil(serialized.length / 4));
}

function compactionEntryMessage(entry: RuntimeCompactionEntry): RuntimeCompactionMessage {
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

function failedOutcome(
  reason: RuntimeCompactionReason,
  code: string,
  message: string,
): Extract<CompactionOutcome, { status: 'failed' }> {
  return { status: 'failed', reason, code, message };
}

function nonNegativeInteger(value: number | undefined): number | undefined {
  return value !== undefined && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function positiveInteger(value: number | undefined): number | undefined {
  return value !== undefined && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

function finiteRatio(value: number | undefined): number | undefined {
  return value !== undefined && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : undefined;
}
