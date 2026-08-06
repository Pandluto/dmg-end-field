'use strict';

const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const fsModule = require('node:fs');
const path = require('node:path');

const AGENT_BRIDGE_PREFIX = '/agent-host/';
const AGENT_BRIDGE_ROOT = '/agent-host';
const HOST_TOKEN_HEADER = 'x-dmg-agent-host-token';
const BROWSER_ORIGIN_HEADER = 'x-dmg-agent-browser-origin';
const UI_CAPABILITY_HEADER = 'x-dmg-agent-ui-capability';
const SERVICE_NAME = 'def-agent-host';
const PROTOCOL_VERSION = 2;
const RUNTIME_SCHEMA_VERSION = 1;
const DEFAULT_READY_TIMEOUT_MS = 15_000;
const DEFAULT_POLL_INTERVAL_MS = 50;
const DEFAULT_HEALTH_TIMEOUT_MS = 1_000;
const DEFAULT_PROXY_TIMEOUT_MS = 30_000;
const DEFAULT_STOP_TIMEOUT_MS = 5_000;
const DEFAULT_GRANT_TTL_MS = 30_000;
const MAX_PROXY_BODY_BYTES = 4 * 1024 * 1024;
const HEALTH_PATH = '/internal/health';
const GRANT_PATH = '/internal/launch-grants';
const SHUTDOWN_PATH = '/internal/shutdown';

