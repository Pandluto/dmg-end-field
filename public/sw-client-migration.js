const CLIENT_REFRESH_MARKER_CACHE = 'dmg-sw-client-migration-v1';
const CLIENT_REFRESH_MARKER_PATH = '/__dmg_sw_client_migration_v1__';
const hadPreviousServiceWorker = Boolean(self.registration.active);

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const markerCache = await caches.open(CLIENT_REFRESH_MARKER_CACHE);
    const markerRequest = new Request(
      new URL(CLIENT_REFRESH_MARKER_PATH, self.location.origin),
    );
    if (await markerCache.match(markerRequest)) return;

    await markerCache.put(markerRequest, new Response('complete'));
    if (!hadPreviousServiceWorker) return;

    await self.clients.claim();
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
