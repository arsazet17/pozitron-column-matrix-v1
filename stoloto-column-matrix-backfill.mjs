// ПОЗИТРОН · МАТРИЦА СТОЛБОВ
// Независимый updater официального архива KENO Столото.
// KENO 7.2 в работе этого файла НЕ участвует: его реализация использована только как проверенный образец логики.

import fs from 'node:fs/promises';
import process from 'node:process';
import { chromium } from 'playwright';

const LOGIN_URL = 'https://oauth.stoloto.ru/login';
// Одноразовый глубокий backfill: официальный desktop-архив Столото.
// Штатный авто-updater приложения остаётся на m.stoloto.ru.
const ARCHIVE_URL = 'https://www.stoloto.ru/keno2/archive/';
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

async function expandArchiveToDraw(page, minTargetDraw) {
  let lastMin = Infinity;
  let lastLoggedMin = null;
  let stableRounds = 0;

  for (let round = 0; round < 240; round += 1) {
    const state = await page.locator('body').evaluate(target => {
      const nums = [...document.body.innerText.matchAll(/№\s*(\d{4,})/g)]
        .map(m => Number(m[1]))
        .filter(Number.isFinite);
      const unique = [...new Set(nums)];
      return {
        count: unique.length,
        min: unique.length ? Math.min(...unique) : null,
        max: unique.length ? Math.max(...unique) : null,
        hasTarget: unique.includes(Number(target))
      };
    }, minTargetDraw);

    if (state.min !== null) {
      if (state.min !== lastLoggedMin) {
        console.log(
          `Архив: ${state.count} тиражей в DOM, диапазон №${state.min}–№${state.max}`
        );
        lastLoggedMin = state.min;
      }
      if (state.hasTarget || state.min <= minTargetDraw) return;

      if (state.min === lastMin) stableRounds += 1;
      else stableRounds = 0;
      lastMin = state.min;
    }

    const moreButton = page.getByRole('button', {
      name: /показать\s*(ещё|еще)|загрузить\s*(ещё|еще)|^(ещё|еще)$/i
    }).last();

    if (await moreButton.count()) {
      try {
        if (await moreButton.isVisible()) {
          await moreButton.click({ timeout: 5000 });
          await page.waitForTimeout(750);
          continue;
        }
      } catch (_) {}
    }

    const moreLink = page.getByRole('link', {
      name: /показать\s*(ещё|еще)|загрузить\s*(ещё|еще)|^(ещё|еще)$/i
    }).last();

    if (await moreLink.count()) {
      try {
        if (await moreLink.isVisible()) {
          await moreLink.click({ timeout: 5000 });
          await page.waitForTimeout(750);
          continue;
        }
      } catch (_) {}
    }

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(700);

    if (stableRounds >= 4) break;
  }

  const finalState = await page.locator('body').evaluate(target => {
    const nums = [...document.body.innerText.matchAll(/№\s*(\d{4,})/g)]
      .map(m => Number(m[1]))
      .filter(Number.isFinite);
    const unique = [...new Set(nums)];
    return {
      count: unique.length,
      min: unique.length ? Math.min(...unique) : null,
      max: unique.length ? Math.max(...unique) : null,
      hasTarget: unique.includes(Number(target))
    };
  }, minTargetDraw);

  if (!finalState.hasTarget && !(finalState.min !== null && finalState.min <= minTargetDraw)) {
    throw new Error(
      `FAIL: официальный архив не удалось раскрыть до №${minTargetDraw}; ` +
      `получен диапазон №${finalState.min}–№${finalState.max}`
    );
  }
}

