'use strict';

(() => {
  const STORAGE_KEY = 'pozitron_column_matrix_draws_v1';
  const HISTORY_URL = 'https://raw.githubusercontent.com/arsazet17/pozitron-column-matrix-v1/main/keno-history.json';
  const ARCHIVE_KEY = 'pozitron_openai_forecast_archive_v2';
  const WORKER_URL = 'https://pozitron-gigachat-api.arsazet-17-go.workers.dev';
  const VERSION = 'HYBRID-6.1-AUTO-INTERNAL';
  const MATRIX_REFRESH_MS = 60000;

  const $ = id => document.getElementById(id);
  let internalAutoBusy = false;


  function forceMainMatrixRefresh() {
    try {
      localStorage.setItem('pozitron_column_matrix_interval_v1', String(MATRIX_REFRESH_MS));
    } catch (_) {}
    const btn = $('syncBtn') || $('syncBtn2');
    if (btn && !btn.disabled) btn.click();
  }

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
    const dm = date.match(/^(\d{2})[.\-/](\d{2})[.\-/](\d{2}|\d{4})$/);
    if (dm) {
      const year = dm[3].length === 2 ? `20${dm[3]}` : dm[3];
      isoDate = `${year}-${dm[2]}-${dm[1]}`;
    }
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

  // Текущее официальное расписание КЕНО 4М. Время прогноза больше не
  // вычисляется по среднему/медианному интервалу — только по этому списку.
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

  function dateParts(value) {
    const raw = String(value || '').trim();
    let m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) return { y:Number(m[1]), mo:Number(m[2]), d:Number(m[3]) };
    m = raw.match(/^(\d{2})[.\-/](\d{2})[.\-/](\d{2}|\d{4})$/);
    if (!m) return null;
    const y = Number(m[3].length === 2 ? `20${m[3]}` : m[3]);
    return { y, mo:Number(m[2]), d:Number(m[1]) };
  }

  function formatRuDate(parts) {
    if (!parts) return '';
    return `${String(parts.d).padStart(2,'0')}.${String(parts.mo).padStart(2,'0')}.${parts.y}`;
  }

  function addDays(parts, days) {
    const dt = new Date(Date.UTC(parts.y, parts.mo - 1, parts.d + days));
    return { y:dt.getUTCFullYear(), mo:dt.getUTCMonth()+1, d:dt.getUTCDate() };
  }

  function inferNextTarget(draws) {
    const latest = draws.at(-1);
    if (!latest) return { draw: null, time: '—', date: '' };

    const timeMatch = String(latest.time || '').match(/(\d{1,2}):(\d{2})/);
    const parts = dateParts(latest.date);
    if (!timeMatch || !parts) {
      return { draw: latest.draw + 1, time: '—', date: '' };
    }

    const currentMinutes = Number(timeMatch[1]) * 60 + Number(timeMatch[2]);
    const scheduleMinutes = CURRENT_SCHEDULE.map(t => {
      const [h,m] = t.split(':').map(Number);
      return h * 60 + m;
    });

    let idx = scheduleMinutes.findIndex(x => x > currentMinutes);
    let targetDate = parts;
    if (idx < 0) {
      idx = 0;
      targetDate = addDays(parts, 1);
    }

    return {
      draw: latest.draw + 1,
      time: CURRENT_SCHEDULE[idx],
      date: formatRuDate(targetDate)
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
      officialSchedule: CURRENT_SCHEDULE,
      scheduleSource: 'current official KENO 4M schedule',
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
      internalLearner: internalSnapshotForOpenAI(draws),
      request: [
        'Перед тобой полный доступный официальный архив столбцов, а не локальный кэш телефона.',
        'Проведи сравнение всей истории с последними 500/250/100 и особенно последними 80 тиражами.',
        'Обязательно учитывай: переходы столбец→столбец, повторы, возвраты через 1/2/3 тиража, серии, продолжение шага и обратный шаг, малые и большие зеркала, текущие и типичные разрывы, чет/нечет, изменения частот по окнам, а также группы/числа последних тиражей.',
        'Не выбирай столбцы только по простой частоте. Сопоставь несколько независимых сигналов и объясни, какие сигналы сошлись.',
        'В payload есть internalLearner — независимый внутренний пакетный алгоритм. Используй его как дополнительную информацию, но НЕ копируй автоматически: внешний прогноз должен оставаться самостоятельным.',
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
      const actualDraw = draws.find(d => d.draw === rec.targetDraw) || draws.find(d => d.draw > rec.baseDraw);

      // Старые записи архива могли быть созданы до сохранения даты/времени.
      // Восстанавливаем их из официального архива при каждом обновлении.
      if (actualDraw) {
        if (rec.actualDraw !== actualDraw.draw) { rec.actualDraw = actualDraw.draw; changed = true; }
        if (rec.actualColumn !== actualDraw.column) { rec.actualColumn = actualDraw.column; changed = true; }
        if (rec.actualTime !== (actualDraw.time || '')) { rec.actualTime = actualDraw.time || ''; changed = true; }
        if (rec.actualDate !== (actualDraw.date || '')) { rec.actualDate = actualDraw.date || ''; changed = true; }

        const pos = Array.isArray(rec.picks) ? rec.picks.indexOf(actualDraw.column) : -1;
        const result = pos === 0 ? 'TOP1' : (pos > 0 ? 'TOP3' : 'MISS');
        if (!rec.settled) { rec.settled = true; changed = true; }
        if (rec.result !== result) { rec.result = result; changed = true; }
      }

      // Если у старой записи не было целевой даты/времени, берём их из
      // фактического тиража, а для ещё ожидаемого — вычисляем из базы.
      if ((!rec.targetDate || rec.targetDate === '—') && actualDraw?.date) {
        rec.targetDate = actualDraw.date;
        changed = true;
      }
      if ((!rec.targetTime || rec.targetTime === '—') && actualDraw?.time) {
        rec.targetTime = actualDraw.time;
        changed = true;
      }

      if ((!rec.targetDate || !rec.targetTime || rec.targetTime === '—') && !actualDraw) {
        const baseIndex = draws.findIndex(d => d.draw === rec.baseDraw);
        if (baseIndex >= 0) {
          const target = inferNextTarget(draws.slice(0, baseIndex + 1));
          if ((!rec.targetDate || rec.targetDate === '—') && target.date) { rec.targetDate = target.date; changed = true; }
          if ((!rec.targetTime || rec.targetTime === '—') && target.time && target.time !== '—') { rec.targetTime = target.time; changed = true; }
        }
      }
    }
    if (changed) saveArchive(archive);
  }

  // ===== ВНУТРЕННИЙ АДАПТИВНЫЙ ДВИЖОК =====
  // Никакое правило здесь не является обязательным. Каждый сигнал лишь
  // добавляет/снимает вес, а итог строится из нескольких независимых слоёв.
  function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }
  function mean(a) { return a.length ? a.reduce((x,y)=>x+y,0)/a.length : 0; }

  function targetTimeFromDraws(draws) {
    const t = inferNextTarget(draws);
    return t.time && t.time !== '—' ? t.time.slice(0,5) : '';
  }

  function frequencyMap(seq) {
    const c = Array(11).fill(0);
    seq.forEach(x => { if (x >= 1 && x <= 10) c[x]++; });
    return c;
  }

  function conditionalLift(seq, anchor, candidate, lag = 1) {
    let denom = 0, hit = 0;
    const baseCount = seq.reduce((n,x)=>n+(x===candidate),0);
    const base = baseCount / Math.max(1, seq.length);
    for (let i = lag; i < seq.length; i++) {
      if (seq[i-lag] === anchor) {
        denom++;
        if (seq[i] === candidate) hit++;
      }
    }
    const p = (hit + 1.2) / (denom + 12); // мягкое сглаживание к ~10%
    const lift = base > 0 ? p / base : 1;
    const reliability = clamp(denom / 45, 0, 1);
    return { p, lift, denom, hit, reliability };
  }

  function gapProfile(seq, col) {
    const pos=[];
    seq.forEach((x,i)=>{ if(x===col) pos.push(i); });
    const gaps=[];
    for(let i=1;i<pos.length;i++) gaps.push(pos[i]-pos[i-1]);
    const current = pos.length ? seq.length-1-pos.at(-1) : seq.length;
    if (!gaps.length) return {current, median:null, q75:null, hazard:.1, sample:0};
    const sorted=[...gaps].sort((a,b)=>a-b);
    const med=sorted[Math.floor(sorted.length*.5)];
    const q75=sorted[Math.floor(sorted.length*.75)];
    const need=current+1;
    const atRisk=gaps.filter(g=>g>=need).length;
    const exact=gaps.filter(g=>g===need).length;
    const hazard=(exact+1)/(atRisk+10); // сглаженная вероятность закрытия разрыва сейчас
    return {current, median:med, q75, hazard, sample:gaps.length};
  }

  function packageState(seq, col, profile, friendshipSignal) {
    const last=[];
    for(let lag=1;lag<=7;lag++) if(seq.at(-lag)===col) last.push(lag);
    const recentHits=last.length;
    const veryRecent=last.some(x=>x<=3);
    const overdue=profile.q75 && profile.current >= profile.q75;
    if (veryRecent && friendshipSignal > .08) return 'АКТИВЕН';
    if (recentHits >= 2) return 'АКТИВЕН';
    if (overdue || friendshipSignal > .16) return 'РАЗВОРАЧИВАЕТСЯ';
    if (profile.current <= 2 && friendshipSignal < -.08) return 'ЗАТУХАЕТ';
    return 'СВЁРНУТ';
  }

  function buildInternalSnapshot(draws, opts = {}) {
    const maxWindow = Math.min(opts.maxWindow || 1400, draws.length);
    const work = draws.slice(-maxWindow);
    const seq = work.map(d=>d.column);
    const latestSeq = draws.map(d=>d.column);
    const targetTime = opts.targetTime || targetTimeFromDraws(draws);
    const windows=[80,200,500,Math.min(1200,seq.length)];
    const freqByWindow=windows.map(w=>frequencyMap(seq.slice(-Math.min(w,seq.length))));
    const baseAll=frequencyMap(seq);
    const latestCols=[];
    for(let lag=1;lag<=5;lag++) latestCols.push(latestSeq.at(-lag));

    const rows=[];
    for(let col=1; col<=10; col++) {
      const reasons=[];
      let score=50;

      // 1) Дружба/переходы с задержками 1..5. Ни один переход не обязателен.
      let friend=0, friendWeight=0;
      for(let lag=1;lag<=5;lag++) {
        const anchor=latestCols[lag-1];
        if(!anchor) continue;
        const st=conditionalLift(seq,anchor,col,lag);
        const raw=clamp((st.lift-1),-.65,.9) * st.reliability;
        const lagWeight=[1,.72,.55,.42,.34][lag-1];
        friend += raw*lagWeight;
        friendWeight += lagWeight;
        if(lag<=3 && raw>.18) reasons.push(`дружба ${anchor}→${col} через ${lag}: +${Math.round(raw*100)}%`);
      }
      const friendNorm=friend/Math.max(.01,friendWeight);
      score += clamp(friendNorm*24,-12,16);

      // 2) Собственные повторы/возвраты 1..5 — тоже вероятностный слой.
      let selfSignal=0;
      for(let lag=1;lag<=5;lag++) {
        if(latestSeq.at(-lag)!==col) continue;
        const st=conditionalLift(seq,col,col,lag);
        const bump=clamp((st.lift-1)*st.reliability,-.5,.9) * [1,.8,.65,.52,.42][lag-1];
        selfSignal += bump;
        if(bump>.12) reasons.push(lag===1 ? 'поддержка повтора' : `поддержка возврата через ${lag-1}`);
      }
      score += clamp(selfSignal*15,-7,13);

      // 3) Индивидуальный цикл/разрыв столба.
      const gp=gapProfile(seq,col);
      const hazardLift=(gp.hazard/.10)-1;
      score += clamp(hazardLift*5,-6,10);
      if(hazardLift>.35) reasons.push(`разрыв ${gp.current}: повышенная фаза возврата`);

      // 4) Устойчивость частоты сразу в нескольких окнах, без доминирования частоты.
      const lifts=freqByWindow.map((fm,i)=>{
        const w=Math.min(windows[i],seq.length);
        const p=fm[col]/Math.max(1,w);
        const b=baseAll[col]/Math.max(1,seq.length);
        return b ? p/b : 1;
      });
      const recentLift=mean(lifts.slice(0,3));
      const consistent=lifts.filter(x=>x>1.05).length;
      score += clamp((recentLift-1)*8,-4,6) + (consistent>=3 ? 2 : 0);
      if(consistent>=3) reasons.push('поддержка нескольких окон 80/200/500');

      // 5) Время тиража: только слабая добавка при достаточной выборке.
      if(targetTime) {
        const sameTime=work.filter(d=>String(d.time||'').slice(0,5)===targetTime);
        if(sameTime.length>=18) {
          const hits=sameTime.filter(d=>d.column===col).length;
          const p=(hits+1)/(sameTime.length+10);
          const base=baseAll[col]/Math.max(1,seq.length);
          const lift=base?p/base:1;
          score += clamp((lift-1)*4,-3,4);
          if(lift>1.25) reasons.push(`время ${targetTime} исторически поддерживает`);
        }
      }

      const state=packageState(latestSeq,col,gp,friendNorm+selfSignal);
      if(state==='АКТИВЕН') score+=4;
      else if(state==='РАЗВОРАЧИВАЕТСЯ') score+=2.5;
      else if(state==='ЗАТУХАЕТ') score-=2;

      rows.push({col, score:clamp(score,0,100), state, gap:gp.current, reasons:reasons.slice(0,4), friend:friendNorm, self:selfSignal});
    }

    rows.sort((a,b)=>b.score-a.score || a.col-b.col);
    return rows;
  }

  function backtestInternal(draws, count = 120) {
    const start=Math.max(500,draws.length-count);
    let tests=0,hits=0,top1=0;
    for(let i=start;i<draws.length;i++) {
      const hist=draws.slice(0,i);
      const targetTime=String(draws[i]?.time||'').slice(0,5);
      const rows=buildInternalSnapshot(hist,{maxWindow:1200,targetTime});
      const picks=rows.slice(0,3).map(x=>x.col);
      tests++;
      if(picks.includes(draws[i].column)) hits++;
      if(picks[0]===draws[i].column) top1++;
    }
    return {tests,hits,top1,hitRate:tests?hits/tests:0,top1Rate:tests?top1/tests:0};
  }

  function runInternalModel(draws) {
    const target=inferNextTarget(draws);
    const rows=buildInternalSnapshot(draws,{targetTime:target.time});
    const picks=rows.slice(0,3).map(x=>x.col);
    const reasons={};
    rows.slice(0,3).forEach(r=>{
      reasons[r.col]=`${r.state} · ${r.reasons.length?r.reasons.join('; '):`сводный балл ${r.score.toFixed(1)}`}`;
    });
    const bt=backtestInternal(draws,120);
    const confidence = bt.hitRate >= .36 ? 'повышенный' : (bt.hitRate >= .30 ? 'средний' : 'низкий');
    const packageSummary=rows.slice(0,5).map(r=>`СТ${r.col} ${r.state.toLowerCase()} ${r.score.toFixed(0)}`).join(' · ');
    return {
      target, picks, reasons, confidence,
      summary:`Пакеты: ${packageSummary}. Проверка без подглядывания: TOP-3 ${Math.round(bt.hitRate*100)}% на ${bt.tests} последних шагах (случайный ориентир 30%).`,
      packages:rows,
      backtest:bt
    };
  }

  function internalSnapshotForOpenAI(draws) {
    const model=runInternalModel(draws);
    return {
      top3:model.picks,
      backtest:model.backtest,
      packages:model.packages.map(r=>({column:r.col,state:r.state,score:Number(r.score.toFixed(1)),gap:r.gap,reasons:r.reasons})),
      instruction:'Это независимый внутренний адаптивный анализ. Не копируй его механически: дай собственный прогноз и используй совпадения/расхождения только как дополнительный аргумент.'
    };
  }

  function currentForecast(archive, latestDraw, provider = null) {
    return archive.find(r => r.baseDraw === latestDraw && !r.settled && (!provider || (r.provider || 'openai') === provider)) || null;
  }

  function providerName(rec) {
    return (rec?.provider || 'openai') === 'internal' ? 'ВНУТРЕННИЙ' : 'OPENAI';
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
      $('aiPicks').innerHTML = '<div class="ai-empty">Внутренний прогноз создаётся автоматически. Внешний OpenAI запускается вручную.</div>';
      $('aiSummary').textContent = 'Внутренний алгоритм работает постоянно; OpenAI подключается вручную для независимого сравнения.';
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

    $('aiConfidence').textContent = `${providerName(rec)} · ${String(rec.confidence || 'низкий').toUpperCase()}`;
    $('aiSummary').textContent = rec.summary || 'Прогноз сохранён.';
    $('aiMeta').textContent = `${providerName(rec)} · создан после тиража №${rec.baseDraw} · ${new Date(rec.createdAt).toLocaleString('ru-RU')}`;
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
    const host=$('aiArchive');
    if(!host) return;
    const groups=new Map();
    archive.forEach(rec=>{
      const key=String(rec.targetDraw);
      if(!groups.has(key)) groups.set(key,[]);
      groups.get(key).push(rec);
    });
    const recent=[...groups.values()].sort((a,b)=>(b[0]?.targetDraw||0)-(a[0]?.targetDraw||0)).slice(0,30);
    if(!recent.length){ host.innerHTML='<div class="ai-empty">Архив пока пуст.</div>'; return; }

    host.innerHTML=`<div class="ai-history">
      <div class="ai-history-labels"><span>ТИРАЖ</span><span>ДАТА</span><span>ВРЕМЯ</span><span>ИТОГ</span><span></span></div>
      ${recent.map(records=>{
        records.sort((a,b)=>String(a.provider||'openai').localeCompare(String(b.provider||'openai')));
        const ref=records[0];
        const actual=records.find(r=>r.settled)?.actualColumn;
        const actualTime=records.find(r=>r.settled)?.actualTime||'';
        const actualDate=records.find(r=>r.settled)?.actualDate||ref.targetDate;
        const anyHit=records.some(r=>r.settled && (r.result==='TOP1'||r.result==='TOP3'));
        const allSettled=records.every(r=>r.settled);
        const icon=anyHit?'🔥':(allSettled?'—':'—');
        return `<details class="ai-history-row">
          <summary class="ai-history-summary">
            <span class="ai-hdraw">№${ref.targetDraw}</span>
            <span class="ai-hdate">${escapeHtml(shortDate(actualDate))}</span>
            <span class="ai-htime">${escapeHtml(actualTime?actualTime.slice(0,5):(ref.targetTime||'—'))}</span>
            <span class="ai-hresult">${icon}</span><span class="ai-harrow">▼</span>
          </summary>
          <div class="ai-history-body">
            ${records.map(rec=>{
              const hit=rec.settled&&(rec.result==='TOP1'||rec.result==='TOP3');
              const label=providerName(rec);
              return `<div class="ai-provider-block ${hit?'provider-hit':''}">
                <div class="ai-provider-title"><b>${label}</b><span>${hit?'🔥 ПОПАЛ':(rec.settled?'МИМО':'ЖДЁМ')}</span></div>
                <div class="ai-history-picks">${rec.picks.map((x,i)=>`<div class="ai-history-pick hp${i+1} ${hit&&x===rec.actualColumn?'actual-hit':''}"><small>TOP-${i+1}</small><b>СТ${x}</b></div>`).join('')}</div>
                ${rec.settled?`<div class="ai-history-fact">ВЫШЕЛ: <strong class="${hit?'actual-green':''}">СТ${rec.actualColumn}</strong> ${hit?'<span class="ok">✅🔥</span>':'<span class="miss">❌ МИМО</span>'}</div>`:'<div class="ai-history-fact muted">Результат ещё не появился.</div>'}
                ${rec.summary?`<div class="ai-history-note">${escapeHtml(rec.summary)}</div>`:''}
              </div>`;
            }).join('')}
          </div>
        </details>`;
      }).join('')}
    </div>`;
  }

  function ensureInternalForecast(draws) {
    if (internalAutoBusy) return null;
    const latest = draws.at(-1);
    if (!latest || draws.length < 500) return null;

    let archive = loadArchive();
    settleArchive(archive, draws);
    archive = loadArchive();

    const existing = currentForecast(archive, latest.draw, 'internal');
    if (existing) return existing;

    internalAutoBusy = true;
    try {
      const model = runInternalModel(draws);
      const rec = {
        id: `internal-${latest.draw}-${Date.now()}`,
        provider: 'internal',
        auto: true,
        version: VERSION,
        createdAt: new Date().toISOString(),
        baseDraw: latest.draw,
        targetDraw: model.target.draw,
        targetTime: model.target.time,
        targetDate: model.target.date,
        officialSchedule: CURRENT_SCHEDULE,
        scheduleSource: 'current official KENO 4M schedule',
        picks: model.picks,
        reasons: model.reasons,
        confidence: model.confidence,
        summary: model.summary,
        packages: model.packages,
        backtest: model.backtest,
        settled: false,
        actualDraw: null,
        actualColumn: null,
        actualTime: '',
        actualDate: '',
        result: null
      };
      archive.push(rec);
      saveArchive(archive);
      return rec;
    } finally {
      internalAutoBusy = false;
    }
  }

  async function refreshUi() {
    injectUi();
    let draws;
    let fresh = false;
    try {
      draws = await fetchFullHistory();
      fresh = true;
      $('aiStatus').textContent = 'ВНУТРЕННИЙ · АВТО';
    } catch (_) {
      draws = loadDraws();
      $('aiStatus').textContent = 'ЛОКАЛЬНЫЙ РЕЗЕРВ';
    }

    let archive = loadArchive();
    settleArchive(archive, draws);
    // INTERNAL on phone disabled: server/archive only.


    archive = loadArchive();
    const latest = draws.at(-1);
    const currents = latest ? archive.filter(r => r.baseDraw === latest.draw && !r.settled) : [];
    // На экране по умолчанию показываем внутренний автопрогноз. Если пользователь
    // только что запускал OpenAI, runExternalAnalysis сам покажет внешний результат.
    const current = currents.find(r => (r.provider || 'openai') === 'internal')
      || currents.sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||'')))[0]
      || null;
    renderForecast(current);
    renderArchive(archive);

    if (latest) {
      const target = inferNextTarget(draws);
      const hasInternal = !!currentForecast(archive, latest.draw, 'internal');
      const hasExternal = !!currentForecast(archive, latest.draw, 'openai');
      $('aiNextHint').textContent = `База: ${draws.length} официальных тиражей · последний №${latest.draw}. Внутренний: ${hasInternal ? 'записан автоматически' : 'ожидает свежий архив'} · OpenAI: ${hasExternal ? 'подключён' : 'не запускался'}. Следующий №${target.draw}${target.time !== '—' ? ` · ${target.time}` : ''}.`;
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

      .ai-actions{display:grid;grid-template-columns:1fr 1fr;gap:8px;align-items:stretch}
      .ai-auto-badge{display:flex;align-items:center;justify-content:center;border:1px solid #d8a82f;border-radius:12px;background:linear-gradient(135deg,#6b4f16,#4b3510);color:#ffe18a;font-size:12px;font-weight:1000;padding:10px 8px;text-align:center}
      .ai-provider-block{border:1px solid #294862;border-radius:12px;padding:10px;margin-top:9px;background:#0b1b29}
      .ai-provider-block:first-child{margin-top:0}
      .ai-provider-block.provider-hit{border-color:#3b9b68;box-shadow:inset 0 0 20px rgba(50,200,120,.06)}
      .ai-provider-title{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;font-size:11px;color:#a9bbcc}
      .ai-provider-title b{color:#fff;font-size:13px}
      .actual-hit{border-color:#44d98a!important;background:#123b29!important;box-shadow:0 0 0 1px rgba(68,217,138,.2)}
      .actual-green{color:#62e6a0!important}

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
              <b>🧠 Двойной прогноз</b>
              <div class="ai-sub">Внутренний самоадаптивный пакетный алгоритм + независимый OpenAI</div>
            </div>
            <div id="aiStatus" class="ai-status">ГОТОВО</div>
          </div>

          <div id="aiTarget" class="ai-target">ПРОГНОЗ НЕ СОЗДАН</div>
          <div class="ai-actions"><div class="ai-auto-badge">● ВНУТРЕННИЙ · АВТО</div><button id="aiRunBtn" class="ai-run" type="button">ВНЕШНИЙ OpenAI</button></div>
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
          <div class="ai-sub">Один архив: внутри видно прогноз каждого алгоритма и отдельное попадание 🔥.</div>
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

    const existing = currentForecast(archive, latest.draw, 'openai');
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
        id: `openai-${latest.draw}-${Date.now()}`,
        provider: 'openai',
        version: VERSION,
        createdAt: new Date().toISOString(),
        baseDraw: latest.draw,
        targetDraw: target.draw,
        targetTime: target.time,
        targetDate: target.date,
      officialSchedule: CURRENT_SCHEDULE,
      scheduleSource: 'current official KENO 4M schedule',
        picks: parsed.picks,
        reasons: parsed.reasons,
        confidence: parsed.confidence,
        summary: parsed.summary,
        rawAnalysis: parsed.raw,
        usedInternalLearning: true,
        settled: false,
        actualDraw: null,
        actualColumn: null,
        actualTime: '',
        actualDate: '',
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

  // Всегда держим основную Матрицу на минутном обновлении.
  // Дополнительно перепроверяем сразу после возврата в приложение.
  setTimeout(forceMainMatrixRefresh, 1200);
  setInterval(forceMainMatrixRefresh, MATRIX_REFRESH_MS);
  setInterval(refreshUi, MATRIX_REFRESH_MS);
  window.addEventListener('focus', () => { forceMainMatrixRefresh(); refreshUi(); });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) { forceMainMatrixRefresh(); refreshUi(); }
  });
})();
