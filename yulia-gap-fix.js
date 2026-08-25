'use strict';

/*
  ПОЗИТРОН · МАТРИЦА СТОЛБОВ v1.7
  Быстрое автообновление + постоянный архив ВНУТРЕННЕГО ИИ.

  ВАЖНО:
  — internal-forecast-archive.json синхронизируется из GitHub автоматически;
  — внешний OpenAI НЕ запускается автоматически и остаётся только ручным;
  — локальные ручные записи OpenAI не удаляются при синхронизации.
*/

(() => {
  const INTERVAL_KEY = 'pozitron_column_matrix_interval_v1';
  const FAST_INTERVAL = '60000';
  const AI_ARCHIVE_KEY = 'pozitron_openai_forecast_archive_v2';
  const INTERNAL_ARCHIVE_URL = 'internal-forecast-archive.json';
  let lastWakeRefresh = 0;

  function safeJson(raw, fallback) {
    try { return JSON.parse(raw); } catch (_) { return fallback; }
  }

  function syncPersistentInternalArchive() {
    try {
      // Синхронно и до загрузки ai-analyzer.js:
      // так экран ИИ сразу видит постоянный внутренний архив.
      const xhr = new XMLHttpRequest();
      xhr.open('GET', `${INTERNAL_ARCHIVE_URL}?_=${Date.now()}`, false);
      xhr.send(null);
      if (xhr.status < 200 || xhr.status >= 300) return;

      const remote = safeJson(xhr.responseText, []);
      if (!Array.isArray(remote)) return;

      const local = safeJson(localStorage.getItem(AI_ARCHIVE_KEY) || '[]', []);
      const manualExternal = (Array.isArray(local) ? local : [])
        .filter(r => (r?.provider || 'openai') !== 'internal');

      const remoteInternal = remote
        .filter(r => (r?.provider || '') === 'internal');

      const map = new Map();
      for (const rec of [...manualExternal, ...remoteInternal]) {
        const provider = rec?.provider || 'openai';
        const key = rec?.id || `${provider}:${rec?.baseDraw}:${rec?.targetDraw}`;
        map.set(key, rec);
      }

      const merged = [...map.values()]
        .sort((a, b) => {
          const da = Number(a?.targetDraw || 0);
          const db = Number(b?.targetDraw || 0);
          if (da !== db) return da - db;
          return String(a?.createdAt || '').localeCompare(String(b?.createdAt || ''));
        })
        .slice(-120);

      localStorage.setItem(AI_ARCHIVE_KEY, JSON.stringify(merged));
    } catch (e) {
      console.warn('persistent internal archive sync', e);
    }
  }

  function enableFastNativeAuto() {
    const interval = document.getElementById('intervalSelect');
    const save = document.getElementById('saveSettings');
    if (!interval || !save) return;

    interval.value = FAST_INTERVAL;
    if (localStorage.getItem(INTERVAL_KEY) !== FAST_INTERVAL) save.click();
  }

  function refreshOnWake() {
    if (document.visibilityState === 'hidden') return;
    const now = Date.now();
    if (now - lastWakeRefresh < 15000) return;
    lastWakeRefresh = now;

    syncPersistentInternalArchive();
    const btn = document.getElementById('syncBtn');
    if (btn) btn.click();
  }

  // Сначала постоянный INTERNAL, потом уже сам ИИ-модуль.
  syncPersistentInternalArchive();
  enableFastNativeAuto();

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refreshOnWake();
  });
  window.addEventListener('focus', refreshOnWake);
  window.addEventListener('pageshow', refreshOnWake);
  window.addEventListener('online', refreshOnWake);

  if (!document.querySelector('script[data-pozitron-ai]')) {
    const s = document.createElement('script');
    s.src = 'ai-analyzer.js?v=internal-archive-310';
    s.defer = true;
    s.dataset.pozitronAi = '1';
    document.head.appendChild(s);
  }
})();
