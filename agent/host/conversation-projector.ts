import {
  asConversationMessageId,
  asConversationPartId,
  assertConversationMessage,
  assertConversationPart,
  assertConversationEvent,
  assertConversationSerializedSize,
  assertConversationSnapshot,
  assertConversationEventTransition,
  DEF_CONVERSATION_LIMITS,
  type ConversationCursor,
  parseConversationCursor,
  conversationSerializedCodeUnits,
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
  subscribe(
    defSessionId: DefSessionId,
    afterHostSequence: number,
    signal?: AbortSignal,
  ): AsyncIterable<DefEvent>;
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
  readonly instrumentation?: ConversationProjectorInstrumentation;
}

export interface ConversationProjectorInstrumentation {
  readonly onFullSnapshotValidation?: (elements: number) => void;
  /** Boundary copies may walk history. */
  readonly onBoundaryStateClone?: (elements: number) => void;
  /** Must remain zero for every source mutation. */
  readonly onIncrementalStateClone?: (elements: number) => void;
  readonly onIncrementalValidation?: () => void;
  /** Number of Message/Part values copied into the current boundary cache. */
  readonly onCacheStateClone?: (elements: number) => void;
  /** Number of Message/Part values inspected by one incremental mutation. */
  readonly onIncrementalTraversal?: (elements: number) => void;
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
  messageById: Map<string, ConversationMessage>;
  messageIndexById: Map<string, number>;
  runtimeMessageIds: Set<string>;
  runtimeMessagePartIds: Map<string, Set<string>>;
  hostPartIdsByMessage: Map<string, Set<string>>;
  messageIdsByTurnId: Map<string, Set<string>>;
  assistantMessageByTurnId: Map<string, string>;
  lastMessageByTurnId: Map<string, string>;
  partOrder: string[];
  partIndexById: Map<string, number>;
  runtimeParts: Map<string, RuntimeTranscriptPart>;
  hostParts: Map<string, HostTranscriptPart | ConversationInteractionPart>;
  partIdentityById: Map<string, PartIdentity>;
  toolCallToPartId: Map<string, string>;
  interactionToPartId: Map<string, string>;
  activeToolPartIds: Set<string>;
  pendingInteractionPartIds: Set<string>;
  serializedCodeUnits: number;
  messageSerializedSizes: Map<string, number>;
  partSerializedSizes: Map<string, number>;
  statusSerializedSize: number;
  effectiveStatusValue: ConversationSessionStatus;
}

interface PartIdentity {
  readonly messageId: string;
  readonly type: ConversationPart['type'];
  readonly toolCallId?: string;
  readonly interactionId?: string;
}

type SessionStoreSource = Pick<DefAgentSessionStore, 'loadSession' | 'loadEvents'> & {
  readonly loadEventPage?: DefAgentSessionStore['loadEventPage'];
  readonly subscribeHost?: (defSessionId: DefSessionId, afterHostSequence: number, signal?: AbortSignal) => AsyncIterable<DefEvent>;
};

interface HostSourceShape {
  readonly getSession?: ConversationHostJournalSource['getSession'];
  readonly loadSession?: SessionStoreSource['loadSession'];
  readonly getSnapshot?: ConversationHostJournalSource['getSnapshot'];
  readonly getHostSnapshot?: ConversationHostJournalSource['getSnapshot'];
  readonly loadEvents?: SessionStoreSource['loadEvents'];
  readonly loadEventPage?: SessionStoreSource['loadEventPage'];
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
const MAX_CAUSAL_SNAPSHOT_RETRIES = 3;
const MAX_CAUSAL_EVENT_RETRIES = 3;
const CLOSE_TIMEOUT_MS = 250;
const MAX_GLOBAL_CACHE_ENTRIES = 128;
const MAX_CACHED_SESSIONS = 64;
const KNOWN_HOST_EVENT_TYPES = new Set<DefEvent['type']>([
  'session.ready', 'session.recovered', 'session.archived', 'session.orphaned',
  'turn.accepted', 'response.first-token', 'response.delta',
  'tool.requested', 'tool.started', 'tool.result', 'tool.error',
  'harness.routed', 'harness.resumed', 'harness.phase.entered', 'harness.tool.projected', 'harness.terminal',
  'interaction.requested', 'interaction.resolved',
  'command.queued', 'command.dispatched', 'command.claimed', 'command.committed',
  'command.result', 'command.reconciled', 'command.orphaned',
  'turn.completed', 'turn.stopped', 'turn.interrupted', 'turn.failed',
]);

/**
 * Deterministic projection of the Runtime transcript and Host journal.
 *
 * The state kept here is an ephemeral materialization cache for active
 * snapshot/subscribe pairs.  It is deliberately neither persisted nor
 * exposed as a journal; Runtime and Host remain the two authorities.  Each
 * Session keeps only its latest boundary state.  A cursor older than that
 * boundary is a cache gap, so callers refetch a snapshot instead of asking
 * the projector to retain or replay an unbounded history of full states.  In
 * particular, a cursor yielded by live progress is not a new boundary:
 * reconnecting with it intentionally returns a same-epoch gap/reset.
 */
export class ConversationProjector implements ConversationProjectorContract {
  readonly #runtime: RuntimeTranscriptSource;
  readonly #host: ConversationHostJournalSource;
  readonly #now: () => string;
  readonly #createEpoch: ((previousEpoch: string) => string) | null;
  readonly #initialEpoch: string;
  readonly #epochPrefix: string;
  #epochCounter = 0;
  readonly #states = new Map<string, Map<string, MutableProjectionState>>();
  readonly #latestStates = new Map<string, MutableProjectionState>();
  readonly #sessionEngines = new Map<string, EngineSessionRef>();
  readonly #sessionEpochs = new Map<string, string>();
  readonly #activeSubscriptions = new Map<string, Set<AbortController>>();
  readonly #instrumentation: ConversationProjectorInstrumentation | null;
  readonly #cacheOrder = new Map<string, true>();
  readonly #sessionCacheOrder = new Map<string, true>();
  #initialEpochIssued = false;

  constructor(options: ConversationProjectorOptions) {
    this.#runtime = options.runtime;
    this.#host = normalizeHostSource(options.host);
    this.#now = options.now ?? (() => new Date().toISOString());
    this.#createEpoch = options.createEpoch ?? null;
    this.#instrumentation = options.instrumentation ?? null;
    this.#initialEpoch = validateEpoch(options.epoch ?? `${DEFAULT_EPOCH_PREFIX}-${Date.now().toString(36)}`);
    this.#epochPrefix = this.#initialEpoch;
  }

  async getSnapshot(defSessionId: DefSessionId): Promise<ConversationSnapshot> {
    for (let attempt = 0; attempt < MAX_CAUSAL_SNAPSHOT_RETRIES; attempt += 1) {
      const hostSession = await this.#host.getSession(defSessionId);
      if (!hostSession) {
        throw new ConversationProjectionError(
          'SESSION_NOT_FOUND',
          `DEF Session ${defSessionId} was not found`,
        );
      }
      const epoch = this.#bindSession(defSessionId, hostSession.engine);

      // Host high-water is captured first.  Runtime is then read after the
      // causal boundary so Host Tool/Interaction parents cannot be observed
      // against an older Runtime snapshot without a bounded retry.
      const rawHostSnapshot = await this.#host.getSnapshot(defSessionId);
      assertSerializedSourceSize(rawHostSnapshot, 'host', DEF_CONVERSATION_LIMITS.maxSnapshotCodeUnits);
      const hostSnapshot = clone(rawHostSnapshot);
      const rawRuntimeSnapshot = await this.#runtime.getRuntimeSnapshot(hostSession.engine);
      assertSerializedSourceSize(rawRuntimeSnapshot, 'runtime', DEF_CONVERSATION_LIMITS.maxSnapshotCodeUnits);
      const runtimeSnapshot = clone(rawRuntimeSnapshot);
      try {
        validateRuntimeSnapshot(runtimeSnapshot, defSessionId, hostSession.engine);
        validateHostSnapshot(hostSnapshot, defSessionId);
        const state = createState(epoch, defSessionId, hostSession.engine, runtimeSnapshot);
        for (const event of hostSnapshot.events) applyHostEvent(state, event, false);
        state.hostSequence = hostSnapshot.sequence;
        assertProjectionState(state);
        this.#instrumentation?.onFullSnapshotValidation?.(stateElementCount(state));
        const snapshot = snapshotFromState(state);
        this.#rememberState(state);
        return clone(snapshot);
      } catch (error) {
        if (error instanceof ConversationProjectionError && error.code === 'PARENT_NOT_FOUND' && attempt + 1 < MAX_CAUSAL_SNAPSHOT_RETRIES) {
          continue;
        }
        throw error;
      }
    }
    throw new ConversationProjectionError('SOURCE_FAILED', 'Conversation snapshot causal capture exhausted');
  }

  async *subscribe(
    defSessionId: DefSessionId,
    cursor: ConversationCursor,
    signal?: AbortSignal,
  ): AsyncIterable<ConversationEvent> {
    const requestedCursor = parseCursor(cursor);
    const hostSession = await this.#host.getSession(defSessionId);
    if (!hostSession) {
      throw new ConversationProjectionError('SESSION_NOT_FOUND', `DEF Session ${defSessionId} was not found`);
    }
    const epoch = this.#bindSession(defSessionId, hostSession.engine);
    if (signal?.aborted) return;
    if (requestedCursor.epoch !== epoch) {
      yield this.#resetEvent(
        defSessionId,
        'epoch-changed',
        this.#cursorForReset(defSessionId),
      );
      return;
    }

    const boundaryState = this.#findState(defSessionId, requestedCursor);
    if (!boundaryState) {
      yield this.#resetEvent(defSessionId, 'gap', this.#cursorForReset(defSessionId));
      return;
    }
    let state = boundaryState;

