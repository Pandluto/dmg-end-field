const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const WORKBENCH_RENDERER_CAPABILITY_HEADER = 'x-workbench-renderer-capability';
const WORKBENCH_RENDERER_CAPABILITY_QUERY = '__workbenchRendererCapability';

function createWorkbenchRendererCapability() {
  return crypto.randomBytes(32).toString('base64url');
}

function isValidWorkbenchRendererCapability(value) {
  // 32 random bytes encoded with base64url are 43 characters.  Keep this
  // intentionally strict so a malformed or manually edited runtime file
  // cannot turn into an always-denied-but-hard-to-diagnose browser session.
  return typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
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
function readOrCreateWorkbenchRendererCapability(filePath) {
  if (!filePath) return createWorkbenchRendererCapability();
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (parsed?.schemaVersion === 1 && isValidWorkbenchRendererCapability(parsed.capability)) {
      return parsed.capability;
    }
  } catch {
    // A first launch or a corrupt runtime artifact both get a new capability.
  }

  const capability = createWorkbenchRendererCapability();
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

function isProtectedWorkbenchRendererLocalDataPath(pathname) {
  return pathname === '/local-data/ai-timeline-worknodes'
    || pathname.startsWith('/local-data/ai-timeline-worknodes/')
    || pathname === '/local-data/timeline-documents'
    || pathname.startsWith('/local-data/timeline-');
}

module.exports = {
  WORKBENCH_RENDERER_CAPABILITY_HEADER,
  WORKBENCH_RENDERER_CAPABILITY_QUERY,
  buildRendererCapabilityUrl,
  createWorkbenchRendererCapability,
  isValidWorkbenchRendererCapability,
  readOrCreateWorkbenchRendererCapability,
  isAuthorizedWorkbenchRendererRequest,
  isProtectedWorkbenchRendererLocalDataPath,
  isTrustedWorkbenchRendererOrigin,
};
