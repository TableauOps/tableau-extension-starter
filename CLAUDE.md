# Build plan — "Ask Your Dashboard"

Turn the Dashboard Companion baseline into **Ask Your Dashboard**: a panel where
you type a question in plain English ("show me only the West region", "sales
between 0 and 500") and the dashboard filters itself — powered by Claude.

You'll use **Claude Code** to build an extension that **calls Claude**. That loop
is the whole demo. Open this project in Claude Code (`claude` in the project root)
and work the phases below in order.

## The arc (each phase is a working checkpoint)

| Phase | You'll have | Risk |
|---|---|---|
| 0 · Baseline | Connects, reads the dashboard (already in the repo) | none |
| 1 · Field map + manual filter | A real, useful filter panel — no AI yet | low |
| 2 · Natural language → filters | **The banger:** type a question, it filters | medium |
| 3 · Ask questions of the data | Claude answers, not just filters | stretch |

If you run short on time, stop after Phase 1 (complete extension) or Phase 2
(the wow). Phase 3 is gravy.

## Before you start (Phase 2+ only)

You need an **Anthropic API key** for the Claude calls. Get one at
console.anthropic.com. For the live build you'll paste it into the code or a
field in the panel. **This is fine for the demo with your own key**, but the key
is visible in the browser — for a version you hand out, proxy the call through a
small backend instead of calling the API directly. Say that out loud during the
workshop; it's a good teaching moment.

---

## Orient Claude (paste once)

> This is a Tableau Dashboard Extension. `src/extension.js` initializes the
> Extensions API and has baseline features plus a "WORKSHOP ZONE" comment.
> `index.html` has `<section id="workshop">` as the render target. We're building
> "Ask Your Dashboard" in phases. Add UI into `#workshop` and logic in the
> workshop zone of extension.js. Don't touch `lib/`. Explain each change briefly
> as you go.

---

## Phase 1 — Field map + manual filter

Goal: discover the dashboard's filterable fields and their values, show them, and
let the user apply a filter by hand. This proves the apply pipeline works before
any AI is involved.

**Prompt:**

> In the build zone, write a `discoverFields()` function: loop every worksheet,
> call `getFiltersAsync()`, and for each categorical filter call
> `getDomainAsync(tableau.FilterDomainType.Relevant)` to get its values, and for
> each range filter get its min/max. Dedupe by field name and return an array like
> `[{field, type, values}]`. Then render one dropdown per categorical field into
> `#workshop`; on change, apply that value with `applyFilterAsync(field, [value],
> tableau.FilterUpdateType.Replace)` on the worksheets that have it.

**Key code it should land on:**

```js
async function discoverFields() {
  const dashboard = tableau.extensions.dashboardContent.dashboard;
  const map = new Map();
  for (const ws of dashboard.worksheets) {
    for (const f of await ws.getFiltersAsync()) {
      if (map.has(f.fieldName)) continue;
      if (f.filterType === "categorical") {
        const d = await f.getDomainAsync(tableau.FilterDomainType.Relevant);
        map.set(f.fieldName, { field: f.fieldName, type: "categorical",
          values: d.values.map(v => v.formattedValue) });
      } else if (f.filterType === "range") {
        const d = await f.getDomainAsync(tableau.FilterDomainType.Relevant);
        map.set(f.fieldName, { field: f.fieldName, type: "range",
          min: d.min.value, max: d.max.value });
      }
    }
  }
  return [...map.values()];
}
```

**Checkpoint:** pick a value from a dropdown → the viz filters. You now have a
real extension.

---

## Phase 2 — Natural language → filters (the banger)

Goal: a text box. The user types a question; you send Claude the field map + the
question; Claude returns JSON describing which filters to apply; you validate it
against the real fields and apply them.

**Prompt:**

> Add a text input ("Ask your dashboard…") and a Send button to `#workshop`. On
> send, call `askClaude(question, fields)` which POSTs to the Anthropic API with
> the field map as context and returns parsed JSON. If the JSON action is
> "filter", apply each filter via `applyFilterAsync` / `applyRangeFilterAsync`,
> ignoring any field not in the real field map. Show a one-line summary of what
> was applied. Read the API key from a password input in the panel.

**The Claude call (client-side):**

```js
async function askClaude(question, fields) {
  const system =
    "You translate a user's plain-English request into Tableau filter actions. " +
    "Only use fields from this schema: " + JSON.stringify(fields) + ". " +
    "Respond with ONLY JSON, no prose, in this shape: " +
    '{"action":"filter","filters":[' +
    '{"field":"Region","type":"categorical","values":["West"]},' +
    '{"field":"Sales","type":"range","min":0,"max":500}]}' +
    ' or {"action":"answer","text":"..."} if it is a question, not a filter.';

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": API_KEY,                              // from the panel input
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true"
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",     // or "claude-haiku-4-5-20251001" for speed
      max_tokens: 1024,
      system,
      messages: [{ role: "user", content: question }]
    })
  });
  const data = await res.json();
  const text = data.content.map(b => b.text || "").join("");
  return JSON.parse(text);
}
```

**Applying the result (validate against real fields):**

```js
async function applyIntent(intent, fields) {
  const valid = new Set(fields.map(f => f.field));
  const dashboard = tableau.extensions.dashboardContent.dashboard;
  for (const flt of intent.filters || []) {
    if (!valid.has(flt.field)) continue;               // never trust blindly
    for (const ws of dashboard.worksheets) {
      const has = (await ws.getFiltersAsync()).some(f => f.fieldName === flt.field);
      if (!has) continue;
      if (flt.type === "categorical") {
        await ws.applyFilterAsync(flt.field, flt.values,
          tableau.FilterUpdateType.Replace);
      } else {
        await ws.applyRangeFilterAsync(flt.field,
          { min: flt.min, max: flt.max }, tableau.FilterUpdateType.Replace);
      }
    }
  }
}
```

**Checkpoint:** type "only the West region" → the dashboard filters to West. 🎤

---

## Phase 3 — Ask questions of the data (stretch)

Goal: when the user asks something that isn't a filter ("which region is
strongest?"), show Claude's answer instead.

**Prompt:**

> When `askClaude` returns `{"action":"answer","text":...}`, render that text in
> `#workshop` as the response. For richer answers, optionally pull a small summary
> with `worksheet.getSummaryDataAsync({ maxRows: 200 })`, send the rows along with
> the question, and let Claude reason over them. Keep maxRows small.

---

## Live demo script (what to type)

1. "show me only the West region"  → categorical filter
2. "sales between 0 and 500"        → range filter
3. "West region and sales over 1000" → two filters at once
4. (Phase 3) "which region is doing best?" → an answer
5. Click your baseline **Reset all filters** to clear and reset the room

## Model choice

- `claude-sonnet-4-6` — reliable default for intent parsing.
- `claude-haiku-4-5-20251001` — faster/cheaper, great for snappy live filtering.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `JSON.parse` fails | Tighten the system prompt: "Respond with ONLY JSON." Log the raw `text`. |
| Filter doesn't apply | The field isn't a filter on that worksheet — drop a Region/Category filter onto the dashboard first. |
| 401 from the API | API key missing or wrong in the panel input. |
| CORS error | Confirm the `anthropic-dangerous-direct-browser-access: true` header is set. |
| Model invents a field | The validation `Set` already drops unknown fields — confirm you're filtering on it. |

## Workflow tips

- Reload the extension in Tableau after each change (right-click → Reload).
- Build a tiny test dashboard first: one viz + a Region (categorical) and a Sales
  (range) filter, so Phase 1 has something to discover.
- Paste any browser console error straight back to Claude.

---

### Prefer a simpler build?
The earlier options (CSV export of selected marks, persistent notes, quick-filter
buttons) still work as drop-in alternatives — but "Ask Your Dashboard" is the one
that lands the Claude angle. Pick based on your comfort and the room.
