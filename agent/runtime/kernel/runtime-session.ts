/**
 * Minimal Runtime Session lifecycle facade.
 *
 * This module owns orchestration only.  P2 assembles one run, P3 owns the
 * append-only transcript, P5 owns context/compaction, and P6 owns Tool
 * settlement.  The facade wires those contracts together without recreating
 * any of their state machines.
 */
import { randomUUID } from 'node:crypto';
import { dirname } from 'node:path';
import type { ClientTurnId, DefSessionId, DefTurnId } from '../../core/contracts/ids.ts';
import { asClientTurnId, asDefSessionId, asDefTurnId } from '../../core/contracts/ids.ts';
import type { JsonObject, JsonValue } from '../../core/contracts/json.ts';
import {
  asRuntimeContentId,
  asRuntimeEntryId,
  asRuntimeMessageId,
  asRuntimeRunId,
  asRuntimeSessionId,
  asRuntimeTurnId,
  type RuntimeEntryId,
  type RuntimeRunId,
  type RuntimeSessionId,
  type RuntimeTurnId,
} from './ids.ts';
import {
  runAgentLoop,
  type AgentLoopResult,
} from './agent-loop.ts';
import type {
  RuntimeAssistantMessage,
  RuntimeMessage,
  RuntimeToolResultMessage,
  RuntimeUserContent,
  RuntimeUserMessage,
  RuntimeUsage,
} from './messages.ts';
import type {
  ModelDriver,
  RuntimeModelConnection,
} from './provider/model-driver.ts';
import type {
  RuntimeEvent,
  RuntimeEventListener,
  RuntimeRunTerminal,
} from './stream-events.ts';
import type {
  RuntimeToolBridge,
  RuntimeToolProjection,
} from './tool.ts';
import { toRuntimeToolProjection } from './tool-projection.ts';
import {
  buildContext,
  projectSessionContext,
  type BuiltRuntimeContext,
  type RuntimeContextInstructions,
  type RuntimeProductContext,
} from './session/context-builder.ts';
import {
  checkCompactionThreshold,
  compactSession,
  type CompactionOutcome,
} from './session/compaction.ts';
import {
  isContextOverflow,
  runWithContextRecovery,
} from './session/context-recovery.ts';
import type {
  RuntimeRunMarkerEntry,
  RuntimeSessionEntry,
  RuntimeSessionHeader,
} from './session/entries.ts';
import {
  createSessionLog,
  reopenSessionLog,
  type SessionLog,
} from './session/session-log.ts';

const DEFAULT_RUNTIME_VERSION = 'def-runtime-v1';
const DEFAULT_PROVIDER_PROFILE_REF = 'provider-profile-unknown';
const DEFAULT_SYSTEM_PROMPT_VERSION = 'system-prompt-unknown';

export type RuntimeSessionState = 'open' | 'closed';

export interface RuntimeSessionContext extends RuntimeContextInstructions {
  /** Alias accepted by adapters that call the stable prompt `systemPrompt`. */
  readonly systemPrompt?: string;
  readonly product?: RuntimeProductContext;
}

export type RuntimeSessionContextSource =
  | RuntimeSessionContext
  | (() => RuntimeSessionContext | Promise<RuntimeSessionContext>);

export type RuntimeSessionConnectionSource =
  | RuntimeModelConnection
  | (() => RuntimeModelConnection | Promise<RuntimeModelConnection>);

export type RuntimeSessionToolProjectionSource =
  | RuntimeToolProjection
  | (() => RuntimeToolProjection | Promise<RuntimeToolProjection>);

export type RuntimeSessionToolBridgeSource =
  | RuntimeToolBridge
  | (() => RuntimeToolBridge | Promise<RuntimeToolBridge>);

export interface RuntimeSessionCreateOptions {
  readonly filePath?: string;
  readonly path?: string;
  readonly rootDir?: string;
  readonly header?: RuntimeSessionHeader;
  readonly runtimeSessionId?: RuntimeSessionId | string;
  readonly defSessionId?: DefSessionId | string;
  readonly runtimeVersion?: string;
  readonly providerProfileRef?: string;
  readonly systemPromptVersion?: string;
  readonly createdAt?: string;

  readonly modelDriver: ModelDriver;
  readonly connection: RuntimeSessionConnectionSource;
  readonly toolBridge: RuntimeSessionToolBridgeSource;
  readonly toolProjection?: RuntimeSessionToolProjectionSource;

  readonly context?: RuntimeSessionContextSource;
  readonly contextSource?: RuntimeSessionContextSource;
  readonly contextProvider?: RuntimeSessionContextSource;
  readonly stableSystemPrompt?: string;
  readonly systemPrompt?: string;
  readonly defInstructions?: string;
  readonly harnessInstructions?: string;

  readonly maxTurns?: number;
  readonly thresholdRatio?: number;
  readonly thresholdTokens?: number;
  readonly reserveTokens?: number;
  readonly retainLastMessages?: number;
  readonly retainTokens?: number;
  readonly now?: () => string;
  readonly listeners?: readonly RuntimeEventListener[];
  readonly markerListeners?: readonly RuntimeRunMarkerListener[];
}

