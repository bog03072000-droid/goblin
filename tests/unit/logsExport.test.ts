import { describe, it, expect } from 'vitest';
import { buildLogsCsv } from '../../src/main/logs/logsExport';

describe('buildLogsCsv', () => {
  it('writes a header row followed by one row per entry', () => {
    const csv = buildLogsCsv([
      { createdAt: '2026-01-01T00:00:00.000Z', eventType: 'PROFILE_CREATED', profileName: 'Work Bot', message: 'Created' },
    ]);
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe('Time,Event,Profile,Message');
    expect(lines[1]).toBe('2026-01-01T00:00:00.000Z,PROFILE_CREATED,Work Bot,Created');
  });

  it('returns just the header when there are no rows', () => {
    expect(buildLogsCsv([])).toBe('Time,Event,Profile,Message');
  });

  it('wraps a field containing a comma in double quotes', () => {
    const csv = buildLogsCsv([{ createdAt: 't', eventType: 'E', profileName: 'P', message: 'a, b' }]);
    expect(csv).toContain('"a, b"');
  });

  it('doubles internal double quotes and wraps the field', () => {
    const csv = buildLogsCsv([{ createdAt: 't', eventType: 'E', profileName: 'P', message: 'said "hi"' }]);
    expect(csv).toContain('"said ""hi"""');
  });

  it('wraps a field containing a newline in double quotes', () => {
    const csv = buildLogsCsv([{ createdAt: 't', eventType: 'E', profileName: 'P', message: 'line1\nline2' }]);
    expect(csv).toContain('"line1\nline2"');
  });

  it('leaves a plain field with no special characters unquoted', () => {
    const csv = buildLogsCsv([{ createdAt: 't', eventType: 'E', profileName: 'P', message: 'plain message' }]);
    expect(csv.split('\r\n')[1]).toBe('t,E,P,plain message');
  });

  it('uses an empty profile field for entries with no associated profile', () => {
    const csv = buildLogsCsv([{ createdAt: 't', eventType: 'E', profileName: '', message: 'msg' }]);
    expect(csv.split('\r\n')[1]).toBe('t,E,,msg');
  });
});
