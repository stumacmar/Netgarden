/* Netgarden service worker: the app opens without a signal once it has been loaded once.
 * App files are fetched network-first (so updates arrive) with the cache as fallback;
 * plant sprites are cached on first use. */
const CACHE = 'netgarden-v3';
const CORE = ['./', 'index.html', 'css/style.css', 'manifest.webmanifest', 'assets/sample-garden.jpg', 'assets/sprites/manifest.js', 'assets/icon.svg', 'assets/icon-192.png',
  'js/homography.js', 'js/phenology.js', 'js/plants.js', 'js/render.js', 'js/compose.js', 'js/beds.js', 'js/masks.js', 'js/renderapi.js', 'js/gif.js', 'js/site.js', 'js/care.js', 'js/app.js'];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(CORE.map(u => c.add(u).catch(() => null)))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request; if (req.method !== 'GET') return;
  const url = new URL(req.url); if (url.origin !== location.origin) return;
  const sprite = url.pathname.includes('/assets/sprites/') && !url.pathname.endsWith('manifest.js');
  e.respondWith(sprite
    ? caches.match(req).then(hit => hit || fetch(req).then(res => { if (res.ok) caches.open(CACHE).then(c => c.put(req, res.clone())); return res; }))
    : fetch(req).then(res => { if (res.ok) caches.open(CACHE).then(c => c.put(req, res.clone())); return res; })
      .catch(() => caches.match(req).then(hit => hit || (req.mode === 'navigate' ? caches.match('index.html') : undefined))));
});
