import { describe, it, expect, beforeEach } from 'vitest';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { createTestDb } from '../../src/main/database/db';
import { ProfileRepository } from '../../src/main/database/profileRepository';
import { FingerprintRepository } from '../../src/main/database/fingerprintRepository';
import { generateFingerprint } from '../../src/main/fingerprint/generator';

const migrationsDir = path.join(__dirname, '../../database/migrations');

describe('ProfileRepository automation token generation', () => {
  let db: Database.Database;
  let profiles: ProfileRepository;
  let fingerprints: FingerprintRepository;
  let profileId: string;

  beforeEach(() => {
    db = createTestDb(migrationsDir);
    profiles = new ProfileRepository(db);
    fingerprints = new FingerprintRepository(db);
    const fp = fingerprints.create(generateFingerprint({ seed: 'automation-test' }));
    const created = profiles.create({
      name: 'Automation Test Profile',
      profilePath: '/tmp/does-not-matter',
      fingerprintId: fp.id,
      proxyId: null,
    });
    profileId = created.id;
  });

  it('a fresh profile has automation disabled and no token by default', () => {
    const profile = profiles.getById(profileId)!;
    expect(profile.automationEnabled).toBe(false);
    expect(profile.automationPort).toBeNull();
    expect(profiles.getAutomationToken(profileId)).toBeNull();
  });

  it('regenerateAutomationToken() generates a real, retrievable token', () => {
    const token = profiles.regenerateAutomationToken(profileId);
    expect(token.length).toBeGreaterThanOrEqual(64); // two concatenated UUIDs, no dashes stripped
    expect(profiles.getAutomationToken(profileId)).toBe(token);
  });

  it('regenerateAutomationToken() produces a different token each call, invalidating the previous one', () => {
    const first = profiles.regenerateAutomationToken(profileId);
    const second = profiles.regenerateAutomationToken(profileId);
    expect(second).not.toBe(first);
    expect(profiles.getAutomationToken(profileId)).toBe(second);
  });

  it('two different profiles never share a token', () => {
    const fp2 = fingerprints.create(generateFingerprint({ seed: 'automation-test-2' }));
    const otherProfile = profiles.create({
      name: 'Second Automation Profile',
      profilePath: '/tmp/also-does-not-matter',
      fingerprintId: fp2.id,
      proxyId: null,
    });
    const tokenA = profiles.regenerateAutomationToken(profileId);
    const tokenB = profiles.regenerateAutomationToken(otherProfile.id);
    expect(tokenA).not.toBe(tokenB);
  });

  it('the token is stored encrypted at rest, not as plaintext in the row', () => {
    const token = profiles.regenerateAutomationToken(profileId);
    const raw = db.prepare('SELECT automation_token_encrypted FROM profiles WHERE id = ?').get(profileId) as {
      automation_token_encrypted: Buffer;
    };
    // Whether via real OS encryption or the documented plaintext-marked
    // fallback (see credentialVault.ts), the raw column bytes must never
    // equal the token verbatim — that's the one invariant that has to hold
    // regardless of which path safeStorage takes on the machine running
    // this test.
    expect(raw.automation_token_encrypted.toString('utf-8')).not.toBe(token);
  });

  it('update() persists automationEnabled and automationPort', () => {
    const updated = profiles.update(profileId, { automationEnabled: true, automationPort: 9333 });
    expect(updated.automationEnabled).toBe(true);
    expect(updated.automationPort).toBe(9333);

    const reloaded = profiles.getById(profileId)!;
    expect(reloaded.automationEnabled).toBe(true);
    expect(reloaded.automationPort).toBe(9333);
  });

  it('disabling automation via update() keeps the existing token intact (re-enabling later does not silently rotate it)', () => {
    const token = profiles.regenerateAutomationToken(profileId);
    profiles.update(profileId, { automationEnabled: true, automationPort: 9333 });
    profiles.update(profileId, { automationEnabled: false });
    expect(profiles.getAutomationToken(profileId)).toBe(token);
  });
});
