import {
  DEF_EVENT_SCHEMA_VERSION,
  DEF_AGENT_IN_MEMORY_LIMITS,
  DEF_SESSION_SCHEMA_VERSION,
  asClientTurnId,
  asCommandId,
  asDefSessionId,
  asDefTurnId,
  type AgentEngine,
  type ClientTurnId,
  type DefEvent,
  type DefHarnessTraceEntry,
  type DefSessionId,
  type DefSessionV6,
  type DefTurnId,
  type EngineEvent,
  type EngineInteractionResultInput,
  type EngineToolProjectionInput,
  type EngineTurnHandle,
  type JsonObject,
  type JsonValue,
  type Phase2ProductOperationSchema,
  type ProductBinding,
  type ProductCommandEnvelope,
  type ProductGateway,
} from '../core/contracts/index.ts';
import { DefHarnessError, DefHarnessManager } from '../core/harness/manager.ts';
import { DefReadToolRegistry } from '../core/tools/read-only-workbench.ts';
import { DefToolExecutionError } from '../core/contracts/tool.ts';
import { DefAgentHostError } from './errors.ts';

type DefEventInput<Type extends DefEvent['type']> = Type extends DefEvent['type']
  ? Omit<
    Extract<DefEvent, { type: Type }>,
    'schemaVersion' | 'sequence' | 'occurredAt' | 'defSessionId'
  >
  : never;

type SessionRecord = {
  session: DefSessionV6;
  binding: ProductBinding;
  providerProfileRef: string;
  sequence: number;
  eventCodeUnits: number;
  acceptedTurns: number;
  events: DefEvent[];
  clientTurns: Map<ClientTurnId, ClientTurnRecord>;
};

type ClientTurnRecord = {
  readonly userMessage: string;
} & (
  | { readonly state: 'pending'; readonly promise: Promise<TurnStartResult> }
  | { readonly state: 'accepted'; readonly result: TurnStartResult }
);

type TurnStartResult = {
  readonly defTurnId: DefTurnId;
  readonly clientTurnId: ClientTurnId;
};

type StartingTurn = {
  readonly session: SessionRecord;
  readonly defTurnId: DefTurnId;
  abortCode: string | null;
};

type ActiveTurn = {
  readonly session: SessionRecord;
  readonly defTurnId: DefTurnId;
  readonly handle: EngineTurnHandle;
  readonly harnessTransactionId: string | null;
  readonly abortController: AbortController;
  readonly terminal: Promise<DefEvent>;
  readonly cancelled: Promise<void>;
  readonly eventStartCount: number;
  readonly eventStartCodeUnits: number;
  resolveTerminal: (event: DefEvent) => void;
  resolveCancelled: () => void;
  protocolTail: Promise<void>;
  abortRequested: boolean;
  settled: boolean;
};

type SettledTurn = {
  readonly session: SessionRecord;
  readonly terminal: DefEvent;
};

type IdFactory = {
  readonly session: () => DefSessionId;
  readonly turn: () => DefTurnId;
  readonly clientTurn: () => ClientTurnId;
};

export class DefAgentHost {
  readonly #engine: AgentEngine;
  readonly #productGateway: ProductGateway<Phase2ProductOperationSchema>;
  readonly #harnessManager: DefHarnessManager | null;
  readonly #toolRegistry: DefReadToolRegistry | null;
  readonly #requireConsumer: () => void;
  readonly #clock: () => number;
  readonly #ids: IdFactory;
  readonly #sessions = new Map<DefSessionId, SessionRecord>();
  readonly #turns = new Map<DefTurnId, ActiveTurn>();
  readonly #settledTurns = new Map<DefTurnId, SettledTurn>();
  #activeTurn: ActiveTurn | null = null;
  #startingTurn: StartingTurn | null = null;
  #activeSessionId: DefSessionId | null = null;
  #shutdown = false;

