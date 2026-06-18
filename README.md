# Tableau Viz Extension — Starter

> 🚀 **New here? Start with [SETUP.md](SETUP.md)** — the 5-minute quick-start.

A **working, minimal** Tableau *Viz Extension* — a custom chart **type** that
renders inside a worksheet — that you customize live (great with Claude Code). It
ships connected and functional so a build never starts from a blank folder.

Out of the box it:
- connects to the worksheet via the Viz Extensions API,
- reads whatever fields you drop on its **Dimension** / **Measure** tiles,
- reads the worksheet's summary data, and
- renders a neutral placeholder card with a live preview of the data.

The **BUILD ZONE** in [`src/viz.js`](src/viz.js) is the one function you replace
to draw your own chart.

> **Requires Tableau 2024.2+** (Desktop or Cloud/Server). Viz Extensions did not
> exist before 2024.2 — the manifest won't load on older versions.

---

## Quick start (local, ~3 min)

Tableau loads an extension from a URL, so you serve the folder, then point a
worksheet's Marks card at the manifest.

1. **Serve this folder on port 1234.** From the project root:

   ```bash
   python -m http.server 1234
   # or
   npx http-server -p 1234 -c-1
   ```

   The extension is now at `http://localhost:1234/index.html` — the URL in
   `manifest.trex`.

2. **Open a worksheet** (Superstore is perfect). Build any sheet so the **Marks
   card** is in play.

3. **Add the extension.** On the **Marks card**, open the mark-type dropdown
   (the one that says *Automatic / Bar / Line…*) → **Add Extension** →
   **Access Local Extensions** → choose `manifest.trex` from this folder.

4. **Drop fields.** Two tiles appear on the Marks card — **Dimension** and
   **Measure**. Drag a dimension onto one and a measure onto the other. The
   placeholder card fills with your data.

> **Reload after each code change:** open the mark-type dropdown again → the
> extension's menu → **Reload** (or remove and re-add the extension).

---

## Hosting on GitHub Pages

Local works only on your machine. To use the extension in a shared or published
workbook, host the files over HTTPS.

1. Push this folder to a GitHub repo, then enable **Settings → Pages → Source:
   `main` / root**. Your site builds at
   `https://<your-username>.github.io/<your-repo>/index.html`.

2. Open **`manifest.hosted.trex`** and replace the placeholder `<url>` with that
   address.

3. In Tableau, add the extension using **`manifest.hosted.trex`** (not the local
   one).

**Two manifests, on purpose:** use `manifest.trex` (localhost) while you iterate,
and `manifest.hosted.trex` (Pages) for the finished version you hand out.

---

## Project layout

```
.
├── index.html                 # the #viz host + load order
├── manifest.trex              # LOCAL — worksheet-extension, localhost URL, encodings
├── manifest.hosted.trex       # HOSTED — same, with your Pages URL
├── lib/
│   └── tableau.extensions.1.latest.js   # official Extensions API (vendored)
├── src/
│   ├── viz.js                 # connect → encodings → data → BUILD ZONE (render)
│   └── style.css              # neutral placeholder styling
├── README.md
└── CLAUDE.md                  # prompts for building your viz live with Claude Code
```

---

## Make it yours

- **Encodings** — in `manifest.trex`, the `<encoding>` tiles are what users drop
  fields onto. Rename `Dimension` / `Measure`, add more, or remove one to fit
  your chart, then read them in `src/viz.js` (`getEncodedFields`).
- **The chart** — replace the `render(model)` function inside the **BUILD ZONE**
  in `src/viz.js`. `model` hands you the worksheet name, which field is on each
  encoding, the columns, and the rows.
- **Identity** — set the `author`, `<name>`, `id`, and `description` in both
  manifests.
- See **CLAUDE.md** for copy-paste prompts that turn the build zone into a real
  chart.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Manifest greyed out / won't add | Tableau is older than **2024.2** (Viz Extensions don't exist), or extensions are disabled by policy. |
| Not in the mark-type dropdown | You're on a dashboard, not a worksheet. Viz extensions attach to a **worksheet's Marks card**. |
| Blank viz area | No fields on the **Dimension/Measure** tiles yet — drop some. |
| `Could not initialize` / nothing | Local server not running, or the `<url>` ≠ the address you're serving from. |
| Edits not showing | Reload: mark-type dropdown → the extension's menu → **Reload**. |
| Works locally, not when published | You're still pointing at `localhost`. Host over HTTPS and update the `<url>`. |
