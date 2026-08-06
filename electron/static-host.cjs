'use strict';

const http = require('node:http');
const net = require('node:net');
const path = require('node:path');
const fs = require('node:fs');
const fsPromises = require('node:fs/promises');

const MIME_TYPES = Object.freeze({
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.zip': 'application/zip',
});

function isLoopbackHostname(value) {
  const hostname = String(value).trim().toLowerCase().replace(/^\[|\]$/g, '');
  return (
    hostname === 'localhost' ||
    hostname === 'localhost.' ||
    hostname === '127.0.0.1' ||
    hostname === '::1'
  );
}

function isLoopbackHostHeader(value) {
  if (typeof value !== 'string') return false;

  const host = value.trim().toLowerCase();
  if (!host || host.includes('/') || host.includes('\\') || host.includes('@')) {
    return false;
  }

  let hostname = host;
  let port = null;

  if (host.startsWith('[')) {
    const closingBracket = host.indexOf(']');
    if (closingBracket < 0) return false;

    hostname = host.slice(1, closingBracket);
    const suffix = host.slice(closingBracket + 1);
    if (suffix) {
      if (!/^:\\d+$/.test(suffix)) return false;
      port = Number(suffix.slice(1));
    }
  } else {
    const colonCount = (host.match(/:/g) || []).length;
    if (colonCount === 1) {
      const separator = host.lastIndexOf(':');
      const possiblePort = host.slice(separator + 1);
      if (!/^\d+$/.test(possiblePort)) return false;
      hostname = host.slice(0, separator);
      port = Number(possiblePort);
    } else if (colonCount > 1) {
      hostname = host;
    }
  }

  if (port !== null && (!Number.isInteger(port) || port < 0 || port > 65535)) {
    return false;
  }

  return isLoopbackHostname(hostname) && (hostname === 'localhost' || hostname === 'localhost.' || net.isIP(hostname) > 0);
}

function isWithinRoot(rootPath, candidatePath) {
  const relativePath = path.relative(rootPath, candidatePath);
  return (
    relativePath === '' ||
    (!relativePath.startsWith(`..${path.sep}`) && relativePath !== '..' && !path.isAbsolute(relativePath))
  );
}

function toPosixRelativePath(relativePath) {
  return relativePath.split(path.sep).join('/');
}

function decodeRequestPath(requestUrl) {
  if (typeof requestUrl !== 'string') {
    const error = new Error('Invalid request target');
    error.statusCode = 400;
    throw error;
  }

  let pathname;
  try {
    pathname = new URL(requestUrl, 'http://desktop-static-host.invalid').pathname;
    pathname = decodeURIComponent(pathname);
  } catch {
    const error = new Error('Invalid request target');
    error.statusCode = 400;
    throw error;
  }

  if (!pathname.startsWith('/') || pathname.includes('\u0000') || pathname.includes('\\')) {
    const error = new Error('Unsafe request path');
    error.statusCode = 403;
    throw error;
  }

  return pathname;
}

function hasFileExtension(pathname) {
  const withoutTrailingSlash = pathname.replace(/\/+$/, '');
  return path.posix.extname(path.posix.basename(withoutTrailingSlash)) !== '';
}

function isHashedAsset(relativePath) {
  const basename = path.posix.basename(relativePath);
  const extension = path.posix.extname(basename);
  if (!extension) return false;

  const stem = basename.slice(0, -extension.length);
  return stem.split(/[._-]+/).some((part) => {
    if (/^[a-f0-9]{8,64}$/i.test(part)) return true;
    return /^(?=.*[a-z])(?=.*\d)[a-z0-9]{8,64}$/i.test(part);
  });
}

function cacheControlFor(relativePath) {
  const normalizedPath = toPosixRelativePath(relativePath);
  const basename = path.posix.basename(normalizedPath);
  const lowerBasename = basename.toLowerCase();

  if (
    lowerBasename === 'index.html' ||
    /^sw.*\.js$/i.test(basename) ||
    (
      /\.json$/i.test(basename) &&
      /(?:^|[-_.])(?:version|manifest)(?:[-_.]|$)/i.test(basename.slice(0, -5))
    ) ||
    /\.webmanifest$/i.test(basename)
  ) {
    return 'no-store';
  }

  if (isHashedAsset(normalizedPath)) {
    return 'public, max-age=31536000, immutable';
  }

  return 'no-cache';
}

function contentTypeFor(filePath) {
  return MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}

function sendText(response, statusCode, message, extraHeaders = {}) {
  if (response.headersSent) {
    response.destroy();
    return;
  }

  const body = Buffer.from(message, 'utf8');
  response.statusCode = statusCode;
  response.setHeader('Content-Type', 'text/plain; charset=utf-8');
  response.setHeader('Content-Length', body.length);
  for (const [name, value] of Object.entries(extraHeaders)) {
    response.setHeader(name, value);
  }
  response.end(response.req?.method === 'HEAD' ? undefined : body);
}

async function inspectCandidate(candidatePath, rootRealPath) {
  let stats;
  try {
    stats = await fsPromises.stat(candidatePath);
  } catch (error) {
    if (error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) {
      return { kind: 'missing' };
    }
    if (error && (error.code === 'EACCES' || error.code === 'EPERM')) {
      return { kind: 'forbidden' };
    }
    throw error;
  }

  const realPath = await fsPromises.realpath(candidatePath);
  if (!isWithinRoot(rootRealPath, realPath)) {
    return { kind: 'forbidden' };
  }

  if (stats.isFile()) {
    return { kind: 'file', filePath: candidatePath, realPath, stats };
  }

  if (stats.isDirectory()) {
    return { kind: 'directory', realPath };
  }

  return { kind: 'missing' };
}

