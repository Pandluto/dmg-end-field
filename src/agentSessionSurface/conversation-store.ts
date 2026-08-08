import {
  assertConversationEventTransition,
  DEF_CONVERSATION_LIMITS,
  type ConversationEvent,
  type ConversationMessage,
  type ConversationPart,
  type ConversationProjector,
  type ConversationSnapshot,
} from '../../agent/core/contracts/conversation.ts';
import type { DefSessionId } from '../../agent/core/contracts/ids.ts';

export type ConversationStoreStatus =
  | 'empty'
  | 'loading'
  | 'ready'
  | 'reconnecting'
  | 'disconnected'
  | 'error';

export interface ConversationStoreState {
  readonly status: ConversationStoreStatus;
  readonly sessionId: DefSessionId | null;
  readonly snapshot: ConversationSnapshot | null;
  readonly cursor: ConversationSnapshot['cursor'] | null;
  readonly error: ConversationStoreError | null;
}

export type ConversationStoreListener = (state: ConversationStoreState) => void;

export type ConversationStoreErrorCode =
  | 'NO_SNAPSHOT'
  | 'SESSION_MISMATCH'
  | 'EPOCH_CHANGED'
  | 'SOURCE_GAP'
  | 'SOURCE_OUT_OF_ORDER'
  | 'INVALID_EVENT'
  | 'RESET_LOOP'
  | 'SOURCE_FAILED';

export class ConversationStoreError extends Error {
  readonly code: ConversationStoreErrorCode;
  readonly causeValue: unknown;

  constructor(code: ConversationStoreErrorCode, message: string, causeValue?: unknown) {
    super(message);
    this.name = 'ConversationStoreError';
    this.code = code;
    this.causeValue = causeValue;
  }
}

/**
 * Pure reducer for a single browser materialization.  It stores only the
 * latest snapshot; events are never retained as a second transcript.
 *
 * Duplicate or stale events are ignored so a reconnect cannot duplicate a
 * Message/Part.  A forward gap or an epoch change is surfaced to the caller
 * as a typed error, allowing the Store connection loop to refetch a snapshot.
 */
