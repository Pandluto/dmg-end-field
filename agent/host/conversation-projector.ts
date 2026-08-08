import {
  asConversationPartId,
  assertConversationEventTransition,
  DEF_CONVERSATION_LIMITS,
  type ConversationCursor,
  type ConversationErrorPart,
  type ConversationEvent,
  type ConversationInteractionPart,
  type ConversationMessage,
  type ConversationPart,
  type ConversationProjector as ConversationProjectorContract,
  type ConversationReasoningPart,
  type ConversationSessionStatus,
  type ConversationSnapshot,
  type ConversationTextPart,
  type ConversationToolPart,
  type ConversationToolState,
  type DefEvent,
  type DefSessionId,
  type DefTurnId,
  type EngineSessionRef,
  type HostTranscriptPart,
  type InteractionId,
  type JsonObject,
  type JsonValue,
  type RuntimeTranscriptEvent,
  type RuntimeTranscriptPart,
  type RuntimeTranscriptSnapshot,
  type RuntimeTranscriptSource,
  type ToolCallId,
} from '../core/contracts/index.ts';
import type { DefAgentSessionStore } from './session-store.ts';

/** A high-water-marked, read-only view of the Host journal. */
export interface ConversationHostJournalSnapshot {
  readonly sequence: number;
  readonly events: readonly DefEvent[];
}

/**
 * The only Host-facing seam needed by the projector.  A Session Store can be
 * adapted with createConversationHostJournalSource below; the projector never
 * reads Runtime JSONL or any Runtime implementation type.
 */
export interface ConversationHostJournalSource {
  getSession(
    defSessionId: DefSessionId,
  ): ConversationHostSession | null | Promise<ConversationHostSession | null>;
  getSnapshot(
    defSessionId: DefSessionId,
  ): ConversationHostJournalSnapshot | Promise<ConversationHostJournalSnapshot>;
  subscribe(defSessionId: DefSessionId, afterHostSequence: number): AsyncIterable<DefEvent>;
}

export type HostJournalSource = ConversationHostJournalSource;

export interface ConversationHostSession {
  readonly engine: EngineSessionRef;
}

export interface ConversationProjectorOptions {
  readonly runtime: RuntimeTranscriptSource;
  readonly host: ConversationHostJournalSource | DefAgentSessionStore;
  /** A stable, transport-safe epoch for the first projector generation. */
  readonly epoch?: string;
  /** Used for projector event timestamps and deterministic tests. */
  readonly now?: () => string;
  /** Called whenever the current source generation can no longer be resumed. */
  readonly createEpoch?: (previousEpoch: string) => string;
}

export type ConversationProjectorSource = ConversationProjectorOptions;

export type ConversationProjectionErrorCode =
  | 'SESSION_NOT_FOUND'
  | 'SOURCE_GAP'
  | 'SOURCE_DUPLICATE'
  | 'SOURCE_OUT_OF_ORDER'
  | 'SOURCE_EPOCH_CHANGED'
  | 'SOURCE_INVALID'
  | 'PARENT_NOT_FOUND'
  | 'SOURCE_FAILED';

export class ConversationProjectionError extends Error {
  readonly code: ConversationProjectionErrorCode;
  readonly source: 'runtime' | 'host' | 'projector';
  readonly expectedSequence: number | null;
  readonly actualSequence: number | null;

  constructor(
    code: ConversationProjectionErrorCode,
    message: string,
    details: {
      readonly source?: 'runtime' | 'host' | 'projector';
      readonly expectedSequence?: number | null;
      readonly actualSequence?: number | null;
    } = {},
  ) {
    super(message);
    this.name = 'ConversationProjectionError';
    this.code = code;
    this.source = details.source ?? 'projector';
    this.expectedSequence = details.expectedSequence ?? null;
    this.actualSequence = details.actualSequence ?? null;
  }
}

interface MutableProjectionState {
  readonly defSessionId: DefSessionId;
  readonly engineSession: EngineSessionRef;
  readonly epoch: string;
  runtimeSequence: number;
  hostSequence: number;
  runtimeStatus: RuntimeTranscriptSnapshot['status'];
  hostStatus: ConversationSessionStatus | null;
  lastTurnId: DefTurnId | null;
  messages: ConversationMessage[];
  runtimePartOrder: string[];
  runtimeParts: Map<string, RuntimeTranscriptPart>;
  hostPartOrder: string[];
  hostParts: Map<string, HostTranscriptPart | ConversationInteractionPart>;
  toolCallToPartId: Map<string, string>;
  interactionToPartId: Map<string, string>;
}

type SessionStoreSource = Pick<DefAgentSessionStore, 'loadSession' | 'loadEvents'> & {
  readonly subscribeHost?: (defSessionId: DefSessionId, afterHostSequence: number) => AsyncIterable<DefEvent>;
};

interface HostSourceShape {
  readonly getSession?: ConversationHostJournalSource['getSession'];
  readonly loadSession?: SessionStoreSource['loadSession'];
  readonly getSnapshot?: ConversationHostJournalSource['getSnapshot'];
  readonly getHostSnapshot?: ConversationHostJournalSource['getSnapshot'];
  readonly loadEvents?: SessionStoreSource['loadEvents'];
  readonly subscribe?: ConversationHostJournalSource['subscribe'];
  readonly subscribeHost?: SessionStoreSource['subscribeHost'];
}

type SourceEvent =
  | { readonly source: 'runtime'; readonly event: RuntimeTranscriptEvent }
  | { readonly source: 'host'; readonly event: DefEvent };

type RuntimeChange =
  | { readonly type: 'message.upsert'; readonly message: ConversationMessage; readonly index: number }
  | { readonly type: 'message.remove'; readonly messageId: ConversationMessage['id'] }
  | { readonly type: 'part.upsert'; readonly part: RuntimeTranscriptPart; readonly index: number }
  | {
      readonly type: 'part.delta';
      readonly messageId: ConversationMessage['id'];
      readonly partId: ConversationPart['id'];
      readonly field: 'text';
      readonly delta: string;
    }
  | {
      readonly type: 'part.remove';
      readonly messageId: ConversationMessage['id'];
      readonly partId: ConversationPart['id'];
    }
  | { readonly type: 'session.status'; readonly status: ConversationSessionStatus };

type HostChange =
  | { readonly type: 'part.upsert'; readonly part: HostTranscriptPart; readonly index: number }
  | { readonly type: 'interaction.upsert'; readonly part: ConversationInteractionPart; readonly index: number }
  | {
      readonly type: 'interaction.remove';
      readonly messageId: ConversationMessage['id'];
      readonly partId: ConversationPart['id'];
      readonly interactionId: InteractionId;
    }
  | { readonly type: 'session.status'; readonly status: ConversationSessionStatus };

const DEFAULT_EPOCH_PREFIX = 'conversation';

/**
 * Deterministic projection of the Runtime transcript and Host journal.
 *
 * The state kept here is an ephemeral materialization cache for active
 * snapshot/subscribe pairs.  It is deliberately neither persisted nor
 * exposed as a journal; Runtime and Host remain the two authorities.
 */
