/**
 * Deterministic lifecycle controller for one Runtime run.
 *
 * Correlation state is committed before an event is dispatched. One durable
 * sink owns every non-terminal write, and accepted history/observers advance
 * only after that sink resolves. The run.start marker/event and the terminal
 * marker/run.end pairs each share an atomic boundary.
 */
import type { DefTurnId, ToolCallId } from '../../core/contracts/ids.ts';
import type { JsonValue } from '../../core/contracts/json.ts';
import type { RuntimeRunMarkerEntry, RuntimeRunMarkerTerminal } from './session/entries.ts';
import type {
  RuntimeEvent,
  RuntimeEventListener,
  RuntimeRunTerminal,
} from './stream-events.ts';
import {
  asRuntimeEntryId,
  asRuntimeTurnId,
  type RuntimeEntryId,
  type RuntimeMessageId,
  type RuntimeRunId,
  type RuntimeSessionId,
  type RuntimeTurnId,
} from './ids.ts';
import type {
  RuntimeAssistantMessage,
  RuntimeAssistantMessageDraft,
  RuntimeMessage,
  RuntimeMessageStart,
  RuntimeToolCallBlock,
  RuntimeToolResultMessage,
  RuntimeToolResultPayload,
} from './messages.ts';

const MAX_RUNTIME_EVENTS = 32_768;
const MAX_RUNTIME_MARKERS = 2;
const MAX_LISTENERS = 64;
const MAX_LISTENER_FAILURES = 128;
const MAX_PENDING_OPERATIONS = 64;
const MAX_RUNTIME_HISTORY_CODE_UNITS = 16 * 1_024 * 1_024;
const MAX_RUNTIME_HISTORY_NODES = 262_144;
const RUNTIME_TERMINAL_CODE_UNIT_RESERVE = 3 * 1_024 * 1_024;
const RUNTIME_TERMINAL_NODE_RESERVE = 65_536;
const MAX_TOOL_UPDATES = 1_024;
const MAX_MESSAGE_CONTENT_BLOCKS = 1_024;
const MAX_ARRAY_ITEMS = 4_096;
const MAX_OBJECT_KEYS = 4_096;
const MAX_CANONICAL_DEPTH = 24;
const MAX_CANONICAL_NODES = 32_768;
const MAX_CANONICAL_STRING_CODE_UNITS = 1 * 1_024 * 1_024;
const MAX_CANONICAL_TOTAL_CODE_UNITS = 2 * 1_024 * 1_024;
const MAX_TIMESTAMP_CODE_UNITS = 128;
const MAX_ID_CODE_UNITS = 256;
const MAX_DIAGNOSTIC_CODE_UNITS = 4_096;

interface RuntimeMessageRecord {
  readonly start: RuntimeMessageStart;
  readonly final?: RuntimeMessage;
  readonly toolCallId?: ToolCallId;
  readonly state: 'open' | 'ended' | 'abandoned';
}

interface RuntimeToolRecord {
  readonly turnId: RuntimeTurnId;
  readonly call: RuntimeToolCallBlock;
  readonly result?: RuntimeToolResultPayload;
  readonly resultMessageId?: RuntimeMessageId;
  readonly updateCount: number;
  readonly state: 'running' | 'ended' | 'result-open' | 'consumed' | 'abandoned';
}

interface RuntimeTurnGraph {
  readonly turnId: RuntimeTurnId;
  readonly assistant?: RuntimeAssistantMessage;
  readonly pendingCalls: readonly RuntimeToolCallBlock[];
  readonly nextToolIndex: number;
  readonly toolResultMessageIds: readonly RuntimeMessageId[];
}

interface CanonicalFootprint {
  readonly nodes: number;
  readonly codeUnits: number;
}

interface CanonicalAllocation<T> {
  readonly value: T;
  readonly footprint: CanonicalFootprint;
}

interface RuntimeStartAllocation {
  readonly bundle: RuntimeDurableStartBundle;
  readonly footprints: readonly CanonicalFootprint[];
}

interface RuntimeTerminalAllocation {
  readonly bundle: RuntimeDurableTerminalBundle;
  readonly footprints: readonly CanonicalFootprint[];
}

export interface RuntimeListenerFailure {
  readonly code: 'RUNTIME_OBSERVER_FAILED';
  readonly message: string;
}

export interface RuntimeTerminalPersistenceFailure {
  readonly code: 'RUNTIME_DURABLE_TERMINAL_FAILED';
  readonly message: string;
}

type RuntimeEventEnvelopeKey = 'sessionId' | 'sequence' | 'occurredAt' | 'runOrdinal';

/** Runtime event input before the controller adds its deterministic envelope. */
export type RuntimeEventDraft = RuntimeEvent extends infer Event
  ? Event extends RuntimeEvent
    ? Omit<Event, RuntimeEventEnvelopeKey>
    : never
  : never;

export interface RuntimeAbortReason {
  readonly code: string;
  readonly message?: string;
}

export type RuntimeRunControllerState = 'created' | 'running' | 'terminal';

export type RuntimeRunMarkerListener = (
  marker: RuntimeRunMarkerEntry,
) => void | Promise<void>;

export interface RuntimeDurableTerminalBundle {
  readonly marker: Extract<RuntimeRunMarkerEntry, { readonly phase: 'end' }>;
  readonly event: Extract<RuntimeEvent, { readonly type: 'run.end' }>;
}

export interface RuntimeDurableStartBundle {
  readonly marker: Extract<RuntimeRunMarkerEntry, { readonly phase: 'start' }>;
  readonly event: Extract<RuntimeEvent, { readonly type: 'run.start' }>;
}

export type RuntimeDurableEventWrite =
  | Readonly<{ readonly kind: 'run.start'; readonly bundle: RuntimeDurableStartBundle }>
  | Readonly<{ readonly kind: 'event'; readonly event: RuntimeEvent }>;

/**
 * Sole durable owner for run.start and every later non-terminal event.
 *
 * A run.start write must atomically commit its marker and event. A rejection
 * means no member was committed. There is intentionally no listener fan-out:
 * additional consumers belong in the best-effort observer APIs.
 */
export type RuntimeDurableEventCommit = (
  write: RuntimeDurableEventWrite,
) => void | Promise<void>;

/**
 * Atomic durable terminal boundary.
 *
 * The implementation must either commit both members before resolving or
 * reject without committing either. Session adapters that fan out to several
 * stores must provide their own prepare/commit transaction behind this one
 * callback. Non-terminal `listeners`/`markerListeners` are deliberately not
 * reused here because unrelated callbacks cannot be rolled back safely.
 */
export type RuntimeDurableTerminalCommit = (
  bundle: RuntimeDurableTerminalBundle,
) => void | Promise<void>;

export interface RuntimeRunControllerOptions {
  readonly sessionId: RuntimeSessionId;
  readonly runId: RuntimeRunId;
  readonly defTurnId: DefTurnId;
  readonly initialTurnId?: RuntimeTurnId;
  readonly parentEntryId?: RuntimeEntryId | null;
  readonly now?: () => string;
  readonly signal?: AbortSignal;
  /** Best-effort event observers; use durableEventCommit for persistence. */
  readonly listeners?: readonly RuntimeEventListener[];
  /** Best-effort marker observers; run marker persistence is pair-atomic. */
  readonly markerListeners?: readonly RuntimeRunMarkerListener[];
  /** Sole durable sink for run.start and non-terminal Runtime events. */
  readonly durableEventCommit?: RuntimeDurableEventCommit;
  /** Sole durable owner of the end marker + run.end transaction. */
  readonly terminalCommit?: RuntimeDurableTerminalCommit;
  /** Known ephemeral secrets removed recursively from canonical payloads. */
  readonly redactions?: readonly string[];
}

export class RuntimeRunProtocolError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'RuntimeRunProtocolError';
    this.code = code;
  }
}

/**
 * Owns one run's event stream and its message/Tool graph.
 *
 * Event assembly is adapted from Pi at
 * e47b8e37a6211ebd0b2942fa87059d64f81eec02. DEF intentionally changes Pi's
 * push-before-callback behavior: public history advances only after its sole
 * durable sink accepts the canonical payload.
 */
export class RuntimeRunController {
  readonly sessionId: RuntimeSessionId;
  readonly runId: RuntimeRunId;
  readonly defTurnId: DefTurnId;
  readonly signal: AbortSignal;

  private readonly now: () => string;
  private readonly abortController = new AbortController();
  private readonly observers = new Set<RuntimeEventListener>();
  private readonly markerObservers = new Set<RuntimeRunMarkerListener>();
  private readonly durableEventCommit: RuntimeDurableEventCommit | undefined;
  private readonly terminalCommit: RuntimeDurableTerminalCommit | undefined;
  private readonly redactions!: readonly string[];
  private readonly emittedEvents: RuntimeEvent[] = [];
  private readonly emittedMarkers: RuntimeRunMarkerEntry[] = [];
  private readonly listenerFailures: RuntimeListenerFailure[] = [];
  private readonly messageRecords = new Map<RuntimeMessageId, RuntimeMessageRecord>();
  private readonly toolRecords = new Map<ToolCallId, RuntimeToolRecord>();
  private readonly seenTurnIds = new Set<RuntimeTurnId>();
  private operationTail: Promise<void> = Promise.resolve();
  private pendingOperations = 0;
  private settlingListeners = false;
  private externalAbortCleanup: (() => void) | undefined;
  private state: RuntimeRunControllerState = 'created';
  private startPersistenceFailed = false;
  private terminalReserved = false;
  private terminalValue: RuntimeRunTerminal | undefined;
  private terminalPersistenceValue: RuntimeTerminalPersistenceFailure | undefined;
  private criticalFailure = false;
  private historyCodeUnits = 0;
  private historyNodes = 0;
  private reservedHistoryCodeUnits = 0;
  private reservedHistoryNodes = 0;
  private sequence = 0;
  private runOrdinal = 0;
  private activeTurnId: RuntimeTurnId | null = null;
  private activeTurnGraph: RuntimeTurnGraph | null = null;
  private lastTurnId: RuntimeTurnId;
  private readonly startMarkerId: RuntimeEntryId;
  private markerParentId: RuntimeEntryId | null;