export function reduceConversationEvent(
  snapshot: ConversationSnapshot | null,
  event: ConversationEvent,
): ConversationSnapshot | null {
  if (event.schemaVersion !== 1) {
    throw new ConversationStoreError('INVALID_EVENT', 'Conversation event schema is unsupported');
  }
  if (event.type === 'conversation.snapshot') {
    if (snapshot && snapshot.defSessionId !== event.defSessionId) {
      throw new ConversationStoreError('SESSION_MISMATCH', 'Conversation snapshot belongs to another Session');
    }
    if (event.snapshot.defSessionId !== event.defSessionId) {
      throw new ConversationStoreError('INVALID_EVENT', 'Conversation snapshot Session IDs do not match');
    }
    return clone(event.snapshot);
  }
  if (event.type === 'conversation.reset-required') return null;
  if (!snapshot) throw new ConversationStoreError('NO_SNAPSHOT', 'Incremental Conversation event has no snapshot');
  if (event.defSessionId !== snapshot.defSessionId) {
    throw new ConversationStoreError('SESSION_MISMATCH', 'Conversation event belongs to another Session');
  }
  if (event.cursor.epoch !== snapshot.cursor.epoch) {
    throw new ConversationStoreError('EPOCH_CHANGED', 'Conversation event epoch changed; snapshot is required');
  }
  if (isStale(snapshot, event)) return snapshot;
  try {
    assertConversationEventTransition(snapshot.cursor, event);
  } catch (error) {
    throw mapTransitionError(error);
  }

  if (event.type === 'message.upsert') {
    const messages = upsertAt(snapshot.messages, event.message, event.index, (message) => message.id);
    return snapshotWith(snapshot, { messages }, event.cursor);
  }
  if (event.type === 'message.remove') {
    if (!snapshot.messages.some((message) => message.id === event.messageId)) {
      throw new ConversationStoreError('SOURCE_GAP', `Message ${event.messageId} is missing for removal`);
    }
    const messages = snapshot.messages.filter((message) => message.id !== event.messageId);
    const parts = snapshot.parts.filter((part) => part.messageId !== event.messageId);
    return snapshotWith(snapshot, { messages, parts }, event.cursor);
  }
  if (event.type === 'part.upsert' || event.type === 'interaction.upsert') {
    const part = event.part;
    const message = findMessage(snapshot.messages, part.messageId);
    if (!message) throw new ConversationStoreError('SOURCE_GAP', `Part ${part.id} has no parent Message`);
    const parts = upsertAt(snapshot.parts, part, event.index, (candidate) => candidate.id);
    const messages = ensureMessagePartId(snapshot.messages, message.id, part.id);
    return snapshotWith(snapshot, { messages, parts }, event.cursor);
  }
  if (event.type === 'part.delta') {
    const part = snapshot.parts.find((candidate) => candidate.id === event.partId);
    if (!part || part.messageId !== event.messageId) {
      throw new ConversationStoreError('SOURCE_GAP', `Part ${event.partId} is missing for delta`);
    }
    if (part.type !== 'text' && part.type !== 'reasoning') {
      throw new ConversationStoreError('INVALID_EVENT', `Part ${event.partId} cannot receive a text delta`);
    }
    const text = part.text + event.delta;
    if (text.length > DEF_CONVERSATION_LIMITS.maxTextCodeUnitsPerPart) {
      throw new ConversationStoreError('INVALID_EVENT', `Part ${event.partId} exceeds the text limit`);
    }
    const updated: ConversationPart = { ...part, text };
    return snapshotWith(snapshot, {
      parts: snapshot.parts.map((candidate) => candidate.id === event.partId ? updated : candidate),
    }, event.cursor);
  }
  if (event.type === 'part.remove') {
    const part = snapshot.parts.find((candidate) => candidate.id === event.partId);
    if (!part || part.messageId !== event.messageId) {
      throw new ConversationStoreError('SOURCE_GAP', `Part ${event.partId} is missing for removal`);
    }
    return snapshotWith(snapshot, {
      parts: snapshot.parts.filter((part) => part.id !== event.partId),
      messages: removeMessagePartId(snapshot.messages, event.messageId, event.partId),
    }, event.cursor);
  }
  if (event.type === 'interaction.remove') {
    const interaction = snapshot.parts.find((part) => part.id === event.partId);
    if (!interaction) throw new ConversationStoreError('SOURCE_GAP', `Interaction Part ${event.partId} is missing for removal`);
    if (interaction && (interaction.type !== 'interaction' || interaction.interactionId !== event.interactionId)) {
      throw new ConversationStoreError('INVALID_EVENT', `Interaction removal does not match Part ${event.partId}`);
    }
    return snapshotWith(snapshot, {
      parts: snapshot.parts.filter((part) => part.id !== event.partId),
      messages: removeMessagePartId(snapshot.messages, event.messageId, event.partId),
    }, event.cursor);
  }
  return snapshotWith(snapshot, { status: clone(event.status) }, event.cursor);
}

export const applyConversationEvent = reduceConversationEvent;

export interface ConversationStoreOptions {
  readonly maxResetRetries?: number;
}

export interface ConversationStore {
  readonly state: ConversationStoreState;
  readonly snapshot: ConversationSnapshot | null;
  getState(): ConversationStoreState;
  subscribe(listener: ConversationStoreListener): () => void;
  load(defSessionId: DefSessionId): Promise<ConversationSnapshot>;
  connect(defSessionId?: DefSessionId): Promise<void>;
  reconnect(): Promise<void>;
  disconnect(): void;
  apply(event: ConversationEvent): ConversationSnapshot | null;
}

