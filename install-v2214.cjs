const fs = require('fs');

function mustReplace(source, oldText, newText, label) {
  if (!source.includes(oldText)) throw new Error(label + ': target not found');
  return source.replace(oldText, newText);
}

let ai = fs.readFileSync('ai-analyzer.js','utf8');

// ---------- SERVER INTERNAL: phone only reads GitHub RAW ----------
if (!ai.includes("const INTERNAL_ARCHIVE_URL =")) {
  ai = mustReplace(
    ai,
    "  const HISTORY_URL = 'https://raw.githubusercontent.com/arsazet17/pozitron-column-matrix-v1/main/keno-history.json';",
    "  const HISTORY_URL = 'https://raw.githubusercontent.com/arsazet17/pozitron-column-matrix-v1/main/keno-history.json';\n  const INTERNAL_ARCHIVE_URL = 'https://raw.githubusercontent.com/arsazet17/pozitron-column-matrix-v1/main/internal-forecast-archive.json';",
    'INTERNAL_ARCHIVE_URL'
  );
}

if (!ai.includes('async function fetchServerInternalArchive()')) {
  const marker = '  function loadArchive() {';
  const block = `
  async function fetchServerInternalArchive() {
    try {
      const u = \`\${INTERNAL_ARCHIVE_URL}?ts=\${Date.now()}\`;
      const r = await fetch(u, {
        method: 'GET',
        cache: 'no-store',
        mode: 'cors',
        credentials: 'omit'
      });
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
          (a,b) => Number(a?.targetDraw || 0) - Number(b?.targetDraw || 0)
        )
      );
    } catch (_) {}
  }

`;
  ai = mustReplace(ai, marker, block + marker, 'server archive function');
}

// Insert await ONLY inside async refreshUi().
const refreshStart = ai.indexOf('  async function refreshUi() {');
const refreshEnd = ai.indexOf('\n  function injectUi()', refreshStart);
if (refreshStart < 0 || refreshEnd < 0) {
  throw new Error('refreshUi boundaries not found');
}
let refreshBlock = ai.slice(refreshStart, refreshEnd);

const oldArchiveStart = `    let archive = loadArchive();
    settleArchive(archive, draws);`;

const newArchiveStart = `    await fetchServerInternalArchive();
    let archive = loadArchive();
    settleArchive(archive, draws);`;

if (!refreshBlock.includes(newArchiveStart)) {
  if (!refreshBlock.includes(oldArchiveStart)) {
    throw new Error('refreshUi archive block not found');
  }
  refreshBlock = refreshBlock.replace(oldArchiveStart, newArchiveStart);
}

// Phone never creates INTERNAL itself.
refreshBlock = refreshBlock.replace(/\n\s*if \(fresh\) ensureInternalForecast\(draws\);/g, '\n');

ai = ai.slice(0, refreshStart) + refreshBlock + ai.slice(refreshEnd);

// ---------- HISTORY SUMMARY: 🔥 СТx / ❌ СТx ----------
const oldSummary = `        const anyHit=records.some(r=>r.settled && (r.result==='TOP1'||r.result==='TOP3'));
        const allSettled=records.every(r=>r.settled);
        const icon=anyHit?'🔥':(allSettled?'—':'—');`;

const newSummary = `        const anyHit=records.some(r=>r.settled && (r.result==='TOP1'||r.result==='TOP3'));
        const allSettled=records.every(r=>r.settled);
        const resultText = allSettled && actual
          ? (anyHit ? \`🔥 СТ\${actual}\` : \`❌ СТ\${actual}\`)
          : '—';`;

if (!ai.includes('const resultText = allSettled && actual')) {
  ai = mustReplace(ai, oldSummary, newSummary, 'history summary');
}
ai = ai.replace(
  '<span class="ai-hresult">${icon}</span>',
  '<span class="ai-hresult">${resultText}</span>'
);

// ---------- EXTERNAL AI independence (previously requested) ----------
ai = ai.replace(/\n\s*internalLearner:\s*internalSnapshotForOpenAI\(draws\),/, '');
ai = ai.replace(/\n\s*'В payload есть internalLearner — независимый внутренний пакетный алгоритм\.[^']*',/, '');
ai = ai.replace('usedInternalLearning: true,', 'usedInternalLearning: false,');

fs.writeFileSync('ai-analyzer.js', ai);

// ---------- M5M-style app version update ----------
let html = fs.readFileSync('index.html','utf8');

html = html.replace(
  /<title>ПОЗИТРОН · МАТРИЦА СТОЛБОВ v[^<]+<\/title>/,
  '<title>ПОЗИТРОН · МАТРИЦА СТОЛБОВ v2.2.14</title>'
);
html = html.replace(
  /<small>новое отдельное приложение · v[^<]+<\/small>/,
  '<small>новое отдельное приложение · v2.2.14</small>'
);

html = html.replace(
  /<script src="matrix\.js\?v=[^"]+"><\/script>/,
  '<script src="matrix.js?v=v2214"></script>'
);
html = html.replace(
  /<script src="yulia-gap-fix\.js\?v=[^"]+"><\/script>/,
  '<script src="yulia-gap-fix.js?v=v2214"></script>'
);
html = html.replace(
  /<script src="ai-analyzer\.js\?v=[^"]+"><\/script>/,
  '<script src="ai-analyzer.js?v=v2214"></script>'
);

// Remove older registrations if any, then add one M5M-style registration.
html = html.replace(/\s*<script id="matrix-sw-register">[\s\S]*?<\/script>/g, '');

const swRegister = `
<script id="matrix-sw-register">
if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register(
        './sw.js?v=matrix-v2214',
        { updateViaCache: 'none' }
      );
      await reg.update();
    } catch (e) {
      console.warn(e);
    }
  });
}
</script>
`;

html = html.replace('</body>', swRegister + '\n</body>');
fs.writeFileSync('index.html', html);

// Manifest version/start URL, so installed Android app sees a new app start.
let manifest = {};
try { manifest = JSON.parse(fs.readFileSync('manifest.webmanifest','utf8')); } catch {}
manifest.start_url = './?app=v2214';
manifest.name = manifest.name || 'ПОЗИТРОН · МАТРИЦА СТОЛБОВ';
manifest.short_name = manifest.short_name || 'Матрица столбов';
manifest.display = manifest.display || 'standalone';
manifest.background_color = manifest.background_color || '#07111f';
manifest.theme_color = manifest.theme_color || '#07111f';
fs.writeFileSync('manifest.webmanifest', JSON.stringify(manifest, null, 2) + '\n');

console.log('v2.2.14 patch applied');
