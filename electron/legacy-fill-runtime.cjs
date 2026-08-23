'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const SERVICE_HOST = '127.0.0.1';
const SERVICE_PORT = 17323;
const SERVICE_ORIGIN = `http://${SERVICE_HOST}:${SERVICE_PORT}`;
const MCP_URL = `${SERVICE_ORIGIN}/mcp`;
const BRIDGE_PREFIX = '/mcp-fill-host/';
const CAPABILITY_HEADER = 'x-dmg-mcp-fill-capability';
const MAX_BRIDGE_BODY_BYTES = 4 * 1024 * 1024;
const REVIEW_LAUNCH_GRANT_TTL_MS = 30_000;
const REVIEW_SESSION_TTL_MS = 8 * 60 * 60 * 1_000;

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function secureEqual(leftValue, rightValue) {
  const left = Buffer.from(String(leftValue || ''));
  const right = Buffer.from(String(rightValue || ''));
  return left.length > 0 && left.length === right.length && crypto.timingSafeEqual(left, right);
}

function requestOrigin(request) {
  const origin = typeof request.headers.origin === 'string' ? request.headers.origin : '';
  if (origin) return origin;
  const referer = typeof request.headers.referer === 'string' ? request.headers.referer : '';
  if (!referer) return '';
  try {
    return new URL(referer).origin;
  } catch {
    return '';
  }
}

function writeJson(response, statusCode, body, corsOrigin = '') {
  if (response.headersSent) {
    response.destroy();
    return;
  }
  const value = Buffer.from(JSON.stringify(body), 'utf8');
  response.statusCode = statusCode;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Content-Length', value.length);
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  if (corsOrigin) {
    response.setHeader('Access-Control-Allow-Origin', corsOrigin);
    response.setHeader('Vary', 'Origin');
  }
  response.end(value);
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BRIDGE_BODY_BYTES) {
      const error = new Error('MCP Fill Host 请求内容过大。');
      error.statusCode = 413;
      error.code = 'mcp-fill-body-too-large';
      throw error;
    }
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    const error = new Error('MCP Fill Host 请求必须是合法 JSON。');
    error.statusCode = 400;
    error.code = 'mcp-fill-invalid-json';
    throw error;
  }
}

function normalizeActionBinding(input) {
  const binding = {
    proposalId: input?.proposalId,
    reviewSessionId: input?.reviewSessionId,
    expectedRevision: Number(input?.expectedRevision),
    expectedManifestDigest: input?.expectedManifestDigest,
  };
  if (typeof binding.proposalId !== 'string' || !binding.proposalId
    || typeof binding.reviewSessionId !== 'string' || !binding.reviewSessionId
    || !Number.isInteger(binding.expectedRevision) || binding.expectedRevision < 1
    || typeof binding.expectedManifestDigest !== 'string' || !binding.expectedManifestDigest) {
    const error = new Error('MCP Fill Web action requires a complete review binding');
    error.statusCode = 400;
    error.code = 'invalid-mcp-fill-web-action';
    throw error;
  }
  return binding;
}

