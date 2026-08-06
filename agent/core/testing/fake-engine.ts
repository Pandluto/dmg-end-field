import {
  AgentEngineProtocolError,
  asEngineMessageId,
  asEngineSessionId,
  asEngineTurnId,
  canonicalJson,
  isEngineTerminalEvent,
  type AbortResult,
  type AgentEngine,
  type CompactionResult,
  type EngineAbortReason,
  type EngineEvent,
  type EngineHealth,
  type EngineInteractionResultInput,
  type EngineRecoveryResult,
  type EngineSessionCreateInput,
  type EngineSessionRef,
  type EngineTerminalEvent,
  type EngineToolProjectionInput,
  type EngineToolResultInput,
  type EngineTurnHandle,
  type EngineTurnInput,
  type EngineTurnRef,
  type InteractionId,
  type JsonObject,
  type JsonValue,
  type ToolCallId,
} from '../contracts/index.ts';

const FAKE_ENGINE_STORE_SCHEMA_VERSION = 1;

export type FakeEngineScriptStep =
  | {
      readonly type: 'text';
      readonly delta: string;
    }
  | {
      readonly type: 'tool';
      readonly toolCallId: ToolCallId;
      readonly name: string;
      readonly input: JsonValue;
    }
  | {
      readonly type: 'interaction';
      readonly interactionId: InteractionId;
      readonly interactionKind: 'question' | 'approval';
      readonly prompt: string;
      readonly payload?: JsonObject;
    }
  | {
      readonly type: 'projection';
      readonly revision: number;
    }
  | {
      readonly type: 'complete';
      readonly output?: JsonValue;
    }
  | {
      readonly type: 'fail';
      readonly code: string;
      readonly message: string;
    };

export type FakeEngineScript = readonly FakeEngineScriptStep[];

export interface FakeEngineTurnTrace {
  readonly ref: EngineTurnRef;
  readonly input: EngineTurnInput;
  readonly events: readonly EngineEvent[];
  readonly toolResults: readonly EngineToolResultInput[];
  readonly interactionResults: readonly EngineInteractionResultInput[];
  readonly toolProjections: readonly EngineToolProjectionInput[];
  readonly pending:
    | { readonly kind: 'tool'; readonly correlationId: ToolCallId }
    | { readonly kind: 'interaction'; readonly correlationId: InteractionId }
    | { readonly kind: 'projection'; readonly revision: number }
    | null;
  readonly terminal: EngineTerminalEvent | null;
}

type PendingInput =
  | {
      readonly kind: 'tool';
      readonly correlationId: ToolCallId;
      readonly resolve: () => void;
    }
  | {
      readonly kind: 'interaction';
      readonly correlationId: InteractionId;
      readonly interactionKind: 'question' | 'approval';
      readonly resolve: () => void;
    }
  | {
      readonly kind: 'projection';
      readonly revision: number;
      readonly resolve: () => void;
    };

type EngineEventInput<Event extends EngineEvent = EngineEvent> = Event extends EngineEvent
  ? Omit<Event, 'engineTurnId' | 'ordinal'>
  : never;

type EngineTerminalEventInput<Event extends EngineTerminalEvent = EngineTerminalEvent> =
  Event extends EngineTerminalEvent
    ? Omit<Event, 'engineTurnId' | 'ordinal'>
    : never;

class AsyncEventQueue<Value> implements AsyncIterable<Value> {
  readonly #values: Value[] = [];
  readonly #waiters: Array<(result: IteratorResult<Value>) => void> = [];
  #closed = false;

