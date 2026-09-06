// Tiny Electron entry point with one job: print the real, installed
// Chromium version this Electron binary embeds, then exit. Used by
// checkBrowserVersionSync.js (run under plain Node) to get a ground-truth
// process.versions.chrome value — that property only exists inside a real
// Electron process, never under plain Node, so this can't be inlined into
// the checker script itself.
const { app } = require('electron');

app.whenReady().then(() => {
  process.stdout.write(process.versions.chrome + '\n');
  app.exit(0);
});
