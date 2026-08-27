'use strict';

import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { chromium } from 'playwright';

const ROOT = process.cwd();
const HISTORY_FILE = path.join(ROOT, 'keno-history.json');
const ARCHIVE_FILE = path.join(ROOT, 'internal-forecast-archive.json');
const STORAGE_KEY = 'pozitron_openai_forecast_archive_v2';
const PORT = 4173;

function contentType(file) {
  const ext = path.extname(file).toLowerCase();
  return ({
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.mjs': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.webmanifest': 'application/manifest+json; charset=utf-8'
  })[ext] || 'application/octet-stream';
}

function flattenHistory(value, out = []) {
  if (Array.isArray(value)) {
    for (const item of value) flattenHistory(item, out);
    return out;
  }
  if (value && typeof value === 'object') {
    const draw = Number(value.draw);
    const column = Number(value.column);
    if (Number.isFinite(draw) && Number.isInteger(column) && column >= 1 && column <= 10) {
      out.push({ draw, column });
      return out;
    }
    for (const item of Object.values(value)) {
      if (item && typeof item === 'object') flattenHistory(item, out);
    }
  }
  return out;
}

async function readJson(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch { return fallback; }
}

const historyRaw = await fs.readFile(HISTORY_FILE, 'utf8');
const historyJson = JSON.parse(historyRaw);
const draws = flattenHistory(historyJson).sort((a, b) => a.draw - b.draw);
if (draws.length < 500) throw new Error(`Недостаточно истории: ${draws.length}`);

const latestDraw = draws.at(-1).draw;
const existing = await readJson(ARCHIVE_FILE, []);
const persistentInternal = Array.isArray(existing)
  ? existing.filter(r => (r?.provider || '') === 'internal')
  : [];

const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url || '/', `http://127.0.0.1:${PORT}`);
    let rel = decodeURIComponent(u.pathname);
    if (rel === '/') rel = '/index.html';
    const file = path.normalize(path.join(ROOT, rel));
    if (!file.startsWith(ROOT)) {
      res.writeHead(403); res.end('forbidden'); return;
    }
    const data = await fs.readFile(file);
    res.writeHead(200, {
      'content-type': contentType(file),
      'cache-control': 'no-store'
    });
    res.end(data);
  } catch {
    res.writeHead(404); res.end('not found');
  }
});

await new Promise(resolve => server.listen(PORT, '127.0.0.1', resolve));

let browser;
try {
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();

  await context.addInitScript(({ key, archive }) => {
    if (location.origin.startsWith('http://127.0.0.1:')) {
      localStorage.setItem(key, JSON.stringify(archive));
    }
  }, { key: STORAGE_KEY, archive: persistentInternal });

  // Всегда анализируем уже обновлённый локальный keno-history.json из этого Action.
  await context.route('**/keno-history.json*', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: historyRaw
    });
  });

  const page = await context.newPage();
  page.on('console', msg => console.log(`[browser:${msg.type()}] ${msg.text()}`));
  page.on('pageerror', err => console.log(`[browser:error] ${err.message}`));

  await page.goto(`http://127.0.0.1:${PORT}/index.html?runner=${Date.now()}`, {
    waitUntil: 'domcontentloaded',
    timeout: 30000
  });

  await page.waitForFunction(({ key, latest }) => {
    try {
      const a = JSON.parse(localStorage.getItem(key) || '[]');
      return a.some(r =>
        (r?.provider || '') === 'internal' &&
        Number(r?.baseDraw) === Number(latest) &&
        Array.isArray(r?.picks) &&
        r.picks.length === 3
      );
    } catch { return false; }
  }, { key: STORAGE_KEY, latest: latestDraw }, { timeout: 30000 });

  const browserArchive = await page.evaluate(key => {
    try { return JSON.parse(localStorage.getItem(key) || '[]'); }
    catch { return []; }
  }, STORAGE_KEY);

  const internal = browserArchive
    .filter(r => (r?.provider || '') === 'internal')
    .sort((a, b) => Number(a.targetDraw || 0) - Number(b.targetDraw || 0));

  const byBase = new Map();
  for (const rec of internal) byBase.set(Number(rec.baseDraw), rec);

  const finalArchive = [...byBase.values()]
    .sort((a, b) => Number(a.targetDraw || 0) - Number(b.targetDraw || 0))
    .slice(-500);

  await fs.writeFile(ARCHIVE_FILE, JSON.stringify(finalArchive, null, 2) + '\n', 'utf8');

  const current = finalArchive.find(r => Number(r.baseDraw) === latestDraw);
  console.log(
    `INTERNAL ARCHIVE PASS · база №${latestDraw} · прогноз №${current?.targetDraw ?? '—'} · TOP-3 ${(current?.picks || []).join(',')}`
  );
} finally {
  if (browser) await browser.close();
  await new Promise(resolve => server.close(resolve));
}
