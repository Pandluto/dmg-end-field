import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer as createViteServer } from 'vite';

const HOST = '127.0.0.1';
const PORT = Number(process.env.AI_CLI_REST_PORT || 17321);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const storageDir = path.join(projectRoot, '.runtime', 'ai-cli-rest');
const viteCacheDir = process.env.AI_CLI_REST_VITE_CACHE_DIR || path.join(projectRoot, '.runtime', 'vite-ai-cli-rest', String(process.pid));
const nowStoragePath = path.join(projectRoot, 'data', 'localdata', 'now-storage.json');
const storageMode = process.env.AI_CLI_REST_STORAGE_MODE || 'now-storage';
const serverStartedAt = new Date().toISOString();

class FileStorage {
  constructor(filePath) {
    this.filePath = filePath;
    this.data = this.read();
  }

  read() {
    try {
      if (!fs.existsSync(this.filePath)) {
        return {};
      }
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf-8'));
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  flush() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf-8');
  }

  getItem(key) {
    return Object.prototype.hasOwnProperty.call(this.data, key) ? String(this.data[key]) : null;
  }

  setItem(key, value) {
    this.data[key] = String(value);
    this.flush();
  }

  removeItem(key) {
    delete this.data[key];
    this.flush();
  }

  clear() {
    this.data = {};
    this.flush();
  }
}

class NowStorageLocalStorage {
  constructor(filePath, fallbackFilePath) {
    this.filePath = filePath;
    this.fallback = new FileStorage(fallbackFilePath);
    this.archive = this.readArchive();
  }

  readArchive() {
    try {
      if (!fs.existsSync(this.filePath)) {
        return null;
      }
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf-8'));
      if (!parsed || parsed.type !== 'def.localdata.archive.v1' || !parsed.storage) {
        return null;
      }
      parsed.storage.local = parsed.storage.local && typeof parsed.storage.local === 'object'
        ? parsed.storage.local
        : {};
      parsed.storage.session = parsed.storage.session && typeof parsed.storage.session === 'object'
        ? parsed.storage.session
        : {};
      return parsed;
    } catch {
      return null;
    }
  }

  ensureArchive() {
    if (this.archive) {
      return this.archive;
    }
    this.archive = {
      type: 'def.localdata.archive.v1',
      schemaVersion: 1,
      id: 'now-storage',
      name: 'now-storage',
      createdAt: new Date().toISOString(),
      exportedAt: new Date().toISOString(),
      sections: ['all'],
      storage: {
        local: {},
        session: {},
      },
    };
    return this.archive;
  }

  flush() {
    const archive = this.ensureArchive();
    archive.exportedAt = new Date().toISOString();
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, `${JSON.stringify(archive, null, 2)}\n`, 'utf-8');
  }

  get local() {
    return this.archive?.storage?.local || {};
  }

  refresh() {
    const nextArchive = this.readArchive();
    if (nextArchive) {
      this.archive = nextArchive;
    }
  }

  getItem(key) {
    this.refresh();
    if (!this.archive) {
      return this.fallback.getItem(key);
    }
    if (!Object.prototype.hasOwnProperty.call(this.local, key)) {
      return null;
    }
    const value = this.local[key];
    return typeof value === 'string' ? value : JSON.stringify(value);
  }

  setItem(key, value) {
    this.refresh();
    const archive = this.ensureArchive();
    try {
      archive.storage.local[key] = JSON.parse(String(value));
    } catch {
      archive.storage.local[key] = String(value);
    }
    this.fallback.setItem(key, value);
    this.flush();
  }

  removeItem(key) {
    if (!this.archive) {
      this.fallback.removeItem(key);
      return;
    }
    delete this.archive.storage.local[key];
    this.fallback.removeItem(key);
    this.flush();
  }

  clear() {
    const archive = this.ensureArchive();
    archive.storage.local = {};
    this.fallback.clear();
    this.flush();
  }
}

function installNodeWindowStorage() {
  const localStorage = storageMode === 'runtime'
    ? new FileStorage(path.join(storageDir, 'localStorage.json'))
    : new NowStorageLocalStorage(nowStoragePath, path.join(storageDir, 'localStorage.json'));
  const sessionStorage = new FileStorage(path.join(storageDir, 'sessionStorage.json'));
  globalThis.window = {
    localStorage,
    sessionStorage,
  };
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

async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf-8').trim();
  if (!raw) {
    return undefined;
  }
  return JSON.parse(raw);
}

