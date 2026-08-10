import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

export const MOBILE_SHARE_TTL_MS = 24 * 60 * 60 * 1000;
export const MOBILE_SHARE_PER_IP_LIMIT = 3;
export const MOBILE_SHARE_HOURLY_LIMIT = 100;
export const MOBILE_SHARE_MAX_PAYLOAD_BYTES = 768 * 1024;

const SHARE_ID_PATTERN = /^[A-Za-z0-9_-]{16}$/;

export class MobileShareServiceError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'MobileShareServiceError';
    this.status = status;
    this.code = code;
  }
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function validatePayload(payload) {
  if (!isRecord(payload) || payload.schemaVersion !== 1 || !isRecord(payload.draft)) {
    throw new MobileShareServiceError(400, 'INVALID_SHARE', '分享数据格式不正确。');
  }
  const { draft } = payload;
  if (
    draft.schemaVersion !== 1
    || !Array.isArray(draft.selectedOperatorIds)
    || draft.selectedOperatorIds.length > 4
    || !Array.isArray(draft.slots)
    || draft.slots.length > 128
    || !isRecord(draft.operatorConfigs)
    || !isRecord(draft.reportNotes ?? {})
  ) {
    throw new MobileShareServiceError(400, 'INVALID_DRAFT', '工作区快照格式不正确。');
  }
  if (
    (typeof payload.dataVersion !== 'string' || payload.dataVersion.length > 80)
    || (typeof payload.imageVersion !== 'string' || payload.imageVersion.length > 80)
  ) {
    throw new MobileShareServiceError(400, 'INVALID_VERSION', '分享版本信息不正确。');
  }
  const notes = Object.values(draft.reportNotes ?? {});
  if (notes.length > 128 || notes.some((note) => typeof note !== 'string' || note.length > 160)) {
    throw new MobileShareServiceError(400, 'INVALID_NOTES', '报表批注数量或长度超出限制。');
  }
}

function createShareId() {
  return randomBytes(12).toString('base64url');
}

function openDatabase(dbPath) {
  if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true });
  const database = new DatabaseSync(dbPath);
  database.exec('PRAGMA busy_timeout = 5000');
  database.exec('PRAGMA journal_mode = WAL');
  database.exec('PRAGMA synchronous = NORMAL');
  database.exec(`
    CREATE TABLE IF NOT EXISTS mobile_share_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS mobile_shares (
      id TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      payload_bytes INTEGER NOT NULL,
      ip_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    ) STRICT;
    CREATE INDEX IF NOT EXISTS mobile_shares_ip_created
      ON mobile_shares (ip_hash, created_at);
    CREATE INDEX IF NOT EXISTS mobile_shares_expires
      ON mobile_shares (expires_at);
    CREATE TABLE IF NOT EXISTS mobile_share_creation_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ip_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL
    ) STRICT;
    CREATE INDEX IF NOT EXISTS mobile_share_events_created
      ON mobile_share_creation_events (created_at);
  `);
  return database;
}

function getOrCreateIpSalt(database) {
  const existing = database.prepare("SELECT value FROM mobile_share_meta WHERE key = 'ip_salt'").get();
  if (existing?.value) return String(existing.value);
  const salt = randomBytes(32).toString('hex');
  database.prepare("INSERT INTO mobile_share_meta (key, value) VALUES ('ip_salt', ?)").run(salt);
  return salt;
}

