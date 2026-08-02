import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import zlib from 'node:zlib';

const outputDirectory = path.resolve(process.argv[2] || 'dist');
const serviceWorkerPath = path.join(outputDirectory, 'sw.js');
const indexPath = path.join(outputDirectory, 'index.html');
const source = fs.readFileSync(serviceWorkerPath, 'utf8');
const indexHtml = fs.readFileSync(indexPath, 'utf8');

const versionMatch = source.match(/const APP_SHELL_VERSION = ("[a-f0-9]{16}");/);
const filesMatch = source.match(
  /const APP_SHELL_FILES = (\[[\s\S]*?\]);\nconst APP_SHELL_FILE_PATHS/,
);
assert.ok(versionMatch, 'Generated service worker must contain a content version.');
assert.ok(filesMatch, 'Generated service worker must contain an app-shell manifest.');

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

const entryMatch = indexHtml.match(/<script type="module"[^>]*src="\.\/assets\/([^"]+\.js)"/);
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
  const cacheStorage = {
    async delete(name) {
      return stores.delete(name);
    },
    async keys() {
      return [...stores.keys()];
    },
    async open(name) {
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
      async claim() {},
    },
    async skipWaiting() {},
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
      const pathname = new URL(request.url).pathname;
      return new Response(`asset:${pathname}`, {
        status: pathname === failingUrl ? 503 : 200,
      });
    },
    self: serviceWorkerGlobal,
  });
  vm.runInContext(source, context, { filename: serviceWorkerPath });
  return { listeners, stores };
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

const failedInstall = createInstallHarness(appShellFiles.at(-2));
await assert.rejects(runInstall(failedInstall));
assert.equal(failedInstall.stores.size, 0, 'Failed app-shell install must remove its partial cache.');

const successfulInstall = createInstallHarness();
await runInstall(successfulInstall);
assert.equal(successfulInstall.stores.size, 1, 'Successful install must publish one versioned cache.');
assert.equal(
  [...successfulInstall.stores.values()][0].entries.size,
  appShellFiles.length,
  'Successful install must cache the entire manifest before activation.',
);

console.log(
  `ATOMIC_SW_OK version=${JSON.parse(versionMatch[1])} files=${appShellFiles.length} `
  + `entryGzip=${entryGzipBytes} optionalLiquidAssets=${liquidThemeAssets.length}`,
);
