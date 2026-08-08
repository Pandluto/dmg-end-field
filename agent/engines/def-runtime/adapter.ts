import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import {
  asEngineMessageId,
  asEngineSessionId,
  asEngineTurnId,
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
  type EngineToolProjectionInput,
  type EngineToolResultInput,
  type EngineTurnHandle,
  type EngineTurnInput,
  type EngineTurnRef,
} from '../../core/contracts/index.ts';
import { HostToolBridge } from '../../runtime/kernel/host-tool-bridge.ts';
import { asRuntimeContentId, asRuntimeSessionId } from '../../runtime/kernel/ids.ts';
import type { RuntimeUserContent } from '../../runtime/kernel/messages.ts';
import { OpenAICompatibleDriver } from '../../runtime/kernel/provider/openai-compatible-driver.ts';
import type {
  ModelDriver,
  RuntimeModelConnection,
} from '../../runtime/kernel/provider/model-driver.ts';
import {
  RuntimeSession,
  type RuntimeRunHandle,
} from '../../runtime/kernel/runtime-session.ts';
import type { RuntimeRunTerminal } from '../../runtime/kernel/stream-events.ts';
import {
  toRuntimeModelConnection,
  type ProviderProfile,
  type ProviderProfileSource,
} from './profile.ts';
import { DefRuntimeEngineError } from './errors.ts';
import { DefRuntimeTranscriptSource } from './transcript-source.ts';

export const DEF_RUNTIME_ENGINE_KIND = 'def-runtime' as const;
export const DEF_RUNTIME_VERSION = 'def-runtime-v1' as const;
export const DEF_RUNTIME_STORE_SCHEMA_VERSION = 1 as const;

export interface DefRuntimeEngineAdapterOptions {
  readonly storeRoot: string;
  readonly profileSource: ProviderProfileSource;
  readonly probeProfileRef?: string;
  readonly modelDriver?: ModelDriver;
  readonly systemPromptVersion?: string;
}

interface SessionState {
  readonly ref: EngineSessionRef;
  readonly filePath: string;
  runtime: RuntimeSession;
  profileRef: string;
  systemContext: string;
  bridge: HostToolBridge | null;
}

export class DefRuntimeEngineAdapter implements AgentEngine {
  readonly kind = DEF_RUNTIME_ENGINE_KIND;
  readonly transcriptSource = new DefRuntimeTranscriptSource();

  readonly #storeRoot: string;
  readonly #profileSource: ProviderProfileSource;
  readonly #probeProfileRef: string;
  readonly #modelDriver: ModelDriver;
  readonly #systemPromptVersion: string;
  readonly #sessions = new Map<string, SessionState>();
  #shutdown = false;

