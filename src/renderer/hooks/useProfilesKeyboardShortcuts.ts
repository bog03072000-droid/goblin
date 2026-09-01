import { useEffect } from 'react';
import type { ProfileListItem } from '@shared/schemas/profile';

/** True while the user is typing into any text input/select — used so
 * page-level keyboard shortcuts (Ctrl+A, Delete, Enter) never hijack normal
 * typing, while Ctrl+N/Ctrl+F still work from anywhere as quick jumps. */
function isEditingText(): boolean {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (el as HTMLElement).isContentEditable;
}

/** Page-level shortcuts for ProfilesPage: Ctrl+N (focus the create-name
 * field), Ctrl+F (focus search), Ctrl+A (select all visible), Delete
 * (delete selection), Enter (start the single selected profile). Ctrl+F/
 * Ctrl+N work from anywhere; Ctrl+A/Delete/Enter are suppressed while
 * typing so they never fight with normal text editing (Ctrl+A to select
 * text, Enter in a form). Extracted out of the page component itself since
 * it's a self-contained global listener with no rendered output of its own. */
export function useProfilesKeyboardShortcuts(options: {
  visibleProfiles: ProfileListItem[];
  selected: Set<string>;
  setSelected: (next: Set<string>) => void;
  setConfirmBulkDelete: (value: boolean) => void;
  onStart: (id: string) => void;
}): void {
  const { visibleProfiles, selected, setSelected, setConfirmBulkDelete, onStart } = options;

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent): void {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        document.getElementById('profiles-create-name-input')?.focus();
      } else if (mod && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        document.getElementById('profiles-search-input')?.focus();
      } else if (mod && e.key.toLowerCase() === 'a' && !isEditingText()) {
        e.preventDefault();
        setSelected(new Set(visibleProfiles.map((p) => p.id)));
      } else if (e.key === 'Delete' && !isEditingText() && selected.size > 0) {
        e.preventDefault();
        setConfirmBulkDelete(true);
      } else if (e.key === 'Enter' && !isEditingText() && selected.size === 1) {
        e.preventDefault();
        const id = Array.from(selected)[0]!;
        const target = visibleProfiles.find((p) => p.id === id);
        if (target && target.status !== 'RUNNING' && target.status !== 'STARTING') {
          onStart(id);
        }
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleProfiles, selected]);
}
