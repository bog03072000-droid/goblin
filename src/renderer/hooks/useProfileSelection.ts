import { useState } from 'react';
import type { ProfileListItem } from '@shared/schemas/profile';
import { callApi } from '../services/api';
import { useAsyncAction } from './useAsyncAction';
import { useTranslation } from '../i18n';

export interface BulkResult {
  succeeded: string[];
  failed: Array<{ id: string; message: string }>;
}

/**
 * Owns everything about "which profiles are selected" and "what bulk action
 * is running against that selection" — extracted out of ProfilesPage.tsx
 * (which was pushing 600 lines) since this is a genuinely self-contained
 * slice: nothing outside bulk-selection UI reads `selected` or calls a
 * `bulk*` function. Deliberately does NOT own `info`/`bulkFailures` display
 * state, since those are shared with several non-bulk actions elsewhere on
 * the page (single-row export, restore, import) — this hook reports through
 * the `onBulkResult` callback instead, letting the page keep owning how
 * results get displayed.
 */
export function useProfileSelection(options: {
  visibleProfiles: ProfileListItem[];
  onBulkResult: (message: string, result: BulkResult) => void;
  refresh: () => Promise<void>;
  refreshGroups: () => Promise<void>;
}): {
  selected: Set<string>;
  setSelected: (next: Set<string>) => void;
  selectedVisible: ProfileListItem[];
  allVisibleSelected: boolean;
  toggleSelectAll: () => void;
  invertSelection: () => void;
  toggleSelect: (id: string) => void;
  confirmBulkDelete: boolean;
  setConfirmBulkDelete: (value: boolean) => void;
  bulkAction: ReturnType<typeof useAsyncAction>;
  bulk: (
    action: 'profiles:bulkStart' | 'profiles:bulkStop' | 'profiles:bulkRestart' | 'profiles:bulkDelete' | 'profiles:bulkClone',
  ) => Promise<void>;
  bulkBackup: () => Promise<void>;
  bulkAssignProxy: (proxyId: string) => Promise<void>;
  bulkAssignGroup: (groupIdValue: string) => Promise<void>;
  bulkAddTag: (tag: string) => Promise<void>;
  bulkRemoveTag: (tag: string) => Promise<void>;
} {
  const { visibleProfiles, onBulkResult, refresh, refreshGroups } = options;
  const { t } = useTranslation();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const bulkAction = useAsyncAction();

  const selectedVisible = visibleProfiles.filter((p) => selected.has(p.id));
  const allVisibleSelected = visibleProfiles.length > 0 && selectedVisible.length === visibleProfiles.length;

  function toggleSelectAll(): void {
    if (allVisibleSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(visibleProfiles.map((p) => p.id)));
    }
  }

  function invertSelection(): void {
    setSelected((prev) => {
      const next = new Set<string>();
      for (const p of visibleProfiles) {
        if (!prev.has(p.id)) next.add(p.id);
      }
      return next;
    });
  }

  function toggleSelect(id: string): void {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function bulk(
    action: 'profiles:bulkStart' | 'profiles:bulkStop' | 'profiles:bulkRestart' | 'profiles:bulkDelete' | 'profiles:bulkClone',
  ): Promise<void> {
    if (selected.size === 0) return;
    await bulkAction.run(async () => {
      const result = await callApi<typeof action, BulkResult>(action, { ids: Array.from(selected) });
      onBulkResult(t('profiles.bulk.resultSummary', { succeeded: result.succeeded.length, failed: result.failed.length }), result);
      setSelected(new Set());
      await refresh();
    });
  }

  async function bulkBackup(): Promise<void> {
    if (selected.size === 0) return;
    await bulkAction.run(async () => {
      const result = await callApi<'profiles:bulkBackup', BulkResult>('profiles:bulkBackup', { ids: Array.from(selected) });
      onBulkResult(t('profiles.bulk.resultSummary', { succeeded: result.succeeded.length, failed: result.failed.length }), result);
    });
  }

  async function bulkAssignProxy(proxyId: string): Promise<void> {
    if (selected.size === 0) return;
    await bulkAction.run(async () => {
      const result = await callApi<'profiles:bulkAssignProxy', BulkResult>('profiles:bulkAssignProxy', {
        ids: Array.from(selected),
        proxyId: proxyId || null,
      });
      onBulkResult(t('profiles.msg.proxyAssigned', { count: result.succeeded.length }), result);
      await refresh();
    });
  }

  async function bulkAssignGroup(groupIdValue: string): Promise<void> {
    if (selected.size === 0) return;
    await bulkAction.run(async () => {
      const result = await callApi<'profiles:bulkAssignGroup', BulkResult>('profiles:bulkAssignGroup', {
        ids: Array.from(selected),
        groupId: groupIdValue || null,
      });
      onBulkResult(t('profiles.msg.groupAssigned', { count: result.succeeded.length }), result);
      await refresh();
      await refreshGroups();
    });
  }

  async function bulkAddTag(tag: string): Promise<void> {
    if (selected.size === 0 || !tag.trim()) return;
    await bulkAction.run(async () => {
      const result = await callApi<'profiles:bulkAddTags', BulkResult>('profiles:bulkAddTags', {
        ids: Array.from(selected),
        tags: [tag.trim()],
      });
      onBulkResult(t('profiles.msg.tagAdded', { count: result.succeeded.length }), result);
      await refresh();
    });
  }

  async function bulkRemoveTag(tag: string): Promise<void> {
    if (selected.size === 0 || !tag.trim()) return;
    await bulkAction.run(async () => {
      const result = await callApi<'profiles:bulkRemoveTags', BulkResult>('profiles:bulkRemoveTags', {
        ids: Array.from(selected),
        tags: [tag.trim()],
      });
      onBulkResult(t('profiles.msg.tagRemoved', { count: result.succeeded.length }), result);
      await refresh();
    });
  }

  return {
    selected,
    setSelected,
    selectedVisible,
    allVisibleSelected,
    toggleSelectAll,
    invertSelection,
    toggleSelect,
    confirmBulkDelete,
    setConfirmBulkDelete,
    bulkAction,
    bulk,
    bulkBackup,
    bulkAssignProxy,
    bulkAssignGroup,
    bulkAddTag,
    bulkRemoveTag,
  };
}
