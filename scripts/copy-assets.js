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

// browser-shell.html is a plain static file (not Vite-bundled — see the
// note above), so it can't rely on Vite's asset resolution/hashing to find
// the self-hosted Inter font files under src/renderer/assets/fonts/. Copy
// just the weights that file's own <style> actually declares (400/500/600/700,
// latin+cyrillic+cyrillic-ext) into a fonts/ folder next to the compiled
// HTML, so its @font-face rules can reference them with a plain relative path.
const shellFontsDir = path.join(root, 'dist-electron', 'main', 'browser', 'fonts');
fs.mkdirSync(shellFontsDir, { recursive: true });
const rendererFontsDir = path.join(root, 'src', 'renderer', 'assets', 'fonts');
for (const file of fs.readdirSync(rendererFontsDir)) {
  if (file.startsWith('Inter-')) {
    fs.copyFileSync(path.join(rendererFontsDir, file), path.join(shellFontsDir, file));
  }
}

// Runtime BrowserWindow icon (distinct from build.win.icon in package.json,
// which electron-builder bakes into the .exe itself) — copied alongside the
// compiled main process so both the manager window and per-profile windows
// can reference it at a stable relative path in dev and packaged builds alike.
fs.copyFileSync(path.join(root, 'build', 'icon.png'), path.join(root, 'dist-electron', 'icon.png'));
