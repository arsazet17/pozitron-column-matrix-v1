'use strict';

/*
  ПОЗИТРОН · МАТРИЦА СТОЛБОВ v1.9 ALL-FIXES

  — внутренний ИИ: АВТО;
  — постоянный INTERNAL-архив берётся из GitHub;
  — внешний OpenAI: ТОЛЬКО ВРУЧНУЮ;
  — ручные OPENAI-записи не удаляются;
  — всегда показывается следующий ТИРАЖ №... · HH:MM;
  — кнопка внешнего ИИ всегда видна как "СДЕЛАТЬ ПРОГНОЗ";
  — ai-analyzer.js не загружается дважды без необходимости.
*/

(() => {
  const INTERVAL_KEY = 'pozitron_column_matrix_interval_v1';
  const FAST_INTERVAL = '60000';
  const AI_ARCHIVE_KEY = 'pozitron_openai_forecast_archive_v2';
  const INTERNAL_ARCHIVE_URL = 'internal-forecast-archive.json';
  const HISTORY_URL =
    'https://raw.githubusercontent.com/arsazet17/pozitron-column-matrix-v1/main/keno-history.json';

  const CURRENT_SCHEDULE = [
    '00:02','00:17','00:32','01:02','01:17','01:32',
    '02:02','02:17','02:32','03:02','03:32','04:02',
    '04:17','04:32','05:02','05:17','05:32','06:02',
    '06:17','06:32','07:02','07:32','08:02','08:17',
    '08:32','09:02','09:17','09:32','10:02','10:17',
    '10:32','11:02','11:32','12:02','12:17','12:32',
    '13:02','13:17','13:32','14:02','14:17','14:32',
    '15:02','15:32','16:02','16:17','16:32','17:02',
    '17:17','17:32','18:02','18:17','18:32','19:02',
    '19:32','20:02','20:17','20:32','21:02','21:17',
    '21:32','22:02','22:17','22:32','23:02','23:32'
  ];

  let lastWakeRefresh = 0;
  let rescueLoaded = false;
  let targetRefreshBusy = false;

  function safeJson(raw, fallback) {
    try { return JSON.parse(raw); } catch (_) { return fallback; }
  }

  function walkHistory(value, out = []) {
    if (Array.isArray(value)) {
      value.forEach(v => walkHistory(v, out));
      return out;
    }

    if (value && typeof value === 'object') {
      const draw = Number(value.draw);
      const time = String(value.time || '').match(/\d{1,2}:\d{2}/)?.[0] || '';

      if (Number.isFinite(draw) && time) {
        out.push({ draw, time });
      } else {
        Object.values(value).forEach(v => {
          if (v && typeof v === 'object') walkHistory(v, out);
        });
      }
    }
    return out;
  }

  function inferNext(latest) {
    if (!latest) return null;

    const m = String(latest.time || '').match(/(\d{1,2}):(\d{2})/);
    if (!m) return { draw: Number(latest.draw) + 1, time: '—' };

    const cur = Number(m[1]) * 60 + Number(m[2]);
    const times = CURRENT_SCHEDULE.map(t => {
      const [h, min] = t.split(':').map(Number);
      return { t, n: h * 60 + min };
    });

    const next = times.find(x => x.n > cur) || times[0];
    return { draw: Number(latest.draw) + 1, time: next.t };
  }

  function analysisBusy() {
    const s = String(document.getElementById('aiStatus')?.textContent || '').toUpperCase();
    return /АНАЛИЗ|ОБНОВЛЯЮ|ОТПРАВЛЯЮ|ЗАГРУЖАЮ/.test(s);
  }

  function applyExternalTarget(target) {
    if (!target) return;

    const targetEl = document.getElementById('aiTarget');
    if (targetEl) {
      targetEl.textContent = `ТИРАЖ №${target.draw} · ${target.time}`;
    }

    const btn = document.getElementById('aiRunBtn');
    if (btn) {
      btn.textContent = 'СДЕЛАТЬ ПРОГНОЗ';
      btn.title = `Внешний OpenAI · прогноз на тираж №${target.draw} · ${target.time}`;
      if (!analysisBusy()) btn.disabled = false;
    }
  }

  async function refreshExternalTarget() {
    if (targetRefreshBusy) return;
    targetRefreshBusy = true;

    try {
      const r = await fetch(`${HISTORY_URL}?_=${Date.now()}`, { cache: 'no-store' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);

      const payload = await r.json();
      const draws = walkHistory(payload)
        .sort((a, b) => Number(a.draw) - Number(b.draw));

      const latest = draws.at(-1);
      if (latest) applyExternalTarget(inferNext(latest));
    } catch (e) {
      // При временной недоступности GitHub/Столото кнопка не исчезает.
      const btn = document.getElementById('aiRunBtn');
      if (btn && !analysisBusy()) btn.disabled = false;
      console.warn('external target refresh', e);
    } finally {
      targetRefreshBusy = false;
    }
  }

  function syncPersistentInternalArchive() {
    try {
      const xhr = new XMLHttpRequest();
      xhr.open('GET', `${INTERNAL_ARCHIVE_URL}?_=${Date.now()}`, false);
      xhr.send(null);

      if (xhr.status < 200 || xhr.status >= 300) return;

      const remote = safeJson(xhr.responseText, []);
      if (!Array.isArray(remote)) return;

      const local = safeJson(localStorage.getItem(AI_ARCHIVE_KEY) || '[]', []);

      // OPENAI остаётся ручным и локальным.
      const manualExternal = (Array.isArray(local) ? local : [])
        .filter(r => (r?.provider || 'openai') !== 'internal');

      // INTERNAL приходит из постоянного GitHub-архива.
      const remoteInternal = remote
        .filter(r => (r?.provider || '') === 'internal');

      const map = new Map();

      for (const rec of [...manualExternal, ...remoteInternal]) {
        const provider = rec?.provider || 'openai';
        const key = rec?.id || `${provider}:${rec?.baseDraw}:${rec?.targetDraw}`;
        map.set(key, rec);
      }

      const merged = [...map.values()]
        .sort((a, b) => {
          const da = Number(a?.targetDraw || 0);
          const db = Number(b?.targetDraw || 0);
          if (da !== db) return da - db;
          return String(a?.createdAt || '').localeCompare(String(b?.createdAt || ''));
        })
        .slice(-120);

      localStorage.setItem(AI_ARCHIVE_KEY, JSON.stringify(merged));
    } catch (e) {
      console.warn('persistent internal archive sync', e);
    }
  }

  function enableFastNativeAuto() {
    const interval = document.getElementById('intervalSelect');
    const save = document.getElementById('saveSettings');

    if (!interval || !save) return;

    interval.value = FAST_INTERVAL;
    if (localStorage.getItem(INTERVAL_KEY) !== FAST_INTERVAL) save.click();
  }

  function refreshOnWake() {
    if (document.visibilityState === 'hidden') return;

    const now = Date.now();
    if (now - lastWakeRefresh < 15000) return;
    lastWakeRefresh = now;

    syncPersistentInternalArchive();
    refreshExternalTarget();

    const btn = document.getElementById('syncBtn');
    if (btn) btn.click();
  }

  function rescueAiUiIfNeeded() {
    if (document.getElementById('aiViewBtn') &&
        document.getElementById('aiRunBtn')) {
      refreshExternalTarget();
      return;
    }

    if (rescueLoaded) return;
    rescueLoaded = true;

    const s = document.createElement('script');
    s.src = `ai-analyzer.js?v=all-fixes-${Date.now()}`;
    s.dataset.pozitronAiRescue = '1';

    s.onload = () => {
      setTimeout(refreshExternalTarget, 100);
    };

    s.onerror = () => {
      console.error('Не удалось восстановить ai-analyzer.js');
    };

    document.body.appendChild(s);
  }

  function watchAiButton() {
    const observer = new MutationObserver(() => {
      const btn = document.getElementById('aiRunBtn');
      const target = document.getElementById('aiTarget');

      if (!btn || !target) return;

      if (!analysisBusy()) {
        btn.disabled = false;
        if (btn.textContent.trim() !== 'СДЕЛАТЬ ПРОГНОЗ') {
          btn.textContent = 'СДЕЛАТЬ ПРОГНОЗ';
        }
      }

      if (/ПРОГНОЗ НЕ СОЗДАН/i.test(target.textContent || '')) {
        refreshExternalTarget();
      }
    });

    observer.observe(document.documentElement, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['disabled']
    });
  }

  syncPersistentInternalArchive();
  enableFastNativeAuto();
  watchAiButton();

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refreshOnWake();
  });

  window.addEventListener('focus', refreshOnWake);
  window.addEventListener('pageshow', refreshOnWake);
  window.addEventListener('online', refreshOnWake);

  // Не грузим ai-analyzer.js преждевременно второй раз.
  // Сначала даём штатному script из index.html отработать.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      setTimeout(rescueAiUiIfNeeded, 300);
      setTimeout(refreshExternalTarget, 500);
    }, { once: true });
  } else {
    setTimeout(rescueAiUiIfNeeded, 300);
    setTimeout(refreshExternalTarget, 500);
  }

  setInterval(refreshExternalTarget, 60000);
})();
