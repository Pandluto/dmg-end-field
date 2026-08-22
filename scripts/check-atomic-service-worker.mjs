import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import zlib from 'node:zlib';

const outputDirectory = path.resolve(process.argv[2] || 'dist');
const serviceWorkerPath = path.join(outputDirectory, 'sw.js');
const indexPath = path.join(outputDirectory, 'index.html');
const cacheRecoveryPath = path.join(outputDirectory, 'cache-recovery.html');
const versionManifestPath = path.join(outputDirectory, 'version.json');
const source = fs.readFileSync(serviceWorkerPath, 'utf8');
const indexHtml = fs.readFileSync(indexPath, 'utf8');
const cacheRecoveryHtml = fs.readFileSync(cacheRecoveryPath, 'utf8');
const versionManifest = JSON.parse(fs.readFileSync(versionManifestPath, 'utf8'));
const incidentShellVersions = [
  'e564a69322ae3fc8',
  '79ce3dba11d89ada',
  '7b6e63d83be550ff',
  '581ba284e45339c7',
];

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
for (const incidentShellVersion of incidentShellVersions) {
  assert.ok(
    indexHtml.includes(incidentShellVersion),
    `Built index must request recovery from incident shell ${incidentShellVersion}.`,
  );
}
assert.match(
  indexHtml,
  /recoveryShellVersions\.has\(shellVersion\)[\s\S]*__DMG_ENSURE_SERVICE_WORKER__/,
  'A hard-refreshed incident shell must run the complete controller migration transaction.',
);
assert.match(
  indexHtml,
  /readWorkerShellVersion\(worker\)[\s\S]*worker\.postMessage\(\{ type: 'SKIP_WAITING' \}\)[\s\S]*waitForTargetController/,
  'Recovery must install, activate, and confirm the matching controller before continuing.',
);

