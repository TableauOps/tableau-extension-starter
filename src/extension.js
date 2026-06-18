/* =============================================================
   Dashboard Companion — Tableau Dashboard Extension (starter)
   -------------------------------------------------------------
   What works out of the box:
     • Connects to the dashboard via the Extensions API
     • Shows the dashboard name + every worksheet
     • Live count of selected marks (updates on selection)
     • A working "Reset all filters" button
   The WORKSHOP ZONE near the bottom is where you'll build a new
   feature live with Claude Code. See CLAUDE.md for prompts.
   ============================================================= */

// Small helper for grabbing elements
const $ = (id) => document.getElementById(id);

// Entry point — the API must initialize before anything else runs.
tableau.extensions.initializeAsync().then(
  () => {
    setStatus("connected", "ok");
    const dashboard = tableau.extensions.dashboardContent.dashboard;

    renderDashboardInfo(dashboard);
    renderWorksheets(dashboard);
    wireSelectedMarks(dashboard);
    wireResetButton(dashboard);

    // 👇 ASK YOUR DASHBOARD — wired up in the workshop zone below.
    setupAskYourDashboard(dashboard);
  },
  (err) => {
    setStatus("init failed", "err");
    console.error("Extensions API failed to initialize:", err);
  }
);

/* ---------- baseline features ---------- */

function renderDashboardInfo(dashboard) {
  $("dashboardName").textContent = dashboard.name || "(untitled)";
}

function renderWorksheets(dashboard) {
  const list = $("worksheets");
  list.innerHTML = "";
  dashboard.worksheets.forEach((ws) => {
    const li = document.createElement("li");
    li.textContent = ws.name;
    list.appendChild(li);
  });
  if (dashboard.worksheets.length === 0) {
    list.innerHTML = '<li class="muted">No worksheets on this dashboard.</li>';
  }
}

// Live selected-marks count across every worksheet.
function wireSelectedMarks(dashboard) {
  const update = async () => {
    let total = 0;
    for (const ws of dashboard.worksheets) {
      const marks = await ws.getSelectedMarksAsync();
      total += marks.data.reduce((n, table) => n + table.data.length, 0);
    }
    $("markCount").textContent = total;
  };

  // Listen on each worksheet for selection changes.
  dashboard.worksheets.forEach((ws) => {
    ws.addEventListener(
      tableau.TableauEventType.MarkSelectionChanged,
      update
    );
  });

  update(); // initial paint
}

// Reset all filters on every worksheet. Genuinely reusable in any workbook.
function wireResetButton(dashboard) {
  $("resetBtn").addEventListener("click", async () => {
    setStatus("resetting…", "wait");
    for (const ws of dashboard.worksheets) {
      const filters = await ws.getFiltersAsync();
      for (const f of filters) {
        try {
          await ws.clearFilterAsync(f.fieldName);
        } catch (e) {
          // Some filter types can't be cleared — skip them quietly.
          console.warn(`Could not clear "${f.fieldName}":`, e.message);
        }
      }
    }
    setStatus("connected", "ok");
  });
}

/* ---------- ui helpers ---------- */

function setStatus(text, kind) {
  const el = $("status");
  el.textContent = text;
  el.className =
    "pill " +
    (kind === "ok" ? "pill--ok" : kind === "err" ? "pill--err" : "pill--wait");
}

/* =============================================================
   👇 ASK YOUR DASHBOARD — built live with Claude
   -------------------------------------------------------------
   Natural-language filtering, METADATA-ONLY. No dashboard data
   ever leaves the browser — only field NAMES + your question are
   sent to Claude, which returns a filter spec we apply locally.

   Phase 1 · discover the dashboard's filterable fields, render
             manual controls (fully local).
   Phase 2 · type a question → Claude returns filter JSON → we
             validate it against the real fields and apply it.
   ============================================================= */

const AYD = {
  // "claude-sonnet-4-6" → reliable JSON for intent parsing.
  // "claude-haiku-4-5"  → faster/cheaper, great for snappy live filtering.
  model: "claude-sonnet-4-6",
  fields: [], // the discovered field map, shared with Claude
};

function setupAskYourDashboard(dashboard) {
  restoreApiKey();
  wireAsk(dashboard);
  refreshFields(dashboard);
}

/* ---------- Phase 1 · discover fields + manual controls ---------- */

// Tableau's auto-generated / housekeeping fields aren't useful filters.
const IGNORE_FIELD = /\(generated\)|Measure Names|Measure Values|Number of Records/i;

