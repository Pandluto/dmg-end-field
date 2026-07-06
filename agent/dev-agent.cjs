const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const HOST = '127.0.0.1';
const PORT = 31457;
const DEFAULT_WEB_URL = 'http://127.0.0.1:3030';
const shouldOpenWebOnBoot = process.argv.includes('--open-web');

let shellProcess = null;
let shellStartedAt = null;
let aiCliRestProcess = null;
let aiCliRestStartedAt = null;
let defAgentProcess = null;
let defAgentStartedAt = null;
let webOpenedAt = null;

function buildJsonHeaders() {
  return {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function writeJson(response, statusCode, payload) {
  response.writeHead(statusCode, buildJsonHeaders());
  response.end(JSON.stringify(payload));
}

function getUserDataRoot() {
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'dmg-end-field');
  }
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'dmg-end-field');
  }
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'dmg-end-field');
}

function readJsonFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

function getActiveImageReleaseRoot() {
  const releaseRoot = path.join(getUserDataRoot(), 'asset-releases');
  const current = readJsonFile(path.join(releaseRoot, 'current.json'));
  const version = typeof current?.assetVersion === 'string' ? current.assetVersion.trim() : '';
  if (!version || /[<>:"/\\|?*\x00-\x1F]/.test(version)) {
    return null;
  }
  const root = path.join(releaseRoot, 'versions', version);
  return fs.existsSync(root) ? root : null;
}

function decodeRequestPath(pathname, prefix) {
  const raw = String(pathname || '').replace(prefix, '');
  try {
    return decodeURIComponent(raw).replace(/\\/g, '/').replace(/^\/+/, '');
  } catch {
    return '';
  }
}

function isSafeImageRelPath(relPath) {
  return Boolean(relPath) &&
    !/(^|\/)\.\.(\/|$)/.test(relPath) &&
    /\.(png|jpg|jpeg|webp|gif|svg|ico)$/i.test(relPath);
}

function getImageContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
  }[ext] || 'application/octet-stream';
}

function trySendImageFile(response, method, filePath) {
  if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    return false;
  }
  const data = fs.readFileSync(filePath);
  response.writeHead(200, {
    'Content-Type': getImageContentType(filePath),
    'Content-Length': data.length,
    'Cache-Control': 'no-store, max-age=0',
    'Access-Control-Allow-Origin': '*',
  });
  response.end(method === 'HEAD' ? '' : data);
  return true;
}

function getImageRoots() {
  const projectRoot = path.resolve(__dirname, '..');
  const activeReleaseRoot = getActiveImageReleaseRoot();
  return [
    activeReleaseRoot,
    path.join(projectRoot, '.runtime-assets'),
    path.join(projectRoot, 'public'),
    path.join(projectRoot, 'data'),
  ].filter((root) => root && fs.existsSync(root));
}

// --- Image file-name cache (mapping bridge) ---

let imageFileCache = null;

function buildImageFileCache() {
  const roots = getImageRoots();
  const byFileName = new Map();

  function walk(baseDir, relativeDir) {
    const dirPath = relativeDir ? path.join(baseDir, relativeDir) : baseDir;
    let entries;
    try {
      entries = fs.readdirSync(dirPath, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        walk(baseDir, relativeDir ? `${relativeDir}/${entry.name}` : entry.name);
      } else if (entry.isFile() && /\.(png|jpg|jpeg|webp|gif|svg|ico)$/i.test(entry.name)) {
        const lower = entry.name.toLowerCase();
        const fullPath = path.join(dirPath, entry.name);
        if (!byFileName.has(lower)) {
          byFileName.set(lower, []);
        }
        byFileName.get(lower).push(fullPath);
      }
    }
  }

  for (const root of roots) {
    walk(root, '');
  }

  imageFileCache = { byFileName, builtAt: Date.now() };
  return imageFileCache;
}

function getImageFileCache() {
  if (!imageFileCache) {
    return buildImageFileCache();
  }
  return imageFileCache;
}

