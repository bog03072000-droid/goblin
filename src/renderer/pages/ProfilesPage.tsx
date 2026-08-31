import { useEffect, useMemo, useState } from 'react';
import type { Profile, ProfileListItem } from '@shared/schemas/profile';
import type { FingerprintInput } from '@shared/schemas/fingerprint';
import type { Template } from '@shared/schemas/template';
import type { ProxyRecord } from '@shared/schemas/proxy';
import type { Group } from '@shared/schemas/group';
import { callApi } from '../services/api';
import { ProfileEditorModal } from '../components/ProfileEditorModal';
import { ProfileCreateModal } from '../components/ProfileCreateModal';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { GroupsModal } from '../components/GroupsModal';
import { useAsyncAction } from '../hooks/useAsyncAction';
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

interface BulkResult {
  succeeded: string[];
  failed: Array<{ id: string; message: string }>;
}

/** True while the user is typing into any text input/select — used so
 * page-level keyboard shortcuts (Ctrl+A, Delete, Enter) never hijack normal
 * typing, while Ctrl+N/Ctrl+F still work from anywhere as quick jumps. */
function isEditingText(): boolean {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (el as HTMLElement).isContentEditable;
}

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
  const [newName, setNewName] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [newGroupId, setNewGroupId] = useState('');
  const [newProxyId, setNewProxyId] = useState('');
  const [newTags, setNewTags] = useState('');
  const [info, setInfo] = useState<string | null>(null);
  const [bulkFailures, setBulkFailures] = useState<Array<{ id: string; name: string; message: string }>>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmDeleteProfile, setConfirmDeleteProfile] = useState<ProfileListItem | null>(null);
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const [showGroupsModal, setShowGroupsModal] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);

  const generalAction = useAsyncAction();
  const rowAction = useAsyncAction();
  const bulkAction = useAsyncAction();
  const error = generalAction.error ?? rowAction.error ?? bulkAction.error;

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

  /** Opens the full profile-creation modal instead of creating a profile
   * immediately — nothing is written to the database until the user
   * explicitly confirms inside that modal. Whatever's already been typed
   * into the toolbar's quick fields (name/group/proxy/tags/template) just
   * seeds the modal's initial state, exactly as it used to seed the
   * immediate create call. */
  function openCreateModal(): void {
    setShowCreateModal(true);
  }

  function onProfileCreated(): void {
    setNewName('');
    setNewGroupId('');
    setNewProxyId('');
    setNewTags('');
    void refresh();
    void refreshGroups();
  }

  /** The one-click path the full config modal (openCreateModal) replaced:
   * generates a fingerprint the same way the modal's own preview does
   * (fingerprint:generate, honoring whatever template is selected in the
   * toolbar) and creates the profile immediately with it — no modal, no
   * extra confirmation step. Whatever's already typed into the toolbar's
   * quick fields (name/group/proxy/tags) is used exactly as-is; an empty
   * name falls back to a timestamp-based one since profiles:create requires
   * a non-empty name. */
  async function quickCreateProfile(): Promise<void> {
    await generalAction.run(async () => {
      const generated = await callApi<'fingerprint:generate', FingerprintInput>('fingerprint:generate', {
        seed: `quick-${Date.now()}`,
        templateId: templateId || undefined,
      });
      const name = newName.trim() || `Profile ${new Date().toLocaleString()}`;
      await callApi('profiles:create', {
        name,
        groupId: newGroupId || undefined,
        proxyId: newProxyId || undefined,
        tags: newTags
          .split(',')
          .map((tg) => tg.trim())
          .filter(Boolean),
        fingerprint: generated,
      });
      onProfileCreated();
    });
  }

  async function runAction(
    id: string,
    action: 'profiles:start' | 'profiles:stop' | 'profiles:restart' | 'profiles:delete',
  ): Promise<void> {
    setBusyId(id);
    await rowAction.run(async () => {
      await callApi(action, { id });
      await refresh();
    });
    setBusyId(null);
  }

  async function cloneOne(p: Profile): Promise<void> {
    setBusyId(p.id);
    await rowAction.run(async () => {
      await callApi('profiles:clone', { id: p.id, mode: 'config', name: `${p.name} (clone)` });
      await refresh();
    });
    setBusyId(null);
  }

  async function exportConfig(id: string): Promise<void> {
    await generalAction.run(async () => {
      const savedPath = await callApi<'profiles:exportConfig', string | null>('profiles:exportConfig', { id });
      if (savedPath) setInfo(t('profiles.msg.exportedConfig', { path: savedPath }));
    });
  }

  async function backupOne(id: string): Promise<void> {
    await generalAction.run(async () => {
      const savedPath = await callApi<'profiles:backup', string>('profiles:backup', { id });
      setInfo(t('profiles.msg.backedUp', { path: savedPath }));
    });
  }

  async function restoreProfile(): Promise<void> {
    await generalAction.run(async () => {
      const restored = await callApi<'profiles:restore', Profile | null>('profiles:restore', {});
      if (restored) {
        setInfo(t('profiles.msg.restored', { name: restored.name }));
        await refresh();
      }
    });
  }

  async function importProfiles(): Promise<void> {
    await generalAction.run(async () => {
      const result = await callApi<'profiles:import', { created: Profile[]; errors: Array<{ path: string; message: string }> }>(
        'profiles:import',
        {},
      );
      if (result.created.length > 0) {
        setInfo(
          t('profiles.msg.imported', { count: result.created.length }) +
            (result.errors.length > 0 ? t('profiles.msg.importedWithFailures', { count: result.errors.length }) : ''),
        );
        await refresh();
      } else if (result.errors.length > 0) {
        generalAction.setError(result.errors.map((e) => `${e.path}: ${e.message}`).join('; '));
      }
    });
  }

  async function exportSelected(): Promise<void> {
    await generalAction.run(async () => {
      const dir = await callApi<'profiles:exportSelected', string | null>('profiles:exportSelected', {
        ids: Array.from(selected),
      });
      if (dir) setInfo(t('profiles.msg.exportedSelected', { count: selected.size, path: dir }));
    });
  }

  async function exportAll(): Promise<void> {
    await generalAction.run(async () => {
      const dir = await callApi<'profiles:exportAll', string | null>('profiles:exportAll', {});
      if (dir) setInfo(t('profiles.msg.exportedAll', { path: dir }));
    });
  }

  /** Shared by every bulk action: shows that action's own specific success
   * message (unchanged from before — "Tag added to 2 profile(s)", not a
   * generic count) AND, when any profile failed, exactly which ones and why
   * — never just a silent count that discards the per-item detail the
   * backend already computed. */
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

  async function bulk(
    action: 'profiles:bulkStart' | 'profiles:bulkStop' | 'profiles:bulkRestart' | 'profiles:bulkDelete' | 'profiles:bulkClone',
  ): Promise<void> {
    if (selected.size === 0) return;
    await bulkAction.run(async () => {
      const result = await callApi<typeof action, BulkResult>(action, { ids: Array.from(selected) });
      reportBulkResult(t('profiles.bulk.resultSummary', { succeeded: result.succeeded.length, failed: result.failed.length }), result);
      setSelected(new Set());
      await refresh();
    });
  }

  async function bulkBackup(): Promise<void> {
    if (selected.size === 0) return;
    await bulkAction.run(async () => {
      const result = await callApi<'profiles:bulkBackup', BulkResult>('profiles:bulkBackup', { ids: Array.from(selected) });
      reportBulkResult(t('profiles.bulk.resultSummary', { succeeded: result.succeeded.length, failed: result.failed.length }), result);
    });
  }

  async function bulkAssignProxy(proxyId: string): Promise<void> {
    if (selected.size === 0) return;
    await bulkAction.run(async () => {
      const result = await callApi<'profiles:bulkAssignProxy', BulkResult>('profiles:bulkAssignProxy', {
        ids: Array.from(selected),
        proxyId: proxyId || null,
      });
      reportBulkResult(t('profiles.msg.proxyAssigned', { count: result.succeeded.length }), result);
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
      reportBulkResult(t('profiles.msg.groupAssigned', { count: result.succeeded.length }), result);
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
      reportBulkResult(t('profiles.msg.tagAdded', { count: result.succeeded.length }), result);
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
      reportBulkResult(t('profiles.msg.tagRemoved', { count: result.succeeded.length }), result);
      await refresh();
    });
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

  // Page-level shortcuts: Ctrl+N (focus the create-name field), Ctrl+F
  // (focus search), Ctrl+A (select all visible), Delete (delete selection),
  // Enter (start the single selected profile). Ctrl+F/Ctrl+N work from
  // anywhere; Ctrl+A/Delete/Enter are suppressed while typing so they never
  // fight with normal text editing (Ctrl+A to select text, Enter in a form).
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent): void {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        document.getElementById('profiles-create-name-input')?.focus();
      } else if (mod && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        document.getElementById('profiles-search-input')?.focus();
      } else if (mod && e.key.toLowerCase() === 'a' && !isEditingText()) {
        e.preventDefault();
        setSelected(new Set(visibleProfiles.map((p) => p.id)));
      } else if (e.key === 'Delete' && !isEditingText() && selected.size > 0) {
        e.preventDefault();
        setConfirmBulkDelete(true);
      } else if (e.key === 'Enter' && !isEditingText() && selected.size === 1) {
        e.preventDefault();
        const id = Array.from(selected)[0]!;
        const target = visibleProfiles.find((p) => p.id === id);
        if (target && target.status !== 'RUNNING' && target.status !== 'STARTING') {
          void runAction(id, 'profiles:start');
        }
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleProfiles, selected]);

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
        quickCreatePending={generalAction.pending}
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
              <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
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
          onDeleteRequest={setConfirmDeleteProfile}
        />
      </div>
      {showCreateModal && (
        <ProfileCreateModal
          initialName={newName}
          initialGroupId={newGroupId}
          initialProxyId={newProxyId}
          initialTags={newTags}
          initialTemplateId={templateId}
          onClose={() => setShowCreateModal(false)}
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
      {confirmDeleteProfile && (
        <ConfirmDialog
          message={t('profiles.confirmDelete', { name: confirmDeleteProfile.name })}
          confirmLabel={t('profiles.action.delete')}
          onCancel={() => setConfirmDeleteProfile(null)}
          onConfirm={() => {
            const id = confirmDeleteProfile.id;
            setConfirmDeleteProfile(null);
            void runAction(id, 'profiles:delete');
          }}
        />
      )}
      {confirmBulkDelete && (
        <ConfirmDialog
          message={t('profiles.bulk.confirmDelete', { count: selected.size })}
          confirmLabel={t('profiles.bulk.delete')}
          onCancel={() => setConfirmBulkDelete(false)}
          onConfirm={() => {
            setConfirmBulkDelete(false);
            void bulk('profiles:bulkDelete');
          }}
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