  constructor(options: RuntimeRunControllerOptions) {
    assertBoundedId(options.sessionId, 'Runtime sessionId');
    assertBoundedId(options.runId, 'Runtime runId');
    assertBoundedId(options.defTurnId, 'Runtime defTurnId');
    if (options.initialTurnId !== undefined) assertBoundedId(options.initialTurnId, 'Runtime initial turnId');
    if (options.parentEntryId !== undefined && options.parentEntryId !== null) {
      assertBoundedId(options.parentEntryId, 'Runtime parent entryId');
    }
    if (options.now !== undefined && typeof options.now !== 'function') {
      throw protocol('RUNTIME_CLOCK_INVALID', 'Runtime clock must be callable.');
    }
    if (options.terminalCommit !== undefined && typeof options.terminalCommit !== 'function') {
      throw protocol('RUNTIME_LISTENER_INVALID', 'Runtime terminal commit must be callable.');
    }
    if (options.durableEventCommit !== undefined && typeof options.durableEventCommit !== 'function') {
      throw protocol('RUNTIME_LISTENER_INVALID', 'Runtime durable event commit must be callable.');
    }
    if ((options.durableEventCommit === undefined) !== (options.terminalCommit === undefined)) {
      throw protocol(
        'RUNTIME_DURABLE_CONFIG_INVALID',
        'Runtime durable event and terminal commits must be configured together.',
      );
    }
    validateListenerList(options.listeners, 'Runtime event observers');
    validateListenerList(options.markerListeners, 'Runtime marker observers');

    this.sessionId = options.sessionId;
    this.runId = options.runId;
    this.defTurnId = options.defTurnId;
    this.now = options.now ?? (() => new Date().toISOString());
    this.lastTurnId = options.initialTurnId ?? asRuntimeTurnId(boundedId(`${options.runId}:turn:1`));
    this.startMarkerId = asRuntimeEntryId(boundedId(`${options.runId}:run-marker:start`));
    this.markerParentId = options.parentEntryId ?? null;
    this.signal = this.abortController.signal;
    Object.defineProperty(this, 'redactions', {
      value: canonicalRedactions(options.redactions ?? []),
      enumerable: false,
      configurable: false,
      writable: false,
    });
    this.durableEventCommit = options.durableEventCommit;
    this.terminalCommit = options.terminalCommit;
    for (const listener of options.listeners ?? []) this.observers.add(listener);
    for (const listener of options.markerListeners ?? []) this.markerObservers.add(listener);

    if (options.signal) {
      const abortExternal = (): void => {
        this.abort(toAbortReason(options.signal?.reason, this.redactions));
      };
      if (options.signal.aborted) abortExternal();
      else {
        options.signal.addEventListener('abort', abortExternal, { once: true });
        this.externalAbortCleanup = () => {
          options.signal?.removeEventListener('abort', abortExternal);
        };
      }
    }
  }

  get status(): RuntimeRunControllerState {
    return this.state;
  }

  get terminal(): RuntimeRunTerminal | undefined {
    return this.terminalValue === undefined ? undefined : cloneCanonical(this.terminalValue, []);
  }

  /**
   * Present only when both the candidate and failed-terminal durable commits
   * rejected. `terminalReserved` remains set in that state: a different
   * terminal may not be retried after an indeterminate durable transaction.
   */
  get terminalPersistenceFailure(): RuntimeTerminalPersistenceFailure | undefined {
    return this.terminalPersistenceValue === undefined
      ? undefined
      : cloneCanonical(this.terminalPersistenceValue, []);
  }

  get events(): readonly RuntimeEvent[] {
    return Object.freeze(this.emittedEvents.map((event) => cloneCanonical(event, [])));
  }

  get runMarkers(): readonly RuntimeRunMarkerEntry[] {
    return Object.freeze(this.emittedMarkers.map((marker) => cloneCanonical(marker, [])));
  }

  get listenerErrors(): readonly RuntimeListenerFailure[] {
    return Object.freeze(this.listenerFailures.map((failure) => cloneCanonical(failure, [])));
  }

  /** Add a best-effort observer after construction. */
  subscribe(listener: RuntimeEventListener): () => void {
    validateObserver(listener, this.observers.size);
    this.observers.add(listener);
    return () => this.observers.delete(listener);
  }

  /** Best-effort marker observer; terminal notification follows durable commit. */
  subscribeRunMarkers(listener: RuntimeRunMarkerListener): () => void {
    validateObserver(listener, this.markerObservers.size);
    this.markerObservers.add(listener);
    return () => this.markerObservers.delete(listener);
  }

  /** Request cancellation. The Agent loop owns the eventual run.end. */
  abort(reason: RuntimeAbortReason = { code: 'RUNTIME_ABORTED', message: 'Run aborted.' }): boolean {
    if (this.terminalReserved) return false;
    if (!this.abortController.signal.aborted) {
      this.abortController.abort(Object.freeze({
        code: safeCode(reason.code, 'RUNTIME_ABORTED'),
        ...(reason.message === undefined
          ? {}
          : { message: safeMessage(reason.message, this.redactions) }),
      }));
    }
    return true;
  }

  async start(): Promise<RuntimeEvent> {
    this.rejectListenerReentry('start');
    return this.enqueueOperation(async () => {
      if (this.startPersistenceFailed) throw durableStartError();
      if (this.state !== 'created') {
        throw protocol('RUNTIME_RUN_START_DUPLICATE', 'Runtime run.start is not unique.');
      }
      const allocation = this.createStartAllocation();
      this.reserveHistory(allocation.footprints, false);
      await this.publishStart(allocation);
      return cloneCanonical(allocation.bundle.event, []);
    });
  }

  async emit(draft: RuntimeEventDraft): Promise<RuntimeEvent> {
    this.rejectListenerReentry('emit');
    this.assertOperationCapacity();
    // Snapshot caller-owned data before the first queue await. State-dependent
    // validation deliberately happens only once this operation reaches head.
    const canonicalDraft = canonicalizeDraft(draft, this.redactions);
    return this.enqueueOperation(async () => {
      if (this.state !== 'running' || this.terminalReserved) {
        throw protocol('RUNTIME_EVENT_AFTER_TERMINAL', 'Runtime event arrived after the run terminal.');
      }
      if (this.criticalFailure) throw criticalListenerError();
      this.assertEventCapacity();
      this.validateDraft(canonicalDraft);
      const allocation = this.allocateEvent(canonicalDraft);
      this.reserveHistory([allocation.footprint], false);
      await this.dispatch(allocation, canonicalDraft);
      return cloneCanonical(allocation.value, []);
    });
  }

  /** Publish the sole terminal after all earlier durable listeners settle. */
  async finish(terminal: RuntimeRunTerminal): Promise<RuntimeEvent> {
    this.rejectListenerReentry('finish');
    this.assertOperationCapacity();
    const canonicalTerminal = canonicalizeTerminal(terminal, this.redactions);
    return this.enqueueOperation(() => this.finishPrepared(canonicalTerminal, false));
  }

  /**
   * Last-resort closure after a failed/aborted loop. Open graph nodes are
   * explicitly abandoned before the same unique durable terminal protocol.
   */
  async finishAfterFailure(terminal: RuntimeRunTerminal): Promise<RuntimeEvent> {
    this.rejectListenerReentry('finishAfterFailure');
    this.assertOperationCapacity();
    const canonicalTerminal = canonicalizeTerminal(terminal, this.redactions);
    if (canonicalTerminal.status === 'completed') {
      throw protocol(
        'RUNTIME_TERMINAL_REPAIR_INVALID',
        'Runtime recovery can only publish a failed or aborted terminal.',
      );
    }
    return this.enqueueOperation(() => this.finishPrepared(canonicalTerminal, true));
  }

  private async finishPrepared(
    terminal: RuntimeRunTerminal,
    repair: boolean,
  ): Promise<RuntimeEvent> {
    if (this.terminalReserved) {
      throw protocol('RUNTIME_TERMINAL_DUPLICATE', 'Runtime run terminal is not unique.');
    }
    if (this.state !== 'running') {
      throw protocol('RUNTIME_RUN_NOT_RUNNING', 'Runtime run.end requires a running run.');
    }
    if (repair) {
      for (const [messageId, record] of this.messageRecords) {
        if (record.state === 'open') {
          this.messageRecords.set(messageId, Object.freeze({ ...record, state: 'abandoned' }));
        }
      }
      for (const [toolCallId, record] of this.toolRecords) {
        if (record.state !== 'consumed' && record.state !== 'abandoned') {
          this.toolRecords.set(toolCallId, Object.freeze({ ...record, state: 'abandoned' }));
        }
      }
      this.activeTurnId = null;
      this.activeTurnGraph = null;
    } else if (this.activeTurnId !== null || this.toolStatesHasUnsettled() || this.messageStatesHasOpen()) {
      throw protocol('RUNTIME_RUN_OPEN_WORK', 'Runtime run cannot end with an open turn, message, or Tool.');
    }

    this.terminalReserved = true;
    const selected = this.criticalFailure ? criticalListenerTerminal() : terminal;
    let event: RuntimeEvent;
    try {
      event = await this.publishTerminal(selected);
    } catch (error) {
      if (this.terminalValue === undefined && this.terminalPersistenceValue === undefined) {
        this.terminalPersistenceValue = Object.freeze({
          code: 'RUNTIME_DURABLE_TERMINAL_FAILED',
          message: 'The durable Runtime terminal commit failed.',
        });
        throw durableTerminalError();
      }
      throw error;
    }
    this.cleanupExternalAbort();
    return cloneCanonical(event, []);
  }

  dispose(): void {
    this.cleanupExternalAbort();
  }

  async waitForIdle(): Promise<void> {
    this.rejectListenerReentry('waitForIdle');
    await this.operationTail;
  }

  private cleanupExternalAbort(): void {
    this.externalAbortCleanup?.();
    this.externalAbortCleanup = undefined;
  }

  private assertOperationCapacity(): void {
    if (this.pendingOperations >= MAX_PENDING_OPERATIONS) {
      throw protocol('RUNTIME_OPERATION_LIMIT', 'Runtime operation queue limit exceeded.');
    }
  }

  private enqueueOperation<T>(operation: () => Promise<T>): Promise<T> {
    this.assertOperationCapacity();
    this.pendingOperations += 1;
    const previous = this.operationTail;
    let release!: () => void;
    this.operationTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    return (async () => {
      await previous;
      try {
        return await operation();
      } finally {
        this.pendingOperations -= 1;
        release();
      }
    })();
  }

