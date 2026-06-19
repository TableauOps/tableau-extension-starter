'use strict';

/*
 * Shared configuration schema + helpers for the Radial Bar Chart viz extension.
 * Loaded by both index.html (the viz) and config.html (the configuration dialog)
 * so the two stay in sync on defaults, types, and how settings are read/written.
 */

// Every customizable option lives here. The TYPE of each default value drives
// coercion when reading from / writing to tableau.extensions.settings (which
// only stores strings).
const RBC_DEFAULTS = {
  // Layout
  chartStyle: 'concentric', // 'concentric' (one rounded arc per category) | 'wedge' (filled sectors)
  title: '',
  startAngle: 0,          // degrees, 0 = 12 o'clock
  endAngle: 360,          // wedge: angular fan span. concentric: sweep a max-value bar reaches.
  innerRadiusPct: 18,     // donut hole, % of available radius (0-90)
  outerRadiusPct: 95,     // outer extent, % of available radius (10-100)
  barPadPct: 45,          // wedge: gap between bars / concentric: gap between rings, % (0-90)
  cornerRadius: 6,        // wedge: rounded sector ends, px. concentric: >0 = round arc caps.

  // Color
  colorMode: 'categorical', // 'single' | 'sequential' | 'categorical'
  color1: '#3b6fb6',       // single color / sequential start
  color2: '#e8743b',       // sequential end
  palette: 'bright',       // categorical palette key (see RBC_PALETTES)
  barOpacity: 1,           // 0-1
  strokeColor: '#ffffff',
  strokeWidth: 0,          // px outline on each bar (wedge mode)
  showLegend: true,        // color legend: gradient ramp (measure) or swatches (palette/dimension)

  // Background
  background: '#f2efe9',

  // Labels
  showCategoryLabels: false,
  showValueLabels: false,
  labelColor: '#3a3a3a',
  fontSize: 12,
  valueDecimals: 0,

  // Reference rings / tracks
  showRings: true,        // concentric: faint full-circle track behind each bar
  ringCount: 4,           // wedge mode only: number of concentric grid rings
  ringColor: '#e7e3da',

  // Data shaping
  sort: 'none',           // 'none' | 'asc' | 'desc' | 'label'
  maxBars: 0,             // 0 = show all
};

const RBC_PALETTES = {
  bright: ['#f4503c', '#f7a01d', '#17a589', '#3a78ee', '#9b51e0', '#e8459b', '#2ecc71', '#e0a800', '#1ab7d4', '#f5731f', '#7c4dff', '#16a085'],
  tableau10: ['#4e79a7', '#f28e2b', '#e15759', '#76b7b2', '#59a14f', '#edc948', '#b07aa1', '#ff9da7', '#9c755f', '#bab0ac'],
  category10: ['#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', '#9467bd', '#8c564b', '#e377c2', '#7f7f7f', '#bcbd22', '#17becf'],
  pastel: ['#a1c9f4', '#ffb482', '#8de5a1', '#ff9f9b', '#d0bbff', '#debb9b', '#fab0e4', '#cfcfcf', '#fffea3', '#b9f2f0'],
  warm: ['#5e1414', '#7e2222', '#a13030', '#c44343', '#e06b4c', '#ef9a4a', '#f5c542', '#f7e15a'],
  cool: ['#0d2b45', '#16425b', '#2a6f97', '#468faf', '#61a5c2', '#89c2d9', '#a9d6e5', '#caf0f8'],
};

// Read a typed config object out of tableau.extensions.settings, falling back
// to defaults for anything unset.
function rbcReadConfig() {
  const settings = (window.tableau && tableau.extensions && tableau.extensions.settings)
    ? tableau.extensions.settings.getAll()
    : {};
  const cfg = {};
  for (const key of Object.keys(RBC_DEFAULTS)) {
    const def = RBC_DEFAULTS[key];
    const raw = settings[key];
    if (raw === undefined || raw === null || raw === '') {
      cfg[key] = def;
    } else if (typeof def === 'number') {
      const n = parseFloat(raw);
      cfg[key] = isNaN(n) ? def : n;
    } else if (typeof def === 'boolean') {
      cfg[key] = (raw === 'true' || raw === true);
    } else {
      cfg[key] = String(raw);
    }
  }
  return cfg;
}

// Persist a config object to settings and save it to the workbook.
async function rbcWriteConfig(cfg) {
  for (const key of Object.keys(RBC_DEFAULTS)) {
    if (cfg[key] === undefined) continue;
    tableau.extensions.settings.set(key, String(cfg[key]));
  }
  await tableau.extensions.settings.saveAsync();
}
