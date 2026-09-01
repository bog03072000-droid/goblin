import { useState } from 'react';
import type { Group } from '@shared/schemas/group';
import { ConfirmDialog } from './ConfirmDialog';
import { useTranslation } from '../i18n';

/** Replaces the previous window.prompt()/window.confirm()-based group
 * management with a proper modal, in the same visual language as
 * ConfirmDialog/ProfileEditorModal (modal-overlay/modal-panel). */
export function GroupsModal({
  groups,
  onCreate,
  onRename,
  onDelete,
  onClose,
}: {
  groups: Group[];
  onCreate: (name: string) => void;
  onRename: (group: Group, name: string) => void;
  onDelete: (group: Group) => void;
  onClose: () => void;
}): JSX.Element {
  const { t } = useTranslation();
  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<Group | null>(null);

  function startRename(group: Group): void {
    setEditingId(group.id);
    setEditingName(group.name);
  }

  function commitRename(group: Group): void {
    const trimmed = editingName.trim();
    if (trimmed && trimmed !== group.name) onRename(group, trimmed);
    setEditingId(null);
  }

  function submitCreate(): void {
    const trimmed = newName.trim();
    if (!trimmed) return;
    onCreate(trimmed);
    setNewName('');
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel modal-panel-groups" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 className="modal-header-title">{t('profiles.group.manage')}</h3>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>
            {t('common.close')}
          </button>
        </div>
        <div className="modal-body-scroll">
          <div className="group-create-row">
            <input
              placeholder={t('profiles.group.newNamePlaceholder')}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submitCreate()}
              className="flex-1"
            />
            <button className="btn btn-primary" onClick={submitCreate}>
              {t('profiles.group.create')}
            </button>
          </div>

          {groups.length === 0 && <p className="text-dim text-sm">{t('profiles.group.empty')}</p>}

          {groups.map((g) => (
            <div key={g.id} className="group-row">
              {editingId === g.id ? (
                <input
                  autoFocus
                  value={editingName}
                  onChange={(e) => setEditingName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitRename(g);
                    if (e.key === 'Escape') setEditingId(null);
                  }}
                  onBlur={() => commitRename(g)}
                  className="flex-1"
                />
              ) : (
                <span className="group-name">
                  {g.name} <span className="mono group-count">({g.profileCount})</span>
                </span>
              )}
              <button className="btn btn-ghost btn-sm" onClick={() => startRename(g)}>
                {t('common.rename')}
              </button>
              <button className="btn btn-danger-ghost btn-sm" onClick={() => setConfirmDelete(g)}>
                {t('common.delete')}
              </button>
            </div>
          ))}
        </div>
      </div>
      {confirmDelete && (
        <ConfirmDialog
          message={t('profiles.group.confirmDelete', { name: confirmDelete.name })}
          confirmLabel={t('common.delete')}
          onCancel={() => setConfirmDelete(null)}
          onConfirm={() => {
            onDelete(confirmDelete);
            setConfirmDelete(null);
          }}
        />
      )}
    </div>
  );
}