async function extractRowsFromCurrentPage(page) {
  return page.locator('body').evaluate(() => {
    const drawRx = /№\s*\d{4,}/;
    const dateRx = /^(Сегодня|Вчера|\d{1,2}[.\/-]\d{1,2}[.\/-]\d{2,4}|\d{1,2}\s+(?:января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)(?:\s+\d{4})?)$/i;
    const norm = s => String(s || '')
      .replace(/\u00a0/g, ' ')
      .replace(/[ \t]+/g, ' ')
      .trim();

    const all = [...document.querySelectorAll('body *')];
    const index = new Map(all.map((el, i) => [el, i]));

    const dateLabels = [];
    for (let i = 0; i < all.length; i += 1) {
      const node = all[i];
      if (node.children && node.children.length > 3) continue;
      const text = norm(node.innerText || node.textContent || '');
      if (!text || text.length > 40 || !dateRx.test(text)) continue;
      dateLabels.push({ index: i, text });
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

    return candidates.map(el => {
      const elIndex = index.get(el) ?? 0;
      let dateLabel = null;
      for (let i = dateLabels.length - 1; i >= 0; i -= 1) {
        if (dateLabels[i].index < elIndex) {
          dateLabel = dateLabels[i].text;
          break;
        }
      }

      return {
        text: el.innerText || '',
        dateLabel,
        buttons: [...el.querySelectorAll('button')]
          .map(button => norm(button.innerText || ''))
      };
    });
  });
}

async function collectRows(page, minTargetDraw) {
  await page.goto(ARCHIVE_URL, {
    waitUntil: 'domcontentloaded',
    timeout: 60000
  });
  await page.waitForTimeout(3500);

  await expandArchiveToDraw(page, minTargetDraw);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(500);

  return extractRowsFromCurrentPage(page);
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

async function readSpecificOfficialDraw(page, draw) {
  const directUrl = `${ARCHIVE_URL}${draw}`;
  console.log(`Точечно: запрашиваю официальный тираж №${draw}`);

  await page.goto(directUrl, {
    waitUntil: 'domcontentloaded',
    timeout: 60000
  });
  await page.waitForTimeout(2200);

  let parsed = parseRows(await extractRowsFromCurrentPage(page));
  let exact = parsed.find(row => row.draw === draw);
  if (exact) {
    console.log(`Точечно PASS: №${draw} найден через ${directUrl}`);
    return exact;
  }

  // Резерв внутри той же точечной страницы: используем официальный фильтр по номеру.
  const inputs = page.locator('input');
  const count = await inputs.count();
  let drawInput = null;

  for (let i = 0; i < count; i += 1) {
    const input = inputs.nth(i);
    const meta = [
      await input.getAttribute('name'),
      await input.getAttribute('placeholder'),
      await input.getAttribute('aria-label'),
      await input.getAttribute('id')
    ].filter(Boolean).join(' ').toLowerCase();

    if (/тираж|draw|number|num/.test(meta)) {
      drawInput = input;
      break;
    }
  }

  if (drawInput) {
    await drawInput.fill(String(draw));
    const findButton = page.getByRole('button', { name: /найти|поиск/i }).last();
    if (await findButton.count()) {
      await findButton.click();
      await page.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => {});
      await page.waitForTimeout(1800);
      parsed = parseRows(await extractRowsFromCurrentPage(page));
      exact = parsed.find(row => row.draw === draw);
      if (exact) {
        console.log(`Точечно PASS: №${draw} найден через официальный фильтр`);
        return exact;
      }
    }
  }

  throw new Error(`FAIL: Столото не отдал точечный тираж №${draw}`);
}

async function readArchiveOnce(page, minTargetDraw, requiredDraws) {
  const rawRows = await collectRows(page, minTargetDraw);
  const parsed = parseRows(rawRows);

  if (!parsed.length) {
    throw new Error('FAIL: Столото не отдал тиражи');
  }

  const officialMap = new Map(parsed.map(row => [row.draw, row]));
  let missingRequired = [...requiredDraws]
    .filter(draw => !officialMap.has(draw))
    .sort((a, b) => a - b);

  console.log(
    `Основной проход: ${parsed.length} тиражей, ` +
    `диапазон №${parsed[0].draw}–№${parsed.at(-1).draw}`
  );

  if (missingRequired.length) {
    console.log(
      `Основной проход пропустил ${missingRequired.length}: ` +
      missingRequired.map(n => `№${n}`).join(', ') +
      '. Забираю только эти номера точечно, весь архив заново не открываю.'
    );

    for (const draw of missingRequired) {
      const exact = await readSpecificOfficialDraw(page, draw);
      officialMap.set(draw, exact);
    }
  }

  missingRequired = [...requiredDraws].filter(draw => !officialMap.has(draw));
  if (missingRequired.length) {
    throw new Error(
      `FAIL: после основного прохода и точечного добора нет ` +
      `${missingRequired.length} нужных тиражей: ` +
      missingRequired.slice(0, 25).map(n => `№${n}`).join(', ')
    );
  }

  console.log(
    `PASS: все ${requiredDraws.size} нужных тиражей получены официально; ` +
    `повторного полного прохода не было`
  );

  return officialMap;
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

function normalizeHistoryDate(value) {
  const s = normalizeSpace(value);
  let m = s.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{2,4})$/);
  if (m) {
    let y = Number(m[3]);
    if (y >= 100) y %= 100;
    return `${pad2(Number(m[1]))}.${pad2(Number(m[2]))}.${pad2(y)}`;
  }
  m = s.match(/^(\d{4})[.\/-](\d{1,2})[.\/-](\d{1,2})$/);
  if (m) {
    return `${pad2(Number(m[3]))}.${pad2(Number(m[2]))}.${String(m[1]).slice(-2)}`;
  }
  return s;
}

function normalizeHistoryDraw(row) {
  return {
    draw: Number(row?.draw ?? row?.number ?? row?.id),
    date: normalizeHistoryDate(row?.date),
    time: normalizeTime(row?.time)?.short || normalizeSpace(row?.time),
    balls: Array.isArray(row?.balls)
      ? row.balls.map(Number)
      : Array.isArray(row?.numbers)
        ? row.numbers.map(Number)
        : [],
    column: Number(row?.column),
    parity: parseParity(row?.parity || '')
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
    if (!/^\d{2}\.\d{2}\.\d{2}$/.test(normalized.date)) {
      throw new Error(`FAIL: history №${normalized.draw}: неверная дата ${normalized.date}`);
    }
    if (!/^\d{2}:\d{2}$/.test(normalized.time)) {
      throw new Error(`FAIL: history №${normalized.draw}: неверное время ${normalized.time}`);
    }
    if (
      normalized.balls.length !== 20 ||
      new Set(normalized.balls).size !== 20 ||
      normalized.balls.some(n => !Number.isInteger(n) || n < 1 || n > 80)
    ) {
      throw new Error(`FAIL: history №${normalized.draw}: неверные 20 чисел`);
    }

    return { original, index, ...normalized };
  }).sort((a, b) => a.draw - b.draw);

  for (let i = 1; i < rows.length; i += 1) {
    if (rows[i].draw === rows[i - 1].draw) {
      throw new Error(`FAIL: дубликат тиража №${rows[i].draw} в history`);
    }
  }

  return rows;
}

