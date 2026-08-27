'use strict';

(() => {
  const INTERVAL_KEY = 'pozitron_column_matrix_interval_v1';
  const FAST_INTERVAL = '60000';
  const AI_ARCHIVE_KEY = 'pozitron_openai_forecast_archive_v2';
  const INTERNAL_URL =
    'https://raw.githubusercontent.com/arsazet17/pozitron-column-matrix-v1/main/internal-forecast-archive.json';

  let lastWakeRefresh = 0;
  let archiveSyncBusy = false;

  function safeJson(raw, fallback) {
    try { return JSON.parse(raw); } catch (_) { return fallback; }
  }

  function enableNativeAuto() {
    const interval = document.getElementById('intervalSelect');
    const save = document.getElementById('saveSettings');
    if (!interval || !save) return;

    interval.value = FAST_INTERVAL;
    if (localStorage.getItem(INTERVAL_KEY) !== FAST_INTERVAL) save.click();
  }

  function mergeArchives(local, remoteInternal) {
    const map = new Map();

    function put(rec) {
      if (!rec || !Number.isFinite(Number(rec.targetDraw))) return;

      const provider = (rec.provider || 'openai') === 'internal'
        ? 'internal'
        : 'openai';

      const key =
        `${provider}:${Number(rec.baseDraw || 0)}:${Number(rec.targetDraw)}`;

      const old = map.get(key);
      if (!old) return void map.set(key, rec);

      if (!!rec.settled && !old.settled) return void map.set(key, rec);

      const oldCreated = Date.parse(old.createdAt || '') || 0;
      const newCreated = Date.parse(rec.createdAt || '') || 0;
      if (newCreated >= oldCreated) map.set(key, rec);
    }

    (Array.isArray(local) ? local : []).forEach(put);
    (Array.isArray(remoteInternal) ? remoteInternal : [])
      .filter(r => (r?.provider || '') === 'internal')
      .forEach(put);

    return [...map.values()]
      .sort((a, b) => Number(a.targetDraw || 0) - Number(b.targetDraw || 0))
      .slice(-200);
  }

  async function syncPersistentInternal() {
    if (archiveSyncBusy) return;
    archiveSyncBusy = true;

    try {
      const response = await fetch(`${INTERNAL_URL}?ts=${Date.now()}`, {
        cache: 'no-store'
      });
      if (!response.ok) throw new Error(`INTERNAL HTTP ${response.status}`);

      const remote = await response.json();
      const local = safeJson(
        localStorage.getItem(AI_ARCHIVE_KEY) || '[]',
        []
      );

      localStorage.setItem(
        AI_ARCHIVE_KEY,
        JSON.stringify(mergeArchives(local, remote))
      );

      const aiView = document.getElementById('aiView');
      const aiBtn = document.getElementById('aiViewBtn');
      if (aiView?.classList.contains('active') && aiBtn) aiBtn.click();
    } catch (error) {
      console.warn('INTERNAL archive sync skipped:', error);
    } finally {
      archiveSyncBusy = false;
    }
  }

  function refreshOnWake() {
    if (document.visibilityState === 'hidden') return;

    const now = Date.now();
    if (now - lastWakeRefresh < 15000) return;
    lastWakeRefresh = now;

    document.getElementById('syncBtn')?.click();
    syncPersistentInternal();
  }

  enableNativeAuto();
  syncPersistentInternal();

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refreshOnWake();
  });
  window.addEventListener('focus', refreshOnWake);
  window.addEventListener('pageshow', refreshOnWake);
  window.addEventListener('online', refreshOnWake);
})();

(() => {
  if (document.querySelector('script[data-archive-result-icon-fix]')) return;
  const s = document.createElement('script');
  s.src = 'archive-result-icon-fix.js?v=3';
  s.defer = true;
  s.dataset.archiveResultIconFix = '1';
  document.head.appendChild(s);
})();
