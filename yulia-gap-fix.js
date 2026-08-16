'use strict';

/*
  ПОЗИТРОН · МАТРИЦА СТОЛБОВ v1.6
  Быстрое автообновление экрана + безопасный загрузчик ИИ.

  Что делает:
  1) включает штатное автообновление matrix.js раз в 1 минуту;
  2) при возврате в Chrome / на страницу сразу проверяет новые тиражи;
  3) при восстановлении сети сразу проверяет новые тиражи;
  4) ИИ по-прежнему загружается отдельным ai-analyzer.js.
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
    // Нажимаем её программно только если нужно поменять интервал:
    // это вызывает штатный setupAuto() внутри matrix.js без дублирующих таймеров.
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

  // Включаем 1-минутный штатный таймер сразу после загрузки matrix.js.
  enableFastNativeAuto();

  // Android/Chrome часто замораживает setInterval в фоне.
  // Поэтому при возвращении на экран делаем немедленную проверку.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refreshOnWake();
  });
  window.addEventListener('focus', refreshOnWake);
  window.addEventListener('pageshow', refreshOnWake);
  window.addEventListener('online', refreshOnWake);

  // Безопасный загрузчик ИИ-модуля.
  if (!document.querySelector('script[data-pozitron-ai]')) {
    const s = document.createElement('script');
    s.src = 'ai-analyzer.js?v=stoloto-200';
    s.defer = true;
    s.dataset.pozitronAi = '1';
    document.head.appendChild(s);
  }
})();
