import { randomBytes } from 'node:crypto';
import {
  AgentEngineProtocolError,
  asEngineMessageId,
  asEngineSessionId,
  asEngineTurnId,
  asToolCallId,
  canonicalJson,
  isEngineTerminalEvent,
  type AbortResult,
  type AgentEngine,
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
  type EngineUserAttachment,
  type JsonValue,
  type ToolCallId,
} from '../../core/contracts/index.ts';
import { OpenCodeEngineError, messageOf, type OpenCodeEngineErrorCode } from './errors.ts';
import {
  OpenCodePrivateBridge,
  type OpenCodeBridgeToolRequest,
  type OpenCodeBridgeToolResponse,
  type OpenCodeBridgeTurnController,
  type OpenCodeBridgeTurnState,
} from './private-bridge.ts';
import type { OpenCodeProviderProfileSource } from './profile.ts';
import {
  OPENCODE_TOOL_BINDINGS,
  projectOpenCodeTools,
  projectSafeToolNames,
  toDefCanonicalToolName,
} from './tool-bindings.ts';
import {
  OpenCodeRuntimeSupervisor,
  type OpenCodeRuntimeSupervisorOptions,
  type RunningOpenCodeRuntime,
} from './runtime.ts';

const OPENCODE_STORE_SCHEMA_VERSION = 1;
const ENGINE_KIND = 'opencode';

type EngineEventInput<Event extends EngineEvent = EngineEvent> = Event extends EngineEvent
  ? Omit<Event, 'engineTurnId' | 'ordinal'>
  : never;

type TerminalEventInput<Event extends EngineTerminalEvent = EngineTerminalEvent> =
  Event extends EngineTerminalEvent ? Omit<Event, 'engineTurnId' | 'ordinal'> : never;

type SessionRecord = {
  readonly ref: EngineSessionRef;
  readonly profileRef: string;
  runtime: RunningOpenCodeRuntime;
  runtimeEpoch: number;
  detached: boolean;
};

type OpenCodePartMetadata = {
  readonly messageId: string;
  readonly type: string;
};

type PendingOpenCodeDelta = {
  readonly partId: string;
  readonly delta: string;
};

const MAX_PROMPT_BYTES = 1_048_576;
const MAX_USER_ATTACHMENTS = 4;
const MAX_USER_ATTACHMENT_BYTES = 8 * 1_048_576;
const MAX_RESPONSE_BYTES = 4_194_304;
const MAX_TOOL_RESULT_BYTES = 4_194_304;
const MAX_SSE_BUFFER_BYTES = 4_194_304;
const ABORT_TIMEOUT_MS = 5_000;
const REQUEST_TIMEOUT_MS = 15_000;
// OpenCode initializes its project-scoped plugin and database on the first
// session created for an isolated workspace.  That cold path can legitimately
// exceed the normal request timeout on desktop builds, so session creation has
// its own wider bound instead of leaving a successfully-starting runtime behind
// a false HTTP 500 in the product UI.
const SESSION_CREATE_TIMEOUT_MS = 60_000;
const RECOVERY_IDLE_TIMEOUT_MS = 5_000;
const ASSISTANT_CORRELATION_TIMEOUT_MS = 5_000;
const RECENT_MESSAGE_LOOKBACK = 8;
const MESSAGE_ID_CLOCK_WAIT_MS = 1_000;
const OPENCODE_ID_TIME_MASK = (1n << 48n) - 1n;
const OPENCODE_ID_TIME_MULTIPLIER = 0x1000n;
const OPENCODE_ID_RANDOM_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

export interface OpenCodeEngineAdapterOptions {
  readonly runtimeRoot: string;
  readonly storeRoot: string;
  readonly profileSource: OpenCodeProviderProfileSource;
  readonly probeProfileRef?: string;
  readonly fetch?: typeof fetch;
  readonly bridge?: OpenCodePrivateBridge;
  readonly runtimeSupervisor?: OpenCodeRuntimeController;
  readonly runtimeSupervisorOptions?: Partial<OpenCodeRuntimeSupervisorOptions>;
}

export interface OpenCodeRuntimeController {
  probe(profileRef: string): Promise<EngineHealth>;
  start(profileRef: string): Promise<RunningOpenCodeRuntime>;
  shutdown(): Promise<void>;
  setExitHandler(handler: (error: OpenCodeEngineError) => void): void;
}

export class OpenCodeEngineAdapter implements AgentEngine {
  readonly kind = ENGINE_KIND;
  readonly #probeProfileRef: string;
  readonly #bridge: OpenCodePrivateBridge;
  readonly #runtime: OpenCodeRuntimeController;
  readonly #sessions = new Map<string, SessionRecord>();
  #activeTurn: OpenCodeTurnHandle | null = null;
  #shutdown = false;

