// ПОЗИТРОН · МАТРИЦА СТОЛБОВ
// Независимый updater официального архива KENO Столото.
// KENO 7.2 в работе этого файла НЕ участвует: его реализация использована только как проверенный образец логики.

import fs from 'node:fs/promises';
import process from 'node:process';
import { chromium } from 'playwright';

const LOGIN_URL = 'https://oauth.stoloto.ru/login';
const ARCHIVE_URL = 'https://m.stoloto.ru/keno2/archive/';
const HISTORY_FILE = 'keno-history.json';

const EMAIL = process.env.STOLOTO_EMAIL || '';
const PASSWORD = process.env.STOLOTO_PASSWORD || '';

if (!EMAIL || !PASSWORD) {
  throw new Error('FAIL: нет GitHub Secrets STOLOTO_EMAIL / STOLOTO_PASSWORD');
}

const MONTHS = {
  'января': 1, 'февраля': 2, 'марта': 3, 'апреля': 4,
  'мая': 5, 'июня': 6, 'июля': 7, 'августа': 8,
  'сентября': 9, 'октября': 10, 'ноября': 11, 'декабря': 12
};

const pad2 = n => String(n).padStart(2, '0');

function normalizeSpace(value) {
  return String(value ?? '')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

function moscowTodayParts() {
  const fmt = new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(new Date()).map(x => [x.type, x.value])
  );
  return {
    y: Number(parts.year),
    m: Number(parts.month),
    d: Number(parts.day)
  };
}

function shiftDate({ y, m, d }, deltaDays) {
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + deltaDays);
  return {
    y: dt.getUTCFullYear(),
    m: dt.getUTCMonth() + 1,
    d: dt.getUTCDate()
  };
}

function normalizeDateLabel(label) {
  const raw = normalizeSpace(label).toLowerCase();
  const today = moscowTodayParts();
  let p = null;

  if (raw === 'сегодня') {
    p = today;
  } else if (raw === 'вчера') {
    p = shiftDate(today, -1);
  } else {
    let m = raw.match(/^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{2,4})$/);
    if (m) {
      let y = Number(m[3]);
      if (y < 100) y += 2000;
      p = { d: Number(m[1]), m: Number(m[2]), y };
    } else {
      m = raw.match(/^(\d{1,2})\s+([а-яё]+)(?:\s+(\d{4}))?$/i);
      if (m && MONTHS[m[2]]) {
        p = {
          d: Number(m[1]),
          m: MONTHS[m[2]],
          y: m[3] ? Number(m[3]) : today.y
        };
        // Декабрь, показанный в январе без года, относится к прошлому году.
        if (!m[3] && p.m > today.m + 6) p.y -= 1;
      }
    }
  }

  if (!p) return null;
  return `${pad2(p.d)}.${pad2(p.m)}.${String(p.y).slice(-2)}`;
}

function normalizeTime(value) {
  const m = String(value ?? '').match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return null;

  const hh = Number(m[1]);
  const mm = Number(m[2]);
  const ss = Number(m[3] || 0);
  if (hh > 23 || mm > 59 || ss > 59) return null;

  return {
    full: `${pad2(hh)}:${pad2(mm)}:${pad2(ss)}`,
    short: `${pad2(hh)}:${pad2(mm)}`
  };
}

function parseParity(text) {
  const s = normalizeSpace(text).toLowerCase();
  if (s.includes('больше нечётных') || s.includes('больше нечетных')) {
    return 'Больше нечётных';
  }
  if (s.includes('больше чётных') || s.includes('больше четных')) {
    return 'Больше чётных';
  }
  if (s.includes('поровну')) return 'Поровну';
  return null;
}

function parseColumn(text) {
  const m = normalizeSpace(text).match(/столбец\s*([1-9]|10)\b/i);
  return m ? Number(m[1]) : null;
}

function parseDraw(text) {
  const m = String(text).match(/№\s*([0-9]{4,})/);
  return m ? Number(m[1]) : null;
}

function parseTime(text) {
  const m = String(text).match(/\b([01]?\d|2[0-3]):[0-5]\d(?::[0-5]\d)?\b/);
  return m ? normalizeTime(m[0]) : null;
}

