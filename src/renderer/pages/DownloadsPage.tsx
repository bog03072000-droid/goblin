import { useEffect, useState } from 'react';
import { FolderOpen, FolderSearch, RotateCcw, Trash2 } from 'lucide-react';
import type { DownloadWithStatus } from '@shared/schemas/download';
import type { Profile } from '@shared/schemas/profile';
import { callApi } from '../services/api';
import { useAsyncAction } from '../hooks/useAsyncAction';
import { useTranslation } from '../i18n';

function formatBytes(n: number): string {
  if (!n || n <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

export function DownloadsPage(): JSX.Element {
  const { t } = useTranslation();
  const [downloads, setDownloads] = useState<DownloadWithStatus[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [search, setSearch] = useState('');
  const [profileId, setProfileId] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const { error, run } = useAsyncAction();
  const actionRunner = useAsyncAction();

  async function load(): Promise<void> {
    await run(async () => {
      const list = await callApi<'downloads:list', DownloadWithStatus[]>('downloads:list', {
        profileId: profileId || undefined,
        search: search || undefined,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo ? `${dateTo}T23:59:59.999Z` : undefined,
      });
      setDownloads(list);
      if (profiles.length === 0) {
        const profileList = await callApi<'profiles:list', Profile[]>('profiles:list', {});
        setProfiles(profileList);
      }
    });
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, profileId, dateFrom, dateTo]);

  async function handleOpen(id: string): Promise<void> {
    await actionRunner.run(() => callApi('downloads:open', { id }));
  }
  async function handleShow(id: string): Promise<void> {
    await actionRunner.run(() => callApi('downloads:showInFolder', { id }));
  }
  async function handleDelete(id: string): Promise<void> {
    if (!confirm(t('downloads.confirmDelete'))) return;
    await actionRunner.run(async () => {
      await callApi('downloads:delete', { id });
      await load();
    });
  }
  async function handleRedownload(id: string): Promise<void> {
    await actionRunner.run(() => callApi('downloads:redownload', { id }));
  }

  function statusPillVariant(d: DownloadWithStatus): string {
    if (d.missing) return 'warn';
    if (d.state === 'completed') return 'on';
    if (d.state === 'cancelled') return 'idle';
    return 'danger';
  }

  function statusLabel(d: DownloadWithStatus): string {
    if (d.missing) return t('downloads.status.missing');
    return t(`downloads.status.${d.state}` as const);
  }

  return (
    <div className="content">
      {error && <div className="banner banner-error">{error}</div>}
      <div className="toolbar" style={{ borderBottom: 'none', background: 'transparent', padding: 0, marginBottom: 12 }}>
        <input
          placeholder={t('downloads.searchPlaceholder')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ minWidth: 220 }}
        />
        <select value={profileId} onChange={(e) => setProfileId(e.target.value)}>
          <option value="">{t('downloads.filter.allProfiles')}</option>
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} title={t('downloads.filter.dateFrom')} />
        <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} title={t('downloads.filter.dateTo')} />
      </div>
      <div className="panel">
        <table>
          <thead>
            <tr>
              <th>{t('downloads.table.filename')}</th>
              <th>{t('downloads.table.profile')}</th>
              <th>{t('downloads.table.size')}</th>
              <th>{t('downloads.table.date')}</th>
              <th>{t('downloads.table.status')}</th>
              <th>{t('downloads.table.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {downloads.map((d) => (
              <tr key={d.id}>
                <td title={d.savePath}>{d.filename}</td>
                <td>{d.profileName}</td>
                <td className="mono">{formatBytes(d.totalBytes)}</td>
                <td className="mono">{new Date(d.createdAt).toLocaleString()}</td>
                <td>
                  <span className={`pill ${statusPillVariant(d)}`}>{statusLabel(d)}</span>
                </td>
                <td>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {!d.missing && d.state === 'completed' && (
                      <>
                        <button className="btn btn-ghost btn-sm" onClick={() => void handleOpen(d.id)}>
                          <FolderOpen size={13} strokeWidth={2.25} />
                          {t('downloads.action.open')}
                        </button>
                        <button className="btn btn-ghost btn-sm" onClick={() => void handleShow(d.id)}>
                          <FolderSearch size={13} strokeWidth={2.25} />
                          {t('downloads.action.showInFolder')}
                        </button>
                      </>
                    )}
                    <button className="btn btn-ghost btn-sm" onClick={() => void handleRedownload(d.id)}>
                      <RotateCcw size={13} strokeWidth={2.25} />
                      {t('downloads.action.redownload')}
                    </button>
                    <button className="btn btn-danger-ghost btn-sm" onClick={() => void handleDelete(d.id)}>
                      <Trash2 size={13} strokeWidth={2.25} />
                      {t('downloads.action.delete')}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {downloads.length === 0 && !error && (
              <tr>
                <td colSpan={6} style={{ color: 'var(--ash-dim)' }}>
                  {search || profileId || dateFrom || dateTo ? t('downloads.empty.noMatch') : t('downloads.empty.none')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
