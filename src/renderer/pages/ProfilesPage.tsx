import { useEffect, useMemo, useState } from 'react';
import type { Profile, ProfileListItem } from '@shared/schemas/profile';
import type { Template } from '@shared/schemas/template';
import type { ProxyRecord } from '@shared/schemas/proxy';
import type { Group } from '@shared/schemas/group';
import { callApi } from '../services/api';
import { ProfileEditorModal } from '../components/ProfileEditorModal';
import { ProfileCreateModal } from '../components/ProfileCreateModal';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { UndoToast } from '../components/UndoToast';
import { GroupsModal } from '../components/GroupsModal';
import { useAsyncAction } from '../hooks/useAsyncAction';
import { useProfileSelection, type BulkResult } from '../hooks/useProfileSelection';
import { useProfilesKeyboardShortcuts } from '../hooks/useProfilesKeyboardShortcuts';
import { useProfileCreate } from '../hooks/useProfileCreate';
import { useProfileIO } from '../hooks/useProfileIO';
import { useTranslation } from '../i18n';
import {
  ProfilesToolbar,
  UNGROUPED_FILTER,
  NO_PROXY_FILTER,
  type StatusFilter,
  type SortKey,
  type SortDirection,
} from './profiles/ProfilesToolbar';
import { BulkToolbar } from './profiles/BulkToolbar';
import { ProfilesTable } from './profiles/ProfilesTable';