export class ConversationProjector implements ConversationProjectorContract {
  readonly #runtime: RuntimeTranscriptSource;
  readonly #host: ConversationHostJournalSource;
  readonly #now: () => string;
  readonly #createEpoch: ((previousEpoch: string) => string) | null;
  readonly #epochPrefix: string;
  #epoch: string;
  #epochCounter = 0;
  readonly #states = new Map<string, Map<string, MutableProjectionState>>();
  readonly #latestStates = new Map<string, MutableProjectionState>();
  readonly #sessionEngines = new Map<string, EngineSessionRef>();

  constructor(options: ConversationProjectorOptions) {
    this.#runtime = options.runtime;
    this.#host = normalizeHostSource(options.host);
    this.#now = options.now ?? (() => new Date().toISOString());
    this.#createEpoch = options.createEpoch ?? null;
    this.#epoch = validateEpoch(options.epoch ?? `${DEFAULT_EPOCH_PREFIX}-${Date.now().toString(36)}`);
    this.#epochPrefix = this.#epoch;
  }

  async getSnapshot(defSessionId: DefSessionId): Promise<ConversationSnapshot> {
    const hostSession = await this.#host.getSession(defSessionId);
    if (!hostSession) {
      throw new ConversationProjectionError(
        'SESSION_NOT_FOUND',
        `DEF Session ${defSessionId} was not found`,
      );
    }

    const priorEngine = this.#sessionEngines.get(defSessionId);
    if (priorEngine && !engineSessionEquals(priorEngine, hostSession.engine)) {
      this.#rotateEpoch();
    }
    this.#sessionEngines.set(defSessionId, clone(hostSession.engine));

    const [runtimeSnapshot, hostSnapshot] = await Promise.all([
      this.#runtime.getRuntimeSnapshot(hostSession.engine),
      this.#host.getSnapshot(defSessionId),
    ]);
    validateRuntimeSnapshot(runtimeSnapshot, defSessionId, hostSession.engine);
    validateHostSnapshot(hostSnapshot, defSessionId);

    const state = createState(this.#epoch, defSessionId, hostSession.engine, runtimeSnapshot);
    for (const event of hostSnapshot.events) {
      state.hostSequence = event.sequence;
      applyHostEvent(state, event, false);
    }
    state.hostSequence = hostSnapshot.sequence;
    const snapshot = snapshotFromState(state);
    rememberState(this.#states, this.#latestStates, state);
    return snapshot;
  }

  async *subscribe(
    defSessionId: DefSessionId,
    cursor: ConversationCursor,
  ): AsyncIterable<ConversationEvent> {
    const requestedCursor = parseCursor(cursor);
    if (requestedCursor.epoch !== this.#epoch) {
      yield this.#resetEvent(
        defSessionId,
        'epoch-changed',
        this.#cursorForReset(defSessionId, requestedCursor),
      );
      return;
    }

    let state = this.#findState(defSessionId, requestedCursor);
    if (!state) {
      const latest = this.#latestStates.get(defSessionId);
      if (latest && latest.epoch === requestedCursor.epoch) {
        yield this.#resetEvent(defSessionId, 'gap', this.#cursorForState(latest));
      } else {
        yield this.#resetEvent(defSessionId, 'gap', requestedCursor);
      }
      return;
    }

    let runtimeIterator: AsyncIterator<RuntimeTranscriptEvent> | null = null;
    let hostIterator: AsyncIterator<DefEvent> | null = null;
    try {
      runtimeIterator = toAsyncIterator(
        this.#runtime.subscribeRuntime(state.engineSession, requestedCursor.runtimeSequence),
      );
      hostIterator = toAsyncIterator(this.#host.subscribe(defSessionId, requestedCursor.hostSequence));
      let runtimeNext: Promise<IteratorResult<RuntimeTranscriptEvent>> | null = runtimeIterator.next();
      let hostNext: Promise<IteratorResult<DefEvent>> | null = hostIterator.next();

      while (runtimeNext || hostNext) {
        const choices: Array<Promise<
          | { readonly source: 'runtime'; readonly result: IteratorResult<RuntimeTranscriptEvent> }
          | { readonly source: 'host'; readonly result: IteratorResult<DefEvent> }
        >> = [];
        if (runtimeNext) choices.push(runtimeNext.then((result) => ({ source: 'runtime', result })));
        if (hostNext) choices.push(hostNext.then((result) => ({ source: 'host', result })));
        const winner = await Promise.race(choices);
        if (winner.source === 'runtime') {
          runtimeNext = winner.result.done ? null : runtimeIterator.next();
          if (winner.result.done) continue;
          const sourceEvent: SourceEvent = { source: 'runtime', event: winner.result.value };
          try {
            const nextState = cloneState(state);
            validateSourceEvent(nextState, sourceEvent);
            const event = applyRuntimeEvent(nextState, sourceEvent.event);
            assertConversationEventTransition(cursorForState(state), event);
            state = nextState;
            rememberState(this.#states, this.#latestStates, state);
            yield event;
          } catch (error) {
            yield this.#resetEvent(defSessionId, 'gap', this.#cursorForState(state), error);
            return;
          }
          continue;
        }

        hostNext = winner.result.done ? null : hostIterator.next();
        if (winner.result.done) continue;
        const sourceEvent: SourceEvent = { source: 'host', event: winner.result.value };
        try {
          const nextState = cloneState(state);
          validateSourceEvent(nextState, sourceEvent);
          const event = applyHostEvent(nextState, sourceEvent.event, true);
          if (!event) throw new ConversationProjectionError('SOURCE_INVALID', 'Host event did not produce a Conversation event', { source: 'host' });
          assertConversationEventTransition(cursorForState(state), event);
          state = nextState;
          rememberState(this.#states, this.#latestStates, state);
          yield event;
        } catch (error) {
          yield this.#resetEvent(defSessionId, 'gap', this.#cursorForState(state), error);
          return;
        }
      }
    } catch (error) {
      yield this.#resetForSourceFailure(defSessionId, state, error);
      return;
    } finally {
      if (runtimeIterator) await closeAsyncIterator(runtimeIterator);
      if (hostIterator) await closeAsyncIterator(hostIterator);
    }
  }

  #findState(defSessionId: DefSessionId, cursor: ConversationCursor): MutableProjectionState | null {
    const entries = this.#states.get(defSessionId);
    const state = entries?.get(cursorKey(cursor));
    return state ? cloneState(state) : null;
  }

  #cursorForState(state: MutableProjectionState): ConversationCursor {
    return parseCursor({
      epoch: state.epoch,
      runtimeSequence: state.runtimeSequence,
      hostSequence: state.hostSequence,
    });
  }

  #cursorForReset(defSessionId: DefSessionId, requested: ConversationCursor): ConversationCursor {
    const latest = this.#latestStates.get(defSessionId);
    if (latest) return this.#cursorForState(latest);
    return parseCursor({
      epoch: this.#epoch,
      runtimeSequence: requested.runtimeSequence,
      hostSequence: requested.hostSequence,
    });
  }

  #resetForSourceFailure(
    defSessionId: DefSessionId,
    state: MutableProjectionState,
    error: unknown,
  ): ConversationEvent {
    return this.#resetEvent(
      defSessionId,
      'gap',
      this.#cursorForState(state),
      new ConversationProjectionError(
        'SOURCE_FAILED',
        `Conversation source subscription failed: ${error instanceof Error ? error.message : String(error)}`,
      ),
    );
  }

  #resetEvent(
    defSessionId: DefSessionId,
    reason: 'epoch-changed' | 'gap',
    cursor: ConversationCursor,
    _cause?: unknown,
  ): ConversationEvent {
    this.#rotateEpoch();
    const resetCursor = parseCursor({
      epoch: this.#epoch,
      runtimeSequence: cursor.runtimeSequence,
      hostSequence: cursor.hostSequence,
    });
    this.#states.delete(defSessionId);
    this.#latestStates.delete(defSessionId);
    return {
      schemaVersion: 1,
      type: 'conversation.reset-required',
      source: 'projector',
      sourceSequence: 0,
      defSessionId,
      occurredAt: this.#now(),
      cursor: resetCursor,
      reason,
    };
  }

  #rotateEpoch(): void {
    const previous = this.#epoch;
    const next = this.#createEpoch
      ? this.#createEpoch(previous)
      : `${this.#epochPrefix}-${++this.#epochCounter}`;
    this.#epoch = validateEpoch(next);
    if (this.#epoch === previous) {
      throw new ConversationProjectionError(
        'SOURCE_EPOCH_CHANGED',
        'Conversation projector epoch rotation did not produce a new epoch',
      );
    }
    this.#states.clear();
    this.#latestStates.clear();
  }
}

