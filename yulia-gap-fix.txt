'use strict';

/*
  ПОЗИТРОН · МАТРИЦА СТОЛБОВ
  yulia-gap-fix.js — безопасный загрузчик дополнительного ИИ-модуля.

  Основная логика "Горизонтали Юли" остаётся в matrix.js.
  Этот файл не перестраивает таблицу Юли.
*/

(() => {
  if (document.querySelector('script[data-pozitron-ai]')) return;
  const s = document.createElement('script');
  s.src = `ai-analyzer.js?v=100`;
  s.defer = true;
  s.dataset.pozitronAi = '1';
  document.head.appendChild(s);
})();
