import { dialog } from 'electron';
import type { FingerprintRepository } from '../database/fingerprintRepository';
import type { ProxyRepository } from '../database/proxyRepository';
import type { GroupRepository } from '../database/groupRepository';
import type { ActivityLogRepository } from '../database/activityLogRepository';
import type { ProfileManager } from './profileManager';
import type { Profile } from '../../shared/schemas/profile';
import { generateFingerprint } from '../fingerprint/generator';
import { parseBulkImportFile, type BulkImportRow } from './bulkCsvImport';

export interface BulkImportParseResult {
  fileName: string;
  rows: BulkImportRow[];
}

export interface BulkImportCommitResult {
  created: Profile[];
  errors: Array<{ row: number; message: string }>;
}

/**
 * Backs the "Bulk import from CSV/XLSX" wizard: parse-then-preview, then a
 * separate commit step the user explicitly confirms — unlike every other
 * import path in this app (ImportExportService's JSON/zip/GoLogin imports),
 * which all create profiles in the same round-trip as picking the file.
 * A spreadsheet import needs the extra step because a row's proxy/group
 * label is free text a user typed, not a validated id — the preview is what
 * lets them catch a typo'd proxy name before 50 profiles get created with
 * half of them silently missing a proxy they expected.
 */
export class BulkCsvImportService {
  constructor(
    private readonly fingerprints: FingerprintRepository,
    private readonly proxies: ProxyRepository,
    private readonly groups: GroupRepository,
    private readonly profileManager: ProfileManager,
    private readonly logs: ActivityLogRepository,
  ) {}

  /** Opens a native file picker, parses the chosen file, and cross-checks
   * each row's `proxyLabel` against real proxies that exist right now (the
   * one piece of validation the pure parser can't do on its own since it
   * has no DB access) — group names are deliberately NOT validated here,
   * since a group that doesn't exist yet gets created automatically at
   * commit time rather than treated as an error (see `commit()`). Returns
   * null if the user cancels the dialog.
   *
   * `PF_E2E_BULK_IMPORT_FILE` (testing-only, same convention as
   * `PF_E2E_AUTO_DIAGNOSTICS`/`PF_E2E_LOCALE` elsewhere in this app — never
   * set in a normal launch): when set, skips the native dialog entirely and
   * parses that path directly. A real OS file picker can't be driven by
   * Playwright, so this is what lets an E2E test exercise the actual wizard
   * UI (upload -> preview -> confirm -> result) against a real parsed file
   * instead of only unit-testing the service methods with the dialog
   * bypassed by calling them directly. */
  async parseFromDialog(): Promise<BulkImportParseResult | null> {
    const forcedPath = process.env['PF_E2E_BULK_IMPORT_FILE'];
    let filePath: string;
    if (forcedPath) {
      filePath = forcedPath;
    } else {
      const result = await dialog.showOpenDialog({
        title: 'Bulk Import Profiles from CSV/XLSX',
        properties: ['openFile'],
        filters: [
          { name: 'CSV/Excel', extensions: ['csv', 'xlsx'] },
          { name: 'All Files', extensions: ['*'] },
        ],
      });
      if (result.canceled || result.filePaths.length === 0) return null;
      filePath = result.filePaths[0]!;
    }

    const rows = parseBulkImportFile(filePath);

    const existingProxyNames = new Set(this.proxies.list().map((p) => p.name));
    for (const row of rows) {
      if (row.error) continue;
      if (row.proxyLabel && !existingProxyNames.has(row.proxyLabel)) {
        row.error = `Proxy "${row.proxyLabel}" not found — check Proxy Manager for the exact name`;
      }
    }

    const fileName = filePath.split(/[\\/]/).pop() ?? filePath;
    return { fileName, rows };
  }

  /** Creates one profile per row that has no `error` — a row already flagged
   * invalid during parsing/preview is skipped here (its original error is
   * carried straight into the result) rather than re-validated, since the
   * whole point of the preview step is that the user already saw it and
   * chose to proceed anyway. One row failing at creation time (e.g. a
   * genuinely unexpected DB error) never aborts the rest of the batch —
   * same "one bad item doesn't stop the batch" rule as every other bulk
   * operation in this app (see ProfileManager's bulkRun helper). */
  async commit(rows: BulkImportRow[]): Promise<BulkImportCommitResult> {
    const created: Profile[] = [];
    const errors: Array<{ row: number; message: string }> = [];

    // Built once, up front — a name -> id map lets every row that shares a
    // brand-new group name reuse the same group (created once, on the first
    // row that needs it) instead of racing to create it once per row or
    // throwing "already exists" on the second row with the same name.
    const groupIdByName = new Map(this.groups.list().map((g) => [g.name, g.id]));
    const proxyIdByName = new Map(this.proxies.list().map((p) => [p.name, p.id]));

    for (const row of rows) {
      if (row.error) {
        errors.push({ row: row.row, message: row.error });
        continue;
      }
      try {
        let groupId: string | null = null;
        if (row.groupName) {
          const existing = groupIdByName.get(row.groupName);
          if (existing) {
            groupId = existing;
          } else {
            const createdGroup = this.groups.create(row.groupName);
            groupIdByName.set(row.groupName, createdGroup.id);
            groupId = createdGroup.id;
          }
        }
        const proxyId = row.proxyLabel ? (proxyIdByName.get(row.proxyLabel) ?? null) : null;

        const generated = generateFingerprint({ seed: `${row.name}-${row.row}-${Date.now()}`, os: row.os });
        const fingerprint = this.fingerprints.create(generated);
        const profile = this.profileManager.create(
          { name: row.name, proxyId, groupId, tags: row.tags },
          fingerprint.id,
        );
        this.logs.record('PROFILE_IMPORTED', profile.id, `Bulk-imported profile "${profile.name}" (row ${row.row})`);
        created.push(profile);
      } catch (err) {
        errors.push({ row: row.row, message: err instanceof Error ? err.message : String(err) });
      }
    }

    return { created, errors };
  }
}