export function createConversationProjector(options: ConversationProjectorOptions): ConversationProjector {
  return new ConversationProjector(options);
}

export const createDefConversationProjector = createConversationProjector;
export const DefConversationProjector = ConversationProjector;

/**
 * Adapt the existing synchronous Host Session Store without making it part of
 * the browser-facing Conversation contract.  A real Host can provide
 * subscribeHost for push delivery; the fallback is intentionally a small
 * polling bridge for tests and local integrations.
 */
export function createConversationHostJournalSource(
  store: SessionStoreSource,
  options: { readonly pollIntervalMs?: number } = {},
): ConversationHostJournalSource {
  const pollIntervalMs = Math.max(1, Math.floor(options.pollIntervalMs ?? 50));
  return {
    getSession(defSessionId) {
      const record = store.loadSession(defSessionId);
      return record ? { engine: clone(record.session.engine) } : null;
    },
    getSnapshot(defSessionId) {
      const events = store.loadEvents(defSessionId).map((event) => clone(event));
      return {
        sequence: events.at(-1)?.sequence ?? 0,
        events,
      };
    },
    subscribe(defSessionId, afterHostSequence) {
      if (store.subscribeHost) return store.subscribeHost(defSessionId, afterHostSequence);
      return pollSessionStore(store, defSessionId, afterHostSequence, pollIntervalMs);
    },
  };
}

export const createHostJournalSource = createConversationHostJournalSource;

function normalizeHostSource(
  source: ConversationHostJournalSource | DefAgentSessionStore,
): ConversationHostJournalSource {
  const candidate = source as unknown as HostSourceShape;
  if (candidate.getSession && (candidate.getSnapshot || candidate.getHostSnapshot) && (candidate.subscribe || candidate.subscribeHost)) {
    const getSession = candidate.getSession;
    const getSnapshot = candidate.getSnapshot ?? candidate.getHostSnapshot;
    const subscribe = candidate.subscribe ?? candidate.subscribeHost;
    return {
      getSession: (defSessionId) => getSession.call(source, defSessionId),
      getSnapshot: (defSessionId) => getSnapshot!.call(source, defSessionId),
      subscribe: (defSessionId, afterHostSequence) => subscribe!.call(source, defSessionId, afterHostSequence),
    };
  }
  if (candidate.loadSession && candidate.loadEvents) {
    const loadSession = candidate.loadSession;
    const loadEvents = candidate.loadEvents;
    const subscribeHost = candidate.subscribeHost;
    return createConversationHostJournalSource({
      loadSession: (defSessionId) => loadSession.call(source, defSessionId),
      loadEvents: (defSessionId) => loadEvents.call(source, defSessionId),
      ...(subscribeHost ? {
        subscribeHost: (defSessionId, afterHostSequence) => subscribeHost.call(source, defSessionId, afterHostSequence),
      } : {}),
    });
  }
  throw new TypeError('Conversation projector Host source is missing Session Store methods');
}

function createState(
  epoch: string,
  defSessionId: DefSessionId,
  engineSession: EngineSessionRef,
  runtimeSnapshot: RuntimeTranscriptSnapshot,
): MutableProjectionState {
  const messages = runtimeSnapshot.messages.map((message) => clone(message));
  const runtimeParts = new Map<string, RuntimeTranscriptPart>();
  const runtimePartOrder: string[] = [];
  const toolCallToPartId = new Map<string, string>();
  for (const part of runtimeSnapshot.parts) {
    if (runtimeParts.has(part.id)) {
      throw new ConversationProjectionError('SOURCE_INVALID', `Runtime part ${part.id} is duplicated`, { source: 'runtime' });
    }
    runtimeParts.set(part.id, clone(part));
    runtimePartOrder.push(part.id);
    if (part.type === 'tool') toolCallToPartId.set(part.toolCallId, part.id);
  }
  for (const message of messages) {
    if (new Set(message.partIds).size !== message.partIds.length) {
      throw new ConversationProjectionError('SOURCE_INVALID', `Runtime message ${message.id} contains duplicate parts`, { source: 'runtime' });
    }
  }
  const lastPartMessageId = runtimeSnapshot.parts.at(-1)?.messageId;
  const lastTurnId = messages.at(-1)?.defTurnId
    ?? (lastPartMessageId
      ? messages.find((message) => message.id === lastPartMessageId)?.defTurnId ?? null
      : null);
  return {
    defSessionId,
    engineSession: clone(engineSession),
    epoch,
    runtimeSequence: runtimeSnapshot.sequence,
    hostSequence: 0,
    runtimeStatus: clone(runtimeSnapshot.status),
    hostStatus: null,
    lastTurnId,
    messages,
    runtimePartOrder,
    runtimeParts,
    hostPartOrder: [],
    hostParts: new Map(),
    toolCallToPartId,
    interactionToPartId: new Map(),
  };
}

function cloneState(state: MutableProjectionState): MutableProjectionState {
  return {
    defSessionId: state.defSessionId,
    engineSession: clone(state.engineSession),
    epoch: state.epoch,
    runtimeSequence: state.runtimeSequence,
    hostSequence: state.hostSequence,
    runtimeStatus: clone(state.runtimeStatus),
    hostStatus: clone(state.hostStatus),
    lastTurnId: state.lastTurnId,
    messages: clone(state.messages),
    runtimePartOrder: [...state.runtimePartOrder],
    runtimeParts: new Map([...state.runtimeParts.entries()].map(([id, part]) => [id, clone(part)])),
    hostPartOrder: [...state.hostPartOrder],
    hostParts: new Map([...state.hostParts.entries()].map(([id, part]) => [id, clone(part)])),
    toolCallToPartId: new Map(state.toolCallToPartId),
    interactionToPartId: new Map(state.interactionToPartId),
  };
}

