import fs from 'node:fs';
import * as XLSX from 'xlsx';
import { OsSchema, type Os } from '../../shared/schemas/fingerprint';

/** One row parsed from a bulk-import CSV/XLSX file, before any profile is
 * actually created. `row` is the 1-based spreadsheet row number a user would
 * see if they opened the file in Excel (header is row 1, so the first data
 * row is 2) — used only for error reporting, never for lookups. `error` is
 * set when this row is structurally invalid (bad/missing name, unrecognized
 * OS) and should never be sent to `commitBulkImportRows()`; a row with no
 * `error` here can still fail at commit time (e.g. a `proxyLabel` that
 * doesn't match any real proxy) since that requires live DB state this pure
 * parser deliberately has no access to. */
export interface BulkImportRow {
  row: number;
  name: string;
  os?: Os;
  proxyLabel?: string;
  groupName?: string;
  tags: string[];
  error?: string;
}

/** Hard cap on rows per file — not a realistic bulk-import size (500 already
 * covers "onboarding a whole team's worth of accounts at once"), but a real
 * ceiling so a malformed or hostile file can't queue an unbounded number of
 * profile-creation attempts. Checked before any row is parsed. */
export const MAX_BULK_IMPORT_ROWS = 500;

const VALID_OS_VALUES = new Set<string>(OsSchema.options);

/** Recognized column headers, matched case-insensitively — the file itself
 * can use any casing ("Name", "NAME", "name"). Only "name" is required;
 * every other column may be entirely absent from the file. */
const COLUMN_ALIASES = {
  name: ['name'],
  os: ['os', 'platform'],
  proxy: ['proxy', 'proxylabel', 'proxy label', 'proxy_label'],
  group: ['group', 'groupname', 'group name', 'group_name'],
  tags: ['tags'],
};

function findColumn(headerKeys: string[], aliases: string[]): string | undefined {
  return headerKeys.find((h) => aliases.includes(h.trim().toLowerCase()));
}

function cell(raw: Record<string, unknown>, key: string | undefined): string {
  if (!key) return '';
  const value = raw[key];
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

/** Reads a `.csv` or `.xlsx` file and turns it into structurally-validated
 * rows — no database access, no profile creation. Splitting parsing from
 * commit (see `commitBulkImportRows`) is what makes the "preview before you
 * create anything" step of the import wizard possible: this function's
 * output is exactly what the UI shows the user before they confirm. */
export function parseBulkImportFile(filePath: string): BulkImportRow[] {
  const isCsv = filePath.toLowerCase().endsWith('.csv');
  // FS: ',' is forced for CSV rather than left to SheetJS's own delimiter
  // auto-detection — a real bug caught in testing: a tags cell with several
  // semicolons in it (the documented tag separator) made auto-detection
  // guess ';' as the field separator instead of ',', silently merging every
  // column into one. This format always uses comma between columns and
  // semicolon only inside the tags cell, so the separator is never actually
  // ambiguous — it just isn't safe to leave to a heuristic.
  const workbook = isCsv
    ? XLSX.read(fs.readFileSync(filePath, 'utf-8'), { type: 'string', FS: ',' })
    : XLSX.read(fs.readFileSync(filePath), { type: 'buffer' });

  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) throw new Error('File contains no sheets');
  const sheet = workbook.Sheets[firstSheetName]!;
  const records = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });

  if (records.length === 0) throw new Error('File has no data rows (only a header, or completely empty)');
  if (records.length > MAX_BULK_IMPORT_ROWS) {
    throw new Error(`File has ${records.length} rows — the limit is ${MAX_BULK_IMPORT_ROWS} per import`);
  }

  const headerKeys = Object.keys(records[0]!);
  const nameKey = findColumn(headerKeys, COLUMN_ALIASES.name);
  if (!nameKey) {
    throw new Error('File has no "name" column — this is the only required column');
  }
  const osKey = findColumn(headerKeys, COLUMN_ALIASES.os);
  const proxyKey = findColumn(headerKeys, COLUMN_ALIASES.proxy);
  const groupKey = findColumn(headerKeys, COLUMN_ALIASES.group);
  const tagsKey = findColumn(headerKeys, COLUMN_ALIASES.tags);

  return records.map((record, i) => {
    const row = i + 2; // +1 for 0-based index, +1 for the header row itself
    const name = cell(record, nameKey);
    const osRaw = cell(record, osKey).toLowerCase();
    const proxyLabel = cell(record, proxyKey) || undefined;
    const groupName = cell(record, groupKey) || undefined;
    const tagsRaw = cell(record, tagsKey);
    const tags = tagsRaw
      ? tagsRaw
          .split(';')
          .map((t) => t.trim())
          .filter(Boolean)
      : [];

    if (!name) {
      return { row, name: '', tags, error: 'Name is required' };
    }
    if (osRaw && !VALID_OS_VALUES.has(osRaw)) {
      return {
        row,
        name,
        proxyLabel,
        groupName,
        tags,
        error: `Unknown OS "${osRaw}" — must be one of ${OsSchema.options.join(', ')}`,
      };
    }

    return {
      row,
      name,
      os: osRaw ? (osRaw as Os) : undefined,
      proxyLabel,
      groupName,
      tags,
    };
  });
}
