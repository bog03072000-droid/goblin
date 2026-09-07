// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { I18nProvider } from '../../src/renderer/i18n';
import { useProfileSelection, type BulkResult } from '../../src/renderer/hooks/useProfileSelection';
import type { ProfileListItem } from '../../src/shared/schemas/profile';
import type { ReactNode } from 'react';

function wrapper({ children }: { children: ReactNode }) {
  return <I18nProvider initialLocale="en" onLocaleChange={() => {}}>{children}</I18nProvider>;
}

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

function makeProfile(overrides: Partial<ProfileListItem> = {}): ProfileListItem {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    name: 'Profile 1',
    description: '',
    profilePath: '/p1',
    fingerprintId: '22222222-2222-2222-2222-222222222222',
    proxyId: null,
    groupId: null,
    status: 'STOPPED',
    tags: [],
    createdAt: '',
    updatedAt: '',
    lastStartedAt: null,
    lastStoppedAt: null,
    automationEnabled: false,
    automationPort: null,
    scheduleEnabled: false,
    scheduleTime: null,
    scheduleDays: null,
    scheduleLastTriggeredAt: null,
    os: 'windows',
    browserVersion: '128.0',
    ...overrides,
  };
}

const successResult: BulkResult = { succeeded: ['11111111-1111-1111-1111-111111111111'], failed: [] };

function setup(visibleProfiles: ProfileListItem[]) {
  const onBulkResult = vi.fn();
  const refresh = vi.fn(async () => undefined);
  const refreshGroups = vi.fn(async () => undefined);
  const { result } = renderHook(() => useProfileSelection({ visibleProfiles, onBulkResult, refresh, refreshGroups }), {
    wrapper,
  });
  return { result, onBulkResult, refresh, refreshGroups };
}

