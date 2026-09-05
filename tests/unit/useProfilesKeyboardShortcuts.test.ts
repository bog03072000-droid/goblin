// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, cleanup } from '@testing-library/react';
import { fireEvent } from '@testing-library/react';
import { useProfilesKeyboardShortcuts } from '../../src/renderer/hooks/useProfilesKeyboardShortcuts';
import type { ProfileListItem } from '../../src/shared/schemas/profile';

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
});

function makeProfile(overrides: Partial<ProfileListItem> = {}): ProfileListItem {
  return { id: 'p1', name: 'Work Bot', status: 'STOPPED', ...overrides } as ProfileListItem;
}

function setup(overrides: Partial<Parameters<typeof useProfilesKeyboardShortcuts>[0]> = {}) {
  const handlers = {
    visibleProfiles: [makeProfile()],
    selected: new Set<string>(),
    setSelected: vi.fn(),
    setConfirmBulkDelete: vi.fn(),
    onStart: vi.fn(),
    ...overrides,
  };
  renderHook(() => useProfilesKeyboardShortcuts(handlers));
  return handlers;
}

function keydown(key: string, opts: KeyboardEventInit = {}) {
  fireEvent.keyDown(document, { key, ...opts });
}

describe('useProfilesKeyboardShortcuts', () => {
  it('Ctrl+N focuses the create-name input, from anywhere', () => {
    const input = document.createElement('input');
    input.id = 'profiles-create-name-input';
    document.body.appendChild(input);
    setup();
    keydown('n', { ctrlKey: true });
    expect(document.activeElement).toBe(input);
  });

  it('Cmd+N (metaKey) also focuses the create-name input', () => {
    const input = document.createElement('input');
    input.id = 'profiles-create-name-input';
    document.body.appendChild(input);
    setup();
    keydown('n', { metaKey: true });
    expect(document.activeElement).toBe(input);
  });

  it('Ctrl+F focuses the search input', () => {
    const input = document.createElement('input');
    input.id = 'profiles-search-input';
    document.body.appendChild(input);
    setup();
    keydown('f', { ctrlKey: true });
    expect(document.activeElement).toBe(input);
  });

  it('Ctrl+A selects every visible profile when not editing text', () => {
    const profiles = [makeProfile({ id: 'a' }), makeProfile({ id: 'b' })];
    const handlers = setup({ visibleProfiles: profiles });
    keydown('a', { ctrlKey: true });
    expect(handlers.setSelected).toHaveBeenCalledWith(new Set(['a', 'b']));
  });

  it('Ctrl+A does nothing while focus is inside a text input (does not hijack real select-all)', () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    const handlers = setup();
    keydown('a', { ctrlKey: true });
    expect(handlers.setSelected).not.toHaveBeenCalled();
  });

  it('Delete opens the bulk-delete confirm when something is selected and not editing text', () => {
    const handlers = setup({ selected: new Set(['p1']) });
    keydown('Delete');
    expect(handlers.setConfirmBulkDelete).toHaveBeenCalledWith(true);
  });

  it('Delete does nothing when nothing is selected', () => {
    const handlers = setup({ selected: new Set() });
    keydown('Delete');
    expect(handlers.setConfirmBulkDelete).not.toHaveBeenCalled();
  });

  it('Delete does nothing while editing text, even with a selection', () => {
    const textarea = document.createElement('textarea');
    document.body.appendChild(textarea);
    textarea.focus();
    const handlers = setup({ selected: new Set(['p1']) });
    keydown('Delete');
    expect(handlers.setConfirmBulkDelete).not.toHaveBeenCalled();
  });

  it('Enter starts the single selected profile when it is stopped', () => {
    const profile = makeProfile({ id: 'p1', status: 'STOPPED' });
    const handlers = setup({ visibleProfiles: [profile], selected: new Set(['p1']) });
    keydown('Enter');
    expect(handlers.onStart).toHaveBeenCalledWith('p1');
  });

  it('Enter does nothing when the single selected profile is already RUNNING', () => {
    const profile = makeProfile({ id: 'p1', status: 'RUNNING' });
    const handlers = setup({ visibleProfiles: [profile], selected: new Set(['p1']) });
    keydown('Enter');
    expect(handlers.onStart).not.toHaveBeenCalled();
  });

  it('Enter does nothing when the single selected profile is STARTING', () => {
    const profile = makeProfile({ id: 'p1', status: 'STARTING' });
    const handlers = setup({ visibleProfiles: [profile], selected: new Set(['p1']) });
    keydown('Enter');
    expect(handlers.onStart).not.toHaveBeenCalled();
  });

  it('Enter does nothing when more than one profile is selected', () => {
    const profiles = [makeProfile({ id: 'a' }), makeProfile({ id: 'b' })];
    const handlers = setup({ visibleProfiles: profiles, selected: new Set(['a', 'b']) });
    keydown('Enter');
    expect(handlers.onStart).not.toHaveBeenCalled();
  });

  it('Enter does nothing while editing text', () => {
    const select = document.createElement('select');
    document.body.appendChild(select);
    select.focus();
    const profile = makeProfile({ id: 'p1', status: 'STOPPED' });
    const handlers = setup({ visibleProfiles: [profile], selected: new Set(['p1']) });
    keydown('Enter');
    expect(handlers.onStart).not.toHaveBeenCalled();
  });

  it('removes its keydown listener on unmount', () => {
    const removeSpy = vi.spyOn(document, 'removeEventListener');
    const { unmount } = renderHook(() =>
      useProfilesKeyboardShortcuts({
        visibleProfiles: [],
        selected: new Set(),
        setSelected: vi.fn(),
        setConfirmBulkDelete: vi.fn(),
        onStart: vi.fn(),
      }),
    );
    unmount();
    expect(removeSpy).toHaveBeenCalledWith('keydown', expect.any(Function));
  });
});