function snapshotFromState(state: MutableProjectionState): ConversationSnapshot {
  const parts: ConversationPart[] = [];
  const seen = new Set<string>();
  for (const id of state.runtimePartOrder) {
    const part = state.hostParts.get(id) ?? state.runtimeParts.get(id);
    if (!part || seen.has(id)) continue;
    seen.add(id);
    parts.push(clone(part));
  }
  for (const id of state.hostPartOrder) {
    const part = state.hostParts.get(id);
    if (!part || seen.has(id)) continue;
    seen.add(id);
    parts.push(clone(part));
  }
  const partIdsByMessage = new Map<string, string[]>();
  for (const part of parts) {
    const ids = partIdsByMessage.get(part.messageId) ?? [];
    if (!ids.includes(part.id)) ids.push(part.id);
    partIdsByMessage.set(part.messageId, ids);
  }
  const availablePartIds = new Set(parts.map((part) => part.id));
  const messages = state.messages.map((message) => ({
    ...clone(message),
    partIds: mergePartIds(
      message.partIds.filter((partId) => availablePartIds.has(partId)),
      partIdsByMessage.get(message.id) ?? [],
    ),
  }));
  if (messages.length > DEF_CONVERSATION_LIMITS.maxMessagesPerSnapshot) {
    throw new ConversationProjectionError('SOURCE_INVALID', 'Conversation snapshot contains too many messages');
  }
  if (parts.length > DEF_CONVERSATION_LIMITS.maxPartsPerSnapshot) {
    throw new ConversationProjectionError('SOURCE_INVALID', 'Conversation snapshot contains too many parts');
  }
  return {
    schemaVersion: 1,
    defSessionId: state.defSessionId,
    cursor: {
      epoch: state.epoch,
      runtimeSequence: state.runtimeSequence,
      hostSequence: state.hostSequence,
    },
    status: effectiveStatus(state),
    messages,
    parts,
  };
}

function applyRuntimeEvent(state: MutableProjectionState, event: RuntimeTranscriptEvent): ConversationEvent {
  state.runtimeSequence = event.sequence;
  const mutation = event.mutation;
  if (mutation.type === 'message.upsert') {
    state.lastTurnId = mutation.message.defTurnId;
    upsertMessage(state, mutation.message, mutation.index);
    return runtimeEventBase(state, event, {
      type: 'message.upsert',
      message: clone(mutation.message),
      index: normalizeIndex(mutation.index, state.messages.length),
    });
  }
  if (mutation.type === 'message.remove') {
    removeMessage(state, mutation.messageId);
    return runtimeEventBase(state, event, { type: 'message.remove', messageId: mutation.messageId });
  }
  if (mutation.type === 'part.upsert') {
    if ((mutation.part as ConversationPart).type === 'interaction') {
      throw new ConversationProjectionError(
        'SOURCE_INVALID',
        'Runtime transcript cannot emit an interaction part',
        { source: 'runtime' },
      );
    }
    const message = requireMessage(state, mutation.part.messageId, 'runtime');
    state.lastTurnId = message.defTurnId;
    upsertRuntimePart(state, mutation.part, mutation.index);
    return runtimeEventBase(state, event, {
      type: 'part.upsert',
      part: clone(mutation.part),
      index: normalizeIndex(mutation.index, state.runtimePartOrder.length),
    });
  }
  if (mutation.type === 'part.delta') {
    requireMessage(state, mutation.messageId, 'runtime');
    const part = state.runtimeParts.get(mutation.partId);
    if (!part || part.messageId !== mutation.messageId) {
      throw parentNotFound('runtime', `Runtime part ${mutation.partId} was not found`);
    }
    if (part.type !== 'text' && part.type !== 'reasoning') {
      throw new ConversationProjectionError(
        'SOURCE_INVALID',
        `Runtime part ${mutation.partId} cannot receive text delta`,
        { source: 'runtime' },
      );
    }
    const updated: ConversationTextPart | ConversationReasoningPart = {
      ...part,
      text: appendBoundedText(part.text, mutation.delta),
    };
    state.runtimeParts.set(mutation.partId, updated);
    return runtimeEventBase(state, event, {
      type: 'part.delta',
      messageId: mutation.messageId,
      partId: mutation.partId,
      field: 'text',
      delta: mutation.delta,
    });
  }
  if (mutation.type === 'part.remove') {
    requireMessage(state, mutation.messageId, 'runtime');
    const part = state.runtimeParts.get(mutation.partId);
    if (!part || part.messageId !== mutation.messageId) {
      throw parentNotFound('runtime', `Runtime part ${mutation.partId} was not found`);
    }
    removePart(state, mutation.partId, 'runtime');
    return runtimeEventBase(state, event, {
      type: 'part.remove',
      messageId: mutation.messageId,
      partId: mutation.partId,
    });
  }
  state.runtimeStatus = clone(mutation.status);
  return runtimeEventBase(state, event, {
    type: 'session.status',
    status: effectiveStatus(state),
  });
}

function applyHostEvent(state: MutableProjectionState, event: DefEvent, incremental: boolean): ConversationEvent | null {
  if (event.defSessionId !== state.defSessionId) {
    throw new ConversationProjectionError(
      'SOURCE_INVALID',
      'Host journal event belongs to another Session',
      { source: 'host' },
    );
  }
  state.hostSequence = event.sequence;
  if (event.type === 'turn.accepted') {
    state.hostStatus = null;
    state.lastTurnId = event.defTurnId;
    return incremental ? hostStatusEvent(state, event) : null;
  }
  if (event.type === 'tool.requested') {
    if (state.hostStatus?.status === 'idle') state.hostStatus = null;
    const part = buildToolPart(state, event, 'pending');
    const index = upsertHostPart(state, part, findPartIndex(state, part.id));
    return incremental ? hostEventBase(state, event, { type: 'part.upsert', part, index }) : null;
  }
  if (event.type === 'tool.started') {
    const part = buildToolPart(state, event, 'running');
    const index = upsertHostPart(state, part, findPartIndex(state, part.id));
    return incremental ? hostEventBase(state, event, { type: 'part.upsert', part, index }) : null;
  }
  if (event.type === 'tool.result') {
    const part = buildToolPart(state, event, 'completed');
    const index = upsertHostPart(state, part, findPartIndex(state, part.id));
    return incremental ? hostEventBase(state, event, { type: 'part.upsert', part, index }) : null;
  }
  if (event.type === 'tool.error') {
    const part = buildToolPart(state, event, 'error');
    const index = upsertHostPart(state, part, findPartIndex(state, part.id));
    return incremental ? hostEventBase(state, event, { type: 'part.upsert', part, index }) : null;
  }
  if (event.type === 'interaction.requested') {
    if (state.hostStatus?.status === 'idle') state.hostStatus = null;
    const part = buildInteractionPart(state, event);
    const index = upsertInteractionPart(state, part, findPartIndex(state, part.id));
    return incremental ? hostEventBase(state, event, { type: 'interaction.upsert', part, index }) : null;
  }
  if (event.type === 'interaction.resolved') {
    const part = resolveInteractionPart(state, event);
    const index = upsertInteractionPart(state, part, findPartIndex(state, part.id));
    return incremental ? hostEventBase(state, event, { type: 'interaction.upsert', part, index }) : null;
  }
  if (isCommandEvent(event)) {
    const part = buildCommandToolPart(state, event);
    if (!part) return incremental ? hostStatusEvent(state, event) : null;
    const index = upsertHostPart(state, part, findPartIndex(state, part.id));
    return incremental ? hostEventBase(state, event, { type: 'part.upsert', part, index }) : null;
  }
  if (event.type === 'session.archived') {
    state.hostStatus = { status: 'archived' };
    return incremental ? hostStatusEvent(state, event) : null;
  }
  if (event.type === 'session.orphaned') {
    state.hostStatus = { status: 'error', code: event.payload.code, message: event.payload.message };
    return incremental ? hostStatusEvent(state, event) : null;
  }
  if (event.type === 'turn.failed') {
    state.hostStatus = { status: 'error', code: event.payload.code, message: event.payload.message };
    const part = buildHostErrorPart(state, event, event.payload.code, event.payload.message);
    const index = upsertHostPart(state, part, findPartIndex(state, part.id));
    return incremental ? hostEventBase(state, event, { type: 'part.upsert', part, index }) : null;
  }
  if (event.type === 'turn.interrupted') {
    state.hostStatus = { status: 'error', code: event.payload.code, message: event.payload.message };
    const part = buildHostErrorPart(state, event, event.payload.code, event.payload.message);
    const index = upsertHostPart(state, part, findPartIndex(state, part.id));
    return incremental ? hostEventBase(state, event, { type: 'part.upsert', part, index }) : null;
  }
  if (event.type === 'turn.stopped') {
    state.hostStatus = { status: 'idle' };
    return incremental ? hostStatusEvent(state, event) : null;
  }
  if (event.type === 'turn.completed') {
    state.hostStatus = { status: 'idle' };
    return incremental ? hostStatusEvent(state, event) : null;
  }
  return incremental ? hostStatusEvent(state, event) : null;
}

