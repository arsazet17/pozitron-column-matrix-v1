'use strict';

(() => {
  function norm(v) {
    return String(v || '').replace(/\s+/g, ' ').trim().toUpperCase();
  }

  function getActualColumn(body) {
    const m = norm(body?.textContent).match(/ВЫШЕЛ:\s*СТ\s*(10|[1-9])/i);
    if (!m) return null;
    const n = Number(m[1]);
    return Number.isInteger(n) && n >= 1 && n <= 10 ? n : null;
  }

  function updateRow(details) {
    const resultCell = details?.querySelector('.ai-hresult');
    const body = details?.querySelector('.ai-history-body');
    if (!resultCell || !body) return;

    const text = norm(body.textContent);
    const actual = getActualColumn(body);

    if (!actual) {
      resultCell.textContent = '—';
      resultCell.title = 'Результат ещё не появился';
      return;
    }

    const hit =
      text.includes('🔥 ПОПАЛ') ||
      text.includes('✅🔥') ||
      text.includes('ПОПАЛ');

    resultCell.textContent = `СТ${actual} ${hit ? '🔥' : '❌'}`;
    resultCell.title = hit
      ? `Выпал СТ${actual} · есть попадание`
      : `Выпал СТ${actual} · мимо`;

    resultCell.style.whiteSpace = 'nowrap';
    resultCell.style.fontSize = '16px';
    resultCell.style.fontWeight = '1000';
  }

  function updateAll() {
    document
      .querySelectorAll('#aiArchive details.ai-history-row')
      .forEach(updateRow);
  }

  function boot() {
    updateAll();

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

    observer.observe(archive, { childList: true, subtree: true });

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
