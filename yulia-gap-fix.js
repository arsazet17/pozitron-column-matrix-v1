'use strict';

/*
  ПОЗИТРОН · МАТРИЦА СТОЛБОВ v2.2 SAFE
  Исправление зависания страницы.
  Нет MutationObserver-цикла.
  Нет опроса каждые 5 секунд.
*/

(() => {
  const ARCHIVE_KEY = 'pozitron_openai_forecast_archive_v2';
  const RAW_BASE = 'https://raw.githubusercontent.com/arsazet17/pozitron-column-matrix-v1/main';
  const INTERNAL_URL = `${RAW_BASE}/internal-forecast-archive.json`;
  const HISTORY_URL = `${RAW_BASE}/keno-history.json`;

  let busy = false;
  let lastFingerprint = '';

  const esc = v => String(v ?? '')
    .replaceAll('&','&amp;')
    .replaceAll('<','&lt;')
    .replaceAll('>','&gt;')
    .replaceAll('"','&quot;');

  function safeJson(raw, fallback) {
    try { return JSON.parse(raw); }
    catch { return fallback; }
  }

  function localArchive() {
    const a = safeJson(localStorage.getItem(ARCHIVE_KEY) || '[]', []);
    return Array.isArray(a) ? a : [];
  }

  function shortDate(v) {
    const s = String(v || '').trim();
    let m = s.match(/^(\d{2})[.\-/](\d{2})[.\-/](\d{4})$/);
    if (m) return `${m[1]}.${m[2]}.${m[3].slice(-2)}`;
    m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) return `${m[3]}.${m[2]}.${m[1].slice(-2)}`;
    return s || '—';
  }

  function provider(rec) {
    return (rec?.provider || 'openai') === 'internal' ? 'ВНУТРЕННИЙ' : 'OPENAI';
  }

  function merge(local, remote) {
    const map = new Map();

    const put = rec => {
      if (!rec || !Number.isFinite(Number(rec.targetDraw))) return;
      const p = (rec.provider || 'openai') === 'internal' ? 'internal' : 'openai';
      const k = `${p}:${Number(rec.targetDraw)}:${Number(rec.baseDraw || 0)}`;
      const old = map.get(k);

      if (!old ||
          (!!rec.settled && !old.settled) ||
          (Date.parse(rec.createdAt || '') || 0) >= (Date.parse(old.createdAt || '') || 0)) {
        map.set(k, rec);
      }
    };

    (Array.isArray(local) ? local : []).forEach(put);
    (Array.isArray(remote) ? remote : [])
      .filter(r => (r?.provider || '') === 'internal')
      .forEach(put);

    return [...map.values()]
      .sort((a,b) => Number(a.targetDraw || 0) - Number(b.targetDraw || 0))
      .slice(-200);
  }

  function historyMap(payload) {
    const out = new Map();

    const walk = v => {
      if (Array.isArray(v)) {
        v.forEach(walk);
        return;
      }
      if (!v || typeof v !== 'object') return;

      const draw = Number(v.draw);
      const column = Number(v.column);

      if (Number.isFinite(draw) &&
          Number.isInteger(column) &&
          column >= 1 && column <= 10) {
        out.set(draw, {
          draw,
          column,
          date: String(v.date || ''),
          time: String(v.time || '')
        });
        return;
      }

      Object.values(v).forEach(x => {
        if (x && typeof x === 'object') walk(x);
      });
    };

    walk(payload);
    return out;
  }

  function settle(records, facts) {
    records.forEach(rec => {
      const fact = facts.get(Number(rec.targetDraw));
      if (!fact) return;

      const pos = Array.isArray(rec.picks) ? rec.picks.indexOf(fact.column) : -1;

      rec.settled = true;
      rec.actualDraw = fact.draw;
      rec.actualColumn = fact.column;
      rec.actualDate = fact.date;
      rec.actualTime = fact.time;
      rec.result = pos === 0 ? 'TOP1' : (pos > 0 ? 'TOP3' : 'MISS');
    });
  }

  function render(records) {
    const host = document.getElementById('aiArchive');
    if (!host) return;

    const groups = new Map();

    records.forEach(r => {
      const k = Number(r.targetDraw);
      if (!Number.isFinite(k)) return;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(r);
    });

    const ordered = [...groups.entries()]
      .sort((a,b) => b[0] - a[0])
      .slice(0,40);

    if (!ordered.length) {
      host.innerHTML = '<div class="ai-empty">Архив пока пуст.</div>';
      return;
    }

    host.innerHTML = `<div class="ai-history">
      <div class="ai-history-labels">
        <span>ТИРАЖ</span><span>ДАТА</span><span>ВРЕМЯ</span><span>ИТОГ</span><span></span>
      </div>
      ${ordered.map(([draw,recs],idx) => {
        recs.sort((a,b) =>
          ((a.provider || 'openai') === 'internal' ? 0 : 1) -
          ((b.provider || 'openai') === 'internal' ? 0 : 1)
        );

        const ref = recs[0];
        const settled = recs.filter(r => r.settled);
        const anyHit = settled.some(r => r.result === 'TOP1' || r.result === 'TOP3');
        const date = settled[0]?.actualDate || ref.targetDate || '—';
        const time = settled[0]?.actualTime || ref.targetTime || '—';

        return `<details class="ai-history-row" ${idx === 0 ? 'open' : ''}>
          <summary class="ai-history-summary">
            <span class="ai-hdraw">№${draw}</span>
            <span class="ai-hdate">${esc(shortDate(date))}</span>
            <span class="ai-htime">${esc(String(time).slice(0,5))}</span>
            <span class="ai-hresult">${anyHit ? '🔥' : '—'}</span>
            <span class="ai-harrow">▼</span>
          </summary>
          <div class="ai-history-body">
            ${recs.map(rec => {
              const hit = rec.settled && (rec.result === 'TOP1' || rec.result === 'TOP3');
              const picks = Array.isArray(rec.picks) ? rec.picks.slice(0,3) : [];

              return `<div class="ai-provider-block ${hit ? 'provider-hit' : ''}">
                <div class="ai-provider-title">
                  <b>${provider(rec)}</b>
                  <span>${!rec.settled ? 'ЖДЁМ' : (hit ? '🔥 ПОПАЛ' : 'МИМО')}</span>
                </div>
                <div class="ai-history-picks">
                  ${picks.map((x,i) => `<div class="ai-history-pick hp${i+1} ${hit && Number(x) === Number(rec.actualColumn) ? 'actual-hit' : ''}">
                    <small>TOP-${i+1}</small><b>СТ${x}</b>
                  </div>`).join('')}
                </div>
                ${rec.settled
                  ? `<div class="ai-history-fact">ВЫШЕЛ: <strong class="${hit ? 'actual-green' : ''}">СТ${rec.actualColumn}</strong> ${hit ? '<span class="ok">✅🔥</span>' : '<span class="miss">❌ МИМО</span>'}</div>`
                  : '<div class="ai-history-fact muted">Результат ещё не появился.</div>'
                }
                ${rec.summary ? `<div class="ai-history-note">${esc(rec.summary)}</div>` : ''}
              </div>`;
            }).join('')}
          </div>
        </details>`;
      }).join('')}
    </div>`;
  }

  async function syncAndRender() {
    if (busy) return;
    busy = true;

    try {
      const [ir,hr] = await Promise.all([
        fetch(`${INTERNAL_URL}?ts=${Date.now()}`, {cache:'no-store'}),
        fetch(`${HISTORY_URL}?ts=${Date.now()}`, {cache:'no-store'})
      ]);

      const remote = ir.ok ? await ir.json() : [];
      const hist = hr.ok ? await hr.json() : [];

      const merged = merge(localArchive(), remote);
      settle(merged, historyMap(hist));

      localStorage.setItem(ARCHIVE_KEY, JSON.stringify(merged));

      const fp = JSON.stringify(
        merged.map(r => [r.provider,r.targetDraw,r.settled,r.result,r.actualColumn,r.createdAt])
      );

      if (fp !== lastFingerprint || !document.querySelector('#aiArchive .ai-history')) {
        lastFingerprint = fp;
        render(merged);
      }
    } catch (e) {
      render(localArchive());
      console.warn('archive sync', e);
    } finally {
      busy = false;
    }
  }

  function keepExternalButton() {
    const btn = document.getElementById('aiRunBtn');
    if (!btn) return;

    const s = String(document.getElementById('aiStatus')?.textContent || '').toUpperCase();
    const working = /АНАЛИЗ|ОБНОВЛЯЮ|ОТПРАВЛЯЮ|ЗАГРУЖАЮ/.test(s);

    if (!working) btn.disabled = false;
    btn.textContent = 'СДЕЛАТЬ ПРОГНОЗ';
  }

  function boot() {
    keepExternalButton();
    syncAndRender();

    // Только резерв раз в минуту.
    setInterval(() => {
      keepExternalButton();
      syncAndRender();
    }, 60000);

    // Событийные обновления.
    window.addEventListener('focus', () => {
      keepExternalButton();
      syncAndRender();
    });

    window.addEventListener('pageshow', () => {
      keepExternalButton();
      syncAndRender();
    });

    window.addEventListener('online', syncAndRender);

    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        keepExternalButton();
        syncAndRender();
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(boot, 400), {once:true});
  } else {
    setTimeout(boot, 400);
  }
})();
