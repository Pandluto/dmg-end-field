import {
  DEF_CONVERSATION_SCHEMA_VERSION,
  asConversationMessageId,
  asConversationPartId,
  type ConversationMessage,
  type EngineSessionRef,
  type RuntimeTranscriptEvent,
  type RuntimeTranscriptMutation,
  type RuntimeTranscriptPart,
  type RuntimeTranscriptSnapshot,
  type RuntimeTranscriptSource,
  type RuntimeTranscriptStatus,
} from '../../core/contracts/index.ts';
import type {
  RuntimeAssistantMessage,
  RuntimeAssistantMessageDraft,
  RuntimeMessage,
  RuntimeUserMessage,
} from '../../runtime/kernel/messages.ts';
import type { RuntimeEvent } from '../../runtime/kernel/stream-events.ts';
import type { RuntimeSession } from '../../runtime/kernel/runtime-session.ts';

interface TranscriptRecord {
  readonly engineSession: EngineSessionRef;
  readonly runtime: RuntimeSession;
  readonly messages: ConversationMessage[];
  readonly parts: RuntimeTranscriptPart[];
  readonly history: RuntimeTranscriptEvent[];
  readonly wake: Set<() => void>;
  unsubscribe: () => void;
  sequence: number;
  status: RuntimeTranscriptStatus;
  closed: boolean;
}

/** Runtime transcript projection consumed by ConversationProjector/P9. */
export class DefRuntimeTranscriptSource implements RuntimeTranscriptSource {
  readonly #records = new Map<string, TranscriptRecord>();

