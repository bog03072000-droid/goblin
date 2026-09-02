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
