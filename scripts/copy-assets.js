const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

fs.mkdirSync(path.join(root, 'dist-electron', 'main', 'browser'), { recursive: true });
for (const file of ['browser-shell.html', 'browser-shell.js', 'diagnostics.html']) {
  fs.copyFileSync(
    path.join(root, 'src', 'main', 'browser', file),
    path.join(root, 'dist-electron', 'main', 'browser', file),
  );
}

// Runtime BrowserWindow icon (distinct from build.win.icon in package.json,
// which electron-builder bakes into the .exe itself) — copied alongside the
// compiled main process so both the manager window and per-profile windows
// can reference it at a stable relative path in dev and packaged builds alike.
fs.copyFileSync(path.join(root, 'build', 'icon.png'), path.join(root, 'dist-electron', 'icon.png'));
