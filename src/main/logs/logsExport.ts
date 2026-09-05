import { dialog } from 'electron';
import fs from 'node:fs';
import type { ActivityLogRepository, ActivityLogListOptions } from '../database/activityLogRepository';
import type { ProfileRepository } from '../database/profileRepository';

export interface LogsCsvRow {
  createdAt: string;
  eventType: string;
  profileName: string;
  message: string;
}

/** RFC 4180-ish CSV escaping: a field containing a comma, double quote, or
 * newline is wrapped in double quotes with any internal double quote
 * doubled. Activity log messages are free-form text (e.g. a proxy error
 * message) and can contain any of these, so this can't be skipped the way
 * a fixed-format export sometimes gets away with. */
function escapeCsvField(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** Pure and independent of the database/dialog so it's directly unit-
 * testable — exportLogsToFile below is the thin, untestable-without-a-
 * real-Electron-dialog wrapper around this. */
export function buildLogsCsv(rows: LogsCsvRow[]): string {
  const header = ['Time', 'Event', 'Profile', 'Message'].join(',');
  const lines = rows.map((r) =>
    [r.createdAt, r.eventType, r.profileName, r.message].map(escapeCsvField).join(','),
  );
  return [header, ...lines].join('\r\n');
}

/** Exports every log entry matching the given filters (not just the
 * current page LogsPage.tsx has loaded via cursor pagination) to a
 * user-chosen .csv file. Returns the chosen path, or null if the user
 * cancelled the save dialog. A profileId that no longer resolves to a
 * profile (deleted since the log entry was recorded) falls back to the
 * raw id, same fallback LogsPage.tsx's own profileName() already uses. */
export async function exportLogsToFile(
  logs: ActivityLogRepository,
  profiles: ProfileRepository,
  filters: Pick<ActivityLogListOptions, 'eventType' | 'profileId' | 'search'>,
): Promise<string | null> {
  // No realistic activity log approaches this in practice, but an explicit
  // cap (rather than an unbounded query) keeps this from ever becoming an
  // accidental full-table scan with no upper bound at all.
  const entries = logs.list({ ...filters, limit: 1_000_000 });
  const rows: LogsCsvRow[] = entries.map((e) => ({
    createdAt: e.createdAt,
    eventType: e.eventType,
    profileName: e.profileId ? (profiles.getById(e.profileId)?.name ?? e.profileId) : '',
    message: e.message,
  }));
  const csv = buildLogsCsv(rows);

  const result = await dialog.showSaveDialog({
    title: 'Export Activity Log',
    defaultPath: 'goblinanty-logs-export.csv',
    filters: [{ name: 'CSV', extensions: ['csv'] }],
  });
  if (result.canceled || !result.filePath) return null;

  fs.writeFileSync(result.filePath, csv, 'utf-8');
  return result.filePath;
}
