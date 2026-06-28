const http = require('http');
const fs = require('fs');
const path = require('path');
const {
  runChat,
  runChatStream,
  continueChat,
  stopChat,
  listChatSessions,
  getChatSessionStream,
  shutdownRuntime,
  sanitizeDeepSeekConfig,
  summarizeConfig,
  runtimeSummary,
} = require('../runtime/def-opencode-adapter/index.cjs');

const HOST = '127.0.0.1';
const PORT = Number(process.env.DEF_AGENT_PORT || 17322);
const projectRoot = path.resolve(__dirname, '..', '..');
const runtimeRoot = path.join(projectRoot, 'agent', 'runtime');
const defRuntimeRoot = path.join(runtimeRoot, 'def');
const configPath = path.join(projectRoot, '.runtime', 'def-agent', 'config.json');
const startedAt = Date.now();

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

    if (method === 'POST' && requestUrl.pathname === '/api/chat') {
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

    const messageMatch = /^\/api\/chat\/([^/]+)\/message$/.exec(requestUrl.pathname);
    if (method === 'POST' && messageMatch) {
      const sessionID = decodeURIComponent(messageMatch[1]);
      const body = await readJsonBody(request);
      const result = await continueChat(sessionID, body.message, body.clientTurnId);
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

    writeJson(response, 404, {
      ok: false,
      error: 'not-found',
      path: requestUrl.pathname,
    });
  } catch (error) {
    writeJson(response, 500, {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[def-agent-sidecar] listening on http://${HOST}:${PORT}`);
});

function shutdownAndExit(signal) {
  try {
    shutdownRuntime();
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
