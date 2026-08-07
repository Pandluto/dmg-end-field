import {
  DEF_AGENT_IN_MEMORY_LIMITS,
  type AgentEventPage,
} from '../../../agent/core/contracts/browser-protocol';
import type { DefEvent } from '../../../agent/core/contracts/events';
import type { DefSessionId } from '../../../agent/core/contracts/ids';

export interface AgentEventReader {
  readSessionEvents(
    defSessionId: DefSessionId,
    afterSequence?: number,
    limit?: number,
  ): Promise<AgentEventPage>;
}

export type AgentEventPollerStatus = 'idle' | 'polling' | 'ready' | 'error';

export interface AgentEventPollerSnapshot {
  readonly defSessionId: DefSessionId | null;
  readonly cursor: number;
  readonly events: readonly DefEvent[];
  readonly status: AgentEventPollerStatus;
  readonly error: string | null;
}

export interface AgentEventPollerOptions {
  readonly reader: AgentEventReader;
  readonly intervalMs?: number;
  readonly errorIntervalMs?: number;
  readonly maxEvents?: number;
  readonly maxEventCodeUnits?: number;
  readonly setTimeout?: (handler: () => void, timeout: number) => unknown;
  readonly clearTimeout?: (handle: unknown) => void;
}

export class AgentEventPoller {
  readonly #reader: AgentEventReader;
  readonly #intervalMs: number;
  readonly #errorIntervalMs: number;
  readonly #maxEvents: number;
  readonly #maxEventCodeUnits: number;
  readonly #setTimeout: (handler: () => void, timeout: number) => unknown;
  readonly #clearTimeout: (handle: unknown) => void;
  readonly #listeners = new Set<(snapshot: AgentEventPollerSnapshot) => void>();
  #snapshot: AgentEventPollerSnapshot = {
    defSessionId: null,
    cursor: 0,
    events: [],
    status: 'idle',
    error: null,
  };
  #running = false;
  #timer: unknown = null;
  #pollPromise: Promise<void> | null = null;
  #pollGeneration = -1;
  #generation = 0;
  #eventCodeUnits = 0;

  constructor(options: AgentEventPollerOptions) {
    this.#reader = options.reader;
    this.#intervalMs = options.intervalMs ?? 300;
    this.#errorIntervalMs = options.errorIntervalMs ?? 1_000;
    this.#maxEvents = options.maxEvents ?? DEF_AGENT_IN_MEMORY_LIMITS.maxEventsPerSession;
    this.#maxEventCodeUnits = options.maxEventCodeUnits
      ?? DEF_AGENT_IN_MEMORY_LIMITS.maxEventCodeUnitsPerSession;
    this.#setTimeout = options.setTimeout ?? ((handler, timeout) => window.setTimeout(handler, timeout));
    this.#clearTimeout = options.clearTimeout ?? ((handle) => window.clearTimeout(handle as number));
  }

  getState(): AgentEventPollerSnapshot {
    return this.#snapshot;
  }

  subscribe(listener: (snapshot: AgentEventPollerSnapshot) => void): () => void {
    this.#listeners.add(listener);
    listener(this.#snapshot);
    return () => this.#listeners.delete(listener);
  }

  setSession(defSessionId: DefSessionId | null): void {
    if (this.#snapshot.defSessionId === defSessionId) return;
    this.#generation += 1;
    this.#cancelTimer();
    this.#eventCodeUnits = 0;
    this.#snapshot = {
      defSessionId,
      cursor: 0,
      events: [],
      status: defSessionId && this.#running ? 'polling' : 'idle',
      error: null,
    };
    this.#emit();
    if (defSessionId && this.#running) void this.#poll();
  }

  start(): void {
    if (this.#running) return;
    this.#running = true;
    if (!this.#snapshot.defSessionId) return;
    this.#snapshot = { ...this.#snapshot, status: 'polling', error: null };
    this.#emit();
    void this.#poll();
  }

  stop(): void {
    if (!this.#running && this.#snapshot.status === 'idle') return;
    this.#running = false;
    this.#generation += 1;
    this.#cancelTimer();
    this.#snapshot = { ...this.#snapshot, status: 'idle' };
    this.#emit();
  }

  refresh(): Promise<void> {
    if (!this.#snapshot.defSessionId) return Promise.resolve();
    return this.#poll();
  }

  async #poll(): Promise<void> {
    if (this.#pollPromise) {
      if (this.#pollGeneration === this.#generation) return this.#pollPromise;
      const stalePoll = this.#pollPromise;
      return stalePoll.then(() => this.#poll());
    }
    const generation = this.#generation;
    this.#pollGeneration = generation;
    const poll = this.#performPoll(generation).finally(() => {
      if (this.#pollPromise === poll) {
        this.#pollPromise = null;
        this.#pollGeneration = -1;
      }
    });
    this.#pollPromise = poll;
    return poll;
  }

  async #performPoll(generation: number): Promise<void> {
    const defSessionId = this.#snapshot.defSessionId;
    if (!defSessionId) return;
    try {
      let hasMore = true;
      let pages = 0;
      while (hasMore && pages < 16) {
        const page = await this.#reader.readSessionEvents(
          defSessionId,
          this.#snapshot.cursor,
          256,
        );
        if (generation !== this.#generation || this.#snapshot.defSessionId !== defSessionId) return;
        if (page.events.length) {
          const pageCodeUnits = page.events.reduce(
            (total, event) => total + JSON.stringify(event).length,
            0,
          );
          if (this.#snapshot.events.length + page.events.length > this.#maxEvents) {
            throw new AgentEventPollerCapacityError(
              `当前会话事件超过 ${this.#maxEvents} 条内存上限，已停止继续加载。`,
            );
          }
          if (this.#eventCodeUnits + pageCodeUnits > this.#maxEventCodeUnits) {
            throw new AgentEventPollerCapacityError(
              `当前会话事件超过 ${this.#maxEventCodeUnits} 字符内存上限，已停止继续加载。`,
            );
          }
          this.#eventCodeUnits += pageCodeUnits;
          this.#snapshot = {
            ...this.#snapshot,
            cursor: page.nextSequence,
            events: [...this.#snapshot.events, ...page.events],
            status: 'ready',
            error: null,
          };
          this.#emit();
        } else if (this.#snapshot.status !== 'ready' || this.#snapshot.error) {
          this.#snapshot = { ...this.#snapshot, status: 'ready', error: null };
          this.#emit();
        }
        hasMore = page.hasMore;
        pages += 1;
      }
      if (this.#running && generation === this.#generation) this.#schedule(this.#intervalMs);
    } catch (error) {
      if (generation !== this.#generation) return;
      this.#snapshot = {
        ...this.#snapshot,
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
      };
      this.#emit();
      if (error instanceof AgentEventPollerCapacityError) {
        this.#running = false;
      } else if (this.#running) {
        this.#schedule(this.#errorIntervalMs);
      }
    }
  }

  #schedule(timeout: number): void {
    this.#cancelTimer();
    this.#timer = this.#setTimeout(() => {
      this.#timer = null;
      void this.#poll();
    }, timeout);
  }

  #cancelTimer(): void {
    if (this.#timer === null) return;
    this.#clearTimeout(this.#timer);
    this.#timer = null;
  }

  #emit(): void {
    for (const listener of this.#listeners) listener(this.#snapshot);
  }
}

class AgentEventPollerCapacityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AgentEventPollerCapacityError';
  }
}
