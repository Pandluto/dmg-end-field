/**
 * Engine-neutral read model consumed by the DEF Agent Session Surface.
 *
 * Message/Part and ToolState semantics are adapted from OpenCode
 * packages/schema/src/session-v1.ts at
 * 67aec2212010d67775c35e696d8b8b54902eb338. Transport, authorization, Host
 * audit, and Runtime storage remain DEF-owned and are not OpenCode APIs.
 */
import type { EngineSessionRef } from './engine.ts';
import type {
  DefSessionId,
  DefTurnId,
  InteractionId,
  ToolCallId,
} from './ids.ts';
import type { JsonObject, JsonValue } from './json.ts';

export const DEF_CONVERSATION_SCHEMA_VERSION = 1 as const;

export const DEF_CONVERSATION_LIMITS = Object.freeze({
  maxEpochLength: 128,
  maxMessagesPerSnapshot: 16_384,
  maxPartsPerSnapshot: 65_536,
  maxTextCodeUnitsPerPart: 1 * 1_024 * 1_024,
  maxEventCodeUnits: 2 * 1_024 * 1_024,
});

declare const conversationIdBrand: unique symbol;

type ConversationId<Tag extends string> = string & {
  readonly [conversationIdBrand]: Tag;
};

export type ConversationMessageId = ConversationId<'ConversationMessageId'>;
export type ConversationPartId = ConversationId<'ConversationPartId'>;

function asConversationId<T extends string>(value: string, label: string): T {
  const normalized = value.trim();
  if (!normalized) throw new TypeError(`${label} must be a non-empty string`);
  if (normalized.length > 256) throw new TypeError(`${label} must not exceed 256 characters`);
  return normalized as T;
}

export const asConversationMessageId = (value: string): ConversationMessageId => (
  asConversationId<ConversationMessageId>(value, 'ConversationMessageId')
);
export const asConversationPartId = (value: string): ConversationPartId => (
  asConversationId<ConversationPartId>(value, 'ConversationPartId')
);

export interface ConversationCursor {
  readonly epoch: string;
  readonly runtimeSequence: number;
  readonly hostSequence: number;
}

export function parseConversationCursor(value: unknown): ConversationCursor {
  if (!isRecord(value)) throw new TypeError('Conversation cursor must be an object');
  const keys = Object.keys(value).sort();
  if (keys.length !== 3 || keys[0] !== 'epoch' || keys[1] !== 'hostSequence' || keys[2] !== 'runtimeSequence') {
    throw new TypeError('Conversation cursor fields are invalid');
  }
  const { epoch, runtimeSequence, hostSequence } = value;
  if (
    typeof epoch !== 'string'
    || !/^[A-Za-z0-9._~-]+$/u.test(epoch)
    || epoch.length > DEF_CONVERSATION_LIMITS.maxEpochLength
  ) {
    throw new TypeError('Conversation cursor epoch is invalid');
  }
  if (!isSequence(runtimeSequence) || !isSequence(hostSequence)) {
    throw new TypeError('Conversation cursor sequences must be non-negative safe integers');
  }
  return Object.freeze({ epoch, runtimeSequence, hostSequence });
}

export function conversationCursorEquals(left: ConversationCursor, right: ConversationCursor): boolean {
  return left.epoch === right.epoch
    && left.runtimeSequence === right.runtimeSequence
    && left.hostSequence === right.hostSequence;
}

export type ConversationSessionStatus =
  | { readonly status: 'idle' }
  | { readonly status: 'running'; readonly defTurnId: DefTurnId }
  | { readonly status: 'waiting-tool'; readonly defTurnId: DefTurnId; readonly toolCallId: ToolCallId }
  | { readonly status: 'waiting-interaction'; readonly defTurnId: DefTurnId; readonly interactionId: InteractionId }
  | { readonly status: 'compacting' }
  | { readonly status: 'error'; readonly code: string; readonly message: string }
  | { readonly status: 'archived' };

export interface ConversationMessage {
  readonly id: ConversationMessageId;
  readonly role: 'user' | 'assistant';
  readonly defTurnId: DefTurnId;
  readonly createdAt: string;
  readonly completedAt?: string;
  /** Stable display order; part payloads live in ConversationSnapshot.parts. */
  readonly partIds: readonly ConversationPartId[];
}

interface ConversationPartBase {
  readonly id: ConversationPartId;
  readonly messageId: ConversationMessageId;
  readonly createdAt: string;
  readonly completedAt?: string;
}

export interface ConversationTextPart extends ConversationPartBase {
  readonly type: 'text';
  readonly text: string;
}

export interface ConversationReasoningPart extends ConversationPartBase {
  readonly type: 'reasoning';
  readonly text: string;
  readonly redacted?: boolean;
}

export interface ConversationFilePart extends ConversationPartBase {
  readonly type: 'file';
  readonly mime: string;
  readonly filename: string;
  readonly url: string;
}

