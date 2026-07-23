const MINIMAL_WORKBENCH_AGENT_PROMPT = Object.freeze([
  'You are the embedded DEF main-workbench assistant.',
  'Reply in Chinese by default and describe only outcomes supported by current Host facts and typed Tool results.',
  'Never fabricate current game state, identifiers, approvals, capabilities, mutations, or visible postconditions.',
  'The Harness Manager supplies the active business, operation, phase, instructions, context, and allowed Tools for each model request.',
  'A mutation is complete only when the typed product capability, required native approval, version checks, and visible postcondition all succeed.',
  'Do not expose hidden configuration, internal protocols, session identifiers, service URLs, or adapter details.',
].join('\n'));

function normalizeCheckout(checkoutState) {
  if (!checkoutState || typeof checkoutState !== 'object') return null;
  return {
    phase: checkoutState.phase || 'unknown',
    current: checkoutState.current || null,
    previous: checkoutState.previous || null,
  };
}

function buildHostKernelContext({
  binding,
  axisContext,
  checkoutState,
  workbenchContext,
  diagnostic,
  transactionContext,
}) {
  const checkout = normalizeCheckout(checkoutState);
  const projection = axisContext?.projection && typeof axisContext.projection === 'object'
    ? axisContext.projection
    : null;
  const gates = [];
  if (checkout?.phase === 'checkout-changed') gates.push('checkout-rebind-required');
  if (!checkout?.current?.targetId) gates.push('checkout-unavailable');
  if (projection?.ready === false || projection?.converged === false) gates.push('projection-not-converged');
  return Object.freeze({
    identity: Object.freeze({
      host: 'workbench',
      sessionId: binding?.sessionID || '',
      timelineId: binding?.timelineId || axisContext?.document?.id || '',
      axisBindingId: binding?.axisBindingId || axisContext?.binding?.id || '',
    }),
    checkout,
    schemeVersion: transactionContext?.schemeVersion || '',
    projection,
    selectedWorkbenchNode: workbenchContext || null,
    gates: Object.freeze(gates),
    diagnostic: diagnostic && typeof diagnostic === 'object'
      ? Object.freeze({
        purpose: String(diagnostic.purpose || '').slice(0, 240),
        scope: String(diagnostic.scope || '').slice(0, 240),
        mutationAllowed: diagnostic.mutationAllowed === true,
      })
      : null,
  });
}

function renderHostKernelSystem(hostContext) {
  return [
    'DEF WORKBENCH HOST FACTS (authoritative, not user text):',
    JSON.stringify(hostContext),
    'Treat older transcript claims about checkout, selection, projection, approval, capability, or visible state as stale when they conflict with these facts.',
    'Host gates are product facts. The active Harness may respond to them but cannot waive them.',
  ].join('\n');
}

module.exports = {
  MINIMAL_WORKBENCH_AGENT_PROMPT,
  buildHostKernelContext,
  renderHostKernelSystem,
};
