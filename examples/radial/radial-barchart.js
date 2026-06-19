'use strict';

/*
 * Radial Bar Chart — viz extension renderer.
 *
 * Flow:
 *   1. initializeAsync({configure}) wires the "Configure…" dialog.
 *   2. We read which fields the user dropped on the Category / Value encodings
 *      (getVisualSpecificationAsync) and pull the matching columns out of the
 *      worksheet summary data (getSummaryDataReaderAsync).
 *   3. We draw the chart as hand-rolled SVG (no chart library → works offline,
 *      no CDN / CSP concerns).
 *   4. Re-render on SummaryDataChanged (data/encoding changes) and
 *      SettingsChanged (the config dialog saved new options) and on resize.
 */
(function () {
  const SVGNS = 'http://www.w3.org/2000/svg';
  const chartEl = document.getElementById('chart');
  const emptyEl = document.getElementById('empty');
  const tip = VizCore.makeTooltip(document.getElementById('tip'));

  // Lifecycle, event wiring and the safe render loop all live in VizCore.
  VizCore.start({
    configure: configure,
    observe: chartEl,
    render: render,
    onError: (err) => showEmpty('Error: ' + (err && err.message ? err.message : String(err))),
  });

  // ---- Configure dialog --------------------------------------------------
  function configure() {
    const url = new URL('./config.html', window.location.href).href;
    tableau.extensions.ui
      .displayDialogAsync(url, '', { width: 460, height: 720, dialogStyle: 'modal' })
      .catch(function (error) {
        // Dismissing the dialog is expected; live changes already applied via SettingsChanged.
        if (error && error.errorCode === tableau.ErrorCodes.DialogClosedByUser) return;
        console.error('Configure dialog error:', error);
      });
  }

  // ---- Render ------------------------------------------------------------
  async function render(worksheet) {
    const cfg = rbcReadConfig();
    const enc = await VizCore.readEncodings(worksheet);
    const { columns, rows } = await VizCore.readData(worksheet);
    if (!columns.length || !rows.length) { showEmpty(); return; }

    // Map encodings → column indexes, with sensible fallbacks.
    let catIdx = VizCore.colIndex(columns, enc.category);
    let valIdx = VizCore.colIndex(columns, enc.value);
    const colorIdx = VizCore.colIndex(columns, enc.color);
    if (catIdx < 0) catIdx = columns.findIndex((c) => !VizCore.isNumericCol(c));
    if (valIdx < 0) valIdx = columns.findIndex(VizCore.isNumericCol);
    if (catIdx < 0 || valIdx < 0) { showEmpty(); return; }

    const ctx = {
      worksheet,
      catField: columns[catIdx].fieldName,
      valField: columns[valIdx].fieldName,
      colorField: colorIdx >= 0 ? columns[colorIdx].fieldName : '',
    };

    // Aggregate (sum) value per category so extra dimensions don't split bars.
    const map = new Map();
    for (const row of rows) {
      const cv = row[catIdx];
      const vv = row[valIdx];
      const label = cv ? VizCore.fmt(cv) : '∅';
      const num = vv ? Number(vv.value) : 0;
      const safe = isNaN(num) ? 0 : num;
      let rec = map.get(label);
      if (!rec) {
        rec = { label, key: cv ? VizCore.raw(cv) : null, value: 0, n: 0, valFmt: vv ? VizCore.fmt(vv) : '', colorRaw: null, colorFmt: '' };
        if (colorIdx >= 0) { const cc = row[colorIdx]; rec.colorRaw = cc ? VizCore.raw(cc) : null; rec.colorFmt = cc ? VizCore.fmt(cc) : ''; }
        map.set(label, rec);
      }
      rec.value += safe; rec.n += 1;
    }
    let data = Array.from(map.values());

    if (cfg.sort === 'desc') data.sort((a, b) => b.value - a.value);
    else if (cfg.sort === 'asc') data.sort((a, b) => a.value - b.value);
    else if (cfg.sort === 'label') data.sort((a, b) => a.label.localeCompare(b.label));

    if (cfg.maxBars && cfg.maxBars > 0 && data.length > cfg.maxBars) data = data.slice(0, cfg.maxBars);

    // Color encoding: a field on the Color shelf overrides palette/gradient.
    if (colorIdx >= 0 && data.length) {
      if (VizCore.isNumericCol(columns[colorIdx])) {
        const cvals = data.map((d) => Number(d.colorRaw)).filter((v) => !isNaN(v));
        const lo = Math.min(...cvals), hi = Math.max(...cvals);
        const sp = (hi - lo) || 1;
        data.forEach((d) => { d.fill = lerpColor(cfg.color1, cfg.color2, (Number(d.colorRaw) - lo) / sp); });
      } else {
        const pal = RBC_PALETTES[cfg.palette] || RBC_PALETTES.bright;
        const idxMap = new Map();
        data.forEach((d) => { const k = String(d.colorFmt); if (!idxMap.has(k)) idxMap.set(k, idxMap.size); });
        data.forEach((d) => { d.fill = pal[idxMap.get(String(d.colorFmt)) % pal.length]; });
      }
    }

    draw(data, cfg, ctx);
    renderLegend(computeLegend(cfg, ctx, columns, colorIdx, data), cfg);
  }

  // ---- Color legend ------------------------------------------------------
  // Build a legend spec that mirrors the exact color decision made above:
  // a field on Color wins (measure → gradient, dimension → swatches); with no
  // field, reflect the configured color mode. Returns null when nothing to show.
  function computeLegend(cfg, ctx, columns, colorIdx, data) {
    if (!cfg.showLegend || !data.length) return null;

    if (colorIdx >= 0) {
      if (VizCore.isNumericCol(columns[colorIdx])) {
        // Measure on Color → gradient between color1 (low) and color2 (high).
        let loD = null, hiD = null;
        for (const d of data) {
          const v = Number(d.colorRaw);
          if (isNaN(v)) continue;
          if (loD === null || v < Number(loD.colorRaw)) loD = d;
          if (hiD === null || v > Number(hiD.colorRaw)) hiD = d;
        }
        if (!loD || !hiD) return null;
        return {
          type: 'gradient', title: ctx.colorField, c1: cfg.color1, c2: cfg.color2,
          loLabel: loD.colorFmt || String(loD.colorRaw),
          hiLabel: hiD.colorFmt || String(hiD.colorRaw),
        };
      }
      // Dimension on Color → one swatch per distinct value (color set in render()).
      const items = []; const seen = new Set();
      for (const d of data) {
        const k = String(d.colorFmt);
        if (!seen.has(k)) { seen.add(k); items.push({ label: d.colorFmt || '∅', color: d.fill }); }
      }
      return { type: 'categorical', title: ctx.colorField, items };
    }

    // No field on Color → reflect the configured color mode.
    if (cfg.colorMode === 'single') return null;
    if (cfg.colorMode === 'sequential') {
      const vals = data.map((d) => d.value);
      return {
        type: 'gradient', title: ctx.valField, c1: cfg.color1, c2: cfg.color2,
        loLabel: formatNum(Math.min(...vals), cfg.valueDecimals),
        hiLabel: formatNum(Math.max(...vals), cfg.valueDecimals),
      };
    }
    const pal = RBC_PALETTES[cfg.palette] || RBC_PALETTES.bright;
    return { type: 'categorical', title: ctx.catField, items: data.map((d, i) => ({ label: d.label, color: pal[i % pal.length] })) };
  }

  // Render the legend as an absolutely-positioned overlay in the bottom-right
  // corner (kept out of the SVG so it doesn't disturb the chart's radius math).
  function renderLegend(spec, cfg) {
    if (!spec) return;
    const box = document.createElement('div');
    Object.assign(box.style, {
      position: 'absolute', right: '12px', bottom: '12px', maxWidth: '44%', zIndex: '5',
      font: (cfg.fontSize - 1) + "px 'Benton Sans','Segoe UI',system-ui,sans-serif",
      color: cfg.labelColor, lineHeight: '1.3', pointerEvents: 'none', textAlign: 'left',
    });

    if (spec.title) {
      const t = document.createElement('div');
      t.textContent = truncate(String(spec.title), 26);
      Object.assign(t.style, { fontWeight: '600', marginBottom: '5px' });
      box.appendChild(t);
    }

    if (spec.type === 'gradient') {
      const wrap = document.createElement('div');
      Object.assign(wrap.style, { display: 'flex', alignItems: 'stretch', gap: '7px', height: '92px' });
      const bar = document.createElement('div');
      Object.assign(bar.style, {
        width: '13px', borderRadius: '3px',
        background: 'linear-gradient(to top, ' + spec.c1 + ', ' + spec.c2 + ')',
        boxShadow: 'inset 0 0 0 1px rgba(0,0,0,.14)',
      });
      const labels = document.createElement('div');
      Object.assign(labels.style, { display: 'flex', flexDirection: 'column', justifyContent: 'space-between', fontVariantNumeric: 'tabular-nums' });
      const hi = document.createElement('span'); hi.textContent = spec.hiLabel;
      const lo = document.createElement('span'); lo.textContent = spec.loLabel;
      labels.appendChild(hi); labels.appendChild(lo);
      wrap.appendChild(bar); wrap.appendChild(labels);
      box.appendChild(wrap);
    } else {
      const MAX = 12;
      for (const it of spec.items.slice(0, MAX)) {
        const row = document.createElement('div');
        Object.assign(row.style, { display: 'flex', alignItems: 'center', gap: '6px', marginTop: '2px' });
        const sw = document.createElement('span');
        Object.assign(sw.style, {
          width: '11px', height: '11px', borderRadius: '3px', flex: '0 0 auto',
          background: it.color || '#ccc', boxShadow: 'inset 0 0 0 1px rgba(0,0,0,.14)',
        });
        const lb = document.createElement('span');
        lb.textContent = truncate(String(it.label), 22);
        Object.assign(lb.style, { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' });
        row.appendChild(sw); row.appendChild(lb);
        box.appendChild(row);
      }
      if (spec.items.length > MAX) {
        const more = document.createElement('div');
        more.textContent = '+' + (spec.items.length - MAX) + ' more';
        Object.assign(more.style, { marginTop: '3px', opacity: '0.6' });
        box.appendChild(more);
      }
    }

    chartEl.style.position = 'relative';
    chartEl.appendChild(box);
  }

  // Use Tableau's formatted value for single-row categories; sum otherwise.
  function valDisplay(d, cfg) { return (d.n === 1 && d.valFmt) ? d.valFmt : formatNum(d.value, cfg.valueDecimals); }

  // Wire tooltip (all encoding fields, formatted) + click selection on a mark.
  function wireMark(node, d, cfg, ctx) {
    node.style.cursor = 'pointer';
    const pairs = [[ctx.catField, d.label], [ctx.valField, valDisplay(d, cfg)]];
    if (ctx.colorField) pairs.push([ctx.colorField, d.colorFmt]);
    node.addEventListener('mousemove', (e) => tip.show(e, pairs));
    node.addEventListener('mouseleave', () => tip.hide());
    node.addEventListener('click', (e) => {
      tip.hide();
      VizCore.selectByValues(ctx.worksheet, ctx.catField, [d.key], e.ctrlKey || e.metaKey || e.shiftKey);
    });
  }

  function showEmpty(msg) {
    chartEl.innerHTML = '';
    emptyEl.style.display = 'flex';
    if (msg) emptyEl.innerHTML = msg;
  }

  // ---- Geometry helpers --------------------------------------------------
  // Angle 0 = top (12 o'clock), increasing clockwise.
  function polar(cx, cy, r, angleDeg) {
    const a = (angleDeg - 90) * Math.PI / 180;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  }

  // Annular sector (a slice of a donut) from a0→a1, rInner→rOuter, with
  // optional rounded outer corners (cornerRadius in px).
  function sectorPath(cx, cy, rInner, rOuter, a0, a1, corner) {
    const sweep = a1 - a0;
    const largeOuter = sweep > 180 ? 1 : 0;
    const [o0x, o0y] = polar(cx, cy, rOuter, a0);
    const [o1x, o1y] = polar(cx, cy, rOuter, a1);
    const [i1x, i1y] = polar(cx, cy, rInner, a1);
    const [i0x, i0y] = polar(cx, cy, rInner, a0);

    // Corner rounding: shrink the outer arc slightly and add small arcs at the
    // two outer corners. Skip when there isn't room.
    const bandWidth = rOuter - rInner;
    const c = Math.max(0, Math.min(corner || 0, bandWidth / 2));
    if (c > 0.5) {
      // angular offset (deg) that corresponds to ~c px along the outer arc
      const dA = (c / (rOuter * Math.PI / 180));
      if (sweep > 2 * dA + 0.2) {
        const [oa0x, oa0y] = polar(cx, cy, rOuter, a0 + dA);
        const [oa1x, oa1y] = polar(cx, cy, rOuter, a1 - dA);
        const [s0x, s0y] = polar(cx, cy, rOuter - c, a0);
        const [s1x, s1y] = polar(cx, cy, rOuter - c, a1);
        return [
          `M ${i0x} ${i0y}`,
          `L ${s0x} ${s0y}`,
          `A ${c} ${c} 0 0 1 ${oa0x} ${oa0y}`,
          `A ${rOuter} ${rOuter} 0 ${largeOuter} 1 ${oa1x} ${oa1y}`,
          `A ${c} ${c} 0 0 1 ${s1x} ${s1y}`,
          `L ${i1x} ${i1y}`,
          `A ${rInner} ${rInner} 0 ${largeOuter} 0 ${i0x} ${i0y}`,
          'Z',
        ].join(' ');
      }
    }
    return [
      `M ${o0x} ${o0y}`,
      `A ${rOuter} ${rOuter} 0 ${largeOuter} 1 ${o1x} ${o1y}`,
      `L ${i1x} ${i1y}`,
      `A ${rInner} ${rInner} 0 ${largeOuter} 0 ${i0x} ${i0y}`,
      'Z',
    ].join(' ');
  }

  function hexToRgb(h) {
    h = h.replace('#', '');
    if (h.length === 3) h = h.split('').map((x) => x + x).join('');
    const n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function lerpColor(c1, c2, t) {
    const a = hexToRgb(c1), b = hexToRgb(c2);
    const r = Math.round(a[0] + (b[0] - a[0]) * t);
    const g = Math.round(a[1] + (b[1] - a[1]) * t);
    const bl = Math.round(a[2] + (b[2] - a[2]) * t);
    return `rgb(${r},${g},${bl})`;
  }

  function el(name, attrs) {
    const node = document.createElementNS(SVGNS, name);
    for (const k in attrs) node.setAttribute(k, attrs[k]);
    return node;
  }

  // ---- Draw --------------------------------------------------------------
  function draw(data, cfg, ctx) {
    if (cfg.chartStyle === 'wedge') drawWedge(data, cfg, ctx);
    else drawConcentric(data, cfg, ctx);
  }

  // Shared canvas setup: SVG element, center, radii, background, title.
  function setupCanvas(cfg) {
    emptyEl.style.display = 'none';
    chartEl.innerHTML = '';
    const W = chartEl.clientWidth || 600;
    const H = chartEl.clientHeight || 600;
    const titleH = cfg.title ? cfg.fontSize + 16 : 0;
    const cx = W / 2;
    const cy = titleH + (H - titleH) / 2;
    const margin = (cfg.showCategoryLabels || cfg.showValueLabels) ? 56 : 14;
    const maxR = Math.max(20, Math.min(W, H - titleH) / 2 - margin);
    const svg = el('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}` });
    svg.style.background = cfg.background;
    if (cfg.title) {
      const t = el('text', {
        x: cx, y: cfg.fontSize + 6, 'text-anchor': 'middle',
        'font-size': cfg.fontSize + 4, 'font-weight': 600, fill: cfg.labelColor,
      });
      t.textContent = cfg.title;
      svg.appendChild(t);
    }
    return {
      svg, W, H, cx, cy,
      rInner: maxR * (cfg.innerRadiusPct / 100),
      rOuterMax: maxR * (cfg.outerRadiusPct / 100),
    };
  }

  // A stroke-style circular arc path (used for concentric bars & their tracks).
  function arcStroke(cx, cy, r, a0, a1) {
    let sweep = a1 - a0;
    if (sweep >= 359.999) sweep = 359.999;
    if (sweep <= 0) sweep = 0.0001;
    const [x0, y0] = polar(cx, cy, r, a0);
    const [x1, y1] = polar(cx, cy, r, a0 + sweep);
    const largeArc = sweep > 180 ? 1 : 0;
    return `M ${x0} ${y0} A ${r} ${r} 0 ${largeArc} 1 ${x1} ${y1}`;
  }

  // Concentric style — one rounded-cap arc per category at its own radius,
  // sweeping from the start angle by an amount proportional to its value,
  // over faint full-circle tracks. (Matches the requested style.)
  function drawConcentric(data, cfg, ctx) {
    const { svg, cx, cy, rInner, rOuterMax } = setupCanvas(cfg);
    const n = data.length;
    const values = data.map((d) => d.value);
    const maxV = Math.max(0, ...values, 1e-9);
    const range = cfg.endAngle - cfg.startAngle;
    const fullCircle = Math.abs(range) >= 359.999;
    const ringStep = (rOuterMax - rInner) / Math.max(1, n);
    const thickness = Math.max(1, ringStep * (1 - cfg.barPadPct / 100));
    const cap = cfg.cornerRadius > 0 ? 'round' : 'butt';
    const palette = RBC_PALETTES[cfg.palette] || RBC_PALETTES.bright;
    const labelSize = Math.min(cfg.fontSize, thickness + 2);

    data.forEach((d, i) => {
      const r = rOuterMax - ringStep * (i + 0.5); // i = 0 is the outermost ring
      if (r <= 0) return;

      // Faint background track
      if (cfg.showRings) {
        const track = fullCircle
          ? el('circle', { cx, cy, r, fill: 'none', stroke: cfg.ringColor, 'stroke-width': thickness })
          : el('path', { d: arcStroke(cx, cy, r, cfg.startAngle, cfg.endAngle), fill: 'none', stroke: cfg.ringColor, 'stroke-width': thickness, 'stroke-linecap': cap });
        svg.appendChild(track);
      }

      // Colored bar — a field on the Color shelf (d.fill) wins over settings.
      let stroke = d.fill;
      if (!stroke) {
        if (cfg.colorMode === 'single') stroke = cfg.color1;
        else if (cfg.colorMode === 'sequential') stroke = lerpColor(cfg.color1, cfg.color2, maxV ? d.value / maxV : 0);
        else stroke = palette[i % palette.length];
      }

      const frac = maxV > 0 ? Math.max(0, d.value) / maxV : 0;
      const a1 = cfg.startAngle + range * frac;
      const bar = el('path', {
        d: arcStroke(cx, cy, r, cfg.startAngle, a1),
        fill: 'none', stroke, 'stroke-width': thickness,
        'stroke-linecap': cap, 'stroke-opacity': cfg.barOpacity, class: 'rbc-bar',
      });
      const valTxt = valDisplay(d, cfg);
      wireMark(bar, d, cfg, ctx);
      svg.appendChild(bar);

      if (cfg.showCategoryLabels) {
        const [lx, ly] = polar(cx, cy, r, cfg.startAngle);
        const ct = el('text', {
          x: lx - 8, y: ly, 'text-anchor': 'end', 'dominant-baseline': 'middle',
          'font-size': labelSize, fill: cfg.labelColor,
        });
        ct.textContent = truncate(d.label, 18);
        svg.appendChild(ct);
      }
      if (cfg.showValueLabels) {
        const [vx, vy] = polar(cx, cy, r, a1);
        const vt = el('text', {
          x: vx, y: vy, 'text-anchor': 'middle', 'dominant-baseline': 'middle',
          'font-size': labelSize, fill: cfg.labelColor, 'font-weight': 600,
        });
        vt.setAttribute('dx', '0'); vt.setAttribute('dy', '0');
        vt.textContent = valTxt;
        svg.appendChild(vt);
      }
    });

    chartEl.appendChild(svg);
  }

  // Wedge style — filled annular sectors fanned across the angular range.
  function drawWedge(data, cfg, ctx) {
    emptyEl.style.display = 'none';
    chartEl.innerHTML = '';

    const W = chartEl.clientWidth || 600;
    const H = chartEl.clientHeight || 600;
    const titleH = cfg.title ? cfg.fontSize + 16 : 0;
    const cx = W / 2;
    const cy = titleH + (H - titleH) / 2;

    const margin = (cfg.showCategoryLabels ? 64 : 14);
    const maxR = Math.max(20, Math.min(W, H - titleH) / 2 - margin);
    const rInner = maxR * (cfg.innerRadiusPct / 100);
    const rOuterMax = maxR * (cfg.outerRadiusPct / 100);

    const svg = el('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}` });
    svg.style.background = cfg.background;

    // Title
    if (cfg.title) {
      const t = el('text', {
        x: cx, y: cfg.fontSize + 6, 'text-anchor': 'middle',
        'font-size': cfg.fontSize + 4, 'font-weight': 600, fill: cfg.labelColor,
      });
      t.textContent = cfg.title;
      svg.appendChild(t);
    }

    // Value scale
    const values = data.map((d) => d.value);
    const minV = Math.min(0, ...values);
    const maxV = Math.max(0, ...values, 1e-9);
    const span = (maxV - minV) || 1;
    const rOf = (v) => rInner + ((v - minV) / span) * (rOuterMax - rInner);

    // Reference rings
    if (cfg.showRings && cfg.ringCount > 0) {
      for (let i = 1; i <= cfg.ringCount; i++) {
        const rr = rInner + (rOuterMax - rInner) * (i / cfg.ringCount);
        svg.appendChild(el('circle', {
          cx, cy, r: rr, fill: 'none', stroke: cfg.ringColor, 'stroke-width': 1,
        }));
      }
    }

    const palette = RBC_PALETTES[cfg.palette] || RBC_PALETTES.tableau10;
    const n = data.length;
    const totalSweep = cfg.endAngle - cfg.startAngle;
    const slot = totalSweep / n;
    const pad = slot * (cfg.barPadPct / 100);

    data.forEach((d, i) => {
      const a0 = cfg.startAngle + i * slot + pad / 2;
      const a1 = cfg.startAngle + (i + 1) * slot - pad / 2;
      const aMid = (a0 + a1) / 2;
      const rOuter = Math.max(rInner + 0.5, rOf(d.value));

      // A field on the Color shelf (d.fill) wins over the color settings.
      let fill = d.fill;
      if (!fill) {
        if (cfg.colorMode === 'single') fill = cfg.color1;
        else if (cfg.colorMode === 'categorical') fill = palette[i % palette.length];
        else fill = lerpColor(cfg.color1, cfg.color2, span ? (d.value - minV) / span : 0);
      }

      const path = el('path', {
        d: sectorPath(cx, cy, rInner, rOuter, a0, a1, cfg.cornerRadius),
        fill, 'fill-opacity': cfg.barOpacity, class: 'rbc-bar',
      });
      if (cfg.strokeWidth > 0) {
        path.setAttribute('stroke', cfg.strokeColor);
        path.setAttribute('stroke-width', cfg.strokeWidth);
      }
      const valTxt = valDisplay(d, cfg);
      wireMark(path, d, cfg, ctx);
      svg.appendChild(path);

      // Value labels at the bar end
      if (cfg.showValueLabels) {
        const [lx, ly] = polar(cx, cy, rOuter + cfg.fontSize * 0.7, aMid);
        const vt = el('text', {
          x: lx, y: ly, 'text-anchor': 'middle', 'dominant-baseline': 'middle',
          'font-size': cfg.fontSize - 1, fill: cfg.labelColor,
        });
        vt.textContent = valTxt;
        svg.appendChild(vt);
      }

      // Category labels around the outer edge, rotated for readability
      if (cfg.showCategoryLabels) {
        const lr = rOuterMax + (cfg.showValueLabels ? cfg.fontSize * 1.9 : cfg.fontSize * 0.9);
        const [lx, ly] = polar(cx, cy, lr, aMid);
        const flip = aMid > 180 && aMid < 360;
        const rot = flip ? aMid + 90 : aMid - 90;
        const ct = el('text', {
          x: lx, y: ly, 'text-anchor': flip ? 'end' : 'start',
          'dominant-baseline': 'middle', 'font-size': cfg.fontSize, fill: cfg.labelColor,
          transform: `rotate(${rot} ${lx} ${ly})`,
        });
        ct.textContent = truncate(d.label, 22);
        svg.appendChild(ct);
      }
    });

    chartEl.appendChild(svg);
  }

  function formatNum(v, decimals) {
    if (Math.abs(v) >= 1e6) return (v / 1e6).toFixed(1) + 'M';
    if (Math.abs(v) >= 1e3) return (v / 1e3).toFixed(1) + 'K';
    return Number(v).toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  }
  function truncate(s, n) { return s.length > n ? s.slice(0, n - 1) + '…' : s; }
})();
