import type { ProxyRecord } from '@shared/schemas/proxy';
import type { Group } from '@shared/schemas/group';
import { useTranslation } from '../../i18n';

export function BulkToolbar({
  selectedCount,
  bulkBusy,
  proxies,
  groups,
  onStart,
  onStop,
  onRestart,
  onClone,
  onDeleteRequest,
  onExportSelected,
  onBackup,
  onAssignProxy,
  onAssignGroup,
  onAddTag,
  onRemoveTag,
  onClearSelection,
}: {
  selectedCount: number;
  bulkBusy: boolean;
  proxies: ProxyRecord[];
  groups: Group[];
  onStart: () => void;
  onStop: () => void;
  onRestart: () => void;
  onClone: () => void;
  onDeleteRequest: () => void;
  onExportSelected: () => void;
  onBackup: () => void;
  onAssignProxy: (proxyId: string) => void;
  onAssignGroup: (groupId: string) => void;
  onAddTag: (tag: string) => void;
  onRemoveTag: (tag: string) => void;
  onClearSelection: () => void;
}): JSX.Element {
  const { t } = useTranslation();
  return (
    <div className="toolbar bulk-toolbar">
      <strong className="selected-count">
        {bulkBusy && <span className="spinner" />}
        {bulkBusy ? t('common.working') : t('profiles.selectedCount', { count: selectedCount })}
      </strong>
      <button className="btn btn-ghost btn-sm" disabled={bulkBusy} onClick={onStart}>
        {t('profiles.bulk.start')}
      </button>
      <button className="btn btn-ghost btn-sm" disabled={bulkBusy} onClick={onStop}>
        {t('profiles.bulk.stop')}
      </button>
      <button className="btn btn-ghost btn-sm" disabled={bulkBusy} onClick={onRestart}>
        {t('profiles.bulk.restart')}
      </button>
      <button className="btn btn-ghost btn-sm" disabled={bulkBusy} onClick={onClone}>
        {t('profiles.bulk.clone')}
      </button>
      <button className="btn btn-danger-ghost btn-sm" disabled={bulkBusy} onClick={onDeleteRequest}>
        {t('profiles.bulk.delete')}
      </button>
      <button className="btn btn-ghost btn-sm" disabled={bulkBusy} onClick={onExportSelected}>
        {t('profiles.bulk.exportSelected')}
      </button>
      <button className="btn btn-ghost btn-sm" disabled={bulkBusy} onClick={onBackup}>
        {t('profiles.bulk.backup')}
      </button>
      <select
        disabled={bulkBusy}
        defaultValue=""
        onChange={(e) => {
          onAssignProxy(e.target.value);
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
          onAssignGroup(e.target.value);
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
        className="w-140"
        disabled={bulkBusy}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            onAddTag(e.currentTarget.value);
            e.currentTarget.value = '';
          }
        }}
      />
      <input
        placeholder={t('profiles.bulk.removeTagPlaceholder')}
        className="w-140"
        disabled={bulkBusy}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            onRemoveTag(e.currentTarget.value);
            e.currentTarget.value = '';
          }
        }}
      />
      <button className="btn btn-ghost btn-sm" disabled={bulkBusy} onClick={onClearSelection}>
        {t('profiles.bulk.clearSelection')}
      </button>
    </div>
  );
}
