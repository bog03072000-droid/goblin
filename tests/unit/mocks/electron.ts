/** Stub for the 'electron' module so main-process unit tests can run under
 * plain Node (vitest) without a real Electron runtime. Encryption always
 * reports unavailable so credentialVault exercises its documented fallback path. */
export const safeStorage = {
  isEncryptionAvailable: (): boolean => false,
  encryptString: (s: string): Buffer => Buffer.from(s, 'utf-8'),
  decryptString: (b: Buffer): string => b.toString('utf-8'),
};