export function ProfilesPage(): JSX.Element {
  const { t } = useTranslation();
  const [profiles, setProfiles] = useState<ProfileListItem[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [proxies, setProxies] = useState<ProxyRecord[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [tagFilter, setTagFilter] = useState('');
  const [groupFilter, setGroupFilter] = useState('');
  const [proxyFilter, setProxyFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [info, setInfo] = useState<string | null>(null);
  const [bulkFailures, setBulkFailures] = useState<Array<{ id: string; name: string; message: string }>>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showGroupsModal, setShowGroupsModal] = useState(false);
  // Soft-delete undo window (see profileManager.ts's SOFT_DELETE_WINDOW_MS,
  // which this mirrors for the visible countdown — the actual undo cutoff is
  // enforced by a main-process timer regardless of what happens to this toast).
  const UNDO_WINDOW_MS = 30_000;
  const [undoToast, setUndoToast] = useState<{ message: string; ids: string[]; bulk: boolean } | null>(null);

  const generalAction = useAsyncAction();
  const rowAction = useAsyncAction();

  // A 250ms debounce keeps every keystroke from firing its own IPC round-trip
  // + full list refetch — the search box stays instantly responsive to type
  // into, but the actual query only fires once typing pauses.
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 250);
    return () => clearTimeout(timer);
  }, [search]);

  async function refresh(): Promise<void> {
    await generalAction.run(async () => {
      const list = await callApi<'profiles:list', ProfileListItem[]>('profiles:list', {
        search: debouncedSearch || undefined,
        tag: tagFilter || undefined,
        groupId: groupFilter && groupFilter !== UNGROUPED_FILTER ? groupFilter : undefined,
      });
      setProfiles(list);
    });
  }

  async function refreshGroups(): Promise<void> {
    const list = await callApi<'groups:list', Group[]>('groups:list', {});
    setGroups(list);
  }

  useEffect(() => {
    void refresh();
    void callApi<'templates:list', Template[]>('templates:list', {}).then(setTemplates);
    void callApi<'proxy:list', ProxyRecord[]>('proxy:list', {}).then(setProxies);
    void refreshGroups();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch, tagFilter, groupFilter]);

  // Start/Stop resolve to a terminal RUNNING/STOPPED/CRASHED status asynchronously
  // (the browser process's own 'exit' event), not synchronously when the IPC call
  // returns — so without this poll, the UI would freeze on STARTING/STOPPING until
  // some unrelated action happened to trigger another refresh().
  const hasTransitionalProfile = profiles.some((p) => p.status === 'STARTING' || p.status === 'STOPPING');
  useEffect(() => {
    if (!hasTransitionalProfile) return;
    const interval = setInterval(() => void refresh(), 1000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasTransitionalProfile]);

  const allTags = useMemo(() => Array.from(new Set(profiles.flatMap((p) => p.tags))).sort(), [profiles]);

  const visibleProfiles = useMemo(() => {
    let filtered = statusFilter === 'ALL' ? profiles : profiles.filter((p) => p.status === statusFilter);
    // The backend has no "ungrouped"/"no proxy" filter concept (the id param
    // is either a real id or "match anything") — cheap enough to filter
    // client-side rather than teach the IPC contract two special sentinels.
    if (groupFilter === UNGROUPED_FILTER) filtered = filtered.filter((p) => p.groupId === null);
    if (proxyFilter === NO_PROXY_FILTER) filtered = filtered.filter((p) => p.proxyId === null);
    else if (proxyFilter) filtered = filtered.filter((p) => p.proxyId === proxyFilter);
    const sorted = [...filtered];
    sorted.sort((a, b) => {
      let cmp: number;
      if (sortKey === 'name') cmp = a.name.localeCompare(b.name);
      else if (sortKey === 'status') cmp = a.status.localeCompare(b.status);
      else cmp = (a.lastStartedAt ?? '').localeCompare(b.lastStartedAt ?? '');
      return sortDirection === 'asc' ? cmp : -cmp;
    });
    return sorted;
  }, [profiles, statusFilter, sortKey, sortDirection, groupFilter, proxyFilter]);

  /** Shows a bulk action's own specific success message (unchanged from
   * before — "Tag added to 2 profile(s)", not a generic count) AND, when any
   * profile failed, exactly which ones and why — never just a silent count
   * that discards the per-item detail the backend already computed. Passed
   * into useProfileSelection so its bulk* functions can report through the
   * same info/bulkFailures banner every other action on this page uses. */
  function reportBulkResult(successMessage: string, result: BulkResult): void {
    setInfo(successMessage);
    setBulkFailures(
      result.failed.map((f) => ({
        id: f.id,
        name: profiles.find((p) => p.id === f.id)?.name ?? f.id,
        message: f.message,
      })),
    );
  }

  const selection = useProfileSelection({
    visibleProfiles,
    onBulkResult: reportBulkResult,
    refresh,
    refreshGroups,
  });
  const {
    selected,
    setSelected,
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
  } = selection;
  const create = useProfileCreate({ refresh, refreshGroups });
  const {
    newName,
    setNewName,
    templateId,
    setTemplateId,
    newGroupId,
    setNewGroupId,
    newProxyId,
    setNewProxyId,
    newTags,
    setNewTags,
    showCreateModal,
    openCreateModal,
    closeCreateModal,
    onProfileCreated,
    quickCreateProfile,
    createAction,
  } = create;
  const { ioAction, exportConfig, backupOne, restoreProfile, importProfiles, exportSelected, exportAll } = useProfileIO({
    selected,
    setInfo,
    refresh,
  });
  const error = generalAction.error ?? rowAction.error ?? bulkAction.error ?? createAction.error ?? ioAction.error;

  async function runAction(id: string, action: 'profiles:start' | 'profiles:stop' | 'profiles:restart'): Promise<void> {
    setBusyId(id);
    await rowAction.run(async () => {
      await callApi(action, { id });
      await refresh();
    });
    setBusyId(null);
  }

  /** Soft-deletes immediately — no confirm dialog, since the Undo toast below
   * is the safety net now (a single profile is cheap to restore, unlike a
   * bulk selection — see confirmBulkDelete, which still confirms). */
  async function deleteOne(p: ProfileListItem): Promise<void> {
    setBusyId(p.id);
    await rowAction.run(async () => {
      await callApi('profiles:delete', { id: p.id });
      await refresh();
      setUndoToast({ message: t('profiles.msg.deleted', { name: p.name }), ids: [p.id], bulk: false });
    });
    setBusyId(null);
  }

  async function bulkDeleteWithUndo(): Promise<void> {
    setConfirmBulkDelete(false);
    if (selected.size === 0) return;
    const ids = Array.from(selected);
    await bulkAction.run(async () => {
      const result = await callApi<'profiles:bulkDelete', BulkResult>('profiles:bulkDelete', { ids });
      reportBulkResult(
        t('profiles.bulk.resultSummary', { succeeded: result.succeeded.length, failed: result.failed.length }),
        result,
      );
      setSelected(new Set());
      await refresh();
      if (result.succeeded.length > 0) {
        setUndoToast({
          message: t('profiles.bulk.msg.deleted', { count: result.succeeded.length }),
          ids: result.succeeded,
          bulk: true,
        });
      }
    });
  }

  async function undoDelete(): Promise<void> {
    if (!undoToast) return;
    const { ids, bulk: isBulk } = undoToast;
    setUndoToast(null);
    await generalAction.run(async () => {
      if (isBulk) {
        await callApi('profiles:bulkRestoreDeleted', { ids });
        setInfo(t('profiles.bulk.msg.deleteRestored', { count: ids.length }));
      } else {
        await callApi('profiles:restoreDeleted', { id: ids[0]! });
        setInfo(t('profiles.msg.deleteRestored'));
      }
      await refresh();
    });
  }

  async function cloneOne(p: Profile): Promise<void> {
    setBusyId(p.id);
    await rowAction.run(async () => {
      await callApi('profiles:clone', { id: p.id, mode: 'config', name: `${p.name} (clone)` });
      await refresh();
    });
    setBusyId(null);
  }

  async function createGroup(name: string): Promise<void> {
    await generalAction.run(async () => {
      await callApi('groups:create', { name });
      await refreshGroups();
    });
  }

  async function renameGroup(group: Group, name: string): Promise<void> {
    await generalAction.run(async () => {
      await callApi('groups:rename', { id: group.id, name });
      await refreshGroups();
    });
  }

  async function deleteGroup(group: Group): Promise<void> {
    await generalAction.run(async () => {
      await callApi('groups:delete', { id: group.id });
      if (groupFilter === group.id) setGroupFilter('');
      await refreshGroups();
      await refresh();
    });
  }

  useProfilesKeyboardShortcuts({
    visibleProfiles,
    selected,
    setSelected,
    setConfirmBulkDelete,
    onStart: (id) => void runAction(id, 'profiles:start'),
  });

  return (
    <>
      <ProfilesToolbar
        search={search}
        onSearchChange={setSearch}
        statusFilter={statusFilter}
        onStatusFilterChange={setStatusFilter}
        tagFilter={tagFilter}
        onTagFilterChange={setTagFilter}
        allTags={allTags}
        groupFilter={groupFilter}
        onGroupFilterChange={setGroupFilter}
        groups={groups}
        onManageGroups={() => setShowGroupsModal(true)}
        proxyFilter={proxyFilter}
        onProxyFilterChange={setProxyFilter}
        proxies={proxies}
        sortKey={sortKey}
        onSortKeyChange={setSortKey}
        sortDirection={sortDirection}
        onToggleSortDirection={() => setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'))}
        onInvertSelection={invertSelection}
        templateId={templateId}
        onTemplateIdChange={setTemplateId}
        templates={templates}
        newName={newName}
        onNewNameChange={setNewName}
        newGroupId={newGroupId}
        onNewGroupIdChange={setNewGroupId}
        newProxyId={newProxyId}
        onNewProxyIdChange={setNewProxyId}
        newTags={newTags}
        onNewTagsChange={setNewTags}
        onCreate={openCreateModal}
        onQuickCreate={() => void quickCreateProfile()}
        quickCreatePending={createAction.pending}
        onImport={() => void importProfiles()}
        onRestore={() => void restoreProfile()}
        onExportAll={() => void exportAll()}
      />

      {selected.size > 0 && (
        <BulkToolbar
          selectedCount={selected.size}
          bulkBusy={bulkAction.pending}
          proxies={proxies}
          groups={groups}
          onStart={() => void bulk('profiles:bulkStart')}
          onStop={() => void bulk('profiles:bulkStop')}
          onRestart={() => void bulk('profiles:bulkRestart')}
          onClone={() => void bulk('profiles:bulkClone')}
          onDeleteRequest={() => setConfirmBulkDelete(true)}
          onExportSelected={() => void exportSelected()}
          onBackup={() => void bulkBackup()}
          onAssignProxy={(proxyId) => void bulkAssignProxy(proxyId)}
          onAssignGroup={(groupId) => void bulkAssignGroup(groupId)}
          onAddTag={(tag) => void bulkAddTag(tag)}
          onRemoveTag={(tag) => void bulkRemoveTag(tag)}
          onClearSelection={() => setSelected(new Set())}
        />
      )}

      <div className="content">
        {error && <div className="banner banner-error">{error}</div>}
        {info && (
          <div className={`banner ${bulkFailures.length > 0 ? 'banner-warn' : 'banner-success'}`}>
            {info}
            {bulkFailures.length > 0 && (
              <ul className="bulk-failure-list">
                {bulkFailures.map((f) => (
                  <li key={f.id}>
                    <strong>{f.name}</strong>: {f.message}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        <ProfilesTable
          profiles={visibleProfiles}
          totalProfileCount={profiles.length}
          proxies={proxies}
          groups={groups}
          selected={selected}
          allVisibleSelected={allVisibleSelected}
          onToggleSelectAll={toggleSelectAll}
          onToggleSelect={toggleSelect}
          busyId={busyId}
          onStart={(id) => void runAction(id, 'profiles:start')}
          onStop={(id) => void runAction(id, 'profiles:stop')}
          onRestart={(id) => void runAction(id, 'profiles:restart')}
          onEdit={setEditingId}
          onClone={(p) => void cloneOne(p)}
          onExport={(id) => void exportConfig(id)}
          onBackup={(id) => void backupOne(id)}
          onDeleteRequest={(p) => void deleteOne(p)}
        />
      </div>
      {showCreateModal && (
        <ProfileCreateModal
          initialName={newName}
          initialGroupId={newGroupId}
          initialProxyId={newProxyId}
          initialTags={newTags}
          initialTemplateId={templateId}
          onClose={closeCreateModal}
          onCreated={onProfileCreated}
        />
      )}
      {editingId && (
        <ProfileEditorModal
          profileId={editingId}
          onClose={() => setEditingId(null)}
          onSaved={() => {
            void refresh();
            // The editor can change a profile's group assignment, which
            // changes group profile counts — without this, they'd stay
            // stale (showing the count from whenever groups were last
            // fetched) until an unrelated filter change refetched them.
            void refreshGroups();
          }}
        />
      )}
      {confirmBulkDelete && (
        <ConfirmDialog
          message={t('profiles.bulk.confirmDelete', { count: selected.size })}
          confirmLabel={t('profiles.bulk.delete')}
          onCancel={() => setConfirmBulkDelete(false)}
          onConfirm={() => void bulkDeleteWithUndo()}
        />
      )}
      {undoToast && (
        <UndoToast
          message={undoToast.message}
          durationMs={UNDO_WINDOW_MS}
          onUndo={() => void undoDelete()}
          onDismiss={() => setUndoToast(null)}
        />
      )}
      {showGroupsModal && (
        <GroupsModal
          groups={groups}
          onCreate={(name) => void createGroup(name)}
          onRename={(g, name) => void renameGroup(g, name)}
          onDelete={(g) => void deleteGroup(g)}
          onClose={() => setShowGroupsModal(false)}
        />
      )}
    </>
  );
}
