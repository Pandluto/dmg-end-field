import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workerPath = path.join(repositoryRoot, 'public', 'sw-desktop.js');
const workerSource = fs.readFileSync(workerPath, 'utf8');

const IMAGE_CACHE_NAME = 'dmg-image-pack-v1';
const RESOURCE_CACHE_NAME = 'dmg-resource-pack-v1';
const THEME_CACHE_NAME = 'dmg-theme-assets-v1';
const DESKTOP_ORIGIN = 'https://desktop.test';

class MockResponse {
  constructor(body, { ok = true, status = 200 } = {}) {
    this.body = body;
    this.ok = ok;
    this.status = status;
  }

  clone() {
    return new MockResponse(this.body, { ok: this.ok, status: this.status });
  }
}

class MockCache {
  constructor(name) {
    this.name = name;
    this.entries = new Map();
    this.matchCalls = [];
    this.putCalls = [];
    this.failMatch = false;
    this.failPut = false;
  }

  async match(request) {
    this.matchCalls.push(request.url);
    if (this.failMatch) throw new Error(`match failed: ${this.name}`);
    return this.entries.get(request.url);
  }

  async put(request, response) {
    this.putCalls.push(request.url);
    if (this.failPut) throw new Error(`put failed: ${this.name}`);
    this.entries.set(request.url, response);
  }
}

class MockCacheStorage {
  constructor() {
    this.cacheByName = new Map();
    this.openCalls = [];
    this.failOpen = new Set();
  }

  async open(name) {
    this.openCalls.push(name);
    if (this.failOpen.has(name)) throw new Error(`open failed: ${name}`);
    let cache = this.cacheByName.get(name);
    if (!cache) {
      cache = new MockCache(name);
      this.cacheByName.set(name, cache);
    }
    return cache;
  }

  cache(name) {
    return this.cacheByName.get(name);
  }
}

function createWorkerHarness() {
  const listeners = new Map();
  const cacheStorage = new MockCacheStorage();
  const fetchCalls = [];
  let skipWaitingCalls = 0;
  let claimCalls = 0;

  const self = {
    location: { origin: DESKTOP_ORIGIN },
    clients: {
      claim() {
        claimCalls += 1;
        return Promise.resolve();
      },
    },
    skipWaiting() {
      skipWaitingCalls += 1;
      return Promise.resolve();
    },
    addEventListener(type, listener) {
      const registered = listeners.get(type) || [];
      registered.push(listener);
      listeners.set(type, registered);
    },
  };

  const fetchMock = async (request) => {
    fetchCalls.push(request.url);
    return new MockResponse(`origin:${request.url}`);
  };

  const context = vm.createContext({
    URL,
    Promise,
    self,
    caches: cacheStorage,
    fetch: fetchMock,
    setTimeout,
    clearTimeout,
  });
  vm.runInContext(workerSource, context, { filename: workerPath });

  async function dispatch(type, event) {
    for (const listener of listeners.get(type) || []) listener(event);
    if (event.responsePromise) await event.responsePromise;
    if (event.waitUntilPromises) await Promise.all(event.waitUntilPromises);
    return event.responsePromise;
  }

  function fetchEvent(url, { method = 'GET', mode = 'cors', destination = '' } = {}) {
    let responsePromise;
    let respondWithCalls = 0;
    const waitUntilPromises = [];
    return {
      request: { url, method, mode, destination },
      respondWith(response) {
        respondWithCalls += 1;
        responsePromise = Promise.resolve(response);
      },
      waitUntil(promise) {
        waitUntilPromises.push(Promise.resolve(promise));
      },
      waitUntilPromises,
      get respondWithCalls() {
        return respondWithCalls;
      },
      get responsePromise() {
        return responsePromise;
      },
    };
  }

  function lifecycleEvent() {
    const waitUntilPromises = [];
    return {
      waitUntil(promise) {
        waitUntilPromises.push(Promise.resolve(promise));
      },
      waitUntilPromises,
    };
  }

  return {
    cacheStorage,
    fetchCalls,
    listeners,
    self,
    get claimCalls() {
      return claimCalls;
    },
    get skipWaitingCalls() {
      return skipWaitingCalls;
    },
    dispatch,
    fetchEvent,
    lifecycleEvent,
  };
}

async function assertResourceRoute(harness, url, expectedCacheName, expectedBody) {
  const event = harness.fetchEvent(url);
  await harness.dispatch('fetch', event);
  assert.equal(event.respondWithCalls, 1, `${url} should be handled`);
  const response = await event.responsePromise;
  assert.equal(response.body, expectedBody);
  assert.ok(harness.cacheStorage.openCalls.includes(expectedCacheName));
}

const harness = createWorkerHarness();

const installEvent = harness.lifecycleEvent();
await harness.dispatch('install', installEvent);
assert.equal(harness.skipWaitingCalls, 1, 'install must immediately call skipWaiting');

const activateEvent = harness.lifecycleEvent();
await harness.dispatch('activate', activateEvent);
assert.equal(harness.claimCalls, 1, 'activate must call clients.claim');

const navigation = harness.fetchEvent(`${DESKTOP_ORIGIN}/index.html`, {
  mode: 'navigate',
  destination: 'document',
});
await harness.dispatch('fetch', navigation);
assert.equal(navigation.respondWithCalls, 0, 'navigation must not be intercepted');

