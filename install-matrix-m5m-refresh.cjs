'use strict';

const fs = require('fs');
const crypto = require('crypto');

function read(path) { return fs.readFileSync(path, 'utf8'); }
function write(path, text) { fs.writeFileSync(path, text, 'utf8'); }
function hash12(path) {
  return crypto.createHash('sha256').update(fs.readFileSync(path)).digest('hex').slice(0, 12);
}

console.log('=== MATRIX M5M REFRESH INSTALL ===');

// matrix.js: 1 minute default.
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
  console.log('PASS matrix.js');
}

// yulia-gap-fix.js already must contain wake refresh + FAST_INTERVAL=60000.
{
  const s = read('yulia-gap-fix.js');
  if (!s.includes("const FAST_INTERVAL = '60000';")) {
    throw new Error('FAST_INTERVAL=60000 missing');
  }
  if (!s.includes("visibilitychange")) {
    throw new Error('wake refresh missing');
  }
  console.log('PASS yulia-gap-fix.js');
}

// sw.js: preserve M5M network-first/no-store principle; rotate cache.
{
  const path = 'sw.js';
  let s = read(path);
  if (!s.includes('raw.githubusercontent.com')) throw new Error('RAW routing missing');
  if (!s.includes("cache:'no-store'") && !s.includes("cache: 'no-store'")) {
    throw new Error('no-store missing');
  }

  const stamp = 'matrix-m5m-refresh-' + hash12(path);
  s = s.replace(/const CACHE='[^']+';/, "const CACHE='" + stamp + "';");

  if (!s.includes("self.addEventListener('message'")) {
    s += "\nself.addEventListener('message', event => {\n" +
         "  if (event.data === 'SKIP_WAITING') self.skipWaiting();\n" +
         "});\n";
  }

  write(path, s);
  console.log('PASS sw.js ' + stamp);
}

// index.html: visible version + SW takeover reload.
{
  const path = 'index.html';
  let s = read(path);
  s = s.replace(/v2\.2\.(14|15)/g, 'v2.2.16');

  if (!s.includes('matrix-sw-controllerchange-v2216')) {
    const marker = '<script id="matrix-sw-register">';
    if (!s.includes(marker)) throw new Error('matrix-sw-register missing');

    const extra =
      '<script id="matrix-sw-controllerchange-v2216">\\n' +
      '(() => {\\n' +
      "  if (!('serviceWorker' in navigator)) return;\\n" +
      '  let reloading = false;\\n' +
      "  navigator.serviceWorker.addEventListener('controllerchange', () => {\\n" +
      '    if (reloading) return;\\n' +
      '    reloading = true;\\n' +
      '    location.reload();\\n' +
      '  });\\n' +
      '  navigator.serviceWorker.ready.then(reg => {\\n' +
      "    if (reg.waiting) reg.waiting.postMessage('SKIP_WAITING');\\n" +
      '    reg.update().catch(() => {});\\n' +
      '  }).catch(() => {});\\n' +
      '})();\\n' +
      '</script>\\n';

    s = s.replace(marker, extra + marker);
  }

  write(path, s);
  console.log('PASS index.html');
}

console.log('=== INSTALL PASS ===');
