/** In-memory ModelDriver fixtures used by the pure Agent loop tests. */
import type {
  ModelDriver,
  ModelStream,
  RuntimeModelRequest,
} from '../provider/model-driver.ts';
import type { ProviderStreamEvent } from '../stream-events.ts';

export type FakeModelPlan = readonly ProviderStreamEvent[] | FakeModelStream;

export type ProviderEventWithoutOrdinal = ProviderStreamEvent extends infer Event
  ? Event extends ProviderStreamEvent
    ? Omit<Event, 'ordinal'>
    : never
  : never;

/** A manually controlled stream makes abort-during-stream tests deterministic. */
export class FakeModelStream implements ModelStream, AsyncIterator<ProviderStreamEvent> {
  private readonly queue: ProviderStreamEvent[] = [];
  private readonly waiters: Array<{
    readonly resolve: (result: IteratorResult<ProviderStreamEvent>) => void;
    readonly reject: (error: unknown) => void;
  }> = [];
  private closed = false;
  private failure: unknown;

  constructor(events: readonly ProviderStreamEvent[] = []) {
    this.queue.push(...events);
    // Array-backed plans are finite. An empty stream remains manually
    // controlled so abort tests can hold the first pull open.
    this.closed = events.length > 0;
  }

  push(event: ProviderStreamEvent): void {
    if (this.closed) throw new Error('FakeModelStream is already closed');
    const waiter = this.waiters.shift();
    if (waiter) waiter.resolve({ done: false, value: event });
    else this.queue.push(event);
  }

  end(): void {
    if (this.closed) return;
    this.closed = true;
    while (this.waiters.length > 0) this.waiters.shift()!.resolve({ done: true, value: undefined });
  }

  fail(error: unknown): void {
    if (this.closed) return;
    this.closed = true;
    this.failure = error;
    while (this.waiters.length > 0) this.waiters.shift()!.reject(error);
  }

  next(): Promise<IteratorResult<ProviderStreamEvent>> {
    if (this.queue.length > 0) return Promise.resolve({ done: false, value: this.queue.shift()! });
    if (this.failure !== undefined) return Promise.reject(this.failure);
    if (this.closed) return Promise.resolve({ done: true, value: undefined });
    return new Promise<IteratorResult<ProviderStreamEvent>>((resolve, reject) => {
      this.waiters.push({ resolve, reject });
    });
  }

  return(): Promise<IteratorResult<ProviderStreamEvent>> {
    this.end();
    return Promise.resolve({ done: true, value: undefined });
  }

  [Symbol.asyncIterator](): AsyncIterator<ProviderStreamEvent> {
    return this;
  }
}

export class FakeModelDriver implements ModelDriver {
  readonly kind = 'fake-model-driver';
  readonly requests: RuntimeModelRequest[] = [];
  private readonly plans: FakeModelPlan[];

  constructor(plans: readonly FakeModelPlan[] = []) {
    this.plans = [...plans];
  }

  enqueue(plan: FakeModelPlan): void {
    this.plans.push(plan);
  }

  stream(input: RuntimeModelRequest): ModelStream {
    this.requests.push(input);
    const plan = this.plans.shift();
    if (!plan) throw new Error('FakeModelDriver has no planned stream');
    return plan instanceof FakeModelStream ? plan : new FakeModelStream(plan);
  }
}

/** Add the F0 one-based provider ordinals to readable fixture event literals. */
export function numberProviderEvents(
  events: readonly ProviderEventWithoutOrdinal[],
): ProviderStreamEvent[] {
  return events.map((event, index) => ({ ...event, ordinal: index + 1 } as ProviderStreamEvent));
}
