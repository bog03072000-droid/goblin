import { useEffect, useState } from 'react';
import type { Profile } from '@shared/schemas/profile';
import { callApi } from '../services/api';

export function ProfilesPage(): JSX.Element {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [search, setSearch] = useState('');
  const [newName, setNewName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function refresh(): Promise<void> {
    try {
      const list = await callApi<'profiles:list', Profile[]>('profiles:list', { search: search || undefined });
      setProfiles(list);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  async function createProfile(): Promise<void> {
    if (!newName.trim()) return;
    try {
      await callApi('profiles:create', { name: newName.trim() });
      setNewName('');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function runAction(id: string, action: 'profiles:start' | 'profiles:stop' | 'profiles:restart' | 'profiles:delete'): Promise<void> {
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

  return (
    <>
      <div className="toolbar">
        <input placeholder="Search profiles..." value={search} onChange={(e) => setSearch(e.target.value)} />
        <div style={{ flex: 1 }} />
        <input placeholder="New profile name" value={newName} onChange={(e) => setNewName(e.target.value)} />
        <button className="primary" onClick={() => void createProfile()}>
          New Profile
        </button>
      </div>
      <div className="content">
        {error && <div className="error-banner">{error}</div>}
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
            {profiles.map((p) => (
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
                  <button disabled={busyId === p.id} onClick={() => void runAction(p.id, 'profiles:delete')}>
                    Delete
                  </button>
                </td>
              </tr>
            ))}
            {profiles.length === 0 && (
              <tr>
                <td colSpan={5} style={{ color: 'var(--text-dim)' }}>
                  No profiles yet. Create one above.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