async function resolveFile({ rootRealPath, pathname }) {
  const relativePath = pathname.replace(/^\/+/, '');
  const candidatePath = path.resolve(rootRealPath, relativePath);

  if (!isWithinRoot(rootRealPath, candidatePath)) {
    return { kind: 'forbidden' };
  }

  const candidate = await inspectCandidate(candidatePath, rootRealPath);
  if (candidate.kind === 'forbidden' || candidate.kind === 'file') {
    return candidate;
  }

  if (candidate.kind === 'directory') {
    const directoryIndex = await inspectCandidate(path.join(candidatePath, 'index.html'), rootRealPath);
    if (directoryIndex.kind === 'forbidden' || directoryIndex.kind === 'file') {
      return directoryIndex;
    }
  }

  if (hasFileExtension(pathname)) {
    return { kind: 'missing' };
  }

  const fallback = await inspectCandidate(path.join(rootRealPath, 'index.html'), rootRealPath);
  if (fallback.kind === 'file') return fallback;
  return fallback.kind === 'forbidden' ? fallback : { kind: 'missing' };
}

async function handleRequest(request, response, rootRealPath, requestHandler, serveStatic) {
  if (!isLoopbackHostHeader(request.headers.host)) {
    sendText(response, 403, 'Forbidden');
    return;
  }

  if (requestHandler && await requestHandler(request, response)) {
    return;
  }

  if (!serveStatic) {
    sendText(response, 404, 'Not Found');
    return;
  }

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    sendText(response, 405, 'Method Not Allowed', { Allow: 'GET, HEAD' });
    return;
  }

  let pathname;
  try {
    pathname = decodeRequestPath(request.url);
  } catch (error) {
    sendText(response, error.statusCode || 400, error.message);
    return;
  }

  let resolved;
  try {
    resolved = await resolveFile({ rootRealPath, pathname });
  } catch {
    sendText(response, 500, 'Internal Server Error');
    return;
  }

  if (resolved.kind === 'forbidden') {
    sendText(response, 403, 'Forbidden');
    return;
  }
  if (resolved.kind !== 'file') {
    sendText(response, 404, 'Not Found');
    return;
  }

  response.statusCode = 200;
  response.setHeader('Content-Type', contentTypeFor(resolved.filePath));
  response.setHeader('Cache-Control', cacheControlFor(toPosixRelativePath(path.relative(rootRealPath, resolved.realPath))));
  response.setHeader('Content-Length', resolved.stats.size);
  response.setHeader('Last-Modified', resolved.stats.mtime.toUTCString());
  response.setHeader('X-Content-Type-Options', 'nosniff');

  if (request.method === 'HEAD') {
    response.end();
    return;
  }

  const stream = fs.createReadStream(resolved.filePath);
  stream.on('error', () => {
    if (response.headersSent) {
      response.destroy();
    } else {
      sendText(response, 500, 'Internal Server Error');
    }
  });
  stream.pipe(response);
}

async function createDesktopStaticServer({
  rootDir,
  host = '127.0.0.1',
  port = 31457,
  requestHandler,
  serveStatic = true,
} = {}) {
  if (typeof rootDir !== 'string' || rootDir.length === 0) {
    throw new TypeError('rootDir must be a non-empty string');
  }
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new TypeError('port must be an integer between 0 and 65535');
  }

  const bindHost = String(host).trim().replace(/^\[|\]$/g, '');
  if (!isLoopbackHostname(bindHost)) {
    throw new TypeError('host must be a loopback hostname');
  }

  if (requestHandler !== undefined && typeof requestHandler !== 'function') {
    throw new TypeError('requestHandler must be a function');
  }
  if (typeof serveStatic !== 'boolean') {
    throw new TypeError('serveStatic must be a boolean');
  }

  const rootRealPath = await fsPromises.realpath(path.resolve(rootDir));
  const rootStats = await fsPromises.stat(rootRealPath);
  if (!rootStats.isDirectory()) {
    throw new TypeError('rootDir must be a directory');
  }

  const server = http.createServer((request, response) => {
    handleRequest(request, response, rootRealPath, requestHandler, serveStatic).catch(() => {
      sendText(response, 500, 'Internal Server Error');
    });
  });

  try {
    await new Promise((resolve, reject) => {
      const onError = (error) => {
        server.removeListener('listening', onListening);
        reject(error);
      };
      const onListening = () => {
        server.removeListener('error', onError);
        resolve();
      };

      server.once('error', onError);
      server.once('listening', onListening);
      server.listen({ host: bindHost, port });
    });
  } catch (error) {
    if (server.listening) server.close();
    throw error;
  }

  const address = server.address();
  if (!address || typeof address === 'string') {
    await new Promise((resolve) => server.close(resolve));
    throw new Error('Static server did not expose a TCP address');
  }

  const originHost = net.isIP(address.address) === 6 ? `[${address.address}]` : address.address;
  const origin = `http://${originHost}:${address.port}`;
  let closePromise;
  const close = () => {
    if (closePromise) return closePromise;

    closePromise = new Promise((resolve, reject) => {
      if (!server.listening) {
        resolve();
        return;
      }

      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
      if (typeof server.closeIdleConnections === 'function') {
        server.closeIdleConnections();
      }
    });
    return closePromise;
  };

  return { server, origin, close };
}

module.exports = { createDesktopStaticServer };
