const CACHE='matrix-v2215';

const ASSETS=[
  './',
  './index.html',
  './matrix.js',
  './yulia-gap-fix.js',
  './ai-analyzer.js',
  './manifest.webmanifest',
  './icon.svg'
];

const RAW_BASE='https://raw.githubusercontent.com/arsazet17/pozitron-column-matrix-v1/main/';
const DIRECT={
  '/keno-history.json':'keno-history.json',
  '/internal-forecast-archive.json':'internal-forecast-archive.json',
  '/stoloto-status.json':'stoloto-status.json'
};

self.addEventListener('install', event => event.waitUntil(
  caches.open(CACHE)
    .then(cache => cache.addAll(ASSETS))
    .then(() => self.skipWaiting())
));

self.addEventListener('activate', event => event.waitUntil(
  caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim())
));

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  const u = new URL(event.request.url);

  // LIVE JSON: always directly from GitHub main, exactly the M5M principle.
  if (u.origin === self.location.origin) {
    const found = Object.entries(DIRECT).find(([suffix]) => u.pathname.endsWith(suffix));
    if (found) {
      const raw = new URL(found[1], RAW_BASE);
      raw.searchParams.set('ts', String(Date.now()));

      event.respondWith(
        fetch(raw.href, {
          method: 'GET',
          cache: 'no-store',
          mode: 'cors',
          credentials: 'omit'
        }).then(r => {
          if (!r.ok) throw new Error('Matrix RAW HTTP ' + r.status);
          return r;
        })
      );
      return;
    }
  }

  // Static app shell: network first, cache only as offline fallback.
  if (u.origin === self.location.origin) {
    event.respondWith(
      fetch(new Request(event.request, { cache:'no-store' }))
        .then(r => {
          const copy = r.clone();
          caches.open(CACHE).then(c => c.put(event.request, copy)).catch(() => {});
          return r;
        })
        .catch(() => caches.match(event.request))
    );
  }
});
