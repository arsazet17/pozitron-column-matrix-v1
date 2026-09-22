'use strict';

(() => {
  const INTERVAL_KEY = 'pozitron_column_matrix_interval_v1';
  const FAST_INTERVAL = '60000';
  const AI_ARCHIVE_KEY = 'pozitron_openai_forecast_archive_v2';
  const INTERNAL_URL =
    'https://raw.githubusercontent.com/arsazet17/pozitron-column-matrix-v1/main/internal-forecast-archive.json';

  let lastWakeRefresh = 0;
  let archiveSyncBusy = false;

  function safeJson(raw, fallback) {
    try { return JSON.parse(raw); } catch (_) { return fallback; }
  }

  function enableNativeAuto() {
    const interval = document.getElementById('intervalSelect');
    const save = document.getElementById('saveSettings');
    if (!interval || !save) return;

    interval.value = FAST_INTERVAL;
    if (localStorage.getItem(INTERVAL_KEY) !== FAST_INTERVAL) save.click();
  }

  function mergeArchives(local, remoteInternal) {
    const map = new Map();

    function put(rec) {
      if (!rec || !Number.isFinite(Number(rec.targetDraw))) return;

      const provider = (rec.provider || 'openai') === 'internal'
        ? 'internal'
        : 'openai';

      const key =
        `${provider}:${Number(rec.baseDraw || 0)}:${Number(rec.targetDraw)}`;

      const old = map.get(key);
      if (!old) return void map.set(key, rec);

      if (!!rec.settled && !old.settled) return void map.set(key, rec);

      const oldCreated = Date.parse(old.createdAt || '') || 0;
      const newCreated = Date.parse(rec.createdAt || '') || 0;
      if (newCreated >= oldCreated) map.set(key, rec);
    }

    (Array.isArray(local) ? local : []).forEach(put);
    (Array.isArray(remoteInternal) ? remoteInternal : [])
      .filter(r => (r?.provider || '') === 'internal')
      .forEach(put);

    return [...map.values()]
      .sort((a, b) => Number(a.targetDraw || 0) - Number(b.targetDraw || 0))
      .slice(-200);
  }

  async function syncPersistentInternal() {
    if (archiveSyncBusy) return;
    archiveSyncBusy = true;

    try {
      const response = await fetch(`${INTERNAL_URL}?ts=${Date.now()}`, {
        cache: 'no-store'
      });
      if (!response.ok) throw new Error(`INTERNAL HTTP ${response.status}`);

      const remote = await response.json();
      const local = safeJson(
        localStorage.getItem(AI_ARCHIVE_KEY) || '[]',
        []
      );

      localStorage.setItem(
        AI_ARCHIVE_KEY,
        JSON.stringify(mergeArchives(local, remote))
      );

      const aiView = document.getElementById('aiView');
      const aiBtn = document.getElementById('aiViewBtn');
      if (aiView?.classList.contains('active') && aiBtn) aiBtn.click();
    } catch (error) {
      console.warn('INTERNAL archive sync skipped:', error);
    } finally {
      archiveSyncBusy = false;
    }
  }

  function refreshOnWake() {
    if (document.visibilityState === 'hidden') return;

    const now = Date.now();
    if (now - lastWakeRefresh < 15000) return;
    lastWakeRefresh = now;

    document.getElementById('syncBtn')?.click();
    syncPersistentInternal();
  }

  enableNativeAuto();
  syncPersistentInternal();

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refreshOnWake();
  });
  window.addEventListener('focus', refreshOnWake);
  window.addEventListener('pageshow', refreshOnWake);
  window.addEventListener('online', refreshOnWake);
})();