function validOfficialColumn(value) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= 10;
}

function validOfficialParity(value) {
  return ['Больше чётных', 'Больше нечётных', 'Поровну'].includes(parseParity(value || ''));
}

function selectLast32Dates(history) {
  const dates = [];
  for (const row of history) {
    if (!dates.includes(row.date)) dates.push(row.date);
  }
  return new Set(dates.slice(-32));
}

function compareTrustedBase(historyRow, officialRow) {
  if (historyRow.date !== officialRow.date) {
    throw new Error(
      `FAIL: №${historyRow.draw}: дата history/Столото отличается ` +
      `(${historyRow.date} != ${officialRow.date})`
    );
  }
  if (historyRow.time !== officialRow.time) {
    throw new Error(
      `FAIL: №${historyRow.draw}: время history/Столото отличается ` +
      `(${historyRow.time} != ${officialRow.time})`
    );
  }
  if (JSON.stringify(historyRow.balls) !== JSON.stringify(officialRow.balls)) {
    throw new Error(`FAIL: №${historyRow.draw}: 20 чисел history/Столото отличаются`);
  }
}

function applyOfficialBackfill(historyRaw, history, officialMap, targetDates) {
  const output = [...historyRaw];
  let changed = 0;
  let checked = 0;

  for (const row of history) {
    if (!targetDates.has(row.date)) continue;
    checked += 1;

    const official = officialMap.get(row.draw);
    if (!official) {
      throw new Error(`FAIL: нет официального Столото №${row.draw}`);
    }

    compareTrustedBase(row, official);

    if (validOfficialColumn(row.original?.column) && Number(row.original.column) !== official.column) {
      throw new Error(
        `FAIL: №${row.draw}: уже записанный column=${row.original.column} ` +
        `не совпадает со Столото column=${official.column}`
      );
    }
    if (validOfficialParity(row.original?.parity) && parseParity(row.original.parity) !== official.parity) {
      throw new Error(`FAIL: №${row.draw}: уже записанный parity не совпадает со Столото`);
    }

    const needsColumn = !validOfficialColumn(row.original?.column);
    const needsParity = !validOfficialParity(row.original?.parity);

    if (needsColumn || needsParity) {
      output[row.index] = {
        ...row.original,
        column: official.column,
        parity: official.parity,
        source: row.original?.source || 'Официальный Столото · OAuth · один проход + точечный добор',
        officialFieldsSource: 'Официальный Столото · OAuth · один проход + точечный добор · backfill 32 дня'
      };
      changed += 1;
    }
  }

  console.log(`Проверено ${checked} тиражей за последние 32 даты; дополнено ${changed}`);
  return { output, changed, checked };
}

const browser = await chromium.launch({ headless: true });

try {
  const historyRaw = await readTrustedHistory();
  const history = trustedHistoryStrict(historyRaw);
  const targetDates = selectLast32Dates(history);
  const targetRows = history.filter(row => targetDates.has(row.date));

  if (!targetRows.length) {
    throw new Error('FAIL: не найден диапазон последних 32 дат в history');
  }

  const minTargetDraw = targetRows[0].draw;
  const maxTargetDraw = targetRows.at(-1).draw;
  const requiredDraws = new Set(targetRows.map(row => row.draw));

  console.log(
    `BACKFILL: последние ${targetDates.size} дат; ` +
    `${targetRows.length} тиражей; диапазон №${minTargetDraw}–№${maxTargetDraw}`
  );

  const context = await browser.newContext({
    locale: 'ru-RU',
    timezoneId: 'Europe/Moscow',
    viewport: { width: 1365, height: 900 },
    userAgent:
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 ' +
      'Chrome/131.0.0.0 Safari/537.36'
  });
  const page = await context.newPage();

  await login(page);
  const officialMap = await readArchiveOnce(page, minTargetDraw, requiredDraws);
  const { output, changed } = applyOfficialBackfill(
    historyRaw,
    history,
    officialMap,
    targetDates
  );

  if (!changed) {
    console.log('PASS: за последние 32 даты column/parity уже заполнены официальными данными');
  } else {
    await fs.writeFile(HISTORY_FILE, JSON.stringify(output) + '\n', 'utf8');
    console.log(`PASS: официальный backfill завершён; обновлено ${changed} тиражей`);
  }
} finally {
  await browser.close();
}
