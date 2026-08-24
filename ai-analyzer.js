'use strict';

(() => {
  const STORAGE_KEY = 'pozitron_column_matrix_draws_v1';
  const AI_CACHE_KEY = 'pozitron_openai_analysis_cache_v1';
  const WORKER_URL = 'https://pozitron-gigachat-api.arsazet-17-go.workers.dev';
  const VERSION = 'OPENAI-EXTERNAL-1.0';

  const $ = id => document.getElementById(id);

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

  function loadDraws() {
    const raw = safeJson(localStorage.getItem(STORAGE_KEY) || '[]', []);
    const map = new Map();

    (Array.isArray(raw) ? raw : []).forEach(item => {
      const d = normalizeDraw(item);
      if (d) map.set(d.draw, d);
    });

    return [...map.values()].sort((a, b) => a.draw - b.draw);
  }

  function columnStats(draws, windowSize = 250) {
    const recent = draws.slice(-windowSize);
    const frequency = Array(11).fill(0);
    const lastSeen = Array(11).fill(null);

    recent.forEach((d, i) => {
      frequency[d.column] += 1;
      lastSeen[d.column] = i;
    });

    const gaps = {};
    for (let col = 1; col <= 10; col++) {
      gaps[col] = lastSeen[col] == null
        ? recent.length
        : recent.length - 1 - lastSeen[col];
    }

    return {
      window: recent.length,
      frequency: Object.fromEntries(
        Array.from({length: 10}, (_, i) => [i + 1, frequency[i + 1]])
      ),
      gaps
    };
  }

  function buildPayload(draws) {
    const latest = draws.at(-1);
    const columns = draws.slice(-300).map(d => d.column);
    const lastFull = draws.slice(-35).map(d => ({
      draw: d.draw,
      date: d.date,
      time: d.time,
      column: d.column,
      parity: d.parity,
      balls: d.balls
    }));

    return {
      task: 'column_matrix_analysis',
      app: 'ПОЗИТРОН · МАТРИЦА СТОЛБОВ',
      version: VERSION,
      warning:
        'Результаты КЕНО случайны. Нужен статистический анализ без обещания гарантированного прогноза.',
      latestDraw: latest?.draw || null,
      latestOfficialColumn: latest?.column || null,
      recentOfficialColumns: columns,
      recentDraws: lastFull,
      stats250: columnStats(draws, 250),
      request:
        'Проанализируй последовательность официальных столбцов и последние тиражи. Дай краткий TOP-3 столбцов на следующий тираж, причины выбора и отдельной строкой уровень уверенности как низкий/средний. Не утверждай, что прогноз гарантирован.'
    };
  }

  function loadCache() {
    const data = safeJson(localStorage.getItem(AI_CACHE_KEY) || '{}', {});
    return data && typeof data === 'object' ? data : {};
  }

  function saveCache(cache) {
    try {
      const entries = Object.entries(cache)
        .sort((a, b) => Number(a[0]) - Number(b[0]))
        .slice(-50);
      localStorage.setItem(AI_CACHE_KEY, JSON.stringify(Object.fromEntries(entries)));
    } catch (_) {}
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;');
  }

  function injectUi() {
    if ($('aiViewBtn')) return;

    const style = document.createElement('style');
    style.textContent = `
      .viewtabs{grid-template-columns:repeat(3,1fr)!important}
      .ai-card{margin-top:0}
      .ai-head{display:flex;justify-content:space-between;gap:10px;align-items:flex-start;margin-bottom:10px}
      .ai-head b{font-size:18px}
      .ai-sub{font-size:11px;color:#9babc0;margin-top:3px;line-height:1.4}
      .ai-status{font-size:12px;font-weight:900;color:#ffd34f;white-space:nowrap}
      .ai-run{width:100%;border:1px solid #397b92;background:#15566a;color:#fff;border-radius:11px;padding:11px;font-weight:950}
      .ai-run:disabled{opacity:.55}
      .ai-result{margin-top:10px;border:1px solid #355273;background:#0b1728;border-radius:12px;padding:12px;white-space:pre-wrap;line-height:1.5;font-size:13px}
      .ai-meta{margin-top:8px;color:#9babc0;font-size:11px}
      .ai-error{color:#ff9b9b}
      .ai-ok{color:#6ee7a0}
      @media(max-width:520px){
        .viewtabs{grid-template-columns:repeat(3,1fr)!important}
        .viewtab{font-size:12px;padding:8px 4px}
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
              <b>🧠 Внешний ИИ-анализ</b>
              <div class="ai-sub">
                OpenAI через защищённый Cloudflare Worker. API-ключ в браузере не хранится.
              </div>
            </div>
            <div id="aiStatus" class="ai-status">готов</div>
          </div>

          <button id="aiRunBtn" class="ai-run" type="button">Запустить ИИ-анализ</button>

          <div class="groupnote">
            Запрос выполняется вручную, чтобы не расходовать API-кредиты при каждом обновлении страницы.
            Для одного и того же последнего тиража сохранённый ответ используется повторно.
          </div>

          <div id="aiResult" class="ai-result">Нажмите «Запустить ИИ-анализ».</div>
          <div id="aiMeta" class="ai-meta"></div>
        </div>`;
      host.insertBefore(section, $('settingsPanel') || null);
    }

    $('aiViewBtn')?.addEventListener('click', () => {
      $('matrixView')?.classList.remove('active');
      $('yuliaView')?.classList.remove('active');
      $('aiView')?.classList.add('active');

      document.querySelectorAll('.viewtab').forEach(b => b.classList.remove('active'));
      $('aiViewBtn')?.classList.add('active');
      showCached();
    });

    ['matrixViewBtn', 'yuliaViewBtn'].forEach(id => {
      $(id)?.addEventListener('click', () => {
        $('aiView')?.classList.remove('active');
        $('aiViewBtn')?.classList.remove('active');
      });
    });

    $('aiRunBtn')?.addEventListener('click', runExternalAnalysis);
  }

  function showCached() {
    const draws = loadDraws();
    const latest = draws.at(-1);

    if (!latest) {
      $('aiResult').textContent = 'Нет официальных тиражей для анализа.';
      $('aiMeta').textContent = '';
      return;
    }

    const cache = loadCache();
    const rec = cache[String(latest.draw)];

    if (rec?.analysis) {
      $('aiStatus').innerHTML = '<span class="ai-ok">сохранено</span>';
      $('aiResult').textContent = rec.analysis;
      $('aiMeta').textContent =
        `Тираж №${latest.draw} · ответ сохранён ${new Date(rec.savedAt).toLocaleString()}`;
    } else {
      $('aiStatus').textContent = 'готов';
      $('aiResult').textContent =
        `Последний официальный тираж: №${latest.draw}, столбец ${latest.column}.\nНажмите «Запустить ИИ-анализ».`;
      $('aiMeta').textContent = '';
    }
  }

  async function runExternalAnalysis() {
    const draws = loadDraws();
    const latest = draws.at(-1);

    if (!latest || draws.length < 10) {
      $('aiResult').innerHTML =
        '<span class="ai-error">Недостаточно официальных данных для анализа.</span>';
      return;
    }

    const btn = $('aiRunBtn');
    btn.disabled = true;
    $('aiStatus').textContent = 'запрос...';
    $('aiResult').textContent = 'Отправляю данные во внешний ИИ-анализатор...';
    $('aiMeta').textContent = '';

    try {
      const response = await fetch(WORKER_URL, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(buildPayload(draws))
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok || !data?.ok) {
        throw new Error(data?.error || `HTTP ${response.status}`);
      }

      const analysis = String(data.analysis || '').trim();
      if (!analysis) throw new Error('OpenAI вернул пустой ответ');

      $('aiStatus').innerHTML = '<span class="ai-ok">готово</span>';
      $('aiResult').textContent = analysis;

      const cache = loadCache();
      cache[String(latest.draw)] = {
        analysis,
        savedAt: new Date().toISOString()
      };
      saveCache(cache);

      $('aiMeta').textContent =
        `Тираж №${latest.draw} · внешний анализ OpenAI · ${new Date().toLocaleString()}`;
    } catch (error) {
      $('aiStatus').innerHTML = '<span class="ai-error">ошибка</span>';
      $('aiResult').innerHTML =
        `<span class="ai-error">${escapeHtml(error?.message || error)}</span>`;
      $('aiMeta').textContent =
        'Проверьте доступность Cloudflare Worker и секрет OPENAI_API_KEY.';
    } finally {
      btn.disabled = false;
    }
  }

  injectUi();
  showCached();
})();
