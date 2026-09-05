// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { I18nProvider } from '../../src/renderer/i18n';
import { LogsPage } from '../../src/renderer/pages/LogsPage';
import type { ActivityLogEntry } from '../../src/shared/schemas/activityLog';
import type { ProfileListItem } from '../../src/shared/schemas/profile';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function makeEntry(overrides: Partial<ActivityLogEntry> = {}): ActivityLogEntry {
  return {
    id: 1,
    eventType: 'PROFILE_CREATED',
    profileId: null,
    message: 'Profile created',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as ActivityLogEntry;
}

function makeProfile(overrides: Partial<ProfileListItem> = {}): ProfileListItem {
  return { id: 'p1', name: 'Work Bot', status: 'STOPPED', ...overrides } as ProfileListItem;
}

/** Mocks the one bridge LogsPage actually talks through
 * (window.profileforge.invoke — see services/api.ts's callApi), matching
 * this project's other page-level tests (ProxiesPage.test.tsx). */
function mockInvoke(handlers: Partial<Record<string, (payload: unknown) => unknown>>) {
  const invoke = vi.fn((channel: string, payload: unknown) => {
    const handler = handlers[channel];
    if (!handler) throw new Error(`Unmocked IPC channel in test: ${channel}`);
    return Promise.resolve(handler(payload));
  });
  window.profileforge = { invoke, onUpdateAvailable: vi.fn(), installUpdate: vi.fn() } as unknown as Window['profileforge'];
  return invoke;
}

function renderPage() {
  render(
    <I18nProvider initialLocale="en" onLocaleChange={() => {}}>
      <LogsPage />
    </I18nProvider>,
  );
}

describe('LogsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loads and renders log entries plus their resolved profile names on mount', async () => {
    mockInvoke({
      'profiles:list': () => [makeProfile({ id: 'p1', name: 'Work Bot' })],
      'logs:list': () => [makeEntry({ id: 2, message: 'Started', profileId: 'p1' })],
    });
    renderPage();

    expect(await screen.findByText('Started')).toBeInTheDocument();
    expect(screen.getAllByText('Work Bot').length).toBeGreaterThan(0);
  });

  it('shows a "—" for entries with no associated profile', async () => {
    mockInvoke({
      'profiles:list': () => [],
      'logs:list': () => [makeEntry({ profileId: null })],
    });
    renderPage();

    await screen.findByText('Profile created');
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('shows the empty state when there are no entries', async () => {
    mockInvoke({ 'profiles:list': () => [], 'logs:list': () => [] });
    renderPage();

    expect(await screen.findByText('No activity yet. Actions on your profiles will show up here.')).toBeInTheDocument();
  });

  it('shows an error banner when logs:list rejects', async () => {
    window.profileforge = {
      invoke: vi.fn((channel: string) => {
        if (channel === 'profiles:list') return Promise.resolve([]);
        if (channel === 'logs:list') return Promise.reject(new Error('boom'));
        throw new Error(`Unmocked channel: ${channel}`);
      }),
      onUpdateAvailable: vi.fn(),
      installUpdate: vi.fn(),
    } as unknown as Window['profileforge'];
    renderPage();

    expect(await screen.findByText('Something went wrong. Please try again.')).toBeInTheDocument();
  });

  it('changing the event type filter re-queries logs:list with the new eventType', async () => {
    const invoke = mockInvoke({ 'profiles:list': () => [], 'logs:list': () => [] });
    renderPage();
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('logs:list', expect.objectContaining({ eventType: undefined })));

    fireEvent.change(screen.getByDisplayValue('All events'), { target: { value: 'PROFILE_STARTED' } });

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('logs:list', expect.objectContaining({ eventType: 'PROFILE_STARTED' })),
    );
  });

  it('changing the profile filter re-queries logs:list with the new profileId', async () => {
    const invoke = mockInvoke({ 'profiles:list': () => [makeProfile({ id: 'p1', name: 'Work Bot' })], 'logs:list': () => [] });
    renderPage();
    await screen.findByDisplayValue('All profiles');

    fireEvent.change(screen.getByDisplayValue('All profiles'), { target: { value: 'p1' } });

    await waitFor(() => expect(invoke).toHaveBeenCalledWith('logs:list', expect.objectContaining({ profileId: 'p1' })));
  });

  it('typing in the search box debounces before re-querying logs:list with the search term', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const invoke = mockInvoke({ 'profiles:list': () => [], 'logs:list': () => [] });
    renderPage();
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith('logs:list', expect.objectContaining({ search: undefined })));
    invoke.mockClear();

    fireEvent.change(screen.getByPlaceholderText('Search messages...'), { target: { value: 'crash' } });
    expect(invoke).not.toHaveBeenCalledWith('logs:list', expect.objectContaining({ search: 'crash' }));

    vi.advanceTimersByTime(300);
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith('logs:list', expect.objectContaining({ search: 'crash' })));
  });

  it('shows a "Load more" button only when a full page was returned, and loadMore appends older entries via beforeId', async () => {
    const firstPage: ActivityLogEntry[] = Array.from({ length: 50 }, (_, i) =>
      makeEntry({ id: 50 - i, message: `Entry ${50 - i}` }),
    );
    const invoke = mockInvoke({
      'profiles:list': () => [],
      'logs:list': (payload) => {
        const p = payload as { beforeId?: number };
        if (p.beforeId === 1) return [makeEntry({ id: 0, message: 'Oldest entry' })];
        return firstPage;
      },
    });
    renderPage();

    const loadMoreBtn = await screen.findByRole('button', { name: 'Load more' });
    fireEvent.click(loadMoreBtn);

    expect(await screen.findByText('Oldest entry')).toBeInTheDocument();
    expect(invoke).toHaveBeenCalledWith('logs:list', expect.objectContaining({ beforeId: 1 }));
  });

  it('does not show "Load more" when fewer than a full page is returned', async () => {
    mockInvoke({ 'profiles:list': () => [], 'logs:list': () => [makeEntry()] });
    renderPage();

    await screen.findByText('Profile created');
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
  });

  it('applies a "danger" pill class for ERROR/CRASH/FAIL event types and "warn" for DELETE/STOP/LOCK', async () => {
    mockInvoke({
      'profiles:list': () => [],
      'logs:list': () => [
        makeEntry({ id: 1, eventType: 'PROFILE_CRASHED', message: 'Crashed' }),
        makeEntry({ id: 2, eventType: 'PROFILE_STOPPED', message: 'Stopped' }),
        makeEntry({ id: 3, eventType: 'PROFILE_CREATED', message: 'Created' }),
      ],
    });
    renderPage();

    await screen.findByText('Crashed');
    const pills = document.querySelectorAll('.pill');
    expect(pills[0].className).toContain('danger');
    expect(pills[1].className).toContain('warn');
    expect(pills[2].className).toContain('on');
  });

  it('toggling "Live" on starts polling logs:latestId, and re-fetches the first page when it changes', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let latestId = 1;
    const invoke = mockInvoke({
      'profiles:list': () => [],
      'logs:list': () => [makeEntry({ id: latestId, message: `Entry ${latestId}` })],
      'logs:latestId': () => latestId,
    });
    renderPage();
    await vi.waitFor(() => expect(screen.getByText('Entry 1')).toBeInTheDocument());

    fireEvent.click(screen.getByLabelText('Live'));
    latestId = 2;
    vi.advanceTimersByTime(3000);

    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith('logs:latestId', {}));
    await vi.waitFor(() => expect(screen.getByText('Entry 2')).toBeInTheDocument());
  });
});
