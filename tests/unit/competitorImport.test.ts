import { describe, it, expect } from 'vitest';
import { parseGoLoginProfile, CompetitorImportError } from '../../src/main/profiles/competitorImport';
import { validateFingerprint } from '../../src/main/fingerprint/validator';

describe('parseGoLoginProfile', () => {
  it('maps every confirmed GoLogin field onto the resulting fingerprint', () => {
    const manifest = parseGoLoginProfile(
      {
        name: 'My GoLogin Profile',
        os: 'win',
        navigator: {
          userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/119.0.0.0',
          resolution: '1920x1080',
          language: 'en-US',
          platform: 'Win32',
          hardwareConcurrency: 12,
          deviceMemory: 16,
          maxTouchPoints: 0,
        },
      },
      'seed-1',
    );

    expect(manifest.fingerprint.os).toBe('windows');
    expect(manifest.fingerprint.userAgent).toBe('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/119.0.0.0');
    expect(manifest.fingerprint.platform).toBe('Win32');
    expect(manifest.fingerprint.screenWidth).toBe(1920);
    expect(manifest.fingerprint.screenHeight).toBe(1080);
    expect(manifest.fingerprint.hardwareConcurrency).toBe(12);
    expect(manifest.fingerprint.deviceMemory).toBe(16);
    expect(manifest.fingerprint.maxTouchPoints).toBe(0);
    expect(manifest.fingerprint.locale).toBe('en-US');
    expect(manifest.fingerprint.languages).toEqual(['en-US']);
    expect(manifest.profile.name).toBe('My GoLogin Profile');
  });

  it('maps mac/lin os values too', () => {
    expect(parseGoLoginProfile({ os: 'mac' }, 'seed-mac').fingerprint.os).toBe('macos');
    expect(parseGoLoginProfile({ os: 'lin' }, 'seed-lin').fingerprint.os).toBe('linux');
  });

  it('falls back to a generated coherent fingerprint for every field GoLogin export did not confirm', () => {
    const manifest = parseGoLoginProfile({ os: 'win', navigator: { hardwareConcurrency: 12 } }, 'seed-partial');
    // Not asserting exact values for the unconfirmed fields (they're
    // seed-derived) — just that every required field is present and the
    // result is internally coherent, and that the one confirmed field
    // (hardwareConcurrency) actually came through.
    const result = validateFingerprint(manifest.fingerprint);
    expect(result.errors).toEqual([]);
    expect(manifest.fingerprint.hardwareConcurrency).toBe(12);
  });

  it('falls all the way back to the generated bundle when the source export is internally inconsistent (a UA that contradicts the claimed OS)', () => {
    // A real coherence risk this guards against: nothing stops a
    // hand-edited or buggy competitor export from claiming os: 'win' with a
    // User-Agent that doesn't actually mention Windows — shipping that
    // combination unchanged would itself be an incoherent, detectable
    // fingerprint, exactly what validateFingerprint() exists to catch.
    const manifest = parseGoLoginProfile(
      { os: 'win', navigator: { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) Safari/605.1.15' } },
      'seed-inconsistent',
    );
    const result = validateFingerprint(manifest.fingerprint);
    expect(result.errors).toEqual([]);
    // The contradictory UA was discarded, not shipped — the fingerprint's
    // own userAgent must actually be self-consistent with its os.
    expect(manifest.fingerprint.userAgent).not.toContain('Macintosh');
  });

  it('a profile with no navigator object at all still produces a fully valid, coherent fingerprint', () => {
    const manifest = parseGoLoginProfile({ name: 'Bare Profile', os: 'lin' }, 'seed-bare');
    const result = validateFingerprint(manifest.fingerprint);
    expect(result.errors).toEqual([]);
    expect(manifest.fingerprint.os).toBe('linux');
  });

  it('an unparseable resolution string falls back to the generated default instead of crashing', () => {
    const manifest = parseGoLoginProfile({ os: 'win', navigator: { resolution: 'not-a-resolution' } }, 'seed-badres');
    expect(manifest.fingerprint.screenWidth).toBeGreaterThan(0);
    expect(manifest.fingerprint.screenHeight).toBeGreaterThan(0);
  });

  it('never carries a proxy (GoLogin\'s confirmed navigator shape has no proxy fields)', () => {
    const manifest = parseGoLoginProfile({ os: 'win' }, 'seed-noproxy');
    expect(manifest.proxy).toBeNull();
  });

  it('tags the imported profile distinctly so its origin is visible later', () => {
    const manifest = parseGoLoginProfile({ os: 'win' }, 'seed-tag');
    expect(manifest.profile.tags).toContain('imported-gologin');
  });

  it('throws CompetitorImportError for input that is not object-shaped at all', () => {
    expect(() => parseGoLoginProfile('just a string', 'seed-bad')).toThrow(CompetitorImportError);
    expect(() => parseGoLoginProfile(null, 'seed-bad')).toThrow(CompetitorImportError);
    expect(() => parseGoLoginProfile(42, 'seed-bad')).toThrow(CompetitorImportError);
  });

  it('is deterministic for the same seed', () => {
    const a = parseGoLoginProfile({ os: 'win' }, 'same-seed');
    const b = parseGoLoginProfile({ os: 'win' }, 'same-seed');
    expect(a.fingerprint).toEqual(b.fingerprint);
  });
});
