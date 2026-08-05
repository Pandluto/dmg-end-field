import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { chromium } from '@playwright/test';

const oldBuildDirectory = process.argv[2]
  ? path.resolve(process.argv[2])
  : process.env.SW_MIGRATION_OLD_BUILD
    ? path.resolve(process.env.SW_MIGRATION_OLD_BUILD)
    : null;
const newBuildDirectory = path.resolve(process.argv[3] || 'dist/client');

if (!oldBuildDirectory) {
  throw new Error(
    'Provide the previously deployed build: '
    + 'node scripts/check-service-worker-migration.mjs <old-build> [new-build]',
  );
}
for (const directory of [oldBuildDirectory, newBuildDirectory]) {
  for (const requiredFile of ['index.html', 'sw.js', 'version.json']) {
    if (!fs.existsSync(path.join(directory, requiredFile))) {
      throw new Error(`Migration build is missing ${requiredFile}: ${directory}`);
    }
  }
}

const oldVersion = JSON.parse(
  fs.readFileSync(path.join(oldBuildDirectory, 'version.json'), 'utf8'),
);
const newVersion = JSON.parse(
  fs.readFileSync(path.join(newBuildDirectory, 'version.json'), 'utf8'),
);
assert.notEqual(
  oldVersion.shellVersion,
  newVersion.shellVersion,
  'Migration test requires two different shell versions.',
);

const contentTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.wasm', 'application/wasm'],
  ['.webmanifest', 'application/manifest+json; charset=utf-8'],
]);
let activeBuildDirectory = oldBuildDirectory;

function resolveStaticPath(requestUrl) {
  const url = new URL(requestUrl || '/', 'http://127.0.0.1');
  const pathname = decodeURIComponent(url.pathname);
  const relativePath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const absolutePath = path.resolve(activeBuildDirectory, relativePath);
  if (!absolutePath.startsWith(`${activeBuildDirectory}${path.sep}`)) return null;
  if (fs.existsSync(absolutePath) && fs.statSync(absolutePath).isFile()) return absolutePath;
  if (pathname.startsWith('/assets/images/')) return null;
  return path.join(activeBuildDirectory, 'index.html');
}

const server = http.createServer((request, response) => {
  const filePath = resolveStaticPath(request.url);
  if (!filePath) {
    response.writeHead(404, { 'Cache-Control': 'no-store' });
    response.end('not found');
    return;
  }
  const extension = path.extname(filePath).toLowerCase();
  let bytes = fs.readFileSync(filePath);
  if (
    activeBuildDirectory === oldBuildDirectory
    && path.basename(filePath) === 'sw.js'
  ) {
    // The production edge uses HTTP/2. This local HTTP/1 harness lowers only
    // the old worker's batch width so its header-only fetch batching cannot
    // exhaust the test server connection pool before the migration begins.
    bytes = Buffer.from(
      bytes.toString('utf8').replace(
        'const APP_SHELL_INSTALL_CONCURRENCY = 6;',
        'const APP_SHELL_INSTALL_CONCURRENCY = 1;',
      ),
    );
  }
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
if (!address || typeof address === 'string') throw new Error('Migration server did not bind.');
const origin = `http://127.0.0.1:${address.port}`;
const imageProbePath = '/assets/images/migration-controller-probe.png';

async function readControllerVersion(page) {
  return page.evaluate(async () => {
    const controller = navigator.serviceWorker.controller;
    if (!controller) return '';
    return new Promise((resolve) => {
      const channel = new MessageChannel();
      const timeout = window.setTimeout(() => resolve(''), 1_000);
      channel.port1.onmessage = (event) => {
        window.clearTimeout(timeout);
        resolve(String(event.data?.shellVersion || ''));
      };
      controller.postMessage({ type: 'GET_PAGE_VERSION' }, [channel.port2]);
    });
  });
}

async function waitForControllerVersion(page, expectedVersion) {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (await readControllerVersion(page) === expectedVersion) return;
    await page.waitForTimeout(200);
  }
  throw new Error(`Controller did not reach shell ${expectedVersion}.`);
}

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ serviceWorkers: 'allow' });
const page = await context.newPage();
const pageErrors = [];
const imageNetworkDiagnostics = [];
page.on('pageerror', (error) => pageErrors.push(error.message));
page.on('response', (response) => {
  if (!response.url().includes(imageProbePath)) return;
  imageNetworkDiagnostics.push({
    status: response.status(),
    fromServiceWorker: response.fromServiceWorker(),
  });
});

