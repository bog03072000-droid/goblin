import { useEffect, useMemo, useState } from 'react';
import type { Profile, ProfileListItem, ProfileStatus } from '@shared/schemas/profile';
import type { Template } from '@shared/schemas/template';
import type { ProxyRecord } from '@shared/schemas/proxy';
import type { Group } from '@shared/schemas/group';
import { callApi } from '../services/api';
import { ProfileEditorModal } from '../components/ProfileEditorModal';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { describeError } from '../services/errorMessages';
import { useTranslation, type TranslationKey } from '../i18n';

type StatusFilter = 'ALL' | ProfileStatus;
type SortKey = 'name' | 'status' | 'lastUsed';

interface BulkResult {
  succeeded: string[];
  failed: Array<{ id: string; message: string }>;
}

const STATUS_LABEL_KEYS: Record<ProfileStatus, TranslationKey> = {
  RUNNING: 'profiles.status.running',
  STOPPED: 'profiles.status.stopped',
  STARTING: 'profiles.status.starting',
  STOPPING: 'profiles.status.stopping',
  CRASHED: 'profiles.status.crashed',
  ERROR: 'profiles.status.error',
  LOCKED: 'profiles.status.locked',
};

const PILL_VARIANT: Record<ProfileStatus, string> = {
  RUNNING: 'on',
  STOPPED: 'idle',
  STARTING: 'warn',
  STOPPING: 'warn',
  CRASHED: 'danger',
  ERROR: 'danger',
  LOCKED: 'lock',
};

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
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmDeleteProfile, setConfirmDeleteProfile] = useState<ProfileListItem | null>(null);
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);

  async function refresh(): Promise<void> {
    try {
      const list = await callApi<'profiles:list', ProfileListItem[]>('profiles:list', {
        search: search || undefined,
        tag: tagFilter || undefined,
        groupId: groupFilter || undefined,
      });
      setProfiles(list);
      setError(null);
    } catch (err) {
      setError(describeError(err, t));
    }
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
    try {
      await callApi('profiles:create', { name: newName.trim(), templateId: templateId || undefined });
      setNewName('');
      await refresh();
    } catch (err) {
      setError(describeError(err, t));
    }
  }

  async function runAction(
    id: string,
    action: 'profiles:start' | 'profiles:stop' | 'profiles:restart' | 'profiles:delete',
  ): Promise<void> {
    setBusyId(id);
    try {
      await callApi(action, { id });
      await refresh();
    } catch (err) {
      setError(describeError(err, t));
    } finally {
      setBusyId(null);
    }
  }

  async function cloneOne(p: Profile): Promise<void> {
    setBusyId(p.id);
    try {
      await callApi('profiles:clone', { id: p.id, mode: 'config', name: `${p.name} (clone)` });
      await refresh();
    } catch (err) {
      setError(describeError(err, t));
    } finally {
      setBusyId(null);
    }
  }

  async function exportConfig(id: string): Promise<void> {
    try {
      const savedPath = await callApi<'profiles:exportConfig', string | null>('profiles:exportConfig', { id });
      if (savedPath) setInfo(t('profiles.msg.exportedConfig', { path: savedPath }));
    } catch (err) {
      setError(describeError(err, t));
    }
  }

  async function backupOne(id: string): Promise<void> {
    try {
      const savedPath = await callApi<'profiles:backup', string>('profiles:backup', { id });
      setInfo(t('profiles.msg.backedUp', { path: savedPath }));
    } catch (err) {
      setError(describeError(err, t));
    }
  }

  async function restoreProfile(): Promise<void> {
    try {
      const restored = await callApi<'profiles:restore', Profile | null>('profiles:restore', {});
      if (restored) {
        setInfo(t('profiles.msg.restored', { name: restored.name }));
        await refresh();
      }
    } catch (err) {
      setError(describeError(err, t));
    }
  }

  async function importProfiles(): Promise<void> {
    try {
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
        setError(result.errors.map((e) => `${e.path}: ${e.message}`).join('; '));
      }
    } catch (err) {
      setError(describeError(err, t));
    }
  }

  async function exportSelected(): Promise<void> {
    try {
      const dir = await callApi<'profiles:exportSelected', string | null>('profiles:exportSelected', {
        ids: Array.from(selected),
      });
      if (dir) setInfo(t('profiles.msg.exportedSelected', { count: selected.size, path: dir }));
    } catch (err) {
      setError(describeError(err, t));
    }
  }

  async function exportAll(): Promise<void> {
    try {
      const dir = await callApi<'profiles:exportAll', string | null>('profiles:exportAll', {});
      if (dir) setInfo(t('profiles.msg.exportedAll', { path: dir }));
    } catch (err) {
      setError(describeError(err, t));
    }
  }

  async function bulk(
    action: 'profiles:bulkStart' | 'profiles:bulkStop' | 'profiles:bulkDelete' | 'profiles:bulkClone',
  ): Promise<void> {
    if (selected.size === 0) return;
    setBulkBusy(true);
    try {
      const result = await callApi<typeof action, BulkResult>(action, { ids: Array.from(selected) });
      setInfo(t('profiles.bulk.resultSummary', { succeeded: result.succeeded.length, failed: result.failed.length }));
      setSelected(new Set());
      await refresh();
    } catch (err) {
      setError(describeError(err, t));
    } finally {
      setBulkBusy(false);
    }
  }

  async function bulkAssignProxy(proxyId: string): Promise<void> {
    if (selected.size === 0) return;
    setBulkBusy(true);
    try {
      const result = await callApi<'profiles:bulkAssignProxy', BulkResult>('profiles:bulkAssignProxy', {
        ids: Array.from(selected),
        proxyId: proxyId || null,
      });
      setInfo(t('profiles.msg.proxyAssigned', { count: result.succeeded.length }));
      await refresh();
    } catch (err) {
      setError(describeError(err, t));
    } finally {
      setBulkBusy(false);
    }
  }

  async function bulkAssignGroup(groupIdValue: string): Promise<void> {
    if (selected.size === 0) return;
    setBulkBusy(true);
    try {
      const result = await callApi<'profiles:bulkAssignGroup', BulkResult>('profiles:bulkAssignGroup', {
        ids: Array.from(selected),
        groupId: groupIdValue || null,
      });
      setInfo(t('profiles.msg.groupAssigned', { count: result.succeeded.length }));
      await refresh();
      await refreshGroups();
    } catch (err) {
      setError(describeError(err, t));
    } finally {
      setBulkBusy(false);
    }
  }

  async function bulkAddTag(tag: string): Promise<void> {
    if (selected.size === 0 || !tag.trim()) return;
    setBulkBusy(true);
    try {
      const result = await callApi<'profiles:bulkAddTags', BulkResult>('profiles:bulkAddTags', {
        ids: Array.from(selected),
        tags: [tag.trim()],
      });
      setInfo(t('profiles.msg.tagAdded', { count: result.succeeded.length }));
      await refresh();
    } catch (err) {
      setError(describeError(err, t));
    } finally {
      setBulkBusy(false);
    }
  }

  async function createGroup(): Promise<void> {
    const name = window.prompt(t('profiles.group.create'));
    if (!name || !name.trim()) return;
    try {
      await callApi('groups:create', { name: name.trim() });
      await refreshGroups();
    } catch (err) {
      setError(describeError(err, t));
    }
  }

  async function renameGroup(group: Group): Promise<void> {
    const name = window.prompt(t('profiles.group.rename', { name: group.name }), group.name);
    if (!name || !name.trim() || name.trim() === group.name) return;
    try {
      await callApi('groups:rename', { id: group.id, name: name.trim() });
      await refreshGroups();
    } catch (err) {
      setError(describeError(err, t));
    }
  }

  async function deleteGroup(group: Group): Promise<void> {
    if (!window.confirm(t('profiles.group.confirmDelete', { name: group.name }))) return;
    try {
      await callApi('groups:delete', { id: group.id });
      if (groupFilter === group.id) setGroupFilter('');
      await refreshGroups();
      await refresh();
    } catch (err) {
      setError(describeError(err, t));
    }
  }

  return (
    <>
      <div className="toolbar">
        <input placeholder={t('profiles.searchPlaceholder')} value={search} onChange={(e) => setSearch(e.target.value)} />
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}>
          <option value="ALL">{t('profiles.status.all')}</option>
          {(Object.keys(STATUS_LABEL_KEYS) as ProfileStatus[]).map((s) => (
            <option key={s} value={s}>
              {t(STATUS_LABEL_KEYS[s])}
            </option>
          ))}
        </select>
        <select value={tagFilter} onChange={(e) => setTagFilter(e.target.value)}>
          <option value="">{t('profiles.tag.all')}</option>
          {allTags.map((tg) => (
            <option key={tg} value={tg}>
              {tg}
            </option>
          ))}
        </select>
        <select value={groupFilter} onChange={(e) => setGroupFilter(e.target.value)}>
          <option value="">{t('profiles.group.all')}</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name} ({g.profileCount})
            </option>
          ))}
        </select>
        <button className="btn btn-ghost" onClick={() => void createGroup()}>+ {t('profiles.group.manage')}</button>
        <select value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)}>
          <option value="name">{t('profiles.sort.name')}</option>
          <option value="status">{t('profiles.sort.status')}</option>
          <option value="lastUsed">{t('profiles.sort.lastUsed')}</option>
        </select>
        <div style={{ flex: 1 }} />
        <select value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
          <option value="">{t('profiles.template.auto')}</option>
          {templates.map((tmpl) => (
            <option key={tmpl.id} value={tmpl.id}>
              {tmpl.name}
            </option>
          ))}
        </select>
        <input placeholder={t('profiles.newNamePlaceholder')} value={newName} onChange={(e) => setNewName(e.target.value)} />
        <button className="btn btn-primary" onClick={() => void createProfile()}>
          {t('profiles.create')}
        </button>
        <button className="btn btn-ghost" onClick={() => void importProfiles()}>{t('profiles.import')}</button>
        <button className="btn btn-ghost" onClick={() => void restoreProfile()}>{t('profiles.restore')}</button>
        <button className="btn btn-ghost" onClick={() => void exportAll()}>{t('profiles.exportAll')}</button>
      </div>

      {groups.length > 0 && (
        <div className="toolbar" style={{ fontSize: 12, color: 'var(--ash-dim)' }}>
          {groups.map((g) => (
            <span key={g.id} style={{ display: 'inline-flex', gap: 4, alignItems: 'center', marginRight: 10 }}>
              {g.name} ({g.profileCount})
              <button className="btn btn-ghost btn-sm" onClick={() => void renameGroup(g)}>
                ✎
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => void deleteGroup(g)}>
                ✕
              </button>
            </span>
          ))}
        </div>
      )}

      {selected.size > 0 && (
        <div className="toolbar bulk-toolbar">
          <strong style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center' }}>
            {bulkBusy && <span className="spinner" />}
            {bulkBusy ? t('common.working') : t('profiles.selectedCount', { count: selected.size })}
          </strong>
          <button className="btn btn-ghost btn-sm" disabled={bulkBusy} onClick={() => void bulk('profiles:bulkStart')}>
            {t('profiles.bulk.start')}
          </button>
          <button className="btn btn-ghost btn-sm" disabled={bulkBusy} onClick={() => void bulk('profiles:bulkStop')}>
            {t('profiles.bulk.stop')}
          </button>
          <button className="btn btn-ghost btn-sm" disabled={bulkBusy} onClick={() => void bulk('profiles:bulkClone')}>
            {t('profiles.bulk.clone')}
          </button>
          <button className="btn btn-danger-ghost btn-sm" disabled={bulkBusy} onClick={() => setConfirmBulkDelete(true)}>
            {t('profiles.bulk.delete')}
          </button>
          <button className="btn btn-ghost btn-sm" disabled={bulkBusy} onClick={() => void exportSelected()}>
            {t('profiles.bulk.exportSelected')}
          </button>
          <select
            disabled={bulkBusy}
            defaultValue=""
            onChange={(e) => {
              void bulkAssignProxy(e.target.value);
              e.target.value = '';
            }}
          >
            <option value="" disabled>
              {t('profiles.bulk.assignProxy')}
            </option>
            <option value="">{t('profiles.bulk.removeProxy')}</option>
            {proxies.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <select
            disabled={bulkBusy}
            defaultValue=""
            onChange={(e) => {
              void bulkAssignGroup(e.target.value);
              e.target.value = '';
            }}
          >
            <option value="" disabled>
              {t('profiles.group.assign')}
            </option>
            <option value="">{t('profiles.group.none')}</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
          <input
            placeholder={t('profiles.bulk.addTagPlaceholder')}
            style={{ width: 140 }}
            disabled={bulkBusy}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                void bulkAddTag(e.currentTarget.value);
                e.currentTarget.value = '';
              }
            }}
          />
          <button className="btn btn-ghost btn-sm" disabled={bulkBusy} onClick={() => setSelected(new Set())}>
            {t('profiles.bulk.clearSelection')}
          </button>
        </div>
      )}

      <div className="content">
        {error && <div className="banner banner-error">{error}</div>}
        {info && <div className="banner banner-success">{info}</div>}
        <div className="panel">
        <table>
          <thead>
            <tr>
              <th style={{ width: 24 }}>
                <input type="checkbox" checked={allVisibleSelected} onChange={toggleSelectAll} />
              </th>
              <th>{t('profiles.table.name')}</th>
              <th>{t('profiles.table.status')}</th>
              <th>{t('profiles.table.os')}</th>
              <th>{t('profiles.table.browser')}</th>
              <th>{t('profiles.table.proxy')}</th>
              <th>{t('profiles.table.group')}</th>
              <th>{t('profiles.table.tags')}</th>
              <th>{t('profiles.table.lastUsed')}</th>
              <th>{t('profiles.table.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {visibleProfiles.map((p) => (
              <tr key={p.id} data-status={p.status}>
                <td>
                  <input type="checkbox" checked={selected.has(p.id)} onChange={() => toggleSelect(p.id)} />
                </td>
                <td>{p.name}</td>
                <td>
                  <span className={`pill ${PILL_VARIANT[p.status]}`}>{t(STATUS_LABEL_KEYS[p.status])}</span>
                </td>
                <td style={{ textTransform: 'capitalize' }}>{p.os}</td>
                <td>Chrome {p.browserVersion.split('.')[0]}</td>
                <td>{proxies.find((pr) => pr.id === p.proxyId)?.name ?? '—'}</td>
                <td>{groups.find((g) => g.id === p.groupId)?.name ?? '—'}</td>
                <td>
                  {p.tags.map((tg) => (
                    <span className="tag" key={tg}>
                      {tg}
                    </span>
                  ))}
                </td>
                <td className="mono">{p.lastStartedAt ?? '—'}</td>
                <td>
                  {p.status === 'RUNNING' ? (
                    <button className="btn btn-ghost btn-sm" disabled={busyId === p.id} onClick={() => void runAction(p.id, 'profiles:stop')}>
                      {busyId === p.id && <span className="spinner" />}
                      {t('profiles.action.stop')}
                    </button>
                  ) : (
                    <button className="btn btn-ghost btn-sm" disabled={busyId === p.id} onClick={() => void runAction(p.id, 'profiles:start')}>
                      {busyId === p.id && <span className="spinner" />}
                      {t('profiles.action.start')}
                    </button>
                  )}
                  <button className="btn btn-ghost btn-sm" disabled={busyId === p.id} onClick={() => void runAction(p.id, 'profiles:restart')}>
                    {busyId === p.id && <span className="spinner" />}
                    {t('profiles.action.restart')}
                  </button>
                  <button className="btn btn-ghost btn-sm" disabled={busyId === p.id} onClick={() => setEditingId(p.id)}>
                    {t('profiles.action.edit')}
                  </button>
                  <button className="btn btn-ghost btn-sm" disabled={busyId === p.id} onClick={() => void cloneOne(p)}>
                    {t('profiles.action.clone')}
                  </button>
                  <button className="btn btn-ghost btn-sm" disabled={busyId === p.id} onClick={() => void exportConfig(p.id)}>
                    {t('profiles.action.export')}
                  </button>
                  <button className="btn btn-ghost btn-sm" disabled={busyId === p.id} onClick={() => void backupOne(p.id)}>
                    {t('profiles.action.backup')}
                  </button>
                  <button className="btn btn-danger-ghost btn-sm" disabled={busyId === p.id} onClick={() => setConfirmDeleteProfile(p)}>
                    {t('profiles.action.delete')}
                  </button>
                </td>
              </tr>
            ))}
            {visibleProfiles.length === 0 && (
              <tr>
                <td colSpan={10} style={{ color: 'var(--ash-dim)' }}>
                  {profiles.length === 0 ? t('profiles.empty.none') : t('profiles.empty.noMatch')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
        </div>
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
