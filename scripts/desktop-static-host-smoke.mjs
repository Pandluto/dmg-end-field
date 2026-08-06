import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import http from 'node:http';

const require = createRequire(import.meta.url);
const { createDesktopStaticServer } = require('../electron/static-host.cjs');

function request(origin, requestPath, { method = 'GET', headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(requestPath, origin);
    const request = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: `${url.pathname}${url.search}`,
        method,
        headers,
      },
      (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => {
          resolve({
            status: response.statusCode,
            headers: response.headers,
            body: Buffer.concat(chunks),
          });
        });
      },
    );
    request.on('error', reject);
    request.end();
  });
}

function text(response) {
  return response.body.toString('utf8');
}

function assertContentType(response, expected) {
  assert.equal(response.headers['content-type'], expected);
}

async function createFixture(rootDir) {
  await mkdir(join(rootDir, 'nested'), { recursive: true });
  await writeFile(join(rootDir, 'index.html'), '<!doctype html><title>Desktop shell</title>');
  await writeFile(join(rootDir, 'app-0123456789abcdef.js'), 'console.log("app");');
  await writeFile(join(rootDir, 'style.css'), 'body { color: black; }');
  await writeFile(join(rootDir, 'data.json'), '{"ok":true}');
  await writeFile(join(rootDir, 'module.wasm'), randomBytes(8));
  await writeFile(join(rootDir, 'assets.zip'), randomBytes(8));
  await writeFile(join(rootDir, 'site.webmanifest'), '{}');
  await writeFile(join(rootDir, 'manifest.json'), '{}');
  await writeFile(join(rootDir, 'image.png'), randomBytes(8));
  await writeFile(join(rootDir, 'image.jpg'), randomBytes(8));
  await writeFile(join(rootDir, 'icon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  await writeFile(join(rootDir, 'image.webp'), randomBytes(8));
  await writeFile(join(rootDir, 'sw.js'), 'self.addEventListener("fetch", () => {});');
  await writeFile(join(rootDir, 'version.json'), '{"version":"1.8.2"}');
  await writeFile(join(rootDir, 'web-image-manifest.json'), '{"manifestVersion":1}');
  await writeFile(join(rootDir, 'nested/route.txt'), 'nested file');
}

async function main() {
  const fixtureParent = await mkdtemp(join(tmpdir(), 'desktop-static-host-smoke-'));
  const rootDir = join(fixtureParent, 'dist');
  await mkdir(rootDir);
  await createFixture(rootDir);
  await writeFile(join(fixtureParent, 'outside-secret.txt'), 'outside secret');

  let staticHost;
  try {
    staticHost = await createDesktopStaticServer({ rootDir, port: 0 });
    const { origin, server, close } = staticHost;
    assert.equal(server.listening, true);
    assert.match(origin, /^http:\/\/127\.0\.0\.1:\d+$/);

    const index = await request(origin, '/index.html?cachebust=1');
    assert.equal(index.status, 200);
    assertContentType(index, 'text/html; charset=utf-8');
    assert.equal(index.headers['cache-control'], 'no-store');
    assert.match(text(index), /Desktop shell/);

    const spa = await request(origin, '/settings/profile?from=smoke');
    assert.equal(spa.status, 200);
    assert.equal(spa.headers['cache-control'], 'no-store');
    assert.equal(text(spa), text(index));

    const head = await request(origin, '/index.html', { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(head.body.length, 0);
    assert.equal(Number(head.headers['content-length']), index.body.length);

    const hashedAsset = await request(origin, '/app-0123456789abcdef.js?cachebust=2');
    assert.equal(hashedAsset.status, 200);
    assertContentType(hashedAsset, 'text/javascript; charset=utf-8');
    assert.equal(hashedAsset.headers['cache-control'], 'public, max-age=31536000, immutable');

    const css = await request(origin, '/style.css');
    const cssWithQuery = await request(origin, '/style.css?cachebust=3');
    assert.equal(cssWithQuery.status, css.status);
    assert.deepEqual(cssWithQuery.body, css.body);
    assert.equal(cssWithQuery.headers['content-type'], css.headers['content-type']);
    assert.equal(cssWithQuery.headers['cache-control'], css.headers['cache-control']);

    const mimeCases = [
      ['/style.css', 'text/css; charset=utf-8'],
      ['/data.json', 'application/json; charset=utf-8'],
      ['/module.wasm', 'application/wasm'],
      ['/assets.zip', 'application/zip'],
      ['/site.webmanifest', 'application/manifest+json; charset=utf-8'],
      ['/image.png', 'image/png'],
      ['/image.jpg', 'image/jpeg'],
      ['/icon.svg', 'image/svg+xml'],
      ['/image.webp', 'image/webp'],
    ];
    for (const [requestPath, expectedContentType] of mimeCases) {
      const response = await request(origin, requestPath);
      assert.equal(response.status, 200, requestPath);
      assertContentType(response, expectedContentType);
    }

    for (const requestPath of [
      '/sw.js',
      '/version.json',
      '/manifest.json',
      '/web-image-manifest.json',
      '/site.webmanifest',
    ]) {
      const response = await request(origin, requestPath);
      assert.equal(response.status, 200, requestPath);
      assert.equal(response.headers['cache-control'], 'no-store', requestPath);
    }

    const missingAsset = await request(origin, '/missing.js');
    assert.equal(missingAsset.status, 404);

    const missingHead = await request(origin, '/missing.js', { method: 'HEAD' });
    assert.equal(missingHead.status, 404);
    assert.equal(missingHead.body.length, 0);

    const traversal = await request(origin, '/%2e%2e%2foutside-secret.txt');
    assert.notEqual(traversal.status, 200);
    assert.doesNotMatch(text(traversal), /outside secret/);

    const invalidMethod = await request(origin, '/index.html', { method: 'POST' });
    assert.equal(invalidMethod.status, 405);
    assert.equal(invalidMethod.headers.allow, 'GET, HEAD');

    const rejectedHost = await request(origin, '/index.html', {
      headers: { Host: 'example.test' },
    });
    assert.equal(rejectedHost.status, 403);
    assert.equal(rejectedHost.headers['access-control-allow-origin'], undefined);

    const occupiedPort = server.address().port;
    await assert.rejects(
      createDesktopStaticServer({ rootDir, port: occupiedPort }),
      (error) => error?.code === 'EADDRINUSE',
    );
    assert.equal(server.listening, true, '端口冲突不能关闭现有宿主或改用随机端口');

    await close();
    assert.equal(server.listening, false);

    let bridgeCalls = 0;
    staticHost = await createDesktopStaticServer({
      rootDir,
      port: 0,
      serveStatic: false,
      requestHandler(request, response) {
        if (new URL(request.url, 'http://bridge.invalid').pathname !== '/bridge') return false;
        bridgeCalls += 1;
        response.writeHead(request.method === 'OPTIONS' ? 204 : 200, {
          'Content-Type': 'application/json; charset=utf-8',
        });
        response.end(request.method === 'OPTIONS' ? undefined : '{"ok":true}');
        return true;
      },
    });
    const bridge = await request(staticHost.origin, '/bridge');
    assert.equal(bridge.status, 200);
    assert.equal(text(bridge), '{"ok":true}');
    assert.equal((await request(staticHost.origin, '/bridge', { method: 'OPTIONS' })).status, 204);
    assert.equal((await request(staticHost.origin, '/index.html')).status, 404, 'bridge-only host does not serve Shell files');
    const callsBeforeRejectedHost = bridgeCalls;
    assert.equal((await request(staticHost.origin, '/bridge', { headers: { Host: 'attacker.invalid' } })).status, 403);
    assert.equal(bridgeCalls, callsBeforeRejectedHost, 'Host validation runs before dynamic bridge handlers');
    await staticHost.close();
    console.log('desktop static host smoke: PASS');
  } finally {
    if (staticHost?.server.listening) await staticHost.close();
    await rm(fixtureParent, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error('desktop static host smoke: FAIL');
  console.error(error);
  process.exitCode = 1;
});
