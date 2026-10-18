// The service worker (docs/re/shell.md, "Offline"): the game works offline once played.
// - The page: from the network when online, else the cached copy.
// - Built code (hashed names) and game data: from the cache, fetched and kept on first use.
//   Music tracks are cached as they first play.
// - Unhashed game data (assets/*.pack, the sound bank, the music) is refreshed in the background
//   after it is served from the cache, so a new deploy reaches players on their next visit.
const CACHE = 'tetris-plus-v1';
const CORE = ['./', 'index.html', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

const HASHED = /-[A-Za-z0-9_-]{8}\.(js|css)$/;

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  // Range requests (video seeking) go straight to the network.
  if (req.headers.has('range')) return;
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) caches.open(CACHE).then((c) => c.put('index.html', res.clone()));
          return res;
        })
        .catch(() => caches.match('index.html')),
    );
    return;
  }
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const hit = await cache.match(req);
      const refresh = fetch(req).then((res) => {
        if (res.ok && res.status === 200) cache.put(req, res.clone());
        return res;
      });
      if (hit) {
        if (!HASHED.test(url.pathname)) e.waitUntil(refresh.catch(() => undefined));
        return hit;
      }
      return refresh;
    }),
  );
});

