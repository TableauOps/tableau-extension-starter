'use strict';

/*
 * Config + design tokens for the Calendar Heatmap. Loaded by heatmap.html.
 * The in-viz gear → settings modal (built in heatmap.js) reads/writes these,
 * and they persist in tableau.extensions.settings (string-only, so we coerce on
 * read) — so they travel with the workbook.
 *
 * Part ids (HM_PARTS) must match DATE_PARTS in heatmap.js.
 */

// Date aggregation levels, coarse → fine, for the Columns / Rows pickers.
var HM_PARTS = [
  { id: 'year',       label: 'Year' },
  { id: 'quarter',    label: 'Quarter' },
  { id: 'month',      label: 'Month' },
  { id: 'week',       label: 'Week (calendar)' },
  { id: 'weekOfYear', label: 'Week of year' },
  { id: 'dayOfMonth', label: 'Day of month' },
  { id: 'weekday',    label: 'Weekday' },
  { id: 'hour',       label: 'Hour' },
  { id: 'minute',     label: 'Minute' },
];
var HM_PART_IDS = HM_PARTS.map(function (p) { return p.id; });

// Each palette: an 8-step light→dark ramp (colors the grid) + one accent color
// (synced across the whole UI — bars, gear, sliders, toggles, hint border).
var HM_PALETTES = {
  coolwarm: { label: 'Coolwarm', accent: '#df7d45', ramp: ['#5b9bbd', '#86b0c2', '#aebfc0', '#c9c3b6', '#d9b394', '#e0996b', '#df7d45', '#d35f2b'] },
  warm:    { label: 'Warm',    accent: '#e8743b', ramp: ['#fff4e6', '#ffe0bf', '#ffc78c', '#ffab59', '#f78c33', '#e8743b', '#b4531f', '#6f2f10'] },
  orange:  { label: 'Orange',  accent: '#e05f00', ramp: ['#fff1e0', '#ffdcb3', '#ffc080', '#ff9f4d', '#fb7e1a', '#e05f00', '#a84700', '#6b2e00'] },
  gold:    { label: 'Gold',    accent: '#cc9600', ramp: ['#fff8e1', '#ffecb3', '#ffe082', '#ffd24d', '#f5b800', '#cc9600', '#8f6900', '#574000'] },
  red:     { label: 'Red',     accent: '#c62828', ramp: ['#fdeaea', '#f9cccc', '#f0a3a3', '#e57373', '#d84a4a', '#c62828', '#962020', '#5c1414'] },
  sunset:  { label: 'Sunset',  accent: '#fa5d5d', ramp: ['#fff0e6', '#ffd9c2', '#ffb38a', '#ff8a66', '#fa5d5d', '#d6437a', '#9b3590', '#5a2475'] },
  pink:    { label: 'Pink',    accent: '#d63d89', ramp: ['#fdeaf3', '#f9c6df', '#f199c4', '#e667a6', '#d63d89', '#b02468', '#7d1949', '#48102b'] },
  magma:   { label: 'Magma',   accent: '#cd4071', ramp: ['#fcfdbf', '#fecc8f', '#fe9f6d', '#f1605d', '#cd4071', '#9e2f7f', '#641a80', '#241147'] },
  purple:  { label: 'Purple',  accent: '#7c5cbf', ramp: ['#f3eefb', '#e0d3f3', '#c6aee6', '#a983d6', '#8c5fc4', '#7c5cbf', '#5a3f8f', '#382660'] },
  indigo:  { label: 'Indigo',  accent: '#3b46b0', ramp: ['#eceefb', '#cdd3f5', '#a3ace8', '#7a86db', '#5562cc', '#3b46b0', '#2a3380', '#171c4a'] },
  blue:    { label: 'Blue',    accent: '#2c6e8f', ramp: ['#eff6fb', '#d3e6f3', '#aacce6', '#7db0d6', '#4f93c4', '#2c6e8f', '#1d4f6b', '#123246'] },
  ocean:   { label: 'Ocean',   accent: '#1f6f96', ramp: ['#e9f6f9', '#c3e6ef', '#90d0e0', '#5ab3cc', '#2e90b3', '#1f6f96', '#154f6e', '#0c2f42'] },
  teal:    { label: 'Teal',    accent: '#0f9b8e', ramp: ['#e9f7f5', '#c7ece7', '#98ddd4', '#67c9bd', '#34b0a2', '#0f9b8e', '#0b6e64', '#073f39'] },
  green:   { label: 'Green',   accent: '#3f9b5a', ramp: ['#eef7ee', '#d2ecd3', '#a9d9ad', '#7cc384', '#4faa5c', '#3f9b5a', '#2c6e3f', '#194527'] },
  viridis: { label: 'Viridis', accent: '#21918c', ramp: ['#440154', '#46327e', '#365c8d', '#277f8e', '#1fa187', '#4ac16d', '#a0da39', '#fde725'] },
  brown:   { label: 'Brown',   accent: '#825a28', ramp: ['#f6efe7', '#e8d6c0', '#d4b78f', '#bd9460', '#a3753c', '#825a28', '#5e3f1b', '#3a2710'] },
  slate:   { label: 'Slate',   accent: '#4c5b70', ramp: ['#eef1f5', '#d6dde6', '#b3c0ce', '#8c9cae', '#677890', '#4c5b70', '#34404f', '#1d242e'] },
  gray:    { label: 'Gray',    accent: '#6b7280', ramp: ['#f4f5f6', '#e1e4e7', '#c7ccd1', '#a7afb6', '#858f98', '#6b7280', '#4b525a', '#2c3137'] },
};
var HM_PALETTE_ORDER = ['coolwarm', 'warm', 'orange', 'gold', 'red', 'sunset', 'pink', 'magma', 'purple', 'indigo', 'blue', 'ocean', 'teal', 'green', 'viridis', 'brown', 'slate', 'gray'];