function validateSourceEvent(state: MutableProjectionState, sourceEvent: SourceEvent): void {
  if (sourceEvent.source === 'runtime') {
    const event = sourceEvent.event;
    if (event.schemaVersion !== 1 || !engineSessionEquals(event.engineSession, state.engineSession)) {
      throw new ConversationProjectionError('SOURCE_INVALID', 'Runtime source event is not for this Session', { source: 'runtime' });
    }
    validateSequence(state.runtimeSequence, event.sequence, 'runtime');
    return;
  }
  const event = sourceEvent.event;
  if (event.schemaVersion !== 1 || event.defSessionId !== state.defSessionId) {
    throw new ConversationProjectionError('SOURCE_INVALID', 'Host source event is not for this Session', { source: 'host' });
  }
  validateSequence(state.hostSequence, event.sequence, 'host');
}

function validateSequence(previous: number, actual: number, source: 'runtime' | 'host'): void {
  if (!Number.isSafeInteger(actual) || actual < 1) {
    throw new ConversationProjectionError('SOURCE_INVALID', `${source} sequence is invalid`, { source, actualSequence: actual });
  }
  const expected = previous + 1;
  if (actual === expected) return;
  if (actual <= previous) {
    throw new ConversationProjectionError(
      actual === previous ? 'SOURCE_DUPLICATE' : 'SOURCE_OUT_OF_ORDER',
      `${source} sequence ${actual} is not newer than ${previous}`,
      { source, expectedSequence: expected, actualSequence: actual },
    );
  }
  throw new ConversationProjectionError(
    'SOURCE_GAP',
    `${source} sequence gap: expected ${expected}, received ${actual}`,
    { source, expectedSequence: expected, actualSequence: actual },
  );
}

function upsertMessage(state: MutableProjectionState, message: ConversationMessage, index: number): void {
  const existing = state.messages.findIndex((entry) => entry.id === message.id);
  if (existing >= 0) state.messages.splice(existing, 1);
  state.messages.splice(normalizeIndex(index, state.messages.length), 0, clone(message));
}

function removeMessage(state: MutableProjectionState, messageId: ConversationMessage['id']): void {
  const index = state.messages.findIndex((message) => message.id === messageId);
  if (index < 0) throw parentNotFound('runtime', `Runtime message ${messageId} was not found`);
  state.messages.splice(index, 1);
  for (const id of [...state.runtimeParts.keys()]) {
    if (state.runtimeParts.get(id)?.messageId === messageId) removePart(state, id, 'runtime');
  }
  for (const id of [...state.hostParts.keys()]) {
    if (state.hostParts.get(id)?.messageId === messageId) removePart(state, id, 'host');
  }
}

function upsertRuntimePart(state: MutableProjectionState, part: RuntimeTranscriptPart, index: number): void {
  const existingRuntime = state.runtimeParts.get(part.id);
  if (existingRuntime && existingRuntime.messageId !== part.messageId) {
    throw new ConversationProjectionError('SOURCE_INVALID', `Runtime part ${part.id} changed parent message`, { source: 'runtime' });
  }
  const mappedId = part.type === 'tool' ? state.toolCallToPartId.get(part.toolCallId) : undefined;
  if (mappedId && mappedId !== part.id && state.hostParts.has(mappedId)) {
    const old = state.hostParts.get(mappedId);
    state.hostParts.delete(mappedId);
    state.hostPartOrder = state.hostPartOrder.filter((id) => id !== mappedId);
    if (old?.type === 'tool') {
      state.hostParts.set(part.id, { ...old, id: part.id, messageId: part.messageId });
      state.hostPartOrder.push(part.id);
    }
  }
  state.runtimeParts.set(part.id, clone(part));
  if (!state.runtimePartOrder.includes(part.id)) {
    state.runtimePartOrder.splice(normalizeIndex(index, state.runtimePartOrder.length), 0, part.id);
  }
  if (part.type === 'tool') state.toolCallToPartId.set(part.toolCallId, part.id);
}

function upsertHostPart(
  state: MutableProjectionState,
  part: HostTranscriptPart,
  index: number,
): number {
  const existing = state.hostParts.get(part.id);
  if (existing && existing.messageId !== part.messageId) {
    throw new ConversationProjectionError('SOURCE_INVALID', `Host part ${part.id} changed parent message`, { source: 'host' });
  }
  state.hostParts.set(part.id, clone(part));
  if (!state.hostPartOrder.includes(part.id) && !state.runtimePartOrder.includes(part.id)) {
    state.hostPartOrder.splice(normalizeIndex(index, state.hostPartOrder.length), 0, part.id);
  }
  if (part.type === 'tool') state.toolCallToPartId.set(part.toolCallId, part.id);
  return mergedPartIndex(state, part.id);
}

function upsertInteractionPart(
  state: MutableProjectionState,
  part: ConversationInteractionPart,
  index: number,
): number {
  const existing = state.hostParts.get(part.id);
  if (existing && existing.type !== 'interaction') {
    throw new ConversationProjectionError('SOURCE_INVALID', `Host part ${part.id} changed type`, { source: 'host' });
  }
  state.hostParts.set(part.id, clone(part));
  if (!state.interactionToPartId.has(part.interactionId)) {
    state.interactionToPartId.set(part.interactionId, part.id);
  }
  if (!state.hostPartOrder.includes(part.id) && !state.runtimePartOrder.includes(part.id)) {
    state.hostPartOrder.splice(normalizeIndex(index, state.hostPartOrder.length), 0, part.id);
  }
  return mergedPartIndex(state, part.id);
}