function findDateLabel(text) {
  const s = String(text);

  const direct = s.match(/(?:^|\n)\s*(Сегодня|Вчера)\s*(?:\n|$)/i);
  if (direct) return normalizeSpace(direct[1]);

  const numeric = s.match(
    /(?:^|\n)\s*(\d{1,2}[.\-/]\d{1,2}[.\-/]\d{2,4})\s*(?:\n|$)/
  );
  if (numeric) return normalizeSpace(numeric[1]);

  const words = s.match(
    /(?:^|\n)\s*(\d{1,2}\s+(?:января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)(?:\s+\d{4})?)\s*(?:\n|$)/i
  );
  if (words) return normalizeSpace(words[1]);

  return null;
}

async function login(page) {
  await page.goto(LOGIN_URL, {
    waitUntil: 'domcontentloaded',
    timeout: 60000
  });

  const loginSelectors = [
    'input[type="email"]',
    'input[name*="email" i]',
    'input[name*="login" i]',
    'input[autocomplete="username"]',
    'input[type="text"]'
  ];
  const passwordSelectors = [
    'input[type="password"]',
    'input[name*="password" i]',
    'input[autocomplete="current-password"]'
  ];

  let loginField = null;
  for (const selector of loginSelectors) {
    const loc = page.locator(selector).first();
    if (await loc.count()) {
      loginField = loc;
      break;
    }
  }

  let passwordField = null;
  for (const selector of passwordSelectors) {
    const loc = page.locator(selector).first();
    if (await loc.count()) {
      passwordField = loc;
      break;
    }
  }

  if (!loginField || !passwordField) {
    throw new Error('FAIL: не найдены поля OAuth Столото');
  }

  await loginField.fill(EMAIL);
  await passwordField.fill(PASSWORD);

  const submitCandidates = [
    page.getByRole('button', { name: /войти/i }).first(),
    page.locator('button[type="submit"]').first(),
    page.locator('input[type="submit"]').first()
  ];

  let clicked = false;
  for (const button of submitCandidates) {
    if (await button.count()) {
      await button.click();
      clicked = true;
      break;
    }
  }

  if (!clicked) throw new Error('FAIL: не найдена кнопка «Войти»');

  await page.waitForLoadState('domcontentloaded', { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(2500);
}

const TAIL_SIZE = 10;
const PAGE_READ_ATTEMPTS = 3;

async function collectRowsOnce(page) {
  await page.goto(ARCHIVE_URL, {
    waitUntil: 'domcontentloaded',
    timeout: 60000
  }).catch(error => {
    console.warn(`WARN: archive goto: ${error.message}`);
  });

  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

  return page.locator('body').evaluate(() => {
    const drawRx = /№\s*\d{4,}/;
    const dateRx = /^(Сегодня|Вчера|\d{1,2}[.\/-]\d{1,2}[.\/-]\d{2,4}|\d{1,2}\s+(?:января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)(?:\s+\d{4})?)$/i;
    const norm = s => String(s || '')
      .replace(/\u00a0/g, ' ')
      .replace(/[ \t]+/g, ' ')
      .trim();

    const all = [...document.querySelectorAll('body *')];

    function nearestDateLabel(el) {
      let best = null;
      for (const node of all) {
        if (node === el || el.contains(node)) continue;
        const pos = node.compareDocumentPosition(el);
        if (!(pos & Node.DOCUMENT_POSITION_FOLLOWING)) continue;
        const text = norm(node.innerText || node.textContent || '');
        if (!text || text.length > 40 || !dateRx.test(text)) continue;
        if (node.children && node.children.length > 3) continue;
        best = text;
      }
      return best;
    }

    let candidates = [...document.querySelectorAll('tr')]
      .filter(el => drawRx.test(el.innerText || ''));

    if (!candidates.length) {
      candidates = all.filter(el => {
        const text = norm(el.innerText || '');
        if (!drawRx.test(text)) return false;
        if (el.querySelectorAll('button').length < 20) return false;
        return ![...el.children].some(ch =>
          drawRx.test(norm(ch.innerText || '')) &&
          ch.querySelectorAll('button').length >= 20
        );
      });
    }

    return candidates.map(el => ({
      text: el.innerText || '',
      dateLabel: nearestDateLabel(el),
      buttons: [...el.querySelectorAll('button')]
        .map(button => norm(button.innerText || ''))
    }));
  });
}

function parseRows(rawRows) {
  const parsed = [];
  let carryDateLabel = null;

  for (const row of rawRows) {
    const text = String(row.text || '');
    const localDate = normalizeSpace(row.dateLabel || '') || findDateLabel(text);
    if (localDate) carryDateLabel = localDate;

    const draw = parseDraw(text);
    if (!draw) continue;

    const time = parseTime(text);
    const parity = parseParity(text);
    const column = parseColumn(text);

    // Официальные поля: НИЧЕГО не вычисляем самостоятельно.
    if (!parity) {
      throw new Error(`FAIL: тираж ${draw}: Столото не отдал метку чёт/нечёт`);
    }
    if (!column) {
      throw new Error(`FAIL: тираж ${draw}: Столото не отдал «Столбец N»`);
    }
    if (!time) {
      throw new Error(`FAIL: тираж ${draw}: не найдено корректное время`);
    }

    const buttonNumbers = (row.buttons || [])
      .map(x => Number(normalizeSpace(x)))
      .filter(n => Number.isInteger(n) && n >= 1 && n <= 80);

    let balls = buttonNumbers;
    if (balls.length > 20) balls = balls.slice(-20);

    if (balls.length !== 20) {
      throw new Error(
        `FAIL: тираж ${draw}: ожидалось 20 чисел, найдено ${balls.length}`
      );
    }
    if (new Set(balls).size !== 20) {
      throw new Error(`FAIL: тираж ${draw}: 20 чисел должны быть без повторов`);
    }

    const dateLabel = localDate || carryDateLabel;
    const date = dateLabel ? normalizeDateLabel(dateLabel) : null;
    if (!date) {
      throw new Error(
        `FAIL: тираж ${draw}: не распознана дата; ` +
        `dateLabel=${JSON.stringify(dateLabel)}`
      );
    }

    parsed.push({
      draw,
      date,
      time: time.short,
      timeFull: time.full,
      balls,
      column,
      parity
    });
  }

  const byDraw = new Map();
  for (const row of parsed) byDraw.set(row.draw, row);
  return [...byDraw.values()].sort((a, b) => a.draw - b.draw);
}

function comparable(row) {
  return JSON.stringify({
    draw: row.draw,
    date: row.date,
    time: row.time,
    balls: row.balls,
    column: row.column,
    parity: row.parity
  });
}

function contiguousRuns(records) {
  const ordered = [...records].sort((a, b) => a.draw - b.draw);
  const runs = [];
  for (const record of ordered) {
    if (!runs.length || record.draw !== runs.at(-1).at(-1).draw + 1) {
      runs.push([record]);
    } else {
      runs.at(-1).push(record);
    }
  }
  return runs;
}

async function collectRecentTail(page) {
  let lastDiagnostic = null;

  for (let attempt = 1; attempt <= PAGE_READ_ATTEMPTS; attempt += 1) {
    await page.waitForTimeout(2500 + 1000 * attempt);

    let rawRows = [];
    let parsed = [];
    let parseError = null;

    try {
      rawRows = await collectRowsOnce(page);
      parsed = parseRows(rawRows);
    } catch (error) {
      parseError = error;
    }

    lastDiagnostic = {
      attempt,
      url: page.url(),
      rawRows: rawRows.length,
      parsed: parsed.length,
      error: parseError?.message || null
    };

    console.log(
      `Столото page attempt ${attempt}/${PAGE_READ_ATTEMPTS}: ` +
      `raw=${rawRows.length}, parsed=${parsed.length}` +
      (parseError ? `, error=${parseError.message}` : '')
    );

    if (!parseError && parsed.length >= TAIL_SIZE) {
      return parsed.slice(-TAIL_SIZE);
    }

    await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(1800);
  }

  throw new Error(
    `FAIL: после ${PAGE_READ_ATTEMPTS} чтений страницы не найдено ` +
    `${TAIL_SIZE} свежих тиражей; diagnostics=${JSON.stringify(lastDiagnostic)}`
  );
}

async function readArchiveThreeTimes(page) {
  const reads = [];

  for (let check = 1; check <= 3; check += 1) {
    const tail = await collectRecentTail(page);
    reads.push(tail);
    console.log(
      `Проверка ${check}/3: ${tail.length} свежих тиражей, ` +
      `№${tail[0].draw}–№${tail.at(-1).draw}`
    );
    if (check < 3) await page.waitForTimeout(900);
  }

  const maps = reads.map(arr => new Map(arr.map(row => [row.draw, row])));
  const minimum = Math.max(2, TAIL_SIZE - 1);
  const candidates = [];

  for (let left = 0; left < maps.length - 1; left += 1) {
    for (let right = left + 1; right < maps.length; right += 1) {
      const agreed = [];
      const common = [...maps[left].keys()]
        .filter(draw => maps[right].has(draw))
        .sort((a, b) => a - b);

      for (const draw of common) {
        const a = maps[left].get(draw);
        const b = maps[right].get(draw);
        if (comparable(a) === comparable(b)) agreed.push(a);
      }

      for (const run of contiguousRuns(agreed)) {
        if (run.length >= minimum) {
          const tail = run.slice(-TAIL_SIZE);
          candidates.push({
            records: tail,
            lastDraw: tail.at(-1).draw,
            length: tail.length,
            checks: [left + 1, right + 1]
          });
        }
      }
    }
  }

  if (!candidates.length) {
    throw new Error(
      `FAIL: нет непрерывного консенсуса минимум ${minimum} тиражей ` +
      `в двух из трёх чтений`
    );
  }

  const chosen = candidates.sort((a, b) =>
    b.lastDraw - a.lastDraw || b.length - a.length
  )[0];

  console.log(
    `Проверка 2 из 3 PASS: проверки ${chosen.checks.join('+')}; ` +
    `${chosen.records.length} тиражей; ` +
    `№${chosen.records[0].draw}–№${chosen.records.at(-1).draw}`
  );

  return chosen.records;
}

async function readTrustedHistory() {
  try {
    const raw = await fs.readFile(HISTORY_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
    if (Array.isArray(parsed?.draws)) return parsed.draws;
    return [];
  } catch {
    return [];
  }
}

function normalizeHistoryDraw(row) {
  return {
    draw: Number(row?.draw ?? row?.number ?? row?.id),
    date: normalizeSpace(row?.date),
    time: normalizeTime(row?.time)?.short || normalizeSpace(row?.time),
    balls: Array.isArray(row?.balls)
      ? row.balls.map(Number)
      : Array.isArray(row?.numbers)
        ? row.numbers.map(Number)
        : []
  };
}

function trustedHistoryStrict(historyRaw) {
  if (!Array.isArray(historyRaw) || historyRaw.length < 60) {
    throw new Error(
      `FAIL: keno-history.json должен содержать доверенный архив, сейчас ` +
      `${Array.isArray(historyRaw) ? historyRaw.length : 0}`
    );
  }

  const rows = historyRaw.map((original, index) => {
    const normalized = normalizeHistoryDraw(original);

    if (!Number.isInteger(normalized.draw) || normalized.draw <= 0) {
      throw new Error(`FAIL: history[${index}]: неверный номер тиража`);
    }
    if (!/^\d{2}\.\d{2}\.\d{2,4}$/.test(normalized.date)) {
      throw new Error(
        `FAIL: history №${normalized.draw}: неверная дата ${normalized.date}`
      );
    }
    if (!/^\d{2}:\d{2}$/.test(normalized.time)) {
      throw new Error(
        `FAIL: history №${normalized.draw}: неверное время ${normalized.time}`
      );
    }
    if (
      normalized.balls.length !== 20 ||
      new Set(normalized.balls).size !== 20 ||
      normalized.balls.some(n => !Number.isInteger(n) || n < 1 || n > 80)
    ) {
      throw new Error(`FAIL: history №${normalized.draw}: неверные 20 чисел`);
    }

    return {
      original,
      ...normalized
    };
  }).sort((a, b) => a.draw - b.draw);

  for (let i = 1; i < rows.length; i += 1) {
    if (rows[i].draw === rows[i - 1].draw) {
      throw new Error(`FAIL: дубликат тиража №${rows[i].draw} в history`);
    }
  }

  return rows;
}

function scheduleMinutesFromHistory(history) {
  const minutes = new Set();
  for (const row of history.slice(-5000)) {
    const m = String(row.time).match(/^\d{2}:(\d{2})$/);
    if (m) minutes.add(m[1]);
  }
  return minutes;
}

function validateProduction(stolotoDraws, historyRaw) {
  const history = trustedHistoryStrict(historyRaw);
  const historyMap = new Map(history.map(row => [row.draw, row]));

  const overlap = stolotoDraws.filter(row => historyMap.has(row.draw));
  if (!overlap.length) {
    throw new Error(
      `FAIL: нет anchor; Столото №${stolotoDraws[0]?.draw}–` +
      `№${stolotoDraws.at(-1)?.draw}, локальный последний ` +
      `№${history.at(-1).draw}`
    );
  }

  // Все общие старые тиражи сверяются по данным, которые уже записаны в history.
  for (const stolotoRow of overlap) {
    const historyRow = historyMap.get(stolotoRow.draw);

    if (historyRow.date !== stolotoRow.date) {
      throw new Error(
        `FAIL: №${stolotoRow.draw}: дата отличается ` +
        `(${historyRow.date} != ${stolotoRow.date})`
      );
    }
    if (historyRow.time !== stolotoRow.time) {
      throw new Error(
        `FAIL: №${stolotoRow.draw}: время отличается ` +
        `(${historyRow.time} != ${stolotoRow.time})`
      );
    }
    if (JSON.stringify(historyRow.balls) !== JSON.stringify(stolotoRow.balls)) {
      throw new Error(`FAIL: №${stolotoRow.draw}: 20 чисел отличаются`);
    }
  }

  // Anchor = строго последний уже сохранённый доверенный тираж.
  const anchor = history.at(-1);
  const exactAnchor = stolotoDraws.find(row => row.draw === anchor.draw);
  if (!exactAnchor) {
    throw new Error(
      `FAIL: официальный архив не содержит последний доверенный anchor №${anchor.draw}`
    );
  }

  const fresh = stolotoDraws
    .filter(row => row.draw > anchor.draw)
    .sort((a, b) => a.draw - b.draw);

  let expected = anchor.draw + 1;
  for (const row of fresh) {
    if (row.draw !== expected) {
      throw new Error(
        `FAIL: пропуск тиража: ожидался №${expected}, получен №${row.draw}`
      );
    }
    expected += 1;
  }

  const allowedParity = new Set([
    'Больше чётных',
    'Больше нечётных',
    'Поровну'
  ]);
  const allowedMinutes = scheduleMinutesFromHistory(history);

  for (const row of fresh) {
    if (!/^\d{2}\.\d{2}\.\d{2}$/.test(row.date)) {
      throw new Error(`FAIL: №${row.draw}: неверная дата ${row.date}`);
    }
    if (!/^\d{2}:\d{2}$/.test(row.time)) {
      throw new Error(`FAIL: №${row.draw}: неверное время ${row.time}`);
    }

    const minute = row.time.slice(3, 5);
    if (allowedMinutes.size && !allowedMinutes.has(minute)) {
      throw new Error(
        `FAIL: №${row.draw}: минута ${minute} не соответствует ` +
        `расписанию доверенного архива`
      );
    }

    if (!allowedParity.has(row.parity)) {
      throw new Error(`FAIL: №${row.draw}: нет официальной метки чёт/нечёт`);
    }
    if (!Number.isInteger(row.column) || row.column < 1 || row.column > 10) {
      throw new Error(`FAIL: №${row.draw}: нет официального «Столбец N»`);
    }
    if (
      !Array.isArray(row.balls) ||
      row.balls.length !== 20 ||
      new Set(row.balls).size !== 20
    ) {
      throw new Error(`FAIL: №${row.draw}: неверный формат 20 чисел`);
    }
  }

  console.log(
    `Anchor PASS: №${anchor.draw}; пересечений ${overlap.length}; ` +
    `новых ${fresh.length}`
  );

  return { anchor, fresh };
}

function mergePreservingOfficialFields(historyRaw, fresh) {
  const source = 'Официальный Столото · OAuth · свежий хвост M5M · проверка 2 из 3';

  const additions = fresh.map(row => ({
    draw: row.draw,
    date: row.date,
    time: row.time,
    balls: row.balls,
    column: row.column,
    parity: row.parity,
    source
  }));

  // Старые записи не переделываем. Добавляем только новые подтверждённые тиражи.
  return [...historyRaw, ...additions]
    .sort((a, b) => Number(a.draw) - Number(b.draw));
}

const browser = await chromium.launch({ headless: true });

try {
  const context = await browser.newContext({
    locale: 'ru-RU',
    timezoneId: 'Europe/Moscow',
    viewport: { width: 390, height: 844 },
    userAgent:
      'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 ' +
      'Chrome/131 Mobile Safari/537.36'
  });

  const page = await context.newPage();

  await login(page);
  const stolotoDraws = await readArchiveThreeTimes(page);
  const historyRaw = await readTrustedHistory();
  const { anchor, fresh } = validateProduction(stolotoDraws, historyRaw);

  if (!fresh.length) {
    console.log(`PASS: новых тиражей нет. Последний доверенный №${anchor.draw}`);
  } else {
    const merged = mergePreservingOfficialFields(historyRaw, fresh);
    await fs.writeFile(HISTORY_FILE, JSON.stringify(merged) + '\n', 'utf8');

    const last = merged.at(-1);
    console.log(`PASS: добавлено ${fresh.length} тиражей. Новый последний №${last.draw}`);
    console.log(`Столото: ${last.parity}; Столбец ${last.column}`);
  }
} finally {
  await browser.close();
}
