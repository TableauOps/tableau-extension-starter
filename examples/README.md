# Viz Extension Suite — Radial Bar Chart + Calendar Heatmap + Pretty Table

A set of worksheet **viz extensions** that share one core:

- **Radial Bar Chart** — bars arranged around a circle (length = measure), as
  *concentric arcs* or *filled wedges*. Fully restyleable from a built-in
  **Configure…** dialog with live preview.
- **Calendar Heatmap** — dates laid out as a weeks × weekdays grid, each cell
  colored by a measure, with marginal weekly/weekday sum bars.
- **Pretty Table** — a clean, sticky-header HTML table of the worksheet's summary
  data. Drop any number of dimensions or measures on **Columns**; each field
  becomes a column. Click-to-sort (asc → desc → off, with a secondary
  tiebreaker), live search, 30-row pagination, a **View** menu (light/dark theme,
  three row densities, zebra striping, and numeric data-bars / heatmap / dots),
  CSV export with a column picker, and a **Configure…** dialog that persists
  per-column settings (label, type, width, decimals, visibility, render mode),
  default sort, appearance, and a custom empty state to the workbook.

All three are **interactive Tableau marks**: click a bar / cell / table row to
select its underlying rows. Each extension selects on its own worksheet, and
Tableau's dashboard **filter / highlight actions** then carry that selection to
the other viz on the dashboard — so the three interact with one another. (Set the
worksheet to *Use as Filter*, or add filter/highlight actions, to propagate.)
Ctrl/Cmd/Shift-click adds to the selection; plain-clicking the current selection
again clears it. Radial and Heatmap also show rich tooltips of each encoding
field using Tableau's own formatted values.

## Layout

Each extension lives in its own folder; `lib/` and `tableau-core.js` are shared
at the root and **all three** extensions are served from one localhost server
(`server.js`) on a single port.

```
.
├── tableau-core.js         shared core: init, events, encoding/data reading,
│                           selection, tooltips, formatting (used by both)
├── lib/                    bundled Tableau Extensions API (works offline)
├── radial/
│   ├── radial-barchart.trex   manifest → http://localhost:1111/radial/index.html
│   ├── index.html / radial-barchart.js   the viz
│   ├── config.html / config.js           Configure dialog (live preview)
│   └── shared.js                         option schema + settings helpers
├── heatmap/
│   ├── heatmap.trex            manifest → http://localhost:1111/heatmap/heatmap.html
│   ├── heatmap.html / heatmap.js         the viz
│   └── heatmap-config.html / heatmap-config.js   Configure dialog + option schema
└── pretty-table/
    ├── pretty-table.trex       manifest → http://localhost:1111/pretty-table/pretty-table.html
    └── pretty-table.html / pretty-table.js   the viz (one "Columns" encoding)
```

The chart HTML loads the shared assets with `../lib/…` and `../tableau-core.js`.
No build step and no external dependencies — the two charts are hand-drawn SVG
and Pretty Table is plain HTML.

> **In a hurry?** See [QUICKSTART.md](QUICKSTART.md) for the 4-step version.

## Run it

1. **Serve the project root over HTTP on port 1111** — one server feeds all
   three extensions (`/radial/…`, `/heatmap/…`, `/pretty-table/…`):

   ```bash
   npm start          # uses the bundled zero-dependency server.js
   # or, equivalently:
   node server.js
   # set a different port:
   PORT=8080 node server.js   # then update each .trex <url>
   ```

   Or use the one-click launchers: **`start.bat`** (Windows, double-clickable)
   or **`./start.sh`** (macOS/Linux). Both just run `node server.js`.

   No install step — `server.js` has no dependencies. (Any static server on
   port 1111 also works, e.g. `npx serve -l 1111 .` or
   `python -m http.server 1111`.)

   > Tableau **Desktop** allows `http://localhost`. Tableau **Cloud/Server**
   > require **HTTPS** — host the files behind TLS and update the `<url>` in each
   > `.trex` to match.

2. **Add it to a worksheet** in Tableau Desktop:
   - Build a viz with one dimension and one measure.
   - On the **Marks** card, change the mark-type dropdown to **Add Extension…**
     (or *Worksheet ▸ Add Extension*) and choose `radial-barchart.trex`.
   - Accept the permissions prompt.

3. **Map fields**: drag your dimension onto the **Category** tile and your
   measure onto the **Value** tile on the Marks card. Optionally drop a field on
   **Color** to color the bars by a measure (gradient) or dimension (palette) —
   it overrides the color settings; leave it empty to use the configured colors.

   **Interactivity:** hover a bar for a tooltip listing every encoding field
   (formatted by Tableau); click a bar to select its rows (Ctrl/Cmd/Shift-click
   to add to the selection) — this drives dashboard filter & highlight actions.

4. **Customize**: click the **Configure…** item on the Marks card (or right-click
   the viz ▸ Configure) to open the modal. Changes apply to the chart **live** as
   you edit (no Save needed). **Done** keeps them, **Cancel** reverts to how the
   chart looked when you opened the dialog, and **Reset to defaults** restores the
   built-in defaults.

## What's configurable

- **Chart style** — *Concentric arcs* (one rounded arc per category at its own
  radius, sweeping over faint full-circle tracks — the default) or *Filled
  wedges* (annular sectors fanned around the circle).
- **Layout** — title, start/end angle (full circle or any arc), inner & outer
  radius, gap between bars/rings, rounded ends.
- **Color** — single color, value-driven sequential gradient, or a categorical
  palette (Bright / Tableau 10 / Category 10 / Pastel / Warm / Cool); opacity;
  bar border; background.
- **Labels** — category labels, value labels, decimals, font size, color.
- **Reference rings** — concentric grid rings with adjustable count & color.
- **Data** — sort (value/label/data order) and a max-bars cap.

Settings are stored in the workbook via `tableau.extensions.settings`, so they
travel with the `.twb`/`.twbx` and reload automatically.
