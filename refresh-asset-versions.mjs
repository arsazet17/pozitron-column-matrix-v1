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

async function exists(path) {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}

async function fileHash(path) {
  const data = await fs.readFile(path);
  return crypto
    .createHash('sha256')
    .update(data)
    .digest('hex')
    .slice(0, 12);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

let html = await fs.readFile(INDEX, 'utf8');
let changed = false;

for (const asset of assets) {
  if (!(await exists(asset))) continue;

  const version = await fileHash(asset);
  const name = escapeRegExp(asset);

  const scriptRe = new RegExp(
    `(<script\\b[^>]*\\bsrc=["']${name})(?:\\?v=[^"']*)?(["'][^>]*><\\/script>)`,
    'gi'
  );

  const before = html;
  html = html.replace(scriptRe, `$1?v=${version}$2`);

  if (html !== before) {
    changed = true;
    console.log(`${asset} -> ?v=${version}`);
  }
}

if (changed) {
  await fs.writeFile(INDEX, html, 'utf8');
  console.log('PASS: index.html versions updated');
} else {
  console.log('PASS: versions already current');
}
