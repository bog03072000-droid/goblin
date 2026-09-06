import fs from 'node:fs';

/**
 * `fs.rmSync(userDataDir, { recursive: true, force: true })` right after
 * `app.close()` can lose a race: Chromium's process exit doesn't guarantee
 * the OS has released every handle on its LevelDB/dictionary files yet, so
 * the delete throws EBUSY/EPERM. Measured on a real Windows dev machine
 * (not just CI): this genuinely varies run to run, from instant to well
 * over 10s of real wall-clock time (confirmed by direct measurement, not
 * guesswork) — no fixed retry budget can be both fast and guaranteed
 * sufficient. Retrying with backoff is still worthwhile (it resolves the
 * overwhelming majority of cases quickly, keeping the OS temp dir clean),
 * but exhausting the budget swallows the error instead of throwing: this
 * is best-effort cleanup of a `mkdtempSync` directory in `os.tmpdir()` on a
 * runner that gets torn down after the job anyway, so a slow-to-release
 * handle should never turn a test whose actual assertions already passed
 * into a failing one over a leftover temp directory.
 */
export async function rmSyncWithRetry(
  targetPath: string,
  attempts = 6,
  delayMs = 400,
): Promise<void> {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      fs.rmSync(targetPath, { recursive: true, force: true });
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'EBUSY' && code !== 'EPERM') {
        throw err;
      }
      if (attempt === attempts) {
        // eslint-disable-next-line no-console
        console.warn(`rmSyncWithRetry: giving up deleting ${targetPath} after ${attempts} attempts (${code}) — leaving it for OS temp cleanup`);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs * attempt));
    }
  }
}
