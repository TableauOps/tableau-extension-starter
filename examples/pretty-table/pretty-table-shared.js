'use strict';

/*
 * Shared config model for Pretty Table — loaded by BOTH the viz (pretty-table.html)
 * and the Configure dialog (pretty-table-config.html).
 *
 * Tableau settings are string-only and travel with the workbook, so the whole
 * config is serialized to one JSON blob under PT_KEY. The dialog writes it
 * (set + saveAsync); the viz reads it on load and re-reads on SettingsChanged.
 */

var PT_KEY = 'prettyTableConfig.v1';

// Appearance defaults the author sets in the dialog. The in-session View menu
// can override these live without persisting (config is the source of defaults).
var PT_APPEARANCE_DEFAULTS = {
  theme: 'light',            // 'light' | 'dark'
  density: 'comfortable',    // 'compact' | 'comfortable' | 'spacious'
  zebra: true,
  numericRender: 'none',     // 'none' | 'bars' | 'heatmap' | 'dots'
  defaultColWidth: 0,        // px; 0 = auto-size
  // In-cell data-bar styling (used when numericRender === 'bars').
  bar: {
    color: 'accent',         // 'accent' | 'posneg' | 'gradient'
    direction: 'left',       // 'left' | 'right' | 'zero' (zero = diverging from center)
    height: 'full',          // 'thin' | 'medium' | 'full'
    labelMode: 'overlay',    // 'overlay' (on the bar) | 'outside' (in a right gutter) | 'hidden'
    rounded: true,
    track: true,             // faint full-extent track behind the fill
  },
};

// Merge persisted appearance over defaults, deep-merging the nested bar object.
function ptMergeAppearance(base, patch) {
  var out = Object.assign({}, base, patch || {});
  out.bar = Object.assign({}, base.bar, (patch && patch.bar) || {});
  return out;
}

// Row heights per density (px). Cell padding scales with it.
var PT_DENSITY = {
  compact: 28,
  comfortable: 36,
  spacious: 46,
};

function ptColDefaults() {
  return {
    label: '',              // '' → use the field name
    type: 'auto',           // 'auto' | 'number' | 'date' | 'bool' | 'text'
    width: 0,               // px; 0 → use the appearance default / auto
    decimals: -1,           // -1 → keep Tableau's formatted value
    visible: true,
    essential: false,       // "star" — kept visible by presets, never auto-hidden
    renderMode: 'default',  // 'default' (follow View menu) | 'dots'
    dotsCeiling: 0,         // 0 → use the column's own max as the dot-scale top
  };
}

function ptEmptyStateDefaults() {
  return {
    title: '',
    description: '',          // HTML-capable
    buttonEnabled: false,
    buttonLabel: 'Load detail',
    paramName: '',
    paramValue: '',
  };
}

function ptDefaults() {
  return {
    appearance: Object.assign({}, PT_APPEARANCE_DEFAULTS),
    sort: {
      primary: { field: '', dir: 'asc' },     // field '' → no default sort
      secondary: { field: '', dir: 'asc' },   // tiebreaker
    },
    columns: {},               // fieldName → partial column-config override
    emptyState: ptEmptyStateDefaults(),
  };
}

function ptReadConfig() {
  var cfg = ptDefaults();
  try {
    var raw = tableau.extensions.settings.get(PT_KEY);
    if (raw) {
      var parsed = JSON.parse(raw);
      if (parsed.appearance) cfg.appearance = ptMergeAppearance(cfg.appearance, parsed.appearance);
      if (parsed.sort) {
        if (parsed.sort.primary) cfg.sort.primary = Object.assign(cfg.sort.primary, parsed.sort.primary);
        if (parsed.sort.secondary) cfg.sort.secondary = Object.assign(cfg.sort.secondary, parsed.sort.secondary);
      }
      if (parsed.columns) cfg.columns = parsed.columns;
      if (parsed.emptyState) cfg.emptyState = Object.assign(cfg.emptyState, parsed.emptyState);
    }
  } catch (e) { /* corrupt/old settings → defaults */ }
  return cfg;
}

// Per-column config merged over defaults.
function ptColConfig(cfg, field) {
  return Object.assign(ptColDefaults(), cfg.columns[field] || {});
}

async function ptWriteConfig(cfg) {
  tableau.extensions.settings.set(PT_KEY, JSON.stringify(cfg));
  await tableau.extensions.settings.saveAsync();
}
