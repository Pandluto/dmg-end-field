/**
 * DEF-owned streaming contracts.
 *
 * Event ordering is behaviorally derived from pi-mono AssistantMessageEvent
 * and AgentEvent at e47b8e37a6211ebd0b2942fa87059d64f81eec02. Provider events
 * remain below the Runtime boundary; UI consumers only receive projected
 * Runtime/Conversation events.
 */
import type { DefTurnId, ToolCallId } from '../../core/contracts/ids.ts';
import type { JsonObject, JsonValue } from '../../core/contracts/json.ts';
import type {
  RuntimeAssistantMessage,
  RuntimeAssistantStopReason,
  RuntimeMessage,
  RuntimeMessageStart,
  RuntimeToolCallBlock,
  RuntimeToolResultPayload,
  RuntimeUsage,
} from './messages.ts';
import type {
  RuntimeContentId,
  RuntimeMessageId,
  RuntimeRunId,
  RuntimeSessionId,
  RuntimeTurnId,
} from './ids.ts';

interface ProviderEventBase {
  /** One-based ordinal within one provider response. */
  readonly ordinal: number;
}

export type ProviderFailureKind =
  | 'authentication'
  | 'bad-request'
  | 'rate-limit'
  | 'server'
  | 'network'
  | 'context-overflow'
  | 'malformed-response'
  | 'aborted'
  | 'unknown';

export interface ProviderFailure {
  readonly kind: ProviderFailureKind;
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
  readonly statusCode?: number;
}

export type ProviderStreamEvent =
  | (ProviderEventBase & {
      readonly type: 'response.start';
      readonly responseId?: string;
      readonly responseModel?: string;
    })
  | (ProviderEventBase & {
      readonly type: 'text.start';
      readonly contentIndex: number;
    })
  | (ProviderEventBase & {
      readonly type: 'text.delta';
      readonly contentIndex: number;
      readonly delta: string;
    })
  | (ProviderEventBase & {
      readonly type: 'text.end';
      readonly contentIndex: number;
      readonly text: string;
    })
  | (ProviderEventBase & {
      readonly type: 'thinking.start';
      readonly contentIndex: number;
    })
  | (ProviderEventBase & {
      readonly type: 'thinking.delta';
      readonly contentIndex: number;
      readonly delta: string;
    })
  | (ProviderEventBase & {
      readonly type: 'thinking.end';
      readonly contentIndex: number;
      readonly text: string;
      readonly redacted?: boolean;
    })
  | (ProviderEventBase & {
      readonly type: 'tool-call.start';
      readonly contentIndex: number;
      readonly toolCallId: ToolCallId;
      readonly name: string;
    })
  | (ProviderEventBase & {
      readonly type: 'tool-call.delta';
      readonly contentIndex: number;
      readonly toolCallId: ToolCallId;
      readonly nameDelta: string;
      readonly argumentsDelta: string;
    })
  | (ProviderEventBase & {
      readonly type: 'tool-call.end';
      readonly contentIndex: number;
      readonly toolCallId: ToolCallId;
      readonly name: string;
      readonly arguments: JsonObject;
    })
  | (ProviderEventBase & {
      readonly type: 'response.done';
      readonly responseId?: string;
      readonly responseModel?: string;
      readonly stopReason: Exclude<RuntimeAssistantStopReason, 'error' | 'aborted'>;
      readonly usage: RuntimeUsage;
    })
  | (ProviderEventBase & {
      readonly type: 'response.error';
      readonly failure: ProviderFailure;
    });

export type ProviderTerminalEvent = Extract<
  ProviderStreamEvent,
  { readonly type: 'response.done' | 'response.error' }
>;

