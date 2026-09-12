import { describe, it, expect, beforeEach } from 'vitest';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { createTestDb } from '../../src/main/database/db';
import { ScenarioRepository } from '../../src/main/database/scenarioRepository';

const migrationsDir = path.join(__dirname, '../../database/migrations');

describe('ScenarioRepository', () => {
  let db: Database.Database;
  let repo: ScenarioRepository;

  beforeEach(() => {
    db = createTestDb(migrationsDir);
    repo = new ScenarioRepository(db);
  });

  it('returns an empty list when nothing has been saved', () => {
    expect(repo.list()).toEqual([]);
  });

  it('save() with no id creates a new scenario with a real generated id', () => {
    const steps = [{ type: 'click' as const, x: 10, y: 20, delayMs: 0 }];
    const saved = repo.save({ name: 'My Scenario', steps });

    expect(saved.id).toBeTruthy();
    expect(saved.name).toBe('My Scenario');
    expect(saved.steps).toEqual(steps);
    expect(repo.getById(saved.id)).toEqual(saved);
  });

  it('save() with an existing id overwrites that scenario in place, not creating a duplicate', () => {
    const first = repo.save({ name: 'Original', steps: [{ type: 'type', text: 'hello', delayMs: 0 }] });

    const updated = repo.save({ id: first.id, name: 'Renamed', steps: [{ type: 'navigate', url: 'https://example.com', delayMs: 0 }] });

    expect(updated.id).toBe(first.id);
    expect(repo.list()).toHaveLength(1);
    expect(repo.getById(first.id)!.name).toBe('Renamed');
    expect(repo.getById(first.id)!.steps).toEqual([{ type: 'navigate', url: 'https://example.com', delayMs: 0 }]);
  });

  it('save() with an id that does not match any existing row creates a new one with that id', () => {
    const saved = repo.save({ id: 'not-a-real-existing-id', name: 'Fresh', steps: [] });
    expect(saved.id).toBe('not-a-real-existing-id');
    expect(repo.list()).toHaveLength(1);
  });

  it('delete() removes a scenario', () => {
    const saved = repo.save({ name: 'ToDelete', steps: [] });
    repo.delete(saved.id);
    expect(repo.getById(saved.id)).toBeNull();
  });

  it('list() is ordered by name', () => {
    repo.save({ name: 'Zebra', steps: [] });
    repo.save({ name: 'Apple', steps: [] });
    expect(repo.list().map((s) => s.name)).toEqual(['Apple', 'Zebra']);
  });

  it('tolerates a corrupted steps column as an empty steps array rather than crashing', () => {
    const saved = repo.save({ name: 'Corrupted', steps: [{ type: 'click', x: 1, y: 2, delayMs: 0 }] });
    db.prepare('UPDATE scenarios SET steps = ? WHERE id = ?').run('{not-valid-json', saved.id);

    expect(repo.getById(saved.id)!.steps).toEqual([]);
  });
});
