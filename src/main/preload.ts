import { contextBridge, ipcRenderer } from 'electron';
import type { IpcChannel, IpcRequest } from '../shared/ipc/contracts';

/**
 * The only surface exposed to the renderer: a single invoke() function scoped
 * to known IPC channels. No fs/child_process/shell/process/db access is ever
 * exposed — contextIsolation + this bridge is what makes that enforceable.
 */
const api = {
  invoke: <C extends IpcChannel>(channel: C, payload: IpcRequest<C>): Promise<unknown> =>
    ipcRenderer.invoke(channel, payload),
  // A narrow, scoped exception to the invoke()-only surface above: this is a
  // main→renderer push (an update finishing download is not a response to
  // any renderer request), not a general event bus — only this one channel
  // is ever wired up.
  onUpdateAvailable: (callback: (info: { version: string }) => void): void => {
    ipcRenderer.on('pf:update-available', (_event, info: { version: string }) => callback(info));
  },
  installUpdate: (): void => {
    ipcRenderer.send('pf:update-install');
  },
};

export type ProfileForgeApi = typeof api;

contextBridge.exposeInMainWorld('profileforge', api);
