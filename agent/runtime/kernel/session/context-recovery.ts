/**
 * One-shot recovery for a context-window overflow.
 *
 * Provider retries and network retries belong to the Provider policy.  This
 * module handles only the distinct overflow path: compact once, retry once,
 * and never loop on a still-too-large context.
 */
import type { CompactionOutcome } from './compaction.ts';

export interface ContextRecoveryResult<T> {
  readonly value: T;
  readonly compacted: true;
  readonly retried: true;
}

export interface ContextRecoveryOptions<T> {
  readonly run: () => Promise<T>;
  readonly compact: () => Promise<CompactionOutcome>;
  readonly isOverflow?: (error: unknown) => boolean;
}

export class ContextRecoveryError extends Error {
  readonly code:
    | 'CONTEXT_COMPACTION_FAILED'
    | 'CONTEXT_COMPACTION_NOT_NEEDED'
    | 'CONTEXT_OVERFLOW_AFTER_COMPACTION';

  constructor(
    code: ContextRecoveryError['code'],
    message: string,
  ) {
    super(message);
    this.name = 'ContextRecoveryError';
    this.code = code;
  }
}

/** Run an operation with the exact overflow -> compact -> retry sequence. */
export async function runWithContextRecovery<T>(
  options: ContextRecoveryOptions<T>,
): Promise<ContextRecoveryResult<T> | { readonly value: T; readonly compacted: false; readonly retried: false }> {
  try {
    return { value: await options.run(), compacted: false, retried: false };
  } catch (error) {
    if (!(options.isOverflow ?? isContextOverflow)(error)) throw error;
  }

  let outcome: CompactionOutcome;
  try {
    outcome = await options.compact();
  } catch {
    throw new ContextRecoveryError(
      'CONTEXT_COMPACTION_FAILED',
      'Context overflow recovery could not create a compaction.',
    );
  }
  if (outcome.status === 'failed') {
    throw new ContextRecoveryError(
      'CONTEXT_COMPACTION_FAILED',
      'Context overflow recovery compaction failed; the original context was retained.',
    );
  }
  if (outcome.status === 'not-needed') {
    throw new ContextRecoveryError(
      'CONTEXT_COMPACTION_NOT_NEEDED',
      'Context overflow recovery had no durable history available to compact.',
    );
  }

  try {
    return { value: await options.run(), compacted: true, retried: true };
  } catch (error) {
    if ((options.isOverflow ?? isContextOverflow)(error)) {
      throw new ContextRecoveryError(
        'CONTEXT_OVERFLOW_AFTER_COMPACTION',
        'Context remained too large after the one permitted compaction retry.',
      );
    }
    throw error;
  }
}

/** Return only the operation value for a Runtime facade. */
export async function compactAndRetryOnce<T>(
  options: ContextRecoveryOptions<T>,
): Promise<T> {
  const result = await runWithContextRecovery(options);
  return result.value;
}

export const recoverContextOverflow = compactAndRetryOnce;

/** Recognize the sanitized F0 Provider failure shape and common error wrappers. */
export function isContextOverflow(error: unknown): boolean {
  const candidates: unknown[] = [error];
  if (isRecord(error)) {
    candidates.push(error.failure, error.error, error.response);
  }
  for (const candidate of candidates) {
    if (!isRecord(candidate)) continue;
    if (candidate.kind === 'context-overflow') return true;
    const code = typeof candidate.code === 'string' ? candidate.code : '';
    const message = typeof candidate.message === 'string' ? candidate.message : '';
    const normalized = `${code} ${message}`.toLowerCase().replace(/[_-]+/gu, ' ');
    if (
      normalized.includes('context overflow')
      || normalized.includes('context window')
      || normalized.includes('maximum context')
      || normalized.includes('too many tokens')
    ) return true;
  }
  return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
