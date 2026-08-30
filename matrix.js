'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const STORAGE_KEY = 'pozitron_column_matrix_draws_v1';
  const URL_KEY = 'pozitron_column_matrix_source_v1';
  const INTERVAL_KEY = 'pozitron_column_matrix_interval_v1';
  const DEFAULT_URL = 'https://raw.githubusercontent.com/arsazet17/pozitron-column-matrix-v1/main/keno-history.json';

  let draws = [];
  let timer = null;
  let activeView = 'matrix';

  const pad = n => String(n).padStart(2, '0');
  const colOf = n => Number(n) % 10 || 10;

  function normDate(v) {
    const s = String(v || '').trim();
    let m = s.match(/^(\d{2})[.\-/](\d{2})[.\-/](\d{2}|\d{4})$/);
    if (m) {
      const y = m[3].length === 2 ? `20${m[3]}` : m[3];
      return `${y}-${m[2]}-${m[1]}`;
    }
    m = s.match(/^(\d{4})[.\-/](\d{2})[.\-/](\d{2})$/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    return s.slice(0, 10);
  }

  function showDate(v) {
    const p = normDate(v).split('-');
    return p.length === 3 ? `${p[2]}.${p[1]}.${p[0]}` : String(v || '');
  }

  function normTime(v) {
    return String(v || '').match(/\d{1,2}:\d{2}(?::\d{2})?/)?.[0] || '';
  }

  function normParity(v) {
    const s = String(v || '').trim();
    if (/^Больше ч[её]тных$/i.test(s)) return 'Больше чётных';
    if (/^Больше неч[её]тных$/i.test(s)) return 'Больше нечётных';
    if (/^Поровну$/i.test(s)) return 'Поровну';
    return '';
  }

  function normColumn(v) {
    const n = Number(v);
    return Number.isInteger(n) && n >= 1 && n <= 10 ? n : null;
  }

  function valid(obj) {
    const draw = Number(obj?.draw ?? obj?.number ?? obj?.drawNumber ?? obj?.id);
    const date = normDate(obj?.date ?? obj?.drawDate ?? obj?.datetime ?? '');
    const time = normTime(obj?.time ?? obj?.drawTime ?? obj?.datetime ?? '');
    let balls = obj?.balls ?? obj?.numbers ?? obj?.results ?? obj?.result ?? obj?.winningNumbers;
    if (typeof balls === 'string') balls = (balls.match(/\d+/g) || []).map(Number);
    balls = (balls || []).map(Number).slice(0, 20);

    if (!Number.isFinite(draw) || balls.length !== 20 || !balls.every(n => n >= 1 && n <= 80)) return null;

    // ВАЖНО: официальный победивший столб и parity только читаем из history.
    // Ничего не вычисляем из 20 чисел.
    const column = normColumn(obj?.column);
    const parity = normParity(obj?.parity);

    return { draw, date, time, balls, column, parity };
  }

  function walk(value, out = []) {
    if (Array.isArray(value)) {
      value.forEach(v => walk(v, out));
      return out;
    }
    if (value && typeof value === 'object') {
      const d = valid(value);
      if (d) out.push(d);
      else Object.values(value).forEach(v => {
        if (v && typeof v === 'object') walk(v, out);
      });
    }
    return out;
  }

  function dedupe(list) {
    const map = new Map();
    list.forEach(d => {
      const v = valid(d);
      if (v) map.set(v.draw, v);
    });
    return [...map.values()].sort((a, b) => a.draw - b.draw);
  }

  function parsePayload(text) {
    const s = String(text || '').replace(/^\uFEFF/, '').trim();
    if (!s) return [];
    try {
      return dedupe(walk(JSON.parse(s)));
    } catch (_) {
      return [];
    }
  }

  // counts() нужен только для старой аналитики групп 0/1/2/3/4+.
  // Победивший столб через counts() НЕ определяется.
  function counts(draw) {
    const out = Array(11).fill(0);
    (draw?.balls || []).forEach(n => out[colOf(n)] += 1);
    return out;
  }

  function winner(draw) {
    return normColumn(draw?.column);
  }

  function save() {
    // localStorage используется только как небольшой быстрый кэш.
    // Основная база всегда читается из keno-history.json репозитория.
    const sizes = [1200, 600, 300, 150];
    try { localStorage.removeItem(STORAGE_KEY); } catch (_) {}

    for (const size of sizes) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(draws.slice(-size)));
        return;
      } catch (_) {
        try { localStorage.removeItem(STORAGE_KEY); } catch (_) {}
      }
    }
    // Если браузер вообще не даёт место — работа продолжается без кэша.
  }

  function load() {
    try {
      draws = dedupe(JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'));
    } catch (_) {
      draws = [];
    }
  }

  function merge(incoming) {
    const beforeLast = draws.at(-1)?.draw || 0;
    draws = dedupe([...draws, ...incoming]).slice(-2500);
    const added = draws.filter(d => d.draw > beforeLast).length;
    save();
    return added;
  }

  function selectedRows() {
    const limit = Number($('limitSelect').value || 50);
    const date = $('dateSelect').value || '';
    let list = draws;
    if (date) list = list.filter(d => normDate(d.date) === date);
    return list.slice(-limit).reverse();
  }

  function stateClass(n) {
    if (n <= 0) return 'state0';
    if (n === 1) return 'state1';
    if (n === 2) return 'state2';
    if (n === 3) return 'state3';
    return 'state4';
  }

  function stateLabel(n) {
    return n >= 4 ? '4+' : String(n);
  }

  function renderDates() {
    const current = $('dateSelect').value;
    const dates = [...new Set(draws.map(d => normDate(d.date)).filter(Boolean))].reverse();
    $('dateSelect').innerHTML = '<option value="">Все даты</option>' +
      dates.map(d => `<option value="${d}"${d === current ? ' selected' : ''}>${showDate(d)}</option>`).join('');
  }

  function frequency(rows) {
    const f = Array(11).fill(0);
    rows.forEach(d => {
      const w = winner(d);
      if (w) f[w] += 1;
    });
    return f;
  }

  function renderHead() {
    $('matrixHead').innerHTML = `
      <tr>
        <th>Тираж</th>
        ${Array.from({length:10},(_,i)=>`<th class="headnum">${i+1}</th>`).join('')}
        <th>Дата</th>
      </tr>`;
  }

  function groupLabel(count) {
    return count >= 4 ? '4+' : String(count);
  }

  function groupDetails(drawIndex, winnerCol) {
    const prev = drawIndex > 0 ? draws[drawIndex - 1] : null;
    if (!prev || !winnerCol) {
      return { group:'—', columns:[], numbers:[] };
    }
    const c = counts(prev);
    const raw = c[winnerCol] || 0;
    const same = [];
    for (let col = 1; col <= 10; col += 1) {
      const value = c[col] || 0;
      const sameGroup = raw >= 4 ? value >= 4 : value === raw;
      if (sameGroup) same.push(col);
    }
    const numbers = (prev.balls || []).map(Number).filter(n => colOf(n) === winnerCol);
    return { group:groupLabel(raw), columns:same, numbers };
  }

  function closeMatrixPopup() {
    const p = $('matrixPopup');
    if (p) p.hidden = true;
  }

  function placeMatrixPopup(cell) {
    const popup = $('matrixPopup');
    if (!popup || !cell) return;
    popup.hidden = false;

    const r = cell.getBoundingClientRect();
    const padPx = 8;
    const w = popup.offsetWidth;
    const h = popup.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let left = r.right + 8;
    let top = r.top - 8;

    if (left + w > vw - padPx) left = r.left - w - 8;
    if (left < padPx) {
      left = Math.max(padPx, Math.min(r.left, vw - w - padPx));
      top = r.bottom + 8;
    }
    if (top + h > vh - padPx) top = Math.max(padPx, r.top - h - 8);

    popup.style.left = `${Math.round(left)}px`;
    popup.style.top = `${Math.round(top)}px`;
  }

  function showWinnerPopup(cell, drawNumber, winnerCol) {
    const idx = draws.findIndex(d => Number(d.draw) === Number(drawNumber));
    if (idx < 0) return;
    const info = groupDetails(idx, winnerCol);

    $('mpTitle').textContent = `ст${winnerCol}`;
    $('mpDraw').textContent = `№${drawNumber}`;
    $('mpGroup').textContent = info.group;
    $('mpCols').textContent = info.columns.length ? info.columns.map(c => `ст${c}`).join(' · ') : '—';
    $('mpNums').textContent = info.numbers.length ? info.numbers.map(n => pad(n)).join(' · ') : '—';

    placeMatrixPopup(cell);
  }

  function renderBody(rows) {
    if (!rows.length) {
      $('matrixBody').innerHTML = '<tr><td colspan="12" style="padding:18px;color:#9babc0">Нет данных</td></tr>';
      return;
    }

    $('matrixBody').innerHTML = rows.map(d => {
      const w = winner(d);
      const cells = Array.from({length:10},(_,i) => {
        const col = i + 1;
        const isWin = col === w;
        return `<td class="cell ${isWin ? 'win' : ''}"
          ${isWin ? `data-win-draw="${d.draw}" data-win-col="${col}"` : ''}
          title="${isWin ? `официальный Столото: ст${col} — нажмите для группы выхода` : (w ? `ст${col}` : 'официальный столбец отсутствует в старой записи')}">${isWin ? col : ''}</td>`;
      }).join('');

      return `<tr>
        <td>${d.draw}</td>
        ${cells}
        <td class="date">${showDate(d.date)}<br><small>${d.time || ''}</small></td>
      </tr>`;
    }).join('');

    document.querySelectorAll('[data-win-draw]').forEach(cell => {
      cell.onclick = event => {
        event.stopPropagation();
        showWinnerPopup(cell, Number(cell.dataset.winDraw), Number(cell.dataset.winCol));
      };
    });
  }

  function renderStats(rows) {
    const f = frequency(rows);
    const officialRows = rows.filter(d => winner(d)).length;
    const total = officialRows || 1;
    $('statsRows').innerHTML = Array.from({length:10},(_,i) => {
      const c = i + 1;
      const pct = Math.round(f[c] * 100 / total);
      return `<div class="row"><b>ст${c}</b> — ${f[c]} из ${officialRows} · ${pct}%</div>`;
    }).join('');
  }

  function dateKeyToMs(dateKey) {
    const m = String(dateKey || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return NaN;
    return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }

  function msToDateKey(ms) {
    const d = new Date(ms);
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())}`;
  }

  function shiftDateKey(dateKey, deltaDays) {
    const ms = dateKeyToMs(dateKey);
    if (!Number.isFinite(ms)) return '';
    return msToDateKey(ms + deltaDays * 86400000);
  }

  function yuliaData() {
    const byDate = new Map();

    draws.forEach(d => {
      const dk = normDate(d.date);
      const tm = normTime(d.time).slice(0,5);
      if (!dk || !tm) return;
      if (!byDate.has(dk)) byDate.set(dk, new Map());
      byDate.get(dk).set(tm, d);
    });

    const allDates = [...byDate.keys()].sort();
    const days = Number($('yuliaDays')?.value || 14);
    const dates = allDates.slice(-days);

    const times = [...new Set(
      dates.flatMap(d => [...(byDate.get(d)?.keys() || [])])
    )].sort((a,b) => {
      const [ah,am] = a.split(':').map(Number);
      const [bh,bm] = b.split(':').map(Number);
      return (ah*60+am) - (bh*60+bm);
    });

    return { byDate, dates, times };
  }

  function yuliaColorClass(data, dateKey, time, timeIndex, value) {
    if (!value) return '';
    const { byDate, times } = data;
    const prev1 = shiftDateKey(dateKey, -1);
    const prev2 = shiftDateKey(dateKey, -2);

    const same1 = byDate.get(prev1)?.get(time);
    if (same1 && winner(same1) === value) return 'y-blue';

    const rightTime = times[timeIndex + 1];
    const right = rightTime ? byDate.get(prev1)?.get(rightTime) : null;
    if (right && winner(right) === value) return 'y-green';

    const leftTime = times[timeIndex - 1];
    const left = leftTime ? byDate.get(prev1)?.get(leftTime) : null;
    if (left && winner(left) === value) return 'y-orange';

    const same2 = byDate.get(prev2)?.get(time);
    if (same2 && winner(same2) === value) return 'y-light';

    return '';
  }

  function renderYulia() {
    if (!$('yuliaHead') || !$('yuliaBody')) return;

    const data = yuliaData();

    $('yuliaHead').innerHTML = `<tr>
      <th>Дата</th>
      ${data.times.map(t => `<th>${t}</th>`).join('')}
    </tr>`;

    if (!data.dates.length || !data.times.length) {
      $('yuliaBody').innerHTML = '<tr><td colspan="2">Нет данных</td></tr>';
      return;
    }

    $('yuliaBody').innerHTML = data.dates.map(dateKey => {
      const map = data.byDate.get(dateKey) || new Map();

      const cells = data.times.map((time, timeIndex) => {
        const d = map.get(time);
        if (!d) return '<td></td>';

        const w = winner(d);
        if (!w) return '<td></td>';

        const cls = yuliaColorClass(data, dateKey, time, timeIndex, w);
        const drawIndex = draws.findIndex(x => Number(x.draw) === Number(d.draw));
        const group = drawIndex >= 0 ? groupDetails(drawIndex, w).group : '—';
        return `<td class="yulia-cell ${cls}"
          data-win-draw="${d.draw}"
          data-win-col="${w}"
          title="${time} · официальный Столото ст${w} · нажмите для группы"><span class="yulia-main-value">${w}</span><span class="yulia-group-mark">(${group})</span></td>`;
      }).join('');

      return `<tr>
        <td>${showDate(dateKey)}</td>
        ${cells}
      </tr>`;
    }).join('');

    $('yuliaBody').querySelectorAll('[data-win-draw]').forEach(cell => {
      cell.onclick = event => {
        event.stopPropagation();
        showWinnerPopup(cell, Number(cell.dataset.winDraw), Number(cell.dataset.winCol));
      };
    });
  }

  function switchView(view) {
    activeView = view === 'yulia' ? 'yulia' : 'matrix';

    $('matrixView')?.classList.toggle('active', activeView === 'matrix');
    $('yuliaView')?.classList.toggle('active', activeView === 'yulia');
    $('matrixViewBtn')?.classList.toggle('active', activeView === 'matrix');
    $('yuliaViewBtn')?.classList.toggle('active', activeView === 'yulia');

    closeMatrixPopup();
    window.scrollTo({ top:0, behavior:'smooth' });
  }

  function render() {
    closeMatrixPopup();
    renderDates();
    const rows = selectedRows();
    renderHead();
    renderBody(rows);
    renderStats(rows);
    renderYulia();

    if (draws.length) {
      const last = draws.at(-1);
      const official = winner(last) ? ` · Столбец ${winner(last)}` : '';
      $('status').textContent = `База: ${draws.length.toLocaleString('ru-RU')} · последний №${last.draw} · ${showDate(last.date)} ${last.time || ''}${official}`;
    } else {
      $('status').textContent = 'База пока пустая';
    }
  }

  function sourceUrl() {
    // Для Матрицы столбов единственный штатный источник —
    // её собственный keno-history.json.
    // Старое пользовательское значение источника автоматически заменяется.
    const saved = (localStorage.getItem(URL_KEY) || '').trim();
    if (saved !== DEFAULT_URL) {
      try { localStorage.setItem(URL_KEY, DEFAULT_URL); } catch (_) {}
    }
    return DEFAULT_URL;
  }

  async function fetchSource(url) {
    const busted = url + (url.includes('?') ? '&' : '?') + 't=' + Date.now();
    const r = await fetch(busted, { cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const incoming = parsePayload(await r.text());
    if (!incoming.length) throw new Error('нет распознанных тиражей');
    return incoming;
  }

  async function update() {
    const saved = sourceUrl();
    $('status').textContent = 'Проверяю новые тиражи…';
    try {
      const incoming = await fetchSource(saved);
      const added = merge(incoming);
      render();
      const officialCount = draws.filter(d => winner(d)).length;
      $('status').textContent = `Обновлено · добавлено ${added} · всего ${draws.length} · официальных столбцов ${officialCount}`;
    } catch (e) {
      render();
      $('status').textContent = 'Обновление не выполнено: ' + e.message;
    }
  }

  function setupAuto() {
    if (timer) clearInterval(timer);
    timer = null;
    const ms = Number(localStorage.getItem(INTERVAL_KEY) || 60000);
    if (ms) timer = setInterval(update, ms);
  }

  function openSettings() {
    $('settingsPanel').classList.toggle('show');
    $('sourceInput').value = sourceUrl();
    $('intervalSelect').value = localStorage.getItem(INTERVAL_KEY) || '60000';
    if ($('settingsPanel').classList.contains('show')) {
      $('settingsPanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  $('mpClose').onclick = closeMatrixPopup;
  document.addEventListener('click', event => {
    if (!event.target.closest('#matrixPopup') && !event.target.closest('[data-win-draw]')) closeMatrixPopup();
  });
  window.addEventListener('resize', closeMatrixPopup);
  window.addEventListener('scroll', closeMatrixPopup, true);

  $('matrixViewBtn').onclick = () => switchView('matrix');
  $('yuliaViewBtn').onclick = () => switchView('yulia');
  $('homeBtn').onclick = () => window.scrollTo({top:0,behavior:'smooth'});
  $('yuliaDays').onchange = renderYulia;
  $('limitSelect').onchange = render;
  $('dateSelect').onchange = render;
  $('syncBtn').onclick = update;
  $('syncBtn2').onclick = update;
  $('settingsBtn').onclick = openSettings;
  $('settingsBtn2').onclick = openSettings;
  $('statsBtn').onclick = () => {
    $('statsPanel').classList.toggle('show');
    if ($('statsPanel').classList.contains('show')) {
      $('statsPanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };
  $('saveSettings').onclick = () => {
    localStorage.setItem(URL_KEY, $('sourceInput').value.trim() || DEFAULT_URL);
    localStorage.setItem(INTERVAL_KEY, $('intervalSelect').value);
    setupAuto();
    $('settingsPanel').classList.remove('show');
    update();
  };

  load();
  render();
  setupAuto();
setTimeout(update, 500);
})();
