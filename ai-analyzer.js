'use strict';

(() => {
  const STORAGE_KEY = 'pozitron_column_matrix_draws_v1';
  const ARCHIVE_KEY = 'pozitron_openai_forecast_archive_v2';
  const WORKER_URL = 'https://pozitron-gigachat-api.arsazet-17-go.workers.dev';
  const VERSION = 'OPENAI-EXTERNAL-2.0';

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

  function loadDraws() {
    const raw = safeJson(localStorage.getItem(STORAGE_KEY) || '[]', []);
    const map = new Map();
    (Array.isArray(raw) ? raw : []).forEach(item => {
      const d = normalizeDraw(item);
      if (d) map.set(d.draw, d);
    });
    return [...map.values()].sort((a, b) => a.draw - b.draw);
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
    const recent = draws.slice(-windowSize);
    const frequency = Array(11).fill(0);
    const lastSeen = Array(11).fill(null);

    recent.forEach((d, i) => {
      frequency[d.column] += 1;
      lastSeen[d.column] = i;
    });

    const gaps = {};
    for (let col = 1; col <= 10; col++) {
      gaps[col] = lastSeen[col] == null
        ? recent.length
        : recent.length - 1 - lastSeen[col];
    }

    return {
      window: recent.length,
      frequency: Object.fromEntries(Array.from({ length: 10 }, (_, i) => [i + 1, frequency[i + 1]])),
      gaps
    };
  }

  function buildPayload(draws, target) {
    const latest = draws.at(-1);
    return {
      task: 'column_matrix_forecast',
      app: 'ПОЗИТРОН · МАТРИЦА СТОЛБОВ',
      version: VERSION,
      targetDraw: target.draw,
      targetTime: target.time,
      targetDate: target.date,
      latestDraw: latest?.draw || null,
      latestOfficialColumn: latest?.column || null,
      recentOfficialColumns: draws.slice(-300).map(d => d.column),
      recentDraws: draws.slice(-35).map(d => ({
        draw: d.draw,
        date: d.date,
        time: d.time,
        column: d.column,
        parity: d.parity,
        balls: d.balls
      })),
      stats250: columnStats(draws, 250),
      request: [
        'Проанализируй данные как статистический помощник. Учитывай частоты, текущие разрывы, переходы между столбцами, повторы, возвраты через 1-3 тиража, шаги последовательности, зеркальные/симметричные переходы, режим чет/нечет и последние 35 тиражей.',
        'Не утверждай, что случайный результат можно гарантированно предсказать.',
        'Ответ дай СТРОГО без Markdown и без звездочек в таком формате:',
        'PICKS: 4,2,9',
        'CONFIDENCE: низкий',
        '4|краткая причина для столбца 4',
        '2|краткая причина для столбца 2',
        '9|краткая причина для столбца 9',
        'SUMMARY: одно короткое итоговое пояснение.'
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

  function renderArchive(archive) {
    const host = $('aiArchive');
    if (!host) return;
    const recent = archive.slice(-20).reverse();

    if (!recent.length) {
      host.innerHTML = '<div class="ai-empty">Архив пока пуст.</div>';
      return;
    }

    host.innerHTML = recent.map(rec => {
      const fact = rec.settled
        ? `<div class="ai-fact">ФАКТ: <strong>СТ${rec.actualColumn}</strong> · тираж №${rec.actualDraw}${rec.actualTime ? ` · ${escapeHtml(rec.actualTime)}` : ''}</div>`
        : '<div class="ai-fact muted">Факт появится после следующего тиража.</div>';
      return `
        <div class="ai-archive-row">
          <div class="ai-archive-head">
            <b>№${rec.targetDraw}${rec.targetTime && rec.targetTime !== '—' ? ` · ${escapeHtml(rec.targetTime)}` : ''}</b>
            ${resultBadge(rec)}
          </div>
          <div class="ai-mini-picks">${rec.picks.map((x, i) => `<span class="mini-${i + 1}">СТ${x}</span>`).join('')}</div>
          ${fact}
        </div>
      `;
    }).join('');
  }

  function refreshUi() {
    injectUi();
    const draws = loadDraws();
    const archive = loadArchive();
    settleArchive(archive, draws);

    const latest = draws.at(-1);
    const current = latest ? currentForecast(archive, latest.draw) : null;
    renderForecast(current);
    renderArchive(loadArchive());

    if (latest) {
      const target = inferNextTarget(draws);
      $('aiNextHint').textContent = current
        ? 'Прогноз зафиксирован и будет сверён автоматически.'
        : `Следующий прогноз: тираж №${target.draw}${target.time !== '—' ? ` · ориентировочно ${target.time}` : ''}`;
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
      .ai-archive-title{margin-top:14px;font-size:16px;font-weight:1000}
      .ai-archive-row{margin-top:8px;border:1px solid #2d4665;background:#101f33;border-radius:12px;padding:9px}
      .ai-archive-head{display:flex;align-items:center;justify-content:space-between;gap:8px}
      .ai-badge{font-size:10px;font-weight:1000;border-radius:999px;padding:4px 7px;border:1px solid}
      .ai-hit{color:#6ee7a0;border-color:#2f8253;background:#123522}
      .ai-miss{color:#ffaaaa;border-color:#854343;background:#351919}
      .ai-wait{color:#ffd34f;border-color:#7b6628;background:#342b11}
      .ai-mini-picks{display:flex;gap:6px;margin-top:7px;flex-wrap:wrap}
      .ai-mini-picks span{font-weight:1000;border-radius:8px;padding:5px 8px;border:1px solid #415c77}
      .ai-mini-picks .mini-1{color:#ffe06b;border-color:#9b7c1d}
      .ai-mini-picks .mini-2{color:#75e5f7;border-color:#27849a}
      .ai-mini-picks .mini-3{color:#8df0b3;border-color:#35885a}
      .ai-fact{margin-top:7px;font-size:12px;color:#dbe7f3}
      .ai-fact strong{font-size:15px;color:#fff}
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

          <div class="ai-archive-title">🗂 АРХИВ ПРОГНОЗОВ</div>
          <div class="ai-sub">Прогноз → следующий официальный тираж → факт</div>
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
    const draws = loadDraws();
    const latest = draws.at(-1);

    if (!latest || draws.length < 10) {
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
    const btn = $('aiRunBtn');
    btn.disabled = true;
    $('aiStatus').textContent = 'АНАЛИЗ...';
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
  setInterval(refreshUi, 15000);
})();
