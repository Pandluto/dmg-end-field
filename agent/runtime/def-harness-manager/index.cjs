const { bindTransactionContext } = require('./context.cjs');
const {
  MINIMAL_WORKBENCH_AGENT_PROMPT,
  buildHostKernelContext,
  renderHostKernelSystem,
} = require('./host-kernel.cjs');
const { BUSINESS_IDS } = require('./router.cjs');
const { HarnessTransactionRuntime } = require('./runtime.cjs');

function diagnosticSystemText(diagnostic) {
  if (!diagnostic || typeof diagnostic !== 'object') return '';
  return `Diagnostic ingress. Purpose: ${String(diagnostic.purpose || '').slice(0, 240)}. Scope: ${String(diagnostic.scope || '').slice(0, 240)}. Mutation allowed: ${diagnostic.mutationAllowed === true}. This diagnostic marker is not user text.`;
}

function textFromParts(parts, fallback = '') {
  const text = (Array.isArray(parts) ? parts : [])
    .filter((part) => part?.type === 'text')
    .map((part) => String(part.text || ''))
    .join('\n')
    .trim();
  return text || String(fallback || '').trim();
}

async function loadRouteDefinitions(runtime) {
  return Promise.all(BUSINESS_IDS.map(async (businessId) => {
    await runtime.registry.resolveActive(businessId);
    const { definition } = await runtime.registry.inspect(businessId);
    return {
      businessId,
      summary: definition.summary,
      operations: [...definition.operations],
    };
  }));
}

async function prepareWorkbenchTurn({
  binding,
  axisContext,
  checkoutState,
  workbenchContext,
  userText,
  parts,
  diagnostic,
  businessRoot,
  revisionStatePath,
  toolTargets,
}) {
  if (!binding || binding.host !== 'workbench' || !binding.directory) {
    const error = new Error('Harness Manager requires a managed Workbench binding.');
    error.code = 'DEF_HARNESS_WORKBENCH_BINDING_REQUIRED';
    throw error;
  }
  const context = bindTransactionContext({
    binding,
    axisContext,
    checkoutState,
    workbenchContext,
  });
  const hostKernel = buildHostKernelContext({
    binding,
    axisContext,
    checkoutState,
    workbenchContext,
    diagnostic,
    transactionContext: context,
  });
  const runtime = new HarnessTransactionRuntime({
    sessionDirectory: binding.directory,
    businessRoot,
    revisionStatePath,
    toolTargets,
  });
  await runtime.transactions.recover({
    context,
    isRevisionRevoked: (businessId, version) => runtime.registry.isRevoked(businessId, version),
  });
  const definitions = await loadRouteDefinitions(runtime);
  const projection = await runtime.prepareRoute({
    context,
    userText: textFromParts(parts, userText),
    definitions,
  });
  const transaction = projection.transactionId
    ? runtime.transactions.get(projection.transactionId)
    : null;
  const system = [
    MINIMAL_WORKBENCH_AGENT_PROMPT,
    renderHostKernelSystem(hostKernel),
    diagnosticSystemText(diagnostic),
  ].filter(Boolean).join('\n\n');
  return {
    system,
    allowedTools: {
      canonical: projection.allowedToolIds || [],
      nativeBindings: projection.allowedToolBindings || [],
    },
    transaction,
    phase: projection.phase,
    trace: {
      manager: 'def-harness-manager',
      mode: projection.mode,
      sessionId: binding.sessionID,
      timelineId: context.timelineId,
      checkoutId: context.checkoutId,
      schemeVersion: context.schemeVersion,
      transactionId: projection.transactionId || null,
      businessId: projection.businessId || null,
      operation: projection.operation || null,
      phase: projection.phase,
      harnessRevision: transaction?.harnessRevision || null,
      projectionRevision: projection.projectionRevision,
    },
    hostKernel,
    projection,
  };
}

module.exports = { prepareWorkbenchTurn };