var HM_DEFAULTS = {
  cols: 'week',       // column date aggregation
  rows: 'weekday',    // row date aggregation
  palette: 'coolwarm',
  colBarPos: 'top',   // 'off' | 'top' | 'bottom'  (column totals)
  rowBarPos: 'right', // 'off' | 'left' | 'right'   (row totals)
  barSize: 56,        // px thickness of the marginal-bar bands
  tileW: 0,           // 0 = fit to viewport; > 0 = fixed px (grid scrolls)
  tileH: 0,
  cellLabel: 'auto',  // 'auto' | 'on' | 'off'
};

function hmReadConfig() {
  var s = (window.tableau && tableau.extensions && tableau.extensions.settings)
    ? tableau.extensions.settings.getAll()
    : {};
  var cfg = {};
  Object.keys(HM_DEFAULTS).forEach(function (k) {
    var def = HM_DEFAULTS[k];
    var raw = s[k];
    if (raw === undefined || raw === null || raw === '') cfg[k] = def;
    else if (typeof def === 'number') { var n = parseFloat(raw); cfg[k] = isNaN(n) ? def : n; }
    else if (typeof def === 'boolean') cfg[k] = (raw === 'true' || raw === true);
    else cfg[k] = String(raw);
  });
  if (HM_PART_IDS.indexOf(cfg.rows) < 0) cfg.rows = HM_DEFAULTS.rows;
  if (HM_PART_IDS.indexOf(cfg.cols) < 0) cfg.cols = HM_DEFAULTS.cols;
  if (HM_PALETTE_ORDER.indexOf(cfg.palette) < 0) cfg.palette = HM_DEFAULTS.palette;
  if (['off', 'top', 'bottom'].indexOf(cfg.colBarPos) < 0) cfg.colBarPos = HM_DEFAULTS.colBarPos;
  if (['off', 'left', 'right'].indexOf(cfg.rowBarPos) < 0) cfg.rowBarPos = HM_DEFAULTS.rowBarPos;
  if (['auto', 'on', 'off'].indexOf(cfg.cellLabel) < 0) cfg.cellLabel = HM_DEFAULTS.cellLabel;
  return cfg;
}

async function hmWriteConfig(patch) {
  Object.keys(patch).forEach(function (k) {
    tableau.extensions.settings.set(k, String(patch[k]));
  });
  await tableau.extensions.settings.saveAsync();
}
