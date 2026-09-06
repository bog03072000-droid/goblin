// Tiny Electron entry point with one job: print the real, installed
// Chromium AND Node versions this Electron binary embeds, then exit.
// process.versions.chrome/node only exist inside a real Electron process,
// never under plain Node — used by both checkBrowserVersionSync.js and
// checkDependencyEnginesSync.js (run under plain Node) to get ground-truth
// values without spawning Electron twice for two separate checks.
const { app } = require('electron');

app.whenReady().then(() => {
  process.stdout.write(JSON.stringify({ chrome: process.versions.chrome, node: process.versions.node }) + '\n');
  app.exit(0);
});
