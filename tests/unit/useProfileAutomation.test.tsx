// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { I18nProvider } from '../../src/renderer/i18n';
import { useProfileAutomation } from '../../src/renderer/hooks/useProfileAutomation';
import type { Profile } from '../../src/shared/schemas/profile';

afterEach(() => {
  vi.restoreAllMocks();
});

function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <I18nProvider initialLocale="en" onLocaleChange={() => {}}>
      {children}
    </I18nProvider>
  );
}

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
  return {
    id: 'p1',
    name: 'Test',
    description: '',
    profilePath: '/tmp/p1',
    fingerprintId: 'fp1',
    proxyId: null,
    groupId: null,
    status: 'STOPPED',
    tags: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    lastStartedAt: null,
    lastStoppedAt: null,
    automationEnabled: false,
    automationPort: null,
    ...overrides,
  } as Profile;
}

describe('useProfileAutomation', () => {
  it('starts with no token', () => {
    mockInvoke({});
    const { result } = renderHook(() => useProfileAutomation('p1', vi.fn()), { wrapper });
    expect(result.current.automationToken).toBeNull();
  });

  it('enabling automation for the first time (no existing token) generates one', async () => {
    const invoke = mockInvoke({
      'profiles:update': (p) => makeProfile({ automationEnabled: true, ...(p as Partial<Profile>) }),
      'profiles:regenerateAutomationToken': () => ({ token: 'fresh-token' }),
    });
    const onProfileUpdated = vi.fn();
    const { result } = renderHook(() => useProfileAutomation('p1', onProfileUpdated), { wrapper });

    await act(() => result.current.saveAutomation({ automationEnabled: true }));

    expect(invoke).toHaveBeenCalledWith('profiles:update', { id: 'p1', automationEnabled: true });
    expect(invoke).toHaveBeenCalledWith('profiles:regenerateAutomationToken', { id: 'p1' });
    expect(result.current.automationToken).toBe('fresh-token');
    expect(onProfileUpdated).toHaveBeenCalledWith(expect.objectContaining({ automationEnabled: true }));
  });

  it('disabling automation does not regenerate a token, and the existing token stays in state', async () => {
    const invoke = mockInvoke({
      'profiles:update': (p) => makeProfile({ ...(p as Partial<Profile>) }),
    });
    const { result } = renderHook(() => useProfileAutomation('p1', vi.fn()), { wrapper });
    act(() => result.current.setAutomationToken('already-had-one'));

    await act(() => result.current.saveAutomation({ automationEnabled: false }));

    expect(invoke).toHaveBeenCalledWith('profiles:update', { id: 'p1', automationEnabled: false });
    expect(invoke).not.toHaveBeenCalledWith('profiles:regenerateAutomationToken', expect.anything());
    expect(result.current.automationToken).toBe('already-had-one');
  });

  it('enabling again when a token already exists does not silently rotate it', async () => {
    const invoke = mockInvoke({
      'profiles:update': (p) => makeProfile({ ...(p as Partial<Profile>) }),
    });
    const { result } = renderHook(() => useProfileAutomation('p1', vi.fn()), { wrapper });
    act(() => result.current.setAutomationToken('long-lived-token'));

    await act(() => result.current.saveAutomation({ automationEnabled: true }));

    expect(invoke).not.toHaveBeenCalledWith('profiles:regenerateAutomationToken', expect.anything());
    expect(result.current.automationToken).toBe('long-lived-token');
  });

  it('regenerateAutomationToken replaces the token unconditionally', async () => {
    const invoke = mockInvoke({
      'profiles:regenerateAutomationToken': () => ({ token: 'rotated' }),
    });
    const { result } = renderHook(() => useProfileAutomation('p1', vi.fn()), { wrapper });
    act(() => result.current.setAutomationToken('old'));

    await act(() => result.current.regenerateAutomationToken());

    expect(invoke).toHaveBeenCalledWith('profiles:regenerateAutomationToken', { id: 'p1' });
    expect(result.current.automationToken).toBe('rotated');
  });

  it('a rejected save surfaces via `error`', async () => {
    mockInvoke({
      'profiles:update': () => {
        throw new Error('backend exploded');
      },
    });
    const { result } = renderHook(() => useProfileAutomation('p1', vi.fn()), { wrapper });

    await act(() => result.current.saveAutomation({ automationEnabled: true }));

    expect(result.current.error).toBeTruthy();
  });
});
