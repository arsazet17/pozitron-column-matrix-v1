'use strict';

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

const scriptRe = /(<script\b[^>]*\bsrc=["'])(?!https?:\/\/|\/\/)([^"'?]+\.js)(?:\?v=[^"']*)?(["'][^>]*><\/script>)/gi;
const matches = [...html.matchAll(scriptRe)];

for (const m of matches) {
  const file = m[2].replace(/^\.\//, '');
  if (!(await exists(file))) continue;

  const h = await fileHash(file);
  const exact = m[0];
  const next = m[1] + m[2] + '?v=' + h + m[3];

  if (exact !== next) {
    html = html.replace(exact, next);
    changes.push(file + ' -> ' + h);
  }
}

if (await exists('sw.js')) {
  const h = await fileHash('sw.js');
  const swRe = /(['"]\.\/sw\.js)(?:\?v=[^'"]*)?(['"])/g;
  const old = html;
  html = html.replace(swRe, '$1?v=' + h + '$2');
  if (html !== old) changes.push('sw.js(register) -> ' + h);
}

if (html !== beforeAll) {
  await fs.writeFile(INDEX, html, 'utf8');
  console.log('PASS: index.html cache versions updated');
  for (const x of changes) console.log('  ' + x);
} else {
  console.log('PASS: JS hashes unchanged; index.html untouched');
}
