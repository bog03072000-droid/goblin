// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { I18nProvider } from '../../src/renderer/i18n';
import { BulkToolbar } from '../../src/renderer/pages/profiles/BulkToolbar';
import type { Group } from '../../src/shared/schemas/group';
import type { ProxyRecord } from '../../src/shared/schemas/proxy';

afterEach(() => {
  cleanup();
});

function makeGroup(overrides: Partial<Group> = {}): Group {
  return { id: 'group-1', name: 'Work', profileCount: 3, proxyPoolIds: [], createdAt: '', updatedAt: '', ...overrides } as Group;
}

function makeProxy(overrides: Partial<ProxyRecord> = {}): ProxyRecord {
  return {
    id: 'proxy-1',
    name: 'My Proxy',
    protocol: 'http',
    host: '1.2.3.4',
    port: 8080,
    username: null,
    lastCheckStatus: null,
    lastCheckedAt: null,
    lastCheckLatencyMs: null,
    createdAt: '',
    updatedAt: '',
    ...overrides,
  } as ProxyRecord;
}

function renderBulkToolbar(overrides: Partial<Parameters<typeof BulkToolbar>[0]> = {}) {
  const handlers = {
    onStart: vi.fn(),
    onStop: vi.fn(),
    onRestart: vi.fn(),
    onClone: vi.fn(),
    onDeleteRequest: vi.fn(),
    onExportSelected: vi.fn(),
    onBackup: vi.fn(),
    onAssignProxy: vi.fn(),
    onAssignGroup: vi.fn(),
    onAddTag: vi.fn(),
    onRemoveTag: vi.fn(),
    onClearSelection: vi.fn(),
  };
  render(
    <I18nProvider initialLocale="en" onLocaleChange={() => {}}>
      <BulkToolbar
        selectedCount={3}
        bulkBusy={false}
        proxies={[makeProxy()]}
        groups={[makeGroup()]}
        {...handlers}
        {...overrides}
      />
    </I18nProvider>,
  );
  return handlers;
}

describe('BulkToolbar', () => {
  it('shows the selected count when not busy', () => {
    renderBulkToolbar({ selectedCount: 5, bulkBusy: false });
    expect(screen.getByText('5 selected')).toBeInTheDocument();
  });

  it('shows "Working…" instead of the count while a bulk action is in flight', () => {
    renderBulkToolbar({ selectedCount: 5, bulkBusy: true });
    expect(screen.getByText('Working…')).toBeInTheDocument();
    expect(screen.queryByText('5 selected')).not.toBeInTheDocument();
  });

  it('every action button is disabled while bulkBusy is true', () => {
    renderBulkToolbar({ bulkBusy: true });
    for (const name of ['Start', 'Stop', 'Restart', 'Clone', 'Delete', 'Export Selected', 'Backup', 'Clear selection']) {
      expect(screen.getByRole('button', { name })).toBeDisabled();
    }
  });

  it('Start/Stop/Restart/Clone/Delete/Export Selected/Backup/Clear selection each call their own handler when not busy', () => {
    const handlers = renderBulkToolbar({ bulkBusy: false });
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    fireEvent.click(screen.getByRole('button', { name: 'Restart' }));
    fireEvent.click(screen.getByRole('button', { name: 'Clone' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    fireEvent.click(screen.getByRole('button', { name: 'Export Selected' }));
    fireEvent.click(screen.getByRole('button', { name: 'Backup' }));
    fireEvent.click(screen.getByRole('button', { name: 'Clear selection' }));
    expect(handlers.onStart).toHaveBeenCalledTimes(1);
    expect(handlers.onStop).toHaveBeenCalledTimes(1);
    expect(handlers.onRestart).toHaveBeenCalledTimes(1);
    expect(handlers.onClone).toHaveBeenCalledTimes(1);
    expect(handlers.onDeleteRequest).toHaveBeenCalledTimes(1);
    expect(handlers.onExportSelected).toHaveBeenCalledTimes(1);
    expect(handlers.onBackup).toHaveBeenCalledTimes(1);
    expect(handlers.onClearSelection).toHaveBeenCalledTimes(1);
  });

  it('picking a proxy from the assign-proxy select calls onAssignProxy with its id, then resets to the placeholder', () => {
    const handlers = renderBulkToolbar({ proxies: [makeProxy({ id: 'p2', name: 'Rotating Proxy' })] });
    const select = screen.getByRole('option', { name: 'Rotating Proxy' }).closest('select') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'p2' } });
    expect(handlers.onAssignProxy).toHaveBeenCalledWith('p2');
    expect(select.value).toBe('');
  });

  it('picking "None (remove proxy)" calls onAssignProxy with an empty string', () => {
    const handlers = renderBulkToolbar();
    const select = screen.getByRole('option', { name: 'None (remove proxy)' }).closest('select') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: '' } });
    expect(handlers.onAssignProxy).toHaveBeenCalledWith('');
  });

  it('picking a group from the assign-group select calls onAssignGroup with its id, then resets to the placeholder', () => {
    const handlers = renderBulkToolbar({ groups: [makeGroup({ id: 'g2', name: 'Scrapers' })] });
    const select = screen.getByRole('option', { name: 'Scrapers' }).closest('select') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'g2' } });
    expect(handlers.onAssignGroup).toHaveBeenCalledWith('g2');
    expect(select.value).toBe('');
  });

  it('typing a tag and pressing Enter in the add-tag field calls onAddTag and clears the field', () => {
    const handlers = renderBulkToolbar();
    const input = screen.getByPlaceholderText('Add tag + Enter') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'important' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(handlers.onAddTag).toHaveBeenCalledWith('important');
    expect(input.value).toBe('');
  });

  it('a non-Enter key in the add-tag field does not call onAddTag', () => {
    const handlers = renderBulkToolbar();
    const input = screen.getByPlaceholderText('Add tag + Enter');
    fireEvent.change(input, { target: { value: 'important' } });
    fireEvent.keyDown(input, { key: 'a' });
    expect(handlers.onAddTag).not.toHaveBeenCalled();
  });

  it('typing a tag and pressing Enter in the remove-tag field calls onRemoveTag and clears the field', () => {
    const handlers = renderBulkToolbar();
    const input = screen.getByPlaceholderText('Remove tag + Enter') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'stale' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(handlers.onRemoveTag).toHaveBeenCalledWith('stale');
    expect(input.value).toBe('');
  });
});
