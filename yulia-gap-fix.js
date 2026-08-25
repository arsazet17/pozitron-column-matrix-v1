'use strict';

/*
  ПОЗИТРОН · МАТРИЦА СТОЛБОВ v2.1
  ЖЁСТКИЙ FIX ПРЕДВАРИТЕЛЬНОГО АРХИВА.

  Закон:
  — INTERNAL есть всегда, если он создан GitHub Action;
  — OPENAI добавляется только после успешного ручного прогноза;
  — оба прогноза отображаются в одной строке targetDraw;
  — предварительный тираж показывается сразу, даже пока факта ещё нет;
  — после появления факта эта же строка получает ПОПАЛ/МИМО;
  — ai-analyzer.js здесь НЕ загружается повторно.
*/

(() => {
  const ARCHIVE_KEY = 'pozitron_openai_forecast_archive_v2';
  const RAW_BASE =
    'https://raw.githubusercontent.com/arsazet17/pozitron-column-matrix-v1/main';
  const INTERNAL_URL = `${RAW_BASE}/internal-forecast-archive.json`;
  const HISTORY_URL = `${RAW_BASE}/keno-history.json`;

  let busy = false;
  let lastFingerprint = '';

  const esc = value => String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

  function safeJson(raw, fallback) {
    try { return JSON.parse(raw); }
    catch { return fallback; }
  }

  function shortDate(value) {
    const raw = String(value || '').trim();
    let m = raw.match(/^(\d{2})[.\-/](\d{2})[.\-/](\d{4})$/);
    if (m) return `${m[1]}.${m[2]}.${m[3].slice(-2)}`;
    m = raw.match(/^(\d{2})[.\-/](\d{2})[.\-/](\d{2})$/);
    if (m) return `${m[1]}.${m[2]}.${m[3]}`;
    m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) return `${m[3]}.${m[2]}.${m[1].slice(-2)}`;
    return raw || '—';
  }

  function provider(rec) {
    return (rec?.provider || 'openai') === 'internal'
      ? 'ВНУТРЕННИЙ'
      : 'OPENAI';
  }

  function localArchive() {
    const a = safeJson(localStorage.getItem(ARCHIVE_KEY) || '[]', []);
    return Array.isArray(a) ? a : [];
  }

  function dedupeMerge(local, remoteInternal) {
    const map = new Map();

    function put(rec) {
      if (!rec || !Number.isFinite(Number(rec.targetDraw))) return;

      const prov = (rec.provider || 'openai') === 'internal'
        ? 'internal'
        : 'openai';

      const key =
        `${prov}:${Number(rec.targetDraw)}:${Number(rec.baseDraw || 0)}`;

      const prev = map.get(key);

      if (!prev) {
        map.set(key, rec);
        return;
      }

      // Завершённая запись сильнее незавершённой.
      if (!!rec.settled && !prev.settled) {
        map.set(key, rec);
        return;
      }

      const p = Date.parse(prev.createdAt || '') || 0;
      const n = Date.parse(rec.createdAt || '') || 0;
      if (n >= p) map.set(key, rec);
    }

    // Сначала всё локальное: это сохраняет старые OPENAI и старый архив.
    (Array.isArray(local) ? local : []).forEach(put);

    // Затем авторитетный INTERNAL из GitHub.
    (Array.isArray(remoteInternal) ? remoteInternal : [])
      .filter(r => (r?.provider || '') === 'internal')
      .forEach(put);

    return [...map.values()]
      .sort((a, b) =>
        Number(a.targetDraw || 0) - Number(b.targetDraw || 0)
      )
      .slice(-250);
  }

  function historyMap(payload) {
    const out = new Map();

    function walk(v) {
      if (Array.isArray(v)) {
        v.forEach(walk);
        return;
      }

      if (!v || typeof v !== 'object') return;

      const draw = Number(v.draw);
      const column = Number(v.column);

      if (
        Number.isFinite(draw) &&
        Number.isInteger(column) &&
        column >= 1 &&
        column <= 10
      ) {
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
    }

    walk(payload);
    return out;
  }

  function settle(records, facts) {
    let changed = false;

    for (const rec of records) {
      const fact = facts.get(Number(rec.targetDraw));
      if (!fact) continue;

      const pos = Array.isArray(rec.picks)
        ? rec.picks.indexOf(fact.column)
        : -1;

      const result =
        pos === 0 ? 'TOP1' :
        pos > 0 ? 'TOP3' :
        'MISS';

      if (!rec.settled) { rec.settled = true; changed = true; }
      if (rec.actualDraw !== fact.draw) {
        rec.actualDraw = fact.draw; changed = true;
      }
      if (rec.actualColumn !== fact.column) {
        rec.actualColumn = fact.column; changed = true;
      }
      if (rec.actualDate !== fact.date) {
        rec.actualDate = fact.date; changed = true;
      }
      if (rec.actualTime !== fact.time) {
        rec.actualTime = fact.time; changed = true;
      }
      if (rec.result !== result) {
        rec.result = result; changed = true;
      }
    }

    return changed;
  }

  function resultText(rec) {
    if (!rec.settled) return 'ЖДЁМ';
    if (rec.result === 'TOP1' || rec.result === 'TOP3') return '🔥 ПОПАЛ';
    return 'МИМО';
  }

  function render(records) {
    const host = document.getElementById('aiArchive');
    if (!host) return false;

    const groups = new Map();

    records.forEach(rec => {
      const key = Number(rec.targetDraw);
      if (!Number.isFinite(key)) return;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(rec);
    });

    const ordered = [...groups.entries()]
      .sort((a, b) => b[0] - a[0])
      .slice(0, 40);

    if (!ordered.length) {
      host.innerHTML =
        '<div class="ai-empty">Архив пока пуст.</div>';
      return true;
    }

    host.innerHTML = `
      <div class="ai-history">
        <div class="ai-history-labels">
          <span>ТИРАЖ</span>
          <span>ДАТА</span>
          <span>ВРЕМЯ</span>
          <span>ИТОГ</span>
          <span></span>
        </div>

        ${ordered.map(([draw, recs]) => {
          recs.sort((a, b) => {
            const pa = (a.provider || 'openai') === 'internal' ? 0 : 1;
            const pb = (b.provider || 'openai') === 'internal' ? 0 : 1;
            return pa - pb;
          });

          const ref = recs[0];
          const settled = recs.filter(r => r.settled);
          const anyHit = settled.some(
            r => r.result === 'TOP1' || r.result === 'TOP3'
          );

          const actualDate =
            settled[0]?.actualDate ||
            ref.targetDate ||
            '—';

          const actualTime =
            settled[0]?.actualTime ||
            ref.targetTime ||
            '—';

          const icon = anyHit ? '🔥' : '—';

          return `
            <details class="ai-history-row"
              ${draw === ordered[0][0] ? 'open' : ''}>
              <summary class="ai-history-summary">
                <span class="ai-hdraw">№${draw}</span>
                <span class="ai-hdate">${esc(shortDate(actualDate))}</span>
                <span class="ai-htime">${esc(String(actualTime).slice(0,5))}</span>
                <span class="ai-hresult">${icon}</span>
                <span class="ai-harrow">▼</span>
              </summary>

              <div class="ai-history-body">
                ${recs.map(rec => {
                  const hit =
                    rec.settled &&
                    (rec.result === 'TOP1' || rec.result === 'TOP3');

                  const picks = Array.isArray(rec.picks)
                    ? rec.picks.slice(0,3)
                    : [];

                  return `
                    <div class="ai-provider-block ${hit ? 'provider-hit' : ''}">
                      <div class="ai-provider-title">
                        <b>${provider(rec)}</b>
                        <span>${resultText(rec)}</span>
                      </div>

                      <div class="ai-history-picks">
                        ${picks.map((x, i) => `
                          <div class="ai-history-pick hp${i+1}
                            ${hit && Number(x) === Number(rec.actualColumn)
                              ? 'actual-hit'
                              : ''}">
                            <small>TOP-${i+1}</small>
                            <b>СТ${x}</b>
                          </div>
                        `).join('')}
                      </div>

                      ${
                        rec.settled
                          ? `<div class="ai-history-fact">
                              ВЫШЕЛ:
                              <strong class="${hit ? 'actual-green' : ''}">
                                СТ${rec.actualColumn}
                              </strong>
                              ${
                                hit
                                  ? '<span class="ok">✅🔥</span>'
                                  : '<span class="miss">❌ МИМО</span>'
                              }
                            </div>`
                          : `<div class="ai-history-fact muted">
                              Результат ещё не появился.
                            </div>`
                      }

                      ${
                        rec.summary
                          ? `<div class="ai-history-note">
                              ${esc(rec.summary)}
                            </div>`
                          : ''
                      }
                    </div>
                  `;
                }).join('')}
              </div>
            </details>
          `;
        }).join('')}
      </div>
    `;

    return true;
  }

  async function syncAndRender() {
    if (busy) return;
    busy = true;

    try {
      const [ir, hr] = await Promise.all([
        fetch(`${INTERNAL_URL}?ts=${Date.now()}`, { cache: 'no-store' }),
        fetch(`${HISTORY_URL}?ts=${Date.now()}`, { cache: 'no-store' })
      ]);

      const remoteInternal =
        ir.ok ? await ir.json() : [];

      const history =
        hr.ok ? await hr.json() : [];

      const merged = dedupeMerge(localArchive(), remoteInternal);
      const facts = historyMap(history);

      settle(merged, facts);

      // Сохраняем объединённый архив обратно:
      // OPENAI не теряется, INTERNAL всегда подмешивается.
      localStorage.setItem(
        ARCHIVE_KEY,
        JSON.stringify(merged.slice(-200))
      );

      const fingerprint = JSON.stringify(
        merged.map(r => [
          r.provider,
          r.targetDraw,
          r.settled,
          r.result,
          r.actualColumn
        ])
      );

      // Рисуем всегда при первом запуске или изменениях.
      if (fingerprint !== lastFingerprint ||
          !document.querySelector('#aiArchive .ai-history')) {
        lastFingerprint = fingerprint;
        render(merged);
      }
    } catch (e) {
      // Даже если сеть упала, локальный OPENAI и уже сохранённый INTERNAL
      // всё равно должны отображаться.
      render(localArchive());
      console.warn('preliminary archive sync', e);
    } finally {
      busy = false;
    }
  }

  function keepButtonAndTarget() {
    const btn = document.getElementById('aiRunBtn');

    if (btn) {
      const status = String(
        document.getElementById('aiStatus')?.textContent || ''
      ).toUpperCase();

      const working =
        /АНАЛИЗ|ОБНОВЛЯЮ|ОТПРАВЛЯЮ|ЗАГРУЖАЮ/.test(status);

      if (!working) btn.disabled = false;
      btn.textContent = 'СДЕЛАТЬ ПРОГНОЗ';
    }
  }

  function boot() {
    keepButtonAndTarget();
    syncAndRender();

    // После ручного прогноза ai-analyzer меняет DOM/статус.
    // Через 200 мс новый OPENAI уже должен появиться в архиве.
    const observer = new MutationObserver(() => {
      keepButtonAndTarget();

      const status = String(
        document.getElementById('aiStatus')?.textContent || ''
      ).trim().toUpperCase();

      if (
        status === 'СОХРАНЕНО' ||
        status.includes('ВНУТРЕННИЙ') ||
        document.getElementById('aiArchive')
      ) {
        setTimeout(syncAndRender, 200);
      }
    });

    observer.observe(document.documentElement, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['disabled']
    });

    // Периодический контроль предварительного архива.
    setInterval(syncAndRender, 5000);

    window.addEventListener('focus', syncAndRender);
    window.addEventListener('pageshow', syncAndRender);
    window.addEventListener('online', syncAndRender);

    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) syncAndRender();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      setTimeout(boot, 500);
    }, { once: true });
  } else {
    setTimeout(boot, 500);
  }
})();
