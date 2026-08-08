/**
 * Deterministic lifecycle controller for one Runtime run.
 *
 * The controller owns the Runtime event envelope, listener settlement, abort
 * signal, and the in-memory run-marker callbacks. It deliberately has no
 * persistence or Host knowledge; a Session implementation can subscribe to
 * the marker callback and decide how to append entries later.
 */
import type { DefTurnId } from '../../core/contracts/ids.ts';
import type { RuntimeRunMarkerEntry } from './session/entries.ts';
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
  RuntimeMessage,
  RuntimeMessageStart,
} from './messages.ts';
import type { ToolCallId } from '../../core/contracts/ids.ts';

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

export interface RuntimeRunControllerOptions {
  readonly sessionId: RuntimeSessionId;
  readonly runId: RuntimeRunId;
  readonly defTurnId: DefTurnId;
  readonly initialTurnId?: RuntimeTurnId;
  readonly parentEntryId?: RuntimeEntryId | null;
  readonly now?: () => string;
  readonly signal?: AbortSignal;
  readonly listeners?: readonly RuntimeEventListener[];
  readonly markerListeners?: readonly RuntimeRunMarkerListener[];
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
 * Owns one run's event stream. Every event is fully settled before the next
 * event can be dispatched, and `finish()` reserves the sole terminal slot
 * before publishing `run.end`, so re-entrant or late producers are rejected.
 */
export class RuntimeRunController {
  readonly sessionId: RuntimeSessionId;
  readonly runId: RuntimeRunId;
  readonly defTurnId: DefTurnId;
  readonly signal: AbortSignal;

  private readonly now: () => string;
  private readonly abortController = new AbortController();
  private readonly listeners = new Set<RuntimeEventListener>();
  private readonly markerListeners = new Set<RuntimeRunMarkerListener>();
  private readonly emittedEvents: RuntimeEvent[] = [];
  private readonly emittedMarkers: RuntimeRunMarkerEntry[] = [];
  private readonly listenerFailures: unknown[] = [];
  private readonly messageTurns = new Map<RuntimeMessageId, DefTurnId>();
  private readonly messageStates = new Map<RuntimeMessageId, 'open' | 'ended'>();
  private readonly toolStates = new Map<ToolCallId, 'running' | 'ended'>();
  private dispatchTail: Promise<void> = Promise.resolve();
  private externalAbortCleanup: (() => void) | undefined;
  private state: RuntimeRunControllerState = 'created';
  private terminalReserved = false;
  private terminalValue: RuntimeRunTerminal | undefined;
  private sequence = 0;
  private runOrdinal = 0;
  private activeTurnId: RuntimeTurnId | null = null;
  private lastTurnId: RuntimeTurnId;
  private readonly startMarkerId: RuntimeEntryId;
  private markerParentId: RuntimeEntryId | null;

  constructor(options: RuntimeRunControllerOptions) {
    this.sessionId = options.sessionId;
    this.runId = options.runId;
    this.defTurnId = options.defTurnId;
    this.now = options.now ?? (() => new Date().toISOString());
    this.lastTurnId = options.initialTurnId ?? asRuntimeTurnId(boundedId(`${options.runId}:turn:1`));
    this.startMarkerId = asRuntimeEntryId(boundedId(`${options.runId}:run-marker:start`));
    this.markerParentId = options.parentEntryId ?? null;
    this.signal = this.abortController.signal;

    for (const listener of options.listeners ?? []) this.listeners.add(listener);
    for (const listener of options.markerListeners ?? []) this.markerListeners.add(listener);

    if (options.signal) {
      const abortExternal = (): void => {
        this.abort(toAbortReason(options.signal?.reason));
      };
      if (options.signal.aborted) abortExternal();
      else {
        options.signal.addEventListener('abort', abortExternal, { once: true });
        this.externalAbortCleanup = () => options.signal?.removeEventListener('abort', abortExternal);
      }
    }
  }

  get status(): RuntimeRunControllerState {
    return this.state;
  }

  get terminal(): RuntimeRunTerminal | undefined {
    return this.terminalValue;
  }

  get events(): readonly RuntimeEvent[] {
    return this.emittedEvents.slice();
  }

  get runMarkers(): readonly RuntimeRunMarkerEntry[] {
    return this.emittedMarkers.slice();
  }

  get listenerErrors(): readonly unknown[] {
    return this.listenerFailures.slice();
  }