/** Framework-neutral browser-side snapshot/delta Store. */
export class BrowserConversationStore implements ConversationStore {
  readonly #source: ConversationProjector;
  readonly #listeners = new Set<ConversationStoreListener>();
  readonly #maxResetRetries: number;
  #state: ConversationStoreState = {
    status: 'empty',
    sessionId: null,
    snapshot: null,
    cursor: null,
    error: null,
  };
  #generation = 0;
  #sessionId: DefSessionId | null = null;

  constructor(source: ConversationProjector, options: ConversationStoreOptions = {}) {
    this.#source = source;
    this.#maxResetRetries = Math.max(1, Math.floor(options.maxResetRetries ?? 8));
  }

  get state(): ConversationStoreState {
    return this.getState();
  }

  get snapshot(): ConversationSnapshot | null {
    return this.#state.snapshot ? clone(this.#state.snapshot) : null;
  }

  getState(): ConversationStoreState {
    return {
      status: this.#state.status,
      sessionId: this.#state.sessionId,
      snapshot: this.#state.snapshot ? clone(this.#state.snapshot) : null,
      cursor: this.#state.cursor ? clone(this.#state.cursor) : null,
      error: this.#state.error,
    };
  }

  subscribe(listener: ConversationStoreListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  async load(defSessionId: DefSessionId): Promise<ConversationSnapshot> {
    ++this.#generation;
    this.#sessionId = defSessionId;
    return this.#loadSnapshot(defSessionId, this.#generation);
  }

  async connect(defSessionId = this.#sessionId ?? undefined): Promise<void> {
    if (!defSessionId) {
      throw new ConversationStoreError('SESSION_MISMATCH', 'Conversation Store requires a Session ID');
    }
    const generation = ++this.#generation;
    this.#sessionId = defSessionId;
    let resetCount = 0;
    try {
      await this.#loadSnapshot(defSessionId, generation);
      while (generation === this.#generation) {
        const snapshot = this.#state.snapshot;
        if (!snapshot) throw new ConversationStoreError('NO_SNAPSHOT', 'Conversation snapshot disappeared');
        let mustReset = false;
        try {
          for await (const event of this.#source.subscribe(defSessionId, snapshot.cursor)) {
            if (generation !== this.#generation) return;
            try {
              const next = this.apply(event);
              if (next === null) {
                mustReset = true;
                break;
              }
            } catch (error) {
              if (!isResyncError(error)) throw error;
              mustReset = true;
              break;
            }
          }
        } catch (error) {
          if (generation !== this.#generation) return;
          throw new ConversationStoreError(
            'SOURCE_FAILED',
            `Conversation subscription failed: ${error instanceof Error ? error.message : String(error)}`,
            error,
          );
        }
        if (generation !== this.#generation) return;
        if (!mustReset) {
          this.#setState({ status: 'disconnected', error: null });
          return;
        }
        resetCount += 1;
        if (resetCount > this.#maxResetRetries) {
          throw new ConversationStoreError('RESET_LOOP', 'Conversation source repeatedly requested snapshot reset');
        }
        this.#setState({ status: 'reconnecting', snapshot: null, cursor: null, error: null });
        await this.#loadSnapshot(defSessionId, generation);
      }
    } catch (error) {
      if (generation !== this.#generation) return;
      const storeError = error instanceof ConversationStoreError
        ? error
        : new ConversationStoreError('SOURCE_FAILED', error instanceof Error ? error.message : String(error), error);
      this.#setState({ status: 'error', error: storeError });
      throw storeError;
    }
  }

  async reconnect(): Promise<void> {
    if (!this.#sessionId) throw new ConversationStoreError('SESSION_MISMATCH', 'Conversation Store has no Session to reconnect');
    return this.connect(this.#sessionId);
  }

  disconnect(): void {
    ++this.#generation;
    if (this.#sessionId) this.#setState({ status: 'disconnected' });
  }

  apply(event: ConversationEvent): ConversationSnapshot | null {
    if (this.#sessionId && event.defSessionId !== this.#sessionId) {
      throw new ConversationStoreError('SESSION_MISMATCH', 'Conversation event belongs to another Session');
    }
    const next = reduceConversationEvent(this.#state.snapshot, event);
    if (next === this.#state.snapshot) return next;
    if (next) {
      this.#sessionId = event.defSessionId;
      this.#setState({
        status: 'ready',
        sessionId: event.defSessionId,
        snapshot: next,
        cursor: next.cursor,
        error: null,
      });
    } else {
      this.#setState({ status: 'reconnecting', snapshot: null, cursor: null, error: null });
    }
    return next;
  }

  async #loadSnapshot(defSessionId: DefSessionId, generation: number): Promise<ConversationSnapshot> {
    this.#setState({
      status: 'loading',
      sessionId: defSessionId,
      snapshot: null,
      cursor: null,
      error: null,
    });
    const snapshot = await this.#source.getSnapshot(defSessionId);
    if (generation !== this.#generation) return snapshot;
    if (snapshot.defSessionId !== defSessionId) {
      throw new ConversationStoreError('SESSION_MISMATCH', 'Conversation snapshot belongs to another Session');
    }
    this.#sessionId = defSessionId;
    this.#setState({
      status: 'ready',
      sessionId: defSessionId,
      snapshot: clone(snapshot),
      cursor: clone(snapshot.cursor),
      error: null,
    });
    return clone(snapshot);
  }

  #setState(partial: Partial<ConversationStoreState>): void {
    this.#state = {
      ...this.#state,
      ...partial,
    };
    const state = this.getState();
    for (const listener of this.#listeners) listener(state);
  }
}

export function createConversationStore(
  source: ConversationProjector,
  options: ConversationStoreOptions = {},
): BrowserConversationStore {
  return new BrowserConversationStore(source, options);
}

export const createBrowserConversationStore = createConversationStore;
export const ConversationStore = BrowserConversationStore;

function isStale(snapshot: ConversationSnapshot, event: ConversationEvent): boolean {
  if (event.source === 'projector') return false;
  if (event.source === 'runtime') {
    return event.sourceSequence <= snapshot.cursor.runtimeSequence
      && event.cursor.hostSequence <= snapshot.cursor.hostSequence;
  }
  return event.sourceSequence <= snapshot.cursor.hostSequence
    && event.cursor.runtimeSequence <= snapshot.cursor.runtimeSequence;
}

function mapTransitionError(error: unknown): ConversationStoreError {
  const message = error instanceof Error ? error.message : String(error);
  if (/epoch changed/u.test(message)) return new ConversationStoreError('EPOCH_CHANGED', message, error);
  if (/not contiguous|gap/u.test(message)) return new ConversationStoreError('SOURCE_GAP', message, error);
  return new ConversationStoreError('INVALID_EVENT', message, error);
}

function isResyncError(error: unknown): error is ConversationStoreError {
  return error instanceof ConversationStoreError
    && (error.code === 'EPOCH_CHANGED' || error.code === 'SOURCE_GAP' || error.code === 'SOURCE_OUT_OF_ORDER' || error.code === 'NO_SNAPSHOT');
}

function snapshotWith(
  snapshot: ConversationSnapshot,
  changes: Partial<Pick<ConversationSnapshot, 'messages' | 'parts' | 'status'>>,
  cursor: ConversationSnapshot['cursor'] = snapshot.cursor,
): ConversationSnapshot {
  return {
    ...clone(snapshot),
    ...changes,
    cursor: clone(cursor),
    messages: clone(changes.messages ?? snapshot.messages),
    parts: clone(changes.parts ?? snapshot.parts),
    status: clone(changes.status ?? snapshot.status),
  };
}

function findMessage(messages: readonly ConversationMessage[], messageId: ConversationMessage['id']): ConversationMessage | undefined {
  return messages.find((message) => message.id === messageId);
}

function ensureMessagePartId(
  messages: readonly ConversationMessage[],
  messageId: ConversationMessage['id'],
  partId: ConversationPart['id'],
): ConversationMessage[] {
  return messages.map((message) => {
    if (message.id !== messageId || message.partIds.includes(partId)) return clone(message);
    return { ...clone(message), partIds: [...message.partIds, partId] };
  });
}

function removeMessagePartId(
  messages: readonly ConversationMessage[],
  messageId: ConversationMessage['id'],
  partId: ConversationPart['id'],
): ConversationMessage[] {
  return messages.map((message) => message.id === messageId
    ? { ...clone(message), partIds: message.partIds.filter((id) => id !== partId) }
    : clone(message));
}

function upsertAt<T>(
  values: readonly T[],
  value: T,
  index: number,
  identity: (entry: T) => string,
): T[] {
  if (!Number.isSafeInteger(index) || index < 0) {
    throw new ConversationStoreError('INVALID_EVENT', 'Conversation mutation index is invalid');
  }
  const next = values.filter((entry) => identity(entry) !== identity(value)).map((entry) => clone(entry));
  next.splice(Math.min(index, next.length), 0, clone(value));
  return next;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
