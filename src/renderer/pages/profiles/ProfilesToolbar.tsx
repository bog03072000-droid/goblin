import { ArrowUp, ArrowDown, FolderCog, ArrowLeftRight, UserPlus, Zap, Upload, ArchiveRestore, FileDown } from 'lucide-react';
import type { ProfileStatus } from '@shared/schemas/profile';
import type { Template } from '@shared/schemas/template';
import type { Group } from '@shared/schemas/group';
import type { ProxyRecord } from '@shared/schemas/proxy';
import { useTranslation, type TranslationKey } from '../../i18n';

export type StatusFilter = 'ALL' | ProfileStatus;
export type SortKey = 'name' | 'status' | 'lastUsed';
export type SortDirection = 'asc' | 'desc';
export const UNGROUPED_FILTER = '__ungrouped__';
export const NO_PROXY_FILTER = '__no_proxy__';

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
  proxyFilter,
  onProxyFilterChange,
  proxies,
  sortKey,
  onSortKeyChange,
  sortDirection,
  onToggleSortDirection,
  onInvertSelection,
  templateId,
  onTemplateIdChange,
  templates,
  newName,
  onNewNameChange,
  newGroupId,
  onNewGroupIdChange,
  newProxyId,
  onNewProxyIdChange,
  newTags,
  onNewTagsChange,
  onCreate,
  onQuickCreate,
  quickCreatePending,
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
  proxyFilter: string;
  onProxyFilterChange: (value: string) => void;
  proxies: ProxyRecord[];
  sortKey: SortKey;
  onSortKeyChange: (value: SortKey) => void;
  sortDirection: SortDirection;
  onToggleSortDirection: () => void;
  onInvertSelection: () => void;
  templateId: string;
  onTemplateIdChange: (value: string) => void;
  templates: Template[];
  newName: string;
  onNewNameChange: (value: string) => void;
  newGroupId: string;
  onNewGroupIdChange: (value: string) => void;
  newProxyId: string;
  onNewProxyIdChange: (value: string) => void;
  newTags: string;
  onNewTagsChange: (value: string) => void;
  onCreate: () => void;
  onQuickCreate: () => void;
  quickCreatePending: boolean;
  onImport: () => void;
  onRestore: () => void;
  onExportAll: () => void;
}): JSX.Element {
  const { t } = useTranslation();
  return (
    <div className="toolbar" style={{ flexWrap: 'wrap' }}>
      <input
        id="profiles-search-input"
        placeholder={t('profiles.searchPlaceholder')}
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
      />
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
      <select value={proxyFilter} onChange={(e) => onProxyFilterChange(e.target.value)}>
        <option value="">{t('profiles.proxy.all')}</option>
        <option value={NO_PROXY_FILTER}>{t('profiles.proxy.none')}</option>
        {proxies.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      <button className="btn btn-ghost" onClick={onManageGroups}>
        <FolderCog size={14} strokeWidth={2.25} />
        {t('profiles.group.manage')}
      </button>
      <div style={{ display: 'inline-flex' }}>
        <select value={sortKey} onChange={(e) => onSortKeyChange(e.target.value as SortKey)}>
          <option value="name">{t('profiles.sort.name')}</option>
          <option value="status">{t('profiles.sort.status')}</option>
          <option value="lastUsed">{t('profiles.sort.lastUsed')}</option>
        </select>
        <button
          className="btn btn-ghost btn-sm"
          title={sortDirection === 'asc' ? t('profiles.sort.ascending') : t('profiles.sort.descending')}
          onClick={onToggleSortDirection}
        >
          {sortDirection === 'asc' ? <ArrowUp size={14} strokeWidth={2.25} /> : <ArrowDown size={14} strokeWidth={2.25} />}
        </button>
      </div>
      <button className="btn btn-ghost btn-sm" onClick={onInvertSelection}>
        <ArrowLeftRight size={14} strokeWidth={2.25} />
        {t('profiles.selection.invert')}
      </button>
      <div style={{ flex: 1 }} />
      <select value={templateId} onChange={(e) => onTemplateIdChange(e.target.value)}>
        <option value="">{t('profiles.template.auto')}</option>
        {templates.map((tmpl) => (
          <option key={tmpl.id} value={tmpl.id}>
            {tmpl.name}
          </option>
        ))}
      </select>
      <input
        id="profiles-create-name-input"
        placeholder={t('profiles.newNamePlaceholder')}
        value={newName}
        onChange={(e) => onNewNameChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onCreate();
        }}
      />
      <select value={newGroupId} onChange={(e) => onNewGroupIdChange(e.target.value)} title={t('profiles.group.assign')}>
        <option value="">{t('profiles.group.none')}</option>
        {groups.map((g) => (
          <option key={g.id} value={g.id}>
            {g.name}
          </option>
        ))}
      </select>
      <select value={newProxyId} onChange={(e) => onNewProxyIdChange(e.target.value)} title={t('profiles.proxy.assign')}>
        <option value="">{t('profiles.proxy.none')}</option>
        {proxies.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      <input
        placeholder={t('profiles.newTagsPlaceholder')}
        style={{ width: 120 }}
        value={newTags}
        onChange={(e) => onNewTagsChange(e.target.value)}
      />
      <button
        className="btn btn-ghost"
        onClick={onQuickCreate}
        disabled={quickCreatePending}
        title={t('profiles.quickCreate.hint')}
      >
        <Zap size={14} strokeWidth={2.25} />
        {t('profiles.quickCreate')}
      </button>
      <button className="btn btn-primary" onClick={onCreate}>
        <UserPlus size={14} strokeWidth={2.25} />
        {t('profiles.create')}
      </button>
      <button className="btn btn-ghost" onClick={onImport}>
        <Upload size={14} strokeWidth={2.25} />
        {t('profiles.import')}
      </button>
      <button className="btn btn-ghost" onClick={onRestore}>
        <ArchiveRestore size={14} strokeWidth={2.25} />
        {t('profiles.restore')}
      </button>
      <button className="btn btn-ghost" onClick={onExportAll}>
        <FileDown size={14} strokeWidth={2.25} />
        {t('profiles.exportAll')}
      </button>
    </div>
  );
}
