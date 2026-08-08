import assert from 'node:assert/strict';
import test from 'node:test';
import { asRuntimeEntryId } from '../ids.ts';
import type { CompactionOutcome } from './compaction.ts';
import type { RuntimeCompactionEntry } from './entries.ts';
import {
  compactAndRetryOnce,
  ContextRecoveryError,
  isContextOverflow,
  runWithContextRecovery,
} from './context-recovery.ts';

function compactedOutcome(): CompactionOutcome {
  const entry: RuntimeCompactionEntry = {
    schemaVersion: 1,
    id: asRuntimeEntryId('entry-compaction'),
    parentId: null,
    createdAt: '2026-08-08T00:00:00.000Z',
    type: 'compaction',
    summary: 'Compacted context.',
    firstKeptEntryId: asRuntimeEntryId('entry-kept'),
    tokensBefore: 100,
    reason: 'overflow',
  };
  return {
    status: 'compacted',
    reason: 'overflow',
    entry,
    firstKeptEntryId: asRuntimeEntryId('entry-kept'),
    summary: 'Compacted context.',
    tokensBefore: 100,
  };
}

test('context overflow compacts and retries exactly once', async () => {
  let attempts = 0;
  let compactions = 0;
  const result = await runWithContextRecovery({
    run: async () => {
      attempts += 1;
      if (attempts === 1) throw { kind: 'context-overflow', code: 'CONTEXT_OVERFLOW' };
      return 'resumed';
    },
    compact: async () => {
      compactions += 1;
      return compactedOutcome();
    },
  });

  assert.equal(result.value, 'resumed');
  assert.equal(result.compacted, true);
  assert.equal(result.retried, true);
  assert.equal(attempts, 2);
  assert.equal(compactions, 1);
});

test('a second overflow is terminal and cannot start another compaction', async () => {
  let attempts = 0;
  let compactions = 0;
  await assert.rejects(
    () => compactAndRetryOnce({
      run: async () => {
        attempts += 1;
        throw { kind: 'context-overflow', message: 'context window exceeded' };
      },
      compact: async () => {
        compactions += 1;
        return compactedOutcome();
      },
    }),
    (error: unknown) => error instanceof ContextRecoveryError
      && error.code === 'CONTEXT_OVERFLOW_AFTER_COMPACTION',
  );
  assert.equal(attempts, 2);
  assert.equal(compactions, 1);
});

test('non-overflow failures pass through without compaction', async () => {
  let compactions = 0;
  const failure = new Error('provider unavailable');
  await assert.rejects(
    () => compactAndRetryOnce({
      run: async () => { throw failure; },
      compact: async () => {
        compactions += 1;
        return compactedOutcome();
      },
    }),
    failure,
  );
  assert.equal(compactions, 0);
  assert.equal(isContextOverflow({ failure: { kind: 'context-overflow' } }), true);
  assert.equal(isContextOverflow({ code: 'PROVIDER_BAD_REQUEST', message: 'invalid schema' }), false);
});