function removePart(state: MutableProjectionState, partId: string, source: 'runtime' | 'host'): void {
  const part = source === 'runtime' ? state.runtimeParts.get(partId) : state.hostParts.get(partId);
  if (!part) return;
  if (source === 'runtime') state.runtimeParts.delete(partId);
  else state.hostParts.delete(partId);
  state.runtimePartOrder = state.runtimePartOrder.filter((id) => id !== partId);
  state.hostPartOrder = state.hostPartOrder.filter((id) => id !== partId);
  if (part.type === 'tool' && state.toolCallToPartId.get(part.toolCallId) === partId) {
    state.toolCallToPartId.delete(part.toolCallId);
  }
  if (part.type === 'interaction' && state.interactionToPartId.get(part.interactionId) === partId) {
    state.interactionToPartId.delete(part.interactionId);
  }
}

function buildToolPart(
  state: MutableProjectionState,
  event: Extract<DefEvent, { type: 'tool.requested' | 'tool.started' | 'tool.result' | 'tool.error' }>,
  phase: ConversationToolState['status'],
): ConversationToolPart {
  const toolCallId = event.toolCallId;
  const existing = findToolPart(state, toolCallId);
  if (!existing) {
    throw parentNotFound('host', `Runtime Tool ${toolCallId} is missing for Host Tool event`);
  }
  const message = requireMessage(state, existing.messageId, 'host');
  const partId = existing.id;
  const input = toolInput(existing.state);
  const name = event.type === 'tool.requested' || event.type === 'tool.started'
    ? event.payload.name
    : existing?.name ?? `tool:${toolCallId}`;
  let stateValue: ConversationToolState;
  if (phase === 'pending') {
    stateValue = { status: 'pending', input };
  } else if (phase === 'running') {
    stateValue = {
      status: 'running',
      input,
      startedAt: event.occurredAt,
      title: name,
    };
  } else if (phase === 'completed') {
    if (event.type !== 'tool.result') throw new ConversationProjectionError('SOURCE_INVALID', 'Completed Tool state lacks result', { source: 'host' });
    const previousState = existing?.state;
    stateValue = {
      status: 'completed',
      input,
      output: clone(event.payload.result),
      ...(previousState?.status === 'running' ? { startedAt: previousState.startedAt } : {}),
      endedAt: event.occurredAt,
      title: name,
    };
  } else {
    if (event.type !== 'tool.error') throw new ConversationProjectionError('SOURCE_INVALID', 'Error Tool state lacks error payload', { source: 'host' });
    const previousState = existing?.state;
    stateValue = {
      status: 'error',
      input,
      code: event.payload.code,
      message: event.payload.message,
      ...(previousState?.status === 'running' ? { startedAt: previousState.startedAt } : {}),
      endedAt: event.occurredAt,
    };
  }
  const part: ConversationToolPart = {
    id: partId,
    messageId: message.id,
    createdAt: existing.createdAt,
    type: 'tool',
    toolCallId,
    name,
    state: stateValue,
  };
  return part;
}

function buildCommandToolPart(state: MutableProjectionState, event: Extract<DefEvent, { type: CommandEventType }>): ConversationToolPart | null {
  const existing = findToolPart(state, event.toolCallId);
  if (!existing) throw parentNotFound('host', `Tool ${event.toolCallId} is missing for Host command event`);
  const input = toolInput(existing.state);
  const name = existing.name;
  let stateValue: ConversationToolState;
  if (event.type === 'command.queued') {
    stateValue = { status: 'pending', input };
  } else if (event.type === 'command.dispatched' || event.type === 'command.claimed') {
    stateValue = {
      status: 'running',
      input,
      startedAt: event.occurredAt,
      title: name,
      detail: clone(event.payload) as unknown as JsonValue,
    };
  } else if (event.type === 'command.orphaned') {
    stateValue = {
      status: 'error',
      input,
      code: event.payload.code,
      message: event.payload.message,
      endedAt: event.occurredAt,
    };
  } else {
    stateValue = {
      status: 'completed',
      input,
      output: clone(event.payload) as unknown as JsonValue,
      endedAt: event.occurredAt,
      title: name,
    };
  }
  return {
    ...existing,
    state: stateValue,
  };
}

type CommandEventType =
  | 'command.queued'
  | 'command.dispatched'
  | 'command.claimed'
  | 'command.committed'
  | 'command.result'
  | 'command.reconciled'
  | 'command.orphaned';

function isCommandEvent(event: DefEvent): event is Extract<DefEvent, { type: CommandEventType }> {
  return event.type.startsWith('command.');
}

function buildInteractionPart(
  state: MutableProjectionState,
  event: Extract<DefEvent, { type: 'interaction.requested' }>,
): ConversationInteractionPart {
  const existingId = state.interactionToPartId.get(event.interactionId);
  const existing = existingId ? state.hostParts.get(existingId) : undefined;
  const message = existing?.type === 'interaction'
    ? requireMessage(state, existing.messageId, 'host')
    : requireTurnMessage(state, event.defTurnId);
  if (event.payload.kind !== 'question' && event.payload.kind !== 'approval') {
    throw new ConversationProjectionError('SOURCE_INVALID', 'Host interaction kind is invalid', { source: 'host' });
  }
  const payload = interactionPayload(event.payload);
  return {
    id: existing?.type === 'interaction' ? existing.id : asConversationPartId(`interaction:${event.interactionId}`),
    messageId: message.id,
    createdAt: existing?.type === 'interaction' ? existing.createdAt : event.occurredAt,
    type: 'interaction',
    interactionId: event.interactionId,
    interactionKind: event.payload.kind,
    prompt: event.payload.prompt,
    ...(payload ? { payload } : {}),
    state: {
      status: 'pending',
      expiresAt: event.payload.expiresAt,
    },
  };
}

function resolveInteractionPart(
  state: MutableProjectionState,
  event: Extract<DefEvent, { type: 'interaction.resolved' }>,
): ConversationInteractionPart {
  const id = state.interactionToPartId.get(event.interactionId);
  const current = id ? state.hostParts.get(id) : undefined;
  if (!current || current.type !== 'interaction') {
    throw parentNotFound('host', `Interaction ${event.interactionId} was not requested`);
  }
  return {
    ...current,
    state: {
      status: 'resolved',
      resolution: event.payload.status,
      ...(Object.prototype.hasOwnProperty.call(event.payload, 'value') ? { value: clone(event.payload.value) } : {}),
      resolvedAt: event.occurredAt,
    },
  };
}

function buildHostErrorPart(
  state: MutableProjectionState,
  event: Extract<DefEvent, { type: 'turn.failed' | 'turn.interrupted' }>,
  code: string,
  message: string,
): ConversationErrorPart {
  const parent = requireTurnMessage(state, event.defTurnId);
  return {
    id: asConversationPartId(`host-error:${event.sequence}`),
    messageId: parent.id,
    createdAt: event.occurredAt,
    type: 'error',
    code,
    message,
    retryable: false,
  };
}

