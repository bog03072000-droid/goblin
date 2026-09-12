import { describe, it, expect, beforeEach } from 'vitest';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { createTestDb } from '../../src/main/database/db';
import { TemplateRepository } from '../../src/main/database/templateRepository';

const migrationsDir = path.join(__dirname, '../../database/migrations');

describe('TemplateRepository', () => {
  let db: Database.Database;
  let repo: TemplateRepository;

  beforeEach(() => {
    db = createTestDb(migrationsDir);
    repo = new TemplateRepository(db);
  });

  it('seeds the 6 built-in os/locale templates named in the original brief, plus 3 ad-platform presets', () => {
    repo.seedBuiltins();
    const names = repo.list().map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'Windows Desktop',
        'Windows Germany',
        'Windows France',
        'Windows Ukraine',
        'macOS Desktop',
        'Linux Desktop',
        'TikTok Ads Mobile',
        'Facebook Ads Desktop',
        'Google Ads Standard',
      ]),
    );
    expect(repo.list().length).toBe(9);
  });

  it('is idempotent — seeding twice does not duplicate', () => {
    repo.seedBuiltins();
    repo.seedBuiltins();
    expect(repo.list().length).toBe(9);
  });

  it('each plain os/locale template has a coherent, minimal definition', () => {
    repo.seedBuiltins();
    const germany = repo.getById('windows-germany');
    expect(germany?.definition).toEqual({ os: 'windows', locale: 'de-DE' });
    const mac = repo.getById('macos-desktop');
    expect(mac?.definition).toEqual({ os: 'macos' });
  });

  it('each ad-platform preset pins a specific, real screen/GPU/hardware combo, not just os/locale', () => {
    repo.seedBuiltins();
    const tiktok = repo.getById('ad-tiktok-mobile');
    expect(tiktok?.definition).toEqual({
      os: 'android',
      locale: 'en-US',
      screenWidth: 412,
      screenHeight: 915,
      hardwareConcurrency: 8,
      deviceMemory: 8,
      webglVendor: 'Google Inc. (Qualcomm)',
      webglRenderer: 'ANGLE (Qualcomm, Adreno (TM) 740, OpenGL ES 3.2)',
    });

    const facebook = repo.getById('ad-facebook-desktop');
    expect(facebook?.definition.os).toBe('windows');
    expect(facebook?.definition.screenWidth).toBe(1920);
    expect(facebook?.definition.screenHeight).toBe(1080);

    const google = repo.getById('ad-google-standard');
    expect(google?.definition.os).toBe('windows');
    // Deliberately a different screen/GPU/hardware combo from the Facebook
    // preset above — two "windows" ad presets that resolved to identical
    // fingerprints would defeat the point of having two of them.
    expect(google?.definition.screenWidth).not.toBe(facebook?.definition.screenWidth);
    expect(google?.definition.webglVendor).not.toBe(facebook?.definition.webglVendor);
  });
});
