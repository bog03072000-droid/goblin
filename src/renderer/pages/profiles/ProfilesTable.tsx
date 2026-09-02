import { useState } from 'react';
import {
  Play,
  Square,
  RotateCw,
  Pencil,
  Copy,
  FileDown,
  Archive,
  Trash2,
  CircleCheck,
  CircleDot,
  Circle,
  CircleX,
  CircleAlert,
  Lock,
  type LucideIcon,
} from 'lucide-react';
import type { ProfileListItem, ProfileStatus } from '@shared/schemas/profile';
import type { ProxyRecord } from '@shared/schemas/proxy';
import type { Group } from '@shared/schemas/group';
import { useTranslation } from '../../i18n';
import { STATUS_LABEL_KEYS } from './ProfilesToolbar';
import { ProfileContextMenu, type ContextMenuState } from './ProfileContextMenu';

const PILL_VARIANT: Record<ProfileStatus, string> = {
  RUNNING: 'on',
  STOPPED: 'idle',
  STARTING: 'warn',
  STOPPING: 'warn',
  CRASHED: 'danger',
  ERROR: 'danger',
  LOCKED: 'lock',
};

// Real icon per status, not just color — so the difference between e.g.
// STARTING (transitioning) and CRASHED (both render with a "warn"-adjacent
// hue on some monitors/color-vision settings) reads at a glance from shape
// too, not color alone.
const PILL_ICON: Record<ProfileStatus, LucideIcon> = {
  RUNNING: CircleCheck,
  STOPPED: Circle,
  STARTING: CircleDot,
  STOPPING: CircleDot,
  CRASHED: CircleX,
  ERROR: CircleAlert,
  LOCKED: Lock,
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
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  return (
    <div className="panel">
      <table>
        <thead>
          <tr>
            <th className="w-24">
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
            <tr
              key={p.id}
              data-status={p.status}
              data-profile-id={p.id}
              onContextMenu={(e) => {
                e.preventDefault();
                setContextMenu({ x: e.clientX, y: e.clientY, profile: p });
              }}
            >
              <td>
                <input type="checkbox" checked={selected.has(p.id)} onChange={() => onToggleSelect(p.id)} />
              </td>
              <td>{p.name}</td>
              <td>
                <span className={`pill ${PILL_VARIANT[p.status]}`}>
                  {(() => {
                    const StatusIcon = PILL_ICON[p.status];
                    return <StatusIcon size={12} />;
                  })()}
                  {t(STATUS_LABEL_KEYS[p.status])}
                </span>
              </td>
              <td className="capitalize">{p.os}</td>
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
                    {busyId === p.id ? <span className="spinner" /> : <Square size={13} strokeWidth={2.25} />}
                    {t('profiles.action.stop')}
                  </button>
                ) : (
                  <button className="btn btn-ghost btn-sm" disabled={busyId === p.id} onClick={() => onStart(p.id)}>
                    {busyId === p.id ? <span className="spinner" /> : <Play size={13} strokeWidth={2.25} />}
                    {t('profiles.action.start')}
                  </button>
                )}
                <button className="btn btn-ghost btn-sm" disabled={busyId === p.id} onClick={() => onRestart(p.id)}>
                  {busyId === p.id ? <span className="spinner" /> : <RotateCw size={13} strokeWidth={2.25} />}
                  {t('profiles.action.restart')}
                </button>
                <button className="btn btn-ghost btn-sm" disabled={busyId === p.id} onClick={() => onEdit(p.id)}>
                  <Pencil size={13} strokeWidth={2.25} />
                  {t('profiles.action.edit')}
                </button>
                <button className="btn btn-ghost btn-sm" disabled={busyId === p.id} onClick={() => onClone(p)}>
                  <Copy size={13} strokeWidth={2.25} />
                  {t('profiles.action.clone')}
                </button>
                <button className="btn btn-ghost btn-sm" disabled={busyId === p.id} onClick={() => onExport(p.id)}>
                  <FileDown size={13} strokeWidth={2.25} />
                  {t('profiles.action.export')}
                </button>
                <button className="btn btn-ghost btn-sm" disabled={busyId === p.id} onClick={() => onBackup(p.id)}>
                  <Archive size={13} strokeWidth={2.25} />
                  {t('profiles.action.backup')}
                </button>
                <button className="btn btn-danger-ghost btn-sm" disabled={busyId === p.id} onClick={() => onDeleteRequest(p)}>
                  <Trash2 size={13} strokeWidth={2.25} />
                  {t('profiles.action.delete')}
                </button>
              </td>
            </tr>
          ))}
          {profiles.length === 0 && (
            <tr>
              <td colSpan={10} className="text-dim">
                {totalProfileCount === 0 ? t('profiles.empty.none') : t('profiles.empty.noMatch')}
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {contextMenu && (
        <ProfileContextMenu
          state={contextMenu}
          onClose={() => setContextMenu(null)}
          onStart={onStart}
          onStop={onStop}
          onRestart={onRestart}
          onEdit={onEdit}
          onClone={onClone}
          onBackup={onBackup}
          onExport={onExport}
          onDeleteRequest={onDeleteRequest}
        />
      )}
    </div>
  );
}
