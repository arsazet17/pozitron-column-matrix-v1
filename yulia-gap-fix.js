'use strict';

/*
  ПОЗИТРОН · МАТРИЦА СТОЛБОВ v1.6
  Быстрое автообновление экрана + безопасный загрузчик ИИ.

  ВОССТАНОВЛЕНО по рабочему состоянию 24.08.2026 22:50 МСК.
*/

(() => {
  const INTERVAL_KEY = 'pozitron_column_matrix_interval_v1';
  const FAST_INTERVAL = '60000';
  let lastWakeRefresh = 0;

  function enableFastNativeAuto() {
    const interval = document.getElementById('intervalSelect');
    const save = document.getElementById('saveSettings');

    if (!interval || !save) return;

    interval.value = FAST_INTERVAL;

    // matrix.js уже навесил обработчик на кнопку "Сохранить".
    // Используем только штатный setupAuto(), без дополнительных таймеров.
    if (localStorage.getItem(INTERVAL_KEY) !== FAST_INTERVAL) {
      save.click();
    }
  }

  function refreshOnWake() {
    if (document.visibilityState === 'hidden') return;

    const now = Date.now();
    if (now - lastWakeRefresh < 15000) return;
    lastWakeRefresh = now;

    const btn = document.getElementById('syncBtn');
    if (btn) btn.click();
  }

  enableFastNativeAuto();

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refreshOnWake();
  });
  window.addEventListener('focus', refreshOnWake);
  window.addEventListener('pageshow', refreshOnWake);
  window.addEventListener('online', refreshOnWake);

  // Точно как в рабочей версии: отдельный безопасный загрузчик ИИ.
  if (!document.querySelector('script[data-pozitron-ai]')) {
    const s = document.createElement('script');
    s.src = 'ai-analyzer.js?v=stoloto-200';
    s.defer = true;
    s.dataset.pozitronAi = '1';
    document.head.appendChild(s);
  }
})();