  constructor(options: OpenCodeEngineAdapterOptions) {
    this.#probeProfileRef = options.probeProfileRef ?? 'default';
    this.#bridge = options.bridge ?? new OpenCodePrivateBridge();
    this.#runtime = options.runtimeSupervisor ?? new OpenCodeRuntimeSupervisor({
      runtimeRoot: options.runtimeRoot,
      storeRoot: options.storeRoot,
      profileSource: options.profileSource,
      bridgeOrigin: () => this.#bridge.origin,
      bridgeToken: () => this.#bridge.token,
      expectPluginReady: (expectation, signal) => this.#bridge.expectPluginReady(expectation, signal),
      fetch: options.fetch,
      ...options.runtimeSupervisorOptions,
    });
    this.#runtime.setExitHandler((error) => this.#handleRuntimeExit(error));
  }

  async probe(): Promise<EngineHealth> {
    if (this.#shutdown) {
      return { status: 'unavailable', kind: this.kind, code: 'ENGINE_SHUTDOWN', message: 'OpenCode Engine is shut down' };
    }
    return this.#runtime.probe(this.#probeProfileRef);
  }

  /**
   * Read-only/native-UI gateway access to the version-locked OpenCode server.
   * Callers never receive its private origin or Basic credential; every
   * request still passes through the Runtime supervisor, which injects both.
   */
  async requestNativeUi(pathname: string, init: RequestInit = {}): Promise<Response> {
    this.#assertRunning();
    await this.#bridge.start();
    const runtime = await this.#runtime.start(this.#probeProfileRef);
    return runtime.request(pathname, init);
  }

  async nativeUiDirectory(): Promise<string> {
    this.#assertRunning();
    await this.#bridge.start();
    return (await this.#runtime.start(this.#probeProfileRef)).directory;
  }

  async createSession(input: EngineSessionCreateInput): Promise<EngineSessionRef> {
    this.#assertRunning();
    this.#assertProfileRef(input.providerProfileRef);
    await this.#bridge.start();
    const runtime = await this.#runtime.start(input.providerProfileRef);
    const response = await runtime.request('/session', {
      method: 'POST',
      signal: AbortSignal.timeout(SESSION_CREATE_TIMEOUT_MS),
      body: JSON.stringify({
        title: `DEF ${input.defSessionId}`,
        agent: 'def-engine',
        metadata: {
          defSessionId: input.defSessionId,
        },
      }),
    });
    const body = await requiredJsonResponse(response, 'OPENCODE_SESSION_CREATE_FAILED');
    const sessionId = requiredId(record(body)?.id, 'OpenCode session id');
    const ref: EngineSessionRef = {
      kind: this.kind,
      sessionId: asEngineSessionId(sessionId),
      runtimeVersion: runtime.verified.manifest.runtimeVersion,
      storeSchemaVersion: runtime.verified.manifest.storeSchemaVersion,
    };
    this.#sessions.set(sessionId, {
      ref,
      profileRef: input.providerProfileRef,
      runtime,
      runtimeEpoch: runtime.epoch,
      detached: false,
    });
    return ref;
  }

  async recoverSession(ref: EngineSessionRef): Promise<EngineRecoveryResult> {
    this.#assertRunning();
    if (!basicCompatible(ref)) return incompatible(ref);
    if (this.#activeTurn?.ref.session.sessionId === ref.sessionId) {
      throw new AgentEngineProtocolError(
        'ENGINE_INPUT_UNEXPECTED',
        `OpenCode Engine session ${ref.sessionId} still has an active Turn`,
      );
    }
    await this.#bridge.start();
    const runtime = await this.#runtime.start(this.#probeProfileRef);
    if (!runtimeCompatible(ref, runtime)) return incompatible(ref);
    const response = await runtime.request(`/session/${encodeURIComponent(ref.sessionId)}`, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (response.status === 404) return { status: 'missing' };
    const body = await requiredJsonResponse(response, 'OPENCODE_SESSION_RECOVERY_FAILED');
    if (requiredId(record(body)?.id, 'OpenCode session id') !== ref.sessionId) {
      return { status: 'missing' };
    }
    const abortResponse = await runtime.request(`/session/${encodeURIComponent(ref.sessionId)}/abort`, {
      method: 'POST',
      signal: AbortSignal.timeout(ABORT_TIMEOUT_MS),
    });
    if (abortResponse.status === 404) return { status: 'missing' };
    if (!abortResponse.ok) {
      throw new OpenCodeEngineError(
        'OPENCODE_SESSION_RECOVERY_FAILED',
        'OpenCode session could not be stopped before recovery',
      );
    }
    await waitForSessionIdle(runtime, ref.sessionId);
    const recovered: EngineSessionRef = { ...ref };
    this.#sessions.set(ref.sessionId, {
      ref: recovered,
      profileRef: this.#probeProfileRef,
      runtime,
      runtimeEpoch: runtime.epoch,
      detached: false,
    });
    return { status: 'recovered', ref: recovered };
  }

  async startTurn(input: EngineTurnInput): Promise<EngineTurnHandle> {
    this.#assertRunning();
    if (this.#activeTurn) {
      throw new AgentEngineProtocolError('ENGINE_INPUT_UNEXPECTED', 'OpenCode Engine already has an active Turn');
    }
    const session = this.#requireSession(input.engineSession);
    this.#assertProfileRef(input.providerProfileRef);
    if (session.profileRef !== input.providerProfileRef) {
      throw new OpenCodeEngineError(
        'OPENCODE_PROFILE_CONFLICT',
        'DEF Session provider profile does not match this Turn',
      );
    }
    const ref: EngineTurnRef = {
      session: session.ref,
      turnId: asEngineTurnId(`opencode-turn-${randomBytes(12).toString('hex')}`),
    };
    const handle = new OpenCodeTurnHandle({
      ref,
      input,
      runtime: session.runtime,
      bridge: this.#bridge,
      onTerminal: () => {
        if (this.#activeTurn === handle) this.#activeTurn = null;
      },
      onUnsafe: () => {
        const current = this.#sessions.get(session.ref.sessionId);
        if (current?.runtimeEpoch === session.runtimeEpoch) current.detached = true;
      },
    });
    this.#activeTurn = handle;
    try {
      await handle.begin();
      return handle;
    } catch (error) {
      if (this.#activeTurn === handle) this.#activeTurn = null;
      await handle.abort({ code: 'ENGINE_START_FAILED' }).catch(() => undefined);
      throw error;
    }
  }

  async disposeSession(ref: EngineSessionRef): Promise<void> {
    const record = this.#sessions.get(ref.sessionId);
    if (!record) return;
    this.#assertCompatible(ref, record.runtime);
    if (this.#activeTurn?.ref.session.sessionId === ref.sessionId) {
      await this.#activeTurn.abort({ code: 'SESSION_DISPOSED' });
    }
    if (record.detached || record.runtimeEpoch !== record.runtime.epoch) {
      this.#sessions.delete(ref.sessionId);
      return;
    }
    const response = await record.runtime.request(`/session/${encodeURIComponent(ref.sessionId)}`, {
      method: 'DELETE',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok && response.status !== 404) {
      throw new OpenCodeEngineError('OPENCODE_HTTP_FAILED', 'OpenCode session could not be disposed');
    }
    this.#sessions.delete(ref.sessionId);
  }

  async shutdown(): Promise<void> {
    if (this.#shutdown) return;
    this.#shutdown = true;
    if (this.#activeTurn) await this.#activeTurn.abort({ code: 'ENGINE_SHUTDOWN' });
    this.#sessions.clear();
    await this.#runtime.shutdown();
    await this.#bridge.stop();
  }

  #requireSession(ref: EngineSessionRef): SessionRecord {
    const session = this.#sessions.get(ref.sessionId);
    if (!session) {
      throw new AgentEngineProtocolError(
        'ENGINE_SESSION_NOT_FOUND',
        `OpenCode Engine session ${ref.sessionId} does not exist`,
      );
    }
    if (session.detached || session.runtimeEpoch !== session.runtime.epoch) {
      throw new AgentEngineProtocolError(
        'ENGINE_SESSION_NOT_FOUND',
        `OpenCode Engine session ${ref.sessionId} is detached; recover it before starting another Turn`,
      );
    }
    this.#assertCompatible(ref, session.runtime);
    return session;
  }

  #assertCompatible(ref: EngineSessionRef, runtime: RunningOpenCodeRuntime): void {
    if (!basicCompatible(ref) || !runtimeCompatible(ref, runtime)) {
      throw new AgentEngineProtocolError(
        'ENGINE_SESSION_INCOMPATIBLE',
        `OpenCode Engine cannot use ${ref.kind}@${ref.runtimeVersion}/schema-${ref.storeSchemaVersion}`,
      );
    }
  }

  #assertRunning(): void {
    if (this.#shutdown) throw new AgentEngineProtocolError('ENGINE_SHUTDOWN', 'OpenCode Engine is shut down');
  }

  #assertProfileRef(profileRef: string): void {
    if (profileRef !== this.#probeProfileRef) {
      throw new OpenCodeEngineError(
        'OPENCODE_PROFILE_CONFLICT',
        `Phase 4 OpenCode Engine only accepts provider profile ${this.#probeProfileRef}`,
      );
    }
  }

  #handleRuntimeExit(error: OpenCodeEngineError): void {
    for (const session of this.#sessions.values()) {
      if (session.runtimeEpoch === session.runtime.epoch) session.detached = true;
    }
    this.#activeTurn?.fail('OPENCODE_PROCESS_EXITED', error.message);
    this.#activeTurn = null;
  }
}