  private assertEventCapacity(): void {
    if (this.emittedEvents.length >= MAX_RUNTIME_EVENTS || this.sequence >= MAX_RUNTIME_EVENTS) {
      throw protocol('RUNTIME_EVENT_LIMIT', 'Runtime event limit exceeded.');
    }
  }

  private reserveHistory(footprints: readonly CanonicalFootprint[], terminal: boolean): void {
    let codeUnits = 0;
    let nodes = 0;
    for (const footprint of footprints) {
      codeUnits += footprint.codeUnits;
      nodes += footprint.nodes;
    }
    const codeUnitLimit = terminal
      ? MAX_RUNTIME_HISTORY_CODE_UNITS
      : MAX_RUNTIME_HISTORY_CODE_UNITS - RUNTIME_TERMINAL_CODE_UNIT_RESERVE;
    const nodeLimit = terminal
      ? MAX_RUNTIME_HISTORY_NODES
      : MAX_RUNTIME_HISTORY_NODES - RUNTIME_TERMINAL_NODE_RESERVE;
    if (
      this.historyCodeUnits + this.reservedHistoryCodeUnits + codeUnits > codeUnitLimit
      || this.historyNodes + this.reservedHistoryNodes + nodes > nodeLimit
    ) {
      throw protocol(
        'RUNTIME_RUN_PAYLOAD_LIMIT',
        'Runtime run history exceeded its cumulative payload budget.',
      );
    }
    this.reservedHistoryCodeUnits += codeUnits;
    this.reservedHistoryNodes += nodes;
  }

  private releaseHistoryReservation(footprints: readonly CanonicalFootprint[]): void {
    for (const footprint of footprints) {
      this.reservedHistoryCodeUnits -= footprint.codeUnits;
      this.reservedHistoryNodes -= footprint.nodes;
    }
  }

  private commitHistoryReservation(footprints: readonly CanonicalFootprint[]): void {
    for (const footprint of footprints) {
      this.reservedHistoryCodeUnits -= footprint.codeUnits;
      this.reservedHistoryNodes -= footprint.nodes;
      this.historyCodeUnits += footprint.codeUnits;
      this.historyNodes += footprint.nodes;
    }
  }

  private allocateEvent(draft: RuntimeEventDraft): CanonicalAllocation<RuntimeEvent> {
    this.assertEventCapacity();
    const sequence = this.sequence + 1;
    const runScoped = 'runId' in draft && draft.runId !== undefined;
    const runOrdinal = runScoped ? this.runOrdinal + 1 : undefined;
    const allocation = cloneCanonicalMeasured({
      ...draft,
      sessionId: this.sessionId,
      sequence,
      occurredAt: safeTimestamp(this.now()),
      ...(runOrdinal === undefined ? {} : { runOrdinal }),
    }, this.redactions) as CanonicalAllocation<RuntimeEvent>;
    validateRuntimeEvent(allocation.value);
    return allocation;
  }

  private async dispatch(
    allocation: CanonicalAllocation<RuntimeEvent>,
    draft: RuntimeEventDraft,
  ): Promise<void> {
    const event = allocation.value;
    this.settlingListeners = true;
    try {
      const accepted = this.durableEventCommit === undefined
        ? true
        : await settleDurableEventCommit(this.durableEventCommit, Object.freeze({ kind: 'event', event }));
      if (!accepted) {
        this.criticalFailure = true;
        this.releaseHistoryReservation([allocation.footprint]);
        throw criticalListenerError();
      }
      this.commitDraftState(draft);
      this.sequence = event.sequence;
      if (event.runOrdinal !== undefined) this.runOrdinal = event.runOrdinal;
      this.commitHistoryReservation([allocation.footprint]);
      this.emittedEvents.push(event);
      await this.notifyEventObservers(event);
    } finally {
      this.settlingListeners = false;
    }
  }

  private createStartAllocation(): RuntimeStartAllocation {
    if (this.emittedMarkers.length >= MAX_RUNTIME_MARKERS) {
      throw protocol('RUNTIME_MARKER_LIMIT', 'Runtime marker limit exceeded.');
    }
    const markerAllocation = cloneCanonicalMeasured({
      schemaVersion: 1,
      type: 'run-marker',
      id: this.startMarkerId,
      parentId: this.markerParentId,
      createdAt: safeTimestamp(this.now()),
      phase: 'start',
      defTurnId: this.defTurnId,
      runId: this.runId,
      turnId: this.lastTurnId,
    }, this.redactions) as CanonicalAllocation<Extract<RuntimeRunMarkerEntry, { readonly phase: 'start' }>>;
    validateRunMarker(markerAllocation.value);
    const eventAllocation = this.allocateEvent({
      type: 'run.start',
      runId: this.runId,
      defTurnId: this.defTurnId,
    }) as CanonicalAllocation<Extract<RuntimeEvent, { readonly type: 'run.start' }>>;
    return Object.freeze({
      bundle: Object.freeze({ marker: markerAllocation.value, event: eventAllocation.value }),
      footprints: Object.freeze([markerAllocation.footprint, eventAllocation.footprint]),
    });
  }

  private async publishStart(allocation: RuntimeStartAllocation): Promise<void> {
    this.settlingListeners = true;
    try {
      const accepted = this.durableEventCommit === undefined
        ? true
        : await settleDurableEventCommit(
          this.durableEventCommit,
          Object.freeze({ kind: 'run.start', bundle: allocation.bundle }),
        );
      if (!accepted) {
        this.releaseHistoryReservation(allocation.footprints);
        this.startPersistenceFailed = true;
        throw durableStartError();
      }
      this.sequence = allocation.bundle.event.sequence;
      this.runOrdinal = allocation.bundle.event.runOrdinal;
      this.commitHistoryReservation(allocation.footprints);
      this.emittedMarkers.push(allocation.bundle.marker);
      this.markerParentId = allocation.bundle.marker.id;
      this.emittedEvents.push(allocation.bundle.event);
      this.state = 'running';
      await this.notifyMarkerObservers(allocation.bundle.marker);
      await this.notifyEventObservers(allocation.bundle.event);
    } finally {
      this.settlingListeners = false;
    }
  }

  private async publishTerminal(candidate: RuntimeRunTerminal): Promise<RuntimeEvent> {
    this.assertEventCapacity();
    let selected = candidate;
    let allocation = this.createTerminalAllocation(selected);
    this.reserveHistory(allocation.footprints, true);

    this.settlingListeners = true;
    try {
      if (this.terminalCommit) {
        const accepted = await settleTerminalCommit(this.terminalCommit, allocation.bundle);
        if (!accepted) {
          this.releaseHistoryReservation(allocation.footprints);
          this.criticalFailure = true;
          selected = durableTerminalFailure();
          allocation = this.createTerminalAllocation(selected);
          this.reserveHistory(allocation.footprints, true);
          // The callback contract guarantees the rejected candidate committed
          // neither member. Retry once with the only terminal now exposed.
          const failedAccepted = await settleTerminalCommit(this.terminalCommit, allocation.bundle);
          if (!failedAccepted) {
            this.releaseHistoryReservation(allocation.footprints);
            this.terminalPersistenceValue = Object.freeze({
              code: 'RUNTIME_DURABLE_TERMINAL_FAILED',
              message: 'The durable Runtime terminal commit failed.',
            });
            // No terminal state/history/observer is updated: durable state is
            // unknown and pretending otherwise would make recovery lie.
            throw durableTerminalError();
          }
        }
      }

      this.terminalValue = selected;
      this.state = 'terminal';
      this.sequence = allocation.bundle.event.sequence;
      this.runOrdinal = allocation.bundle.event.runOrdinal;
      this.commitHistoryReservation(allocation.footprints);
      this.emittedMarkers.push(allocation.bundle.marker);
      this.markerParentId = allocation.bundle.marker.id;
      this.emittedEvents.push(allocation.bundle.event);

      // Observers only see the fixed terminal, never a completed candidate
      // that can subsequently become failed because durable commit rejected.
      await this.notifyMarkerObservers(allocation.bundle.marker);
      await this.notifyEventObservers(allocation.bundle.event);
      return allocation.bundle.event;
    } finally {
      this.settlingListeners = false;
    }
  }

  private createTerminalAllocation(terminal: RuntimeRunTerminal): RuntimeTerminalAllocation {
    if (this.emittedMarkers.length >= MAX_RUNTIME_MARKERS) {
      throw protocol('RUNTIME_MARKER_LIMIT', 'Runtime marker limit exceeded.');
    }
    const markerAllocation = cloneCanonicalMeasured({
      schemaVersion: 1,
      type: 'run-marker',
      id: asRuntimeEntryId(boundedId(`${this.runId}:run-marker:end`)),
      parentId: this.markerParentId,
      createdAt: safeTimestamp(this.now()),
      phase: 'end',
      defTurnId: this.defTurnId,
      runId: this.runId,
      turnId: this.lastTurnId,
      terminal: toMarkerTerminal(terminal),
    }, this.redactions) as CanonicalAllocation<Extract<RuntimeRunMarkerEntry, { readonly phase: 'end' }>>;
    const eventAllocation = cloneCanonicalMeasured({
      type: 'run.end',
      sessionId: this.sessionId,
      sequence: this.sequence + 1,
      occurredAt: safeTimestamp(this.now()),
      runOrdinal: this.runOrdinal + 1,
      runId: this.runId,
      defTurnId: this.defTurnId,
      terminal,
    }, this.redactions) as CanonicalAllocation<Extract<RuntimeEvent, { readonly type: 'run.end' }>>;
    validateRunMarker(markerAllocation.value);
    validateRuntimeEvent(eventAllocation.value);
    return Object.freeze({
      bundle: Object.freeze({ marker: markerAllocation.value, event: eventAllocation.value }),
      footprints: Object.freeze([markerAllocation.footprint, eventAllocation.footprint]),
    });
  }

  private async notifyEventObservers(event: RuntimeEvent): Promise<void> {
    const settlements = await Promise.allSettled(
      [...this.observers].map((listener) => Promise.resolve().then(() => listener(cloneCanonical(event, [])))),
    );
    this.recordObserverFailures(settlements);
  }

