'use strict';

const PROXY_PREFIX = '/__dmg_official_resources__/';
const UPSTREAM_ORIGIN = 'https://dmgendfield.cloud';
const MAX_REQUEST_TARGET_BYTES = 2_048;
const MAX_QUERY_BYTES = 512;
const MAX_REDIRECTS = 2;
const MAX_RESOURCE_BYTES = 64 * 1024 * 1024;
const MAX_CHANNEL_BYTES = 64 * 1024;
const UPSTREAM_TIMEOUT_MS = 15_000;
const SAFE_RESPONSE_HEADERS = [
  'cache-control',
  'content-type',
  'etag',
  'last-modified',
];

class OfficialResourceProxyError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.name = 'OfficialResourceProxyError';
    this.statusCode = statusCode;
  }
}

function invalidRequest(message) {
  throw new OfficialResourceProxyError(400, message);
}

function parseOfficialResourceProxyTarget(requestTarget) {
  if (typeof requestTarget !== 'string') return null;
  if (!requestTarget.startsWith(PROXY_PREFIX)) return null;
  if (Buffer.byteLength(requestTarget, 'utf8') > MAX_REQUEST_TARGET_BYTES) {
    invalidRequest('Resource proxy request target is too long.');
  }
  const queryOffset = requestTarget.indexOf('?');
  const rawPath = queryOffset >= 0 ? requestTarget.slice(0, queryOffset) : requestTarget;
  const rawQuery = queryOffset >= 0 ? requestTarget.slice(queryOffset + 1) : '';
  if (Buffer.byteLength(rawQuery, 'utf8') > MAX_QUERY_BYTES) {
    invalidRequest('Resource proxy query is too long.');
  }
  if (/%(?:2f|5c|00|2e)/i.test(rawPath) || rawPath.includes('\\')) {
    invalidRequest('Encoded separators and dot segments are not allowed.');
  }

  let relativePath;
  try {
    relativePath = decodeURIComponent(rawPath.slice(PROXY_PREFIX.length));
  } catch {
    invalidRequest('Resource proxy path is not valid UTF-8.');
  }
  if (!relativePath.startsWith('resources/') || relativePath.includes('//')) {
    invalidRequest('Only the official resources directory is available.');
  }
  const segments = relativePath.split('/');
  if (
    segments.some((segment) => (
      !segment
      || segment === '.'
      || segment === '..'
      || !/^[A-Za-z0-9._-]+$/.test(segment)
    ))
  ) {
    invalidRequest('Resource proxy path contains an unsupported segment.');
  }

  const query = new URLSearchParams(rawQuery);
  for (const [name, value] of query) {
    if (!/^[A-Za-z0-9_-]{1,32}$/.test(name) || !/^[A-Za-z0-9._~-]{0,160}$/.test(value)) {
      invalidRequest('Resource proxy query contains an unsupported value.');
    }
  }
  const upstream = new URL(`/${segments.join('/')}`, `${UPSTREAM_ORIGIN}/`);
  upstream.search = query.toString();
  return upstream;
}

function isAllowedRedirect(value) {
  try {
    const target = new URL(value, `${UPSTREAM_ORIGIN}/`);
    return target.origin === UPSTREAM_ORIGIN
      && target.username === ''
      && target.password === ''
      && target.pathname.startsWith('/resources/');
  } catch {
    return false;
  }
}

async function fetchWithRestrictedRedirects(fetchImpl, target, options, redirects = 0) {
  const response = await fetchImpl(target, { ...options, redirect: 'manual' });
  if (response.status < 300 || response.status >= 400) return response;
  const location = response.headers.get('location') || '';
  if (redirects >= MAX_REDIRECTS || !isAllowedRedirect(location)) {
    throw new OfficialResourceProxyError(502, 'Official resource redirect was rejected.');
  }
  return fetchWithRestrictedRedirects(
    fetchImpl,
    new URL(location, target),
    options,
    redirects + 1,
  );
}

