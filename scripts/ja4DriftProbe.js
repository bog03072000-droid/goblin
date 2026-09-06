// Tiny Electron entry point with one job: make a real HTTPS request through
// Chromium's actual network stack to a public TLS-fingerprint echo service
// and print its JSON response, then exit. Mirrors the exact method used in
// docs/FINGERPRINT_AUDIT.md's "Ninth investigation" (a real BrowserWindow
// navigating to tls.peet.ws, not a synthetic/mocked handshake) — this
// script just re-runs that same real capture on demand instead of as a
// one-off manual step.
const { app, BrowserWindow } = require('electron');

app.whenReady().then(async () => {
  try {
    const win = new BrowserWindow({ show: false, webPreferences: { sandbox: false } });
    await win.loadURL('https://tls.peet.ws/api/all');
    const bodyText = await win.webContents.executeJavaScript('document.body.innerText');
    process.stdout.write(bodyText + '\n');
    app.exit(0);
  } catch (err) {
    process.stderr.write(`ja4DriftProbe failed: ${err.message}\n`);
    app.exit(1);
  }
});