// Build the field map two ways, best first:
//   (a) existing dashboard filters → rich entries WITH domain values (dropdowns)
//   (b) the worksheets' data sources → name-only entries, so natural-language
//       filtering works even when no filters are on the dashboard yet.
// Everything here is read locally; nothing is sent anywhere.
async function discoverFields() {
  const dashboard = tableau.extensions.dashboardContent.dashboard;
  const map = new Map();

  // (a) Existing filters — gives us the domain values the dropdowns use.
  for (const ws of dashboard.worksheets) {
    let filters;
    try {
      filters = await ws.getFiltersAsync();
    } catch (e) {
      continue; // worksheet we can't read — skip it quietly
    }
    for (const f of filters) {
      if (map.has(f.fieldName)) continue; // dedupe by field name
      try {
        if (f.filterType === "categorical") {
          const d = await f.getDomainAsync(tableau.FilterDomainType.Relevant);
          map.set(f.fieldName, {
            field: f.fieldName,
            type: "categorical",
            values: d.values.map((v) => v.formattedValue),
          });
        } else if (f.filterType === "range") {
          const d = await f.getDomainAsync(tableau.FilterDomainType.Relevant);
          map.set(f.fieldName, {
            field: f.fieldName,
            type: "range",
            min: d.min.value,
            max: d.max.value,
          });
        }
      } catch (e) {
        console.warn(`Could not read domain for "${f.fieldName}":`, e.message);
      }
    }
  }

  // (b) Data-source fields — names only, so you don't have to pre-build filters.
  for (const ws of dashboard.worksheets) {
    let sources;
    try {
      sources = await ws.getDataSourcesAsync();
    } catch (e) {
      continue;
    }
    for (const ds of sources) {
      for (const fld of ds.fields || []) {
        if (fld.isHidden || map.has(fld.name) || IGNORE_FIELD.test(fld.name)) continue;
        const dt = fld.dataType;
        if (fld.role === "measure" && (dt === "int" || dt === "float")) {
          map.set(fld.name, { field: fld.name, type: "range" });
        } else if (fld.role === "dimension" && (dt === "string" || dt === "bool")) {
          map.set(fld.name, { field: fld.name, type: "categorical" });
        }
        // dates / spatial / geo skipped — they don't map cleanly to a filter here
      }
    }
  }

  return [...map.values()];
}

async function refreshFields(dashboard) {
  AYD.fields = await discoverFields();
  renderFieldControls(AYD.fields, dashboard);
}

function renderFieldControls(fields, dashboard) {
  const host = $("aydFields");
  host.innerHTML = "";

  const head = document.createElement("div");
  head.className = "ayd-fields__head";
  const title = document.createElement("span");
  title.className = "label";
  title.textContent = "Filters";
  const rescan = document.createElement("button");
  rescan.type = "button";
  rescan.className = "ayd-link";
  rescan.textContent = "↻ Rescan";
  rescan.addEventListener("click", () => refreshFields(dashboard));
  head.append(title, rescan);
  host.appendChild(head);

  if (!fields.length) {
    const hint = document.createElement("p");
    hint.className = "ayd-hint";
    hint.textContent =
      "No fields found. Make sure the dashboard has a worksheet, then ↻ Rescan.";
    host.appendChild(hint);
    return;
  }

  // Fields that came with a domain (from an existing filter) get a real control;
  // the rest are name-only — usable by typing a request in the Ask box.
  const withControls = fields.filter((f) => f.values || f.min != null);
  const nlOnly = fields.filter((f) => !(f.values || f.min != null));

  for (const f of withControls) {
    host.appendChild(
      f.type === "categorical"
        ? categoricalControl(f, dashboard)
        : rangeControl(f, dashboard)
    );
  }

  if (nlOnly.length) {
    const note = document.createElement("p");
    note.className = "ayd-hint";
    note.appendChild(document.createTextNode("Ask to filter any of: "));
    const shown = nlOnly.slice(0, 30);
    shown.forEach((f, i) => {
      const chip = document.createElement("span");
      chip.className = "ayd-chip";
      chip.textContent = f.field;
      note.appendChild(chip);
      if (i < shown.length - 1) note.appendChild(document.createTextNode(" "));
    });
    if (nlOnly.length > shown.length) {
      note.appendChild(document.createTextNode(` +${nlOnly.length - shown.length} more`));
    }
    host.appendChild(note);
  }
}

function categoricalControl(f, dashboard) {
  const row = document.createElement("label");
  row.className = "ayd-field";
  row.innerHTML = `<span class="ayd-field__name">${f.field}</span>`;

  const select = document.createElement("select");
  select.className = "ayd-input ayd-select";
  select.innerHTML = '<option value="">(all)</option>';
  for (const v of f.values) {
    const opt = document.createElement("option");
    opt.value = v;
    opt.textContent = v;
    select.appendChild(opt);
  }
  select.addEventListener("change", async () => {
    if (select.value === "") await clearField(dashboard, f.field);
    else await applyCategorical(dashboard, f.field, [select.value]);
  });

  row.appendChild(select);
  return row;
}

