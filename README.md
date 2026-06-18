# Dashboard Companion — Tableau Extension Starter

A **working** Tableau Dashboard Extension you can load in under five minutes, then
customize live with Claude Code. It ships connected and functional so a workshop
build never starts from a blank folder.

Out of the box it:
- connects to the dashboard via the Extensions API,
- shows the dashboard name and all worksheets,
- displays a **live count of selected marks**, and
- includes a working **Reset all filters** button.

The dashed **build zone** in the panel is where you'll add a new feature.

---

## What you need

- **Tableau Desktop** (2018.2+) or Tableau Server/Cloud with extensions enabled.
- A way to serve the folder locally — either **Python 3** or **Node**. You almost
  certainly already have one.

> Extensions must be served over `http://localhost` (dev) or `https://` (hosted).
> Opening `index.html` as a `file://` path will **not** work.

---

## Quick start (local, ~5 min)

1. **Unzip** this folder somewhere stable.

2. **Serve it.** From the project root, run one of:

   ```bash
   python3 -m http.server 8000
   ```
   ```bash
   npx serve -l 8000
   ```

   Leave that running. The extension is now at `http://localhost:8000/index.html`.

3. **Load it in Tableau.** Open a workbook with a dashboard (or build a quick one),
   then from the Objects pane drag **Extension** onto the dashboard.
   Choose **Access Local Extensions**, and select **`manifest.trex`** from this folder.

4. The **Dashboard Companion** panel appears. Click some marks — the count updates.
   Click **Reset all filters** to confirm it's live.

If the panel shows `init failed`, your local server isn't running or the `<url>` in
`manifest.trex` doesn't match the address you're serving from.

---

## Hosting it on GitHub Pages (tableauops)

Local works only on your machine. To use the extension in a shared or published
workbook, host the files over HTTPS. This repo is pre-wired for the **`tableauops`**
GitHub account via `manifest.hosted.trex`.

1. Create an empty repo named **`tableau-extension-starter`** under `tableauops`,
   then push this folder to it:

   ```bash
   cd tableau-extension-starter
   git init
   git add .
   git commit -m "Tableau extension starter"
   git branch -M main
   git remote add origin https://github.com/tableauops/tableau-extension-starter.git
   git push -u origin main
   ```

2. In the repo: **Settings → Pages → Source: `main` / root**. After it builds, the
   page is live at
   `https://tableauops.github.io/tableau-extension-starter/index.html`
   — which is exactly the URL already set in **`manifest.hosted.trex`**.

3. In Tableau, add the extension using **`manifest.hosted.trex`** (not the local one).

> Used a different repo name? Change that one segment in the `<url>` of
> `manifest.hosted.trex` to match. Everything else stays the same.

**Two manifests, on purpose:** use `manifest.trex` (localhost) for the live build
when you're iterating with Claude Code, and `manifest.hosted.trex` (GitHub Pages)
for the finished version you hand to attendees.

---

## Project structure

```
tableau-extension-starter/
├── index.html                 # the panel markup
├── manifest.trex              # LOCAL — load this for the live build
├── manifest.hosted.trex       # HOSTED — load this once it's on GitHub Pages
├── lib/
│   └── tableau.extensions.1.latest.js   # official Extensions API (vendored)
├── src/
│   ├── extension.js           # init + features + WORKSHOP ZONE
│   └── style.css              # panel styling
├── README.md
└── CLAUDE.md                  # prompts for building live with Claude Code
```

---

## Make it yours

- In `manifest.trex`, set the `author` fields and the `<name>` resource.
- In `src/extension.js`, the **WORKSHOP ZONE** comment marks where to build.
- See **CLAUDE.md** for copy-paste prompts that turn the build zone into a real
  feature (CSV export, range filter, persistent notes, and more).

## Troubleshooting

| Symptom | Fix |
|---|---|
| Panel blank / `init failed` | Local server not running, or `<url>` ≠ serve address. |
| "Extension not allowed" | Enable extensions: Help → Settings and Performance → Manage Extensions (Desktop), or have your admin allow it on Server/Cloud. |
| Works locally, not when published | You're still pointing at `localhost`. Host over HTTPS and update `<url>`. |
| A filter won't clear | Some filter types can't be cleared by the API; it's skipped and logged. |