class AgentRuntimeError extends Error {
  constructor(code, message, statusCode = 500) {
    super(message);
    this.name = 'AgentRuntimeError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

function createAgentRuntime(options = {}) {
  const fs = options.fs || fsModule;
  const timers = options.timers || globalThis;
  const fetchImpl = options.fetch || globalThis.fetch;
  const applicationRoot = path.resolve(String(options.applicationRoot || path.resolve(__dirname, '..')));
  const runtimeRoot = path.resolve(String(
    options.runtimeRoot || path.join(applicationRoot, 'runtime', 'agent-host'),
  ));
  const readyFile = path.resolve(String(
    options.readyFile || path.join(runtimeRoot, 'ready.json'),
  ));
  const servicePath = path.resolve(String(
    options.servicePath || path.join(applicationRoot, 'dist', 'agent', 'host-entry.cjs'),
  ));
  const engineRoot = path.resolve(String(
    options.engineRoot || path.join(applicationRoot, 'dist', 'agent', 'engine', 'opencode'),
  ));
  const engineStoreRoot = path.resolve(String(
    options.engineStoreRoot || path.join(runtimeRoot, 'opencode'),
  ));
  const engineProfilePath = path.resolve(String(
    options.engineProfilePath || path.join(runtimeRoot, 'provider-profiles.json'),
  ));
  const engineDefaultProfileRef = String(options.engineDefaultProfileRef || 'default').trim();
  if (!engineDefaultProfileRef) throw new TypeError('Agent runtime requires a default provider profile ref');
  const browserOrigin = normalizeOrigin(options.browserOrigin || 'http://127.0.0.1:31457');
  const launchService = options.launchService || defaultLaunchService;
  const processKill = typeof options.processKill === 'function' ? options.processKill : process.kill.bind(process);
  const inspectProcessIdentity = typeof options.inspectProcessIdentity === 'function'
    ? options.inspectProcessIdentity
    : defaultInspectProcessIdentity;
  const diagnostic = typeof options.diagnostic === 'function' ? options.diagnostic : () => undefined;
  const clock = typeof options.clock === 'function' ? options.clock : Date.now;
  const randomToken = typeof options.randomToken === 'function'
    ? options.randomToken
    : () => crypto.randomBytes(32).toString('base64url');
  const readyTimeoutMs = positiveInteger(options.readyTimeoutMs, DEFAULT_READY_TIMEOUT_MS);
  const pollIntervalMs = positiveInteger(options.pollIntervalMs, DEFAULT_POLL_INTERVAL_MS);
  const healthTimeoutMs = positiveInteger(options.healthTimeoutMs, DEFAULT_HEALTH_TIMEOUT_MS);
  const proxyTimeoutMs = positiveInteger(options.proxyTimeoutMs, DEFAULT_PROXY_TIMEOUT_MS);
  const stopTimeoutMs = positiveInteger(options.stopTimeoutMs, DEFAULT_STOP_TIMEOUT_MS);
  const grantTtlMs = positiveInteger(options.grantTtlMs, DEFAULT_GRANT_TTL_MS);

  if (typeof fetchImpl !== 'function') {
    throw new TypeError('Agent runtime requires a fetch implementation');
  }
  if (typeof launchService !== 'function') {
    throw new TypeError('Agent runtime requires an Electron utility-process launcher');
  }

  let lifecycle = 'not-started';
  let child = null;
  let childExited = true;
  let childPid = null;
  let childExitPromise = null;
  let resolveChildExit = null;
  let manifest = null;
  let privateOrigin = '';
  let hostToken = '';
  let startedAt = null;
  let lastError = '';
  let lastHealth = null;
  let startPromise = null;
  let healthPromise = null;
  let stopPromise = null;
  let stopRequested = false;
  let launchError = null;

  function state() {
    const running = Boolean(child && !childExited);
    return {
      service: SERVICE_NAME,
      running,
      ready: running && lifecycle === 'ready',
      state: lifecycle,
      pid: running ? childPid : null,
      port: running && manifest ? manifest.port : null,
      startedAt: running ? startedAt : null,
      health: lastHealth,
      reason: running && lifecycle === 'ready'
        ? 'DEF Agent Host 已就绪'
        : lastError || (lifecycle === 'starting'
          ? 'DEF Agent Host 正在启动'
          : lifecycle === 'stopping'
            ? 'DEF Agent Host 正在停止'
            : lifecycle === 'not-started'
              ? 'DEF Agent Host 尚未启动'
              : 'DEF Agent Host 未运行'),
    };
  }

  function clearReadyFile() {
    try {
      if (typeof fs.existsSync !== 'function' || fs.existsSync(readyFile)) fs.unlinkSync(readyFile);
    } catch (error) {
      diagnostic(`agent ready manifest cleanup failed: ${messageOf(error)}`);
    }
  }

  function readReadyManifest() {
    if (typeof fs.existsSync === 'function' && !fs.existsSync(readyFile)) return null;
    let raw;
    try {
      raw = fs.readFileSync(readyFile, 'utf8');
    } catch (error) {
      if (error?.code === 'ENOENT') return null;
      throw new AgentRuntimeError('AGENT_READY_READ_FAILED', `无法读取 Agent Host 就绪清单：${messageOf(error)}`);
    }
    let value;
    try {
      value = JSON.parse(String(raw));
    } catch {
      // The child writes this file atomically. A malformed file can only be stale or
      // incomplete, so keep polling until the bounded handshake expires.
      return null;
    }
    validateReadyManifest(value, childPid);
    return value;
  }

  function attachChild(nextChild) {
    child = nextChild;
    childExited = false;
    childPid = Number.isInteger(nextChild?.pid) && nextChild.pid > 0 ? nextChild.pid : null;
    childExitPromise = new Promise((resolve) => {
      resolveChildExit = resolve;
    });

    addOnce(nextChild, 'spawn', () => {
      if (child !== nextChild) return;
      if (Number.isInteger(nextChild.pid) && nextChild.pid > 0) childPid = nextChild.pid;
      diagnostic(`agent host spawned pid=${childPid || '-'}`);
    });
    addOnce(nextChild, 'error', (error) => {
      if (child !== nextChild || childExited) return;
      launchError = error instanceof Error ? error : new Error(String(error));
      lastError = `Agent Host 进程错误：${launchError.message}`;
      diagnostic(`agent host process error: ${launchError.message}`);
      if (lifecycle === 'ready') lifecycle = 'error';
    });
    addOnce(nextChild, 'exit', (code, signal) => {
      if (child !== nextChild) return;
      const exitedHostPid = childPid;
      childExited = true;
      if (resolveChildExit) resolveChildExit({ code, signal });
      resolveChildExit = null;
      childExitPromise = null;
      child = null;
      const wasStopping = lifecycle === 'stopping' || stopRequested;
      const preserveExistingError = lifecycle === 'error' && Boolean(lastError);
      manifest = null;
      privateOrigin = '';
      lastHealth = null;
      clearReadyFile();
      void terminateOrphanedEngine(exitedHostPid);
      if (wasStopping) {
        diagnostic(`agent host stopped code=${code ?? '-'} signal=${signal || '-'}`);
      } else if (!preserveExistingError) {
        lifecycle = 'error';
        lastError = `Agent Host 进程已退出（code=${code ?? '-'}, signal=${signal || '-'}）。`;
        diagnostic(`agent host crashed code=${code ?? '-'} signal=${signal || '-'}`);
      }
    });
  }

  async function terminateOrphanedEngine(expectedHostPid) {
    if (!Number.isSafeInteger(expectedHostPid) || expectedHostPid <= 0) return false;
    const processManifestPath = path.join(engineStoreRoot, 'process.json');
    try {
      if (typeof fs.existsSync === 'function' && !fs.existsSync(processManifestPath)) return false;
      if (typeof fs.lstatSync === 'function') {
        const info = fs.lstatSync(processManifestPath);
        if (!info.isFile() || info.isSymbolicLink() || info.size > 4_096) return false;
        if (
          process.platform !== 'win32'
          && ((info.mode & 0o077) !== 0 || (process.getuid && info.uid !== process.getuid()))
        ) return false;
      }
      const ownership = parseEngineProcessManifest(
        JSON.parse(String(fs.readFileSync(processManifestPath, 'utf8'))),
      );
      if (ownership.hostPid !== expectedHostPid) return false;
      if (ownership.legacy) {
        if (isProcessAlive(ownership.enginePid)) {
          diagnostic(`legacy OpenCode ownership manifest retained for live pid=${ownership.enginePid}`);
          return false;
        }
        removeEngineProcessManifest(processManifestPath);
        return true;
      }

      let engineState = ownedProcessState(
        ownership.enginePid,
        ownership.engineProcessIdentity,
      );
      if (engineState !== 'owned') {
        removeEngineProcessManifest(processManifestPath);
        diagnostic(engineState === 'reused'
          ? `stale OpenCode PID was reused; manifest removed without signalling pid=${ownership.enginePid}`
          : `stale OpenCode engine already exited pid=${ownership.enginePid}`);
        return true;
      }
      if (engineState === 'owned') {
        try {
          processKill(ownership.enginePid, 'SIGTERM');
        } catch (error) {
          if (error?.code !== 'ESRCH') throw error;
        }
        await waitForOwnedProcessExit(
          ownership.enginePid,
          ownership.engineProcessIdentity,
          Math.min(stopTimeoutMs, 2_000),
        );
      }
      engineState = ownedProcessState(ownership.enginePid, ownership.engineProcessIdentity);
      if (engineState === 'owned') {
        try {
          processKill(ownership.enginePid, 'SIGKILL');
        } catch (error) {
          if (error?.code !== 'ESRCH') throw error;
        }
        await waitForOwnedProcessExit(ownership.enginePid, ownership.engineProcessIdentity, 1_000);
      }
      engineState = ownedProcessState(ownership.enginePid, ownership.engineProcessIdentity);
      if (engineState === 'owned') {
        throw new AgentRuntimeError(
          'AGENT_ENGINE_STOP_FAILED',
          `OpenCode engine ${ownership.enginePid} did not exit after SIGKILL`,
        );
      }
      removeEngineProcessManifest(processManifestPath);
      diagnostic(`orphaned OpenCode engine terminated pid=${ownership.enginePid}`);
      return true;
    } catch (error) {
      diagnostic(`OpenCode process ownership cleanup failed: ${messageOf(error)}`);
      return false;
    }
  }

  async function cleanupStaleEngineBeforeStart() {
    const processManifestPath = path.join(engineStoreRoot, 'process.json');
    if (typeof fs.existsSync === 'function' && !fs.existsSync(processManifestPath)) return;
    let manifestValue;
    try {
      if (typeof fs.lstatSync === 'function') {
        const info = fs.lstatSync(processManifestPath);
        if (!info.isFile() || info.isSymbolicLink() || info.size > 4_096) {
          throw new AgentRuntimeError('AGENT_ENGINE_MANIFEST_INVALID', 'OpenCode process ownership manifest is invalid');
        }
        if (
          process.platform !== 'win32'
          && ((info.mode & 0o077) !== 0 || (process.getuid && info.uid !== process.getuid()))
        ) {
          throw new AgentRuntimeError('AGENT_ENGINE_MANIFEST_INVALID', 'OpenCode process ownership manifest is insecure');
        }
      }
      manifestValue = parseEngineProcessManifest(
        JSON.parse(String(fs.readFileSync(processManifestPath, 'utf8'))),
      );
    } catch (error) {
      if (error?.code === 'ENOENT') return;
      throw error instanceof AgentRuntimeError
        ? error
        : new AgentRuntimeError('AGENT_ENGINE_MANIFEST_INVALID', 'OpenCode process ownership manifest is invalid');
    }
    const hostPid = manifestValue.hostPid;
    if (manifestValue.legacy && isProcessAlive(hostPid)) {
      throw new AgentRuntimeError(
        'AGENT_ENGINE_ALREADY_RUNNING',
        `Legacy OpenCode ownership is still associated with live PID ${hostPid}`,
      );
    }
    if (manifestValue.legacy && isProcessAlive(manifestValue.enginePid)) {
      throw new AgentRuntimeError(
        'AGENT_ENGINE_STOP_FAILED',
        'A live engine with a legacy ownership manifest cannot be signalled safely',
      );
    }
    if (!manifestValue.legacy) {
      const hostState = ownedProcessState(hostPid, manifestValue.hostProcessIdentity);
      if (hostState === 'owned') {
        throw new AgentRuntimeError(
          'AGENT_ENGINE_ALREADY_RUNNING',
          `OpenCode engine is still owned by live Agent Host ${hostPid}`,
        );
      }
    }
    const cleaned = await terminateOrphanedEngine(hostPid);
    if (!cleaned && fs.existsSync(processManifestPath)) {
      throw new AgentRuntimeError('AGENT_ENGINE_STOP_FAILED', 'Stale OpenCode engine could not be cleaned');
    }
  }

  function isProcessAlive(pid) {
    if (!Number.isSafeInteger(pid) || pid <= 0) return false;
    try {
      processKill(pid, 0);
      return true;
    } catch (error) {
      if (error?.code === 'ESRCH') return false;
      if (error?.code === 'EPERM') return true;
      throw error;
    }
  }

  function ownedProcessState(pid, expectedIdentity) {
    if (!isProcessAlive(pid)) return 'exited';
    let actualIdentity;
    try {
      actualIdentity = inspectProcessIdentity(pid);
    } catch (error) {
      throw new AgentRuntimeError(
        'AGENT_PROCESS_IDENTITY_UNAVAILABLE',
        `无法核验进程 ${pid} 的身份：${messageOf(error)}`,
      );
    }
    if (!actualIdentity) {
      if (!isProcessAlive(pid)) return 'exited';
      throw new AgentRuntimeError(
        'AGENT_PROCESS_IDENTITY_UNAVAILABLE',
        `无法核验仍在运行的进程 ${pid} 身份`,
      );
    }
    return actualIdentity === expectedIdentity ? 'owned' : 'reused';
  }

  async function waitForOwnedProcessExit(pid, expectedIdentity, timeoutMs) {
    const deadline = clock() + timeoutMs;
    while (clock() < deadline) {
      if (ownedProcessState(pid, expectedIdentity) !== 'owned') return true;
      await delay(Math.min(50, Math.max(1, deadline - clock())));
    }
    return ownedProcessState(pid, expectedIdentity) !== 'owned';
  }

  async function waitForProcessExit(pid, timeoutMs) {
    const deadline = clock() + timeoutMs;
    while (clock() < deadline) {
      if (!isProcessAlive(pid)) return true;
      await delay(Math.min(50, Math.max(1, deadline - clock())));
    }
    return !isProcessAlive(pid);
  }

  function removeEngineProcessManifest(processManifestPath) {
    try {
      fs.unlinkSync(processManifestPath);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }

  async function start() {
    if (startPromise) return startPromise;
    startPromise = ensureStarted().finally(() => {
      startPromise = null;
    });
    return startPromise;
  }

  async function ensureStarted() {
    stopRequested = false;
    if (stopPromise) await stopPromise;

    if (child && !childExited && lifecycle === 'ready') {
      try {
        await probeHealth();
        return state();
      } catch (error) {
        lastError = `Agent Host 健康检查失败：${messageOf(error)}`;
        lifecycle = 'error';
        await stopCurrentChild();
      }
    }

    if (child && !childExited) await stopCurrentChild();
    return launchFreshHost();
  }

  async function launchFreshHost() {
    lifecycle = 'starting';
    lastError = '';
    lastHealth = null;
    launchError = null;
    manifest = null;
    privateOrigin = '';
    startedAt = new Date(clock()).toISOString();
    hostToken = secureToken(randomToken());
    clearReadyFile();

    try {
      fs.mkdirSync(runtimeRoot, { recursive: true });
      await cleanupStaleEngineBeforeStart();
    } catch (error) {
      return failStart(new AgentRuntimeError(
        'AGENT_RUNTIME_DIRECTORY_FAILED',
        `无法准备 Agent Host 运行目录或清理旧引擎：${messageOf(error)}`,
      ));
    }

    if (!fs.existsSync(servicePath)) {
      return failStart(new AgentRuntimeError(
        'AGENT_RUNTIME_MISSING',
        `缺少 Agent Host 运行时：${servicePath}`,
      ));
    }

    const environment = childEnvironment();
    let nextChild;
    try {
      nextChild = launchService({
        servicePath,
        cwd: applicationRoot,
        env: environment,
      });
      if (!nextChild || typeof nextChild !== 'object') {
        throw new TypeError('Electron utilityProcess launcher did not return a process');
      }
      attachChild(nextChild);
    } catch (error) {
      return failStart(new AgentRuntimeError(
        'AGENT_RUNTIME_LAUNCH_FAILED',
        `无法启动 Agent Host：${messageOf(error)}`,
      ));
    }

    try {
      manifest = await waitForReadyManifest();
      privateOrigin = originForManifest(manifest);
      lastHealth = await requestHealth();
      lifecycle = 'ready';
      diagnostic(`agent host ready at ${privateOrigin}`);
      return state();
    } catch (error) {
      const failure = error instanceof AgentRuntimeError
        ? error
        : new AgentRuntimeError('AGENT_RUNTIME_NOT_READY', messageOf(error));
      return failStart(failure);
    }
  }

  async function failStart(error) {
    lifecycle = 'error';
    lastError = error.message;
    diagnostic(`agent host start failed: ${error.message}`);
    await stopCurrentChild({ requestShutdown: false });
    return state();
  }

  async function waitForReadyManifest() {
    const deadline = clock() + readyTimeoutMs;
    let lastReadError = null;
    while (clock() < deadline) {
      if (stopRequested) {
        throw new AgentRuntimeError('AGENT_RUNTIME_STOPPED', 'Agent Host 启动已被停止请求取消');
      }
      if (launchError) throw new AgentRuntimeError('AGENT_RUNTIME_PROCESS_ERROR', launchError.message);
      if (childExited) {
        throw new AgentRuntimeError('AGENT_RUNTIME_EXITED', 'Agent Host 在就绪前已退出');
      }
      try {
        const candidate = readReadyManifest();
        if (candidate) return candidate;
      } catch (error) {
        lastReadError = error;
      }
      await delay(Math.min(pollIntervalMs, Math.max(1, deadline - clock())));
    }
    if (lastReadError) throw lastReadError;
    throw new AgentRuntimeError('AGENT_RUNTIME_READY_TIMEOUT', `Agent Host 在 ${readyTimeoutMs}ms 内未就绪`);
  }

  async function probeHealth() {
    if (!manifest || !privateOrigin || !child || childExited) {
      throw new AgentRuntimeError('AGENT_RUNTIME_NOT_RUNNING', 'Agent Host 尚未运行');
    }
    if (healthPromise) return healthPromise;
    healthPromise = requestHealth().finally(() => {
      healthPromise = null;
    });
    lastHealth = await healthPromise;
    return lastHealth;
  }

  async function requestHealth() {
    const response = await internalRequest(HEALTH_PATH, { method: 'GET' });
    const health = await responseJson(response, 'Agent Host 健康检查');
    if (
      health?.service !== SERVICE_NAME
      || health?.protocolVersion !== PROTOCOL_VERSION
      || health?.runtimeSchemaVersion !== RUNTIME_SCHEMA_VERSION
      || health?.state !== 'ready'
    ) {
      throw new AgentRuntimeError('AGENT_RUNTIME_HEALTH_INVALID', 'Agent Host 健康检查返回了不兼容状态');
    }
    return health;
  }

  async function issueLaunchGrant({
    origin = browserOrigin,
    audience = 'workbench-ai-mode',
    ttlMs = grantTtlMs,
  } = {}) {
    const targetOrigin = normalizeOrigin(origin);
    if (audience !== 'workbench-ai-mode') {
      throw new AgentRuntimeError('AGENT_LAUNCH_AUDIENCE_INVALID', 'Agent AI 模式 audience 不合法', 400);
    }
    const requestedTtl = positiveInteger(ttlMs, grantTtlMs);
    const runtime = await start();
    if (!runtime.ready) {
      throw new AgentRuntimeError('AGENT_RUNTIME_UNAVAILABLE', runtime.reason || 'Agent Host 不可用', 503);
    }
    const grant = secureToken(randomToken());
    const expiresAt = clock() + requestedTtl;
    const response = await internalRequest(GRANT_PATH, {
      method: 'POST',
      body: { grant, origin: targetOrigin, audience, expiresAt },
    });
    await responseJson(response, 'Agent launch grant 注册');
    return { grant, origin: targetOrigin, audience, expiresAt };
  }

  async function handleBrowserRequest(request, response) {
    const pathname = requestPathname(request);
    if (pathname !== AGENT_BRIDGE_ROOT && !pathname.startsWith(AGENT_BRIDGE_PREFIX)) return false;

    const requestOriginValue = requestOrigin(request);
    if (requestOriginValue && requestOriginValue !== browserOrigin) {
      writeJson(response, 403, {
        ok: false,
        error: { code: 'agent-origin-denied', message: 'Agent Host 浏览器来源不被允许。' },
      });
      return true;
    }

    if (String(request.method || 'GET').toUpperCase() === 'OPTIONS') {
      writeCorsPreflight(response, browserOrigin);
      return true;
    }

    const runtime = startPromise ? await startPromise : state();
    if (!runtime.ready || !privateOrigin) {
      writeJson(response, 503, {
        ok: false,
        error: { code: 'agent-host-unavailable', message: runtime.reason },
      });
      return true;
    }

    let body;
    try {
      body = await requestBody(request);
    } catch (error) {
      const statusCode = Number.isInteger(error?.statusCode) ? error.statusCode : 400;
      writeJson(response, statusCode, {
        ok: false,
        error: { code: error?.code || 'agent-request-invalid', message: messageOf(error) },
      });
      return true;
    }

    try {
      const upstream = await fetchWithTimeout(
        `${privateOrigin}${requestTarget(request)}`,
        {
          method: String(request.method || 'GET').toUpperCase(),
          headers: proxyRequestHeaders(request, browserOrigin, hostToken),
          ...(body === undefined ? {} : { body }),
        },
        proxyTimeoutMs,
      );
      await writeUpstreamResponse(response, upstream, browserOrigin);
    } catch (error) {
      writeJson(response, 502, {
        ok: false,
        error: { code: 'agent-host-proxy-failed', message: messageOf(error) },
      });
    }
    return true;
  }

  async function stop() {
    if (stopPromise) return stopPromise;
    stopPromise = (async () => {
      stopRequested = true;
      const pendingStart = startPromise;
      if (pendingStart) await pendingStart.catch(() => undefined);
      lifecycle = 'stopping';
      await stopCurrentChild();
      hostToken = '';
      manifest = null;
      privateOrigin = '';
      lastHealth = null;
      startedAt = null;
      childPid = null;
      lastError = '';
      lifecycle = 'stopped';
      return state();
    })().finally(() => {
      stopPromise = null;
    });
    return stopPromise;
  }

  async function stopCurrentChild({ requestShutdown = true } = {}) {
    const currentChild = child;
    if (!currentChild || childExited) {
      clearReadyFile();
      child = null;
      childExited = true;
      manifest = null;
      privateOrigin = '';
      return;
    }
    if (lifecycle !== 'stopping' && requestShutdown) lifecycle = 'stopping';

    if (requestShutdown && manifest && privateOrigin) {
      try {
        await internalRequest(SHUTDOWN_PATH, { method: 'POST', timeoutMs: healthTimeoutMs });
      } catch (error) {
        diagnostic(`agent host graceful shutdown unavailable: ${messageOf(error)}`);
      }
    }

    const exitPromise = childExitPromise;
    if (exitPromise) await raceWithDelay(exitPromise, stopTimeoutMs);
    if (!childExited && child === currentChild) {
      await requireOwnedEngineStopped(childPid);
      try {
        if (typeof currentChild.kill === 'function') currentChild.kill();
      } catch (error) {
        diagnostic(`agent host kill failed: ${messageOf(error)}`);
      }
      if (childExitPromise) await raceWithDelay(childExitPromise, Math.min(stopTimeoutMs, 1_000));
    }
    if (!childExited && child === currentChild) {
      try {
        if (childPid && isProcessAlive(childPid)) processKill(childPid, 'SIGKILL');
      } catch (error) {
        if (error?.code !== 'ESRCH') diagnostic(`agent host SIGKILL failed: ${messageOf(error)}`);
      }
      if (childPid) await waitForProcessExit(childPid, 1_000);
    }
    if (!childExited && child === currentChild && childPid && isProcessAlive(childPid)) {
      throw new AgentRuntimeError('AGENT_RUNTIME_STOP_FAILED', `Agent Host ${childPid} did not exit after SIGKILL`);
    }
    if (!childExited && child === currentChild) {
      // The OS confirmed exit even if Electron lost the utility-process event.
      child = null;
      childExited = true;
      if (resolveChildExit) resolveChildExit({ code: null, signal: 'forced-timeout' });
      resolveChildExit = null;
      childExitPromise = null;
      manifest = null;
      privateOrigin = '';
      clearReadyFile();
      await requireOwnedEngineStopped(childPid);
    }
  }

  async function requireOwnedEngineStopped(expectedHostPid) {
    const cleaned = await terminateOrphanedEngine(expectedHostPid);
    const processManifestPath = path.join(engineStoreRoot, 'process.json');
    if (!cleaned && typeof fs.existsSync === 'function' && fs.existsSync(processManifestPath)) {
      throw new AgentRuntimeError(
        'AGENT_ENGINE_STOP_FAILED',
        'OpenCode engine could not be confirmed stopped; ownership manifest was retained',
      );
    }
  }

  async function internalRequest(pathname, { method = 'GET', body, timeoutMs = healthTimeoutMs } = {}) {
    if (!privateOrigin || !hostToken) {
      throw new AgentRuntimeError('AGENT_RUNTIME_NOT_RUNNING', 'Agent Host 私有服务尚未就绪');
    }
    const response = await fetchWithTimeout(
      `${privateOrigin}${pathname}`,
      {
        method,
        headers: {
          [HOST_TOKEN_HEADER]: hostToken,
          accept: 'application/json',
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      },
      timeoutMs,
    );
    if (!isResponseOk(response)) {
      throw new AgentRuntimeError(
        'AGENT_RUNTIME_HTTP_FAILED',
        `Agent Host 私有请求失败（HTTP ${response.status}）`,
        response.status || 502,
      );
    }
    return response;
  }

  function childEnvironment() {
    const environment = { ...process.env, ...(options.environment || {}) };
    for (const key of Object.keys(environment)) {
      if (key.startsWith('OPENCODE_') || key.startsWith('PI_AGENT_') || key.startsWith('DEF_AGENT_')) {
        delete environment[key];
      }
    }
    Object.assign(environment, {
      DEF_AGENT_HOST_TOKEN: hostToken,
      DEF_AGENT_BROWSER_ORIGIN: browserOrigin,
      DEF_AGENT_READY_FILE: readyFile,
      DEF_AGENT_PARENT_PID: String(process.pid),
      DEF_AGENT_ENGINE_ROOT: engineRoot,
      DEF_AGENT_ENGINE_STORE_ROOT: engineStoreRoot,
      DEF_AGENT_ENGINE_PROFILE_PATH: engineProfilePath,
      DEF_AGENT_ENGINE_DEFAULT_PROFILE_REF: engineDefaultProfileRef,
    });
    return environment;
  }

  return Object.freeze({
    state,
    start,
    stop,
    issueLaunchGrant,
    handleBrowserRequest,
    get readyFile() { return readyFile; },
    get servicePath() { return servicePath; },
    get engineRoot() { return engineRoot; },
    get engineStoreRoot() { return engineStoreRoot; },
    get engineProfilePath() { return engineProfilePath; },
    get browserOrigin() { return browserOrigin; },
  });

  function delay(milliseconds) {
    return new Promise((resolve) => {
      const handle = timers.setTimeout(resolve, milliseconds);
      handle?.unref?.();
    });
  }

  function raceWithDelay(promise, milliseconds) {
    return Promise.race([
      promise,
      delay(milliseconds),
    ]);
  }

  async function fetchWithTimeout(url, requestOptions, timeoutMs) {
    const controller = new AbortController();
    const timeout = timers.setTimeout(() => controller.abort(), timeoutMs);
    timeout?.unref?.();
    try {
      return await fetchImpl(url, { ...requestOptions, signal: controller.signal });
    } finally {
      timers.clearTimeout(timeout);
    }
  }

  async function responseJson(response, label) {
    try {
      if (typeof response.json === 'function') return await response.json();
      return JSON.parse(await response.text());
    } catch (error) {
      throw new AgentRuntimeError('AGENT_RUNTIME_RESPONSE_INVALID', `${label}返回了非 JSON 响应：${messageOf(error)}`);
    }
  }
}

function parseEngineProcessManifest(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AgentRuntimeError('AGENT_ENGINE_MANIFEST_INVALID', 'OpenCode process ownership manifest is invalid');
  }
  const legacyKeys = ['enginePid', 'hostPid', 'processNonce', 'runtimeVersion', 'schemaVersion'];
  const currentKeys = [
    'enginePid',
    'engineProcessIdentity',
    'hostPid',
    'hostProcessIdentity',
    'processNonce',
    'runtimeVersion',
    'schemaVersion',
  ];
  const keys = Object.keys(value).sort();
  const isLegacy = value.schemaVersion === 1
    && keys.length === legacyKeys.length
    && keys.every((key, index) => key === legacyKeys[index]);
  const isCurrent = value.schemaVersion === 2
    && keys.length === currentKeys.length
    && keys.every((key, index) => key === currentKeys[index]);
  if (
    (!isLegacy && !isCurrent)
    || !Number.isSafeInteger(value.hostPid)
    || value.hostPid <= 0
    || !Number.isSafeInteger(value.enginePid)
    || value.enginePid <= 0
    || value.enginePid === value.hostPid
    || value.enginePid === process.pid
    || typeof value.processNonce !== 'string'
    || !/^[A-Za-z0-9_-]{32,128}$/.test(value.processNonce)
    || value.runtimeVersion !== '1.17.11-def.1'
    || (isCurrent && (
      typeof value.hostProcessIdentity !== 'string'
      || !/^sha256:[a-f0-9]{64}$/.test(value.hostProcessIdentity)
      || typeof value.engineProcessIdentity !== 'string'
      || !/^sha256:[a-f0-9]{64}$/.test(value.engineProcessIdentity)
    ))
  ) {
    throw new AgentRuntimeError('AGENT_ENGINE_MANIFEST_INVALID', 'OpenCode process ownership manifest is invalid');
  }
  return isLegacy
    ? { ...value, legacy: true }
    : { ...value, legacy: false };
}

function defaultInspectProcessIdentity(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return null;
  const result = process.platform === 'win32'
    ? spawnSync('powershell.exe', [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `$p = Get-CimInstance Win32_Process -Filter \"ProcessId = ${pid}\" | Select-Object -First 1 CreationDate,ExecutablePath; if ($null -ne $p) { $p | ConvertTo-Json -Compress }`,
    ], { encoding: 'utf8', timeout: 3_000, windowsHide: true })
    : spawnSync('ps', [
      '-p', String(pid),
      '-o', 'lstart=',
      '-o', 'comm=',
    ], { encoding: 'utf8', timeout: 3_000, windowsHide: true });
  if (result.error) throw result.error;
  const normalized = String(result.stdout || '').trim().replace(/\s+/gu, ' ');
  if (!normalized) return null;
  return `sha256:${crypto.createHash('sha256').update(normalized).digest('hex')}`;
}

function defaultLaunchService({ servicePath, cwd, env }) {
  // Keep Electron out of the module load path so the supervisor remains unit
  // testable in plain Node. Main injects the same function explicitly.
  const { utilityProcess } = require('electron');
  return utilityProcess.fork(servicePath, [], {
    cwd,
    env,
    stdio: 'pipe',
    serviceName: 'DEF Agent Host',
  });
}

function normalizeOrigin(value) {
  try {
    const url = new URL(String(value));
    if (
      !['http:', 'https:'].includes(url.protocol)
      || url.username
      || url.password
      || url.pathname !== '/'
      || url.search
      || url.hash
    ) throw new Error('invalid browser origin');
    return url.origin;
  } catch {
    throw new AgentRuntimeError('AGENT_BROWSER_ORIGIN_INVALID', 'Agent 浏览器 origin 不合法', 400);
  }
}

function validateReadyManifest(value, expectedPid) {
  if (!value || typeof value !== 'object') {
    throw new AgentRuntimeError('AGENT_READY_INVALID', 'Agent Host 就绪清单格式不合法');
  }
  if (value.service !== SERVICE_NAME) {
    throw new AgentRuntimeError('AGENT_READY_INVALID', 'Agent Host 就绪清单 service 不匹配');
  }
  if (
    value.protocolVersion !== PROTOCOL_VERSION
    || value.runtimeSchemaVersion !== RUNTIME_SCHEMA_VERSION
  ) {
    throw new AgentRuntimeError('AGENT_READY_INCOMPATIBLE', 'Agent Host 就绪清单协议版本不兼容');
  }
  if (!isLoopbackHost(value.host)) {
    throw new AgentRuntimeError('AGENT_READY_NOT_PRIVATE', 'Agent Host 就绪清单不是 loopback 地址');
  }
  if (!Number.isInteger(value.port) || value.port < 1 || value.port > 65535) {
    throw new AgentRuntimeError('AGENT_READY_INVALID', 'Agent Host 就绪清单端口不合法');
  }
  if (!Number.isInteger(value.pid) || value.pid < 1) {
    throw new AgentRuntimeError('AGENT_READY_INVALID', 'Agent Host 就绪清单 pid 不合法');
  }
  if (
    expectedPid !== null
    && expectedPid !== undefined
    && value.pid !== expectedPid
  ) {
    throw new AgentRuntimeError('AGENT_READY_PID_MISMATCH', 'Agent Host 就绪清单进程不匹配');
  }
  if (value.healthPath !== undefined && normalizePath(value.healthPath) !== HEALTH_PATH) {
    throw new AgentRuntimeError('AGENT_READY_INVALID', 'Agent Host 健康检查路径不匹配');
  }
}

function originForManifest(manifest) {
  const host = manifest.host === '::1' ? '[::1]' : manifest.host;
  return `http://${host}:${manifest.port}`;
}

function isLoopbackHost(value) {
  const normalized = String(value || '').toLowerCase().replace(/\.$/u, '');
  return normalized === '127.0.0.1' || normalized === 'localhost' || normalized === '::1';
}

function normalizePath(value) {
  const pathValue = String(value || '');
  return pathValue.startsWith('/') ? pathValue : `/${pathValue}`;
}

function positiveInteger(value, fallback) {
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function secureToken(value) {
  const token = String(value || '');
  if (!/^[A-Za-z0-9_-]{20,200}$/u.test(token)) {
    throw new AgentRuntimeError('AGENT_TOKEN_GENERATION_FAILED', 'Agent runtime 生成了不安全 token');
  }
  return token;
}

function addOnce(target, eventName, listener) {
  if (typeof target?.once === 'function') {
    target.once(eventName, listener);
  } else if (typeof target?.on === 'function') {
    target.on(eventName, listener);
  } else {
    throw new TypeError(`Agent utility process does not support ${eventName} events`);
  }
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}

function isResponseOk(response) {
  return response?.ok === undefined ? Number(response?.status || 0) >= 200 && Number(response?.status || 0) < 400 : response.ok;
}

function requestPathname(request) {
  try {
    return new URL(String(request?.url || '/'), 'http://desktop-bridge.invalid').pathname;
  } catch {
    return '';
  }
}

function requestTarget(request) {
  const parsed = new URL(String(request?.url || '/'), 'http://desktop-bridge.invalid');
  return `${parsed.pathname}${parsed.search}`;
}

function headerValue(headers, name) {
  if (!headers) return '';
  const expected = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (String(key).toLowerCase() !== expected) continue;
    return Array.isArray(value) ? String(value[0] || '') : String(value || '');
  }
  return '';
}

function requestOrigin(request) {
  const origin = headerValue(request?.headers, 'origin');
  if (origin) {
    try { return new URL(origin).origin; } catch { return origin; }
  }
  const referer = headerValue(request?.headers, 'referer');
  if (referer) {
    try { return new URL(referer).origin; } catch { return referer; }
  }
  return '';
}

function proxyRequestHeaders(request, browserOrigin, hostToken) {
  const headers = {
    origin: requestOrigin(request) || browserOrigin,
    [BROWSER_ORIGIN_HEADER]: browserOrigin,
    accept: headerValue(request?.headers, 'accept') || 'application/json',
    [HOST_TOKEN_HEADER]: hostToken,
  };
  const capability = headerValue(request?.headers, UI_CAPABILITY_HEADER);
  const contentType = headerValue(request?.headers, 'content-type');
  const referer = headerValue(request?.headers, 'referer');
  if (capability) headers[UI_CAPABILITY_HEADER] = capability;
  if (contentType) headers['content-type'] = contentType;
  if (referer) headers.referer = referer;
  return headers;
}

async function requestBody(request) {
  const method = String(request?.method || 'GET').toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return undefined;
  if (request?.body !== undefined && !request?.[Symbol.asyncIterator]) {
    const body = Buffer.isBuffer(request.body) ? request.body : Buffer.from(String(request.body));
    if (body.length > MAX_PROXY_BODY_BYTES) throw bodyTooLarge();
    return body;
  }
  if (typeof request?.[Symbol.asyncIterator] !== 'function') return undefined;
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_PROXY_BODY_BYTES) throw bodyTooLarge();
    chunks.push(buffer);
  }
  return chunks.length ? Buffer.concat(chunks) : undefined;
}

function bodyTooLarge() {
  return new AgentRuntimeError('AGENT_PROXY_BODY_TOO_LARGE', 'Agent Host 请求内容过大', 413);
}

function writeCorsPreflight(response, browserOrigin) {
  if (response.headersSent) return;
  response.statusCode = 204;
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Access-Control-Allow-Origin', browserOrigin);
  response.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, POST, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', `${UI_CAPABILITY_HEADER}, content-type`);
  response.setHeader('Access-Control-Max-Age', '60');
  response.setHeader('Vary', 'Origin');
  response.end();
}

async function writeUpstreamResponse(response, upstream, corsOrigin) {
  const body = Buffer.from(await upstream.arrayBuffer());
  if (response.headersSent) {
    response.destroy();
    return;
  }
  response.statusCode = Number(upstream.status || 502);
  for (const headerName of [
    'content-type',
    'etag',
    'allow',
    'access-control-expose-headers',
  ]) {
    const value = upstream.headers?.get?.(headerName);
    if (value) response.setHeader(headerName, value);
  }
  response.setHeader('Content-Length', body.length);
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Access-Control-Allow-Origin', corsOrigin);
  response.setHeader('Vary', 'Origin');
  response.end(body);
}

function writeJson(response, statusCode, body) {
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
  response.end(value);
}

module.exports = {
  AGENT_BRIDGE_PREFIX,
  AGENT_BRIDGE_ROOT,
  BROWSER_ORIGIN_HEADER,
  GRANT_PATH,
  HEALTH_PATH,
  HOST_TOKEN_HEADER,
  SHUTDOWN_PATH,
  SERVICE_NAME,
  createAgentRuntime,
};
