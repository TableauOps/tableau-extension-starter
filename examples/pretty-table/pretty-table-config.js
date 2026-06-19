'use strict';

/*
 * Pretty Table — Configure dialog.
 *
 * Opened from the viz via ui.displayDialogAsync(url, payload). The payload is a
 * JSON list of the worksheet's current columns (field, dataType, autoType) so
 * the dialog can show one editor per column without re-querying the data.
 *
 * The whole config object (pretty-table-shared.js shape) is edited in a working
 * copy and written back with ptWriteConfig (set + saveAsync) on Save. The viz
 * picks it up via its SettingsChanged listener.
 */
(function () {
  const formEl = document.getElementById('form');
  let cfg = ptDefaults();
  let columns = []; // [{ field, dataType, autoType }]

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  tableau.extensions.initializeDialogAsync().then((payload) => {
    try { columns = (JSON.parse(payload || '{}').columns) || []; } catch (e) { columns = []; }
    cfg = ptReadConfig();
    // Ensure a working entry exists for every current column.
    for (const c of columns) if (!cfg.columns[c.field]) cfg.columns[c.field] = ptColDefaults();
    build();
  });

  // ---- Builders ----------------------------------------------------------
  function group(title, open, innerHtml) {
    return '<details class="group"' + (open ? ' open' : '') + '><summary>' + title + '</summary><div class="body">' + innerHtml + '</div></details>';
  }

  function sortFieldOptions(selected) {
    let o = '<option value="">— none —</option>';
    for (const c of columns) {
      const cc = cfg.columns[c.field] || {};
      o += '<option value="' + esc(c.field) + '"' + (c.field === selected ? ' selected' : '') + '>' + esc(cc.label || c.field) + '</option>';
    }
    return o;
  }
  function dirOptions(selected) {
    return ['asc', 'desc'].map((d) => '<option value="' + d + '"' + (d === selected ? ' selected' : '') + '>' + (d === 'asc' ? 'Ascending' : 'Descending') + '</option>').join('');
  }
  function pick(key, val, opts) {
    return '<select data-set="' + key + '">' + opts.map(([v, t]) => '<option value="' + v + '"' + (String(v) === String(val) ? ' selected' : '') + '>' + t + '</option>').join('') + '</select>';
  }

  function build() {
    const a = cfg.appearance;

    // Appearance
    const appearance = group('Appearance', true,
      '<div class="row"><label>Theme</label>' + pick('app.theme', a.theme, [['light', 'Light'], ['dark', 'Dark']]) + '</div>' +
      '<div class="row"><label>Density</label>' + pick('app.density', a.density, [['compact', 'Compact'], ['comfortable', 'Comfortable'], ['spacious', 'Spacious']]) + '</div>' +
      '<div class="row"><label>Default column width</label><div class="inline"><input type="number" min="0" step="10" data-set="app.defaultColWidth" value="' + (a.defaultColWidth | 0) + '" style="width:90px"><span class="hint">px · 0 = auto (sets fixed layout when &gt; 0)</span></div></div>'
    );

    // Default sort
    const sort = group('Default sort', true,
      '<div class="row"><label>Primary</label><div class="inline"><select data-set="sort.primary.field" style="flex:1">' + sortFieldOptions(cfg.sort.primary.field) + '</select><select data-set="sort.primary.dir">' + dirOptions(cfg.sort.primary.dir) + '</select></div></div>' +
      '<div class="row"><label>Tiebreaker</label><div class="inline"><select data-set="sort.secondary.field" style="flex:1">' + sortFieldOptions(cfg.sort.secondary.field) + '</select><select data-set="sort.secondary.dir">' + dirOptions(cfg.sort.secondary.dir) + '</select></div></div>' +
      '<div class="hint">Header clicks override this per session; defaults apply on load and survive data refreshes.</div>'
    );

    // Columns
    let colHtml = '';
    if (!columns.length) colHtml = '<div class="hint">No fields are on the Columns encoding yet.</div>';
    for (const c of columns) colHtml += columnCard(c);
    const cols = group('Columns (' + columns.length + ')', true, colHtml);

    // Empty state
    const es = cfg.emptyState;
    const empty = group('Empty "no rows" state', false,
      '<div class="row wide"><label>Title</label><input type="text" data-set="es.title" value="' + esc(es.title) + '" placeholder="No rows to display"></div>' +
      '<div class="row wide"><label>Description (HTML allowed)</label><textarea data-set="es.description" placeholder="&lt;b&gt;0 rows&lt;/b&gt; matched your filters.">' + esc(es.description) + '</textarea></div>' +
      '<div class="row"><label>Load button</label><label class="switch"><input type="checkbox" data-set="es.buttonEnabled"' + (es.buttonEnabled ? ' checked' : '') + '> Show a button that sets a parameter</label></div>' +
      '<div class="row"><label>Button label</label><input type="text" data-set="es.buttonLabel" value="' + esc(es.buttonLabel) + '"></div>' +
      '<div class="row"><label>Parameter name</label><input type="text" data-set="es.paramName" value="' + esc(es.paramName) + '" placeholder="Exact parameter name in the workbook"></div>' +
      '<div class="row"><label>Value to set</label><input type="text" data-set="es.paramValue" value="' + esc(es.paramValue) + '"></div>' +
      '<div class="hint">An escape hatch for feeds that start filtered to nothing — the button writes the value into a Tableau parameter to trigger a load.</div>'
    );

    formEl.innerHTML = appearance + sort + cols + empty;
    wire();
  }

  function columnCard(c) {
    const cc = cfg.columns[c.field];
    const f = c.field;
    return '<div class="col-card" data-field="' + esc(f) + '">' +
      '<div class="col-head">' +
        '<button type="button" class="star-btn' + (cc.essential ? ' on' : '') + '" data-col="essential" title="Mark essential">★</button>' +
        '<span class="name">' + esc(f) + '</span>' +
        '<span class="type-tag">' + esc(c.autoType) + '</span>' +
        '<label class="switch"><input type="checkbox" data-col="visible"' + (cc.visible ? ' checked' : '') + '> Visible</label>' +
      '</div>' +
      '<div class="col-body">' +
        '<div class="field full"><span>Display label</span><input type="text" data-col="label" value="' + esc(cc.label) + '" placeholder="' + esc(f) + '"></div>' +
        '<div class="field"><span>Type</span><select data-col="type">' +
          [['auto', 'Auto (' + c.autoType + ')'], ['number', 'Number'], ['date', 'Date'], ['bool', 'Boolean'], ['text', 'Text']]
            .map(([v, t]) => '<option value="' + v + '"' + (cc.type === v ? ' selected' : '') + '>' + t + '</option>').join('') +
        '</select></div>' +
        '<div class="field"><span>Width (px, 0 = auto)</span><input type="number" min="0" step="10" data-col="width" value="' + (cc.width | 0) + '"></div>' +
        '<div class="field"><span>Decimals (−1 = default)</span><input type="number" min="-1" max="10" step="1" data-col="decimals" value="' + (cc.decimals) + '"></div>' +
        '<div class="field"><span>Render mode</span><select data-col="renderMode">' +
          [['default', 'Default'], ['dots', 'Dots']].map(([v, t]) => '<option value="' + v + '"' + (cc.renderMode === v ? ' selected' : '') + '>' + t + '</option>').join('') +
        '</select></div>' +
        '<div class="field"><span>Dots ceiling (0 = column max)</span><input type="number" min="0" step="1" data-col="dotsCeiling" value="' + (cc.dotsCeiling) + '"></div>' +
      '</div>' +
    '</div>';
  }

  // ---- Wiring ------------------------------------------------------------
  function setDeep(path, value) {
    const parts = path.split('.');
    let o = cfg;
    if (parts[0] === 'app') o = cfg.appearance, parts.shift();
    else if (parts[0] === 'sort') { o = cfg.sort[parts[1]]; o[parts[2]] = value; return; }
    else if (parts[0] === 'es') o = cfg.emptyState, parts.shift();
    o[parts[0]] = value;
  }

  function wire() {
    // Global selects/inputs (appearance, sort, empty state).
    formEl.querySelectorAll('[data-set]').forEach((el) => {
      const path = el.getAttribute('data-set');
      const ev = el.tagName === 'SELECT' || el.type === 'checkbox' ? 'change' : 'input';
      el.addEventListener(ev, () => {
        let v;
        if (el.type === 'checkbox') v = el.checked;
        else if (el.type === 'number') v = parseFloat(el.value || '0') || 0;
        else v = el.value;
        setDeep(path, v);
      });
    });

    // Per-column controls.
    formEl.querySelectorAll('.col-card').forEach((card) => {
      const field = card.getAttribute('data-field');
      const cc = cfg.columns[field];
      card.querySelectorAll('[data-col]').forEach((el) => {
        const key = el.getAttribute('data-col');
        if (key === 'essential') {
          el.addEventListener('click', () => { cc.essential = !cc.essential; el.classList.toggle('on', cc.essential); });
          return;
        }
        const ev = el.tagName === 'SELECT' || el.type === 'checkbox' ? 'change' : 'input';
        el.addEventListener(ev, () => {
          if (el.type === 'checkbox') cc[key] = el.checked;
          else if (el.type === 'number') cc[key] = parseInt(el.value, 10);
          else cc[key] = el.value;
          if (key === 'decimals' && isNaN(cc[key])) cc[key] = -1;
          if ((key === 'width' || key === 'dotsCeiling') && isNaN(cc[key])) cc[key] = 0;
        });
      });
    });
  }

  // ---- Footer ------------------------------------------------------------
  document.getElementById('save').onclick = async function () {
    try { await ptWriteConfig(cfg); } catch (e) { console.error('Save failed:', e); }
    tableau.extensions.ui.closeDialog('saved');
  };
  document.getElementById('cancel').onclick = function () {
    tableau.extensions.ui.closeDialog('cancelled');
  };
  document.getElementById('reset').onclick = function () {
    cfg = ptDefaults();
    for (const c of columns) cfg.columns[c.field] = ptColDefaults();
    build();
  };
})();