function resolveImageByFileName(requestPath) {
  const cache = getImageFileCache();
  const decoded = decodeURIComponent(requestPath).replace(/\\/g, '/').replace(/^\/+/, '');
  const fileName = path.posix.basename(decoded);
  if (!fileName) return null;

  const requestedExt = path.extname(fileName).toLowerCase();
  const fileBase = fileName.slice(0, fileName.length - requestedExt.length);

  const extensionOrder = [requestedExt, '.png', '.webp', '.jpg', '.jpeg', '.gif', '.svg']
    .filter((ext, index, list) => list.indexOf(ext) === index);

  for (const ext of extensionOrder) {
    const key = `${fileBase}${ext}`.toLowerCase();
    const paths = cache.byFileName.get(key);
    if (paths) {
      for (const filePath of paths) {
        if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
          return filePath;
        }
      }
    }
  }
  return null;
}

function tryServeAssetImage(requestUrl, response, method) {
  const relPath = decodeRequestPath(requestUrl.pathname, /^\/assets\/?/);
  if (!isSafeImageRelPath(relPath)) return false;

  const candidates = [];
  for (const root of getImageRoots()) {
    candidates.push(path.join(root, relPath));
    candidates.push(path.join(root, 'assets', relPath));
    if (relPath.startsWith('images/')) {
      candidates.push(path.join(root, relPath.slice('images/'.length)));
    } else {
      candidates.push(path.join(root, 'images', relPath));
    }
    const legacyAvatarMatch = /^avatars\/([^/]+)\/([^/]+)$/u.exec(relPath);
    if (legacyAvatarMatch) {
      const [, characterName, fileName] = legacyAvatarMatch;
      candidates.push(path.join(root, 'images', 'img-operator', fileName));
      candidates.push(path.join(root, 'images', 'img-operator', 'skiil-icon', characterName, fileName));
    }
  }

  if (candidates.some((candidate) => trySendImageFile(response, method, candidate))) {
    return true;
  }
  // Fallback: filename-based cache lookup (mapping bridge)
  const cachePath = resolveImageByFileName(relPath);
  return cachePath ? trySendImageFile(response, method, cachePath) : false;
}

function tryServeUserImage(requestUrl, response, method) {
  const relPath = decodeRequestPath(requestUrl.pathname, /^\/user-images\/?/);
  if (!isSafeImageRelPath(relPath)) return false;

  const projectRoot = path.resolve(__dirname, '..');
  const activeReleaseRoot = getActiveImageReleaseRoot();
  const roots = [
    activeReleaseRoot ? path.join(activeReleaseRoot, 'images') : null,
    path.join(projectRoot, 'data', 'images'),
    path.join(projectRoot, '.runtime-assets', 'images'),
  ].filter((root) => root && fs.existsSync(root));
  const candidates = roots.flatMap((root) => [
    path.join(root, relPath),
    path.join(root, path.posix.basename(relPath)),
  ]);

  if (candidates.some((candidate) => trySendImageFile(response, method, candidate))) {
    return true;
  }
  // Fallback: filename-based cache lookup (mapping bridge)
  const cachePath = resolveImageByFileName(relPath);
  return cachePath ? trySendImageFile(response, method, cachePath) : false;
}

function tryServeGenericImageFallback(requestUrl, response, method) {
  if (!/\.(png|jpg|jpeg|webp|gif|svg|ico)$/i.test(requestUrl.pathname || '')) {
    return false;
  }
  const imagePath = String(requestUrl.pathname || '').replace(/^\/+/, '');
  if (!imagePath || /(^|\/)\.\.(\/|$)/.test(imagePath) || imagePath.includes('\\')) {
    return false;
  }
  const cachePath = resolveImageByFileName(imagePath);
  return cachePath ? trySendImageFile(response, method, cachePath) : false;
}

function isShellRunning() {
  return Boolean(shellProcess && !shellProcess.killed);
}