class OpenCodeTurnHandle implements EngineTurnHandle, OpenCodeBridgeTurnController {
  readonly ref: EngineTurnRef;
  readonly events: AsyncIterable<EngineEvent>;
  readonly #input: EngineTurnInput;
  readonly #runtime: RunningOpenCodeRuntime;
  readonly #bridge: OpenCodePrivateBridge;
  readonly #onTerminal: () => void;
  readonly #onUnsafe: () => void;
  readonly #queue = new AsyncEventQueue<EngineEvent>();
  readonly #streamAbort = new AbortController();
  readonly #acceptedToolResults = new Map<ToolCallId, string>();
  readonly #acceptedProjections = new Map<number, string>();
  readonly #toolCalls = new Map<string, ToolCallRecord>();
  #userMessageId = '';
  readonly #turnLease = randomBytes(32).toString('base64url');
  readonly #assistantMessageIds = new Set<string>();
  readonly #assistantProjectionById = new Map<string, number>();
  readonly #assistantWaiters = new Map<string, Set<Deferred<void>>>();
  readonly #partMetadata = new Map<string, OpenCodePartMetadata>();
  readonly #pendingDeltas = new Map<string, PendingOpenCodeDelta[]>();
  #projection: EngineToolProjectionInput;
  #pendingTool: ToolCallRecord | null = null;
  #terminal: EngineTerminalEvent | null = null;
  #ordinal = 0;
  #promptAccepted = false;
  #idleSeen = false;
  #currentAssistantCompleted = false;
  #responseText = '';
  #responseBytes = 0;
  #pendingDeltaBytes = 0;
  #lifecycle: 'active' | 'aborting' | 'terminal' = 'active';
  #abortPromise: Promise<AbortResult> | null = null;

