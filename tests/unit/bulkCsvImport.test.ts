import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as XLSX from 'xlsx';
import { parseBulkImportFile, MAX_BULK_IMPORT_ROWS } from '../../src/main/profiles/bulkCsvImport';

describe('parseBulkImportFile', () => {
  let workDir: string;

  afterEach(() => {
    if (workDir) fs.rmSync(workDir, { recursive: true, force: true });
  });

  function writeCsv(content: string): string {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-bulk-csv-'));
    const filePath = path.join(workDir, 'import.csv');
    fs.writeFileSync(filePath, content, 'utf-8');
    return filePath;
  }

  function writeXlsx(rows: Array<Record<string, string>>): string {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-bulk-xlsx-'));
    const filePath = path.join(workDir, 'import.xlsx');
    const sheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, 'Profiles');
    // XLSX.writeFile() misdetects this test runner's environment (Vitest's
    // ESM interop) and tries a browser-style save path that has no real
    // filesystem to write to — XLSX.write(...) to an in-memory buffer, then
    // a plain fs.writeFileSync, sidesteps that entirely and is what
    // production code (parseBulkImportFile) already does on the read side.
    const buffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' }) as Buffer;
    fs.writeFileSync(filePath, buffer);
    return filePath;
  }

  it('parses a well-formed CSV with every column into fully valid rows', () => {
    const filePath = writeCsv(
      'name,os,proxy,group,tags\n' +
        'Alice,windows,Proxy A,Team 1,affiliate;test\n' +
        'Bob,android,,Team 1,\n' +
        'Carol,,,,\n',
    );

    const rows = parseBulkImportFile(filePath);

    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual({
      row: 2,
      name: 'Alice',
      os: 'windows',
      proxyLabel: 'Proxy A',
      groupName: 'Team 1',
      tags: ['affiliate', 'test'],
    });
    expect(rows[1]).toEqual({
      row: 3,
      name: 'Bob',
      os: 'android',
      proxyLabel: undefined,
      groupName: 'Team 1',
      tags: [],
    });
    expect(rows[2]).toEqual({
      row: 4,
      name: 'Carol',
      os: undefined,
      proxyLabel: undefined,
      groupName: undefined,
      tags: [],
    });
    expect(rows.every((r) => !r.error)).toBe(true);
  });

  it('matches column headers case-insensitively', () => {
    const filePath = writeCsv('Name,OS,Proxy,Group,Tags\nAlice,windows,,,\n');
    const rows = parseBulkImportFile(filePath);
    expect(rows[0]!.name).toBe('Alice');
    expect(rows[0]!.os).toBe('windows');
  });

  it('flags a row with an empty name as an error, without dropping it', () => {
    const filePath = writeCsv('name,os\nAlice,windows\n,macos\n');
    const rows = parseBulkImportFile(filePath);
    expect(rows).toHaveLength(2);
    expect(rows[1]!.error).toBe('Name is required');
  });

  it('flags a row with an unrecognized OS value', () => {
    const filePath = writeCsv('name,os\nAlice,commodore64\n');
    const rows = parseBulkImportFile(filePath);
    expect(rows[0]!.error).toMatch(/Unknown OS "commodore64"/);
    expect(rows[0]!.error).toMatch(/windows, macos, linux, android, ios/);
  });

  it('throws when the file has no "name" column at all', () => {
    const filePath = writeCsv('os,proxy\nwindows,Proxy A\n');
    expect(() => parseBulkImportFile(filePath)).toThrow(/no "name" column/);
  });

  it('throws on a file with only a header row (no data)', () => {
    const filePath = writeCsv('name,os\n');
    expect(() => parseBulkImportFile(filePath)).toThrow(/no data rows/);
  });

  it('throws when the row count exceeds the hard cap', () => {
    const header = 'name\n';
    const body = Array.from({ length: MAX_BULK_IMPORT_ROWS + 1 }, (_, i) => `Profile ${i}`).join('\n');
    const filePath = writeCsv(header + body + '\n');
    expect(() => parseBulkImportFile(filePath)).toThrow(new RegExp(`limit is ${MAX_BULK_IMPORT_ROWS}`));
  });

  it('parses a real .xlsx workbook identically to the equivalent CSV', () => {
    const filePath = writeXlsx([
      { name: 'Dave', os: 'ios', proxy: '', group: '', tags: 'warm' },
      { name: 'Eve', os: 'linux', proxy: '', group: '', tags: '' },
    ]);

    const rows = parseBulkImportFile(filePath);

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ name: 'Dave', os: 'ios', tags: ['warm'] });
    expect(rows[1]).toMatchObject({ name: 'Eve', os: 'linux', tags: [] });
  });

  it('splits a semicolon-separated tags cell into a trimmed array', () => {
    const filePath = writeCsv('name,tags\nAlice, tag one ; tag two ;;\n');
    const rows = parseBulkImportFile(filePath);
    expect(rows[0]!.tags).toEqual(['tag one', 'tag two']);
  });
});
