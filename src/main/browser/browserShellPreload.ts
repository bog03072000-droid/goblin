import { contextBridge, ipcRenderer } from 'electron';

export interface DownloadEvent {
  id: string;
  filename: string;
  savePath: string;
  state: 'started' | 'progressing' | 'completed' | 'cancelled' | 'failed';
  receivedBytes: number;
  totalBytes: number;
}

/** Exposed only to browser-shell.html itself (the host window, loaded via
 * win.loadFile — never a remote origin) so its toolbar can render a
 * Downloads list and act on entries without needing nodeIntegration. */
contextBridge.exposeInMainWorld('pfDownloads', {
  onEvent: (cb: (event: DownloadEvent) => void): void => {
    ipcRenderer.on('pf:download-event', (_e, payload: DownloadEvent) => cb(payload));
  },
  open: (id: string): void => {
    ipcRenderer.send('pf:download-open', id);
  },
  showInFolder: (id: string): void => {
    ipcRenderer.send('pf:download-show', id);
  },
  cancel: (id: string): void => {
    ipcRenderer.send('pf:download-cancel', id);
  },
});

/** Routes explicit navigation (address bar, Home button, duplicate-tab) through
 * the main process's own webContents.loadURL() instead of the <webview> tag's
 * `src` attribute — see profileWindowEntry.ts's did-attach-webview comment for
 * why: attribute-based navigation goes through the webview guest-bridge's own
 * internal IPC hop, whose latency under CI-runner load raced (and sometimes
 * lost to) the main process's own loadURL() call for the default start page,
 * with no deterministic ordering between the two paths. Routing both through
 * main-process loadURL() calls makes ordering a single-threaded JS call order
 * instead — deterministic by construction. */
contextBridge.exposeInMainWorld('pfNav', {
  navigate: (webContentsId: number, url: string): void => {
    ipcRenderer.send('pf:navigate', webContentsId, url);
  },
});

/** Lets the toolbar's "Test human input" button (see README's Automation
 * section) trigger a real humanClick+humanScroll against whatever page is
 * currently loaded in this tab — see profileWindowEntry.ts's
 * 'pf:test-human-input' handler for what it actually does. A visual,
 * no-script-required way to confirm the feature works, distinct from
 * actually using it via an external automation client. */
contextBridge.exposeInMainWorld('pfHumanInput', {
  test: (webContentsId: number): Promise<{ ok: boolean }> => ipcRenderer.invoke('pf:test-human-input', webContentsId),
});

export interface WarmupProgressEvent {
  index: number;
  total: number;
  url: string;
  status: 'loading' | 'browsing' | 'done' | 'error' | 'skipped-invalid-url';
  error?: string;
}

/** Lets the toolbar's "Warm up profile" button (see README's Automation
 * section — the Cookie-Robot-style feature) drive a real sequence of
 * page visits against whatever tab is currently active, over the same
 * `webContents.debugger` CDP session pattern `pfHumanInput` already uses —
 * see profileWindowEntry.ts's 'pf:warmup' handler for what it actually
 * does. `onProgress` reports each page as it's visited so the panel can
 * show a live "3/8: https://..." status rather than a single opaque wait. */
contextBridge.exposeInMainWorld('pfWarmup', {
  run: (webContentsId: number, urls: string[], durationSeconds: number): Promise<{ visited: number; skipped: number }> =>
    ipcRenderer.invoke('pf:warmup', webContentsId, urls, durationSeconds),
  onProgress: (cb: (progress: WarmupProgressEvent) => void): void => {
    ipcRenderer.on('pf:warmup-progress', (_e, payload: WarmupProgressEvent) => cb(payload));
  },
});

