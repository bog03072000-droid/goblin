import { describe, it, expect, vi } from 'vitest';
import { applyPermissionPolicy } from '../../src/main/browser/fingerprintEnforcement';
import type { GeolocationMode, PermissionsMode } from '../../src/shared/schemas/fingerprint';

/** Minimal double of the two Electron `Session` methods applyPermissionPolicy
 * actually calls — captures the handler each installs so tests can invoke it
 * directly with an arbitrary permission name, the same way Electron itself
 * would when a page calls `navigator.permissions.query()` or requests a
 * getUserMedia/geolocation/notification permission. */
function fakeSession() {
  let requestHandler: ((wc: unknown, permission: string, callback: (granted: boolean) => void) => void) | null = null;
  let checkHandler: ((wc: unknown, permission: string) => boolean) | null = null;
  return {
    setPermissionRequestHandler: vi.fn((h) => {
      requestHandler = h;
    }),
    setPermissionCheckHandler: vi.fn((h) => {
      checkHandler = h;
    }),
    request(permission: string): boolean {
      let granted = false;
      requestHandler!(null, permission, (g) => (granted = g));
      return granted;
    },
    check(permission: string): boolean {
      return checkHandler!(null, permission);
    },
  };
}

function apply(permissionsMode: PermissionsMode, geolocationMode: GeolocationMode) {
  const ses = fakeSession();
  applyPermissionPolicy(ses as never, { permissionsMode, geolocationMode });
  return ses;
}

describe('applyPermissionPolicy', () => {
  it('preserves Electron\'s implicit "allow everything" default when both modes are at their default (real)', () => {
    const ses = apply('real', 'real');
    expect(ses.request('geolocation')).toBe(true);
    expect(ses.request('media')).toBe(true);
    expect(ses.request('notifications')).toBe(true);
    expect(ses.check('geolocation')).toBe(true);
    expect(ses.check('media')).toBe(true);
  });

  it('geolocationMode "blocked" denies only geolocation, leaving every other permission untouched', () => {
    const ses = apply('real', 'blocked');
    expect(ses.request('geolocation')).toBe(false);
    expect(ses.check('geolocation')).toBe(false);
    expect(ses.request('media')).toBe(true);
    expect(ses.request('notifications')).toBe(true);
  });

  it('geolocationMode "spoof" grants the geolocation permission (the CDP override supplies the value)', () => {
    const ses = apply('real', 'spoof');
    expect(ses.request('geolocation')).toBe(true);
    expect(ses.check('geolocation')).toBe(true);
  });

  it('permissionsMode "deny-all" denies every non-geolocation permission', () => {
    const ses = apply('deny-all', 'real');
    expect(ses.request('media')).toBe(false);
    expect(ses.request('notifications')).toBe(false);
    expect(ses.request('clipboard-read')).toBe(false);
    expect(ses.check('midiSysex')).toBe(false);
  });

  it('"spoof my location but deny everything else" is representable — geolocationMode wins for geolocation specifically, deny-all wins for the rest', () => {
    const ses = apply('deny-all', 'spoof');
    expect(ses.request('geolocation')).toBe(true);
    expect(ses.check('geolocation')).toBe(true);
    expect(ses.request('media')).toBe(false);
  });

  it('geolocationMode "blocked" together with permissionsMode "deny-all" denies geolocation too (both paths agree, not a conflict)', () => {
    const ses = apply('deny-all', 'blocked');
    expect(ses.request('geolocation')).toBe(false);
    expect(ses.request('media')).toBe(false);
  });
});
