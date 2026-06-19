'use strict';

/*
 * Pretty Table — viz extension renderer.
 *
 * Pipeline (re-run on data/encoding changes):
 *   1. getVisualSpecificationAsync()  → column ORDER (field names on "Columns").
 *   2. getSummaryDataAsync({ignoreSelection, ignoreAliases}) → rows.
 *   3. Coerce each column to a real type ONCE at ingest (number/date/bool/text),
 *      so sorting, numeric rendering and search are all correct, and precompute
 *      each numeric column's min/max/absMax.
 *   4. View = filter (live search) → sort (multi-level, persisted by field name)
 *      → paginate (30/page) → draw. Cheap stuff (search, sort, page, View menu)
 *      re-runs step 4 only; it never re-fetches.
 *
 * Config (labels, types, widths, sort defaults, appearance, empty state…) lives
 * in tableau.extensions.settings via pretty-table-shared.js and is authored in
 * the Configure dialog.
 */
(function () {
  const EM = '—';
  const PAGE_SIZE = 30;

  const els = {
    body: document.body,
    wsName: document.getElementById('ws-name'),
    envBadge: document.getElementById('env-badge'),
    search: document.getElementById('search'),
    table: document.getElementById('table'),
    scroll: document.getElementById('scroll'),
    pager: document.getElementById('pager'),
    count: document.getElementById('count'),
    overlay: document.getElementById('overlay'),
    collapseBtn: document.getElementById('collapse-btn'),
    viewMenu: document.getElementById('view-menu'),
    viewBtn: document.getElementById('view-btn'),
    viewPanel: document.getElementById('view-panel'),
    exportBtn: document.getElementById('export-btn'),
    exportModal: document.getElementById('export-modal'),
    exportCols: document.getElementById('export-cols'),
    exportCount: document.getElementById('export-count'),
    exportGo: document.getElementById('export-go'),
  };

  // ---- State -------------------------------------------------------------
  let worksheet = null;
  let cfg = ptDefaults();
  let lastCfgJson = '';
  let model = null;          // { bound, cols, rows, wsName }
  let sortState = [];        // [{ field, dir }]  primary first, then tiebreaker
  let searchTerm = '';
  let page = 1;
  let appearance = Object.assign({}, PT_APPEARANCE_DEFAULTS); // in-session (View menu)
  let exportChecked = {};    // fieldName → bool, for the export picker
  let currentPageRows = [];  // rows currently drawn (for click→select)
  let selectedSigs = new Set(); // signatures of this worksheet's selected marks

  // ============================ INGEST ====================================

  async function readColumnOrder(ws) {
    const order = [];
    const seen = new Set();
    try {
      const spec = await ws.getVisualSpecificationAsync();
      const marks = spec && spec.marksSpecifications && spec.marksSpecifications.length
        ? (spec.marksSpecifications[spec.activeMarksSpecificationIndex] || spec.marksSpecifications[0])
        : null;
      for (const enc of (marks && marks.encodings) || []) {
        if (enc && enc.id === 'columns' && enc.field && !seen.has(enc.field.name)) {
          seen.add(enc.field.name);
          order.push(enc.field.name);
        }
      }
    } catch (e) { /* spec not ready / nothing bound */ }
    return order;
  }

  function autoType(dataType) {
    if (dataType === 'int' || dataType === 'float') return 'number';
    if (dataType === 'date' || dataType === 'date-time' || dataType === 'datetime') return 'date';
    if (dataType === 'bool' || dataType === 'boolean') return 'bool';
    return 'text';
  }

  // Coerce one Tableau DataValue into the shape the rest of the code needs:
  //   disp – what we show   lc – lowercase for search   sort – comparable key
  //   num  – numeric value for bars/heatmap/dots   csv – value for export
  function coerceCell(dv, col) {
    const isNull = dv == null || dv.value == null || dv.value === '%null%';
    if (isNull) return { isNull: true, disp: EM, lc: '', sort: null, num: null, csv: '', nat: null, sig: VizCore.sigRaw(null) };

    const raw = dv.nativeValue != null ? dv.nativeValue : dv.value;
    let disp, sort, num = null;

    if (col.type === 'number') {
      let n = typeof raw === 'number' ? raw : parseFloat(raw);
      if (isNaN(n)) n = parseFloat(String(dv.formattedValue || '').replace(/[^0-9.eE+-]/g, ''));
      num = isNaN(n) ? null : n;
      sort = num;
      // Honor a decimals override; otherwise keep Tableau's formatted value.
      disp = (col.decimals >= 0 && num != null)
        ? num.toLocaleString(undefined, { minimumFractionDigits: col.decimals, maximumFractionDigits: col.decimals })
        : VizCore.fmt(dv);
    } else if (col.type === 'date') {
      let d = raw instanceof Date ? raw : new Date(raw);
      if (isNaN(d.getTime()) && dv.formattedValue) d = new Date(dv.formattedValue);
      sort = isNaN(d.getTime()) ? null : d.getTime();
      disp = VizCore.fmt(dv);
    } else if (col.type === 'bool') {
      const b = raw === true || raw === 'true' || raw === 1;
      sort = b ? 1 : 0;
      disp = VizCore.fmt(dv) || (b ? 'True' : 'False');
    } else {
      disp = VizCore.fmt(dv);
      sort = String(disp).toLowerCase();
    }

    return {
      isNull: false,
      disp: disp == null ? '' : String(disp),
      lc: String(disp == null ? '' : disp).toLowerCase(),
      sort: sort,
      num: num,
      csv: col.type === 'number' && num != null ? String(num) : (disp == null ? '' : String(disp)),
      nat: raw,                    // native value, used to select this row's marks
      sig: VizCore.sigRaw(raw),    // stable key for matching against selected marks
    };
  }

  async function loadData(ws) {
    const order = await readColumnOrder(ws);
    if (!order.length) { model = { bound: false, cols: [], rows: [], wsName: ws.name }; return; }

    const summary = await ws.getSummaryDataAsync({ ignoreSelection: true, ignoreAliases: true });
    const rawCols = (summary && summary.columns) || [];
    const data = (summary && summary.data) || [];

    // Build the column model in visual-spec order, applying per-column config.
    const cols = [];
    for (const field of order) {
      const raw = rawCols.find((c) => c.fieldName === field);
      if (!raw) continue; // bound field not present in summary data → hidden
      const cc = ptColConfig(cfg, field);
      const type = cc.type === 'auto' ? autoType(raw.dataType) : cc.type;
      cols.push({
        field, label: cc.label || field, type, dataType: raw.dataType, srcIndex: raw.index,
        visible: cc.visible, width: cc.width, decimals: cc.decimals, essential: cc.essential,
        renderMode: cc.renderMode, dotsCeiling: cc.dotsCeiling,
        isNum: type === 'number', min: Infinity, max: -Infinity, absMax: 0,
      });
    }

    // Coerce every cell once, aligned to the column model.
    const rows = data.map((r) => cols.map((c) => coerceCell(r[c.srcIndex], c)));

    // Precompute numeric stats per column (one pass) for bars/heatmap/dots.
    for (let j = 0; j < cols.length; j++) {
      if (!cols[j].isNum) continue;
      let mn = Infinity, mx = -Infinity;
      for (const row of rows) {
        const n = row[j].num;
        if (n == null) continue;
        if (n < mn) mn = n;
        if (n > mx) mx = n;
      }
      cols[j].min = mn === Infinity ? 0 : mn;
      cols[j].max = mx === -Infinity ? 0 : mx;
      cols[j].absMax = Math.max(Math.abs(cols[j].min), Math.abs(cols[j].max));
    }

    // Dimension columns identify a mark. Selecting by every dimension value of a
    // row uniquely targets that row's underlying marks (measures are aggregates,
    // so they're poor selection keys). Fall back to all columns if there are no
    // dimensions (e.g. a measures-only table).
    let dimIdx = cols.map((c, j) => (c.type !== 'number' ? j : -1)).filter((j) => j >= 0);
    if (!dimIdx.length) dimIdx = cols.map((_, j) => j);
    const dimFields = dimIdx.map((j) => cols[j].field);

    model = { bound: true, cols, rows, wsName: ws.name, dimIdx, dimFields };
  }

  const SIG_SEP = String.fromCharCode(1); // must match VizCore.getSelectedSignatures
  function rowSignature(row) {
    return model.dimIdx.map((j) => row[j].sig).join(SIG_SEP);
  }

  // ============================ SORT ======================================

  // Keep only levels whose field still exists; seed from config defaults when
  // there is no active sort (or when the author just changed config defaults).
  function reconcileSort(seedFromConfig) {
    const fields = new Set(model.cols.map((c) => c.field));
    if (seedFromConfig) {
      sortState = [];
      const p = cfg.sort.primary, s = cfg.sort.secondary;
      if (p.field && fields.has(p.field)) sortState.push({ field: p.field, dir: p.dir });
      if (s.field && fields.has(s.field) && s.field !== p.field) sortState.push({ field: s.field, dir: s.dir });
    } else {
      sortState = sortState.filter((s) => fields.has(s.field));
    }
  }

  // Header click cycles the clicked column asc → desc → off. Clicking a column
  // that isn't already primary promotes it to primary and demotes the previous
  // primary to the secondary tiebreaker (max two levels).
  function cycleSort(field) {
    const i = sortState.findIndex((s) => s.field === field);
    if (i === 0) {
      if (sortState[0].dir === 'asc') sortState[0].dir = 'desc';
      else sortState.shift(); // off → secondary (if any) becomes primary
    } else {
      if (i > 0) sortState.splice(i, 1);
      sortState.unshift({ field, dir: 'asc' });
      sortState = sortState.slice(0, 2);
    }
    page = 1;
    renderView();
  }

  function compareRows(a, b) {
    for (const lvl of sortState) {
      const j = model.cols.findIndex((c) => c.field === lvl.field);
      if (j < 0) continue;
      const av = a[j].sort, bv = b[j].sort;
      if (av === bv) continue;
      if (av == null) return 1;          // nulls always last
      if (bv == null) return -1;
      let cmp = av < bv ? -1 : 1;
      if (lvl.dir === 'desc') cmp = -cmp;
      return cmp;
    }
    return 0;
  }

  // ============================ VIEW (filter→sort→page→draw) ==============

  function visibleCols() { return model.cols.filter((c) => c.visible); }

  function getFiltered() {
    if (!searchTerm) return model.rows;
    const vis = [];
    model.cols.forEach((c, j) => { if (c.visible) vis.push(j); });
    return model.rows.filter((row) => vis.some((j) => row[j].lc.indexOf(searchTerm) !== -1));
  }

  function effectiveMode(col) {
    if (!col.isNum) return 'none';
    if (col.renderMode === 'dots') return 'dots';
    return appearance.numericRender;
  }

  function renderCell(col, cell) {
    if (cell.isNull) return '<td class="null">' + EM + '</td>';
    if (!col.isNum) return '<td>' + VizCore.escapeHtml(cell.disp) + '</td>';

    const v = cell.num;
    const cls = ['num'];
    if (v > 0) cls.push('pos'); else if (v < 0) cls.push('neg');
    const mode = effectiveMode(col);
    const esc = VizCore.escapeHtml(cell.disp);

    if (mode === 'bars') return renderBarCell(col, v, esc);
    if (mode === 'heatmap') {
      const span = col.max - col.min;
      const ratio = span > 0 ? (v - col.min) / span : 0.5;
      const alpha = (0.08 + 0.42 * ratio).toFixed(3);
      // Inset shadow tints over the row's own background (zebra/hover) without
      // replacing it; alpha rises from column min → max.
      return '<td class="' + cls.join(' ') + '" style="box-shadow:inset 0 0 0 999px rgba(44,110,143,' + alpha + ')">' + esc + '</td>';
    }
    if (mode === 'dots') {
      const ceil = col.dotsCeiling > 0 ? col.dotsCeiling : Math.max(col.absMax, 1);
      const filled = Math.max(0, Math.min(5, Math.round((Math.abs(v) / ceil) * 5)));
      let dots = '<span class="dots">';
      for (let k = 0; k < 5; k++) dots += '<i class="' + (k < filled ? 'on' : '') + '"></i>';
      dots += '</span>';
      // dots sit left, label right — drop num alignment so the row reads cleanly
      return '<td class="num' + (v > 0 ? ' pos' : v < 0 ? ' neg' : '') + '" style="text-align:right">' + dots + esc + '</td>';
    }
    return '<td class="' + cls.join(' ') + '">' + esc + '</td>';
  }

  // In-cell data bar. Geometry, color and label placement all come from the
  // appearance.bar options (set in the View menu). The label is kept separate
  // from the fill so the two always compose cleanly:
  //   overlay  → number on the bar, with a bg-colored halo for legibility
  //   outside  → number in a fixed right gutter the bar never enters
  //   hidden   → bar only
  function renderBarCell(col, v, esc) {
    const b = appearance.bar;
    const ceil = col.absMax > 0 ? col.absMax : 1;
    const ratio = Math.min(1, Math.abs(v) / ceil);
    const pct = (ratio * 100).toFixed(2);

    let color = 'var(--accent)';
    let opacity = 0.62;
    if (b.color === 'posneg') color = v < 0 ? 'var(--neg)' : 'var(--accent)';
    else if (b.color === 'gradient') opacity = 0.30 + 0.55 * ratio; // darker with magnitude

    let geo;
    if (b.direction === 'zero') {
      const half = (ratio * 50).toFixed(2) + '%';
      geo = v < 0 ? 'right:50%;width:' + half : 'left:50%;width:' + half;
    } else if (b.direction === 'right') {
      geo = 'right:0;width:' + pct + '%';
    } else {
      geo = 'left:0;width:' + pct + '%';
    }

    const tdCls = ['bar', 'h-' + b.height, 'lbl-' + b.labelMode];
    if (b.rounded) tdCls.push('rounded');
    if (b.track) tdCls.push('track');

    const fill = '<div class="barzone"><span class="barfill" style="' + geo + ';background:' + color + ';opacity:' + opacity.toFixed(3) + '"></span></div>';
    const label = b.labelMode === 'hidden' ? '' : '<span class="barlabel">' + esc + '</span>';
    return '<td class="' + tdCls.join(' ') + '">' + fill + label + '</td>';
  }

  function applyColgroup(cols) {
    const dw = cfg.appearance.defaultColWidth | 0;
    const anyWidth = dw > 0 || cols.some((c) => (c.width | 0) > 0);
    if (!anyWidth) { els.table.classList.remove('fixed'); return ''; }
    els.table.classList.add('fixed');
    let cg = '<colgroup>';
    for (const c of cols) {
      const w = (c.width | 0) > 0 ? c.width : dw;
      cg += w > 0 ? '<col style="width:' + w + 'px">' : '<col>';
    }
    return cg + '</colgroup>';
  }

  function renderView() {
    const cols = visibleCols();
    const filtered = getFiltered();
    const total = model.rows.length;

    const sorted = sortState.length ? filtered.slice().sort(compareRows) : filtered;
    const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
    if (page > pageCount) page = pageCount;
    const start = (page - 1) * PAGE_SIZE;
    const pageRows = sorted.slice(start, start + PAGE_SIZE);

    // Map visible cols back to their model index so we read the right cell.
    const colIdx = cols.map((c) => model.cols.indexOf(c));

    let html = applyColgroup(cols) + '<thead><tr>';
    for (const c of cols) {
      const lvl = sortState.findIndex((s) => s.field === c.field);
      const sortCls = lvl === 0 ? ' sorted' : lvl === 1 ? ' sorted2' : '';
      const dirCls = lvl >= 0 ? ' dir-' + sortState[lvl].dir : '';
      const lvlBadge = lvl === 1 ? '<span class="lvl">2</span>' : '';
      const star = c.essential ? '<span class="star" title="Essential">★</span> ' : '';
      html += '<th class="' + (c.isNum ? 'num' : '') + sortCls + dirCls + '" data-field="' + VizCore.escapeHtml(c.field) + '">'
        + '<span class="h">' + star + '<span class="label">' + VizCore.escapeHtml(c.label) + '</span>' + lvlBadge + '<span class="caret"></span></span></th>';
    }
    html += '</tr></thead><tbody>';

    currentPageRows = pageRows; // referenced by row-click selection
    for (let r = 0; r < pageRows.length; r++) {
      const row = pageRows[r];
      const sig = rowSignature(row);
      html += '<tr data-idx="' + r + '" data-sig="' + VizCore.escapeHtml(sig) + '"' + (selectedSigs.has(sig) ? ' class="selected"' : '') + '>';
      for (let k = 0; k < cols.length; k++) html += renderCell(cols[k], row[colIdx[k]]);
      html += '</tr>';
    }
    html += '</tbody>';
    els.table.innerHTML = html;
    els.scroll.scrollTop = 0;

    renderPager(page, pageCount);
    renderCount(sorted.length, total);
  }

  // ============================ CROSS-VIZ SELECTION ======================
  // Clicking a row selects its underlying marks on this worksheet. If the
  // worksheet "uses as filter" (or has filter/highlight actions), Tableau then
  // carries that selection to the OTHER viz on the dashboard, which re-render as
  // their data changes — this is how all the extensions interact.
  function onRowClick(tr, evt) {
    const additive = evt.ctrlKey || evt.metaKey || evt.shiftKey;
    const sig = tr.getAttribute('data-sig');

    // Plain-click the sole current selection again → clear it (toggle off).
    if (!additive && selectedSigs.size === 1 && selectedSigs.has(sig)) {
      VizCore.clearMarks(worksheet);
      return;
    }
    const row = currentPageRows[parseInt(tr.getAttribute('data-idx'), 10)];
    if (!row) return;
    const criteria = [];
    for (const j of model.dimIdx) {
      const cell = row[j];
      if (cell.isNull) continue; // can't select on a null dimension value
      criteria.push({ fieldName: model.cols[j].field, value: [cell.nat] });
    }
    if (!criteria.length) return;
    VizCore.selectByCriteria(worksheet, criteria, additive);
    // The resulting MarkSelectionChanged event refreshes the highlight.
  }

  // Reflect this worksheet's current selection by highlighting matching rows —
  // lightweight (toggles classes only), no data re-fetch.
  async function refreshSelection() {
    if (!model || !model.bound) return;
    selectedSigs = await VizCore.getSelectedSignatures(worksheet, model.dimFields);
    els.table.querySelectorAll('tbody tr').forEach((tr) => {
      tr.classList.toggle('selected', selectedSigs.has(tr.getAttribute('data-sig')));
    });
  }

  // First, last, current ± neighbors, ellipsis between gaps.
  function renderPager(cur, totalPages) {
    if (totalPages <= 1) { els.pager.innerHTML = ''; return; }
    const want = new Set([1, totalPages, cur, cur - 1, cur + 1]);
    const nums = [...want].filter((n) => n >= 1 && n <= totalPages).sort((a, b) => a - b);
    let html = '<button data-pg="' + (cur - 1) + '"' + (cur === 1 ? ' disabled' : '') + '>‹</button>';
    let prev = 0;
    for (const n of nums) {
      if (n - prev > 1) html += '<span class="gap">…</span>';
      html += '<button data-pg="' + n + '"' + (n === cur ? ' class="active"' : '') + '>' + n + '</button>';
      prev = n;
    }
    html += '<button data-pg="' + (cur + 1) + '"' + (cur === totalPages ? ' disabled' : '') + '>›</button>';
    els.pager.innerHTML = html;
  }

  function renderCount(shown, total) {
    const noun = total === 1 ? 'row' : 'rows';
    els.count.innerHTML = shown < total
      ? '<b>' + shown.toLocaleString() + '</b> of ' + total.toLocaleString() + ' ' + noun
      : '<b>' + total.toLocaleString() + '</b> ' + noun;
  }

  // ============================ EMPTY / LOADING ===========================

  function showLoading() {
    if (els.table.tHead) return; // don't blink over an existing table on refresh
    els.overlay.innerHTML = '<div class="box"><div class="spinner"></div>Loading…</div>';
    els.overlay.classList.add('show');
  }
  function hideOverlay() { els.overlay.classList.remove('show'); }

  function showSimpleState(msgHtml) {
    els.table.innerHTML = ''; els.pager.innerHTML = ''; els.count.innerHTML = '';
    els.overlay.innerHTML = '<div class="box">' + msgHtml + '</div>';
    els.overlay.classList.add('show');
  }

  // Feature 8: branded "no rows" state with an optional parameter-writing button.
  function showNoRowsState() {
    els.table.innerHTML = ''; els.pager.innerHTML = ''; els.count.innerHTML = '';
    const es = cfg.emptyState;
    const title = es.title || 'No rows to display';
    const desc = es.description || 'The bound fields returned <b>0 rows</b>.';
    let html = '<div class="box"><h3>' + VizCore.escapeHtml(title) + '</h3>'
      + '<div class="es-desc">' + desc + '</div>'; // description is HTML-capable by design
    if (es.buttonEnabled && es.paramName) {
      html += '<button class="es-btn" id="es-load">' + VizCore.escapeHtml(es.buttonLabel || 'Load detail') + '</button>';
    }
    html += '</div>';
    els.overlay.innerHTML = html;
    els.overlay.classList.add('show');
    const btn = document.getElementById('es-load');
    if (btn) btn.onclick = loadDetailParameter;
  }

  async function loadDetailParameter() {
    const es = cfg.emptyState;
    const btn = document.getElementById('es-load');
    try {
      const param = await worksheet.findParameterAsync(es.paramName);
      if (!param) throw new Error('Parameter “' + es.paramName + '” not found');
      await param.changeValueAsync(es.paramValue);
      if (btn) { btn.textContent = 'Loading…'; btn.disabled = true; }
    } catch (e) {
      if (btn) { btn.textContent = 'Couldn’t set “' + es.paramName + '”'; }
      console.error('Load-detail parameter write failed:', e);
    }
  }

  // ============================ APPEARANCE (View menu) ====================

  function applyAppearance() {
    els.body.setAttribute('data-theme', appearance.theme);
    els.body.setAttribute('data-density', appearance.density);
    els.body.setAttribute('data-zebra', appearance.zebra ? 'on' : 'off');
  }

  // Read/write a possibly-nested appearance key ("bar.color" → appearance.bar.color).
  function appGet(key) { return key.indexOf('.') < 0 ? appearance[key] : key.split('.').reduce((o, k) => o[k], appearance); }
  function appSet(key, val) {
    if (key.indexOf('.') < 0) { appearance[key] = val; return; }
    const p = key.split('.'); appearance[p[0]][p[1]] = val;
  }

  function buildViewMenu() {
    const seg = (label, key, opts) => {
      let h = '<div class="menu-group"><div class="menu-label">' + label + '</div><div class="seg">';
      for (const [v, t] of opts) h += '<button data-set="' + key + '" data-val="' + v + '"' + (String(appGet(key)) === String(v) ? ' class="active"' : '') + '>' + t + '</button>';
      return h + '</div></div>';
    };
    const checkbox = (id, label, on) => '<div class="menu-group"><label class="check"><input type="checkbox" id="' + id + '"' + (on ? ' checked' : '') + '> ' + label + '</label></div>';

    let html =
      seg('Theme', 'theme', [['light', 'Light'], ['dark', 'Dark']]) +
      seg('Row density', 'density', [['compact', 'Compact'], ['comfortable', 'Comfortable'], ['spacious', 'Spacious']]) +
      checkbox('vm-zebra', 'Zebra striping', appearance.zebra) +
      seg('Numbers', 'numericRender', [['none', 'Plain'], ['bars', 'Bars'], ['heatmap', 'Heatmap'], ['dots', 'Dots']]);

    // Bar-styling controls — only relevant when the bars renderer is active.
    if (appearance.numericRender === 'bars') {
      const b = appearance.bar;
      html +=
        seg('Bar fill', 'bar.color', [['accent', 'Accent'], ['posneg', '+ / −'], ['gradient', 'Gradient']]) +
        seg('Bar direction', 'bar.direction', [['left', 'Left'], ['right', 'Right'], ['zero', 'Center']]) +
        seg('Bar height', 'bar.height', [['thin', 'Thin'], ['medium', 'Medium'], ['full', 'Full']]) +
        seg('Number label', 'bar.labelMode', [['overlay', 'On bar'], ['outside', 'Beside'], ['hidden', 'Hidden']]) +
        checkbox('vm-bar-rounded', 'Rounded corners', b.rounded) +
        checkbox('vm-bar-track', 'Show track', b.track);
    }
    els.viewPanel.innerHTML = html;

    els.viewPanel.querySelectorAll('button[data-set]').forEach((btn) => {
      btn.onclick = () => {
        appSet(btn.getAttribute('data-set'), btn.getAttribute('data-val'));
        applyAppearance(); buildViewMenu();
        if (model && model.bound && visibleCols().length && model.rows.length) renderView();
      };
    });
    const reRender = () => { if (model && model.bound && visibleCols().length && model.rows.length) renderView(); };
    const z = document.getElementById('vm-zebra');
    if (z) z.onchange = () => { appearance.zebra = z.checked; applyAppearance(); };
    const r = document.getElementById('vm-bar-rounded');
    if (r) r.onchange = () => { appearance.bar.rounded = r.checked; reRender(); };
    const t = document.getElementById('vm-bar-track');
    if (t) t.onchange = () => { appearance.bar.track = t.checked; reRender(); };
  }

  // ============================ CSV EXPORT ================================

  function openExport() {
    const cols = model.cols;
    // Default selection follows current visibility.
    exportChecked = {};
    cols.forEach((c) => { exportChecked[c.field] = c.visible; });
    renderExportList();
    els.exportModal.classList.add('show');
  }

  function renderExportList() {
    let html = '';
    for (const c of model.cols) {
      html += '<label><input type="checkbox" data-field="' + VizCore.escapeHtml(c.field) + '"' + (exportChecked[c.field] ? ' checked' : '') + '> '
        + VizCore.escapeHtml(c.label) + '</label>';
    }
    els.exportCols.innerHTML = html;
    els.exportCols.querySelectorAll('input[data-field]').forEach((i) => {
      i.onchange = () => { exportChecked[i.getAttribute('data-field')] = i.checked; updateExportCount(); };
    });
    updateExportCount();
  }

  function updateExportCount() {
    const chosen = model.cols.filter((c) => exportChecked[c.field]).length;
    const rows = getFiltered().length;
    els.exportCount.textContent = chosen + ' of ' + model.cols.length + ' cols · ' + rows.toLocaleString() + ' rows';
    els.exportGo.disabled = chosen === 0;
  }

  function csvField(s) {
    s = s == null ? '' : String(s);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function doExport() {
    const cols = model.cols.filter((c) => exportChecked[c.field]);
    if (!cols.length) return;
    const colIdx = cols.map((c) => model.cols.indexOf(c));
    const rows = getFiltered();

    const lines = [cols.map((c) => csvField(c.label)).join(',')];
    for (const row of rows) {
      lines.push(colIdx.map((j) => csvField(row[j].csv)).join(','));
    }
    const csv = lines.join('\r\n');
    const BOM = '﻿'; // so Excel detects UTF-8
    const blob = new Blob([BOM + csv], { type: 'text/csv;charset=utf-8;' });
    const name = (model.wsName || 'pretty-table').replace(/[\\/:*?"<>|]+/g, '_');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name + '.csv';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    els.exportModal.classList.remove('show');
  }

  // ============================ TITLE / ENV ===============================

  function envLetter() {
    try {
      const env = tableau.extensions.environment;
      const ctx = String(env.context || env.tableauVersion || '').toLowerCase();
      if (ctx.indexOf('desktop') !== -1) return { l: 'd', t: 'Tableau Desktop' };
      if (ctx.indexOf('public') !== -1) return { l: 'p', t: 'Tableau Public' };
      if (ctx.indexOf('server') !== -1 || ctx.indexOf('cloud') !== -1) return { l: 's', t: 'Tableau Server / Cloud' };
      const mode = String(env.mode || '').toLowerCase();
      if (mode) return { l: mode[0], t: 'Mode: ' + mode };
    } catch (e) { /* ignore */ }
    return { l: 'L', t: 'Local' };
  }

  // ============================ RENDER LOOP ===============================

  async function render(ws) {
    worksheet = ws;

    // Detect whether config (not just data) changed, to decide on re-seeding.
    const fresh = ptReadConfig();
    const j = JSON.stringify(fresh);
    const cfgChanged = j !== lastCfgJson;
    cfg = fresh; lastCfgJson = j;
    if (cfgChanged) appearance = ptMergeAppearance(PT_APPEARANCE_DEFAULTS, cfg.appearance);

    showLoading();
    await loadData(ws);

    els.wsName.textContent = model.wsName || 'Pretty Table';
    const env = envLetter();
    els.envBadge.textContent = env.l; els.envBadge.title = env.t;

    applyAppearance();
    buildViewMenu();

    if (!model.bound) {
      showSimpleState('Drop one or more fields on <b>Columns</b> on the Marks card. Each field becomes a table column.');
      return;
    }
    reconcileSort(cfgChanged); // seed from config on a config change; else just prune dead levels

    if (!visibleCols().length) {
      showSimpleState(model.cols.length
        ? 'All columns are hidden. Re-enable some in <b>Configure…</b>.'
        : 'The bound fields aren’t present in this worksheet’s summary data.');
      return;
    }
    if (!model.rows.length) { showNoRowsState(); return; }

    hideOverlay();
    renderView();
    refreshSelection(); // re-apply selection highlight after a data refresh
  }

  // ---- Static UI wiring (once) ------------------------------------------
  els.search.addEventListener('input', () => {
    searchTerm = els.search.value.trim().toLowerCase();
    page = 1; // search change resets to page 1
    if (model && model.bound && visibleCols().length && model.rows.length) renderView();
  });

  els.table.addEventListener('click', (e) => {
    const th = e.target.closest('th[data-field]');
    if (th) { cycleSort(th.getAttribute('data-field')); return; }
    const tr = e.target.closest('tbody tr');
    if (tr) onRowClick(tr, e);
  });

  els.pager.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-pg]');
    if (!b || b.disabled) return;
    const n = parseInt(b.getAttribute('data-pg'), 10);
    if (!isNaN(n)) { page = n; renderView(); }
  });

  els.collapseBtn.addEventListener('click', () => {
    els.body.classList.toggle('toolbar-collapsed');
    els.collapseBtn.textContent = els.body.classList.contains('toolbar-collapsed') ? '⌃' : '⌄';
  });

  els.viewBtn.addEventListener('click', (e) => { e.stopPropagation(); els.viewMenu.classList.toggle('open'); });
  // Keep the menu open while picking options (option clicks rebuild the panel,
  // which would otherwise detach the target and trip the close-on-outside check).
  els.viewPanel.addEventListener('click', (e) => e.stopPropagation());
  document.addEventListener('click', (e) => { if (!els.viewMenu.contains(e.target)) els.viewMenu.classList.remove('open'); });

  els.exportBtn.addEventListener('click', () => { if (model && model.cols.length) openExport(); });
  els.exportGo.addEventListener('click', doExport);
  els.exportModal.addEventListener('click', (e) => {
    if (e.target.getAttribute('data-close')) els.exportModal.classList.remove('show');
    const preset = e.target.getAttribute('data-preset');
    if (preset) {
      model.cols.forEach((c) => { exportChecked[c.field] = preset === 'all' ? true : preset === 'none' ? false : c.visible; });
      renderExportList();
    }
  });

  // ---- Configure dialog --------------------------------------------------
  function configure() {
    const payload = JSON.stringify({
      columns: (model ? model.cols : []).map((c) => ({ field: c.field, dataType: c.dataType, autoType: autoType(c.dataType) })),
    });
    const url = new URL('./pretty-table-config.html', window.location.href).href;
    tableau.extensions.ui
      .displayDialogAsync(url, payload, { width: 480, height: 620, dialogStyle: 'modal' })
      .catch((err) => { if (!(err && err.errorCode === tableau.ErrorCodes.DialogClosedByUser)) console.error('Configure dialog:', err); });
  }

  // ---- Lifecycle ---------------------------------------------------------
  VizCore.start({
    render: render,
    configure: configure,
    onSelection: refreshSelection, // reflect selection driven from this or other sheets
    onError: (err) => showSimpleState('Error: ' + VizCore.escapeHtml(err && err.message ? err.message : String(err))),
  });
})();