function findToolPart(state: MutableProjectionState, toolCallId: ToolCallId): ConversationToolPart | undefined {
  const mapped = state.toolCallToPartId.get(toolCallId);
  const mappedPart = mapped ? state.hostParts.get(mapped) ?? state.runtimeParts.get(mapped) : undefined;
  if (mappedPart?.type === 'tool' && mappedPart.toolCallId === toolCallId) return clone(mappedPart);
  for (const part of [...state.hostParts.values(), ...state.runtimeParts.values()]) {
    if (part.type === 'tool' && part.toolCallId === toolCallId) {
      state.toolCallToPartId.set(toolCallId, part.id);
      return clone(part);
    }
  }
  return undefined;
}

function requireTurnMessage(state: MutableProjectionState, defTurnId: DefTurnId): ConversationMessage {
  const message = [...state.messages].reverse().find((entry) => entry.defTurnId === defTurnId && entry.role === 'assistant')
    ?? [...state.messages].reverse().find((entry) => entry.defTurnId === defTurnId);
  if (!message) throw parentNotFound('host', `Conversation message for Turn ${defTurnId} was not found`);
  state.lastTurnId = defTurnId;
  return message;
}

function requireMessage(state: MutableProjectionState, messageId: ConversationMessage['id'], source: 'runtime' | 'host'): ConversationMessage {
  const message = state.messages.find((entry) => entry.id === messageId);
  if (!message) throw parentNotFound(source, `Conversation message ${messageId} was not found`);
  return message;
}

function toolInput(state: ConversationToolState): JsonObject {
  return clone(state.input);
}

function interactionPayload(payload: Extract<DefEvent, { type: 'interaction.requested' }>['payload']): JsonObject | undefined {
  const result: JsonObject = {};
  if (payload.candidate !== undefined) result.candidate = clone(payload.candidate) as unknown as JsonValue;
  if (payload.candidateReview !== undefined) result.candidateReview = clone(payload.candidateReview) as unknown as JsonValue;
  if (payload.proposal !== undefined) result.proposal = clone(payload.proposal);
  return Object.keys(result).length > 0 ? result : undefined;
}

function hostStatusEvent(state: MutableProjectionState, event: DefEvent): ConversationEvent {
  state.hostSequence = event.sequence;
  return hostEventBase(state, event, { type: 'session.status', status: effectiveStatus(state) });
}

function runtimeEventBase(
  state: MutableProjectionState,
  event: RuntimeTranscriptEvent,
  change: RuntimeChange,
): ConversationEvent {
  const base = {
    schemaVersion: 1 as const,
    source: 'runtime' as const,
    sourceSequence: event.sequence,
    defSessionId: state.defSessionId,
    occurredAt: event.occurredAt,
    cursor: cursorForState(state),
  };
  if (change.type === 'message.upsert') return { ...base, type: 'message.upsert', message: change.message, index: change.index };
  if (change.type === 'message.remove') return { ...base, type: 'message.remove', messageId: change.messageId };
  if (change.type === 'part.upsert') return { ...base, type: 'part.upsert', part: change.part, index: change.index };
  if (change.type === 'part.delta') return { ...base, type: 'part.delta', messageId: change.messageId, partId: change.partId, field: 'text', delta: change.delta };
  if (change.type === 'part.remove') return { ...base, type: 'part.remove', messageId: change.messageId, partId: change.partId };
  return { ...base, type: 'session.status', status: change.status };
}

function hostEventBase(
  state: MutableProjectionState,
  event: DefEvent,
  change: HostChange,
): ConversationEvent {
  const base = {
    schemaVersion: 1 as const,
    source: 'host' as const,
    sourceSequence: event.sequence,
    defSessionId: state.defSessionId,
    occurredAt: event.occurredAt,
    cursor: cursorForState(state),
  };
  if (change.type === 'part.upsert') return { ...base, type: 'part.upsert', part: change.part, index: change.index };
  if (change.type === 'interaction.upsert') return { ...base, type: 'interaction.upsert', part: change.part, index: change.index };
  if (change.type === 'interaction.remove') {
    return {
      ...base,
      type: 'interaction.remove',
      messageId: change.messageId,
      partId: change.partId,
      interactionId: change.interactionId,
    };
  }
  return { ...base, type: 'session.status', status: change.status };
}

function effectiveStatus(state: MutableProjectionState): ConversationSessionStatus {
  if (state.hostStatus?.status === 'archived' || state.hostStatus?.status === 'error') return clone(state.hostStatus);
  const mergedParts = mergedPartValues(state);
  const pendingInteraction = mergedParts.find(
    (part): part is ConversationInteractionPart => part.type === 'interaction' && part.state.status === 'pending',
  );
  if (pendingInteraction) {
    return {
      status: 'waiting-interaction',
      defTurnId: requireMessage(state, pendingInteraction.messageId, 'host').defTurnId,
      interactionId: pendingInteraction.interactionId,
    };
  }
  const activeTool = mergedParts.find(
    (part): part is ConversationToolPart => part.type === 'tool' && (part.state.status === 'pending' || part.state.status === 'running'),
  );
  if (activeTool) {
    return {
      status: 'waiting-tool',
      defTurnId: requireMessage(state, activeTool.messageId, 'host').defTurnId,
      toolCallId: activeTool.toolCallId,
    };
  }
  if (state.runtimeStatus.status === 'error') return clone(state.runtimeStatus);
  if (state.runtimeStatus.status === 'compacting') return { status: 'compacting' };
  if (state.hostStatus?.status === 'idle') return { status: 'idle' };
  if (state.runtimeStatus.status === 'idle') return { status: 'idle' };
  const defTurnId = state.lastTurnId;
  if (!defTurnId) {
    throw new ConversationProjectionError('SOURCE_INVALID', 'Runtime running status has no Turn correlation');
  }
  return { status: 'running', defTurnId };
}

function validateRuntimeSnapshot(
  snapshot: RuntimeTranscriptSnapshot,
  defSessionId: DefSessionId,
  engineSession: EngineSessionRef,
): void {
  if (snapshot.schemaVersion !== 1 || !Number.isSafeInteger(snapshot.sequence) || snapshot.sequence < 0) {
    throw new ConversationProjectionError('SOURCE_INVALID', 'Runtime snapshot is invalid', { source: 'runtime' });
  }
  if (!engineSessionEquals(snapshot.engineSession, engineSession)) {
    throw new ConversationProjectionError('SOURCE_INVALID', 'Runtime snapshot belongs to another Engine Session', { source: 'runtime' });
  }
  if (snapshot.messages.length > DEF_CONVERSATION_LIMITS.maxMessagesPerSnapshot || snapshot.parts.length > DEF_CONVERSATION_LIMITS.maxPartsPerSnapshot) {
    throw new ConversationProjectionError('SOURCE_INVALID', 'Runtime snapshot exceeds Conversation limits', { source: 'runtime' });
  }
  const messageIds = new Set<string>();
  for (const message of snapshot.messages) {
    if (messageIds.has(message.id) || message.defTurnId === undefined) {
      throw new ConversationProjectionError('SOURCE_INVALID', `Runtime message ${message.id} is invalid`, { source: 'runtime' });
    }
    messageIds.add(message.id);
  }
  for (const part of snapshot.parts) {
    if (!messageIds.has(part.messageId)) {
      throw parentNotFound('runtime', `Runtime part ${part.id} has no message ${part.messageId}`);
    }
    if ((part.type === 'text' || part.type === 'reasoning') && part.text.length > DEF_CONVERSATION_LIMITS.maxTextCodeUnitsPerPart) {
      throw new ConversationProjectionError('SOURCE_INVALID', `Runtime part ${part.id} exceeds text limits`, { source: 'runtime' });
    }
  }
  if (defSessionId.trim() === '') throw new ConversationProjectionError('SOURCE_INVALID', 'Session ID is empty');
}

