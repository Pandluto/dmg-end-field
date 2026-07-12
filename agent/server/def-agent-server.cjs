const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const {
  runChat,
  runChatStream,
  continueChat,
  stopChat,
  listChatSessions,
  listPersistedDefSessions,
  getPersistedDefSession,
  hydrateDefSession,
  getChatSessionStream,
  getLiveDefTranscript,
  shutdownRuntime,
  sanitizeDeepSeekConfig,
  summarizeConfig,
  runtimeSummary,
  ensureRuntime,
  createNativeHostSession,
} = require('../runtime/def-opencode-adapter/index.cjs');

const HOST = '127.0.0.1';
const PORT = Number(process.env.DEF_AGENT_PORT || 17322);
const projectRoot = path.resolve(__dirname, '..', '..');
const runtimeRoot = path.join(projectRoot, 'agent', 'runtime');
const defRuntimeRoot = path.join(runtimeRoot, 'def');
const openCodeUiRoot = path.join(runtimeRoot, 'opencode-ui');
const configPath = path.join(projectRoot, '.runtime', 'def-agent', 'config.json');
const startedAt = Date.now();
const defRestUrl = process.env.DEF_REST_BASE_URL || 'http://127.0.0.1:17321';
let defRestProcess = null;

async function defRestReady() {
  try {
    const response = await fetch(`${defRestUrl}/health`, { signal: AbortSignal.timeout(1000) });
    return response.ok;
  } catch {
    return false;
  }
}

async function ensureDefRestService() {
  if (await defRestReady()) return { running: true, owned: false, url: defRestUrl };
  if (!defRestProcess || defRestProcess.exitCode !== null) {
    defRestProcess = spawn(process.execPath, [path.join(projectRoot, 'scripts', 'ai-cli-rest-server.mjs')], {
      cwd: projectRoot,
      env: { ...process.env, DEF_REST_BASE_URL: defRestUrl },
      stdio: ['ignore', 'ignore', 'ignore'],
      windowsHide: true,
    });
    defRestProcess.once('exit', () => { defRestProcess = null; });
  }
  for (let attempt = 0; attempt < 75; attempt += 1) {
    if (await defRestReady()) return { running: true, owned: true, url: defRestUrl };
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`DEF tool service did not become ready at ${defRestUrl}`);
}

function ensureParent(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

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

function writeSse(response, event) {
  response.write(`id: ${event.seq ?? Date.now()}\n`);
  response.write(`event: ${event.type || 'message'}\n`);
  response.write(`data: ${JSON.stringify(event)}\n\n`);
}

function writeSseHeaders(response) {
  response.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
    'Access-Control-Allow-Origin': '*',
  });
  response.write(': connected\n\n');
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

function readConfig() {
  try {
    const raw = fs.readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(raw);
    return {
      deepseek: sanitizeDeepSeekConfig(parsed.deepseek || {}),
    };
  } catch {
    return {
      deepseek: sanitizeDeepSeekConfig({}),
    };
  }
}

function writeConfig(patch) {
  const current = readConfig();
  const next = {
    ...current,
    ...patch,
    deepseek: sanitizeDeepSeekConfig({
      ...current.deepseek,
      ...(patch.deepseek || {}),
    }),
  };
  ensureParent(configPath);
  fs.writeFileSync(configPath, JSON.stringify(next, null, 2));
  return next;
}

function listSkills() {
  const skillsDir = path.join(defRuntimeRoot, 'skills');
  try {
    return fs.readdirSync(skillsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => ({
        id: entry.name,
        path: path.relative(projectRoot, path.join(skillsDir, entry.name, 'SKILL.md')).replace(/\\/g, '/'),
      }));
  } catch {
    return [];
  }
}

function healthPayload() {
  const config = readConfig();
  return {
    ok: true,
    service: 'def-agent-sidecar',
    host: HOST,
    port: PORT,
    pid: process.pid,
    startedAt,
    runtime: {
      ...runtimeSummary(config.deepseek),
      root: path.relative(projectRoot, runtimeRoot).replace(/\\/g, '/'),
    },
    skills: listSkills(),
  };
}

const staticMimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.woff2': 'font/woff2',
};

