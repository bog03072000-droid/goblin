import type Database from 'better-sqlite3';
import type { Template, TemplateDefinition } from '../../shared/schemas/template';

interface TemplateRow {
  id: string;
  name: string;
  definition: string;
  created_at: string;
}

/** The 6 built-in templates named in the project brief. Seeding is idempotent
 * (INSERT OR IGNORE keyed by id) so it's safe to call on every app start. */
const BUILTIN_TEMPLATES: Array<{ id: string; name: string; definition: TemplateDefinition }> = [
  { id: 'windows-desktop', name: 'Windows Desktop', definition: { os: 'windows' } },
  { id: 'windows-germany', name: 'Windows Germany', definition: { os: 'windows', locale: 'de-DE' } },
  { id: 'windows-france', name: 'Windows France', definition: { os: 'windows', locale: 'fr-FR' } },
  { id: 'windows-ukraine', name: 'Windows Ukraine', definition: { os: 'windows', locale: 'uk-UA' } },
  { id: 'macos-desktop', name: 'macOS Desktop', definition: { os: 'macos' } },
  { id: 'linux-desktop', name: 'Linux Desktop', definition: { os: 'linux' } },
];

function rowToTemplate(row: TemplateRow): Template {
  return {
    id: row.id,
    name: row.name,
    definition: JSON.parse(row.definition) as TemplateDefinition,
    createdAt: row.created_at,
  };
}

export class TemplateRepository {
  constructor(private readonly db: Database.Database) {}

  seedBuiltins(): void {
    const insert = this.db.prepare(
      'INSERT OR IGNORE INTO templates (id, name, definition, created_at) VALUES (?, ?, ?, ?)',
    );
    const now = new Date().toISOString();
    const seed = this.db.transaction(() => {
      for (const t of BUILTIN_TEMPLATES) {
        insert.run(t.id, t.name, JSON.stringify(t.definition), now);
      }
    });
    seed();
  }

  list(): Template[] {
    const rows = this.db.prepare('SELECT * FROM templates ORDER BY name').all() as TemplateRow[];
    return rows.map(rowToTemplate);
  }

  getById(id: string): Template | null {
    const row = this.db.prepare('SELECT * FROM templates WHERE id = ?').get(id) as TemplateRow | undefined;
    return row ? rowToTemplate(row) : null;
  }
}
