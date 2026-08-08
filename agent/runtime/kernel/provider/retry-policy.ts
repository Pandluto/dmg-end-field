/**
 * DEF-owned bounded provider retry policy.
 * Behaviorally derived from pi-mono packages/ai/src/utils/provider-retry.ts and
 * packages/ai/src/utils/retry.ts at
 * e47b8e37a6211ebd0b2942fa87059d64f81eec02.
 */
import type { ProviderFailure } from '../stream-events.ts';

const MAX_RETRIES = 8;
const MAX_DELAY_MS = 60_000;

export interface RetryPolicy {
  /** Number of attempts after the initial request. */
  readonly maxRetries: number;
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
  /** Randomized proportion around the exponential delay, in the [0, 1] range. */
  readonly jitterRatio: number;
}

export type RetryPolicyInput = Partial<RetryPolicy>;

export const DEFAULT_RETRY_POLICY: RetryPolicy = Object.freeze({
  maxRetries: 2,
  baseDelayMs: 250,
  maxDelayMs: 8_000,
  jitterRatio: 0.2,
});

export interface RetryTimers {
  readonly setTimeout?: (
    callback: () => void,
    delayMs: number,
  ) => ReturnType<typeof setTimeout>;
  readonly clearTimeout?: (handle: ReturnType<typeof setTimeout>) => void;
}

export class RetryAbortedError extends Error {
  constructor() {
    super('Retry wait aborted.');
    this.name = 'RetryAbortedError';
  }
}

export interface RetryCallbacks {
  readonly onRetryScheduled?: (
    attempt: number,
    delayMs: number,
    failure: ProviderFailure,
  ) => void | Promise<void>;
  readonly onRetryStarted?: (attempt: number) => void | Promise<void>;
}

export function normalizeRetryPolicy(policy?: RetryPolicyInput): RetryPolicy {
  const maxRetries = boundedInteger(policy?.maxRetries, DEFAULT_RETRY_POLICY.maxRetries, 0, MAX_RETRIES);
  const baseDelayMs = boundedNumber(policy?.baseDelayMs, DEFAULT_RETRY_POLICY.baseDelayMs, 0, MAX_DELAY_MS);
  const maxDelayMs = boundedNumber(
    policy?.maxDelayMs,
    DEFAULT_RETRY_POLICY.maxDelayMs,
    0,
    MAX_DELAY_MS,
  );
  const jitterRatio = boundedNumber(policy?.jitterRatio, DEFAULT_RETRY_POLICY.jitterRatio, 0, 1);

  return { maxRetries, baseDelayMs, maxDelayMs, jitterRatio };
}

export function isRetryableProviderFailure(failure: ProviderFailure): boolean {
  return failure.retryable && (
    failure.kind === 'rate-limit' ||
    failure.kind === 'server' ||
    failure.kind === 'network'
  );
}

export function calculateRetryDelayMs(
  policy: RetryPolicyInput,
  attempt: number,
  retryAfterMs?: number,
  random: () => number = Math.random,
): number {
  const normalized = normalizeRetryPolicy(policy);
  const safeAttempt = Math.max(1, Math.floor(attempt));
  const exponential = normalized.baseDelayMs * 2 ** Math.min(safeAttempt - 1, 30);
  const requested = retryAfterMs !== undefined && Number.isFinite(retryAfterMs)
    ? Math.max(0, retryAfterMs)
    : exponential;
  const bounded = Math.min(normalized.maxDelayMs, requested);
  if (bounded === 0 || normalized.jitterRatio === 0) return Math.round(bounded);

  const sampledRandom = random();
  const randomValue = Number.isFinite(sampledRandom) ? Math.min(1, Math.max(0, sampledRandom)) : 0.5;
  const jitter = (randomValue * 2 - 1) * normalized.jitterRatio * bounded;
  return Math.round(Math.min(normalized.maxDelayMs, Math.max(0, bounded + jitter)));
}

export function waitForRetry(
  delayMs: number,
  signal?: AbortSignal,
  timers: RetryTimers = {},
): Promise<void> {
  const timeout = timers.setTimeout ?? setTimeout;
  const clear = timers.clearTimeout ?? clearTimeout;
  const boundedDelay = Math.max(0, Math.min(MAX_DELAY_MS, Number.isFinite(delayMs) ? delayMs : 0));

  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new RetryAbortedError());
      return;
    }

    let handle: ReturnType<typeof setTimeout> | undefined;
    const onAbort = () => {
      if (handle !== undefined) clear(handle);
      signal?.removeEventListener('abort', onAbort);
      reject(new RetryAbortedError());
    };
    const onTimeout = () => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    };

    handle = timeout(onTimeout, boundedDelay);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export interface RetryOperationOptions {
  readonly policy?: RetryPolicyInput;
  readonly signal?: AbortSignal;
  readonly timers?: RetryTimers;
  readonly random?: () => number;
  readonly classifyFailure: (error: unknown) => ProviderFailure;
  readonly retryAfterMs?: (error: unknown) => number | undefined;
  readonly callbacks?: RetryCallbacks;
}

/**
 * Run an operation with bounded, abortable retries. The operation receives a
 * zero-based attempt number; it must not expose secrets through thrown errors.
 */
export async function retryWithPolicy<T>(
  operation: (attempt: number) => Promise<T>,
  options: RetryOperationOptions,
): Promise<T> {
  const policy = normalizeRetryPolicy(options.policy);
  let retryCount = 0;

  for (;;) {
    if (options.signal?.aborted) throw new RetryAbortedError();

    try {
      return await operation(retryCount);
    } catch (error) {
      if (options.signal?.aborted) throw new RetryAbortedError();

      const failure = options.classifyFailure(error);
      if (retryCount >= policy.maxRetries || !isRetryableProviderFailure(failure)) throw error;

      retryCount += 1;
      const delayMs = calculateRetryDelayMs(
        policy,
        retryCount,
        options.retryAfterMs?.(error),
        options.random,
      );
      await options.callbacks?.onRetryScheduled?.(retryCount, delayMs, failure);
      await waitForRetry(delayMs, options.signal, options.timers);
      await options.callbacks?.onRetryStarted?.(retryCount);
    }
  }
}

function boundedInteger(value: number | undefined, fallback: number, minimum: number, maximum: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.floor(value)));
}

function boundedNumber(value: number | undefined, fallback: number, minimum: number, maximum: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(maximum, Math.max(minimum, value));
}
