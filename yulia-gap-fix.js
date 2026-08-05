'use strict';
(() => {
  const pad = n => String(n).padStart(2, '0');

  function canonicalSlot(value) {
    const m = String(value || '').match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return String(value || '');

    const minutes = Number(m[1]) * 60 + Number(m[2]);

    let slot = Math.round((minutes - 17) / 30) * 30 + 17;
    slot = ((slot % 1440) + 1440) % 1440;

    return `${pad(Math.floor(slot / 60))}:${pad(slot % 60)}`;
  }

  function minuteValue(value) {
    const m = String(value || '').match(/^(\d{1,2}):(\d{2})$/);
    return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
  }

  function distance(a, b) {
    if (!Number.isFinite(a) || !Number.isFinite(b)) return 9999;

    const d = Math.abs(a - b);
    return Math.min(d, 1440 - d);
  }

  let scheduled = false;
  let applying = false;

  function normalizeYulia() {
    scheduled = false;

    if (applying) return;

    const head = document.getElementById('yuliaHead');
    const body = document.getElementById('yuliaBody');
    const headRow = head?.rows?.[0];

    if (!headRow || !body) return;

    const headers = Array.from(headRow.cells).slice(1);

    if (!headers.length) return;

    const source = headers.map((cell, index) => {
      const raw = cell.textContent.trim();
      const canonical = canonicalSlot(raw);

      return {
        index,
        raw,
        canonical,
        rawMinute: minuteValue(raw),
        canonicalMinute: minuteValue(canonical)
      };
    });

    const canonicalTimes = [
      ...new Set(source.map(x => x.canonical))
    ].sort((a, b) => minuteValue(a) - minuteValue(b));

    const alreadyNormalized =
      canonicalTimes.length === headers.length &&
      source.every((x, i) => x.raw === canonicalTimes[i]);

    if (alreadyNormalized) return;

    applying = true;

    try {
      const rows = Array.from(body.rows);

      rows.forEach(row => {
        if (!row.cells[0]) return;

        const oldCells = Array.from(row.cells).slice(1);
        const chosen = new Map();

        source.forEach(info => {
          const cell = oldCells[info.index];

          if (!cell) return;

          const hasValue = cell.textContent.trim() !== '';

          const score = hasValue
            ? distance(info.rawMinute, info.canonicalMinute)
            : 10000;

          const current = chosen.get(info.canonical);

          if (!current || score < current.score) {
            chosen.set(info.canonical, {
              cell,
              score,
              hasValue
            });
          }
        });

        while (row.cells.length > 1) {
          row.deleteCell(1);
        }

        canonicalTimes.forEach(time => {
          const pick = chosen.get(time);

          if (pick?.hasValue) {
            row.appendChild(pick.cell);
          } else {
            row.appendChild(document.createElement('td'));
          }
        });
      });

      while (headRow.cells.length > 1) {
        headRow.deleteCell(1);
      }

      canonicalTimes.forEach(time => {
        const th = document.createElement('th');
        th.textContent = time;
        headRow.appendChild(th);
      });

    } finally {
      applying = false;
    }
  }

  function scheduleNormalize() {
    if (applying || scheduled) return;

    scheduled = true;
    setTimeout(normalizeYulia, 0);
  }

  const observer = new MutationObserver(scheduleNormalize);

  function start() {
    const head = document.getElementById('yuliaHead');
    const body = document.getElementById('yuliaBody');

    if (!head || !body) return;

    observer.observe(head, {
      childList: true,
      subtree: true
    });

    observer.observe(body, {
      childList: true,
      subtree: true
    });

    scheduleNormalize();
  }

  if (document.readyState === 'loading') {
    document.addEventListener(
      'DOMContentLoaded',
      start,
      { once: true }
    );
  } else {
    start();
  }
})();
