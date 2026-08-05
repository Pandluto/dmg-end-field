import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import zlib from 'node:zlib';

const outputDirectory = path.resolve(process.argv[2] || 'dist');
const serviceWorkerPath = path.join(outputDirectory, 'sw.js');
const indexPath = path.join(outputDirectory, 'index.html');
const versionManifestPath = path.join(outputDirectory, 'version.json');
const source = fs.readFileSync(serviceWorkerPath, 'utf8');
const indexHtml = fs.readFileSync(indexPath, 'utf8');
const versionManifest = JSON.parse(fs.readFileSync(versionManifestPath, 'utf8'));

const versionMatch = source.match(/const APP_SHELL_VERSION = ("[a-f0-9]{16}");/);
const releaseVersionMatch = source.match(/const APP_RELEASE_VERSION = ("[^"]+");/);
const filesMatch = source.match(
  /const APP_SHELL_FILES = (\[[\s\S]*?\]);\nconst APP_SHELL_FILE_PATHS/,
);
assert.ok(versionMatch, 'Generated service worker must contain a content version.');
assert.ok(releaseVersionMatch, 'Generated service worker must contain a release version.');
assert.ok(filesMatch, 'Generated service worker must contain an app-shell manifest.');
const shellVersion = JSON.parse(versionMatch[1]);
const releaseVersion = JSON.parse(releaseVersionMatch[1]);
assert.equal(versionManifest.schemaVersion, 1, 'Version manifest schema must be supported.');
assert.equal(versionManifest.releaseVersion, releaseVersion, 'Version manifest release must match the worker.');
assert.equal(versionManifest.shellVersion, shellVersion, 'Version manifest shell must match the worker.');
assert.match(
  indexHtml,
  new RegExp(`<meta name="dmg-app-shell-version" content="${shellVersion}"`),
  'Built index must identify its installed app-shell version.',
);

const appShellFiles = JSON.parse(filesMatch[1]);
assert.ok(appShellFiles.includes('/index.html'), 'Offline shell must contain index.html.');
assert.ok(appShellFiles.some((file) => file.endsWith('.wasm')), 'Offline shell must contain SQLite WASM.');
assert.ok(appShellFiles.some((file) => file.endsWith('.css')), 'Offline shell must contain core CSS.');
assert.ok(appShellFiles.some((file) => file.endsWith('.js')), 'Offline shell must contain core JavaScript.');
assert.equal(
  appShellFiles.some((file) => file.startsWith('/assets/themes/') || path.basename(file).startsWith('theme-')),
  false,
  'Optional themes must not be installed with the core app shell.',
);

for (const url of appShellFiles) {
  assert.ok(
    fs.existsSync(path.join(outputDirectory, url.slice(1))),
    `App-shell file is missing from build output: ${url}`,
  );
}

const liquidThemeAssets = fs.readdirSync(path.join(outputDirectory, 'assets'))
  .filter((file) => file.startsWith('theme-liquid-'));
assert.ok(liquidThemeAssets.length >= 2, 'Liquid theme must be emitted as optional CSS/runtime assets.');
liquidThemeAssets.forEach((file) => {
  assert.equal(appShellFiles.includes(`/assets/${file}`), false, `${file} must remain on demand.`);
});

const entryMatch = indexHtml.match(
  /<script type="module"[^>]*src="(?:\.\/|\/)assets\/([^"]+\.js)"/,
);
assert.ok(entryMatch, 'Built index.html must reference a JavaScript entry.');
const entryBytes = fs.readFileSync(path.join(outputDirectory, 'assets', entryMatch[1]));
const entryGzipBytes = zlib.gzipSync(entryBytes).byteLength;
assert.ok(
  entryGzipBytes <= 180 * 1024,
  `Core JavaScript gzip budget exceeded: ${entryGzipBytes} bytes.`,
);

function createInstallHarness(failingUrl = null) {
  const listeners = new Map();
  const stores = new Map();
  let skipWaitingCalls = 0;
  let fetchCalls = 0;
  let clientClaimCalls = 0;
  let cacheOperationsFail = false;
  const assertCacheAvailable = () => {
    if (cacheOperationsFail) throw new Error('Cache Storage unavailable');
  };
  const cacheStorage = {
    async delete(name) {
      assertCacheAvailable();
      return stores.delete(name);
    },
    async keys() {
      assertCacheAvailable();
      return [...stores.keys()];
    },
    async open(name) {
      assertCacheAvailable();
      if (!stores.has(name)) {
        const entries = new Map();
        stores.set(name, {
          entries,
          async match(key) {
            return entries.get(String(key?.url || key));
          },
          async put(key, response) {
            entries.set(String(key?.url || key), response);
          },
        });
      }
      return stores.get(name);
    },
  };
  class HarnessRequest {
    constructor(input, init = {}) {
      this.url = new URL(String(input), 'https://offline.test').href;
      this.method = init.method || 'GET';
      this.mode = init.mode || 'same-origin';
    }
  }
  const serviceWorkerGlobal = {
    registration: { active: null },
    location: { origin: 'https://offline.test' },
    clients: {
      async claim() {
        clientClaimCalls += 1;
      },
    },
    async skipWaiting() {
      skipWaitingCalls += 1;
    },
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
  };
  const context = vm.createContext({
    URL,
    Request: HarnessRequest,
    Response,
    Set,
    console,
    caches: cacheStorage,
    fetch: async (request) => {
      fetchCalls += 1;
      const pathname = new URL(request.url).pathname;
      return new Response(`asset:${pathname}`, {
        status: pathname === failingUrl ? 503 : 200,
      });
    },
    self: serviceWorkerGlobal,
  });
  vm.runInContext(source, context, { filename: serviceWorkerPath });
  return {
    listeners,
    stores,
    createRequest: (input, init) => new HarnessRequest(input, init),
    readFetchCalls: () => fetchCalls,
    readSkipWaitingCalls: () => skipWaitingCalls,
    readClientClaimCalls: () => clientClaimCalls,
    setCacheOperationsFail(value) {
      cacheOperationsFail = value;
    },
    async seedCache(name, key, body) {
      const cache = await cacheStorage.open(name);
      await cache.put(key, new Response(body));
    },
  };
}

