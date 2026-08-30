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