export type ConversationToolState =
  | {
      readonly status: 'pending';
      readonly input: JsonObject;
    }
  | {
      readonly status: 'running';
      readonly input: JsonObject;
      readonly startedAt: string;
      readonly title?: string;
      readonly detail?: JsonValue;
    }
  | {
      readonly status: 'completed';
      readonly input: JsonObject;
      readonly output: JsonValue;
      readonly startedAt?: string;
      readonly endedAt: string;
      readonly title?: string;
    }
  | {
      readonly status: 'error';
      readonly input: JsonObject;
      readonly code: string;
      readonly message: string;
      readonly startedAt?: string;
      readonly endedAt: string;
    };

export interface ConversationToolPart extends ConversationPartBase {
  readonly type: 'tool';
  readonly toolCallId: ToolCallId;
  readonly name: string;
  readonly state: ConversationToolState;
}

export type ConversationInteractionState =
  | {
      readonly status: 'pending';
      readonly expiresAt: string;
    }
  | {
      readonly status: 'resolved';
      readonly resolution: 'answered' | 'approved' | 'rejected' | 'expired' | 'cancelled' | 'stale';
      readonly value?: JsonValue;
      readonly resolvedAt: string;
    };

export interface ConversationInteractionPart extends ConversationPartBase {
  readonly type: 'interaction';
  readonly interactionId: InteractionId;
  readonly interactionKind: 'question' | 'approval';
  readonly prompt: string;
  readonly payload?: JsonObject;
  readonly state: ConversationInteractionState;
}

export interface ConversationCompactionPart extends ConversationPartBase {
  readonly type: 'compaction';
  readonly reason: 'manual' | 'threshold' | 'overflow';
  readonly state: 'running' | 'completed' | 'error';
  readonly summary?: string;
  readonly error?: { readonly code: string; readonly message: string };
}

export interface ConversationErrorPart extends ConversationPartBase {
  readonly type: 'error';
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
}

export type ConversationPart =
  | ConversationTextPart
  | ConversationReasoningPart
  | ConversationFilePart
  | ConversationToolPart
  | ConversationInteractionPart
  | ConversationCompactionPart
  | ConversationErrorPart;

/** Runtime-owned parts; Host-only Interaction state is composed later. */
export type RuntimeTranscriptPart = Exclude<ConversationPart, ConversationInteractionPart>;

/** Host Journal mutations may settle business Tools or surface Host failures. */
export type HostTranscriptPart = ConversationToolPart | ConversationErrorPart;

export interface ConversationSnapshot {
  readonly schemaVersion: typeof DEF_CONVERSATION_SCHEMA_VERSION;
  readonly defSessionId: DefSessionId;
  readonly cursor: ConversationCursor;
  readonly status: ConversationSessionStatus;
  readonly messages: readonly ConversationMessage[];
  readonly parts: readonly ConversationPart[];
}

interface ConversationEventBase {
  readonly schemaVersion: typeof DEF_CONVERSATION_SCHEMA_VERSION;
  readonly defSessionId: DefSessionId;
  /** Sequence in the declared source, never a synthetic cross-source sequence. */
  readonly sourceSequence: number;
  readonly cursor: ConversationCursor;
  readonly occurredAt: string;
}

interface ProjectorConversationEventBase extends ConversationEventBase {
  readonly source: 'projector';
  readonly sourceSequence: 0;
}

interface RuntimeConversationEventBase extends ConversationEventBase {
  readonly source: 'runtime';
}

interface HostConversationEventBase extends ConversationEventBase {
  readonly source: 'host';
}

export type ConversationEvent =
  | (ProjectorConversationEventBase & {
      readonly type: 'conversation.snapshot';
      readonly snapshot: ConversationSnapshot;
    })
  | (ProjectorConversationEventBase & {
      readonly type: 'conversation.reset-required';
      readonly reason: 'epoch-changed' | 'gap';
    })
  | (RuntimeConversationEventBase & {
      readonly type: 'message.upsert';
      readonly message: ConversationMessage;
      readonly index: number;
    })
  | (RuntimeConversationEventBase & {
      readonly type: 'message.remove';
      readonly messageId: ConversationMessageId;
    })
  | (RuntimeConversationEventBase & {
      readonly type: 'part.upsert';
      readonly part: RuntimeTranscriptPart;
      readonly index: number;
    })
  | (HostConversationEventBase & {
      readonly type: 'part.upsert';
      readonly part: HostTranscriptPart;
      readonly index: number;
    })
  | (RuntimeConversationEventBase & {
      readonly type: 'part.delta';
      readonly messageId: ConversationMessageId;
      readonly partId: ConversationPartId;
      readonly field: 'text';
      readonly delta: string;
    })
  | ((RuntimeConversationEventBase | HostConversationEventBase) & {
      readonly type: 'part.remove';
      readonly messageId: ConversationMessageId;
      readonly partId: ConversationPartId;
    })
  | ((RuntimeConversationEventBase | HostConversationEventBase) & {
      readonly type: 'session.status';
      readonly status: ConversationSessionStatus;
    })
  | (HostConversationEventBase & {
      readonly type: 'interaction.upsert';
      readonly part: ConversationInteractionPart;
      readonly index: number;
    })
  | (HostConversationEventBase & {
      readonly type: 'interaction.remove';
      readonly messageId: ConversationMessageId;
      readonly partId: ConversationPartId;
      readonly interactionId: InteractionId;
    });

