// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { I18nProvider } from '../../src/renderer/i18n';
import { ProfileContextMenu } from '../../src/renderer/pages/profiles/ProfileContextMenu';
import type { ProfileListItem } from '../../src/shared/schemas/profile';

afterEach(() => {
  cleanup();
});

function makeProfile(overrides: Partial<ProfileListItem> = {}): ProfileListItem {
  return { id: 'p1', name: 'Work Bot', status: 'STOPPED', ...overrides } as ProfileListItem;
}

function renderMenu(overrides: Partial<Parameters<typeof ProfileContextMenu>[0]> = {}) {
  const handlers = {
    onClose: vi.fn(),
    onStart: vi.fn(),
    onStop: vi.fn(),
    onRestart: vi.fn(),
    onEdit: vi.fn(),
    onClone: vi.fn(),
    onBackup: vi.fn(),
    onExport: vi.fn(),
    onDeleteRequest: vi.fn(),
  };
  render(
    <I18nProvider initialLocale="en" onLocaleChange={() => {}}>
      <ProfileContextMenu state={{ x: 10, y: 10, profile: makeProfile() }} {...handlers} {...overrides} />
    </I18nProvider>,
  );
  return handlers;
}

describe('ProfileContextMenu', () => {
  it('shows "Open" (not "Stop") for a stopped profile, and clicking it calls onStart then onClose', () => {
    const handlers = renderMenu({ state: { x: 0, y: 0, profile: makeProfile({ status: 'STOPPED' }) } });
    expect(screen.getByText('Open')).toBeInTheDocument();
    expect(screen.queryByText('Stop')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('Open'));
    expect(handlers.onStart).toHaveBeenCalledWith('p1');
    expect(handlers.onClose).toHaveBeenCalledTimes(1);
  });

  it('shows "Stop" (not "Open") for a running profile, and clicking it calls onStop then onClose', () => {
    const handlers = renderMenu({ state: { x: 0, y: 0, profile: makeProfile({ status: 'RUNNING' }) } });
    expect(screen.getByText('Stop')).toBeInTheDocument();
    expect(screen.queryByText('Open')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('Stop'));
    expect(handlers.onStop).toHaveBeenCalledWith('p1');
    expect(handlers.onClose).toHaveBeenCalledTimes(1);
  });

  it('shows neither "Open" nor "Stop", nor "Restart", while the profile is transitional (STARTING/STOPPING)', () => {
    renderMenu({ state: { x: 0, y: 0, profile: makeProfile({ status: 'STARTING' }) } });
    expect(screen.queryByText('Open')).not.toBeInTheDocument();
    expect(screen.queryByText('Stop')).not.toBeInTheDocument();
    expect(screen.queryByText('Restart')).not.toBeInTheDocument();
  });

  it('Restart, Edit, Clone, Backup and Export each call their own handler then onClose', () => {
    const handlers = renderMenu({ state: { x: 0, y: 0, profile: makeProfile({ status: 'STOPPED' }) } });

    fireEvent.click(screen.getByText('Restart'));
    expect(handlers.onRestart).toHaveBeenCalledWith('p1');

    fireEvent.click(screen.getByText('Edit'));
    expect(handlers.onEdit).toHaveBeenCalledWith('p1');

    fireEvent.click(screen.getByText('Clone'));
    expect(handlers.onClone).toHaveBeenCalledWith(expect.objectContaining({ id: 'p1' }));

    fireEvent.click(screen.getByText('Backup'));
    expect(handlers.onBackup).toHaveBeenCalledWith('p1');

    fireEvent.click(screen.getByText('Export'));
    expect(handlers.onExport).toHaveBeenCalledWith('p1');

    expect(handlers.onClose).toHaveBeenCalledTimes(5);
  });

  it('"Move to group…" and "Add Tag" both delegate to onEdit (opening the editor rather than duplicating UI)', () => {
    const handlers = renderMenu();
    fireEvent.click(screen.getByText('Move to group…'));
    fireEvent.click(screen.getByText('Add Tag'));
    expect(handlers.onEdit).toHaveBeenCalledTimes(2);
    expect(handlers.onEdit).toHaveBeenCalledWith('p1');
  });

  it('"Delete" calls onDeleteRequest with the full profile object, and carries the danger class', () => {
    const handlers = renderMenu();
    const deleteItem = screen.getByText('Delete');
    expect(deleteItem.className).toContain('danger');

    fireEvent.click(deleteItem);
    expect(handlers.onDeleteRequest).toHaveBeenCalledWith(expect.objectContaining({ id: 'p1' }));
    expect(handlers.onClose).toHaveBeenCalledTimes(1);
  });

  it('clicking outside the menu calls onClose', () => {
    const handlers = renderMenu();
    fireEvent.mouseDown(document.body);
    expect(handlers.onClose).toHaveBeenCalledTimes(1);
  });

  it('clicking inside the menu does not call onClose', () => {
    const handlers = renderMenu();
    fireEvent.mouseDown(screen.getByText('Edit'));
    expect(handlers.onClose).not.toHaveBeenCalled();
  });

  it('pressing Escape calls onClose', () => {
    const handlers = renderMenu();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(handlers.onClose).toHaveBeenCalledTimes(1);
  });

  it('a non-Escape key does not call onClose', () => {
    const handlers = renderMenu();
    fireEvent.keyDown(document, { key: 'a' });
    expect(handlers.onClose).not.toHaveBeenCalled();
  });
});