  async registerSession(engineSession: EngineSessionRef, runtime: RuntimeSession): Promise<void> {
    const key = String(engineSession.sessionId);
    this.unregisterSession(engineSession);
    const transcript = await runtime.readTranscript();
    const projected = projectMessages(transcript.messages);
    const record: TranscriptRecord = {
      engineSession,
      runtime,
      messages: [...projected.messages],
      parts: [...projected.parts],
      history: [],
      wake: new Set(),
      unsubscribe: () => undefined,
      sequence: 0,
      status: { status: 'idle' },
      closed: false,
    };
    record.unsubscribe = runtime.subscribe((event) => this.#accept(record, event));
    this.#records.set(key, record);
  }

  unregisterSession(engineSession: EngineSessionRef): void {
    const record = this.#records.get(String(engineSession.sessionId));
    if (!record) return;
    record.closed = true;
    record.unsubscribe();
    this.#records.delete(String(engineSession.sessionId));
    for (const wake of record.wake) wake();
    record.wake.clear();
  }

  close(): void {
    for (const record of [...this.#records.values()]) this.unregisterSession(record.engineSession);
  }

  async getRuntimeSnapshot(engineSession: EngineSessionRef): Promise<RuntimeTranscriptSnapshot> {
    const record = this.#require(engineSession);
    return structuredClone({
      schemaVersion: DEF_CONVERSATION_SCHEMA_VERSION,
      engineSession: record.engineSession,
      sequence: record.sequence,
      status: record.status,
      messages: record.messages,
      parts: record.parts,
    });
  }

  async *subscribeRuntime(
    engineSession: EngineSessionRef,
    afterRuntimeSequence: number,
    signal?: AbortSignal,
  ): AsyncIterable<RuntimeTranscriptEvent> {
    const record = this.#require(engineSession);
    let cursor = afterRuntimeSequence;
    while (!record.closed && !signal?.aborted) {
      const available = record.history.filter((event) => event.sequence > cursor);
      if (available.length > 0) {
        for (const event of available) {
          if (signal?.aborted) return;
          cursor = event.sequence;
          yield structuredClone(event);
        }
        continue;
      }
      await new Promise<void>((resolve) => {
        const wake = () => {
          signal?.removeEventListener('abort', wake);
          record.wake.delete(wake);
          resolve();
        };
        record.wake.add(wake);
        signal?.addEventListener('abort', wake, { once: true });
        if (record.closed || signal?.aborted || record.sequence > cursor) wake();
      });
    }
  }

  #require(engineSession: EngineSessionRef): TranscriptRecord {
    const record = this.#records.get(String(engineSession.sessionId));
    if (!record || !sameEngineSession(record.engineSession, engineSession)) {
      throw new Error(`DEF Runtime transcript ${engineSession.sessionId} is unavailable`);
    }
    return record;
  }

  #accept(record: TranscriptRecord, event: RuntimeEvent): void {
    if (record.closed) return;
    if (event.type === 'run.start') {
      this.#emit(record, event.occurredAt, {
        type: 'session.status',
        status: { status: 'running' },
      });
      return;
    }
    if (event.type === 'run.end') {
      const status: RuntimeTranscriptStatus = event.terminal.status === 'failed'
        ? { status: 'error', code: event.terminal.code, message: event.terminal.message }
        : { status: 'idle' };
      this.#emit(record, event.occurredAt, { type: 'session.status', status });
      return;
    }
    if (event.type === 'compaction.start') {
      this.#emit(record, event.occurredAt, {
        type: 'session.status',
        status: { status: 'compacting' },
      });
      return;
    }
    if (event.type === 'compaction.end') {
      const status: RuntimeTranscriptStatus = event.outcome.status === 'failed'
        ? { status: 'error', code: event.outcome.code, message: event.outcome.message }
        : { status: 'idle' };
      this.#emit(record, event.occurredAt, { type: 'session.status', status });
      return;
    }
    if (event.type === 'message.start') {
      if (event.message.role === 'user' || event.message.role === 'assistant') {
        this.#upsertMessage(record, event.occurredAt, projectTurnMessage(event.message));
      }
      return;
    }
    if (event.type === 'message.update') {
      if (event.delta.type !== 'text' && event.delta.type !== 'thinking') return;
      const messageId = asConversationMessageId(String(event.messageId));
      const message = record.messages.find((candidate) => candidate.id === messageId);
      if (!message) return;
      const partId = asConversationPartId(String(event.delta.contentId));
      let part = record.parts.find((candidate) => candidate.id === partId);
      if (!part) {
        part = event.delta.type === 'text'
          ? { id: partId, messageId, createdAt: event.occurredAt, type: 'text', text: '' }
          : { id: partId, messageId, createdAt: event.occurredAt, type: 'reasoning', text: '' };
        this.#emit(record, event.occurredAt, {
          type: 'part.upsert',
          part,
          index: record.parts.length,
        });
      }
      this.#emit(record, event.occurredAt, {
        type: 'part.delta',
        messageId,
        partId,
        field: 'text',
        delta: event.delta.delta,
      });
      return;
    }
    if (event.type === 'message.end') {
      if (event.message.role === 'user' || event.message.role === 'assistant') {
        this.#upsertMessage(record, event.occurredAt, projectTurnMessage(event.message));
      }
    }
  }

  #upsertMessage(
    record: TranscriptRecord,
    occurredAt: string,
    projected: { readonly message: ConversationMessage; readonly parts: readonly RuntimeTranscriptPart[] },
  ): void {
    const existingIndex = record.messages.findIndex((message) => message.id === projected.message.id);
    if (existingIndex < 0) {
      this.#emit(record, occurredAt, {
        type: 'message.upsert',
        message: { ...projected.message, partIds: [] },
        index: record.messages.length,
      });
    }
    for (const part of projected.parts) {
      const partIndex = record.parts.findIndex((candidate) => candidate.id === part.id);
      this.#emit(record, occurredAt, {
        type: 'part.upsert',
        part,
        index: partIndex < 0 ? record.parts.length : partIndex,
      });
    }
    this.#emit(record, occurredAt, {
      type: 'message.upsert',
      message: projected.message,
      index: existingIndex < 0 ? record.messages.length - 1 : existingIndex,
    });
  }

  #emit(record: TranscriptRecord, occurredAt: string, mutation: RuntimeTranscriptMutation): void {
    applyMutation(record, mutation);
    const event: RuntimeTranscriptEvent = {
      schemaVersion: DEF_CONVERSATION_SCHEMA_VERSION,
      engineSession: record.engineSession,
      sequence: ++record.sequence,
      occurredAt,
      mutation,
    };
    record.history.push(event);
    for (const wake of [...record.wake]) wake();
  }
}

function projectMessages(messages: readonly RuntimeMessage[]): {
  readonly messages: readonly ConversationMessage[];
  readonly parts: readonly RuntimeTranscriptPart[];
} {
  const projectedMessages: ConversationMessage[] = [];
  const parts: RuntimeTranscriptPart[] = [];
  for (const message of messages) {
    if (message.role !== 'user' && message.role !== 'assistant') continue;
    const projected = projectTurnMessage(message);
    projectedMessages.push(projected.message);
    parts.push(...projected.parts);
  }
  return { messages: projectedMessages, parts };
}