describe('useProfileSelection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('selection state', () => {
    it('starts with an empty selection', () => {
      const { result } = setup([makeProfile()]);
      expect(result.current.selected.size).toBe(0);
      expect(result.current.allVisibleSelected).toBe(false);
    });

    it('toggleSelect adds then removes a single id', () => {
      const { result } = setup([makeProfile()]);
      act(() => result.current.toggleSelect('11111111-1111-1111-1111-111111111111'));
      expect(result.current.selected.has('11111111-1111-1111-1111-111111111111')).toBe(true);
      act(() => result.current.toggleSelect('11111111-1111-1111-1111-111111111111'));
      expect(result.current.selected.has('11111111-1111-1111-1111-111111111111')).toBe(false);
    });

    it('toggleSelectAll selects every visible profile, then clears on a second call', () => {
      const profiles = [makeProfile({ id: 'a' }), makeProfile({ id: 'b' })];
      const { result } = setup(profiles);
      act(() => result.current.toggleSelectAll());
      expect(result.current.selected).toEqual(new Set(['a', 'b']));
      expect(result.current.allVisibleSelected).toBe(true);
      act(() => result.current.toggleSelectAll());
      expect(result.current.selected.size).toBe(0);
    });

    it('invertSelection flips membership against the currently visible set only', () => {
      const profiles = [makeProfile({ id: 'a' }), makeProfile({ id: 'b' }), makeProfile({ id: 'c' })];
      const { result } = setup(profiles);
      act(() => result.current.toggleSelect('a'));
      act(() => result.current.invertSelection());
      expect(result.current.selected).toEqual(new Set(['b', 'c']));
    });

    it('setSelected replaces the set directly (used by ProfilesPage after a bulk delete)', () => {
      const { result } = setup([makeProfile({ id: 'a' })]);
      act(() => result.current.setSelected(new Set(['a'])));
      expect(result.current.selected).toEqual(new Set(['a']));
      act(() => result.current.setSelected(new Set()));
      expect(result.current.selected.size).toBe(0);
    });

    it('setConfirmBulkDelete toggles the confirm-dialog flag', () => {
      const { result } = setup([]);
      expect(result.current.confirmBulkDelete).toBe(false);
      act(() => result.current.setConfirmBulkDelete(true));
      expect(result.current.confirmBulkDelete).toBe(true);
    });
  });

  describe('bulk() — start/stop/restart/delete/clone', () => {
    it('is a no-op when nothing is selected (no IPC call, no callback)', async () => {
      const invoke = mockInvoke({});
      const { result, onBulkResult, refresh } = setup([makeProfile({ id: 'a' })]);
      await act(() => result.current.bulk('profiles:bulkStart'));
      expect(invoke).not.toHaveBeenCalled();
      expect(onBulkResult).not.toHaveBeenCalled();
      expect(refresh).not.toHaveBeenCalled();
    });

    it('calls the given bulk channel with the selected ids, reports the result, clears selection, and refreshes', async () => {
      const invoke = mockInvoke({ 'profiles:bulkStart': () => successResult });
      const profiles = [makeProfile({ id: 'a' }), makeProfile({ id: 'b' })];
      const { result, onBulkResult, refresh } = setup(profiles);
      act(() => result.current.toggleSelect('a'));

      await act(() => result.current.bulk('profiles:bulkStart'));

      expect(invoke).toHaveBeenCalledWith('profiles:bulkStart', { ids: ['a'] });
      expect(onBulkResult).toHaveBeenCalledWith(expect.any(String), successResult);
      expect(result.current.selected.size).toBe(0);
      expect(refresh).toHaveBeenCalledTimes(1);
    });
  });

  describe('bulkBackup', () => {
    it('is a no-op with nothing selected', async () => {
      const invoke = mockInvoke({});
      const { result } = setup([]);
      await act(() => result.current.bulkBackup());
      expect(invoke).not.toHaveBeenCalled();
    });

    it('backs up the selection and reports the result WITHOUT clearing selection or refreshing (unlike bulk())', async () => {
      const invoke = mockInvoke({ 'profiles:bulkBackup': () => successResult });
      const { result, onBulkResult, refresh } = setup([makeProfile({ id: 'a' })]);
      act(() => result.current.toggleSelect('a'));

      await act(() => result.current.bulkBackup());

      expect(invoke).toHaveBeenCalledWith('profiles:bulkBackup', { ids: ['a'] });
      expect(onBulkResult).toHaveBeenCalledWith(expect.any(String), successResult);
      expect(result.current.selected).toEqual(new Set(['a']));
      expect(refresh).not.toHaveBeenCalled();
    });
  });

  describe('bulkAssignProxy', () => {
    it('sends the chosen proxyId and refreshes (not groups)', async () => {
      const invoke = mockInvoke({ 'profiles:bulkAssignProxy': () => successResult });
      const { result, refresh, refreshGroups } = setup([makeProfile({ id: 'a' })]);
      act(() => result.current.toggleSelect('a'));

      await act(() => result.current.bulkAssignProxy('proxy-1'));

      expect(invoke).toHaveBeenCalledWith('profiles:bulkAssignProxy', { ids: ['a'], proxyId: 'proxy-1' });
      expect(refresh).toHaveBeenCalledTimes(1);
      expect(refreshGroups).not.toHaveBeenCalled();
    });

    it('sends null when the proxy value is empty (unassign)', async () => {
      const invoke = mockInvoke({ 'profiles:bulkAssignProxy': () => successResult });
      const { result } = setup([makeProfile({ id: 'a' })]);
      act(() => result.current.toggleSelect('a'));

      await act(() => result.current.bulkAssignProxy(''));

      expect(invoke).toHaveBeenCalledWith('profiles:bulkAssignProxy', { ids: ['a'], proxyId: null });
    });
  });

  describe('bulkAssignGroup', () => {
    it('sends the chosen groupId and refreshes BOTH profiles and groups (group counts change)', async () => {
      const invoke = mockInvoke({ 'profiles:bulkAssignGroup': () => successResult });
      const { result, refresh, refreshGroups } = setup([makeProfile({ id: 'a' })]);
      act(() => result.current.toggleSelect('a'));

      await act(() => result.current.bulkAssignGroup('group-1'));

      expect(invoke).toHaveBeenCalledWith('profiles:bulkAssignGroup', { ids: ['a'], groupId: 'group-1' });
      expect(refresh).toHaveBeenCalledTimes(1);
      expect(refreshGroups).toHaveBeenCalledTimes(1);
    });
  });

  describe('bulkSetSchedule', () => {
    it('enables schedule for the selection and refreshes', async () => {
      const invoke = mockInvoke({ 'profiles:bulkSetSchedule': () => successResult });
      const { result, refresh } = setup([makeProfile({ id: 'a' })]);
      act(() => result.current.toggleSelect('a'));

      await act(() => result.current.bulkSetSchedule(true));

      expect(invoke).toHaveBeenCalledWith('profiles:bulkSetSchedule', { ids: ['a'], enabled: true });
      expect(refresh).toHaveBeenCalledTimes(1);
    });

    it('disables schedule when called with false', async () => {
      const invoke = mockInvoke({ 'profiles:bulkSetSchedule': () => successResult });
      const { result } = setup([makeProfile({ id: 'a' })]);
      act(() => result.current.toggleSelect('a'));

      await act(() => result.current.bulkSetSchedule(false));

      expect(invoke).toHaveBeenCalledWith('profiles:bulkSetSchedule', { ids: ['a'], enabled: false });
    });
  });

  describe('bulkAddTag / bulkRemoveTag', () => {
    it('bulkAddTag is a no-op when the tag is blank, even with a selection', async () => {
      const invoke = mockInvoke({});
      const { result } = setup([makeProfile({ id: 'a' })]);
      act(() => result.current.toggleSelect('a'));

      await act(() => result.current.bulkAddTag('   '));

      expect(invoke).not.toHaveBeenCalled();
    });

    it('bulkAddTag trims the tag before sending it', async () => {
      const invoke = mockInvoke({ 'profiles:bulkAddTags': () => successResult });
      const { result, refresh } = setup([makeProfile({ id: 'a' })]);
      act(() => result.current.toggleSelect('a'));

      await act(() => result.current.bulkAddTag('  vip  '));

      expect(invoke).toHaveBeenCalledWith('profiles:bulkAddTags', { ids: ['a'], tags: ['vip'] });
      expect(refresh).toHaveBeenCalledTimes(1);
    });

    it('bulkRemoveTag is a no-op with nothing selected, even with a non-blank tag', async () => {
      const invoke = mockInvoke({});
      const { result } = setup([]);
      await act(() => result.current.bulkRemoveTag('vip'));
      expect(invoke).not.toHaveBeenCalled();
    });

    it('bulkRemoveTag trims and sends the tag', async () => {
      const invoke = mockInvoke({ 'profiles:bulkRemoveTags': () => successResult });
      const { result } = setup([makeProfile({ id: 'a' })]);
      act(() => result.current.toggleSelect('a'));

      await act(() => result.current.bulkRemoveTag(' vip '));

      expect(invoke).toHaveBeenCalledWith('profiles:bulkRemoveTags', { ids: ['a'], tags: ['vip'] });
    });
  });
});