function rangeControl(f, dashboard) {
  const row = document.createElement("div");
  row.className = "ayd-field";
  row.innerHTML = `<span class="ayd-field__name">${f.field}</span>`;

  const wrap = document.createElement("div");
  wrap.className = "ayd-range";
  const min = document.createElement("input");
  const max = document.createElement("input");
  for (const [el, val] of [[min, f.min], [max, f.max]]) {
    el.type = "number";
    el.className = "ayd-input ayd-num";
    el.value = val;
  }
  const apply = () => applyRange(dashboard, f.field, Number(min.value), Number(max.value));
  min.addEventListener("change", apply);
  max.addEventListener("change", apply);

  const dash = document.createElement("span");
  dash.className = "ayd-range__dash";
  dash.textContent = "–";
  wrap.append(min, dash, max);
  row.appendChild(wrap);
  return row;
}

/* ---------- Phase 2 · natural language → filters ---------- */

function wireAsk(dashboard) {
  const send = async () => {
    const key = $("aydKey").value.trim();
    const q = $("aydQuestion").value.trim();
    if (!q) return;
    if (!key) {
      aydStatus("Enter your Anthropic API key above first.", "err");
      return;
    }
    saveApiKey(key);
    hideAnswer();

    // Nothing to filter yet → nothing is sent.
    if (!AYD.fields.length) {
      aydStatus("", "");
      showAnswer("Nothing to filter yet — add a filter and ↻ Rescan. Nothing was sent.");
      return;
    }

    aydStatus("Thinking…", "wait");
    try {
      const intent = await askClaude(q, AYD.fields, key);
      if (intent && intent.action === "filter") {
        const applied = await applyIntent(intent, AYD.fields, dashboard);
        aydStatus(
          applied.length ? "Applied — " + applied.join("; ") : "Nothing applied: no matching fields.",
          applied.length ? "ok" : "wait"
        );
      } else {
        // Not a filter. This panel only filters — it never reads your data — so
        // we decline rather than send anything from the dashboard.
        aydStatus("", "");
        showAnswer(
          "This panel only filters your dashboard — it doesn't read your data. " +
            "Try phrasing it as a filter, e.g. “only the West region” or “sales over 1000”."
        );
      }
    } catch (e) {
      console.error(e);
      aydStatus("Error: " + e.message, "err");
    }
  };

  $("aydSend").addEventListener("click", send);
  $("aydQuestion").addEventListener("keydown", (e) => {
    if (e.key === "Enter") send();
  });
}

// Send Claude the field schema + the question; get back parsed JSON intent.
async function askClaude(question, fields, apiKey) {
  // PRIVACY: we send ONLY the field names + types (structure) and the user's
  // own question. The actual filter values, measure ranges, and data rows
  // never leave the browser — Claude proposes a value from the user's wording
  // and we snap it to a real domain value locally (see snapValue / applyIntent).
  const schema = fields.map((f) => ({ field: f.field, type: f.type }));

  const system =
    "You translate a user's plain-English request about a Tableau dashboard into filter actions. " +
    "Use ONLY these fields, by their exact names: " +
    JSON.stringify(schema) +
    ". Infer the filter value(s) from the user's request. " +
    "Respond with ONLY a JSON object, no prose and no markdown fences. " +
    "For a filter request use this shape: " +
    '{"action":"filter","filters":[' +
    '{"field":"Region","type":"categorical","values":["West"]},' +
    '{"field":"Sales","type":"range","min":0,"max":500}]}. ' +
    'If the user is asking a question about the data rather than requesting a filter, ' +
    'respond with {"action":"answer","text":"..."}.';

  const data = await callAnthropic(apiKey, {
    model: AYD.model,
    max_tokens: 1024,
    system,
    messages: [{ role: "user", content: question }],
  });
  return extractJson(textOf(data));
}

// Validate the intent against the REAL fields, then apply each filter.
// Never trusts a field Claude didn't get from the schema, and snaps proposed
// values to real domain values locally (the domain never went to the model).
async function applyIntent(intent, fields, dashboard) {
  const valid = new Set(fields.map((f) => f.field));
  const applied = [];
  for (const flt of intent.filters || []) {
    if (!valid.has(flt.field)) continue; // model invented a field — drop it
    const def = fields.find((f) => f.field === flt.field) || {};
    if (flt.type === "categorical" && Array.isArray(flt.values) && flt.values.length) {
      const values = flt.values.map((v) => snapValue(def, v)); // map to real values
      await applyCategorical(dashboard, flt.field, values);
      applied.push(`${flt.field} = ${values.join(", ")}`);
    } else if (flt.type === "range") {
      // "over 1000" / "under 500" only give one bound — fill the other from the
      // domain, and clamp within the real min/max.
      let min = flt.min != null ? Number(flt.min) : def.min;
      let max = flt.max != null ? Number(flt.max) : def.max;
      if (def.min != null) min = Math.max(min, def.min);
      if (def.max != null) max = Math.min(max, def.max);
      // Without a known domain a one-sided range ("over 1000") can't be completed.
      if (min == null || max == null || Number.isNaN(min) || Number.isNaN(max)) continue;
      await applyRange(dashboard, flt.field, min, max);
      applied.push(`${flt.field} ${min}–${max}`);
    }
  }
  return applied;
}

