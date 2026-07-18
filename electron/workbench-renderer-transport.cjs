const crypto = require('crypto');

const WORKBENCH_RENDERER_CAPABILITY_HEADER = 'x-def-workbench-renderer-capability';
const WORKBENCH_RENDERER_CAPABILITY_QUERY = '__defWorkbenchRendererCapability';

function createWorkbenchRendererCapability() {
  return crypto.randomBytes(32).toString('base64url');
}

function isTrustedWorkbenchRendererOrigin(request, bridgeHost = '127.0.0.1', bridgePort = 31457) {
  const origin = String(request?.headers?.origin || '');
  const referer = String(request?.headers?.referer || '');
  const trustedOrigins = new Set([
    'http://127.0.0.1:3030',
    'http://localhost:3030',
    `http://${bridgeHost}:${bridgePort}`,
  ]);
  if (trustedOrigins.has(origin)) return true;
  return [...trustedOrigins].some((trusted) => referer === `${trusted}/` || referer.startsWith(`${trusted}/`));
}

function safeCapabilityEqual(actual, expected) {
  if (typeof actual !== 'string' || typeof expected !== 'string' || !actual || !expected) return false;
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length
    && crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

function readWorkbenchRendererCapability(request, requestUrl) {
  const header = request?.headers?.[WORKBENCH_RENDERER_CAPABILITY_HEADER];
  if (typeof header === 'string' && header) return header;
  return requestUrl?.searchParams?.get(WORKBENCH_RENDERER_CAPABILITY_QUERY) || '';
}

function isAuthorizedWorkbenchRendererRequest(request, requestUrl, expectedCapability, options = {}) {
  if (!isTrustedWorkbenchRendererOrigin(request, options.bridgeHost, options.bridgePort)) return false;
  return safeCapabilityEqual(readWorkbenchRendererCapability(request, requestUrl), expectedCapability);
}

function buildRendererCapabilityUrl(url, capability) {
  const target = new URL(url);
  target.searchParams.set(WORKBENCH_RENDERER_CAPABILITY_QUERY, capability);
  return target.toString();
}

function buildWorkbenchUpstreamSearch(requestUrl) {
  const search = new URLSearchParams(requestUrl.searchParams);
  search.delete(WORKBENCH_RENDERER_CAPABILITY_QUERY);
  const serialized = search.toString();
  return serialized ? `?${serialized}` : '';
}

module.exports = {
  WORKBENCH_RENDERER_CAPABILITY_HEADER,
  WORKBENCH_RENDERER_CAPABILITY_QUERY,
  buildRendererCapabilityUrl,
  buildWorkbenchUpstreamSearch,
  createWorkbenchRendererCapability,
  isAuthorizedWorkbenchRendererRequest,
  isTrustedWorkbenchRendererOrigin,
};
