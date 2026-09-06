// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { I18nProvider } from '../../src/renderer/i18n';
import { GroupsModal } from '../../src/renderer/components/GroupsModal';
import type { Group } from '../../src/shared/schemas/group';
import type { ProxyRecord } from '../../src/shared/schemas/proxy';

afterEach(() => {
  cleanup();
});

function makeGroup(overrides: Partial<Group> = {}): Group {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    name: 'Marketing',
    profileCount: 3,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeProxy(overrides: Partial<ProxyRecord> = {}): ProxyRecord {
  return {
    id: '22222222-2222-2222-2222-222222222222',
    name: 'Proxy 1',
    protocol: 'http',
    host: '127.0.0.1',
    port: 8080,
    lastCheckedAt: null,
    lastCheckStatus: null,
    lastCheckLatencyMs: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function mockInvoke(overrides: Partial<Record<string, (payload: unknown) => unknown>> = {}) {
  const handlers: Record<string, (payload: unknown) => unknown> = {
    'groups:getProxyPool': () => [],
    'groups:setProxyPool': () => undefined,
    ...overrides,
  };
  const invoke = vi.fn((channel: string, payload: unknown) => {
    const handler = handlers[channel];
    if (!handler) throw new Error(`Unmocked IPC channel in test: ${channel}`);
    return Promise.resolve(handler(payload));
  });
  window.profileforge = { invoke, onUpdateAvailable: vi.fn(), installUpdate: vi.fn() } as unknown as Window['profileforge'];
  return invoke;
}

function renderModal(props: Partial<React.ComponentProps<typeof GroupsModal>> = {}) {
  const onCreate = vi.fn();
  const onRename = vi.fn();
  const onDelete = vi.fn();
  const onClose = vi.fn();
  render(
    <I18nProvider initialLocale="en" onLocaleChange={() => {}}>
      <GroupsModal
        groups={[makeGroup()]}
        proxies={[makeProxy()]}
        onCreate={onCreate}
        onRename={onRename}
        onDelete={onDelete}
        onClose={onClose}
        {...props}
      />
    </I18nProvider>,
  );
  return { onCreate, onRename, onDelete, onClose };
}

describe('GroupsModal', () => {
  it('renders every group with its profile count', () => {
    mockInvoke();
    renderModal({ groups: [makeGroup({ name: 'Sales', profileCount: 7 })] });
    expect(screen.getByText('Sales')).toBeInTheDocument();
    expect(screen.getByText('(7)')).toBeInTheDocument();
  });

  it('shows the empty-state message when there are no groups', () => {
    mockInvoke();
    renderModal({ groups: [] });
    expect(screen.getByText('No groups yet. Create one above.')).toBeInTheDocument();
  });

  it('submitting the create form with a name calls onCreate and clears the input', () => {
    mockInvoke();
    const { onCreate } = renderModal();
    const input = screen.getByPlaceholderText('New group name');
    fireEvent.change(input, { target: { value: 'New Group' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    expect(onCreate).toHaveBeenCalledWith('New Group');
    expect(input).toHaveValue('');
  });

  it('does not call onCreate for a blank/whitespace-only name', () => {
    mockInvoke();
    const { onCreate } = renderModal();
    const input = screen.getByPlaceholderText('New group name');
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    expect(onCreate).not.toHaveBeenCalled();
  });

  it('pressing Enter in the create input also submits', () => {
    mockInvoke();
    const { onCreate } = renderModal();
    const input = screen.getByPlaceholderText('New group name');
    fireEvent.change(input, { target: { value: 'Via Enter' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onCreate).toHaveBeenCalledWith('Via Enter');
  });

  it('clicking Rename switches the row to an editable input pre-filled with the current name', () => {
    mockInvoke();
    renderModal({ groups: [makeGroup({ name: 'Marketing' })] });
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
    expect(screen.getByDisplayValue('Marketing')).toBeInTheDocument();
  });

  it('committing a rename with a changed, non-blank name calls onRename, but leaving it unchanged does not', () => {
    mockInvoke();
    const { onRename } = renderModal({ groups: [makeGroup({ name: 'Marketing' })] });
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
    const input = screen.getByDisplayValue('Marketing');
    fireEvent.change(input, { target: { value: 'Marketing' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onRename).not.toHaveBeenCalled();
  });

  it('committing a rename with a real change calls onRename with the trimmed name', () => {
    mockInvoke();
    const { onRename } = renderModal({ groups: [makeGroup({ name: 'Marketing' })] });
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
    const input = screen.getByDisplayValue('Marketing');
    fireEvent.change(input, { target: { value: '  Growth  ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onRename).toHaveBeenCalledWith(expect.objectContaining({ name: 'Marketing' }), 'Growth');
  });

  it('pressing Escape while renaming cancels without calling onRename', () => {
    mockInvoke();
    const { onRename } = renderModal({ groups: [makeGroup({ name: 'Marketing' })] });
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
    const input = screen.getByDisplayValue('Marketing');
    fireEvent.change(input, { target: { value: 'Something Else' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onRename).not.toHaveBeenCalled();
    expect(screen.queryByDisplayValue('Something Else')).not.toBeInTheDocument();
  });

  it('clicking Delete shows a confirm dialog, and confirming it calls onDelete', () => {
    mockInvoke();
    const { onDelete } = renderModal({ groups: [makeGroup({ name: 'Marketing' })] });
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(screen.getByText('Delete group "Marketing"? Profiles in it will become ungrouped.')).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'Delete' })[1]!);
    expect(onDelete).toHaveBeenCalledWith(expect.objectContaining({ name: 'Marketing' }));
  });

  it('clicking Proxy pool loads and displays the group\'s current pool from groups:getProxyPool', async () => {
    const invoke = mockInvoke({ 'groups:getProxyPool': () => ['22222222-2222-2222-2222-222222222222'] });
    renderModal({ proxies: [makeProxy({ name: 'Proxy 1' })] });
    fireEvent.click(screen.getByRole('button', { name: 'Proxy pool' }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('groups:getProxyPool', { groupId: '11111111-1111-1111-1111-111111111111' }));
    const checkbox = await screen.findByRole('checkbox');
    expect(checkbox).toBeChecked();
  });

  it('toggling a proxy in the pool calls groups:setProxyPool with the updated id list', async () => {
    const invoke = mockInvoke({ 'groups:getProxyPool': () => [] });
    renderModal({ proxies: [makeProxy({ id: '22222222-2222-2222-2222-222222222222' })] });
    fireEvent.click(screen.getByRole('button', { name: 'Proxy pool' }));
    const checkbox = await screen.findByRole('checkbox');
    fireEvent.click(checkbox);
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('groups:setProxyPool', {
        groupId: '11111111-1111-1111-1111-111111111111',
        proxyIds: ['22222222-2222-2222-2222-222222222222'],
      }),
    );
  });

  it('clicking Proxy pool again while open collapses it without a new fetch', async () => {
    const invoke = mockInvoke();
    renderModal();
    const poolButton = screen.getByRole('button', { name: 'Proxy pool' });
    fireEvent.click(poolButton);
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
    fireEvent.click(poolButton);
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('clicking outside the panel (the overlay) calls onClose, but clicking inside the panel does not', () => {
    mockInvoke();
    const { onClose } = renderModal();
    fireEvent.click(screen.getByText('Manage Groups'));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(document.querySelector('.modal-overlay')!);
    expect(onClose).toHaveBeenCalled();
  });
});
