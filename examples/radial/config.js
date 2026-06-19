'use strict';

/*
 * Configuration dialog logic.
 *
 * Live preview: the dialog is a separate window from the viz, so the only
 * channel back is the shared settings store. On every change we write +
 * saveAsync() (throttled); the viz re-renders on its SettingsChanged listener.
 * "Cancel" restores the snapshot taken when the dialog opened; "Reset" applies
 * the defaults live.
 */
(function () {
  // Quick-pick swatches shown beneath the main color pickers.
  const PRESET_SWATCHES = [
    '#f4503c', '#f7a01d', '#e0a800', '#2ecc71', '#17a589', '#1ab7d4',
    '#3a78ee', '#7c4dff', '#9b51e0', '#e8459b', '#1f2937', '#6b7280',
    '#ffffff', '#f2efe9', '#000000',
  ];

  // Declarative form schema. `show` is an optional predicate (cfg => bool).
  // `wide` lays the control out below its label (full width).
  const GROUPS = [
    {
      title: 'Layout', open: true, fields: [
        { key: 'chartStyle', type: 'segmented', label: 'Chart type', options: [
          ['concentric', 'Concentric'], ['wedge', 'Radial bars'],
        ] },
        { key: 'title', type: 'text', label: 'Chart title', hint: 'Leave blank for none' },
        { key: 'startAngle', type: 'number', label: 'Start angle', hint: '0 = top', min: -360, max: 360, step: 5 },
        { key: 'endAngle', type: 'number', label: 'End / max-value angle', hint: '360 = full circle', min: -360, max: 720, step: 5 },
        { key: 'innerRadiusPct', type: 'range', label: 'Inner radius', min: 0, max: 90, step: 1, unit: '%' },
        { key: 'outerRadiusPct', type: 'range', label: 'Outer radius', min: 10, max: 100, step: 1, unit: '%' },
        { key: 'barPadPct', type: 'range', label: 'Bar / ring gap', min: 0, max: 90, step: 1, unit: '%' },
        { key: 'cornerRadius', type: 'range', label: 'Rounded ends', min: 0, max: 20, step: 1, unit: 'px' },
      ],
    },
    {
      title: 'Color', open: true, fields: [
        { key: 'colorMode', type: 'segmented', label: 'Color mode', options: [
          ['categorical', 'Palette'], ['sequential', 'Gradient'], ['single', 'Single'],
        ] },
        { key: 'color1', type: 'color', label: 'Color', wide: true, presets: PRESET_SWATCHES, show: (c) => c.colorMode === 'single' },
        { key: 'color1', type: 'color', label: 'Gradient start', wide: true, presets: PRESET_SWATCHES, show: (c) => c.colorMode === 'sequential' },
        { key: 'color2', type: 'color', label: 'Gradient end', wide: true, presets: PRESET_SWATCHES, show: (c) => c.colorMode === 'sequential' },
        { key: 'palette', type: 'palette', label: 'Palette', wide: true, show: (c) => c.colorMode === 'categorical', options: [
          ['bright', 'Bright'], ['tableau10', 'Tableau 10'], ['category10', 'Category 10'], ['pastel', 'Pastel'], ['warm', 'Warm'], ['cool', 'Cool'],
        ] },
        { key: 'barOpacity', type: 'range', label: 'Opacity', min: 0.1, max: 1, step: 0.05 },
        { key: 'strokeWidth', type: 'range', label: 'Border width', min: 0, max: 6, step: 0.5, unit: 'px', show: (c) => c.chartStyle === 'wedge' },
        { key: 'strokeColor', type: 'color', label: 'Border color', show: (c) => c.chartStyle === 'wedge' && c.strokeWidth > 0 },
        { key: 'background', type: 'color', label: 'Background', wide: true, presets: PRESET_SWATCHES },
        { key: 'showLegend', type: 'toggle', label: 'Color legend', hint: 'Gradient ramp or palette swatches' },
      ],
    },
    {
      title: 'Labels', open: false, fields: [
        { key: 'showCategoryLabels', type: 'toggle', label: 'Category labels' },
        { key: 'showValueLabels', type: 'toggle', label: 'Value labels' },
        { key: 'valueDecimals', type: 'number', label: 'Value decimals', min: 0, max: 6, step: 1, show: (c) => c.showValueLabels },
        { key: 'fontSize', type: 'number', label: 'Font size', min: 6, max: 32, step: 1, unit: 'px' },
        { key: 'labelColor', type: 'color', label: 'Label color' },
      ],
    },
    {
      title: 'Reference rings / tracks', open: false, fields: [
        { key: 'showRings', type: 'toggle', label: 'Show rings / tracks' },
        { key: 'ringCount', type: 'number', label: 'Ring count', min: 1, max: 12, step: 1, show: (c) => c.showRings && c.chartStyle === 'wedge' },
        { key: 'ringColor', type: 'color', label: 'Ring color', show: (c) => c.showRings },
      ],
    },
    {
      title: 'Data', open: false, fields: [
        { key: 'sort', type: 'select', label: 'Sort bars', options: [
          ['desc', 'Value: high → low'], ['asc', 'Value: low → high'], ['label', 'By label (A→Z)'], ['none', 'Data order'],
        ] },
        { key: 'maxBars', type: 'number', label: 'Max bars', hint: '0 = show all', min: 0, max: 500, step: 1 },
      ],
    },
  ];

  let cfg = Object.assign({}, RBC_DEFAULTS);
  let originalCfg = Object.assign({}, RBC_DEFAULTS); // snapshot for Cancel
  const formEl = document.getElementById('form');

  tableau.extensions.initializeDialogAsync().then(function () {
    cfg = rbcReadConfig();
    originalCfg = Object.assign({}, cfg);
    buildForm();
  });

  // ---- Live preview (throttled write + save) -----------------------------
  let saveTimer = null;
  let lastRun = 0;
  let saving = false;
  let pending = false;

  async function flush() {
    if (saving) { pending = true; return; }
    saving = true;
    try {
      await rbcWriteConfig(cfg); // set() + saveAsync() → viz gets SettingsChanged
    } catch (e) {
      // A transient save race is harmless; the next flush will reconcile.
    } finally {
      saving = false;
      if (pending) { pending = false; flush(); }
    }
  }

  // Fire at most ~every 120ms so dragging a slider updates the viz smoothly.
  function applyLive() {
    const now = (window.performance && performance.now) ? performance.now() : 0;
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    const since = now - lastRun;
    if (since >= 120) { lastRun = now; flush(); }
    else { saveTimer = setTimeout(() => { lastRun = (window.performance && performance.now) ? performance.now() : 0; flush(); }, 120 - since); }
  }

  function set(key, value) { cfg[key] = value; applyLive(); }

  // ---- Form rendering ----------------------------------------------------
  function buildForm() {
    formEl.innerHTML = '';
    for (const group of GROUPS) {
      const details = document.createElement('details');
      details.className = 'group';
      if (group.open) details.open = true;
      const summary = document.createElement('summary');
      summary.textContent = group.title;
      details.appendChild(summary);
      const body = document.createElement('div');
      body.className = 'body';
      for (const f of group.fields) {
        if (f.show && !f.show(cfg)) continue;
        body.appendChild(buildRow(f));
      }
      details.appendChild(body);
      formEl.appendChild(details);
    }
  }

  function buildRow(f) {
    const row = document.createElement('div');
    row.className = 'row' + (f.wide ? ' wide' : '');
    const lab = document.createElement('label');
    lab.innerHTML = f.label + (f.hint ? `<span class="hint">${f.hint}</span>` : '');
    row.appendChild(lab);

    const wrap = document.createElement('div');
    wrap.className = 'ctrl';
    const val = cfg[f.key];

    if (f.type === 'text') {
      const i = inp('text', val); i.oninput = () => set(f.key, i.value); wrap.appendChild(i);
    } else if (f.type === 'number') {
      const i = inp('number', val); applyMinMax(i, f); i.oninput = () => set(f.key, num(i.value)); wrap.appendChild(i);
    } else if (f.type === 'color') {
      wrap.appendChild(buildColor(f, val));
    } else if (f.type === 'range') {
      const i = inp('range', val); applyMinMax(i, f);
      const out = document.createElement('span'); out.className = 'rangeval'; out.textContent = fmtRange(val, f);
      i.oninput = () => { set(f.key, num(i.value)); out.textContent = fmtRange(i.value, f); };
      wrap.appendChild(i); wrap.appendChild(out);
    } else if (f.type === 'segmented') {
      const seg = document.createElement('div');
      seg.className = 'seg';
      for (const [v, t] of f.options) {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = t;
        if (String(v) === String(val)) b.classList.add('active');
        b.onclick = () => { set(f.key, v); buildForm(); }; // rebuild for conditional fields
        seg.appendChild(b);
      }
      wrap.appendChild(seg);
    } else if (f.type === 'palette') {
      const box = document.createElement('div');
      box.className = 'palettes';
      for (const [key, name] of f.options) {
        const opt = document.createElement('button');
        opt.type = 'button';
        opt.className = 'pal' + (key === val ? ' active' : '');
        const nm = document.createElement('span'); nm.className = 'pname'; nm.textContent = name;
        const sws = document.createElement('span'); sws.className = 'swatches';
        for (const c of (RBC_PALETTES[key] || [])) {
          const s = document.createElement('span'); s.style.background = c; sws.appendChild(s);
        }
        opt.appendChild(nm); opt.appendChild(sws);
        opt.onclick = () => { set(f.key, key); buildForm(); };
        box.appendChild(opt);
      }
      wrap.appendChild(box);
    } else if (f.type === 'select') {
      const s = document.createElement('select');
      for (const [v, t] of f.options) {
        const o = document.createElement('option'); o.value = v; o.textContent = t;
        if (String(v) === String(val)) o.selected = true; s.appendChild(o);
      }
      s.onchange = () => { set(f.key, s.value); buildForm(); };
      wrap.appendChild(s);
    } else if (f.type === 'toggle') {
      const sw = document.createElement('label'); sw.className = 'switch';
      const i = document.createElement('input'); i.type = 'checkbox'; i.checked = !!val;
      const sl = document.createElement('span'); sl.className = 'slider';
      i.onchange = () => { set(f.key, i.checked); buildForm(); };
      sw.appendChild(i); sw.appendChild(sl); wrap.appendChild(sw);
    }
    row.appendChild(wrap);
    return row;
  }

  // Color input + optional quick-pick preset swatches.
  function buildColor(f, val) {
    const box = document.createElement('div');
    box.className = 'colorbox';
    const line = document.createElement('div'); line.className = 'colorline';
    const i = inp('color', val);
    const hex = document.createElement('span'); hex.className = 'hex'; hex.textContent = String(val).toLowerCase();
    line.appendChild(i); line.appendChild(hex);
    box.appendChild(line);

    let grid = null;
    if (f.presets) {
      grid = document.createElement('div'); grid.className = 'swrow';
      for (const c of f.presets) {
        const sw = document.createElement('button');
        sw.type = 'button'; sw.className = 'sw'; sw.style.background = c; sw.title = c;
        if (c.toLowerCase() === String(val).toLowerCase()) sw.classList.add('active');
        sw.onclick = () => {
          set(f.key, c); i.value = c; hex.textContent = c.toLowerCase();
          grid.querySelectorAll('.sw').forEach((el) => el.classList.toggle('active', el === sw));
        };
        grid.appendChild(sw);
      }
      box.appendChild(grid);
    }
    i.oninput = () => {
      set(f.key, i.value); hex.textContent = i.value.toLowerCase();
      if (grid) grid.querySelectorAll('.sw').forEach((el) => el.classList.toggle('active', el.title.toLowerCase() === i.value.toLowerCase()));
    };
    return box;
  }

  function inp(type, value) {
    const i = document.createElement('input'); i.type = type;
    if (type === 'range' || type === 'number') i.value = value;
    else i.value = value == null ? '' : value;
    return i;
  }
  function applyMinMax(i, f) {
    if (f.min != null) i.min = f.min;
    if (f.max != null) i.max = f.max;
    if (f.step != null) i.step = f.step;
  }
  function fmtRange(v, f) { return (Math.round(v * 100) / 100) + (f.unit || ''); }
  function num(v) { const n = parseFloat(v); return isNaN(n) ? 0 : n; }

  // ---- Footer actions ----------------------------------------------------
  document.getElementById('save').onclick = async function () {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    await flush();
    tableau.extensions.ui.closeDialog('saved');
  };
  document.getElementById('cancel').onclick = async function () {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    cfg = Object.assign({}, originalCfg); // revert the live preview
    await rbcWriteConfig(cfg);
    tableau.extensions.ui.closeDialog('cancelled');
  };
  document.getElementById('reset').onclick = function () {
    cfg = Object.assign({}, RBC_DEFAULTS);
    applyLive();   // push defaults to the viz immediately
    buildForm();
  };
})();
