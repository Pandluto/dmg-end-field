import { createHash, randomBytes } from 'node:crypto';
import {
  DEF_EVENT_SCHEMA_VERSION,
  DEF_AGENT_IN_MEMORY_LIMITS,
  DEF_SESSION_SCHEMA_VERSION,
  asClientTurnId,
  asCommandId,
  asDefSessionId,
  asDefTurnId,
  asInteractionId,
  canonicalJson,
  type AgentEngine,
  type ApprovalCapabilityVerificationKey,
  type ClientTurnId,
  type CommandId,
  type DefEvent,
  type DefHarnessTraceEntry,
  type DefSessionId,
  type DefSessionV6,
  type DefTurnId,
  type EngineEvent,
  type EngineInteractionResultInput,
  type EngineMessageId,
  type EngineToolProjectionInput,
  type EngineTurnHandle,
  type EngineUserAttachment,
  type DefInteractiveToolPlan,
  type DefWorkbenchToolRegistry,
  type InteractionId,
  type InteractionRequest,
  type InteractionResponse,
  type JsonObject,
  type JsonValue,
  type Phase2ProductOperationSchema,
  type ProductBinding,
  type ProductCommandEnvelope,
  type ProductCommandResult,
  type ProductGateway,
} from '../core/contracts/index.ts';
import { DefHarnessError, DefHarnessManager } from '../core/harness/manager.ts';
import { DefToolExecutionError } from '../core/contracts/tool.ts';
import {
  InteractionBroker,
  InteractionBrokerError,
  type InteractionSnapshot,
} from '../core/interactions/interaction-broker.ts';
import { DefAgentHostError } from './errors.ts';
import { ApprovalCapabilitySigner } from './approval-capability-signer.ts';
import {
  createNoopDefAgentSessionStore,
  type DefAcceptedClientTurn,
  type DefAgentSessionRecord,
  type DefAgentSessionStore,
} from './session-store.ts';

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
  readonly attachmentDigest: string | null;
} & (
  | { readonly state: 'pending'; readonly promise: Promise<TurnStartResult> }
  | {
      readonly state: 'accepted';
      readonly result: TurnStartResult;
      readonly acceptedAt: string;
    }
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
  readonly pendingInteractionIds: Set<InteractionId>;
  responseDeltaEventsSinceFlush: number;
  responseDeltaCodeUnitsSinceFlush: number;
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
  readonly interaction: () => InteractionId;
  readonly command: () => CommandId;
};

type InteractionWaiter = {
  readonly resolve: (response: InteractionResponse) => void;
  readonly timer: ReturnType<typeof setTimeout> | null;
};

const INTERACTION_TIMEOUT_MS = 15 * 60 * 1_000;
const PRODUCT_COMMAND_TIMEOUT_MS = 45_000;
const RESPONSE_DELTA_FLUSH_EVENT_INTERVAL = 32;
const RESPONSE_DELTA_FLUSH_CODE_UNITS = 64 * 1_024;

export class DefAgentHost {
  readonly #engine: AgentEngine;
  readonly #productGateway: ProductGateway<Phase2ProductOperationSchema>;
  readonly #harnessManager: DefHarnessManager | null;
  readonly #toolRegistry: DefWorkbenchToolRegistry | null;
  readonly #interactionBroker: InteractionBroker;
  readonly #approvalCapabilitySigner: ApprovalCapabilitySigner;
  readonly #sessionStore: DefAgentSessionStore;
  readonly #interactionWaiters = new Map<InteractionId, InteractionWaiter>();
  readonly #requireConsumer: () => void;
  readonly #clock: () => number;
  readonly #ids: IdFactory;
  readonly #sessions = new Map<DefSessionId, SessionRecord>();
  readonly #turns = new Map<DefTurnId, ActiveTurn>();
  readonly #settledTurns = new Map<DefTurnId, SettledTurn>();
  #activeTurn: ActiveTurn | null = null;
  #startingTurn: StartingTurn | null = null;
  #activeSessionId: DefSessionId | null = null;
  #pendingSessionCreations = 0;
  #initialized = false;
  #initializing: Promise<void> | null = null;
  #shutdown = false;

  constructor(options: {
    readonly engine: AgentEngine;
    readonly productGateway: ProductGateway<Phase2ProductOperationSchema>;
    readonly requireConsumer: () => void;
    readonly harnessManager?: DefHarnessManager;
    readonly toolRegistry?: DefWorkbenchToolRegistry;
    readonly interactionBroker?: InteractionBroker;
    readonly approvalCapabilitySigner?: ApprovalCapabilitySigner;
    readonly sessionStore?: DefAgentSessionStore;
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
    this.#interactionBroker = options.interactionBroker ?? new InteractionBroker({
      keyEpoch: `approval-${randomBytes(18).toString('base64url')}`,
      nonceFactory: () => `nonce-${randomBytes(18).toString('base64url')}`,
    });
    this.#approvalCapabilitySigner = options.approvalCapabilitySigner
      ?? new ApprovalCapabilitySigner({ keyEpoch: this.#interactionBroker.keyEpoch });
    if (this.#approvalCapabilitySigner.verificationKey.keyEpoch !== this.#interactionBroker.keyEpoch) {
      throw new Error('Approval signer and Interaction Broker key epochs must match');
    }
    this.#sessionStore = options.sessionStore ?? createNoopDefAgentSessionStore();
    this.#requireConsumer = options.requireConsumer;
    this.#clock = options.clock ?? Date.now;
    this.#ids = {
      session: options.ids?.session ?? (() => asDefSessionId(`def-session-${randomBytes(12).toString('base64url')}`)),
      turn: options.ids?.turn ?? (() => asDefTurnId(`def-turn-${randomBytes(12).toString('base64url')}`)),
      clientTurn: options.ids?.clientTurn ?? (() => asClientTurnId(`client-turn-${randomBytes(12).toString('base64url')}`)),
      interaction: options.ids?.interaction ?? (() => asInteractionId(`interaction-${randomBytes(12).toString('base64url')}`)),
      command: options.ids?.command ?? (() => asCommandId(`command-${randomBytes(12).toString('base64url')}`)),
    };
    this.#loadStoredSessions();
    this.#initialized = this.#sessions.size === 0;
  }

