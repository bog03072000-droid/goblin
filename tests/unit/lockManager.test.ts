import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LockManager } from '../../src/main/profiles/lockManager';

describe('LockManager', () => {
  let dir: string;
  let lock: LockManager;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-lock-'));
    lock = new LockManager();
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('is unlocked initially', () => {
    expect(lock.isLocked(dir)).toBe(false);
  });

  it('locks with the current process and reports locked while alive', () => {
    lock.acquire(dir, process.pid);
    expect(lock.isLocked(dir)).toBe(true);
  });

  it('prevents acquiring a second lock while the first is held', () => {
    lock.acquire(dir, process.pid);
    expect(() => lock.acquire(dir, process.pid)).toThrow();
  });

  it('releases cleanly', () => {
    lock.acquire(dir, process.pid);
    lock.release(dir);
    expect(lock.isLocked(dir)).toBe(false);
  });

  it('recovers a stale lock left by a dead process without touching profile data', () => {
    // A PID astronomically unlikely to be alive.
    const deadPid = 999999;
    lock.acquire(dir, deadPid);
    fs.writeFileSync(path.join(dir, 'data.txt'), 'keep-me');

    expect(lock.isLocked(dir)).toBe(false); // stale lock detected and cleared
    expect(fs.readFileSync(path.join(dir, 'data.txt'), 'utf-8')).toBe('keep-me');
    lock.acquire(dir, process.pid); // can now be reacquired
    expect(lock.isLocked(dir)).toBe(true);
  });
});