const genericAsset = harness.fetchEvent(`${DESKTOP_ORIGIN}/assets/app-icon.png`, {
  destination: 'image',
});
await harness.dispatch('fetch', genericAsset);
assert.equal(genericAsset.respondWithCalls, 0, 'generic /assets must not be intercepted');

const htmlAsset = harness.fetchEvent(`${DESKTOP_ORIGIN}/assets/images/not-an-image.html`);
await harness.dispatch('fetch', htmlAsset);
assert.equal(htmlAsset.respondWithCalls, 0, 'HTML must not be intercepted');

const scriptAsset = harness.fetchEvent(`${DESKTOP_ORIGIN}/data/not-a-script.js`, {
  destination: 'script',
});
await harness.dispatch('fetch', scriptAsset);
assert.equal(scriptAsset.respondWithCalls, 0, 'JavaScript must not be intercepted');

const styleAsset = harness.fetchEvent(`${DESKTOP_ORIGIN}/assets/themes/liquid-tide/theme.css`, {
  destination: 'style',
});
await harness.dispatch('fetch', styleAsset);
assert.equal(styleAsset.respondWithCalls, 0, 'CSS must not be intercepted');

const crossOriginImage = harness.fetchEvent('https://cdn.test/assets/images/remote.png', {
  destination: 'image',
});
await harness.dispatch('fetch', crossOriginImage);
assert.equal(crossOriginImage.respondWithCalls, 0, 'cross-origin resources must not be intercepted');

const agentHostRequest = harness.fetchEvent(`${DESKTOP_ORIGIN}/agent-host/ui/state`);
await harness.dispatch('fetch', agentHostRequest);
assert.equal(agentHostRequest.respondWithCalls, 0, 'Agent Host requests must never be cached');

const imageUrl = `${DESKTOP_ORIGIN}/assets/images/operator.png`;
await assertResourceRoute(harness, imageUrl, IMAGE_CACHE_NAME, `origin:${imageUrl}`);
const imageCache = harness.cacheStorage.cache(IMAGE_CACHE_NAME);
assert.ok(imageCache?.entries.has(imageUrl), 'image response must be installed in image cache');

const dataUrl = `${DESKTOP_ORIGIN}/data/characters/operator.json`;
await assertResourceRoute(harness, dataUrl, RESOURCE_CACHE_NAME, `origin:${dataUrl}`);
const resourceCache = harness.cacheStorage.cache(RESOURCE_CACHE_NAME);
assert.ok(resourceCache?.entries.has(dataUrl), 'data response must be installed in resource cache');

const excludedData = harness.fetchEvent(`${DESKTOP_ORIGIN}/data/src/not-installed.json`);
await harness.dispatch('fetch', excludedData);
assert.equal(excludedData.respondWithCalls, 0, '/data/src/ must not be intercepted');

const themeUrl = `${DESKTOP_ORIGIN}/assets/themes/liquid-tide/anmi-anniversary.jpg`;
const themeCache = await harness.cacheStorage.open(THEME_CACHE_NAME);
await themeCache.put(
  { url: themeUrl },
  new MockResponse('cached:theme'),
);
harness.cacheStorage.openCalls.length = 0;
harness.fetchCalls.length = 0;

const theme = harness.fetchEvent(themeUrl, { destination: 'image' });
await harness.dispatch('fetch', theme);
assert.equal(theme.respondWithCalls, 1, 'theme asset should be handled');
assert.equal((await theme.responsePromise).body, 'cached:theme', 'theme must be cache-first');
assert.equal(theme.waitUntilPromises.length, 1, 'theme refresh must extend the fetch event');
assert.deepEqual(harness.fetchCalls, [themeUrl], 'theme cache hit must refresh from origin once');
assert.equal(themeCache.entries.get(themeUrl)?.body, `origin:${themeUrl}`);
assert.deepEqual(harness.cacheStorage.openCalls, [THEME_CACHE_NAME]);

const cacheFailureUrl = `${DESKTOP_ORIGIN}/assets/images/cache-failure.png`;
harness.cacheStorage.failOpen.add(IMAGE_CACHE_NAME);
const cacheFailure = harness.fetchEvent(cacheFailureUrl, { destination: 'image' });
await harness.dispatch('fetch', cacheFailure);
assert.equal(cacheFailure.respondWithCalls, 1, 'cache failure must still use the route');
assert.equal(
  (await cacheFailure.responsePromise).body,
  `origin:${cacheFailureUrl}`,
  'cache failure must fall back to origin',
);

let statusMessage;
await harness.dispatch('message', {
  data: { type: 'DESKTOP_RESOURCE_WORKER_STATUS' },
  ports: [{ postMessage(message) { statusMessage = message; } }],
});
assert.deepEqual(JSON.parse(JSON.stringify(statusMessage)), {
  type: 'DESKTOP_RESOURCE_WORKER_STATUS',
  schemaVersion: 1,
  navigation: 'passthrough',
  caches: {
    images: IMAGE_CACHE_NAME,
    resources: RESOURCE_CACHE_NAME,
    themes: THEME_CACHE_NAME,
  },
  routes: {
    images: '/assets/images/**',
    resources: '/data/** (excluding /src/)',
    themes: '/assets/themes/** and /assets/theme-*',
  },
});

console.log('Desktop resource worker check passed.');
console.log('- navigation and generic assets are not intercepted');
console.log('- image, data, and theme routes use the expected caches');
console.log('- cache failures fall back to origin');
