'use strict';

/*
  ПОЗИТРОН · МАТРИЦА СТОЛБОВ
  CLEAN AI BRIDGE v3.0

  Единственная задача этого файла:
  — штатное автообновление Матрицы раз в минуту;
  — при открытии/возврате подмешать постоянный INTERNAL-архив из GitHub
    в локальный архив телефона;
  — НЕ загружать ai-analyzer.js: index.html уже делает это сам;
  — НЕ создавать дополнительные циклы/MutationObserver.
*/

(() => {
  const INTERVAL_KEY = 'pozitron_column_matrix_interval_v1';
  const FAST_INTERVAL = '60000';

  const AI_ARCHIVE_KEY = 'pozitron_openai_forecast_archive_v2';
  const INTERNAL_URL =
    'https://raw.githubusercontent.com/arsazet17/pozitron-column-matrix-v1/main/internal-forecast-archive.json';

  let lastWakeRefresh = 0;
  let archiveSyncBusy = false;

  function safeJson(raw, fallback) {
    try { return JSON.parse(raw); }
    catch (_) { return fallback; }
  }

  function enableNativeAuto() {
    const interval = document.getElementById('intervalSelect');
    const save = document.getElementById('saveSettings');

    if (!interval || !save) return;

    interval.value = FAST_INTERVAL;

    // Только штатный таймер matrix.js.
    if (localStorage.getItem(INTERVAL_KEY) !== FAST_INTERVAL) {
      save.click();
    }
  }

  function mergeArchives(local, remoteInternal) {
    const map = new Map();

    function put(rec) {
      if (!rec || !Number.isFinite(Number(rec.targetDraw))) return;

      const provider =
        (rec.provider || 'openai') === 'internal'
          ? 'internal'
          : 'openai';

      const key =
        `${provider}:${Number(rec.baseDraw || 0)}:${Number(rec.targetDraw)}`;

      const old = map.get(key);

      if (!old) {
        map.set(key, rec);
        return;
      }

      // Закрытая запись сильнее предварительной.
      if (!!rec.settled && !old.settled) {
        map.set(key, rec);
        return;
      }

      const oldCreated = Date.parse(old.createdAt || '') || 0;
      const newCreated = Date.parse(rec.createdAt || '') || 0;

      if (newCreated >= oldCreated) {
        map.set(key, rec);
      }
    }

    // Сначала весь локальный архив телефона:
    // здесь находятся ручные OPENAI и уже загруженные INTERNAL.
    (Array.isArray(local) ? local : []).forEach(put);

    // Затем официальный постоянный INTERNAL из GitHub.
    (Array.isArray(remoteInternal) ? remoteInternal : [])
      .filter(r => (r?.provider || '') === 'internal')
      .forEach(put);

    return [...map.values()]
      .sort((a, b) => {
        const td = Number(a.targetDraw || 0) - Number(b.targetDraw || 0);
        if (td) return td;
        return String(a.provider || '').localeCompare(String(b.provider || ''));
      })
      .slice(-200);
  }

  async function syncPersistentInternal() {
    if (archiveSyncBusy) return;
    archiveSyncBusy = true;

    try {
      const response = await fetch(
        `${INTERNAL_URL}?ts=${Date.now()}`,
        { cache: 'no-store' }
      );

      if (!response.ok) {
        throw new Error(`INTERNAL HTTP ${response.status}`);
      }

      const remote = await response.json();

      const local = safeJson(
        localStorage.getItem(AI_ARCHIVE_KEY) || '[]',
        []
      );

      const merged = mergeArchives(local, remote);

      localStorage.setItem(
        AI_ARCHIVE_KEY,
        JSON.stringify(merged)
      );

      // Если пользователь уже находится во вкладке ИИ,
      // вызываем штатный refreshUi через её собственную кнопку.
      // Никаких самостоятельных renderArchive здесь нет.
      const aiView = document.getElementById('aiView');
      const aiBtn = document.getElementById('aiViewBtn');

      if (aiView?.classList.contains('active') && aiBtn) {
        aiBtn.click();
      }
    } catch (error) {
      // Сбой GitHub не должен ломать интерфейс:
      // локальный архив остаётся нетронутым.
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

    const btn = document.getElementById('syncBtn');
    if (btn) btn.click();

    syncPersistentInternal();
  }

  enableNativeAuto();

  // Один стартовый импорт постоянного INTERNAL.
  // ai-analyzer.js загрузится штатно следующей строкой index.html.
  syncPersistentInternal();

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refreshOnWake();
  });

  window.addEventListener('focus', refreshOnWake);
  window.addEventListener('pageshow', refreshOnWake);
  window.addEventListener('online', refreshOnWake);

  // ВАЖНО:
  // Здесь НЕТ загрузки ai-analyzer.js.
  // Его единственный запуск находится в index.html.
})();


/* Подключение итогового значка архива: 🔥 / ❌ / — */
(() => {
  if (document.querySelector('script[data-archive-result-icon-fix]')) return;
  const s = document.createElement('script');
  s.src = 'archive-result-icon-fix.js?v=2';
  s.defer = true;
  s.dataset.archiveResultIconFix = '1';
  document.head.appendChild(s);
})();
