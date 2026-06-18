# Get started — Tableau Viz Extension workshop

Welcome! This gets you ready in about **5 minutes**. (Full reference:
[README.md](README.md). Building it: [CLAUDE.md](CLAUDE.md).)

## You'll need

- **Tableau Desktop 2024.2 or newer** — Viz Extensions don't exist before 2024.2.
- **Python 3 or Node** — to serve the folder locally (you almost certainly have one).
- Optional: **git** (there's a no-git path below).

---

## 1 · Get the repo

**With git:**

```bash
git clone https://github.com/TableauOps/tableau-extension-starter.git
cd tableau-extension-starter
```

**No git?** Open the repo on GitHub → green **Code** button → **Download ZIP** →
unzip it somewhere stable.

## 2 · Serve it on port 1234

From inside the project folder (the one containing `index.html`):

```bash
python -m http.server 1234
# or:  npx http-server -p 1234 -c-1
```

Leave it running. The extension is now live at `http://localhost:1234/index.html`.

> Serve **this folder** — the one with `index.html`. If you only have one server,
> it must be on port **1234** to match `manifest.trex`.

## 3 · Add it in Tableau

1. Open a worksheet (Superstore is perfect) and build any quick sheet so the
   **Marks card** is in play.
2. On the **Marks card**, open the mark-type dropdown (*Automatic / Bar / Line…*)
   → **Add Extension** → **Access Local Extensions** → choose **`manifest.trex`**.
   Click **Allow** if prompted.
3. Two tiles appear — **Dimension** and **Measure**. Drag a dimension onto one and
   a measure onto the other.
4. You'll see your data in a placeholder card. 🎉 **That's the checkpoint — you're
   set up.**

## 4 · Build it (the fun part)

Open the folder in **Claude Code** and follow [CLAUDE.md](CLAUDE.md). You replace
the **BUILD ZONE** in `src/viz.js` to draw your own chart — a table, a bar chart,
whatever you can describe.

```bash
claude
```

> After every code change, **Reload** the extension: mark-type dropdown → the
> extension's menu → **Reload**. Edits won't show until you do.

---

## If something's off

| Problem | Fix |
|---|---|
| Manifest greyed out / won't add | Tableau is older than **2024.2** (or extensions are disabled by policy). |
| Not in the mark-type dropdown | You're on a **dashboard** — viz extensions attach to a **worksheet's** Marks card. |
| Blank viz area | No fields on the **Dimension/Measure** tiles yet — drop some. |
| Nothing loads | Server not running, or you're not serving the folder that has `index.html`. |
| Edits don't show | Reload from the mark-type dropdown (see above). |

See you in the build. 👋
