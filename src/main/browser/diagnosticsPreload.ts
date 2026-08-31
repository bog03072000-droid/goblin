import { contextBridge, ipcRenderer } from 'electron';

/**
 * Forced onto every profile webview by `will-attach-webview` in
 * profileWindowEntry.ts, so a loaded page can never request a different
 * preload for itself. Two independent jobs live here now:
 *
 * 1. The diagnostics report bridge (unchanged) — gated to our own
 *    `profileforge://` origin only, since this same webview also loads
 *    whatever real sites the user browses to.
 *
 * 2. Fingerprint spoofing script injection — runs for EVERY origin (real
 *    sites included), and replaces what used to be a CDP
 *    `Page.addScriptToEvaluateOnNewDocument` call from the main process
 *    (see fingerprintEnforcement.ts / docs/FINGERPRINT_AUDIT.md,
 *    "CDP footprint reduction"). The script itself (canvas/audio/WebGL/
 *    deviceMemory/fonts/mediaDevices patches + the Worker/SharedWorker
 *    propagation) is generated server-side per profile by
 *    buildSpoofingScript() and fetched here via a synchronous IPC call —
 *    synchronous specifically so this still runs, and finishes, before the
 *    guest page's own scripts get a chance to run, the same ordering
 *    guarantee `Page.addScriptToEvaluateOnNewDocument` gave.
 *
 *    The actual injection uses the classic "insert a same-document <script>
 *    element with inline text content" technique: under contextIsolation,
 *    a preload script's own JS scope cannot reach the guest page's MAIN
 *    world prototypes directly (that boundary is the whole point of
 *    contextIsolation) — but the DOM tree itself is shared, and a <script>
 *    node with inline content executes synchronously, in the MAIN world,
 *    the instant it's attached to the live document.
 *
 *    `document.documentElement` is `null` at the exact instant this preload
 *    runs on this Chromium build — verified empirically (a naive immediate
 *    `document.documentElement.appendChild(...)` threw on every single
 *    navigation, silently, discovered via a temporary file-based IPC trace
 *    since neither this preload's own isolated-world globals nor the child
 *    profile process's stdout are otherwise observable). A `MutationObserver`
 *    on `document` itself (which always exists) fires the instant
 *    `documentElement` is inserted — a microtask, so it still lands before
 *    the parser continues on to any of the page's own `<script>` tags.
 */
if (location.protocol === 'profileforge:') {
  contextBridge.exposeInMainWorld('pfDiagnostics', {
    report: (data: unknown): void => {
      ipcRenderer.send('pf:diagnostics-report', data);
    },
  });
}

function injectSpoofingScript(): void {
  try {
    const script = ipcRenderer.sendSync('pf:get-spoofing-script') as string;
    if (!script) return;
    const el = document.createElement('script');
    el.textContent = script;
    document.documentElement.appendChild(el);
    el.remove();
  } catch (err) {
    // Never let a spoofing-injection failure break real browsing — the
    // guest page still loads normally, just without this stage's overrides.
    console.error('[ProfileForge] fingerprint spoofing script injection failed:', err);
  }
}

if (document.documentElement) {
  injectSpoofingScript();
} else {
  const observer = new MutationObserver(() => {
    if (document.documentElement) {
      observer.disconnect();
      injectSpoofingScript();
    }
  });
  observer.observe(document, { childList: true, subtree: true });
}