function validateHostSnapshot(snapshot: ConversationHostJournalSnapshot, defSessionId: DefSessionId): void {
  if (!Number.isSafeInteger(snapshot.sequence) || snapshot.sequence < 0) {
    throw new ConversationProjectionError('SOURCE_INVALID', 'Host snapshot sequence is invalid', { source: 'host' });
  }
  let previous = 0;
  for (const [index, event] of snapshot.events.entries()) {
    if (event.schemaVersion !== 1 || !Number.isSafeInteger(event.sequence) || event.sequence < 1) {
      throw new ConversationProjectionError('SOURCE_INVALID', 'Host snapshot contains an invalid event', { source: 'host' });
    }
    if (event.defSessionId !== defSessionId) {
      throw new ConversationProjectionError('SOURCE_INVALID', 'Host snapshot contains another Session event', { source: 'host' });
    }
    if (event.sequence <= previous) {
      throw new ConversationProjectionError(
        event.sequence === previous ? 'SOURCE_DUPLICATE' : 'SOURCE_OUT_OF_ORDER',
        'Host snapshot events are not strictly ordered',
        { source: 'host', expectedSequence: previous + 1, actualSequence: event.sequence },
      );
    }
    if (index === 0 && event.sequence !== 1) {
      throw new ConversationProjectionError(
        'SOURCE_GAP',
        `Host snapshot starts at ${event.sequence} instead of sequence 1`,
        { source: 'host', expectedSequence: 1, actualSequence: event.sequence },
      );
    }
    if (event.sequence > snapshot.sequence) {
      throw new ConversationProjectionError('SOURCE_INVALID', 'Host snapshot event exceeds its high-water mark', { source: 'host' });
    }
    previous = event.sequence;
  }
  if (snapshot.sequence > 0 && previous !== snapshot.sequence) {
    throw new ConversationProjectionError(
      'SOURCE_GAP',
      `Host snapshot high-water mark ${snapshot.sequence} is not covered by its events`,
      { source: 'host', expectedSequence: previous + 1, actualSequence: snapshot.sequence },
    );
  }
}

function engineSessionEquals(left: EngineSessionRef, right: EngineSessionRef): boolean {
  return left.kind === right.kind
    && left.sessionId === right.sessionId
    && left.runtimeVersion === right.runtimeVersion
    && left.storeSchemaVersion === right.storeSchemaVersion;
}

function cursorForState(state: MutableProjectionState): ConversationCursor {
  return {
    epoch: state.epoch,
    runtimeSequence: state.runtimeSequence,
    hostSequence: state.hostSequence,
  };
}

function parseCursor(cursor: ConversationCursor): ConversationCursor {
  const value = {
    epoch: cursor.epoch,
    runtimeSequence: cursor.runtimeSequence,
    hostSequence: cursor.hostSequence,
  };
  if (cursor.epoch === '') throw new TypeError('Conversation cursor epoch is empty');
  return Object.freeze(value);
}

function validateEpoch(epoch: string): string {
  return parseCursor({ epoch, runtimeSequence: 0, hostSequence: 0 }).epoch;
}

function cursorKey(cursor: ConversationCursor): string {
  return `${cursor.epoch}|${cursor.runtimeSequence}|${cursor.hostSequence}`;
}

function rememberState(
  states: Map<string, Map<string, MutableProjectionState>>,
  latestStates: Map<string, MutableProjectionState>,
  state: MutableProjectionState,
): void {
  const sessionStates = states.get(state.defSessionId) ?? new Map<string, MutableProjectionState>();
  sessionStates.set(cursorKey(cursorForState(state)), cloneState(state));
  while (sessionStates.size > 8) {
    const oldest = sessionStates.keys().next().value;
    if (oldest === undefined) break;
    sessionStates.delete(oldest);
  }
  states.set(state.defSessionId, sessionStates);
  latestStates.set(state.defSessionId, cloneState(state));
}

function findPartIndex(state: MutableProjectionState, partId: string): number {
  return mergedPartIndex(state, partId);
}

function mergedPartIndex(state: MutableProjectionState, partId: string): number {
  const order = [...state.runtimePartOrder, ...state.hostPartOrder.filter((id) => !state.runtimePartOrder.includes(id))];
  const index = order.indexOf(partId);
  return index >= 0 ? index : order.length;
}

function normalizeIndex(index: number, length: number): number {
  if (!Number.isSafeInteger(index) || index < 0) {
    throw new ConversationProjectionError('SOURCE_INVALID', 'Conversation mutation index is invalid');
  }
  return Math.min(index, length);
}

function mergePartIds(existing: readonly string[], additional: readonly string[]): readonly ConversationPart['id'][] {
  const ids: ConversationPart['id'][] = [];
  for (const id of [...existing, ...additional]) {
    if (!ids.includes(id as ConversationPart['id'])) ids.push(id as ConversationPart['id']);
  }
  return ids;
}

function appendBoundedText(current: string, delta: string): string {
  const next = current + delta;
  if (next.length > DEF_CONVERSATION_LIMITS.maxTextCodeUnitsPerPart) {
    throw new ConversationProjectionError('SOURCE_INVALID', 'Conversation text part exceeds its limit');
  }
  return next;
}

function parentNotFound(source: 'runtime' | 'host', message: string): ConversationProjectionError {
  return new ConversationProjectionError('PARENT_NOT_FOUND', message, { source });
}

function mergedPartValues(state: MutableProjectionState): ConversationPart[] {
  const parts: ConversationPart[] = [];
  const seen = new Set<string>();
  for (const id of [...state.runtimePartOrder, ...state.hostPartOrder]) {
    if (seen.has(id)) continue;
    const part = state.hostParts.get(id) ?? state.runtimeParts.get(id);
    if (!part) continue;
    seen.add(id);
    parts.push(part);
  }
  return parts;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function toAsyncIterator<T>(iterable: AsyncIterable<T>): AsyncIterator<T> {
  return iterable[Symbol.asyncIterator]();
}

async function closeAsyncIterator<T>(iterator: AsyncIterator<T>): Promise<void> {
  if (typeof iterator.return === 'function') await iterator.return();
}

async function* pollSessionStore(
  store: SessionStoreSource,
  defSessionId: DefSessionId,
  afterHostSequence: number,
  pollIntervalMs: number,
): AsyncIterable<DefEvent> {
  let cursor = afterHostSequence;
  while (true) {
    const events = store.loadEvents(defSessionId);
    const next = events.filter((event) => event.sequence > cursor);
    if (next.length > 0) {
      for (const event of next) {
        cursor = event.sequence;
        yield clone(event);
      }
      continue;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, pollIntervalMs));
  }
}
