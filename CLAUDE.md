# Build a Tableau Viz Extension with Claude Code

This is a **viz extension** starter — a custom Tableau chart *type* that renders
inside a worksheet. It already connects, reads the data, and draws a placeholder.
Your job is to replace the placeholder with a real chart. Open this folder in
Claude Code (`claude` in the project root) and work the steps below.

> Requires **Tableau 2024.2+**. Everything runs locally in the worksheet — no
> servers to call, no API keys.

## Orient Claude (paste once)

> This is a Tableau **Viz Extension** (`<worksheet-extension>`). `src/viz.js`
> initializes the Extensions API, reads the encodings + summary data, and has a
> clearly marked **BUILD ZONE** with a `render(model)` function. `index.html`
> has `<div id="viz">` as the render target. Encodings are declared in
> `manifest.trex`. Replace `render(model)` to draw a chart from `model`; don't
> touch `lib/`. Explain each change briefly as you go.

## The pattern (what's already wired)

Every viz extension is the same four moves — only the last one changes:

1. **Connect** — `tableau.extensions.initializeAsync()`, then
   `worksheetContent.worksheet`.
2. **Encodings** — `getVisualSpecificationAsync()` tells you which field the user
   dropped on each tile (`dimension`, `measure`).
3. **Data** — `getSummaryDataReaderAsync()` → read pages → columns + rows.
4. **Draw** — render into `#viz`; re-render on `SummaryDataChanged`.

Steps 1–3 are done. You live in step 4 (the BUILD ZONE), where `render(model)`
receives:

```js
model.worksheet  // sheet name
model.fields     // { dimension: "Region", measure: "Sales", … }
model.columns    // [{ name, isNumeric }]
model.rows       // [["West", "$1,234"], …]  (formatted strings)
```

## Changing the inputs

Want different tiles? Edit the `<encoding>` entries in **both** manifests, then
read the new ids in `getEncodedFields`. For example, a heatmap might want
`row`, `column`, and `value`; a bar chart wants `category` and `measure`.

## Starter prompts (pick a chart, then climb)

> Replace `render(model)` so it draws an **SVG bar chart**: one bar per row, the
> `dimension` field for labels, the `measure` field for bar length. Scale bars to
> the max value, label each bar, and animate them growing in on each data change.

> Replace `render(model)` with a clean, sticky-header **HTML table** of
> `model.columns` / `model.rows`: tabular-figure numbers, zebra rows, and a row
> count. Right-align numeric columns (`column.isNumeric`).

Then add features one at a time — each is a self-contained checkpoint:

- **Sort** — click a header to sort rows; show a caret for the state.
- **Color** — add a third encoding and use it to color marks.
- **Tooltips** — rich hover cards (you own the DOM, so make them nice).
- **Number formatting, totals, export** — for tables.

## Workflow tips

- **Reload after every change:** mark-type dropdown → the extension's menu →
  **Reload**. Edits won't show until you do.
- Build a tiny test sheet first (Superstore: a dimension + a measure) so there's
  data to read.
- Paste any browser console error straight back to Claude.
- Keep `min-api-version` and the 2024.2+ requirement in mind — older Tableau
  won't load the manifest at all.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Manifest greyed out | Tableau < 2024.2, or extensions disabled. |
| Blank viz area | No fields on the encoding tiles — drop a dimension + measure. |
| Edits not showing | Reload the extension from the mark-type dropdown. |
| `Could not initialize` | Server not running, or `<url>` ≠ serve address. |