/**
 * Enforces the snapshot-to-subscribe contract at the reducer/Gateway boundary.
 * Runtime events advance only runtimeSequence; Host events advance only
 * hostSequence. Projector events never invent a third sequence.
 */
export function assertConversationEventTransition(
  previous: ConversationCursor | null,
  event: ConversationEvent,
): void {
  const cursor = parseConversationCursor(event.cursor);
  if (!isSequence(event.sourceSequence)) throw new TypeError('Conversation event sourceSequence is invalid');

  if (event.source === 'projector') {
    if (event.sourceSequence !== 0) throw new TypeError('Projector events must use sourceSequence 0');
    if (event.type !== 'conversation.snapshot' && event.type !== 'conversation.reset-required') {
      throw new TypeError('Projector cannot emit incremental Conversation mutations');
    }
    if (event.type === 'conversation.snapshot') {
      if (!conversationCursorEquals(cursor, parseConversationCursor(event.snapshot.cursor))) {
        throw new TypeError('Conversation snapshot event cursor does not match its snapshot');
      }
      if (event.defSessionId !== event.snapshot.defSessionId) {
        throw new TypeError('Conversation snapshot event session does not match its snapshot');
      }
    }
    return;
  }

  if (!previous) throw new TypeError('Incremental Conversation event requires a previous cursor');
  const prior = parseConversationCursor(previous);
  if (prior.epoch !== cursor.epoch) {
    throw new TypeError('Conversation event epoch changed without reset');
  }

  if (event.source === 'runtime') {
    if (cursor.hostSequence !== prior.hostSequence) {
      throw new TypeError('Runtime Conversation event changed hostSequence');
    }
    if (cursor.runtimeSequence !== prior.runtimeSequence + 1) {
      throw new TypeError('Runtime Conversation event sequence is not contiguous');
    }
    if (event.sourceSequence !== cursor.runtimeSequence) {
      throw new TypeError('Runtime Conversation event sourceSequence does not match cursor');
    }
    return;
  }

  if (cursor.runtimeSequence !== prior.runtimeSequence) {
    throw new TypeError('Host Conversation event changed runtimeSequence');
  }
  if (cursor.hostSequence !== prior.hostSequence + 1) {
    throw new TypeError('Host Conversation event sequence is not contiguous');
  }
  if (event.sourceSequence !== cursor.hostSequence) {
    throw new TypeError('Host Conversation event sourceSequence does not match cursor');
  }
}

export type RuntimeTranscriptStatus =
  | { readonly status: 'idle' }
  | { readonly status: 'running' }
  | { readonly status: 'compacting' }
  | { readonly status: 'error'; readonly code: string; readonly message: string };

export interface RuntimeTranscriptSnapshot {
  readonly schemaVersion: typeof DEF_CONVERSATION_SCHEMA_VERSION;
  readonly engineSession: EngineSessionRef;
  readonly sequence: number;
  readonly status: RuntimeTranscriptStatus;
  readonly messages: readonly ConversationMessage[];
  readonly parts: readonly RuntimeTranscriptPart[];
}

export type RuntimeTranscriptMutation =
  | { readonly type: 'message.upsert'; readonly message: ConversationMessage; readonly index: number }
  | { readonly type: 'message.remove'; readonly messageId: ConversationMessageId }
  | { readonly type: 'part.upsert'; readonly part: RuntimeTranscriptPart; readonly index: number }
  | {
      readonly type: 'part.delta';
      readonly messageId: ConversationMessageId;
      readonly partId: ConversationPartId;
      readonly field: 'text';
      readonly delta: string;
    }
  | {
      readonly type: 'part.remove';
      readonly messageId: ConversationMessageId;
      readonly partId: ConversationPartId;
    }
  | { readonly type: 'session.status'; readonly status: RuntimeTranscriptStatus };

export interface RuntimeTranscriptEvent {
  readonly schemaVersion: typeof DEF_CONVERSATION_SCHEMA_VERSION;
  readonly engineSession: EngineSessionRef;
  readonly sequence: number;
  readonly occurredAt: string;
  readonly mutation: RuntimeTranscriptMutation;
}

export interface RuntimeTranscriptSource {
  getRuntimeSnapshot(session: EngineSessionRef): Promise<RuntimeTranscriptSnapshot>;
  subscribeRuntime(
    session: EngineSessionRef,
    afterRuntimeSequence: number,
    signal?: AbortSignal,
  ): AsyncIterable<RuntimeTranscriptEvent>;
}

export interface ConversationProjector {
  getSnapshot(session: DefSessionId): Promise<ConversationSnapshot>;
  /**
   * The caller owns cancellation. Implementations must settle the subscription
   * and release every upstream source after signal aborts; changing a local UI
   * connection must not leave a hidden Runtime or Host subscription alive.
   */
  subscribe(
    session: DefSessionId,
    cursor: ConversationCursor,
    signal?: AbortSignal,
  ): AsyncIterable<ConversationEvent>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isSequence(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}
