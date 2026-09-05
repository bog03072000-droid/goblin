import { contextBridge, ipcRenderer } from 'electron';

/**
 * Forced onto every profile webview by `will-attach-webview` in
 * profileWindowEntry.ts, so a loaded page can never request a different
 * preload for itself. Only job left here: the diagnostics report bridge —
 * gated to our own `profileforge://` origin only, since this same webview
 * also loads whatever real sites the user browses to.
 *
 * Fingerprint spoofing script injection used to happen here too (the
 * classic "insert a same-document <script> element with inline text
 * content" technique) but has moved to CDP
 * `Page.addScriptToEvaluateOnNewDocument` (`injectSpoofingScriptViaCdp()`
 * in fingerprintEnforcement.ts, called from profileWindowEntry.ts) — see
 * docs/FINGERPRINT_AUDIT.md's "Eighth attempt". A real, verified reason
 * forced that move: any site with a strict `script-src` CSP directive (no
 * `'unsafe-inline'`, no matching `nonce-`/`hash-` source — confirmed
 * directly on github.com's and x.com's real response headers) silently
 * blocks an inline `<script>` element like this one from executing at all,
 * which meant the *entire* spoofing script never ran there, not just one
 * field. CDP-injected scripts are exempt from the page's own CSP (the same
 * mechanism Puppeteer/Playwright's own `addInitScript()` relies on) and
 * are the authoritative injection path for every profile now, CSP or not.
 */
if (location.protocol === 'profileforge:') {
  contextBridge.exposeInMainWorld('pfDiagnostics', {
    report: (data: unknown): void => {
      ipcRenderer.send('pf:diagnostics-report', data);
    },
  });
}