export function createMobileShareStore(options = {}) {
  const database = openDatabase(options.dbPath || ':memory:');
  const now = options.now || (() => Date.now());
  const ttlMs = options.ttlMs || MOBILE_SHARE_TTL_MS;
  const perIpLimit = options.perIpLimit || MOBILE_SHARE_PER_IP_LIMIT;
  const hourlyLimit = options.hourlyLimit || MOBILE_SHARE_HOURLY_LIMIT;
  const maxPayloadBytes = options.maxPayloadBytes || MOBILE_SHARE_MAX_PAYLOAD_BYTES;
  const ipSalt = getOrCreateIpSalt(database);

  const deleteExpiredShares = database.prepare('DELETE FROM mobile_shares WHERE expires_at <= ?');
  const deleteOldEvents = database.prepare('DELETE FROM mobile_share_creation_events WHERE created_at < ?');
  const countRecentEvents = database.prepare('SELECT COUNT(*) AS count FROM mobile_share_creation_events WHERE created_at >= ?');
  const findIpShares = database.prepare('SELECT id FROM mobile_shares WHERE ip_hash = ? AND expires_at > ? ORDER BY created_at ASC');
  const deleteShare = database.prepare('DELETE FROM mobile_shares WHERE id = ?');
  const insertShare = database.prepare(`
    INSERT INTO mobile_shares (id, payload, payload_bytes, ip_hash, created_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const insertEvent = database.prepare('INSERT INTO mobile_share_creation_events (ip_hash, created_at) VALUES (?, ?)');
  const findShare = database.prepare(`
    SELECT id, payload, created_at AS createdAt, expires_at AS expiresAt
    FROM mobile_shares
    WHERE id = ? AND expires_at > ?
  `);

  function hashIp(ipAddress) {
    return createHash('sha256').update(`${ipSalt}:${ipAddress}`).digest('hex');
  }

  function cleanup(timestamp = now()) {
    deleteExpiredShares.run(timestamp);
    deleteOldEvents.run(timestamp - MOBILE_SHARE_TTL_MS);
  }

  function create(payload, ipAddress) {
    validatePayload(payload);
    const serialized = JSON.stringify(payload);
    const payloadBytes = Buffer.byteLength(serialized);
    if (payloadBytes > maxPayloadBytes) {
      throw new MobileShareServiceError(413, 'PAYLOAD_TOO_LARGE', '分享内容过大，请减少排轴项目后重试。');
    }

    const timestamp = now();
    const expiresAt = timestamp + ttlMs;
    const ipHash = hashIp(ipAddress || 'unknown');
    database.exec('BEGIN IMMEDIATE');
    try {
      cleanup(timestamp);
      const hourlyCount = Number(countRecentEvents.get(timestamp - 60 * 60 * 1000)?.count || 0);
      if (hourlyCount >= hourlyLimit) {
        throw new MobileShareServiceError(429, 'HOURLY_LIMIT', '本小时分享名额已用完，请稍后再试。');
      }

      const activeShares = findIpShares.all(ipHash, timestamp);
      const removeCount = Math.max(0, activeShares.length - perIpLimit + 1);
      activeShares.slice(0, removeCount).forEach((share) => deleteShare.run(share.id));

      let id = '';
      for (let attempt = 0; attempt < 4; attempt += 1) {
        id = createShareId();
        try {
          insertShare.run(id, serialized, payloadBytes, ipHash, timestamp, expiresAt);
          break;
        } catch (error) {
          if (attempt === 3 || !String(error).includes('UNIQUE')) throw error;
          id = '';
        }
      }
      if (!id) throw new Error('Unable to allocate a share id.');
      insertEvent.run(ipHash, timestamp);
      database.exec('COMMIT');
      return { id, createdAt: timestamp, expiresAt };
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  }

  function get(id) {
    if (!SHARE_ID_PATTERN.test(id)) return null;
    const timestamp = now();
    cleanup(timestamp);
    const row = findShare.get(id, timestamp);
    if (!row) return null;
    return {
      id: String(row.id),
      createdAt: Number(row.createdAt),
      expiresAt: Number(row.expiresAt),
      payload: JSON.parse(String(row.payload)),
    };
  }

  function stats() {
    const timestamp = now();
    cleanup(timestamp);
    return {
      active: Number(database.prepare('SELECT COUNT(*) AS count FROM mobile_shares').get()?.count || 0),
      createdLastHour: Number(countRecentEvents.get(timestamp - 60 * 60 * 1000)?.count || 0),
    };
  }

  return {
    create,
    get,
    cleanup,
    stats,
    close: () => database.close(),
  };
}

function sendJson(response, status, body) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  response.end(JSON.stringify(body));
}

async function readJsonBody(request, maxBytes) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) {
      throw new MobileShareServiceError(413, 'REQUEST_TOO_LARGE', '分享内容过大。');
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new MobileShareServiceError(400, 'INVALID_JSON', '分享请求不是有效的 JSON。');
  }
}

function resolveClientIp(request, trustProxy) {
  if (trustProxy) {
    const forwarded = request.headers['x-forwarded-for'];
    const first = Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(',')[0];
    if (first?.trim()) return first.trim();
  }
  return request.socket.remoteAddress || 'unknown';
}

export function createMobileShareRequestHandler(options = {}) {
  const store = createMobileShareStore(options);
  const trustProxy = options.trustProxy !== false;
  const maxRequestBytes = (options.maxPayloadBytes || MOBILE_SHARE_MAX_PAYLOAD_BYTES) + 16 * 1024;

  const handler = async (request, response) => {
    try {
      const url = new URL(request.url || '/', 'http://127.0.0.1');
      if (request.method === 'OPTIONS' && url.pathname.startsWith('/api/mobile-shares')) {
        response.writeHead(204, { 'cache-control': 'no-store' });
        response.end();
        return;
      }
      if (request.method === 'GET' && url.pathname === '/api/mobile-shares/health') {
        sendJson(response, 200, { ok: true, ...store.stats() });
        return;
      }
      if (request.method === 'POST' && url.pathname === '/api/mobile-shares') {
        const contentType = String(request.headers['content-type'] || '').split(';')[0].trim();
        if (contentType !== 'application/json') {
          throw new MobileShareServiceError(415, 'JSON_REQUIRED', '分享接口只接受 JSON。');
        }
        const payload = await readJsonBody(request, maxRequestBytes);
        sendJson(response, 201, store.create(payload, resolveClientIp(request, trustProxy)));
        return;
      }
      const match = url.pathname.match(/^\/api\/mobile-shares\/([A-Za-z0-9_-]{16})$/);
      if (request.method === 'GET' && match) {
        const share = store.get(match[1]);
        if (!share) throw new MobileShareServiceError(404, 'SHARE_NOT_FOUND', '分享不存在或已经过期。');
        sendJson(response, 200, share);
        return;
      }
      if (url.pathname.startsWith('/api/mobile-shares')) {
        throw new MobileShareServiceError(404, 'NOT_FOUND', '分享接口不存在。');
      }
      throw new MobileShareServiceError(404, 'NOT_FOUND', '页面不存在。');
    } catch (error) {
      if (error instanceof MobileShareServiceError) {
        sendJson(response, error.status, { code: error.code, message: error.message });
      } else {
        console.error('[mobile-share]', error);
        sendJson(response, 500, { code: 'INTERNAL_ERROR', message: '分享服务暂时不可用。' });
      }
    }
  };
  handler.close = () => store.close();
  handler.cleanup = () => store.cleanup();
  return handler;
}

function isMainModule() {
  if (!process.argv[1]) return false;
  return import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
}

if (isMainModule()) {
  const host = process.env.DEF_MOBILE_SHARE_HOST || '127.0.0.1';
  const port = Number(process.env.DEF_MOBILE_SHARE_PORT || 8787);
  const dbPath = process.env.DEF_MOBILE_SHARE_DB
    || resolve(process.cwd(), 'var/mobile-shares.sqlite');
  const handler = createMobileShareRequestHandler({ dbPath, trustProxy: true });
  const server = createServer(handler);
  const cleanupTimer = setInterval(() => handler.cleanup(), 60 * 60 * 1000);
  cleanupTimer.unref();

  const close = () => {
    clearInterval(cleanupTimer);
    server.close(() => {
      handler.close();
      process.exit(0);
    });
  };
  process.once('SIGINT', close);
  process.once('SIGTERM', close);
  server.listen(port, host, () => {
    console.log(`Mobile share service listening on http://${host}:${port}`);
    console.log(`SQLite database: ${dbPath}`);
  });
}

export function getDefaultDevelopmentShareDatabasePath() {
  return resolve(tmpdir(), 'dmg-end-field-mobile-shares.sqlite');
}
