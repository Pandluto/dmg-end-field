import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createLegacyFillProposalRepository } from './proposal-repository.mjs';

const MAX_BODY_BYTES = 4 * 1024 * 1024;
const DOMAINS = ['buff', 'weapon', 'operator', 'equipment'];

function writeJson(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(body));
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      const error = new Error('Request body too large');
      error.status = 413;
      error.code = 'request-body-too-large';
      throw error;
    }
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch {
    const error = new Error('Request body must be valid JSON');
    error.status = 400;
    error.code = 'invalid-json';
    throw error;
  }
}

export function createLegacyFillService(options = {}) {
  const host = options.host || '127.0.0.1';
  const port = Number(options.port || 17323);
  const hostToken = typeof options.hostToken === 'string' ? options.hostToken.trim() : '';
  if (!hostToken) throw new TypeError('LEGACY_FILL_HOST_TOKEN is required');
  const databasePath = path.resolve(options.databasePath);
  const registryPath = options.registryPath ? path.resolve(options.registryPath) : '';
  const repository = createLegacyFillProposalRepository({ databasePath });
  const startedAt = new Date().toISOString();
  let server;
  let closing = false;

  function health() {
    const snapshots = Object.fromEntries(DOMAINS.map((domain) => [domain, repository.latestSnapshot(domain)]));
    return {
      ok: true,
      service: 'legacy-fill-service',
      protocolVersion: 1,
      pid: process.pid,
      host,
      port,
      startedAt,
      database: repository.diagnostics(),
      snapshotReady: DOMAINS.every((domain) => Boolean(snapshots[domain])),
      snapshots: Object.fromEntries(DOMAINS.map((domain) => [domain, snapshots[domain] ? {
        snapshotId: snapshots[domain].snapshotId,
        revision: snapshots[domain].revision,
        contentHash: snapshots[domain].contentHash,
        schemaVersion: snapshots[domain].schemaVersion,
      } : null])),
      mcp: { enabled: false },
    };
  }

  function authorized(request) {
    return request.headers['x-legacy-fill-host-token'] === hostToken;
  }

  function publishSnapshot(payload) {
    if (!payload || payload.contract !== 'LegacyFillSnapshotV1' || !payload.domains || typeof payload.domains !== 'object') {
      const error = new Error('Host snapshot must satisfy LegacyFillSnapshotV1');
      error.status = 400;
      error.code = 'invalid-host-snapshot';
      throw error;
    }
    const published = {};
    for (const domain of DOMAINS) {
      const incoming = payload.domains[domain];
      if (!incoming || incoming.domain !== domain || typeof incoming.contentHash !== 'string') {
        const error = new Error(`Host snapshot is missing ${domain}`);
        error.status = 400;
        error.code = 'invalid-host-snapshot-domain';
        throw error;
      }
      const latest = repository.latestSnapshot(domain);
      if (latest?.contentHash === incoming.contentHash) {
        published[domain] = latest;
        continue;
      }
      const revision = (latest?.revision || 0) + 1;
      published[domain] = repository.publishSnapshot({
        snapshotId: `${payload.snapshotId}-${domain}-r${revision}`,
        domain,
        schemaVersion: Number(incoming.schemaVersion || 1),
        revision,
        contentHash: incoming.contentHash,
        payload: { current: incoming.current ?? null, library: incoming.library ?? {} },
        createdAt: payload.publishedAt || new Date().toISOString(),
      });
    }
    return { contract: 'LegacyFillSnapshotReceiptV1', sourceSnapshotId: payload.snapshotId, domains: published };
  }

  server = http.createServer(async (request, response) => {
    const method = request.method || 'GET';
    const url = new URL(request.url || '/', `http://${host}:${port}`);
    try {
      if (method === 'GET' && url.pathname === '/health') return writeJson(response, 200, health());
      if (url.pathname.startsWith('/internal/') && !authorized(request)) {
        return writeJson(response, 403, { ok: false, error: { code: 'host-authority-required', message: 'Legacy Fill Host authority required' } });
      }
      if (method === 'POST' && url.pathname === '/internal/snapshots/publish') {
        const receipt = publishSnapshot(await readJson(request));
        return writeJson(response, 200, { ok: true, receipt });
      }
      if (method === 'GET' && url.pathname === '/internal/audit/export') {
        return writeJson(response, 200, { ok: true, audit: repository.exportAudit() });
      }
      if (method === 'POST' && url.pathname === '/internal/shutdown') {
        writeJson(response, 202, { ok: true, closing: true });
        setImmediate(() => void close());
        return;
      }
      return writeJson(response, 404, { ok: false, error: { code: 'not-found', message: `Route not found: ${url.pathname}` } });
    } catch (error) {
      return writeJson(response, error?.status || 500, { ok: false, error: {
        code: error?.code || 'legacy-fill-service-error', message: error instanceof Error ? error.message : String(error),
      } });
    }
  });

  async function listen() {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, host, () => { server.off('error', reject); resolve(); });
    });
    if (registryPath) {
      fs.mkdirSync(path.dirname(registryPath), { recursive: true });
      const tempPath = `${registryPath}.${process.pid}.tmp`;
      fs.writeFileSync(tempPath, `${JSON.stringify({
        contract: 'LegacyFillServiceRegistryV1', pid: process.pid, host, port, url: `http://${host}:${port}`,
        startedAt, databasePath,
      }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
      fs.renameSync(tempPath, registryPath);
    }
    return health();
  }

  async function close() {
    if (closing) return;
    closing = true;
    await new Promise((resolve) => server.close(() => resolve()));
    repository.close();
    if (registryPath) {
      try {
        const current = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
        if (current?.pid === process.pid) fs.rmSync(registryPath, { force: true });
      } catch { /* registry already absent */ }
    }
  }

  return Object.freeze({ listen, close, health, publishSnapshot, repository });
}
