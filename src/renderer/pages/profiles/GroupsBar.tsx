import type { Group } from '@shared/schemas/group';

export function GroupsBar({
  groups,
  onRename,
  onDelete,
}: {
  groups: Group[];
  onRename: (group: Group) => void;
  onDelete: (group: Group) => void;
}): JSX.Element | null {
  if (groups.length === 0) return null;
  return (
    <div className="toolbar" style={{ fontSize: 12, color: 'var(--ash-dim)' }}>
      {groups.map((g) => (
        <span key={g.id} style={{ display: 'inline-flex', gap: 4, alignItems: 'center', marginRight: 10 }}>
          {g.name} ({g.profileCount})
          <button className="btn btn-ghost btn-sm" onClick={() => onRename(g)}>
            ✎
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => onDelete(g)}>
            ✕
          </button>
        </span>
      ))}
    </div>
  );
}
