const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { tryServeDesktopApp } = require('../electron/web-host.cjs');

function createMockResponse() {
  return {
    statusCode: null,
    headers: null,
    body: Buffer.alloc(0),
    ended: false,
    writeHead(statusCode, headers) {
      this.statusCode = statusCode;
      this.headers = headers;
    },
    end(body = '') {
      this.body = Buffer.isBuffer(body) ? body : Buffer.from(body);
      this.ended = true;
    },
  };
}

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'def-web-host-'));
const distDir = path.join(tempRoot, 'dist');
fs.mkdirSync(path.join(distDir, 'assets'), { recursive: true });
fs.writeFileSync(
  path.join(distDir, 'index.html'),
  '<!doctype html><html><body><div id="root"></div></body></html>',
  'utf8'
);
fs.writeFileSync(
  path.join(distDir, 'assets', 'main.js'),
  'console.log("desktop web host");',
  'utf8'
);

{
  const response = createMockResponse();
  const handled = tryServeDesktopApp({
    method: 'GET',
    requestUrl: new URL('http://127.0.0.1:31457/'),
    response,
    distDir,
  });

  assert.strictEqual(handled, true, 'root request should be handled');
  assert.strictEqual(response.statusCode, 200, 'root request should return 200');
  assert.match(response.body.toString('utf8'), /<div id="root">/, 'root request should return index.html');
}

{
  const response = createMockResponse();
  const handled = tryServeDesktopApp({
    method: 'GET',
    requestUrl: new URL('http://127.0.0.1:31457/assets/main.js'),
    response,
    distDir,
  });

  assert.strictEqual(handled, true, 'asset request should be handled');
  assert.strictEqual(response.statusCode, 200, 'asset request should return 200');
  assert.strictEqual(response.body.toString('utf8'), 'console.log("desktop web host");');
}

{
  const response = createMockResponse();
  const handled = tryServeDesktopApp({
    method: 'GET',
    requestUrl: new URL('http://127.0.0.1:31457/operator-config'),
    response,
    distDir,
  });

  assert.strictEqual(handled, true, 'spa route should be handled');
  assert.strictEqual(response.statusCode, 200, 'spa route should return 200');
  assert.match(response.body.toString('utf8'), /<div id="root">/, 'spa route should fall back to index.html');
}

{
  const response = createMockResponse();
  const handled = tryServeDesktopApp({
    method: 'GET',
    requestUrl: { pathname: '/..%2Fsecret.txt' },
    response,
    distDir,
  });

  assert.strictEqual(handled, true, 'path traversal should be handled');
  assert.strictEqual(response.statusCode, 403, 'path traversal should be forbidden');
}

fs.rmSync(tempRoot, { recursive: true, force: true });
