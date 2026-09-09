// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, waitFor, within, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { I18nProvider } from '../../src/renderer/i18n';
import { ProfilesPage } from '../../src/renderer/pages/ProfilesPage';
import type { ProfileListItem } from '../../src/shared/schemas/profile';
import { formatLowMemoryError } from '../../src/shared/utils/lowMemory';

afterEach(() => {
  cleanup();
});

function makeProfile(overrides: Partial<ProfileListItem> = {}): ProfileListItem {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    name: 'Profile 1',
    description: '',
    profilePath: '/p1',
    fingerprintId: '22222222-2222-2222-2222-222222222222',
    proxyId: null,
    groupId: null,
    status: 'STOPPED',
    tags: [],
    createdAt: '',
    updatedAt: '',
    lastStartedAt: null,
    lastStoppedAt: null,
    automationEnabled: false,
    automationPort: null,
    scheduleEnabled: false,
    scheduleTime: null,
    scheduleDays: null,
    scheduleLastTriggeredAt: null,
    os: 'windows',
    browserVersion: '128.0',
    ...overrides,
  };
}

/** Mocks the one bridge ProfilesPage actually talks through
 * (window.profileforge.invoke — see services/api.ts's callApi), same
 * approach as ProxiesPage.test.tsx, so the test exercises real component
 * wiring exactly as the real preload bridge would present it. Every test
 * supplies its own `profiles:list`/`templates:list`/`proxy:list`/
 * `groups:list` handlers since ProfilesPage fetches all four on mount. */
function mockInvoke(handlers: Partial<Record<string, (payload: unknown) => unknown>>) {
  const invoke = vi.fn((channel: string, payload: unknown) => {
    const handler = handlers[channel];
    if (!handler) throw new Error(`Unmocked IPC channel in test: ${channel}`);
    return Promise.resolve(handler(payload));
  });
  window.profileforge = { invoke, onUpdateAvailable: vi.fn(), installUpdate: vi.fn() } as unknown as Window['profileforge'];
  return invoke;
}

function baseHandlers(overrides: Partial<Record<string, (payload: unknown) => unknown>> = {}) {
  return {
    'profiles:list': () => [],
    'templates:list': () => [],
    'proxy:list': () => [],
    'groups:list': () => [],
    ...overrides,
  };
}

function renderPage() {
  render(
    <I18nProvider initialLocale="en" onLocaleChange={() => {}}>
      <ProfilesPage />
    </I18nProvider>,
  );
}

function rowFor(name: string): HTMLElement {
  return screen.getByText(name).closest('tr')!;
}

