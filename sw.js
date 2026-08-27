const CACHE='column-matrix-v222-shell-20260827';
const SHELL=['./','./index.html','./manifest.webmanifest','./icon.svg','./icons/icon-192.png','./icons/icon-512.png','./matrix.js','./yulia-gap-fix.js','./server-runtime-direct.js','./ai-analyzer.js','./history-result-column-fix.js'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==CACHE).map(x=>caches.delete(x)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{
 if(e.request.method!=='GET')return;
 const u=new URL(e.request.url);
 if(u.pathname.endsWith('/keno-history.json')||u.pathname.endsWith('/internal-forecast-archive.json')||u.hostname==='raw.githubusercontent.com'){
   e.respondWith(fetch(e.request,{cache:'no-store'})); return;
 }
 if(u.origin===self.location.origin){
   e.respondWith(fetch(new Request(e.request,{cache:'no-store'})).then(r=>{const cp=r.clone();caches.open(CACHE).then(c=>c.put(e.request,cp)).catch(()=>{});return r;}).catch(()=>caches.match(e.request)));
 }
});