import { useState } from 'react';
import type { CookieInfo, CookieSetInput } from '@shared/schemas/cookie';
import type { LocalStorageEntry, LocalStorageSetInput } from '@shared/schemas/localStorageEntry';
import { callApi } from '../services/api';
import { useAsyncAction } from './useAsyncAction';
import { useTranslation } from '../i18n';

/** Same window as ProfilesPage.tsx's own UNDO_WINDOW_MS — no shared
 * constant exists to import (that one is local to a page component), so
 * this is a deliberate duplicate of the same value, not a drift risk in
 * practice since both represent the same product decision ("30s to
 * change your mind about a delete"), not a value that's ever tuned
 * independently per surface. */
const UNDO_WINDOW_MS = 30_000;

export interface StorageUndoState {
  message: string;
  restore: () => void;
}

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
  /** A just-deleted cookie or localStorage entry that can still be
   * restored — see removeCookie/removeLocalStorageItem's own comment for
   * why this exists (a real, previously-documented inconsistency: profile
   * deletion gets this, cookie/localStorage deletion didn't). */
  undoState: StorageUndoState | null;
  dismissUndo: () => void;
} {
  const { t } = useTranslation();
  const [cookies, setCookies] = useState<CookieInfo[] | null>(null);
  const [localStorageItems, setLocalStorageItems] = useState<LocalStorageEntry[] | null>(null);
  const [localStorageOrigin, setLocalStorageOrigin] = useState<string | null>(null);
  const [undoState, setUndoState] = useState<StorageUndoState | null>(null);
  const cookiesAction = useAsyncAction();
  const localStorageAction = useAsyncAction();

  async function loadCookies(): Promise<void> {
    await cookiesAction.run(async () => {
      const list = await callApi<'profiles:cookies:list', CookieInfo[]>('profiles:cookies:list', { id: profileId });
      setCookies(list);
    });
  }

  /** Deletes immediately (there's no server-side soft-delete for a cookie
   * the way there is for a whole profile — cookies only exist inside a
   * running profile's own live browser session, nothing to mark deleted
   * in a database) but keeps the full deleted cookie in a closure, so
   * Undo can genuinely re-create it via the same addCookie() a manual
   * "Add cookie" submit already uses — real restoration, not a
   * database-backed undo, but indistinguishable from the user's side.
   * Was previously instant-and-irreversible (see
   * docs/STORAGE_TAB_LIVE_AUDIT.md's "real friction point" note) — the
   * only destructive action in this app without either a confirm dialog
   * or an undo toast. */
  async function removeCookie(cookie: CookieInfo): Promise<void> {
    await cookiesAction.run(async () => {
      const url = `${cookie.secure ? 'https' : 'http'}://${(cookie.domain ?? '').replace(/^\./, '')}${cookie.path ?? '/'}`;
      await callApi('profiles:cookies:remove', { id: profileId, url, name: cookie.name });
      await loadCookies();
      setUndoState({
        message: t('editor.storage.cookies.removed', { name: cookie.name }),
        restore: () => {
          setUndoState(null);
          void addCookie({
            url,
            name: cookie.name,
            value: cookie.value,
            path: cookie.path,
            secure: cookie.secure,
            httpOnly: cookie.httpOnly,
            sameSite: cookie.sameSite,
            expirationDate: cookie.expirationDate,
          });
        },
      });
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

  /** Same reasoning as removeCookie's own comment above — captures the
   * entry's current value (read from the already-loaded `localStorageItems`
   * state, before the delete) so Undo can call addLocalStorageItem() to
   * genuinely restore it. */
  async function removeLocalStorageItem(key: string): Promise<void> {
    const value = localStorageItems?.find((it) => it.key === key)?.value ?? '';
    await localStorageAction.run(async () => {
      await callApi('profiles:localStorage:remove', { id: profileId, key });
      await loadLocalStorage();
      setUndoState({
        message: t('editor.storage.localStorage.removed', { key }),
        restore: () => {
          setUndoState(null);
          void addLocalStorageItem({ key, value });
        },
      });
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
    undoState,
    dismissUndo: () => setUndoState(null),
  };
}

export { UNDO_WINDOW_MS };