  subscribe(listener: RuntimeEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  subscribeRunMarkers(listener: RuntimeRunMarkerListener): () => void {
    this.markerListeners.add(listener);
    return () => this.markerListeners.delete(listener);
  }

  /** Request cancellation. The Agent loop owns the eventual `run.end`. */
  abort(reason: RuntimeAbortReason = { code: 'RUNTIME_ABORTED', message: 'Run aborted.' }): boolean {
    if (this.terminalReserved) return false;
    if (!this.abortController.signal.aborted) {
      this.abortController.abort({
        code: safeCode(reason.code, 'RUNTIME_ABORTED'),
        ...(reason.message === undefined ? {} : { message: safeMessage(reason.message) }),
      });
    }
    return true;
  }

  async start(): Promise<RuntimeEvent> {
    if (this.state !== 'created') {
      throw new RuntimeRunProtocolError('RUNTIME_RUN_START_DUPLICATE', 'Runtime run.start is not unique.');
    }
    this.state = 'running';
    await this.publishMarker('start');
    const event = this.allocateEvent({
      type: 'run.start',
      runId: this.runId,
      defTurnId: this.defTurnId,
    });
    await this.dispatch(event);
    return event;
  }

  async emit(draft: RuntimeEventDraft): Promise<RuntimeEvent> {
    if (this.state !== 'running' || this.terminalReserved) {
      throw new RuntimeRunProtocolError('RUNTIME_EVENT_AFTER_TERMINAL', 'Runtime event arrived after the run terminal.');
    }
    this.validateDraft(draft);
    const event = this.allocateEvent(draft);
    await this.dispatch(event);
    this.commitDraftState(draft);
    return event;
  }

  /** Publish the only run.end event, after all previous event listeners settle. */
  async finish(terminal: RuntimeRunTerminal): Promise<RuntimeEvent> {
    if (this.state !== 'running') {
      throw new RuntimeRunProtocolError('RUNTIME_RUN_NOT_RUNNING', 'Runtime run.end requires a running run.');
    }
    if (this.terminalReserved) {
      throw new RuntimeRunProtocolError('RUNTIME_TERMINAL_DUPLICATE', 'Runtime run terminal is not unique.');
    }
    if (this.activeTurnId !== null || this.toolStatesHasRunning()) {
      throw new RuntimeRunProtocolError('RUNTIME_RUN_OPEN_WORK', 'Runtime run cannot end with an open turn or Tool.');
    }

    this.terminalReserved = true;
    const safeTerminal = sanitizeTerminal(terminal);
    this.terminalValue = safeTerminal;
    await this.dispatchTail;
    await this.publishMarker('end', safeTerminal);
    const event = this.allocateEvent({
      type: 'run.end',
      runId: this.runId,
      defTurnId: this.defTurnId,
      terminal: safeTerminal,
    });
    await this.dispatch(event);
    this.state = 'terminal';
    this.externalAbortCleanup?.();
    this.externalAbortCleanup = undefined;
    return event;
  }

  dispose(): void {
    this.externalAbortCleanup?.();
    this.externalAbortCleanup = undefined;
  }

  async waitForIdle(): Promise<void> {
    await this.dispatchTail;
  }

  private allocateEvent(draft: RuntimeEventDraft): RuntimeEvent {
    this.sequence += 1;
    const runScoped = 'runId' in draft && draft.runId !== undefined;
    if (runScoped) this.runOrdinal += 1;
    return {
      ...draft,
      sessionId: this.sessionId,
      sequence: this.sequence,
      occurredAt: this.now(),
      ...(runScoped ? { runOrdinal: this.runOrdinal } : {}),
    } as RuntimeEvent;
  }

  private async dispatch(event: RuntimeEvent): Promise<void> {
    const previous = this.dispatchTail;
    let release!: () => void;
    this.dispatchTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      this.emittedEvents.push(event);
      const settlements = await Promise.allSettled(
        [...this.listeners].map((listener) => Promise.resolve().then(() => listener(event))),
      );
      for (const settlement of settlements) {
        if (settlement.status === 'rejected') this.listenerFailures.push(settlement.reason);
      }
    } finally {
      release();
    }
  }

