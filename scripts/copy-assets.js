const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

fs.mkdirSync(path.join(root, 'dist-electron', 'main', 'browser'), { recursive: true });
fs.copyFileSync(
  path.join(root, 'src', 'main', 'browser', 'browser-shell.html'),
  path.join(root, 'dist-electron', 'main', 'browser', 'browser-shell.html'),
);
