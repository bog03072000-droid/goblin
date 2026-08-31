import type { IpcChannel, IpcRequest } from '@shared/ipc/contracts';

declare global {
  interface Window {
    profileforge: {
      invoke: (channel: IpcChannel, payload: unknown) => Promise<unknown>;
      onUpdateAvailable: (callback: (info: { version: string }) => void) => void;
      installUpdate: () => void;
    };
  }
}

export function callApi<C extends IpcChannel, R>(channel: C, payload: IpcRequest<C>): Promise<R> {
  return window.profileforge.invoke(channel, payload) as Promise<R>;
}
