import { memo, useMemo, useState, type MouseEvent } from 'react';
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

/** One profile row — split out of ProfilesTable's own render and wrapped in
 * React.memo (custom comparator below) so a change that only affects SOME
 * rows (e.g. one row's busy/selected state) doesn't force React to recreate
 * and diff every other row's entire JSX subtree too. Found to matter far
 * less in practice than assumed — see ProfilesTable's own module comment —
 * but is still real, low-risk, standard practice once the row is its own
 * component, so kept regardless. */
const ProfileRow = memo(
  function ProfileRow({
    profile,
    isSelected,
    isBusy,
    proxyName,
    groupName,
    onToggleSelect,
    onContextMenu,
    onStart,
    onStop,
    onRestart,
    onEdit,
    onClone,
    onExport,
    onBackup,
    onDeleteRequest,
  }: {
    profile: ProfileListItem;
    isSelected: boolean;
    isBusy: boolean;
    proxyName: string;
    groupName: string;
    onToggleSelect: (id: string) => void;
    onContextMenu: (e: MouseEvent, profile: ProfileListItem) => void;
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
    const StatusIcon = PILL_ICON[profile.status];
    return (
      <tr data-status={profile.status} data-profile-id={profile.id} onContextMenu={(e) => onContextMenu(e, profile)}>
        <td>
          <input type="checkbox" checked={isSelected} onChange={() => onToggleSelect(profile.id)} />
        </td>
        <td>{profile.name}</td>
        <td>
          <span className={`pill ${PILL_VARIANT[profile.status]}`}>
            <StatusIcon size={12} />
            {t(STATUS_LABEL_KEYS[profile.status])}
          </span>
        </td>
        <td className="capitalize">{profile.os}</td>
        <td>Chrome {profile.browserVersion.split('.')[0]}</td>
        <td>{proxyName}</td>
        <td>{groupName}</td>
        <td>
          {profile.tags.map((tg) => (
            <span className="tag" key={tg}>
              {tg}
            </span>
          ))}
        </td>
        <td className="mono">{profile.lastStartedAt ?? '—'}</td>
        <td>
          {profile.status === 'RUNNING' ? (
            <button className="btn btn-ghost btn-sm" disabled={isBusy} onClick={() => onStop(profile.id)}>
              {isBusy ? <span className="spinner" /> : <Square size={13} strokeWidth={2.25} />}
              {t('profiles.action.stop')}
            </button>
          ) : (
            <button className="btn btn-ghost btn-sm" disabled={isBusy} onClick={() => onStart(profile.id)}>
              {isBusy ? <span className="spinner" /> : <Play size={13} strokeWidth={2.25} />}
              {t('profiles.action.start')}
            </button>
          )}
          <button className="btn btn-ghost btn-sm" disabled={isBusy} onClick={() => onRestart(profile.id)}>
            {isBusy ? <span className="spinner" /> : <RotateCw size={13} strokeWidth={2.25} />}
            {t('profiles.action.restart')}
          </button>
          <button className="btn btn-ghost btn-sm" disabled={isBusy} onClick={() => onEdit(profile.id)}>
            <Pencil size={13} strokeWidth={2.25} />
            {t('profiles.action.edit')}
          </button>
          <button className="btn btn-ghost btn-sm" disabled={isBusy} onClick={() => onClone(profile)}>
            <Copy size={13} strokeWidth={2.25} />
            {t('profiles.action.clone')}
          </button>
          <button className="btn btn-ghost btn-sm" disabled={isBusy} onClick={() => onExport(profile.id)}>
            <FileDown size={13} strokeWidth={2.25} />
            {t('profiles.action.export')}
          </button>
          <button className="btn btn-ghost btn-sm" disabled={isBusy} onClick={() => onBackup(profile.id)}>
            <Archive size={13} strokeWidth={2.25} />
            {t('profiles.action.backup')}
          </button>
          <button className="btn btn-danger-ghost btn-sm" disabled={isBusy} onClick={() => onDeleteRequest(profile)}>
            <Trash2 size={13} strokeWidth={2.25} />
            {t('profiles.action.delete')}
          </button>
        </td>
      </tr>
    );
  },
  // Custom comparator: ignores the callback props' identity on purpose.
  // ProfilesPage.tsx passes onStart/onStop/etc. as fresh inline closures on
  // every render (not wrapped in useCallback) — a default shallow-equal
  // memo would be defeated by that alone, re-rendering every row on every
  // ProfilesPage render regardless of whether that row's own data changed.
  // Every one of those closures only ever reads the current profile id from
  // its own argument and calls through to logic that's already current, so
  // treating them as "always equal enough" for memo purposes is correct,
  // not just convenient — only the props that actually determine this row's
  // rendered output are compared.
  (prev, next) =>
    prev.profile === next.profile &&
    prev.isSelected === next.isSelected &&
    prev.isBusy === next.isBusy &&
    prev.proxyName === next.proxyName &&
    prev.groupName === next.groupName,
);

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
  // O(1) lookup instead of profiles.length * proxies.length / groups.length
  // Array.find() calls (was recomputed inline per row on every render) —
  // real, if secondary, cost alongside the memoization above.
  const proxyNameById = useMemo(() => new Map(proxies.map((p) => [p.id, p.name])), [proxies]);
  const groupNameById = useMemo(() => new Map(groups.map((g) => [g.id, g.name])), [groups]);

  function handleContextMenu(e: MouseEvent, profile: ProfileListItem): void {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, profile });
  }

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
            <ProfileRow
              key={p.id}
              profile={p}
              isSelected={selected.has(p.id)}
              isBusy={busyId === p.id}
              proxyName={(p.proxyId && proxyNameById.get(p.proxyId)) || '—'}
              groupName={(p.groupId && groupNameById.get(p.groupId)) || '—'}
              onToggleSelect={onToggleSelect}
              onContextMenu={handleContextMenu}
              onStart={onStart}
              onStop={onStop}
              onRestart={onRestart}
              onEdit={onEdit}
              onClone={onClone}
              onExport={onExport}
              onBackup={onBackup}
              onDeleteRequest={onDeleteRequest}
            />
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
