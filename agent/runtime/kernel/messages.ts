/**
 * DEF-owned model and transcript messages.
 *
 * Behaviorally derived from pi-mono packages/ai/src/types.ts at
 * e47b8e37a6211ebd0b2942fa87059d64f81eec02. The contract keeps ordered text,
 * reasoning, and tool-call blocks while removing provider- and CLI-specific
 * message variants.
 */
import type { ClientTurnId, DefTurnId, ToolCallId } from '../../core/contracts/ids.ts';
import type { JsonObject, JsonValue } from '../../core/contracts/json.ts';
import type {
  RuntimeContentId,
  RuntimeEntryId,
  RuntimeMessageId,
  RuntimeTurnId,
} from './ids.ts';

export const RUNTIME_MESSAGE_SCHEMA_VERSION = 1 as const;

export interface RuntimeUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
  readonly reasoningTokens?: number;
  readonly cacheReadTokens?: number;
  readonly cacheWriteTokens?: number;
}

export interface RuntimeTextBlock {
  readonly type: 'text';
  readonly id: RuntimeContentId;
  readonly text: string;
}

export interface RuntimeThinkingBlock {
  readonly type: 'thinking';
  readonly id: RuntimeContentId;
  readonly text: string;
  readonly redacted?: boolean;
}

export interface RuntimeFileBlock {
  readonly type: 'file';
  readonly id: RuntimeContentId;
  readonly mime: string;
  readonly filename: string;
  /** A bounded data URL accepted by the existing Agent attachment boundary. */
  readonly url: string;
}

export interface RuntimeToolCallBlock {
  readonly type: 'tool-call';
  readonly id: RuntimeContentId;
  readonly toolCallId: ToolCallId;
  readonly name: string;
  readonly arguments: JsonObject;
}

export type RuntimeUserContent = RuntimeTextBlock | RuntimeFileBlock;
export type RuntimeAssistantContent = RuntimeTextBlock | RuntimeThinkingBlock | RuntimeToolCallBlock;

interface RuntimeMessageBase {
  readonly schemaVersion: typeof RUNTIME_MESSAGE_SCHEMA_VERSION;
  readonly id: RuntimeMessageId;
  readonly createdAt: string;
}

interface RuntimeTurnMessageBase extends RuntimeMessageBase {
  /** Durable correlation to the owning DEF product turn. */
  readonly defTurnId: DefTurnId;
  readonly turnId: RuntimeTurnId;
}

export interface RuntimeUserMessage extends RuntimeTurnMessageBase {
  readonly role: 'user';
  readonly clientTurnId: ClientTurnId;
  readonly content: readonly RuntimeUserContent[];
}

export type RuntimeAssistantStopReason =
  | 'stop'
  | 'length'
  | 'tool-use'
  | 'error'
  | 'aborted';

export interface RuntimeProviderDiagnostic {
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
}

/** Initial assistant state emitted before usage, stop reason, and completion exist. */
export interface RuntimeAssistantMessageDraft extends RuntimeTurnMessageBase {
  readonly role: 'assistant';
  readonly content: readonly [];
  readonly providerId: string;
  readonly modelId: string;
  readonly responseId?: string;
}

export interface RuntimeAssistantMessage extends RuntimeTurnMessageBase {
  readonly role: 'assistant';
  readonly content: readonly RuntimeAssistantContent[];
  readonly providerId: string;
  readonly modelId: string;
  readonly responseId?: string;
  readonly usage: RuntimeUsage;
  readonly stopReason: RuntimeAssistantStopReason;
  readonly diagnostic?: RuntimeProviderDiagnostic;
  readonly completedAt: string;
}

export type RuntimeToolResultPayload =
  | {
      readonly status: 'succeeded';
      readonly output: JsonValue;
    }
  | {
      readonly status: 'failed';
      readonly code: string;
      readonly message: string;
      readonly details?: JsonValue;
    };

export interface RuntimeToolResultMessage extends RuntimeTurnMessageBase {
  readonly role: 'tool-result';
  readonly toolCallId: ToolCallId;
  readonly toolName: string;
  readonly result: RuntimeToolResultPayload;
  readonly completedAt: string;
}

export type RuntimeCompactionReason = 'manual' | 'threshold' | 'overflow';

/**
 * A transcript projection of a durable compaction entry. The Session log stores
 * the canonical entry; this message lets the Runtime/UI expose it without
 * pretending that the summary was a user prompt.
 */
export interface RuntimeCompactionMessage extends RuntimeMessageBase {
  readonly role: 'compaction';
  /** Present for overflow compaction performed inside an active turn. */
  readonly defTurnId?: DefTurnId;
  readonly turnId?: RuntimeTurnId;
  readonly summary: string;
  readonly firstKeptEntryId: RuntimeEntryId;
  readonly tokensBefore: number;
  readonly reason: RuntimeCompactionReason;
  readonly completedAt: string;
}

export type RuntimeTurnMessage =
  | RuntimeUserMessage
  | RuntimeAssistantMessage
  | RuntimeToolResultMessage;

export type RuntimeMessage = RuntimeTurnMessage | RuntimeCompactionMessage;

export type RuntimeMessageStart =
  | RuntimeUserMessage
  | RuntimeToolResultMessage
  | RuntimeCompactionMessage
  | RuntimeAssistantMessageDraft;

export function runtimeToolCalls(message: RuntimeAssistantMessage): readonly RuntimeToolCallBlock[] {
  return message.content.filter((block): block is RuntimeToolCallBlock => block.type === 'tool-call');
}
