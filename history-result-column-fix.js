(() => {
  'use strict';

  // v2.2 — отображение фактического вышедшего столба в строке истории.
  // Попал: 🔥 СТN
  // Мимо:  СТN ❌
  // Ожидаем факт: —

  function applyResultColumnFix() {
    const host = document.getElementById('aiArchive');
    if (!host) return;

    const rows = host.querySelectorAll('details.ai-history-row');
    for (const row of rows) {
      const summary = row.querySelector('.ai-history-summary');
      const resultCell = row.querySelector('.ai-hresult');
      if (!summary || !resultCell) continue;

      const factText = row.querySelector('.ai-history-fact')?.textContent || '';
      const m = factText.match(/ВЫШЕЛ:\s*СТ\s*(10|[1-9])/i);
      if (!m) {
        // Нет факта — тираж ещё ждём.
        resultCell.textContent = '—';
        resultCell.title = 'результат ещё не появился';
        continue;
      }

      const col = Number(m[1]);
      const providerBlocks = [...row.querySelectorAll('.ai-provider-block')];

      const hit = providerBlocks.some(block => {
        const title = block.querySelector('.ai-provider-title')?.textContent || '';
        return /ПОПАЛ/i.test(title);
      });

      if (hit) {
        resultCell.innerHTML = `<span class="hist-result-hit">🔥 <b>СТ${col}</b></span>`;
        resultCell.title = `попадание · вышел СТ${col}`;
      } else {
        resultCell.innerHTML = `<span class="hist-result-miss"><b>СТ${col}</b> ❌</span>`;
        resultCell.title = `мимо · вышел СТ${col}`;
      }
    }
  }

  function installStyle() {
    if (document.getElementById('v22-history-result-style')) return;
    const style = document.createElement('style');
    style.id = 'v22-history-result-style';
    style.textContent = `
      .ai-hresult{
        font-size:14px!important;
        font-weight:1000!important;
        white-space:nowrap;
        text-align:center;
      }
      .hist-result-hit{color:#ffffff}
      .hist-result-hit b{color:#68e7a3}
      .hist-result-miss{color:#ffffff}
      .hist-result-miss b{color:#eef5ff}
    `;
    document.head.appendChild(style);
  }

  installStyle();

  // ai-analyzer.js перерисовывает архив целиком, поэтому наблюдаем за ним.
  const observer = new MutationObserver(() => {
    queueMicrotask(applyResultColumnFix);
  });

  function start() {
    const host = document.getElementById('aiArchive');
    if (!host) {
      setTimeout(start, 250);
      return;
    }
    observer.observe(host, { childList: true, subtree: true });
    applyResultColumnFix();
  }

  start();

  // Дополнительно после возврата/обновления.
  window.addEventListener('focus', () => setTimeout(applyResultColumnFix, 150));
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) setTimeout(applyResultColumnFix, 150);
  });
})();