  constructor(options: DefRuntimeEngineAdapterOptions) {
    if (!options.storeRoot) throw new TypeError('DEF Runtime store root is required');
    this.#storeRoot = options.storeRoot;
    this.#profileSource = options.profileSource;
    this.#probeProfileRef = options.probeProfileRef?.trim() || 'default';
    this.#modelDriver = options.modelDriver ?? new OpenAICompatibleDriver();
    this.#systemPromptVersion = options.systemPromptVersion ?? 'def-workbench-v1';
    mkdirSync(this.#storeRoot, { recursive: true });
  }

  async probe(): Promise<EngineHealth> {
    if (this.#shutdown) {
      return unavailable('DEF_RUNTIME_SHUTDOWN', 'DEF Runtime has stopped');
    }
    try {
      const profile = await this.#profileSource.getProfile(this.#probeProfileRef);
      if (!profile) {
        return unavailable(
          'DEF_RUNTIME_PROFILE_NOT_FOUND',
          'Provider profile is not configured. Please update it in the desktop Shell.',
        );
      }
      return {
        status: 'ready',
        kind: this.kind,
        runtimeVersion: DEF_RUNTIME_VERSION,
      };
    } catch {
      return unavailable(
        'DEF_RUNTIME_PROFILE_INVALID',
        'Provider profile cannot be read. Please update it in the desktop Shell.',
      );
    }
  }

  async createSession(input: EngineSessionCreateInput): Promise<EngineSessionRef> {
    this.#assertRunning();
    await this.#requireProfile(input.providerProfileRef);
    const runtimeSessionId = asRuntimeSessionId(`def-runtime-${randomUUID()}`);
    const ref = engineRef(runtimeSessionId);
    const state = this.#createState({
      ref,
      filePath: this.#sessionPath(ref),
      profileRef: input.providerProfileRef,
      create: true,
      defSessionId: input.defSessionId,
    });
    this.#sessions.set(String(ref.sessionId), state);
    await this.transcriptSource.registerSession(ref, state.runtime);
    return ref;
  }

  async recoverSession(ref: EngineSessionRef): Promise<EngineRecoveryResult> {
    this.#assertRunning();
    if (!isCompatibleRef(ref)) {
      return {
        status: 'incompatible',
        code: 'DEF_RUNTIME_SESSION_INCOMPATIBLE',
        message: 'The Session belongs to another Agent runtime.',
      };
    }
    const existing = this.#sessions.get(String(ref.sessionId));
    if (existing) return { status: 'recovered', ref: existing.ref };
    const filePath = this.#sessionPath(ref);
    if (!existsSync(filePath)) return { status: 'missing' };
    try {
      const state = this.#createState({
        ref,
        filePath,
        profileRef: this.#probeProfileRef,
        create: false,
      });
      state.profileRef = state.runtime.header.providerProfileRef;
      await this.#requireProfile(state.profileRef);
      this.#sessions.set(String(ref.sessionId), state);
      await this.transcriptSource.registerSession(ref, state.runtime);
      return { status: 'recovered', ref };
    } catch {
      return {
        status: 'incompatible',
        code: 'DEF_RUNTIME_SESSION_INCOMPATIBLE',
        message: 'The DEF Runtime Session could not be recovered.',
      };
    }
  }

  async startTurn(input: EngineTurnInput): Promise<EngineTurnHandle> {
    this.#assertRunning();
    const state = this.#requireState(input.engineSession);
    if (state.bridge) {
      throw new DefRuntimeEngineError('DEF_RUNTIME_TURN_INACTIVE', 'A DEF Runtime turn is already active.');
    }
    await this.#requireProfile(input.providerProfileRef);
    state.profileRef = input.providerProfileRef;
    state.systemContext = input.systemContext;

    const engineTurnId = asEngineTurnId(`def-runtime-turn-${input.defTurnId}`);
    const stream = new EngineEventStream();
    let ordinal = 0;
    let terminal = false;
    let runtimeHandle: RuntimeRunHandle | null = null;
    let unsubscribe: () => void = () => undefined;

    const finish = (terminalValue: RuntimeRunTerminal): void => {
      if (terminal) return;
      terminal = true;
      stream.push(engineTerminal(engineTurnId, ++ordinal, terminalValue));
      stream.close();
      unsubscribe();
      if (state.bridge === bridge) state.bridge = null;
    };
    const bridge = new HostToolBridge({
      initialProjection: input.toolProjection,
      emitRequest: (request) => {
        stream.push({
          type: 'tool.requested',
          engineTurnId,
          ordinal: ++ordinal,
          toolCallId: request.invocation.call.toolCallId,
          name: request.invocation.call.name,
          input: request.invocation.call.arguments,
        });
      },
    });
    state.bridge = bridge;
    unsubscribe = state.runtime.subscribe((event) => {
      if ('defTurnId' in event && event.defTurnId !== input.defTurnId) return;
      if (event.type === 'message.update' && event.delta.type === 'text' && event.delta.delta) {
        stream.push({
          type: 'response.delta',
          engineTurnId,
          ordinal: ++ordinal,
          messageId: asEngineMessageId(String(event.messageId)),
          delta: event.delta.delta,
        });
      } else if (event.type === 'run.end') {
        finish(event.terminal);
      }
    });

    try {
      runtimeHandle = await state.runtime.startTurn({
        defTurnId: input.defTurnId,
        clientTurnId: input.clientTurnId,
        content: runtimeUserContent(input),
        ...(input.engineUserMessageId === undefined
          ? {}
          : { messageId: String(input.engineUserMessageId) }),
      });
    } catch (error) {
      unsubscribe();
      state.bridge = null;
      stream.close();
      throw error;
    }

    void runtimeHandle.result.then(
      (result) => finish(result.terminal),
      () => finish({
        status: 'failed',
        code: 'DEF_RUNTIME_TURN_FAILED',
        message: 'The DEF Runtime turn failed.',
      }),
    );
    return new DefRuntimeTurnHandle({
      ref: { session: state.ref, turnId: engineTurnId },
      events: stream,
      bridge,
      runtimeHandle,
    });
  }

  async compact(ref: EngineSessionRef): Promise<CompactionResult> {
    this.#assertRunning();
    const outcome = await this.#requireState(ref).runtime.compact({ reason: 'manual' });
    return outcome.status === 'compacted'
      ? { status: 'compacted', summaryRef: String(outcome.entry.id) }
      : { status: 'not-needed' };
  }

  async disposeSession(ref: EngineSessionRef): Promise<void> {
    const state = this.#sessions.get(String(ref.sessionId));
    if (state) {
      this.transcriptSource.unregisterSession(state.ref);
      await state.runtime.close();
      this.#sessions.delete(String(ref.sessionId));
    }
    if (isCompatibleRef(ref)) rmSync(this.#sessionPath(ref), { force: true });
  }

  async shutdown(): Promise<void> {
    if (this.#shutdown) return;
    this.#shutdown = true;
    const sessions = [...this.#sessions.values()];
    this.transcriptSource.close();
    await Promise.all(sessions.map((state) => state.runtime.close()));
    this.#sessions.clear();
  }

  #createState(input: {
    readonly ref: EngineSessionRef;
    readonly filePath: string;
    readonly profileRef: string;
    readonly create: boolean;
    readonly defSessionId?: EngineSessionCreateInput['defSessionId'];
  }): SessionState {
    const state = {} as SessionState;
    Object.assign(state, {
      ref: input.ref,
      filePath: input.filePath,
      profileRef: input.profileRef,
      systemContext: '',
      bridge: null,
    });
    const options = {
      filePath: input.filePath,
      rootDir: this.#storeRoot,
      modelDriver: this.#modelDriver,
      connection: async () => runtimeModelConnection(await this.#requireProfile(state.profileRef)),
      toolBridge: () => {
        if (!state.bridge) {
          throw new DefRuntimeEngineError('DEF_RUNTIME_TURN_INACTIVE', 'No Host Tool bridge is active.');
        }
        return state.bridge;
      },
      context: () => ({ stableSystemPrompt: state.systemContext }),
      systemPromptVersion: this.#systemPromptVersion,
    } as const;
    state.runtime = input.create
      ? RuntimeSession.create({
        ...options,
        runtimeSessionId: String(input.ref.sessionId),
        defSessionId: input.defSessionId,
        runtimeVersion: DEF_RUNTIME_VERSION,
        providerProfileRef: input.profileRef,
      })
      : RuntimeSession.recover(options);
    return state;
  }

  #sessionPath(ref: EngineSessionRef): string {
    const id = String(ref.sessionId);
    if (!/^[A-Za-z0-9._-]{1,256}$/u.test(id)) {
      throw new DefRuntimeEngineError('DEF_RUNTIME_SESSION_INCOMPATIBLE', 'Runtime Session ID is invalid.');
    }
    return join(this.#storeRoot, `${id}.jsonl`);
  }

  #requireState(ref: EngineSessionRef): SessionState {
    if (!isCompatibleRef(ref)) {
      throw new DefRuntimeEngineError('DEF_RUNTIME_SESSION_INCOMPATIBLE', 'The Session belongs to another runtime.');
    }
    const state = this.#sessions.get(String(ref.sessionId));
    if (!state) {
      throw new DefRuntimeEngineError('DEF_RUNTIME_SESSION_NOT_FOUND', 'The DEF Runtime Session is not loaded.');
    }
    return state;
  }

  async #requireProfile(ref: string) {
    const profile = await this.#profileSource.getProfile(ref);
    if (!profile) {
      throw new DefRuntimeEngineError(
        'DEF_RUNTIME_PROFILE_NOT_FOUND',
        'Provider profile is not configured. Please update it in the desktop Shell.',
      );
    }
    return profile;
  }

  #assertRunning(): void {
    if (this.#shutdown) throw new DefRuntimeEngineError('DEF_RUNTIME_SHUTDOWN', 'DEF Runtime has stopped.');
  }
}