installNodeWindowStorage();

const vite = await createViteServer({
  configFile: path.join(projectRoot, 'vite.config.ts'),
  cacheDir: viteCacheDir,
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'error',
});

vite.moduleGraph?.invalidateAll?.();

const { handleAiCliRestRequest, getAiCliRestDiagnostics } = await vite.ssrLoadModule('/src/aiCli/aiCliRestAdapter.ts');
const { readCurrentBuffDraft } = await vite.ssrLoadModule('/src/aiCli/buffFillAdapter.ts');
const { readAgentRecordSnapshot } = await vite.ssrLoadModule('/src/aiCli/aiCliAgentInfrastructure.ts');
const startupDiagnostics = getAiCliRestDiagnostics();

const sseClients = new Set();

function writeSse(response, eventName, payload) {
  try {
    response.write(`event: ${eventName}\n`);
    response.write(`data: ${JSON.stringify(payload)}\n\n`);
    return true;
  } catch {
    return false;
  }
}

function broadcastAgentRecords() {
  const payload = {
    ok: true,
    protocolVersion: 1,
    ...readAgentRecordSnapshot(),
  };
  for (const client of sseClients) {
    if (!writeSse(client, 'agent.records', payload)) {
      sseClients.delete(client);
    }
  }
}

const heartbeatTimer = setInterval(() => {
  for (const client of sseClients) {
    if (!writeSse(client, 'heartbeat', { ok: true, now: Date.now() })) {
      sseClients.delete(client);
    }
  }
}, 15000);

const server = http.createServer(async (request, response) => {
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
      service: 'def-ai-cli-rest',
      host: HOST,
      port: PORT,
      storageDir,
      storageMode: storageMode === 'runtime' ? 'runtime' : 'now-storage',
      nowStoragePath,
      pid: process.pid,
      startedAt: serverStartedAt,
      projectRoot,
      viteCacheDir,
      diagnostics: startupDiagnostics,
    });
    return;
  }

  if (method === 'GET' && requestUrl.pathname === '/api/agent/events') {
    response.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });
    response.write(': connected\n\n');
    sseClients.add(response);
    writeSse(response, 'agent.records', {
      ok: true,
      protocolVersion: 1,
      ...readAgentRecordSnapshot(),
    });
    request.on('close', () => {
      sseClients.delete(response);
    });
    return;
  }

  try {
    const body = method === 'POST' ? await readJsonBody(request) : undefined;
    const restResponse = handleAiCliRestRequest({
      method,
      path: requestUrl.pathname,
      body,
      client: requestUrl.searchParams.get('client') || 'rest',
      query: Object.fromEntries(requestUrl.searchParams.entries()),
    }, readCurrentBuffDraft(), {
      sourceText: '',
    });
    writeJson(response, restResponse.status, restResponse.body);
    if (requestUrl.pathname !== '/api/agent/records' && requestUrl.pathname !== '/api/agent/logs' && requestUrl.pathname !== '/api/agent/sessions') {
      broadcastAgentRecords();
    }
  } catch (error) {
    writeJson(response, 500, {
      ok: false,
      error: {
        code: 'internal-error',
        message: error instanceof Error ? error.message : String(error),
      },
    });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[def-ai-cli-rest] listening on http://${HOST}:${PORT} pid=${process.pid} startedAt=${serverStartedAt} weaponFill=${startupDiagnostics.weaponFill.contractVersion}`);
});

const close = async () => {
  clearInterval(heartbeatTimer);
  for (const client of sseClients) {
    client.end();
  }
  sseClients.clear();
  await new Promise((resolve) => {
    server.close(() => resolve());
  });
  await vite.close();
  if (!process.env.AI_CLI_REST_KEEP_VITE_CACHE) {
    fs.rmSync(viteCacheDir, { recursive: true, force: true });
  }
};

process.once('SIGINT', () => {
  void close().finally(() => process.exit(0));
});

process.once('SIGTERM', () => {
  void close().finally(() => process.exit(0));
});
