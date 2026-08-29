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
};

export type ProfileForgeApi = typeof api;

contextBridge.exposeInMainWorld('profileforge', api);
