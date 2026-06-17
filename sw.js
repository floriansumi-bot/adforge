/* AdForge — service worker DISABLED (kill switch).
   The offline cache was serving stale code during active development. This SW
   now caches nothing and removes itself + any old caches. (A properly-versioned
   SW can be reintroduced before final deployment if offline support is wanted.) */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    } catch {}
    await self.registration.unregister();
    const clients = await self.clients.matchAll();
    clients.forEach((c) => c.navigate(c.url));
  })());
});
// Pass-through: never serve from cache.
self.addEventListener('fetch', () => {});
