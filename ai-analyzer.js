'use strict';

(() => {
  const STORAGE_KEY = 'pozitron_column_matrix_draws_v1';
  const HISTORY_URL = 'https://raw.githubusercontent.com/arsazet17/pozitron-column-matrix-v1/main/keno-history.json';
  const ARCHIVE_KEY = 'pozitron_openai_forecast_archive_v2';
  const WORKER_URL = 'https://pozitron-gigachat-api.arsazet-17-go.workers.dev';
  const VERSION = 'OPENAI-EXTERNAL-4.0-FULL-ARCHIVE';

  const $ = id => document.getElementById(id);

  function safeJson(raw, fallback) {
    try { return JSON.parse(raw); } catch (_) { return fallback; }
  }

  function officialColumn(value) {
    const n = Number(value);
    return Number.isInteger(n) && n >= 1 && n <= 10 ? n : null;
  }

  function normalizeDraw(d) {
    if (!d) return null;
    const draw = Number(d.draw);
    const column = officialColumn(d.column);
    if (!Number.isFinite(draw) || !column) return null;

    const balls = Array.isArray(d.balls)
      ? d.balls.slice(0, 20).map(Number).filter(Number.isFinite)
      : [];

    return {
      draw,
      date: String(d.date || ''),
      time: String(d.time || ''),
      column,
      parity: String(d.parity || ''),
      balls
    };
  }

  function dedupeDraws(items) {
    const map = new Map();
    (Array.isArray(items) ? items : []).forEach(item => {
      const d = normalizeDraw(item);
      if (d) map.set(d.draw, d);
    });
    return [...map.values()].sort((a, b) => a.draw - b.draw);
  }

  function walkHistory(value, out = []) {
    if (Array.isArray(value)) {
      value.forEach(v => walkHistory(v, out));
      return out;
    }
    if (value && typeof value === 'object') {
      const d = normalizeDraw(value);
      if (d) out.push(d);
      else Object.values(value).forEach(v => {
        if (v && typeof v === 'object') walkHistory(v, out);
      });
    }
    return out;
  }

  function loadDraws() {
    // Только аварийный локальный резерв для показа UI.
    // Сам прогноз всегда пытается читать полный свежий архив GitHub.
    const raw = safeJson(localStorage.getItem(STORAGE_KEY) || '[]', []);
    return dedupeDraws(raw);
  }

  async function fetchFullHistory() {
    const url = `${HISTORY_URL}?ts=${Date.now()}`;
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Архив GitHub: HTTP ${response.status}`);
    const payload = await response.json();
    const draws = dedupeDraws(walkHistory(payload));
    if (!draws.length) throw new Error('В полном архиве не найдены официальные столбцы');
    return draws;
  }

  function loadArchive() {
    const a = safeJson(localStorage.getItem(ARCHIVE_KEY) || '[]', []);
    return Array.isArray(a) ? a : [];
  }

  function saveArchive(archive) {
    try {
      localStorage.setItem(ARCHIVE_KEY, JSON.stringify(archive.slice(-120)));
    } catch (_) {
      try { localStorage.setItem(ARCHIVE_KEY, JSON.stringify(archive.slice(-50))); } catch (_) {}
    }
  }

  function parseDateTime(draw) {
    if (!draw?.date || !draw?.time) return null;
    const date = String(draw.date).trim();
    const time = String(draw.time).trim().match(/\d{1,2}:\d{2}(?::\d{2})?/)?.[0];
    if (!time) return null;

    let isoDate = date;
    const dm = date.match(/^(\d{2})[.\-/](\d{2})[.\-/](\d{4})$/);
    if (dm) isoDate = `${dm[3]}-${dm[2]}-${dm[1]}`;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return null;

    const dt = new Date(`${isoDate}T${time.length === 5 ? time + ':00' : time}`);
    return Number.isNaN(dt.getTime()) ? null : dt;
  }

  function median(nums) {
    if (!nums.length) return null;
    const a = [...nums].sort((x, y) => x - y);
    const m = Math.floor(a.length / 2);
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  }

  function inferNextTarget(draws) {
    const latest = draws.at(-1);
    if (!latest) return { draw: null, time: '—', date: '' };

    const recent = draws.slice(-40);
    const diffs = [];
    for (let i = 1; i < recent.length; i++) {
      const a = parseDateTime(recent[i - 1]);
      const b = parseDateTime(recent[i]);
      if (!a || !b) continue;
      const mins = (b - a) / 60000;
      if (mins > 0 && mins <= 60) diffs.push(mins);
    }

    const step = median(diffs);
    const base = parseDateTime(latest);
    if (!base || !step) {
      return { draw: latest.draw + 1, time: '—', date: '' };
    }

    const next = new Date(base.getTime() + step * 60000);
    return {
      draw: latest.draw + 1,
      time: next.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }),
      date: next.toLocaleDateString('ru-RU')
    };
  }

  function columnStats(draws, windowSize = 250) {
    const recent = windowSize ? draws.slice(-windowSize) : draws;
    const frequency = Array(11).fill(0);
    const lastSeen = Array(11).fill(null);

    recent.forEach((d, i) => {
      frequency[d.column] += 1;
      lastSeen[d.column] = i;
    });

    const gaps = {};
    for (let col = 1; col <= 10; col++) {
      gaps[col] = lastSeen[col] == null ? recent.length : recent.length - 1 - lastSeen[col];
    }

    return {
      window: recent.length,
      frequency: Object.fromEntries(Array.from({ length: 10 }, (_, i) => [i + 1, frequency[i + 1]])),
      gaps
    };
  }

  const SMALL_MIRROR = {1:5,5:1,2:4,4:2,6:10,10:6,7:9,9:7};
  const BIG_MIRROR = {1:6,6:1,2:7,7:2,3:8,8:3,4:9,9:4,5:10,10:5};

  function patternSummary(draws) {
    const wins = draws.map(d => d.column);
    const trans = Array.from({length: 11}, () => Array(11).fill(0));
    let repeats = 0, return1 = 0, return2 = 0, return3 = 0;
    let smallMirror = 0, bigMirror = 0, stepContinue = 0;
    let even = 0, odd = 0;

    for (let i = 0; i < wins.length; i++) {
      const cur = wins[i];
      cur % 2 === 0 ? even++ : odd++;
      if (i > 0) {
        const prev = wins[i - 1];
        trans[prev][cur]++;
        if (cur === prev) repeats++;
        if (SMALL_MIRROR[prev] === cur) smallMirror++;
        if (BIG_MIRROR[prev] === cur) bigMirror++;
      }
      if (i > 1 && cur === wins[i - 2]) return1++;
      if (i > 2 && cur === wins[i - 3]) return2++;
      if (i > 3 && cur === wins[i - 4]) return3++;
      if (i > 2) {
        const a = wins[i - 2], b = wins[i - 1];
        if (b + (b - a) === cur) stepContinue++;
      }
    }

    const topTransitions = [];
    for (let a = 1; a <= 10; a++) {
      const rowTotal = trans[a].slice(1).reduce((x,y)=>x+y,0);
      const row = [];
      for (let b = 1; b <= 10; b++) row.push({to:b, count:trans[a][b]});
      row.sort((x,y)=>y.count-x.count || x.to-y.to);
      topTransitions.push({from:a, total:rowTotal, top:row.slice(0,4)});
    }

    const last = wins.at(-1);
    const gapSeries = {};
    for (let col = 1; col <= 10; col++) {
      const positions = [];
      wins.forEach((w,i) => { if (w === col) positions.push(i); });
      const gaps = [];
      for (let i = 1; i < positions.length; i++) gaps.push(positions[i] - positions[i-1]);
      gapSeries[col] = {
        current: positions.length ? wins.length - 1 - positions.at(-1) : wins.length,
        median: median(gaps),
        max: gaps.length ? Math.max(...gaps) : null
      };
    }

    return {
      totalOfficialDraws: wins.length,
      lastColumn: last,
      repeats,
      returnAfter1: return1,
      returnAfter2: return2,
      returnAfter3: return3,
      smallMirrorHits: smallMirror,
      bigMirrorHits: bigMirror,
      stepContinuations: stepContinue,
      parity: {even, odd},
      topTransitions,
      gapSeries
    };
  }

  function buildPayload(draws, target) {
    const latest = draws.at(-1);
    const compactWholeArchive = draws.map(d => `${d.draw}:${d.column}`).join(',');
    const lastFull = draws.slice(-80).map(d => ({
      draw: d.draw,
      date: d.date,
      time: d.time,
      column: d.column,
      parity: d.parity,
      balls: d.balls
    }));

    return {
      task: 'column_matrix_forecast_full_archive',
      app: 'ПОЗИТРОН · МАТРИЦА СТОЛБОВ',
      version: VERSION,
      dataSource: 'fresh GitHub keno-history.json, cache-busted on every forecast',
      archiveOfficialDrawCount: draws.length,
      targetDraw: target.draw,
      targetTime: target.time,
      targetDate: target.date,
      latestDraw: latest?.draw || null,
      latestTime: latest?.time || '',
      latestOfficialColumn: latest?.column || null,
      fullOfficialSequenceCompact: compactWholeArchive,
      recentDraws: lastFull,
      statsAll: columnStats(draws, 0),
      stats500: columnStats(draws, 500),
      stats250: columnStats(draws, 250),
      stats100: columnStats(draws, 100),
      patternsAll: patternSummary(draws),
      request: [
        'Перед тобой полный доступный официальный архив столбцов, а не локальный кэш телефона.',
        'Проведи сравнение всей истории с последними 500/250/100 и особенно последними 80 тиражами.',
        'Обязательно учитывай: переходы столбец→столбец, повторы, возвраты через 1/2/3 тиража, серии, продолжение шага и обратный шаг, малые и большие зеркала, текущие и типичные разрывы, чет/нечет, изменения частот по окнам, а также группы/числа последних тиражей.',
        'Не выбирай столбцы только по простой частоте. Сопоставь несколько независимых сигналов и объясни, какие сигналы сошлись.',
        'КЕНО случайно: не обещай гарантии и не изображай обучение на будущих результатах.',
        'Ответ дай СТРОГО без Markdown и без звездочек в формате:',
        'PICKS: 4,2,9',
        'CONFIDENCE: низкий',
        '4|кратко: какие 2-4 сигнала поддерживают столбец',
        '2|кратко: какие 2-4 сигнала поддерживают столбец',
        '9|кратко: какие 2-4 сигнала поддерживают столбец',
        'SUMMARY: одно короткое итоговое пояснение, почему именно эта тройка.'
      ].join('\n')
    };
  }

  function cleanText(s) {
    return String(s || '').replace(/\*\*/g, '').replace(/`/g, '').trim();
  }

  function parseAnalysis(raw) {
    const text = cleanText(raw);
    const lines = text.split(/\r?\n/).map(x => x.trim()).filter(Boolean);

    let picks = [];
    let confidence = 'низкий';
    let summary = '';
    const reasons = {};

    const picksLine = lines.find(x => /^PICKS\s*:/i.test(x));
    if (picksLine) {
      picks = (picksLine.match(/\d+/g) || [])
        .map(Number)
        .filter(n => n >= 1 && n <= 10)
        .slice(0, 3);
    }

    const confLine = lines.find(x => /^CONFIDENCE\s*:/i.test(x));
    if (confLine) confidence = cleanText(confLine.replace(/^CONFIDENCE\s*:/i, '')) || 'низкий';

    for (const line of lines) {
      const m = line.match(/^([1-9]|10)\s*\|\s*(.+)$/);
      if (m) reasons[Number(m[1])] = cleanText(m[2]);
      if (/^SUMMARY\s*:/i.test(line)) summary = cleanText(line.replace(/^SUMMARY\s*:/i, ''));
    }

    if (picks.length < 3) {
      const found = [];
      const re = /(?:столб(?:ец)?|ст)\s*#?\s*(10|[1-9])/gi;
      let m;
      while ((m = re.exec(text))) {
        const n = Number(m[1]);
        if (!found.includes(n)) found.push(n);
      }
      picks = [...picks, ...found.filter(n => !picks.includes(n))].slice(0, 3);
    }

    if (!summary) {
      summary = lines
        .filter(x => !/^PICKS\s*:/i.test(x) && !/^CONFIDENCE\s*:/i.test(x) && !/^([1-9]|10)\s*\|/.test(x))
        .join(' ')
        .slice(0, 420);
    }

    return { picks, reasons, confidence, summary, raw: text };
  }

  function settleArchive(archive, draws) {
    let changed = false;
    for (const rec of archive) {
      if (rec.settled) continue;
      const actualDraw = draws.find(d => d.draw === rec.targetDraw) || draws.find(d => d.draw > rec.baseDraw);
      if (!actualDraw) continue;

      rec.settled = true;
      rec.actualDraw = actualDraw.draw;
      rec.actualColumn = actualDraw.column;
      rec.actualTime = actualDraw.time || '';
      rec.actualDate = actualDraw.date || '';
      const pos = rec.picks.indexOf(actualDraw.column);
      rec.result = pos === 0 ? 'TOP1' : (pos > 0 ? 'TOP3' : 'MISS');
      changed = true;
    }
    if (changed) saveArchive(archive);
  }

  function currentForecast(archive, latestDraw) {
    return archive.find(r => r.baseDraw === latestDraw && !r.settled) || null;
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;');
  }

  function resultBadge(rec) {
    if (!rec.settled) return '<span class="ai-badge ai-wait">⏳ ЖДЁМ</span>';
    if (rec.result === 'TOP1') return '<span class="ai-badge ai-hit">✅ ТОП-1</span>';
    if (rec.result === 'TOP3') return '<span class="ai-badge ai-hit">✅ ТОП-3</span>';
    return '<span class="ai-badge ai-miss">❌ МИМО</span>';
  }

  function renderForecast(rec) {
    const target = rec
      ? `ТИРАЖ №${rec.targetDraw}${rec.targetTime && rec.targetTime !== '—' ? ` · ${rec.targetTime}` : ''}`
      : 'ПРОГНОЗ НЕ СОЗДАН';

    $('aiTarget').textContent = target;

    if (!rec) {
      $('aiPicks').innerHTML = '<div class="ai-empty">Нажмите «Сделать прогноз».</div>';
      $('aiSummary').textContent = 'ИИ проанализирует текущую историю и сохранит прогноз до появления следующего тиража.';
      $('aiConfidence').textContent = '—';
      return;
    }

    $('aiPicks').innerHTML = rec.picks.map((col, i) => `
      <div class="ai-pick rank-${i + 1}">
        <div class="ai-rank">ТОП-${i + 1}</div>
        <div class="ai-col">СТ${col}</div>
        <div class="ai-reason">${escapeHtml(rec.reasons?.[col] || 'совокупный статистический сигнал')}</div>
      </div>
    `).join('');

    $('aiConfidence').textContent = String(rec.confidence || 'низкий').toUpperCase();
    $('aiSummary').textContent = rec.summary || 'Прогноз сохранён.';
    $('aiMeta').textContent = `Создан после тиража №${rec.baseDraw} · ${new Date(rec.createdAt).toLocaleString('ru-RU')}`;
  }

  function shortDate(value) {
    const raw = String(value || '').trim();
    let m = raw.match(/^(\d{2})[.\-/](\d{2})[.\-/](\d{4})$/);
    if (m) return `${m[1]}.${m[2]}.${m[3].slice(-2)}`;
    m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) return `${m[3]}.${m[2]}.${m[1].slice(-2)}`;
    return raw || '—';
  }

  function archiveResultIcon(rec) {
    if (!rec.settled) return '<span title="ждём результат">—</span>';
    return rec.result === 'TOP1' || rec.result === 'TOP3'
      ? '<span title="попадание в TOP-3">🔥</span>'
      : '<span title="мимо">—</span>';
  }

  function renderArchive(archive) {
    const host = $('aiArchive');
    if (!host) return;
    const recent = archive.slice(-30).reverse();

    if (!recent.length) {
      host.innerHTML = '<div class="ai-empty">Архив пока пуст.</div>';
      return;
    }

    host.innerHTML = `
      <div class="ai-history">
        <div class="ai-history-labels">
          <span>ТИРАЖ</span><span>ДАТА</span><span>ВРЕМЯ</span><span>ИТОГ</span><span></span>
        </div>
        ${recent.map(rec => {
          const hit = rec.settled && (rec.result === 'TOP1' || rec.result === 'TOP3');
          const fact = rec.settled
            ? `<div class="ai-history-fact">
                 ВЫШЕЛ: <strong>СТ${rec.actualColumn}</strong>
                 ${hit ? '<span class="ok">✅</span>' : '<span class="miss">❌ МИМО</span>'}
                 ${rec.actualTime ? `<span class="muted"> · ${escapeHtml(rec.actualTime)}</span>` : ''}
               </div>`
            : '<div class="ai-history-fact muted">Результат ещё не появился.</div>';

          return `
            <details class="ai-history-row">
              <summary class="ai-history-summary">
                <span class="ai-hdraw">№${rec.targetDraw}</span>
                <span class="ai-hdate">${escapeHtml(shortDate(rec.targetDate || rec.actualDate))}</span>
                <span class="ai-htime">${escapeHtml(rec.targetTime && rec.targetTime !== '—' ? rec.targetTime : '—')}</span>
                <span class="ai-hresult">${archiveResultIcon(rec)}</span>
                <span class="ai-harrow">▼</span>
              </summary>
              <div class="ai-history-body">
                <div class="ai-history-caption">ПРОГНОЗ ИИ · TOP-3</div>
                <div class="ai-history-picks">
                  ${rec.picks.map((x, i) => `
                    <div class="ai-history-pick hp${i + 1}">
                      <small>TOP-${i + 1}</small>
                      <b>СТ${x}</b>
                    </div>
                  `).join('')}
                </div>
                ${fact}
                ${rec.summary ? `<div class="ai-history-note">${escapeHtml(rec.summary)}</div>` : ''}
              </div>
            </details>
          `;
        }).join('')}
      </div>
    `;
  }

  async function refreshUi() {
    injectUi();
    let draws;
    try {
      draws = await fetchFullHistory();
      $('aiStatus').textContent = 'АРХИВ СВЕЖИЙ';
    } catch (_) {
      draws = loadDraws();
      $('aiStatus').textContent = 'ЛОКАЛЬНЫЙ РЕЗЕРВ';
    }

    const archive = loadArchive();
    settleArchive(archive, draws);

    const latest = draws.at(-1);
    const current = latest ? currentForecast(archive, latest.draw) : null;
    renderForecast(current);
    renderArchive(loadArchive());

    if (latest) {
      const target = inferNextTarget(draws);
      $('aiNextHint').textContent = current
        ? `База: ${draws.length} официальных тиражей · последний №${latest.draw}. Прогноз зафиксирован.`
        : `База: ${draws.length} официальных тиражей · последний №${latest.draw}. Следующий прогноз: №${target.draw}${target.time !== '—' ? ` · ориентировочно ${target.time}` : ''}`;
    }
  }

  function injectUi() {
    if ($('aiViewBtn')) return;

    const style = document.createElement('style');
    style.textContent = `
      .viewtabs{grid-template-columns:repeat(3,1fr)!important}
      .ai-card{margin-top:0}
      .ai-head{display:flex;justify-content:space-between;gap:10px;align-items:flex-start;margin-bottom:10px}
      .ai-head b{font-size:20px}
      .ai-sub{font-size:11px;color:#9babc0;margin-top:3px;line-height:1.4}
      .ai-status{font-size:12px;font-weight:950;color:#6ee7a0;white-space:nowrap}
      .ai-target{margin:10px 0 8px;border:1px solid #46739f;background:linear-gradient(135deg,#18314f,#10243a);border-radius:13px;padding:11px;text-align:center;font-size:17px;font-weight:1000;color:#fff;letter-spacing:.3px}
      .ai-run{width:100%;border:1px solid #52b8d1;background:linear-gradient(135deg,#16758c,#145269);color:#fff;border-radius:12px;padding:13px;font-size:16px;font-weight:1000;box-shadow:0 5px 20px rgba(34,211,238,.12)}
      .ai-run:disabled{opacity:.55}
      .ai-next{font-size:11px;color:#9babc0;text-align:center;margin:7px 0 10px}
      .ai-picks{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:9px}
      .ai-pick{border-radius:14px;padding:12px 8px;text-align:center;border:1px solid #45627e;box-shadow:inset 0 0 22px rgba(255,255,255,.035)}
      .ai-pick.rank-1{background:linear-gradient(180deg,#5c4810,#2d260d);border-color:#ffd34f}
      .ai-pick.rank-2{background:linear-gradient(180deg,#153f52,#102837);border-color:#56d7ef}
      .ai-pick.rank-3{background:linear-gradient(180deg,#19422e,#102b20);border-color:#6ee7a0}
      .ai-rank{font-size:11px;font-weight:1000;color:#dbe8f7}
      .ai-col{font-size:29px;font-weight:1000;color:#fff;margin:4px 0;text-shadow:0 1px 8px rgba(0,0,0,.4)}
      .ai-reason{font-size:11px;line-height:1.35;color:#e7eef7}
      .ai-summary-box{margin-top:10px;border:1px solid #355273;background:#0b1728;border-radius:12px;padding:11px}
      .ai-summary-title{display:flex;justify-content:space-between;gap:8px;align-items:center;font-size:12px;color:#9babc0;margin-bottom:6px}
      .ai-confidence{border:1px solid #415d78;border-radius:999px;padding:4px 7px;color:#ffd34f;font-weight:950}
      .ai-summary{font-size:13px;line-height:1.5;color:#eef5ff}
      .ai-meta{margin-top:7px;color:#8194aa;font-size:10px}
      .ai-archive-title{margin-top:16px;font-size:21px;font-weight:1000}
      .ai-history{margin-top:10px;border:1px solid #294862;border-radius:16px;overflow:hidden;background:#0b1726}
      .ai-history-labels{display:grid;grid-template-columns:1.45fr .95fr .78fr .78fr 28px;gap:6px;padding:10px 12px 8px;color:#8da1b8;font-size:9px;font-weight:1000;letter-spacing:.08em;background:#10253a}
      .ai-history-labels span:nth-child(4){text-align:center}
      .ai-history-row{border-top:1px solid #24435b}
      .ai-history-row:first-of-type{border-top:0}
      .ai-history-row summary{list-style:none;cursor:pointer}
      .ai-history-row summary::-webkit-details-marker{display:none}
      .ai-history-summary{display:grid;grid-template-columns:1.45fr .95fr .78fr .78fr 28px;gap:6px;align-items:center;padding:13px 12px;background:#0b1d2c}
      .ai-history-row[open] .ai-history-summary{background:#102a3e}
      .ai-hdraw{color:#52d2ff;font-size:14px;font-weight:1000}
      .ai-hdate,.ai-htime{color:#eef5ff;font-size:13px;font-weight:950}
      .ai-hresult{text-align:center;font-size:23px;line-height:1}
      .ai-harrow{color:#8ca1b7;font-size:14px;text-align:right;transition:transform .18s ease}
      .ai-history-row[open] .ai-harrow{transform:rotate(180deg)}
      .ai-history-body{padding:11px 12px 13px;background:#091722;border-top:1px solid #28445c}
      .ai-history-caption{font-size:10px;color:#8da1b8;font-weight:1000;letter-spacing:.06em;margin-bottom:7px}
      .ai-history-picks{display:grid;grid-template-columns:repeat(3,1fr);gap:7px}
      .ai-history-pick{border:1px solid #355673;border-radius:10px;padding:8px;text-align:center;background:#0d2132}
      .ai-history-pick.hp1{border-color:#a78b2c;background:#2c260f}
      .ai-history-pick.hp2{border-color:#267d91;background:#102c38}
      .ai-history-pick.hp3{border-color:#377d56;background:#102a1e}
      .ai-history-pick b{display:block;font-size:18px;color:#fff}
      .ai-history-pick small{font-size:9px;color:#aebfd2;font-weight:900}
      .ai-history-fact{margin-top:9px;padding:10px;border:1px solid #31516c;border-radius:10px;background:#102336;font-size:13px;color:#dce8f4}
      .ai-history-fact strong{font-size:18px;color:#fff}
      .ai-history-fact .ok{color:#62e6a0;font-size:18px;font-weight:1000;margin-left:6px}
      .ai-history-fact .miss{color:#ff9b9b;font-size:13px;font-weight:950;margin-left:6px}
      .ai-history-note{margin-top:8px;color:#a9bbcc;font-size:11px;line-height:1.4}
      .ai-empty{padding:12px;border:1px dashed #355273;border-radius:11px;color:#9babc0;text-align:center;font-size:12px}
      .muted{color:#8194aa}
      .ai-error{color:#ff9b9b}
      @media(max-width:520px){
        .viewtabs{grid-template-columns:repeat(3,1fr)!important}
        .viewtab{font-size:12px;padding:8px 4px}
        .ai-picks{grid-template-columns:1fr}
        .ai-pick{display:grid;grid-template-columns:64px 70px 1fr;align-items:center;text-align:left;gap:6px}
        .ai-col{font-size:25px;margin:0}
      }
    `;
    document.head.appendChild(style);

    const tabs = document.querySelector('.viewtabs');
    if (tabs) {
      const btn = document.createElement('button');
      btn.id = 'aiViewBtn';
      btn.type = 'button';
      btn.className = 'viewtab';
      btn.textContent = '🧠 ИИ';
      tabs.appendChild(btn);
    }

    const host = $('yuliaView')?.parentElement || document.querySelector('.app');
    if (host) {
      const section = document.createElement('section');
      section.id = 'aiView';
      section.className = 'viewpage';
      section.innerHTML = `
        <div class="card ai-card">
          <div class="ai-head">
            <div>
              <b>🧠 Внешний ИИ-прогноз</b>
              <div class="ai-sub">OpenAI через защищённый Cloudflare Worker · прогноз сохраняется до следующего тиража</div>
            </div>
            <div id="aiStatus" class="ai-status">ГОТОВО</div>
          </div>

          <div id="aiTarget" class="ai-target">ПРОГНОЗ НЕ СОЗДАН</div>
          <button id="aiRunBtn" class="ai-run" type="button">СДЕЛАТЬ ПРОГНОЗ</button>
          <div id="aiNextHint" class="ai-next"></div>

          <div id="aiPicks" class="ai-picks"></div>

          <div class="ai-summary-box">
            <div class="ai-summary-title">
              <span>КОММЕНТАРИЙ ИИ</span>
              <span id="aiConfidence" class="ai-confidence">—</span>
            </div>
            <div id="aiSummary" class="ai-summary">—</div>
            <div id="aiMeta" class="ai-meta"></div>
          </div>

          <div class="ai-archive-title">🗂 ИСТОРИЯ ПРОГНОЗОВ</div>
          <div class="ai-sub">Нажмите на тираж — увидите TOP-3 и реальный вышедший столб.</div>
          <div id="aiArchive"></div>
        </div>`;
      host.insertBefore(section, $('settingsPanel') || null);
    }

    $('aiViewBtn')?.addEventListener('click', () => {
      $('matrixView')?.classList.remove('active');
      $('yuliaView')?.classList.remove('active');
      $('aiView')?.classList.add('active');
      document.querySelectorAll('.viewtab').forEach(b => b.classList.remove('active'));
      $('aiViewBtn')?.classList.add('active');
      refreshUi();
    });

    ['matrixViewBtn', 'yuliaViewBtn'].forEach(id => {
      $(id)?.addEventListener('click', () => {
        $('aiView')?.classList.remove('active');
        $('aiViewBtn')?.classList.remove('active');
      });
    });

    $('aiRunBtn')?.addEventListener('click', runExternalAnalysis);
  }

  async function runExternalAnalysis() {
    const btn = $('aiRunBtn');
    btn.disabled = true;
    $('aiStatus').textContent = 'ОБНОВЛЯЮ АРХИВ...';
    $('aiSummary').textContent = 'Сначала загружаю свежий полный keno-history.json из GitHub...';

    let draws;
    try {
      draws = await fetchFullHistory();
    } catch (error) {
      btn.disabled = false;
      $('aiStatus').innerHTML = '<span class="ai-error">ОШИБКА АРХИВА</span>';
      $('aiSummary').innerHTML = `<span class="ai-error">Не удалось получить свежий полный архив: ${escapeHtml(error?.message || error)}. Прогноз не отправлен, чтобы не использовать старые данные.</span>`;
      return;
    }

    const latest = draws.at(-1);
    if (!latest || draws.length < 10) {
      btn.disabled = false;
      $('aiSummary').innerHTML = '<span class="ai-error">Недостаточно официальных данных для анализа.</span>';
      return;
    }

    let archive = loadArchive();
    settleArchive(archive, draws);
    archive = loadArchive();

    const existing = currentForecast(archive, latest.draw);
    if (existing) {
      renderForecast(existing);
      renderArchive(archive);
      $('aiStatus').textContent = 'СОХРАНЕНО';
      return;
    }

    const target = inferNextTarget(draws);
    btn.disabled = true;
    $('aiStatus').textContent = `АНАЛИЗ · ${draws.length} ТИРАЖЕЙ`;
    $('aiTarget').textContent = `ТИРАЖ №${target.draw}${target.time !== '—' ? ` · ${target.time}` : ''}`;
    $('aiSummary').textContent = 'Отправляю данные во внешний ИИ-анализатор...';
    $('aiPicks').innerHTML = '';
    $('aiMeta').textContent = '';

    try {
      const response = await fetch(WORKER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildPayload(draws, target))
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data?.ok) throw new Error(data?.error || `HTTP ${response.status}`);

      const parsed = parseAnalysis(data.analysis || '');
      if (parsed.picks.length < 3) throw new Error('ИИ не вернул три распознаваемых столбца');

      const rec = {
        id: `${latest.draw}-${Date.now()}`,
        version: VERSION,
        createdAt: new Date().toISOString(),
        baseDraw: latest.draw,
        targetDraw: target.draw,
        targetTime: target.time,
        targetDate: target.date,
        picks: parsed.picks,
        reasons: parsed.reasons,
        confidence: parsed.confidence,
        summary: parsed.summary,
        rawAnalysis: parsed.raw,
        settled: false,
        actualDraw: null,
        actualColumn: null,
        actualTime: '',
        result: null
      };

      archive.push(rec);
      saveArchive(archive);
      $('aiStatus').textContent = 'СОХРАНЕНО';
      renderForecast(rec);
      renderArchive(loadArchive());
      $('aiNextHint').textContent = 'Прогноз зафиксирован и будет сверён автоматически после следующего официального тиража.';
    } catch (error) {
      $('aiStatus').innerHTML = '<span class="ai-error">ОШИБКА</span>';
      $('aiSummary').innerHTML = `<span class="ai-error">${escapeHtml(error?.message || error)}</span>`;
    } finally {
      btn.disabled = false;
    }
  }

  injectUi();
  refreshUi();
  setInterval(refreshUi, 60000);
})();