  private async notifyMarkerObservers(marker: RuntimeRunMarkerEntry): Promise<void> {
    const settlements = await Promise.allSettled(
      [...this.markerObservers].map((listener) => Promise.resolve().then(() => listener(cloneCanonical(marker, [])))),
    );
    this.recordObserverFailures(settlements);
  }

  private recordObserverFailures(settlements: readonly PromiseSettledResult<unknown>[]): void {
    for (const settlement of settlements) {
      if (settlement.status === 'rejected' && this.listenerFailures.length < MAX_LISTENER_FAILURES) {
        this.listenerFailures.push(Object.freeze({
          code: 'RUNTIME_OBSERVER_FAILED',
          message: 'A Runtime observer failed.',
        }));
      }
    }
  }

  private validateDraft(draft: RuntimeEventDraft): void {
    if (draft.type === 'run.start' || draft.type === 'run.end') {
      throw protocol('RUNTIME_TERMINAL_INTERNAL', 'run.start and run.end are owned by RuntimeRunController.');
    }
    const compaction = draft.type === 'compaction.start' || draft.type === 'compaction.end';
    if (
      (!compaction && (!('runId' in draft) || draft.runId !== this.runId))
      || (compaction && 'runId' in draft && draft.runId !== undefined && draft.runId !== this.runId)
    ) {
      throw protocol('RUNTIME_RUN_ID_CONFLICT', 'Runtime event changed or omitted runId.');
    }
    if (
      (!compaction && (!('defTurnId' in draft) || draft.defTurnId !== this.defTurnId))
      || (compaction && 'defTurnId' in draft && draft.defTurnId !== undefined && draft.defTurnId !== this.defTurnId)
    ) {
      throw protocol('RUNTIME_DEF_TURN_ID_CONFLICT', 'Runtime event changed or omitted defTurnId.');
    }

    switch (draft.type) {
      case 'turn.start':
        if (this.activeTurnId !== null) {
          throw protocol('RUNTIME_TURN_DUPLICATE', 'Runtime turn.start arrived before turn.end.');
        }
        if (this.seenTurnIds.has(draft.turnId)) {
          throw protocol('RUNTIME_TURN_ID_DUPLICATE', 'Runtime turnId is not unique within its run.');
        }
        break;
      case 'turn.end':
        this.requireActiveTurn(draft.turnId);
        if (this.messageStatesHasOpen()) {
          throw protocol('RUNTIME_MESSAGE_OPEN', 'Runtime turn.end arrived before every message settled.');
        }
        if (this.toolStatesHasUnsettled()) {
          throw protocol('RUNTIME_TOOL_OPEN', 'Runtime turn.end arrived before every Tool result settled.');
        }
        this.requireTurnGraphComplete(draft.assistantMessage, draft.toolResultMessageIds);
        break;
      case 'message.start':
        this.validateMessageStart(draft.message, draft.defTurnId);
        break;
      case 'message.update':
        this.validateMessageUpdate(draft.messageId, draft.defTurnId);
        break;
      case 'message.end':
        this.validateMessageEnd(draft.message, draft.defTurnId);
        break;
      case 'tool.start':
        this.requireActiveTurn(draft.turnId);
        if (this.toolRecords.has(draft.call.toolCallId)) {
          throw protocol('RUNTIME_TOOL_DUPLICATE', 'Runtime Tool call is not unique.');
        }
        this.requireExpectedToolStart(draft.call);
        break;
      case 'tool.update': {
        this.requireActiveTurn(draft.turnId);
        const record = this.toolRecords.get(draft.toolCallId);
        if (record?.state !== 'running' || record.turnId !== draft.turnId) {
          throw protocol('RUNTIME_TOOL_LATE_EVENT', 'Runtime Tool update arrived outside its running Tool.');
        }
        if (record.updateCount >= MAX_TOOL_UPDATES) {
          throw protocol('RUNTIME_TOOL_UPDATE_LIMIT', 'Runtime Tool update limit exceeded.');
        }
        break;
      }
      case 'tool.end': {
        this.requireActiveTurn(draft.turnId);
        const record = this.toolRecords.get(draft.toolCallId);
        if (record?.state !== 'running' || record.turnId !== draft.turnId) {
          throw protocol('RUNTIME_TOOL_LATE_EVENT', 'Runtime Tool end arrived outside its running Tool.');
        }
        break;
      }
      case 'retry.scheduled':
      case 'retry.end':
      case 'compaction.start':
      case 'compaction.end':
        break;
    }
  }

  private commitDraftState(draft: RuntimeEventDraft): void {
    switch (draft.type) {
      case 'turn.start':
        this.activeTurnId = draft.turnId;
        this.activeTurnGraph = Object.freeze({
          turnId: draft.turnId,
          pendingCalls: Object.freeze([]),
          nextToolIndex: 0,
          toolResultMessageIds: Object.freeze([]),
        });
        this.lastTurnId = draft.turnId;
        this.seenTurnIds.add(draft.turnId);
        break;
      case 'turn.end':
        this.activeTurnId = null;
        this.activeTurnGraph = null;
        break;
      case 'message.start':
        this.messageRecords.set(draft.message.id, Object.freeze({
          start: draft.message,
          ...(draft.message.role === 'tool-result' ? { toolCallId: draft.message.toolCallId } : {}),
          state: 'open',
        }));
        if (draft.message.role === 'tool-result') {
          const tool = this.toolRecords.get(draft.message.toolCallId)!;
          this.toolRecords.set(draft.message.toolCallId, Object.freeze({
            ...tool,
            resultMessageId: draft.message.id,
            state: 'result-open',
          }));
        }
        break;
      case 'message.end':
        this.messageRecords.set(draft.message.id, Object.freeze({
          ...this.messageRecords.get(draft.message.id)!,
          final: draft.message,
          state: 'ended',
        }));
        if (draft.message.role === 'assistant') {
          const calls = Object.freeze(draft.message.content
            .filter((block): block is RuntimeToolCallBlock => block.type === 'tool-call'));
          this.activeTurnGraph = Object.freeze({
            turnId: draft.message.turnId,
            assistant: draft.message,
            pendingCalls: calls,
            nextToolIndex: 0,
            toolResultMessageIds: Object.freeze([]),
          });
        } else if (draft.message.role === 'tool-result') {
          const tool = this.toolRecords.get(draft.message.toolCallId)!;
          this.toolRecords.set(draft.message.toolCallId, Object.freeze({ ...tool, state: 'consumed' }));
          const graph = this.activeTurnGraph!;
          this.activeTurnGraph = Object.freeze({
            ...graph,
            toolResultMessageIds: Object.freeze([...graph.toolResultMessageIds, draft.message.id]),
          });
        }
        break;
      case 'tool.start':
        this.toolRecords.set(draft.call.toolCallId, Object.freeze({
          turnId: draft.turnId,
          call: draft.call,
          updateCount: 0,
          state: 'running',
        }));
        this.activeTurnGraph = Object.freeze({
          ...this.activeTurnGraph!,
          nextToolIndex: this.activeTurnGraph!.nextToolIndex + 1,
        });
        break;
      case 'tool.update': {
        const tool = this.toolRecords.get(draft.toolCallId)!;
        this.toolRecords.set(draft.toolCallId, Object.freeze({ ...tool, updateCount: tool.updateCount + 1 }));
        break;
      }
      case 'tool.end':
        this.toolRecords.set(draft.toolCallId, Object.freeze({
          ...this.toolRecords.get(draft.toolCallId)!,
          result: draft.result,
          state: 'ended',
        }));
        break;
      default:
        break;
    }
  }

  private validateMessageStart(message: RuntimeMessageStart, eventDefTurnId: DefTurnId): void {
    if (this.messageRecords.has(message.id)) {
      throw protocol('RUNTIME_MESSAGE_DUPLICATE', 'Runtime message.start is not unique.');
    }
    if (message.role !== 'compaction') {
      this.requireActiveTurn(message.turnId);
      if (message.defTurnId !== eventDefTurnId) {
        throw protocol('RUNTIME_MESSAGE_DEF_TURN_ID_CONFLICT', 'Runtime message changed defTurnId.');
      }
    } else {
      if (message.defTurnId !== undefined && message.defTurnId !== eventDefTurnId) {
        throw protocol('RUNTIME_MESSAGE_DEF_TURN_ID_CONFLICT', 'Runtime compaction changed defTurnId.');
      }
      if (message.turnId !== undefined) this.requireActiveTurn(message.turnId);
    }
    if (message.role === 'assistant' && this.activeTurnGraph?.assistant !== undefined) {
      throw protocol('RUNTIME_ASSISTANT_DUPLICATE', 'Runtime turn already has an assistant message.');
    }
    if (message.role === 'tool-result') this.requireToolResultStart(message);
  }

  private validateMessageUpdate(messageId: RuntimeMessageId, eventDefTurnId: DefTurnId): void {
    const record = this.messageRecords.get(messageId);
    if (
      record?.state !== 'open'
      || record.start.role !== 'assistant'
      || record.start.defTurnId !== eventDefTurnId
    ) {
      throw protocol('RUNTIME_MESSAGE_LATE_EVENT', 'Runtime message.update arrived outside its assistant draft.');
    }
    this.requireActiveTurn(record.start.turnId);
  }

  private validateMessageEnd(message: RuntimeMessage, eventDefTurnId: DefTurnId): void {
    const record = this.messageRecords.get(message.id);
    if (record?.state !== 'open') {
      throw protocol('RUNTIME_MESSAGE_LATE_EVENT', 'Runtime message.end arrived outside its message.');
    }
    if (message.role !== record.start.role) {
      throw protocol('RUNTIME_MESSAGE_ROLE_CONFLICT', 'Runtime message.end changed message role.');
    }
    if (message.role === 'assistant' && record.start.role === 'assistant') {
      if (message.defTurnId !== record.start.defTurnId || message.turnId !== record.start.turnId) {
        throw protocol('RUNTIME_MESSAGE_TURN_CONFLICT', 'Runtime message.end changed message turn correlation.');
      }
      this.requireActiveTurn(message.turnId);
      if (message.defTurnId !== eventDefTurnId) {
        throw protocol('RUNTIME_MESSAGE_DEF_TURN_ID_CONFLICT', 'Runtime assistant changed defTurnId.');
      }
      validateAssistantCompletion(record.start, message);
      return;
    }
    if (!canonicalEqual(record.start, message)) {
      throw protocol('RUNTIME_MESSAGE_PAYLOAD_CONFLICT', 'Runtime message.end changed an immutable message payload.');
    }
    if (message.role !== 'compaction') this.requireActiveTurn(message.turnId);
    if (message.role === 'tool-result') {
      const tool = this.toolRecords.get(message.toolCallId);
      if (
        tool?.state !== 'result-open'
        || tool.resultMessageId !== message.id
        || !canonicalEqual(tool.result, message.result)
      ) {
        throw protocol('RUNTIME_TOOL_RESULT_INVALID', 'Runtime Tool result message did not match its ended Tool call.');
      }
    }
  }

