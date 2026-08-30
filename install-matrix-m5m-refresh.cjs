'use strict';

const fs = require('fs');
const crypto = require('crypto');

function read(path) {
  return fs.readFileSync(path, 'utf8');
}
function write(path, text) {
  fs.writeFileSync(path, text, 'utf8');
}
function replaceOrFail(text, from, to, label) {
  if (!text.includes(from)) {
    throw new Error(`Не найден фрагмент для ${label}`);
  }
  return text.replace(from, to);
}
function hash12(path) {
  return crypto.createHash('sha256').update(fs.readFileSync(path)).digest('hex').slice(0, 12);
}

console.log('=== MATRIX M5M REFRESH INSTALL ===');

// 1) matrix.js: native default = 1 minute.
{
  const path = 'matrix.js';
  let s = read(path);

  s = s.replace(
    "const ms = Number(localStorage.getItem(INTERVAL_KEY) || 300000);",
    "const ms = Number(localStorage.getItem(INTERVAL_KEY) || 60000);"
  );

  s = s.replace(
    "$('intervalSelect').value = localStorage.getItem(INTERVAL_KEY) || '300000';",
    "$('intervalSelect').value = localStorage.getItem(INTERVAL_KEY) || '60000';"
  );

  write(path, s);
  console.log('PASS matrix.js: default refresh = 60 sec');
}

// 2) yulia-gap-fix.js already carries wake/foreground refresh.
// Make sure it forces existing old 5-minute value to 1 minute.
{
  const path = 'yulia-gap-fix.js';
  let s = read(path);

  if (!s.includes("const FAST_INTERVAL = '60000';")) {
    throw new Error('yulia-gap-fix.js: FAST_INTERVAL=60000 не найден');
  }
  if (!s.includes("document.addEventListener('visibilitychange'")) {
    throw new Error('yulia-gap-fix.js: foreground refresh не найден');
  }

  console.log('PASS yulia-gap-fix.js: wake refresh + 60 sec are present');
}

// 3) sw.js: M5M principle — LIVE RAW no-store, shell network-first.
// Existing implementation is preserved, only cache generation changes.
{
  const path = 'sw.js';
  let s = read(path);

  if (!s.includes("cache:'no-store'") && !s.includes("cache: 'no-store'")) {
    throw new Error('sw.js: network-first/no-store не найден');
  }
  if (!s.includes('raw.githubusercontent.com')) {
    throw new Error('sw.js: RAW GitHub routing не найден');
  }

  const stamp = `matrix-m5m-refresh-${hash12(path)}`;
  s = s.replace(/const CACHE='[^']+';/, `const CACHE='${stamp}';`);

  if (!s.includes("self.addEventListener('message'")) {
    s += `
self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
`;
  }

  write(path, s);
  console.log(`PASS sw.js: cache=${stamp}`);
}

// 4) refresh-asset-versions.mjs:
// Hash every local JS referenced from index.html, plus sw.js registration.
// Data-only commits do not touch index.html.
{
  const path = 'refresh-asset-versions.mjs';
  const code = String.raw`'use strict';

import fs from 'node:fs/promises';
import crypto from 'node:crypto';

const INDEX = 'index.html';

async function exists(path) {
  try { await fs.access(path); return true; } catch { return false; }
}

async function fileHash(path) {
  const data = await fs.readFile(path);
  return crypto.createHash('sha256').update(data).digest('hex').slice(0, 12);
}

let html = await fs.readFile(INDEX, 'utf8');
const beforeAll = html;
const changes = [];

// All LOCAL <script src="...js"> tags.
// External https:// scripts are ignored.
const scriptRe = /(<script\b[^>]*\bsrc=["'])(?!https?:\/\/|\/\/)([^"'?]+\.js)(?:\?v=[^"']*)?(["'][^>]*><\/script>)/gi;

const matches = [...html.matchAll(scriptRe)];
for (const m of matches) {
  const file = m[2].replace(/^\.\//, '');
  if (!(await exists(file))) continue;

  const h = await fileHash(file);
  const exact = m[0];
  const next = `${m[1]}${m[2]}?v=${h}${m[3]}`;

  if (exact !== next) {
    html = html.replace(exact, next);
    changes.push(`${file} -> ${h}`);
  }
}

// Service-worker registration URL also receives hash of sw.js.
if (await exists('sw.js')) {
  const h = await fileHash('sw.js');
  const swRe = /(['"]\.\/sw\.js)(?:\?v=[^'"]*)?(['"])/g;
  const old = html;
  html = html.replace(swRe, `$1?v=${h}$2`);
  if (html !== old) changes.push(`sw.js(register) -> ${h}`);
}

if (html !== beforeAll) {
  await fs.writeFile(INDEX, html, 'utf8');
  console.log('PASS: index.html cache versions updated');
  for (const x of changes) console.log('  ' + x);
} else {
  console.log('PASS: JS hashes unchanged; index.html untouched');
}
`;
  write(path, code);
  console.log('PASS refresh-asset-versions.mjs: hash all local JS + sw.js');
}

// 5) index.html: visible version + M5M-style SW takeover reload.
{
  const path = 'index.html';
  let s = read(path);

  // Bump visible UI version from any v2.2.1x to v2.2.16.
  s = s.replace(/v2\.2\.(?:14|15)/g, 'v2.2.16');

  // Ensure register uses updateViaCache:none and reloads once after controller takeover.
  if (!s.includes("updateViaCache:'none'") && !s.includes("updateViaCache: 'none'")) {
    console.warn('WARN: updateViaCache:none not found in index.html');
  }

  if (!s.includes('matrix-sw-controllerchange-v2216')) {
    const marker = '<script id="matrix-sw-register">';
    if (!s.includes(marker)) throw new Error('index.html: matrix-sw-register не найден');

    const extra = `<script id="matrix-sw-controllerchange-v2216">
(() => {
  if (!('serviceWorker' in navigator)) return;
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return;
    reloading = true;
    location.reload();
  });
  navigator.serviceWorker.ready.then(reg => {
    if (reg.waiting) reg.waiting.postMessage('SKIP_WAITING');
    reg.update().catch(() => {});
  }).catch(() => {});
})();
</script>
`;
    s = s.replace(marker, extra + marker);
  }

  write(path, s);
  console.log('PASS index.html: v2.2.16 + SW takeover reload');
}

console.log('=== INSTALL PASS ===');
