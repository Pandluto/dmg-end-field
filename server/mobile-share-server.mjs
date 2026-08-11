import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

export const MOBILE_SHARE_RATE_WINDOW_MS = 24 * 60 * 60 * 1000;
export const MOBILE_SHARE_PER_DEVICE_DAILY_LIMIT = 3;
export const MOBILE_SHARE_PER_IP_DAILY_LIMIT = 10;
export const MOBILE_SHARE_DAILY_LIMIT = 100;
export const MOBILE_SHARE_MAX_PAYLOAD_BYTES = 8 * 1024 * 1024;
export const MOBILE_SHARE_DEVICE_COOKIE = 'dmg_share_device';
export const MOBILE_SHARE_DEVICE_COOKIE_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;

const DEFAULT_ALLOWED_ORIGINS = [
  'https://dmgendfield.online',
  'https://150.158.133.176',
  'http://150.158.133.176',
  'http://127.0.0.1:3030',
  'http://localhost:3030',
];

const SHARE_ID_PATTERN = /^[A-Za-z0-9_-]{16}$/;
const DEVICE_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;
const DEVICE_SIGNATURE_PATTERN = /^[A-Za-z0-9_-]{43}$/;

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

function validateMobileDraft(draft) {
  if (
    !isRecord(draft)
    ||
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
  const notes = Object.values(draft.reportNotes ?? {});
  if (notes.length > 128 || notes.some((note) => typeof note !== 'string' || note.length > 160)) {
    throw new MobileShareServiceError(400, 'INVALID_NOTES', '报表批注数量或长度超出限制。');
  }
}

function validateTimelinePayload(payload, index) {
  if (
    !isRecord(payload)
    || !Array.isArray(payload.selectedCharacters)
    || payload.selectedCharacters.length > 4
    || !isRecord(payload.timelineData)
    || !Array.isArray(payload.timelineData.staffLines)
    || payload.timelineData.staffLines.length > 4
    || !isRecord(payload.skillButtonTable)
    || !Array.isArray(payload.allBuffList)
    || payload.allBuffList.length > 2048
    || !Array.isArray(payload.anomalyStateSnapshots ?? [])
  ) {
    throw new MobileShareServiceError(
      400,
      'INVALID_TIMELINE_PAYLOAD',
      `桌面工作树的第 ${index + 1} 份恢复数据格式不正确。`,
    );
  }
  const buttonCount = Object.keys(payload.skillButtonTable).length;
  const timelineButtonCount = payload.timelineData.staffLines.reduce((count, line) => (
    count + (Array.isArray(line?.buttons) ? line.buttons.length : 0)
  ), 0);
  if (buttonCount > 2048 || timelineButtonCount > 2048) {
    throw new MobileShareServiceError(400, 'TIMELINE_TOO_LARGE', '桌面工作树中的排轴项目过多。');
  }
}

function validateDesktopBundle(bundle) {
  if (
    !isRecord(bundle)
    || bundle.type !== 'dmg.timeline-bundle.v2'
    || bundle.schemaVersion !== 2
    || !isRecord(bundle.manifest)
    || !isRecord(bundle.document)
    || !Array.isArray(bundle.payloads)
    || bundle.payloads.length === 0
    || bundle.payloads.length > 512
    || !Array.isArray(bundle.snapshots)
    || bundle.snapshots.length > 1024
    || (bundle.workNodes !== undefined && (!Array.isArray(bundle.workNodes) || bundle.workNodes.length > 1024))
    || (bundle.commits !== undefined && (!Array.isArray(bundle.commits) || bundle.commits.length > 2048))
  ) {
    throw new MobileShareServiceError(400, 'INVALID_DESKTOP_BUNDLE', '桌面工作树格式不正确。');
  }
  bundle.payloads.forEach(validateTimelinePayload);
}

function validatePayload(payload) {
  if (!isRecord(payload)) {
    throw new MobileShareServiceError(400, 'INVALID_SHARE', '分享数据格式不正确。');
  }
  if (payload.schemaVersion === 1) {
    validateMobileDraft(payload.draft);
  } else if (payload.schemaVersion === 2 && payload.source === 'mobile') {
    validateMobileDraft(payload.draft);
  } else if (payload.schemaVersion === 2 && payload.source === 'desktop') {
    validateDesktopBundle(payload.bundle);
    validateMobileDraft(payload.presentedDraft);
  } else {
    throw new MobileShareServiceError(400, 'INVALID_SHARE', '分享来源或版本不受支持。');
  }
  if (
    (typeof payload.dataVersion !== 'string' || payload.dataVersion.length > 80)
    || (typeof payload.imageVersion !== 'string' || payload.imageVersion.length > 80)
  ) {
    throw new MobileShareServiceError(400, 'INVALID_VERSION', '分享版本信息不正确。');
  }
}

function createShareId() {
  return randomBytes(12).toString('base64url');
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function hashablePayloadJson(payload, serialized) {
  if (
    payload?.schemaVersion !== 2
    || payload.source !== 'desktop'
    || !isRecord(payload.bundle)
    || !isRecord(payload.bundle.manifest)
  ) return serialized;
  return JSON.stringify({
    ...payload,
    bundle: {
      ...payload.bundle,
      manifest: {
        ...payload.bundle.manifest,
        // Export time is transport metadata, not part of the SQLite tree.
        exportedAt: 0,
      },
    },
  });
}

function tableHasColumn(database, tableName, columnName) {
  return database.prepare(`PRAGMA table_info(${tableName})`)
    .all()
    .some((column) => column.name === columnName);
}

function ensureColumn(database, tableName, columnName, definition) {
  if (tableHasColumn(database, tableName, columnName)) return;
  database.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
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
      payload_hash TEXT NOT NULL DEFAULT '',
      ip_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL DEFAULT 0
    ) STRICT;
    CREATE TABLE IF NOT EXISTS mobile_share_creation_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ip_hash TEXT NOT NULL,
      device_hash TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL
    ) STRICT;
  `);
  ensureColumn(database, 'mobile_shares', 'payload_hash', "TEXT NOT NULL DEFAULT ''");
  ensureColumn(database, 'mobile_share_creation_events', 'device_hash', "TEXT NOT NULL DEFAULT ''");
  database.exec(`
    DROP INDEX IF EXISTS mobile_shares_expires;
    CREATE UNIQUE INDEX IF NOT EXISTS mobile_shares_payload_hash
      ON mobile_shares (payload_hash) WHERE payload_hash <> '';
    CREATE INDEX IF NOT EXISTS mobile_shares_ip_created
      ON mobile_shares (ip_hash, created_at);
    CREATE INDEX IF NOT EXISTS mobile_share_events_created
      ON mobile_share_creation_events (created_at);
    CREATE INDEX IF NOT EXISTS mobile_share_events_ip_created
      ON mobile_share_creation_events (ip_hash, created_at);
    CREATE INDEX IF NOT EXISTS mobile_share_events_device_created
      ON mobile_share_creation_events (device_hash, created_at);
  `);
  const legacyShares = database.prepare(
    "SELECT id, payload FROM mobile_shares WHERE payload_hash = ''",
  ).all();
  const backfillPayloadHash = database.prepare(
    "UPDATE OR IGNORE mobile_shares SET payload_hash = ? WHERE id = ? AND payload_hash = ''",
  );
  legacyShares.forEach((share) => backfillPayloadHash.run(sha256(String(share.payload)), share.id));
  database.exec('UPDATE mobile_shares SET expires_at = 0 WHERE expires_at <> 0');
  return database;
}

function getOrCreateMetaSecret(database, key, fallbackKey = '') {
  const existing = database.prepare('SELECT value FROM mobile_share_meta WHERE key = ?').get(key);
  if (existing?.value) return String(existing.value);
  const fallback = fallbackKey
    ? database.prepare('SELECT value FROM mobile_share_meta WHERE key = ?').get(fallbackKey)
    : null;
  const secret = fallback?.value ? String(fallback.value) : randomBytes(32).toString('hex');
  database.prepare('INSERT INTO mobile_share_meta (key, value) VALUES (?, ?)').run(key, secret);
  return secret;
}

export function createMobileShareStore(options = {}) {
  const database = openDatabase(options.dbPath || ':memory:');
  const now = options.now || (() => Date.now());
  const rateWindowMs = options.rateWindowMs ?? MOBILE_SHARE_RATE_WINDOW_MS;
  const perDeviceDailyLimit = options.perDeviceDailyLimit ?? MOBILE_SHARE_PER_DEVICE_DAILY_LIMIT;
  const perIpDailyLimit = options.perIpDailyLimit ?? MOBILE_SHARE_PER_IP_DAILY_LIMIT;
  const dailyLimit = options.dailyLimit ?? MOBILE_SHARE_DAILY_LIMIT;
  const maxPayloadBytes = options.maxPayloadBytes ?? MOBILE_SHARE_MAX_PAYLOAD_BYTES;
  const identitySalt = getOrCreateMetaSecret(database, 'identity_salt', 'ip_salt');
  const deviceSecret = getOrCreateMetaSecret(database, 'device_secret');

  const deleteOldEvents = database.prepare('DELETE FROM mobile_share_creation_events WHERE created_at < ?');
  const countRecentEvents = database.prepare('SELECT COUNT(*) AS count FROM mobile_share_creation_events WHERE created_at >= ?');
  const countRecentIpEvents = database.prepare(`
    SELECT COUNT(*) AS count FROM mobile_share_creation_events
    WHERE ip_hash = ? AND created_at >= ?
  `);
  const countRecentDeviceEvents = database.prepare(`
    SELECT COUNT(*) AS count FROM mobile_share_creation_events
    WHERE device_hash = ? AND created_at >= ?
  `);
  const findShareByPayloadHash = database.prepare(`
    SELECT id, created_at AS createdAt FROM mobile_shares WHERE payload_hash = ?
  `);
  const insertShare = database.prepare(`
    INSERT INTO mobile_shares (
      id, payload, payload_bytes, payload_hash, ip_hash, created_at, expires_at
    ) VALUES (?, ?, ?, ?, ?, ?, 0)
  `);
  const insertEvent = database.prepare(`
    INSERT INTO mobile_share_creation_events (ip_hash, device_hash, created_at)
    VALUES (?, ?, ?)
  `);
  const findShare = database.prepare(`
    SELECT id, payload, created_at AS createdAt
    FROM mobile_shares
    WHERE id = ?
  `);

  function hashIp(ipAddress) {
    return sha256(`${identitySalt}:${ipAddress}`);
  }

  function hashDevice(deviceId) {
    return sha256(`${identitySalt}:device:${deviceId}`);
  }

  function signDeviceId(deviceId) {
    return createHmac('sha256', Buffer.from(deviceSecret, 'hex'))
      .update(deviceId)
      .digest('base64url');
  }

  function verifyDeviceToken(token) {
    const [deviceId, signature, extra] = String(token || '').split('.');
    if (
      extra !== undefined
      || !DEVICE_ID_PATTERN.test(deviceId || '')
      || !DEVICE_SIGNATURE_PATTERN.test(signature || '')
    ) return null;
    const expected = Buffer.from(signDeviceId(deviceId));
    const received = Buffer.from(signature);
    return expected.length === received.length && timingSafeEqual(expected, received)
      ? deviceId
      : null;
  }

  function resolveDevice(token) {
    const verifiedId = verifyDeviceToken(token);
    if (verifiedId) return { id: verifiedId, token: `${verifiedId}.${signDeviceId(verifiedId)}` };
    const id = randomBytes(16).toString('base64url');
    return { id, token: `${id}.${signDeviceId(id)}` };
  }

  function cleanup(timestamp = now()) {
    deleteOldEvents.run(timestamp - rateWindowMs);
  }

  function create(payload, ipAddress, deviceId = 'unknown-device') {
    validatePayload(payload);
    const serialized = JSON.stringify(payload);
    const payloadBytes = Buffer.byteLength(serialized);
    if (payloadBytes > maxPayloadBytes) {
      throw new MobileShareServiceError(413, 'PAYLOAD_TOO_LARGE', '分享内容过大，请减少排轴项目后重试。');
    }

    const timestamp = now();
    const windowStart = timestamp - rateWindowMs;
    const ipHash = hashIp(ipAddress || 'unknown');
    const deviceHash = hashDevice(deviceId || 'unknown-device');
    const payloadHash = sha256(hashablePayloadJson(payload, serialized));
    database.exec('BEGIN IMMEDIATE');
    try {
      cleanup(timestamp);
      const existing = findShareByPayloadHash.get(payloadHash);
      if (existing) {
        database.exec('COMMIT');
        return {
          id: String(existing.id),
          createdAt: Number(existing.createdAt),
          expiresAt: null,
          permanent: true,
          reused: true,
        };
      }

      const deviceCount = Number(countRecentDeviceEvents.get(deviceHash, windowStart)?.count || 0);
      if (deviceCount >= perDeviceDailyLimit) {
        throw new MobileShareServiceError(
          429,
          'DEVICE_DAILY_LIMIT',
          `当前浏览器 24 小时内最多创建 ${perDeviceDailyLimit} 份永久分享。`,
        );
      }
      const ipCount = Number(countRecentIpEvents.get(ipHash, windowStart)?.count || 0);
      if (ipCount >= perIpDailyLimit) {
        throw new MobileShareServiceError(
          429,
          'IP_DAILY_LIMIT',
          `当前网络 24 小时内最多创建 ${perIpDailyLimit} 份永久分享。`,
        );
      }
      const dailyCount = Number(countRecentEvents.get(windowStart)?.count || 0);
      if (dailyCount >= dailyLimit) {
        throw new MobileShareServiceError(
          429,
          'DAILY_LIMIT',
          `服务器 24 小时内最多创建 ${dailyLimit} 份永久分享，请稍后再试。`,
        );
      }

      let id = '';
      for (let attempt = 0; attempt < 4; attempt += 1) {
        id = createShareId();
        try {
          insertShare.run(id, serialized, payloadBytes, payloadHash, ipHash, timestamp);
          break;
        } catch (error) {
          if (attempt === 3 || !String(error).includes('UNIQUE')) throw error;
          id = '';
        }
      }
      if (!id) throw new Error('Unable to allocate a share id.');
      insertEvent.run(ipHash, deviceHash, timestamp);
      database.exec('COMMIT');
      return {
        id,
        createdAt: timestamp,
        expiresAt: null,
        permanent: true,
        reused: false,
      };
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  }

  function get(id) {
    if (!SHARE_ID_PATTERN.test(id)) return null;
    cleanup(now());
    const row = findShare.get(id);
    if (!row) return null;
    return {
      id: String(row.id),
      createdAt: Number(row.createdAt),
      expiresAt: null,
      permanent: true,
      payload: JSON.parse(String(row.payload)),
    };
  }

  function stats() {
    const timestamp = now();
    cleanup(timestamp);
    const permanent = Number(database.prepare('SELECT COUNT(*) AS count FROM mobile_shares').get()?.count || 0);
    return {
      active: permanent,
      permanent,
      createdLast24Hours: Number(countRecentEvents.get(timestamp - rateWindowMs)?.count || 0),
    };
  }

  return {
    create,
    get,
    cleanup,
    stats,
    resolveDevice,
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

function readCookie(request, name) {
  const cookieHeader = Array.isArray(request.headers.cookie)
    ? request.headers.cookie.join(';')
    : String(request.headers.cookie || '');
  for (const part of cookieHeader.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(separator + 1).trim());
    } catch {
      return '';
    }
  }
  return '';
}

function requestIsSecure(request, trustProxy) {
  if (request.socket.encrypted) return true;
  if (!trustProxy) return false;
  const forwardedProto = request.headers['x-forwarded-proto'];
  const first = Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto?.split(',')[0];
  return first?.trim().toLowerCase() === 'https';
}

function buildDeviceCookie(token, secure) {
  const parts = [
    `${MOBILE_SHARE_DEVICE_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/api/mobile-shares',
    `Max-Age=${MOBILE_SHARE_DEVICE_COOKIE_MAX_AGE_SECONDS}`,
    'HttpOnly',
    'SameSite=Lax',
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

function normalizeAllowedOrigins(value) {
  const source = Array.isArray(value) ? value : DEFAULT_ALLOWED_ORIGINS;
  return new Set(source.map((origin) => String(origin || '').trim().replace(/\/$/, '')).filter(Boolean));
}

function applyCorsHeaders(request, response, allowedOrigins) {
  const origin = String(request.headers.origin || '').trim().replace(/\/$/, '');
  if (!origin) return;
  if (!allowedOrigins.has(origin)) {
    throw new MobileShareServiceError(403, 'ORIGIN_NOT_ALLOWED', '当前网页来源不能访问分享服务。');
  }
  response.setHeader('access-control-allow-origin', origin);
  response.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
  response.setHeader('access-control-allow-headers', 'Accept, Content-Type');
  response.setHeader('access-control-max-age', '600');
  response.setHeader('vary', 'Origin');
}

export function createMobileShareRequestHandler(options = {}) {
  const store = createMobileShareStore(options);
  const trustProxy = options.trustProxy !== false;
  const maxRequestBytes = (options.maxPayloadBytes ?? MOBILE_SHARE_MAX_PAYLOAD_BYTES) + 16 * 1024;
  const allowedOrigins = normalizeAllowedOrigins(options.allowedOrigins);

  const handler = async (request, response) => {
    try {
      const url = new URL(request.url || '/', 'http://127.0.0.1');
      if (url.pathname.startsWith('/api/mobile-shares')) {
        applyCorsHeaders(request, response, allowedOrigins);
      }
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
        const device = store.resolveDevice(readCookie(request, MOBILE_SHARE_DEVICE_COOKIE));
        response.setHeader('set-cookie', buildDeviceCookie(
          device.token,
          requestIsSecure(request, trustProxy),
        ));
        const result = store.create(
          payload,
          resolveClientIp(request, trustProxy),
          device.id,
        );
        sendJson(response, result.reused ? 200 : 201, result);
        return;
      }
      const match = url.pathname.match(/^\/api\/mobile-shares\/([A-Za-z0-9_-]{16})$/);
      if (request.method === 'GET' && match) {
        const share = store.get(match[1]);
        if (!share) throw new MobileShareServiceError(404, 'SHARE_NOT_FOUND', '分享不存在。');
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
  const allowedOrigins = process.env.DEF_MOBILE_SHARE_ALLOWED_ORIGINS
    ?.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  const handler = createMobileShareRequestHandler({
    dbPath,
    trustProxy: true,
    ...(allowedOrigins?.length ? { allowedOrigins } : {}),
  });
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
