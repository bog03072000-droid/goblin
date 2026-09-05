// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { I18nProvider } from '../../src/renderer/i18n';
import { DownloadsPage } from '../../src/renderer/pages/DownloadsPage';
import type { DownloadWithStatus } from '../../src/shared/schemas/download';
import type { Profile } from '../../src/shared/schemas/profile';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function makeDownload(overrides: Partial<DownloadWithStatus> = {}): DownloadWithStatus {
  return {
    id: 'd1',
    filename: 'report.pdf',
    savePath: 'C:/downloads/report.pdf',
    totalBytes: 2048,
    profileId: 'p1',
    profileName: 'Work Bot',
    state: 'completed',
    missing: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as DownloadWithStatus;
}

function makeProfile(overrides: Partial<Profile> = {}): Profile {
  return { id: 'p1', name: 'Work Bot', status: 'STOPPED', ...overrides } as Profile;
}

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
      <DownloadsPage />
    </I18nProvider>,
  );
}

describe('DownloadsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loads and renders downloads with formatted size and resolved profile name', async () => {
    mockInvoke({
      'downloads:list': () => [makeDownload({ totalBytes: 1536 })],
      'profiles:list': () => [makeProfile()],
    });
    renderPage();

    expect(await screen.findByText('report.pdf')).toBeInTheDocument();
    expect(screen.getByText('1.5 KB')).toBeInTheDocument();
    expect(screen.getAllByText('Work Bot').length).toBeGreaterThan(0);
  });

  it('shows "No downloads yet..." when there are no downloads and no filters applied', async () => {
    mockInvoke({ 'downloads:list': () => [], 'profiles:list': () => [] });
    renderPage();

    expect(
      await screen.findByText("No downloads yet. Files downloaded inside a profile's browser will show up here."),
    ).toBeInTheDocument();
  });

  it('shows the "no match" empty state once a filter is applied and 0 rows come back', async () => {
    mockInvoke({ 'downloads:list': () => [], 'profiles:list': () => [] });
    renderPage();
    await screen.findByText("No downloads yet. Files downloaded inside a profile's browser will show up here.");

    fireEvent.change(screen.getByPlaceholderText('Search by filename...'), { target: { value: 'zzz' } });

    expect(await screen.findByText('No downloads match the current filters.')).toBeInTheDocument();
  });

  it('re-queries downloads:list with the search term, profileId and date range filters', async () => {
    const invoke = mockInvoke({ 'downloads:list': () => [], 'profiles:list': () => [makeProfile()] });
    renderPage();
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('downloads:list', expect.objectContaining({ search: undefined })));

    fireEvent.change(screen.getByPlaceholderText('Search by filename...'), { target: { value: 'report' } });
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('downloads:list', expect.objectContaining({ search: 'report' })));

    fireEvent.change(screen.getByDisplayValue('All profiles'), { target: { value: 'p1' } });
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('downloads:list', expect.objectContaining({ profileId: 'p1' })));

    fireEvent.change(screen.getByTitle('To date'), { target: { value: '2026-02-01' } });
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith(
        'downloads:list',
        expect.objectContaining({ dateTo: '2026-02-01T23:59:59.999Z' }),
      ),
    );
  });

  it('shows Open/Show-in-folder only for completed, non-missing downloads', async () => {
    mockInvoke({
      'downloads:list': () => [
        makeDownload({ id: 'd1', filename: 'done.pdf', state: 'completed', missing: false }),
        makeDownload({ id: 'd2', filename: 'gone.pdf', state: 'completed', missing: true }),
        makeDownload({ id: 'd3', filename: 'failed.pdf', state: 'failed', missing: false }),
      ],
      'profiles:list': () => [],
    });
    renderPage();
    await screen.findByText('done.pdf');

    const rows = screen.getAllByRole('row').slice(1);
    expect(rows[0].querySelector('button[class*="btn-ghost"]')).toHaveTextContent('Open');
    expect(rows[1].textContent).not.toContain('Open');
    expect(rows[2].textContent).not.toContain('Open');
    // Re-download and Delete are always present
    for (const row of rows) {
      expect(row.textContent).toContain('Re-download');
      expect(row.textContent).toContain('Delete');
    }
  });

  it('clicking Open calls downloads:open with the row id', async () => {
    const invoke = mockInvoke({
      'downloads:list': () => [makeDownload()],
      'profiles:list': () => [],
      'downloads:open': () => undefined,
    });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Open/ }));

    await waitFor(() => expect(invoke).toHaveBeenCalledWith('downloads:open', { id: 'd1' }));
  });

  it('clicking Show in folder calls downloads:showInFolder with the row id', async () => {
    const invoke = mockInvoke({
      'downloads:list': () => [makeDownload()],
      'profiles:list': () => [],
      'downloads:showInFolder': () => undefined,
    });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Show in folder/ }));

    await waitFor(() => expect(invoke).toHaveBeenCalledWith('downloads:showInFolder', { id: 'd1' }));
  });

  it('clicking Re-download calls downloads:redownload with the row id', async () => {
    const invoke = mockInvoke({
      'downloads:list': () => [makeDownload()],
      'profiles:list': () => [],
      'downloads:redownload': () => undefined,
    });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Re-download/ }));

    await waitFor(() => expect(invoke).toHaveBeenCalledWith('downloads:redownload', { id: 'd1' }));
  });

  it('clicking Delete asks for confirmation, and does nothing if declined', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    const invoke = mockInvoke({ 'downloads:list': () => [makeDownload()], 'profiles:list': () => [] });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Delete/ }));

    expect(window.confirm).toHaveBeenCalledWith(
      'Delete this entry from the download history? The file on disk (if any) is not touched.',
    );
    expect(invoke).not.toHaveBeenCalledWith('downloads:delete', expect.anything());
  });

  it('clicking Delete, when confirmed, calls downloads:delete then reloads the list', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const invoke = mockInvoke({
      'downloads:list': () => [makeDownload()],
      'profiles:list': () => [],
      'downloads:delete': () => undefined,
    });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Delete/ }));

    await waitFor(() => expect(invoke).toHaveBeenCalledWith('downloads:delete', { id: 'd1' }));
    await waitFor(() =>
      expect(invoke.mock.calls.filter(([channel]) => channel === 'downloads:list').length).toBeGreaterThan(1),
    );
  });

  it('applies the correct status pill variant for missing, completed, cancelled and failed', async () => {
    mockInvoke({
      'downloads:list': () => [
        makeDownload({ id: 'd1', missing: true, state: 'completed' }),
        makeDownload({ id: 'd2', missing: false, state: 'completed' }),
        makeDownload({ id: 'd3', missing: false, state: 'cancelled' }),
        makeDownload({ id: 'd4', missing: false, state: 'failed' }),
      ],
      'profiles:list': () => [],
    });
    renderPage();
    await screen.findByText('Missing');

    const pills = document.querySelectorAll('.pill');
    expect(pills[0].className).toContain('warn');
    expect(pills[1].className).toContain('on');
    expect(pills[2].className).toContain('idle');
    expect(pills[3].className).toContain('danger');
  });
});
