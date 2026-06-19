# Quick Start

Three Tableau **worksheet viz extensions** — Radial Bar Chart, Calendar Heatmap,
and Pretty Table — all served from one local server.

You need: **Node.js v14+** ([nodejs.org](https://nodejs.org/)) and **Tableau
Desktop**. No install step, no build, no dependencies.

---

## 1. Start the server (one command)

All three extensions are served from a single origin on port **1111**.

| Platform | Command |
| --- | --- |
| **Windows** | double-click `start.bat`, or run `start.bat` |
| **macOS / Linux** | `./start.sh` |
| **Any** | `npm start`  (same as `node server.js`) |

You should see:

```
  Radial Bar Chart  http://localhost:1111/radial/index.html
  Calendar Heatmap  http://localhost:1111/heatmap/heatmap.html
  Pretty Table      http://localhost:1111/pretty-table/pretty-table.html
```

Leave this terminal running. Press **Ctrl+C** to stop.

> Different port? `PORT=8080 npm start` — then update the `<url>` in each `.trex`.

---

## 2. Add an extension to a worksheet

1. In Tableau Desktop, build a sheet with the fields each extension needs (below).
2. On the **Marks** card, open the mark-type dropdown → **Add Extension…**
   (or **Worksheet ▸ Add Extension**).
3. Choose **My Extensions** and pick the `.trex` file:
   - `radial/radial-barchart.trex`
   - `heatmap/heatmap.trex`
   - `pretty-table/pretty-table.trex`
4. Accept the permissions prompt.

---

## 3. Map the fields

| Extension | Drop on the Marks card |
| --- | --- |
| **Radial Bar Chart** | a dimension on **Category**, a measure on **Value**. Optional: a field on **Color** — a *measure* makes a gradient, a *dimension* uses a palette. |
| **Calendar Heatmap** | a date on **Date**, a measure on **Value**. |
| **Pretty Table** | any number of dimensions / measures on **Columns** — each becomes a table column. |

Click the **Configure…** item on the Marks card (or right-click ▸ Configure) to
restyle any of them — changes preview live.

---

## 4. Make them interact on a dashboard

Drop the sheets onto a dashboard, then either:

- Select a sheet → click the **Use as Filter** (funnel) icon, **or**
- **Dashboard ▸ Actions ▸ Add Action ▸ Filter**, with the source sheet → target
  sheet (add the reverse for two-way filtering).

Clicking a bar / cell / row now selects its rows and filters the other sheets.
Cross-filtering only works when the sheets share the **same underlying field**.

---

## Troubleshooting

- **Blank / "failed to load" panel** → the server isn't running, or it's on a
  different port than the `.trex` URL. Start it (step 1) and confirm
  `http://localhost:1111/radial/index.html` opens in a browser.
- **Changed a file but Tableau shows the old version** → remove the extension
  object from the sheet, re-add the `.trex`, and restart Tableau Desktop (its
  embedded browser caches aggressively).
- **Tableau Cloud / Server** → these require **HTTPS**. Host the files behind TLS
  and update the `<url>` in each `.trex`. `http://localhost` is Desktop-only.

See [README.md](README.md) for the full feature list and project layout.
