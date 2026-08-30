/** Stub for the 'electron' module so main-process unit tests can run under
 * plain Node (vitest) without a real Electron runtime. Encryption always
 * reports unavailable so credentialVault exercises its documented fallback path. */
export const safeStorage = {
  isEncryptionAvailable: (): boolean => false,
  encryptString: (s: string): Buffer => Buffer.from(s, 'utf-8'),
  decryptString: (b: Buffer): string => b.toString('utf-8'),
};

import os from 'node:os';
import path from 'node:path';

/** Only the members importExport.ts/settingsRepository-adjacent code actually
 * calls in tests that exercise those modules directly (not via IPC). */
export const app = {
  getVersion: (): string => '0.0.0-test',
  getPath: (name: string): string => path.join(os.tmpdir(), 'profileforge-test-userdata', name),
};

export const dialog = {
  showSaveDialog: (): never => {
    throw new Error('dialog.showSaveDialog is not available in unit tests — call the underlying method directly');
  },
  showOpenDialog: (): never => {
    throw new Error('dialog.showOpenDialog is not available in unit tests — call the underlying method directly');
  },
};