export type RuntimeMessageDelta =
  | {
      readonly type: 'text';
      readonly contentId: RuntimeContentId;
      readonly delta: string;
    }
  | {
      readonly type: 'thinking';
      readonly contentId: RuntimeContentId;
      readonly delta: string;
    }
  | {
      readonly type: 'tool-call';
      readonly contentId: RuntimeContentId;
      readonly toolCallId: ToolCallId;
      readonly nameDelta: string;
      readonly argumentsDelta: string;
    };

export type RuntimeRunTerminal =
  | { readonly status: 'completed'; readonly output?: JsonValue }
  | { readonly status: 'failed'; readonly code: string; readonly message: string }
  | { readonly status: 'aborted'; readonly code: string; readonly message?: string };

interface RuntimeEventBase {
  readonly sessionId: RuntimeSessionId;
  /** One-based sequence within the Runtime Session event stream. */
  readonly sequence: number;
  readonly occurredAt: string;
}

interface RuntimeRunEventBase extends RuntimeEventBase {
  readonly defTurnId: DefTurnId;
  readonly runId: RuntimeRunId;
  /** One-based ordinal within one Runtime run. */
  readonly runOrdinal: number;
}

export type RuntimeEvent =
  | (RuntimeRunEventBase & {
      readonly type: 'run.start';
    })
  | (RuntimeRunEventBase & {
      readonly type: 'run.end';
      readonly terminal: RuntimeRunTerminal;
    })
  | (RuntimeRunEventBase & {
      readonly type: 'turn.start';
      readonly turnId: RuntimeTurnId;
    })
  | (RuntimeRunEventBase & {
      readonly type: 'turn.end';
      readonly turnId: RuntimeTurnId;
      readonly assistantMessage: RuntimeAssistantMessage;
      readonly toolResultMessageIds: readonly RuntimeMessageId[];
    })
  | (RuntimeRunEventBase & {
      readonly type: 'message.start';
      readonly message: RuntimeMessageStart;
    })
  | (RuntimeRunEventBase & {
      readonly type: 'message.update';
      readonly messageId: RuntimeMessageId;
      readonly delta: RuntimeMessageDelta;
    })
  | (RuntimeRunEventBase & {
      readonly type: 'message.end';
      readonly message: RuntimeMessage;
    })
  | (RuntimeRunEventBase & {
      readonly type: 'tool.start';
      readonly turnId: RuntimeTurnId;
      readonly call: RuntimeToolCallBlock;
    })
  | (RuntimeRunEventBase & {
      readonly type: 'tool.update';
      readonly turnId: RuntimeTurnId;
      readonly toolCallId: ToolCallId;
      readonly detail: JsonValue;
    })
  | (RuntimeRunEventBase & {
      readonly type: 'tool.end';
      readonly turnId: RuntimeTurnId;
      readonly toolCallId: ToolCallId;
      readonly result: RuntimeToolResultPayload;
      readonly nextProjectionRevision: number;
    })
  | (RuntimeEventBase & {
      readonly type: 'compaction.start';
      readonly defTurnId?: DefTurnId;
      readonly runId?: RuntimeRunId;
      readonly runOrdinal?: number;
      readonly reason: 'manual' | 'threshold' | 'overflow';
    })
  | (RuntimeEventBase & {
      readonly type: 'compaction.end';
      readonly defTurnId?: DefTurnId;
      readonly runId?: RuntimeRunId;
      readonly runOrdinal?: number;
      readonly outcome:
        | { readonly status: 'compacted'; readonly summaryEntryId: string }
        | { readonly status: 'not-needed' }
        | { readonly status: 'failed'; readonly code: string; readonly message: string };
    })
  | (RuntimeRunEventBase & {
      readonly type: 'retry.scheduled';
      readonly attempt: number;
      readonly delayMs: number;
      readonly failure: ProviderFailure;
    })
  | (RuntimeRunEventBase & {
      readonly type: 'retry.end';
      readonly attempt: number;
      readonly outcome: 'resumed' | 'failed' | 'aborted';
    });

export type RuntimeEventListener = (event: RuntimeEvent) => void | Promise<void>;
