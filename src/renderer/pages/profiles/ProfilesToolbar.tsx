import type { ProfileStatus } from '@shared/schemas/profile';
import type { Template } from '@shared/schemas/template';
import type { Group } from '@shared/schemas/group';
import { useTranslation, type TranslationKey } from '../../i18n';

export type StatusFilter = 'ALL' | ProfileStatus;
export type SortKey = 'name' | 'status' | 'lastUsed';
export const UNGROUPED_FILTER = '__ungrouped__';

export const STATUS_LABEL_KEYS: Record<ProfileStatus, TranslationKey> = {
  RUNNING: 'profiles.status.running',
  STOPPED: 'profiles.status.stopped',
  STARTING: 'profiles.status.starting',
  STOPPING: 'profiles.status.stopping',
  CRASHED: 'profiles.status.crashed',
  ERROR: 'profiles.status.error',
  LOCKED: 'profiles.status.locked',
};

export function ProfilesToolbar({
  search,
  onSearchChange,
  statusFilter,
  onStatusFilterChange,
  tagFilter,
  onTagFilterChange,
  allTags,
  groupFilter,
  onGroupFilterChange,
  groups,
  onManageGroups,
  sortKey,
  onSortKeyChange,
  templateId,
  onTemplateIdChange,
  templates,
  newName,
  onNewNameChange,
  onCreate,
  onImport,
  onRestore,
  onExportAll,
}: {
  search: string;
  onSearchChange: (value: string) => void;
  statusFilter: StatusFilter;
  onStatusFilterChange: (value: StatusFilter) => void;
  tagFilter: string;
  onTagFilterChange: (value: string) => void;
  allTags: string[];
  groupFilter: string;
  onGroupFilterChange: (value: string) => void;
  groups: Group[];
  onManageGroups: () => void;
  sortKey: SortKey;
  onSortKeyChange: (value: SortKey) => void;
  templateId: string;
  onTemplateIdChange: (value: string) => void;
  templates: Template[];
  newName: string;
  onNewNameChange: (value: string) => void;
  onCreate: () => void;
  onImport: () => void;
  onRestore: () => void;
  onExportAll: () => void;
}): JSX.Element {
  const { t } = useTranslation();
  return (
    <div className="toolbar">
      <input placeholder={t('profiles.searchPlaceholder')} value={search} onChange={(e) => onSearchChange(e.target.value)} />
      <select value={statusFilter} onChange={(e) => onStatusFilterChange(e.target.value as StatusFilter)}>
        <option value="ALL">{t('profiles.status.all')}</option>
        {(Object.keys(STATUS_LABEL_KEYS) as ProfileStatus[]).map((s) => (
          <option key={s} value={s}>
            {t(STATUS_LABEL_KEYS[s])}
          </option>
        ))}
      </select>
      <select value={tagFilter} onChange={(e) => onTagFilterChange(e.target.value)}>
        <option value="">{t('profiles.tag.all')}</option>
        {allTags.map((tg) => (
          <option key={tg} value={tg}>
            {tg}
          </option>
        ))}
      </select>
      <select value={groupFilter} onChange={(e) => onGroupFilterChange(e.target.value)}>
        <option value="">{t('profiles.group.all')}</option>
        <option value={UNGROUPED_FILTER}>{t('profiles.group.ungrouped')}</option>
        {groups.map((g) => (
          <option key={g.id} value={g.id}>
            {g.name} ({g.profileCount})
          </option>
        ))}
      </select>
      <button className="btn btn-ghost" onClick={onManageGroups}>+ {t('profiles.group.manage')}</button>
      <select value={sortKey} onChange={(e) => onSortKeyChange(e.target.value as SortKey)}>
        <option value="name">{t('profiles.sort.name')}</option>
        <option value="status">{t('profiles.sort.status')}</option>
        <option value="lastUsed">{t('profiles.sort.lastUsed')}</option>
      </select>
      <div style={{ flex: 1 }} />
      <select value={templateId} onChange={(e) => onTemplateIdChange(e.target.value)}>
        <option value="">{t('profiles.template.auto')}</option>
        {templates.map((tmpl) => (
          <option key={tmpl.id} value={tmpl.id}>
            {tmpl.name}
          </option>
        ))}
      </select>
      <input placeholder={t('profiles.newNamePlaceholder')} value={newName} onChange={(e) => onNewNameChange(e.target.value)} />
      <button className="btn btn-primary" onClick={onCreate}>
        {t('profiles.create')}
      </button>
      <button className="btn btn-ghost" onClick={onImport}>{t('profiles.import')}</button>
      <button className="btn btn-ghost" onClick={onRestore}>{t('profiles.restore')}</button>
      <button className="btn btn-ghost" onClick={onExportAll}>{t('profiles.exportAll')}</button>
    </div>
  );
}
