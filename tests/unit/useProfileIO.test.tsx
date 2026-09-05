// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { act } from '@testing-library/react';
import { I18nProvider } from '../../src/renderer/i18n';
import { useProfileIO } from '../../src/renderer/hooks/useProfileIO';
import type { Profile } from '../../src/shared/schemas/profile';
import type { ReactNode } from 'react';

afterEach(() => {
  vi.restoreAllMocks();
});

function mockInvoke(handlers: Partial<Record<string, (payload: unknown) => unknown>>) {
  const invoke = vi.fn((channel: string, payload: unknown) => {
    const handler = handlers[channel];
    if (!handler) throw new Error(`Unmocked IPC channel in test: ${channel}`);
    return Promise.resolve(handler(payload));
  });
  window.profileforge = { invoke, onUpdateAvailable: vi.fn(), installUpdate: vi.fn() } as unknown as Window['profileforge'];
  return invoke;
}

function makeProfile(overrides: Partial<Profile> = {}): Profile {
  return { id: 'p1', name: 'Work Bot', status: 'STOPPED', ...overrides } as Profile;
}

function wrapper({ children }: { children: ReactNode }) {
  return <I18nProvider initialLocale="en" onLocaleChange={() => {}}>{children}</I18nProvider>;
}

function setup(overrides: Partial<{ selected: Set<string>; setInfo: ReturnType<typeof vi.fn>; refresh: ReturnType<typeof vi.fn> }> = {}) {
  const setInfo = overrides.setInfo ?? vi.fn();
  const refresh = overrides.refresh ?? vi.fn(async () => undefined);
  const selected = overrides.selected ?? new Set<string>();
  const { result } = renderHook(() => useProfileIO({ selected, setInfo, refresh }), { wrapper });
  return { result, setInfo, refresh };
}

describe('useProfileIO', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exportConfig reports the saved path when one is returned', async () => {
    mockInvoke({ 'profiles:exportConfig': () => '/exports/p1.json' });
    const { result, setInfo } = setup();
    await act(() => result.current.exportConfig('p1'));
    expect(setInfo).toHaveBeenCalledWith('Exported configuration to /exports/p1.json');
  });

  it('exportConfig does not report anything when the user cancelled the save dialog (null path)', async () => {
    mockInvoke({ 'profiles:exportConfig': () => null });
    const { result, setInfo } = setup();
    await act(() => result.current.exportConfig('p1'));
    expect(setInfo).not.toHaveBeenCalled();
  });

  it('backupOne reports the backup path', async () => {
    mockInvoke({ 'profiles:backup': () => '/backups/p1.zip' });
    const { result, setInfo } = setup();
    await act(() => result.current.backupOne('p1'));
    expect(setInfo).toHaveBeenCalledWith('Backed up to /backups/p1.zip');
  });

  it('restoreProfile reports the restored profile name and refreshes when one is returned', async () => {
    mockInvoke({ 'profiles:restore': () => makeProfile({ name: 'Restored Bot' }) });
    const { result, setInfo, refresh } = setup();
    await act(() => result.current.restoreProfile());
    expect(setInfo).toHaveBeenCalledWith('Restored "Restored Bot"');
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('restoreProfile does nothing when the user cancelled (null)', async () => {
    mockInvoke({ 'profiles:restore': () => null });
    const { result, setInfo, refresh } = setup();
    await act(() => result.current.restoreProfile());
    expect(setInfo).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('importProfiles reports a plain success count and refreshes when there are no errors', async () => {
    mockInvoke({ 'profiles:import': () => ({ created: [makeProfile(), makeProfile({ id: 'p2' })], errors: [] }) });
    const { result, setInfo, refresh } = setup();
    await act(() => result.current.importProfiles());
    expect(setInfo).toHaveBeenCalledWith('Imported 2 profile(s)');
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('importProfiles appends a failure count when some profiles also failed to import', async () => {
    mockInvoke({
      'profiles:import': () => ({
        created: [makeProfile()],
        errors: [{ path: '/bad.json', message: 'corrupt' }],
      }),
    });
    const { result, setInfo } = setup();
    await act(() => result.current.importProfiles());
    expect(setInfo).toHaveBeenCalledWith('Imported 1 profile(s)' + '; 1 failed');
  });

  it('importProfiles surfaces an error (via ioAction.error) when everything failed and nothing was created', async () => {
    mockInvoke({
      'profiles:import': () => ({
        created: [],
        errors: [{ path: '/bad.json', message: 'corrupt' }],
      }),
    });
    const { result, refresh } = setup();
    await act(() => result.current.importProfiles());
    await waitFor(() => expect(result.current.ioAction.error).toBe('/bad.json: corrupt'));
    expect(refresh).not.toHaveBeenCalled();
  });

  it('exportSelected sends the selected ids and reports the destination directory', async () => {
    const invoke = mockInvoke({ 'profiles:exportSelected': () => '/exports/selected' });
    const { result, setInfo } = setup({ selected: new Set(['a', 'b']) });
    await act(() => result.current.exportSelected());
    expect(invoke).toHaveBeenCalledWith('profiles:exportSelected', { ids: ['a', 'b'] });
    expect(setInfo).toHaveBeenCalledWith('Exported 2 profile(s) to /exports/selected');
  });

  it('exportAll reports the destination directory', async () => {
    mockInvoke({ 'profiles:exportAll': () => '/exports/all' });
    const { result, setInfo } = setup();
    await act(() => result.current.exportAll());
    expect(setInfo).toHaveBeenCalledWith('Exported all profiles to /exports/all');
  });
});