function serveOpenCodeUi(request, response, pathname) {
  if (!['GET', 'HEAD'].includes(request.method || 'GET')) return false;
  if (!fs.existsSync(path.join(openCodeUiRoot, 'index.html'))) return false;

  let requestedPath;
  try {
    requestedPath = decodeURIComponent(pathname);
  } catch {
    return false;
  }
  const relativePath = requestedPath === '/' ? 'index.html' : requestedPath.replace(/^\/+/, '');
  const resolved = path.resolve(openCodeUiRoot, relativePath);
  const insideRoot = resolved === openCodeUiRoot || resolved.startsWith(`${openCodeUiRoot}${path.sep}`);
  const hasAsset = insideRoot && fs.existsSync(resolved) && fs.statSync(resolved).isFile();
  const acceptsHtml = String(request.headers.accept || '').includes('text/html');
  if (!hasAsset && !acceptsHtml) return false;
  const assetPath = hasAsset ? resolved : path.join(openCodeUiRoot, 'index.html');
  const extension = path.extname(assetPath).toLowerCase();
  const isIndex = assetPath === path.join(openCodeUiRoot, 'index.html');
  const body = fs.readFileSync(assetPath);
  response.writeHead(200, {
    'Content-Type': staticMimeTypes[extension] || 'application/octet-stream',
    'Content-Length': body.length,
    'Cache-Control': isIndex ? 'no-store' : 'public, max-age=31536000, immutable',
    'Access-Control-Allow-Origin': '*',
  });
  response.end(request.method === 'HEAD' ? undefined : body);
  return true;
}

function proxyOpenCodeRequest(request, response) {
  const runtime = runtimeSummary(readConfig().deepseek);
  if (!runtime.running || !runtime.serverUrl) return Promise.resolve(false);
  const target = new URL(request.url || '/', runtime.serverUrl);
  return new Promise((resolve, reject) => {
    const upstream = http.request({
      hostname: target.hostname,
      port: target.port,
      path: `${target.pathname}${target.search}`,
      method: request.method,
      headers: {
        ...request.headers,
        host: target.host,
      },
    }, (upstreamResponse) => {
      response.writeHead(upstreamResponse.statusCode || 502, {
        ...upstreamResponse.headers,
        'access-control-allow-origin': '*',
      });
      upstreamResponse.pipe(response);
      upstreamResponse.on('end', () => resolve(true));
    });
    upstream.on('error', reject);
    request.pipe(upstream);
  });
}