function runtimeModelConnection(profile: ProviderProfile): RuntimeModelConnection {
  const connection = toRuntimeModelConnection(profile);
  const headers = connection.headers === undefined
    ? undefined
    : Object.fromEntries(Object.entries(connection.headers));
  return {
    providerId: connection.providerId,
    modelId: connection.modelId,
    baseUrl: connection.baseUrl,
    apiKey: connection.apiKey,
    ...(headers === undefined ? {} : { headers }),
    ...(connection.contextLimit === undefined ? {} : { contextLimit: connection.contextLimit }),
    ...(connection.outputLimit === undefined ? {} : { outputLimit: connection.outputLimit }),
  };
}

class DefRuntimeTurnHandle implements EngineTurnHandle {
  readonly ref: EngineTurnRef;
  readonly events: AsyncIterable<EngineEvent>;
  readonly #bridge: HostToolBridge;
  readonly #runtimeHandle: RuntimeRunHandle;

  constructor(input: {
    readonly ref: EngineTurnRef;
    readonly events: AsyncIterable<EngineEvent>;
    readonly bridge: HostToolBridge;
    readonly runtimeHandle: RuntimeRunHandle;
  }) {
    this.ref = input.ref;
    this.events = input.events;
    this.#bridge = input.bridge;
    this.#runtimeHandle = input.runtimeHandle;
  }

