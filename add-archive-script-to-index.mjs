'use strict';

import fs from 'node:fs/promises';

const file = 'index.html';
let html = await fs.readFile(file, 'utf8');

if (!html.includes('archive-result-icon-fix.js')) {
  html = html.replace(
    /<\/body>/i,
    '<script src="archive-result-icon-fix.js?v=bootstrap"></script>\n</body>'
  );
  await fs.writeFile(file, html, 'utf8');
  console.log('PASS: archive-result-icon-fix.js added to index.html');
} else {
  console.log('PASS: archive-result-icon-fix.js already present');
}
