'use strict';

/*
  ПОЗИТРОН · МАТРИЦА СТОЛБОВ
  ИТОГ СТРОКИ АРХИВА:
  🔥 = хотя бы один алгоритм попал
  ❌ = тираж закрыт, но попаданий нет
  — = результат ещё не появился

  Внутренние блоки алгоритмов не меняются:
  внутри остаются "🔥 ПОПАЛ" / "❌ МИМО".
*/

(() => {
  function normalizeText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim().toUpperCase();
  }

  function updateRow(details) {
    if (!details) return;

    const resultCell = details.querySelector('.ai-hresult');
    const body = details.querySelector('.ai-history-body');
    if (!resultCell || !body) return;

    const text = normalizeText(body.textContent);

    // Пока факт не появился.
    const waiting =
      text.includes('РЕЗУЛЬТАТ ЕЩЁ НЕ ПОЯВИЛСЯ') ||
      text.includes('РЕЗУЛЬТАТ ЕЩЕ НЕ ПОЯВИЛСЯ') ||
      text.includes('ЖДЁМ') ||
      text.includes('ЖДЕМ');

    if (waiting) {
      resultCell.textContent = '—';
      return;
    }

    // Если хотя бы один алгоритм попал — общий итог 🔥.
    const hit =
      text.includes('🔥 ПОПАЛ') ||
      text.includes('✅🔥') ||
      text.includes('ПОПАЛ');

    if (hit) {
      resultCell.textContent = '🔥';
      return;
    }

    // Факт уже есть, но попаданий нет — только красный крест.
    const settled =
      text.includes('ВЫШЕЛ:') ||
      text.includes('МИМО');

    resultCell.textContent = settled ? '❌' : '—';
  }

  function updateAll() {
    document
      .querySelectorAll('#aiArchive details.ai-history-row')
      .forEach(updateRow);
  }

  function boot() {
    updateAll();

    // Наблюдаем только сам архив, чтобы после штатной перерисовки
    // ai-analyzer.js заменить внешний итоговый значок.
    const archive = document.getElementById('aiArchive');
    if (!archive) return;

    let queued = false;

    const observer = new MutationObserver(() => {
      if (queued) return;
      queued = true;

      requestAnimationFrame(() => {
        queued = false;
        updateAll();
      });
    });

    observer.observe(archive, {
      childList: true,
      subtree: true
    });

    // При раскрытии строки тоже приводим значок к правилу.
    archive.addEventListener('toggle', event => {
      if (event.target?.matches?.('details.ai-history-row')) {
        updateRow(event.target);
      }
    }, true);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
