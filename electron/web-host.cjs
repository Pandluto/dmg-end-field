const fs = require('fs');
const path = require('path');

const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.webp': 'image/webp',
};

function buildStaticHeaders(contentType, byteLength, isHtml) {
  return {
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': isHtml ? 'no-cache' : 'public, max-age=31536000, immutable',
    'Content-Length': byteLength,
    'Content-Type': contentType,
  };
}

function sendBuffer(response, statusCode, headers, body, method) {
  response.writeHead(statusCode, headers);
  response.end(method === 'HEAD' ? '' : body);
}

function tryServeDesktopApp({ method, requestUrl, response, distDir }) {
  if (method !== 'GET' && method !== 'HEAD') {
    return false;
  }

  const pathname = decodeURIComponent(requestUrl.pathname || '/');
  if (pathname.includes('\\') || pathname.includes('\0') || pathname.includes('..')) {
    sendBuffer(response, 403, { 'Content-Type': 'text/plain; charset=utf-8' }, 'Forbidden', method);
    return true;
  }

  const rootDir = path.resolve(distDir);
  const normalizedPath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const requestedPath = path.resolve(rootDir, normalizedPath);

  if (requestedPath !== rootDir && !requestedPath.startsWith(rootDir + path.sep)) {
    sendBuffer(response, 403, { 'Content-Type': 'text/plain; charset=utf-8' }, 'Forbidden', method);
    return true;
  }

  let filePath = requestedPath;
  let useSpaFallback = false;

  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    if (path.extname(normalizedPath)) {
      sendBuffer(response, 404, { 'Content-Type': 'text/plain; charset=utf-8' }, 'Not Found', method);
      return true;
    }
    filePath = path.join(rootDir, 'index.html');
    useSpaFallback = true;
  }

  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    sendBuffer(response, 404, { 'Content-Type': 'text/plain; charset=utf-8' }, 'Not Found', method);
    return true;
  }

  const body = fs.readFileSync(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const isHtml = useSpaFallback || ext === '.html';
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';
  sendBuffer(response, 200, buildStaticHeaders(contentType, body.length, isHtml), body, method);
  return true;
}

module.exports = {
  tryServeDesktopApp,
};