function projectTurnMessage(
  message: RuntimeUserMessage | RuntimeAssistantMessage | RuntimeAssistantMessageDraft,
): { readonly message: ConversationMessage; readonly parts: readonly RuntimeTranscriptPart[] } {
  const messageId = asConversationMessageId(String(message.id));
  const parts: RuntimeTranscriptPart[] = [];
  for (const block of message.content) {
    const id = asConversationPartId(String(block.id));
    if (block.type === 'text') {
      parts.push({ id, messageId, createdAt: message.createdAt, type: 'text', text: block.text });
    } else if (block.type === 'thinking') {
      parts.push({
        id,
        messageId,
        createdAt: message.createdAt,
        type: 'reasoning',
        text: block.text,
        ...(block.redacted === undefined ? {} : { redacted: block.redacted }),
      });
    } else if (block.type === 'file') {
      parts.push({
        id,
        messageId,
        createdAt: message.createdAt,
        type: 'file',
        mime: block.mime,
        filename: block.filename,
        url: block.url,
      });
    } else if (block.type === 'tool-call') {
      parts.push({
        id,
        messageId,
        createdAt: message.createdAt,
        type: 'tool',
        toolCallId: block.toolCallId,
        name: block.name,
        state: { status: 'pending', input: block.arguments },
      });
    }
  }
  if ('diagnostic' in message && message.diagnostic) {
    const id = asConversationPartId(`${message.id}:error`);
    parts.push({
      id,
      messageId,
      createdAt: message.completedAt,
      completedAt: message.completedAt,
      type: 'error',
      code: message.diagnostic.code,
      message: message.diagnostic.message,
      retryable: message.diagnostic.retryable,
    });
  }
  const completedAt = 'completedAt' in message ? message.completedAt : undefined;
  return {
    message: {
      id: messageId,
      role: message.role,
      defTurnId: message.defTurnId,
      createdAt: message.createdAt,
      ...(completedAt === undefined ? {} : { completedAt }),
      partIds: parts.map((part) => part.id),
    },
    parts,
  };
}

function applyMutation(record: TranscriptRecord, mutation: RuntimeTranscriptMutation): void {
  if (mutation.type === 'session.status') {
    record.status = mutation.status;
    return;
  }
  if (mutation.type === 'message.upsert') {
    const existing = record.messages.findIndex((message) => message.id === mutation.message.id);
    if (existing >= 0) record.messages.splice(existing, 1);
    record.messages.splice(Math.min(mutation.index, record.messages.length), 0, structuredClone(mutation.message));
    return;
  }
  if (mutation.type === 'part.upsert') {
    const existing = record.parts.findIndex((part) => part.id === mutation.part.id);
    if (existing >= 0) record.parts.splice(existing, 1);
    record.parts.splice(Math.min(mutation.index, record.parts.length), 0, structuredClone(mutation.part));
    const messageIndex = record.messages.findIndex((message) => message.id === mutation.part.messageId);
    if (messageIndex >= 0) {
      const message = record.messages[messageIndex]!;
      if (!message.partIds.includes(mutation.part.id)) {
        record.messages[messageIndex] = { ...message, partIds: [...message.partIds, mutation.part.id] };
      }
    }
    return;
  }
  if (mutation.type === 'part.delta') {
    const index = record.parts.findIndex((part) => part.id === mutation.partId);
    const part = record.parts[index];
    if (part && (part.type === 'text' || part.type === 'reasoning')) {
      record.parts[index] = { ...part, text: `${part.text}${mutation.delta}` };
    }
    return;
  }
  if (mutation.type === 'message.remove') {
    const index = record.messages.findIndex((message) => message.id === mutation.messageId);
    if (index >= 0) record.messages.splice(index, 1);
    return;
  }
  if (mutation.type === 'part.remove') {
    const index = record.parts.findIndex((part) => part.id === mutation.partId);
    if (index >= 0) record.parts.splice(index, 1);
  }
}

function sameEngineSession(left: EngineSessionRef, right: EngineSessionRef): boolean {
  return left.kind === right.kind
    && left.sessionId === right.sessionId
    && left.runtimeVersion === right.runtimeVersion
    && left.storeSchemaVersion === right.storeSchemaVersion;
}
