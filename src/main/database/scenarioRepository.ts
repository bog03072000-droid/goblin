import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { ScenarioStepSchema, type Scenario, type ScenarioStep } from '../../shared/schemas/scenario';

interface ScenarioRow {
  id: string;
  name: string;
  steps: string;
  created_at: string;
  updated_at: string;
}

function rowToScenario(row: ScenarioRow): Scenario {
  let steps: ScenarioStep[];
  try {
    steps = ScenarioStepSchema.array().parse(JSON.parse(row.steps));
  } catch {
    // A corrupted/foreign-shaped steps value is tolerated as an empty
    // scenario (same "never crash reading a list over one bad row" posture
    // as SettingsRepository.getAll()'s per-key JSON.parse) rather than
    // taking down the whole scenarios list.
    steps = [];
  }
  return { id: row.id, name: row.name, steps, createdAt: row.created_at, updatedAt: row.updated_at };
}

export class ScenarioRepository {
  constructor(private readonly db: Database.Database) {}

  list(): Scenario[] {
    const rows = this.db.prepare('SELECT * FROM scenarios ORDER BY name').all() as ScenarioRow[];
    return rows.map(rowToScenario);
  }

  getById(id: string): Scenario | null {
    const row = this.db.prepare('SELECT * FROM scenarios WHERE id = ?').get(id) as ScenarioRow | undefined;
    return row ? rowToScenario(row) : null;
  }

  /** Creates a new scenario when `id` is omitted, or overwrites an existing
   * one's name/steps when `id` matches a real row (the Scenario panel's
   * "Save" button uses this for both "record a new one" and "re-save after
   * re-recording the same named scenario" without needing two IPC channels). */
  save(input: { id?: string; name: string; steps: ScenarioStep[] }): Scenario {
    const now = new Date().toISOString();
    if (input.id && this.getById(input.id)) {
      this.db
        .prepare('UPDATE scenarios SET name = ?, steps = ?, updated_at = ? WHERE id = ?')
        .run(input.name, JSON.stringify(input.steps), now, input.id);
      return this.getById(input.id)!;
    }
    const id = input.id ?? randomUUID();
    this.db
      .prepare('INSERT INTO scenarios (id, name, steps, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run(id, input.name, JSON.stringify(input.steps), now, now);
    return this.getById(id)!;
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM scenarios WHERE id = ?').run(id);
  }
}