  private requireToolResultStart(message: RuntimeToolResultMessage): void {
    const tool = this.toolRecords.get(message.toolCallId);
    if (
      tool?.state !== 'ended'
      || tool.turnId !== message.turnId
      || tool.call.name !== message.toolName
      || !canonicalEqual(tool.result, message.result)
      || tool.resultMessageId !== undefined
    ) {
      throw protocol(
        'RUNTIME_TOOL_RESULT_INVALID',
        'Runtime Tool result must consume one real ended Tool call from the active turn.',
      );
    }
  }

  private requireExpectedToolStart(call: RuntimeToolCallBlock): void {
    const graph = this.activeTurnGraph;
    if (!graph?.assistant) {
      throw protocol('RUNTIME_TOOL_GRAPH_INVALID', 'Runtime Tool started before its assistant message ended.');
    }
    if (this.toolStatesHasUnsettled()) {
      throw protocol('RUNTIME_TOOL_ORDER_INVALID', 'Runtime Tools must settle in assistant source order.');
    }
    const expected = graph.pendingCalls[graph.nextToolIndex];
    if (!expected || !canonicalEqual(expected, call)) {
      throw protocol('RUNTIME_TOOL_GRAPH_INVALID', 'Runtime Tool start did not match the next assistant Tool call.');
    }
  }

  private requireTurnGraphComplete(
    assistant: RuntimeAssistantMessage,
    toolResultMessageIds: readonly RuntimeMessageId[],
  ): void {
    const graph = this.activeTurnGraph;
    if (
      !graph?.assistant
      || graph.turnId !== this.activeTurnId
      || !canonicalEqual(graph.assistant, assistant)
    ) {
      throw protocol('RUNTIME_ASSISTANT_NOT_SETTLED', 'Runtime turn.end changed or forged its assistant message.');
    }
    if (graph.nextToolIndex !== graph.pendingCalls.length) {
      throw protocol('RUNTIME_TOOL_GRAPH_INCOMPLETE', 'Runtime turn ended before every assistant Tool call ran.');
    }
    if (!canonicalEqual(graph.toolResultMessageIds, toolResultMessageIds)) {
      throw protocol('RUNTIME_TOOL_RESULT_INVALID', 'Runtime turn.end did not exactly reference this turn\'s Tool results.');
    }
    for (const call of graph.pendingCalls) {
      const tool = this.toolRecords.get(call.toolCallId);
      const message = tool?.resultMessageId === undefined ? undefined : this.messageRecords.get(tool.resultMessageId);
      if (
        tool?.state !== 'consumed'
        || tool.turnId !== graph.turnId
        || !canonicalEqual(tool.call, call)
        || message?.state !== 'ended'
        || message.final?.role !== 'tool-result'
      ) {
        throw protocol('RUNTIME_TOOL_GRAPH_INCOMPLETE', 'Runtime turn has an incomplete Tool lifecycle.');
      }
    }
  }

  private requireActiveTurn(turnId: RuntimeTurnId): void {
    if (this.activeTurnId !== turnId) {
      throw protocol('RUNTIME_TURN_CORRELATION_CONFLICT', 'Runtime event arrived outside its active turn.');
    }
  }

  private toolStatesHasUnsettled(): boolean {
    for (const record of this.toolRecords.values()) {
      if (record.state === 'running' || record.state === 'ended' || record.state === 'result-open') return true;
    }
    return false;
  }

  private messageStatesHasOpen(): boolean {
    for (const record of this.messageRecords.values()) if (record.state === 'open') return true;
    return false;
  }

  private rejectListenerReentry(operation: string): void {
    if (this.settlingListeners) {
      throw protocol(
        'RUNTIME_LISTENER_REENTRANT',
        `Runtime listener cannot call ${operation} while its event is settling.`,
      );
    }
  }
}

export const RunController = RuntimeRunController;
export type RunController = RuntimeRunController;

export function createRunController(options: RuntimeRunControllerOptions): RuntimeRunController {
  return new RuntimeRunController(options);
}

/** Validate, clone, redact, and recursively freeze a Runtime message. */
export function canonicalizeRuntimeMessage(
  message: RuntimeMessage,
  redactions: readonly string[] = [],
): RuntimeMessage {
  const canonical = cloneCanonical(message, canonicalRedactions(redactions));
  validateMessage(canonical, 'final');
  return canonical;
}

/** Validate, clone, redact, and recursively freeze a Runtime message-start. */
export function canonicalizeRuntimeMessageStart(
  message: RuntimeMessageStart,
  redactions: readonly string[] = [],
): RuntimeMessageStart {
  const canonical = cloneCanonical(message, canonicalRedactions(redactions));
  validateMessage(canonical, 'start');
  return canonical;
}

function canonicalizeDraft(draft: RuntimeEventDraft, redactions: readonly string[]): RuntimeEventDraft {
  const canonical = cloneCanonical(draft, redactions);
  validateRuntimeDraft(canonical);
  return canonical;
}

function canonicalizeTerminal(
  terminal: RuntimeRunTerminal,
  redactions: readonly string[],
): RuntimeRunTerminal {
  const canonical = cloneCanonical(terminal, redactions);
  validateTerminal(canonical);
  return canonical;
}

function validateAssistantCompletion(
  draft: RuntimeAssistantMessageDraft,
  message: RuntimeAssistantMessage,
): void {
  if (
    draft.schemaVersion !== message.schemaVersion
    || draft.id !== message.id
    || draft.createdAt !== message.createdAt
    || draft.defTurnId !== message.defTurnId
    || draft.turnId !== message.turnId
    || draft.providerId !== message.providerId
    || draft.modelId !== message.modelId
    || (draft.responseId !== undefined && draft.responseId !== message.responseId)
  ) {
    throw protocol('RUNTIME_MESSAGE_IDENTITY_CONFLICT', 'Runtime assistant final changed its draft identity.');
  }
}

function validateRuntimeDraft(value: unknown): asserts value is RuntimeEventDraft {
  const event = assertRecord(value, 'Runtime event draft');
  assertString(event.type, 'Runtime event type', 64, true);
  switch (event.type) {
    case 'run.start':
      assertExactKeys(event, ['type', 'runId', 'defTurnId']);
      assertBoundedId(event.runId, 'Runtime runId');
      assertBoundedId(event.defTurnId, 'Runtime defTurnId');
      return;
    case 'run.end':
      assertExactKeys(event, ['type', 'runId', 'defTurnId', 'terminal']);
      assertBoundedId(event.runId, 'Runtime runId');
      assertBoundedId(event.defTurnId, 'Runtime defTurnId');
      validateTerminal(event.terminal);
      return;
    case 'turn.start':
      assertExactKeys(event, ['type', 'runId', 'defTurnId', 'turnId']);
      assertRunCorrelation(event);
      assertBoundedId(event.turnId, 'Runtime turnId');
      return;
    case 'turn.end':
      assertExactKeys(event, ['type', 'runId', 'defTurnId', 'turnId', 'assistantMessage', 'toolResultMessageIds']);
      assertRunCorrelation(event);
      assertBoundedId(event.turnId, 'Runtime turnId');
      validateMessage(event.assistantMessage, 'final', 'assistant');
      assertIdArray(event.toolResultMessageIds, 'Runtime Tool result message ids');
      return;
    case 'message.start':
      assertExactKeys(event, ['type', 'runId', 'defTurnId', 'message']);
      assertRunCorrelation(event);
      validateMessage(event.message, 'start');
      return;
    case 'message.update':
      assertExactKeys(event, ['type', 'runId', 'defTurnId', 'messageId', 'delta']);
      assertRunCorrelation(event);
      assertBoundedId(event.messageId, 'Runtime messageId');
      validateMessageDelta(event.delta);
      return;
    case 'message.end':
      assertExactKeys(event, ['type', 'runId', 'defTurnId', 'message']);
      assertRunCorrelation(event);
      validateMessage(event.message, 'final');
      return;
    case 'tool.start':
      assertExactKeys(event, ['type', 'runId', 'defTurnId', 'turnId', 'call']);
      assertRunCorrelation(event);
      assertBoundedId(event.turnId, 'Runtime turnId');
      validateToolCall(event.call);
      return;
    case 'tool.update':
      assertExactKeys(event, ['type', 'runId', 'defTurnId', 'turnId', 'toolCallId', 'detail']);
      assertRunCorrelation(event);
      assertBoundedId(event.turnId, 'Runtime turnId');
      assertBoundedId(event.toolCallId, 'Runtime Tool callId');
      assertJsonValue(event.detail, 'Runtime Tool update detail');
      return;
    case 'tool.end':
      assertExactKeys(event, ['type', 'runId', 'defTurnId', 'turnId', 'toolCallId', 'result', 'nextProjectionRevision']);
      assertRunCorrelation(event);
      assertBoundedId(event.turnId, 'Runtime turnId');
      assertBoundedId(event.toolCallId, 'Runtime Tool callId');
      validateToolResult(event.result);
      assertNonNegativeInteger(event.nextProjectionRevision, 'Runtime projection revision');
      return;
    case 'retry.scheduled':
      assertExactKeys(event, ['type', 'runId', 'defTurnId', 'attempt', 'delayMs', 'failure']);
      assertRunCorrelation(event);
      assertPositiveInteger(event.attempt, 'Runtime retry attempt');
      assertNonNegativeInteger(event.delayMs, 'Runtime retry delay');
      validateProviderFailure(event.failure);
      return;
    case 'retry.end':
      assertExactKeys(event, ['type', 'runId', 'defTurnId', 'attempt', 'outcome']);
      assertRunCorrelation(event);
      assertPositiveInteger(event.attempt, 'Runtime retry attempt');
      if (event.outcome !== 'resumed' && event.outcome !== 'failed' && event.outcome !== 'aborted') {
        throw payloadInvalid('Runtime retry outcome');
      }
      return;
    case 'compaction.start':
      assertExactKeys(event, ['type', 'reason'], ['runId', 'defTurnId']);
      assertOptionalCorrelation(event);
      if (event.reason !== 'manual' && event.reason !== 'threshold' && event.reason !== 'overflow') {
        throw payloadInvalid('Runtime compaction reason');
      }
      return;
    case 'compaction.end':
      assertExactKeys(event, ['type', 'outcome'], ['runId', 'defTurnId']);
      assertOptionalCorrelation(event);
      validateCompactionOutcome(event.outcome);
      return;
    default:
      throw payloadInvalid('Runtime event type');
  }
}

