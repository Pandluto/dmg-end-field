/**
 * Non-terminal renderer commands have no safe no-op interpretation. A late
 * command may still apply C, so callers must expose reconciliation rather
 * than report zero change until they see a terminal result.
 */
export function assessAtomicTeamApplyCommand({ status, candidateLive, parentCanonical }) {
  if (status === 'pending' || status === 'running') {
    return { kind: 'unresolved', code: 'team-loadout-apply-unresolved' };
  }
  if (candidateLive) return { kind: 'rollback', code: 'team-loadout-apply-failed' };
  if (parentCanonical) return { kind: 'zero-change', code: 'team-loadout-apply-rejected' };
  return { kind: 'reconciliation', code: 'team-loadout-apply-terminal-state-ambiguous' };
}