function isAiCliRestRunning() {
  return Boolean(aiCliRestProcess && aiCliRestProcess.exitCode === null && !aiCliRestProcess.killed);
}

function isDefAgentRunning() {
  return Boolean(defAgentProcess && defAgentProcess.exitCode === null && !defAgentProcess.killed);
}

function getShellRuntimeInfo() {
  return {
    running: isShellRunning(),
    pid: shellProcess?.pid ?? null,
    startedAt: shellStartedAt,
  };
}

function getAiCliRestRuntimeInfo() {
  return {
    running: isAiCliRestRunning(),
    pid: aiCliRestProcess?.pid ?? null,
    startedAt: aiCliRestStartedAt,
    url: 'http://127.0.0.1:17321',
  };
}

function getDefAgentRuntimeInfo() {
  return {
    running: isDefAgentRunning(),
    pid: defAgentProcess?.pid ?? null,
    startedAt: defAgentStartedAt,
    url: 'http://127.0.0.1:17322',
  };
}

function getWebRuntimeInfo() {
  return {
    url: DEFAULT_WEB_URL,
    openedAt: webOpenedAt,
  };
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf-8').trim();
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(error);
      }
    });
    request.on('error', reject);
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fetchJsonUrl(url) {
  return new Promise((resolve, reject) => {
    const request = http.get(url, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        try {
          resolve({
            status: response.statusCode,
            body: JSON.parse(Buffer.concat(chunks).toString('utf-8') || '{}'),
          });
        } catch (error) {
          reject(error);
        }
      });
    });
    request.on('error', reject);
    request.setTimeout(1000, () => {
      request.destroy(new Error('request timeout'));
    });
  });
}

async function waitForAiCliRestHealth(expectedPid, timeoutMs = 15000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const health = await fetchJsonUrl('http://127.0.0.1:17321/health');
      if (health.status === 200 && health.body?.ok === true && health.body?.pid === expectedPid) {
        return health.body;
      }
    } catch {
      // Keep polling until the process has finished Vite SSR startup.
    }
    await delay(250);
  }
  throw new Error(`AI CLI REST health check timed out for pid ${expectedPid}`);
}

async function waitForDefAgentHealth(expectedPid, timeoutMs = 15000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const health = await fetchJsonUrl('http://127.0.0.1:17322/health');
      if (health.status === 200 && health.body?.ok === true && health.body?.pid === expectedPid) {
        return health.body;
      }
    } catch {
      // Keep polling until the sidecar starts listening.
    }
    await delay(250);
  }
  throw new Error(`DEF agent health check timed out for pid ${expectedPid}`);
}

