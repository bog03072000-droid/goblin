import { useState } from 'react';
import type { CookieInfo, CookieSetInput } from '@shared/schemas/cookie';
import type { LocalStorageEntry, LocalStorageSetInput } from '@shared/schemas/localStorageEntry';
import { callApi } from '../services/api';
import { useAsyncAction } from './useAsyncAction';

/**
 * Cookie/localStorage state and actions for ProfileEditorModal's Storage
 * tab — extracted the same way useFingerprintPreview and useProfileFormFields
 * already pulled Fingerprint/General state out of that modal, following the
 * ProfileChildChannel precedent of splitting off one self-contained,
 * independently-testable unit rather than leaving every tab's plumbing
 * inlined in one component. Both only exist inside a running profile's own
 * child-process session (see ProfileManager.sendChildRequest) — there is
 * nothing to list while stopped, which is why the caller (not this hook)
 * gates loading behind `profile.status === 'RUNNING'`.
 */
export function useProfileStorageData(profileId: string): {
  cookies: CookieInfo[] | null;
  cookiesPending: boolean;
  loadCookies: () => Promise<void>;
  removeCookie: (cookie: CookieInfo) => Promise<void>;
  addCookie: (input: CookieSetInput) => Promise<void>;
  localStorageOrigin: string | null;
  localStorageItems: LocalStorageEntry[] | null;
  localStoragePending: boolean;
  loadLocalStorage: () => Promise<void>;
  removeLocalStorageItem: (key: string) => Promise<void>;
  addLocalStorageItem: (input: LocalStorageSetInput) => Promise<void>;
  error: string | null;
} {
  const [cookies, setCookies] = useState<CookieInfo[] | null>(null);
  const [localStorageItems, setLocalStorageItems] = useState<LocalStorageEntry[] | null>(null);
  const [localStorageOrigin, setLocalStorageOrigin] = useState<string | null>(null);
  const cookiesAction = useAsyncAction();
  const localStorageAction = useAsyncAction();

  async function loadCookies(): Promise<void> {
    await cookiesAction.run(async () => {
      const list = await callApi<'profiles:cookies:list', CookieInfo[]>('profiles:cookies:list', { id: profileId });
      setCookies(list);
    });
  }

  async function removeCookie(cookie: CookieInfo): Promise<void> {
    await cookiesAction.run(async () => {
      const url = `${cookie.secure ? 'https' : 'http'}://${(cookie.domain ?? '').replace(/^\./, '')}${cookie.path ?? '/'}`;
      await callApi('profiles:cookies:remove', { id: profileId, url, name: cookie.name });
      await loadCookies();
    });
  }

  async function addCookie(input: CookieSetInput): Promise<void> {
    await cookiesAction.run(async () => {
      await callApi('profiles:cookies:set', { id: profileId, cookie: input });
      await loadCookies();
    });
  }

  /** Only the profile's first/primary tab's current origin (see
   * profileWindowEntry.ts's localStorage: handlers) — localStorage has no
   * session-wide API the way cookies do. */
  async function loadLocalStorage(): Promise<void> {
    await localStorageAction.run(async () => {
      const result = await callApi<'profiles:localStorage:list', { origin: string; items: LocalStorageEntry[] }>(
        'profiles:localStorage:list',
        { id: profileId },
      );
      setLocalStorageOrigin(result.origin);
      setLocalStorageItems(result.items);
    });
  }

  async function removeLocalStorageItem(key: string): Promise<void> {
    await localStorageAction.run(async () => {
      await callApi('profiles:localStorage:remove', { id: profileId, key });
      await loadLocalStorage();
    });
  }

  async function addLocalStorageItem(input: LocalStorageSetInput): Promise<void> {
    await localStorageAction.run(async () => {
      await callApi('profiles:localStorage:set', { id: profileId, item: input });
      await loadLocalStorage();
    });
  }

  return {
    cookies,
    cookiesPending: cookiesAction.pending,
    loadCookies,
    removeCookie,
    addCookie,
    localStorageOrigin,
    localStorageItems,
    localStoragePending: localStorageAction.pending,
    loadLocalStorage,
    removeLocalStorageItem,
    addLocalStorageItem,
    error: cookiesAction.error ?? localStorageAction.error,
  };
}
