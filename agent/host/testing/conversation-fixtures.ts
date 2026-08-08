import {
  asConversationMessageId,
  asConversationPartId,
  asDefSessionId,
  asDefTurnId,
  asEngineSessionId,
  asInteractionId,
  asToolCallId,
  type ConversationMessage,
  type DefEvent,
  type DefSessionId,
  type EngineSessionRef,
  type JsonObject,
  type RuntimeTranscriptEvent,
  type RuntimeTranscriptMutation,
  type RuntimeTranscriptPart,
  type RuntimeTranscriptSnapshot,
  type RuntimeTranscriptSource,
} from '../../core/contracts/index.ts';
import type {
  ConversationHostJournalSnapshot,
  ConversationHostJournalSource,
  ConversationHostSession,
} from '../conversation-projector.ts';

export const FIXTURE_SESSION_ID = asDefSessionId('conversation-fixture-session');
export const FIXTURE_ENGINE_SESSION: EngineSessionRef = {
  kind: 'synthetic-runtime',
  sessionId: asEngineSessionId('conversation-fixture-engine'),
  runtimeVersion: 'fixture-runtime-1',
  storeSchemaVersion: 1,
};
export const FIXTURE_TURN_ID = asDefTurnId('conversation-fixture-turn');
export const FIXTURE_ASSISTANT_MESSAGE_ID = asConversationMessageId('message-assistant-fixture');
export const FIXTURE_USER_MESSAGE_ID = asConversationMessageId('message-user-fixture');
export const FIXTURE_TEXT_PART_ID = asConversationPartId('part-text-fixture');
export const FIXTURE_REASONING_PART_ID = asConversationPartId('part-reasoning-fixture');
export const FIXTURE_TOOL_PART_ID = asConversationPartId('part-tool-fixture');
export const FIXTURE_COMPACTION_PART_ID = asConversationPartId('part-compaction-fixture');
export const FIXTURE_FILE_PART_ID = asConversationPartId('part-file-fixture');
export const FIXTURE_ERROR_PART_ID = asConversationPartId('part-error-fixture');
export const FIXTURE_TOOL_CALL_ID = asToolCallId('tool-fixture');
export const FIXTURE_INTERACTION_ID = asInteractionId('interaction-fixture');

const FIXTURE_TIME = '2026-08-08T00:00:00.000Z';

export interface ConversationFixtureOptions {
  readonly live?: boolean;
  readonly sessionId?: DefSessionId;
  readonly engineSession?: EngineSessionRef;
}

export interface ConversationFixture {
  readonly sessionId: DefSessionId;
  readonly engineSession: EngineSessionRef;
  readonly runtime: SyntheticRuntimeTranscriptSource;
  readonly host: SyntheticHostJournalSource;
  readonly runtimeSnapshot: RuntimeTranscriptSnapshot;
  readonly hostSnapshot: ConversationHostJournalSnapshot;
}

export function createConversationFixture(options: ConversationFixtureOptions = {}): ConversationFixture {
  const sessionId = options.sessionId ?? FIXTURE_SESSION_ID;
  const engineSession = options.engineSession ?? FIXTURE_ENGINE_SESSION;
  const runtimeSnapshot = createFixtureRuntimeSnapshot(engineSession);
  const runtime = new SyntheticRuntimeTranscriptSource(runtimeSnapshot, options.live ?? false);
  const host = new SyntheticHostJournalSource(sessionId, engineSession, options.live ?? false);
  return {
    sessionId,
    engineSession,
    runtime,
    host,
    get runtimeSnapshot() {
      return runtime.getCurrentSnapshot();
    },
    get hostSnapshot() {
      return host.getCurrentSnapshot();
    },
  };
}