  constructor(options: {
    readonly ref: EngineTurnRef;
    readonly input: EngineTurnInput;
    readonly runtime: RunningOpenCodeRuntime;
    readonly bridge: OpenCodePrivateBridge;
    readonly onTerminal: () => void;
    readonly onUnsafe: () => void;
  }) {
    this.ref = options.ref;
    this.events = this.#queue;
    this.#input = options.input;
    this.#runtime = options.runtime;
    this.#bridge = options.bridge;
    this.#onTerminal = options.onTerminal;
    this.#onUnsafe = options.onUnsafe;
    this.#projection = options.input.toolProjection;
    projectSafeToolNames(this.#projection);
  }

  async begin(): Promise<void> {
    ensureBoundedUtf8(this.#input.systemContext, MAX_PROMPT_BYTES, 'OpenCode system context');
    ensureBoundedUtf8(this.#input.userMessage, MAX_PROMPT_BYTES, 'OpenCode user message');
    const attachments = validateUserAttachments(this.#input.userAttachments);
    this.#userMessageId = this.#input.engineUserMessageId
      ?? await nextOpenCodeUserMessageId(this.#runtime, this.ref.session.sessionId);
    this.#bridge.register(this.ref.session.sessionId, this);
    const connected = deferred<void>();
    void this.#consumeEvents(connected);
    await withTimeout(connected.promise, 10_000, 'OpenCode event stream did not connect');
    const tools = Object.fromEntries(OPENCODE_TOOL_BINDINGS.map(([, safe]) => [safe, true]));
    const response = await this.#runtime.request(
      `/session/${encodeURIComponent(this.ref.session.sessionId)}/prompt_async`,
      {
        method: 'POST',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        body: JSON.stringify({
          messageID: this.#userMessageId,
          agent: 'def-engine',
          tools,
          parts: [
            { type: 'text', text: this.#input.userMessage },
            ...attachments,
          ],
        }),
      },
    );
    if (!response.ok) {
      throw new OpenCodeEngineError(
        'OPENCODE_HTTP_FAILED',
        `OpenCode prompt was rejected with HTTP ${response.status}`,
      );
    }
    this.#promptAccepted = true;
    if (this.#idleSeen) this.#completeFromIdle();
  }

  state(): OpenCodeBridgeTurnState {
    this.#assertActive();
    return {
      engineTurnId: this.ref.turnId,
      turnLease: this.#turnLease,
      userMessageId: this.#userMessageId,
      systemContext: this.#input.systemContext,
      projectionRevision: this.#projection.revision,
      safeTools: projectSafeToolNames(this.#projection),
      projectedTools: projectOpenCodeTools(this.#projection).map((tool) => ({
        safeName: tool.safeName,
        description: tool.description,
        inputSchema: tool.inputSchema,
        risk: tool.risk,
      })),
    };
  }

  async requestTool(input: OpenCodeBridgeToolRequest): Promise<OpenCodeBridgeToolResponse> {
    this.#assertActive();
    if (
      input.sessionId !== this.ref.session.sessionId
      || input.engineTurnId !== this.ref.turnId
      || input.turnLease !== this.#turnLease
      || input.userMessageId !== this.#userMessageId
    ) {
      throw new OpenCodeEngineError(
        'OPENCODE_BRIDGE_CORRELATION_FAILED',
        'OpenCode Tool call does not belong to the active DEF Turn',
      );
    }
    await this.#awaitAssistantMessage(input.messageId, input.projectionRevision);
    this.#assertActive();
    if (input.projectionRevision !== this.#projection.revision) {
      throw new OpenCodeEngineError(
        'OPENCODE_BRIDGE_CORRELATION_FAILED',
        `OpenCode Tool call used stale projection ${input.projectionRevision}`,
      );
    }
    const projected = projectSafeToolNames(this.#projection);
    if (projected.length !== 1 || projected[0] !== input.safeToolName) {
      throw new OpenCodeEngineError(
        'OPENCODE_BRIDGE_CORRELATION_FAILED',
        `OpenCode Tool ${input.safeToolName} is not currently projected`,
      );
    }
    const fingerprint = canonicalJson({
      sessionId: input.sessionId,
      messageId: input.messageId,
      callId: input.callId,
      engineTurnId: input.engineTurnId,
      turnLease: input.turnLease,
      userMessageId: input.userMessageId,
      safeToolName: input.safeToolName,
      input: input.input,
      projectionRevision: input.projectionRevision,
    });
    const existing = this.#toolCalls.get(input.callId);
    if (existing) {
      if (existing.fingerprint !== fingerprint) {
        throw new AgentEngineProtocolError(
          'ENGINE_CORRELATION_CONFLICT',
          `OpenCode Tool call ${input.callId} was replayed with another payload`,
        );
      }
      return existing.result.promise;
    }
    if (this.#pendingTool) {
      throw new AgentEngineProtocolError('ENGINE_INPUT_UNEXPECTED', 'OpenCode emitted parallel Tool calls');
    }
    const toolCallId = asToolCallId(`${this.ref.turnId}:${input.callId}`);
    const call: ToolCallRecord = {
      toolCallId,
      fingerprint,
      result: deferred<OpenCodeBridgeToolResponse>(),
    };
    this.#toolCalls.set(input.callId, call);
    this.#pendingTool = call;
    this.#emit({
      type: 'tool.requested',
      toolCallId,
      name: toDefCanonicalToolName(input.safeToolName),
      input: input.input,
    });
    return call.result.promise;
  }

  async submitToolResult(input: EngineToolResultInput): Promise<void> {
    const fingerprint = boundedCanonicalJson(input as unknown as JsonValue, MAX_TOOL_RESULT_BYTES, 'Tool result');
    const accepted = this.#acceptedToolResults.get(input.toolCallId);
    if (accepted !== undefined) {
      if (accepted === fingerprint) return;
      throw conflict(input.toolCallId);
    }
    this.#assertPendingTool(input.toolCallId);
    this.#acceptedToolResults.set(input.toolCallId, fingerprint);
    const pending = this.#pendingTool!;
    this.#pendingTool = null;
    pending.result.resolve(bridgeResponse(input));
  }

  async submitToolResultAndUpdateProjection(
    input: EngineToolResultInput,
    projection: EngineToolProjectionInput,
  ): Promise<void> {
    const resultFingerprint = boundedCanonicalJson(
      input as unknown as JsonValue,
      MAX_TOOL_RESULT_BYTES,
      'Tool result',
    );
    const projectionFingerprint = boundedCanonicalJson(
      projection as unknown as JsonValue,
      MAX_PROMPT_BYTES,
      'Tool projection',
    );
    const acceptedResult = this.#acceptedToolResults.get(input.toolCallId);
    const acceptedProjection = this.#acceptedProjections.get(projection.revision);
    if (acceptedResult !== undefined || acceptedProjection !== undefined) {
      if (acceptedResult === resultFingerprint && acceptedProjection === projectionFingerprint) return;
      throw conflict(input.toolCallId);
    }
    this.#assertPendingTool(input.toolCallId);
    this.#assertFreshProjection(projection);
    projectSafeToolNames(projection);

    // This ordering is the critical Phase 4 invariant: the next LLM step can
    // only resume after the new projection is visible through the bridge.
    this.#projection = projection;
    this.#acceptedToolResults.set(input.toolCallId, resultFingerprint);
    this.#acceptedProjections.set(projection.revision, projectionFingerprint);
    const pending = this.#pendingTool!;
    this.#pendingTool = null;
    this.#emit({ type: 'tool-projection.applied', revision: projection.revision });
    pending.result.resolve(bridgeResponse(input));
  }

  async submitInteractionResult(_input: EngineInteractionResultInput): Promise<void> {
    this.#assertActive();
    throw new AgentEngineProtocolError(
      'ENGINE_INPUT_UNEXPECTED',
      'OpenCode interactions are disabled in Phase 4',
    );
  }

  async updateToolProjection(input: EngineToolProjectionInput): Promise<void> {
    const fingerprint = boundedCanonicalJson(
      input as unknown as JsonValue,
      MAX_PROMPT_BYTES,
      'Tool projection',
    );
    const accepted = this.#acceptedProjections.get(input.revision);
    if (accepted !== undefined) {
      if (accepted === fingerprint) return;
      throw new AgentEngineProtocolError(
        'ENGINE_CORRELATION_CONFLICT',
        `OpenCode projection ${input.revision} was already applied differently`,
      );
    }
    this.#assertActive();
    this.#assertFreshProjection(input);
    projectSafeToolNames(input);
    this.#projection = input;
    this.#acceptedProjections.set(input.revision, fingerprint);
    this.#emit({ type: 'tool-projection.applied', revision: input.revision });
  }

  async abort(reason: EngineAbortReason): Promise<AbortResult> {
    if (this.#terminal) return { status: 'already-terminal', terminalType: this.#terminal.type };
    if (this.#abortPromise) return this.#abortPromise;
    this.#lifecycle = 'aborting';
    this.#abortPromise = (async () => {
      let unsafe = false;
      try {
        const response = await withTimeout(
          this.#runtime.request(`/session/${encodeURIComponent(this.ref.session.sessionId)}/abort`, {
            method: 'POST',
            signal: AbortSignal.timeout(ABORT_TIMEOUT_MS),
          }),
          ABORT_TIMEOUT_MS,
          'OpenCode abort timed out',
        );
        if (!response.ok) unsafe = true;
      } catch {
        unsafe = true;
      }
      if (unsafe) this.#onUnsafe();
      this.#pendingTool?.result.resolve({
        status: 'failed',
        code: reason.code,
        message: reason.message ?? 'DEF Turn was aborted',
      });
      this.#pendingTool = null;
      this.#finish({ type: 'turn.aborted', reason });
      return { status: 'aborted', terminalType: 'turn.aborted' } as const;
    })();
    return this.#abortPromise;
  }

