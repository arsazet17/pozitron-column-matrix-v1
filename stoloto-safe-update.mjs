'use strict';

import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';

const STATUS_FILE = 'stoloto-status.json';
const UPDATER = 'stoloto-column-matrix-update.mjs';

function nowIso() {
  return new Date().toISOString();
}

function isStolotoUnavailable(text) {
  const s = String(text || '').toLowerCase();

  // Только признаки недоступности/пустого ответа.
  const soft = [
    'не найдены поля oauth столото',
    'не найдена кнопка «войти»',
    'получено только 0 тиражей',
    'после проверки 2 из 3 стабильны только 0 тиражей',
    'timeout',
    'timed out',
    'net::err_',
    'http 502',
    'http 503',
    'http 504',
    'service unavailable',
    'maintenance',
    'техническ',
    'временно недоступ',
    'site is unavailable',
    'страница недоступна'
  ];

  return soft.some(x => s.includes(x));
}

async function writeStatus(status, details = '') {
  const data = {
    source: 'Столото',
    status,
    message:
      status === 'no_response' ? 'НЕТ ОТВЕТА СТОЛОТО' :
      status === 'ok' ? 'СТОЛОТО ОТВЕТИЛ' :
      'ОШИБКА ПРОВЕРКИ',
    checkedAt: nowIso(),
    details: String(details || '').slice(-2000)
  };
  await fs.writeFile(STATUS_FILE, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

const child = spawn(process.execPath, [UPDATER], {
  stdio: ['ignore', 'pipe', 'pipe'],
  env: process.env
});

let stdout = '';
let stderr = '';

child.stdout.on('data', chunk => {
  const s = chunk.toString();
  stdout += s;
  process.stdout.write(s);
});

child.stderr.on('data', chunk => {
  const s = chunk.toString();
  stderr += s;
  process.stderr.write(s);
});

const code = await new Promise(resolve => child.on('close', resolve));
const combined = `${stdout}\n${stderr}`;

if (code === 0) {
  await writeStatus('ok', stdout.trim());
  console.log('STOLOTO STATUS: OK');
  process.exit(0);
}

if (isStolotoUnavailable(combined)) {
  await writeStatus('no_response', combined.trim());
  console.log(
    'WARN: НЕТ ОТВЕТА СТОЛОТО — keno-history.json не трогаем, workflow продолжается.'
  );
  process.exit(0);
}

// Ошибки данных, Secrets, логики и валидации не маскируем.
await writeStatus('error', combined.trim());
console.error('FAIL: это не обычная недоступность Столото; требуется проверка.');
process.exit(code || 1);
