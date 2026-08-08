import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ProviderFailureError,
  providerFailureForStatus,
  providerFailureFromUnknown,
} from './provider-errors.ts';
import {
  calculateRetryDelayMs,
  isRetryableProviderFailure,
  retryWithPolicy,
  waitForRetry,
  type RetryTimers,
} from './retry-policy.ts';

function immediateTimers(): RetryTimers {
  return {
    setTimeout: (callback) => {
      callback();
      return 0 as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimeout: () => undefined,
  };
}

test('retry classification keeps authentication failures terminal', () => {
  assert.equal(isRetryableProviderFailure(providerFailureForStatus(401)), false);
  assert.equal(isRetryableProviderFailure(providerFailureForStatus(403)), false);
  assert.equal(isRetryableProviderFailure(providerFailureForStatus(429)), true);
  assert.equal(isRetryableProviderFailure(providerFailureForStatus(503)), true);
  assert.equal(isRetryableProviderFailure(providerFailureFromUnknown(new Error('network drop'))), true);
});

test('retry delay is exponential, bounded, and deterministic with injected jitter', () => {
  const policy = { maxRetries: 5, baseDelayMs: 100, maxDelayMs: 250, jitterRatio: 0.2 };
  assert.equal(calculateRetryDelayMs(policy, 1, undefined, () => 0.5), 100);
  assert.equal(calculateRetryDelayMs(policy, 2, undefined, () => 0.5), 200);
  assert.equal(calculateRetryDelayMs(policy, 3, undefined, () => 0.5), 250);
  assert.equal(calculateRetryDelayMs(policy, 1, 10_000, () => 0.5), 250);
});

test('waitForRetry rejects and clears the timer when aborted', async () => {
  const controller = new AbortController();
  let clearCount = 0;
  const timers: RetryTimers = {
    setTimeout: () => 1 as unknown as ReturnType<typeof setTimeout>,
    clearTimeout: () => {
      clearCount += 1;
    },
  };
  const waiting = waitForRetry(10_000, controller.signal, timers);
  controller.abort();

  await assert.rejects(waiting, /Retry wait aborted/u);
  assert.equal(clearCount, 1);
});

test('retryWithPolicy retries a transient failure and reports only safe failure data', async () => {
  let calls = 0;
  const scheduled: Array<{ attempt: number; delayMs: number; code: string }> = [];
  const result = await retryWithPolicy(
    async () => {
      calls += 1;
      if (calls === 1) throw new ProviderFailureError(providerFailureForStatus(429));
      return 'ok';
    },
    {
      policy: { maxRetries: 1, baseDelayMs: 0, maxDelayMs: 0, jitterRatio: 0 },
      timers: immediateTimers(),
      classifyFailure: providerFailureFromUnknown,
      callbacks: {
        onRetryScheduled: (attempt, delayMs, failure) => {
          scheduled.push({ attempt, delayMs, code: failure.code });
        },
      },
    },
  );

  assert.equal(result, 'ok');
  assert.equal(calls, 2);
  assert.deepEqual(scheduled, [{ attempt: 1, delayMs: 0, code: 'PROVIDER_RATE_LIMIT' }]);
});

test('retryWithPolicy does not retry a 401 response', async () => {
  let calls = 0;
  await assert.rejects(
    retryWithPolicy(
      async () => {
        calls += 1;
        throw new ProviderFailureError(providerFailureForStatus(401));
      },
      {
        policy: { maxRetries: 3, baseDelayMs: 0, maxDelayMs: 0, jitterRatio: 0 },
        timers: immediateTimers(),
        classifyFailure: providerFailureFromUnknown,
      },
    ),
    (error: unknown) => error instanceof ProviderFailureError && error.failure.kind === 'authentication',
  );
  assert.equal(calls, 1);
});