async function runInstall(harness) {
  let installPromise;
  harness.listeners.get('install')({
    waitUntil(promise) {
      installPromise = promise;
    },
  });
  assert.ok(installPromise, 'Install handler must register atomic work.');
  return installPromise;
}

async function runActivate(harness) {
  let activatePromise;
  harness.listeners.get('activate')({
    waitUntil(promise) {
      activatePromise = promise;
    },
  });
  assert.ok(activatePromise, 'Activate handler must register cleanup work.');
  return activatePromise;
}

const failedInstall = createInstallHarness(appShellFiles.at(-2));
await assert.rejects(runInstall(failedInstall));
assert.equal(failedInstall.stores.size, 0, 'Failed app-shell install must remove its partial cache.');

const successfulInstall = createInstallHarness();
await runInstall(successfulInstall);
assert.equal(successfulInstall.stores.size, 1, 'Successful install must publish one versioned cache.');
assert.equal(
  successfulInstall.readSkipWaitingCalls(),
  0,
  'A downloaded page version must wait for explicit user activation.',
);
assert.equal(
  [...successfulInstall.stores.values()][0].entries.size,
  appShellFiles.length,
  'Successful install must cache the entire manifest before activation.',
);
const installFetchCalls = successfulInstall.readFetchCalls();
let navigationResponsePromise;
successfulInstall.listeners.get('fetch')({
  request: successfulInstall.createRequest('/timeline', { mode: 'navigate' }),
  respondWith(promise) {
    navigationResponsePromise = promise;
  },
});
assert.ok(navigationResponsePromise, 'Navigation must be handled by the installed app shell.');
assert.equal(
  await (await navigationResponsePromise).text(),
  'asset:/index.html',
  'A normal navigation must keep the currently installed page version.',
);
assert.equal(
  successfulInstall.readFetchCalls(),
  installFetchCalls,
  'A controlled navigation must not switch to the server page before user activation.',
);

successfulInstall.setCacheOperationsFail(true);
let recoveryNavigationResponsePromise;
successfulInstall.listeners.get('fetch')({
  request: successfulInstall.createRequest('/recovery', { mode: 'navigate' }),
  respondWith(promise) {
    recoveryNavigationResponsePromise = promise;
  },
});
assert.ok(recoveryNavigationResponsePromise, 'Navigation recovery must still be handled.');
assert.equal(
  await (await recoveryNavigationResponsePromise).text(),
  'asset:/recovery',
  'Cache Storage failure must fall back to the online navigation.',
);
successfulInstall.setCacheOperationsFail(false);

const brokenShellVersion = 'e564a69322ae3fc8';
assert.notEqual(
  shellVersion,
  brokenShellVersion,
  'The recovery worker must have a new shell version.',
);
const recoveryInstall = createInstallHarness();
await recoveryInstall.seedCache(
  `dmg-app-shell-${brokenShellVersion}`,
  '/index.html',
  'previous:/index.html',
);
await runInstall(recoveryInstall);
assert.equal(
  recoveryInstall.readSkipWaitingCalls(),
  1,
  'The known broken page version must be recovered without another page click.',
);
await runActivate(recoveryInstall);
assert.equal(
  recoveryInstall.stores.has(`dmg-app-shell-${brokenShellVersion}`),
  true,
  'Activation must retain one previous shell as an emergency fallback.',
);

const unavailableCacheInstall = createInstallHarness();
unavailableCacheInstall.setCacheOperationsFail(true);
await runInstall(unavailableCacheInstall);
assert.equal(
  unavailableCacheInstall.readSkipWaitingCalls(),
  1,
  'Cache Storage failure must activate the online recovery worker.',
);
await runActivate(unavailableCacheInstall);
assert.equal(
  unavailableCacheInstall.readClientClaimCalls(),
  1,
  'Cache cleanup failure must not block navigation recovery.',
);
const messageListener = successfulInstall.listeners.get('message');
assert.ok(messageListener, 'Service worker must expose explicit update activation.');
let reportedPageVersion;
messageListener({
  data: { type: 'GET_PAGE_VERSION' },
  ports: [{ postMessage(value) { reportedPageVersion = value; } }],
});
assert.deepEqual(
  JSON.parse(JSON.stringify(reportedPageVersion)),
  {
    schemaVersion: 1,
    releaseVersion,
    shellVersion,
  },
  'The active worker must report the exact installed release and shell versions.',
);
messageListener({ data: { type: 'SKIP_WAITING' } });
assert.equal(
  successfulInstall.readSkipWaitingCalls(),
  1,
  'Explicit user activation must release the waiting page version.',
);

console.log(
  `ATOMIC_SW_OK release=${releaseVersion} version=${shellVersion} files=${appShellFiles.length} `
  + `entryGzip=${entryGzipBytes} optionalLiquidAssets=${liquidThemeAssets.length}`,
);