export interface RuntimeStartTurnInput {
  readonly defTurnId: DefTurnId | string;
  readonly clientTurnId?: ClientTurnId | string;
  readonly text?: string;
  readonly prompt?: string;
  readonly message?: string;
  readonly content?: readonly RuntimeUserContent[];
  readonly userMessage?: RuntimeUserMessage | string;
  readonly messageId?: string;
  readonly turnId?: RuntimeTurnId | string;
  readonly runId?: RuntimeRunId | string;
  readonly signal?: AbortSignal;
  readonly maxTurns?: number;
  readonly contextLimit?: number;
  readonly thresholdRatio?: number;
  readonly thresholdTokens?: number;
  readonly reserveTokens?: number;
  readonly currentInputTokens?: number;
  readonly currentUsage?: RuntimeUsage;
}

export interface RuntimeSteerInput {
  readonly clientTurnId: ClientTurnId | string;
  readonly text: string;
}

export interface RuntimeCompactInput {
  readonly reason?: 'manual' | 'threshold' | 'overflow';
  readonly summary?: string;
  readonly summarize?: (
    prompt: string,
    signal: AbortSignal,
    messages: readonly RuntimeMessage[],
  ) => Promise<string> | string;
  readonly firstKeptEntryId?: RuntimeEntryId;
  readonly retainLastMessages?: number;
  readonly retainTokens?: number;
  readonly currentInputTokens?: number;
  readonly currentUsage?: RuntimeUsage;
  readonly contextLimit?: number;
  readonly thresholdTokens?: number;
  readonly thresholdRatio?: number;
  readonly reserveTokens?: number;
}

export interface RuntimeTranscriptSnapshot {
  readonly header: RuntimeSessionHeader;
  readonly entries: readonly RuntimeSessionEntry[];
  readonly updatedAt: string;
  readonly leafId: RuntimeEntryId | null;
  readonly interruptedRuns: ReturnType<SessionLog['getInterruptedRuns']>;
  readonly messages: readonly RuntimeMessage[];
}

export interface RuntimeRunResult extends AgentLoopResult {
  readonly runId: RuntimeRunId;
  readonly defTurnId: DefTurnId;
  readonly context: BuiltRuntimeContext;
  readonly attempt: number;
}

export interface RuntimeRunHandle {
  readonly runId: RuntimeRunId;
  readonly defTurnId: DefTurnId;
  readonly result: Promise<RuntimeRunResult>;
  readonly promise: Promise<RuntimeRunResult>;
  readonly completion: Promise<RuntimeRunResult>;
  steer(input: RuntimeSteerInput): Promise<void>;
  abort(reason?: RuntimeAbortReason): Promise<RuntimeRunTerminal>;
  waitForIdle(): Promise<void>;
}

export interface RuntimeAbortReason {
  readonly code: string;
  readonly message?: string;
}

export type RuntimeRunMarkerListener = (
  marker: RuntimeRunMarkerEntry,
) => void | Promise<void>;

export class RuntimeSessionError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'RuntimeSessionError';
    this.code = code;
  }
}

class RuntimeContextOverflow extends Error {
  readonly result: RuntimeRunResult;

  constructor(result: RuntimeRunResult) {
    super('The Runtime context exceeded the Provider window.');
    this.name = 'RuntimeContextOverflow';
    this.result = result;
  }
}

interface NormalizedTurnInput {
  readonly defTurnId: DefTurnId;
  readonly clientTurnId?: ClientTurnId;
  readonly text?: string;
  readonly content?: readonly RuntimeUserContent[];
  readonly userMessage?: RuntimeUserMessage;
  readonly messageId?: string;
  readonly turnId?: RuntimeTurnId;
  readonly runId?: RuntimeRunId;
  readonly signal?: AbortSignal;
  readonly maxTurns?: number;
  readonly contextLimit?: number;
  readonly thresholdRatio?: number;
  readonly thresholdTokens?: number;
  readonly reserveTokens?: number;
  readonly currentInputTokens?: number;
  readonly currentUsage?: {
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly totalTokens: number;
  };
}

interface NormalizedOptions {
  readonly filePath: string;
  readonly rootDir: string;
  readonly header: RuntimeSessionHeader;
  readonly modelDriver: ModelDriver;
  readonly connection: RuntimeSessionConnectionSource;
  readonly toolBridge: RuntimeSessionToolBridgeSource;
  readonly toolProjection?: RuntimeSessionToolProjectionSource;
  readonly context: RuntimeSessionContextSource;
  readonly maxTurns?: number;
  readonly thresholdRatio?: number;
  readonly thresholdTokens?: number;
  readonly reserveTokens?: number;
  readonly retainLastMessages?: number;
  readonly retainTokens?: number;
  readonly now: () => string;
  readonly listeners: readonly RuntimeEventListener[];
  readonly markerListeners: readonly RuntimeRunMarkerListener[];
}

interface ActiveRun {
  readonly input: NormalizedTurnInput;
  readonly abortController: AbortController;
  readonly bridgeSet: Set<RuntimeToolBridge>;
  readonly externalSignalCleanup?: () => void;
  readonly firstRunId: RuntimeRunId;
  readonly steeringQueue: RuntimeUserMessage[];
  readonly steeringByClientTurnId: Map<string, RuntimeUserMessage>;
  result: Promise<RuntimeRunResult>;
  attempts: number;
  steeringSequence: number;
  acceptingSteering: boolean;
  lastRunId?: RuntimeRunId;
  lastResult?: RuntimeRunResult;
  lastContext?: BuiltRuntimeContext;
}

interface ActiveCompaction {
  readonly controller: AbortController;
  readonly promise: Promise<CompactionOutcome>;
}