  submitToolResult(input: EngineToolResultInput): Promise<void> {
    return this.#bridge.submitToolResult(input);
  }

  submitToolResultAndUpdateProjection(
    input: EngineToolResultInput,
    projection: EngineToolProjectionInput,
  ): Promise<void> {
    return this.#bridge.submitToolResultAndUpdateProjection(input, projection);
  }

  submitInteractionResult(_input: EngineInteractionResultInput): Promise<void> {
    return Promise.reject(new DefRuntimeEngineError(
      'DEF_RUNTIME_INTERACTION_UNSUPPORTED',
      'Interactions are settled by the DEF Host Harness.',
    ));
  }

  updateToolProjection(_input: EngineToolProjectionInput): Promise<void> {
    return Promise.reject(new DefRuntimeEngineError(
      'DEF_RUNTIME_PROJECTION_UNSUPPORTED',
      'Tool projection changes must be settled atomically with a Tool result.',
    ));
  }

  async abort(reason: EngineAbortReason): Promise<AbortResult> {
    const terminal = await this.#runtimeHandle.abort(reason);
    return terminal.status === 'aborted'
      ? { status: 'aborted', terminalType: 'turn.aborted' }
      : {
        status: 'already-terminal',
        terminalType: terminal.status === 'completed' ? 'turn.completed' : 'turn.failed',
      };
  }
}

class EngineEventStream implements AsyncIterable<EngineEvent> {
  readonly #values: EngineEvent[] = [];
  readonly #waiters: Array<(value: IteratorResult<EngineEvent>) => void> = [];
  #closed = false;

  push(value: EngineEvent): void {
    if (this.#closed) return;
    const waiter = this.#waiters.shift();
    if (waiter) waiter({ done: false, value });
    else this.#values.push(value);
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    for (const waiter of this.#waiters.splice(0)) waiter({ done: true, value: undefined });
  }

  [Symbol.asyncIterator](): AsyncIterator<EngineEvent> {
    return {
      next: () => {
        const value = this.#values.shift();
        if (value) return Promise.resolve({ done: false, value });
        if (this.#closed) return Promise.resolve({ done: true, value: undefined });
        return new Promise<IteratorResult<EngineEvent>>((resolve) => this.#waiters.push(resolve));
      },
      return: async () => {
        this.close();
        return { done: true, value: undefined };
      },
    };
  }
}

function runtimeUserContent(input: EngineTurnInput): readonly RuntimeUserContent[] {
  const prefix = input.engineUserMessageId ?? input.defTurnId;
  return [
    {
      type: 'text',
      id: asRuntimeContentId(`${prefix}:content:0`),
      text: input.userMessage,
    },
    ...(input.userAttachments ?? []).map((attachment, index) => ({
      type: 'file' as const,
      id: asRuntimeContentId(`${prefix}:attachment:${index + 1}`),
      mime: attachment.mime,
      filename: attachment.filename,
      url: attachment.url,
    })),
  ];
}

function engineTerminal(
  engineTurnId: EngineTurnRef['turnId'],
  ordinal: number,
  terminal: RuntimeRunTerminal,
): EngineEvent {
  if (terminal.status === 'completed') {
    return {
      type: 'turn.completed',
      engineTurnId,
      ordinal,
      ...(terminal.output === undefined ? {} : { output: terminal.output }),
    };
  }
  if (terminal.status === 'failed') {
    return {
      type: 'turn.failed',
      engineTurnId,
      ordinal,
      code: terminal.code,
      message: terminal.message,
    };
  }
  return {
    type: 'turn.aborted',
    engineTurnId,
    ordinal,
    reason: {
      code: terminal.code,
      ...(terminal.message === undefined ? {} : { message: terminal.message }),
    },
  };
}

function engineRef(runtimeSessionId: ReturnType<typeof asRuntimeSessionId>): EngineSessionRef {
  return {
    kind: DEF_RUNTIME_ENGINE_KIND,
    sessionId: asEngineSessionId(String(runtimeSessionId)),
    runtimeVersion: DEF_RUNTIME_VERSION,
    storeSchemaVersion: DEF_RUNTIME_STORE_SCHEMA_VERSION,
  };
}

function isCompatibleRef(ref: EngineSessionRef): boolean {
  return ref.kind === DEF_RUNTIME_ENGINE_KIND
    && ref.runtimeVersion === DEF_RUNTIME_VERSION
    && ref.storeSchemaVersion === DEF_RUNTIME_STORE_SCHEMA_VERSION;
}

function unavailable(code: string, message: string): EngineHealth {
  return { status: 'unavailable', kind: DEF_RUNTIME_ENGINE_KIND, code, message };
}