try {
  const firstResponse = await page.goto(origin, { waitUntil: 'domcontentloaded' });
  assert.equal(firstResponse?.status(), 200, 'The old deployed page must start normally.');
  assert.equal(
    await page.evaluate(async () => {
      if (!window.__DMG_ENSURE_SERVICE_WORKER__) return false;
      return window.__DMG_ENSURE_SERVICE_WORKER__();
    }),
    true,
    'The old deployed page must establish its controller before migration.',
  );
  await waitForControllerVersion(page, oldVersion.shellVersion);

  await page.evaluate(async ({ oldShellVersion, probePath }) => {
    const imageCache = await caches.open('dmg-image-pack-v1');
    await imageCache.put(
      new Request(new URL(probePath, window.location.origin)),
      new Response('cached-image-data', {
        headers: {
          'Content-Type': 'image/png',
          'X-Migration-Probe': 'cached',
        },
      }),
    );
    await caches.delete(`dmg-app-shell-${oldShellVersion}`);
  }, { oldShellVersion: oldVersion.shellVersion, probePath: imageProbePath });

  activeBuildDirectory = newBuildDirectory;
  assert.equal(
    (await fetch(`${origin}${imageProbePath}`)).status,
    404,
    'The image probe must only be available through the installed browser image cache.',
  );

  const migrationResponse = await page.reload({ waitUntil: 'domcontentloaded' });
  assert.equal(
    migrationResponse?.status(),
    200,
    'A missing old app-shell cache must fall through to the new online page.',
  );
  await waitForControllerVersion(page, newVersion.shellVersion);

  const inspectImageDelivery = async () => {
    const result = await page.evaluate(async (probePath) => {
      const response = await fetch(probePath);
      const imageCache = await caches.open('dmg-image-pack-v1');
      const cached = await imageCache.match(new Request(new URL(probePath, window.location.origin)));
      return {
        image: {
          status: response.status,
          body: await response.text(),
          marker: response.headers.get('X-Migration-Probe'),
        },
        cached: cached
          ? { body: await cached.text(), marker: cached.headers.get('X-Migration-Probe') }
          : null,
        cacheNames: await caches.keys(),
        control: await navigator.serviceWorker.getRegistration('/').then((registration) => ({
          controller: navigator.serviceWorker.controller?.scriptURL || '',
          controllerState: navigator.serviceWorker.controller?.state || '',
          active: registration?.active?.scriptURL || '',
          activeState: registration?.active?.state || '',
          scope: registration?.scope || '',
          controllerIsActive: navigator.serviceWorker.controller === registration?.active,
        })),
      };
    }, imageProbePath);
    const workerDiagnostics = await Promise.all(context.serviceWorkers().map(async (worker) => ({
      url: worker.url(),
      cache: await worker.evaluate(async (probePath) => {
        const imageCache = await caches.open('dmg-image-pack-v1');
        const cached = await imageCache.match(new Request(new URL(probePath, self.location.origin)));
        return cached
          ? { body: await cached.text(), marker: cached.headers.get('X-Migration-Probe') }
          : null;
      }, imageProbePath),
    })));
    return { ...result, workerDiagnostics };
  };
  const assertImageDelivery = async () => {
    const result = await inspectImageDelivery();
    assert.deepEqual(
      result.image,
      { status: 200, body: 'cached-image-data', marker: 'cached' },
      `Image migration diagnostics: ${JSON.stringify({ ...result, imageNetworkDiagnostics })}`,
    );
  };
  await assertImageDelivery();

  for (let refresh = 1; refresh <= 2; refresh += 1) {
    const response = await page.reload({ waitUntil: 'domcontentloaded' });
    assert.equal(response?.status(), 200, `Consecutive refresh ${refresh} must stay reachable.`);
    await waitForControllerVersion(page, newVersion.shellVersion);
    await assertImageDelivery();
  }

  await context.setOffline(true);
  const offlineResponse = await page.reload({ waitUntil: 'domcontentloaded' });
  assert.equal(offlineResponse?.status(), 200, 'The migrated page must reload offline.');
  assert.equal(
    offlineResponse?.fromServiceWorker(),
    true,
    'The offline reload must come from the complete migrated app shell.',
  );
  await waitForControllerVersion(page, newVersion.shellVersion);
  await assertImageDelivery();
  await context.setOffline(false);

  assert.equal(
    await readControllerVersion(page),
    newVersion.shellVersion,
    'The new worker must remain the controller after consecutive refreshes.',
  );
  assert.deepEqual(pageErrors, [], `Migration page errors: ${pageErrors.join(' | ')}`);
  console.log(
    `SW_MIGRATION_OK old=${oldVersion.shellVersion} new=${newVersion.shellVersion} `
    + 'missingOldShell=true images=cache-only refreshes=2 offline=true',
  );
} finally {
  await context.close();
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