interface ProjectedBridge extends RuntimeToolBridge {
  readonly projection?: RuntimeToolProjection;
}

class RuntimeRunHandleImpl implements RuntimeRunHandle {
  readonly runId: RuntimeRunId;
  readonly defTurnId: DefTurnId;
  private readonly session: RuntimeSession;
  private readonly active: ActiveRun;

  constructor(
    session: RuntimeSession,
    active: ActiveRun,
    runId: RuntimeRunId,
    defTurnId: DefTurnId,
  ) {
    this.session = session;
    this.active = active;
    this.runId = runId;
    this.defTurnId = defTurnId;
  }

  get result(): Promise<RuntimeRunResult> {
    return this.active.result;
  }

  get promise(): Promise<RuntimeRunResult> {
    return this.active.result;
  }

  get completion(): Promise<RuntimeRunResult> {
    return this.active.result;
  }

  steer(input: RuntimeSteerInput): Promise<void> {
    return this.session.steer(input, this.active.firstRunId);
  }

  abort(reason?: RuntimeAbortReason): Promise<RuntimeRunTerminal> {
    return this.session.abort(reason);
  }

  waitForIdle(): Promise<void> {
    return this.session.waitForIdle();
  }
}

export class RuntimeSession {
  readonly id: RuntimeSessionId;

  #log: SessionLog;
  #options: NormalizedOptions;
  #state: RuntimeSessionState = 'open';
  #active: ActiveRun | undefined;
  #activeCompaction: ActiveCompaction | undefined;
  #closePromise: Promise<void> | undefined;
  #eventSequence = 0;
  #knownBridges = new Set<RuntimeToolBridge>();
  readonly #listeners = new Set<RuntimeEventListener>();
  readonly #markerListeners = new Set<RuntimeRunMarkerListener>();

  private constructor(log: SessionLog, options: NormalizedOptions) {
    this.#log = log;
    this.#options = options;
    this.id = log.header.runtimeSessionId;
    for (const listener of options.listeners) this.#listeners.add(listener);
    for (const listener of options.markerListeners) this.#markerListeners.add(listener);
  }

  static create(options: RuntimeSessionCreateOptions): RuntimeSession {
    const normalized = normalizeOptions(options);
    const log = createSessionLog(normalized.filePath, normalized.header, { rootDir: normalized.rootDir });
    return new RuntimeSession(log, normalized);
  }

  static recover(options: RuntimeSessionCreateOptions): RuntimeSession {
    const filePath = options.filePath ?? options.path;
    if (!filePath) throw new RuntimeSessionError('RUNTIME_SESSION_PATH_INVALID', 'Runtime Session file path is required.');
    const rootDir = options.rootDir ?? dirname(filePath);
    const log = reopenSessionLog(filePath, { rootDir });
    const normalized = normalizeOptions({ ...options, header: options.header ?? log.header });
    assertHeaderBinding(log.header, normalized.header);
    if (log.interruptedRuns.some((run) => run.endEntryId === null)) {
      log.markInterrupted({
        code: 'RUNTIME_INTERRUPTED',
        message: 'The Runtime run was interrupted before recovery.',
        createdAt: normalized.now(),
      });
    }
    return new RuntimeSession(log, normalized);
  }

  static createOrRecover(options: RuntimeSessionCreateOptions): RuntimeSession {
    try {
      return RuntimeSession.create(options);
    } catch (error) {
      if (isSessionExistsError(error)) return RuntimeSession.recover(options);
      throw error;
    }
  }

  get state(): RuntimeSessionState {
    return this.#state;
  }

  get header(): RuntimeSessionHeader {
    return this.#log.header;
  }

  get entries(): readonly RuntimeSessionEntry[] {
    return this.#log.entries;
  }

  get log(): SessionLog {
    return this.#log;
  }

