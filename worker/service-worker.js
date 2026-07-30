// dmg-service-worker: dynamic-v1
const RESOURCE_CACHE_NAME = 'dmg-resource-pack-v1';
const IMAGE_CACHE_NAME = 'dmg-image-pack-v1';
const LEGACY_PAGE_CACHE_PREFIXES = [
  'workbox-precache',
  'dmg-app-shell',
  'dmg-sw-client-migration',
];
const hadPreviousServiceWorker = Boolean(self.registration.active);

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const cacheNames = await caches.keys();
    await Promise.all(cacheNames
      .filter((cacheName) => LEGACY_PAGE_CACHE_PREFIXES.some(
        (prefix) => cacheName.startsWith(prefix),
      ))
      .map((cacheName) => caches.delete(cacheName)));

    await self.clients.claim();
    if (!hadPreviousServiceWorker) return;

    const windowClients = await self.clients.matchAll({
      type: 'window',
      includeUncontrolled: true,
    });
    const refreshToken = String(Date.now());
    await Promise.all(windowClients.map(async (client) => {
      const target = new URL(client.url);
      target.searchParams.set('__sw_recovery', refreshToken);
      try {
        await client.navigate(target.href);
      } catch {
        // The client may have closed while this worker was activating.
      }
    }));
  })());
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

async function readInstalledPackage(request, cacheName) {
  const cache = await caches.open(cacheName);
  return (await cache.match(request)) || fetch(request);
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
  }
});
