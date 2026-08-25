'use strict';

import fs from 'node:fs/promises';
import crypto from 'node:crypto';

const INDEX = 'index.html';

const assets = [
  'matrix.js',
  'yulia-gap-fix.js',
  'ai-analyzer.js',
  'archive-result-icon-fix.js'
];

async function fileHash(path) {
  const data = await fs.readFile(path);
  return crypto.createHash('sha256').update(data).digest('hex').slice(0, 12);
}

let html = await fs.readFile(INDEX, 'utf8');
let changed = false;

for (const asset of assets) {
  try {
    const hash = await fileHash(asset);

    const escaped = asset.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(<script\\s+src=["']${escaped})(?:\\?v=[^"']*)?(["'][^>]*><\\/script>)`, 'g');

    const next = html.replace(re, `$1?v=${hash}$2`);

    if (next !== html) {
      html = next;
      changed = true;
      console.log(`${asset} -> ?v=${hash}`);
    } else {
      console.log(`${asset}: script tag not found in index.html`);
    }
  } catch (e) {
    console.log(`${asset}: skipped (${e.message})`);
  }
}

if (changed) {
  await fs.writeFile(INDEX, html, 'utf8');
  console.log('index.html cache versions updated');
} else {
  console.log('index.html already up to date');
}