function validateRuntimeEvent(value: unknown): asserts value is RuntimeEvent {
  const event = assertRecord(value, 'Runtime event');
  assertString(event.type, 'Runtime event type', 64, true);
  assertBoundedId(event.sessionId, 'Runtime sessionId');
  assertPositiveInteger(event.sequence, 'Runtime event sequence');
  assertTimestamp(event.occurredAt, 'Runtime occurredAt');
  const runScoped = event.type !== 'compaction.start' && event.type !== 'compaction.end';
  if (runScoped) assertPositiveInteger(event.runOrdinal, 'Runtime run ordinal');
  else if (event.runOrdinal !== undefined) assertPositiveInteger(event.runOrdinal, 'Runtime run ordinal');

  const draft: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(event)) {
    if (key !== 'sessionId' && key !== 'sequence' && key !== 'occurredAt' && key !== 'runOrdinal') draft[key] = child;
  }
  validateRuntimeDraft(draft);
  const expectedKeys = Object.keys(draft).concat(['sessionId', 'sequence', 'occurredAt']);
  if (event.runOrdinal !== undefined) expectedKeys.push('runOrdinal');
  assertExactKeys(event, expectedKeys);
}

function validateMessage(
  value: unknown,
  phase: 'start' | 'final',
  requiredRole?: RuntimeMessage['role'],
): asserts value is RuntimeMessage | RuntimeMessageStart {
  const message = assertRecord(value, 'Runtime message');
  assertString(message.role, 'Runtime message role', 32, true);
  if (requiredRole !== undefined && message.role !== requiredRole) throw payloadInvalid('Runtime message role');
  assertExactBaseMessage(message);

  switch (message.role) {
    case 'user':
      assertExactKeys(message, ['schemaVersion', 'id', 'createdAt', 'defTurnId', 'turnId', 'role', 'clientTurnId', 'content']);
      assertTurnMessage(message);
      assertBoundedId(message.clientTurnId, 'Runtime clientTurnId');
      validateContent(message.content, 'user');
      return;
    case 'assistant':
      if (phase === 'start') {
        assertExactKeys(
          message,
          ['schemaVersion', 'id', 'createdAt', 'defTurnId', 'turnId', 'role', 'content', 'providerId', 'modelId'],
          ['responseId'],
        );
        assertTurnMessage(message);
        if (!Array.isArray(message.content) || message.content.length !== 0) throw payloadInvalid('Runtime assistant draft content');
        assertIdentityString(message.providerId, 'Runtime providerId');
        assertIdentityString(message.modelId, 'Runtime modelId');
        if (message.responseId !== undefined) assertIdentityString(message.responseId, 'Runtime responseId');
        return;
      }
      assertExactKeys(
        message,
        [
          'schemaVersion', 'id', 'createdAt', 'defTurnId', 'turnId', 'role', 'content',
          'providerId', 'modelId', 'usage', 'stopReason', 'completedAt',
        ],
        ['responseId', 'diagnostic'],
      );
      assertTurnMessage(message);
      validateContent(message.content, 'assistant');
      assertIdentityString(message.providerId, 'Runtime providerId');
      assertIdentityString(message.modelId, 'Runtime modelId');
      if (message.responseId !== undefined) assertIdentityString(message.responseId, 'Runtime responseId');
      validateUsage(message.usage);
      if (!['stop', 'length', 'tool-use', 'error', 'aborted'].includes(String(message.stopReason))) {
        throw payloadInvalid('Runtime assistant stopReason');
      }
      if (message.diagnostic !== undefined) validateDiagnostic(message.diagnostic);
      assertTimestamp(message.completedAt, 'Runtime assistant completedAt');
      return;
    case 'tool-result':
      assertExactKeys(
        message,
        [
          'schemaVersion', 'id', 'createdAt', 'defTurnId', 'turnId', 'role', 'toolCallId',
          'toolName', 'result', 'completedAt',
        ],
      );
      assertTurnMessage(message);
      assertBoundedId(message.toolCallId, 'Runtime Tool callId');
      assertString(message.toolName, 'Runtime Tool name', 256, false);
      validateToolResult(message.result);
      assertTimestamp(message.completedAt, 'Runtime Tool result completedAt');
      return;
    case 'compaction':
      assertExactKeys(
        message,
        [
          'schemaVersion', 'id', 'createdAt', 'role', 'summary', 'firstKeptEntryId',
          'tokensBefore', 'reason', 'completedAt',
        ],
        ['defTurnId', 'turnId'],
      );
      if ((message.defTurnId === undefined) !== (message.turnId === undefined)) {
        throw payloadInvalid('Runtime compaction correlation');
      }
      if (message.defTurnId !== undefined) assertBoundedId(message.defTurnId, 'Runtime defTurnId');
      if (message.turnId !== undefined) assertBoundedId(message.turnId, 'Runtime turnId');
      assertString(message.summary, 'Runtime compaction summary', 256 * 1_024, false);
      assertBoundedId(message.firstKeptEntryId, 'Runtime first kept entryId');
      assertNonNegativeInteger(message.tokensBefore, 'Runtime compaction token count');
      if (message.reason !== 'manual' && message.reason !== 'threshold' && message.reason !== 'overflow') {
        throw payloadInvalid('Runtime compaction reason');
      }
      assertTimestamp(message.completedAt, 'Runtime compaction completedAt');
      return;
    default:
      throw payloadInvalid('Runtime message role');
  }
}

function assertExactBaseMessage(message: Record<string, unknown>): void {
  if (message.schemaVersion !== 1) throw payloadInvalid('Runtime message schemaVersion');
  assertBoundedId(message.id, 'Runtime messageId');
  assertTimestamp(message.createdAt, 'Runtime message createdAt');
}

function assertTurnMessage(message: Record<string, unknown>): void {
  assertBoundedId(message.defTurnId, 'Runtime defTurnId');
  assertBoundedId(message.turnId, 'Runtime turnId');
}

function validateContent(value: unknown, owner: 'user' | 'assistant'): void {
  if (!Array.isArray(value) || value.length > MAX_MESSAGE_CONTENT_BLOCKS) throw payloadInvalid('Runtime message content');
  const contentIds = new Set<string>();
  const toolCallIds = new Set<string>();
  for (const rawBlock of value) {
    const block = assertRecord(rawBlock, 'Runtime content block');
    assertString(block.type, 'Runtime content type', 32, true);
    assertBoundedId(block.id, 'Runtime contentId');
    if (contentIds.has(block.id)) throw payloadInvalid('Runtime duplicate contentId');
    contentIds.add(block.id);
    if (block.type === 'text') {
      assertExactKeys(block, ['type', 'id', 'text']);
      assertString(block.text, 'Runtime text', MAX_CANONICAL_STRING_CODE_UNITS, false);
    } else if (block.type === 'file' && owner === 'user') {
      assertExactKeys(block, ['type', 'id', 'mime', 'filename', 'url']);
      assertString(block.mime, 'Runtime file mime', 256, true);
      assertString(block.filename, 'Runtime filename', 4_096, true);
      assertString(block.url, 'Runtime file URL', MAX_CANONICAL_STRING_CODE_UNITS, true);
    } else if (block.type === 'thinking' && owner === 'assistant') {
      assertExactKeys(block, ['type', 'id', 'text'], ['redacted']);
      assertString(block.text, 'Runtime thinking', MAX_CANONICAL_STRING_CODE_UNITS, false);
      if (block.redacted !== undefined && typeof block.redacted !== 'boolean') throw payloadInvalid('Runtime thinking redaction');
    } else if (block.type === 'tool-call' && owner === 'assistant') {
      validateToolCall(block);
      if (toolCallIds.has(String(block.toolCallId))) throw payloadInvalid('Runtime duplicate Tool callId');
      toolCallIds.add(String(block.toolCallId));
    } else {
      throw payloadInvalid('Runtime content block');
    }
  }
}

function validateToolCall(value: unknown): asserts value is RuntimeToolCallBlock {
  const call = assertRecord(value, 'Runtime Tool call');
  assertExactKeys(call, ['type', 'id', 'toolCallId', 'name', 'arguments']);
  if (call.type !== 'tool-call') throw payloadInvalid('Runtime Tool call type');
  assertBoundedId(call.id, 'Runtime contentId');
  assertBoundedId(call.toolCallId, 'Runtime Tool callId');
  // Empty is permitted for a deterministic synthetic failure lifecycle.
  assertString(call.name, 'Runtime Tool name', 256, false);
  const args = assertRecord(call.arguments, 'Runtime Tool arguments');
  assertJsonValue(args, 'Runtime Tool arguments');
}

function validateToolResult(value: unknown): asserts value is RuntimeToolResultPayload {
  const result = assertRecord(value, 'Runtime Tool result');
  if (result.status === 'succeeded') {
    assertExactKeys(result, ['status', 'output']);
    assertJsonValue(result.output, 'Runtime Tool output');
    return;
  }
  if (result.status !== 'failed') throw payloadInvalid('Runtime Tool result status');
  assertExactKeys(result, ['status', 'code', 'message'], ['details']);
  assertCode(result.code, 'Runtime Tool result code');
  assertString(result.message, 'Runtime Tool result message', MAX_DIAGNOSTIC_CODE_UNITS, false);
  if (result.details !== undefined) assertJsonValue(result.details, 'Runtime Tool result details');
}