// Карточка победившего столба: всегда показываем состав ГР 0/1/2/3/4+
// для самого открытого тиража. Работает на всей доступной истории.
(() => {
  const HISTORY_URL = './keno-history.json';
  let historyMap = null;
  let historyPromise = null;
  let lastRenderedDraw = null;

  const colOf = n => Number(n) % 10 || 10;

  function readBalls(obj) {
    let balls = obj?.balls ?? obj?.numbers ?? obj?.results ?? obj?.result ?? obj?.winningNumbers;
    if (typeof balls === 'string') balls = (balls.match(/\d+/g) || []).map(Number);
    if (!Array.isArray(balls)) return null;
    const out = balls.map(Number).filter(Number.isFinite).slice(0, 20);
    return out.length === 20 ? out : null;
  }

  function readDraw(obj) {
    const n = Number(obj?.draw ?? obj?.number ?? obj?.drawNumber ?? obj?.id);
    return Number.isFinite(n) ? n : null;
  }

  function collectHistory(payload) {
    const map = new Map();
    const stack = [payload];

    while (stack.length) {
      const value = stack.pop();
      if (Array.isArray(value)) {
        for (const item of value) stack.push(item);
        continue;
      }
      if (!value || typeof value !== 'object') continue;

      const draw = readDraw(value);
      const balls = readBalls(value);
      if (draw !== null && balls) map.set(draw, balls);

      for (const child of Object.values(value)) {
        if (child && typeof child === 'object') stack.push(child);
      }
    }

    return map;
  }

  async function loadHistory(force = false) {
    if (force) {
      historyMap = null;
      historyPromise = null;
    }

    if (historyMap) return historyMap;
    if (historyPromise) return historyPromise;

    historyPromise = fetch(`${HISTORY_URL}?ts=${Date.now()}`, { cache: 'no-store' })
      .then(response => {
        if (!response.ok) throw new Error(`HISTORY HTTP ${response.status}`);
        return response.json();
      })
      .then(payload => {
        historyMap = collectHistory(payload);
        return historyMap;
      })
      .catch(error => {
        console.warn('Current groups history load skipped:', error);
        historyMap = new Map();
        return historyMap;
      })
      .finally(() => {
        historyPromise = null;
      });

    return historyPromise;
  }

  function invalidateHistory() {
    historyMap = null;
    historyPromise = null;
  }

  function ensureGroupsBlock() {
    let block = document.getElementById('mpCurrentGroups');
    if (block) return block;

    const nums = document.getElementById('mpNums');
    const numsRow = nums?.closest('.mp-row');
    if (!numsRow) return null;

    block = document.createElement('div');
    block.id = 'mpCurrentGroups';
    block.style.marginTop = '9px';
    block.style.paddingTop = '8px';
    block.style.borderTop = '1px solid rgba(75,107,145,.55)';
    block.innerHTML = `
      <div style="font-weight:950;color:#eef5ff;margin-bottom:4px">Группы сейчас</div>
      <div class="mp-row"><span class="mp-label">ГР 0:</span> <span id="mpNowGroup0" class="mp-cols">—</span></div>
      <div class="mp-row"><span class="mp-label">ГР 1:</span> <span id="mpNowGroup1" class="mp-cols">—</span></div>
      <div class="mp-row"><span class="mp-label">ГР 2:</span> <span id="mpNowGroup2" class="mp-cols">—</span></div>
      <div class="mp-row"><span class="mp-label">ГР 3:</span> <span id="mpNowGroup3" class="mp-cols">—</span></div>
      <div class="mp-row"><span class="mp-label">ГР 4+:</span> <span id="mpNowGroup4" class="mp-cols">—</span></div>`;

    numsRow.after(block);
    return block;
  }

  function setAll(value) {
    ensureGroupsBlock();
    for (let state = 0; state <= 4; state += 1) {
      const el = document.getElementById(`mpNowGroup${state}`);
      if (el) el.textContent = value;
    }
  }

  function formatCols(cols) {
    return cols.length ? cols.map(col => `ст${col}`).join(' · ') : '—';
  }

  function fitPopup() {
    const popup = document.getElementById('matrixPopup');
    if (!popup || popup.hidden) return;

    requestAnimationFrame(() => {
      const pad = 8;
      const r = popup.getBoundingClientRect();
      let top = Number.parseFloat(popup.style.top) || r.top;
      if (r.bottom > window.innerHeight - pad) top -= r.bottom - (window.innerHeight - pad);
      if (top < pad) top = pad;
      popup.style.top = `${Math.round(top)}px`;
      popup.style.maxHeight = `calc(100vh - ${pad * 2}px)`;
      popup.style.overflowY = 'auto';
    });
  }

  async function renderGroups(drawNumber) {
    const draw = Number(drawNumber);
    if (!Number.isFinite(draw)) return;
    lastRenderedDraw = draw;
    setAll('…');

    let map = await loadHistory();
    if (lastRenderedDraw !== draw) return;

    let balls = map.get(draw);

    // Главная матрица обновляет свой архив отдельно. Если новый тираж уже виден
    // в таблице, а этот вспомогательный снимок был загружен раньше, перечитываем
    // keno-history.json немедленно и не оставляем ложные прочерки.
    if (!balls) {
      map = await loadHistory(true);
      if (lastRenderedDraw !== draw) return;
      balls = map.get(draw);
    }

    if (!balls) {
      setAll('—');
      fitPopup();
      return;
    }

    const counts = Array(11).fill(0);
    balls.forEach(n => { counts[colOf(n)] += 1; });

    const groups = Array.from({ length: 5 }, () => []);
    for (let col = 1; col <= 10; col += 1) {
      groups[Math.min(4, counts[col])].push(col);
    }

    for (let state = 0; state <= 4; state += 1) {
      const el = document.getElementById(`mpNowGroup${state}`);
      if (el) el.textContent = formatCols(groups[state]);
    }
    fitPopup();
  }

  function currentPopupDraw() {
    const text = document.getElementById('mpDraw')?.textContent || '';
    const m = text.match(/\d+/);
    return m ? Number(m[0]) : null;
  }

  function syncFromPopup() {
    ensureGroupsBlock();
    const draw = currentPopupDraw();
    if (Number.isFinite(draw)) renderGroups(draw);
  }

  // Блок существует сразу после загрузки скрипта — не зависит от клика/всплытия события.
  ensureGroupsBlock();
  loadHistory();

  // При ручном обновлении основной матрицы старый снимок групп больше не держим.
  ['syncBtn', 'syncBtn2'].forEach(id => {
    document.getElementById(id)?.addEventListener('click', invalidateHistory, true);
  });

  // Основной путь: как только matrix.js меняет номер тиража в карточке,
  // MutationObserver автоматически пересчитывает ГР сейчас.
  const drawNode = document.getElementById('mpDraw');
  if (drawNode) {
    new MutationObserver(syncFromPopup).observe(drawNode, {
      childList: true,
      characterData: true,
      subtree: true
    });
  }

  // Дополнительная страховка для всех ячеек матрицы и Горизонтали Юли.
  document.addEventListener('click', event => {
    const cell = event.target?.closest?.('[data-win-draw]');
    if (!cell) return;
    const draw = Number(cell.dataset.winDraw);
    if (Number.isFinite(draw)) setTimeout(() => renderGroups(draw), 0);
  }, true);

  window.addEventListener('pageshow', () => {
    invalidateHistory();
    syncFromPopup();
  });
})();

// archive-result-icon-fix.js теперь подключается напрямую из index.html.
// Его ?v= автоматически обновляет refresh-asset-versions.mjs.
