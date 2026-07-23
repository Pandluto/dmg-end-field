const { getNativeHarnessSystem } = require('../def-opencode-adapter/index.cjs');
const { composeLegacyWorkbenchSystem } = require('./compatibility.cjs');
const { buildHostKernelContext } = require('./host-kernel.cjs');

function diagnosticSystemText(diagnostic) {
  if (!diagnostic || typeof diagnostic !== 'object') return '';
  return `Diagnostic ingress. Purpose: ${String(diagnostic.purpose || '').slice(0, 240)}. Scope: ${String(diagnostic.scope || '').slice(0, 240)}. Mutation allowed: ${diagnostic.mutationAllowed === true}. This diagnostic marker is not user text.`;
}

async function prepareWorkbenchTurn({
  binding,
  axisContext,
  checkoutState,
  workbenchContext,
  userText,
  parts,
  incomingSystem,
  diagnostic,
}) {
  if (!binding || binding.host !== 'workbench') {
    const error = new Error('Harness Manager requires a managed Workbench binding.');
    error.code = 'DEF_HARNESS_WORKBENCH_BINDING_REQUIRED';
    throw error;
  }
  const normalizedParts = Array.isArray(parts)
    ? parts
    : [{ type: 'text', text: String(userText || '') }];
  const harness = getNativeHarnessSystem(binding, userText);
  const hostKernel = buildHostKernelContext({
    binding,
    axisContext,
    checkoutState,
    workbenchContext,
    diagnostic,
  });
  const system = composeLegacyWorkbenchSystem({
    harnessSystem: harness.system,
    workbenchContext,
    checkoutState,
    incomingSystem,
    diagnosticSystem: diagnosticSystemText(diagnostic),
    parts: normalizedParts,
  });
  return {
    system,
    allowedTools: null,
    transaction: null,
    phase: 'legacy-compatibility',
    trace: {
      manager: 'def-harness-manager',
      mode: 'legacy-compatibility',
      sessionId: binding.sessionID,
      timelineId: binding.timelineId || axisContext?.document?.id || '',
      checkoutId: checkoutState?.current?.targetId || '',
      harnessSelector: harness.selector || '',
    },
    hostKernel,
    compatibility: {
      binding: harness.binding,
      sessionBinding: harness.sessionBinding || harness.binding,
      turnRoute: harness.turnRoute || null,
      warning: harness.warning,
    },
  };
}

module.exports = { prepareWorkbenchTurn };
