'use strict';
/* ПОЗИТРОН · общий загрузчик архива КЕНО.
   Полный keno-history.json (несколько МБ) скачивается один раз за запуск,
   дальше подтягивается только свежий хвост из компактного keno-recent.json. */
(() => {
  const RAW = 'https://raw.githubusercontent.com/arsazet17/pozitron-column-matrix-v1/main/';
  const TAIL_EVERY_MS = 50000;
  let full = null, fullPromise = null, tailPromise = null, lastTail = 0;

  async function getJson(file, timeoutMs) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const r = await fetch(`${RAW}${file}?ts=${Date.now()}`, { cache: 'no-store', signal: ctrl.signal });
      if (!r.ok) throw new Error(`${file}: HTTP ${r.status}`);
      return await r.json();
    } finally { clearTimeout(timer); }
  }
  const list = payload => (Array.isArray(payload) ? payload : Array.isArray(payload?.draws) ? payload.draws : []);
  const num = d => Number(d?.draw);

  function loadFull() {
    if (!fullPromise) {
      fullPromise = getJson('keno-history.json', 180000)
        .then(payload => {
          const a = list(payload).filter(d => Number.isFinite(num(d)));
          if (!a.length) throw new Error('keno-history.json пустой');
          a.sort((x, y) => num(x) - num(y));
          full = a; lastTail = Date.now();
          return full;
        })
        .finally(() => { fullPromise = null; });
    }
    return fullPromise;
  }

  // true — хвост приклеен; false — между архивом и хвостом дыра, нужен полный архив заново.
  function mergeTail(tail) {
    const t = list(tail).filter(d => Number.isFinite(num(d))).sort((x, y) => num(x) - num(y));
    if (!t.length) return true;
    const last = num(full[full.length - 1]);
    if (num(t[0]) > last + 1) return false;
    const index = new Map();
    const from = Math.max(0, full.length - t.length - 50);
    for (let i = from; i < full.length; i++) index.set(num(full[i]), i);
    for (const d of t) {
      const i = index.get(num(d));
      if (i !== undefined) full[i] = d;
      else if (num(d) > last) full.push(d);
    }
    return true;
  }

  async function get(force = false) {
    if (!full) return (await loadFull()).slice();
    if (force || Date.now() - lastTail > TAIL_EVERY_MS) {
      if (!tailPromise) {
        tailPromise = getJson('keno-recent.json', 30000)
          .then(async tail => { if (!mergeTail(tail)) { full = null; await loadFull(); } lastTail = Date.now(); })
          .catch(e => console.warn('История: хвост не обновлён', e))
          .finally(() => { tailPromise = null; });
      }
      await tailPromise;
    }
    return (full || await loadFull()).slice();
  }

  // Архив серверных прогнозов: одна загрузка на всех, результат живёт минуту.
  let internalPromise = null, internalAt = 0;
  function internal() {
    if (!internalPromise || Date.now() - internalAt > 60000) {
      internalAt = Date.now();
      internalPromise = getJson('internal-forecast-archive.json', 120000)
        .catch(e => { internalPromise = null; throw e; });
    }
    return internalPromise;
  }

  window.PozitronHistory = { get, internal };
})();
