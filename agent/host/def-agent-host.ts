import {
  DEF_EVENT_SCHEMA_VERSION,
  DEF_SESSION_SCHEMA_VERSION,
  asClientTurnId,
  asCommandId,
  asDefSessionId,
  asDefTurnId,
  type AgentEngine,
  type ClientTurnId,
  type DefEvent,
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
  events: DefEvent[];
};

type ActiveTurn = {
  readonly session: SessionRecord;
  readonly defTurnId: DefTurnId;
  readonly handle: EngineTurnHandle;
  readonly terminal: Promise<DefEvent>;
  readonly cancelled: Promise<void>;
  resolveTerminal: (event: DefEvent) => void;
  resolveCancelled: () => void;
  settled: boolean;
};

type IdFactory = {
  readonly session: () => DefSessionId;
  readonly turn: () => DefTurnId;
  readonly clientTurn: () => ClientTurnId;
};

export class DefAgentHost {
  readonly #engine: AgentEngine;
  readonly #productGateway: ProductGateway<Phase2ProductOperationSchema>;
  readonly #requireConsumer: () => void;
  readonly #clock: () => number;
  readonly #ids: IdFactory;
  readonly #sessions = new Map<DefSessionId, SessionRecord>();
  readonly #turns = new Map<DefTurnId, ActiveTurn>();
  #activeTurn: ActiveTurn | null = null;
  #shutdown = false;

