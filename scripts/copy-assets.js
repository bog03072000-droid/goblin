const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

fs.mkdirSync(path.join(root, 'dist-electron', 'main', 'browser'), { recursive: true });
for (const file of ['browser-shell.html', 'diagnostics.html']) {
  fs.copyFileSync(
    path.join(root, 'src', 'main', 'browser', file),
    path.join(root, 'dist-electron', 'main', 'browser', file),
  );
}