  getApprovalVerificationKey(): ApprovalCapabilityVerificationKey {
    return { ...this.#approvalCapabilitySigner.verificationKey };
  }

  async initialize(): Promise<void> {
    this.#assertRunning();
    if (this.#initialized) return;
    if (this.#initializing) return this.#initializing;
    this.#initializing = this.#recoverStoredSessions();
    try {
      await this.#initializing;
      this.#initialized = true;
    } finally {
      this.#initializing = null;
    }
  }

  #loadStoredSessions(): void {
    const snapshot = this.#sessionStore.load();
    if (snapshot.sessions.length > DEF_AGENT_IN_MEMORY_LIMITS.maxSessionsPerHost) {
      throw new DefAgentHostError(
        'AGENT_SESSION_LIMIT_REACHED',
        `Session store contains more than ${DEF_AGENT_IN_MEMORY_LIMITS.maxSessionsPerHost} Sessions`,
      );
    }
    for (const stored of snapshot.sessions) {
      const events = [...(snapshot.events.get(stored.session.defSessionId) ?? [])];
      const record: SessionRecord = {
        session: cloneSession(stored.session),
        binding: structuredClone(stored.binding),
        providerProfileRef: stored.providerProfileRef,
        sequence: events.at(-1)?.sequence ?? 0,
        eventCodeUnits: events.reduce((total, event) => total + JSON.stringify(event).length, 0),
        acceptedTurns: events.filter((event) => event.type === 'turn.accepted').length,
        events,
        clientTurns: new Map(stored.acceptedClientTurns.map((turn) => [
          turn.clientTurnId,
          {
            userMessage: turn.userMessage,
            attachmentDigest: turn.attachmentDigest ?? null,
            state: 'accepted' as const,
            result: structuredClone(turn.result),
            acceptedAt: turn.acceptedAt,
          },
        ])),
      };
      this.#sessions.set(record.session.defSessionId, record);
      for (const event of events) {
        if (isTurnTerminalEvent(event)) {
          this.#settledTurns.set(event.defTurnId, { session: record, terminal: event });
        }
      }
    }
    this.#activeSessionId = snapshot.activeSessionId && this.#sessions.has(snapshot.activeSessionId)
      ? snapshot.activeSessionId
      : null;
  }

  async #recoverStoredSessions(): Promise<void> {
    for (const record of [...this.#sessions.values()]) {
      this.#interruptAbandonedTurns(record);
      if (record.session.status === 'deleting') {
        try {
          await this.#engine.disposeSession(record.session.engine);
          this.#sessionStore.delete(record.session.defSessionId);
          this.#sessions.delete(record.session.defSessionId);
          if (this.#activeSessionId === record.session.defSessionId) this.#activeSessionId = null;
          continue;
        } catch (error) {
          this.#replaceSession(record, {
            ...record.session,
            status: 'delete-failed',
            updatedAt: new Date(this.#clock()).toISOString(),
          });
        }
      }

      try {
        const recovered = await this.#engine.recoverSession(record.session.engine);
        if (recovered.status === 'recovered') {
          const nextStatus = record.session.status === 'archived' ? 'archived' : 'ready';
          this.#replaceSession(record, {
            ...record.session,
            status: nextStatus,
            engine: recovered.ref,
            updatedAt: new Date(this.#clock()).toISOString(),
          });
          this.#append(record, {
            type: 'session.recovered',
            payload: {
              engineKind: recovered.ref.kind,
              engineRuntimeVersion: recovered.ref.runtimeVersion,
            },
          });
          continue;
        }
        const message = recovered.status === 'missing'
          ? 'The persisted Engine Session no longer exists'
          : recovered.message;
        this.#replaceSession(record, {
          ...record.session,
          status: 'orphaned',
          updatedAt: new Date(this.#clock()).toISOString(),
        });
        this.#append(record, {
          type: 'session.orphaned',
          payload: {
            code: recovered.status === 'missing' ? 'ENGINE_SESSION_MISSING' : recovered.code,
            message,
          },
        });
      } catch (error) {
        this.#replaceSession(record, {
          ...record.session,
          status: 'engine-unavailable',
          updatedAt: new Date(this.#clock()).toISOString(),
        });
        this.#append(record, {
          type: 'session.orphaned',
          payload: {
            code: 'ENGINE_RECOVERY_UNAVAILABLE',
            message: error instanceof Error ? error.message : String(error),
          },
        });
      }
    }
    if (this.#activeSessionId && !this.#sessions.has(this.#activeSessionId)) {
      this.#activeSessionId = null;
      this.#sessionStore.setActive(null);
    }
  }

  #interruptAbandonedTurns(record: SessionRecord): void {
    const terminalTurns = new Set<DefTurnId>();
    const acceptedTurns = new Set<DefTurnId>();
    const pendingInteractions = new Map<InteractionId, Extract<DefEvent, { type: 'interaction.requested' }>>();
    const unresolvedCommands = new Map<DefTurnId, Set<CommandId>>();
    for (const event of record.events) {
      if (event.type === 'turn.accepted') acceptedTurns.add(event.defTurnId);
      if (isTurnTerminalEvent(event)) terminalTurns.add(event.defTurnId);
      if (event.type === 'interaction.requested') pendingInteractions.set(event.interactionId, event);
      if (event.type === 'interaction.resolved') pendingInteractions.delete(event.interactionId);
      if (
        event.type === 'command.queued'
        || event.type === 'command.dispatched'
        || event.type === 'command.claimed'
        || event.type === 'command.committed'
      ) {
        const commands = unresolvedCommands.get(event.defTurnId) ?? new Set<CommandId>();
        commands.add(event.commandId);
        unresolvedCommands.set(event.defTurnId, commands);
      }
      if (
        event.type === 'command.result'
        || event.type === 'command.reconciled'
        || event.type === 'command.orphaned'
      ) {
        unresolvedCommands.get(event.defTurnId)?.delete(event.commandId);
      }
    }
    for (const [interactionId, event] of pendingInteractions) {
      if (!acceptedTurns.has(event.defTurnId) || terminalTurns.has(event.defTurnId)) continue;
      this.#append(record, {
        type: 'interaction.resolved',
        defTurnId: event.defTurnId,
        interactionId,
        ...('toolCallId' in event && event.toolCallId ? { toolCallId: event.toolCallId } : {}),
        payload: { status: 'stale' },
      });
    }
    for (const defTurnId of acceptedTurns) {
      if (terminalTurns.has(defTurnId)) continue;
      const terminal = this.#append(record, {
        type: 'turn.interrupted',
        defTurnId,
        payload: {
          code: 'HOST_RESTARTED',
          message: 'The Agent Host restarted before this Turn reached a terminal state',
          reconcileRequiredCommandIds: [...(unresolvedCommands.get(defTurnId) ?? [])],
        },
      });
      this.#settledTurns.set(defTurnId, { session: record, terminal });
    }
  }

  async createSession(input: {
    readonly binding: ProductBinding;
    readonly providerProfileRef: string;
  }): Promise<DefSessionV6> {
    this.#assertRunning();
    this.#assertInitialized();
    this.#requireConsumer();
    if (
      this.#sessions.size + this.#pendingSessionCreations
      >= DEF_AGENT_IN_MEMORY_LIMITS.maxSessionsPerHost
    ) {
      throw new DefAgentHostError(
        'AGENT_SESSION_LIMIT_REACHED',
        `This Agent Host keeps at most ${DEF_AGENT_IN_MEMORY_LIMITS.maxSessionsPerHost} in-memory Sessions`,
      );
    }
    const defSessionId = this.#ids.session();
    let engine: DefSessionV6['engine'];
    this.#pendingSessionCreations += 1;
    try {
      engine = await this.#engine.createSession({
        defSessionId,
        providerProfileRef: input.providerProfileRef,
        metadata: {
          workspaceId: input.binding.workspaceId,
          databaseGeneration: input.binding.databaseGeneration,
          timelineId: input.binding.timelineId,
        },
      });
    } finally {
      this.#pendingSessionCreations -= 1;
    }
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
    try {
      this.#sessionStore.create(this.#toStoredRecord(record));
      this.#sessions.set(defSessionId, record);
      this.#append(record, {
        type: 'session.ready',
        payload: {
          engineKind: engine.kind,
          engineRuntimeVersion: engine.runtimeVersion,
        },
      });
      this.#sessionStore.setActive(defSessionId);
      this.#activeSessionId = defSessionId;
    } catch (error) {
      this.#sessions.delete(defSessionId);
      try {
        if (this.#sessionStore.loadSession(defSessionId)) this.#sessionStore.delete(defSessionId);
      } catch {
        // Preserve the original Session creation failure.
      }
      await this.#engine.disposeSession(engine).catch(() => undefined);
      throw error;
    }
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
    this.#assertInitialized();
    this.#requireConsumer();
    const record = this.#sessions.get(input.defSessionId);
    if (!record) {
      throw new DefAgentHostError('AGENT_SESSION_NOT_FOUND', `DEF Session ${input.defSessionId} does not exist`, 404);
    }
    const clientTurnId = input.clientTurnId ?? this.#ids.clientTurn();
    const previous = record.clientTurns.get(clientTurnId);
    if (previous) {
      if (previous.userMessage !== input.userMessage || previous.attachmentDigest !== null) {
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
    const defTurnId = this.#ids.turn();
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
        const acceptedAt = new Date(this.#clock()).toISOString();
        this.#append(record, {
          type: 'turn.accepted',
          defTurnId,
          payload: { clientTurnId, userMessage: input.userMessage },
        });
        const result = { defTurnId, clientTurnId };
        this.#sessionStore.acceptClientTurn(record.session.defSessionId, {
          clientTurnId,
          userMessage: input.userMessage,
          result,
          acceptedAt,
        });
        record.clientTurns.set(clientTurnId, {
          userMessage: input.userMessage,
          attachmentDigest: null,
          state: 'accepted',
          result,
          acceptedAt,
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
    readonly engineUserMessageId?: EngineMessageId;
    readonly userAttachments?: readonly EngineUserAttachment[];
    readonly binding?: ProductBinding;
  }): Promise<TurnStartResult> {
    this.#assertRunning();
    this.#assertInitialized();
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
    const userAttachments = cloneUserAttachments(input.userAttachments);
    const attachmentDigest = digestUserAttachments(userAttachments);
    const clientTurnId = input.clientTurnId ?? this.#ids.clientTurn();
    const previous = record.clientTurns.get(clientTurnId);
    if (previous) {
      if (
        previous.userMessage !== input.userMessage
        || previous.attachmentDigest !== attachmentDigest
      ) {
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
    if (input.binding) {
      const previousBinding = record.binding;
      const previousSession = record.session;
      record.binding = input.binding;
      record.session = {
        ...record.session,
        lastDatabaseGeneration: input.binding.databaseGeneration,
        boundNodeId: input.binding.checkoutTargetId,
        updatedAt: new Date(this.#clock()).toISOString(),
      };
      try {
        this.#persistRecord(record);
      } catch (error) {
        record.binding = previousBinding;
        record.session = previousSession;
        throw error;
      }
    }
    const promise = this.#startHarnessTurn(record, harnessManager, {
      clientTurnId,
      userMessage: input.userMessage,
      engineUserMessageId: input.engineUserMessageId,
      userAttachments,
      attachmentDigest,
    });
    record.clientTurns.set(clientTurnId, {
      userMessage: input.userMessage,
      attachmentDigest,
      state: 'pending',
      promise,
    });
    try {
      const result = await promise;
      const current = record.clientTurns.get(clientTurnId);
      if (current?.state === 'pending' && current.promise === promise) {
        const acceptedAt = this.#sessionStore
          .loadAcceptedClientTurn(record.session.defSessionId, clientTurnId)?.acceptedAt
          ?? new Date(this.#clock()).toISOString();
        record.clientTurns.set(clientTurnId, {
          userMessage: input.userMessage,
          attachmentDigest,
          state: 'accepted',
          result,
          acceptedAt,
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
    input: {
      readonly clientTurnId: ClientTurnId;
      readonly userMessage: string;
      readonly engineUserMessageId?: EngineMessageId;
      readonly userAttachments: readonly EngineUserAttachment[];
      readonly attachmentDigest: string | null;
    },
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
          engineUserMessageId: input.engineUserMessageId,
          systemContext: harnessManager.buildRoutingSystemContext(),
          userMessage: input.userMessage,
          ...(input.userAttachments.length > 0 ? { userAttachments: input.userAttachments } : {}),
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
        this.#sessionStore.acceptClientTurn(record.session.defSessionId, {
          clientTurnId: input.clientTurnId,
          userMessage: input.userMessage,
          ...(input.attachmentDigest ? { attachmentDigest: input.attachmentDigest } : {}),
          result: { defTurnId, clientTurnId: input.clientTurnId },
          acceptedAt: new Date(this.#clock()).toISOString(),
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
      pendingInteractionIds: new Set(),
      responseDeltaEventsSinceFlush: 0,
      responseDeltaCodeUnitsSinceFlush: 0,
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

  listPendingInteractions(binding?: ProductBinding): readonly InteractionRequest[] {
    const pending = this.#interactionBroker.listPending();
    return pending
      .filter((entry) => {
        const record = this.#sessions.get(entry.request.defSessionId);
        return Boolean(record && (!binding || stableSessionBindingMatches(record.session, binding)));
      })
      .map((entry) => structuredClone(entry.request));
  }

  resolveInteraction(
    interactionId: InteractionId,
    input: { readonly status: InteractionResponse['status']; readonly value?: JsonValue },
    binding?: ProductBinding,
  ): InteractionResponse {
    let before: InteractionSnapshot;
    try {
      before = this.#interactionBroker.require(interactionId);
    } catch (error) {
      throw interactionHostError(error);
    }
    const record = this.#requireSession(before.request.defSessionId);
    if (binding) assertStableSessionBinding(record.session, binding);
    const active = this.#turns.get(before.request.defTurnId);
    if (!active || active.settled || active.abortRequested || this.#activeTurn !== active) {
      throw new DefAgentHostError(
        'AGENT_TURN_NOT_FOUND',
        `Interaction ${interactionId} no longer belongs to an active Turn`,
        409,
      );
    }
    const response: InteractionResponse = {
      interactionId,
      status: input.status,
      ...(Object.prototype.hasOwnProperty.call(input, 'value') ? { value: input.value } : {}),
      resolvedAt: new Date(this.#clock()).toISOString(),
    };
    let resolved: InteractionSnapshot;
    try {
      resolved = this.#interactionBroker.respond(response);
    } catch (error) {
      throw interactionHostError(error);
    }
    if (before.status === 'pending') {
      this.#append(record, {
        type: 'interaction.resolved',
        defTurnId: before.request.defTurnId,
        interactionId,
        ...(before.request.toolCallId ? { toolCallId: before.request.toolCallId } : {}),
        payload: {
          status: resolved.response!.status,
          ...(Object.prototype.hasOwnProperty.call(resolved.response!, 'value')
            ? { value: resolved.response!.value }
            : {}),
        },
      });
      this.#completeInteractionWaiter(interactionId, resolved.response!);
    }
    return structuredClone(resolved.response!);
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
    await this.#productGateway.cancelPending?.(active.defTurnId, {
      code: 'AGENT_COMMAND_CANCELLED_BY_TURN',
      message: `DEF Turn ${active.defTurnId} stopped before the Product command was delivered.`,
    });
    await this.#withTurnProtocolLock(active, async () => {
      if (active.settled) return;
      this.#cancelPendingInteractions(active, 'cancelled');
      if (active.harnessTransactionId) {
        const harnessManager = this.#requireHarnessManager();
        if (harnessManager.getTransaction(active.harnessTransactionId).status === 'active') {
          const transition = harnessManager.abort(active.harnessTransactionId, code);
          this.#appendHarnessTrace(active, transition.trace);
        }
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

  archiveSession(
    defSessionId: DefSessionId,
    binding?: ProductBinding,
    reason = 'USER_ARCHIVED',
  ): DefSessionV6 {
    this.#assertRunning();
    this.#assertInitialized();
    const record = this.#requireSession(defSessionId);
    if (binding) assertStableSessionBinding(record.session, binding);
    this.#assertSessionIdle(record, 'archive');
    if (record.session.status === 'archived') return cloneSession(record.session);
    if (record.session.status !== 'ready' && record.session.status !== 'engine-unavailable') {
      throw new DefAgentHostError(
        'AGENT_SESSION_STATE_INVALID',
        `DEF Session ${defSessionId} cannot be archived from ${record.session.status}`,
      );
    }
    this.#replaceSession(record, {
      ...record.session,
      status: 'archived',
      updatedAt: new Date(this.#clock()).toISOString(),
    });
    this.#append(record, {
      type: 'session.archived',
      payload: { reason },
    });
    if (this.#activeSessionId === defSessionId) this.#setActiveSession(null);
    return cloneSession(record.session);
  }

  async restoreSession(defSessionId: DefSessionId, binding?: ProductBinding): Promise<DefSessionV6> {
    this.#assertRunning();
    this.#assertInitialized();
    const record = this.#requireSession(defSessionId);
    if (binding) assertStableSessionBinding(record.session, binding);
    this.#assertSessionIdle(record, 'restore');
    if (record.session.status === 'ready') {
      this.#setActiveSession(defSessionId);
      return cloneSession(record.session);
    }
    if (record.session.status !== 'archived') {
      throw new DefAgentHostError(
        'AGENT_SESSION_STATE_INVALID',
        `DEF Session ${defSessionId} cannot be restored from ${record.session.status}`,
      );
    }
    let recovered;
    try {
      recovered = await this.#engine.recoverSession(record.session.engine);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.#replaceSession(record, {
        ...record.session,
        status: 'engine-unavailable',
        updatedAt: new Date(this.#clock()).toISOString(),
      });
      this.#append(record, {
        type: 'session.orphaned',
        payload: { code: 'ENGINE_RECOVERY_UNAVAILABLE', message },
      });
      throw new DefAgentHostError(
        'AGENT_SESSION_RECOVERY_FAILED',
        `DEF Session ${defSessionId} could not restore its Engine session: ${message}`,
        503,
      );
    }
    if (recovered.status !== 'recovered') {
      const code = recovered.status === 'missing' ? 'ENGINE_SESSION_MISSING' : recovered.code;
      const message = recovered.status === 'missing'
        ? 'The persisted Engine Session no longer exists'
        : recovered.message;
      this.#replaceSession(record, {
        ...record.session,
        status: 'orphaned',
        updatedAt: new Date(this.#clock()).toISOString(),
      });
      this.#append(record, {
        type: 'session.orphaned',
        payload: { code, message },
      });
      throw new DefAgentHostError(
        'AGENT_SESSION_RECOVERY_FAILED',
        `DEF Session ${defSessionId} could not restore its Engine session: ${message}`,
        409,
      );
    }
    this.#replaceSession(record, {
      ...record.session,
      status: 'ready',
      engine: recovered.ref,
      updatedAt: new Date(this.#clock()).toISOString(),
    });
    this.#setActiveSession(defSessionId);
    this.#append(record, {
      type: 'session.recovered',
      payload: {
        engineKind: recovered.ref.kind,
        engineRuntimeVersion: recovered.ref.runtimeVersion,
      },
    });
    return cloneSession(record.session);
  }

  async deleteSession(defSessionId: DefSessionId, binding?: ProductBinding): Promise<void> {
    this.#assertRunning();
    this.#assertInitialized();
    const record = this.#requireSession(defSessionId);
    if (binding) assertStableSessionBinding(record.session, binding);
    this.#assertSessionIdle(record, 'delete');
    this.#replaceSession(record, {
      ...record.session,
      status: 'deleting',
      updatedAt: new Date(this.#clock()).toISOString(),
    });
    try {
      await this.#engine.disposeSession(record.session.engine);
      this.#sessionStore.delete(defSessionId);
      this.#sessions.delete(defSessionId);
      for (const [defTurnId, settled] of this.#settledTurns) {
        if (settled.session === record) this.#settledTurns.delete(defTurnId);
      }
      if (this.#activeSessionId === defSessionId) this.#activeSessionId = null;
    } catch (error) {
      this.#replaceSession(record, {
        ...record.session,
        status: 'delete-failed',
        updatedAt: new Date(this.#clock()).toISOString(),
      });
      throw new DefAgentHostError(
        'AGENT_SESSION_DELETE_FAILED',
        `DEF Session ${defSessionId} could not be deleted: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
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

  /**
   * Complete the durable Session journal for a Product command whose browser
   * receipt arrived only after this Host recovered and interrupted its Turn.
   * The command-store result is already terminal; this method only records the
   * read-only reconciliation and is idempotent across browser retries.
   */
  recordReconciledProductCommandResult(
    command: ProductCommandEnvelope<Phase2ProductOperationSchema>,
    result: ProductCommandResult,
  ): boolean {
    this.#assertRunning();
    this.#assertInitialized();
    if (result.commandId !== command.commandId) {
      throw new DefAgentHostError(
        'AGENT_COMMAND_CONFLICT',
        `Product command result does not match ${command.commandId}`,
      );
    }
    const record = this.#sessions.get(command.defSessionId);
    if (!record) return false;
    const alreadyTerminal = record.events.some((event) => (
      (event.type === 'command.result'
        || event.type === 'command.reconciled'
        || event.type === 'command.orphaned')
      && event.commandId === command.commandId
    ));
    if (alreadyTerminal) return false;
    const queued = record.events.find((event): event is Extract<DefEvent, { type: 'command.queued' }> => (
      event.type === 'command.queued'
      && event.commandId === command.commandId
      && event.defTurnId === command.defTurnId
      && event.toolCallId === command.toolCallId
    ));
    const interrupted = record.events.some((event) => (
      event.type === 'turn.interrupted'
      && event.defTurnId === command.defTurnId
      && event.payload.reconcileRequiredCommandIds.includes(command.commandId)
    ));
    if (!queued || !interrupted) return false;
    if (
      queued.payload.workspaceId !== command.expected.workspaceId
      || queued.payload.databaseGeneration !== command.expected.databaseGeneration
      || queued.payload.timelineId !== command.expected.timelineId
      || queued.payload.checkoutTargetId !== command.expected.checkoutTargetId
      || queued.payload.beforeRevision !== command.expected.contentRevision
    ) {
      throw new DefAgentHostError(
        'AGENT_COMMAND_CONFLICT',
        `Recovered Product command ${command.commandId} does not match the Session journal`,
      );
    }
    const receipt = (result.browserResult ?? result.visiblePostcondition ?? null) as JsonValue;
    const browserReceiptDigest = createHash('sha256')
      .update(canonicalJson(receipt))
      .digest('hex');
    this.#append(record, {
      type: 'command.reconciled',
      defTurnId: command.defTurnId,
      toolCallId: command.toolCallId,
      commandId: command.commandId,
      ...(queued.interactionId ? { interactionId: queued.interactionId } : {}),
      payload: {
        workspaceId: command.expected.workspaceId,
        databaseGeneration: command.expected.databaseGeneration,
        timelineId: command.expected.timelineId,
        checkoutTargetId: command.expected.checkoutTargetId,
        beforeRevision: command.expected.contentRevision,
        status: result.status,
        afterRevision: result.afterRevision,
        browserReceiptDigest,
        ...(result.code ? { code: result.code } : {}),
        ...(result.message ? { message: result.message } : {}),
      },
    });
    return true;
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
          const risk = this.#toolRegistry?.resolveDescriptor(event.name)?.risk ?? 'read';
          this.#append(active.session, {
            type: 'tool.requested',
            defTurnId: active.defTurnId,
            toolCallId: event.toolCallId,
            payload: { name: event.name, risk, input: event.input },
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
          const harnessManager = this.#requireHarnessManager();
          if (harnessManager.getTransaction(active.harnessTransactionId).status === 'active') {
            const transition = harnessManager.abort(active.harnessTransactionId, failureCode);
            this.#appendHarnessTrace(active, transition.trace);
          }
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
        const descriptor = toolRegistry.resolveDescriptor(event.name);
        if (!descriptor) {
          throw new DefAgentHostError('AGENT_TOOL_UNSUPPORTED', `Unsupported DEF Tool: ${event.name}`);
        }
        prepared = {
          status: 'succeeded',
          result: descriptor.risk === 'read'
            ? await toolRegistry.executeRead(event.name, event.input, {
              defSessionId: active.session.session.defSessionId,
              defTurnId: active.defTurnId,
              toolCallId: event.toolCallId,
              binding: active.session.binding,
              product: this.#productGateway,
              abortSignal: active.abortController.signal,
            })
            : await this.#executeInteractiveTool(active, event, await toolRegistry.prepareInteractive(
              event.name,
              event.input,
              {
                defSessionId: active.session.session.defSessionId,
                defTurnId: active.defTurnId,
                toolCallId: event.toolCallId,
                binding: active.session.binding,
                product: this.#productGateway,
                abortSignal: active.abortController.signal,
              },
            )),
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

  async #executeInteractiveTool(
    active: ActiveTurn,
    event: Extract<EngineEvent, { type: 'tool.requested' }>,
    plan: DefInteractiveToolPlan,
  ): Promise<JsonValue> {
    if (active.abortController.signal.aborted) {
      throw new DefToolExecutionError('DEF_TOOL_ABORTED', 'DEF Tool execution was aborted');
    }

    if (plan.kind === 'question') {
      const interactionId = this.#ids.interaction();
      const createdAt = new Date(this.#clock()).toISOString();
      const response = await this.#requestInteraction(active, {
        interactionId,
        defSessionId: active.session.session.defSessionId,
        defTurnId: active.defTurnId,
        toolCallId: event.toolCallId,
        kind: 'question',
        prompt: plan.prompt,
        ...(plan.details ? { details: structuredClone(plan.details) } : {}),
        createdAt,
        expiresAt: new Date(this.#clock() + INTERACTION_TIMEOUT_MS).toISOString(),
      });
      if (response.status !== 'answered') throw interactionToolFailure(response);
      return {
        contract: 'DefQuestionAnswerV1',
        interactionId,
        answer: Object.prototype.hasOwnProperty.call(response, 'value') ? response.value! : null,
      };
    }

    const snapshot = await this.#productGateway.getSnapshot(active.session.binding);
    if (plan.kind === 'command') {
      return this.#dispatchProductCommand(active, event, {
        expected: snapshot.binding,
        command: plan.command,
        ...(plan.visiblePostcondition ? { visiblePostcondition: plan.visiblePostcondition } : {}),
      });
    }

    const interactionId = this.#ids.interaction();
    const createdAt = new Date(this.#clock()).toISOString();
    const proposalHash = createHash('sha256')
      .update(canonicalJson(plan.proposal))
      .digest('hex');
    const request: InteractionRequest = {
      interactionId,
      defSessionId: active.session.session.defSessionId,
      defTurnId: active.defTurnId,
      toolCallId: event.toolCallId,
      kind: 'approval',
      prompt: plan.prompt,
      proposalHash,
      binding: { ...snapshot.binding },
      scope: [...plan.scope],
      proposal: structuredClone(plan.proposal),
      createdAt,
      expiresAt: new Date(this.#clock() + INTERACTION_TIMEOUT_MS).toISOString(),
    };
    const response = await this.#requestInteraction(active, request);
    if (response.status !== 'approved') throw interactionToolFailure(response);

    // Re-read the exact approved binding immediately before dispatch. Any edit
    // made while the approval card was open invalidates the proposal fail-closed.
    await this.#productGateway.getSnapshot(request.binding);
    const commandId = this.#ids.command();
    let approvalCapability: string;
    try {
      const claims = this.#interactionBroker.issueApprovalCapability(interactionId, commandId);
      this.#interactionBroker.consumeApprovalCapability(claims, {
        interactionId,
        commandId,
        defSessionId: active.session.session.defSessionId,
        defTurnId: active.defTurnId,
        toolCallId: event.toolCallId,
        proposalHash,
        binding: request.binding,
        scope: request.scope,
      });
      approvalCapability = this.#approvalCapabilitySigner.sign(claims);
    } catch (error) {
      throw interactionHostError(error);
    }
    return this.#dispatchProductCommand(active, event, {
      commandId,
      interactionId,
      expected: request.binding,
      command: plan.command,
      approvalCapability,
      ...(plan.visiblePostcondition ? { visiblePostcondition: plan.visiblePostcondition } : {}),
    });
  }

  #requestInteraction(
    active: ActiveTurn,
    request: InteractionRequest,
  ): Promise<InteractionResponse> {
    let registered: InteractionSnapshot;
    try {
      registered = this.#interactionBroker.register(request);
    } catch (error) {
      throw interactionHostError(error);
    }
    this.#append(active.session, {
      type: 'interaction.requested',
      defTurnId: active.defTurnId,
      interactionId: request.interactionId,
      ...(request.toolCallId ? { toolCallId: request.toolCallId } : {}),
      payload: {
        kind: request.kind,
        prompt: request.prompt,
        expiresAt: request.expiresAt,
      },
    });
    if (registered.response) {
      this.#append(active.session, {
        type: 'interaction.resolved',
        defTurnId: active.defTurnId,
        interactionId: request.interactionId,
        ...(request.toolCallId ? { toolCallId: request.toolCallId } : {}),
        payload: {
          status: registered.response.status,
          ...(Object.prototype.hasOwnProperty.call(registered.response, 'value')
            ? { value: registered.response.value }
            : {}),
        },
      });
      return Promise.resolve(registered.response);
    }
    active.pendingInteractionIds.add(request.interactionId);
    const delay = Math.max(0, Date.parse(request.expiresAt) - this.#clock());
    return new Promise<InteractionResponse>((resolve) => {
      const timer = setTimeout(() => {
        const current = this.#interactionBroker.get(request.interactionId);
        if (!current) return;
        let expired = current;
        if (current.status === 'pending') {
          try {
            expired = this.#interactionBroker.expire(request.interactionId);
          } catch {
            return;
          }
        }
        if (!expired.response) return;
        if (!active.settled) {
          this.#append(active.session, {
            type: 'interaction.resolved',
            defTurnId: active.defTurnId,
            interactionId: request.interactionId,
            ...(request.toolCallId ? { toolCallId: request.toolCallId } : {}),
            payload: { status: expired.response.status },
          });
        }
        this.#completeInteractionWaiter(request.interactionId, expired.response);
      }, delay);
      timer.unref?.();
      this.#interactionWaiters.set(request.interactionId, { resolve, timer });
    });
  }

  #completeInteractionWaiter(
    interactionId: InteractionId,
    response: InteractionResponse,
  ): void {
    const waiter = this.#interactionWaiters.get(interactionId);
    if (!waiter) return;
    if (waiter.timer) clearTimeout(waiter.timer);
    this.#interactionWaiters.delete(interactionId);
    for (const active of this.#turns.values()) active.pendingInteractionIds.delete(interactionId);
    waiter.resolve(structuredClone(response));
  }

  #cancelPendingInteractions(
    active: ActiveTurn,
    status: 'cancelled' | 'stale',
  ): void {
    for (const interactionId of [...active.pendingInteractionIds]) {
      const current = this.#interactionBroker.get(interactionId);
      if (!current) {
        active.pendingInteractionIds.delete(interactionId);
        continue;
      }
      let resolved = current;
      if (current.status === 'pending') {
        try {
          resolved = status === 'cancelled'
            ? this.#interactionBroker.cancel(interactionId)
            : this.#interactionBroker.stale(interactionId);
        } catch {
          continue;
        }
      }
      if (resolved.response) {
        this.#append(active.session, {
          type: 'interaction.resolved',
          defTurnId: active.defTurnId,
          interactionId,
          ...(current.request.toolCallId ? { toolCallId: current.request.toolCallId } : {}),
          payload: { status: resolved.response.status },
        });
        this.#completeInteractionWaiter(interactionId, resolved.response);
      }
    }
  }

  async #dispatchProductCommand(
    active: ActiveTurn,
    event: Extract<EngineEvent, { type: 'tool.requested' }>,
    input: {
      readonly commandId?: CommandId;
      readonly interactionId?: InteractionId;
      readonly expected: ProductBinding;
      readonly command: JsonObject;
      readonly approvalCapability?: string;
      readonly visiblePostcondition?: JsonObject;
    },
  ): Promise<JsonValue> {
    const commandId = input.commandId ?? this.#ids.command();
    const command: ProductCommandEnvelope<Phase2ProductOperationSchema> = {
      protocolVersion: 1,
      commandId,
      defSessionId: active.session.session.defSessionId,
      defTurnId: active.defTurnId,
      toolCallId: event.toolCallId,
      expected: input.expected,
      command: {
        op: 'workbench.execute-command',
        payload: {
          command: structuredClone(input.command),
          ...(input.visiblePostcondition
            ? { visiblePostcondition: structuredClone(input.visiblePostcondition) }
            : {}),
        },
      },
      ...(input.approvalCapability ? { approvalCapability: input.approvalCapability } : {}),
    };
    const correlation = {
      defTurnId: active.defTurnId,
      toolCallId: event.toolCallId,
      commandId,
      ...(input.interactionId ? { interactionId: input.interactionId } : {}),
    };
    const bindingPayload = {
      workspaceId: input.expected.workspaceId,
      databaseGeneration: input.expected.databaseGeneration,
      timelineId: input.expected.timelineId,
      checkoutTargetId: input.expected.checkoutTargetId,
      beforeRevision: input.expected.contentRevision,
    };
    let resultObserved = false;

    try {
      await this.#productGateway.dispatch(command);
      this.#append(active.session, {
        type: 'command.queued',
        ...correlation,
        payload: {
          ...bindingPayload,
          op: command.command.op,
          afterRevision: null,
          browserReceiptDigest: null,
        },
      });
      this.#append(active.session, {
        type: 'command.dispatched',
        ...correlation,
        payload: {
          ...bindingPayload,
          op: command.command.op,
          afterRevision: null,
          browserReceiptDigest: null,
        },
      });

      const wait = this.#productGateway
        .awaitResult(commandId, { timeoutMs: PRODUCT_COMMAND_TIMEOUT_MS })
        .then((result) => ({ kind: 'result' as const, result }))
        .catch((error: unknown) => ({ kind: 'error' as const, error }));
      const outcome = await Promise.race([
        wait,
        active.cancelled.then(() => ({ kind: 'cancelled' as const })),
      ]);
      if (outcome.kind === 'cancelled') {
        throw new DefToolExecutionError('DEF_TOOL_ABORTED', 'Product command was cancelled with the Turn');
      }
      if (outcome.kind === 'error') {
        const reconciled = await this.#productGateway.reconcile(commandId).catch(() => null);
        if (reconciled) {
          resultObserved = true;
          return this.#finishProductCommand(active, correlation, bindingPayload, reconciled);
        }
        throw outcome.error;
      }
      resultObserved = true;
      return this.#finishProductCommand(active, correlation, bindingPayload, outcome.result);
    } catch (error) {
      if (
        !resultObserved
        && !(error instanceof DefToolExecutionError && error.code === 'DEF_TOOL_ABORTED')
      ) {
        this.#append(active.session, {
          type: 'command.orphaned',
          ...correlation,
          payload: {
            ...bindingPayload,
            code: error instanceof DefAgentHostError ? error.code : 'PRODUCT_COMMAND_FAILED',
            message: error instanceof Error ? error.message : String(error),
            afterRevision: null,
            browserReceiptDigest: null,
          },
        });
      }
      if (error instanceof DefToolExecutionError) throw error;
      throw new DefToolExecutionError(
        'DEF_PRODUCT_COMMAND_FAILED',
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  #finishProductCommand(
    active: ActiveTurn,
    correlation: {
      readonly defTurnId: DefTurnId;
      readonly toolCallId: Extract<EngineEvent, { type: 'tool.requested' }>['toolCallId'];
      readonly commandId: CommandId;
      readonly interactionId?: InteractionId;
    },
    bindingPayload: {
      readonly workspaceId: ProductBinding['workspaceId'];
      readonly databaseGeneration: ProductBinding['databaseGeneration'];
      readonly timelineId: ProductBinding['timelineId'];
      readonly checkoutTargetId: string | null;
      readonly beforeRevision: number;
    },
    result: ProductCommandResult,
  ): JsonValue {
    const receipt = (result.browserResult ?? result.visiblePostcondition ?? null) as JsonValue;
    const browserReceiptDigest = createHash('sha256')
      .update(canonicalJson(receipt))
      .digest('hex');
    this.#append(active.session, {
      type: 'command.result',
      ...correlation,
      payload: {
        ...bindingPayload,
        status: result.status,
        afterRevision: result.afterRevision,
        browserReceiptDigest,
        ...(result.code ? { code: result.code } : {}),
        ...(result.message ? { message: result.message } : {}),
      },
    });
    if (result.status !== 'succeeded' && result.status !== 'committed') {
      throw new DefToolExecutionError(
        'DEF_PRODUCT_COMMAND_FAILED',
        result.message ?? `Product command ended as ${result.status}`,
        JSON.parse(JSON.stringify(result)) as JsonValue,
      );
    }
    return {
      contract: 'DefProductCommandResultV1',
      commandId: result.commandId,
      status: result.status,
      beforeRevision: result.beforeRevision,
      afterRevision: result.afterRevision,
      browserResult: result.browserResult ?? null,
      visiblePostcondition: result.visiblePostcondition ?? null,
    };
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
          if (transaction.status === 'active') {
            const transition = harnessManager.abort(active.harnessTransactionId, code);
            this.#appendHarnessTrace(active, transition.trace);
          }
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
        const harnessManager = this.#requireHarnessManager();
        if (harnessManager.getTransaction(active.harnessTransactionId).status === 'active') {
          const transition = harnessManager.abort(active.harnessTransactionId, event.code);
          this.#appendHarnessTrace(active, transition.trace);
        }
      }
      return this.#append(active.session, {
        type: 'turn.failed',
        defTurnId: active.defTurnId,
        payload: { code: event.code, message: event.message },
      });
    }
    if (event.type === 'turn.aborted') {
      if (active.harnessTransactionId) {
        const harnessManager = this.#requireHarnessManager();
        if (harnessManager.getTransaction(active.harnessTransactionId).status === 'active') {
          const transition = harnessManager.abort(active.harnessTransactionId, event.reason.code);
          this.#appendHarnessTrace(active, transition.trace);
        }
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
    this.#sessionStore.append(record.session.defSessionId, envelope);
    record.sequence = nextSequence;
    record.eventCodeUnits += eventCodeUnits;
    record.events.push(envelope);
    if (envelope.type === 'response.delta' && active) {
      active.responseDeltaEventsSinceFlush += 1;
      active.responseDeltaCodeUnitsSinceFlush += eventCodeUnits;
      if (
        active.responseDeltaEventsSinceFlush >= RESPONSE_DELTA_FLUSH_EVENT_INTERVAL
        || active.responseDeltaCodeUnitsSinceFlush >= RESPONSE_DELTA_FLUSH_CODE_UNITS
      ) {
        this.#sessionStore.flush?.(record.session.defSessionId);
        active.responseDeltaEventsSinceFlush = 0;
        active.responseDeltaCodeUnitsSinceFlush = 0;
      }
    } else if (active) {
      // Every non-delta append is synchronously durable in the file store and
      // therefore also flushes any response.delta bytes that precede it.
      active.responseDeltaEventsSinceFlush = 0;
      active.responseDeltaCodeUnitsSinceFlush = 0;
    }
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

  #requireToolRegistry(): DefWorkbenchToolRegistry {
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

  #assertInitialized(): void {
    if (!this.#initialized) {
      throw new DefAgentHostError(
        'AGENT_SESSION_RECOVERY_FAILED',
        'Persisted DEF Sessions must be recovered before the Host can accept mutations',
        503,
      );
    }
  }

  #assertTurnAvailable(): void {
    if (this.#activeTurn || this.#startingTurn) {
      throw new DefAgentHostError('AGENT_TURN_BUSY', 'The workbench already has an active or starting turn');
    }
  }

  #assertSessionCanStartTurn(record: SessionRecord, userMessage: string): void {
    if (record.session.status !== 'ready') {
      throw new DefAgentHostError(
        'AGENT_SESSION_STATE_INVALID',
        `DEF Session ${record.session.defSessionId} cannot start a Turn from ${record.session.status}`,
      );
    }
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
    this.#setActiveSession(record.session.defSessionId);
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
    if (starting.abortCode === 'BROWSER_CONSUMER_LOST') {
      if (consumerError instanceof DefAgentHostError) {
        return { code: starting.abortCode, error: consumerError };
      }
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

  #assertSessionIdle(record: SessionRecord, action: string): void {
    if (
      this.#startingTurn?.session === record
      || (this.#activeTurn?.session === record && !this.#activeTurn.settled)
    ) {
      throw new DefAgentHostError(
        'AGENT_TURN_BUSY',
        `DEF Session ${record.session.defSessionId} cannot ${action} while its Turn is active`,
      );
    }
    const pending = this.#interactionBroker.listPending().some(
      (entry) => entry.request.defSessionId === record.session.defSessionId,
    );
    if (pending) {
      throw new DefAgentHostError(
        'AGENT_INTERACTION_CONFLICT',
        `DEF Session ${record.session.defSessionId} cannot ${action} while an interaction is pending`,
      );
    }
  }

  #touchSession(record: SessionRecord): void {
    this.#replaceSession(record, {
      ...record.session,
      lastDatabaseGeneration: record.binding.databaseGeneration,
      boundNodeId: record.binding.checkoutTargetId,
      updatedAt: new Date(this.#clock()).toISOString(),
    });
  }

  #setActiveSession(defSessionId: DefSessionId | null): void {
    this.#sessionStore.setActive(defSessionId);
    this.#activeSessionId = defSessionId;
  }

  #replaceSession(record: SessionRecord, session: DefSessionV6): void {
    const previous = record.session;
    record.session = session;
    try {
      this.#sessionStore.update(this.#toStoredRecord(record));
    } catch (error) {
      record.session = previous;
      throw error;
    }
  }

  #persistRecord(record: SessionRecord): void {
    this.#sessionStore.update(this.#toStoredRecord(record));
  }

  #toStoredRecord(record: SessionRecord): DefAgentSessionRecord {
    const acceptedClientTurns: DefAcceptedClientTurn[] = [];
    for (const [clientTurnId, turn] of record.clientTurns) {
      if (turn.state !== 'accepted') continue;
      acceptedClientTurns.push({
        clientTurnId,
        userMessage: turn.userMessage,
        ...(turn.attachmentDigest ? { attachmentDigest: turn.attachmentDigest } : {}),
        result: structuredClone(turn.result),
        acceptedAt: turn.acceptedAt,
      });
    }
    return {
      session: cloneSession(record.session),
      binding: structuredClone(record.binding),
      providerProfileRef: record.providerProfileRef,
      acceptedClientTurns,
    };
  }
}

function cloneUserAttachments(
  attachments: readonly EngineUserAttachment[] | undefined,
): readonly EngineUserAttachment[] {
  return (attachments ?? []).map((attachment) => ({
    type: 'file',
    mime: attachment.mime,
    filename: attachment.filename,
    url: attachment.url,
  }));
}

function digestUserAttachments(attachments: readonly EngineUserAttachment[]): string | null {
  if (attachments.length === 0) return null;
  const value: JsonValue = attachments.map((attachment) => ({
    type: attachment.type,
    mime: attachment.mime,
    filename: attachment.filename,
    url: attachment.url,
  }));
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function isTerminalReserveEvent(event: DefEvent): boolean {
  if (
    event.type === 'session.recovered'
    || event.type === 'session.archived'
    || event.type === 'session.orphaned'
    || event.type === 'turn.completed'
    || event.type === 'turn.stopped'
    || event.type === 'turn.interrupted'
    || event.type === 'turn.failed'
    || event.type === 'command.result'
    || event.type === 'command.reconciled'
    || event.type === 'command.orphaned'
    || event.type === 'harness.terminal'
  ) return true;
  return event.type === 'harness.tool.projected' && event.payload.tools.length === 0;
}

function isTurnTerminalEvent(event: DefEvent): event is Extract<DefEvent, {
  type: 'turn.completed' | 'turn.stopped' | 'turn.interrupted' | 'turn.failed';
}> {
  return event.type === 'turn.completed'
    || event.type === 'turn.stopped'
    || event.type === 'turn.interrupted'
    || event.type === 'turn.failed';
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

function interactionToolFailure(response: InteractionResponse): DefToolExecutionError {
  if (response.status === 'rejected') {
    return new DefToolExecutionError('DEF_INTERACTION_REJECTED', '用户拒绝了这项 AI 修改');
  }
  if (response.status === 'cancelled') {
    return new DefToolExecutionError('DEF_INTERACTION_CANCELLED', '用户取消了这次 AI 交互');
  }
  if (response.status === 'expired') {
    return new DefToolExecutionError('DEF_INTERACTION_EXPIRED', 'AI 交互等待用户响应超时');
  }
  if (response.status === 'stale') {
    return new DefToolExecutionError('DEF_INTERACTION_STALE', 'AI 交互绑定的工作区状态已经失效');
  }
  return new DefToolExecutionError(
    'DEF_INTERACTION_REJECTED',
    `AI 交互以不适用的状态结束：${response.status}`,
  );
}

function interactionHostError(error: unknown): DefAgentHostError {
  if (!(error instanceof InteractionBrokerError)) {
    return new DefAgentHostError(
      'AGENT_INTERACTION_INVALID',
      error instanceof Error ? error.message : String(error),
      400,
    );
  }
  if (error.code === 'INTERACTION_NOT_FOUND') {
    return new DefAgentHostError('AGENT_INTERACTION_NOT_FOUND', error.message, 404);
  }
  if (
    error.code === 'INTERACTION_REQUEST_INVALID'
    || error.code === 'INTERACTION_RESPONSE_INVALID'
    || error.code === 'INTERACTION_KIND_MISMATCH'
    || error.code === 'INTERACTION_BROKER_CONFIG_INVALID'
  ) {
    return new DefAgentHostError('AGENT_INTERACTION_INVALID', error.message, 400);
  }
  return new DefAgentHostError('AGENT_INTERACTION_CONFLICT', error.message, 409);
}
