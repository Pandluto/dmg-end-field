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
  maxIdentifierLength: 256,
  maxMessagesPerSnapshot: 16_384,
  maxPartsPerSnapshot: 65_536,
  maxEventsPerSnapshot: 131_072,
  maxTextCodeUnitsPerPart: 1 * 1_024 * 1_024,
  maxEventCodeUnits: 2 * 1_024 * 1_024,
  maxSnapshotCodeUnits: 16 * 1_024 * 1_024,
  maxJsonDepth: 32,
  maxJsonNodes: 1_000_000,
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
  if (normalized.length > DEF_CONVERSATION_LIMITS.maxIdentifierLength) {
    throw new TypeError(`${label} must not exceed ${DEF_CONVERSATION_LIMITS.maxIdentifierLength} characters`);
  }
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

/** Validate the status carried by every incremental mutation. */
export function parseConversationSessionStatus(value: unknown): ConversationSessionStatus {
  if (!isRecord(value) || typeof value.status !== 'string') {
    throw new TypeError('Conversation session status is invalid');
  }
  switch (value.status) {
    case 'idle':
    case 'compacting':
    case 'archived':
      assertExactKeys(value, ['status']);
      return value as ConversationSessionStatus;
    case 'running':
      assertExactKeys(value, ['defTurnId', 'status']);
      assertIdentifier(value.defTurnId, 'Conversation status Turn ID');
      return value as ConversationSessionStatus;
    case 'waiting-tool':
      assertExactKeys(value, ['defTurnId', 'status', 'toolCallId']);
      assertIdentifier(value.defTurnId, 'Conversation status Turn ID');
      assertIdentifier(value.toolCallId, 'Conversation status Tool ID');
      return value as ConversationSessionStatus;
    case 'waiting-interaction':
      assertExactKeys(value, ['defTurnId', 'interactionId', 'status']);
      assertIdentifier(value.defTurnId, 'Conversation status Turn ID');
      assertIdentifier(value.interactionId, 'Conversation status Interaction ID');
      return value as ConversationSessionStatus;
    case 'error':
      assertExactKeys(value, ['code', 'message', 'status']);
      assertBoundedString(value.code, 'Conversation status error code', DEF_CONVERSATION_LIMITS.maxIdentifierLength);
      assertBoundedString(value.message, 'Conversation status error message', DEF_CONVERSATION_LIMITS.maxTextCodeUnitsPerPart);
      return value as ConversationSessionStatus;
    default:
      throw new TypeError('Conversation session status variant is invalid');
  }
}

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
  /** Effective session status after this mutation has been applied. */
  readonly status: ConversationSessionStatus;
}

interface HostConversationEventBase extends ConversationEventBase {
  readonly source: 'host';
  /** Effective session status after this mutation has been applied. */
  readonly status: ConversationSessionStatus;
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

