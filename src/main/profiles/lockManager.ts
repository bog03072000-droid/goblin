import fs from 'node:fs';
import path from 'node:path';

interface LockFileContents {
  pid: number;
  startedAt: string;
}

/**
 * File-based lock so a profile can only have one running browser instance at a
 * time. On startup, a stale lock (process no longer alive) is detected and
 * cleared automatically — profile *data* is never touched by this recovery.
 */
export class LockManager {
  private lockPath(profileDir: string): string {
    return path.join(profileDir, 'profile.lock');
  }

  isLocked(profileDir: string): boolean {
    const lockPath = this.lockPath(profileDir);
    if (!fs.existsSync(lockPath)) return false;
    const contents = this.readLock(profileDir);
    if (!contents) return false;
    if (this.isProcessAlive(contents.pid)) return true;
    // Stale lock: process is gone. Clear it and report unlocked.
    fs.rmSync(lockPath, { force: true });
    return false;
  }

  acquire(profileDir: string, pid: number): void {
    if (this.isLocked(profileDir)) {
      throw new Error('Profile is already running (locked)');
    }
    const contents: LockFileContents = { pid, startedAt: new Date().toISOString() };
    fs.writeFileSync(this.lockPath(profileDir), JSON.stringify(contents), 'utf-8');
  }

  release(profileDir: string): void {
    fs.rmSync(this.lockPath(profileDir), { force: true });
  }

  private readLock(profileDir: string): LockFileContents | null {
    try {
      return JSON.parse(fs.readFileSync(this.lockPath(profileDir), 'utf-8')) as LockFileContents;
    } catch {
      return null;
    }
  }

  private isProcessAlive(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }
}
