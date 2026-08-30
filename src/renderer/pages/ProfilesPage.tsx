import { useEffect, useMemo, useState } from 'react';
import type { Profile, ProfileListItem } from '@shared/schemas/profile';
import type { Template } from '@shared/schemas/template';
import type { ProxyRecord } from '@shared/schemas/proxy';
import type { Group } from '@shared/schemas/group';
import { callApi } from '../services/api';
import { ProfileEditorModal } from '../components/ProfileEditorModal';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useAsyncAction } from '../hooks/useAsyncAction';
import { useTranslation } from '../i18n';
import { ProfilesToolbar, type StatusFilter, type SortKey } from './profiles/ProfilesToolbar';
import { GroupsBar } from './profiles/GroupsBar';
import { BulkToolbar } from './profiles/BulkToolbar';
import { ProfilesTable } from './profiles/ProfilesTable';

interface BulkResult {
  succeeded: string[];
  failed: Array<{ id: string; message: string }>;
}

export function ProfilesPage(): JSX.Element {
  const { t } = useTranslation();
  const [profiles, setProfiles] = useState<ProfileListItem[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [proxies, setProxies] = useState<ProxyRecord[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [search, setSearch] = useState('');
  const [tagFilter, setTagFilter] = useState('');
  const [groupFilter, setGroupFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [newName, setNewName] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [info, setInfo] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmDeleteProfile, setConfirmDeleteProfile] = useState<ProfileListItem | null>(null);
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);

  const generalAction = useAsyncAction();
  const rowAction = useAsyncAction();
  const bulkAction = useAsyncAction();
  const error = generalAction.error ?? rowAction.error ?? bulkAction.error;

  async function refresh(): Promise<void> {
    await generalAction.run(async () => {
      const list = await callApi<'profiles:list', ProfileListItem[]>('profiles:list', {
        search: search || undefined,
        tag: tagFilter || undefined,
        groupId: groupFilter || undefined,
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
  }, [search, tagFilter, groupFilter]);

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
    const filtered = statusFilter === 'ALL' ? profiles : profiles.filter((p) => p.status === statusFilter);
    const sorted = [...filtered];
    sorted.sort((a, b) => {
      if (sortKey === 'name') return a.name.localeCompare(b.name);
      if (sortKey === 'status') return a.status.localeCompare(b.status);
      return (b.lastStartedAt ?? '').localeCompare(a.lastStartedAt ?? '');
    });
    return sorted;
  }, [profiles, statusFilter, sortKey]);

  const selectedVisible = visibleProfiles.filter((p) => selected.has(p.id));
  const allVisibleSelected = visibleProfiles.length > 0 && selectedVisible.length === visibleProfiles.length;

  function toggleSelectAll(): void {
    if (allVisibleSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(visibleProfiles.map((p) => p.id)));
    }
  }

  function toggleSelect(id: string): void {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function createProfile(): Promise<void> {
    if (!newName.trim()) return;
    await generalAction.run(async () => {
      await callApi('profiles:create', { name: newName.trim(), templateId: templateId || undefined });
      setNewName('');
      await refresh();
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

  async function bulk(
    action: 'profiles:bulkStart' | 'profiles:bulkStop' | 'profiles:bulkDelete' | 'profiles:bulkClone',
  ): Promise<void> {
    if (selected.size === 0) return;
    await bulkAction.run(async () => {
      const result = await callApi<typeof action, BulkResult>(action, { ids: Array.from(selected) });
      setInfo(t('profiles.bulk.resultSummary', { succeeded: result.succeeded.length, failed: result.failed.length }));
      setSelected(new Set());
      await refresh();
    });
  }

  async function bulkAssignProxy(proxyId: string): Promise<void> {
    if (selected.size === 0) return;
    await bulkAction.run(async () => {
      const result = await callApi<'profiles:bulkAssignProxy', BulkResult>('profiles:bulkAssignProxy', {
        ids: Array.from(selected),
        proxyId: proxyId || null,
      });
      setInfo(t('profiles.msg.proxyAssigned', { count: result.succeeded.length }));
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
      setInfo(t('profiles.msg.groupAssigned', { count: result.succeeded.length }));
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
      setInfo(t('profiles.msg.tagAdded', { count: result.succeeded.length }));
      await refresh();
    });
  }

  async function createGroup(): Promise<void> {
    const name = window.prompt(t('profiles.group.create'));
    if (!name || !name.trim()) return;
    await generalAction.run(async () => {
      await callApi('groups:create', { name: name.trim() });
      await refreshGroups();
    });
  }

  async function renameGroup(group: Group): Promise<void> {
    const name = window.prompt(t('profiles.group.rename', { name: group.name }), group.name);
    if (!name || !name.trim() || name.trim() === group.name) return;
    await generalAction.run(async () => {
      await callApi('groups:rename', { id: group.id, name: name.trim() });
      await refreshGroups();
    });
  }

  async function deleteGroup(group: Group): Promise<void> {
    if (!window.confirm(t('profiles.group.confirmDelete', { name: group.name }))) return;
    await generalAction.run(async () => {
      await callApi('groups:delete', { id: group.id });
      if (groupFilter === group.id) setGroupFilter('');
      await refreshGroups();
      await refresh();
    });
  }

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
        onManageGroups={() => void createGroup()}
        sortKey={sortKey}
        onSortKeyChange={setSortKey}
        templateId={templateId}
        onTemplateIdChange={setTemplateId}
        templates={templates}
        newName={newName}
        onNewNameChange={setNewName}
        onCreate={() => void createProfile()}
        onImport={() => void importProfiles()}
        onRestore={() => void restoreProfile()}
        onExportAll={() => void exportAll()}
      />

      <GroupsBar groups={groups} onRename={(g) => void renameGroup(g)} onDelete={(g) => void deleteGroup(g)} />

      {selected.size > 0 && (
        <BulkToolbar
          selectedCount={selected.size}
          bulkBusy={bulkAction.pending}
          proxies={proxies}
          groups={groups}
          onStart={() => void bulk('profiles:bulkStart')}
          onStop={() => void bulk('profiles:bulkStop')}
          onClone={() => void bulk('profiles:bulkClone')}
          onDeleteRequest={() => setConfirmBulkDelete(true)}
          onExportSelected={() => void exportSelected()}
          onAssignProxy={(proxyId) => void bulkAssignProxy(proxyId)}
          onAssignGroup={(groupId) => void bulkAssignGroup(groupId)}
          onAddTag={(tag) => void bulkAddTag(tag)}
          onClearSelection={() => setSelected(new Set())}
        />
      )}

      <div className="content">
        {error && <div className="banner banner-error">{error}</div>}
        {info && <div className="banner banner-success">{info}</div>}
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
      {editingId && (
        <ProfileEditorModal
          profileId={editingId}
          onClose={() => setEditingId(null)}
          onSaved={() => void refresh()}
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
    </>
  );
}
