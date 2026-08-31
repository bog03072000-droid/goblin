import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { getDb, closeDb } from '../../src/main/database/db';
import { ProfileRepository } from '../../src/main/database/profileRepository';
import { FingerprintRepository } from '../../src/main/database/fingerprintRepository';
import { ProxyRepository } from '../../src/main/database/proxyRepository';
import { ActivityLogRepository } from '../../src/main/database/activityLogRepository';
import { GroupRepository } from '../../src/main/database/groupRepository';
import { ProfileManager } from '../../src/main/profiles/profileManager';
import { generateFingerprint } from '../../src/main/fingerprint/generator';
import { SEED_DIR } from './loadTestUiSeedDir';

const migrationsDir = path.join(__dirname, '../../database/migrations');
const SCALE = 200;

/**
 * Seeds a real 200-profile `profileforge.db` + `profiles/` tree on disk for
 * loadTestUIResponsiveness.spec.ts (Test 8: UI responsiveness at 200 stored
 * profiles) to copy into a fresh --user-data-dir and launch against.
 *
 * This has to run as a SEPARATE step (vitest, real Node process) rather than
 * inline inside the Playwright E2E test file: better-sqlite3's native
 * addon is ABI-locked to whichever runtime last rebuilt it (`npm rebuild
 * better-sqlite3` for plain Node vs `electron-builder install-app-deps` for
 * Electron — see the load-test session notes / README for the exact
 * incident), and the Playwright test needs the ELECTRON-ABI build to launch
 * the real app. Seeding directly inside that same Playwright process would
 * require the Node-ABI build at the exact moment the Electron-ABI build is
 * needed to launch the app. Running the seed here, in vitest (Node ABI),
 * writing to a fixed on-disk path, keeps the two cleanly separated: run
 * `npm run rebuild:node && npx vitest run --config vitest.perf.config.ts
 * tests/performance/seedLoadTestUiDb.test.ts && npm run rebuild:electron`
 * once, then the E2E test just copies the resulting directory — no
 * better-sqlite3 import inside the Playwright process at all.
 */
describe('Load test: seed 200-profile DB for UI responsiveness E2E test', () => {
  it(`writes a real profileforge.db + profiles/ tree with ${SCALE} profiles to ${SEED_DIR}`, () => {
    fs.rmSync(SEED_DIR, { recursive: true, force: true });
    fs.mkdirSync(SEED_DIR, { recursive: true });
    const dbPath = path.join(SEED_DIR, 'profileforge.db');
    const profilesRoot = path.join(SEED_DIR, 'profiles');
    fs.mkdirSync(profilesRoot, { recursive: true });

    const db = getDb(dbPath, migrationsDir);
    const profiles = new ProfileRepository(db);
    const fingerprints = new FingerprintRepository(db);
    const proxies = new ProxyRepository(db);
    const groupsRepo = new GroupRepository(db);
    const logs = new ActivityLogRepository(db);
    const manager = new ProfileManager(profilesRoot, profiles, fingerprints, proxies, logs, ':memory:');

    const groupA = groupsRepo.create('Load UI Group A');
    const groupB = groupsRepo.create('Load UI Group B');
    const proxy = proxies.create({ name: 'Load UI Proxy', protocol: 'http', host: '127.0.0.1', port: 9999 });

    for (let i = 0; i < SCALE; i++) {
      const tags = i % 5 === 0 ? ['bulk', 'even5'] : i % 3 === 0 ? ['bulk', 'div3'] : ['bulk'];
      const groupId = i % 4 === 0 ? groupA.id : i % 4 === 1 ? groupB.id : undefined;
      const proxyId = i % 10 === 0 ? proxy.id : undefined;
      const fp = fingerprints.create(generateFingerprint({ seed: `load-ui-seed-${i}` }));
      manager.create({ name: `Load UI Profile ${String(i).padStart(3, '0')}`, tags, groupId, proxyId }, fp.id);
    }
    expect(profiles.list().length).toBe(SCALE);
    closeDb();
    expect(fs.existsSync(dbPath)).toBe(true);
  });
});
