const IMAGE_CACHE_NAME = 'dmg-image-pack-v1';
const RESOURCE_CACHE_NAME = 'dmg-resource-pack-v1';
const THEME_CACHE_NAME = 'dmg-theme-assets-v1';

const CODE_OR_DOCUMENT_DESTINATIONS = new Set([
  'document',
  'script',
  'style',
]);
const CODE_OR_DOCUMENT_EXTENSIONS = /\.(?:html?|xhtml|cjs|mjs|js|css)$/i;

function hasResourcePath(pathname, prefix) {
  return pathname.startsWith(prefix) && pathname.length > prefix.length;
}

function isCodeOrDocumentRequest(request, pathname) {
  const accept = request.headers?.get?.('accept') || '';
  return CODE_OR_DOCUMENT_DESTINATIONS.has(request.destination)
    || accept.includes('text/html')
    || CODE_OR_DOCUMENT_EXTENSIONS.test(pathname);
}

function isInstalledImagePath(request, pathname) {
  return hasResourcePath(pathname, '/assets/images/')
    && !isCodeOrDocumentRequest(request, pathname);
}

function isInstalledDataPath(request, pathname) {
  return hasResourcePath(pathname, '/data/')
    && !pathname.includes('/src/')
    && !isCodeOrDocumentRequest(request, pathname);
}

function isOptionalThemeAsset(request, pathname) {
  const isThemePath = hasResourcePath(pathname, '/assets/themes/')
    || /^\/assets\/theme-[^/]+$/u.test(pathname);
  return isThemePath && !isCodeOrDocumentRequest(request, pathname);
}

async function putResponse(cache, request, response) {
  if (!response?.ok) return;
  try {
    await cache.put(request, response.clone());
  } catch {
    // A cache write must never turn a successful origin response into an error.
  }
}

function refreshThemeAsset(cache, request) {
  // Theme assets are optional. A stale cached value is immediately usable while
  // the newest value is refreshed opportunistically in the background.
  return Promise.resolve()
    .then(() => fetch(request))
    .then((response) => putResponse(cache, request, response))
    .catch(() => undefined);
}

async function readCacheFirst(request, cacheName, { refresh = false, waitUntil } = {}) {
  let cache;
  try {
    cache = await caches.open(cacheName);
    const cached = await cache.match(request);
    if (cached) {
      if (refresh) {
        const refreshPromise = refreshThemeAsset(cache, request);
        if (typeof waitUntil === 'function') waitUntil(refreshPromise);
        else void refreshPromise;
      }
      return cached;
    }
  } catch {
    // Cache Storage is an optimization for this worker. Fall through to origin.
  }

  const response = await fetch(request);
  if (cache) await putResponse(cache, request, response);
  return response;
}

function desktopResourceWorkerStatus() {
  return {
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
  };
}

self.addEventListener('install', (event) => {
  event.waitUntil(Promise.resolve(self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(Promise.resolve(self.clients.claim()));
});

self.addEventListener('message', (event) => {
  if (event.data?.type !== 'DESKTOP_RESOURCE_WORKER_STATUS') return;
  const response = desktopResourceWorkerStatus();
  const port = event.ports?.[0];
  if (port && typeof port.postMessage === 'function') {
    port.postMessage(response);
    return;
  }
  if (event.source && typeof event.source.postMessage === 'function') {
    event.source.postMessage(response);
  }
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || request.mode === 'navigate') return;

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }
  if (url.origin !== self.location.origin) return;
  // Agent Host requests carry tab-scoped capabilities and are lifecycle
  // traffic, never installable resources. Always leave them to the origin.
  if (url.pathname.startsWith('/agent-host/')) return;

  if (isInstalledImagePath(request, url.pathname)) {
    event.respondWith(readCacheFirst(request, IMAGE_CACHE_NAME));
    return;
  }

  if (isInstalledDataPath(request, url.pathname)) {
    event.respondWith(readCacheFirst(request, RESOURCE_CACHE_NAME));
    return;
  }

  if (isOptionalThemeAsset(request, url.pathname)) {
    const waitUntil = typeof event.waitUntil === 'function'
      ? (promise) => event.waitUntil(promise)
      : undefined;
    event.respondWith(readCacheFirst(request, THEME_CACHE_NAME, {
      refresh: true,
      waitUntil,
    }));
  }
});