// Match a model-proposed value to a real domain value, in the browser
// (case-insensitive, then substring either direction). Falls back to the
// proposed value if nothing matches.
function snapValue(def, proposed) {
  const vals = def.values || [];
  const p = String(proposed).trim().toLowerCase();
  return (
    vals.find((v) => String(v).toLowerCase() === p) ||
    vals.find((v) => String(v).toLowerCase().includes(p)) ||
    vals.find((v) => p.includes(String(v).toLowerCase())) ||
    proposed
  );
}

/* ---------- Tableau filter helpers (shared by manual + NL) ---------- */

// Run fn on every worksheet whose data source contains `field`, so applying
// works even when the field isn't on the filter shelf yet. Per-sheet errors
// (field not filterable there) are ignored.
async function eachWorksheetWithField(dashboard, field, fn) {
  for (const ws of dashboard.worksheets) {
    let has = true;
    try {
      const sources = await ws.getDataSourcesAsync();
      has = sources.some((ds) => (ds.fields || []).some((f) => f.name === field));
    } catch (e) {
      has = true; // couldn't check — attempt anyway
    }
    if (!has) continue;
    try {
      await fn(ws);
    } catch (e) {
      /* field isn't filterable on this sheet — skip it */
    }
  }
}

function applyCategorical(dashboard, field, values) {
  return eachWorksheetWithField(dashboard, field, (ws) =>
    ws.applyFilterAsync(field, values, tableau.FilterUpdateType.Replace)
  );
}

function applyRange(dashboard, field, min, max) {
  return eachWorksheetWithField(dashboard, field, (ws) =>
    ws.applyRangeFilterAsync(field, { min, max }, tableau.FilterUpdateType.Replace)
  );
}

function clearField(dashboard, field) {
  return eachWorksheetWithField(dashboard, field, (ws) => ws.clearFilterAsync(field));
}

/* ---------- Anthropic call + JSON helpers ---------- */

async function callAnthropic(apiKey, body) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      // Required to call the API directly from the browser (CORS).
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data && data.error && data.error.message) || `HTTP ${res.status}`);
  }
  return data;
}

// Join all text blocks of a Messages API response into one string.
function textOf(data) {
  return (data.content || []).map((b) => b.text || "").join("").trim();
}

// Be forgiving: strip ``` fences or surrounding prose before JSON.parse.
function extractJson(text) {
  let t = (text || "").trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  if (!t.startsWith("{")) {
    const s = t.indexOf("{");
    const e = t.lastIndexOf("}");
    if (s !== -1 && e > s) t = t.slice(s, e + 1);
  }
  return JSON.parse(t);
}

/* ---------- panel ui helpers ---------- */

function aydStatus(text, kind) {
  const el = $("aydStatus");
  el.textContent = text;
  el.className = "ayd-status" + (kind ? " ayd-status--" + kind : "");
}

function showAnswer(text) {
  const el = $("aydAnswer");
  el.textContent = text;
  el.hidden = false;
}

function hideAnswer() {
  const el = $("aydAnswer");
  el.hidden = true;
  el.textContent = "";
}

// Key lives in this browser only (survives reloads, never saved into the
// workbook). For a version you hand out, proxy the call through a backend.
const AYD_KEY_LS = "ayd.anthropicKey";

function saveApiKey(key) {
  try {
    localStorage.setItem(AYD_KEY_LS, key);
  } catch (e) {
    /* private mode / storage disabled — fine, just won't persist */
  }
}

function restoreApiKey() {
  // 1) Local gitignored config file wins, if it set a key.
  const fromConfig = (window.AYD_CONFIG && window.AYD_CONFIG.apiKey || "").trim();
  if (fromConfig) {
    $("aydKey").value = fromConfig;
    return;
  }
  // 2) Otherwise fall back to a key typed into the panel earlier this browser.
  try {
    const k = localStorage.getItem(AYD_KEY_LS);
    if (k) $("aydKey").value = k;
  } catch (e) {
    /* ignore */
  }
}
