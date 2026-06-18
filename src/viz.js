'use strict';

/* =============================================================
   TABLEAU VIZ EXTENSION — STARTER
   -------------------------------------------------------------
   A working skeleton you customize live (great with Claude Code).
   Every viz extension is the same four moves:

     1. CONNECT  — initializeAsync(), grab the worksheet
     2. ENCODINGS — which field did the user drop on each tile?
     3. DATA     — read the worksheet's summary data
     4. DRAW     — render into #viz; redraw on data change

   The only part that changes between a table, a bar chart, a
   heatmap… is step 4. Everything above the BUILD ZONE is plumbing
   you can usually leave alone.

   Requires Tableau 2024.2+ (Viz Extensions API).
   ============================================================= */

(function () {
  const host = document.getElementById('viz');

  // 1 — CONNECT ------------------------------------------------
  tableau.extensions.initializeAsync().then(
    () => {
      const ws = tableau.extensions.worksheetContent.worksheet;

      // Redraw whenever the data changes (filter, sort, parameter…).
      ws.addEventListener(tableau.TableauEventType.SummaryDataChanged, update);

      // Keep the viz responsive to worksheet resizing.
      if (window.ResizeObserver) {
        new ResizeObserver(() => lastModel && render(lastModel)).observe(host);
      }

      update(); // first paint
    },
    (err) => showMessage('Could not initialize: ' + err)
  );

  let lastModel = null;

  // 2 + 3 — read ENCODINGS and DATA, build a small model -------
  async function update() {
    const ws = tableau.extensions.worksheetContent.worksheet;

    let fields = {};
    try {
      fields = await getEncodedFields(ws);
    } catch (e) {
      console.error('reading encodings failed:', e);
    }

    // Nothing dropped on the tiles yet → friendly prompt.
    if (!Object.keys(fields).length) {
      lastModel = null;
      showMessage('Drop fields on the <b>Dimension</b> and <b>Measure</b> tiles in the Marks card.');
      return;
    }

    let table = { columns: [], data: [] };
    try {
      table = await readSummary(ws);
    } catch (e) {
      console.error('reading summary data failed:', e);
    }

    lastModel = {
      worksheet: ws.name,
      fields,                                   // { dimension: "Region", measure: "Sales", … }
      columns: table.columns.map((c) => ({ name: c.name, isNumeric: c.isNumeric })),
      rows: table.data.map((row) => row.map((cell) => (cell ? cell.formattedValue : ''))),
    };

    render(lastModel);
  }

  /* ===========================================================
     ▼▼▼  BUILD ZONE — make it yours  ▼▼▼
     -----------------------------------------------------------
     `model` gives you everything you need:
       model.worksheet  → the sheet name (string)
       model.fields     → which field is on each encoding,
                          e.g. { dimension: "Region", measure: "Sales" }
       model.columns    → [{ name, isNumeric }]
       model.rows       → array of rows, each an array of formatted strings

     Replace the placeholder below with your chart. Ask Claude Code
     for one, e.g. "render model.rows as an SVG bar chart using the
     dimension for labels and the measure for bar length."
     =========================================================== */
  function render(model) {
    host.innerHTML = '';

    const card = el('div', 'starter-card');
    card.appendChild(el('div', 'starter-kicker', 'VIZ EXTENSION · STARTER'));
    card.appendChild(el('h1', 'starter-title', model.worksheet || 'Your worksheet'));

    // Show what's wired up so the build zone is obvious.
    const enc = el('div', 'starter-enc');
    Object.entries(model.fields).forEach(([id, name]) => {
      const tag = el('span', 'starter-tag');
      tag.innerHTML = '<b>' + id + '</b> ' + escapeHtml(name);
      enc.appendChild(tag);
    });
    card.appendChild(enc);
    card.appendChild(el('div', 'starter-count', model.rows.length + ' rows · replace render() to draw your chart'));

    // A tiny preview table so you can see real data flowing through.
    if (model.columns.length) {
      const tbl = el('table', 'starter-preview');
      const thead = el('tr');
      model.columns.forEach((c) => thead.appendChild(el('th', c.isNumeric ? 'num' : '', c.name)));
      tbl.appendChild(thead);
      model.rows.slice(0, 8).forEach((row) => {
        const tr = el('tr');
        row.forEach((v, i) => tr.appendChild(el('td', model.columns[i] && model.columns[i].isNumeric ? 'num' : '', v)));
        tbl.appendChild(tr);
      });
      card.appendChild(tbl);
    }

    host.appendChild(card);
  }
  /* ▲▲▲  END BUILD ZONE  ▲▲▲ */

  /* ---------- plumbing (read encodings + summary data) ---------- */

  // Which field is on each encoding tile, keyed by the encoding id
  // from manifest.trex (here: "dimension", "measure").
  async function getEncodedFields(ws) {
    const spec = await ws.getVisualSpecificationAsync();
    const marks = spec.marksSpecifications[spec.activeMarksSpecificationIndex];
    const fields = {};
    for (const enc of marks.encodings) {
      if (enc.field) fields[enc.id] = enc.field.name;
    }
    return fields;
  }

  // Read the worksheet's summary data, page by page.
  async function readSummary(ws) {
    const reader = await ws.getSummaryDataReaderAsync();
    let columns = [];
    let data = [];
    for (let p = 0; p < reader.pageCount; p++) {
      const page = await reader.getPageAsync(p);
      columns = page.columns;
      data = data.concat(page.data);
    }
    if (reader.releaseAsync) {
      try { await reader.releaseAsync(); } catch (e) { /* ignore */ }
    }
    return { columns, data };
  }

  /* ---------- tiny DOM helpers ---------- */
  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function showMessage(html) {
    host.innerHTML = '<div class="starter-card starter-empty"><p>' + html + '</p></div>';
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }
})();
