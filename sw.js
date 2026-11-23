// Pinoy BnB web: keeps the app's own files on the device so it opens without internet, and
// shows the pictures saved in this browser (guest IDs, payment screenshots, incident photos).
// Your data is never sent here; it stays in this browser. Licence checks always go online.
const CACHE = 'pbnb-app-v3';
// Only this app's old caches are removed (Rentals lives on the same site with its own).
const FILE_DB = 'pinoy-bnb-files';
const FILE_STORE = 'blobs';
const FILE_PREFIX = '__files/';

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['./', './index.html', './sql-wasm.js', './sql-wasm.wasm', './manifest.json'])).catch(() => undefined));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith('pbnb-app-') && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

function savedPicture(key) {
  return new Promise((resolve) => {
    const req = indexedDB.open(FILE_DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(FILE_STORE);
    req.onerror = () => resolve(null);
    req.onsuccess = () => {
      try {
        const r = req.result.transaction(FILE_STORE, 'readonly').objectStore(FILE_STORE).get(key);
        r.onsuccess = () => resolve(r.result || null);
        r.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    };
  });
}
async function answerPicture(key) {
  // A picture picked a moment ago may still be saving: wait up to ~3 seconds.
  for (let i = 0; i < 15; i++) {
    const b = await savedPicture(key);
    if (b) return new Response(b, { headers: { 'Content-Type': b.type || 'image/jpeg', 'Cache-Control': 'no-store' } });
    await new Promise((r) => setTimeout(r, 200));
  }
  return new Response('Not found', { status: 404 });
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  const scope = new URL(self.registration.scope);
  if (url.pathname.startsWith(scope.pathname + FILE_PREFIX)) {
    const key = decodeURIComponent(url.pathname.slice((scope.pathname + FILE_PREFIX).length));
    e.respondWith(answerPicture(key));
    return;
  }
  // Pages: try the network first (to get updates), fall back to the saved copy.
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req, { cache: 'no-cache' })
        .then((r) => {
          const copy = r.clone();
          caches.open(CACHE).then((c) => c.put('./index.html', copy));
          return r;
        })
        .catch(() => caches.match('./index.html')),
    );
    return;
  }
  // Files (code, pictures, database engine): saved copy first, then the network.
  e.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ||
        fetch(req).then((r) => {
          if (r.ok) {
            const copy = r.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return r;
        }),
    ),
  );
});
