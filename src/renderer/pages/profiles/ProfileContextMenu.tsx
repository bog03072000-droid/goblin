import { useEffect, useRef } from 'react';
import type { ProfileListItem } from '@shared/schemas/profile';
import { useTranslation } from '../../i18n';

export interface ContextMenuState {
  x: number;
  y: number;
  profile: ProfileListItem;
}

/** Only shows actions that make sense for the profile's current status —
 * e.g. never "Stop" on a stopped profile, never "Delete" affordance
 * disabled just because it's running (that's still allowed to try; the
 * backend's own clear "stop it first" error handles that case, tested in
 * reliability.spec.ts). "Move to Group"/"Add Tag" open the editor's General
 * tab (where both already live) rather than duplicating that UI here. */
export function ProfileContextMenu({
  state,
  onClose,
  onStart,
  onStop,
  onRestart,
  onEdit,
  onClone,
  onBackup,
  onExport,
  onDeleteRequest,
}: {
  state: ContextMenuState;
  onClose: () => void;
  onStart: (id: string) => void;
  onStop: (id: string) => void;
  onRestart: (id: string) => void;
  onEdit: (id: string) => void;
  onClone: (profile: ProfileListItem) => void;
  onBackup: (id: string) => void;
  onExport: (id: string) => void;
  onDeleteRequest: (profile: ProfileListItem) => void;
}): JSX.Element {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const { profile } = state;
  const isRunning = profile.status === 'RUNNING';
  const isTransitional = profile.status === 'STARTING' || profile.status === 'STOPPING';

  // Real context menus are keyboard-operable without ever touching the
  // mouse: arrow keys move between items, Enter/Space activates, Escape
  // closes (already handled below). Before this, every item was a bare
  // <div> with a mouse-only onClick — this makes the whole menu behave
  // like the role="menu" it's actually presenting itself as.
  function menuItems(): HTMLElement[] {
    return ref.current ? Array.from(ref.current.querySelectorAll<HTMLElement>('[role="menuitem"]')) : [];
  }

  useEffect(() => {
    // Auto-focuses the first item on open so a keyboard-only interaction
    // (e.g. this menu opened via a keyboard shortcut) can immediately use
    // arrow keys/Enter without an extra Tab press first.
    menuItems()[0]?.focus();

    function handleOutside(e: MouseEvent): void {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    function handleKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      const items = menuItems();
      if (items.length === 0) return;
      e.preventDefault();
      const currentIndex = items.indexOf(document.activeElement as HTMLElement);
      const delta = e.key === 'ArrowDown' ? 1 : -1;
      const nextIndex = (currentIndex + delta + items.length) % items.length;
      items[nextIndex]!.focus();
    }
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('keydown', handleKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onClose]);

  function item(label: string, action: () => void, danger = false): JSX.Element {
    function activate(): void {
      action();
      onClose();
    }
    return (
      <div
        role="menuitem"
        tabIndex={0}
        className={`context-menu-item${danger ? ' danger' : ''}`}
        onClick={activate}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            activate();
          }
        }}
      >
        {label}
      </div>
    );
  }

  // Clamped so the menu never renders past the right/bottom edge of the window.
  const left = Math.min(state.x, window.innerWidth - 200);
  const top = Math.min(state.y, window.innerHeight - 320);

  return (
    <div ref={ref} role="menu" className="context-menu" style={{ left, top }}>
      {!isRunning && !isTransitional && item(t('profiles.context.open'), () => onStart(profile.id))}
      {isRunning && item(t('profiles.context.stop'), () => onStop(profile.id))}
      {!isTransitional && item(t('profiles.action.restart'), () => onRestart(profile.id))}
      <div className="context-menu-divider" />
      {item(t('profiles.action.edit'), () => onEdit(profile.id))}
      {item(t('profiles.action.clone'), () => onClone(profile))}
      {item(t('profiles.action.backup'), () => onBackup(profile.id))}
      {item(t('profiles.action.export'), () => onExport(profile.id))}
      <div className="context-menu-divider" />
      {item(t('profiles.group.assign'), () => onEdit(profile.id))}
      {item(t('profiles.context.addTag'), () => onEdit(profile.id))}
      <div className="context-menu-divider" />
      {item(t('profiles.action.delete'), () => onDeleteRequest(profile), true)}
    </div>
  );
}