  fail(code: string, message: string): void {
    if (this.#terminal || this.#lifecycle === 'aborting') return;
    this.#pendingTool?.result.resolve({ status: 'failed', code, message });
    this.#pendingTool = null;
    this.#finish({ type: 'turn.failed', code, message: publicTurnFailure(message) });
  }

  async #consumeEvents(connected: Deferred<void>): Promise<void> {
    try {
      const response = await this.#runtime.request('/global/event', {
        headers: { Accept: 'text/event-stream' },
        signal: this.#streamAbort.signal,
      });
      if (!response.ok || !response.body) {
        throw new OpenCodeEngineError('OPENCODE_HTTP_FAILED', 'OpenCode event stream is unavailable');
      }
      for await (const value of parseEventStream(response.body)) {
        const envelope = record(value);
        const payload = record(envelope?.payload);
        const type = typeof payload?.type === 'string' ? payload.type : '';
        if (type === 'server.connected') {
          connected.resolve();
          continue;
        }
        if (envelope?.directory !== this.#runtime.directory) continue;
        const properties = record(payload?.properties);
        if (!properties) continue;
        this.#consumeOpenCodeEvent(type, properties);
      }
      if (!this.#terminal && !this.#streamAbort.signal.aborted) {
        throw new OpenCodeEngineError('OPENCODE_HTTP_FAILED', 'OpenCode event stream ended unexpectedly');
      }
    } catch (error) {
      if (this.#streamAbort.signal.aborted || this.#terminal) return;
      connected.reject(error);
      this.#onUnsafe();
      await this.#abortRemoteSession().catch(() => false);
      this.fail('OPENCODE_EVENT_STREAM_FAILED', messageOf(error));
    }
  }

  #consumeOpenCodeEvent(type: string, properties: Record<string, unknown>): void {
    if (this.#terminal || this.#lifecycle !== 'active') return;
    if (type === 'message.updated') {
      const info = record(properties.info);
      if (!info || info.sessionID !== this.ref.session.sessionId || info.role !== 'assistant') return;
      if (info.parentID !== this.#userMessageId) return;
      const messageId = requiredId(info.id, 'OpenCode assistant message id');
      this.#assistantMessageIds.add(messageId);
      if (!this.#assistantProjectionById.has(messageId)) {
        this.#assistantProjectionById.set(messageId, this.#projection.revision);
      }
      for (const waiter of this.#assistantWaiters.get(messageId) ?? []) waiter.resolve();
      this.#assistantWaiters.delete(messageId);
      this.#flushPendingDeltas(messageId);
      const time = record(info.time);
      if (typeof time?.completed === 'number') this.#currentAssistantCompleted = true;
      if (info.error !== undefined) {
        this.fail('OPENCODE_PROVIDER_FAILED', publicProviderFailure(info.error));
        return;
      }
      if (this.#idleSeen) this.#completeFromIdle();
      return;
    }
    if (type === 'message.part.delta') {
      if (properties.sessionID !== this.ref.session.sessionId || properties.field !== 'text') return;
      if (typeof properties.delta !== 'string' || !properties.delta) return;
      const messageId = requiredId(properties.messageID, 'OpenCode message id');
      const partId = requiredId(properties.partID, 'OpenCode part id');
      const metadata = this.#partMetadata.get(partId);
      if (metadata && metadata.messageId !== messageId) {
        this.fail('OPENCODE_EVENT_INVALID', 'OpenCode part changed its owning message');
        return;
      }
      // OpenCode emits both final text and private model reasoning through
      // message.part.delta with field="text". PartUpdated is the authoritative
      // discriminator; never expose a non-text part to the DEF transcript.
      if (metadata?.type !== undefined && metadata.type !== 'text') return;
      if (!metadata || !this.#assistantMessageIds.has(messageId)) {
        this.#queuePendingDelta(messageId, partId, properties.delta);
        return;
      }
      this.#appendDelta(messageId, properties.delta);
      return;
    }
    if (type === 'message.part.updated') {
      const part = record(properties.part);
      if (!part || (part.sessionID ?? properties.sessionID) !== this.ref.session.sessionId) return;
      const messageId = requiredId(part.messageID, 'OpenCode part message id');
      const partId = requiredId(part.id, 'OpenCode part id');
      if (typeof part.type !== 'string' || !part.type) return;
      const previous = this.#partMetadata.get(partId);
      if (previous && (previous.messageId !== messageId || previous.type !== part.type)) {
        this.fail('OPENCODE_EVENT_INVALID', 'OpenCode part metadata changed after publication');
        return;
      }
      this.#partMetadata.set(partId, { messageId, type: part.type });
      this.#flushPendingDeltas(messageId);
      return;
    }
    if (type === 'session.error') {
      if (properties.sessionID !== this.ref.session.sessionId) return;
      this.fail(
        'OPENCODE_PROVIDER_FAILED',
        publicProviderFailure(properties.error),
      );
      return;
    }
    if (type === 'session.status') {
      if (properties.sessionID !== this.ref.session.sessionId) return;
      const status = record(properties.status);
      if (status?.type !== 'idle') return;
      if (!this.#promptAccepted || !this.#currentAssistantCompleted) return;
      this.#idleSeen = true;
      this.#completeFromIdle();
    }
  }

  #completeFromIdle(): void {
    if (this.#terminal || this.#lifecycle !== 'active') return;
    if (!this.#currentAssistantCompleted || this.#pendingTool) return;
    if (projectSafeToolNames(this.#projection).length !== 0) return;
    this.#finish({
      type: 'turn.completed',
      ...(this.#responseText ? { output: this.#responseText } : {}),
    });
  }

  #flushPendingDeltas(messageId: string): void {
    const deltas = this.#pendingDeltas.get(messageId);
    if (!deltas) return;
    this.#pendingDeltas.delete(messageId);
    this.#pendingDeltaBytes -= deltas.reduce((total, item) => total + Buffer.byteLength(item.delta), 0);
    for (const item of deltas) {
      if (this.#terminal) return;
      const metadata = this.#partMetadata.get(item.partId);
      if (!metadata) {
        this.#queuePendingDelta(messageId, item.partId, item.delta);
        continue;
      }
      if (metadata.messageId !== messageId) {
        this.fail('OPENCODE_EVENT_INVALID', 'OpenCode part changed its owning message');
        return;
      }
      if (metadata.type === 'text' && this.#assistantMessageIds.has(messageId)) {
        this.#appendDelta(messageId, item.delta);
      }
    }
  }

  #queuePendingDelta(messageId: string, partId: string, delta: string): void {
    const queued = this.#pendingDeltas.get(messageId) ?? [];
    queued.push({ partId, delta });
    this.#pendingDeltaBytes += Buffer.byteLength(delta);
    if (this.#pendingDeltaBytes > MAX_RESPONSE_BYTES) {
      this.fail('OPENCODE_RESPONSE_TOO_LARGE', 'OpenCode response exceeded the configured limit');
      return;
    }
    this.#pendingDeltas.set(messageId, queued);
  }

  #appendDelta(messageId: string, delta: string): void {
    const bytes = Buffer.byteLength(delta);
    if (bytes > MAX_RESPONSE_BYTES || this.#responseBytes + bytes > MAX_RESPONSE_BYTES) {
      this.fail('OPENCODE_RESPONSE_TOO_LARGE', 'OpenCode response exceeded the configured limit');
      return;
    }
    this.#responseBytes += bytes;
    this.#responseText += delta;
    this.#emit({
      type: 'response.delta',
      messageId: asEngineMessageId(messageId),
      delta,
    });
  }

  #emit(input: EngineEventInput): void {
    if (this.#terminal) {
      throw new AgentEngineProtocolError('ENGINE_TURN_TERMINAL', `OpenCode Turn ${this.ref.turnId} is terminal`);
    }
    const event = {
      ...input,
      engineTurnId: this.ref.turnId,
      ordinal: ++this.#ordinal,
    } as EngineEvent;
    this.#queue.push(event);
  }

  #finish(input: TerminalEventInput): void {
    if (this.#terminal) return;
    this.#emit(input);
    const event = this.#queue.last;
    if (!event || !isEngineTerminalEvent(event)) throw new Error('OpenCode terminal event projection failed');
    this.#terminal = event;
    this.#lifecycle = 'terminal';
    this.#partMetadata.clear();
    this.#pendingDeltas.clear();
    this.#pendingDeltaBytes = 0;
    for (const waiters of this.#assistantWaiters.values()) {
      for (const waiter of waiters) {
        waiter.reject(new OpenCodeEngineError(
          'OPENCODE_BRIDGE_CORRELATION_FAILED',
          'OpenCode assistant message did not belong to the active DEF Turn',
        ));
      }
    }
    this.#assistantWaiters.clear();
    this.#bridge.unregister(this.ref.session.sessionId, this);
    this.#streamAbort.abort();
    this.#queue.close();
    this.#onTerminal();
  }

  #assertPendingTool(toolCallId: ToolCallId): void {
    this.#assertActive();
    if (!this.#pendingTool || this.#pendingTool.toolCallId !== toolCallId) {
      throw new AgentEngineProtocolError(
        'ENGINE_INPUT_UNEXPECTED',
        `OpenCode Turn is not waiting for Tool result ${toolCallId}`,
      );
    }
  }