  private async publishMarker(
    phase: 'start' | 'end',
    terminal?: RuntimeRunTerminal,
  ): Promise<void> {
    const id = phase === 'start'
      ? this.startMarkerId
      : asRuntimeEntryId(boundedId(`${this.runId}:run-marker:end`));
    const marker: RuntimeRunMarkerEntry = phase === 'start'
      ? {
          schemaVersion: 1,
          type: 'run-marker',
          id,
          parentId: this.markerParentId,
          createdAt: this.now(),
          phase,
          defTurnId: this.defTurnId,
          runId: this.runId,
          turnId: this.lastTurnId,
        }
      : {
          schemaVersion: 1,
          type: 'run-marker',
          id,
          parentId: this.markerParentId,
          createdAt: this.now(),
          phase,
          defTurnId: this.defTurnId,
          runId: this.runId,
          turnId: this.lastTurnId,
          terminal: terminal ?? { status: 'failed', code: 'RUNTIME_TERMINAL_MISSING', message: 'Run terminal missing.' },
        };
    this.emittedMarkers.push(marker);
    this.markerParentId = marker.id;
    const settlements = await Promise.allSettled(
      [...this.markerListeners].map((listener) => Promise.resolve().then(() => listener(marker))),
    );
    for (const settlement of settlements) {
      if (settlement.status === 'rejected') this.listenerFailures.push(settlement.reason);
    }
  }

  private validateDraft(draft: RuntimeEventDraft): void {
    if (draft.type === 'run.start' || draft.type === 'run.end') {
      throw new RuntimeRunProtocolError(
        'RUNTIME_TERMINAL_INTERNAL',
        'run.start and run.end are owned by RuntimeRunController.',
      );
    }

    if ('runId' in draft && draft.runId !== undefined && draft.runId !== this.runId) {
      throw new RuntimeRunProtocolError('RUNTIME_RUN_ID_CONFLICT', 'Runtime event changed runId.');
    }
    if ('defTurnId' in draft && draft.defTurnId !== undefined && draft.defTurnId !== this.defTurnId) {
      throw new RuntimeRunProtocolError('RUNTIME_DEF_TURN_ID_CONFLICT', 'Runtime event changed defTurnId.');
    }

    switch (draft.type) {
      case 'turn.start':
        if (this.activeTurnId !== null) {
          throw new RuntimeRunProtocolError('RUNTIME_TURN_DUPLICATE', 'Runtime turn.start arrived before turn.end.');
        }
        this.lastTurnId = draft.turnId;
        break;
      case 'turn.end':
        this.requireActiveTurn(draft.turnId);
        this.requireAssistantEnded(draft.assistantMessage);
        for (const messageId of draft.toolResultMessageIds) {
          if (this.messageStates.get(messageId) !== 'ended') {
            throw new RuntimeRunProtocolError('RUNTIME_TOOL_RESULT_OPEN', 'Runtime turn.end referenced an open Tool result.');
          }
        }
        if (this.toolStatesHasRunning()) {
          throw new RuntimeRunProtocolError('RUNTIME_TOOL_OPEN', 'Runtime turn.end arrived before Tool settlement.');
        }
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
        if (this.toolStates.has(draft.call.toolCallId)) {
          throw new RuntimeRunProtocolError('RUNTIME_TOOL_DUPLICATE', 'Runtime Tool call is not unique.');
        }
        break;
      case 'tool.update':
      case 'tool.end':
        this.requireActiveTurn(draft.turnId);
        if (this.toolStates.get(draft.toolCallId) !== 'running') {
          throw new RuntimeRunProtocolError('RUNTIME_TOOL_LATE_EVENT', 'Runtime Tool event arrived after settlement.');
        }
        break;
      case 'retry.scheduled':
      case 'retry.end':
        if (draft.runId !== this.runId) {
          throw new RuntimeRunProtocolError('RUNTIME_RUN_ID_CONFLICT', 'Runtime retry changed runId.');
        }
        break;
      case 'compaction.start':
      case 'compaction.end':
        break;
    }
  }

  private commitDraftState(draft: RuntimeEventDraft): void {
    switch (draft.type) {
      case 'turn.start':
        this.activeTurnId = draft.turnId;
        break;
      case 'turn.end':
        this.activeTurnId = null;
        break;
      case 'message.end':
        this.messageStates.set(draft.message.id, 'ended');
        break;
      case 'tool.start':
        this.toolStates.set(draft.call.toolCallId, 'running');
        break;
      case 'tool.end':
        this.toolStates.set(draft.toolCallId, 'ended');
        break;
      default:
        break;
    }
  }