export function createFixtureRuntimeSnapshot(
  engineSession: EngineSessionRef = FIXTURE_ENGINE_SESSION,
): RuntimeTranscriptSnapshot {
  const userMessage: ConversationMessage = {
    id: FIXTURE_USER_MESSAGE_ID,
    role: 'user',
    defTurnId: FIXTURE_TURN_ID,
    createdAt: FIXTURE_TIME,
    completedAt: FIXTURE_TIME,
    partIds: [],
  };
  const assistantMessage: ConversationMessage = {
    id: FIXTURE_ASSISTANT_MESSAGE_ID,
    role: 'assistant',
    defTurnId: FIXTURE_TURN_ID,
    createdAt: FIXTURE_TIME,
    partIds: [
      FIXTURE_TEXT_PART_ID,
      FIXTURE_REASONING_PART_ID,
      FIXTURE_TOOL_PART_ID,
      FIXTURE_COMPACTION_PART_ID,
      FIXTURE_FILE_PART_ID,
      FIXTURE_ERROR_PART_ID,
    ],
  };
  const parts: RuntimeTranscriptPart[] = [
    {
      id: FIXTURE_TEXT_PART_ID,
      messageId: FIXTURE_ASSISTANT_MESSAGE_ID,
      createdAt: FIXTURE_TIME,
      type: 'text',
      text: 'fixture text',
    },
    {
      id: FIXTURE_REASONING_PART_ID,
      messageId: FIXTURE_ASSISTANT_MESSAGE_ID,
      createdAt: FIXTURE_TIME,
      type: 'reasoning',
      text: 'fixture reasoning',
      redacted: false,
    },
    {
      id: FIXTURE_TOOL_PART_ID,
      messageId: FIXTURE_ASSISTANT_MESSAGE_ID,
      createdAt: FIXTURE_TIME,
      type: 'tool',
      toolCallId: FIXTURE_TOOL_CALL_ID,
      name: 'fixture.tool',
      state: {
        status: 'pending',
        input: { value: 'fixture' },
      },
    },
    {
      id: FIXTURE_COMPACTION_PART_ID,
      messageId: FIXTURE_ASSISTANT_MESSAGE_ID,
      createdAt: FIXTURE_TIME,
      type: 'compaction',
      reason: 'threshold',
      state: 'completed',
      summary: 'fixture compaction',
    },
    {
      id: FIXTURE_FILE_PART_ID,
      messageId: FIXTURE_ASSISTANT_MESSAGE_ID,
      createdAt: FIXTURE_TIME,
      type: 'file',
      mime: 'text/plain',
      filename: 'fixture.txt',
      url: 'data:text/plain,fixture',
    },
    {
      id: FIXTURE_ERROR_PART_ID,
      messageId: FIXTURE_ASSISTANT_MESSAGE_ID,
      createdAt: FIXTURE_TIME,
      type: 'error',
      code: 'FIXTURE_ERROR',
      message: 'fixture error',
      retryable: true,
    },
  ];
  return {
    schemaVersion: 1,
    engineSession: clone(engineSession),
    sequence: 6,
    status: { status: 'idle' },
    messages: [userMessage, assistantMessage],
    parts,
  };
}

export class SyntheticRuntimeTranscriptSource implements RuntimeTranscriptSource {
  #snapshot: RuntimeTranscriptSnapshot;
  readonly #events: RuntimeTranscriptEvent[] = [];
  readonly #waiters: Array<() => void> = [];
  readonly #live: boolean;
  #closed = false;

  constructor(snapshot: RuntimeTranscriptSnapshot, live = false) {
    this.#snapshot = clone(snapshot);
    this.#live = live;
  }

  getRuntimeSnapshot(_session: EngineSessionRef): Promise<RuntimeTranscriptSnapshot> {
    return Promise.resolve(this.getCurrentSnapshot());
  }

  subscribeRuntime(
    _session: EngineSessionRef,
    afterRuntimeSequence: number,
  ): AsyncIterable<RuntimeTranscriptEvent> {
    return this.#subscribe(afterRuntimeSequence);
  }