async function readResponseBytes(response, limit) {
  if (!response.body) return Buffer.from(await response.arrayBuffer());
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel().catch(() => undefined);
      throw new OfficialResourceProxyError(502, 'Official resource response is too large.');
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, total);
}

function sendText(response, statusCode, message, extraHeaders = {}) {
  const bytes = Buffer.from(message, 'utf8');
  response.statusCode = statusCode;
  response.setHeader('Content-Type', 'text/plain; charset=utf-8');
  response.setHeader('Content-Length', bytes.byteLength);
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  for (const [name, value] of Object.entries(extraHeaders)) response.setHeader(name, value);
  response.end(bytes);
}

function maxResponseBytes(target) {
  return target.pathname === '/resources/stable.json'
    ? MAX_CHANNEL_BYTES
    : MAX_RESOURCE_BYTES;
}

function createOfficialResourceProxyHandler(options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
    ? options.timeoutMs
    : UPSTREAM_TIMEOUT_MS;
  if (typeof fetchImpl !== 'function') {
    throw new TypeError('Official resource proxy requires a fetch implementation.');
  }
  return async function handleOfficialResourceProxyRequest(request, response) {
    let target;
    try {
      target = parseOfficialResourceProxyTarget(request.url);
    } catch (error) {
      if (!(error instanceof OfficialResourceProxyError)) throw error;
      sendText(response, error.statusCode, error.message);
      return true;
    }
    if (!target) return false;
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      sendText(response, 405, 'Method Not Allowed', { Allow: 'GET, HEAD' });
      return true;
    }

    const abortController = new AbortController();
    const abortTimer = setTimeout(() => abortController.abort(), timeoutMs);
    try {
      const headers = { 'accept-encoding': 'identity' };
      if (typeof request.headers?.['if-none-match'] === 'string') {
        headers['if-none-match'] = request.headers['if-none-match'];
      }
      if (typeof request.headers?.['if-modified-since'] === 'string') {
        headers['if-modified-since'] = request.headers['if-modified-since'];
      }
      const upstream = await fetchWithRestrictedRedirects(fetchImpl, target, {
        method: request.method,
        headers,
        cache: 'no-store',
        signal: abortController.signal,
      });
      const limit = maxResponseBytes(target);
      const declaredHeader = upstream.headers.get('content-length');
      const declaredBytes = declaredHeader === null ? null : Number(declaredHeader);
      if (
        declaredBytes !== null
        && (!Number.isSafeInteger(declaredBytes) || declaredBytes < 0 || declaredBytes > limit)
      ) {
        throw new OfficialResourceProxyError(502, 'Official resource response is too large.');
      }
      const noBody = request.method === 'HEAD' || upstream.status === 204 || upstream.status === 304;
      const bytes = noBody ? null : await readResponseBytes(upstream, limit);

      response.statusCode = upstream.status;
      for (const name of SAFE_RESPONSE_HEADERS) {
        const value = upstream.headers.get(name);
        if (value) response.setHeader(name, value);
      }
      response.setHeader(
        'Content-Length',
        request.method === 'HEAD' && declaredBytes !== null ? declaredBytes : bytes?.byteLength || 0,
      );
      response.setHeader('X-Content-Type-Options', 'nosniff');
      response.end(bytes || undefined);
      return true;
    } catch (error) {
      const statusCode = error instanceof OfficialResourceProxyError ? error.statusCode : 502;
      const message = error instanceof OfficialResourceProxyError
        ? error.message
        : 'Official resource server is unavailable.';
      sendText(response, statusCode, message);
      return true;
    } finally {
      clearTimeout(abortTimer);
    }
  };
}

module.exports = {
  MAX_RESOURCE_BYTES,
  OfficialResourceProxyError,
  PROXY_PREFIX,
  UPSTREAM_ORIGIN,
  createOfficialResourceProxyHandler,
  parseOfficialResourceProxyTarget,
};
