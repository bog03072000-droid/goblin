import type Database from 'better-sqlite3';
import type { ActivityEventType, ActivityLogEntry } from '../../shared/schemas/activityLog';

interface ActivityLogRow {
  id: number;
  event_type: string;
  profile_id: string | null;
  message: string;
  created_at: string;
}

function rowToEntry(row: ActivityLogRow): ActivityLogEntry {
  return {
    id: row.id,
    eventType: row.event_type as ActivityEventType,
    profileId: row.profile_id,
    message: row.message,
    createdAt: row.created_at,
  };
}

/** Records must never contain secrets (passwords, cookies, tokens) — see SECURITY.md. */
export class ActivityLogRepository {
  constructor(private readonly db: Database.Database) {}

  record(eventType: ActivityEventType, profileId: string | null, message: string): void {
    this.db
      .prepare(
        'INSERT INTO activity_logs (event_type, profile_id, message, created_at) VALUES (?, ?, ?, ?)',
      )
      .run(eventType, profileId, message, new Date().toISOString());
  }

  list(limit: number): ActivityLogEntry[] {
    const rows = this.db
      .prepare('SELECT * FROM activity_logs ORDER BY id DESC LIMIT ?')
      .all(limit) as ActivityLogRow[];
    return rows.map(rowToEntry);
  }
}
