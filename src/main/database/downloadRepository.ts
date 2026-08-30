import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type { DownloadRecord } from '../../shared/schemas/download';

interface DownloadRow {
  id: string;
  profile_id: string;
  filename: string;
  save_path: string;
  url: string;
  total_bytes: number;
  state: string;
  created_at: string;
  updated_at: string;
}

export interface DownloadCreateInput {
  profileId: string;
  filename: string;
  savePath: string;
  url: string;
  totalBytes: number;
  state: DownloadRecord['state'];
}

export interface DownloadListFilters {
  profileId?: string;
  search?: string;
  dateFrom?: string;
  dateTo?: string;
}

function rowToDownload(row: DownloadRow): DownloadRecord {
  return {
    id: row.id,
    profileId: row.profile_id,
    filename: row.filename,
    savePath: row.save_path,
    url: row.url,
    totalBytes: row.total_bytes,
    state: row.state as DownloadRecord['state'],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Written to both from the manager process (deletion via the Downloads page)
 * and from each per-profile child process (recording a terminal download
 * outcome) — safe because `getDb()` puts the underlying SQLite file in WAL
 * mode, which is what makes multiple OS processes writing to the same file
 * a supported, real SQLite usage pattern rather than a race. */
export class DownloadRepository {
  constructor(private readonly db: Database.Database) {}

  create(input: DownloadCreateInput): DownloadRecord {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO downloads (id, profile_id, filename, save_path, url, total_bytes, state, created_at, updated_at)
         VALUES (@id, @profileId, @filename, @savePath, @url, @totalBytes, @state, @createdAt, @updatedAt)`,
      )
      .run({ id, ...input, createdAt: now, updatedAt: now });
    return this.getById(id)!;
  }

  getById(id: string): DownloadRecord | null {
    const row = this.db.prepare('SELECT * FROM downloads WHERE id = ?').get(id) as DownloadRow | undefined;
    return row ? rowToDownload(row) : null;
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM downloads WHERE id = ?').run(id);
  }

  list(filters: DownloadListFilters = {}): DownloadRecord[] {
    let sql = 'SELECT * FROM downloads WHERE 1=1';
    const params: Record<string, unknown> = {};
    if (filters.profileId) {
      sql += ' AND profile_id = @profileId';
      params['profileId'] = filters.profileId;
    }
    if (filters.search) {
      sql += ' AND filename LIKE @search';
      params['search'] = `%${filters.search}%`;
    }
    if (filters.dateFrom) {
      sql += ' AND created_at >= @dateFrom';
      params['dateFrom'] = filters.dateFrom;
    }
    if (filters.dateTo) {
      sql += ' AND created_at <= @dateTo';
      params['dateTo'] = filters.dateTo;
    }
    sql += ' ORDER BY created_at DESC';
    const rows = this.db.prepare(sql).all(params) as DownloadRow[];
    return rows.map(rowToDownload);
  }
}