    const controller = new AbortController();
    const abortFromCaller = () => controller.abort();
    if (signal) signal.addEventListener('abort', abortFromCaller, { once: true });
    const subscriptions = this.#activeSubscriptions.get(defSessionId) ?? new Set<AbortController>();
    subscriptions.add(controller);
    this.#activeSubscriptions.set(defSessionId, subscriptions);
    let runtimeIterator: AsyncIterator<RuntimeTranscriptEvent> | null = null;
    let hostIterator: AsyncIterator<DefEvent> | null = null;
    try {
      runtimeIterator = toAsyncIterator(
        this.#runtime.subscribeRuntime(state.engineSession, requestedCursor.runtimeSequence, controller.signal),
      );
      hostIterator = toAsyncIterator(this.#host.subscribe(defSessionId, requestedCursor.hostSequence, controller.signal));
      let runtimeNext: Promise<IteratorResult<RuntimeTranscriptEvent>> | null = nextWithAbort(runtimeIterator, controller.signal);
      let hostNext: Promise<IteratorResult<DefEvent>> | null = nextWithAbort(hostIterator, controller.signal);
      let pendingRuntime: RuntimeTranscriptEvent | null = null;
      let pendingHost: DefEvent | null = null;
      let parentWaits = 0;

      while (runtimeNext || hostNext || pendingRuntime || pendingHost) {
        if (controller.signal.aborted) return;
        const pending = pendingRuntime
          ? ({ source: 'runtime' as const, event: pendingRuntime })
          : pendingHost
            ? ({ source: 'host' as const, event: pendingHost })
            : null;
        if (pending) {
          const stableCursor = cursorForState(state);
          try {
            const event = this.#applySourceEvent(state, pending);
            state = event.state;
            if (pending.source === 'runtime') pendingRuntime = null;
            else pendingHost = null;
            parentWaits = 0;
            if (pending.source === 'runtime' && runtimeNext === null) runtimeNext = nextWithAbort(runtimeIterator!, controller.signal);
            if (pending.source === 'host' && hostNext === null) hostNext = nextWithAbort(hostIterator!, controller.signal);
            yield event.event;
            continue;
          } catch (error) {
            if (!(error instanceof ConversationProjectionError) || error.code !== 'PARENT_NOT_FOUND') {
              yield* this.#sourceReset(defSessionId, state, controller, stableCursor, error);
              return;
            }
            parentWaits += 1;
            if (parentWaits >= MAX_CAUSAL_EVENT_RETRIES || (!runtimeNext && !hostNext)) {
              yield* this.#sourceReset(defSessionId, state, controller, stableCursor, error);
              return;
            }
          }
        }
        const choices: Array<Promise<
          | { readonly source: 'runtime'; readonly result: IteratorResult<RuntimeTranscriptEvent> }
          | { readonly source: 'host'; readonly result: IteratorResult<DefEvent> }
        >> = [];
        if (runtimeNext) choices.push(runtimeNext.then((result) => ({ source: 'runtime', result })));
        if (hostNext) choices.push(hostNext.then((result) => ({ source: 'host', result })));
        if (choices.length === 0) {
          yield* this.#sourceReset(
            defSessionId,
            state,
            controller,
            cursorForState(state),
            new ConversationProjectionError('PARENT_NOT_FOUND', 'Conversation event parent remained unavailable'),
          );
          return;
        }
        const winner = await Promise.race(choices);
        if (controller.signal.aborted) return;
        if (winner.source === 'runtime') {
          runtimeNext = null;
          if (winner.result.done) continue;
          assertSerializedSourceSize(winner.result.value, 'runtime');
          const sourceEvent: SourceEvent = { source: 'runtime', event: clone(winner.result.value) };
          const stableCursor = cursorForState(state);
          try {
            const event = this.#applySourceEvent(state, sourceEvent);
            state = event.state;
            runtimeNext = nextWithAbort(runtimeIterator, controller.signal);
            yield event.event;
          } catch (error) {
            if (error instanceof ConversationProjectionError && error.code === 'PARENT_NOT_FOUND') pendingRuntime = sourceEvent.event;
            else {
              yield* this.#sourceReset(defSessionId, state, controller, stableCursor, error);
              return;
            }
          }
          continue;
        }

        hostNext = null;
        if (winner.result.done) continue;
        assertSerializedSourceSize(winner.result.value, 'host');
        const sourceEvent: SourceEvent = { source: 'host', event: clone(winner.result.value) };
        const stableCursor = cursorForState(state);
        try {
          const event = this.#applySourceEvent(state, sourceEvent);
          state = event.state;
          hostNext = nextWithAbort(hostIterator, controller.signal);
          yield event.event;
        } catch (error) {
          if (error instanceof ConversationProjectionError && error.code === 'PARENT_NOT_FOUND') pendingHost = sourceEvent.event;
          else {
            yield* this.#sourceReset(defSessionId, state, controller, stableCursor, error);
            return;
          }
      }
    }
    } catch (error) {
      if (controller.signal.aborted) return;
      yield* this.#sourceReset(defSessionId, state, controller, cursorForState(state), error);
      return;
    } finally {
      controller.abort();
      subscriptions.delete(controller);
      if (subscriptions.size === 0) this.#activeSubscriptions.delete(defSessionId);
      if (signal) signal.removeEventListener('abort', abortFromCaller);
      await Promise.allSettled([
        ...(runtimeIterator ? [closeAsyncIterator(runtimeIterator)] : []),
        ...(hostIterator ? [closeAsyncIterator(hostIterator)] : []),
      ]);
    }
  }

