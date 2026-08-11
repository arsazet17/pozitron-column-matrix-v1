'use strict';

(() => {
  const STORAGE_KEY = 'pozitron_column_matrix_draws_v1';
  // New archive key so old forecasts based on calculated columns are NOT mixed
  // with forecasts based on official Stoloto draw.column.
  const ARCHIVE_KEY = 'pozitron_column_matrix_ai_archive_stoloto_v2';
  const VERSION = 'AI-2.0-STOLOTO';

  const $ = (id) => document.getElementById(id);
  const colOf = (n) => Number(n) % 10 || 10;

  const SMALL_MIRROR = {1:5,5:1,2:4,4:2,6:10,10:6,7:9,9:7};
  const BIG_MIRROR = {1:6,6:1,2:7,7:2,3:8,8:3,4:9,9:4,5:10,10:5};

  function safeJson(raw, fallback) {
    try { return JSON.parse(raw); } catch (_) { return fallback; }
  }

  function officialColumn(value) {
    const n = Number(value);
    return Number.isInteger(n) && n >= 1 && n <= 10 ? n : null;
  }

  function normalizeDraw(d) {
    if (!d || !Array.isArray(d.balls) || d.balls.length < 20) return null;

    const draw = Number(d.draw);
    const balls = d.balls.slice(0,20).map(Number);
    const column = officialColumn(d.column);

    if (!Number.isFinite(draw)) return null;
    if (!balls.every(n => Number.isInteger(n) && n >= 1 && n <= 80)) return null;

    // IMPORTANT: AI does not calculate the winning column from balls.
    // Rows without official draw.column are excluded from column analysis.
    if (!column) return null;

    return {
      draw,
      date: String(d.date || ''),
      time: String(d.time || ''),
      balls,
      column,
      parity: String(d.parity || '')
    };
  }

  function loadDraws() {
    const raw = safeJson(localStorage.getItem(STORAGE_KEY) || '[]', []);
    const map = new Map();

    (Array.isArray(raw) ? raw : []).forEach(item => {
      const d = normalizeDraw(item);
      if (d) map.set(d.draw, d);
    });

    return [...map.values()].sort((a,b) => a.draw - b.draw);
  }

  function counts(draw) {
    const out = Array(11).fill(0);
    draw.balls.forEach(n => out[colOf(n)]++);
    return out;
  }

  // The ONLY source of the winning column.
  function winner(draw) {
    return officialColumn(draw?.column);
  }

  function parityMode(wins) {
    const last = wins.slice(-10);
    if (!last.length) return { key:'MIX', label:'МИКС' };

    const even = last.filter(x => x % 2 === 0).length;
    if (last.length >= 7 && even >= Math.ceil(last.length * 0.7)) {
      return { key:'EVEN', label:'ЧЁТ' };
    }
    if (last.length >= 7 && (last.length - even) >= Math.ceil(last.length * 0.7)) {
      return { key:'ODD', label:'НЕЧЁТ' };
    }

    const recent = last.slice(-4);
    const re = recent.filter(x => x % 2 === 0).length;
    if (re >= 3) return { key:'MIX_E', label:'МИКС → ЧЁТ' };
    if ((recent.length - re) >= 3) return { key:'MIX_O', label:'МИКС → НЕЧЁТ' };

    return { key:'MIX', label:'МИКС' };
  }

  function groupLabel(n) {
    return n >= 4 ? '4+' : String(n);
  }

  function train(draws) {
    const trans = Array.from({length:11}, () => Array(11).fill(1));
    const groupNext = Array.from(
      {length:11},
      () => ({'0':[1,1], '1':[1,1], '2':[1,1], '3':[1,1], '4+':[1,1]})
    );
    const gapHits = Array.from({length:11}, () => []);
    const lastSeen = Array(11).fill(-1);

    for (let i = 0; i < draws.length - 1; i++) {
      const a = winner(draws[i]);
      const b = winner(draws[i+1]);
      if (!a || !b) continue;

      trans[a][b]++;

      const c = counts(draws[i]);
      for (let col = 1; col <= 10; col++) {
        const g = groupLabel(c[col]);
        groupNext[col][g][1]++;
        if (b === col) groupNext[col][g][0]++;
      }

      if (lastSeen[b] >= 0) gapHits[b].push(i + 1 - lastSeen[b]);
      lastSeen[b] = i + 1;
    }

    return { trans, groupNext, gapHits };
  }

  function median(nums) {
    if (!nums.length) return 0;
    const a = [...nums].sort((x,y)=>x-y);
    const m = Math.floor(a.length/2);
    return a.length % 2 ? a[m] : (a[m-1]+a[m])/2;
  }

  function addSignal(state, col, points, reason) {
    state[col].score += points;
    if (reason && !state[col].reasons.includes(reason)) {
      state[col].reasons.push(reason);
    }
  }

  function predict(draws) {
    const wins = draws.map(winner).filter(Boolean);
    const model = train(draws);
    const mode = parityMode(wins);
    const state = Array.from({length:11}, () => ({score:0, reasons:[]}));

    const last = wins.at(-1);
    const p1 = wins.at(-2);
    const p2 = wins.at(-3);
    const p3 = wins.at(-4);

    const latest = draws.at(-1);
    const latestCounts = latest ? counts(latest) : Array(11).fill(0);

    // 1) Historical transition from the last official winning column.
    if (last) {
      const row = model.trans[last];
      const base = row.slice(1).reduce((a,b)=>a+b,0) / 10;
      for (let col=1; col<=10; col++) {
        const rel = row[col] / Math.max(base, 1);
        addSignal(
          state, col,
          Math.max(-5, Math.min(8, (rel - 1) * 22)),
          'история переходов'
        );
      }
    }

    // 2) Repeat and returns.
    if (last) addSignal(state, last, 8, 'повтор');
    if (p1) addSignal(state, p1, 11, 'возврат через 1');
    if (p2) addSignal(state, p2, 7, 'возврат через 2');
    if (p3) addSignal(state, p3, 4, 'возврат через 3');

    // 3) Mirrors.
    if (last && SMALL_MIRROR[last]) {
      addSignal(state, SMALL_MIRROR[last], 9, 'малое зеркало');
    }
    if (last && BIG_MIRROR[last]) {
      addSignal(state, BIG_MIRROR[last], 7, 'большое зеркало');
    }

    // 4) Step continuation and bounce.
    if (last && p1) {
      const step = last - p1;
      const cont = last + step;
      const bounce = last - step;

      if (cont >= 1 && cont <= 10 && step !== 0) {
        addSignal(state, cont, 9, 'продолжение шага');
      }
      if (bounce >= 1 && bounce <= 10 && step !== 0) {
        addSignal(state, bounce, 7, 'обратный шаг');
      }
      if (Math.abs(step) === 1) {
        const neighbor = last + (step > 0 ? 1 : -1);
        if (neighbor >= 1 && neighbor <= 10) {
          addSignal(state, neighbor, 3, 'движение по соседям');
        }
      }
    }

    // 5) Winning-column even/odd mode.
    for (let col=1; col<=10; col++) {
      const even = col % 2 === 0;
      if (mode.key === 'EVEN' && even) addSignal(state, col, 8, 'плотность ЧЁТ');
      if (mode.key === 'ODD' && !even) addSignal(state, col, 8, 'плотность НЕЧЁТ');
      if (mode.key === 'MIX_E' && even) addSignal(state, col, 5, 'МИКС с уклоном ЧЁТ');
      if (mode.key === 'MIX_O' && !even) addSignal(state, col, 5, 'МИКС с уклоном НЕЧЁТ');
      if (mode.key === 'MIX') addSignal(state, col, 1, 'режим МИКС');
    }

    // 6) Current 0/1/2/3/4+ groups from balls.
    // This is only group analysis; it is NOT used to calculate the winning column.
    for (let col=1; col<=10; col++) {
      const g = groupLabel(latestCounts[col] || 0);
      const [hit, exposure] = model.groupNext[col][g];
      const rate = hit / Math.max(exposure,1);
      addSignal(
        state, col,
        Math.max(-4, Math.min(7, (rate - 0.1) * 55)),
        `группа ${g}`
      );
    }

    // 7) Gap since the last official winning-column occurrence.
    for (let col=1; col<=10; col++) {
      let gap = wins.length;

      for (let i=wins.length-1; i>=0; i--) {
        if (wins[i] === col) {
          gap = wins.length - 1 - i;
          break;
        }
      }

      const typical = median(model.gapHits[col]) || 10;
      const rel = gap / Math.max(typical,1);

      if (rel >= 1.8) addSignal(state, col, 8, 'долгий разрыв');
      else if (rel >= 1.25) addSignal(state, col, 5, 'разрыв выше обычного');
      else if (gap === 0) addSignal(state, col, 2, 'только что вышел');
    }

    const ranking = Array.from({length:10},(_,i)=>i+1)
      .sort((a,b) => state[b].score - state[a].score || a-b)
      .map(col => ({
        col,
        score: Math.round(state[col].score * 10) / 10,
        reasons: state[col].reasons.slice(0,4)
      }));

    return {
      mode,
      top3: ranking.slice(0,3),
      ranking
    };
  }

  function loadArchive() {
    const a = safeJson(localStorage.getItem(ARCHIVE_KEY) || '[]', []);
    return Array.isArray(a) ? a : [];
  }

  function saveArchive(a) {
    try {
      localStorage.setItem(ARCHIVE_KEY, JSON.stringify(a.slice(-300)));
    } catch (_) {
      try {
        localStorage.setItem(ARCHIVE_KEY, JSON.stringify(a.slice(-100)));
      } catch (_) {}
    }
  }

  function settleArchive(archive, draws) {
    let changed = false;

    for (const rec of archive) {
      if (rec.settled) continue;

      const actualDraw = draws.find(d => d.draw > rec.baseDraw);
      if (!actualDraw) continue;

      const actual = winner(actualDraw);
      if (!actual) continue;

      rec.settled = true;
      rec.actualDraw = actualDraw.draw;
      rec.actual = actual;

      const pos = rec.picks.indexOf(actual);
      rec.result = pos === 0 ? 'TOP1' : (pos >= 0 ? 'TOP3' : 'MISS');
      changed = true;
    }

    if (changed) saveArchive(archive);
  }

  function ensureCurrentForecast(draws, archive) {
    if (draws.length < 6) return null;

    const latest = draws.at(-1);
    const existing = archive.find(r => r.baseDraw === latest.draw && !r.settled);
    if (existing) return existing;

    const p = predict(draws);
    const chain = draws.slice(-5).map(d => ({
      draw: d.draw,
      winner: winner(d)
    }));

    const rec = {
      id: `${latest.draw}-${Date.now()}`,
      version: VERSION,
      createdAt: new Date().toISOString(),
      baseDraw: latest.draw,
      chain,
      mode: p.mode.label,
      picks: p.top3.map(x => x.col),
      reasons: Object.fromEntries(p.top3.map(x => [x.col, x.reasons])),
      settled: false,
      actualDraw: null,
      actual: null,
      result: null
    };

    archive.push(rec);
    saveArchive(archive);
    return rec;
  }

  function injectUi() {
    if ($('aiViewBtn')) return;

    const style = document.createElement('style');
    style.textContent = `
      .viewtabs{grid-template-columns:repeat(3,1fr)!important}
      .ai-card{margin-top:0}
      .ai-head{display:flex;justify-content:space-between;gap:8px;align-items:center;margin-bottom:9px}
      .ai-head b{font-size:18px}
      .ai-sub{font-size:11px;color:#9babc0;margin-top:2px}
      .ai-mode{border:1px solid #355273;background:#102137;border-radius:999px;padding:6px 9px;font-size:12px;font-weight:900}
      .ai-picks{display:grid;grid-template-columns:repeat(3,1fr);gap:7px}
      .ai-pick{border:1px solid #355273;background:#0b1728;border-radius:12px;padding:10px;text-align:center}
      .ai-pick strong{display:block;font-size:24px;color:#ffd34f}
      .ai-pick small{display:block;color:#9babc0;margin-top:5px;line-height:1.35}
      .ai-archive{margin-top:10px}
      .ai-rec{border:1px solid #2d4665;background:#101f33;border-radius:11px;padding:9px;margin-top:7px;font-size:12px}
      .ai-chain{font-family:ui-monospace,Consolas,monospace;color:#dbe9f8;margin:5px 0}
      .ai-good{color:#6ee7a0;font-weight:950}
      .ai-bad{color:#ff9b9b;font-weight:950}
      .ai-wait{color:#ffd34f;font-weight:950}
      @media(max-width:520px){
        .ai-picks{grid-template-columns:1fr}
        .viewtabs{grid-template-columns:1fr 1fr 1fr!important}
        .viewtab{font-size:12px;padding:8px 4px}
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
              <b>🧠 ИИ Анализ</b>
              <div class="ai-sub">логический прогноз по текущему состоянию</div>
            </div>
            <div id="aiMode" class="ai-mode">—</div>
          </div>
          <div id="aiPicks" class="ai-picks"></div>
          <div class="groupnote">
            Проценты не показываются. ИИ учитывает повторы, зеркала, шаги, группы и Ч/Н/МИКС.
          </div>
          <div class="ai-archive">
            <b>🗂 Архив прогнозов</b>
            <div class="ai-sub">цепочка 5 тиражей → прогноз → факт</div>
            <div id="aiArchive"></div>
          </div>
        </div>`;
      host.insertBefore(section, $('settingsPanel') || null);
    }

    $('aiViewBtn')?.addEventListener('click', () => {
      $('matrixView')?.classList.remove('active');
      $('yuliaView')?.classList.remove('active');
      $('aiView')?.classList.add('active');

      document.querySelectorAll('.viewtab').forEach(b => b.classList.remove('active'));
      $('aiViewBtn')?.classList.add('active');
      render();
    });

    ['matrixViewBtn','yuliaViewBtn'].forEach(id => {
      $(id)?.addEventListener('click', () => {
        $('aiView')?.classList.remove('active');
        $('aiViewBtn')?.classList.remove('active');
      });
    });
  }

  function resultLabel(rec) {
    if (!rec.settled) {
      return '<span class="ai-wait">⏳ ждём результат</span>';
    }
    if (rec.result === 'TOP1') {
      return '<span class="ai-good">✅ ТОП-1</span>';
    }
    if (rec.result === 'TOP3') {
      return '<span class="ai-good">✅ ТОП-3</span>';
    }
    return '<span class="ai-bad">❌ мимо</span>';
  }

  function render() {
    injectUi();

    const draws = loadDraws();
    const archive = loadArchive();
    settleArchive(archive, draws);

    if (draws.length < 6) {
      if ($('aiPicks')) {
        $('aiPicks').innerHTML =
          '<div class="row">Недостаточно официальных столбцов Столото для ИИ.</div>';
      }
      if ($('aiMode')) $('aiMode').textContent = 'СТОЛОТО';
      return;
    }

    const current = ensureCurrentForecast(draws, archive);
    if (!current) return;

    $('aiMode').textContent = current.mode || '—';

    $('aiPicks').innerHTML = current.picks.map((col, i) => {
      const reasons =
        (current.reasons?.[col] || []).slice(0,3).join(' · ') ||
        'совокупный сигнал';

      return `
        <div class="ai-pick">
          <span>ТОП-${i+1}</span>
          <strong>ст${col}</strong>
          <small>${reasons}</small>
        </div>`;
    }).join('');

    const recent = loadArchive().slice(-20).reverse();

    $('aiArchive').innerHTML = recent.map(rec => {
      const chain = (rec.chain || [])
        .map(x => `№${x.draw}:ст${x.winner}`)
        .join(' → ');

      const fact = rec.settled ? ` · факт: ст${rec.actual}` : '';

      return `
        <div class="ai-rec">
          <div><b>После №${rec.baseDraw}</b> · ${rec.mode}</div>
          <div class="ai-chain">${chain}</div>
          <div>
            Прогноз: <b>${rec.picks.map(x=>'ст'+x).join(' · ')}</b>${fact}
          </div>
          <div>${resultLabel(rec)}</div>
        </div>`;
    }).join('');
  }

  injectUi();
  render();

  // matrix.js updates local cache without a storage event in the same tab.
  setInterval(render, 15000);
})();
