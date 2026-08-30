import type { Group } from '@shared/schemas/group';
import { useTranslation } from '../../i18n';

export function GeneralTab({
  name,
  onNameChange,
  description,
  onDescriptionChange,
  tagsText,
  onTagsTextChange,
  groupId,
  onGroupIdChange,
  groups,
  saving,
  onSave,
}: {
  name: string;
  onNameChange: (value: string) => void;
  description: string;
  onDescriptionChange: (value: string) => void;
  tagsText: string;
  onTagsTextChange: (value: string) => void;
  groupId: string;
  onGroupIdChange: (value: string) => void;
  groups: Group[];
  saving: boolean;
  onSave: () => void;
}): JSX.Element {
  const { t } = useTranslation();
  return (
    <div>
      <label style={{ display: 'block', marginBottom: 8 }}>
        {t('editor.general.name')}
        <input value={name} onChange={(e) => onNameChange(e.target.value)} style={{ display: 'block', width: '100%', marginTop: 4 }} />
      </label>
      <label style={{ display: 'block', marginBottom: 8 }}>
        {t('editor.general.description')}
        <textarea
          value={description}
          onChange={(e) => onDescriptionChange(e.target.value)}
          style={{ display: 'block', width: '100%', marginTop: 4, minHeight: 60 }}
        />
      </label>
      <label style={{ display: 'block', marginBottom: 8 }}>
        {t('editor.general.tags')}
        <input value={tagsText} onChange={(e) => onTagsTextChange(e.target.value)} style={{ display: 'block', width: '100%', marginTop: 4 }} />
      </label>
      <label style={{ display: 'block', marginBottom: 8 }}>
        {t('editor.general.group')}
        <select value={groupId} onChange={(e) => onGroupIdChange(e.target.value)} style={{ display: 'block', width: '100%', marginTop: 4 }}>
          <option value="">{t('profiles.group.none')}</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
      </label>
      <button className="btn btn-primary" disabled={saving} onClick={onSave}>
        {saving && <span className="spinner" />}
        {t('common.save')}
      </button>
    </div>
  );
}
