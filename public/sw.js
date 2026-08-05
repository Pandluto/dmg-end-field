const RESOURCE_CACHE_NAME = 'dmg-resource-pack-v1';
const IMAGE_CACHE_NAME = 'dmg-image-pack-v1';
const THEME_CACHE_NAME = 'dmg-theme-assets-v1';
const APP_SHELL_CACHE_PREFIX = 'dmg-app-shell-';
const APP_RELEASE_VERSION = '__DMG_APP_RELEASE_VERSION__';
const APP_SHELL_VERSION = '__DMG_APP_SHELL_VERSION__';
const APP_SHELL_FILES = /*__DMG_APP_SHELL_FILES__*/[];
const APP_SHELL_FILE_PATHS = new Set(APP_SHELL_FILES);
const HAS_BUILT_APP_SHELL = APP_SHELL_FILES.length > 0
  && APP_SHELL_VERSION !== '__DMG_APP_SHELL_VERSION__';
const APP_SHELL_CACHE_NAME = `${APP_SHELL_CACHE_PREFIX}${APP_SHELL_VERSION}`;
const RECOVERY_APP_SHELL_VERSIONS = new Set([
  // v1.8.2 site release v26 could reject navigation when Cache Storage failed.
  'e564a69322ae3fc8',
]);
const LEGACY_PAGE_CACHE_PREFIXES = [
  'workbox-precache',
  'dmg-sw-client-migration',
];

async function installAtomicAppShell() {
  if (!HAS_BUILT_APP_SHELL) return false;
  let cache;
  try {
    await caches.delete(APP_SHELL_CACHE_NAME);
    cache = await caches.open(APP_SHELL_CACHE_NAME);
  } catch {
    // An online-only worker is safer than leaving a broken worker in control.
    return false;
  }
  try {
    for (const url of APP_SHELL_FILES) {
      const response = await fetch(new Request(url, { cache: 'reload' }));
      if (!response.ok) {
        throw new Error(`App shell request failed: ${url} (${response.status})`);
      }
      try {
        await cache.put(url, response);
      } catch {
        await caches.delete(APP_SHELL_CACHE_NAME).catch(() => undefined);
        return false;
      }
    }
  } catch (error) {
    await caches.delete(APP_SHELL_CACHE_NAME).catch(() => undefined);
    throw error;
  }
  return true;
}

async function shouldActivateRecoveryWorker() {
  try {
    const cacheNames = await caches.keys();
    return cacheNames.some((cacheName) => (
      cacheName.startsWith(APP_SHELL_CACHE_PREFIX)
      && RECOVERY_APP_SHELL_VERSIONS.has(
        cacheName.slice(APP_SHELL_CACHE_PREFIX.length),
      )
    ));
  } catch {
    // Cache Storage failure is the incident this worker is designed to recover.
    return true;
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    await installAtomicAppShell();
    if (await shouldActivateRecoveryWorker()) {
      await self.skipWaiting();
    }
    // Other upgrades keep waiting until the user explicitly accepts them.
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    try {
      const cacheNames = await caches.keys();
      const previousAppShellCaches = cacheNames.filter((cacheName) => (
        cacheName.startsWith(APP_SHELL_CACHE_PREFIX)
        && cacheName !== APP_SHELL_CACHE_NAME
      ));
      const retainedFallbackCache = previousAppShellCaches[
        previousAppShellCaches.length - 1
      ];
      await Promise.allSettled(cacheNames
        .filter((cacheName) => (
          LEGACY_PAGE_CACHE_PREFIXES.some((prefix) => cacheName.startsWith(prefix))
          || (
            cacheName.startsWith(APP_SHELL_CACHE_PREFIX)
            && cacheName !== APP_SHELL_CACHE_NAME
            && cacheName !== retainedFallbackCache
          )
        ))
        .map((cacheName) => caches.delete(cacheName)));
    } catch {
      // Cache cleanup must never prevent the worker from restoring navigation.
    }
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
  if (event.data?.type === 'GET_PAGE_VERSION') {
    event.ports?.[0]?.postMessage({
      schemaVersion: 1,
      releaseVersion: APP_RELEASE_VERSION,
      shellVersion: APP_SHELL_VERSION,
    });
  }
});

async function readInstalledPackage(request, cacheName) {
  try {
    const cache = await caches.open(cacheName);
    const cached = await cache.match(request);
    if (cached) return cached;
  } catch {
    // Keep the online path available when Cache Storage is unavailable.
  }
  return fetch(request);
}

async function readAppShell(request) {
  try {
    const cache = await caches.open(APP_SHELL_CACHE_NAME);
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;
  } catch {
    // Keep the online path available when Cache Storage is unavailable.
  }
  return fetch(request);
}

async function readCachedNavigation(cacheName) {
  try {
    const cache = await caches.open(cacheName);
    return await cache.match('/index.html', { ignoreSearch: true });
  } catch {
    return undefined;
  }
}

async function readPreviousNavigation() {
  try {
    const cacheNames = (await caches.keys())
      .filter((cacheName) => (
        cacheName.startsWith(APP_SHELL_CACHE_PREFIX)
        && cacheName !== APP_SHELL_CACHE_NAME
      ))
      .reverse();
    for (const cacheName of cacheNames) {
      const cached = await readCachedNavigation(cacheName);
      if (cached) return cached;
    }
  } catch {
    // The original network failure remains the useful error in this case.
  }
  return undefined;
}

async function readNavigation(request) {
  const installed = await readCachedNavigation(APP_SHELL_CACHE_NAME);
  if (installed) return installed;
  try {
    return await fetch(request);
  } catch (networkError) {
    const previous = await readPreviousNavigation();
    if (previous) return previous;
    throw networkError;
  }
}

async function readOptionalThemeAsset(request) {
  try {
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
  } catch {
    return fetch(request);
  }
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
