'use strict';

const fs = require('fs');

function replaceOnce(source, oldText, newText, label) {
  if (!source.includes(oldText)) throw new Error(`${label}: target not found`);
  return source.replace(oldText, newText);
}

let ai = fs.readFileSync('ai-analyzer.js', 'utf8');

// 1) Phone reads the ready server INTERNAL archive.
if (!ai.includes('async function fetchServerInternalArchive()')) {
  const marker = '  function loadArchive() {';
  const block = `
  async function fetchServerInternalArchive() {
    try {
      const r = await fetch(\`internal-forecast-archive.json?ts=\${Date.now()}\`, { cache: 'no-store' });
      if (!r.ok) return;
      const server = await r.json();
      if (!Array.isArray(server)) return;

      const local = loadArchive();
      const map = new Map();

      [...local, ...server].forEach(rec => {
        const key = \`\${rec?.provider || 'openai'}:\${rec?.baseDraw}:\${rec?.targetDraw}\`;
        map.set(key, rec);
      });

      saveArchive(
        [...map.values()].sort(
          (a, b) => Number(a?.targetDraw || 0) - Number(b?.targetDraw || 0)
        )
      );
    } catch (_) {}
  }

`;
  ai = replaceOnce(ai, marker, block + marker, 'server archive loader');
}

// 2) Refresh UI from server archive BEFORE rendering history/current forecast.
const refreshOld = `    let archive = loadArchive();
    settleArchive(archive, draws);`;
const refreshNew = `    await fetchServerInternalArchive();
    let archive = loadArchive();
    settleArchive(archive, draws);`;

if (!ai.includes(refreshNew)) {
  ai = replaceOnce(ai, refreshOld, refreshNew, 'refresh server archive');
}

// 3) Phone must never create INTERNAL itself.
ai = ai.replace(/\n\s*if \(fresh\) ensureInternalForecast\(draws\);/g, '\n');

// 4) In the collapsed history row show actual column:
// hit  -> 🔥 СТx
// miss -> ❌ СТx
const oldSummary = `        const anyHit=records.some(r=>r.settled && (r.result==='TOP1'||r.result==='TOP3'));
        const allSettled=records.every(r=>r.settled);
        const icon=anyHit?'🔥':(allSettled?'—':'—');`;

const newSummary = `        const anyHit=records.some(r=>r.settled && (r.result==='TOP1'||r.result==='TOP3'));
        const allSettled=records.every(r=>r.settled);
        const resultText = allSettled && actual
          ? (anyHit ? \`🔥 СТ\${actual}\` : \`❌ СТ\${actual}\`)
          : '—';`;

if (!ai.includes('const resultText = allSettled && actual')) {
  ai = replaceOnce(ai, oldSummary, newSummary, 'history result summary');
}

if (ai.includes('<span class="ai-hresult">${icon}</span>')) {
  ai = ai.replace(
    '<span class="ai-hresult">${icon}</span>',
    '<span class="ai-hresult">${resultText}</span>'
  );
}

fs.writeFileSync('ai-analyzer.js', ai);

// 5) Visible version and mandatory cache-bust.
let html = fs.readFileSync('index.html', 'utf8');
html = html.replace(
  /<title>ПОЗИТРОН · МАТРИЦА СТОЛБОВ v[^<]+<\/title>/,
  '<title>ПОЗИТРОН · МАТРИЦА СТОЛБОВ v2.2.12</title>'
);
html = html.replace(
  /<small>новое отдельное приложение · v[^<]+<\/small>/,
  '<small>новое отдельное приложение · v2.2.12</small>'
);
html = html.replace(
  /<script src="ai-analyzer\.js\?v=[^"]+"><\/script>/,
  '<script src="ai-analyzer.js?v=v2212-server-history"></script>'
);
fs.writeFileSync('index.html', html);

console.log('v2.2.12 patch applied');