  #applySourceEvent(
    state: MutableProjectionState,
    sourceEvent: SourceEvent,
  ): { readonly state: MutableProjectionState; readonly event: ConversationEvent } {
    // `state` belongs exclusively to this subscription after #findState's
    // boundary copy.  Validate first, then commit changes in place.  If any
    // later invariant fails, the caller discards this private state and emits
    // a reset; no mutable state was ever shared with a cache checkpoint.
    const previousCursor = cursorForState(state);
    validateSourceEvent(state, sourceEvent);
    const event = sourceEvent.source === 'runtime'
      ? applyRuntimeEvent(state, sourceEvent.event)
      : applyHostEvent(state, sourceEvent.event, true);
    if (!event) throw new ConversationProjectionError('SOURCE_INVALID', 'Host event did not produce a Conversation event', { source: 'host' });
    assertConversationEvent(event);
    assertConversationEventTransition(previousCursor, event);
    this.#instrumentation?.onIncrementalValidation?.();
    assertIncrementalState(state, sourceEvent);
    this.#instrumentation?.onIncrementalTraversal?.(incrementalTouchedElements(sourceEvent));
    this.#instrumentation?.onIncrementalStateClone?.(0);
    return { state, event };
  }

  *#sourceReset(
    defSessionId: DefSessionId,
    _state: MutableProjectionState,
    current: AbortController,
    stableCursor: ConversationCursor,
    error: unknown,
  ): Generator<ConversationEvent> {
    const cursor = this.#rotateSession(defSessionId, current, stableCursor);
    yield this.#resetEvent(defSessionId, 'gap', cursor, error);
  }

  #findState(defSessionId: DefSessionId, cursor: ConversationCursor): MutableProjectionState | null {
    const entries = this.#states.get(defSessionId);
    const state = entries?.get(cursorKey(cursor));
    if (!state) return null;
    this.#touchCache(defSessionId, cursorKey(cursor));
    this.#instrumentation?.onBoundaryStateClone?.(stateElementCount(state));
    return cloneState(state);
  }

  #cursorForState(state: MutableProjectionState): ConversationCursor {
    return parseCursor({
      epoch: state.epoch,
      runtimeSequence: state.runtimeSequence,
      hostSequence: state.hostSequence,
    });
  }

  #cursorForReset(defSessionId: DefSessionId): ConversationCursor {
    const latest = this.#latestStates.get(defSessionId);
    const epoch = this.#epochFor(defSessionId);
    if (latest && latest.epoch === epoch) return this.#cursorForState(latest);
    return parseCursor({
      epoch,
      runtimeSequence: 0,
      hostSequence: 0,
    });
  }

  #resetEvent(
    defSessionId: DefSessionId,
    reason: 'epoch-changed' | 'gap',
    cursor: ConversationCursor,
    _cause?: unknown,
  ): ConversationEvent {
    const resetCursor = parseCursor({
      epoch: this.#epochFor(defSessionId),
      runtimeSequence: cursor.runtimeSequence,
      hostSequence: cursor.hostSequence,
    });
    const event: ConversationEvent = {
      schemaVersion: 1,
      type: 'conversation.reset-required',
      source: 'projector',
      sourceSequence: 0,
      defSessionId,
      occurredAt: this.#now(),
      cursor: resetCursor,
      reason,
    };
    assertConversationEvent(event);
    return event;
  }

  #bindSession(defSessionId: DefSessionId, engine: EngineSessionRef): string {
    const priorEngine = this.#sessionEngines.get(defSessionId);
    if (priorEngine && !engineSessionEquals(priorEngine, engine)) this.#rotateSession(defSessionId);
    this.#sessionEngines.set(defSessionId, clone(engine));
    if (!this.#sessionEpochs.has(defSessionId)) {
      this.#sessionEpochs.set(defSessionId, this.#allocateEpoch());
    }
    return this.#epochFor(defSessionId);
  }

  #epochFor(defSessionId: DefSessionId): string {
    const epoch = this.#sessionEpochs.get(defSessionId);
    if (!epoch) {
      const validated = this.#allocateEpoch();
      this.#sessionEpochs.set(defSessionId, validated);
      return validated;
    }
    return epoch;
  }

  #allocateEpoch(): string {
    if (!this.#initialEpochIssued) {
      this.#initialEpochIssued = true;
      return this.#initialEpoch;
    }
    return validateEpoch(`${this.#epochPrefix}-${++this.#epochCounter}`);
  }

  #rotateSession(
    defSessionId: DefSessionId,
    except?: AbortController,
    stableCursor?: ConversationCursor,
  ): ConversationCursor {
    const previous = this.#epochFor(defSessionId);
    const next = this.#createEpoch
      ? this.#createEpoch(previous)
      : `${this.#epochPrefix}-${++this.#epochCounter}`;
    const epoch = validateEpoch(next);
    if (epoch === previous) {
      throw new ConversationProjectionError(
        'SOURCE_EPOCH_CHANGED',
        'Conversation projector epoch rotation did not produce a new epoch',
      );
    }
    this.#sessionEpochs.set(defSessionId, epoch);
    this.#dropSessionCache(defSessionId, false);
    const active = this.#activeSubscriptions.get(defSessionId);
    if (active) {
      for (const controller of active) if (controller !== except) controller.abort();
    }
    return parseCursor({
      epoch,
      runtimeSequence: stableCursor?.runtimeSequence ?? 0,
      hostSequence: stableCursor?.hostSequence ?? 0,
    });
  }

  #rememberState(state: MutableProjectionState): void {
    const sessionKey = state.defSessionId;
    const key = cursorKey(cursorForState(state));
    const sessionStates = this.#states.get(sessionKey) ?? new Map<string, MutableProjectionState>();
    // A live subscription mutates its private copy in place.  Keeping older
    // full states would make every checkpoint another O(history) clone, so a
    // Session retains only its latest boundary cursor.  Older cursors,
    // including cursors yielded by live progress, are deliberate same-epoch
    // gaps and must refetch a fresh snapshot.
    for (const oldKey of [...sessionStates.keys()]) this.#removeCacheKey(sessionKey, oldKey);
    const cached = cloneState(state);
    this.#instrumentation?.onCacheStateClone?.(stateElementCount(state));
    sessionStates.set(key, cached);
    this.#states.set(sessionKey, sessionStates);
    // The latest entry is the same internal boundary copy, not a second full
    // state clone.  It is never mutated by a live subscription.
    this.#latestStates.set(sessionKey, cached);
    const globalKey = cacheKey(sessionKey, key);
    this.#cacheOrder.delete(globalKey);
    this.#cacheOrder.set(globalKey, true);
    this.#touchSession(sessionKey);
    while (this.#cacheOrder.size > MAX_GLOBAL_CACHE_ENTRIES) {
      const oldest = this.#cacheOrder.keys().next().value as string | undefined;
      if (!oldest) break;
      this.#cacheOrder.delete(oldest);
      const separator = oldest.indexOf('\u0000');
      if (separator < 0) continue;
      this.#removeCacheKey(oldest.slice(0, separator), oldest.slice(separator + 1));
    }
    while (this.#sessionCacheOrder.size > MAX_CACHED_SESSIONS) {
      let evicted = false;
      for (const oldestSession of this.#sessionCacheOrder.keys()) {
        if (this.#activeSubscriptions.has(oldestSession)) continue;
        this.#evictSession(oldestSession);
        evicted = true;
        break;
      }
      if (!evicted) break;
    }
  }

  #touchCache(defSessionId: string, key: string): void {
    const global = cacheKey(defSessionId, key);
    if (this.#cacheOrder.delete(global)) this.#cacheOrder.set(global, true);
    this.#touchSession(defSessionId);
  }

  #touchSession(defSessionId: string): void {
    this.#sessionCacheOrder.delete(defSessionId);
    this.#sessionCacheOrder.set(defSessionId, true);
  }

  #removeCacheKey(defSessionId: string, key: string): void {
    const entries = this.#states.get(defSessionId);
    entries?.delete(key);
    if (entries && entries.size === 0) this.#states.delete(defSessionId);
    const latest = this.#latestStates.get(defSessionId);
    if (latest && cursorKey(cursorForState(latest)) === key) this.#latestStates.delete(defSessionId);
    const global = cacheKey(defSessionId, key);
    this.#cacheOrder.delete(global);
  }

  #dropSessionCache(defSessionId: string, removeFromLru = true): void {
    const sessionStates = this.#states.get(defSessionId);
    if (sessionStates) {
      for (const key of sessionStates.keys()) {
        const global = cacheKey(defSessionId, key);
        this.#cacheOrder.delete(global);
      }
    }
    this.#states.delete(defSessionId);
    this.#latestStates.delete(defSessionId);
    if (removeFromLru) this.#sessionCacheOrder.delete(defSessionId);
  }

  #evictSession(defSessionId: string): void {
    this.#dropSessionCache(defSessionId);
    this.#sessionEngines.delete(defSessionId);
    this.#sessionEpochs.delete(defSessionId);
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
      const events = loadBoundedHostEvents(store, defSessionId);
      return {
        sequence: events.at(-1)?.sequence ?? 0,
        events,
      };
    },
    subscribe(defSessionId, afterHostSequence, signal) {
      if (store.subscribeHost) return store.subscribeHost(defSessionId, afterHostSequence, signal);
      return pollSessionStore(store, defSessionId, afterHostSequence, pollIntervalMs, signal);
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
      subscribe: (defSessionId, afterHostSequence, signal) => subscribe!.call(source, defSessionId, afterHostSequence, signal),
    };
  }
  if (candidate.loadSession && candidate.loadEvents) {
    const loadSession = candidate.loadSession;
    const loadEvents = candidate.loadEvents;
    const loadEventPage = candidate.loadEventPage;
    const subscribeHost = candidate.subscribeHost;
    return createConversationHostJournalSource({
      loadSession: (defSessionId) => loadSession.call(source, defSessionId),
      loadEvents: (defSessionId) => loadEvents.call(source, defSessionId),
      ...(loadEventPage ? {
        loadEventPage: (defSessionId, afterSequence, limit) => loadEventPage.call(source, defSessionId, afterSequence, limit),
      } : {}),
      ...(subscribeHost ? {
        subscribeHost: (defSessionId, afterHostSequence, signal) => subscribeHost.call(source, defSessionId, afterHostSequence, signal),
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
  const messageById = new Map<string, ConversationMessage>();
  const messageIndexById = new Map<string, number>();
  const runtimeMessageIds = new Set<string>();
  const runtimeMessagePartIds = new Map<string, Set<string>>();
  const hostPartIdsByMessage = new Map<string, Set<string>>();
  const messageIdsByTurnId = new Map<string, Set<string>>();
  const assistantMessageByTurnId = new Map<string, string>();
  const lastMessageByTurnId = new Map<string, string>();
  for (const [index, message] of messages.entries()) {
    messageById.set(message.id, message);
    messageIndexById.set(message.id, index);
    runtimeMessageIds.add(message.id);
    runtimeMessagePartIds.set(message.id, new Set(message.partIds));
    indexTurnMessageMaps(message, messageIdsByTurnId, assistantMessageByTurnId, lastMessageByTurnId);
  }
  const runtimeParts = new Map<string, RuntimeTranscriptPart>();
  const partOrder: string[] = [];
  const partIndexById = new Map<string, number>();
  const partIdentityById = new Map<string, PartIdentity>();
  const toolCallToPartId = new Map<string, string>();
  const activeToolPartIds = new Set<string>();
  const pendingInteractionPartIds = new Set<string>();
  for (const part of runtimeSnapshot.parts) {
    if (runtimeParts.has(part.id)) {
      throw new ConversationProjectionError('SOURCE_INVALID', `Runtime part ${part.id} is duplicated`, { source: 'runtime' });
    }
    runtimeParts.set(part.id, clone(part));
    rememberPartIdentity(partIdentityById, part, 'runtime');
    partIndexById.set(part.id, partOrder.length);
    partOrder.push(part.id);
    if (part.type === 'tool') {
      if (toolCallToPartId.has(part.toolCallId)) {
        throw new ConversationProjectionError('SOURCE_INVALID', `Runtime Tool call ${part.toolCallId} is duplicated`, { source: 'runtime' });
      }
      toolCallToPartId.set(part.toolCallId, part.id);
      if (part.state.status === 'pending' || part.state.status === 'running') activeToolPartIds.add(part.id);
    }
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
  const messageSerializedSizes = new Map(messages.map((message) => [message.id, serializedSize(message)]));
  const partSerializedSizes = new Map([...runtimeParts.entries()].map(([id, part]) => [id, serializedSize(part)]));
  const initialStatus = runtimeStatusAsConversationStatus(runtimeSnapshot.status, messages);
  const statusSerializedSize = serializedSize(initialStatus);
  const state: MutableProjectionState = {
    defSessionId,
    engineSession: clone(engineSession),
    epoch,
    runtimeSequence: runtimeSnapshot.sequence,
    hostSequence: 0,
    runtimeStatus: clone(runtimeSnapshot.status),
    hostStatus: null,
    lastTurnId,
    messages,
    messageById,
    messageIndexById,
    runtimeMessageIds,
    runtimeMessagePartIds,
    hostPartIdsByMessage,
    messageIdsByTurnId,
    assistantMessageByTurnId,
    lastMessageByTurnId,
    partOrder,
    partIndexById,
    runtimeParts,
    hostParts: new Map(),
    partIdentityById,
    toolCallToPartId,
    interactionToPartId: new Map(),
    activeToolPartIds,
    pendingInteractionPartIds,
    serializedCodeUnits: 1
      + [...messageSerializedSizes.values()].reduce((sum, size) => sum + size, 0)
      + [...partSerializedSizes.values()].reduce((sum, size) => sum + size, 0)
      + statusSerializedSize,
    messageSerializedSizes,
    partSerializedSizes,
    statusSerializedSize,
    effectiveStatusValue: initialStatus,
  };
  refreshEffectiveStatus(state);
  return state;
}

function cloneState(state: MutableProjectionState): MutableProjectionState {
  const messages = state.messages.map((message) => ({ ...message, partIds: [...message.partIds] }));
  return {
    defSessionId: state.defSessionId,
    engineSession: clone(state.engineSession),
    epoch: state.epoch,
    runtimeSequence: state.runtimeSequence,
    hostSequence: state.hostSequence,
    runtimeStatus: clone(state.runtimeStatus),
    hostStatus: clone(state.hostStatus),
    lastTurnId: state.lastTurnId,
    messages,
    messageById: new Map(messages.map((message) => [message.id, message])),
    messageIndexById: new Map(state.messageIndexById),
    runtimeMessageIds: new Set(state.runtimeMessageIds),
    runtimeMessagePartIds: cloneSetMap(state.runtimeMessagePartIds),
    hostPartIdsByMessage: cloneSetMap(state.hostPartIdsByMessage),
    messageIdsByTurnId: cloneSetMap(state.messageIdsByTurnId),
    assistantMessageByTurnId: new Map(state.assistantMessageByTurnId),
    lastMessageByTurnId: new Map(state.lastMessageByTurnId),
    partOrder: [...state.partOrder],
    partIndexById: new Map(state.partIndexById),
    runtimeParts: new Map(state.runtimeParts),
    hostParts: new Map(state.hostParts),
    partIdentityById: new Map(state.partIdentityById),
    toolCallToPartId: new Map(state.toolCallToPartId),
    interactionToPartId: new Map(state.interactionToPartId),
    activeToolPartIds: new Set(state.activeToolPartIds),
    pendingInteractionPartIds: new Set(state.pendingInteractionPartIds),
    serializedCodeUnits: state.serializedCodeUnits,
    messageSerializedSizes: new Map(state.messageSerializedSizes),
    partSerializedSizes: new Map(state.partSerializedSizes),
    statusSerializedSize: state.statusSerializedSize,
    effectiveStatusValue: clone(state.effectiveStatusValue),
  };
}

function snapshotFromState(state: MutableProjectionState): ConversationSnapshot {
  const parts: ConversationPart[] = [];
  for (const id of state.partOrder) {
    const part = state.hostParts.get(id) ?? state.runtimeParts.get(id);
    if (!part) continue;
    parts.push(clone(part));
  }
  const messages = state.messages.map((message) => ({
    ...clone(message),
    partIds: clone(message.partIds),
  }));
  if (messages.length > DEF_CONVERSATION_LIMITS.maxMessagesPerSnapshot) {
    throw new ConversationProjectionError('SOURCE_INVALID', 'Conversation snapshot contains too many messages');
  }
  if (parts.length > DEF_CONVERSATION_LIMITS.maxPartsPerSnapshot) {
    throw new ConversationProjectionError('SOURCE_INVALID', 'Conversation snapshot contains too many parts');
  }
  const snapshot: ConversationSnapshot = {
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
  assertConversationSnapshot(snapshot);
  return snapshot;
}

function applyRuntimeEvent(state: MutableProjectionState, event: RuntimeTranscriptEvent): ConversationEvent {
  const mutation = event.mutation;
  if (mutation.type === 'message.upsert') {
    const startsNewTurn = state.lastTurnId !== mutation.message.defTurnId;
    state.lastTurnId = mutation.message.defTurnId;
    // A Host idle marker belongs to the previous Turn. Runtime may publish the
    // next Turn's Message before Host turn.accepted crosses the other stream.
    if (startsNewTurn && state.hostStatus?.status === 'idle') state.hostStatus = null;
    const index = upsertMessage(state, mutation.message, mutation.index);
    refreshEffectiveStatus(state);
    const effectiveMessage = requireMessage(state, mutation.message.id, 'runtime');
    return runtimeEventBase(state, event, {
      type: 'message.upsert',
      message: clone(effectiveMessage),
      index,
    });
  }
  if (mutation.type === 'message.remove') {
    const retained = removeRuntimeMessage(state, mutation.messageId);
    refreshEffectiveStatus(state);
    if (retained) {
      return runtimeEventBase(state, event, {
        type: 'message.upsert',
        message: clone(retained.message),
        index: retained.index,
      });
    }
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
    const index = upsertRuntimePart(state, mutation.part, mutation.index);
    const effective = effectivePart(state, mutation.part.id);
    if (!effective || effective.type === 'interaction') {
      throw new ConversationProjectionError('SOURCE_INVALID', 'Runtime Part has no valid effective projection', { source: 'runtime' });
    }
    return runtimeEventBase(state, event, {
      type: 'part.upsert',
      part: clone(effective),
      index,
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
    refreshEffectivePartSize(state, mutation.partId, part);
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
    const visible = state.hostParts.get(mutation.partId);
    if (visible && visible.type !== 'interaction') {
      return runtimeEventBase(state, event, {
        type: 'part.upsert',
        part: clone(visible),
        index: mergedPartIndex(state, mutation.partId),
      });
    }
    return runtimeEventBase(state, event, {
      type: 'part.remove',
      messageId: mutation.messageId,
      partId: mutation.partId,
    });
  }
  state.runtimeStatus = clone(mutation.status);
  refreshEffectiveStatus(state);
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
  if (!incremental) state.hostSequence = event.sequence;
  if (event.type === 'turn.accepted') {
    state.hostStatus = null;
    if (state.runtimeStatus.status !== 'running' || !state.lastTurnId) state.lastTurnId = event.defTurnId;
    refreshEffectiveStatus(state);
    return incremental ? hostStatusEvent(state, event) : null;
  }
  if (event.type === 'tool.requested') {
    const part = buildToolPart(state, event, 'pending');
    if (state.hostStatus?.status === 'idle') state.hostStatus = null;
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
    const part = buildInteractionPart(state, event);
    if (state.hostStatus?.status === 'idle') state.hostStatus = null;
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
    refreshEffectiveStatus(state);
    return incremental ? hostStatusEvent(state, event) : null;
  }
  if (event.type === 'session.orphaned') {
    state.hostStatus = { status: 'error', code: event.payload.code, message: event.payload.message };
    refreshEffectiveStatus(state);
    return incremental ? hostStatusEvent(state, event) : null;
  }
  if (event.type === 'turn.failed') {
    const part = buildHostErrorPart(state, event, event.payload.code, event.payload.message);
    if (event.defTurnId === state.lastTurnId) {
      state.hostStatus = { status: 'error', code: event.payload.code, message: event.payload.message };
    }
    const index = upsertHostPart(state, part, findPartIndex(state, part.id));
    return incremental ? hostEventBase(state, event, { type: 'part.upsert', part, index }) : null;
  }
  if (event.type === 'turn.interrupted') {
    const part = buildHostErrorPart(state, event, event.payload.code, event.payload.message);
    if (event.defTurnId === state.lastTurnId) {
      state.hostStatus = { status: 'error', code: event.payload.code, message: event.payload.message };
    }
    const index = upsertHostPart(state, part, findPartIndex(state, part.id));
    return incremental ? hostEventBase(state, event, { type: 'part.upsert', part, index }) : null;
  }
  if (event.type === 'turn.stopped') {
    if (event.defTurnId === state.lastTurnId) state.hostStatus = { status: 'idle' };
    refreshEffectiveStatus(state);
    return incremental ? hostStatusEvent(state, event) : null;
  }
  if (event.type === 'turn.completed') {
    if (event.defTurnId === state.lastTurnId) state.hostStatus = { status: 'idle' };
    refreshEffectiveStatus(state);
    return incremental ? hostStatusEvent(state, event) : null;
  }
  return incremental ? hostStatusEvent(state, event) : null;
}

function validateSourceEvent(state: MutableProjectionState, sourceEvent: SourceEvent): void {
  if (sourceEvent.source === 'runtime') {
    const event = sourceEvent.event;
    if (!isRecord(event) || event.schemaVersion !== 1 || !isEngineSession(event.engineSession) || !engineSessionEquals(event.engineSession, state.engineSession)) {
      throw new ConversationProjectionError('SOURCE_INVALID', 'Runtime source event is not for this Session', { source: 'runtime' });
    }
    assertSerializedSourceSize(event, 'runtime');
    if (!isRecord(event.mutation) || typeof event.mutation.type !== 'string') {
      throw new ConversationProjectionError('SOURCE_INVALID', 'Runtime source mutation is invalid', { source: 'runtime' });
    }
    const mutation = event.mutation;
    if (mutation.type === 'message.upsert') {
      assertConversationMessage(mutation.message);
      assertMutationIndex(mutation.index, 'runtime');
    } else if (mutation.type === 'part.upsert') {
      assertConversationPart(mutation.part);
      assertMutationIndex(mutation.index, 'runtime');
    } else if (mutation.type === 'part.delta') {
      if (mutation.field !== 'text' || !isIdentifier(mutation.messageId) || !isIdentifier(mutation.partId) || typeof mutation.delta !== 'string') {
        throw new ConversationProjectionError('SOURCE_INVALID', 'Runtime text delta is invalid', { source: 'runtime' });
      }
      if (mutation.delta.length > DEF_CONVERSATION_LIMITS.maxTextCodeUnitsPerPart) throw new ConversationProjectionError('SOURCE_INVALID', 'Runtime text delta exceeds its limit', { source: 'runtime' });
    } else if (mutation.type === 'message.remove') {
      if (!isIdentifier(mutation.messageId)) throw new ConversationProjectionError('SOURCE_INVALID', 'Runtime Message removal is invalid', { source: 'runtime' });
    } else if (mutation.type === 'part.remove') {
      if (!isIdentifier(mutation.messageId) || !isIdentifier(mutation.partId)) throw new ConversationProjectionError('SOURCE_INVALID', 'Runtime Part removal is invalid', { source: 'runtime' });
    } else if (mutation.type === 'session.status') {
      if (!isRecord(mutation.status) || typeof mutation.status.status !== 'string') throw new ConversationProjectionError('SOURCE_INVALID', 'Runtime status mutation is invalid', { source: 'runtime' });
    } else {
      throw new ConversationProjectionError('SOURCE_INVALID', 'Runtime source mutation variant is invalid', { source: 'runtime' });
    }
    validateSequence(state.runtimeSequence, event.sequence, 'runtime');
    return;
  }
  const event = sourceEvent.event;
  if (!isRecord(event) || event.schemaVersion !== 1 || event.defSessionId !== state.defSessionId) {
    throw new ConversationProjectionError('SOURCE_INVALID', 'Host source event is not for this Session', { source: 'host' });
  }
  validateHostEvent(event, state.defSessionId);
  validateSequence(state.hostSequence, event.sequence, 'host');
}

function assertMutationIndex(index: unknown, source: 'runtime' | 'host'): asserts index is number {
  if (!Number.isSafeInteger(index) || Number(index) < 0) {
    throw new ConversationProjectionError('SOURCE_INVALID', `${source} mutation index is invalid`, { source });
  }
}

function assertSerializedSourceSize(
  value: unknown,
  source: 'runtime' | 'host',
  limit = DEF_CONVERSATION_LIMITS.maxEventCodeUnits,
): void {
  try {
    assertConversationSerializedSize(value, limit, `${source} source event`);
  } catch {
    throw new ConversationProjectionError('SOURCE_INVALID', `${source} source event exceeds serialized bounds`, { source });
  }
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

function upsertMessage(state: MutableProjectionState, message: ConversationMessage, index: number): number {
  const existing = state.messageById.get(message.id);
  if (existing) unindexTurnMessage(state, existing);

  const nextRuntimeIds = new Set<string>(message.partIds);
  const previousRuntimeIds = state.runtimeMessagePartIds.get(message.id) ?? new Set<string>();
  for (const partId of previousRuntimeIds) {
    if (!nextRuntimeIds.has(partId)) removePart(state, partId, 'runtime');
  }
  for (const partId of nextRuntimeIds) {
    const part = state.runtimeParts.get(partId) ?? state.hostParts.get(partId);
    if (!part || part.messageId !== message.id) {
      throw parentNotFound('runtime', `Runtime message ${message.id} references unavailable Part ${partId}`);
    }
  }
  state.runtimeMessageIds.add(message.id);
  state.runtimeMessagePartIds.set(message.id, nextRuntimeIds);

  const mergedPartIds = [...message.partIds];
  const mergedSet = new Set<string>(mergedPartIds);
  for (const partId of state.hostPartIdsByMessage.get(message.id) ?? []) {
    if (!mergedSet.has(partId)) {
      mergedSet.add(partId);
      mergedPartIds.push(partId as ConversationPart['id']);
    }
  }
  const nextMessage: ConversationMessage = { ...clone(message), partIds: mergedPartIds };
  const actualIndex = upsertIndexedValue(state.messages, state.messageIndexById, nextMessage, index, (entry) => entry.id);
  state.messageById.set(nextMessage.id, nextMessage);
  indexTurnMessage(state, nextMessage);
  refreshMessageSize(state, nextMessage);
  return actualIndex;
}

function removeRuntimeMessage(
  state: MutableProjectionState,
  messageId: ConversationMessage['id'],
): { readonly message: ConversationMessage; readonly index: number } | null {
  if (!state.runtimeMessageIds.has(messageId)) throw parentNotFound('runtime', `Runtime message ${messageId} was not found`);
  for (const id of [...(state.runtimeMessagePartIds.get(messageId) ?? [])]) removePart(state, id, 'runtime');
  state.runtimeMessagePartIds.delete(messageId);
  state.runtimeMessageIds.delete(messageId);
  const hostIds = state.hostPartIdsByMessage.get(messageId);
  const existing = state.messageById.get(messageId);
  if (existing && hostIds && hostIds.size > 0) {
    const retainedIds = existing.partIds.filter((id) => hostIds.has(id));
    const retained: ConversationMessage = { ...existing, partIds: retainedIds };
    const index = state.messageIndexById.get(messageId)!;
    state.messages[index] = retained;
    state.messageById.set(messageId, retained);
    refreshMessageSize(state, retained);
    return { message: retained, index };
  }
  removeEffectiveMessage(state, messageId);
  return null;
}

function removeEffectiveMessage(state: MutableProjectionState, messageId: ConversationMessage['id']): void {
  const index = state.messageIndexById.get(messageId);
  if (index === undefined) throw parentNotFound('runtime', `Runtime message ${messageId} was not found`);
  const message = state.messageById.get(messageId)!;
  unindexTurnMessage(state, message);
  state.serializedCodeUnits -= state.messageSerializedSizes.get(messageId) ?? 0;
  state.messageSerializedSizes.delete(messageId);
  state.messageById.delete(messageId);
  state.messageIndexById.delete(messageId);
  state.messages.splice(index, 1);
  reindexValues(state.messages, state.messageIndexById, index, (entry) => entry.id);
}

function upsertRuntimePart(state: MutableProjectionState, part: RuntimeTranscriptPart, index: number): number {
  const existingRuntime = state.runtimeParts.get(part.id);
  rememberPartIdentity(state.partIdentityById, part, 'runtime');
  if (part.type === 'tool') {
    const mappedId = state.toolCallToPartId.get(part.toolCallId);
    if (mappedId && mappedId !== part.id) {
      throw new ConversationProjectionError('SOURCE_INVALID', `Tool call ${part.toolCallId} changed Part identity`, { source: 'runtime' });
    }
  }
  state.runtimeParts.set(part.id, clone(part));
  const runtimeIds = state.runtimeMessagePartIds.get(part.messageId) ?? new Set<string>();
  runtimeIds.add(part.id);
  state.runtimeMessagePartIds.set(part.messageId, runtimeIds);
  refreshEffectivePartSize(state, part.id);
  const actualIndex = reorderPart(state.partOrder, state.partIndexById, part.id, index);
  ensureStateMessagePartId(state, part.messageId, part.id);
  if (part.type === 'tool') state.toolCallToPartId.set(part.toolCallId, part.id);
  refreshActivePart(state, part.id);
  if (part.type === 'tool' || existingRuntime?.type === 'tool' || state.hostParts.get(part.id)?.type === 'tool') refreshEffectiveStatus(state);
  return actualIndex;
}

function upsertHostPart(
  state: MutableProjectionState,
  part: HostTranscriptPart,
  index: number,
): number {
  rememberPartIdentity(state.partIdentityById, part, 'host');
  if (part.type === 'tool') {
    const mappedId = state.toolCallToPartId.get(part.toolCallId);
    if (mappedId && mappedId !== part.id) {
      throw new ConversationProjectionError('SOURCE_INVALID', `Tool call ${part.toolCallId} is duplicated`, { source: 'host' });
    }
  }
  state.hostParts.set(part.id, clone(part));
  const hostIds = state.hostPartIdsByMessage.get(part.messageId) ?? new Set<string>();
  hostIds.add(part.id);
  state.hostPartIdsByMessage.set(part.messageId, hostIds);
  refreshEffectivePartSize(state, part.id);
  const actualIndex = reorderPart(state.partOrder, state.partIndexById, part.id, index);
  ensureStateMessagePartId(state, part.messageId, part.id);
  if (part.type === 'tool') state.toolCallToPartId.set(part.toolCallId, part.id);
  refreshActivePart(state, part.id);
  refreshEffectiveStatus(state);
  return actualIndex;
}

function upsertInteractionPart(
  state: MutableProjectionState,
  part: ConversationInteractionPart,
  index: number,
): number {
  rememberPartIdentity(state.partIdentityById, part, 'host');
  const mappedId = state.interactionToPartId.get(part.interactionId);
  if (mappedId && mappedId !== part.id) {
    throw new ConversationProjectionError('SOURCE_INVALID', `Interaction ${part.interactionId} is duplicated`, { source: 'host' });
  }
  state.hostParts.set(part.id, clone(part));
  const hostIds = state.hostPartIdsByMessage.get(part.messageId) ?? new Set<string>();
  hostIds.add(part.id);
  state.hostPartIdsByMessage.set(part.messageId, hostIds);
  refreshEffectivePartSize(state, part.id);
  if (!state.interactionToPartId.has(part.interactionId)) {
    state.interactionToPartId.set(part.interactionId, part.id);
  }
  const actualIndex = reorderPart(state.partOrder, state.partIndexById, part.id, index);
  ensureStateMessagePartId(state, part.messageId, part.id);
  refreshActivePart(state, part.id);
  refreshEffectiveStatus(state);
  return actualIndex;
}

function removePart(state: MutableProjectionState, partId: string, source: 'runtime' | 'host'): void {
  const part = source === 'runtime' ? state.runtimeParts.get(partId) : state.hostParts.get(partId);
  if (!part) return;
  if (source === 'runtime') {
    state.runtimeParts.delete(partId);
    state.runtimeMessagePartIds.get(part.messageId)?.delete(partId);
  } else {
    state.hostParts.delete(partId);
    state.hostPartIdsByMessage.get(part.messageId)?.delete(partId);
  }
  refreshEffectivePartSize(state, partId);
  if (!state.runtimeParts.has(partId) && !state.hostParts.has(partId)) {
    removeIndexedValue(state.partOrder, state.partIndexById, partId);
  }
  if (!state.runtimeParts.has(partId) && !state.hostParts.has(partId)) removeStateMessagePartId(state, part.messageId, partId);
  refreshActivePart(state, partId);
  if (part.type === 'tool' || part.type === 'interaction') refreshEffectiveStatus(state);
}

function refreshMessageSize(state: MutableProjectionState, message: ConversationMessage): void {
  const nextSize = serializedSize(message);
  const previous = state.messageSerializedSizes.get(message.id) ?? 0;
  state.messageSerializedSizes.set(message.id, nextSize);
  state.serializedCodeUnits += nextSize - previous;
}

function refreshEffectivePartSize(
  state: MutableProjectionState,
  partId: string,
  previousPart?: ConversationPart,
): void {
  const part = state.hostParts.get(partId) ?? state.runtimeParts.get(partId);
  const previous = state.partSerializedSizes.get(partId) ?? 0;
  if (!part) {
    state.partSerializedSizes.delete(partId);
    state.serializedCodeUnits -= previous;
    return;
  }
  const nextSize = previousPart
    && (previousPart.type === 'text' || previousPart.type === 'reasoning')
    && (part.type === 'text' || part.type === 'reasoning')
    ? previous + part.text.length - previousPart.text.length
    : serializedSize(part);
  state.partSerializedSizes.set(partId, nextSize);
  state.serializedCodeUnits += nextSize - previous;
}

function refreshStatusSize(state: MutableProjectionState): void {
  const nextSize = serializedSize(state.effectiveStatusValue);
  state.serializedCodeUnits += nextSize - state.statusSerializedSize;
  state.statusSerializedSize = nextSize;
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
  const existingHost = state.hostParts.get(partId);
  const input = event.type === 'tool.requested'
    ? clone(event.payload.input) as JsonObject
    : toolInput(existing.state);
  const name = event.type === 'tool.requested' || event.type === 'tool.started'
    ? event.payload.name
    : existing?.name ?? `tool:${toolCallId}`;
  assertToolStateProgression(existing.state.status, phase);
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
    createdAt: existingHost?.type === 'tool' ? existingHost.createdAt : event.occurredAt,
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
  assertToolStateProgression(existing.state.status, stateValue.status);
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
  if (existing?.type === 'interaction' && existing.state.status === 'resolved') {
    throw new ConversationProjectionError('SOURCE_INVALID', 'Resolved Interaction cannot return to pending', { source: 'host' });
  }
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
  if (current.state.status !== 'pending') {
    throw new ConversationProjectionError('SOURCE_INVALID', 'Resolved Interaction cannot be resolved again', { source: 'host' });
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
  const parent = requireOrCreateHostErrorMessage(state, event);
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

function requireOrCreateHostErrorMessage(
  state: MutableProjectionState,
  event: Extract<DefEvent, { type: 'turn.failed' | 'turn.interrupted' }>,
): ConversationMessage {
  const existingId = state.assistantMessageByTurnId.get(event.defTurnId)
    ?? state.lastMessageByTurnId.get(event.defTurnId);
  const existing = existingId ? state.messageById.get(existingId) : undefined;
  if (existing) return existing;

  const message: ConversationMessage = {
    id: asConversationMessageId(`host-error-message:${event.defTurnId}`),
    role: 'assistant',
    defTurnId: event.defTurnId,
    createdAt: event.occurredAt,
    completedAt: event.occurredAt,
    partIds: [],
  };
  const laterIndex = state.messages.findIndex((candidate) => candidate.createdAt > message.createdAt);
  upsertIndexedValue(
    state.messages,
    state.messageIndexById,
    message,
    laterIndex < 0 ? state.messages.length : laterIndex,
    (candidate) => candidate.id,
  );
  state.messageById.set(message.id, message);
  indexTurnMessage(state, message);
  refreshMessageSize(state, message);
  return message;
}

function findToolPart(state: MutableProjectionState, toolCallId: ToolCallId): ConversationToolPart | undefined {
  const mapped = state.toolCallToPartId.get(toolCallId);
  const mappedPart = mapped ? state.hostParts.get(mapped) ?? state.runtimeParts.get(mapped) : undefined;
  if (mappedPart?.type === 'tool' && mappedPart.toolCallId === toolCallId) return clone(mappedPart);
  return undefined;
}

function requireTurnMessage(state: MutableProjectionState, defTurnId: DefTurnId): ConversationMessage {
  const messageId = state.assistantMessageByTurnId.get(defTurnId) ?? state.lastMessageByTurnId.get(defTurnId);
  const message = messageId ? state.messageById.get(messageId) : undefined;
  if (!message) throw parentNotFound('host', `Conversation message for Turn ${defTurnId} was not found`);
  return message;
}

function requireMessage(state: MutableProjectionState, messageId: ConversationMessage['id'], source: 'runtime' | 'host'): ConversationMessage {
  const message = state.messageById.get(messageId);
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
  state.runtimeSequence = event.sequence;
  refreshStatusSize(state);
  const base = {
    schemaVersion: 1 as const,
    source: 'runtime' as const,
    sourceSequence: event.sequence,
    defSessionId: state.defSessionId,
    occurredAt: event.occurredAt,
    cursor: cursorForState(state),
    status: effectiveStatus(state),
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
  state.hostSequence = event.sequence;
  refreshStatusSize(state);
  const base = {
    schemaVersion: 1 as const,
    source: 'host' as const,
    sourceSequence: event.sequence,
    defSessionId: state.defSessionId,
    occurredAt: event.occurredAt,
    cursor: cursorForState(state),
    status: effectiveStatus(state),
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
  return clone(state.effectiveStatusValue);
}

function refreshEffectiveStatus(state: MutableProjectionState): void {
  const next = computeEffectiveStatus(state);
  state.effectiveStatusValue = next;
  refreshStatusSize(state);
}

function computeEffectiveStatus(state: MutableProjectionState): ConversationSessionStatus {
  if (state.hostStatus?.status === 'archived' || state.hostStatus?.status === 'error') return clone(state.hostStatus);
  const activeToolId = state.activeToolPartIds.values().next().value as string | undefined;
  const activeTool = activeToolId ? effectivePart(state, activeToolId) : undefined;
  if (activeTool) {
    if (activeTool.type !== 'tool') throw new ConversationProjectionError('SOURCE_INVALID', 'Active Tool index is invalid');
    return {
      status: 'waiting-tool',
      defTurnId: requireMessage(state, activeTool.messageId, 'host').defTurnId,
      toolCallId: activeTool.toolCallId,
    };
  }
  const pendingInteractionId = state.pendingInteractionPartIds.values().next().value as string | undefined;
  const pendingInteraction = pendingInteractionId ? effectivePart(state, pendingInteractionId) : undefined;
  if (pendingInteraction) {
    if (pendingInteraction.type !== 'interaction') throw new ConversationProjectionError('SOURCE_INVALID', 'Pending Interaction index is invalid');
    return {
      status: 'waiting-interaction',
      defTurnId: requireMessage(state, pendingInteraction.messageId, 'host').defTurnId,
      interactionId: pendingInteraction.interactionId,
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

function assertProjectionState(state: MutableProjectionState): void {
  if (state.messages.length > DEF_CONVERSATION_LIMITS.maxMessagesPerSnapshot) {
    throw new ConversationProjectionError('SOURCE_INVALID', 'Conversation state contains too many messages');
  }
  if (state.partOrder.length > DEF_CONVERSATION_LIMITS.maxPartsPerSnapshot) {
    throw new ConversationProjectionError('SOURCE_INVALID', 'Conversation state contains too many parts');
  }
  const messageIds = new Set<string>();
  for (const message of state.messages) {
    if (messageIds.has(message.id)) throw new ConversationProjectionError('SOURCE_INVALID', 'Conversation state contains duplicate Messages');
    messageIds.add(message.id);
    if (new Set(message.partIds).size !== message.partIds.length) throw new ConversationProjectionError('SOURCE_INVALID', 'Conversation state contains duplicate Message Part IDs');
  }
  const parts = new Map<string, ConversationPart>();
  for (const part of [...state.runtimeParts.values(), ...state.hostParts.values()]) {
    if (!parts.has(part.id)) parts.set(part.id, part);
    const existing = parts.get(part.id)!;
    if (existing.messageId !== part.messageId || existing.type !== part.type) throw new ConversationProjectionError('SOURCE_INVALID', 'Conversation Part changed parent or type');
    if ((part.type === 'text' || part.type === 'reasoning') && part.text.length > DEF_CONVERSATION_LIMITS.maxTextCodeUnitsPerPart) {
      throw new ConversationProjectionError('SOURCE_INVALID', 'Conversation Part text exceeds its limit');
    }
    try {
      assertConversationSerializedSize(part, DEF_CONVERSATION_LIMITS.maxEventCodeUnits, 'Conversation Part');
    } catch {
      throw new ConversationProjectionError('SOURCE_INVALID', 'Conversation Part is not within serialized bounds');
    }
  }
  const ordered = new Set(state.partOrder);
  if (ordered.size !== state.partOrder.length || ordered.size !== parts.size) {
    throw new ConversationProjectionError('SOURCE_INVALID', 'Conversation Part order index is incomplete');
  }
  for (const id of state.partOrder) if (!parts.has(id)) throw new ConversationProjectionError('SOURCE_INVALID', 'Conversation Part order contains an unknown Part');
  const partsByMessage = new Map<string, Set<string>>();
  for (const part of parts.values()) {
    if (!messageIds.has(part.messageId)) throw parentNotFound('projector', `Conversation Part ${part.id} has no parent Message`);
    const ids = partsByMessage.get(part.messageId) ?? new Set<string>();
    ids.add(part.id);
    partsByMessage.set(part.messageId, ids);
  }
  for (const message of state.messages) {
    const expected = partsByMessage.get(message.id) ?? new Set<string>();
    const actual = new Set(message.partIds);
    if (actual.size !== expected.size || [...actual].some((id) => !expected.has(id))) {
      throw new ConversationProjectionError('SOURCE_INVALID', `Conversation Message ${message.id} Part index is incomplete`);
    }
  }
  const toolCalls = new Map<string, string>();
  const interactions = new Map<string, string>();
  for (const part of parts.values()) {
    if (part.type === 'tool') {
      const prior = toolCalls.get(part.toolCallId);
      if (prior && prior !== part.id) throw new ConversationProjectionError('SOURCE_INVALID', 'Conversation Tool call identity is duplicated');
      toolCalls.set(part.toolCallId, part.id);
    }
    if (part.type === 'interaction') {
      const prior = interactions.get(part.interactionId);
      if (prior && prior !== part.id) throw new ConversationProjectionError('SOURCE_INVALID', 'Conversation Interaction identity is duplicated');
      interactions.set(part.interactionId, part.id);
    }
  }
}

/** O(1) incremental guard. Full cross-index validation is reserved for snapshots. */
function assertIncrementalState(state: MutableProjectionState, sourceEvent: SourceEvent): void {
  if (state.messages.length > DEF_CONVERSATION_LIMITS.maxMessagesPerSnapshot || state.partOrder.length > DEF_CONVERSATION_LIMITS.maxPartsPerSnapshot) {
    throw new ConversationProjectionError('SOURCE_INVALID', 'Conversation incremental state exceeds collection limits', { source: sourceEvent.source });
  }
  if (state.serializedCodeUnits > DEF_CONVERSATION_LIMITS.maxSnapshotCodeUnits) {
    throw new ConversationProjectionError('SOURCE_INVALID', 'Conversation incremental state exceeds serialized bounds', { source: sourceEvent.source });
  }
}

function stateElementCount(state: MutableProjectionState): number {
  return state.messages.length + state.runtimeParts.size + state.hostParts.size;
}

function incrementalTouchedElements(sourceEvent: SourceEvent): number {
  if (sourceEvent.source === 'runtime') {
    const mutation = sourceEvent.event.mutation;
    if (mutation.type === 'part.delta' || mutation.type === 'part.remove') return 2;
    if (mutation.type === 'part.upsert') return 2;
    if (mutation.type === 'message.upsert') return 1 + mutation.message.partIds.length;
    if (mutation.type === 'message.remove') return 1;
    return 0;
  }
  return sourceEvent.event.type === 'session.archived' || sourceEvent.event.type === 'session.orphaned'
    ? 0
    : 2;
}

function validateRuntimeSnapshot(
  snapshot: RuntimeTranscriptSnapshot,
  defSessionId: DefSessionId,
  engineSession: EngineSessionRef,
): void {
  if (!isRecord(snapshot) || snapshot.schemaVersion !== 1 || !Number.isSafeInteger(snapshot.sequence) || snapshot.sequence < 0) {
    throw new ConversationProjectionError('SOURCE_INVALID', 'Runtime snapshot is invalid', { source: 'runtime' });
  }
  if (!isEngineSession(snapshot.engineSession) || !engineSessionEquals(snapshot.engineSession, engineSession)) {
    throw new ConversationProjectionError('SOURCE_INVALID', 'Runtime snapshot belongs to another Engine Session', { source: 'runtime' });
  }
  if (!Array.isArray(snapshot.messages) || !Array.isArray(snapshot.parts)) {
    throw new ConversationProjectionError('SOURCE_INVALID', 'Runtime snapshot collections are invalid', { source: 'runtime' });
  }
  if (snapshot.messages.length > DEF_CONVERSATION_LIMITS.maxMessagesPerSnapshot || snapshot.parts.length > DEF_CONVERSATION_LIMITS.maxPartsPerSnapshot) {
    throw new ConversationProjectionError('SOURCE_INVALID', 'Runtime snapshot exceeds Conversation limits', { source: 'runtime' });
  }
  const status = runtimeStatusAsConversationStatus(snapshot.status, snapshot.messages);
  const projected: ConversationSnapshot = {
    schemaVersion: 1,
    defSessionId,
    cursor: { epoch: 'runtime-validation', runtimeSequence: snapshot.sequence, hostSequence: 0 },
    status,
    messages: snapshot.messages,
    parts: snapshot.parts,
  };
  try {
    assertConversationSnapshot(projected);
    assertConversationSerializedSize(snapshot, DEF_CONVERSATION_LIMITS.maxSnapshotCodeUnits, 'Runtime snapshot');
  } catch (error) {
    throw new ConversationProjectionError(
      'SOURCE_INVALID',
      `Runtime snapshot is invalid: ${error instanceof Error ? error.message : String(error)}`,
      { source: 'runtime' },
    );
  }
}

function validateHostSnapshot(snapshot: ConversationHostJournalSnapshot, defSessionId: DefSessionId): void {
  if (!isRecord(snapshot) || !Number.isSafeInteger(snapshot.sequence) || snapshot.sequence < 0 || !Array.isArray(snapshot.events)) {
    throw new ConversationProjectionError('SOURCE_INVALID', 'Host snapshot sequence is invalid', { source: 'host' });
  }
  if (snapshot.events.length > DEF_CONVERSATION_LIMITS.maxEventsPerSnapshot) {
    throw new ConversationProjectionError('SOURCE_INVALID', 'Host snapshot contains too many events', { source: 'host' });
  }
  let previous = 0;
  for (const event of snapshot.events) {
    validateHostEvent(event, defSessionId);
    if (event.sequence !== previous + 1) {
      throw new ConversationProjectionError(
        event.sequence === previous
          ? 'SOURCE_DUPLICATE'
          : event.sequence < previous
            ? 'SOURCE_OUT_OF_ORDER'
            : 'SOURCE_GAP',
        'Host snapshot events are not contiguous',
        { source: 'host', expectedSequence: previous + 1, actualSequence: event.sequence },
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
  if (snapshot.sequence === 0 && snapshot.events.length !== 0) {
    throw new ConversationProjectionError('SOURCE_INVALID', 'Host snapshot has events with a zero high-water mark', { source: 'host' });
  }
}

function runtimeStatusAsConversationStatus(
  status: RuntimeTranscriptSnapshot['status'],
  messages: readonly ConversationMessage[],
): ConversationSessionStatus {
  if (!isRecord(status) || typeof status.status !== 'string') throw new TypeError('Runtime status is invalid');
  if (status.status === 'idle') return { status: 'idle' };
  if (status.status === 'compacting') return { status: 'compacting' };
  if (status.status === 'error') {
    if (typeof status.code !== 'string' || typeof status.message !== 'string') throw new TypeError('Runtime error status is invalid');
    return { status: 'error', code: status.code, message: status.message };
  }
  if (status.status === 'running') {
    const turn = messages.at(-1)?.defTurnId;
    if (!turn) throw new TypeError('Runtime running status has no Turn correlation');
    return { status: 'running', defTurnId: turn };
  }
  throw new TypeError('Runtime status variant is invalid');
}

function validateHostEvent(event: unknown, defSessionId: DefSessionId): asserts event is DefEvent {
  if (!isRecord(event) || event.schemaVersion !== 1 || event.defSessionId !== defSessionId || typeof event.type !== 'string') {
    throw new ConversationProjectionError('SOURCE_INVALID', 'Host snapshot contains an invalid event', { source: 'host' });
  }
  if (!KNOWN_HOST_EVENT_TYPES.has(event.type as DefEvent['type'])) {
    throw new ConversationProjectionError('SOURCE_INVALID', 'Host snapshot contains an unknown event variant', { source: 'host' });
  }
  if (typeof event.sequence !== 'number' || !Number.isSafeInteger(event.sequence) || event.sequence < 1 || typeof event.occurredAt !== 'string' || event.occurredAt.length > 256) {
    throw new ConversationProjectionError('SOURCE_INVALID', 'Host snapshot contains an invalid event header', { source: 'host' });
  }
  if (!isRecord(event.payload)) throw new ConversationProjectionError('SOURCE_INVALID', 'Host snapshot event payload is invalid', { source: 'host' });
  try {
    assertConversationSerializedSize(event, DEF_CONVERSATION_LIMITS.maxEventCodeUnits, 'Host snapshot event');
  } catch {
    throw new ConversationProjectionError('SOURCE_INVALID', 'Host snapshot event exceeds serialized bounds', { source: 'host' });
  }
  const turnTypes = new Set([
    'turn.accepted', 'response.first-token', 'response.delta', 'tool.requested', 'tool.started', 'tool.result', 'tool.error',
    'harness.routed', 'harness.resumed', 'harness.phase.entered', 'harness.tool.projected', 'harness.terminal',
    'interaction.requested', 'interaction.resolved', 'command.queued', 'command.dispatched', 'command.claimed',
    'command.committed', 'command.result', 'command.reconciled', 'command.orphaned', 'turn.completed', 'turn.stopped',
    'turn.interrupted', 'turn.failed',
  ]);
  if (turnTypes.has(event.type) && !isIdentifier(event.defTurnId)) {
    throw new ConversationProjectionError('SOURCE_INVALID', 'Host event Turn correlation is invalid', { source: 'host' });
  }
  if ((event.type === 'tool.requested' || event.type === 'tool.started' || event.type === 'tool.result' || event.type === 'tool.error') && !isIdentifier(event.toolCallId)) {
    throw new ConversationProjectionError('SOURCE_INVALID', 'Host event Tool correlation is invalid', { source: 'host' });
  }
  if ((event.type === 'interaction.requested' || event.type === 'interaction.resolved') && !isIdentifier(event.interactionId)) {
    throw new ConversationProjectionError('SOURCE_INVALID', 'Host event Interaction correlation is invalid', { source: 'host' });
  }
  if (event.type === 'tool.requested') {
    if (!isIdentifier(event.payload.name) || !['read', 'propose', 'mutate'].includes(String(event.payload.risk))) {
      throw new ConversationProjectionError('SOURCE_INVALID', 'Host Tool request payload is invalid', { source: 'host' });
    }
  } else if (event.type === 'tool.started') {
    if (!isIdentifier(event.payload.name)) throw new ConversationProjectionError('SOURCE_INVALID', 'Host Tool start payload is invalid', { source: 'host' });
  } else if (event.type === 'tool.result') {
    if (!Object.prototype.hasOwnProperty.call(event.payload, 'result')) throw new ConversationProjectionError('SOURCE_INVALID', 'Host Tool result payload is invalid', { source: 'host' });
  } else if (event.type === 'tool.error' || event.type === 'turn.failed' || event.type === 'turn.interrupted') {
    if (!isIdentifier(event.payload.code) || typeof event.payload.message !== 'string') {
      throw new ConversationProjectionError('SOURCE_INVALID', 'Host terminal error payload is invalid', { source: 'host' });
    }
  } else if (event.type === 'interaction.requested') {
    if (!['question', 'approval'].includes(String(event.payload.kind)) || typeof event.payload.prompt !== 'string' || typeof event.payload.expiresAt !== 'string') {
      throw new ConversationProjectionError('SOURCE_INVALID', 'Host Interaction request payload is invalid', { source: 'host' });
    }
  } else if (event.type === 'interaction.resolved') {
    if (!['answered', 'approved', 'rejected', 'expired', 'cancelled', 'stale'].includes(String(event.payload.status))) {
      throw new ConversationProjectionError('SOURCE_INVALID', 'Host Interaction resolution payload is invalid', { source: 'host' });
    }
  } else if (event.type === 'session.orphaned') {
    if (!isIdentifier(event.payload.code) || typeof event.payload.message !== 'string') {
      throw new ConversationProjectionError('SOURCE_INVALID', 'Host orphaned Session payload is invalid', { source: 'host' });
    }
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
  return parseConversationCursor({
    epoch: cursor.epoch,
    runtimeSequence: cursor.runtimeSequence,
    hostSequence: cursor.hostSequence,
  });
}

function validateEpoch(epoch: string): string {
  return parseCursor({ epoch, runtimeSequence: 0, hostSequence: 0 }).epoch;
}

function cursorKey(cursor: ConversationCursor): string {
  return `${cursor.epoch}|${cursor.runtimeSequence}|${cursor.hostSequence}`;
}

function cacheKey(defSessionId: string, cursor: string): string {
  return `${defSessionId}\u0000${cursor}`;
}

function findPartIndex(state: MutableProjectionState, partId: string): number {
  return mergedPartIndex(state, partId);
}

function mergedPartIndex(state: MutableProjectionState, partId: string): number {
  return state.partIndexById.get(partId) ?? state.partOrder.length;
}

function normalizeIndex(index: number, length: number): number {
  if (!Number.isSafeInteger(index) || index < 0) {
    throw new ConversationProjectionError('SOURCE_INVALID', 'Conversation mutation index is invalid');
  }
  return Math.min(index, length);
}

function reorderPart(order: string[], indexes: Map<string, number>, partId: string, index: number): number {
  return upsertIndexedValue(order, indexes, partId, index, (entry) => entry);
}

function ensureStateMessagePartId(state: MutableProjectionState, messageId: string, partId: string): void {
  const messageIndex = state.messageIndexById.get(messageId);
  const message = state.messageById.get(messageId);
  if (!message || messageIndex === undefined) throw parentNotFound('runtime', `Conversation message ${messageId} was not found`);
  if (!new Set(message.partIds).has(partId as ConversationPart['id'])) {
    const next = { ...message, partIds: [...message.partIds, partId as ConversationPart['id']] };
    state.messages[messageIndex] = next;
    state.messageById.set(messageId, next);
    refreshMessageSize(state, next);
  }
}

function removeStateMessagePartId(state: MutableProjectionState, messageId: string, partId: string): void {
  const messageIndex = state.messageIndexById.get(messageId);
  const message = state.messageById.get(messageId);
  if (!message || messageIndex === undefined) return;
  const next = { ...message, partIds: message.partIds.filter((candidate) => candidate !== partId) };
  state.messages[messageIndex] = next;
  state.messageById.set(messageId, next);
  refreshMessageSize(state, next);
}

function upsertIndexedValue<T>(
  values: T[],
  indexes: Map<string, number>,
  value: T,
  requestedIndex: number,
  identity: (entry: T) => string,
): number {
  const id = identity(value);
  const existingIndex = indexes.get(id);
  if (existingIndex !== undefined) {
    values.splice(existingIndex, 1);
    indexes.delete(id);
    reindexValues(values, indexes, existingIndex, identity);
  }
  const index = normalizeIndex(requestedIndex, values.length);
  values.splice(index, 0, value);
  reindexValues(values, indexes, Math.min(index, existingIndex ?? index), identity);
  return index;
}

function removeIndexedValue(
  values: string[],
  indexes: Map<string, number>,
  id: string,
): void {
  const index = indexes.get(id);
  if (index === undefined) return;
  values.splice(index, 1);
  indexes.delete(id);
  reindexValues(values, indexes, index, (entry) => entry);
}

function reindexValues<T>(
  values: readonly T[],
  indexes: Map<string, number>,
  start: number,
  identity: (entry: T) => string,
): void {
  for (let index = start; index < values.length; index += 1) indexes.set(identity(values[index]!), index);
}

function effectivePart(state: MutableProjectionState, partId: string): ConversationPart | undefined {
  return state.hostParts.get(partId) ?? state.runtimeParts.get(partId);
}

function refreshActivePart(state: MutableProjectionState, partId: string): void {
  state.activeToolPartIds.delete(partId);
  state.pendingInteractionPartIds.delete(partId);
  const part = effectivePart(state, partId);
  if (part?.type === 'tool' && (part.state.status === 'pending' || part.state.status === 'running')) {
    state.activeToolPartIds.add(partId);
  }
  if (part?.type === 'interaction' && part.state.status === 'pending') {
    state.pendingInteractionPartIds.add(partId);
  }
}

function rememberPartIdentity(
  identities: Map<string, PartIdentity>,
  part: ConversationPart,
  source: 'runtime' | 'host',
): void {
  const next: PartIdentity = {
    messageId: part.messageId,
    type: part.type,
    ...(part.type === 'tool' ? { toolCallId: part.toolCallId } : {}),
    ...(part.type === 'interaction' ? { interactionId: part.interactionId } : {}),
  };
  const existing = identities.get(part.id);
  if (existing && (
    existing.messageId !== next.messageId
    || existing.type !== next.type
    || existing.toolCallId !== next.toolCallId
    || existing.interactionId !== next.interactionId
  )) {
    throw new ConversationProjectionError('SOURCE_INVALID', `Conversation Part ${part.id} changed stable identity`, { source });
  }
  if (!existing) identities.set(part.id, next);
}

function cloneSetMap(source: Map<string, Set<string>>): Map<string, Set<string>> {
  return new Map([...source].map(([key, values]) => [key, new Set(values)]));
}

function indexTurnMessageMaps(
  message: ConversationMessage,
  idsByTurn: Map<string, Set<string>>,
  assistantByTurn: Map<string, string>,
  lastByTurn: Map<string, string>,
): void {
  const ids = idsByTurn.get(message.defTurnId) ?? new Set<string>();
  ids.delete(message.id);
  ids.add(message.id);
  idsByTurn.set(message.defTurnId, ids);
  lastByTurn.set(message.defTurnId, message.id);
  if (message.role === 'assistant') assistantByTurn.set(message.defTurnId, message.id);
}

function indexTurnMessage(state: MutableProjectionState, message: ConversationMessage): void {
  indexTurnMessageMaps(
    message,
    state.messageIdsByTurnId,
    state.assistantMessageByTurnId,
    state.lastMessageByTurnId,
  );
}

function unindexTurnMessage(state: MutableProjectionState, message: ConversationMessage): void {
  const ids = state.messageIdsByTurnId.get(message.defTurnId);
  ids?.delete(message.id);
  if (!ids || ids.size === 0) {
    state.messageIdsByTurnId.delete(message.defTurnId);
    state.assistantMessageByTurnId.delete(message.defTurnId);
    state.lastMessageByTurnId.delete(message.defTurnId);
    return;
  }
  if (state.lastMessageByTurnId.get(message.defTurnId) === message.id) {
    state.lastMessageByTurnId.set(message.defTurnId, [...ids].at(-1)!);
  }
  if (state.assistantMessageByTurnId.get(message.defTurnId) === message.id) {
    let replacement: string | undefined;
    for (const id of ids) if (state.messageById.get(id)?.role === 'assistant') replacement = id;
    if (replacement) state.assistantMessageByTurnId.set(message.defTurnId, replacement);
    else state.assistantMessageByTurnId.delete(message.defTurnId);
  }
}

function assertToolStateProgression(
  previous: ConversationToolState['status'],
  next: ConversationToolState['status'],
): void {
  const rank = (status: ConversationToolState['status']): number => (
    status === 'pending' ? 0 : status === 'running' ? 1 : 2
  );
  if (rank(next) < rank(previous)) {
    throw new ConversationProjectionError('SOURCE_INVALID', 'Terminal Tool state cannot regress', { source: 'host' });
  }
}

function appendBoundedText(current: string, delta: string): string {
  const next = current + delta;
  if (next.length > DEF_CONVERSATION_LIMITS.maxTextCodeUnitsPerPart) {
    throw new ConversationProjectionError('SOURCE_INVALID', 'Conversation text part exceeds its limit');
  }
  return next;
}

function parentNotFound(source: 'runtime' | 'host' | 'projector', message: string): ConversationProjectionError {
  return new ConversationProjectionError('PARENT_NOT_FOUND', message, { source });
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function serializedSize(value: unknown): number {
  try {
    return conversationSerializedCodeUnits(value, DEF_CONVERSATION_LIMITS.maxEventCodeUnits, 'Conversation value');
  } catch {
    throw new ConversationProjectionError('SOURCE_INVALID', 'Conversation value is not serializable');
  }
}

function toAsyncIterator<T>(iterable: AsyncIterable<T>): AsyncIterator<T> {
  return iterable[Symbol.asyncIterator]();
}

async function closeAsyncIterator<T>(iterator: AsyncIterator<T>): Promise<void> {
  if (typeof iterator.return !== 'function') return;
  const closing = Promise.resolve(iterator.return());
  await Promise.race([
    closing,
    new Promise<void>((resolve) => setTimeout(resolve, CLOSE_TIMEOUT_MS)),
  ]);
}

function nextWithAbort<T>(iterator: AsyncIterator<T>, signal: AbortSignal): Promise<IteratorResult<T>> {
  if (signal.aborted) return Promise.resolve({ done: true, value: undefined as never });
  return new Promise<IteratorResult<T>>((resolve, reject) => {
    let settled = false;
    const finish = (result: IteratorResult<T>): void => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', abort);
      resolve(result);
    };
    const fail = (error: unknown): void => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', abort);
      reject(error);
    };
    const abort = (): void => finish({ done: true, value: undefined as never });
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve().then(() => iterator.next()).then(finish, fail);
  });
}

function waitWithAbort(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const timer = setTimeout(done, milliseconds);
    const abort = () => done();
    function done(): void {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      resolve();
    }
    signal?.addEventListener('abort', abort, { once: true });
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isIdentifier(value: unknown): value is string {
  return typeof value === 'string' && value.trim() === value && value.length > 0 && value.length <= 256;
}

function isEngineSession(value: unknown): value is EngineSessionRef {
  return isRecord(value)
    && (value.kind === 'synthetic-runtime' || typeof value.kind === 'string')
    && isIdentifier(value.sessionId)
    && typeof value.runtimeVersion === 'string'
    && Number.isSafeInteger(value.storeSchemaVersion);
}

const HOST_EVENT_PAGE_SIZE = 256;

function loadBoundedHostEvents(store: SessionStoreSource, defSessionId: DefSessionId): DefEvent[] {
  if (store.loadEventPage) {
    const events: DefEvent[] = [];
    let afterSequence = 0;
    while (events.length <= DEF_CONVERSATION_LIMITS.maxEventsPerSnapshot) {
      const page = store.loadEventPage(defSessionId, afterSequence, HOST_EVENT_PAGE_SIZE);
      if (!Array.isArray(page) || page.length > HOST_EVENT_PAGE_SIZE) {
        throw new ConversationProjectionError('SOURCE_INVALID', 'Host Session Store returned an invalid event page', { source: 'host' });
      }
      if (page.length === 0) return events;
      for (const event of page) {
        events.push(clone(event));
        if (events.length > DEF_CONVERSATION_LIMITS.maxEventsPerSnapshot) {
          throw new ConversationProjectionError('SOURCE_INVALID', 'Host Session Store journal exceeds its bounded limit', { source: 'host' });
        }
      }
      const nextSequence = page.at(-1)?.sequence;
      if (!Number.isSafeInteger(nextSequence) || Number(nextSequence) <= afterSequence) {
        throw new ConversationProjectionError('SOURCE_INVALID', 'Host Session Store event page did not advance', { source: 'host' });
      }
      afterSequence = Number(nextSequence);
      if (page.length < HOST_EVENT_PAGE_SIZE) return events;
    }
    throw new ConversationProjectionError('SOURCE_INVALID', 'Host Session Store journal exceeds its bounded limit', { source: 'host' });
  }
  const loaded = store.loadEvents(defSessionId);
  if (!Array.isArray(loaded) || loaded.length > DEF_CONVERSATION_LIMITS.maxEventsPerSnapshot) {
    throw new ConversationProjectionError('SOURCE_INVALID', 'Host Session Store fallback journal exceeds its bounded limit', { source: 'host' });
  }
  return loaded.map((event) => clone(event));
}

async function* pollSessionStore(
  store: SessionStoreSource,
  defSessionId: DefSessionId,
  afterHostSequence: number,
  pollIntervalMs: number,
  signal?: AbortSignal,
): AsyncIterable<DefEvent> {
  let cursor = afterHostSequence;
  while (!signal?.aborted) {
    const events = store.loadEventPage
      ? store.loadEventPage(defSessionId, cursor, HOST_EVENT_PAGE_SIZE)
      : store.loadEvents(defSessionId);
    if (!Array.isArray(events) || events.length > (store.loadEventPage ? HOST_EVENT_PAGE_SIZE : DEF_CONVERSATION_LIMITS.maxEventsPerSnapshot)) {
      throw new ConversationProjectionError('SOURCE_INVALID', 'Host Session Store polling page exceeds its bounded limit', { source: 'host' });
    }
    const next = store.loadEventPage
      ? events
      : events.filter((event) => event.sequence > cursor).slice(0, HOST_EVENT_PAGE_SIZE);
    if (next.length > 0) {
      for (const event of next) {
        cursor = event.sequence;
        yield clone(event);
      }
      continue;
    }
    await waitWithAbort(pollIntervalMs, signal);
  }
}