  #assertFreshProjection(projection: EngineToolProjectionInput): void {
    if (projection.revision <= this.#projection.revision) {
      throw new AgentEngineProtocolError(
        'ENGINE_PROJECTION_STALE',
        `OpenCode projection ${projection.revision} must be newer than ${this.#projection.revision}`,
      );
    }
  }

  #assertActive(): void {
    if (this.#terminal || this.#lifecycle !== 'active') {
      throw new AgentEngineProtocolError('ENGINE_TURN_TERMINAL', `OpenCode Turn ${this.ref.turnId} is terminal`);
    }
  }

  async #awaitAssistantMessage(messageId: string, projectionRevision: number): Promise<void> {
    const knownRevision = this.#assistantProjectionById.get(messageId);
    if (knownRevision !== undefined) {
      if (knownRevision === projectionRevision) return;
      throw assistantCorrelationError(messageId);
    }
    for (const [knownMessageId, revision] of this.#assistantProjectionById) {
      if (revision === projectionRevision && knownMessageId !== messageId) {
        throw assistantCorrelationError(messageId);
      }
    }
    const waiter = deferred<void>();
    const waiters = this.#assistantWaiters.get(messageId) ?? new Set<Deferred<void>>();
    waiters.add(waiter);
    this.#assistantWaiters.set(messageId, waiters);
    try {
      await withTimeout(
        waiter.promise,
        ASSISTANT_CORRELATION_TIMEOUT_MS,
        'OpenCode assistant message correlation timed out',
        'OPENCODE_BRIDGE_CORRELATION_FAILED',
      );
    } finally {
      waiters.delete(waiter);
      if (waiters.size === 0) this.#assistantWaiters.delete(messageId);
    }
    if (this.#assistantProjectionById.get(messageId) !== projectionRevision) {
      throw assistantCorrelationError(messageId);
    }
  }

  async #abortRemoteSession(): Promise<boolean> {
    const response = await withTimeout(
      this.#runtime.request(`/session/${encodeURIComponent(this.ref.session.sessionId)}/abort`, {
        method: 'POST',
        signal: AbortSignal.timeout(ABORT_TIMEOUT_MS),
      }),
      ABORT_TIMEOUT_MS,
      'OpenCode abort timed out',
    );
    return response.ok;
  }
}

type ToolCallRecord = {
  readonly toolCallId: ToolCallId;
  readonly fingerprint: string;
  readonly result: Deferred<OpenCodeBridgeToolResponse>;
};

class AsyncEventQueue<Value> implements AsyncIterable<Value> {
  readonly #values: Value[] = [];
  readonly #waiters: Array<(result: IteratorResult<Value>) => void> = [];
  #closed = false;
  #last: Value | null = null;

  get last(): Value | null {
    return this.#last;
  }