function createLegacyFillRuntime(options) {
  const applicationRoot = path.resolve(options.applicationRoot);
  const runtimeRoot = path.resolve(options.runtimeRoot);
  const browserOrigin = new URL(options.browserOrigin).origin;
  const diagnostics = typeof options.diagnostic === 'function' ? options.diagnostic : () => undefined;
  const launchService = options.launchService;
  if (typeof launchService !== 'function') {
    throw new TypeError('Legacy Fill runtime requires an Electron utility-process launcher');
  }
  const hostToken = crypto.randomBytes(32).toString('base64url');
  const publisherCapability = crypto.randomBytes(32).toString('base64url');
  const reviewLaunchGrants = new Map();
  const reviewSessions = new Map();
  const actionCapabilities = new Map();
  const saveContinuations = new Map();
  const clientConfigPath = path.join(runtimeRoot, 'mcp-client.json');
  let serviceProcess = null;
  let servicePid = null;
  let serviceExited = true;
  let serviceStartedAt = null;
  let serviceReady = false;
  let lastError = '';

  function serviceRunning() {
    return Boolean(serviceProcess && !serviceExited);
  }

  function state() {
    const running = serviceRunning();
    return {
      running,
      ready: running && serviceReady,
      pid: running ? servicePid || serviceProcess.pid || null : null,
      startedAt: running ? serviceStartedAt : null,
      url: SERVICE_ORIGIN,
      mcpUrl: MCP_URL,
      mcpClientConfigPath: clientConfigPath,
      reason: running && serviceReady
        ? 'MCP 填表服务已就绪'
        : lastError || (running ? 'MCP 填表服务正在启动' : 'MCP 填表服务未运行'),
    };
  }

  function ensureClientConfig() {
    fs.mkdirSync(runtimeRoot, { recursive: true });
    try {
      const current = JSON.parse(fs.readFileSync(clientConfigPath, 'utf8'));
      if (current?.contract === 'LegacyFillMcpClientConfigV1'
        && current.transport === 'streamable-http'
        && current.url === MCP_URL
        && typeof current.token === 'string' && current.token
        && typeof current.ownerNamespace === 'string' && current.ownerNamespace) {
        try { fs.chmodSync(clientConfigPath, 0o600); } catch { /* Windows and restricted filesystems */ }
        return current;
      }
    } catch {
      // Create a stable private client identity below.
    }
    const installationId = crypto.randomUUID();
    const config = {
      contract: 'LegacyFillMcpClientConfigV1',
      transport: 'streamable-http',
      url: MCP_URL,
      token: crypto.randomBytes(32).toString('base64url'),
      ownerNamespace: `codex:${installationId}:desktop-default`,
      createdAt: new Date().toISOString(),
    };
    const temporaryPath = `${clientConfigPath}.${process.pid}.next`;
    fs.writeFileSync(temporaryPath, `${JSON.stringify(config, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(temporaryPath, clientConfigPath);
    try { fs.chmodSync(clientConfigPath, 0o600); } catch { /* Windows and restricted filesystems */ }
    return config;
  }

  function serviceEnvironment(clientConfig) {
    const environment = {
      ...process.env,
      LEGACY_FILL_SERVICE_PORT: String(SERVICE_PORT),
      LEGACY_FILL_PARENT_PID: String(process.pid),
      LEGACY_FILL_HOST_TOKEN: hostToken,
      LEGACY_FILL_MCP_CLIENTS_JSON: JSON.stringify({ [clientConfig.token]: clientConfig.ownerNamespace }),
      LEGACY_FILL_DATABASE_PATH: path.join(runtimeRoot, 'legacy-fill.sqlite3'),
      LEGACY_FILL_REGISTRY_PATH: path.join(runtimeRoot, 'registry.json'),
      LEGACY_FILL_DOMAIN_RUNTIME_PATH: path.join(applicationRoot, 'dist', 'legacy-fill', 'domain-runtime.mjs'),
      LEGACY_FILL_STRATEGY_PATH: path.join(applicationRoot, 'dist', 'legacy-fill', 'resources', 'strategy-v2.json'),
      LEGACY_FILL_GOLDEN_PATH: path.join(applicationRoot, 'dist', 'legacy-fill', 'resources', 'golden-v2.json'),
    };
    for (const key of Object.keys(environment)) {
      if (key.startsWith('DEF_') || key.startsWith('OPENCODE_')) delete environment[key];
    }
    return environment;
  }

  async function serviceRequest(pathname, { method = 'GET', body } = {}) {
    const response = await fetch(`${SERVICE_ORIGIN}${pathname}`, {
      method,
      headers: {
        'x-legacy-fill-host-token': hostToken,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(10_000),
    });
    const payload = await response.json().catch(() => ({
      ok: false,
      error: { code: 'invalid-service-response', message: `Legacy Fill 服务返回了非 JSON 响应（${response.status}）。` },
    }));
    return { status: response.status, body: payload };
  }

  async function waitForHealth(expectedPid, timeoutMs = 15_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (!serviceRunning()) throw new Error('MCP 填表服务进程已提前退出。');
      try {
        const response = await fetch(`${SERVICE_ORIGIN}/health`, { signal: AbortSignal.timeout(1_000) });
        const health = await response.json();
        if (response.ok && health?.service === 'legacy-fill-service' && health?.pid === expectedPid
          && health?.domainRuntime?.ready === true && health?.mcp?.enabled === true) {
          return health;
        }
      } catch {
        // The child may still be loading the bundled MCP runtime.
      }
      await delay(100);
    }
    throw new Error(`MCP 填表服务在 ${timeoutMs}ms 内未就绪。`);
  }

  async function start() {
    if (serviceRunning()) return state();
    serviceReady = false;
    lastError = '';
    const servicePath = path.join(applicationRoot, 'dist', 'legacy-fill', 'service.mjs');
    if (!fs.existsSync(servicePath)) {
      lastError = `缺少 MCP 填表运行时：${servicePath}`;
      return state();
    }
    const clientConfig = ensureClientConfig();
    let child;
    try {
      child = launchService({
        servicePath,
        cwd: applicationRoot,
        env: serviceEnvironment(clientConfig),
      });
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      diagnostics(`mcp service launch failed ${lastError}`);
      return state();
    }
    serviceProcess = child;
    servicePid = Number.isInteger(child.pid) ? child.pid : null;
    serviceExited = false;
    serviceStartedAt = Date.now();
    child.stdout?.on('data', (chunk) => diagnostics(`mcp stdout ${String(chunk).trim()}`));
    child.stderr?.on('data', (chunk) => diagnostics(`mcp stderr ${String(chunk).trim()}`));
    child.once('spawn', () => {
      if (serviceProcess !== child) return;
      servicePid = Number.isInteger(child.pid) ? child.pid : servicePid;
      diagnostics(`mcp service spawned pid=${servicePid || '-'}`);
    });
    child.once('error', (type, location) => {
      if (serviceProcess !== child) return;
      lastError = [type, location].filter(Boolean).join(' at ') || 'MCP utility process failed';
      serviceReady = false;
    });
    child.once('exit', (code) => {
      if (serviceProcess !== child) return;
      diagnostics(`mcp service exit code=${code ?? '-'}`);
      if (!lastError && code) lastError = `MCP 填表服务退出（code ${code}）。`;
      serviceExited = true;
      serviceProcess = null;
      servicePid = null;
      serviceStartedAt = null;
      serviceReady = false;
    });
    try {
      const expectedPid = await new Promise((resolve, reject) => {
        if (Number.isInteger(child.pid)) {
          servicePid = child.pid;
          resolve(child.pid);
          return;
        }
        const timer = setTimeout(() => {
          child.off('spawn', onSpawn);
          child.off('exit', onExit);
          reject(new Error('MCP 填表服务进程在 5 秒内未能启动。'));
        }, 5_000);
        const finish = (callback) => {
          clearTimeout(timer);
          child.off('spawn', onSpawn);
          child.off('exit', onExit);
          callback();
        };
        const onSpawn = () => finish(() => {
          servicePid = Number.isInteger(child.pid) ? child.pid : null;
          if (servicePid) resolve(servicePid);
          else reject(new Error('MCP 填表服务进程启动后没有 PID。'));
        });
        const onExit = (code) => finish(() => reject(new Error(`MCP 填表服务进程提前退出（code ${code ?? '-'}）。`)));
        child.once('spawn', onSpawn);
        child.once('exit', onExit);
      });
      await waitForHealth(expectedPid);
      serviceReady = true;
      diagnostics(`mcp service ready pid=${expectedPid}`);
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      diagnostics(`mcp service unavailable ${lastError}`);
      if (serviceProcess === child && !serviceExited) {
        child.kill();
        await waitForExit(child, 2_000);
      }
    }
    return state();
  }

  function waitForExit(child, timeoutMs = 5_000) {
    return new Promise((resolve) => {
      if (!child || serviceProcess !== child || serviceExited) {
        resolve(true);
        return;
      }
      const timer = setTimeout(() => {
        child.off('exit', onExit);
        resolve(false);
      }, timeoutMs);
      const onExit = () => {
        clearTimeout(timer);
        resolve(true);
      };
      child.once('exit', onExit);
    });
  }

  async function stop() {
    const child = serviceProcess;
    if (!child || serviceExited) return state();
    try {
      await serviceRequest('/internal/shutdown', { method: 'POST', body: {} });
    } catch {
      child.kill();
    }
    if (!await waitForExit(child)) {
      child.kill();
      await waitForExit(child, 2_000);
    }
    serviceReady = false;
    reviewLaunchGrants.clear();
    reviewSessions.clear();
    actionCapabilities.clear();
    saveContinuations.clear();
    return state();
  }

  function issueReviewLaunchGrant() {
    const grant = crypto.randomBytes(24).toString('base64url');
    reviewLaunchGrants.set(grant, Date.now() + REVIEW_LAUNCH_GRANT_TTL_MS);
    setTimeout(() => reviewLaunchGrants.delete(grant), REVIEW_LAUNCH_GRANT_TTL_MS + 100).unref?.();
    return grant;
  }

  function exchangeReviewLaunchGrant(grant) {
    const expiresAt = reviewLaunchGrants.get(grant);
    reviewLaunchGrants.delete(grant);
    if (!expiresAt || expiresAt < Date.now()) {
      const error = new Error('MCP Fill review launch grant is invalid or expired');
      error.statusCode = 403;
      error.code = 'mcp-fill-review-launch-required';
      throw error;
    }
    const sessionCapability = crypto.randomBytes(32).toString('base64url');
    reviewSessions.set(sessionCapability, Date.now() + REVIEW_SESSION_TTL_MS);
    setTimeout(() => reviewSessions.delete(sessionCapability), REVIEW_SESSION_TTL_MS + 100).unref?.();
    return sessionCapability;
  }

  function browserScope(capability) {
    if (secureEqual(capability, publisherCapability)) return 'publisher';
    const expiresAt = reviewSessions.get(capability);
    if (!expiresAt) return '';
    if (expiresAt < Date.now()) {
      reviewSessions.delete(capability);
      return '';
    }
    return 'review';
  }

  function issueAction(action, input) {
    if (!['confirm', 'reject'].includes(action)) {
      const error = new Error('MCP Fill Web action requires a supported action');
      error.statusCode = 400;
      error.code = 'invalid-mcp-fill-web-action';
      throw error;
    }
    const binding = normalizeActionBinding(input);
    const token = crypto.randomBytes(24).toString('base64url');
    actionCapabilities.set(token, { action, ...binding, expiresAt: Date.now() + 2_000 });
    setTimeout(() => actionCapabilities.delete(token), 2_100).unref?.();
    return token;
  }

  function consumeAction(token, action, input) {
    const binding = normalizeActionBinding(input);
    const value = actionCapabilities.get(token);
    actionCapabilities.delete(token);
    if (!value || value.action !== action
      || value.proposalId !== binding.proposalId
      || value.reviewSessionId !== binding.reviewSessionId
      || value.expectedRevision !== binding.expectedRevision
      || value.expectedManifestDigest !== binding.expectedManifestDigest
      || value.expiresAt < Date.now()) {
      const error = new Error('A fresh MCP Fill Web confirmation is required');
      error.statusCode = 403;
      error.code = 'mcp-fill-web-action-required';
      throw error;
    }
  }

  async function routeBridge(request, response, requestUrl, corsOrigin, scope) {
    const method = request.method || 'GET';
    const hostHeadersPath = (pathname) => serviceRequest(pathname);
    const publisherRoute = (method === 'GET' && requestUrl.pathname === `${BRIDGE_PREFIX}state`)
      || (method === 'POST' && requestUrl.pathname === `${BRIDGE_PREFIX}snapshots/publish`);
    if (scope !== 'review' && !publisherRoute) {
      writeJson(response, 403, { ok: false, error: {
        code: 'mcp-fill-review-authority-required',
        message: 'This MCP Fill operation requires a review page opened by Electron Shell.',
      } }, corsOrigin);
      return;
    }
    if (method === 'GET' && requestUrl.pathname === `${BRIDGE_PREFIX}state`) {
      writeJson(response, 200, { ok: true, state: state() }, corsOrigin);
      return;
    }
    if (method === 'GET' && requestUrl.pathname === `${BRIDGE_PREFIX}proposals`) {
      const result = await hostHeadersPath('/internal/proposals');
      writeJson(response, result.status, result.body, corsOrigin);
      return;
    }
    if (method !== 'POST') {
      writeJson(response, 405, { ok: false, error: { code: 'method-not-allowed', message: 'Method not allowed' } }, corsOrigin);
      return;
    }
    const body = await readJson(request);
    if (requestUrl.pathname === `${BRIDGE_PREFIX}actions/issue`) {
      writeJson(response, 200, { ok: true, actionCapability: issueAction(body.action, body) }, corsOrigin);
      return;
    }
    if (requestUrl.pathname === `${BRIDGE_PREFIX}proposals/claim`) {
      const reviewSessionId = `legacy-fill-review-${crypto.randomUUID()}`;
      const result = await serviceRequest('/internal/proposals/claim', {
        method: 'POST', body: { ...body, reviewSessionId },
      });
      writeJson(response, result.status, {
        ...result.body,
        ...(result.body?.ok ? { reviewSessionId } : {}),
      }, corsOrigin);
      return;
    }
    if (requestUrl.pathname === `${BRIDGE_PREFIX}proposals/decision`) {
      const { actionCapability, ...payload } = body;
      if (payload.decision !== 'rejected') {
        writeJson(response, 403, { ok: false, error: { code: 'mcp-fill-web-decision-denied', message: 'Web review exposes reject or combined confirm-and-save only.' } }, corsOrigin);
        return;
      }
      consumeAction(actionCapability, 'reject', payload);
      const result = await serviceRequest('/internal/proposals/decision', { method: 'POST', body: payload });
      writeJson(response, result.status, result.body, corsOrigin);
      return;
    }
    if (requestUrl.pathname === `${BRIDGE_PREFIX}proposals/confirm`) {
      const { actionCapability, alreadyApproved, proposal, ...payload } = body;
      consumeAction(actionCapability, 'confirm', payload);
      const decision = alreadyApproved
        ? { status: 200, body: { ok: true, proposal } }
        : await serviceRequest('/internal/proposals/decision', {
          method: 'POST', body: { ...payload, decision: 'approved' },
        });
      if (!decision.body?.ok || !decision.body?.proposal) {
        writeJson(response, decision.status, decision.body, corsOrigin);
        return;
      }
      const begin = await serviceRequest('/internal/proposals/save/begin', {
        method: 'POST', body: { ...payload, expectedRevision: decision.body.proposal.revision },
      });
      if (!begin.body?.ok || !begin.body?.proposal || begin.body.proposal.lifecycleStatus === 'stale') {
        writeJson(response, begin.status, begin.body, corsOrigin);
        return;
      }
      const saveCapability = crypto.randomBytes(24).toString('base64url');
      saveContinuations.set(saveCapability, { proposalId: payload.proposalId, expiresAt: Date.now() + 30_000 });
      setTimeout(() => saveContinuations.delete(saveCapability), 30_100).unref?.();
      writeJson(response, 200, { ...begin.body, approvedProposal: decision.body.proposal, saveCapability }, corsOrigin);
      return;
    }
    if (requestUrl.pathname === `${BRIDGE_PREFIX}proposals/save-result`) {
      const { saveCapability, ...payload } = body;
      const continuation = saveContinuations.get(saveCapability);
      saveContinuations.delete(saveCapability);
      if (!continuation || continuation.proposalId !== payload.proposalId || continuation.expiresAt < Date.now()) {
        writeJson(response, 403, { ok: false, error: { code: 'mcp-fill-save-continuation-invalid', message: 'MCP Fill save continuation is invalid or expired.' } }, corsOrigin);
        return;
      }
      const result = await serviceRequest('/internal/proposals/save/result', { method: 'POST', body: payload });
      writeJson(response, result.status, result.body, corsOrigin);
      return;
    }
    if (requestUrl.pathname === `${BRIDGE_PREFIX}proposals/save/reconcile`) {
      const { snapshot, ...payload } = body;
      const published = await serviceRequest('/internal/snapshots/publish', { method: 'POST', body: snapshot });
      if (!published.body?.ok) {
        writeJson(response, published.status, published.body, corsOrigin);
        return;
      }
      const result = await serviceRequest('/internal/proposals/save/result', {
        method: 'POST', body: { ...payload, ok: true },
      });
      writeJson(response, result.status, { ...result.body, reconciled: Boolean(result.body?.ok) }, corsOrigin);
      return;
    }
    if (requestUrl.pathname === `${BRIDGE_PREFIX}snapshots/publish`) {
      const result = await serviceRequest('/internal/snapshots/publish', { method: 'POST', body: body.snapshot });
      writeJson(response, result.status, result.body, corsOrigin);
      return;
    }
    writeJson(response, 404, { ok: false, error: { code: 'mcp-fill-web-host-route-not-found', message: 'Unknown MCP Fill Web Host route.' } }, corsOrigin);
  }

  async function handleBrowserRequest(request, response) {
    const requestUrl = new URL(request.url || '/', 'http://desktop-mcp-host.invalid');
    if (!requestUrl.pathname.startsWith(BRIDGE_PREFIX)) return false;
    const origin = requestOrigin(request);
    if (request.method === 'OPTIONS') {
      if (origin !== browserOrigin) {
        writeJson(response, 403, { ok: false, error: { code: 'mcp-fill-origin-denied', message: 'MCP Fill browser origin denied.' } });
        return true;
      }
      response.statusCode = 204;
      response.setHeader('Access-Control-Allow-Origin', browserOrigin);
      response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      response.setHeader('Access-Control-Allow-Headers', `content-type, ${CAPABILITY_HEADER}`);
      response.setHeader('Access-Control-Max-Age', '600');
      response.setHeader('Cache-Control', 'no-store');
      response.setHeader('Vary', 'Origin');
      response.end();
      return true;
    }
    if (origin !== browserOrigin) {
      writeJson(response, 403, { ok: false, error: { code: 'mcp-fill-browser-authority-required', message: 'MCP Fill browser authority required.' } });
      return true;
    }
    try {
      if (request.method === 'POST' && requestUrl.pathname === `${BRIDGE_PREFIX}session`) {
        const body = await readJson(request);
        const sessionCapability = exchangeReviewLaunchGrant(body.reviewLaunchGrant);
        writeJson(response, 200, { ok: true, sessionCapability }, browserOrigin);
        return true;
      }
      const scope = browserScope(request.headers[CAPABILITY_HEADER]);
      if (!scope) {
        writeJson(response, 403, { ok: false, error: { code: 'mcp-fill-browser-authority-required', message: 'MCP Fill browser authority required.' } }, browserOrigin);
        return true;
      }
      await routeBridge(request, response, requestUrl, browserOrigin, scope);
    } catch (error) {
      writeJson(response, error?.statusCode || 502, { ok: false, error: {
        code: error?.code || 'mcp-fill-host-error',
        message: error instanceof Error ? error.message : String(error),
      } }, browserOrigin);
    }
    return true;
  }

  return Object.freeze({
    publisherCapability,
    clientConfigPath,
    handleBrowserRequest,
    issueReviewLaunchGrant,
    start,
    stop,
    state,
  });
}

module.exports = { createLegacyFillRuntime };
