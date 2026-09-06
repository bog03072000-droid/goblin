// Shared by checkBrowserVersionSync.js and checkDependencyEnginesSync.js —
// both need ground-truth Chrome/Node versions from the REAL installed
// Electron binary (process.versions.chrome/node only exist inside an
// actual Electron process, never under plain Node, which is what these
// build-time check scripts otherwise run under). One spawn, both callers.
const { spawnSync } = require('node:child_process');
const path = require('node:path');

function getElectronRuntimeVersions() {
  const electronBin = require('electron');
  const printerScript = path.join(__dirname, '..', 'printElectronRuntimeVersions.js');
  const result = spawnSync(electronBin, [printerScript], { encoding: 'utf-8', timeout: 30_000 });
  if (result.error || result.status !== 0) {
    throw new Error(`Failed to launch Electron to read its real runtime versions: ${result.stderr || result.error}`);
  }
  // The last non-empty line, in case Electron prints unrelated stray
  // warnings to stdout before app.whenReady() resolves.
  const lines = result.stdout.split('\n').map((l) => l.trim()).filter(Boolean);
  const lastLine = lines[lines.length - 1];
  try {
    const parsed = JSON.parse(lastLine);
    if (!parsed.chrome || !parsed.node) throw new Error('missing chrome/node field');
    return parsed;
  } catch (err) {
    throw new Error(`Could not parse Electron's runtime-version output (${JSON.stringify(result.stdout)}): ${err.message}`);
  }
}

module.exports = { getElectronRuntimeVersions };