const server = http.createServer(async (request, response) => {
  const method = request.method || 'GET';
  const requestUrl = new URL(request.url || '/', `http://${HOST}:${PORT}`);

  if (method === 'OPTIONS') {
    response.writeHead(204, buildJsonHeaders());
    response.end();
    return;
  }

  try {
    if (method === 'GET' && requestUrl.pathname === '/health') {
      writeJson(response, 200, healthPayload());
      return;
    }

    if (method === 'POST' && requestUrl.pathname === '/api/runtime/ensure') {
      const defTools = await ensureDefRestService();
      writeJson(response, 200, {
        ok: true,
        runtime: await ensureRuntime(readConfig().deepseek),
        defTools,
      });
      return;
    }

    if (method === 'POST' && requestUrl.pathname === '/api/native/session') {
      await ensureDefRestService();
      const body = await readJsonBody(request);
      const host = body.host === 'workbench' ? 'workbench' : 'ai-cli';
      const session = await createNativeHostSession({
        config: readConfig().deepseek,
        host,
        skillId: typeof body.skillId === 'string' ? body.skillId : undefined,
        thinkingEffort: body.thinkingEffort,
      });
      writeJson(response, 200, { ok: true, session });
      return;
    }

    if (method === 'GET' && requestUrl.pathname === '/api/config/deepseek') {
      writeJson(response, 200, {
        ok: true,
        deepseek: summarizeConfig(readConfig().deepseek),
      });
      return;
    }

    if (method === 'POST' && requestUrl.pathname === '/api/config/deepseek') {
      const body = await readJsonBody(request);
      const config = writeConfig({
        deepseek: {
          apiKey: body.apiKey,
          baseUrl: body.baseUrl,
          model: body.model,
        },
      });
      writeJson(response, 200, {
        ok: true,
        deepseek: summarizeConfig(config.deepseek),
      });
      return;
    }

    if (method === 'GET' && requestUrl.pathname === '/api/skills') {
      writeJson(response, 200, {
        ok: true,
        skills: listSkills(),
      });
      return;
    }

    if (method === 'GET' && requestUrl.pathname === '/api/chat/sessions') {
      writeJson(response, 200, {
        ok: true,
        sessions: listChatSessions(),
      });
      return;
    }

    if (method === 'GET' && requestUrl.pathname === '/api/chat/persisted-sessions') {
      const sessions = await listPersistedDefSessions({
        config: readConfig().deepseek,
        limit: Number(requestUrl.searchParams.get('limit') || 100) || 100,
      });
      writeJson(response, 200, {
        ok: true,
        sessions,
      });
      return;
    }

    if (method === 'POST' && requestUrl.pathname === '/api/chat') {
      await ensureDefRestService();
      const body = await readJsonBody(request);
      const result = await runChat({
        config: readConfig().deepseek,
        message: body.message,
        thinkingEffort: body.thinkingEffort,
        skillId: body.skillId,
      });
      writeJson(response, result.ok ? 200 : 502, {
        ok: result.ok,
        result,
      });
      return;
    }

    if (method === 'POST' && requestUrl.pathname === '/api/chat/stream') {
      await ensureDefRestService();
      const body = await readJsonBody(request);
      const result = await runChatStream({
        config: readConfig().deepseek,
        message: body.message,
        thinkingEffort: body.thinkingEffort,
        skillId: body.skillId,
        clientTurnId: body.clientTurnId,
      });
      writeJson(response, 200, {
        ok: true,
        sessionId: result.sessionId,
        sessionID: result.sessionID,
      });
      return;
    }

    const eventsMatch = /^\/api\/chat\/([^/]+)\/events$/.exec(requestUrl.pathname);
    if (method === 'GET' && eventsMatch) {
      const sessionID = decodeURIComponent(eventsMatch[1]);
      const stream = getChatSessionStream(sessionID);
      if (!stream) {
        writeJson(response, 404, {
          ok: false,
          error: 'session-not-found',
        });
        return;
      }
      const fromSeq = Number(requestUrl.searchParams.get('from') || 0) || 0;
      writeSseHeaders(response);
      for (const event of stream.buffer) {
        if ((event.seq || 0) > fromSeq) writeSse(response, event);
      }
      const onEvent = (event) => writeSse(response, event);
      stream.eventEmitter.on('event', onEvent);
      const heartbeat = setInterval(() => {
        response.write(`event: heartbeat\ndata: ${JSON.stringify({ ok: true, sessionId: sessionID, at: Date.now() })}\n\n`);
      }, 15000);
      request.on('close', () => {
        clearInterval(heartbeat);
        stream.eventEmitter.off('event', onEvent);
      });
      return;
    }

    const persistedMatch = /^\/api\/chat\/([^/]+)\/persisted$/.exec(requestUrl.pathname);
    if (method === 'GET' && persistedMatch) {
      const sessionID = decodeURIComponent(persistedMatch[1]);
      const persisted = await getPersistedDefSession(sessionID, { config: readConfig().deepseek });
      writeJson(response, 200, {
        ok: true,
        session: persisted.summary,
      });
      return;
    }

    const transcriptMatch = /^\/api\/chat\/([^/]+)\/transcript$/.exec(requestUrl.pathname);
    if (method === 'GET' && transcriptMatch) {
      const sessionID = decodeURIComponent(transcriptMatch[1]);
      const transcript = getLiveDefTranscript(sessionID) || await hydrateDefSession(sessionID, { config: readConfig().deepseek });
      writeJson(response, 200, {
        ok: true,
        ...transcript,
      });
      return;
    }

    const messageMatch = /^\/api\/chat\/([^/]+)\/message$/.exec(requestUrl.pathname);
    if (method === 'POST' && messageMatch) {
      await ensureDefRestService();
      const sessionID = decodeURIComponent(messageMatch[1]);
      const body = await readJsonBody(request);
      const result = await continueChat(sessionID, body.message, body.clientTurnId, {
        config: readConfig().deepseek,
        thinkingEffort: body.thinkingEffort,
        skillId: body.skillId,
      });
      writeJson(response, 200, {
        ok: true,
        sessionId: result.sessionId,
        sessionID: result.sessionID,
      });
      return;
    }

    const stopMatch = /^\/api\/chat\/([^/]+)\/stop$/.exec(requestUrl.pathname);
    if (method === 'POST' && stopMatch) {
      const sessionID = decodeURIComponent(stopMatch[1]);
      writeJson(response, 200, {
        ok: true,
        result: await stopChat(sessionID),
      });
      return;
    }

    if (method === 'POST' && requestUrl.pathname === '/api/chat/stop') {
      writeJson(response, 200, {
        ok: true,
        result: await stopChat(),
      });
      return;
    }

    if (serveOpenCodeUi(request, response, requestUrl.pathname)) return;
    if (await proxyOpenCodeRequest(request, response)) return;

    writeJson(response, 404, {
      ok: false,
      error: 'not-found',
      path: requestUrl.pathname,
    });
  } catch (error) {
    const errorCode = error && typeof error === 'object' && typeof error.code === 'string' ? error.code : undefined;
    writeJson(response, errorCode === 'DEF_SESSION_SKILL_MISMATCH' ? 409 : 500, {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      ...(errorCode ? { code: errorCode } : {}),
    });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[def-agent-sidecar] listening on http://${HOST}:${PORT}`);
});

function shutdownAndExit(signal) {
  try {
    shutdownRuntime();
    if (defRestProcess && defRestProcess.exitCode === null) defRestProcess.kill('SIGTERM');
  } finally {
    server.close(() => process.exit(signal === 'SIGINT' ? 130 : 0));
    setTimeout(() => process.exit(signal === 'SIGINT' ? 130 : 0), 1500).unref();
  }
}

process.once('SIGTERM', () => shutdownAndExit('SIGTERM'));
process.once('SIGINT', () => shutdownAndExit('SIGINT'));
process.once('exit', () => {
  shutdownRuntime();
});
