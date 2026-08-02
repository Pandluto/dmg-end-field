const RESOURCE_CACHE_NAME = 'dmg-resource-pack-v1';
const IMAGE_CACHE_NAME = 'dmg-image-pack-v1';
const THEME_CACHE_NAME = 'dmg-theme-assets-v1';
const APP_SHELL_CACHE_PREFIX = 'dmg-app-shell-';
const APP_SHELL_VERSION = '__DMG_APP_SHELL_VERSION__';
const APP_SHELL_FILES = /*__DMG_APP_SHELL_FILES__*/[];
const APP_SHELL_FILE_PATHS = new Set(APP_SHELL_FILES);
const HAS_BUILT_APP_SHELL = APP_SHELL_FILES.length > 0
  && APP_SHELL_VERSION !== '__DMG_APP_SHELL_VERSION__';
const APP_SHELL_CACHE_NAME = `${APP_SHELL_CACHE_PREFIX}${APP_SHELL_VERSION}`;
const LEGACY_PAGE_CACHE_PREFIXES = [
  'workbox-precache',
  'dmg-sw-client-migration',
];

async function installAtomicAppShell() {
  if (!HAS_BUILT_APP_SHELL) return;
  await caches.delete(APP_SHELL_CACHE_NAME);
  const cache = await caches.open(APP_SHELL_CACHE_NAME);
  try {
    for (const url of APP_SHELL_FILES) {
      const response = await fetch(new Request(url, { cache: 'reload' }));
      if (!response.ok) {
        throw new Error(`App shell request failed: ${url} (${response.status})`);
      }
      await cache.put(url, response);
    }
  } catch (error) {
    await caches.delete(APP_SHELL_CACHE_NAME);
    throw error;
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    await installAtomicAppShell();
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const cacheNames = await caches.keys();
    await Promise.all(cacheNames
      .filter((cacheName) => (
        LEGACY_PAGE_CACHE_PREFIXES.some((prefix) => cacheName.startsWith(prefix))
        || (
          cacheName.startsWith(APP_SHELL_CACHE_PREFIX)
          && cacheName !== APP_SHELL_CACHE_NAME
        )
      ))
      .map((cacheName) => caches.delete(cacheName)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

async function readInstalledPackage(request, cacheName) {
  const cache = await caches.open(cacheName);
  return (await cache.match(request)) || fetch(request);
}

async function readAppShell(request) {
  const cache = await caches.open(APP_SHELL_CACHE_NAME);
  return (await cache.match(request, { ignoreSearch: true })) || fetch(request);
}

async function readNavigation(request) {
  try {
    const response = await fetch(request);
    if (response.ok) return response;
  } catch {
    // The complete, versioned app shell is the offline fallback.
  }
  const cache = await caches.open(APP_SHELL_CACHE_NAME);
  const fallback = await cache.match('/index.html', { ignoreSearch: true });
  if (fallback) return fallback;
  return fetch(request);
}

async function readOptionalThemeAsset(request) {
  const cache = await caches.open(THEME_CACHE_NAME);
  const cached = await cache.match(request, { ignoreSearch: true });
  if (cached) {
    void fetch(request).then((response) => {
      if (response.ok) return cache.put(request, response);
      return undefined;
    }).catch(() => undefined);
    return cached;
  }
  const response = await fetch(request);
  if (response.ok) await cache.put(request, response.clone());
  return response;
}

function isOptionalThemeAsset(pathname) {
  const fileName = pathname.split('/').pop() || '';
  return pathname.startsWith('/assets/themes/')
    || (pathname.startsWith('/assets/') && fileName.startsWith('theme-'));
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.includes('/assets/images/')) {
    event.respondWith(readInstalledPackage(request, IMAGE_CACHE_NAME));
    return;
  }

  if (url.pathname.includes('/data/') && !url.pathname.includes('/src/')) {
    event.respondWith(readInstalledPackage(request, RESOURCE_CACHE_NAME));
    return;
  }

  if (!HAS_BUILT_APP_SHELL) return;

  if (request.mode === 'navigate') {
    event.respondWith(readNavigation(request));
    return;
  }

  if (isOptionalThemeAsset(url.pathname)) {
    event.respondWith(readOptionalThemeAsset(request));
    return;
  }

  if (APP_SHELL_FILE_PATHS.has(url.pathname)) {
    event.respondWith(readAppShell(request));
  }
});
