const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;
const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;

export function createDefCoreRuntimeState(options = {}) {
  const governanceToken = typeof options.governanceToken === 'string'
    ? options.governanceToken.trim()
    : '';

  return Object.freeze({
    preparedOperatorConfigCapabilities: new Map(),
    approvedApplyCapabilities: new Map(),
    guideLoadoutPlanSources: new Map(),
    operatorBuildGuideResolutions: new Map(),
    operatorBuildProfileCapabilities: new Map(),
    preparedTeamLoadoutPlans: new Map(),
    preparedOperatorConfigTtlMs: FIFTEEN_MINUTES_MS,
    operatorBuildGuideResolutionTtlMs: FIFTEEN_MINUTES_MS,
    operatorBuildProfileCapabilityTtlMs: FIFTEEN_MINUTES_MS,
    preparedTeamLoadoutTtlMs: FIFTEEN_MINUTES_MS,
    preparedTeamLoadoutApprovalGraceMs: FOUR_HOURS_MS,
    governanceToken,
    internalRawTransport: Object.freeze({ internalRawTransport: true }),
  });
}

export function createDefRawTransportPolicy({ governanceToken, fail }) {
  if (typeof fail !== 'function') throw new TypeError('DEF raw transport policy requires fail');

  function authorized(invocation = {}) {
    return invocation?.internalRawTransport === true
      || (Boolean(governanceToken) && invocation?.internalToken === governanceToken);
  }

  function deny(pathname) {
    return fail(403, 'denied-internal-transport', `Raw DEF transport is unavailable to this caller: ${pathname}`);
  }

  return Object.freeze({ authorized, deny });
}
