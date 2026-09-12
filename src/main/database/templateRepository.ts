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
  // Ad-platform presets — pin a specific, realistic screen/GPU/hardware
  // combo per platform's own known device profile, on top of the OS/locale
  // an id-only template already supported. Every screen/GPU value here is
  // copied verbatim from an existing PLATFORM_PROFILES entry in
  // platformProfiles.ts (Pixel 7 for the Android bundle; real desktop GPU
  // options for the Windows bundles) — generateFingerprint() validates each
  // override against that same list, so a typo here would just be silently
  // ignored rather than crash, but these are deliberately exact matches, not
  // approximations. Ids prefixed `ad-` so the UI can group them separately
  // from the plain OS/locale templates above (see ProfilesToolbar.tsx /
  // ProfileCreateModal.tsx's template <select>, which groups by this
  // prefix) — not a schema field, since nothing outside display grouping
  // needs to distinguish "ad preset" from "OS template" as a first-class
  // concept.
  {
    id: 'ad-tiktok-mobile',
    name: 'TikTok Ads Mobile',
    definition: {
      os: 'android',
      locale: 'en-US',
      screenWidth: 412,
      screenHeight: 915,
      hardwareConcurrency: 8,
      deviceMemory: 8,
      webglVendor: 'Google Inc. (Qualcomm)',
      webglRenderer: 'ANGLE (Qualcomm, Adreno (TM) 740, OpenGL ES 3.2)',
    },
  },
  {
    id: 'ad-facebook-desktop',
    name: 'Facebook Ads Desktop',
    definition: {
      os: 'windows',
      locale: 'en-US',
      screenWidth: 1920,
      screenHeight: 1080,
      hardwareConcurrency: 8,
      deviceMemory: 16,
      webglVendor: 'Google Inc. (NVIDIA)',
      webglRenderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0)',
    },
  },
  {
    id: 'ad-google-standard',
    name: 'Google Ads Standard',
    definition: {
      os: 'windows',
      locale: 'en-US',
      screenWidth: 1366,
      screenHeight: 768,
      hardwareConcurrency: 4,
      deviceMemory: 8,
      webglVendor: 'Google Inc. (Intel)',
      webglRenderer: 'ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0)',
    },
  },
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