const appShellFiles = JSON.parse(filesMatch[1]);
assert.ok(appShellFiles.includes('/index.html'), 'Offline shell must contain index.html.');
assert.equal(
  appShellFiles.includes('/cache-recovery.html'),
  false,
  'Cache recovery must stay outside every versioned app shell.',
);
assert.match(
  cacheRecoveryHtml,
  /navigator\.serviceWorker\.getRegistrations\(\)/,
  'Cache recovery must unregister service workers.',
);
assert.match(cacheRecoveryHtml, /caches\.keys\(\)/, 'Cache recovery must enumerate app caches.');
assert.doesNotMatch(
  cacheRecoveryHtml,
  /searchParams\.set\(['"]cache-recovery['"]/,
  'Cache recovery must return to the clean root URL without a recovery query.',
);
assert.doesNotMatch(
  cacheRecoveryHtml,
  /(?:localStorage|sessionStorage)\.clear\(|indexedDB\.deleteDatabase\(/,
  'Cache recovery must preserve workspace and browser storage.',
);
assert.ok(
  appShellFiles.includes('/assets/images/_manifest.json'),
  'Offline shell must contain the browser image index used during workspace startup.',
);
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

function createInstallHarness(failingUrl = null, failureCount = Number.POSITIVE_INFINITY) {
  const listeners = new Map();
  const stores = new Map();
  let skipWaitingCalls = 0;
  let fetchCalls = 0;
  let clientClaimCalls = 0;
  let cacheOperationsFail = false;
  let remainingFailures = failureCount;
  const normalizeCacheKey = (key) => new URL(
    String(key?.url || key),
    'https://offline.test',
  ).href;
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
            return entries.get(normalizeCacheKey(key));
          },
          async put(key, response) {
            entries.set(normalizeCacheKey(key), response);
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
  class HarnessMessageChannel {
    constructor() {
      this.port1 = {
        onmessage: null,
        close() {},
      };
      this.port2 = {
        postMessage: (value) => this.port1.onmessage?.({ data: value }),
      };
    }
  }
  let timerSequence = 0;
  const pendingTimers = new Set();
  const context = vm.createContext({
    clearTimeout(timerId) {
      pendingTimers.delete(timerId);
    },
    setTimeout(callback) {
      const timerId = ++timerSequence;
      pendingTimers.add(timerId);
      queueMicrotask(() => {
        if (!pendingTimers.delete(timerId)) return;
        callback();
      });
      return timerId;
    },
    MessageChannel: HarnessMessageChannel,
    TextDecoder,
    URL,
    Request: HarnessRequest,
    Response,
    Set,
    console,
    caches: cacheStorage,
    fetch: async (request) => {
      fetchCalls += 1;
      const pathname = new URL(request.url).pathname;
      const shouldFail = pathname === failingUrl && remainingFailures > 0;
      if (shouldFail) remainingFailures -= 1;
      return new Response(pathname === '/index.html' ? indexHtml : `asset:${pathname}`, {
        status: shouldFail ? 503 : 200,
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
    setActiveWorkerVersion(version) {
      serviceWorkerGlobal.registration.active = {
        postMessage(message, ports) {
          if (message?.type !== 'GET_PAGE_VERSION') return;
          ports?.[0]?.postMessage({
            schemaVersion: 1,
            releaseVersion,
            shellVersion: version,
          });
        },
      };
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

const transientInstall = createInstallHarness(appShellFiles.at(-2), 2);
await runInstall(transientInstall);
assert.equal(
  transientInstall.stores.size,
  1,
  'A release asset that appears late at the edge must be retried into a complete shell.',
);

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
  appShellFiles.length + 1,
  'Successful install must cache the entire manifest and its completion marker.',
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
assert.match(
  await (await navigationResponsePromise).text(),
  new RegExp(`dmg-app-shell-version" content="${shellVersion}`),
  'A normal navigation must keep the complete currently installed page version.',
);
assert.equal(
  successfulInstall.readFetchCalls(),
  installFetchCalls,
  'A controlled navigation must not switch to the server page before user activation.',
);

const cacheRecoveryHarness = createInstallHarness();
let cacheRecoveryResponsePromise;
cacheRecoveryHarness.listeners.get('fetch')({
  request: cacheRecoveryHarness.createRequest('/cache-recovery.html', { mode: 'navigate' }),
  respondWith(promise) {
    cacheRecoveryResponsePromise = promise;
  },
});
assert.ok(cacheRecoveryResponsePromise, 'Cache recovery must bypass the installed app shell.');
assert.equal(
  await (await cacheRecoveryResponsePromise).text(),
  'asset:/cache-recovery.html',
  'Cache recovery must always come directly from the network.',
);
assert.equal(
  cacheRecoveryHarness.readFetchCalls(),
  1,
  'Cache recovery must make exactly one network request.',
);

let imageIndexResponsePromise;
successfulInstall.listeners.get('fetch')({
  request: successfulInstall.createRequest('/assets/images/_manifest.json'),
  respondWith(promise) {
    imageIndexResponsePromise = promise;
  },
});
assert.ok(imageIndexResponsePromise, 'The browser image index must be handled offline.');
assert.equal(
  await (await imageIndexResponsePromise).text(),
  'asset:/assets/images/_manifest.json',
  'The browser image index must come from the atomic app shell, not the network.',
);
assert.equal(
  successfulInstall.readFetchCalls(),
  installFetchCalls,
  'Reading the browser image index must not fall through to the network.',
);

let agentHostRespondWithCalls = 0;
successfulInstall.listeners.get('fetch')({
  request: successfulInstall.createRequest('/agent-host/ui/state'),
  respondWith() {
    agentHostRespondWithCalls += 1;
  },
});
assert.equal(
  agentHostRespondWithCalls,
  0,
  'Agent Host protocol requests must bypass the atomic application cache.',
);

await successfulInstall.seedCache(
  'dmg-image-pack-v1',
  'https://offline.test/assets/images/cache-only.png',
  'installed-image',
);
let installedImageResponsePromise;
successfulInstall.listeners.get('fetch')({
  request: successfulInstall.createRequest('/assets/images/cache-only.png'),
  respondWith(promise) {
    installedImageResponsePromise = promise;
  },
});
assert.ok(installedImageResponsePromise, 'An installed image must be handled offline.');
assert.equal(
  await (await installedImageResponsePromise).text(),
  'installed-image',
  'Installed images must still come from the image package cache.',
);
assert.equal(
  successfulInstall.readFetchCalls(),
  installFetchCalls,
  'Reading an installed image must not fall through to the network.',
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

for (const brokenShellVersion of incidentShellVersions) {
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
    'A known broken page version must recover without another page click.',
  );
  await runActivate(recoveryInstall);
  assert.equal(
    recoveryInstall.readClientClaimCalls(),
    1,
    'A complete recovery worker must claim existing tabs after activation.',
  );
  assert.equal(
    recoveryInstall.stores.has(`dmg-app-shell-${brokenShellVersion}`),
    true,
    'Activation must retain one previous shell as an emergency fallback.',
  );
}

const missingOldCacheRecovery = createInstallHarness();
missingOldCacheRecovery.setActiveWorkerVersion(incidentShellVersions.at(-1));
await runInstall(missingOldCacheRecovery);
assert.equal(
  missingOldCacheRecovery.readSkipWaitingCalls(),
  1,
  'The latest incident controller must recover even when its app-shell cache is missing.',
);

const previousAssetFallback = createInstallHarness();
await previousAssetFallback.seedCache(
  `dmg-app-shell-${incidentShellVersions.at(-1)}`,
  'https://offline.test/assets/previous-release.js',
  'previous-release-asset',
);
await runInstall(previousAssetFallback);
await runActivate(previousAssetFallback);
let previousAssetResponsePromise;
previousAssetFallback.listeners.get('fetch')({
  request: previousAssetFallback.createRequest('/assets/previous-release.js'),
  respondWith(promise) {
    previousAssetResponsePromise = promise;
  },
});
assert.ok(previousAssetResponsePromise, 'A previous release asset must be handled offline.');
assert.equal(
  await (await previousAssetResponsePromise).text(),
  'previous-release-asset',
  'A retained previous index must keep its matching hashed assets, not only index.html.',
);

const unavailableCacheInstall = createInstallHarness();
unavailableCacheInstall.setCacheOperationsFail(true);
await assert.rejects(runInstall(unavailableCacheInstall));
assert.equal(
  unavailableCacheInstall.readSkipWaitingCalls(),
  0,
  'Cache Storage failure must never activate an incomplete worker.',
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
