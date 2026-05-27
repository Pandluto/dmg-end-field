const http = require('http');
const path = require('path');
const { spawn } = require('child_process');

const HOST = '127.0.0.1';
const PORT = 31457;
const DEFAULT_WEB_URL = 'http://127.0.0.1:3030';
const shouldOpenWebOnBoot = process.argv.includes('--open-web');

let shellProcess = null;
let shellStartedAt = null;
let aiCliRestProcess = null;
let aiCliRestStartedAt = null;
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

function isShellRunning() {
  return Boolean(shellProcess && !shellProcess.killed);
}

function isAiCliRestRunning() {
  return Boolean(aiCliRestProcess && !aiCliRestProcess.killed);
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

function getWebRuntimeInfo() {
  return {
    url: DEFAULT_WEB_URL,
    openedAt: webOpenedAt,
  };
}

function openWeb(url = DEFAULT_WEB_URL) {
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

  shellProcess = spawn(electronBinary, ['.', '--dev'], {
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

  shellProcess.kill();
  return {
    stopped: true,
    reason: 'terminated',
    running: false,
    pid: null,
    startedAt: null,
  };
}

function startAiCliRest() {
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

  return {
    started: true,
    reason: 'launched',
    ...getAiCliRestRuntimeInfo(),
  };
}

function stopAiCliRest() {
  if (!isAiCliRestRunning()) {
    return {
      stopped: false,
      reason: 'not-running',
      ...getAiCliRestRuntimeInfo(),
    };
  }

  aiCliRestProcess.kill();
  return {
    stopped: true,
    reason: 'terminated',
    running: false,
    pid: null,
    startedAt: null,
    url: 'http://127.0.0.1:17321',
  };
}

const server = http.createServer((request, response) => {
  const method = request.method || 'GET';
  const requestUrl = new URL(request.url || '/', `http://${HOST}:${PORT}`);

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
      aiCliRest: startAiCliRest(),
    });
    return;
  }

  if (method === 'POST' && requestUrl.pathname === '/close-ai-cli-rest') {
    writeJson(response, 200, {
      ok: true,
      aiCliRest: stopAiCliRest(),
    });
    return;
  }

  if (method === 'POST' && requestUrl.pathname === '/open-web') {
    writeJson(response, 200, {
      ok: true,
      web: openWeb(requestUrl.searchParams.get('url') || DEFAULT_WEB_URL),
    });
    return;
  }

  writeJson(response, 404, {
    ok: false,
    error: 'not-found',
    path: requestUrl.pathname,
  });
});

server.listen(PORT, HOST, () => {
  console.log(`[def-local-agent] listening on http://${HOST}:${PORT}`);
  if (shouldOpenWebOnBoot) {
    const web = openWeb(DEFAULT_WEB_URL);
    console.log(`[def-local-agent] web opened at ${web.url}`);
  }
});
