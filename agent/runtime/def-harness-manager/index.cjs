const fs = require('fs');
const path = require('path');
const { bindTransactionContext } = require('./context.cjs');
const {
  MINIMAL_WORKBENCH_AGENT_PROMPT,
  buildHostKernelContext,
  renderHostKernelSystem,
} = require('./host-kernel.cjs');
const { BUSINESS_IDS } = require('./router.cjs');
const { BusinessHarnessRegistry } = require('./registry.cjs');
const { HarnessTransactionRuntime } = require('./runtime.cjs');

let revisionRegistry = null;
let revisionWatcherStops = [];

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

function managedRevisionRegistry() {
  if (!revisionRegistry) revisionRegistry = new BusinessHarnessRegistry();
  revisionRegistry.controller.reload();
  return revisionRegistry;
}

async function reloadHarnessBusiness(businessId, version = undefined) {
  return managedRevisionRegistry().reloadBusiness(businessId, version);
}

async function startHarnessRevisionWatchers({ onReload } = {}) {
  if (revisionWatcherStops.length) return () => stopHarnessRevisionWatchers();
  const registry = managedRevisionRegistry();
  for (const businessId of BUSINESS_IDS) {
    await registry.resolveActive(businessId);
    revisionWatcherStops.push(registry.watchBusinessRevisions(businessId, { onReload }));
  }
  return () => stopHarnessRevisionWatchers();
}

function stopHarnessRevisionWatchers() {
  for (const stop of revisionWatcherStops.splice(0)) stop();
}

async function prepareWorkbenchTurn({
  binding,
  axisContext,
  checkoutState,
  workbenchContext,
  userText,
  parts,
  diagnostic,
  serviceEpoch,
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
    serviceEpoch,
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
    referenceAvailable: async (kind, reference) => {
      if (kind !== 'work-node') return true;
      const materializedBinding = (() => {
        try {
          return JSON.parse(fs.readFileSync(
            path.join(binding.directory, '.def-node.json'),
            'utf8',
          ));
        } catch {
          return null;
        }
      })();
      return Boolean(
        materializedBinding
        && materializedBinding.nodeId === reference.nodeId
        && (reference.revision === undefined || String(materializedBinding.revision) === String(reference.revision))
        && (!reference.workingHash || materializedBinding.workingHash === reference.workingHash),
      );
    },
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

module.exports = {
  prepareWorkbenchTurn,
  reloadHarnessBusiness,
  startHarnessRevisionWatchers,
  stopHarnessRevisionWatchers,
};