function postJsonUrl(url, payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload || {});
    const requestUrl = new URL(url);
    const request = http.request({
      hostname: requestUrl.hostname,
      port: requestUrl.port,
      path: `${requestUrl.pathname}${requestUrl.search}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        try {
          resolve({
            status: response.statusCode,
            body: JSON.parse(Buffer.concat(chunks).toString('utf-8') || '{}'),
          });
        } catch (error) {
          reject(error);
        }
      });
    });
    request.on('error', reject);
    request.setTimeout(30000, () => {
      request.destroy(new Error('request timeout'));
    });
    request.write(body);
    request.end();
  });
}

function proxySseUrl(url, clientRequest, clientResponse) {
  const requestUrl = new URL(url);
  const upstream = http.request({
    hostname: requestUrl.hostname,
    port: requestUrl.port,
    path: `${requestUrl.pathname}${requestUrl.search}`,
    method: 'GET',
    headers: { Accept: 'text/event-stream' },
  }, (upstreamResponse) => {
    clientResponse.writeHead(upstreamResponse.statusCode || 502, {
      'Content-Type': upstreamResponse.headers['content-type'] || 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });
    upstreamResponse.pipe(clientResponse);
  });
  upstream.on('error', (error) => {
    if (!clientResponse.headersSent) {
      writeJson(clientResponse, 502, { ok: false, error: error instanceof Error ? error.message : String(error) });
    } else {
      clientResponse.end();
    }
  });
  clientRequest.on('close', () => upstream.destroy());
  upstream.end();
}

function waitForProcessExit(child, timeoutMs = 5000) {
  return new Promise((resolve) => {
    if (!child || child.exitCode !== null) {
      resolve({ exited: true });
      return;
    }
    const timer = setTimeout(() => {
      cleanup();
      resolve({ exited: false, reason: 'timeout' });
    }, timeoutMs);
    const cleanup = () => {
      clearTimeout(timer);
      child.off('exit', onExit);
    };
    const onExit = (code, signal) => {
      cleanup();
      resolve({ exited: true, code, signal });
    };
    child.once('exit', onExit);
  });
}

function killProcessTree(pid) {
  if (!pid) return false;
  try {
    if (process.platform === 'win32') {
      const result = spawnSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      });
      return result.status === 0;
    }
    process.kill(pid, 'SIGTERM');
    return true;
  } catch {
    return false;
  }
}

function openBrowserWeb(url = DEFAULT_WEB_URL) {
  spawn('cmd', ['/c', 'start', '', url], {
    cwd: path.resolve(__dirname, '..'),
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  }).unref();
  webOpenedAt = Date.now();

  return {
    opened: true,
    url,
    openedAt: webOpenedAt,
  };
}

function startShell() {
  if (isShellRunning()) {
    return {
      started: false,
      reason: 'already-running',
      ...getShellRuntimeInfo(),
    };
  }

  const electronBinary = require('electron');
  const projectRoot = path.resolve(__dirname, '..');

  shellProcess = spawn(electronBinary, ['.', '--dev', '--shell-only'], {
    cwd: projectRoot,
    stdio: 'ignore',
    detached: false,
    windowsHide: false,
  });
  shellStartedAt = Date.now();

  shellProcess.once('exit', () => {
    shellProcess = null;
    shellStartedAt = null;
  });

  return {
    started: true,
    reason: 'launched',
    ...getShellRuntimeInfo(),
  };
}

function stopShell() {
  if (!isShellRunning()) {
    return {
      stopped: false,
      reason: 'not-running',
      ...getShellRuntimeInfo(),
    };
  }

  killProcessTree(shellProcess.pid);
  return {
    stopped: true,
    reason: 'terminated',
    running: false,
    pid: null,
    startedAt: null,
  };
}

async function startAiCliRest() {
  if (isAiCliRestRunning()) {
    return {
      started: false,
      reason: 'already-running',
      ...getAiCliRestRuntimeInfo(),
    };
  }

  const projectRoot = path.resolve(__dirname, '..');
  aiCliRestProcess = spawn(process.execPath, ['scripts/ai-cli-rest-server.mjs'], {
    cwd: projectRoot,
    env: {
      ...process.env,
      AI_CLI_REST_PORT: '17321',
    },
    stdio: 'ignore',
    detached: false,
    windowsHide: true,
  });
  aiCliRestStartedAt = Date.now();

  aiCliRestProcess.once('exit', () => {
    aiCliRestProcess = null;
    aiCliRestStartedAt = null;
  });

  let health = null;
  try {
    health = await waitForAiCliRestHealth(aiCliRestProcess.pid);
  } catch (error) {
    return {
      started: true,
      ready: false,
      reason: 'launched-health-timeout',
      error: error instanceof Error ? error.message : String(error),
      ...getAiCliRestRuntimeInfo(),
    };
  }

  return {
    started: true,
    ready: true,
    reason: 'launched',
    health,
    ...getAiCliRestRuntimeInfo(),
  };
}

async function stopAiCliRest() {
  if (!isAiCliRestRunning()) {
    return {
      stopped: false,
      reason: 'not-running',
      ...getAiCliRestRuntimeInfo(),
    };
  }

  const stoppingProcess = aiCliRestProcess;
  killProcessTree(stoppingProcess.pid);
  const exit = await waitForProcessExit(stoppingProcess);
  if (!exit.exited) {
    return {
      stopped: false,
      reason: 'exit-timeout',
      running: Boolean(stoppingProcess.exitCode === null),
      pid: stoppingProcess.pid ?? null,
      startedAt: aiCliRestStartedAt,
      url: 'http://127.0.0.1:17321',
    };
  }
  return {
    stopped: true,
    reason: 'terminated',
    running: false,
    pid: null,
    startedAt: null,
    url: 'http://127.0.0.1:17321',
  };
}

async function startDefAgent() {
  if (isDefAgentRunning()) {
    return {
      started: false,
      reason: 'already-running',
      ...getDefAgentRuntimeInfo(),
    };
  }

  const projectRoot = path.resolve(__dirname, '..');
  defAgentProcess = spawn(process.execPath, ['agent/server/def-agent-server.cjs'], {
    cwd: projectRoot,
    env: {
      ...process.env,
      DEF_AGENT_PORT: '17322',
      DEF_OPENCODE_HOME: path.join(projectRoot, '.runtime', 'def-opencode'),
    },
    stdio: 'ignore',
    detached: false,
    windowsHide: true,
  });
  defAgentStartedAt = Date.now();

  defAgentProcess.once('exit', () => {
    defAgentProcess = null;
    defAgentStartedAt = null;
  });

  let health = null;
  try {
    health = await waitForDefAgentHealth(defAgentProcess.pid);
  } catch (error) {
    return {
      started: true,
      ready: false,
      reason: 'launched-health-timeout',
      error: error instanceof Error ? error.message : String(error),
      ...getDefAgentRuntimeInfo(),
    };
  }

  return {
    started: true,
    ready: true,
    reason: 'launched',
    health,
    ...getDefAgentRuntimeInfo(),
  };
}

async function stopDefAgent() {
  if (!isDefAgentRunning()) {
    return {
      stopped: false,
      reason: 'not-running',
      ...getDefAgentRuntimeInfo(),
    };
  }

  const stoppingProcess = defAgentProcess;
  killProcessTree(stoppingProcess.pid);
  const exit = await waitForProcessExit(stoppingProcess);
  if (!exit.exited) {
    return {
      stopped: false,
      reason: 'exit-timeout',
      running: Boolean(stoppingProcess.exitCode === null),
      pid: stoppingProcess.pid ?? null,
      startedAt: defAgentStartedAt,
      url: 'http://127.0.0.1:17322',
    };
  }
  return {
    stopped: true,
    reason: 'terminated',
    running: false,
    pid: null,
    startedAt: null,
    url: 'http://127.0.0.1:17322',
  };
}

const server = http.createServer(async (request, response) => {
  const method = request.method || 'GET';
  const requestUrl = new URL(request.url || '/', `http://${HOST}:${PORT}`);

  try {
    if (method === 'OPTIONS') {
      response.writeHead(204, buildJsonHeaders());
      response.end();
      return;
    }

    if (method === 'GET' && requestUrl.pathname === '/health') {
      writeJson(response, 200, {
        ok: true,
        service: 'def-local-agent',
        host: HOST,
        port: PORT,
        shell: getShellRuntimeInfo(),
        aiCliRest: getAiCliRestRuntimeInfo(),
        web: getWebRuntimeInfo(),
        defAgent: getDefAgentRuntimeInfo(),
      });
      return;
    }

  if (method === 'POST' && requestUrl.pathname === '/open-shell') {
    writeJson(response, 200, {
      ok: true,
      shell: startShell(),
    });
    return;
  }

  if (method === 'POST' && requestUrl.pathname === '/close-shell') {
    writeJson(response, 200, {
      ok: true,
      shell: stopShell(),
    });
    return;
  }

  if (method === 'POST' && requestUrl.pathname === '/open-ai-cli-rest') {
    writeJson(response, 200, {
      ok: true,
      aiCliRest: await startAiCliRest(),
    });
    return;
  }

  if (method === 'POST' && requestUrl.pathname === '/close-ai-cli-rest') {
    writeJson(response, 200, {
      ok: true,
      aiCliRest: await stopAiCliRest(),
    });
    return;
  }

  if (method === 'POST' && requestUrl.pathname === '/open-def-agent') {
    writeJson(response, 200, {
      ok: true,
      defAgent: await startDefAgent(),
    });
    return;
  }

  if (method === 'POST' && requestUrl.pathname === '/close-def-agent') {
    writeJson(response, 200, {
      ok: true,
      defAgent: await stopDefAgent(),
    });
    return;
  }

  if (method === 'POST' && requestUrl.pathname === '/def-agent/deepseek-config') {
    const defAgent = await startDefAgent();
    const body = await readJsonBody(request);
    const upstream = await postJsonUrl('http://127.0.0.1:17322/api/config/deepseek', body);
    writeJson(response, upstream.status || 500, {
      ok: upstream.status >= 200 && upstream.status < 300,
      defAgent,
      ...upstream.body,
    });
    return;
  }

  if (method === 'POST' && requestUrl.pathname === '/def-agent/chat') {
    const defAgent = await startDefAgent();
    const body = await readJsonBody(request);
    const upstream = await postJsonUrl('http://127.0.0.1:17322/api/chat', body);
    writeJson(response, upstream.status || 500, {
      ok: upstream.status >= 200 && upstream.status < 300,
      defAgent,
      ...upstream.body,
    });
    return;
  }

  if (method === 'POST' && requestUrl.pathname === '/def-agent/chat/stream') {
    const defAgent = await startDefAgent();
    const body = await readJsonBody(request);
    const upstream = await postJsonUrl('http://127.0.0.1:17322/api/chat/stream', body);
    writeJson(response, upstream.status || 500, {
      ok: upstream.status >= 200 && upstream.status < 300,
      defAgent,
      ...upstream.body,
    });
    return;
  }

  if (method === 'GET' && requestUrl.pathname === '/def-agent/chat/sessions') {
    await startDefAgent();
    const upstream = await fetchJsonUrl('http://127.0.0.1:17322/api/chat/sessions');
    writeJson(response, upstream.status || 500, upstream.body);
    return;
  }

  if (method === 'GET' && requestUrl.pathname === '/def-agent/chat/persisted-sessions') {
    await startDefAgent();
    const limit = requestUrl.searchParams.get('limit');
    const suffix = limit ? `?limit=${encodeURIComponent(limit)}` : '';
    const upstream = await fetchJsonUrl(`http://127.0.0.1:17322/api/chat/persisted-sessions${suffix}`);
    writeJson(response, upstream.status || 500, upstream.body);
    return;
  }

  const defAgentEventsMatch = /^\/def-agent\/chat\/([^/]+)\/events$/.exec(requestUrl.pathname);
  if (method === 'GET' && defAgentEventsMatch) {
    await startDefAgent();
    const sessionID = encodeURIComponent(decodeURIComponent(defAgentEventsMatch[1]));
    const from = requestUrl.searchParams.get('from');
    const suffix = from ? `?from=${encodeURIComponent(from)}` : '';
    proxySseUrl(`http://127.0.0.1:17322/api/chat/${sessionID}/events${suffix}`, request, response);
    return;
  }

  const defAgentPersistedMatch = /^\/def-agent\/chat\/([^/]+)\/persisted$/.exec(requestUrl.pathname);
  if (method === 'GET' && defAgentPersistedMatch) {
    await startDefAgent();
    const sessionID = encodeURIComponent(decodeURIComponent(defAgentPersistedMatch[1]));
    const upstream = await fetchJsonUrl(`http://127.0.0.1:17322/api/chat/${sessionID}/persisted`);
    writeJson(response, upstream.status || 500, upstream.body);
    return;
  }

  const defAgentTranscriptMatch = /^\/def-agent\/chat\/([^/]+)\/transcript$/.exec(requestUrl.pathname);
  if (method === 'GET' && defAgentTranscriptMatch) {
    await startDefAgent();
    const sessionID = encodeURIComponent(decodeURIComponent(defAgentTranscriptMatch[1]));
    const upstream = await fetchJsonUrl(`http://127.0.0.1:17322/api/chat/${sessionID}/transcript`);
    writeJson(response, upstream.status || 500, upstream.body);
    return;
  }

  const defAgentMessageMatch = /^\/def-agent\/chat\/([^/]+)\/message$/.exec(requestUrl.pathname);
  if (method === 'POST' && defAgentMessageMatch) {
    const defAgent = await startDefAgent();
    const body = await readJsonBody(request);
    const sessionID = encodeURIComponent(decodeURIComponent(defAgentMessageMatch[1]));
    const upstream = await postJsonUrl(`http://127.0.0.1:17322/api/chat/${sessionID}/message`, body);
    writeJson(response, upstream.status || 500, {
      ok: upstream.status >= 200 && upstream.status < 300,
      defAgent,
      ...upstream.body,
    });
    return;
  }

  const defAgentStopMatch = /^\/def-agent\/chat\/([^/]+)\/stop$/.exec(requestUrl.pathname);
  if (method === 'POST' && defAgentStopMatch) {
    const defAgent = await startDefAgent();
    const sessionID = encodeURIComponent(decodeURIComponent(defAgentStopMatch[1]));
    const upstream = await postJsonUrl(`http://127.0.0.1:17322/api/chat/${sessionID}/stop`, {});
    writeJson(response, upstream.status || 500, {
      ok: upstream.status >= 200 && upstream.status < 300,
      defAgent,
      ...upstream.body,
    });
    return;
  }

  if (method === 'POST' && requestUrl.pathname === '/def-agent/chat/stop') {
    const defAgent = await startDefAgent();
    const upstream = await postJsonUrl('http://127.0.0.1:17322/api/chat/stop', {});
    writeJson(response, upstream.status || 500, {
      ok: upstream.status >= 200 && upstream.status < 300,
      defAgent,
      ...upstream.body,
    });
    return;
  }

  if (method === 'POST' && requestUrl.pathname === '/open-web') {
    writeJson(response, 200, {
      ok: true,
      web: openBrowserWeb(requestUrl.searchParams.get('url') || DEFAULT_WEB_URL),
    });
    return;
  }

  if ((method === 'GET' || method === 'HEAD') && requestUrl.pathname.startsWith('/assets/')) {
    if (tryServeAssetImage(requestUrl, response, method)) {
      return;
    }
  }

  if ((method === 'GET' || method === 'HEAD') && requestUrl.pathname.startsWith('/user-images/')) {
    if (tryServeUserImage(requestUrl, response, method)) {
      return;
    }
  }

  if ((method === 'GET' || method === 'HEAD') && tryServeGenericImageFallback(requestUrl, response, method)) {
    return;
  }

    writeJson(response, 404, {
      ok: false,
      error: 'not-found',
      path: requestUrl.pathname,
    });
  } catch (error) {
    if (response.headersSent) {
      response.end();
      return;
    }
    writeJson(response, 500, {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      path: requestUrl.pathname,
    });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[def-local-agent] listening on http://${HOST}:${PORT}`);
  // Warm image file-name cache for mapping-bridge fallback
  try {
    buildImageFileCache();
    console.log(`[def-local-agent] image cache ready (${imageFileCache.byFileName.size} filenames)`);
  } catch (err) {
    console.error(`[def-local-agent] image cache build failed: ${err.message}`);
  }
  if (shouldOpenWebOnBoot) {
    const web = openBrowserWeb(DEFAULT_WEB_URL);
    console.log(`[def-local-agent] web opened at ${web.url}`);
  }
});
