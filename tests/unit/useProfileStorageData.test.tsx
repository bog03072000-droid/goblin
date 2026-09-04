// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { I18nProvider } from '../../src/renderer/i18n';
import { useProfileStorageData } from '../../src/renderer/hooks/useProfileStorageData';
import type { CookieInfo } from '../../src/shared/schemas/cookie';

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

function makeCookie(overrides: Partial<CookieInfo> = {}): CookieInfo {
  return { name: 'session', value: 'abc', domain: 'example.com', path: '/', secure: true, httpOnly: false, ...overrides };
}

describe('useProfileStorageData', () => {
  it('starts with null cookies/localStorage (nothing loaded yet)', () => {
    mockInvoke({});
    const { result } = renderHook(() => useProfileStorageData('p1'), { wrapper });
    expect(result.current.cookies).toBeNull();
    expect(result.current.localStorageItems).toBeNull();
    expect(result.current.localStorageOrigin).toBeNull();
  });

  it('loadCookies fetches and stores the list for the given profile id', async () => {
    const invoke = mockInvoke({ 'profiles:cookies:list': () => [makeCookie()] });
    const { result } = renderHook(() => useProfileStorageData('p1'), { wrapper });

    await act(() => result.current.loadCookies());

    expect(invoke).toHaveBeenCalledWith('profiles:cookies:list', { id: 'p1' });
    expect(result.current.cookies).toHaveLength(1);
  });

  it('removeCookie builds the url from domain/path/secure, calls remove, then reloads the list', async () => {
    const invoke = mockInvoke({
      'profiles:cookies:remove': () => undefined,
      'profiles:cookies:list': () => [],
    });
    const { result } = renderHook(() => useProfileStorageData('p1'), { wrapper });

    await act(() => result.current.removeCookie(makeCookie({ domain: '.example.com', path: '/app', secure: true, name: 'tok' })));

    expect(invoke).toHaveBeenCalledWith('profiles:cookies:remove', { id: 'p1', url: 'https://example.com/app', name: 'tok' });
    expect(invoke).toHaveBeenCalledWith('profiles:cookies:list', { id: 'p1' });
  });

  it('addCookie sets the cookie then reloads the list', async () => {
    const invoke = mockInvoke({
      'profiles:cookies:set': () => undefined,
      'profiles:cookies:list': () => [makeCookie()],
    });
    const { result } = renderHook(() => useProfileStorageData('p1'), { wrapper });

    await act(() => result.current.addCookie({ name: 'a', value: 'b', url: 'https://example.com/', path: '/' }));

    expect(invoke).toHaveBeenCalledWith('profiles:cookies:set', { id: 'p1', cookie: { name: 'a', value: 'b', url: 'https://example.com/', path: '/' } });
    await waitFor(() => expect(result.current.cookies).toHaveLength(1));
  });

  it('loadLocalStorage stores both the origin and the items', async () => {
    mockInvoke({
      'profiles:localStorage:list': () => ({ origin: 'https://example.com', items: [{ key: 'k', value: 'v' }] }),
    });
    const { result } = renderHook(() => useProfileStorageData('p1'), { wrapper });

    await act(() => result.current.loadLocalStorage());

    expect(result.current.localStorageOrigin).toBe('https://example.com');
    expect(result.current.localStorageItems).toEqual([{ key: 'k', value: 'v' }]);
  });

  it('removeLocalStorageItem removes by key then reloads', async () => {
    const invoke = mockInvoke({
      'profiles:localStorage:remove': () => undefined,
      'profiles:localStorage:list': () => ({ origin: 'https://example.com', items: [] }),
    });
    const { result } = renderHook(() => useProfileStorageData('p1'), { wrapper });

    await act(() => result.current.removeLocalStorageItem('k'));

    expect(invoke).toHaveBeenCalledWith('profiles:localStorage:remove', { id: 'p1', key: 'k' });
    expect(invoke).toHaveBeenCalledWith('profiles:localStorage:list', { id: 'p1' });
  });

  it('a rejected list call surfaces via `error` instead of throwing out of the hook', async () => {
    mockInvoke({
      'profiles:cookies:list': () => {
        throw new Error('backend exploded');
      },
    });
    const { result } = renderHook(() => useProfileStorageData('p1'), { wrapper });

    await act(() => result.current.loadCookies());

    expect(result.current.error).toBeTruthy();
  });
});
