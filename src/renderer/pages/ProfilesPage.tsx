import { useEffect, useMemo, useState } from 'react';
import type { Profile, ProfileStatus } from '@shared/schemas/profile';
import type { Template } from '@shared/schemas/template';
import { callApi } from '../services/api';

type StatusFilter = 'ALL' | ProfileStatus;

export function ProfilesPage(): JSX.Element {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [search, setSearch] = useState('');
  const [tagFilter, setTagFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
  const [newName, setNewName] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function refresh(): Promise<void> {
    try {
      const list = await callApi<'profiles:list', Profile[]>('profiles:list', {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, tagFilter]);

  const allTags = useMemo(() => Array.from(new Set(profiles.flatMap((p) => p.tags))).sort(), [profiles]);

  const visibleProfiles = useMemo(
    () => (statusFilter === 'ALL' ? profiles : profiles.filter((p) => p.status === statusFilter)),
    [profiles, statusFilter],
  );

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

  async function exportConfig(id: string): Promise<void> {
    try {
      const savedPath = await callApi<'profiles:exportConfig', string | null>('profiles:exportConfig', { id });
      setInfo(savedPath ? `Exported configuration to ${savedPath}` : null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function exportFull(id: string): Promise<void> {
    try {
      const savedPath = await callApi<'profiles:exportFull', string | null>('profiles:exportFull', { id });
      setInfo(savedPath ? `Exported full profile to ${savedPath}` : null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function importProfile(): Promise<void> {
    try {
      const created = await callApi<'profiles:import', Profile | null>('profiles:import', {});
      if (created) {
        setInfo(`Imported "${created.name}"`);
        await refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
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
        <button onClick={() => void importProfile()}>Import</button>
      </div>
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
              <th>Name</th>
              <th>Status</th>
              <th>Tags</th>
              <th>Last Used</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {visibleProfiles.map((p) => (
              <tr key={p.id}>
                <td>{p.name}</td>
                <td>
                  <span className={`status-dot status-${p.status}`} />
                  {p.status}
                </td>
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
                  <button disabled={busyId === p.id} onClick={() => void exportConfig(p.id)}>
                    Export Config
                  </button>
                  <button disabled={busyId === p.id} onClick={() => void exportFull(p.id)}>
                    Export Full
                  </button>
                  <button disabled={busyId === p.id} onClick={() => void runAction(p.id, 'profiles:delete')}>
                    Delete
                  </button>
                </td>
              </tr>
            ))}
            {visibleProfiles.length === 0 && (
              <tr>
                <td colSpan={5} style={{ color: 'var(--text-dim)' }}>
                  {profiles.length === 0 ? 'No profiles yet. Create one above.' : 'No profiles match the current filters.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
