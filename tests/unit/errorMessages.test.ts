import { describe, it, expect, vi } from 'vitest';
import { describeError } from '../../src/renderer/services/errorMessages';

const t = vi.fn((key: string) => key);

// Electron's ipcMain.handle wraps a thrown error's message with an
// "Error invoking remote method '<channel>': Error: <original>" prefix
// before it reaches the renderer — a real E2E test caught the previous
// version of describeError never matching anything because its patterns
// were anchored to the start of the string. These mirror that real prefix
// so the same regression can't slip back in unnoticed.
function wrapped(message: string): Error {
  return new Error(`Error invoking remote method 'profiles:delete': Error: ${message}`);
}

describe('describeError', () => {
  it('maps a wrapped "Stop the profile before..." error, not just a bare one', () => {
    expect(describeError(wrapped('Stop the profile before deleting it'), t)).toBe('errors.stopProfileFirst');
    expect(describeError(new Error('Stop the profile before deleting it'), t)).toBe('errors.stopProfileFirst');
  });

  it('maps wrapped business errors for the other known cases', () => {
    expect(describeError(wrapped('Profile is already running'), t)).toBe('errors.profileAlreadyRunning');
    expect(describeError(wrapped('Profile is locked by another running instance'), t)).toBe('errors.profileLocked');
    expect(describeError(wrapped('Profile not found: abc'), t)).toBe('errors.profileNotFound');
    expect(describeError(wrapped('Proxy not found'), t)).toBe('errors.proxyNotFound');
  });

  it('maps a wrapped Zod validation failure to the generic invalid-input message', () => {
    const zodIssues = JSON.stringify([{ code: 'too_small', message: 'too small', path: ['port'] }]);
    expect(describeError(wrapped(zodIssues), t)).toBe('errors.invalidInput');
  });

  it('falls back to the generic message for anything unrecognized', () => {
    expect(describeError(wrapped('some totally new backend error'), t)).toBe('common.unexpectedError');
    expect(describeError('a plain string, not an Error at all', t)).toBe('common.unexpectedError');
  });
});