  if (event.source === 'runtime' || event.source === 'host') {
    parseConversationSessionStatus(event.status);
  }

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

/**
 * Runtime boundary validation for snapshots.  The projector and Browser Store
 * both call this before exposing untrusted source data to application code.
 */
export function assertConversationSnapshot(value: unknown): asserts value is ConversationSnapshot {
  if (!isRecord(value) || value.schemaVersion !== DEF_CONVERSATION_SCHEMA_VERSION) {
    throw new TypeError('Conversation snapshot schema is invalid');
  }
  assertExactKeys(value, ['cursor', 'defSessionId', 'messages', 'parts', 'schemaVersion', 'status']);
  assertIdentifier(value.defSessionId, 'Conversation snapshot Session ID');
  parseConversationCursor(value.cursor);
  parseConversationSessionStatus(value.status);
  if (!Array.isArray(value.messages) || !Array.isArray(value.parts)) {
    throw new TypeError('Conversation snapshot collections are invalid');
  }
  if (
    value.messages.length > DEF_CONVERSATION_LIMITS.maxMessagesPerSnapshot
    || value.parts.length > DEF_CONVERSATION_LIMITS.maxPartsPerSnapshot
  ) {
    throw new TypeError('Conversation snapshot exceeds collection limits');
  }
  assertSerializedSize(value, DEF_CONVERSATION_LIMITS.maxSnapshotCodeUnits, 'Conversation snapshot');

  const messageIds = new Set<string>();
  const partIds = new Set<string>();
  const toolCallIds = new Set<string>();
  const interactionIds = new Set<string>();
  const partMessageIds = new Map<string, string>();
  const partIdsByMessage = new Map<string, string[]>();
  for (const message of value.messages) {
    assertConversationMessage(message);
    if (messageIds.has(message.id)) throw new TypeError('Conversation snapshot contains duplicate Message IDs');
    messageIds.add(message.id);
    const listed = new Set<string>();
    for (const partId of message.partIds) {
      assertIdentifier(partId, 'Conversation Message Part ID');
      if (listed.has(partId)) throw new TypeError('Conversation Message contains duplicate Part IDs');
      listed.add(partId);
    }
  }
  for (const part of value.parts) {
    assertConversationPart(part);
    if (partIds.has(part.id)) throw new TypeError('Conversation snapshot contains duplicate Part IDs');
    if (!messageIds.has(part.messageId)) throw new TypeError('Conversation Part has no parent Message');
    partIds.add(part.id);
    partMessageIds.set(part.id, part.messageId);
    const messageParts = partIdsByMessage.get(part.messageId) ?? [];
    messageParts.push(part.id);
    partIdsByMessage.set(part.messageId, messageParts);
    if (part.type === 'tool') {
      if (toolCallIds.has(part.toolCallId)) throw new TypeError('Conversation snapshot contains duplicate Tool call IDs');
      toolCallIds.add(part.toolCallId);
    }
    if (part.type === 'interaction') {
      if (interactionIds.has(part.interactionId)) throw new TypeError('Conversation snapshot contains duplicate Interaction IDs');
      interactionIds.add(part.interactionId);
    }
  }
  for (const message of value.messages) {
    const listed = new Set<string>(message.partIds as readonly string[]);
    for (const partId of listed) {
      if (!partIds.has(partId) || partMessageIds.get(partId) !== message.id) {
        throw new TypeError('Conversation Message↔Part parent invariant is invalid');
      }
    }
    const actual = partIdsByMessage.get(message.id) ?? [];
    if (actual.some((partId) => !listed.has(partId)) || listed.size !== actual.length) {
      throw new TypeError('Conversation Message↔Part index is incomplete');
    }
  }
}

/** Bounded serialized-size accounting without allocating a full JSON string. */
export function assertConversationSerializedSize(value: unknown, limit: number, label: string): void {
  conversationSerializedCodeUnits(value, limit, label);
}

export function conversationSerializedCodeUnits(value: unknown, limit: number, label = 'Conversation value'): number {
  const budget = { codeUnits: 0, nodes: 0, seen: new WeakSet<object>() };
  walkBoundedJson(value, 0, budget, limit, label);
  return budget.codeUnits;
}

/** Runtime boundary validation for a single projector event. */
export function assertConversationEvent(value: unknown): asserts value is ConversationEvent {
  if (!isRecord(value) || value.schemaVersion !== DEF_CONVERSATION_SCHEMA_VERSION) {
    throw new TypeError('Conversation event schema is invalid');
  }
  assertIdentifier(value.defSessionId, 'Conversation event Session ID');
  assertBoundedString(value.occurredAt, 'Conversation event timestamp', 256);
  parseConversationCursor(value.cursor);
  if (!isSequence(value.sourceSequence)) throw new TypeError('Conversation event sourceSequence is invalid');
  if (value.source === 'projector') {
    if (value.sourceSequence !== 0) throw new TypeError('Projector event sourceSequence is invalid');
    if (value.type === 'conversation.snapshot') {
      assertExactKeys(value, ['cursor', 'defSessionId', 'occurredAt', 'schemaVersion', 'snapshot', 'source', 'sourceSequence', 'type']);
      const snapshot = value.snapshot;
      assertConversationSnapshot(snapshot);
      if (snapshot.defSessionId !== value.defSessionId) throw new TypeError('Conversation snapshot Session mismatch');
      if (!conversationCursorEquals(value.cursor as ConversationCursor, snapshot.cursor)) {
        throw new TypeError('Conversation snapshot cursor does not match event cursor');
      }
      assertSerializedSize(value, DEF_CONVERSATION_LIMITS.maxEventCodeUnits, 'Conversation event');
      return;
    }
    if (value.type !== 'conversation.reset-required' || !['epoch-changed', 'gap'].includes(String(value.reason))) {
      throw new TypeError('Projector event variant is invalid');
    }
    assertExactKeys(value, ['cursor', 'defSessionId', 'occurredAt', 'reason', 'schemaVersion', 'source', 'sourceSequence', 'type']);
    assertSerializedSize(value, DEF_CONVERSATION_LIMITS.maxEventCodeUnits, 'Conversation event');
    return;
  }
  if (value.source !== 'runtime' && value.source !== 'host') throw new TypeError('Conversation event source is invalid');
  parseConversationSessionStatus(value.status);
  if (value.source === 'runtime') {
    if (value.type === 'message.upsert') {
      assertExactKeys(value, ['cursor', 'defSessionId', 'index', 'message', 'occurredAt', 'schemaVersion', 'source', 'sourceSequence', 'status', 'type']);
      assertMutationIndexValue(value.index);
      assertConversationMessage(value.message);
    }
    else if (value.type === 'part.upsert') {
      assertExactKeys(value, ['cursor', 'defSessionId', 'index', 'occurredAt', 'part', 'schemaVersion', 'source', 'sourceSequence', 'status', 'type']);
      assertMutationIndexValue(value.index);
      assertConversationPart(value.part);
      if (value.part.type === 'interaction') throw new TypeError('Runtime cannot own Interaction parts');
    } else if (value.type === 'part.delta') {
      assertExactKeys(value, ['cursor', 'defSessionId', 'delta', 'field', 'messageId', 'occurredAt', 'partId', 'schemaVersion', 'source', 'sourceSequence', 'status', 'type']);
      assertIdentifier(value.messageId, 'Conversation delta Message ID');
      assertIdentifier(value.partId, 'Conversation delta Part ID');
      if (value.field !== 'text') throw new TypeError('Conversation delta field is invalid');
      assertBoundedString(value.delta, 'Conversation delta', DEF_CONVERSATION_LIMITS.maxTextCodeUnitsPerPart);
    } else if (value.type === 'message.remove') {
      assertExactKeys(value, ['cursor', 'defSessionId', 'messageId', 'occurredAt', 'schemaVersion', 'source', 'sourceSequence', 'status', 'type']);
      assertIdentifier(value.messageId, 'Conversation removal Message ID');
    }
    else if (value.type === 'part.remove') {
      assertExactKeys(value, ['cursor', 'defSessionId', 'messageId', 'occurredAt', 'partId', 'schemaVersion', 'source', 'sourceSequence', 'status', 'type']);
      assertIdentifier(value.messageId, 'Conversation removal Message ID');
      assertIdentifier(value.partId, 'Conversation removal Part ID');
    } else if (value.type === 'session.status') {
      assertExactKeys(value, ['cursor', 'defSessionId', 'occurredAt', 'schemaVersion', 'source', 'sourceSequence', 'status', 'type']);
    } else throw new TypeError('Runtime event variant is invalid');
    assertSerializedSize(value, DEF_CONVERSATION_LIMITS.maxEventCodeUnits, 'Conversation event');
    return;
  }
  if (value.type === 'part.upsert') {
    assertExactKeys(value, ['cursor', 'defSessionId', 'index', 'occurredAt', 'part', 'schemaVersion', 'source', 'sourceSequence', 'status', 'type']);
    assertMutationIndexValue(value.index);
    assertConversationPart(value.part);
    if (value.part.type !== 'tool' && value.part.type !== 'error') throw new TypeError('Host Part ownership is invalid');
  } else if (value.type === 'interaction.upsert') {
    assertExactKeys(value, ['cursor', 'defSessionId', 'index', 'occurredAt', 'part', 'schemaVersion', 'source', 'sourceSequence', 'status', 'type']);
    assertMutationIndexValue(value.index);
    assertConversationPart(value.part);
    if (value.part.type !== 'interaction') throw new TypeError('Host Interaction variant is invalid');
  } else if (value.type === 'interaction.remove') {
    assertExactKeys(value, ['cursor', 'defSessionId', 'interactionId', 'messageId', 'occurredAt', 'partId', 'schemaVersion', 'source', 'sourceSequence', 'status', 'type']);
    assertIdentifier(value.messageId, 'Interaction removal Message ID');
    assertIdentifier(value.partId, 'Interaction removal Part ID');
    assertIdentifier(value.interactionId, 'Interaction removal ID');
  } else if (value.type === 'session.status') {
    assertExactKeys(value, ['cursor', 'defSessionId', 'occurredAt', 'schemaVersion', 'source', 'sourceSequence', 'status', 'type']);
  } else throw new TypeError('Host event variant is invalid');
  assertSerializedSize(value, DEF_CONVERSATION_LIMITS.maxEventCodeUnits, 'Conversation event');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isSequence(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function assertExactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): void {
  const actual = Object.keys(value).sort();
  if (
    actual.some((key) => !required.includes(key) && !optional.includes(key))
    || required.some((key) => !Object.prototype.hasOwnProperty.call(value, key))
  ) {
    throw new TypeError('Conversation object fields are invalid');
  }
}

function assertIdentifier(value: unknown, label: string): asserts value is string {
  assertBoundedString(value, label, DEF_CONVERSATION_LIMITS.maxIdentifierLength);
  if (value.trim() === '' || value.trim() !== value) throw new TypeError(`${label} must be canonical and non-empty`);
}

function assertBoundedString(value: unknown, label: string, limit: number): asserts value is string {
  if (typeof value !== 'string' || value.length > limit) throw new TypeError(`${label} exceeds its limit`);
}

function assertMutationIndexValue(value: unknown): asserts value is number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new TypeError('Conversation mutation index is invalid');
}

function assertSerializedSize(value: unknown, limit: number, label: string): void {
  assertConversationSerializedSize(value, limit, label);
}

export function assertConversationMessage(value: unknown): asserts value is ConversationMessage {
  if (!isRecord(value)) throw new TypeError('Conversation Message is invalid');
  assertExactKeys(value, ['createdAt', 'defTurnId', 'id', 'partIds', 'role'], ['completedAt']);
  assertIdentifier(value.id, 'Conversation Message ID');
  assertIdentifier(value.defTurnId, 'Conversation Message Turn ID');
  if (value.role !== 'user' && value.role !== 'assistant') throw new TypeError('Conversation Message role is invalid');
  assertBoundedString(value.createdAt, 'Conversation Message timestamp', 256);
  if (value.completedAt !== undefined) assertBoundedString(value.completedAt, 'Conversation Message completion timestamp', 256);
  if (!Array.isArray(value.partIds)) throw new TypeError('Conversation Message parts are invalid');
}

export function assertConversationPart(value: unknown): asserts value is ConversationPart {
  if (!isRecord(value) || typeof value.type !== 'string') throw new TypeError('Conversation Part is invalid');
  assertIdentifier(value.id, 'Conversation Part ID');
  assertIdentifier(value.messageId, 'Conversation Part Message ID');
  assertBoundedString(value.createdAt, 'Conversation Part timestamp', 256);
  if (value.completedAt !== undefined) assertBoundedString(value.completedAt, 'Conversation Part completion timestamp', 256);
  switch (value.type) {
    case 'text':
    case 'reasoning':
      assertExactKeys(value, value.type === 'text' ? ['createdAt', 'id', 'messageId', 'text', 'type'] : ['createdAt', 'id', 'messageId', 'text', 'type'], value.type === 'text' ? ['completedAt'] : ['completedAt', 'redacted']);
      assertBoundedString(value.text, 'Conversation Part text', DEF_CONVERSATION_LIMITS.maxTextCodeUnitsPerPart);
      if (value.type === 'reasoning' && value.redacted !== undefined && typeof value.redacted !== 'boolean') throw new TypeError('Conversation reasoning redaction is invalid');
      return;
    case 'file':
      assertExactKeys(value, ['createdAt', 'filename', 'id', 'messageId', 'mime', 'type', 'url'], ['completedAt']);
      assertBoundedString(value.mime, 'Conversation file MIME', 256);
      assertBoundedString(value.filename, 'Conversation file name', 4_096);
      assertBoundedString(value.url, 'Conversation file URL', 1 * 1_024 * 1_024);
      return;
    case 'tool':
      assertExactKeys(value, ['createdAt', 'id', 'messageId', 'name', 'state', 'toolCallId', 'type'], ['completedAt']);
      assertIdentifier(value.toolCallId, 'Conversation Tool call ID');
      assertBoundedString(value.name, 'Conversation Tool name', DEF_CONVERSATION_LIMITS.maxIdentifierLength);
      assertToolState(value.state);
      return;
    case 'interaction':
      assertExactKeys(value, ['createdAt', 'id', 'interactionId', 'interactionKind', 'messageId', 'prompt', 'state', 'type'], ['completedAt', 'payload']);
      assertIdentifier(value.interactionId, 'Conversation Interaction ID');
      if (value.interactionKind !== 'question' && value.interactionKind !== 'approval') throw new TypeError('Conversation Interaction kind is invalid');
      assertBoundedString(value.prompt, 'Conversation Interaction prompt', DEF_CONVERSATION_LIMITS.maxTextCodeUnitsPerPart);
      if (value.payload !== undefined) assertJson(value.payload, 0);
      assertInteractionState(value.state);
      return;
    case 'compaction':
      assertExactKeys(value, ['createdAt', 'id', 'messageId', 'reason', 'state', 'type'], ['completedAt', 'error', 'summary']);
      if (!['manual', 'threshold', 'overflow'].includes(String(value.reason)) || !['running', 'completed', 'error'].includes(String(value.state))) throw new TypeError('Conversation Compaction state is invalid');
      if (value.summary !== undefined) assertBoundedString(value.summary, 'Conversation Compaction summary', DEF_CONVERSATION_LIMITS.maxTextCodeUnitsPerPart);
      if (value.error !== undefined) {
        if (!isRecord(value.error)) throw new TypeError('Conversation Compaction error is invalid');
        assertExactKeys(value.error, ['code', 'message']);
        assertBoundedString(value.error.code, 'Conversation Compaction error code', DEF_CONVERSATION_LIMITS.maxIdentifierLength);
        assertBoundedString(value.error.message, 'Conversation Compaction error message', DEF_CONVERSATION_LIMITS.maxTextCodeUnitsPerPart);
      }
      return;
    case 'error':
      assertExactKeys(value, ['code', 'createdAt', 'id', 'message', 'messageId', 'retryable', 'type'], ['completedAt']);
      assertBoundedString(value.code, 'Conversation error code', DEF_CONVERSATION_LIMITS.maxIdentifierLength);
      assertBoundedString(value.message, 'Conversation error message', DEF_CONVERSATION_LIMITS.maxTextCodeUnitsPerPart);
      if (typeof value.retryable !== 'boolean') throw new TypeError('Conversation error retryability is invalid');
      return;
    default:
      throw new TypeError('Conversation Part type is invalid');
  }
}

function assertToolState(value: unknown): void {
  if (!isRecord(value) || typeof value.status !== 'string') throw new TypeError('Conversation Tool state is invalid');
  if (!['pending', 'running', 'completed', 'error'].includes(value.status)) throw new TypeError('Conversation Tool state variant is invalid');
  assertJson(value.input, 0);
  if (value.status === 'pending') assertExactKeys(value, ['input', 'status']);
  if (value.status === 'running') {
    assertExactKeys(value, ['input', 'startedAt', 'status'], ['detail', 'title']);
    assertBoundedString(value.startedAt, 'Conversation Tool start timestamp', 256);
    if (value.title !== undefined) assertBoundedString(value.title, 'Conversation Tool title', DEF_CONVERSATION_LIMITS.maxIdentifierLength);
    if (value.detail !== undefined) assertJson(value.detail, 0);
  }
  if (value.status === 'completed') {
    assertExactKeys(value, ['endedAt', 'input', 'output', 'status'], ['startedAt', 'title']);
    assertJson(value.output, 0);
    assertBoundedString(value.endedAt, 'Conversation Tool end timestamp', 256);
    if (value.startedAt !== undefined) assertBoundedString(value.startedAt, 'Conversation Tool start timestamp', 256);
    if (value.title !== undefined) assertBoundedString(value.title, 'Conversation Tool title', DEF_CONVERSATION_LIMITS.maxIdentifierLength);
  }
  if (value.status === 'error') {
    assertExactKeys(value, ['code', 'endedAt', 'input', 'message', 'status'], ['startedAt']);
    assertBoundedString(value.code, 'Conversation Tool error code', DEF_CONVERSATION_LIMITS.maxIdentifierLength);
    assertBoundedString(value.message, 'Conversation Tool error message', DEF_CONVERSATION_LIMITS.maxTextCodeUnitsPerPart);
    assertBoundedString(value.endedAt, 'Conversation Tool end timestamp', 256);
    if (value.startedAt !== undefined) assertBoundedString(value.startedAt, 'Conversation Tool start timestamp', 256);
  }
}

function assertInteractionState(value: unknown): void {
  if (!isRecord(value) || typeof value.status !== 'string') throw new TypeError('Conversation Interaction state is invalid');
  if (value.status === 'pending') {
    assertExactKeys(value, ['expiresAt', 'status']);
    assertBoundedString(value.expiresAt, 'Conversation Interaction expiry', 256);
  } else if (value.status === 'resolved') {
    assertExactKeys(value, ['resolution', 'resolvedAt', 'status'], ['value']);
    if (!['answered', 'approved', 'rejected', 'expired', 'cancelled', 'stale'].includes(String(value.resolution))) throw new TypeError('Conversation Interaction resolution is invalid');
    assertBoundedString(value.resolvedAt, 'Conversation Interaction resolution timestamp', 256);
    if (value.value !== undefined) assertJson(value.value, 0);
  } else {
    throw new TypeError('Conversation Interaction state variant is invalid');
  }
}

function assertJson(
  value: unknown,
  depth: number,
  budget: { codeUnits: number; nodes: number; seen: WeakSet<object> } = { codeUnits: 0, nodes: 0, seen: new WeakSet<object>() },
): asserts value is JsonValue {
  if (depth > DEF_CONVERSATION_LIMITS.maxJsonDepth) throw new TypeError('Conversation JSON exceeds depth limit');
  budget.nodes += 1;
  if (budget.nodes > DEF_CONVERSATION_LIMITS.maxJsonNodes) throw new TypeError('Conversation JSON exceeds node limit');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    if (typeof value === 'string') {
      if (value.length > DEF_CONVERSATION_LIMITS.maxTextCodeUnitsPerPart) throw new TypeError('Conversation JSON string exceeds its limit');
      budget.codeUnits += value.length;
      if (budget.codeUnits > DEF_CONVERSATION_LIMITS.maxSnapshotCodeUnits) throw new TypeError('Conversation JSON exceeds code-unit limit');
    }
    if (value === null) budget.codeUnits += 4;
    else if (typeof value === 'boolean') budget.codeUnits += value ? 4 : 5;
    if (budget.codeUnits > DEF_CONVERSATION_LIMITS.maxSnapshotCodeUnits) throw new TypeError('Conversation JSON exceeds code-unit limit');
    return;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Conversation JSON number is invalid');
    budget.codeUnits += 24;
    if (budget.codeUnits > DEF_CONVERSATION_LIMITS.maxSnapshotCodeUnits) throw new TypeError('Conversation JSON exceeds code-unit limit');
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > DEF_CONVERSATION_LIMITS.maxPartsPerSnapshot) throw new TypeError('Conversation JSON array exceeds its limit');
    if (budget.seen.has(value)) throw new TypeError('Conversation JSON contains a cycle');
    budget.seen.add(value);
    budget.codeUnits += 2;
    for (const entry of value) assertJson(entry, depth + 1, budget);
    budget.seen.delete(value);
    return;
  }
  if (!isRecord(value)) throw new TypeError('Conversation JSON value is invalid');
  if (Object.keys(value).length > DEF_CONVERSATION_LIMITS.maxPartsPerSnapshot) throw new TypeError('Conversation JSON object exceeds its limit');
  if (budget.seen.has(value)) throw new TypeError('Conversation JSON contains a cycle');
  budget.seen.add(value);
  budget.codeUnits += 2;
  for (const [key, entry] of Object.entries(value)) {
    if (key.length > DEF_CONVERSATION_LIMITS.maxIdentifierLength) throw new TypeError('Conversation JSON key exceeds its limit');
    budget.codeUnits += key.length;
    if (budget.codeUnits > DEF_CONVERSATION_LIMITS.maxSnapshotCodeUnits) throw new TypeError('Conversation JSON exceeds code-unit limit');
    assertJson(entry, depth + 1, budget);
  }
  budget.seen.delete(value);
}

