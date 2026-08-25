'use strict';

/*
  ПОЗИТРОН · МАТРИЦА СТОЛБОВ v2.0 ARCHIVE-SYNC-FIX

  Исправляет:
  1) свежий INTERNAL-архив берётся напрямую из raw GitHub, а не из
     возможного задержанного GitHub Pages;
  2) после ручного OpenAI со статусом "СОХРАНЕНО" история принудительно
     перечитывается из localStorage и перерисовывается через штатный refreshUi;
  3) INTERNAL + OPENAI объединяются по одному targetDraw и не теряются;
  4) внешний OpenAI остаётся только ручным;
  5) следующий тираж и время показываются постоянно.
*/

(() => {
  const INTERVAL_KEY = 'pozitron_column_matrix_interval_v1';
  const FAST_INTERVAL = '60000';
  const AI_ARCHIVE_KEY = 'pozitron_openai_forecast_archive_v2';

  const RAW_BASE =
    'https://raw.githubusercontent.com/arsazet17/pozitron-column-matrix-v1/main';

  const INTERNAL_ARCHIVE_URL = `${RAW_BASE}/internal-forecast-archive.json`;
  const HISTORY_URL = `${RAW_BASE}/keno-history.json`;

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
  let syncBusy = false;
  let targetBusy = false;
  let lastSavedStamp = '';

  function safeJson(raw, fallback) {
    try { return JSON.parse(raw); } catch (_) { return fallback; }
  }

  function mergeArchives(local, remoteInternal) {
    const localList = Array.isArray(local) ? local : [];
    const remoteList = Array.isArray(remoteInternal) ? remoteInternal : [];

    // Все ручные OpenAI с телефона сохраняем.
    const external = localList.filter(
      r => (r?.provider || 'openai') !== 'internal'
    );

    // INTERNAL считаем авторитетным из GitHub, но если там временно
    // чего-то нет, локальную INTERNAL запись не удаляем.
    const localInternal = localList.filter(
      r => (r?.provider || '') === 'internal'
    );
    const all = [...external, ...localInternal, ...remoteList];

    const map = new Map();
    for (const rec of all) {
      if (!rec || !Number.isFinite(Number(rec.targetDraw))) continue;
      const provider = rec.provider || 'openai';
      const key = `${provider}:${Number(rec.targetDraw)}:${Number(rec.baseDraw || 0)}`;

      const prev = map.get(key);
      if (!prev) {
        map.set(key, rec);
        continue;
      }

      // Более свежая/завершённая запись выигрывает.
      const prevSettled = !!prev.settled;
      const nextSettled = !!rec.settled;
      if (nextSettled && !prevSettled) {
        map.set(key, rec);
        continue;
      }

      const prevTime = Date.parse(prev.createdAt || '') || 0;
      const nextTime = Date.parse(rec.createdAt || '') || 0;
      if (nextTime >= prevTime) map.set(key, rec);
    }

    return [...map.values()]
      .sort((a, b) => {
        const td = Number(a.targetDraw || 0) - Number(b.targetDraw || 0);
        if (td) return td;
        return String(a.provider || '').localeCompare(String(b.provider || ''));
      })
      .slice(-200);
  }

  function forceAiRefresh() {
    const aiView = document.getElementById('aiView');
    const aiBtn = document.getElementById('aiViewBtn');

    // Штатный click вызывает refreshUi() внутри ai-analyzer.js.
    if (aiView?.classList.contains('active') && aiBtn) {
      aiBtn.click();
    }
  }

  async function syncPersistentInternalArchive(forceRender = true) {
    if (syncBusy) return;
    syncBusy = true;

    try {
      const r = await fetch(`${INTERNAL_ARCHIVE_URL}?ts=${Date.now()}`, {
        cache: 'no-store'
      });
      if (!r.ok) throw new Error(`INTERNAL archive HTTP ${r.status}`);

      const remoteInternal = await r.json();
      const local = safeJson(
        localStorage.getItem(AI_ARCHIVE_KEY) || '[]',
        []
      );

      const merged = mergeArchives(local, remoteInternal);
      localStorage.setItem(AI_ARCHIVE_KEY, JSON.stringify(merged));

      if (forceRender) {
        setTimeout(forceAiRefresh, 50);
      }
    } catch (e) {
      console.warn('INTERNAL archive sync failed', e);
    } finally {
      syncBusy = false;
    }
  }

  function walkHistory(value, out = []) {
    if (Array.isArray(value)) {
      value.forEach(v => walkHistory(v, out));
      return out;
    }

    if (value && typeof value === 'object') {
      const draw = Number(value.draw);
      const time =
        String(value.time || '').match(/\d{1,2}:\d{2}/)?.[0] || '';

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
    const s = String(
      document.getElementById('aiStatus')?.textContent || ''
    ).toUpperCase();

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
      btn.title =
        `Внешний OpenAI · прогноз на тираж №${target.draw} · ${target.time}`;

      if (!analysisBusy()) btn.disabled = false;
    }
  }

  async function refreshExternalTarget() {
    if (targetBusy) return;
    targetBusy = true;

    try {
      const r = await fetch(`${HISTORY_URL}?ts=${Date.now()}`, {
        cache: 'no-store'
      });
      if (!r.ok) throw new Error(`History HTTP ${r.status}`);

      const payload = await r.json();
      const draws = walkHistory(payload)
        .sort((a, b) => Number(a.draw) - Number(b.draw));

      const latest = draws.at(-1);
      if (latest) applyExternalTarget(inferNext(latest));
    } catch (e) {
      const btn = document.getElementById('aiRunBtn');
      if (btn && !analysisBusy()) btn.disabled = false;
      console.warn('next target refresh failed', e);
    } finally {
      targetBusy = false;
    }
  }

  function enableFastNativeAuto() {
    const interval = document.getElementById('intervalSelect');
    const save = document.getElementById('saveSettings');

    if (!interval || !save) return;

    interval.value = FAST_INTERVAL;
    if (localStorage.getItem(INTERVAL_KEY) !== FAST_INTERVAL) {
      save.click();
    }
  }

  function refreshOnWake() {
    if (document.visibilityState === 'hidden') return;

    const now = Date.now();
    if (now - lastWakeRefresh < 15000) return;
    lastWakeRefresh = now;

    syncPersistentInternalArchive(true);
    refreshExternalTarget();

    const btn = document.getElementById('syncBtn');
    if (btn) btn.click();
  }

  function rescueAiUiIfNeeded() {
    if (
      document.getElementById('aiViewBtn') &&
      document.getElementById('aiRunBtn')
    ) {
      syncPersistentInternalArchive(true);
      refreshExternalTarget();
      return;
    }

    if (rescueLoaded) return;
    rescueLoaded = true;

    const s = document.createElement('script');
    s.src = `ai-analyzer.js?v=archive-sync-${Date.now()}`;
    s.dataset.pozitronAiRescue = '1';

    s.onload = () => {
      setTimeout(() => {
        syncPersistentInternalArchive(true);
        refreshExternalTarget();
      }, 100);
    };

    document.body.appendChild(s);
  }

  function watchAiState() {
    const observer = new MutationObserver(() => {
      const btn = document.getElementById('aiRunBtn');
      const target = document.getElementById('aiTarget');
      const status = document.getElementById('aiStatus');

      if (btn && !analysisBusy()) {
        btn.disabled = false;
        btn.textContent = 'СДЕЛАТЬ ПРОГНОЗ';
      }

      if (target && /ПРОГНОЗ НЕ СОЗДАН/i.test(target.textContent || '')) {
        refreshExternalTarget();
      }

      // Ключевой FIX:
      // как только внешний ai-analyzer пишет СОХРАНЕНО,
      // перечитываем localStorage + свежий INTERNAL и заново рисуем историю.
      const text = String(status?.textContent || '').trim().toUpperCase();
      if (text === 'СОХРАНЕНО') {
        const archive = localStorage.getItem(AI_ARCHIVE_KEY) || '';
        const stamp = `${archive.length}:${archive.slice(-120)}`;

        if (stamp !== lastSavedStamp) {
          lastSavedStamp = stamp;

          setTimeout(async () => {
            await syncPersistentInternalArchive(false);
            forceAiRefresh();
          }, 80);
        }
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

  enableFastNativeAuto();
  watchAiState();

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refreshOnWake();
  });
  window.addEventListener('focus', refreshOnWake);
  window.addEventListener('pageshow', refreshOnWake);
  window.addEventListener('online', refreshOnWake);

  if (document.readyState === 'loading') {
    document.addEventListener(
      'DOMContentLoaded',
      () => {
        setTimeout(rescueAiUiIfNeeded, 300);
        setTimeout(() => syncPersistentInternalArchive(true), 450);
        setTimeout(refreshExternalTarget, 550);
      },
      { once: true }
    );
  } else {
    setTimeout(rescueAiUiIfNeeded, 300);
    setTimeout(() => syncPersistentInternalArchive(true), 450);
    setTimeout(refreshExternalTarget, 550);
  }

  // Раз в минуту одновременно подтягиваем и новые INTERNAL-записи,
  // и следующую цель.
  setInterval(() => {
    syncPersistentInternalArchive(true);
    refreshExternalTarget();
  }, 60000);
})();
