const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const WORKBENCH_RENDERER_CAPABILITY_HEADER = 'x-def-workbench-renderer-capability';
const WORKBENCH_RENDERER_CAPABILITY_QUERY = '__defWorkbenchRendererCapability';

function createPersistentLocalCapability() {
  return crypto.randomBytes(32).toString('base64url');
}

function isValidPersistentLocalCapability(value) {
  // 32 random bytes encoded with base64url are 43 characters.  Keep this
  // intentionally strict so a malformed or manually edited runtime file
  // cannot turn into an always-denied-but-hard-to-diagnose browser session.
  return typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
}

function createWorkbenchRendererCapability() {
  return createPersistentLocalCapability();
}

function isValidWorkbenchRendererCapability(value) {
  return isValidPersistentLocalCapability(value);
}

/**
 * The browser Workbench is intentionally outside the Electron renderer in
 * development.  Its capability therefore has to outlive the Electron main
 * process: Chromium can retain the browser tab's session/local storage while
 * the local bridge restarts.  A per-process token made every such restart
 * look like an unavailable SQLite workspace even though user.sqlite was
 * healthy.
 *
 * This remains an unguessable local capability.  It is stored only in the
 * app's runtime directory and is rotated automatically if that file is
 * missing or malformed.
 */
function readOrCreatePersistentLocalCapability(filePath) {
  if (!filePath) return createPersistentLocalCapability();
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (parsed?.schemaVersion === 1 && isValidPersistentLocalCapability(parsed.capability)) {
      return parsed.capability;
    }
  } catch {
    // A first launch or a corrupt runtime artifact both get a new capability.
  }

  const capability = createPersistentLocalCapability();
  const directory = path.dirname(filePath);
  fs.mkdirSync(directory, { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(temporaryPath, `${JSON.stringify({ schemaVersion: 1, capability })}\n`, { mode: 0o600 });
    fs.renameSync(temporaryPath, filePath);
  } catch {
    try {
      if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
    } catch {
      // The in-memory capability still keeps this launch functional.
    }
  }
  return capability;
}

function readOrCreateWorkbenchRendererCapability(filePath) {
  return readOrCreatePersistentLocalCapability(filePath);
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

function isAuthorizedWorkbenchNativeRequest(request, expectedToken) {
  const token = request?.headers?.['x-def-internal-token'];
  return safeCapabilityEqual(typeof token === 'string' ? token : '', expectedToken);
}

function buildProtectedWorkbenchNativeHeaders(url, expectedOrigin, token) {
  try {
    const target = new URL(url);
    if (target.origin === expectedOrigin && isProtectedWorkbenchRendererLocalDataPath(target.pathname) && token) {
      return { 'x-def-internal-token': token };
    }
  } catch {
    // Invalid or relative targets receive no native authority.
  }
  return {};
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

function isAllowedWorkbenchRendererTransport(method, pathname) {
  const route = `${method} ${pathname}`;
  if ((method === 'GET' || method === 'POST') && pathname.startsWith('/api/timeline-')) return true;
  if (new Set([
    'GET /api/main-workbench/snapshot',
    'POST /api/main-workbench/snapshot',
    'GET /api/main-workbench/commands',
    'POST /api/main-workbench/commands/result',
    'GET /api/main-workbench/commands/events',
    'GET /api/ai-timeline-worknodes',
    'POST /api/ai-timeline-worknodes/create',
  ]).has(route)) return true;
  const match = /^\/api\/ai-timeline-worknodes\/[^/]+(?:\/([^/]+))?$/.exec(pathname);
  if (!match) return false;
  if (method === 'GET') return !match[1] || match[1] === 'diff';
  return method === 'POST' && new Set([
    'update', 'delete', 'commit', 'checkout-applied', 'rollback-applied',
  ]).has(match[1]);
}

function isProtectedWorkbenchRendererLocalDataPath(pathname) {
  return pathname === '/local-data/ai-timeline-worknodes'
    || pathname.startsWith('/local-data/ai-timeline-worknodes/')
    || pathname === '/local-data/timeline-documents'
    || pathname.startsWith('/local-data/timeline-');
}

module.exports = {
  WORKBENCH_RENDERER_CAPABILITY_HEADER,
  WORKBENCH_RENDERER_CAPABILITY_QUERY,
  buildProtectedWorkbenchNativeHeaders,
  buildRendererCapabilityUrl,
  buildWorkbenchUpstreamSearch,
  createPersistentLocalCapability,
  createWorkbenchRendererCapability,
  isValidWorkbenchRendererCapability,
  readOrCreateWorkbenchRendererCapability,
  isAllowedWorkbenchRendererTransport,
  isAuthorizedWorkbenchNativeRequest,
  isAuthorizedWorkbenchRendererRequest,
  isProtectedWorkbenchRendererLocalDataPath,
  isTrustedWorkbenchRendererOrigin,
  readOrCreatePersistentLocalCapability,
};
