(() => {
  'use strict';

  // ПОЗИТРОН · МАТРИЦА СТОЛБОВ v2.2
  // Серверный принцип как в M5M:
  // GitHub Actions продолжает собирать тиражи и INTERNAL-прогнозы,
  // даже когда телефон закрыт. Телефон при открытии только читает
  // готовый серверный архив напрямую из GitHub main без кэша.

  const RAW_BASE = 'https://raw.githubusercontent.com/arsazet17/pozitron-column-matrix-v1/main/';
  const HISTORY_FILE = 'keno-history.json';
  const INTERNAL_ARCHIVE_FILE = 'internal-forecast-archive.json';
  const ARCHIVE_KEY = 'pozitron_openai_forecast_archive_v2';

  const nativeFetch = window.fetch.bind(window);
  let syncPromise = null;
  let lastServerCount = 0;
  let lastSyncAt = '';

  function safeJson(raw, fallback) {
    try { return JSON.parse(raw); } catch (_) { return fallback; }
  }

  function recordKey(rec) {
    const provider = rec?.provider || 'openai';
    const baseDraw = Number(rec?.baseDraw || 0);
    const targetDraw = Number(rec?.targetDraw || 0);
    return `${provider}:${baseDraw}:${targetDraw}`;
  }

  function validInternal(rec) {
    return !!rec &&
      (rec.provider || '') === 'internal' &&
      Number.isFinite(Number(rec.baseDraw)) &&
      Number.isFinite(Number(rec.targetDraw)) &&
      Array.isArray(rec.picks) &&
      rec.picks.length === 3;
  }

  function readLocalArchive() {
    const value = safeJson(localStorage.getItem(ARCHIVE_KEY) || '[]', []);
    return Array.isArray(value) ? value : [];
  }

  function mergeArchive(localArchive, serverInternal) {
    const merged = new Map();

    // Локальные записи сохраняем, прежде всего ручной внешний OpenAI.
    for (const rec of (Array.isArray(localArchive) ? localArchive : [])) {
      if (!rec) continue;
      merged.set(recordKey(rec), rec);
    }

    // INTERNAL с сервера авторитетнее локального INTERNAL.
    // Именно эти записи были созданы GitHub Actions при закрытом телефоне.
    for (const rec of (Array.isArray(serverInternal) ? serverInternal : [])) {
      if (!validInternal(rec)) continue;
      merged.set(recordKey(rec), rec);
    }

    return [...merged.values()]
      .sort((a, b) =>
        Number(a.targetDraw || 0) - Number(b.targetDraw || 0) ||
        String(a.provider || 'openai').localeCompare(String(b.provider || 'openai'))
      )
      .slice(-500);
  }

  async function rawJson(rel) {
    const u = new URL(rel, RAW_BASE);
    u.searchParams.set('ts', String(Date.now()));

    // Как в M5M: напрямую raw.githubusercontent.com, cache:no-store,
    // без своих Cache-Control/Pragma headers, чтобы мобильный Chrome
    // не создавал лишний CORS preflight.
    const r = await nativeFetch(u.href, {
      method: 'GET',
      cache: 'no-store',
      mode: 'cors',
      credentials: 'omit',
      headers: undefined
    });

    if (!r.ok) throw new Error(`SERVER RAW ${rel}: HTTP ${r.status}`);
    return await r.json();
  }

  async function syncServerInternal(force = false) {
    if (syncPromise && !force) return syncPromise;

    syncPromise = (async () => {
      const server = await rawJson(INTERNAL_ARCHIVE_FILE);
      if (!Array.isArray(server)) throw new Error('SERVER INTERNAL: неверный JSON');

      const local = readLocalArchive();
      const merged = mergeArchive(local, server);

      localStorage.setItem(ARCHIVE_KEY, JSON.stringify(merged));
      lastServerCount = server.filter(validInternal).length;
      lastSyncAt = new Date().toISOString();

      window.dispatchEvent(new CustomEvent('column:server-archive', {
        detail: {
          serverInternal: lastServerCount,
          merged: merged.length,
          syncedAt: lastSyncAt
        }
      }));

      return merged;
    })();

    try {
      return await syncPromise;
    } finally {
      syncPromise = null;
    }
  }

  function isHistoryRequest(input) {
    try {
      const raw = typeof input === 'string' ? input : input?.url;
      if (!raw) return false;
      const u = new URL(raw, location.href);
      return u.pathname.endsWith('/' + HISTORY_FILE) || u.pathname.endsWith(HISTORY_FILE);
    } catch {
      return false;
    }
  }

  // Главная связка с существующим ai-analyzer.js:
  // перед КАЖДЫМ чтением свежей истории сначала восстанавливаем
  // серверный INTERNAL-архив. Поэтому ai-analyzer уже видит все
  // тиражи/прогнозы, накопленные пока телефон был закрыт.
  window.fetch = async function(input, init = {}) {
    if (isHistoryRequest(input)) {
      try {
        await syncServerInternal(false);
      } catch (error) {
        console.warn('[v2.2 SERVER INTERNAL]', error?.message || error);
      }
    }
    return nativeFetch(input, init);
  };

  // Предзагрузка сразу при старте приложения.
  syncServerInternal(true).catch(error => {
    console.warn('[v2.2 SERVER INTERNAL startup]', error?.message || error);
  });

  // При возврате в приложение снова подтягиваем сервер.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      syncServerInternal(true).catch(() => {});
    }
  });

  window.addEventListener('focus', () => {
    syncServerInternal(true).catch(() => {});
  });

  window.addEventListener('online', () => {
    syncServerInternal(true).catch(() => {});
  });

  window.ColumnRuntimeDirect = {
    sync: () => syncServerInternal(true),
    status: () => ({
      serverInternal: lastServerCount,
      syncedAt: lastSyncAt
    })
  };
})();
