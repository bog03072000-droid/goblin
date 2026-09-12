import fs from 'node:fs';
import path from 'node:path';

export interface PickedExtension {
  path: string;
  name: string;
  manifestVersion: number | null;
}

/**
 * Validates that `dir` is a real unpacked extension directory (has a real,
 * parseable `manifest.json`) and extracts the two fields worth showing the
 * user before they add it — split out of the `profiles:pickExtensionDirectory`
 * IPC handler (registerIpc.ts) specifically so this validation logic is
 * unit-testable without a real native dialog, the same "keep the dialog
 * call itself thin, put the real logic in a plain function" split
 * ImportExportService.importFromPaths() already uses for its own
 * dialog-driven imports. Throws a message meant to be shown to the user
 * directly (registerIpc.ts's `handle()` wrapper surfaces thrown messages as
 * the IPC rejection), not caught/re-wrapped here.
 */
export function validateExtensionDirectory(dir: string): PickedExtension {
  const manifestPath = path.join(dir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error('This folder has no manifest.json — pick the extension\'s own unpacked directory, not a parent folder');
  }
  let manifest: { name?: unknown; manifest_version?: unknown };
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as typeof manifest;
  } catch {
    throw new Error('manifest.json in this folder is not valid JSON');
  }
  return {
    path: dir,
    name: typeof manifest.name === 'string' ? manifest.name : dir,
    manifestVersion: typeof manifest.manifest_version === 'number' ? manifest.manifest_version : null,
  };
}
