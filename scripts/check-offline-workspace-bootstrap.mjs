import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { chromium } from '@playwright/test';

const buildDirectory = path.resolve(process.argv[2] || 'dist');
const accessPassword = process.env.E2E_ACCESS_PASSWORD || 'zmd';
for (const requiredFile of [
  'index.html',
  'sw.js',
  'version.json',
  'web-image-manifest.json',
  'assets/images/_manifest.json',
]) {
  if (!fs.existsSync(path.join(buildDirectory, requiredFile))) {
    throw new Error(`Offline workspace build is missing ${requiredFile}: ${buildDirectory}`);
  }
}

const imagePackageManifest = JSON.parse(
  fs.readFileSync(path.join(buildDirectory, 'web-image-manifest.json'), 'utf8'),
);
const imageProbePath = `/${imagePackageManifest.files[0].path}`;
const contentTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.gif', 'image/gif'],
  ['.html', 'text/html; charset=utf-8'],
  ['.jpeg', 'image/jpeg'],
  ['.jpg', 'image/jpeg'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.wasm', 'application/wasm'],
  ['.webmanifest', 'application/manifest+json; charset=utf-8'],
  ['.webp', 'image/webp'],
  ['.zip', 'application/zip'],
]);

function resolveStaticPath(requestUrl) {
  const url = new URL(requestUrl || '/', 'http://127.0.0.1');
  const pathname = decodeURIComponent(url.pathname);
  const relativePath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const absolutePath = path.resolve(buildDirectory, relativePath);
  if (!absolutePath.startsWith(`${buildDirectory}${path.sep}`)) return null;
  if (fs.existsSync(absolutePath) && fs.statSync(absolutePath).isFile()) return absolutePath;
  if (path.posix.extname(pathname)) return null;
  return path.join(buildDirectory, 'index.html');
}

const server = http.createServer((request, response) => {
  const filePath = resolveStaticPath(request.url);
  if (!filePath) {
    response.writeHead(404, { 'Cache-Control': 'no-store' });
    response.end('not found');
    return;
  }
  const bytes = fs.readFileSync(filePath);
  const extension = path.extname(filePath).toLowerCase();
  response.writeHead(200, {
    'Cache-Control': 'no-store, max-age=0',
    'Connection': 'close',
    'Content-Length': String(bytes.byteLength),
    'Content-Type': contentTypes.get(extension) || 'application/octet-stream',
    ...(path.basename(filePath) === 'sw.js' ? { 'Service-Worker-Allowed': '/' } : {}),
  });
  response.end(bytes);
});

await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolve);
});
const address = server.address();
if (!address || typeof address === 'string') throw new Error('Offline workspace server did not bind.');
const origin = `http://127.0.0.1:${address.port}`;

async function waitForOfflineReady(page) {
  await page.waitForFunction(async () => {
    const version = document
      .querySelector('meta[name="dmg-app-shell-version"]')
      ?.getAttribute('content') || '';
    const controller = navigator.serviceWorker.controller;
    if (!version || !controller) return false;
    const controllerVersion = await new Promise((resolve) => {
      const channel = new MessageChannel();
      const timeout = window.setTimeout(() => resolve(''), 1_000);
      channel.port1.onmessage = (event) => {
        window.clearTimeout(timeout);
        resolve(String(event.data?.shellVersion || ''));
      };
      controller.postMessage({ type: 'GET_PAGE_VERSION' }, [channel.port2]);
    });
    if (controllerVersion !== version) return false;
    const cache = await caches.open(`dmg-app-shell-${version}`);
    const marker = await cache.match('/__dmg_app_shell_complete__');
    return Boolean(marker && await marker.text() === version);
  }, undefined, { timeout: 120_000 });
}

async function readCachedImage(page) {
  return page.evaluate(async (pathname) => {
    const response = await fetch(pathname);
    return {
      status: response.status,
      packageVersion: response.headers.get('X-Dmg-Image-Package'),
      bytes: (await response.arrayBuffer()).byteLength,
    };
  }, imageProbePath);
}

