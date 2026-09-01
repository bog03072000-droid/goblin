import { describe, it, expect, beforeEach } from 'vitest';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { createTestDb } from '../../src/main/database/db';
import { ActivityLogRepository } from '../../src/main/database/activityLogRepository';

const migrationsDir = path.join(__dirname, '../../database/migrations');

describe('ActivityLogRepository', () => {
  let db: Database.Database;
  let logs: ActivityLogRepository;

  beforeEach(() => {
    db = createTestDb(migrationsDir);
    logs = new ActivityLogRepository(db);
  });

  it('list() with no options returns entries newest-first, limited', () => {
    logs.record('PROFILE_CREATED', 'p1', 'created profile A');
    logs.record('PROFILE_STARTED', 'p1', 'started profile A');
    logs.record('PROFILE_STOPPED', 'p2', 'stopped profile B');

    const all = logs.list({ limit: 10 });
    expect(all).toHaveLength(3);
    expect(all[0]!.message).toBe('stopped profile B');
    expect(all[2]!.message).toBe('created profile A');

    expect(logs.list({ limit: 2 })).toHaveLength(2);
  });

  it('filters by eventType and by profileId independently', () => {
    logs.record('PROFILE_CREATED', 'p1', 'created A');
    logs.record('PROFILE_STARTED', 'p1', 'started A');
    logs.record('PROFILE_STARTED', 'p2', 'started B');

    const started = logs.list({ limit: 10, eventType: 'PROFILE_STARTED' });
    expect(started).toHaveLength(2);
    expect(started.every((e) => e.eventType === 'PROFILE_STARTED')).toBe(true);

    const forP1 = logs.list({ limit: 10, profileId: 'p1' });
    expect(forP1).toHaveLength(2);
    expect(forP1.every((e) => e.profileId === 'p1')).toBe(true);

    const startedForP2 = logs.list({ limit: 10, eventType: 'PROFILE_STARTED', profileId: 'p2' });
    expect(startedForP2).toHaveLength(1);
    expect(startedForP2[0]!.message).toBe('started B');
  });

  it('search matches message substrings case-insensitively and escapes LIKE wildcards literally', () => {
    logs.record('PROFILE_CREATED', 'p1', 'Created profile Quick Test');
    logs.record('PROFILE_STARTED', 'p1', 'unrelated entry');
    logs.record('PROFILE_UPDATED', 'p1', 'renamed to 100%_done');

    expect(logs.list({ limit: 10, search: 'quick' })).toHaveLength(1);
    expect(logs.list({ limit: 10, search: 'nomatch' })).toHaveLength(0);
    // A literal '%' in the search term must not act as a SQL LIKE wildcard.
    expect(logs.list({ limit: 10, search: '100%_done' })).toHaveLength(1);
  });

  it('beforeId cursor pagination returns strictly older, non-overlapping pages', () => {
    for (let i = 0; i < 5; i++) logs.record('PROFILE_CREATED', 'p1', `entry ${i}`);

    const page1 = logs.list({ limit: 2 });
    expect(page1.map((e) => e.message)).toEqual(['entry 4', 'entry 3']);

    const page2 = logs.list({ limit: 2, beforeId: page1[page1.length - 1]!.id });
    expect(page2.map((e) => e.message)).toEqual(['entry 2', 'entry 1']);

    const page3 = logs.list({ limit: 2, beforeId: page2[page2.length - 1]!.id });
    expect(page3.map((e) => e.message)).toEqual(['entry 0']);
  });

  it('latestId() reflects the most recently recorded row, and null when empty', () => {
    expect(logs.latestId()).toBeNull();
    logs.record('PROFILE_CREATED', 'p1', 'first');
    const firstId = logs.latestId();
    expect(firstId).not.toBeNull();
    logs.record('PROFILE_STARTED', 'p1', 'second');
    expect(logs.latestId()).toBeGreaterThan(firstId!);
  });
});
