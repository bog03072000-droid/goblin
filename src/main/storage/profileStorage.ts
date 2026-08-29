import fs from 'node:fs';
import path from 'node:path';

const PROFILE_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * All profile storage paths are derived from this function alone — never from a
 * path supplied by the renderer. Rejects anything that isn't a well-formed UUID
 * to block path traversal (../, absolute paths, symlink names, etc).
 */
export function resolveProfileDir(profilesRoot: string, profileId: string): string {
  if (!PROFILE_ID_RE.test(profileId)) {
    throw new Error(`Invalid profile id: ${profileId}`);
  }
  const dir = path.join(profilesRoot, profileId);
  const resolved = path.resolve(dir);
  const resolvedRoot = path.resolve(profilesRoot);
  if (!resolved.startsWith(resolvedRoot + path.sep) && resolved !== resolvedRoot) {
    throw new Error('Resolved profile path escapes profiles root');
  }
  return resolved;
}

export function createProfileStorage(profilesRoot: string, profileId: string): string {
  const dir = resolveProfileDir(profilesRoot, profileId);
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(dir, 'browser-data'), { recursive: true });
  return dir;
}

export function deleteProfileStorage(profilesRoot: string, profileId: string): void {
  const dir = resolveProfileDir(profilesRoot, profileId);
  fs.rmSync(dir, { recursive: true, force: true });
}

export function clearProfileCache(profilesRoot: string, profileId: string): void {
  const dir = resolveProfileDir(profilesRoot, profileId);
  const cacheDir = path.join(dir, 'browser-data', 'Cache');
  fs.rmSync(cacheDir, { recursive: true, force: true });
}

export function profileStorageExists(profilesRoot: string, profileId: string): boolean {
  return fs.existsSync(resolveProfileDir(profilesRoot, profileId));
}

/** Copies full persistent browser-data directory tree for full-clone mode. */
export function copyProfileStorage(
  profilesRoot: string,
  sourceProfileId: string,
  destProfileId: string,
): void {
  const src = path.join(resolveProfileDir(profilesRoot, sourceProfileId), 'browser-data');
  const dest = path.join(resolveProfileDir(profilesRoot, destProfileId), 'browser-data');
  fs.mkdirSync(dest, { recursive: true });
  fs.cpSync(src, dest, { recursive: true });
}

export function backupProfile(profilesRoot: string, profileId: string, backupDir: string): string {
  const dir = resolveProfileDir(profilesRoot, profileId);
  fs.mkdirSync(backupDir, { recursive: true });
  const target = path.join(backupDir, `${profileId}-${Date.now()}`);
  fs.cpSync(dir, target, { recursive: true });
  return target;
}

export function restoreProfile(backupPath: string, profilesRoot: string, profileId: string): void {
  const dest = resolveProfileDir(profilesRoot, profileId);
  fs.rmSync(dest, { recursive: true, force: true });
  fs.cpSync(backupPath, dest, { recursive: true });
}
