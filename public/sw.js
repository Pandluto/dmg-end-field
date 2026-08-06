const RESOURCE_CACHE_NAME = 'dmg-resource-pack-v1';
const IMAGE_CACHE_NAME = 'dmg-image-pack-v1';
const THEME_CACHE_NAME = 'dmg-theme-assets-v1';
const APP_SHELL_CACHE_PREFIX = 'dmg-app-shell-';
const APP_SHELL_COMPLETE_MARKER = '/__dmg_app_shell_complete__';
const APP_RELEASE_VERSION = '__DMG_APP_RELEASE_VERSION__';
const APP_SHELL_VERSION = '__DMG_APP_SHELL_VERSION__';
const APP_SHELL_FILES = /*__DMG_APP_SHELL_FILES__*/[];
const APP_SHELL_FILE_PATHS = new Set(APP_SHELL_FILES);
const APP_SHELL_INSTALL_CONCURRENCY = 6;
const APP_SHELL_RETRY_DELAYS_MS = [0, 250, 750, 1_500, 3_000, 5_000, 8_000];
const HAS_BUILT_APP_SHELL = APP_SHELL_FILES.length > 0
  && APP_SHELL_VERSION !== '__DMG_APP_SHELL_VERSION__';
const APP_SHELL_CACHE_NAME = `${APP_SHELL_CACHE_PREFIX}${APP_SHELL_VERSION}`;
const RECOVERY_APP_SHELL_VERSIONS = new Set([
  // v1.8.2 site release v26 could reject navigation when Cache Storage failed.
  'e564a69322ae3fc8',
  // v1.8.2 site release v27 could reload before a slow worker finished installing.
  '79ce3dba11d89ada',
  // v1.8.2 site release v28 could accept an old controller and lose image delivery.
  '7b6e63d83be550ff',
  // v1.8.2 site release v29 fetched its image index outside the offline shell.
  '581ba284e45339c7',
]);
const LEGACY_PAGE_CACHE_PREFIXES = [
  'workbox-precache',
  'dmg-sw-client-migration',
];

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function fetchAppShellFile(url) {
  let lastError;
  for (const retryDelay of APP_SHELL_RETRY_DELAYS_MS) {
    if (retryDelay > 0) await delay(retryDelay);
    try {
      const response = await fetch(new Request(url, { cache: 'reload' }));
      if (!response.ok) {
        lastError = new Error(`App shell request failed: ${url} (${response.status})`);
        continue;
      }
      const bytes = await response.arrayBuffer();
      if (
        url === '/index.html'
        && !new TextDecoder().decode(bytes).includes(
          `<meta name="dmg-app-shell-version" content="${APP_SHELL_VERSION}"`,
        )
      ) {
        lastError = new Error(`App shell index version is not ${APP_SHELL_VERSION}`);
        continue;
      }
      // Consume every response before the next batch. Waiting on several
      // header-only responses can deadlock HTTP/1 connection pools while their
      // unread bodies occupy every available connection.
      return new Response(bytes, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error(`App shell request failed: ${url}`);
}

async function installAtomicAppShell() {
  if (!HAS_BUILT_APP_SHELL) return false;
  let cache;
  try {
    await caches.delete(APP_SHELL_CACHE_NAME);
    cache = await caches.open(APP_SHELL_CACHE_NAME);
  } catch (error) {
    throw new Error('App shell Cache Storage is unavailable.', { cause: error });
  }
  try {
    for (
      let offset = 0;
      offset < APP_SHELL_FILES.length;
      offset += APP_SHELL_INSTALL_CONCURRENCY
    ) {
      const batch = APP_SHELL_FILES.slice(
        offset,
        offset + APP_SHELL_INSTALL_CONCURRENCY,
      );
      const downloads = await Promise.all(batch.map(async (url) => ({
        url,
        response: await fetchAppShellFile(url),
      })));
      try {
        await Promise.all(downloads.map(({ url, response }) => (
          cache.put(url, response)
        )));
      } catch (error) {
        await caches.delete(APP_SHELL_CACHE_NAME).catch(() => undefined);
        throw new Error('App shell cache write failed.', { cause: error });
      }
    }
    await cache.put(
      APP_SHELL_COMPLETE_MARKER,
      new Response(APP_SHELL_VERSION, {
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      }),
    );
  } catch (error) {
    await caches.delete(APP_SHELL_CACHE_NAME).catch(() => undefined);
    throw error;
  }
  return true;
}

function readActiveWorkerShellVersion() {
  const activeWorker = self.registration.active;
  if (!activeWorker || typeof MessageChannel === 'undefined') {
    return Promise.resolve('');
  }
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const finish = (value) => {
      clearTimeout(timeout);
      channel.port1.close();
      resolve(value);
    };
    const timeout = setTimeout(() => finish(''), 1_000);
    channel.port1.onmessage = (event) => {
      finish(String(event.data?.shellVersion || ''));
    };
    try {
      activeWorker.postMessage({ type: 'GET_PAGE_VERSION' }, [channel.port2]);
    } catch {
      finish('');
    }
  });
}

async function shouldActivateRecoveryWorker() {
  const activeShellVersion = await readActiveWorkerShellVersion();
  if (RECOVERY_APP_SHELL_VERSIONS.has(activeShellVersion)) return true;
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

async function readPreviousAppShellResource(request) {
  try {
    const cacheNames = (await caches.keys())
      .filter((cacheName) => (
        cacheName.startsWith(APP_SHELL_CACHE_PREFIX)
        && cacheName !== APP_SHELL_CACHE_NAME
      ))
      .reverse();
    for (const cacheName of cacheNames) {
      const cache = await caches.open(cacheName);
      const cached = await cache.match(request, { ignoreSearch: true });
      if (cached) return cached;
    }
  } catch {
    // The current network request remains the useful fallback.
  }
  return undefined;
}

async function readAppShellResource(request) {
  try {
    const cache = await caches.open(APP_SHELL_CACHE_NAME);
    const current = await cache.match(request, { ignoreSearch: true });
    if (current) return current;
  } catch {
    // Try a complete previous shell or the network below.
  }
  const previous = await readPreviousAppShellResource(request);
  return previous || fetch(request);
}

async function readCachedNavigation(cacheName) {
  try {
    const cache = await caches.open(cacheName);
    if (cacheName === APP_SHELL_CACHE_NAME) {
      const marker = await cache.match(APP_SHELL_COMPLETE_MARKER);
      if (!marker || await marker.text() !== APP_SHELL_VERSION) return undefined;
    }
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
  // Agent Host responses are live, capability-bound protocol messages. They
  // must never be read from or written to an application cache.
  if (url.pathname.startsWith('/agent-host/')) return;

  // The generated browser image index lives below /assets/images/, but it is
  // application code metadata rather than an installed image. Serve every
  // explicit non-navigation shell entry before the generic package routes.
  if (
    HAS_BUILT_APP_SHELL
    && request.mode !== 'navigate'
    && APP_SHELL_FILE_PATHS.has(url.pathname)
  ) {
    event.respondWith(readAppShellResource(request));
    return;
  }

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

  if (APP_SHELL_FILE_PATHS.has(url.pathname) || url.pathname.startsWith('/assets/')) {
    event.respondWith(readAppShellResource(request));
  }
});