  push(value: Value): void {
    if (this.#closed) throw new Error('Cannot push to a closed event queue');
    const waiter = this.#waiters.shift();
    if (waiter) {
      waiter({ done: false, value });
      return;
    }
    this.#values.push(value);
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    for (const waiter of this.#waiters.splice(0)) waiter({ done: true, value: undefined });
  }

  [Symbol.asyncIterator](): AsyncIterator<Value> {
    return {
      next: async (): Promise<IteratorResult<Value>> => {
        const value = this.#values.shift();
        if (value !== undefined) return { done: false, value };
        if (this.#closed) return { done: true, value: undefined };
        return new Promise<IteratorResult<Value>>((resolve) => this.#waiters.push(resolve));
      },
    };
  }
}

function fingerprint(value: unknown): string {
  return canonicalJson(value as JsonValue);
}

function isValidInteractionResolution(
  kind: 'question' | 'approval',
  resolution: string,
): boolean {
  if (kind === 'question') {
    return ['answered', 'expired', 'cancelled', 'stale'].includes(resolution);
  }
  return ['approved', 'rejected', 'expired', 'cancelled', 'stale'].includes(resolution);
}

class FakeEngineTurnHandle implements EngineTurnHandle {
  readonly ref: EngineTurnRef;
  readonly events: AsyncIterable<EngineEvent>;

  readonly #input: EngineTurnInput;
  readonly #script: FakeEngineScript;
  readonly #queue = new AsyncEventQueue<EngineEvent>();
  readonly #traceEvents: EngineEvent[] = [];
  readonly #toolResults: EngineToolResultInput[] = [];
  readonly #interactionResults: EngineInteractionResultInput[] = [];
  readonly #toolProjections: EngineToolProjectionInput[] = [];
  readonly #acceptedToolResults = new Map<ToolCallId, string>();
  readonly #acceptedInteractionResults = new Map<InteractionId, string>();
  readonly #acceptedProjections = new Map<number, string>();
  readonly #nextMessageId: () => ReturnType<typeof asEngineMessageId>;
  #lastProjectionRevision: number;
  #pending: PendingInput | null = null;
  #terminal: EngineTerminalEvent | null = null;
  #ordinal = 0;

  constructor(
    ref: EngineTurnRef,
    input: EngineTurnInput,
    script: FakeEngineScript,
    nextMessageId: () => ReturnType<typeof asEngineMessageId>,
  ) {
    this.ref = ref;
    this.events = this.#queue;
    this.#input = input;
    this.#script = script;
    this.#lastProjectionRevision = input.toolProjection.revision;
    this.#nextMessageId = nextMessageId;
    void this.#runScript();
  }

  async submitToolResult(input: EngineToolResultInput): Promise<void> {
    const accepted = this.#acceptedToolResults.get(input.toolCallId);
    const nextFingerprint = fingerprint(input);
    if (accepted !== undefined) {
      if (accepted === nextFingerprint) return;
      throw new AgentEngineProtocolError(
        'ENGINE_CORRELATION_CONFLICT',
        `Tool result ${input.toolCallId} was already submitted with another payload`,
      );
    }
    this.#assertActive();
    if (this.#pending?.kind !== 'tool' || this.#pending.correlationId !== input.toolCallId) {
      throw new AgentEngineProtocolError(
        'ENGINE_INPUT_UNEXPECTED',
        `Turn is not waiting for tool result ${input.toolCallId}`,
      );
    }

    this.#acceptedToolResults.set(input.toolCallId, nextFingerprint);
    this.#toolResults.push(input);
    const pending = this.#pending;
    this.#pending = null;
    pending.resolve();
  }

  async submitToolResultAndUpdateProjection(
    input: EngineToolResultInput,
    projection: EngineToolProjectionInput,
  ): Promise<void> {
    const resultFingerprint = fingerprint(input);
    const projectionFingerprint = fingerprint(projection);
    const acceptedResult = this.#acceptedToolResults.get(input.toolCallId);
    const acceptedProjection = this.#acceptedProjections.get(projection.revision);
    if (acceptedResult !== undefined || acceptedProjection !== undefined) {
      if (
        acceptedResult === resultFingerprint
        && acceptedProjection === projectionFingerprint
      ) return;
      throw new AgentEngineProtocolError(
        'ENGINE_CORRELATION_CONFLICT',
        `Atomic Tool result/projection was already partially or differently submitted for ${input.toolCallId}`,
      );
    }
    this.#assertActive();
    if (this.#pending?.kind !== 'tool' || this.#pending.correlationId !== input.toolCallId) {
      throw new AgentEngineProtocolError(
        'ENGINE_INPUT_UNEXPECTED',
        `Turn is not waiting for atomic tool result ${input.toolCallId}`,
      );
    }
    if (projection.revision <= this.#lastProjectionRevision) {
      throw new AgentEngineProtocolError(
        'ENGINE_PROJECTION_STALE',
        `Tool projection revision ${projection.revision} must be greater than ${this.#lastProjectionRevision}`,
      );
    }

    this.#acceptedToolResults.set(input.toolCallId, resultFingerprint);
    this.#toolResults.push(input);
    this.#acceptedProjections.set(projection.revision, projectionFingerprint);
    this.#toolProjections.push(projection);
    this.#lastProjectionRevision = projection.revision;
    const pending = this.#pending;
    this.#pending = null;
    this.#emit({ type: 'tool-projection.applied', revision: projection.revision });
    pending.resolve();
    // Let the script consume a pre-applied projection and, when applicable,
    // emit an eager terminal before the atomic Host call resolves.
    await Promise.resolve();
    await Promise.resolve();
  }

  async submitInteractionResult(input: EngineInteractionResultInput): Promise<void> {
    const accepted = this.#acceptedInteractionResults.get(input.interactionId);
    const nextFingerprint = fingerprint(input);
    if (accepted !== undefined) {
      if (accepted === nextFingerprint) return;
      throw new AgentEngineProtocolError(
        'ENGINE_CORRELATION_CONFLICT',
        `Interaction ${input.interactionId} was already resolved with another payload`,
      );
    }
    this.#assertActive();
    if (this.#pending?.kind !== 'interaction' || this.#pending.correlationId !== input.interactionId) {
      throw new AgentEngineProtocolError(
        'ENGINE_INPUT_UNEXPECTED',
        `Turn is not waiting for interaction ${input.interactionId}`,
      );
    }
    if (this.#pending.interactionKind !== input.interactionKind) {
      throw new AgentEngineProtocolError(
        'ENGINE_INTERACTION_KIND_MISMATCH',
        `Interaction ${input.interactionId} expects ${this.#pending.interactionKind}, not ${input.interactionKind}`,
      );
    }
    if (!isValidInteractionResolution(input.interactionKind, input.resolution)) {
      throw new AgentEngineProtocolError(
        'ENGINE_INTERACTION_RESOLUTION_INVALID',
        `Resolution ${input.resolution} is invalid for ${input.interactionKind}`,
      );
    }

    this.#acceptedInteractionResults.set(input.interactionId, nextFingerprint);
    this.#interactionResults.push(input);
    const pending = this.#pending;
    this.#pending = null;
    pending.resolve();
  }

  async updateToolProjection(input: EngineToolProjectionInput): Promise<void> {
    const accepted = this.#acceptedProjections.get(input.revision);
    const nextFingerprint = fingerprint(input);
    if (accepted !== undefined) {
      if (accepted === nextFingerprint) return;
      throw new AgentEngineProtocolError(
        'ENGINE_CORRELATION_CONFLICT',
        `Tool projection ${input.revision} was already submitted with another payload`,
      );
    }
    this.#assertActive();
    if (input.revision <= this.#lastProjectionRevision) {
      throw new AgentEngineProtocolError(
        'ENGINE_PROJECTION_STALE',
        `Tool projection revision ${input.revision} must be greater than ${this.#lastProjectionRevision}`,
      );
    }
    if (this.#pending?.kind !== 'projection' || this.#pending.revision !== input.revision) {
      throw new AgentEngineProtocolError(
        'ENGINE_INPUT_UNEXPECTED',
        `Turn is not waiting for tool projection ${input.revision}`,
      );
    }

    this.#acceptedProjections.set(input.revision, nextFingerprint);
    this.#toolProjections.push(input);
    this.#lastProjectionRevision = input.revision;
    const pending = this.#pending;
    this.#pending = null;
    this.#emit({ type: 'tool-projection.applied', revision: input.revision });
    pending.resolve();
  }

  async abort(reason: EngineAbortReason): Promise<AbortResult> {
    if (this.#terminal) {
      return { status: 'already-terminal', terminalType: this.#terminal.type };
    }

    const pending = this.#pending;
    this.#pending = null;
    this.#finish({ type: 'turn.aborted', reason });
    pending?.resolve();
    return { status: 'aborted', terminalType: 'turn.aborted' };
  }

  getTrace(): FakeEngineTurnTrace {
    const pending = this.#pending;
    let publicPending: FakeEngineTurnTrace['pending'] = null;
    if (pending?.kind === 'projection') {
      publicPending = { kind: 'projection', revision: pending.revision };
    } else if (pending?.kind === 'tool') {
      publicPending = { kind: 'tool', correlationId: pending.correlationId };
    } else if (pending?.kind === 'interaction') {
      publicPending = { kind: 'interaction', correlationId: pending.correlationId };
    }

    return {
      ref: this.ref,
      input: this.#input,
      events: [...this.#traceEvents],
      toolResults: [...this.#toolResults],
      interactionResults: [...this.#interactionResults],
      toolProjections: [...this.#toolProjections],
      pending: publicPending,
      terminal: this.#terminal,
    };
  }

  async #runScript(): Promise<void> {
    try {
      for (const step of this.#script) {
        if (this.#terminal) return;
        if (step.type === 'text') {
          this.#emit({
            type: 'response.delta',
            messageId: this.#nextMessageId(),
            delta: step.delta,
          });
          continue;
        }
        if (step.type === 'tool') {
          this.#emit({
            type: 'tool.requested',
            toolCallId: step.toolCallId,
            name: step.name,
            input: step.input,
          });
          await this.#waitFor({ kind: 'tool', correlationId: step.toolCallId });
          continue;
        }
        if (step.type === 'interaction') {
          this.#emit({
            type: 'interaction.requested',
            interactionId: step.interactionId,
            interactionKind: step.interactionKind,
            prompt: step.prompt,
            payload: step.payload,
          });
          await this.#waitFor({
            kind: 'interaction',
            correlationId: step.interactionId,
            interactionKind: step.interactionKind,
          });
          continue;
        }
        if (step.type === 'projection') {
          await this.#waitFor({ kind: 'projection', revision: step.revision });
          continue;
        }
        if (step.type === 'complete') {
          this.#finish({ type: 'turn.completed', output: step.output });
          return;
        }
        this.#finish({ type: 'turn.failed', code: step.code, message: step.message });
        return;
      }

      if (!this.#terminal) this.#finish({ type: 'turn.completed' });
    } catch (error) {
      if (this.#terminal) return;
      this.#finish({
        type: 'turn.failed',
        code: 'FAKE_ENGINE_SCRIPT_ERROR',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  #waitFor(
    pending:
      | { readonly kind: 'tool'; readonly correlationId: ToolCallId }
      | {
          readonly kind: 'interaction';
          readonly correlationId: InteractionId;
          readonly interactionKind: 'question' | 'approval';
        }
      | { readonly kind: 'projection'; readonly revision: number },
  ): Promise<void> {
    if (this.#terminal) return Promise.resolve();
    if (
      pending.kind === 'projection'
      && this.#acceptedProjections.has(pending.revision)
    ) return Promise.resolve();
    if (this.#pending) throw new Error('Fake Engine script attempted to wait for two inputs');
    return new Promise<void>((resolve) => {
      this.#pending = { ...pending, resolve } as PendingInput;
    });
  }

  #emit(event: EngineEventInput): void {
    if (this.#terminal) {
      throw new AgentEngineProtocolError('ENGINE_TURN_TERMINAL', `Turn ${this.ref.turnId} is already terminal`);
    }
    const fullEvent = {
      ...event,
      engineTurnId: this.ref.turnId,
      ordinal: ++this.#ordinal,
    } as EngineEvent;
    this.#traceEvents.push(fullEvent);
    this.#queue.push(fullEvent);
  }

  #finish(event: EngineTerminalEventInput): void {
    if (this.#terminal) return;
    this.#emit(event);
    const terminal = this.#traceEvents.at(-1);
    if (!terminal || !isEngineTerminalEvent(terminal)) throw new Error('Terminal event projection failed');
    this.#terminal = terminal;
    this.#queue.close();
  }

  #assertActive(): void {
    if (this.#terminal) {
      throw new AgentEngineProtocolError('ENGINE_TURN_TERMINAL', `Turn ${this.ref.turnId} is already terminal`);
    }
  }
}

export class DeterministicFakeAgentEngine implements AgentEngine {
  readonly kind = 'fake';
  readonly #runtimeVersion: string;
  readonly #scripts: FakeEngineScript[] = [];
  readonly #sessions = new Map<string, EngineSessionRef>();
  readonly #turns = new Map<string, FakeEngineTurnHandle>();
  #sessionCounter = 0;
  #turnCounter = 0;
  #messageCounter = 0;
  #compactionCounter = 0;
  #shutdown = false;

  constructor(options: { readonly runtimeVersion?: string } = {}) {
    this.#runtimeVersion = options.runtimeVersion ?? 'fake-1';
  }

  enqueueScript(script: FakeEngineScript): void {
    this.#assertRunning();
    this.#scripts.push([...script]);
  }

  async probe(): Promise<EngineHealth> {
    if (this.#shutdown) {
      return {
        status: 'unavailable',
        kind: this.kind,
        code: 'ENGINE_SHUTDOWN',
        message: 'Fake Engine is shut down',
      };
    }
    return { status: 'ready', kind: this.kind, runtimeVersion: this.#runtimeVersion };
  }

  async createSession(_input: EngineSessionCreateInput): Promise<EngineSessionRef> {
    this.#assertRunning();
    const ref: EngineSessionRef = {
      kind: this.kind,
      sessionId: asEngineSessionId(`fake-session-${++this.#sessionCounter}`),
      runtimeVersion: this.#runtimeVersion,
      storeSchemaVersion: FAKE_ENGINE_STORE_SCHEMA_VERSION,
    };
    this.#sessions.set(ref.sessionId, ref);
    return ref;
  }

  async recoverSession(ref: EngineSessionRef): Promise<EngineRecoveryResult> {
    this.#assertRunning();
    if (!this.#supportsSessionRef(ref)) {
      return {
        status: 'incompatible',
        code: 'ENGINE_SESSION_INCOMPATIBLE',
        message: this.#incompatibleSessionMessage(ref),
      };
    }
    const session = this.#sessions.get(ref.sessionId);
    return session ? { status: 'recovered', ref: session } : { status: 'missing' };
  }

  async startTurn(input: EngineTurnInput): Promise<EngineTurnHandle> {
    this.#assertRunning();
    const session = this.#sessions.get(input.engineSession.sessionId);
    if (!session) {
      throw new AgentEngineProtocolError(
        'ENGINE_SESSION_NOT_FOUND',
        `Engine session ${input.engineSession.sessionId} does not exist`,
      );
    }
    if (!this.#supportsSessionRef(input.engineSession)) {
      throw new AgentEngineProtocolError(
        'ENGINE_SESSION_INCOMPATIBLE',
        this.#incompatibleSessionMessage(input.engineSession),
      );
    }

    const ref: EngineTurnRef = {
      session,
      turnId: asEngineTurnId(`fake-turn-${++this.#turnCounter}`),
    };
    const script = this.#scripts.shift() ?? [{ type: 'complete' }];
    const handle = new FakeEngineTurnHandle(
      ref,
      input,
      script,
      () => asEngineMessageId(`fake-message-${++this.#messageCounter}`),
    );
    this.#turns.set(ref.turnId, handle);
    return handle;
  }

  async compact(ref: EngineSessionRef): Promise<CompactionResult> {
    this.#assertSession(ref);
    return {
      status: 'compacted',
      summaryRef: `fake-compaction-${++this.#compactionCounter}`,
    };
  }

  async disposeSession(ref: EngineSessionRef): Promise<void> {
    const session = this.#sessions.get(ref.sessionId);
    if (!session) return;
    if (!this.#supportsSessionRef(ref)) {
      throw new AgentEngineProtocolError(
        'ENGINE_SESSION_INCOMPATIBLE',
        this.#incompatibleSessionMessage(ref),
      );
    }
    const activeTurns = [...this.#turns.values()].filter((turn) => (
      turn.ref.session.sessionId === session.sessionId && !turn.getTrace().terminal
    ));
    await Promise.all(activeTurns.map((turn) => turn.abort({ code: 'SESSION_DISPOSED' })));
    this.#sessions.delete(ref.sessionId);
  }

  async shutdown(): Promise<void> {
    if (this.#shutdown) return;
    this.#shutdown = true;
    const activeTurns = [...this.#turns.values()].filter((turn) => !turn.getTrace().terminal);
    await Promise.all(activeTurns.map((turn) => turn.abort({ code: 'ENGINE_SHUTDOWN' })));
    this.#sessions.clear();
    this.#scripts.length = 0;
  }

  getTurnTrace(ref: EngineTurnRef): FakeEngineTurnTrace | null {
    return this.#turns.get(ref.turnId)?.getTrace() ?? null;
  }

  #assertSession(ref: EngineSessionRef): void {
    this.#assertRunning();
    const session = this.#sessions.get(ref.sessionId);
    if (!session) {
      throw new AgentEngineProtocolError(
        'ENGINE_SESSION_NOT_FOUND',
        `Engine session ${ref.sessionId} does not exist`,
      );
    }
    if (!this.#supportsSessionRef(ref)) {
      throw new AgentEngineProtocolError(
        'ENGINE_SESSION_INCOMPATIBLE',
        this.#incompatibleSessionMessage(ref),
      );
    }
  }

  #supportsSessionRef(ref: EngineSessionRef): boolean {
    return ref.kind === this.kind
      && ref.runtimeVersion === this.#runtimeVersion
      && ref.storeSchemaVersion === FAKE_ENGINE_STORE_SCHEMA_VERSION;
  }

  #incompatibleSessionMessage(ref: EngineSessionRef): string {
    return `Fake Engine cannot use ${ref.kind}@${ref.runtimeVersion}/schema-${ref.storeSchemaVersion}`;
  }

  #assertRunning(): void {
    if (this.#shutdown) {
      throw new AgentEngineProtocolError('ENGINE_SHUTDOWN', 'Fake Engine is shut down');
    }
  }
}