  push(value: Value): void {
    if (this.#closed) throw new Error('Cannot push to a closed OpenCode event queue');
    this.#last = value;
    const waiter = this.#waiters.shift();
    if (waiter) waiter({ done: false, value });
    else this.#values.push(value);
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    for (const waiter of this.#waiters.splice(0)) waiter({ done: true, value: undefined });
  }

  [Symbol.asyncIterator](): AsyncIterator<Value> {
    return {
      next: async () => {
        const value = this.#values.shift();
        if (value !== undefined) return { done: false, value };
        if (this.#closed) return { done: true, value: undefined };
        return new Promise<IteratorResult<Value>>((resolveValue) => this.#waiters.push(resolveValue));
      },
    };
  }
}

type Deferred<Value> = {
  readonly promise: Promise<Value>;
  resolve(value: Value): void;
  reject(error: unknown): void;
};

function deferred<Value>(): Deferred<Value> {
  let resolveValue!: (value: Value) => void;
  let rejectValue!: (error: unknown) => void;
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolveValue = resolvePromise;
    rejectValue = rejectPromise;
  });
  return { promise, resolve: resolveValue, reject: rejectValue };
}

function bridgeResponse(input: EngineToolResultInput): OpenCodeBridgeToolResponse {
  return input.status === 'succeeded'
    ? { status: 'succeeded', result: input.result }
    : {
        status: 'failed',
        code: input.code,
        message: input.message,
        ...(input.details === undefined ? {} : { details: input.details }),
      };
}

function conflict(toolCallId: ToolCallId): AgentEngineProtocolError {
  return new AgentEngineProtocolError(
    'ENGINE_CORRELATION_CONFLICT',
    `OpenCode Tool result/projection conflicts with an accepted payload for ${toolCallId}`,
  );
}

function assistantCorrelationError(messageId: string): OpenCodeEngineError {
  return new OpenCodeEngineError(
    'OPENCODE_BRIDGE_CORRELATION_FAILED',
    `OpenCode assistant message ${messageId} does not belong to the active projection`,
  );
}

async function nextOpenCodeUserMessageId(
  runtime: RunningOpenCodeRuntime,
  sessionId: string,
): Promise<string> {
  const response = await runtime.request(
    `/session/${encodeURIComponent(sessionId)}/message?limit=${RECENT_MESSAGE_LOOKBACK}`,
    { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
  );
  const body = await requiredJsonResponse(
    response,
    'OPENCODE_MESSAGE_HISTORY_FAILED',
    MAX_RESPONSE_BYTES,
  );
  if (!Array.isArray(body) || body.length > RECENT_MESSAGE_LOOKBACK) {
    throw new OpenCodeEngineError(
      'OPENCODE_RESPONSE_INVALID',
      'OpenCode recent message history is invalid',
    );
  }
  const recentIds = body.map((message) => {
    const id = requiredId(record(record(message)?.info)?.id, 'OpenCode recent message id');
    if (!id.startsWith('msg')) {
      throw new OpenCodeEngineError(
        'OPENCODE_RESPONSE_INVALID',
        'OpenCode recent message id has an invalid prefix',
      );
    }
    return id;
  });
  const latestId = recentIds.reduce<string | null>(
    (latest, id) => latest === null || id > latest ? id : latest,
    null,
  );
  const deadline = Date.now() + MESSAGE_ID_CLOCK_WAIT_MS;
  for (;;) {
    // Keep the user ID one millisecond behind wall clock. The OpenCode process
    // creates the assistant after accepting this request, so its native
    // MessageID.ascending() remains strictly newer even though the two
    // processes do not share the generator's in-memory counter.
    const candidate = createOpenCodeAscendingMessageId(Date.now() - 1);
    if (latestId === null || candidate > latestId) return candidate;
    if (Date.now() >= deadline) {
      throw new OpenCodeEngineError(
        'OPENCODE_RESPONSE_INVALID',
        'OpenCode message chronology did not advance',
      );
    }
    await new Promise<void>((resolveWait) => setTimeout(resolveWait, 1));
  }
}

function createOpenCodeAscendingMessageId(timestamp: number): string {
  const encoded = (BigInt(timestamp) * OPENCODE_ID_TIME_MULTIPLIER) & OPENCODE_ID_TIME_MASK;
  const time = encoded.toString(16).padStart(12, '0');
  const bytes = randomBytes(14);
  let suffix = '';
  for (const byte of bytes) suffix += OPENCODE_ID_RANDOM_ALPHABET.charAt(byte % OPENCODE_ID_RANDOM_ALPHABET.length);
  return `msg_${time}${suffix}`;
}

async function requiredJsonResponse(
  response: Response,
  code: string,
  maxBytes = MAX_PROMPT_BYTES,
): Promise<unknown> {
  if (!response.ok) {
    throw new OpenCodeEngineError('OPENCODE_HTTP_FAILED', `${code} (HTTP ${response.status})`);
  }
  try {
    const text = await readBoundedResponseText(response, maxBytes);
    return JSON.parse(text);
  } catch {
    throw new OpenCodeEngineError('OPENCODE_RESPONSE_INVALID', `${code} returned invalid JSON`);
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function requiredId(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 512) {
    throw new OpenCodeEngineError('OPENCODE_RESPONSE_INVALID', `${label} is invalid`);
  }
  return value;
}

function basicCompatible(ref: EngineSessionRef): boolean {
  return ref.kind === ENGINE_KIND && ref.storeSchemaVersion === OPENCODE_STORE_SCHEMA_VERSION;
}

function runtimeCompatible(ref: EngineSessionRef, runtime: RunningOpenCodeRuntime): boolean {
  return basicCompatible(ref)
    && ref.runtimeVersion === runtime.verified.manifest.runtimeVersion
    && ref.storeSchemaVersion === runtime.verified.manifest.storeSchemaVersion;
}

function incompatible(ref: EngineSessionRef): EngineRecoveryResult {
  return {
    status: 'incompatible',
    code: 'ENGINE_SESSION_INCOMPATIBLE',
    message: `OpenCode Engine cannot recover ${ref.kind}@${ref.runtimeVersion}/schema-${ref.storeSchemaVersion}`,
  };
}

async function* parseEventStream(stream: ReadableStream<Uint8Array>): AsyncIterable<unknown> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let dataLines: string[] = [];
  let frameBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      if (Buffer.byteLength(buffer) > MAX_SSE_BUFFER_BYTES) {
        throw new OpenCodeEngineError('OPENCODE_RESPONSE_INVALID', 'OpenCode event stream frame is too large');
      }
      let index: number;
      while ((index = buffer.indexOf('\n')) >= 0) {
        const rawLine = buffer.slice(0, index);
        buffer = buffer.slice(index + 1);
        const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
        if (!line) {
          if (dataLines.length) {
            const text = dataLines.join('\n');
            dataLines = [];
            frameBytes = 0;
            yield JSON.parse(text);
          }
          continue;
        }
        if (line.startsWith('data:')) {
          const data = line.slice(5).trimStart();
          frameBytes += Buffer.byteLength(data) + (dataLines.length === 0 ? 0 : 1);
          if (frameBytes > MAX_SSE_BUFFER_BYTES) {
            throw new OpenCodeEngineError('OPENCODE_RESPONSE_INVALID', 'OpenCode event stream frame is too large');
          }
          dataLines.push(data);
        }
      }
      if (done) break;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

async function withTimeout<Value>(
  promise: Promise<Value>,
  milliseconds: number,
  message: string,
  code: OpenCodeEngineErrorCode = 'OPENCODE_HTTP_FAILED',
): Promise<Value> {
  let handle: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<Value>((_resolve, reject) => {
        handle = setTimeout(() => reject(new OpenCodeEngineError(code, message)), milliseconds);
      }),
    ]);
  } finally {
    if (handle) clearTimeout(handle);
  }
}

async function waitForSessionIdle(runtime: RunningOpenCodeRuntime, sessionId: string): Promise<void> {
  const deadline = Date.now() + RECOVERY_IDLE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const response = await runtime.request('/session/status', {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const body = record(await requiredJsonResponse(response, 'OPENCODE_SESSION_STATUS_FAILED'));
    if (!body) {
      throw new OpenCodeEngineError(
        'OPENCODE_SESSION_RECOVERY_FAILED',
        'OpenCode session status response is malformed',
      );
    }
    if (!(sessionId in body)) return;
    const status = record(body[sessionId]);
    if (!status || typeof status.type !== 'string') {
      throw new OpenCodeEngineError(
        'OPENCODE_SESSION_RECOVERY_FAILED',
        'OpenCode session status response is malformed',
      );
    }
    if (status.type === 'idle') return;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));
  }
  throw new OpenCodeEngineError(
    'OPENCODE_SESSION_RECOVERY_FAILED',
    'OpenCode session did not become idle before recovery',
  );
}

