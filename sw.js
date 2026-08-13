const CACHE='matrix-top3-v1.1.1-lab';
const ASSETS=['./','./index.html','./styles.css','./app.js','./top3-data.js','./top3-live.json','./matrix-logo.png','./manifest.webmanifest','./icon-192.png','./icon-512.png'];
const NETWORK_FIRST=['/','/index.html','/app.js','/styles.css','/top3-live.json'];

self.addEventListener('install',e=>e.waitUntil(
  caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting())
));
self.addEventListener('activate',e=>e.waitUntil(
  caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())
));
self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET')return;const path=new URL(e.request.url).pathname;const networkFirst=NETWORK_FIRST.some(x=>path.endsWith(x));
  if(networkFirst){e.respondWith(fetch(e.request,{cache:'no-store'}).then(resp=>{const copy=resp.clone();caches.open(CACHE).then(c=>c.put(e.request,copy));return resp}).catch(()=>caches.match(e.request)));return}
  e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request).then(resp=>{const copy=resp.clone();caches.open(CACHE).then(c=>c.put(e.request,copy));return resp})));
});
