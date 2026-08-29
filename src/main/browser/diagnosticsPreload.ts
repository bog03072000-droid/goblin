import { contextBridge, ipcRenderer } from 'electron';

/**
 * Narrow preload, forced onto the profile's webview by `will-attach-webview`
 * in profileWindowEntry.ts so a loaded page cannot request a different
 * preload for itself — but this same webview also loads whatever real sites
 * the user browses to, so the API is gated to our own `profileforge://`
 * origin here. Without this check, an arbitrary website loaded in the same
 * webview could call the exposed function to spoof a fake fingerprint
 * snapshot or spam the IPC channel.
 */
if (location.protocol === 'profileforge:') {
  contextBridge.exposeInMainWorld('pfDiagnostics', {
    report: (data: unknown): void => {
      ipcRenderer.send('pf:diagnostics-report', data);
    },
  });
}
