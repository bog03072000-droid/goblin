import { useEffect, useMemo, useState } from 'react';
import type { Profile, ProfileListItem, ProfileStatus } from '@shared/schemas/profile';
import type { Template } from '@shared/schemas/template';
import type { ProxyRecord } from '@shared/schemas/proxy';
import { callApi } from '../services/api';
import { ProfileEditorModal } from '../components/ProfileEditorModal';

type StatusFilter = 'ALL' | ProfileStatus;
type SortKey = 'name' | 'status' | 'lastUsed';

interface BulkResult {
  succeeded: string[];
  failed: Array<{ id: string; message: string }>;
}

export function ProfilesPage(): JSX.Element {
  const [profiles, setProfiles] = useState<ProfileListItem[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [proxies, setProxies] = useState<ProxyRecord[]>([]);
  const [search, setSearch] = useState('');
  const [tagFilter, setTagFilter] = useState('');
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

  async function refresh(): Promise<void> {
    try {
      const list = await callApi<'profiles:list', ProfileListItem[]>('profiles:list', {
        search: search || undefined,
        tag: tagFilter || undefined,
      });
      setProfiles(list);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  useEffect(() => {
    void refresh();
    void callApi<'templates:list', Template[]>('templates:list', {}).then(setTemplates);
    void callApi<'proxy:list', ProxyRecord[]>('proxy:list', {}).then(setProxies);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, tagFilter]);

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
      setError(err instanceof Error ? err.message : String(err));
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
      setError(err instanceof Error ? err.message : String(err));
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
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  }

  async function exportConfig(id: string): Promise<void> {
    try {
      const savedPath = await callApi<'profiles:exportConfig', string | null>('profiles:exportConfig', { id });
      if (savedPath) setInfo(`Exported configuration to ${savedPath}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function backupOne(id: string): Promise<void> {
    try {
      const savedPath = await callApi<'profiles:backup', string>('profiles:backup', { id });
      setInfo(`Backed up to ${savedPath}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function restoreProfile(): Promise<void> {
    try {
      const restored = await callApi<'profiles:restore', Profile | null>('profiles:restore', {});
      if (restored) {
        setInfo(`Restored "${restored.name}"`);
        await refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
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
          `Imported ${result.created.length} profile(s)` +
            (result.errors.length > 0 ? `; ${result.errors.length} failed` : ''),
        );
        await refresh();
      } else if (result.errors.length > 0) {
        setError(result.errors.map((e) => `${e.path}: ${e.message}`).join('; '));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function exportSelected(): Promise<void> {
    try {
      const dir = await callApi<'profiles:exportSelected', string | null>('profiles:exportSelected', {
        ids: Array.from(selected),
      });
      if (dir) setInfo(`Exported ${selected.size} profile(s) to ${dir}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function exportAll(): Promise<void> {
    try {
      const dir = await callApi<'profiles:exportAll', string | null>('profiles:exportAll', {});
      if (dir) setInfo(`Exported all profiles to ${dir}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function bulk(
    action: 'profiles:bulkStart' | 'profiles:bulkStop' | 'profiles:bulkDelete' | 'profiles:bulkClone',
  ): Promise<void> {
    if (selected.size === 0) return;
    setBulkBusy(true);
    try {
      const result = await callApi<typeof action, BulkResult>(action, { ids: Array.from(selected) });
      setInfo(`${result.succeeded.length} succeeded, ${result.failed.length} failed`);
      setSelected(new Set());
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
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
      setInfo(`Proxy assigned to ${result.succeeded.length} profile(s)`);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
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
      setInfo(`Tag added to ${result.succeeded.length} profile(s)`);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBulkBusy(false);
    }
  }

  return (
    <>
      <div className="toolbar">
        <input placeholder="Search profiles..." value={search} onChange={(e) => setSearch(e.target.value)} />
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}>
          <option value="ALL">All statuses</option>
          <option value="RUNNING">Running</option>
          <option value="STOPPED">Stopped</option>
          <option value="CRASHED">Crashed</option>
          <option value="ERROR">Error</option>
          <option value="LOCKED">Locked</option>
        </select>
        <select value={tagFilter} onChange={(e) => setTagFilter(e.target.value)}>
          <option value="">All tags</option>
          {allTags.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <select value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)}>
          <option value="name">Sort: Name</option>
          <option value="status">Sort: Status</option>
          <option value="lastUsed">Sort: Last Used</option>
        </select>
        <div style={{ flex: 1 }} />
        <select value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
          <option value="">Automatic (mixed)</option>
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <input placeholder="New profile name" value={newName} onChange={(e) => setNewName(e.target.value)} />
        <button className="primary" onClick={() => void createProfile()}>
          New Profile
        </button>
        <button onClick={() => void importProfiles()}>Import</button>
        <button onClick={() => void restoreProfile()}>Restore</button>
        <button onClick={() => void exportAll()}>Export All</button>
      </div>

      {selected.size > 0 && (
        <div className="toolbar bulk-toolbar" style={{ background: 'var(--bg-hover)' }}>
          <strong style={{ fontSize: 12 }}>{selected.size} selected</strong>
          <button disabled={bulkBusy} onClick={() => void bulk('profiles:bulkStart')}>
            Start
          </button>
          <button disabled={bulkBusy} onClick={() => void bulk('profiles:bulkStop')}>
            Stop
          </button>
          <button disabled={bulkBusy} onClick={() => void bulk('profiles:bulkClone')}>
            Clone
          </button>
          <button disabled={bulkBusy} onClick={() => void bulk('profiles:bulkDelete')}>
            Delete
          </button>
          <button disabled={bulkBusy} onClick={() => void exportSelected()}>
            Export Selected
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
              Assign proxy…
            </option>
            <option value="">None (remove proxy)</option>
            {proxies.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <input
            placeholder="Add tag + Enter"
            style={{ width: 140 }}
            disabled={bulkBusy}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                void bulkAddTag(e.currentTarget.value);
                e.currentTarget.value = '';
              }
            }}
          />
          <button disabled={bulkBusy} onClick={() => setSelected(new Set())}>
            Clear selection
          </button>
        </div>
      )}

      <div className="content">
        {error && <div className="error-banner">{error}</div>}
        {info && (
          <div className="error-banner" style={{ borderColor: 'var(--green)', color: '#a6f0b4' }}>
            {info}
          </div>
        )}
        <table>
          <thead>
            <tr>
              <th style={{ width: 24 }}>
                <input type="checkbox" checked={allVisibleSelected} onChange={toggleSelectAll} />
              </th>
              <th>Name</th>
              <th>Status</th>
              <th>OS</th>
              <th>Browser</th>
              <th>Proxy</th>
              <th>Tags</th>
              <th>Last Used</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {visibleProfiles.map((p) => (
              <tr key={p.id}>
                <td>
                  <input type="checkbox" checked={selected.has(p.id)} onChange={() => toggleSelect(p.id)} />
                </td>
                <td>{p.name}</td>
                <td>
                  <span className={`status-dot status-${p.status}`} />
                  {p.status}
                </td>
                <td style={{ textTransform: 'capitalize' }}>{p.os}</td>
                <td>Chrome {p.browserVersion.split('.')[0]}</td>
                <td>{proxies.find((pr) => pr.id === p.proxyId)?.name ?? '—'}</td>
                <td>
                  {p.tags.map((t) => (
                    <span className="tag" key={t}>
                      {t}
                    </span>
                  ))}
                </td>
                <td>{p.lastStartedAt ?? '—'}</td>
                <td>
                  {p.status === 'RUNNING' ? (
                    <button disabled={busyId === p.id} onClick={() => void runAction(p.id, 'profiles:stop')}>
                      Stop
                    </button>
                  ) : (
                    <button disabled={busyId === p.id} onClick={() => void runAction(p.id, 'profiles:start')}>
                      Start
                    </button>
                  )}
                  <button disabled={busyId === p.id} onClick={() => void runAction(p.id, 'profiles:restart')}>
                    Restart
                  </button>
                  <button disabled={busyId === p.id} onClick={() => setEditingId(p.id)}>
                    Edit
                  </button>
                  <button disabled={busyId === p.id} onClick={() => void cloneOne(p)}>
                    Clone
                  </button>
                  <button disabled={busyId === p.id} onClick={() => void exportConfig(p.id)}>
                    Export
                  </button>
                  <button disabled={busyId === p.id} onClick={() => void backupOne(p.id)}>
                    Backup
                  </button>
                  <button disabled={busyId === p.id} onClick={() => void runAction(p.id, 'profiles:delete')}>
                    Delete
                  </button>
                </td>
              </tr>
            ))}
            {visibleProfiles.length === 0 && (
              <tr>
                <td colSpan={9} style={{ color: 'var(--text-dim)' }}>
                  {profiles.length === 0 ? 'No profiles yet. Create one above.' : 'No profiles match the current filters.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {editingId && (
        <ProfileEditorModal
          profileId={editingId}
          onClose={() => setEditingId(null)}
          onSaved={() => void refresh()}
        />
      )}
    </>
  );
}
