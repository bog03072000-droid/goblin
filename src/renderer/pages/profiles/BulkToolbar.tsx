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
  onClone,
  onDeleteRequest,
  onExportSelected,
  onAssignProxy,
  onAssignGroup,
  onAddTag,
  onClearSelection,
}: {
  selectedCount: number;
  bulkBusy: boolean;
  proxies: ProxyRecord[];
  groups: Group[];
  onStart: () => void;
  onStop: () => void;
  onClone: () => void;
  onDeleteRequest: () => void;
  onExportSelected: () => void;
  onAssignProxy: (proxyId: string) => void;
  onAssignGroup: (groupId: string) => void;
  onAddTag: (tag: string) => void;
  onClearSelection: () => void;
}): JSX.Element {
  const { t } = useTranslation();
  return (
    <div className="toolbar bulk-toolbar">
      <strong style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center' }}>
        {bulkBusy && <span className="spinner" />}
        {bulkBusy ? t('common.working') : t('profiles.selectedCount', { count: selectedCount })}
      </strong>
      <button className="btn btn-ghost btn-sm" disabled={bulkBusy} onClick={onStart}>
        {t('profiles.bulk.start')}
      </button>
      <button className="btn btn-ghost btn-sm" disabled={bulkBusy} onClick={onStop}>
        {t('profiles.bulk.stop')}
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
        style={{ width: 140 }}
        disabled={bulkBusy}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            onAddTag(e.currentTarget.value);
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
