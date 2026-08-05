'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const STORAGE_KEY = 'pozitron_column_matrix_draws_v1';
  const URL_KEY = 'pozitron_column_matrix_source_v1';
  const INTERVAL_KEY = 'pozitron_column_matrix_interval_v1';
  const DEFAULT_URL = 'https://raw.githubusercontent.com/arsazet17/pozitron-keno-v72/main/keno-history.json';

  let draws = [];
  let timer = null;

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

  function valid(obj) {
    const draw = Number(obj?.draw ?? obj?.number ?? obj?.drawNumber ?? obj?.id);
    const date = normDate(obj?.date ?? obj?.drawDate ?? obj?.datetime ?? '');
    const time = normTime(obj?.time ?? obj?.drawTime ?? obj?.datetime ?? '');
    let balls = obj?.balls ?? obj?.numbers ?? obj?.results ?? obj?.result ?? obj?.winningNumbers;
    if (typeof balls === 'string') balls = (balls.match(/\d+/g) || []).map(Number);
    balls = (balls || []).map(Number).slice(0, 20);
    if (!Number.isFinite(draw) || balls.length !== 20 || !balls.every(n => n >= 1 && n <= 80)) return null;
    return { draw, date, time, balls };
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

  function counts(draw) {
    const out = Array(11).fill(0);
    (draw?.balls || []).forEach(n => out[colOf(n)] += 1);
    return out;
  }

  function winner(draw) {
    const c = counts(draw);
    const max = Math.max(...c.slice(1));
    const reached = Array(11).fill(999);
    for (let col = 1; col <= 10; col += 1) {
      if (c[col] !== max) continue;
      let seen = 0;
      for (let i = 0; i < draw.balls.length; i += 1) {
        if (colOf(draw.balls[i]) === col) seen += 1;
        if (seen === max) {
          reached[col] = i;
          break;
        }
      }
    }
    let w = 1;
    for (let col = 2; col <= 10; col += 1) {
      if (c[col] > c[w] || (c[col] === c[w] && reached[col] < reached[w])) w = col;
    }
    return w;
  }

  function save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(draws));
  }

  function load() {
    try {
      draws = dedupe(JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'));
    } catch (_) {
      draws = [];
    }
  }

  function merge(incoming) {
    const before = draws.length;
    draws = dedupe([...draws, ...incoming]);
    save();
    return draws.length - before;
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
    rows.forEach(d => f[winner(d)] += 1);
    return f;
  }

  function renderHead(rows) {
    const f = frequency(rows);
    $('matrixHead').innerHTML = `
      <tr>
        <th>Частота</th>
        ${Array.from({length:10},(_,i)=>`<th class="freq">${f[i+1]}</th>`).join('')}
        <th>Дата</th>
      </tr>
      <tr>
        <th>Тираж</th>
        ${Array.from({length:10},(_,i)=>`<th class="headnum">${i+1}</th>`).join('')}
        <th>Дата</th>
      </tr>`;
  }

  function renderBody(rows) {
    if (!rows.length) {
      $('matrixBody').innerHTML = '<tr><td colspan="12" style="padding:18px;color:#9babc0">Нет данных</td></tr>';
      return;
    }

    const indexByDraw = new Map(draws.map((d,i) => [d.draw, i]));
    $('matrixBody').innerHTML = rows.map(d => {
      const idx = indexByDraw.get(d.draw);
      const prev = idx > 0 ? draws[idx - 1] : null;
      const prevCounts = prev ? counts(prev) : Array(11).fill(0);
      const w = winner(d);

      const cells = Array.from({length:10},(_,i) => {
        const col = i + 1;
        const state = prev ? prevCounts[col] : 0;
        const isWin = col === w;
        return `<td class="cell ${stateClass(state)} ${isWin ? 'win' : ''}" title="ст${col} · до выхода было ${stateLabel(state)}">${isWin ? stateLabel(state) : ''}</td>`;
      }).join('');

      return `<tr>
        <td>№${d.draw}</td>
        ${cells}
        <td class="date">${showDate(d.date)}<br><small>${d.time || ''}</small></td>
      </tr>`;
    }).join('');
  }

  function renderStats(rows) {
    const f = frequency(rows);
    const total = rows.length || 1;
    $('statsRows').innerHTML = Array.from({length:10},(_,i) => {
      const c = i + 1;
      const pct = Math.round(f[c] * 100 / total);
      return `<div class="row"><b>ст${c}</b> — ${f[c]} из ${rows.length} · ${pct}%</div>`;
    }).join('');
  }

  function render() {
    renderDates();
    const rows = selectedRows();
    renderHead(rows);
    renderBody(rows);
    renderStats(rows);

    if (draws.length) {
      const last = draws.at(-1);
      $('status').textContent = `База: ${draws.length.toLocaleString('ru-RU')} · последний №${last.draw} · ${showDate(last.date)} ${last.time || ''}`;
    } else {
      $('status').textContent = 'База пока пустая';
    }
  }

  async function update() {
    const saved = (localStorage.getItem(URL_KEY) || DEFAULT_URL).trim() || DEFAULT_URL;
    const url = saved + (saved.includes('?') ? '&' : '?') + 't=' + Date.now();
    $('status').textContent = 'Проверяю новые тиражи…';
    try {
      const r = await fetch(url, { cache: 'no-store' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const incoming = parsePayload(await r.text());
      if (!incoming.length) throw new Error('нет распознанных тиражей');
      const added = merge(incoming);
      render();
      $('status').textContent = `Обновлено · добавлено ${added} · всего ${draws.length}`;
    } catch (e) {
      render();
      $('status').textContent = 'Обновление не выполнено: ' + e.message;
    }
  }

  function setupAuto() {
    if (timer) clearInterval(timer);
    timer = null;
    const ms = Number(localStorage.getItem(INTERVAL_KEY) || 300000);
    if (ms) timer = setInterval(update, ms);
  }

  function openSettings() {
    $('settingsPanel').classList.toggle('show');
    $('sourceInput').value = localStorage.getItem(URL_KEY) || DEFAULT_URL;
    $('intervalSelect').value = localStorage.getItem(INTERVAL_KEY) || '300000';
    if ($('settingsPanel').classList.contains('show')) {
      $('settingsPanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

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
