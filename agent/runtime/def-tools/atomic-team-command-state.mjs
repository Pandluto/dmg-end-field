/**
 * Non-terminal renderer commands have no safe no-op interpretation. A late
 * command may still apply C, so callers must expose reconciliation rather
 * than report zero change until they see a terminal result.
 */
export function assessAtomicTeamApplyCommand({ status, candidateLive, parentCanonical }) {
  // Absence/unknown status is not evidence of a terminal rejection.  The
  // queue entry may have moved between stores while the renderer still owns
  // it, so only its explicit terminal error can establish the P no-op path.
  if (status !== 'done' && status !== 'error') {
    return { kind: 'unresolved', code: 'team-loadout-apply-unresolved' };
  }
  if (candidateLive) return { kind: 'rollback', code: 'team-loadout-apply-failed' };
  if (status === 'error' && parentCanonical) return { kind: 'zero-change', code: 'team-loadout-apply-rejected' };
  return { kind: 'reconciliation', code: 'team-loadout-apply-terminal-state-ambiguous' };
}

/**
 * Observe one exact renderer command again.  Keeping this separate from the
 * initial enqueue is deliberate: a timeout only means the queue has not
 * supplied a terminal answer yet, never that the command did not write C.
 */
export async function observeAtomicTeamApplyCommand({
  commandId,
  waitForCommand,
  candidateIsLive,
  parentIsCanonical,
  waitMs,
}) {
  if (!commandId || typeof waitForCommand !== 'function'
    || typeof candidateIsLive !== 'function' || typeof parentIsCanonical !== 'function') {
    throw new TypeError('An exact command and all reconciliation readers are required.');
  }
  const commandVerification = await waitForCommand(commandId, waitMs);
  const status = commandVerification?.result?.status;
  if (status !== 'done' && status !== 'error') {
    return {
      commandVerification,
      commandState: assessAtomicTeamApplyCommand({ status, candidateLive: false, parentCanonical: false }),
    };
  }
  const candidateLive = await candidateIsLive();
  const parentCanonical = candidateLive ? false : await parentIsCanonical();
  return {
    commandVerification,
    commandState: assessAtomicTeamApplyCommand({
      status,
      candidateLive,
      parentCanonical,
    }),
  };
}
