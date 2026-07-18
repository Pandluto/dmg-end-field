/**
 * Decide whether an atomic-team compensation still owns the live state.
 * This deliberately treats any uncertainty as no-touch: callers may report
 * reconciliation, but must not move a newer checkout back to P.
 */
export function assessAtomicRollbackPrecondition({ candidateLive, checkout, timelineId, parentNodeId, candidateNodeId }) {
  if (!candidateLive) return { attempt: false, reason: 'candidate-not-live' };
  if (!checkout || checkout.timelineId !== timelineId || checkout.targetType !== 'work-node') {
    return { attempt: false, reason: 'checkout-not-owned' };
  }
  if (![parentNodeId, candidateNodeId].includes(checkout.targetId)) {
    return { attempt: false, reason: 'checkout-not-owned' };
  }
  return { attempt: true, expectedCheckoutNodeId: checkout.targetId };
}

export function assessAtomicRollbackConvergence({ commandRestored, sessionPayloadMatches, projectionRestored, damageRestored, lifecycleRestored, checkout, parentNodeId }) {
  return Boolean(commandRestored
    && sessionPayloadMatches
    && projectionRestored
    && damageRestored
    && lifecycleRestored
    && checkout?.targetType === 'work-node'
    && checkout.targetId === parentNodeId);
}