function validateMessageDelta(value: unknown): void {
  const delta = assertRecord(value, 'Runtime message delta');
  if (delta.type === 'text' || delta.type === 'thinking') {
    assertExactKeys(delta, ['type', 'contentId', 'delta']);
    assertBoundedId(delta.contentId, 'Runtime contentId');
    assertString(delta.delta, 'Runtime message delta', MAX_CANONICAL_STRING_CODE_UNITS, false);
    return;
  }
  if (delta.type === 'tool-call') {
    assertExactKeys(delta, ['type', 'contentId', 'toolCallId', 'nameDelta', 'argumentsDelta']);
    assertBoundedId(delta.contentId, 'Runtime contentId');
    assertBoundedId(delta.toolCallId, 'Runtime Tool callId');
    assertString(delta.nameDelta, 'Runtime Tool name delta', 256, false);
    assertString(delta.argumentsDelta, 'Runtime Tool arguments delta', 256 * 1_024, false);
    return;
  }
  throw payloadInvalid('Runtime message delta type');
}

function validateUsage(value: unknown): void {
  const usage = assertRecord(value, 'Runtime usage');
  assertExactKeys(
    usage,
    ['inputTokens', 'outputTokens', 'totalTokens'],
    ['reasoningTokens', 'cacheReadTokens', 'cacheWriteTokens'],
  );
  for (const key of Object.keys(usage)) assertNonNegativeInteger(usage[key], `Runtime usage ${key}`);
}

function validateDiagnostic(value: unknown): void {
  const diagnostic = assertRecord(value, 'Runtime diagnostic');
  assertExactKeys(diagnostic, ['code', 'message', 'retryable']);
  assertCode(diagnostic.code, 'Runtime diagnostic code');
  assertString(diagnostic.message, 'Runtime diagnostic message', MAX_DIAGNOSTIC_CODE_UNITS, false);
  if (typeof diagnostic.retryable !== 'boolean') throw payloadInvalid('Runtime diagnostic retryable');
}

function validateProviderFailure(value: unknown): void {
  const failure = assertRecord(value, 'Runtime provider failure');
  assertExactKeys(failure, ['kind', 'code', 'message', 'retryable'], ['statusCode']);
  if (![
    'authentication', 'bad-request', 'rate-limit', 'server', 'network', 'context-overflow',
    'malformed-response', 'aborted', 'unknown',
  ].includes(String(failure.kind))) throw payloadInvalid('Runtime provider failure kind');
  assertCode(failure.code, 'Runtime provider failure code');
  assertString(failure.message, 'Runtime provider failure message', MAX_DIAGNOSTIC_CODE_UNITS, false);
  if (typeof failure.retryable !== 'boolean') throw payloadInvalid('Runtime provider failure retryable');
  if (failure.statusCode !== undefined) assertNonNegativeInteger(failure.statusCode, 'Runtime provider status code');
}

function validateCompactionOutcome(value: unknown): void {
  const outcome = assertRecord(value, 'Runtime compaction outcome');
  if (outcome.status === 'compacted') {
    assertExactKeys(outcome, ['status', 'summaryEntryId']);
    assertBoundedId(outcome.summaryEntryId, 'Runtime summary entryId');
  } else if (outcome.status === 'not-needed') {
    assertExactKeys(outcome, ['status']);
  } else if (outcome.status === 'failed') {
    assertExactKeys(outcome, ['status', 'code', 'message']);
    assertCode(outcome.code, 'Runtime compaction failure code');
    assertString(outcome.message, 'Runtime compaction failure message', MAX_DIAGNOSTIC_CODE_UNITS, false);
  } else {
    throw payloadInvalid('Runtime compaction outcome');
  }
}

function validateTerminal(value: unknown): asserts value is RuntimeRunTerminal {
  const terminal = assertRecord(value, 'Runtime terminal');
  if (terminal.status === 'completed') {
    assertExactKeys(terminal, ['status'], ['output']);
    if (terminal.output !== undefined) assertJsonValue(terminal.output, 'Runtime terminal output');
  } else if (terminal.status === 'failed') {
    assertExactKeys(terminal, ['status', 'code', 'message']);
    assertCode(terminal.code, 'Runtime terminal code');
    assertString(terminal.message, 'Runtime terminal message', MAX_DIAGNOSTIC_CODE_UNITS, false);
  } else if (terminal.status === 'aborted') {
    assertExactKeys(terminal, ['status', 'code'], ['message']);
    assertCode(terminal.code, 'Runtime terminal code');
    if (terminal.message !== undefined) {
      assertString(terminal.message, 'Runtime terminal message', MAX_DIAGNOSTIC_CODE_UNITS, false);
    }
  } else {
    throw payloadInvalid('Runtime terminal status');
  }
}

function validateRunMarker(value: unknown): asserts value is RuntimeRunMarkerEntry {
  const marker = assertRecord(value, 'Runtime run marker');
  const required = [
    'schemaVersion', 'type', 'id', 'parentId', 'createdAt', 'phase', 'defTurnId', 'runId', 'turnId',
  ];
  assertExactKeys(marker, marker.phase === 'end' ? [...required, 'terminal'] : required);
  if (marker.schemaVersion !== 1 || marker.type !== 'run-marker') throw payloadInvalid('Runtime run marker');
  assertBoundedId(marker.id, 'Runtime marker id');
  if (marker.parentId !== null) assertBoundedId(marker.parentId, 'Runtime marker parent id');
  assertTimestamp(marker.createdAt, 'Runtime marker createdAt');
  assertBoundedId(marker.defTurnId, 'Runtime marker defTurnId');
  assertBoundedId(marker.runId, 'Runtime marker runId');
  assertBoundedId(marker.turnId, 'Runtime marker turnId');
  if (marker.phase === 'start') return;
  if (marker.phase !== 'end') throw payloadInvalid('Runtime marker phase');
  validateMarkerTerminal(marker.terminal);
}

function validateMarkerTerminal(value: unknown): void {
  const terminal = assertRecord(value, 'Runtime marker terminal');
  if (terminal.status === 'completed') assertExactKeys(terminal, ['status']);
  else if (terminal.status === 'failed' || terminal.status === 'interrupted') {
    assertExactKeys(terminal, ['status', 'code', 'message']);
    assertCode(terminal.code, 'Runtime marker terminal code');
    assertString(terminal.message, 'Runtime marker terminal message', MAX_DIAGNOSTIC_CODE_UNITS, false);
  } else if (terminal.status === 'aborted') {
    assertExactKeys(terminal, ['status', 'code'], ['message']);
    assertCode(terminal.code, 'Runtime marker terminal code');
    if (terminal.message !== undefined) {
      assertString(terminal.message, 'Runtime marker terminal message', MAX_DIAGNOSTIC_CODE_UNITS, false);
    }
  } else throw payloadInvalid('Runtime marker terminal status');
}

function toMarkerTerminal(terminal: RuntimeRunTerminal): RuntimeRunMarkerTerminal {
  if (terminal.status === 'completed') return Object.freeze({ status: 'completed' });
  return terminal;
}

function assertRunCorrelation(event: Record<string, unknown>): void {
  assertBoundedId(event.runId, 'Runtime runId');
  assertBoundedId(event.defTurnId, 'Runtime defTurnId');
}

function assertOptionalCorrelation(event: Record<string, unknown>): void {
  if ((event.runId === undefined) !== (event.defTurnId === undefined)) {
    throw payloadInvalid('Runtime optional correlation');
  }
  if (event.runId !== undefined) assertRunCorrelation(event);
}

function assertIdArray(value: unknown, label: string): void {
  if (!Array.isArray(value) || value.length > MAX_ARRAY_ITEMS) throw payloadInvalid(label);
  const ids = new Set<string>();
  for (const id of value) {
    assertBoundedId(id, label);
    if (ids.has(id)) throw payloadInvalid(label);
    ids.add(id);
  }
}

function assertJsonValue(value: unknown, label: string): asserts value is JsonValue {
  if (
    value === null
    || typeof value === 'string'
    || typeof value === 'boolean'
    || (typeof value === 'number' && Number.isFinite(value))
  ) return;
  if (Array.isArray(value)) {
    for (const child of value) assertJsonValue(child, label);
    return;
  }
  if (isRecord(value)) {
    for (const child of Object.values(value)) assertJsonValue(child, label);
    return;
  }
  throw payloadInvalid(label);
}

function assertExactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): void {
  const allowed = new Set([...required, ...optional]);
  for (const key of required) if (!(key in value)) throw payloadInvalid(`Runtime missing ${key}`);
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw payloadInvalid(`Runtime unexpected ${key}`);
}

function assertRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw payloadInvalid(label);
  return value;
}

function assertBoundedId(value: unknown, label: string): asserts value is string {
  assertString(value, label, MAX_ID_CODE_UNITS, true);
  if (/[\u0000-\u001f\u007f]/u.test(value)) throw payloadInvalid(label);
}

function assertIdentityString(value: unknown, label: string): asserts value is string {
  assertString(value, label, 4_096, true);
  if (/[\u0000-\u001f\u007f]/u.test(value)) throw payloadInvalid(label);
}

function assertCode(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9._-]{1,128}$/u.test(value)) throw payloadInvalid(label);
}

function assertString(
  value: unknown,
  label: string,
  maxCodeUnits: number,
  nonEmpty: boolean,
): asserts value is string {
  if (typeof value !== 'string' || value.length > maxCodeUnits || (nonEmpty && value.length === 0)) {
    throw payloadInvalid(label);
  }
}

function assertTimestamp(value: unknown, label: string): asserts value is string {
  assertString(value, label, MAX_TIMESTAMP_CODE_UNITS, true);
  if (!Number.isFinite(Date.parse(value))) throw payloadInvalid(label);
}

function assertNonNegativeInteger(value: unknown, label: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw payloadInvalid(label);
}

function assertPositiveInteger(value: unknown, label: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) throw payloadInvalid(label);
}

function payloadInvalid(label: string): RuntimeRunProtocolError {
  return protocol('RUNTIME_PAYLOAD_INVALID', `${label} is malformed.`);
}

interface CloneBudget {
  nodes: number;
  codeUnits: number;
}

function cloneCanonical<T>(value: T, redactions: readonly string[]): T {
  return cloneCanonicalMeasured(value, redactions).value;
}

