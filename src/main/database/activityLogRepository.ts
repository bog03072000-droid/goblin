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

export interface ActivityLogListOptions {
  limit: number;
  /** Cursor-based pagination: only rows with id strictly less than this are
   * returned, i.e. "the page before whatever ends in this id" — used for
   * "load more" rather than an offset, so a new row appearing between pages
   * (this table is append-only and actively growing) can never shift
   * already-seen rows into view again or skip one. */
  beforeId?: number;
  eventType?: ActivityEventType;
  profileId?: string;
  /** Case-insensitive substring match against the message field only. */
  search?: string;
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

  list(options: ActivityLogListOptions): ActivityLogEntry[] {
    const conditions: string[] = [];
    const params: Record<string, unknown> = { limit: options.limit };
    if (options.beforeId !== undefined) {
      conditions.push('id < @beforeId');
      params['beforeId'] = options.beforeId;
    }
    if (options.eventType) {
      conditions.push('event_type = @eventType');
      params['eventType'] = options.eventType;
    }
    if (options.profileId) {
      conditions.push('profile_id = @profileId');
      params['profileId'] = options.profileId;
    }
    if (options.search) {
      conditions.push('message LIKE @search ESCAPE \'\\\'');
      params['search'] = `%${options.search.replace(/[\\%_]/g, '\\$&')}%`;
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const rows = this.db
      .prepare(`SELECT * FROM activity_logs ${where} ORDER BY id DESC LIMIT @limit`)
      .all(params) as ActivityLogRow[];
    return rows.map(rowToEntry);
  }

  /** The single most recent row's id, or null if the table is empty — used
   * by the renderer's live-tail poll to detect "is there anything newer
   * than what I already have" without re-fetching/re-filtering the whole
   * page each tick. */
  latestId(): number | null {
    const row = this.db.prepare('SELECT id FROM activity_logs ORDER BY id DESC LIMIT 1').get() as
      | { id: number }
      | undefined;
    return row?.id ?? null;
  }
}
