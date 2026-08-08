/**
 * DEF-owned append-only Session record contract.
 *
 * The header/parent-entry shape is adapted from pi-mono
 * packages/coding-agent/src/core/session-manager.ts at
 * e47b8e37a6211ebd0b2942fa87059d64f81eec02. DEF removes CLI extension,
 * label, branch-summary, and UI-only records while retaining parent ids for a
 * future non-breaking branch/fork feature.
 */
import type { DefSessionId, DefTurnId } from '../../../core/contracts/ids.ts';
import type {
  RuntimeCompactionReason,
  RuntimeTurnMessage,
  RuntimeUsage,
} from '../messages.ts';
import type {
  RuntimeEntryId,
  RuntimeRunId,
  RuntimeSessionId,
  RuntimeTurnId,
} from '../ids.ts';

export const RUNTIME_SESSION_SCHEMA_VERSION = 1 as const;

export const RUNTIME_SESSION_LIMITS = Object.freeze({
  maxLineCodeUnits: 2 * 1_024 * 1_024,
  maxEntries: 1_048_576,
  maxMessageCodeUnits: 1 * 1_024 * 1_024,
  maxSummaryCodeUnits: 256 * 1_024,
});

export interface RuntimeSessionHeader {
  readonly type: 'session';
  readonly schemaVersion: typeof RUNTIME_SESSION_SCHEMA_VERSION;
  readonly runtimeSessionId: RuntimeSessionId;
  readonly defSessionId: DefSessionId;
  readonly runtimeVersion: string;
  readonly providerProfileRef: string;
  readonly systemPromptVersion: string;
  readonly createdAt: string;
}

interface RuntimeSessionEntryBase {
  readonly schemaVersion: typeof RUNTIME_SESSION_SCHEMA_VERSION;
  readonly id: RuntimeEntryId;
  readonly parentId: RuntimeEntryId | null;
  readonly createdAt: string;
}

export interface RuntimeMessageEntry extends RuntimeSessionEntryBase {
  readonly type: 'message';
  /** Compaction is persisted only as RuntimeCompactionEntry, never duplicated here. */
  readonly message: RuntimeTurnMessage;
}

export interface RuntimeModelChangeEntry extends RuntimeSessionEntryBase {
  readonly type: 'model-change';
  readonly providerProfileRef: string;
  readonly providerId: string;
  readonly modelId: string;
}

export type RuntimeThinkingLevel = 'off' | 'low' | 'medium' | 'high';

export interface RuntimeThinkingChangeEntry extends RuntimeSessionEntryBase {
  readonly type: 'thinking-change';
  readonly level: RuntimeThinkingLevel;
}

export interface RuntimeCompactionEntry extends RuntimeSessionEntryBase {
  readonly type: 'compaction';
  readonly summary: string;
  readonly firstKeptEntryId: RuntimeEntryId;
  readonly tokensBefore: number;
  readonly reason: RuntimeCompactionReason;
  readonly usage?: RuntimeUsage;
}

export type RuntimeRunMarkerTerminal =
  | { readonly status: 'completed' }
  | { readonly status: 'failed'; readonly code: string; readonly message: string }
  | { readonly status: 'aborted'; readonly code: string; readonly message?: string }
  | { readonly status: 'interrupted'; readonly code: string; readonly message: string };

export type RuntimeRunMarkerEntry = RuntimeSessionEntryBase & (
  | {
      readonly type: 'run-marker';
      readonly phase: 'start';
      readonly defTurnId: DefTurnId;
      readonly runId: RuntimeRunId;
      readonly turnId: RuntimeTurnId;
    }
  | {
      readonly type: 'run-marker';
      readonly phase: 'end';
      readonly defTurnId: DefTurnId;
      readonly runId: RuntimeRunId;
      readonly turnId: RuntimeTurnId;
      readonly terminal: RuntimeRunMarkerTerminal;
    }
);

export type RuntimeSessionEntry =
  | RuntimeMessageEntry
  | RuntimeModelChangeEntry
  | RuntimeThinkingChangeEntry
  | RuntimeCompactionEntry
  | RuntimeRunMarkerEntry;

export type RuntimeSessionRecord = RuntimeSessionHeader | RuntimeSessionEntry;
