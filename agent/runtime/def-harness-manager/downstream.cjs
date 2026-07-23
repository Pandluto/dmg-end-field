const UNFINISHED = ['active', 'awaiting-confirmation'];

function dispositionFor(sourceBusiness, transaction, effects) {
  if (transaction.businessId === 'calculation') return sourceBusiness === 'calculation' ? 'continue' : 'recompute';
  if (sourceBusiness === 'selection') {
    if (transaction.businessId === 'timeline' || transaction.businessId === 'buff') {
      return effects.removedCharacterIds?.length ? 'hard-invalid' : 'stale';
    }
    if (transaction.businessId === 'loadout') return 'stale';
  }
  if (sourceBusiness === 'timeline' && transaction.businessId === 'buff') {
    return effects.removedButtonIds?.length ? 'hard-invalid' : 'stale';
  }
  return 'continue';
}

function applyDownstreamEffects({
  transactionStore,
  sourceTransactionId,
  sourceBusiness,
  effects = {},
  newSchemeVersion,
}) {
  const outcomes = [];
  for (const transaction of transactionStore.list({ statuses: UNFINISHED })) {
    if (transaction.transactionId === sourceTransactionId) continue;
    const disposition = dispositionFor(sourceBusiness, transaction, effects);
    const updated = transactionStore.update(transaction.transactionId, (current) => {
      if (disposition === 'stale' || disposition === 'hard-invalid') {
        return {
          ...current,
          status: 'stale',
          phase: 'stale',
          terminalReason: disposition,
          downstreamDisposition: disposition,
          completedAt: Date.now(),
        };
      }
      if (disposition === 'recompute') {
        return {
          ...current,
          ...(newSchemeVersion ? { currentSchemeVersion: newSchemeVersion } : {}),
          recomputeRequired: true,
          requiresRevalidation: true,
          downstreamDisposition: disposition,
        };
      }
      return {
        ...current,
        ...(newSchemeVersion ? { currentSchemeVersion: newSchemeVersion } : {}),
        requiresRevalidation: true,
        downstreamDisposition: disposition,
      };
    }, 'downstream-impact', {
      sourceTransactionId,
      sourceBusiness,
      disposition,
      effects,
    });
    outcomes.push({
      transactionId: updated.transactionId,
      businessId: updated.businessId,
      disposition,
    });
  }
  return outcomes;
}

module.exports = { applyDownstreamEffects, dispositionFor };