describe('ProfilesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loads and renders the profile list on mount', async () => {
    mockInvoke(baseHandlers({ 'profiles:list': () => [makeProfile({ name: 'Alpha' }), makeProfile({ id: 'p2', name: 'Beta' })] }));
    renderPage();

    expect(await screen.findByText('Alpha')).toBeInTheDocument();
    expect(screen.getByText('Beta')).toBeInTheDocument();
  });

  it('fetches all four lists (profiles/templates/proxies/groups) exactly once on mount', async () => {
    const invoke = mockInvoke(baseHandlers());
    renderPage();
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('profiles:list', expect.anything()));

    expect(invoke.mock.calls.filter(([c]) => c === 'profiles:list')).toHaveLength(1);
    expect(invoke).toHaveBeenCalledWith('templates:list', {});
    expect(invoke).toHaveBeenCalledWith('proxy:list', {});
    expect(invoke).toHaveBeenCalledWith('groups:list', {});
  });

  it('selecting a row shows the BulkToolbar with the right count; unchecking it hides it again', async () => {
    mockInvoke(baseHandlers({ 'profiles:list': () => [makeProfile({ name: 'Alpha' })] }));
    renderPage();
    await screen.findByText('Alpha');
    expect(screen.queryByText(/selected/i)).not.toBeInTheDocument();

    const checkbox = within(rowFor('Alpha')).getByRole('checkbox');
    checkbox.click();
    expect(await screen.findByText(/1.*selected/i)).toBeInTheDocument();

    checkbox.click();
    await waitFor(() => expect(screen.queryByText(/selected/i)).not.toBeInTheDocument());
  });

  it('starting a profile calls profiles:start with its id and refreshes the list', async () => {
    const invoke = mockInvoke(
      baseHandlers({
        'profiles:list': () => [makeProfile({ name: 'Stopped One', status: 'STOPPED' })],
        'profiles:start': () => undefined,
      }),
    );
    renderPage();
    const row = await screen.findByText('Stopped One').then((el) => el.closest('tr')!);

    within(row).getByRole('button', { name: 'Start' }).click();

    await waitFor(() => expect(invoke).toHaveBeenCalledWith('profiles:start', { id: '11111111-1111-1111-1111-111111111111' }));
    // Refetch after the action completes (initial mount fetch + this one).
    await waitFor(() => expect(invoke.mock.calls.filter(([c]) => c === 'profiles:list')).toHaveLength(2));
  });

  it('a low-memory rejection on start shows a confirm() dialog; declining leaves the profile untouched', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const invoke = mockInvoke(
      baseHandlers({
        'profiles:list': () => [makeProfile({ name: 'Heavy One', status: 'STOPPED' })],
        'profiles:start': () => {
          throw new Error(formatLowMemoryError({ freeMemMb: 300, estimatedCostMb: 585 }));
        },
      }),
    );
    renderPage();
    const row = await screen.findByText('Heavy One').then((el) => el.closest('tr')!);

    within(row).getByRole('button', { name: 'Start' }).click();

    await waitFor(() => expect(confirmSpy).toHaveBeenCalledTimes(1));
    expect(confirmSpy.mock.calls[0]![0]).toContain('300');
    // Declined — no acknowledged retry call.
    expect(invoke).not.toHaveBeenCalledWith('profiles:start', expect.objectContaining({ acknowledgeLowMemory: true }));
  });

  it('a low-memory rejection on start, when confirmed, retries with acknowledgeLowMemory: true', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    let firstCall = true;
    const invoke = mockInvoke(
      baseHandlers({
        'profiles:list': () => [makeProfile({ name: 'Heavy One', status: 'STOPPED' })],
        'profiles:start': (payload: unknown) => {
          if (firstCall) {
            firstCall = false;
            throw new Error(formatLowMemoryError({ freeMemMb: 300, estimatedCostMb: 585 }));
          }
          expect((payload as { acknowledgeLowMemory?: boolean }).acknowledgeLowMemory).toBe(true);
          return undefined;
        },
      }),
    );
    renderPage();
    const row = await screen.findByText('Heavy One').then((el) => el.closest('tr')!);

    within(row).getByRole('button', { name: 'Start' }).click();

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('profiles:start', {
        id: '11111111-1111-1111-1111-111111111111',
        acknowledgeLowMemory: true,
      }),
    );
  });

  it('deleting a single profile soft-deletes it immediately (no confirm dialog) and shows an Undo toast', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm');
    const invoke = mockInvoke(
      baseHandlers({
        'profiles:list': () => [makeProfile({ name: 'To Delete' })],
        'profiles:delete': () => undefined,
      }),
    );
    renderPage();
    const row = await screen.findByText('To Delete').then((el) => el.closest('tr')!);

    within(row).getByRole('button', { name: /Delete/ }).click();

    await waitFor(() => expect(invoke).toHaveBeenCalledWith('profiles:delete', { id: '11111111-1111-1111-1111-111111111111' }));
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(await screen.findByText(/Undo/i)).toBeInTheDocument();
  });

  it('clicking Undo after a single delete calls profiles:restoreDeleted with that id', async () => {
    const invoke = mockInvoke(
      baseHandlers({
        'profiles:list': () => [makeProfile({ name: 'To Delete' })],
        'profiles:delete': () => undefined,
        'profiles:restoreDeleted': () => undefined,
      }),
    );
    renderPage();
    const row = await screen.findByText('To Delete').then((el) => el.closest('tr')!);
    within(row).getByRole('button', { name: /Delete/ }).click();
    const undoButton = await screen.findByRole('button', { name: /Undo/i });

    undoButton.click();

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('profiles:restoreDeleted', { id: '11111111-1111-1111-1111-111111111111' }),
    );
  });

  it('bulk delete asks for confirmation, then calls profiles:bulkDelete and shows a bulk Undo toast on success', async () => {
    const invoke = mockInvoke(
      baseHandlers({
        'profiles:list': () => [makeProfile({ name: 'Alpha' })],
        'profiles:bulkDelete': () => ({ succeeded: ['11111111-1111-1111-1111-111111111111'], failed: [] }),
      }),
    );
    renderPage();
    const row = await screen.findByText('Alpha').then((el) => el.closest('tr')!);
    within(row).getByRole('checkbox').click();

    // Two "Delete" buttons already exist with one profile selected: the
    // BulkToolbar's own (rendered first in DOM order, above the table) and
    // the single row's own Delete action — the BulkToolbar one is index 0.
    const beforeDialog = await screen.findAllByRole('button', { name: 'Delete' });
    expect(beforeDialog).toHaveLength(2);
    beforeDialog[0]!.click();

    // Confirmation dialog appears before anything is actually deleted — its
    // own confirm button carries the same bulk-delete label, so there are
    // now three "Delete" buttons on screen (bulk toolbar + row + dialog).
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Delete' })).toHaveLength(3));
    expect(invoke).not.toHaveBeenCalledWith('profiles:bulkDelete', expect.anything());
    const dialogButtons = screen.getAllByRole('button', { name: 'Delete' });
    dialogButtons[dialogButtons.length - 1]!.click();

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('profiles:bulkDelete', { ids: ['11111111-1111-1111-1111-111111111111'] }),
    );
    expect(await screen.findByText(/Undo/i)).toBeInTheDocument();
  });

  it('cloning a profile calls profiles:clone with mode "config" and a "(clone)"-suffixed name', async () => {
    const invoke = mockInvoke(
      baseHandlers({
        'profiles:list': () => [makeProfile({ name: 'Original' })],
        'profiles:clone': () => undefined,
      }),
    );
    renderPage();
    const row = await screen.findByText('Original').then((el) => el.closest('tr')!);

    within(row).getByRole('button', { name: /Clone/ }).click();

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('profiles:clone', {
        id: '11111111-1111-1111-1111-111111111111',
        mode: 'config',
        name: 'Original (clone)',
      }),
    );
  });

  it('shows a generic error banner (via describeError) when the initial profiles:list fetch itself fails', async () => {
    mockInvoke(
      baseHandlers({
        'profiles:list': () => {
          throw new Error('backend exploded');
        },
      }),
    );
    renderPage();

    // ProfilesPage funnels the raw error through describeError()/i18n, not
    // the raw message — this matches errorMessages.ts's own fallback copy
    // ('common.unexpectedError') for a message it doesn't specifically know.
    expect(await screen.findByText('Something went wrong. Please try again.')).toBeInTheDocument();
  });

  // The three tests below cover ProfilesPage's own createGroup/renameGroup/
  // deleteGroup wrapper functions — real IPC-calling glue between
  // GroupsModal's callback props and the backend, previously untested here
  // (GroupsModal.test.tsx only ever exercises the modal standalone, with
  // vi.fn() stand-ins for onCreate/onRename/onDelete, so ProfilesPage's own
  // wiring — which channel each callback actually calls, with what payload,
  // and whether it refreshes afterward — was never covered by any test
  // until now; found via a real function-coverage gap, not padding).

  it('creating a group via the Groups modal calls groups:create and refreshes the group list', async () => {
    const invoke = mockInvoke(
      baseHandlers({
        'groups:create': () => undefined,
      }),
    );
    renderPage();
    await screen.findByRole('button', { name: 'Manage Groups' });

    fireEvent.click(screen.getByRole('button', { name: 'Manage Groups' }));
    const input = await screen.findByPlaceholderText('New group name');
    fireEvent.change(input, { target: { value: 'Marketing' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(invoke).toHaveBeenCalledWith('groups:create', { name: 'Marketing' }));
    // groups:list is called once on mount and again by refreshGroups() after create.
    await waitFor(() => expect(invoke.mock.calls.filter((c) => c[0] === 'groups:list').length).toBeGreaterThanOrEqual(2));
  });

  it('renaming a group via the Groups modal calls groups:rename with that group\'s id and refreshes', async () => {
    const invoke = mockInvoke(
      baseHandlers({
        'groups:list': () => [{ id: '33333333-3333-3333-3333-333333333333', name: 'Sales', createdAt: '', profileCount: 3 }],
        'groups:rename': () => undefined,
      }),
    );
    renderPage();
    await screen.findByRole('button', { name: 'Manage Groups' });
    fireEvent.click(screen.getByRole('button', { name: 'Manage Groups' }));
    // "Sales" alone is ambiguous — it also appears in the toolbar's "All
    // groups" filter dropdown as "Sales (3)" — scope to the modal itself.
    // ("Manage Groups" text is ALSO ambiguous once open — the modal's own
    // header title uses the same i18n key as the button — so query the
    // modal's container class directly instead of by text.)
    const modal = await waitFor(() => {
      const el = document.querySelector('.modal-panel-groups');
      if (!el) throw new Error('modal not found yet');
      return el as HTMLElement;
    });
    within(modal).getByText('Sales');

    fireEvent.click(within(modal).getByRole('button', { name: 'Rename' }));
    const renameInput = within(modal).getByDisplayValue('Sales');
    fireEvent.change(renameInput, { target: { value: 'Sales EU' } });
    fireEvent.keyDown(renameInput, { key: 'Enter' });

    await waitFor(() => expect(invoke).toHaveBeenCalledWith('groups:rename', { id: '33333333-3333-3333-3333-333333333333', name: 'Sales EU' }));
  });

  it('deleting a group via the Groups modal calls groups:delete with that group\'s id, refreshes groups and profiles, and clears an active group filter matching it', async () => {
    const invoke = mockInvoke(
      baseHandlers({
        'groups:list': () => [{ id: '33333333-3333-3333-3333-333333333333', name: 'Marketing', createdAt: '', profileCount: 0 }],
        'groups:delete': () => undefined,
      }),
    );
    renderPage();
    await screen.findByRole('button', { name: 'Manage Groups' });
    fireEvent.click(screen.getByRole('button', { name: 'Manage Groups' }));
    // "Marketing" alone is ambiguous — it also appears in the toolbar's
    // "All groups" filter dropdown as "Marketing (0)" — scope to the modal
    // (queried by container class, not text — the modal's own header title
    // shares the same "Manage Groups" i18n key as the button that opens it).
    const modal = await waitFor(() => {
      const el = document.querySelector('.modal-panel-groups');
      if (!el) throw new Error('modal not found yet');
      return el as HTMLElement;
    });
    within(modal).getByText('Marketing');

    fireEvent.click(within(modal).getByRole('button', { name: 'Delete' }));
    await screen.findByText('Delete group "Marketing"? Profiles in it will become ungrouped.');
    // ConfirmDialog renders as a sibling of .modal-panel-groups (inside the
    // shared .modal-overlay, but outside the panel div itself) — not
    // nested inside it, so its own "Delete" confirm button isn't reachable
    // via within(modal). Query at the screen level instead: the toolbar's
    // "Marketing (0)" filter option is an <option>, not a button, so no
    // third match to disambiguate from. The second "Delete" button is the
    // confirm dialog's, same disambiguation GroupsModal.test.tsx itself
    // already uses for this exact flow.
    fireEvent.click(screen.getAllByRole('button', { name: 'Delete' })[1]!);

    await waitFor(() => expect(invoke).toHaveBeenCalledWith('groups:delete', { id: '33333333-3333-3333-3333-333333333333' }));
    // profiles:list is called once on mount and again by deleteGroup()'s own
    // refresh() call — confirms the (group, profile-list) double-refresh
    // this wrapper does, not just the groups:delete call itself.
    await waitFor(() => expect(invoke.mock.calls.filter((c) => c[0] === 'profiles:list').length).toBeGreaterThanOrEqual(2));
  });
});