async function waitForWorkspaceOrFailure(page, heading) {
  const workspace = page.getByRole('heading', { name: heading, exact: true });
  const failure = page.getByRole('heading', { name: '工作区没有准备好', exact: true });
  await Promise.race([
    workspace.waitFor({ timeout: 120_000 }),
    failure.waitFor({ timeout: 120_000 }).then(async () => {
      throw new Error(`Offline workspace failed: ${await page.locator('body').innerText()}`);
    }),
  ]);
}

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ serviceWorkers: 'allow' });
const pageErrors = [];

try {
  const onlinePage = await context.newPage();
  onlinePage.on('pageerror', (error) => pageErrors.push(`online: ${error.message}`));
  const onlineResponse = await onlinePage.goto(origin, { waitUntil: 'domcontentloaded' });
  assert.equal(onlineResponse?.status(), 200, 'The online workspace must open before installation.');

  await onlinePage.getByRole('heading', { name: '终末地伤害工作台', exact: true }).waitFor();
  await onlinePage.getByRole('textbox', { name: '访问密码', exact: true }).fill(accessPassword);
  await onlinePage.getByRole('button', { name: '进入工作台', exact: true }).click();
  await onlinePage.getByRole('heading', {
    name: '先把基础资料装进浏览器',
    exact: true,
  }).waitFor({ timeout: 60_000 });
  await onlinePage.getByRole('button', {
    name: '下载完整资料并开始',
    exact: true,
  }).click();
  await onlinePage.getByRole('heading', {
    name: '建立第一份排轴',
    exact: true,
  }).waitFor({ timeout: 180_000 });
  await waitForOfflineReady(onlinePage);

  const onlineImage = await readCachedImage(onlinePage);
  assert.equal(onlineImage.status, 200, 'The installed image package must be readable online.');
  assert.ok(onlineImage.packageVersion, 'The online image must come from the installed image package.');
  assert.ok(onlineImage.bytes > 0, 'The installed image must not be empty.');

  await onlinePage.close();
  await context.setOffline(true);

  const offlinePage = await context.newPage();
  offlinePage.on('pageerror', (error) => pageErrors.push(`offline: ${error.message}`));
  const offlineResponse = await offlinePage.goto(`${origin}/#/timeline`, {
    waitUntil: 'domcontentloaded',
  });
  assert.equal(offlineResponse?.status(), 200, 'A fresh offline tab must receive the cached page.');
  assert.equal(
    offlineResponse?.fromServiceWorker(),
    true,
    'A fresh offline tab must be served by the installed worker.',
  );
  await waitForWorkspaceOrFailure(offlinePage, '选择干员');
  assert.equal(
    await offlinePage.getByRole('heading', { name: '工作区没有准备好', exact: true }).count(),
    0,
    'Offline startup must not enter the workspace failure page.',
  );

  const offlineImage = await readCachedImage(offlinePage);
  assert.deepEqual(
    offlineImage,
    onlineImage,
    'The same installed image must remain readable in a fresh offline tab.',
  );

  const secondOfflineResponse = await offlinePage.reload({ waitUntil: 'domcontentloaded' });
  assert.equal(secondOfflineResponse?.status(), 200, 'A second offline reload must stay reachable.');
  assert.equal(secondOfflineResponse?.fromServiceWorker(), true);
  await waitForWorkspaceOrFailure(offlinePage, '选择干员');

  assert.deepEqual(pageErrors, [], `Offline workspace page errors: ${pageErrors.join(' | ')}`);
  console.log(
    `OFFLINE_WORKSPACE_OK image=${imageProbePath} coldStart=true reloads=2 sqlite=true`,
  );
} finally {
  await context.setOffline(false).catch(() => undefined);
  await context.close();
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