  private validateMessageStart(message: RuntimeMessageStart, eventDefTurnId: DefTurnId): void {
    if (this.messageStates.has(message.id)) {
      throw new RuntimeRunProtocolError('RUNTIME_MESSAGE_DUPLICATE', 'Runtime message.start is not unique.');
    }
    if (message.role !== 'compaction' && message.defTurnId !== eventDefTurnId) {
      throw new RuntimeRunProtocolError('RUNTIME_MESSAGE_DEF_TURN_ID_CONFLICT', 'Runtime message changed defTurnId.');
    }
    this.messageTurns.set(message.id, message.role === 'compaction' ? eventDefTurnId : message.defTurnId);
    this.messageStates.set(message.id, 'open');
  }

  private validateMessageUpdate(messageId: RuntimeMessageId, eventDefTurnId: DefTurnId): void {
    if (this.messageStates.get(messageId) !== 'open' || this.messageTurns.get(messageId) !== eventDefTurnId) {
      throw new RuntimeRunProtocolError('RUNTIME_MESSAGE_LATE_EVENT', 'Runtime message.update arrived outside its message.');
    }
  }

  private validateMessageEnd(message: RuntimeMessage, eventDefTurnId: DefTurnId): void {
    if (this.messageStates.get(message.id) !== 'open' || this.messageTurns.get(message.id) !== eventDefTurnId) {
      throw new RuntimeRunProtocolError('RUNTIME_MESSAGE_LATE_EVENT', 'Runtime message.end arrived outside its message.');
    }
    if (message.role !== 'compaction' && message.defTurnId !== eventDefTurnId) {
      throw new RuntimeRunProtocolError('RUNTIME_MESSAGE_DEF_TURN_ID_CONFLICT', 'Runtime message.end changed defTurnId.');
    }
  }

  private requireActiveTurn(turnId: RuntimeTurnId): void {
    if (this.activeTurnId !== turnId) {
      throw new RuntimeRunProtocolError('RUNTIME_TURN_CORRELATION_CONFLICT', 'Runtime event arrived outside its active turn.');
    }
  }

  private requireAssistantEnded(message: RuntimeAssistantMessage): void {
    if (message.defTurnId !== this.defTurnId || this.messageStates.get(message.id) !== 'ended') {
      throw new RuntimeRunProtocolError('RUNTIME_ASSISTANT_NOT_SETTLED', 'Runtime turn.end referenced an unsettled assistant message.');
    }
  }

  private toolStatesHasRunning(): boolean {
    for (const state of this.toolStates.values()) if (state === 'running') return true;
    return false;
  }
}

export const RunController = RuntimeRunController;
export type RunController = RuntimeRunController;

export function createRunController(options: RuntimeRunControllerOptions): RuntimeRunController {
  return new RuntimeRunController(options);
}

function toAbortReason(value: unknown): RuntimeAbortReason {
  if (isRecord(value) && typeof value.code === 'string') {
    return {
      code: value.code,
      ...(typeof value.message === 'string' ? { message: value.message } : {}),
    };
  }
  return { code: 'RUNTIME_ABORTED', message: 'Run aborted.' };
}

function sanitizeTerminal(terminal: RuntimeRunTerminal): RuntimeRunTerminal {
  if (terminal.status === 'completed') return terminal;
  return {
    ...terminal,
    code: safeCode(terminal.code, terminal.status === 'aborted' ? 'RUNTIME_ABORTED' : 'RUNTIME_FAILED'),
    ...(terminal.message === undefined ? {} : { message: safeMessage(terminal.message) }),
  };
}

function safeCode(value: string, fallback: string): string {
  return /^[A-Za-z0-9._-]{1,128}$/u.test(value) ? value : fallback;
}

function safeMessage(value: string): string {
  const bounded = value.slice(0, 4_096);
  return bounded
    .replace(/authorization\s*:\s*\S+/giu, 'authorization: [redacted]')
    .replace(/bearer\s+[A-Za-z0-9._~+/=-]{8,}/giu, 'bearer [redacted]')
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/giu, '[redacted]')
    .replace(/((?:api[-_ ]?key|access[-_ ]?token|refresh[-_ ]?token|password|secret)\s*[:=])\s*[^\s,;]+/giu, '$1 [redacted]');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function boundedId(value: string): string {
  if (value.length <= 256) return value;
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  return `${value.slice(0, 224)}:${hash.toString(16)}`;
}