async function readBoundedResponseText(response: Response, maxBytes: number): Promise<string> {
  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) throw new Error('response too large');
  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) throw new Error('response too large');
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return text;
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

function publicTurnFailure(message: string): string {
  const compact = message.replace(/\s+/gu, ' ').trim();
  if (!compact) return 'OpenCode Engine Turn failed';
  return compact.slice(0, 240);
}

function publicProviderFailure(value: unknown): string {
  const error = record(value);
  const data = record(error?.data);
  const statusCode = typeof data?.statusCode === 'number' ? data.statusCode : null;
  if (statusCode === 401 || statusCode === 403) {
    return '模型服务认证失败，请在桌面 Shell 更新 API Key。';
  }
  if (statusCode === 404) {
    return '模型或接口地址不存在，请检查桌面 Shell 中的 Base URL 与 Model ID。';
  }
  if (statusCode === 429) {
    return '模型服务限流或额度不足，请稍后重试或检查账户额度。';
  }
  if (statusCode === 400 || statusCode === 422) {
    return '模型服务拒绝了请求，请检查桌面 Shell 中的 Provider 配置。';
  }
  if (statusCode !== null && statusCode >= 500) {
    return '模型服务暂时不可用，请稍后重试。';
  }
  return 'OpenCode provider request failed';
}

function ensureBoundedUtf8(value: string, maxBytes: number, label: string): void {
  if (Buffer.byteLength(value) > maxBytes) {
    throw new OpenCodeEngineError('OPENCODE_BRIDGE_INVALID', `${label} is too large`);
  }
}

const USER_ATTACHMENT_MIMES = new Set([
  'application/pdf',
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp',
  'text/plain',
]);

function validateUserAttachments(
  value: readonly EngineUserAttachment[] | undefined,
): readonly EngineUserAttachment[] {
  const attachments = value ?? [];
  if (attachments.length > MAX_USER_ATTACHMENTS) {
    throw new OpenCodeEngineError('OPENCODE_BRIDGE_INVALID', 'OpenCode user attachment count is too large');
  }
  let totalBytes = 0;
  return attachments.map((attachment) => {
    const mime = attachment.mime.trim().toLowerCase();
    if (!USER_ATTACHMENT_MIMES.has(mime)) {
      throw new OpenCodeEngineError('OPENCODE_BRIDGE_INVALID', `OpenCode attachment MIME is not supported: ${mime}`);
    }
    const filename = attachment.filename.trim();
    if (
      !filename
      || filename.length > 240
      || filename.includes('\u0000')
      || filename.includes('/')
      || filename.includes('\\')
    ) {
      throw new OpenCodeEngineError('OPENCODE_BRIDGE_INVALID', 'OpenCode attachment filename is invalid');
    }
    const match = /^data:([^;,]+);base64,([A-Za-z0-9+/]*={0,2})$/u.exec(attachment.url);
    if (!match || match[1]?.toLowerCase() !== mime || match[2]!.length % 4 !== 0) {
      throw new OpenCodeEngineError('OPENCODE_BRIDGE_INVALID', 'OpenCode attachment data URL is invalid');
    }
    const bytes = Buffer.from(match[2]!, 'base64');
    if (bytes.toString('base64') !== match[2]) {
      throw new OpenCodeEngineError('OPENCODE_BRIDGE_INVALID', 'OpenCode attachment base64 is invalid');
    }
    totalBytes += bytes.length;
    if (totalBytes > MAX_USER_ATTACHMENT_BYTES) {
      throw new OpenCodeEngineError('OPENCODE_BRIDGE_INVALID', 'OpenCode user attachments are too large');
    }
    return { type: 'file' as const, mime, filename, url: attachment.url };
  });
}

function boundedCanonicalJson(value: JsonValue, maxBytes: number, label: string): string {
  const serialized = canonicalJson(value);
  if (Buffer.byteLength(serialized) > maxBytes) {
    throw new OpenCodeEngineError('OPENCODE_BRIDGE_INVALID', `${label} is too large`);
  }
  return serialized;
}
