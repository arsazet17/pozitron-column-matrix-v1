'use strict';

/*
  ПОЗИТРОН · МАТРИЦА СТОЛБОВ
  Безопасный загрузчик ИИ-модуля.
  Победивший столб внутри ai-analyzer.js берётся только из draw.column.
*/

(() => {
  if (document.querySelector('script[data-pozitron-ai]')) return;

  const s = document.createElement('script');
  s.src = `ai-analyzer.js?v=stoloto-200`;
  s.defer = true;
  s.dataset.pozitronAi = '1';
  document.head.appendChild(s);
})();