  append(
    mutation: RuntimeTranscriptMutation,
    sequence = this.#snapshot.sequence + 1,
    occurredAt = FIXTURE_TIME,
  ): RuntimeTranscriptEvent {
    const event: RuntimeTranscriptEvent = {
      schemaVersion: 1,
      engineSession: clone(this.#snapshot.engineSession),
      sequence,
      occurredAt,
      mutation: clone(mutation),
    };
    this.#events.push(event);
    this.#snapshot = applyRuntimeMutation(this.#snapshot, event);
    this.#wake();
    return clone(event);
  }

  close(): void {
    this.#closed = true;
    this.#wake();
  }

  getCurrentSnapshot(): RuntimeTranscriptSnapshot {
    return clone(this.#snapshot);
  }

  async *#subscribe(afterRuntimeSequence: number): AsyncIterable<RuntimeTranscriptEvent> {
    let cursor = afterRuntimeSequence;
    while (!this.#closed) {
      const pending = this.#events.filter((event) => event.sequence > cursor);
      if (pending.length > 0) {
        for (const event of pending) {
          cursor = event.sequence;
          yield clone(event);
        }
        if (!this.#live) return;
        continue;
      }
      if (!this.#live) return;
      await this.#waitForChange();
    }
  }

  #waitForChange(): Promise<void> {
    return new Promise((resolve) => this.#waiters.push(resolve));
  }

  #wake(): void {
    const waiters = this.#waiters.splice(0);
    for (const resolve of waiters) resolve();
  }
}

export class SyntheticHostJournalSource implements ConversationHostJournalSource {
  readonly #session: ConversationHostSession;
  readonly #sessionId: DefSessionId;
  readonly #events: DefEvent[] = [];
  readonly #waiters: Array<() => void> = [];
  readonly #live: boolean;
  #closed = false;

  constructor(sessionId: DefSessionId, engineSession: EngineSessionRef, live = false) {
    this.#sessionId = sessionId;
    this.#session = { engine: clone(engineSession) };
    this.#live = live;
  }

  getSession(defSessionId: DefSessionId): ConversationHostSession | null {
    return defSessionId === this.#sessionId ? { engine: clone(this.#session.engine) } : null;
  }

  getSnapshot(defSessionId: DefSessionId): ConversationHostJournalSnapshot {
    if (defSessionId !== this.#sessionId) return { sequence: 0, events: [] };
    return this.getCurrentSnapshot();
  }

  subscribe(defSessionId: DefSessionId, afterHostSequence: number): AsyncIterable<DefEvent> {
    return defSessionId === this.#sessionId ? this.#subscribe(afterHostSequence) : emptyAsyncIterable();
  }

  append(event: DefEvent): DefEvent {
    if (event.defSessionId !== this.#sessionId) throw new Error('fixture Host event Session mismatch');
    this.#events.push(clone(event));
    this.#wake();
    return clone(event);
  }

  close(): void {
    this.#closed = true;
    this.#wake();
  }

  getCurrentSnapshot(): ConversationHostJournalSnapshot {
    return {
      sequence: this.#events.at(-1)?.sequence ?? 0,
      events: clone(this.#events),
    };
  }

  async *#subscribe(afterHostSequence: number): AsyncIterable<DefEvent> {
    let cursor = afterHostSequence;
    while (!this.#closed) {
      const pending = this.#events.filter((event) => event.sequence > cursor);
      if (pending.length > 0) {
        for (const event of pending) {
          cursor = event.sequence;
          yield clone(event);
        }
        if (!this.#live) return;
        continue;
      }
      if (!this.#live) return;
      await this.#waitForChange();
    }
  }

  #waitForChange(): Promise<void> {
    return new Promise((resolve) => this.#waiters.push(resolve));
  }

  #wake(): void {
    const waiters = this.#waiters.splice(0);
    for (const resolve of waiters) resolve();
  }
}

export function hostToolRequested(
  sessionId: DefSessionId,
  sequence: number,
  turnId: string = FIXTURE_TURN_ID,
  toolCallId: string = FIXTURE_TOOL_CALL_ID,
): Extract<DefEvent, { type: 'tool.requested' }> {
  return {
    schemaVersion: 1,
    sequence,
    occurredAt: FIXTURE_TIME,
    defSessionId: sessionId,
    defTurnId: asDefTurnId(turnId),
    toolCallId: asToolCallId(toolCallId),
    type: 'tool.requested',
    payload: {
      name: 'fixture.tool',
      risk: 'read',
      input: { value: 'fixture' },
    },
  };
}

export function hostToolStarted(
  sessionId: DefSessionId,
  sequence: number,
  turnId: string = FIXTURE_TURN_ID,
  toolCallId: string = FIXTURE_TOOL_CALL_ID,
): Extract<DefEvent, { type: 'tool.started' }> {
  return {
    ...hostToolRequested(sessionId, sequence, turnId, toolCallId),
    type: 'tool.started',
    payload: { name: 'fixture.tool' },
  };
}

export function hostToolResult(
  sessionId: DefSessionId,
  sequence: number,
  result: JsonObject = { ok: true },
  turnId: string = FIXTURE_TURN_ID,
  toolCallId: string = FIXTURE_TOOL_CALL_ID,
): Extract<DefEvent, { type: 'tool.result' }> {
  return {
    ...hostToolRequested(sessionId, sequence, turnId, toolCallId),
    type: 'tool.result',
    payload: { result },
  };
}

export function hostToolError(
  sessionId: DefSessionId,
  sequence: number,
  turnId: string = FIXTURE_TURN_ID,
  toolCallId: string = FIXTURE_TOOL_CALL_ID,
): Extract<DefEvent, { type: 'tool.error' }> {
  return {
    ...hostToolRequested(sessionId, sequence, turnId, toolCallId),
    type: 'tool.error',
    payload: { code: 'FIXTURE_TOOL_ERROR', message: 'fixture tool failed' },
  };
}

export function hostInteractionRequested(
  sessionId: DefSessionId,
  sequence: number,
  interactionId: string = FIXTURE_INTERACTION_ID,
  turnId: string = FIXTURE_TURN_ID,
): Extract<DefEvent, { type: 'interaction.requested' }> {
  return {
    schemaVersion: 1,
    sequence,
    occurredAt: FIXTURE_TIME,
    defSessionId: sessionId,
    defTurnId: asDefTurnId(turnId),
    interactionId: asInteractionId(interactionId),
    type: 'interaction.requested',
    payload: {
      kind: 'question',
      prompt: 'fixture question?',
      expiresAt: '2026-08-08T00:15:00.000Z',
    },
  };
}

export function hostInteractionResolved(
  sessionId: DefSessionId,
  sequence: number,
  interactionId: string = FIXTURE_INTERACTION_ID,
  turnId: string = FIXTURE_TURN_ID,
): Extract<DefEvent, { type: 'interaction.resolved' }> {
  return {
    ...hostInteractionRequested(sessionId, sequence, interactionId, turnId),
    type: 'interaction.resolved',
    payload: { status: 'answered', value: 'fixture-answer' },
  };
}

function applyRuntimeMutation(
  snapshot: RuntimeTranscriptSnapshot,
  event: RuntimeTranscriptEvent,
): RuntimeTranscriptSnapshot {
  const messages = snapshot.messages.map((message) => clone(message));
  const parts = snapshot.parts.map((part) => clone(part));
  const mutation = event.mutation;
  if (mutation.type === 'message.upsert') {
    const existing = messages.findIndex((message) => message.id === mutation.message.id);
    if (existing >= 0) messages.splice(existing, 1);
    messages.splice(Math.min(mutation.index, messages.length), 0, clone(mutation.message));
  } else if (mutation.type === 'message.remove') {
    const index = messages.findIndex((message) => message.id === mutation.messageId);
    if (index >= 0) messages.splice(index, 1);
  } else if (mutation.type === 'part.upsert') {
    const existing = parts.findIndex((part) => part.id === mutation.part.id);
    if (existing >= 0) parts.splice(existing, 1);
    parts.splice(Math.min(mutation.index, parts.length), 0, clone(mutation.part));
  } else if (mutation.type === 'part.delta') {
    const index = parts.findIndex((part) => part.id === mutation.partId);
    const part = parts[index];
    if (index >= 0 && part && (part.type === 'text' || part.type === 'reasoning')) {
      parts[index] = { ...part, text: part.text + mutation.delta };
    }
  } else if (mutation.type === 'part.remove') {
    const index = parts.findIndex((part) => part.id === mutation.partId);
    if (index >= 0) parts.splice(index, 1);
  }
  return {
    ...clone(snapshot),
    sequence: event.sequence,
    status: mutation.type === 'session.status' ? clone(mutation.status) : snapshot.status,
    messages,
    parts,
  };
}

function emptyAsyncIterable<T>(): AsyncIterable<T> {
  return {
    async *[Symbol.asyncIterator](): AsyncIterator<T> {
      return;
    },
  };
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