  constructor(options: {
    readonly engine: AgentEngine;
    readonly productGateway: ProductGateway<Phase2ProductOperationSchema>;
    readonly requireConsumer: () => void;
    readonly harnessManager?: DefHarnessManager;
    readonly toolRegistry?: DefReadToolRegistry;
    readonly clock?: () => number;
    readonly ids?: Partial<IdFactory>;
  }) {
    this.#engine = options.engine;
    this.#productGateway = options.productGateway;
    if (Boolean(options.harnessManager) !== Boolean(options.toolRegistry)) {
      throw new Error('DefAgentHost requires Harness Manager and Tool Registry together');
    }
    this.#harnessManager = options.harnessManager ?? null;
    this.#toolRegistry = options.toolRegistry ?? null;
    this.#requireConsumer = options.requireConsumer;
    this.#clock = options.clock ?? Date.now;
    let sessionSequence = 0;
    let turnSequence = 0;
    let clientTurnSequence = 0;
    this.#ids = {
      session: options.ids?.session ?? (() => asDefSessionId(`def-session-${++sessionSequence}`)),
      turn: options.ids?.turn ?? (() => asDefTurnId(`def-turn-${++turnSequence}`)),
      clientTurn: options.ids?.clientTurn ?? (() => asClientTurnId(`client-turn-${++clientTurnSequence}`)),
    };
  }

  async createSession(input: {
    readonly binding: ProductBinding;
    readonly providerProfileRef: string;
  }): Promise<DefSessionV6> {
    this.#assertRunning();
    this.#requireConsumer();
    if (this.#sessions.size >= DEF_AGENT_IN_MEMORY_LIMITS.maxSessionsPerHost) {
      throw new DefAgentHostError(
        'AGENT_SESSION_LIMIT_REACHED',
        `This Agent Host keeps at most ${DEF_AGENT_IN_MEMORY_LIMITS.maxSessionsPerHost} in-memory Sessions`,
      );
    }
    const defSessionId = this.#ids.session();
    const engine = await this.#engine.createSession({
      defSessionId,
      providerProfileRef: input.providerProfileRef,
      metadata: {
        workspaceId: input.binding.workspaceId,
        databaseGeneration: input.binding.databaseGeneration,
        timelineId: input.binding.timelineId,
      },
    });
    const now = new Date(this.#clock()).toISOString();
    const session: DefSessionV6 = {
      schemaVersion: DEF_SESSION_SCHEMA_VERSION,
      eventSchemaVersion: DEF_EVENT_SCHEMA_VERSION,
      defSessionId,
      host: 'workbench',
      status: 'ready',
      workspaceId: input.binding.workspaceId,
      lastDatabaseGeneration: input.binding.databaseGeneration,
      timelineId: input.binding.timelineId,
      axisBindingId: null,
      boundNodeId: input.binding.checkoutTargetId,
      engine,
      harness: {
        stateVersion: 1,
        revision: this.#harnessManager?.catalogRevision ?? 'phase2-browser-product-gateway',
      },
      createdAt: now,
      updatedAt: now,
    };
    const record: SessionRecord = {
      session,
      binding: input.binding,
      providerProfileRef: input.providerProfileRef,
      sequence: 0,
      eventCodeUnits: 0,
      acceptedTurns: 0,
      events: [],
      clientTurns: new Map(),
    };
    this.#sessions.set(defSessionId, record);
    this.#activeSessionId = defSessionId;
    this.#append(record, {
      type: 'session.ready',
      payload: {
        engineKind: engine.kind,
        engineRuntimeVersion: engine.runtimeVersion,
      },
    });
    return session;
  }

  async startTurn(input: {
    readonly defSessionId: DefSessionId;
    readonly userMessage: string;
    readonly systemContext: string;
    readonly toolProjection: EngineToolProjectionInput;
    readonly clientTurnId?: ClientTurnId;
  }): Promise<{ readonly defTurnId: DefTurnId; readonly clientTurnId: ClientTurnId }> {
    this.#assertRunning();
    this.#requireConsumer();
    this.#assertTurnAvailable();
    const record = this.#sessions.get(input.defSessionId);
    if (!record) {
      throw new DefAgentHostError('AGENT_SESSION_NOT_FOUND', `DEF Session ${input.defSessionId} does not exist`, 404);
    }
    this.#assertSessionCanStartTurn(record, input.userMessage);
    const defTurnId = this.#ids.turn();
    const clientTurnId = input.clientTurnId ?? this.#ids.clientTurn();
    const starting = this.#beginStartingTurn(record, defTurnId);
    try {
      const handle = await this.#engine.startTurn({
        engineSession: record.session.engine,
        defSessionId: record.session.defSessionId,
        defTurnId,
        clientTurnId,
        systemContext: input.systemContext,
        userMessage: input.userMessage,
        providerProfileRef: record.providerProfileRef,
        toolProjection: input.toolProjection,
        context: bindingContext(record.binding),
      });
      const cancellation = this.#startingTurnCancellation(starting);
      if (cancellation) {
        await handle.abort({ code: cancellation.code }).catch(() => undefined);
        throw cancellation.error;
      }
      this.#startingTurn = null;
      this.#activeSessionId = record.session.defSessionId;
      this.#touchSession(record);
      try {
        this.#append(record, {
          type: 'turn.accepted',
          defTurnId,
          payload: { clientTurnId, userMessage: input.userMessage },
        });
      } catch (error) {
        await handle.abort({ code: 'AGENT_EVENT_CAPACITY_REACHED' }).catch(() => undefined);
        throw error;
      }
      record.acceptedTurns += 1;
      const active = this.#createActiveTurn(record, defTurnId, handle, null);
      void this.#pump(active);
      return { defTurnId, clientTurnId };
    } finally {
      if (this.#startingTurn === starting) this.#startingTurn = null;
    }
  }

  async startHarnessTurn(input: {
    readonly defSessionId: DefSessionId;
    readonly userMessage: string;
    readonly clientTurnId?: ClientTurnId;
    readonly binding?: ProductBinding;
  }): Promise<TurnStartResult> {
    this.#assertRunning();
    this.#requireConsumer();
    const harnessManager = this.#requireHarnessManager();
    this.#requireToolRegistry();
    const record = this.#sessions.get(input.defSessionId);
    if (!record) {
      throw new DefAgentHostError('AGENT_SESSION_NOT_FOUND', `DEF Session ${input.defSessionId} does not exist`, 404);
    }
    if (input.binding) {
      assertStableSessionBinding(record.session, input.binding);
    }
    const clientTurnId = input.clientTurnId ?? this.#ids.clientTurn();
    const previous = record.clientTurns.get(clientTurnId);
    if (previous) {
      if (previous.userMessage !== input.userMessage) {
        throw new DefAgentHostError(
          'AGENT_CLIENT_TURN_CONFLICT',
          `Client Turn ${clientTurnId} was already used with another message`,
          409,
        );
      }
      return previous.state === 'pending' ? previous.promise : previous.result;
    }
    this.#assertTurnAvailable();
    this.#assertSessionCanStartTurn(record, input.userMessage);
    if (input.binding) record.binding = input.binding;
    const promise = this.#startHarnessTurn(record, harnessManager, {
      clientTurnId,
      userMessage: input.userMessage,
    });
    record.clientTurns.set(clientTurnId, {
      userMessage: input.userMessage,
      state: 'pending',
      promise,
    });
    try {
      const result = await promise;
      const current = record.clientTurns.get(clientTurnId);
      if (current?.state === 'pending' && current.promise === promise) {
        record.clientTurns.set(clientTurnId, {
          userMessage: input.userMessage,
          state: 'accepted',
          result,
        });
      }
      return result;
    } catch (error) {
      const current = record.clientTurns.get(clientTurnId);
      if (current?.state === 'pending' && current.promise === promise) {
        record.clientTurns.delete(clientTurnId);
      }
      throw error;
    }
  }

  async #startHarnessTurn(
    record: SessionRecord,
    harnessManager: DefHarnessManager,
    input: { readonly clientTurnId: ClientTurnId; readonly userMessage: string },
  ): Promise<TurnStartResult> {
    const defTurnId = this.#ids.turn();
    const starting = this.#beginStartingTurn(record, defTurnId);
    try {
      const started = harnessManager.beginTurn({
        defSessionId: record.session.defSessionId,
        defTurnId,
      });
      let handle: EngineTurnHandle;
      try {
        handle = await this.#engine.startTurn({
          engineSession: record.session.engine,
          defSessionId: record.session.defSessionId,
          defTurnId,
          clientTurnId: input.clientTurnId,
          systemContext: harnessManager.buildRoutingSystemContext(),
          userMessage: input.userMessage,
          providerProfileRef: record.providerProfileRef,
          toolProjection: started.transaction.projection,
          context: bindingContext(record.binding),
        });
        const cancellation = this.#startingTurnCancellation(starting);
        if (cancellation) {
          await handle.abort({ code: cancellation.code }).catch(() => undefined);
          throw cancellation.error;
        }
      } catch (error) {
        harnessManager.abort(
          started.transaction.transactionId,
          starting.abortCode ?? 'ENGINE_START_FAILED',
        );
        throw error;
      }
      this.#startingTurn = null;
      this.#activeSessionId = record.session.defSessionId;
      this.#touchSession(record);
      try {
        this.#append(record, {
          type: 'turn.accepted',
          defTurnId,
          payload: { clientTurnId: input.clientTurnId, userMessage: input.userMessage },
        });
      } catch (error) {
        harnessManager.abort(started.transaction.transactionId, 'AGENT_EVENT_CAPACITY_REACHED');
        await handle.abort({ code: 'AGENT_EVENT_CAPACITY_REACHED' }).catch(() => undefined);
        throw error;
      }
      record.acceptedTurns += 1;
      const active = this.#createActiveTurn(
        record,
        defTurnId,
        handle,
        started.transaction.transactionId,
      );
      this.#appendHarnessTrace(active, started.trace);
      void this.#pump(active);
      return { defTurnId, clientTurnId: input.clientTurnId };
    } finally {
      if (this.#startingTurn === starting) this.#startingTurn = null;
    }
  }

  #createActiveTurn(
    record: SessionRecord,
    defTurnId: DefTurnId,
    handle: EngineTurnHandle,
    harnessTransactionId: string | null,
  ): ActiveTurn {
    let resolveTerminal!: (event: DefEvent) => void;
    let resolveCancelled!: () => void;
    const terminal = new Promise<DefEvent>((resolve) => {
      resolveTerminal = resolve;
    });
    const cancelled = new Promise<void>((resolve) => {
      resolveCancelled = resolve;
    });
    const active: ActiveTurn = {
      session: record,
      defTurnId,
      handle,
      harnessTransactionId,
      abortController: new AbortController(),
      terminal,
      cancelled,
      eventStartCount: record.events.length,
      eventStartCodeUnits: record.eventCodeUnits,
      resolveTerminal,
      resolveCancelled,
      protocolTail: Promise.resolve(),
      abortRequested: false,
      settled: false,
    };
    this.#activeTurn = active;
    this.#turns.set(defTurnId, active);
    return active;
  }

  async respondInteraction(
    defTurnId: DefTurnId,
    input: EngineInteractionResultInput,
  ): Promise<void> {
    const active = this.#turns.get(defTurnId);
    if (!active || this.#activeTurn !== active) {
      throw new DefAgentHostError('AGENT_TURN_NOT_FOUND', `Active DEF Turn ${defTurnId} does not exist`, 404);
    }
    await this.#withTurnProtocolLock(active, async () => {
      if (active.settled || active.abortRequested) {
        throw new DefAgentHostError('AGENT_TURN_NOT_FOUND', `Active DEF Turn ${defTurnId} is stopping`, 404);
      }
      await active.handle.submitInteractionResult(input);
      this.#append(active.session, {
        type: 'interaction.resolved',
        defTurnId,
        interactionId: input.interactionId,
        payload: { status: input.resolution, ...('value' in input ? { value: input.value } : {}) },
      });
    });
  }

  async abortTurn(
    defTurnId: DefTurnId,
    code = 'USER_STOPPED',
    binding?: ProductBinding,
  ): Promise<void> {
    const starting = this.#startingTurn;
    if (starting?.defTurnId === defTurnId) {
      if (binding) assertStableSessionBinding(starting.session.session, binding);
      starting.abortCode ??= code;
      return;
    }
    const active = this.#turns.get(defTurnId);
    if (!active) {
      const settled = this.#settledTurns.get(defTurnId);
      if (settled) {
        if (binding) assertStableSessionBinding(settled.session.session, binding);
        return;
      }
      throw new DefAgentHostError('AGENT_TURN_NOT_FOUND', `Active DEF Turn ${defTurnId} does not exist`, 404);
    }
    if (binding) assertStableSessionBinding(active.session.session, binding);
    if (active.settled) return;
    if (this.#activeTurn !== active) {
      throw new DefAgentHostError('AGENT_TURN_NOT_FOUND', `Active DEF Turn ${defTurnId} does not exist`, 404);
    }
    active.abortRequested = true;
    active.abortController.abort();
    await this.#withTurnProtocolLock(active, async () => {
      if (active.settled) return;
      if (active.harnessTransactionId) {
        const transition = this.#requireHarnessManager().abort(active.harnessTransactionId, code);
        this.#appendHarnessTrace(active, transition.trace);
      }
      const result = await active.handle.abort({ code });
      if (result.status === 'aborted' && !active.settled) {
        this.#settle(active, this.#append(active.session, {
          type: 'turn.stopped',
          defTurnId: active.defTurnId,
          payload: { code },
        }));
      }
    });
  }

  waitForTurnTerminal(defTurnId: DefTurnId): Promise<DefEvent> {
    const turn = this.#turns.get(defTurnId);
    if (turn) return turn.terminal;
    const settled = this.#settledTurns.get(defTurnId);
    if (!settled) {
      return Promise.reject(new DefAgentHostError(
        'AGENT_TURN_NOT_FOUND',
        `DEF Turn ${defTurnId} does not exist`,
        404,
      ));
    }
    return Promise.resolve(settled.terminal);
  }

  listSessions(binding?: ProductBinding): readonly DefSessionV6[] {
    return [...this.#sessions.values()]
      .filter((record) => !binding || stableSessionBindingMatches(record.session, binding))
      .map((record) => cloneSession(record.session))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  readSession(defSessionId: DefSessionId, binding?: ProductBinding): DefSessionV6 {
    const record = this.#requireSession(defSessionId);
    if (binding) assertStableSessionBinding(record.session, binding);
    return cloneSession(record.session);
  }

  readEvents(
    defSessionId: DefSessionId,
    afterSequence = 0,
    limit = 256,
    binding?: ProductBinding,
  ): readonly DefEvent[] {
    const record = this.#requireSession(defSessionId);
    if (binding) assertStableSessionBinding(record.session, binding);
    if (!Number.isSafeInteger(afterSequence) || afterSequence < 0 || afterSequence > record.sequence) {
      throw new DefAgentHostError('AGENT_EVENT_CURSOR_INVALID', 'Event cursor is outside this Session journal', 400);
    }
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 256) {
      throw new DefAgentHostError('AGENT_EVENT_LIMIT_INVALID', 'Event page limit must be between 1 and 256', 400);
    }
    return record.events
      .filter((event) => event.sequence > afterSequence)
      .slice(0, limit);
  }

  getActiveIds(): { readonly defSessionId: DefSessionId | null; readonly defTurnId: DefTurnId | null } {
    return {
      defSessionId: this.#activeTurn?.session.session.defSessionId
        ?? this.#startingTurn?.session.session.defSessionId
        ?? this.#activeSessionId,
      defTurnId: this.#activeTurn?.defTurnId ?? this.#startingTurn?.defTurnId ?? null,
    };
  }

  async shutdown(): Promise<void> {
    if (this.#shutdown) return;
    this.#shutdown = true;
    if (this.#startingTurn) this.#startingTurn.abortCode ??= 'HOST_SHUTDOWN';
    if (this.#activeTurn) await this.abortTurn(this.#activeTurn.defTurnId, 'HOST_SHUTDOWN');
    await this.#engine.shutdown();
  }

  async #pump(active: ActiveTurn): Promise<void> {
    let firstToken = true;
    try {
      for await (const event of active.handle.events) {
        if (active.settled) return;
        if (event.type === 'response.delta') {
          if (firstToken) {
            firstToken = false;
            this.#append(active.session, {
              type: 'response.first-token',
              defTurnId: active.defTurnId,
              payload: {},
            });
          }
          this.#append(active.session, {
            type: 'response.delta',
            defTurnId: active.defTurnId,
            payload: { delta: event.delta },
          });
          continue;
        }
        if (event.type === 'tool.requested') {
          this.#append(active.session, {
            type: 'tool.requested',
            defTurnId: active.defTurnId,
            toolCallId: event.toolCallId,
            payload: { name: event.name, risk: 'read', input: event.input },
          });
          await this.#executeTool(active, event);
          continue;
        }
        if (event.type === 'interaction.requested') {
          this.#append(active.session, {
            type: 'interaction.requested',
            defTurnId: active.defTurnId,
            interactionId: event.interactionId,
            payload: {
              kind: event.interactionKind,
              prompt: event.prompt,
              expiresAt: new Date(this.#clock() + 15 * 60 * 1_000).toISOString(),
            },
          });
          continue;
        }
        if (event.type === 'tool-projection.applied') continue;
        const terminal = this.#projectTerminal(active, event);
        if (terminal) {
          this.#settle(active, terminal);
          return;
        }
      }
    } catch (error) {
      if (active.settled) return;
      const failureCode = error instanceof DefAgentHostError
        && (
          error.code === 'AGENT_EVENT_CAPACITY_REACHED'
          || error.code === 'AGENT_TURN_OUTPUT_LIMIT'
        )
        ? error.code
        : 'HOST_EVENT_LOOP_FAILED';
      active.abortRequested = true;
      active.abortController.abort();
      await this.#withTurnProtocolLock(active, async () => {
        if (active.settled) return;
        if (active.harnessTransactionId) {
          const transition = this.#requireHarnessManager().abort(
            active.harnessTransactionId,
            failureCode,
          );
          this.#appendHarnessTrace(active, transition.trace);
        }
        try {
          await active.handle.abort({ code: failureCode });
        } catch {
          // The original event-loop failure remains the authoritative terminal error.
        }
        const terminal = this.#append(active.session, {
          type: 'turn.failed',
          defTurnId: active.defTurnId,
          payload: {
            code: failureCode,
            message: error instanceof Error ? error.message : String(error),
          },
        });
        this.#settle(active, terminal);
      });
    } finally {
      if (this.#activeTurn === active) this.#activeTurn = null;
    }
  }

  async #executeTool(
    active: ActiveTurn,
    event: Extract<EngineEvent, { type: 'tool.requested' }>,
  ): Promise<void> {
    if (active.harnessTransactionId) {
      await this.#executeHarnessTool(active, event);
      return;
    }
    let outcome:
      | { readonly status: 'succeeded'; readonly result: JsonValue }
      | { readonly status: 'failed'; readonly code: string; readonly message: string };
    try {
      let result: JsonValue;
      if (event.name === 'product.snapshot.read') {
        result = await this.#productGateway.getSnapshot(active.session.binding) as unknown as JsonValue;
      } else if (event.name === 'product.command.refresh-snapshot') {
        const command: ProductCommandEnvelope<Phase2ProductOperationSchema> = {
          protocolVersion: 1,
          commandId: asCommandId(`command-${event.toolCallId}`),
          defSessionId: active.session.session.defSessionId,
          defTurnId: active.defTurnId,
          toolCallId: event.toolCallId,
          expected: active.session.binding,
          command: {
            op: 'workbench.refresh-snapshot',
            payload: { reason: 'agent-read' },
          },
        };
        await this.#productGateway.dispatch(command);
        const gatewayOutcome = await Promise.race([
          this.#productGateway.awaitResult(command.commandId).then((value) => ({
            status: 'result' as const,
            value,
          })),
          active.cancelled.then(() => ({ status: 'cancelled' as const })),
        ]);
        if (gatewayOutcome.status === 'cancelled') return;
        result = gatewayOutcome.value as unknown as JsonValue;
      } else {
        throw new DefAgentHostError('AGENT_TOOL_UNSUPPORTED', `Unsupported Phase 2 tool: ${event.name}`);
      }
      outcome = { status: 'succeeded', result };
    } catch (error) {
      outcome = {
        status: 'failed',
        code: error instanceof DefAgentHostError ? error.code : 'PRODUCT_GATEWAY_ERROR',
        message: error instanceof Error ? error.message : String(error),
      };
    }
    await this.#withTurnProtocolLock(active, async () => {
      if (active.settled || active.abortRequested) return;
      if (outcome.status === 'succeeded') {
        await active.handle.submitToolResult({
          toolCallId: event.toolCallId,
          status: 'succeeded',
          result: outcome.result,
        });
        this.#append(active.session, {
          type: 'tool.result',
          defTurnId: active.defTurnId,
          toolCallId: event.toolCallId,
          payload: { result: outcome.result },
        });
        return;
      }
      await active.handle.submitToolResult({
        toolCallId: event.toolCallId,
        status: 'failed',
        code: outcome.code,
        message: outcome.message,
      });
      this.#append(active.session, {
        type: 'tool.error',
        defTurnId: active.defTurnId,
        toolCallId: event.toolCallId,
        payload: { code: outcome.code, message: outcome.message },
      });
    });
  }

  async #executeHarnessTool(
    active: ActiveTurn,
    event: Extract<EngineEvent, { type: 'tool.requested' }>,
  ): Promise<void> {
    const transactionId = active.harnessTransactionId;
    if (!transactionId) throw new Error('Harness Tool execution requires a Harness transaction');
    const harnessManager = this.#requireHarnessManager();
    const toolRegistry = this.#requireToolRegistry();
    this.#append(active.session, {
      type: 'tool.started',
      defTurnId: active.defTurnId,
      toolCallId: event.toolCallId,
      payload: { name: event.name },
    });

    let prepared:
      | { readonly status: 'route' }
      | { readonly status: 'succeeded'; readonly result: JsonValue }
      | { readonly status: 'failed'; readonly error: unknown } = { status: 'route' };
    try {
      // Authorization must happen before a registered but out-of-phase Tool
      // can touch the Browser ProductGateway.
      harnessManager.assertToolProjected(transactionId, event.name);
      if (event.name !== 'def.harness.route') {
        prepared = {
          status: 'succeeded',
          result: await toolRegistry.execute(event.name, event.input, {
            defSessionId: active.session.session.defSessionId,
            defTurnId: active.defTurnId,
            toolCallId: event.toolCallId,
            binding: active.session.binding,
            product: this.#productGateway,
            abortSignal: active.abortController.signal,
          }),
        };
      }
    } catch (error) {
      prepared = { status: 'failed', error };
    }

    await this.#withTurnProtocolLock(active, async () => {
      if (active.settled || active.abortRequested) return;
      let result: JsonValue;
      let staged;
      try {
        harnessManager.assertToolProjected(transactionId, event.name);
        if (prepared.status === 'route') {
          staged = harnessManager.prepareRoute(transactionId, event.input);
          result = {
            contract: 'DefHarnessRouteResultV1',
            businessId: staged.transition.transaction.businessId,
            operation: staged.transition.transaction.operation,
            revision: staged.transition.transaction.revision?.revision ?? null,
            sourceLineage: staged.transition.transaction.revision?.sourceLineage ?? null,
            contentHash: staged.transition.transaction.revision?.contentHash ?? null,
            phaseId: staged.transition.transaction.phaseId,
          };
        } else {
          if (prepared.status === 'failed') throw prepared.error;
          result = prepared.result;
          staged = harnessManager.prepareToolCompletion(transactionId, {
            toolName: event.name,
            status: 'succeeded',
          });
        }
      } catch (error) {
        const failure = harnessToolFailure(error);
        staged = this.#prepareHarnessToolFailure(
          harnessManager,
          transactionId,
          event.name,
          failure.code,
        );
        await active.handle.submitToolResultAndUpdateProjection({
          toolCallId: event.toolCallId,
          status: 'failed',
          code: failure.code,
          message: failure.message,
          ...(failure.details === undefined ? {} : { details: failure.details }),
        }, staged.transition.transaction.projection);
        const transition = harnessManager.commitPrepared(staged);
        this.#append(active.session, {
          type: 'tool.error',
          defTurnId: active.defTurnId,
          toolCallId: event.toolCallId,
          payload: {
            code: failure.code,
            message: failure.message,
            ...(failure.details === undefined ? {} : { details: failure.details }),
          },
        });
        this.#appendHarnessTrace(active, transition.trace);
        return;
      }

      await active.handle.submitToolResultAndUpdateProjection({
        toolCallId: event.toolCallId,
        status: 'succeeded',
        result,
      }, staged.transition.transaction.projection);
      const transition = harnessManager.commitPrepared(staged);
      this.#append(active.session, {
        type: 'tool.result',
        defTurnId: active.defTurnId,
        toolCallId: event.toolCallId,
        payload: { result },
      });
      this.#appendHarnessTrace(active, transition.trace);
    });
  }

  #prepareHarnessToolFailure(
    harnessManager: DefHarnessManager,
    transactionId: string,
    toolName: string,
    code: string,
  ) {
    const transaction = harnessManager.getTransaction(transactionId);
    if (
      transaction.status === 'active'
      && transaction.projection.tools.some((tool) => tool.name === toolName)
      && toolName !== 'def.harness.route'
    ) {
      try {
        return harnessManager.prepareToolCompletion(transactionId, { toolName, status: 'failed' });
      } catch {
        // Fall through to the global abort so every failed Tool closes the transaction.
      }
    }
    return harnessManager.prepareAbort(transactionId, code);
  }

  #projectTerminal(active: ActiveTurn, event: EngineEvent): DefEvent | null {
    if (event.type === 'turn.completed') {
      if (active.harnessTransactionId) {
        const harnessManager = this.#requireHarnessManager();
        const transaction = harnessManager.getTransaction(active.harnessTransactionId);
        if (transaction.status !== 'completed') {
          const code = transaction.status === 'aborted' ? 'HARNESS_ABORTED' : 'HARNESS_INCOMPLETE';
          const transition = harnessManager.abort(active.harnessTransactionId, code);
          this.#appendHarnessTrace(active, transition.trace);
          return this.#append(active.session, {
            type: 'turn.failed',
            defTurnId: active.defTurnId,
            payload: {
              code,
              message: transaction.status === 'aborted'
                ? 'The Harness transaction aborted before the Engine completed'
                : 'The Engine completed before the Harness transaction reached its terminal phase',
            },
          });
        }
      }
      return this.#append(active.session, {
        type: 'turn.completed',
        defTurnId: active.defTurnId,
        payload: { output: event.output },
      });
    }
    if (event.type === 'turn.failed') {
      if (active.harnessTransactionId) {
        const transition = this.#requireHarnessManager().abort(
          active.harnessTransactionId,
          event.code,
        );
        this.#appendHarnessTrace(active, transition.trace);
      }
      return this.#append(active.session, {
        type: 'turn.failed',
        defTurnId: active.defTurnId,
        payload: { code: event.code, message: event.message },
      });
    }
    if (event.type === 'turn.aborted') {
      if (active.harnessTransactionId) {
        const transition = this.#requireHarnessManager().abort(
          active.harnessTransactionId,
          event.reason.code,
        );
        this.#appendHarnessTrace(active, transition.trace);
      }
      return this.#append(active.session, {
        type: 'turn.stopped',
        defTurnId: active.defTurnId,
        payload: { code: event.reason.code, message: event.reason.message },
      });
    }
    return null;
  }

  #settle(active: ActiveTurn, terminal: DefEvent): void {
    if (active.settled) return;
    active.settled = true;
    active.abortController.abort();
    this.#turns.delete(active.defTurnId);
    this.#settledTurns.set(active.defTurnId, { session: active.session, terminal });
    if (this.#activeTurn === active) this.#activeTurn = null;
    active.resolveCancelled();
    active.resolveTerminal(terminal);
  }

  #append<Type extends DefEvent['type']>(
    record: SessionRecord,
    event: DefEventInput<Type>,
  ): Extract<DefEvent, { type: Type }> {
    const nextSequence = record.sequence + 1;
    const envelope = {
      schemaVersion: DEF_EVENT_SCHEMA_VERSION,
      sequence: nextSequence,
      occurredAt: new Date(this.#clock()).toISOString(),
      defSessionId: record.session.defSessionId,
      ...event,
    } as unknown as Extract<DefEvent, { type: Type }>;
    const eventCodeUnits = JSON.stringify(envelope).length;
    const usesTerminalReserve = isTerminalReserveEvent(envelope);
    const eventLimit = DEF_AGENT_IN_MEMORY_LIMITS.maxEventsPerSession
      - (usesTerminalReserve ? 0 : DEF_AGENT_IN_MEMORY_LIMITS.terminalEventReserve);
    const codeUnitLimit = DEF_AGENT_IN_MEMORY_LIMITS.maxEventCodeUnitsPerSession
      - (usesTerminalReserve ? 0 : DEF_AGENT_IN_MEMORY_LIMITS.terminalCodeUnitReserve);
    const active = this.#activeTurn?.session === record ? this.#activeTurn : null;
    const exceedsTurnLimit = Boolean(active && !usesTerminalReserve && (
      record.events.length + 1 - active.eventStartCount > DEF_AGENT_IN_MEMORY_LIMITS.maxEventsPerTurn
      || record.eventCodeUnits + eventCodeUnits - active.eventStartCodeUnits
        > DEF_AGENT_IN_MEMORY_LIMITS.maxEventCodeUnitsPerTurn
    ));
    if (
      record.events.length + 1 > eventLimit
      || record.eventCodeUnits + eventCodeUnits > codeUnitLimit
    ) {
      throw new DefAgentHostError(
        'AGENT_EVENT_CAPACITY_REACHED',
        `DEF Session ${record.session.defSessionId} reached its in-memory Event Journal capacity`,
      );
    }
    if (exceedsTurnLimit) {
      throw new DefAgentHostError(
        'AGENT_TURN_OUTPUT_LIMIT',
        `DEF Turn output reached its in-memory Event limit in Session ${record.session.defSessionId}`,
      );
    }
    record.sequence = nextSequence;
    record.eventCodeUnits += eventCodeUnits;
    record.events.push(envelope);
    return envelope;
  }

  #appendHarnessTrace(active: ActiveTurn, trace: readonly DefHarnessTraceEntry[]): void {
    for (const entry of trace) {
      if (entry.type === 'harness.routed') {
        this.#append(active.session, {
          type: entry.type,
          defTurnId: active.defTurnId,
          payload: {
            businessId: entry.businessId,
            operation: entry.operation,
            revision: entry.revision.revision,
            sourceLineage: entry.revision.sourceLineage,
            contentHash: entry.revision.contentHash,
          },
        });
        continue;
      }
      if (entry.type === 'harness.phase.entered') {
        this.#append(active.session, {
          type: entry.type,
          defTurnId: active.defTurnId,
          payload: {
            businessId: entry.businessId,
            operation: entry.operation,
            phaseId: entry.phaseId,
            phaseKind: entry.phaseKind,
          },
        });
        continue;
      }
      if (entry.type === 'harness.tool.projected') {
        this.#append(active.session, {
          type: entry.type,
          defTurnId: active.defTurnId,
          payload: {
            projectionRevision: entry.projectionRevision,
            tools: entry.tools,
          },
        });
        continue;
      }
      this.#append(active.session, {
        type: entry.type,
        defTurnId: active.defTurnId,
        payload: {
          businessId: entry.businessId,
          operation: entry.operation,
          phaseId: entry.phaseId,
          terminalState: entry.terminalState,
          ...(entry.code ? { code: entry.code } : {}),
        },
      });
    }
  }

  #requireHarnessManager(): DefHarnessManager {
    if (!this.#harnessManager) {
      throw new DefAgentHostError('AGENT_TOOL_UNSUPPORTED', 'DEF Harness Manager is not configured');
    }
    return this.#harnessManager;
  }

  #requireToolRegistry(): DefReadToolRegistry {
    if (!this.#toolRegistry) {
      throw new DefAgentHostError('AGENT_TOOL_UNSUPPORTED', 'DEF Tool Registry is not configured');
    }
    return this.#toolRegistry;
  }

  async #withTurnProtocolLock<Result>(
    active: ActiveTurn,
    action: () => Promise<Result>,
  ): Promise<Result> {
    const previous = active.protocolTail;
    let release!: () => void;
    active.protocolTail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      return await action();
    } finally {
      release();
    }
  }

  #assertRunning(): void {
    if (this.#shutdown) throw new Error('DEF Agent Host is shut down');
  }

  #assertTurnAvailable(): void {
    if (this.#activeTurn || this.#startingTurn) {
      throw new DefAgentHostError('AGENT_TURN_BUSY', 'The workbench already has an active or starting turn');
    }
  }

  #assertSessionCanStartTurn(record: SessionRecord, userMessage: string): void {
    if (record.acceptedTurns >= DEF_AGENT_IN_MEMORY_LIMITS.maxTurnsPerSession) {
      throw new DefAgentHostError(
        'AGENT_SESSION_TURN_LIMIT_REACHED',
        `DEF Session ${record.session.defSessionId} keeps at most ${DEF_AGENT_IN_MEMORY_LIMITS.maxTurnsPerSession} Turns`,
      );
    }
    const eventSoftLimit = DEF_AGENT_IN_MEMORY_LIMITS.maxEventsPerSession
      - DEF_AGENT_IN_MEMORY_LIMITS.terminalEventReserve;
    const codeUnitSoftLimit = DEF_AGENT_IN_MEMORY_LIMITS.maxEventCodeUnitsPerSession
      - DEF_AGENT_IN_MEMORY_LIMITS.terminalCodeUnitReserve;
    const acceptedTurnHeadroom = JSON.stringify(userMessage).length + 4_096;
    if (
      record.events.length + 4 > eventSoftLimit
      || record.eventCodeUnits + acceptedTurnHeadroom > codeUnitSoftLimit
    ) {
      throw new DefAgentHostError(
        'AGENT_EVENT_CAPACITY_REACHED',
        `DEF Session ${record.session.defSessionId} has no room for another Turn`,
      );
    }
  }

  #beginStartingTurn(record: SessionRecord, defTurnId: DefTurnId): StartingTurn {
    const starting: StartingTurn = { session: record, defTurnId, abortCode: null };
    this.#startingTurn = starting;
    this.#activeSessionId = record.session.defSessionId;
    return starting;
  }

  #startingTurnCancellation(starting: StartingTurn): {
    readonly code: string;
    readonly error: DefAgentHostError;
  } | null {
    let consumerError: unknown = null;
    try {
      this.#requireConsumer();
    } catch (error) {
      consumerError = error;
      starting.abortCode ??= 'BROWSER_CONSUMER_LOST';
    }
    if (!starting.abortCode) return null;
    if (consumerError instanceof DefAgentHostError) {
      return { code: starting.abortCode, error: consumerError };
    }
    if (starting.abortCode === 'BROWSER_CONSUMER_LOST') {
      return {
        code: starting.abortCode,
        error: new DefAgentHostError(
          'AGENT_CONSUMER_REQUIRED',
          `Browser Workbench consumer was lost while starting DEF Turn ${starting.defTurnId}`,
        ),
      };
    }
    return {
      code: starting.abortCode,
      error: new DefAgentHostError(
        'AGENT_TURN_START_CANCELLED',
        `DEF Turn ${starting.defTurnId} was cancelled while starting (${starting.abortCode})`,
      ),
    };
  }

  #requireSession(defSessionId: DefSessionId): SessionRecord {
    const record = this.#sessions.get(defSessionId);
    if (!record) {
      throw new DefAgentHostError('AGENT_SESSION_NOT_FOUND', `DEF Session ${defSessionId} does not exist`, 404);
    }
    return record;
  }

  #touchSession(record: SessionRecord): void {
    record.session = {
      ...record.session,
      lastDatabaseGeneration: record.binding.databaseGeneration,
      boundNodeId: record.binding.checkoutTargetId,
      updatedAt: new Date(this.#clock()).toISOString(),
    };
  }
}