  constructor(options: {
    readonly engine: AgentEngine;
    readonly productGateway: ProductGateway<Phase2ProductOperationSchema>;
    readonly requireConsumer: () => void;
    readonly clock?: () => number;
    readonly ids?: Partial<IdFactory>;
  }) {
    this.#engine = options.engine;
    this.#productGateway = options.productGateway;
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
      harness: { stateVersion: 1, revision: 'phase2-browser-product-gateway' },
      createdAt: now,
      updatedAt: now,
    };
    const record: SessionRecord = {
      session,
      binding: input.binding,
      providerProfileRef: input.providerProfileRef,
      sequence: 0,
      events: [],
    };
    this.#sessions.set(defSessionId, record);
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
    if (this.#activeTurn) {
      throw new DefAgentHostError('AGENT_TURN_BUSY', 'The workbench already has an active turn');
    }
    const record = this.#sessions.get(input.defSessionId);
    if (!record) {
      throw new DefAgentHostError('AGENT_SESSION_NOT_FOUND', `DEF Session ${input.defSessionId} does not exist`, 404);
    }
    const defTurnId = this.#ids.turn();
    const clientTurnId = input.clientTurnId ?? this.#ids.clientTurn();
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
      terminal,
      cancelled,
      resolveTerminal,
      resolveCancelled,
      settled: false,
    };
    this.#activeTurn = active;
    this.#turns.set(defTurnId, active);
    this.#append(record, {
      type: 'turn.accepted',
      defTurnId,
      payload: { clientTurnId },
    });
    void this.#pump(active);
    return { defTurnId, clientTurnId };
  }

  async respondInteraction(
    defTurnId: DefTurnId,
    input: EngineInteractionResultInput,
  ): Promise<void> {
    const active = this.#turns.get(defTurnId);
    if (!active || this.#activeTurn !== active) {
      throw new DefAgentHostError('AGENT_TURN_NOT_FOUND', `Active DEF Turn ${defTurnId} does not exist`, 404);
    }
    await active.handle.submitInteractionResult(input);
    this.#append(active.session, {
      type: 'interaction.resolved',
      defTurnId,
      interactionId: input.interactionId,
      payload: { status: input.resolution, ...('value' in input ? { value: input.value } : {}) },
    });
  }

  async abortTurn(defTurnId: DefTurnId, code = 'USER_STOPPED'): Promise<void> {
    const active = this.#turns.get(defTurnId);
    if (!active || this.#activeTurn !== active) {
      throw new DefAgentHostError('AGENT_TURN_NOT_FOUND', `Active DEF Turn ${defTurnId} does not exist`, 404);
    }
    const result = await active.handle.abort({ code });
    if (result.status === 'aborted' && !active.settled) {
      this.#settle(active, this.#append(active.session, {
        type: 'turn.stopped',
        defTurnId: active.defTurnId,
        payload: { code },
      }));
    }
  }

  waitForTurnTerminal(defTurnId: DefTurnId): Promise<DefEvent> {
    const turn = this.#turns.get(defTurnId);
    if (!turn) {
      return Promise.reject(new DefAgentHostError(
        'AGENT_TURN_NOT_FOUND',
        `DEF Turn ${defTurnId} does not exist`,
        404,
      ));
    }
    return turn.terminal;
  }

  readEvents(defSessionId: DefSessionId, afterSequence = 0): readonly DefEvent[] {
    const record = this.#sessions.get(defSessionId);
    if (!record) {
      throw new DefAgentHostError('AGENT_SESSION_NOT_FOUND', `DEF Session ${defSessionId} does not exist`, 404);
    }
    return record.events.filter((event) => event.sequence > afterSequence);
  }

  getActiveIds(): { readonly defSessionId: DefSessionId | null; readonly defTurnId: DefTurnId | null } {
    return {
      defSessionId: this.#activeTurn?.session.session.defSessionId ?? null,
      defTurnId: this.#activeTurn?.defTurnId ?? null,
    };
  }

  async shutdown(): Promise<void> {
    if (this.#shutdown) return;
    this.#shutdown = true;
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
      const terminal = this.#append(active.session, {
        type: 'turn.failed',
        defTurnId: active.defTurnId,
        payload: {
          code: 'HOST_EVENT_LOOP_FAILED',
          message: error instanceof Error ? error.message : String(error),
        },
      });
      this.#settle(active, terminal);
    } finally {
      if (this.#activeTurn === active) this.#activeTurn = null;
    }
  }

  async #executeTool(
    active: ActiveTurn,
    event: Extract<EngineEvent, { type: 'tool.requested' }>,
  ): Promise<void> {
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
        const outcome = await Promise.race([
          this.#productGateway.awaitResult(command.commandId).then((value) => ({
            status: 'result' as const,
            value,
          })),
          active.cancelled.then(() => ({ status: 'cancelled' as const })),
        ]);
        if (outcome.status === 'cancelled') return;
        result = outcome.value as unknown as JsonValue;
      } else {
        throw new DefAgentHostError('AGENT_TOOL_UNSUPPORTED', `Unsupported Phase 2 tool: ${event.name}`);
      }
      if (active.settled) return;
      await active.handle.submitToolResult({ toolCallId: event.toolCallId, status: 'succeeded', result });
      this.#append(active.session, {
        type: 'tool.result',
        defTurnId: active.defTurnId,
        toolCallId: event.toolCallId,
        payload: { result },
      });
    } catch (error) {
      if (active.settled) return;
      const code = error instanceof DefAgentHostError ? error.code : 'PRODUCT_GATEWAY_ERROR';
      const message = error instanceof Error ? error.message : String(error);
      await active.handle.submitToolResult({
        toolCallId: event.toolCallId,
        status: 'failed',
        code,
        message,
      });
      this.#append(active.session, {
        type: 'tool.error',
        defTurnId: active.defTurnId,
        toolCallId: event.toolCallId,
        payload: { code, message },
      });
    }
  }

  #projectTerminal(active: ActiveTurn, event: EngineEvent): DefEvent | null {
    if (event.type === 'turn.completed') {
      return this.#append(active.session, {
        type: 'turn.completed',
        defTurnId: active.defTurnId,
        payload: { output: event.output },
      });
    }
    if (event.type === 'turn.failed') {
      return this.#append(active.session, {
        type: 'turn.failed',
        defTurnId: active.defTurnId,
        payload: { code: event.code, message: event.message },
      });
    }
    if (event.type === 'turn.aborted') {
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
    active.resolveCancelled();
    active.resolveTerminal(terminal);
    if (this.#activeTurn === active) this.#activeTurn = null;
  }

  #append<Type extends DefEvent['type']>(
    record: SessionRecord,
    event: DefEventInput<Type>,
  ): Extract<DefEvent, { type: Type }> {
    const envelope = {
      schemaVersion: DEF_EVENT_SCHEMA_VERSION,
      sequence: ++record.sequence,
      occurredAt: new Date(this.#clock()).toISOString(),
      defSessionId: record.session.defSessionId,
      ...event,
    } as unknown as Extract<DefEvent, { type: Type }>;
    record.events.push(envelope);
    return envelope;
  }

  #assertRunning(): void {
    if (this.#shutdown) throw new Error('DEF Agent Host is shut down');
  }
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
