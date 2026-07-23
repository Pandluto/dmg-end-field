const crypto = require('crypto');

function stableSchemeVersion({ timelineId, checkout, checkoutNode }) {
  const identity = [
    timelineId || '',
    checkout?.targetType || '',
    checkout?.targetId || '',
    Number(checkout?.updatedAt || 0),
    Number(checkoutNode?.updatedAt || 0),
  ].join(':');
  return crypto.createHash('sha256').update(identity).digest('hex');
}

function bindTransactionContext({
  binding,
  axisContext,
  checkoutState,
  workbenchContext,
  schemeVersion,
  formulaVersion,
}) {
  if (!binding?.sessionID || binding.host !== 'workbench') {
    const error = new Error('A business transaction requires a managed Workbench Session.');
    error.code = 'HARNESS_CONTEXT_SESSION_REQUIRED';
    throw error;
  }
  const timelineId = binding.timelineId || axisContext?.document?.id || '';
  const checkout = axisContext?.checkout || checkoutState?.current || null;
  if (!timelineId || !checkout?.targetId) {
    const error = new Error('A business transaction requires a current timeline checkout.');
    error.code = 'HARNESS_CONTEXT_CHECKOUT_REQUIRED';
    throw error;
  }
  const checkoutNode = Array.isArray(axisContext?.nodes)
    ? axisContext.nodes.find((node) => node?.id === checkout.targetId)
    : null;
  return Object.freeze({
    sessionId: binding.sessionID,
    sessionDirectory: binding.directory || '',
    timelineId,
    axisBindingId: binding.axisBindingId || axisContext?.binding?.id || '',
    checkoutId: checkout.targetId,
    checkoutType: checkout.targetType || '',
    checkoutUpdatedAt: Number(checkout.updatedAt || 0),
    selectedWorkbenchNodeId: workbenchContext?.id || '',
    schemeVersion: schemeVersion || stableSchemeVersion({ timelineId, checkout, checkoutNode }),
    formulaVersion: formulaVersion || '',
    observedAt: Date.now(),
  });
}

function normalizeEvidenceRef(evidence) {
  if (!evidence || typeof evidence !== 'object') {
    const error = new Error('Evidence reference must be an object.');
    error.code = 'HARNESS_EVIDENCE_INVALID';
    throw error;
  }
  const source = String(evidence.source || '').trim();
  const referenceId = String(evidence.referenceId || evidence.artifactId || '').trim();
  const contentHash = String(evidence.contentHash || evidence.hash || evidence.sourceRevision || '').trim();
  if (!source || !referenceId || !contentHash) {
    const error = new Error('Evidence requires source, referenceId and contentHash/sourceRevision.');
    error.code = 'HARNESS_EVIDENCE_INVALID';
    throw error;
  }
  return Object.freeze({
    source,
    referenceId,
    sectionId: String(evidence.sectionId || '').trim(),
    contentHash,
    applicability: String(evidence.applicability || '').trim(),
    conditions: Array.isArray(evidence.conditions)
      ? evidence.conditions.map((value) => String(value).trim()).filter(Boolean)
      : [],
    observedAt: Number(evidence.observedAt || Date.now()),
  });
}

module.exports = {
  bindTransactionContext,
  normalizeEvidenceRef,
  stableSchemeVersion,
};
