/**
 * Pi reference trace normalization.
 *
 * Pi deliberately owns its event and message identifiers, so a golden trace
 * must not compare those identifiers literally. This module maps each
 * identifier namespace by first appearance, drops only the raw event timestamp,
 * and then validates the resulting DEF trace with the frozen F0 parser.
 */
import { createHash } from 'node:crypto';
import type { AgentTrace, AgentTraceEventType, AgentTraceSource } from './trace-schema.ts';
import { parseAgentTrace } from './trace-schema.ts';

export const PI_REFERENCE_COMMIT = 'e47b8e37a6211ebd0b2942fa87059d64f81eec02' as const;
export const PI_REFERENCE_VERSION = '0.84.1' as const;
export const PI_REFERENCE_REPOSITORY = 'https://github.com/earendil-works/pi-mono' as const;

export interface PiRawTraceEvent {
  readonly type: AgentTraceEventType;
  readonly runId: string;
  readonly turnId?: string;
  readonly messageId?: string;
  readonly toolCallId?: string;
  readonly data: unknown;
  /** Raw Pi message timestamps are intentionally not part of the golden trace. */
  readonly timestamp?: number;
}

export interface PiRawTrace {
  readonly schemaVersion: 1;
  readonly scenario: string;
  readonly source: AgentTraceSource;
  readonly events: readonly PiRawTraceEvent[];
}

type IdentifierKind = 'run' | 'turn' | 'message' | 'tool-call';

interface IdentifierMaps {
  readonly run: Map<string, string>;
  readonly turn: Map<string, string>;
  readonly message: Map<string, string>;
  readonly 'tool-call': Map<string, string>;
}

/**
 * Convert an event trace containing Pi-owned ids and timestamps into the
 * stable trace consumed by the F0 parser.
 */
export function normalizePiTrace(value: PiRawTrace): AgentTrace {
  assertPinnedSource(value.source);
  const maps: IdentifierMaps = {
    run: new Map(),
    turn: new Map(),
    message: new Map(),
    'tool-call': new Map(),
  };

  const events = value.events.map((event, index) => {
    if (event.timestamp !== undefined) normalizeTimestamp(event.timestamp, `events[${index}].timestamp`);
    const normalized: Record<string, unknown> = {
      ordinal: index + 1,
      type: event.type,
      runId: normalizeIdentifier(event.runId, 'run', maps),
      data: normalizePayload(event.type, event.data, maps),
    };
    if (event.turnId !== undefined) normalized.turnId = normalizeIdentifier(event.turnId, 'turn', maps);
    if (event.messageId !== undefined) normalized.messageId = normalizeIdentifier(event.messageId, 'message', maps);
    if (event.toolCallId !== undefined) {
      normalized.toolCallId = normalizeIdentifier(event.toolCallId, 'tool-call', maps);
    }
    return normalized;
  });

  // The parser is deliberately called here, before a fixture can be written.
  return parseAgentTrace({
    schemaVersion: 1,
    scenario: value.scenario,
    source: value.source,
    events,
  });
}

/** Stable, newline-terminated JSON used for fixture bytes and hashing. */
export function serializeNormalizedTrace(trace: AgentTrace): string {
  return `${JSON.stringify(sortJsonValue(trace), null, 2)}\n`;
}

export function hashNormalizedTrace(trace: AgentTrace): string {
  return createHash('sha256').update(serializeNormalizedTrace(trace), 'utf8').digest('hex');
}

/** Normalize a raw Pi timestamp without allowing non-finite values into a trace. */
export function normalizeTimestamp(value: unknown, label = 'timestamp'): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new TypeError(`${label} must be a finite non-negative number`);
  }
  return 0;
}

function assertPinnedSource(source: AgentTraceSource): void {
  if (source.kind !== 'pi-reference') throw new TypeError('Pi raw trace source must be pi-reference');
  if (source.commit !== PI_REFERENCE_COMMIT) {
    throw new TypeError(`Pi raw trace must use pinned commit ${PI_REFERENCE_COMMIT}`);
  }
  if (source.version !== PI_REFERENCE_VERSION) {
    throw new TypeError(`Pi raw trace must use Pi version ${PI_REFERENCE_VERSION}`);
  }
}

function normalizeIdentifier(value: string, kind: IdentifierKind, maps: IdentifierMaps): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${kind} identifier must be a non-empty string`);
  }
  const map = maps[kind];
  const existing = map.get(value);
  if (existing) return existing;
  const normalized = `${kind === 'tool-call' ? 'tool-call' : kind}-${map.size + 1}`;
  map.set(value, normalized);
  return normalized;
}

function normalizePayload(type: AgentTraceEventType, value: unknown, maps: IdentifierMaps): unknown {
  if (type !== 'context.snapshot') return value;
  if (!isRecord(value) || !Array.isArray(value.items)) return value;
  return {
    ...value,
    items: value.items.map((item) => normalizeContextItem(item, maps)),
  };
}

function normalizeContextItem(value: unknown, maps: IdentifierMaps): unknown {
  if (!isRecord(value)) return value;
  const normalized: Record<string, unknown> = { ...value };
  if (typeof value.messageId === 'string') {
    normalized.messageId = normalizeIdentifier(value.messageId, 'message', maps);
  }
  if (typeof value.toolCallId === 'string') {
    normalized.toolCallId = normalizeIdentifier(value.toolCallId, 'tool-call', maps);
  }
  return normalized;
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJsonValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortJsonValue(value[key])]),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
