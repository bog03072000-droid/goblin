import { ipcMain, shell, type BrowserWindow, type DownloadItem, type Session } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { getDb } from '../database/db';
import { DownloadRepository } from '../database/downloadRepository';
import { migrationsDir } from './profileWindowArgs';
import type { DownloadEvent } from './browserShellPreload';

function uniqueSavePath(dir: string, filename: string): string {
  fs.mkdirSync(dir, { recursive: true });
  const ext = path.extname(filename);
  const base = path.basename(filename, ext);
  let candidate = path.join(dir, filename);
  let n = 1;
  while (fs.existsSync(candidate)) {
    candidate = path.join(dir, `${base} (${n})${ext}`);
    n++;
  }
  return candidate;
}

/** Recording is best-effort and lazily-connected: the manager app's own DB
 * migrations already ran by the time any profile is ever started (the
 * manager opens it at app startup, before its window/IPC even exist), so
 * this call only ever *reuses* an already-migrated file — it never races
 * schema creation. See docs — same WAL-mode file, second OS process. */
function recordDownload(
  dbPath: string | null,
  profileId: string,
  filename: string,
  savePath: string,
  url: string,
  totalBytes: number,
  state: 'completed' | 'cancelled' | 'failed',
): void {
  if (!dbPath) return;
  try {
    const db = getDb(dbPath, migrationsDir());
    new DownloadRepository(db).create({ profileId, filename, savePath, url, totalBytes, state });
  } catch (err) {
    console.error('[ProfileForge] failed to record download history:', err);
  }
}

/** Downloads are saved under this profile's own storage directory and
 * driven entirely by this profile's own session (`ses`) — since every
 * profile is a fully separate OS process with its own userDataDir and
 * session partition, there is no code path by which one profile's download
 * could land in, or even see, another profile's directory.
 *
 * Wires up `will-download` (save-path assignment, progress events forwarded
 * to the renderer, completion recorded to the shared activity DB) and the
 * three `pf:download-*` IPC handlers (open/show/cancel) the renderer's
 * Downloads panel uses. Extracted out of profileWindowEntry.ts as a
 * self-contained slice — nothing outside download handling touches the
 * `downloads` map or `nextDownloadId` counter this owns internally. */
export function setupDownloadHandling(options: {
  win: BrowserWindow;
  ses: Session;
  userDataDir: string;
  profileId: string;
  dbPath: string | null;
}): void {
  const { win, ses, userDataDir, profileId, dbPath } = options;
  const downloadsDir = path.join(userDataDir, 'downloads');
  const downloads = new Map<string, DownloadItem>();
  let nextDownloadId = 1;

  ses.on('will-download', (_event, item) => {
    const id = String(nextDownloadId++);
    const savePath = uniqueSavePath(downloadsDir, item.getFilename());
    item.setSavePath(savePath);
    downloads.set(id, item);

    const send = (state: DownloadEvent['state']): void => {
      win.webContents.send('pf:download-event', {
        id,
        filename: path.basename(savePath),
        savePath,
        state,
        receivedBytes: item.getReceivedBytes(),
        totalBytes: item.getTotalBytes(),
      } satisfies DownloadEvent);
    };
    send('started');

    item.on('updated', (_e, state) => {
      send(state === 'interrupted' ? 'failed' : 'progressing');
    });
    item.once('done', (_e, state) => {
      const finalState = state === 'completed' ? 'completed' : state === 'cancelled' ? 'cancelled' : 'failed';
      send(finalState);
      recordDownload(dbPath, profileId, path.basename(savePath), savePath, item.getURL(), item.getTotalBytes(), finalState);
    });
  });

  ipcMain.on('pf:download-open', (_e, id: string) => {
    const item = downloads.get(id);
    if (item) void shell.openPath(item.getSavePath());
  });
  ipcMain.on('pf:download-show', (_e, id: string) => {
    const item = downloads.get(id);
    if (item) shell.showItemInFolder(item.getSavePath());
  });
  ipcMain.on('pf:download-cancel', (_e, id: string) => {
    const item = downloads.get(id);
    if (item && item.getState() === 'progressing') item.cancel();
  });
}
