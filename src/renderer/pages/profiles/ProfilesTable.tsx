import type { ProfileListItem, ProfileStatus } from '@shared/schemas/profile';
import type { ProxyRecord } from '@shared/schemas/proxy';
import type { Group } from '@shared/schemas/group';
import { useTranslation } from '../../i18n';
import { STATUS_LABEL_KEYS } from './ProfilesToolbar';

const PILL_VARIANT: Record<ProfileStatus, string> = {
  RUNNING: 'on',
  STOPPED: 'idle',
  STARTING: 'warn',
  STOPPING: 'warn',
  CRASHED: 'danger',
  ERROR: 'danger',
  LOCKED: 'lock',
};

export function ProfilesTable({
  profiles,
  totalProfileCount,
  proxies,
  groups,
  selected,
  allVisibleSelected,
  onToggleSelectAll,
  onToggleSelect,
  busyId,
  onStart,
  onStop,
  onRestart,
  onEdit,
  onClone,
  onExport,
  onBackup,
  onDeleteRequest,
}: {
  profiles: ProfileListItem[];
  totalProfileCount: number;
  proxies: ProxyRecord[];
  groups: Group[];
  selected: Set<string>;
  allVisibleSelected: boolean;
  onToggleSelectAll: () => void;
  onToggleSelect: (id: string) => void;
  busyId: string | null;
  onStart: (id: string) => void;
  onStop: (id: string) => void;
  onRestart: (id: string) => void;
  onEdit: (id: string) => void;
  onClone: (profile: ProfileListItem) => void;
  onExport: (id: string) => void;
  onBackup: (id: string) => void;
  onDeleteRequest: (profile: ProfileListItem) => void;
}): JSX.Element {
  const { t } = useTranslation();
  return (
    <div className="panel">
      <table>
        <thead>
          <tr>
            <th style={{ width: 24 }}>
              <input type="checkbox" checked={allVisibleSelected} onChange={onToggleSelectAll} />
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
          {profiles.map((p) => (
            <tr key={p.id} data-status={p.status}>
              <td>
                <input type="checkbox" checked={selected.has(p.id)} onChange={() => onToggleSelect(p.id)} />
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
                  <button className="btn btn-ghost btn-sm" disabled={busyId === p.id} onClick={() => onStop(p.id)}>
                    {busyId === p.id && <span className="spinner" />}
                    {t('profiles.action.stop')}
                  </button>
                ) : (
                  <button className="btn btn-ghost btn-sm" disabled={busyId === p.id} onClick={() => onStart(p.id)}>
                    {busyId === p.id && <span className="spinner" />}
                    {t('profiles.action.start')}
                  </button>
                )}
                <button className="btn btn-ghost btn-sm" disabled={busyId === p.id} onClick={() => onRestart(p.id)}>
                  {busyId === p.id && <span className="spinner" />}
                  {t('profiles.action.restart')}
                </button>
                <button className="btn btn-ghost btn-sm" disabled={busyId === p.id} onClick={() => onEdit(p.id)}>
                  {t('profiles.action.edit')}
                </button>
                <button className="btn btn-ghost btn-sm" disabled={busyId === p.id} onClick={() => onClone(p)}>
                  {t('profiles.action.clone')}
                </button>
                <button className="btn btn-ghost btn-sm" disabled={busyId === p.id} onClick={() => onExport(p.id)}>
                  {t('profiles.action.export')}
                </button>
                <button className="btn btn-ghost btn-sm" disabled={busyId === p.id} onClick={() => onBackup(p.id)}>
                  {t('profiles.action.backup')}
                </button>
                <button className="btn btn-danger-ghost btn-sm" disabled={busyId === p.id} onClick={() => onDeleteRequest(p)}>
                  {t('profiles.action.delete')}
                </button>
              </td>
            </tr>
          ))}
          {profiles.length === 0 && (
            <tr>
              <td colSpan={10} style={{ color: 'var(--ash-dim)' }}>
                {totalProfileCount === 0 ? t('profiles.empty.none') : t('profiles.empty.noMatch')}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
