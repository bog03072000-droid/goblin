// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { I18nProvider } from '../../src/renderer/i18n';
import { ProxiesPage } from '../../src/renderer/pages/ProxiesPage';
import type { ProxyRecord } from '../../src/shared/schemas/proxy';

afterEach(() => {
  cleanup();
});

function makeProxy(overrides: Partial<ProxyRecord>): ProxyRecord {
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
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as ProxyRecord;
}

/** Mocks the one bridge ProxiesPage actually talks through
 * (window.profileforge.invoke — see services/api.ts's callApi) rather than
 * the module, so the test exercises the real component wiring exactly as
 * the real preload bridge would present it. */
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
      <ProxiesPage />
    </I18nProvider>,
  );
}

describe('ProxiesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loads and renders the proxy list on mount', async () => {
    mockInvoke({ 'proxy:list': () => [makeProxy({ name: 'Alpha' }), makeProxy({ id: 'proxy-2', name: 'Beta' })] });
    renderPage();

    expect(await screen.findByText('Alpha')).toBeInTheDocument();
    expect(screen.getByText('Beta')).toBeInTheDocument();
  });

  it('shows the empty state when no proxies exist', async () => {
    mockInvoke({ 'proxy:list': () => [] });
    renderPage();

    expect(await screen.findByText('No proxies yet. Add one above.')).toBeInTheDocument();
  });

  it('an out-of-range port shows a red-bordered field, a banner message, and disables Create', async () => {
    mockInvoke({ 'proxy:list': () => [] });
    renderPage();
    await screen.findByText('No proxies yet. Add one above.');

    const portInput = screen.getByPlaceholderText('Port') as HTMLInputElement;
    fireEvent.change(portInput, { target: { value: '99999' } });

    expect(portInput).toHaveClass('field-input-invalid');
    expect(screen.getByText('Enter a port between 1 and 65535.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add Proxy' })).toBeDisabled();
  });

  it('creates a proxy with the entered fields once the form is valid, then clears and refreshes', async () => {
    const invoke = mockInvoke({
      'proxy:list': () => [],
      'proxy:create': () => makeProxy({ id: 'new-id', name: 'New Proxy' }),
    });
    renderPage();
    await screen.findByText('No proxies yet. Add one above.');

    fireEvent.change(screen.getByPlaceholderText('Name'), { target: { value: 'New Proxy' } });
    fireEvent.change(screen.getByPlaceholderText('Host'), { target: { value: 'example.com' } });
    fireEvent.change(screen.getByPlaceholderText('Port'), { target: { value: '3128' } });

    fireEvent.click(screen.getByRole('button', { name: 'Add Proxy' }));

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith(
        'proxy:create',
        expect.objectContaining({ name: 'New Proxy', host: 'example.com', port: 3128, protocol: 'http' }),
      ),
    );
    // Refreshed the list after creating (proxy:list called again).
    expect(invoke).toHaveBeenCalledWith('proxy:list', {});
  });

  it('does not call proxy:create when Name or Host is blank, even if clicked directly', async () => {
    const invoke = mockInvoke({ 'proxy:list': () => [] });
    renderPage();
    await screen.findByText('No proxies yet. Add one above.');

    fireEvent.click(screen.getByRole('button', { name: 'Add Proxy' }));

    await new Promise((r) => setTimeout(r, 0));
    expect(invoke).not.toHaveBeenCalledWith('proxy:create', expect.anything());
  });

  it('Delete opens a confirmation dialog and only calls proxy:delete once confirmed', async () => {
    const invoke = mockInvoke({
      'proxy:list': () => [makeProxy({ name: 'To Delete' })],
      'proxy:delete': () => undefined,
    });
    renderPage();
    await screen.findByText('To Delete');

    fireEvent.click(screen.getByRole('button', { name: /Delete/ }));
    // The confirm dialog is now open — deletion must not have happened yet.
    expect(invoke).not.toHaveBeenCalledWith('proxy:delete', expect.anything());

    const dialogConfirm = screen.getAllByRole('button', { name: 'Delete' }).at(-1)!;
    fireEvent.click(dialogConfirm);

    await waitFor(() => expect(invoke).toHaveBeenCalledWith('proxy:delete', { id: 'proxy-1' }));
  });

  it('Test reports success/failure inline, overriding any earlier persisted health-check status for that row', async () => {
    mockInvoke({
      'proxy:list': () => [makeProxy({ lastCheckStatus: 'FAIL', lastCheckedAt: '2026-01-01T00:00:00.000Z' })],
      'proxy:test': () => ({ success: true, latencyMs: 42 }),
    });
    renderPage();
    await screen.findByText('My Proxy');

    fireEvent.click(screen.getByRole('button', { name: 'Test' }));

    expect(await screen.findByText('OK (42ms)')).toBeInTheDocument();
  });
});