function isTerminalReserveEvent(event: DefEvent): boolean {
  if (
    event.type === 'turn.completed'
    || event.type === 'turn.stopped'
    || event.type === 'turn.interrupted'
    || event.type === 'turn.failed'
    || event.type === 'harness.terminal'
  ) return true;
  return event.type === 'harness.tool.projected' && event.payload.tools.length === 0;
}

function bindingContext(binding: ProductBinding): JsonObject {
  return {
    workspaceId: binding.workspaceId,
    databaseGeneration: binding.databaseGeneration,
    timelineId: binding.timelineId,
    checkoutTargetId: binding.checkoutTargetId,
    checkoutUpdatedAt: binding.checkoutUpdatedAt,
    contentRevision: binding.contentRevision,
    snapshotDigest: binding.snapshotDigest,
  };
}

function stableSessionBindingMatches(session: DefSessionV6, binding: ProductBinding): boolean {
  return session.workspaceId === binding.workspaceId
    && session.lastDatabaseGeneration === binding.databaseGeneration
    && session.timelineId === binding.timelineId;
}

function cloneSession(session: DefSessionV6): DefSessionV6 {
  return {
    ...session,
    engine: { ...session.engine },
    harness: { ...session.harness },
  };
}

function assertStableSessionBinding(session: DefSessionV6, binding: ProductBinding): void {
  if (!stableSessionBindingMatches(session, binding)) {
    throw new DefAgentHostError(
      'AGENT_BINDING_CONFLICT',
      'DEF Session does not belong to the active browser workspace and Timeline',
      409,
    );
  }
}

function harnessToolFailure(error: unknown): {
  readonly code: string;
  readonly message: string;
  readonly details?: JsonValue;
} {
  if (error instanceof DefToolExecutionError) {
    return {
      code: error.code,
      message: error.message,
      ...(error.details === undefined ? {} : { details: error.details }),
    };
  }
  if (error instanceof DefHarnessError || error instanceof DefAgentHostError) {
    return { code: error.code, message: error.message };
  }
  return {
    code: 'DEF_TOOL_EXECUTION_FAILED',
    message: error instanceof Error ? error.message : String(error),
  };
}
