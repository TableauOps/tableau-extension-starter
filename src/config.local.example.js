/* =============================================================
   Local config (template)
   -------------------------------------------------------------
   Copy this file to "config.local.js" (same folder) and paste
   your Anthropic API key below. config.local.js is gitignored,
   so your key never gets committed.

       cp src/config.local.example.js src/config.local.js

   The panel reads window.AYD_CONFIG.apiKey on load and pre-fills
   the key field, so you don't have to type it after every reload.
   Leave apiKey as "" to fall back to typing it in the panel.
   ============================================================= */

window.AYD_CONFIG = {
  apiKey: "", // e.g. "sk-ant-..."
};
