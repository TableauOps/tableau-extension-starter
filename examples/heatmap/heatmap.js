'use strict';

/*
 * Calendar Heatmap — viz extension renderer.
 *
 *   1. VizCore wires init, the SummaryDataChanged/SettingsChanged/resize loop,
 *      encoding + summary-data reading, mark selection.
 *   2. We bucket each timestamp into a (row, column) grid from the independent
 *      column/row date aggregations (Year … down to Minute), colour each cell
 *      from the active 8-step palette ramp, draw marginal sum bars (column
 *      totals top or bottom; row totals left or right), and a gradient legend.
 *   3. The grid is HTML/CSS so tile/bar sizes are driven by CSS variables —
 *      drawer sliders resize it live, no rebuild.
 *
 * Settings live in the in-viz gear → drawer and persist via
 * tableau.extensions.settings (see heatmap-config.js).
 */
(function () {
  const chartEl = document.getElementById('chart');
  const emptyEl = document.getElementById('empty');
  const tipEl = document.getElementById('tip');
  const gearEl = document.getElementById('gear');
  const backdropEl = document.getElementById('backdrop');
  const drawerEl = document.getElementById('drawer');
  const drawerBody = document.getElementById('drawerBody');
  const drawerClose = document.getElementById('drawerClose');
  const root = document.documentElement;

  const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const DAY_MS = 86400000;
  const GAP = 2, ROWLABEL_W = 40, COLLABEL_H = 16, LEGEND_W = 46, PAD = 24;

  let worksheet = null;
  let model = null;     // { dateField, valField, byDay, dayMeta, partCounts, origin }
  let lastGrid = null;  // { numCols, numRows } — for live fit recompute

  // ---- date helpers ------------------------------------------------------
  // Day number (days since epoch) of a Date, read in LOCAL Y/M/D so every
  // source lands on the same calendar day regardless of timezone.
  function localDayNum(d) { return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY_MS); }
  function weekdayOf(dayNum) { return new Date(dayNum * DAY_MS).getUTCDay(); }     // 0=Sun..6=Sat
  function monthOfDayNum(dayNum) { return new Date(dayNum * DAY_MS).getUTCMonth(); }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function isoWeek(d) {
    const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    const dow = (t.getUTCDay() + 6) % 7;
    t.setUTCDate(t.getUTCDate() - dow + 3);
    const firstThu = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
    return 1 + Math.round((t - firstThu) / (7 * DAY_MS));
  }
  const RANGE = (n) => Array.from({ length: n }, (_v, i) => i);

  // Date aggregation levels — turn a Date into a sortable integer key + label.
  // keyOf receives the real Date (time preserved), so Hour/Minute work too.
  const DATE_PARTS = {
    year:       { label: 'Year',         kind: 'dense', keyOf: (d) => d.getFullYear(), fmt: (k) => String(k) },
    quarter:    { label: 'Quarter',      kind: 'fixed', domain: [0, 1, 2, 3], keyOf: (d) => Math.floor(d.getMonth() / 3), fmt: (k) => 'Q' + (k + 1) },
    month:      { label: 'Month',        kind: 'fixed', domain: RANGE(12), keyOf: (d) => d.getMonth(), fmt: (k) => MONTHS[k] },
    week:       { label: 'Week',         kind: 'dense', keyOf: (d, ctx) => Math.floor((localDayNum(d) - ctx.originDay) / 7), fmt: (k, ctx) => MONTHS[monthOfDayNum(ctx.originDay + k * 7)] },
    weekOfYear: { label: 'Week of year', kind: 'dense', keyOf: (d) => isoWeek(d), fmt: (k) => 'W' + k },
    dayOfMonth: { label: 'Day of month', kind: 'dense', keyOf: (d) => d.getDate(), fmt: (k) => String(k) },
    weekday:    { label: 'Weekday',      kind: 'fixed', domain: RANGE(7), keyOf: (d) => d.getDay(), fmt: (k) => WEEKDAYS[k] },
    hour:       { label: 'Hour',         kind: 'fixed', domain: RANGE(24), keyOf: (d) => d.getHours(), fmt: (k) => pad2(k) + ':00' },
    minute:     { label: 'Minute',       kind: 'fixed', domain: RANGE(60), keyOf: (d) => d.getMinutes(), fmt: (k) => ':' + pad2(k) },
  };
  function axisKeys(part, presentSet) {
    if (part.kind === 'fixed') return part.domain.slice();
    const arr = Array.from(presentSet).sort((a, b) => a - b);
    if (part.kind === 'dense' && arr.length) {
      const out = [];
      for (let k = arr[0]; k <= arr[arr.length - 1]; k++) out.push(k);
      return out;
    }
    return arr;
  }

  // Robust date coercion: native Date, ms timestamp, bare year, ISO/formatted string.
  function coerceDate(v) {
    if (v == null) return null;
    if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
    if (typeof v === 'number') {
      if (v >= 1000 && v <= 9999) return new Date(v, 0, 1);
      const d = new Date(v); return isNaN(d.getTime()) ? null : d;
    }
    if (typeof v === 'string') {
      const s = v.trim(); if (!s) return null;
      if (/^\d{4}$/.test(s)) return new Date(+s, 0, 1);
      const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (iso) return new Date(+iso[1], +iso[2] - 1, +iso[3]);
      const d = new Date(s); if (!isNaN(d.getTime())) return d;
      const m = s.match(/(\d{4})/); if (m) return new Date(+m[1], 0, 1);
    }
    return null;
  }
  // ---- colour helpers ----------------------------------------------------
  function hexToRgb(h) {
    h = h.replace('#', '');
    if (h.length === 3) h = h.split('').map((x) => x + x).join('');
    const n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function readableOn(hex) {
    const c = hexToRgb(hex);
    const L = (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) / 255;
    return L > 0.6 ? '#1c2330' : '#ffffff';
  }
  function formatNum(v) {
    if (Math.abs(v) >= 1e6) return (v / 1e6).toFixed(1) + 'M';
    if (Math.abs(v) >= 1e3) return (v / 1e3).toFixed(1) + 'K';
    return Number(v).toLocaleString(undefined, { maximumFractionDigits: 1 });
  }
  function formatFull(v) { return Number(v).toLocaleString(undefined, { maximumFractionDigits: 20 }); }

  // ---- edge-aware tooltip ------------------------------------------------
  function showTip(evt, pairs, title) {
    let html = '';
    if (title) html += '<div class="t-title">' + VizCore.escapeHtml(title) + '</div>';
    for (const [k, v] of pairs) html += '<div class="t-row"><span>' + VizCore.escapeHtml(k) + ':</span> ' + VizCore.escapeHtml(v) + '</div>';
    tipEl.innerHTML = html;
    tipEl.style.opacity = '1';
    const r = tipEl.getBoundingClientRect();
    const vw = window.innerWidth, m = 6;
    let tx = '-50%', ty = '-100%', top = evt.clientY - 12;
    if (evt.clientX - r.width / 2 < m) tx = '0%';
    else if (evt.clientX + r.width / 2 > vw - m) tx = '-100%';
    if (evt.clientY - r.height - 16 < m) { top = evt.clientY + 16; ty = '0%'; }
    tipEl.style.left = evt.clientX + 'px';
    tipEl.style.top = top + 'px';
    tipEl.style.transform = 'translate(' + tx + ', ' + ty + ')';
  }
  function hideTip() { tipEl.style.opacity = '0'; }
  function bindTip(node, pairs, title) {
    node.addEventListener('mousemove', (e) => showTip(e, pairs, title));
    node.addEventListener('mouseleave', hideTip);
  }

  // ---- render: read Tableau, build the data model ------------------------
  async function render(ws) {
    worksheet = ws;
    const enc = await VizCore.readEncodings(ws);
    const { columns, rows } = await VizCore.readData(ws);
    if (!columns.length || !rows.length) { model = null; showEmpty(); return; }

    let dateIdx = VizCore.colIndex(columns, enc.date);
    let valIdx = VizCore.colIndex(columns, enc.value);
    if (dateIdx < 0) dateIdx = columns.findIndex(VizCore.isDateCol);            // dataType fallback
    if (dateIdx < 0) dateIdx = columns.findIndex((c) => !VizCore.isNumericCol(c));
    if (valIdx < 0) valIdx = columns.findIndex(VizCore.isNumericCol);
    if (dateIdx < 0 || valIdx < 0) { model = null; showEmpty(); return; }

    // Keep each row as a timestamped point (time preserved for Hour/Minute).
    const points = [];
    let minDay = Infinity;
    for (const row of rows) {
      const cell = row[dateIdx];
      let d = coerceDate(cell && cell.nativeValue != null ? cell.nativeValue : (cell ? cell.value : null));
      if (!d && cell && cell.formattedValue) d = coerceDate(cell.formattedValue);
      if (!d) continue;
      const vv = row[valIdx];
      const num = vv ? Number(vv.value) : 0;
      points.push({ d: d, v: isNaN(num) ? 0 : num, raw: VizCore.raw(cell) });
      const dn = localDayNum(d);
      if (dn < minDay) minDay = dn;
    }
    if (!points.length) { model = null; showEmpty(); return; }

    const origin = minDay - weekdayOf(minDay); // Sunday on/before the first date

    const partCtx = { originDay: origin };
    const partCounts = {};
    Object.keys(DATE_PARTS).forEach((id) => {
      const set = new Set();
      for (const p of points) set.add(DATE_PARTS[id].keyOf(p.d, partCtx));
      partCounts[id] = set.size;
    });

    model = {
      dateField: columns[dateIdx].fieldName,
      valField: columns[valIdx].fieldName,
      points, origin, partCounts,
    };
    layout();
  }

  function showEmpty(msg) {
    chartEl.innerHTML = '';
    emptyEl.style.display = 'flex';
    if (msg) emptyEl.innerHTML = msg;
  }

  // ---- fit-to-viewport tile size -----------------------------------------
  function computeFit(numCols, numRows, cfg) {
    const rowbarW = cfg.rowBarPos !== 'off' ? cfg.barSize : 0;
    const colbarH = cfg.colBarPos !== 'off' ? cfg.barSize : 0;
    const availW = chartEl.clientWidth - PAD - ROWLABEL_W - rowbarW - LEGEND_W;
    const availH = chartEl.clientHeight - PAD - colbarH - COLLABEL_H;
    const w = Math.max(5, Math.min(48, Math.floor((availW - GAP * (numCols - 1)) / numCols)));
    const h = Math.max(5, Math.min(48, Math.floor((availH - GAP * (numRows - 1)) / numRows)));
    return { w: w, h: h };
  }

  // ---- layout: build the CSS grid ---------------------------------------
  function layout() {
    if (!model) return;
    const cfg = hmReadConfig();
    const pal = HM_PALETTES[cfg.palette] || HM_PALETTES.coolwarm;
    const rowsPart = DATE_PARTS[cfg.rows] || DATE_PARTS.weekday;
    const colsPart = DATE_PARTS[cfg.cols] || DATE_PARTS.week;
    const partCtx = { originDay: model.origin };
    const colPos = cfg.colBarPos, rowPos = cfg.rowBarPos;
    const showCol = colPos !== 'off', showRow = rowPos !== 'off';

    root.style.setProperty('--accent', pal.accent);
    root.style.setProperty('--bar-band', cfg.barSize + 'px');

    // Bucket points into the grid.
    const cellVal = new Map(), cellDates = new Map();
    const colTotals = new Map(), rowTotals = new Map();
    const presentRows = new Set(), presentCols = new Set();
    model.points.forEach((p) => {
      const rk = rowsPart.keyOf(p.d, partCtx), ck = colsPart.keyOf(p.d, partCtx);
      presentRows.add(rk); presentCols.add(ck);
      const key = rk + '|' + ck;
      cellVal.set(key, (cellVal.get(key) || 0) + p.v);
      if (!cellDates.has(key)) cellDates.set(key, []);
      cellDates.get(key).push(p.raw);
      colTotals.set(ck, (colTotals.get(ck) || 0) + p.v);
      rowTotals.set(rk, (rowTotals.get(rk) || 0) + p.v);
    });
    let minVal = Infinity, maxVal = -Infinity;
    cellVal.forEach((v) => { if (v < minVal) minVal = v; if (v > maxVal) maxVal = v; });
    const span = (maxVal - minVal) || 1;

    const rowKeys = axisKeys(rowsPart, presentRows);
    const colKeys = axisKeys(colsPart, presentCols);
    const numRows = rowKeys.length || 1, numCols = colKeys.length || 1;
    lastGrid = { numCols, numRows };

    let maxCol = 1e-9, maxRow = 1e-9;
    colTotals.forEach((t) => { maxCol = Math.max(maxCol, Math.abs(t)); });
    rowTotals.forEach((t) => { maxRow = Math.max(maxRow, Math.abs(t)); });

    const fit = computeFit(numCols, numRows, cfg);
    const tileW = cfg.tileW > 0 ? cfg.tileW : fit.w;
    const tileH = cfg.tileH > 0 ? cfg.tileH : fit.h;
    root.style.setProperty('--tile-w', tileW + 'px');
    root.style.setProperty('--tile-h', tileH + 'px');

    const showLabel = cfg.cellLabel === 'on' || (cfg.cellLabel === 'auto' && tileW >= 26 && tileH >= 18);
    const colorOf = (v) => pal.ramp[Math.max(0, Math.min(7, Math.floor(((v - minVal) / span) * 8)))];
    const colLabelIdx = pickLabels(colKeys, colsPart, partCtx, tileW + GAP, true);
    const rowLabelIdx = pickLabels(rowKeys, rowsPart, partCtx, tileH + GAP, false);

    // Track layout — bar bands go before/after the data tracks per position.
    let ti = 0, idxRowbar = -1, idxRowlabel, idxDataC;
    if (rowPos === 'left') idxRowbar = ti++;
    idxRowlabel = ti++;
    idxDataC = ti; ti += numCols;
    if (rowPos === 'right') idxRowbar = ti++;
    const colSizes = [];
    for (let k = 0; k < ti; k++) colSizes.push('var(--tile-w)');
    colSizes[idxRowlabel] = 'var(--rowlabel-w)';
    if (idxRowbar >= 0) colSizes[idxRowbar] = 'var(--bar-band)';

    let tj = 0, idxColbar = -1, idxCollabel, idxDataR;
    if (colPos === 'top') idxColbar = tj++;
    idxCollabel = tj++;
    idxDataR = tj; tj += numRows;
    if (colPos === 'bottom') idxColbar = tj++;
    const rowSizes = [];
    for (let k = 0; k < tj; k++) rowSizes.push('var(--tile-h)');
    rowSizes[idxCollabel] = 'var(--collabel-h)';
    if (idxColbar >= 0) rowSizes[idxColbar] = 'var(--bar-band)';

    const gcData = (ci) => idxDataC + ci + 1; // 1-based grid lines
    const grData = (ri) => idxDataR + ri + 1;

    const grid = document.createElement('div');
    grid.className = 'hm-grid';
    grid.style.gridTemplateColumns = colSizes.join(' ');
    grid.style.gridTemplateRows = rowSizes.join(' ');

    // Column sum bars (top or bottom).
    if (showCol) {
      for (let ci = 0; ci < numCols; ci++) {
        const total = colTotals.get(colKeys[ci]) || 0;
        const wrap = document.createElement('div');
        wrap.className = 'hm-topcell';
        wrap.style.gridColumn = gcData(ci); wrap.style.gridRow = idxColbar + 1;
        wrap.style.alignItems = colPos === 'top' ? 'flex-end' : 'flex-start';
        const bar = document.createElement('div');
        bar.className = 'hm-topbar';
        bar.style.height = (Math.abs(total) / maxCol * 100) + '%';
        bar.style.borderRadius = colPos === 'top' ? '2px 2px 0 0' : '0 0 2px 2px';
        wrap.appendChild(bar);
        bindTip(wrap, [[colsPart.label, colsPart.fmt(colKeys[ci], partCtx)], [model.valField + ' total', formatFull(total)]]);
        grid.appendChild(wrap);
      }
    }

    // Column labels.
    for (let ci = 0; ci < numCols; ci++) {
      if (!colLabelIdx.has(ci)) continue;
      const c = document.createElement('div');
      c.className = 'hm-collabel';
      c.style.gridColumn = gcData(ci); c.style.gridRow = idxCollabel + 1;
      c.textContent = colsPart.fmt(colKeys[ci], partCtx);
      grid.appendChild(c);
    }

    // Row labels + cells + row sum bars (left or right).
    for (let ri = 0; ri < numRows; ri++) {
      if (rowLabelIdx.has(ri)) {
        const rl = document.createElement('div');
        rl.className = 'hm-rowlabel';
        rl.style.gridColumn = idxRowlabel + 1; rl.style.gridRow = grData(ri);
        rl.textContent = rowsPart.fmt(rowKeys[ri], partCtx);
        grid.appendChild(rl);
      }
      for (let ci = 0; ci < numCols; ci++) {
        const key = rowKeys[ri] + '|' + colKeys[ci];
        const has = cellVal.has(key);
        const v = cellVal.get(key);
        const cell = document.createElement('div');
        cell.className = 'hm-cell' + (has ? ' has' : '');
        cell.style.gridColumn = gcData(ci); cell.style.gridRow = grData(ri);
        if (has) {
          const color = colorOf(v);
          cell.style.background = color;
          if (showLabel) {
            const sp = document.createElement('span');
            sp.className = 'lbl'; sp.style.color = readableOn(color); sp.textContent = formatNum(v);
            cell.appendChild(sp);
          }
          bindTip(cell, [
            [colsPart.label, colsPart.fmt(colKeys[ci], partCtx)],
            [rowsPart.label, rowsPart.fmt(rowKeys[ri], partCtx)],
            [model.valField, formatFull(v)],
          ]);
          cell.addEventListener('click', (e) => {
            hideTip();
            VizCore.selectByValues(worksheet, model.dateField, cellDates.get(key), e.ctrlKey || e.metaKey || e.shiftKey);
          });
        }
        grid.appendChild(cell);
      }
      if (showRow) {
        const total = rowTotals.get(rowKeys[ri]) || 0;
        const wrap = document.createElement('div');
        wrap.className = 'hm-sidecell';
        wrap.style.gridColumn = idxRowbar + 1; wrap.style.gridRow = grData(ri);
        wrap.style.justifyContent = rowPos === 'left' ? 'flex-end' : 'flex-start';
        const bar = document.createElement('div');
        bar.className = 'hm-sidebar';
        bar.style.width = (Math.abs(total) / maxRow * 100) + '%';
        bar.style.borderRadius = rowPos === 'left' ? '2px 0 0 2px' : '0 2px 2px 0';
        wrap.appendChild(bar);
        bindTip(wrap, [[rowsPart.label, rowsPart.fmt(rowKeys[ri], partCtx)], [model.valField + ' total', formatFull(total)]]);
        grid.appendChild(wrap);
      }
    }

    // Assemble grid + gradient legend.
    const wrap = document.createElement('div');
    wrap.className = 'hm-wrap';
    wrap.appendChild(grid);
    const gridPxH = numRows * tileH + (numRows - 1) * GAP;
    const topOffset = (showCol && colPos === 'top' ? cfg.barSize + GAP : 0) + COLLABEL_H + GAP;
    wrap.appendChild(buildLegend(pal, gridPxH, topOffset));

    emptyEl.style.display = 'none';
    chartEl.innerHTML = '';
    chartEl.appendChild(wrap);
  }

  function buildLegend(pal, h, topOffset) {
    const lg = document.createElement('div');
    lg.className = 'hm-legend';
    lg.style.marginTop = topOffset + 'px';
    const hi = document.createElement('div'); hi.textContent = 'high';
    const bar = document.createElement('div');
    bar.className = 'bar';
    bar.style.height = Math.max(40, h) + 'px';
    bar.style.background = 'linear-gradient(to top,' + pal.ramp.join(',') + ')';
    const lo = document.createElement('div'); lo.textContent = 'low';
    lg.appendChild(hi); lg.appendChild(bar); lg.appendChild(lo);
    return lg;
  }

  // Choose which axis ticks to label: skip until the text changes (collapses
  // runs like a month spanning weeks) and a minimum pixel gap is met.
  function pickLabels(keys, part, partCtx, slotPx, horizontal) {
    const out = new Set();
    const minGap = horizontal ? 26 : 14;
    let lastPos = -Infinity, lastText = null;
    for (let i = 0; i < keys.length; i++) {
      const text = part.fmt(keys[i], partCtx);
      const pos = i * slotPx;
      if (horizontal && text === lastText) continue;
      if (pos - lastPos < minGap) continue;
      out.add(i); lastPos = pos; lastText = text;
    }
    return out;
  }

  /* =========================================================================
     Settings drawer
     ========================================================================= */
  function segHtml(id, opts) {
    return '<div class="seg" id="' + id + '">' +
      opts.map(function (o) { return '<button data-v="' + o.v + '">' + o.label + '</button>'; }).join('') + '</div>';
  }
  function wireSeg(id, key) {
    drawerBody.querySelectorAll('#' + id + ' button').forEach(function (b) {
      b.addEventListener('click', function () {
        drawerBody.querySelectorAll('#' + id + ' button').forEach(function (x) { x.classList.toggle('active', x === b); });
        const patch = {}; patch[key] = b.getAttribute('data-v'); persist(patch);
      });
    });
  }
  function setSeg(id, val) {
    drawerBody.querySelectorAll('#' + id + ' button').forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-v') === val); });
  }

  function buildDrawer() {
    const palSwatches = HM_PALETTE_ORDER.map(function (id) {
      const p = HM_PALETTES[id];
      return '<div class="hm-sw" data-pal="' + id + '"><span class="nm">' + p.label + '</span><span class="grad" style="background:linear-gradient(90deg,' + p.ramp.join(',') + ')"></span></div>';
    }).join('');
    const partOpts = HM_PARTS.map(function (p) { return '<option value="' + p.id + '">' + p.label + '</option>'; }).join('');

    drawerBody.innerHTML =
      '<div class="hm-field"><label>Palette</label><div class="hm-pal" id="palList">' + palSwatches + '</div></div>' +
      '<div class="hm-field"><label>Columns date</label><select id="colsSel">' + partOpts + '</select></div>' +
      '<div class="hm-field"><label>Rows date</label><select id="rowsSel">' + partOpts + '</select></div>' +
      '<div class="hm-field"><label>Sum bars</label>' +
        '<div class="hm-row"><span>Columns</span>' + segHtml('colBarPos', [{ v: 'off', label: 'Off' }, { v: 'top', label: 'Top' }, { v: 'bottom', label: 'Bottom' }]) + '</div>' +
        '<div class="hm-row"><span>Rows</span>' + segHtml('rowBarPos', [{ v: 'off', label: 'Off' }, { v: 'left', label: 'Left' }, { v: 'right', label: 'Right' }]) + '</div>' +
        '<div class="hm-row"><span>Bar size</span><input type="range" id="barSize" min="20" max="120" step="2"><span class="hm-num" id="barSizeV"></span></div>' +
      '</div>' +
      '<div class="hm-field"><label>Tile size</label>' +
        '<div class="hm-row"><span>Width</span><input type="range" id="tileW" min="0" max="48" step="1"><span class="hm-num" id="tileWV"></span></div>' +
        '<div class="hm-row"><span>Height</span><input type="range" id="tileH" min="0" max="48" step="1"><span class="hm-num" id="tileHV"></span></div>' +
        '<div class="hm-hint">0 = fit to the viewport. Any value pins a fixed tile size and lets the grid scroll.</div>' +
      '</div>' +
      '<div class="hm-field"><label>Cell labels</label>' +
        segHtml('cellLabel', [{ v: 'auto', label: 'Auto' }, { v: 'on', label: 'On' }, { v: 'off', label: 'Off' }]) +
      '</div>';

    // Palette
    drawerBody.querySelectorAll('.hm-sw').forEach(function (sw) {
      sw.addEventListener('click', function () {
        const id = sw.getAttribute('data-pal');
        root.style.setProperty('--accent', HM_PALETTES[id].accent);
        drawerBody.querySelectorAll('.hm-sw').forEach(function (s) { s.classList.toggle('active', s === sw); });
        persist({ palette: id });
      });
    });
    // Independent column / row date aggregation
    drawerBody.querySelector('#colsSel').addEventListener('change', function (e) { persist({ cols: e.target.value }); });
    drawerBody.querySelector('#rowsSel').addEventListener('change', function (e) { persist({ rows: e.target.value }); });
    // Bars
    wireSeg('colBarPos', 'colBarPos');
    wireSeg('rowBarPos', 'rowBarPos');
    const barSize = drawerBody.querySelector('#barSize'), barSizeV = drawerBody.querySelector('#barSizeV');
    barSize.addEventListener('input', function () { root.style.setProperty('--bar-band', barSize.value + 'px'); barSizeV.textContent = barSize.value + 'px'; });
    barSize.addEventListener('change', function () { persist({ barSize: +barSize.value }); });
    // Tiles
    wireTileSlider('tileW', 'tileWV', '--tile-w', function (n) { return { tileW: n }; }, function (c, r, cfg) { return computeFit(c, r, cfg).w; });
    wireTileSlider('tileH', 'tileHV', '--tile-h', function (n) { return { tileH: n }; }, function (c, r, cfg) { return computeFit(c, r, cfg).h; });
    // Cell labels
    wireSeg('cellLabel', 'cellLabel');
  }

  function wireTileSlider(id, valId, cssVar, patchFn, fitFn) {
    const el = drawerBody.querySelector('#' + id), valEl = drawerBody.querySelector('#' + valId);
    el.addEventListener('input', function () {
      const n = +el.value;
      valEl.textContent = n ? n + 'px' : 'Fit';
      const cfg = hmReadConfig();
      const px = n ? n : (lastGrid ? fitFn(lastGrid.numCols, lastGrid.numRows, cfg) : 16);
      root.style.setProperty(cssVar, px + 'px');
    });
    el.addEventListener('change', function () { persist(patchFn(+el.value)); });
  }

  function persist(patch) { hmWriteConfig(patch).catch(function (e) { console.error('settings save failed:', e); }); }

  function syncDrawer() {
    const cfg = hmReadConfig();
    drawerBody.querySelectorAll('.hm-sw').forEach(function (s) { s.classList.toggle('active', s.getAttribute('data-pal') === cfg.palette); });

    // Date pickers — mark levels that can't split the current data as (n/a).
    ['rowsSel', 'colsSel'].forEach(function (sid) {
      const ss = drawerBody.querySelector('#' + sid);
      Array.from(ss.options).forEach(function (opt) {
        const part = HM_PARTS.find(function (p) { return p.id === opt.value; });
        const cnt = model ? model.partCounts[opt.value] : 2;
        opt.disabled = cnt <= 1;
        opt.textContent = part.label + (cnt <= 1 ? ' (n/a)' : '');
      });
    });
    drawerBody.querySelector('#rowsSel').value = cfg.rows;
    drawerBody.querySelector('#colsSel').value = cfg.cols;

    setSeg('colBarPos', cfg.colBarPos);
    setSeg('rowBarPos', cfg.rowBarPos);
    setSeg('cellLabel', cfg.cellLabel);
    const bs = drawerBody.querySelector('#barSize'); bs.value = cfg.barSize; drawerBody.querySelector('#barSizeV').textContent = cfg.barSize + 'px';
    const tw = drawerBody.querySelector('#tileW'); tw.value = cfg.tileW; drawerBody.querySelector('#tileWV').textContent = cfg.tileW ? cfg.tileW + 'px' : 'Fit';
    const th = drawerBody.querySelector('#tileH'); th.value = cfg.tileH; drawerBody.querySelector('#tileHV').textContent = cfg.tileH ? cfg.tileH + 'px' : 'Fit';
  }

  function openDrawer() { syncDrawer(); drawerEl.classList.add('open'); backdropEl.classList.add('open'); drawerEl.setAttribute('aria-hidden', 'false'); }
  function closeDrawer() { drawerEl.classList.remove('open'); backdropEl.classList.remove('open'); drawerEl.setAttribute('aria-hidden', 'true'); }

  gearEl.addEventListener('click', openDrawer);
  drawerClose.addEventListener('click', closeDrawer);
  backdropEl.addEventListener('click', closeDrawer);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && drawerEl.classList.contains('open')) closeDrawer(); });

  buildDrawer();

  // ---- lifecycle ---------------------------------------------------------
  VizCore.start({
    observe: chartEl,
    render: render,
    configure: openDrawer, // Tableau's "Configure…" menu opens the same drawer
    onError: (err) => showEmpty('Error: ' + (err && err.message ? err.message : String(err))),
  });
})();