function walkBoundedJson(
  value: unknown,
  depth: number,
  budget: { codeUnits: number; nodes: number; seen: WeakSet<object> },
  limit: number,
  label: string,
): void {
  if (depth > DEF_CONVERSATION_LIMITS.maxJsonDepth) throw new TypeError(`${label} exceeds JSON depth limit`);
  budget.nodes += 1;
  if (budget.nodes > DEF_CONVERSATION_LIMITS.maxJsonNodes) throw new TypeError(`${label} exceeds JSON node limit`);
  const add = (units: number): void => {
    budget.codeUnits += units;
    if (budget.codeUnits > limit) throw new TypeError(`${label} exceeds its serialized size limit`);
  };
  if (value === null) { add(4); return; }
  if (typeof value === 'string') { add(jsonStringCodeUnits(value)); return; }
  if (typeof value === 'boolean') { add(value ? 4 : 5); return; }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError(`${label} contains an invalid number`);
    add(24);
    return;
  }
  if (Array.isArray(value)) {
    if (budget.seen.has(value)) throw new TypeError(`${label} contains a cycle`);
    budget.seen.add(value);
    add(1);
    for (const entry of value) walkBoundedJson(entry, depth + 1, budget, limit, label);
    add(1);
    budget.seen.delete(value);
    return;
  }
  if (!isRecord(value)) throw new TypeError(`${label} contains a non-JSON value`);
  if (budget.seen.has(value)) throw new TypeError(`${label} contains a cycle`);
  budget.seen.add(value);
  add(1);
  for (const [key, entry] of Object.entries(value)) {
    add(jsonStringCodeUnits(key) + 1);
    walkBoundedJson(entry, depth + 1, budget, limit, label);
  }
  add(1);
  budget.seen.delete(value);
}

function jsonStringCodeUnits(value: string): number {
  let size = 2;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code === 0x08 || code === 0x0c || code === 0x0a || code === 0x0d || code === 0x09) size += 2;
    else if (code === 0x22 || code === 0x5c || code < 0x20) size += 6;
    else size += 1;
  }
  return size;
}