function cloneCanonicalMeasured<T>(
  value: T,
  redactions: readonly string[],
): CanonicalAllocation<T> {
  const budget: CloneBudget = { nodes: 0, codeUnits: 0 };
  const cloned = cloneCanonicalNode(value, redactions, budget, 0, new WeakSet<object>()) as T;
  return Object.freeze({
    value: cloned,
    footprint: Object.freeze({ nodes: budget.nodes, codeUnits: budget.codeUnits }),
  });
}

function cloneCanonicalNode(
  value: unknown,
  redactions: readonly string[],
  budget: CloneBudget,
  depth: number,
  active: WeakSet<object>,
): unknown {
  budget.nodes += 1;
  if (depth > MAX_CANONICAL_DEPTH || budget.nodes > MAX_CANONICAL_NODES) throw payloadTooLarge();
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw payloadInvalid('Runtime numeric payload');
    return value;
  }
  if (typeof value === 'string') {
    budget.codeUnits += value.length;
    if (
      value.length > MAX_CANONICAL_STRING_CODE_UNITS
      || budget.codeUnits > MAX_CANONICAL_TOTAL_CODE_UNITS
    ) throw payloadTooLarge();
    return redactText(value, redactions);
  }
  if (typeof value !== 'object' || active.has(value)) throw payloadInvalid('Runtime canonical payload');
  active.add(value);
  try {
    if (Array.isArray(value)) {
      const descriptors = denseCanonicalArrayDescriptors(value);
      const output = descriptors.map(
        (descriptor) => cloneCanonicalNode(descriptor.value, redactions, budget, depth + 1, active),
      );
      return Object.freeze(output);
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw payloadInvalid('Runtime canonical object');
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const symbols = Object.getOwnPropertySymbols(value);
    if (symbols.some((symbol) => Object.prototype.propertyIsEnumerable.call(value, symbol))) {
      throw payloadInvalid('Runtime canonical object');
    }
    const entries = Object.entries(descriptors).filter(([, descriptor]) => descriptor.enumerable);
    if (entries.length > MAX_OBJECT_KEYS) throw payloadTooLarge();
    const output: Record<string, unknown> = {};
    for (const [rawKey, descriptor] of entries) {
      if (!('value' in descriptor)) throw payloadInvalid('Runtime canonical accessor');
      if (descriptor.value === undefined) continue;
      budget.codeUnits += rawKey.length;
      if (rawKey.length > MAX_CANONICAL_STRING_CODE_UNITS || budget.codeUnits > MAX_CANONICAL_TOTAL_CODE_UNITS) {
        throw payloadTooLarge();
      }
      const key = redactKey(rawKey, redactions);
      if (Object.prototype.hasOwnProperty.call(output, key)) throw payloadInvalid('Runtime redacted key collision');
      Object.defineProperty(output, key, {
        value: cloneCanonicalNode(descriptor.value, redactions, budget, depth + 1, active),
        enumerable: true,
        configurable: false,
        writable: false,
      });
    }
    return Object.freeze(output);
  } finally {
    active.delete(value);
  }
}

function denseCanonicalArrayDescriptors(value: readonly unknown[]): readonly PropertyDescriptor[] {
  let descriptors: Record<PropertyKey, PropertyDescriptor>;
  let prototype: unknown;
  try {
    prototype = Object.getPrototypeOf(value);
    descriptors = Object.getOwnPropertyDescriptors(value) as unknown as Record<PropertyKey, PropertyDescriptor>;
  } catch (_error) {
    throw payloadInvalid('Runtime canonical array');
  }
  const lengthDescriptor = descriptors.length;
  if (
    prototype !== Array.prototype
    || !lengthDescriptor
    || !('value' in lengthDescriptor)
    || !Number.isSafeInteger(lengthDescriptor.value)
    || lengthDescriptor.value < 0
  ) {
    throw payloadInvalid('Runtime canonical array');
  }
  const length = lengthDescriptor.value as number;
  if (length > MAX_ARRAY_ITEMS) throw payloadTooLarge();
  const indexed = new Map<number, PropertyDescriptor>();
  for (const key of Reflect.ownKeys(descriptors)) {
    if (key === 'length') continue;
    if (typeof key !== 'string' || !/^(?:0|[1-9][0-9]*)$/u.test(key)) {
      throw payloadInvalid('Runtime canonical array');
    }
    const index = Number(key);
    const descriptor = descriptors[key];
    if (
      !Number.isSafeInteger(index)
      || index < 0
      || index >= length
      || !descriptor
      || !descriptor.enumerable
      || !('value' in descriptor)
    ) {
      throw payloadInvalid('Runtime canonical array');
    }
    indexed.set(index, descriptor);
  }
  if (indexed.size !== length) throw payloadInvalid('Runtime canonical array');
  const output: PropertyDescriptor[] = [];
  for (let index = 0; index < length; index += 1) output.push(indexed.get(index)!);
  return output;
}

function payloadTooLarge(): RuntimeRunProtocolError {
  return protocol('RUNTIME_PAYLOAD_TOO_LARGE', 'Runtime payload exceeded its bounded canonical contract.');
}

function canonicalEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left)
      && Array.isArray(right)
      && left.length === right.length
      && left.every((child, index) => canonicalEqual(child, right[index]));
  }
  if (!isRecord(left) || !isRecord(right)) return false;
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key) => Object.prototype.hasOwnProperty.call(right, key) && canonicalEqual(left[key], right[key]));
}

function canonicalRedactions(values: readonly string[]): readonly string[] {
  if (!Array.isArray(values) || values.length > MAX_ARRAY_ITEMS) throw payloadInvalid('Runtime redactions');
  const accepted = new Set<string>();
  for (const value of values) {
    if (typeof value !== 'string') throw payloadInvalid('Runtime redaction');
    if (value.length >= 4 && value.length <= MAX_DIAGNOSTIC_CODE_UNITS) accepted.add(value);
  }
  return Object.freeze([...accepted].sort((left, right) => right.length - left.length));
}

function redactKey(value: string, redactions: readonly string[]): string {
  const known = redactKnown(value, redactions);
  if (/(?:authorization|api[-_ ]?key|access[-_ ]?token|refresh[-_ ]?token|password|secret)/iu.test(known)) {
    return '[redacted-key]';
  }
  return known;
}

function redactText(value: string, redactions: readonly string[]): string {
  return redactKnown(value, redactions)
    .replace(/authorization\s*:\s*\S+/giu, 'authorization: [redacted]')
    .replace(/bearer\s+[A-Za-z0-9._~+/=-]{8,}/giu, 'bearer [redacted]')
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/giu, '[redacted]')
    .replace(/((?:api[-_ ]?key|access[-_ ]?token|refresh[-_ ]?token|password|secret)\s*[:=])\s*[^\s,;]+/giu, '$1 [redacted]');
}

function redactKnown(value: string, redactions: readonly string[]): string {
  let output = value;
  for (const secret of redactions) output = output.split(secret).join('[redacted]');
  return output;
}

function safeTimestamp(value: unknown): string {
  assertTimestamp(value, 'Runtime timestamp');
  return value;
}

function safeCode(value: unknown, fallback: string): string {
  return typeof value === 'string' && /^[A-Za-z0-9._-]{1,128}$/u.test(value) ? value : fallback;
}

function safeMessage(value: unknown, redactions: readonly string[]): string {
  return redactText(typeof value === 'string' ? value.slice(0, MAX_DIAGNOSTIC_CODE_UNITS) : 'Runtime failure.', redactions);
}

function criticalListenerTerminal(): RuntimeRunTerminal {
  return Object.freeze({
    status: 'failed',
    code: 'RUNTIME_CRITICAL_LISTENER_FAILED',
    message: 'A critical Runtime persistence listener failed.',
  });
}

function durableTerminalFailure(): RuntimeRunTerminal {
  return Object.freeze({
    status: 'failed',
    code: 'RUNTIME_DURABLE_TERMINAL_FAILED',
    message: 'The durable Runtime terminal commit failed.',
  });
}

function durableTerminalError(): RuntimeRunProtocolError {
  return protocol('RUNTIME_DURABLE_TERMINAL_FAILED', 'The durable Runtime terminal commit failed.');
}

function durableStartError(): RuntimeRunProtocolError {
  return protocol('RUNTIME_DURABLE_START_FAILED', 'The durable Runtime run.start commit failed.');
}

function criticalListenerError(): RuntimeRunProtocolError {
  return protocol('RUNTIME_CRITICAL_LISTENER_FAILED', 'A critical Runtime persistence listener failed.');
}

async function settleDurableEventCommit(
  commit: RuntimeDurableEventCommit,
  write: RuntimeDurableEventWrite,
): Promise<boolean> {
  try {
    await commit(cloneCanonical(write, []));
    return true;
  } catch (_error) {
    return false;
  }
}

async function settleTerminalCommit(
  commit: RuntimeDurableTerminalCommit,
  bundle: RuntimeDurableTerminalBundle,
): Promise<boolean> {
  try {
    await commit(cloneCanonical(bundle, []));
    return true;
  } catch (_error) {
    return false;
  }
}

function validateListenerList(
  listeners: readonly ((value: never) => unknown)[] | undefined,
  label: string,
): void {
  if (listeners === undefined) return;
  if (!Array.isArray(listeners) || listeners.length > MAX_LISTENERS) throw payloadInvalid(label);
  for (const listener of listeners) if (typeof listener !== 'function') throw payloadInvalid(label);
}

function validateObserver(listener: unknown, size: number): asserts listener is (...args: never[]) => unknown {
  if (typeof listener !== 'function') throw payloadInvalid('Runtime observer');
  if (size >= MAX_LISTENERS) throw protocol('RUNTIME_LISTENER_LIMIT', 'Runtime observer limit exceeded.');
}

function toAbortReason(value: unknown, redactions: readonly string[]): RuntimeAbortReason {
  if (isRecord(value) && typeof value.code === 'string') {
    return {
      code: safeCode(value.code, 'RUNTIME_ABORTED'),
      ...(typeof value.message === 'string' ? { message: safeMessage(value.message, redactions) } : {}),
    };
  }
  return { code: 'RUNTIME_ABORTED', message: 'Run aborted.' };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function boundedId(value: string): string {
  if (value.length <= MAX_ID_CODE_UNITS) return value;
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return `${value.slice(0, 224)}:${hash.toString(16)}`;
}

function protocol(code: string, message: string): RuntimeRunProtocolError {
  return new RuntimeRunProtocolError(code, message);
}