  subscribe(listener: RuntimeEventListener): () => void {
    if (typeof listener !== 'function') throw new RuntimeSessionError('RUNTIME_LISTENER_INVALID', 'Runtime event listener is invalid.');
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  subscribeRunMarkers(listener: RuntimeRunMarkerListener): () => void {
    if (typeof listener !== 'function') throw new RuntimeSessionError('RUNTIME_LISTENER_INVALID', 'Runtime marker listener is invalid.');
    this.#markerListeners.add(listener);
    return () => this.#markerListeners.delete(listener);
  }

  async readTranscript(): Promise<RuntimeTranscriptSnapshot> {
    const projection = projectSessionContext(this.#log);
    return {
      header: this.#log.header,
      entries: this.#log.entries,
      updatedAt: this.#log.updatedAt,
      leafId: this.#log.leafId,
      interruptedRuns: this.#log.interruptedRuns,
      messages: projection.messages,
    };
  }

  async readContext(input: {
    readonly currentUserMessage?: RuntimeUserMessage;
    readonly product?: RuntimeProductContext;
  } = {}): Promise<BuiltRuntimeContext> {
    return this.#buildContext(input.currentUserMessage, input.product);
  }

  startTurn(input: RuntimeStartTurnInput): Promise<RuntimeRunHandle> {
    if (this.#state === 'closed') return Promise.reject(sessionClosed());
    if (this.#active) return Promise.reject(activeRunError());
    if (this.#activeCompaction) return Promise.reject(activeCompactionError());

    const normalizedInput = normalizeTurnInput(input);
    const active = {} as ActiveRun;
    const abortController = new AbortController();
    const cleanupExternalSignal = bindAbortSignal(input.signal, abortController);
    Object.assign(active, {
      input: normalizedInput,
      abortController,
      bridgeSet: new Set<RuntimeToolBridge>(),
      firstRunId: normalizedInput.runId ?? asRuntimeRunId(`runtime-run-${randomUUID()}`),
      steeringQueue: [],
      steeringByClientTurnId: new Map<string, RuntimeUserMessage>(),
      ...(cleanupExternalSignal === undefined ? {} : { externalSignalCleanup: cleanupExternalSignal }),
      attempts: 0,
      steeringSequence: 0,
      acceptingSteering: true,
    });
    this.#active = active;

    const handle = new RuntimeRunHandleImpl(this, active, active.firstRunId, normalizedInput.defTurnId);
    active.result = this.#executeTurn(active);
    return Promise.resolve(handle);
  }

  start(input: RuntimeStartTurnInput): Promise<RuntimeRunHandle> {
    return this.startTurn(input);
  }

  async steer(input: RuntimeSteerInput, expectedRunId?: RuntimeRunId): Promise<void> {
    if (this.#state === 'closed') throw sessionClosed();
    const active = this.#active;
    if (!active || (expectedRunId !== undefined && active.firstRunId !== expectedRunId)) {
      throw new RuntimeSessionError('RUNTIME_STEERING_INACTIVE', 'Runtime Session has no matching active run.');
    }
    const normalized = normalizeSteeringInput(input);
    if (active.steeringByClientTurnId.has(String(normalized.clientTurnId))) return;
    if (!active.acceptingSteering) {
      throw new RuntimeSessionError('RUNTIME_STEERING_CLOSED', 'Runtime run is already completing.');
    }
    if (active.steeringQueue.length >= 64) {
      throw new RuntimeSessionError('RUNTIME_STEERING_LIMIT', 'Runtime steering queue is full.');
    }
    const message = makeSteeringMessage(active, normalized, this.#options.now);
    active.steeringSequence += 1;
    active.steeringQueue.push(message);
    active.steeringByClientTurnId.set(String(normalized.clientTurnId), message);
  }

  async compact(input: RuntimeCompactInput = {}): Promise<CompactionOutcome> {
    if (this.#state === 'closed') throw sessionClosed();
    if (this.#active) throw activeRunError();
    if (this.#activeCompaction) throw activeCompactionError();
    return this.#compactInternal({ ...input, reason: input.reason ?? 'manual' });
  }

  async abort(reason: RuntimeAbortReason = { code: 'RUNTIME_ABORTED', message: 'Runtime run aborted.' }): Promise<RuntimeRunTerminal> {
    const active = this.#active;
    if (!active) {
      if (this.#activeCompaction) {
        activeCompactionAbort(this.#activeCompaction.controller, reason);
        await settlePromise(this.#activeCompaction.promise);
      }
      return { status: 'aborted', code: 'RUNTIME_NO_ACTIVE_RUN', message: 'No active Runtime run.' };
    }

    abortController(active.abortController, reason);
    await this.#abortBridges(active, reason);
    const result = await active.result;
    return result.terminal;
  }

  async waitForIdle(): Promise<void> {
    const active = this.#active;
    const compaction = this.#activeCompaction;
    await Promise.all([
      ...(active === undefined ? [] : [settlePromise(active.result)]),
      ...(compaction === undefined ? [] : [settlePromise(compaction.promise)]),
    ]);
  }

  async close(): Promise<void> {
    if (this.#closePromise) return this.#closePromise;
    this.#state = 'closed';
    this.#closePromise = (async () => {
      const active = this.#active;
      if (active) {
        const reason = { code: 'RUNTIME_CLOSED', message: 'Runtime Session closed.' };
        abortController(active.abortController, reason);
        await this.#abortBridges(active, reason);
        await settlePromise(active.result);
      }
      const compaction = this.#activeCompaction;
      if (compaction) {
        compaction.controller.abort({ code: 'RUNTIME_CLOSED', message: 'Runtime Session closed.' });
        await settlePromise(compaction.promise);
      }
      await Promise.all([...this.#knownBridges].map((bridge) => closeBridge(bridge)));
      this.#log.close();
    })();
    return this.#closePromise;
  }

  dispose(): Promise<void> {
    return this.close();
  }

  async #executeTurn(active: ActiveRun): Promise<RuntimeRunResult> {
    try {
      const recovered = await runWithContextRecovery({
        run: () => this.#runAttempt(active),
        compact: () => this.#compactInternal({
          reason: 'overflow',
          currentInputTokens: active.lastContext?.estimatedInputTokens,
          retainLastMessages: this.#options.retainLastMessages,
          retainTokens: this.#options.retainTokens,
        }, active),
        isOverflow: (error: unknown) => error instanceof RuntimeContextOverflow || isContextOverflow(error),
      });
      return recovered.value;
    } catch (error) {
      // Provider failures are normally represented as an AgentLoopResult.  If
      // overflow recovery cannot compact or the second attempt still overflows,
      // expose the last canonical result instead of inventing a new terminal.
      if (active.lastResult) return active.lastResult;
      throw error;
    } finally {
      active.acceptingSteering = false;
      active.steeringQueue.splice(0);
      active.externalSignalCleanup?.();
      if (this.#active === active) this.#active = undefined;
    }
  }

  async #runAttempt(active: ActiveRun): Promise<RuntimeRunResult> {
    const attempt = active.attempts + 1;
    active.attempts = attempt;
    const runId = attempt === 1
      ? active.firstRunId
      : asRuntimeRunId(`${active.input.runId ?? active.lastRunId ?? `runtime-run-${randomUUID()}`}:retry:${attempt - 1}`);
    active.lastRunId = runId;
    active.acceptingSteering = true;

    const userMessage = attempt === 1 ? makeUserMessage(active.input, runId, this.#options.now) : undefined;
    let context = await this.#buildContext(userMessage);
    active.lastContext = context;

    const connection = await resolveSource(this.#options.connection);
    const threshold = checkCompactionThreshold({
      currentInputTokens: active.input.currentInputTokens ?? context.estimatedInputTokens,
      currentUsage: active.input.currentUsage,
      contextLimit: active.input.contextLimit ?? connection.contextLimit,
      thresholdTokens: active.input.thresholdTokens ?? this.#options.thresholdTokens,
      thresholdRatio: active.input.thresholdRatio ?? this.#options.thresholdRatio,
      reserveTokens: active.input.reserveTokens ?? this.#options.reserveTokens,
    });
    if (threshold.shouldCompact) {
      const outcome = await this.#compactInternal({
        reason: 'threshold',
        currentInputTokens: threshold.inputTokens,
        currentUsage: active.input.currentUsage,
        contextLimit: active.input.contextLimit ?? connection.contextLimit,
        thresholdTokens: threshold.thresholdTokens,
        thresholdRatio: active.input.thresholdRatio ?? this.#options.thresholdRatio,
        reserveTokens: active.input.reserveTokens ?? this.#options.reserveTokens,
        retainLastMessages: this.#options.retainLastMessages,
        retainTokens: this.#options.retainTokens,
      }, active);
      if (outcome.status === 'compacted') {
        context = await this.#buildContext(userMessage);
        active.lastContext = context;
      }
    }

    const bridge = await resolveSource(this.#options.toolBridge);
    active.bridgeSet.add(bridge);
    this.#knownBridges.add(bridge);
    const tools = await this.#resolveProjection(bridge);
    const raw = await runAgentLoop({
      sessionId: this.id,
      runId,
      defTurnId: active.input.defTurnId,
      systemPrompt: context.systemPrompt,
      messages: context.messages,
      userMessage,
      connection,
      tools,
      modelDriver: this.#options.modelDriver,
      toolBridge: bridge,
      signal: active.abortController.signal,
      initialTurnId: userMessage?.turnId,
      maxTurns: active.input.maxTurns ?? this.#options.maxTurns,
      now: this.#options.now,
      getSteeringMessages: (options) => this.#drainSteering(active, options?.closeIfEmpty === true),
      onSteeringClosed: () => {
        active.acceptingSteering = false;
      },
      listeners: [this.#publishEvent.bind(this)],
      markerListeners: [this.#publishMarker.bind(this)],
      durableEventCommit: (write) => this.#durableEventCommit(write),
      terminalCommit: (bundle) => this.#terminalCommit(bundle),
    });
    const result: RuntimeRunResult = {
      ...raw,
      runId,
      defTurnId: active.input.defTurnId,
      context,
      attempt,
    };
    active.lastResult = result;
    if (result.terminal.status === 'failed' && isContextOverflow(result.terminal)) {
      throw new RuntimeContextOverflow(result);
    }
    return result;
  }

  async #buildContext(
    currentUserMessage?: RuntimeUserMessage,
    productOverride?: RuntimeProductContext,
  ): Promise<BuiltRuntimeContext> {
    const source = await resolveContext(this.#options.context);
    return buildContext({
      stableSystemPrompt: source.stableSystemPrompt ?? source.systemPrompt ?? '',
      ...(source.defInstructions === undefined ? {} : { defInstructions: source.defInstructions }),
      ...(source.harnessInstructions === undefined ? {} : { harnessInstructions: source.harnessInstructions }),
      ...(productOverride === undefined
        ? source.product === undefined ? {} : { product: source.product }
        : { product: productOverride }),
      entries: this.#log,
      ...(currentUserMessage === undefined ? {} : { currentUserMessage }),
    });
  }

  async #resolveProjection(bridge: RuntimeToolBridge): Promise<RuntimeToolProjection> {
    const source = this.#options.toolProjection === undefined
      ? (bridge as ProjectedBridge).projection ?? { revision: 0, tools: [] }
      : await resolveSource(this.#options.toolProjection);
    return toRuntimeToolProjection(source);
  }

  async #compactInternal(
    input: RuntimeCompactInput,
    active?: ActiveRun,
  ): Promise<CompactionOutcome> {
    if (this.#activeCompaction) throw activeCompactionError();
    const controller = new AbortController();
    const runId = active?.lastRunId;
    const defTurnId = active?.input.defTurnId;
    const startEvent = this.#makeCompactionEvent('compaction.start', input.reason ?? 'manual', defTurnId, runId);
    const operation = (async (): Promise<CompactionOutcome> => {
      await this.#publishEvent(startEvent);
      let outcome: CompactionOutcome;
      try {
        const connection = await resolveSource(this.#options.connection);
        outcome = await compactSession({
          session: this.#log,
          reason: input.reason ?? 'manual',
          summary: input.summary,
          summarize: input.summarize,
          modelDriver: this.#options.modelDriver,
          connection,
          signal: controller.signal,
          runId,
          defTurnId,
          currentInputTokens: input.currentInputTokens,
          currentUsage: input.currentUsage,
          contextLimit: input.contextLimit ?? connection.contextLimit,
          thresholdTokens: input.thresholdTokens,
          thresholdRatio: input.thresholdRatio,
          reserveTokens: input.reserveTokens,
          firstKeptEntryId: input.firstKeptEntryId,
          retainLastMessages: input.retainLastMessages ?? this.#options.retainLastMessages,
          retainTokens: input.retainTokens ?? this.#options.retainTokens,
          now: this.#options.now,
        });
      } catch {
        outcome = {
          status: 'failed',
          reason: input.reason ?? 'manual',
          code: 'RUNTIME_COMPACTION_FAILED',
          message: 'Runtime Session compaction failed; the transcript was left unchanged.',
        };
      }
      const endEvent = this.#makeCompactionEvent(
        'compaction.end',
        input.reason ?? 'manual',
        defTurnId,
        runId,
        outcome,
      );
      await this.#publishEvent(endEvent);
      return outcome;
    })();
    this.#activeCompaction = { controller, promise: operation };
    try {
      return await operation;
    } finally {
      if (this.#activeCompaction?.promise === operation) this.#activeCompaction = undefined;
    }
  }

  #makeCompactionEvent(
    type: 'compaction.start' | 'compaction.end',
    reason: 'manual' | 'threshold' | 'overflow',
    defTurnId?: DefTurnId,
    runId?: RuntimeRunId,
    outcome?: CompactionOutcome,
  ): Extract<RuntimeEvent, { type: 'compaction.start' | 'compaction.end' }> {
    const base = {
      sessionId: this.id,
      // Compaction events are assigned their Session sequence at the publish
      // boundary, just like P2 run events.  The placeholder is never exposed.
      sequence: 0,
      occurredAt: this.#options.now(),
      type,
      ...(defTurnId === undefined ? {} : { defTurnId }),
      ...(runId === undefined ? {} : { runId }),
      ...(runId === undefined ? {} : { runOrdinal: 1 }),
      reason,
    } as const;
    if (type === 'compaction.start') return Object.freeze(base) as Extract<RuntimeEvent, { type: 'compaction.start' }>;
    const compactedOutcome = outcome?.status === 'compacted'
      ? { status: 'compacted' as const, summaryEntryId: String(outcome.entry.id) }
      : outcome?.status === 'failed'
        ? { status: 'failed' as const, code: outcome.code, message: outcome.message }
        : { status: 'not-needed' as const };
    return Object.freeze({ ...base, outcome: compactedOutcome }) as Extract<RuntimeEvent, { type: 'compaction.end' }>;
  }

  async #publishEvent(event: RuntimeEvent): Promise<void> {
    const facadeEvent = Object.freeze({
      ...event,
      sequence: ++this.#eventSequence,
    }) as RuntimeEvent;
    await Promise.allSettled([...this.#listeners].map((listener) => Promise.resolve().then(() => listener(facadeEvent))));
  }

  async #publishMarker(marker: RuntimeRunMarkerEntry): Promise<void> {
    await Promise.allSettled([...this.#markerListeners].map((listener) => Promise.resolve().then(() => listener(marker))));
  }

  async #durableEventCommit(write: Parameters<NonNullable<Parameters<typeof runAgentLoop>[0]['durableEventCommit']>>[0]): Promise<void> {
    if (write.kind === 'run.start') {
      this.#log.appendControllerRunMarker(write.bundle.marker);
      return;
    }
    if (write.event.type !== 'message.end') return;
    if (write.event.message.role === 'compaction') return;
    this.#log.append(messageEntry(write.event.message, write.event.occurredAt, this.#log.leafId));
  }

  async #terminalCommit(bundle: Parameters<NonNullable<Parameters<typeof runAgentLoop>[0]['terminalCommit']>>[0]): Promise<void> {
    this.#log.appendControllerRunMarker(bundle.marker);
  }

  async #abortBridges(active: ActiveRun, reason: RuntimeAbortReason): Promise<void> {
    await Promise.all([...active.bridgeSet].map((bridge) => abortBridge(bridge, reason)));
  }

  #drainSteering(active: ActiveRun, closeIfEmpty = false): readonly RuntimeUserMessage[] {
    if (this.#active !== active) return [];
    if (active.steeringQueue.length === 0) {
      if (closeIfEmpty) active.acceptingSteering = false;
      return [];
    }
    const message = active.steeringQueue.shift();
    return message ? [message] : [];
  }
}

export function createRuntimeSession(options: RuntimeSessionCreateOptions): RuntimeSession {
  return RuntimeSession.create(options);
}

export function recoverRuntimeSession(options: RuntimeSessionCreateOptions): RuntimeSession {
  return RuntimeSession.recover(options);
}

export const createSession = createRuntimeSession;
export const recoverSession = recoverRuntimeSession;

function normalizeOptions(options: RuntimeSessionCreateOptions): NormalizedOptions {
  const filePath = options.filePath ?? options.path;
  if (!filePath) throw new RuntimeSessionError('RUNTIME_SESSION_PATH_INVALID', 'Runtime Session file path is required.');
  const rootDir = options.rootDir ?? dirname(filePath);
  const header = options.header ?? {
    type: 'session' as const,
    schemaVersion: 1 as const,
    runtimeSessionId: asRuntimeSessionId(String(options.runtimeSessionId ?? `runtime-session-${randomUUID()}`)),
    defSessionId: asDefSessionId(String(options.defSessionId ?? 'def-session-unknown')),
    runtimeVersion: options.runtimeVersion ?? DEFAULT_RUNTIME_VERSION,
    providerProfileRef: options.providerProfileRef ?? DEFAULT_PROVIDER_PROFILE_REF,
    systemPromptVersion: options.systemPromptVersion ?? DEFAULT_SYSTEM_PROMPT_VERSION,
    createdAt: options.createdAt ?? (options.now?.() ?? new Date().toISOString()),
  };
  const context = options.context ?? options.contextSource ?? options.contextProvider ?? {
    stableSystemPrompt: options.stableSystemPrompt ?? options.systemPrompt ?? '',
    ...(options.defInstructions === undefined ? {} : { defInstructions: options.defInstructions }),
    ...(options.harnessInstructions === undefined ? {} : { harnessInstructions: options.harnessInstructions }),
  };
  if (typeof options.modelDriver?.stream !== 'function') {
    throw new RuntimeSessionError('RUNTIME_MODEL_DRIVER_INVALID', 'Runtime ModelDriver is required.');
  }
  if (!options.connection) throw new RuntimeSessionError('RUNTIME_MODEL_CONNECTION_INVALID', 'Runtime model connection is required.');
  if (!options.toolBridge) throw new RuntimeSessionError('RUNTIME_TOOL_BRIDGE_INVALID', 'Runtime ToolBridge is required.');
  return {
    filePath,
    rootDir,
    header,
    modelDriver: options.modelDriver,
    connection: options.connection,
    toolBridge: options.toolBridge,
    ...(options.toolProjection === undefined ? {} : { toolProjection: options.toolProjection }),
    context,
    ...(options.maxTurns === undefined ? {} : { maxTurns: options.maxTurns }),
    ...(options.thresholdRatio === undefined ? {} : { thresholdRatio: options.thresholdRatio }),
    ...(options.thresholdTokens === undefined ? {} : { thresholdTokens: options.thresholdTokens }),
    ...(options.reserveTokens === undefined ? {} : { reserveTokens: options.reserveTokens }),
    ...(options.retainLastMessages === undefined ? {} : { retainLastMessages: options.retainLastMessages }),
    ...(options.retainTokens === undefined ? {} : { retainTokens: options.retainTokens }),
    now: options.now ?? (() => new Date().toISOString()),
    listeners: options.listeners ?? [],
    markerListeners: options.markerListeners ?? [],
  };
}

function assertHeaderBinding(actual: RuntimeSessionHeader, expected: RuntimeSessionHeader): void {
  if (
    actual.runtimeSessionId !== expected.runtimeSessionId
    || actual.defSessionId !== expected.defSessionId
    || actual.providerProfileRef !== expected.providerProfileRef
  ) {
    throw new RuntimeSessionError('RUNTIME_SESSION_HEADER_CONFLICT', 'Runtime Session header does not match the durable Session.');
  }
}

function normalizeTurnInput(input: RuntimeStartTurnInput): NormalizedTurnInput {
  if (!input || typeof input !== 'object') throw new RuntimeSessionError('RUNTIME_TURN_INVALID', 'Runtime turn input is invalid.');
  const defTurnId = asDefTurnId(String(input.defTurnId));
  const userMessage = input.userMessage && typeof input.userMessage === 'object'
    ? input.userMessage
    : undefined;
  const text = typeof input.userMessage === 'string'
    ? input.userMessage
    : input.text ?? input.prompt ?? input.message;
  return {
    defTurnId,
    ...(input.clientTurnId === undefined ? {} : { clientTurnId: asClientTurnId(String(input.clientTurnId)) }),
    ...(text === undefined ? {} : { text }),
    ...(input.content === undefined ? {} : { content: input.content }),
    ...(userMessage === undefined ? {} : { userMessage }),
    ...(input.messageId === undefined ? {} : { messageId: input.messageId }),
    ...(input.turnId === undefined ? {} : { turnId: asRuntimeTurnId(String(input.turnId)) }),
    ...(input.runId === undefined ? {} : { runId: asRuntimeRunId(String(input.runId)) }),
    ...(input.signal === undefined ? {} : { signal: input.signal }),
    ...(input.maxTurns === undefined ? {} : { maxTurns: input.maxTurns }),
    ...(input.contextLimit === undefined ? {} : { contextLimit: input.contextLimit }),
    ...(input.thresholdRatio === undefined ? {} : { thresholdRatio: input.thresholdRatio }),
    ...(input.thresholdTokens === undefined ? {} : { thresholdTokens: input.thresholdTokens }),
    ...(input.reserveTokens === undefined ? {} : { reserveTokens: input.reserveTokens }),
    ...(input.currentInputTokens === undefined ? {} : { currentInputTokens: input.currentInputTokens }),
    ...(input.currentUsage === undefined ? {} : { currentUsage: input.currentUsage }),
  };
}

function normalizeSteeringInput(input: RuntimeSteerInput): { readonly clientTurnId: ClientTurnId; readonly text: string } {
  if (!input || typeof input !== 'object') {
    throw new RuntimeSessionError('RUNTIME_STEERING_INVALID', 'Runtime steering input is invalid.');
  }
  const text = typeof input.text === 'string' ? input.text.trim() : '';
  if (!text || text.length > 16_000) {
    throw new RuntimeSessionError('RUNTIME_STEERING_INVALID', 'Runtime steering message is invalid.');
  }
  return {
    clientTurnId: asClientTurnId(String(input.clientTurnId)),
    text,
  };
}

function makeUserMessage(
  input: NormalizedTurnInput,
  runId: RuntimeRunId,
  now: () => string,
): RuntimeUserMessage | undefined {
  if (input.userMessage) return input.userMessage;
  if (input.text === undefined && input.content === undefined) return undefined;
  const turnId = input.turnId ?? asRuntimeTurnId(`${runId}:turn:1`);
  const messageId = asRuntimeMessageId(input.messageId ?? `${runId}:user`);
  const content = input.content ?? [{
    type: 'text' as const,
    id: asRuntimeContentId(`${messageId}:content:0`),
    text: input.text ?? '',
  }];
  return {
    schemaVersion: 1,
    id: messageId,
    createdAt: now(),
    defTurnId: input.defTurnId,
    turnId,
    role: 'user',
    clientTurnId: input.clientTurnId ?? asClientTurnId(`${runId}:client-turn`),
    content,
  };
}

function makeSteeringMessage(
  active: ActiveRun,
  input: { readonly clientTurnId: ClientTurnId; readonly text: string },
  now: () => string,
): RuntimeUserMessage {
  const sequence = active.steeringSequence + 1;
  const suffix = randomUUID();
  const messageId = asRuntimeMessageId(`runtime-steer-message-${suffix}`);
  return {
    schemaVersion: 1,
    id: messageId,
    createdAt: now(),
    defTurnId: active.input.defTurnId,
    turnId: asRuntimeTurnId(`runtime-steer-turn-${sequence}-${suffix}`),
    role: 'user',
    clientTurnId: input.clientTurnId,
    content: [{
      type: 'text',
      id: asRuntimeContentId(`${messageId}:content:0`),
      text: input.text,
    }],
  };
}

function messageEntry(
  message: RuntimeAssistantMessage | RuntimeUserMessage | RuntimeToolResultMessage,
  createdAt: string,
  parentId: RuntimeEntryId | null,
): RuntimeSessionEntry {
  return {
    schemaVersion: 1,
    id: asRuntimeEntryId(String(message.id)),
    parentId,
    createdAt,
    type: 'message',
    message,
  };
}

async function resolveSource<T>(source: T | (() => T | Promise<T>)): Promise<T> {
  return typeof source === 'function'
    ? await (source as () => T | Promise<T>)()
    : source;
}

async function resolveContext(source: RuntimeSessionContextSource): Promise<RuntimeSessionContext> {
  const value = await resolveSource(source);
  if (!value || typeof value !== 'object') throw new RuntimeSessionError('RUNTIME_CONTEXT_INVALID', 'Runtime context is invalid.');
  return value;
}

function bindAbortSignal(signal: AbortSignal | undefined, target: AbortController): (() => void) | undefined {
  if (!signal) return undefined;
  const forward = (): void => abortController(target, toAbortReason(signal.reason));
  if (signal.aborted) forward();
  else signal.addEventListener('abort', forward, { once: true });
  return () => signal.removeEventListener('abort', forward);
}

function abortController(controller: AbortController, reason: RuntimeAbortReason): void {
  if (!controller.signal.aborted) controller.abort({ code: reason.code, ...(reason.message === undefined ? {} : { message: reason.message }) });
}

function toAbortReason(reason: unknown): RuntimeAbortReason {
  if (reason && typeof reason === 'object') {
    const value = reason as Record<string, unknown>;
    return {
      code: typeof value.code === 'string' ? value.code : 'RUNTIME_ABORTED',
      ...(typeof value.message === 'string' ? { message: value.message } : {}),
    };
  }
  return { code: 'RUNTIME_ABORTED', message: 'Runtime run aborted.' };
}

async function abortBridge(bridge: RuntimeToolBridge, reason: RuntimeAbortReason): Promise<void> {
  const candidate = bridge as RuntimeToolBridge & { abort?: (reason?: RuntimeAbortReason) => void | Promise<void> };
  try {
    await candidate.abort?.(reason);
  } catch {
    // P6 owns transport cleanup.  The Runtime still waits for its run terminal.
  }
}

async function closeBridge(bridge: RuntimeToolBridge): Promise<void> {
  const candidate = bridge as RuntimeToolBridge & { close?: () => void | Promise<void> };
  try {
    await candidate.close?.();
  } catch {
    // Closing is best effort after every pending wait has been aborted.
  }
}

function activeCompactionAbort(controller: AbortController, reason: RuntimeAbortReason): void {
  if (!controller.signal.aborted) controller.abort(reason);
}

async function settlePromise<T>(promise: Promise<T>): Promise<void> {
  await promise.then(() => undefined, () => undefined);
}

function sessionClosed(): RuntimeSessionError {
  return new RuntimeSessionError('RUNTIME_SESSION_CLOSED', 'Runtime Session is closed.');
}

function activeRunError(): RuntimeSessionError {
  return new RuntimeSessionError('RUNTIME_ACTIVE_RUN', 'Runtime Session already has an active run.');
}

function activeCompactionError(): RuntimeSessionError {
  return new RuntimeSessionError('RUNTIME_COMPACTION_ACTIVE', 'Runtime Session already has an active compaction.');
}

function isSessionExistsError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && (error as { code?: unknown }).code === 'SESSION_EXISTS');
}

// Keep these imports/brands at the Runtime boundary instead of leaking raw
// string IDs from future adapters.
export type { JsonObject, JsonValue };
