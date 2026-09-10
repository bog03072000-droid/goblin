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

  it('History fetches and shows past checks on first open, then closes without re-fetching on a second click', async () => {
    const invoke = mockInvoke({
      'proxy:list': () => [makeProxy({})],
      'proxy:checkHistory': () => [
        { id: 'h1', status: 'OK', latencyMs: 12, checkedAt: '2026-01-01T00:05:00.000Z' },
        { id: 'h2', status: 'FAIL', latencyMs: null, checkedAt: '2026-01-01T00:00:00.000Z' },
      ],
    });
    renderPage();
    await screen.findByText('My Proxy');

    fireEvent.click(screen.getByRole('button', { name: /History/ }));

    await waitFor(() => expect(invoke).toHaveBeenCalledWith('proxy:checkHistory', { id: 'proxy-1' }));
    expect(await screen.findByText('12ms')).toBeInTheDocument();
    expect(screen.getByText('FAIL')).toBeInTheDocument(); // the null-latency row's status pill

    // Closing and reopening must not re-fetch — the cached history is reused.
    fireEvent.click(screen.getByRole('button', { name: /History/ }));
    expect(screen.queryByText('12ms')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /History/ }));
    expect(await screen.findByText('12ms')).toBeInTheDocument();
    expect(invoke).toHaveBeenCalledTimes(2); // proxy:list once, proxy:checkHistory once — not twice
  });

  it('History shows an empty-state message when a proxy has never been checked', async () => {
    mockInvoke({
      'proxy:list': () => [makeProxy({})],
      'proxy:checkHistory': () => [],
    });
    renderPage();
    await screen.findByText('My Proxy');

    fireEvent.click(screen.getByRole('button', { name: /History/ }));

    expect(await screen.findByText('No checks recorded yet.')).toBeInTheDocument();
  });

  it('a manual Test drops any cached history for that proxy so History re-fetches instead of showing a stale list', async () => {
    const invoke = mockInvoke({
      'proxy:list': () => [makeProxy({})],
      'proxy:checkHistory': () => [{ id: 'h1', status: 'OK', latencyMs: 5, checkedAt: '2026-01-01T00:00:00.000Z' }],
      'proxy:test': () => ({ success: true, latencyMs: 99 }),
    });
    renderPage();
    await screen.findByText('My Proxy');

    fireEvent.click(screen.getByRole('button', { name: /History/ }));
    await screen.findByText('5ms');
    fireEvent.click(screen.getByRole('button', { name: /History/ })); // close

    fireEvent.click(screen.getByRole('button', { name: 'Test' }));
    await screen.findByText('OK (99ms)');

    fireEvent.click(screen.getByRole('button', { name: /History/ })); // reopen
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('proxy:checkHistory', { id: 'proxy-1' }));
    // Called twice total (once on the original open, once on this reopen) —
    // proof the cache was actually dropped, not just harmlessly re-rendered.
    expect(invoke.mock.calls.filter((c) => c[0] === 'proxy:checkHistory')).toHaveLength(2);
  });

  it('editing a proxy (e.g. changing its port) drops the stale Test/Geolocate/History results for it, instead of leaving a result that now refers to the old config', async () => {
    // Found via a live UX walkthrough: testing a proxy against a dead
    // 127.0.0.1:8080, then editing it to port 9090, left the OLD result
    // ("Failed: connect ECONNREFUSED 127.0.0.1:8080") displayed unchanged —
    // referring to a port the proxy no longer even uses. Editing only ever
    // called refresh() for the proxy list itself, never clearing the
    // separate in-memory results/geo/history state a manual Test/Geolocate
    // click had populated.
    const invoke = mockInvoke({
      'proxy:list': () => [makeProxy({})],
      'proxy:test': () => ({ success: false, error: 'connect ECONNREFUSED 1.2.3.4:8080' }),
      'proxy:update': (p) => ({ ...makeProxy({}), ...(p as object) }),
      'proxy:checkHistory': () => [{ id: 'h1', status: 'FAIL', latencyMs: null, checkedAt: '2026-01-01T00:00:00.000Z' }],
    });
    renderPage();
    await screen.findByText('My Proxy');

    fireEvent.click(screen.getByRole('button', { name: 'Test' }));
    expect(await screen.findByText('Failed: connect ECONNREFUSED 1.2.3.4:8080')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const portInput = screen.getByLabelText('Port');
    fireEvent.change(portInput, { target: { value: '9090' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(invoke).toHaveBeenCalledWith('proxy:update', expect.objectContaining({ port: 9090 })));
    // The stale failure text (which names the OLD port) must be gone — not
    // still showing, and not replaced by some other leftover fragment of it.
    expect(screen.queryByText('Failed: connect ECONNREFUSED 1.2.3.4:8080')).not.toBeInTheDocument();

    // History must also re-fetch rather than show whatever was cached under
    // the old config, same guarantee the manual-Test case above already has.
    fireEvent.click(screen.getByRole('button', { name: /History/ }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('proxy:checkHistory', { id: 'proxy-1' }));
  });

  describe('bulk import', () => {
    function openBulkImport() {
      fireEvent.click(screen.getByRole('button', { name: 'Bulk import' }));
    }

    it('Bulk import toggles a panel with a textarea and a protocol select, closed by default', async () => {
      mockInvoke({ 'proxy:list': () => [] });
      renderPage();
      await screen.findByText('No proxies yet. Add one above.');

      expect(screen.queryByPlaceholderText(/203\.0\.113\.5:8080/)).not.toBeInTheDocument();
      openBulkImport();
      expect(screen.getByPlaceholderText(/203\.0\.113\.5:8080/)).toBeInTheDocument();
    });

    it('parses host:port and host:port:user:pass lines, creates one proxy per valid line, and reports invalid lines without creating them', async () => {
      const invoke = mockInvoke({
        'proxy:list': () => [],
        'proxy:create': (p) => makeProxy(p as Partial<ProxyRecord>),
      });
      renderPage();
      await screen.findByText('No proxies yet. Add one above.');
      openBulkImport();

      fireEvent.change(screen.getByPlaceholderText(/203\.0\.113\.5:8080/), {
        target: { value: '10.0.0.1:8080\n10.0.0.2:3128:alice:s3cret\nnot-a-valid-line\n\n' },
      });

      expect(screen.getByText('2 valid line(s), 1 invalid')).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Import' }));

      await waitFor(() =>
        expect(invoke).toHaveBeenCalledWith(
          'proxy:create',
          expect.objectContaining({ name: '10.0.0.1:8080', host: '10.0.0.1', port: 8080, protocol: 'http' }),
        ),
      );
      expect(invoke).toHaveBeenCalledWith(
        'proxy:create',
        expect.objectContaining({ name: '10.0.0.2:3128', host: '10.0.0.2', port: 3128, username: 'alice', password: 's3cret' }),
      );
      // The invalid line never became a proxy:create call — only the 2 valid ones did.
      expect(invoke.mock.calls.filter((c) => c[0] === 'proxy:create')).toHaveLength(2);

      expect(await screen.findByText('Imported 2 of 3 proxies')).toBeInTheDocument();
      expect(screen.getByText('not-a-valid-line', { exact: false })).toBeInTheDocument();
    });

    it('applies the selected protocol to every imported line', async () => {
      const invoke = mockInvoke({
        'proxy:list': () => [],
        'proxy:create': (p) => makeProxy(p as Partial<ProxyRecord>),
      });
      renderPage();
      await screen.findByText('No proxies yet. Add one above.');
      openBulkImport();

      fireEvent.change(screen.getByPlaceholderText(/203\.0\.113\.5:8080/), { target: { value: '10.0.0.1:1080' } });
      fireEvent.change(screen.getByLabelText('Protocol (applied to every imported proxy)'), { target: { value: 'socks5' } });
      fireEvent.click(screen.getByRole('button', { name: 'Import' }));

      await waitFor(() =>
        expect(invoke).toHaveBeenCalledWith('proxy:create', expect.objectContaining({ protocol: 'socks5' })),
      );
    });

    it('a proxy:create failure for one line is reported per-line without blocking the others from importing', async () => {
      const invoke = mockInvoke({
        'proxy:list': () => [],
        'proxy:create': (p) => {
          const input = p as { host: string };
          if (input.host === '10.0.0.2') throw new Error('duplicate host');
          return makeProxy(p as Partial<ProxyRecord>);
        },
      });
      renderPage();
      await screen.findByText('No proxies yet. Add one above.');
      openBulkImport();

      fireEvent.change(screen.getByPlaceholderText(/203\.0\.113\.5:8080/), {
        target: { value: '10.0.0.1:8080\n10.0.0.2:8080' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Import' }));

      expect(await screen.findByText('Imported 1 of 2 proxies')).toBeInTheDocument();
      expect(screen.getByText('duplicate host', { exact: false })).toBeInTheDocument();
      expect(invoke.mock.calls.filter((c) => c[0] === 'proxy:create')).toHaveLength(2);
    });

    it('Import is disabled when there are no valid lines yet', async () => {
      mockInvoke({ 'proxy:list': () => [] });
      renderPage();
      await screen.findByText('No proxies yet. Add one above.');
      openBulkImport();

      expect(screen.getByRole('button', { name: 'Import' })).toBeDisabled();

      fireEvent.change(screen.getByPlaceholderText(/203\.0\.113\.5:8080/), { target: { value: 'garbage-line' } });
      expect(screen.getByRole('button', { name: 'Import' })).toBeDisabled();
    });
  });

  describe('geolocation', () => {
    const tunnelGeo = { ok: true, verifiedThroughTunnel: true, geo: { country: 'Germany', countryCode: 'DE', timezone: 'Europe/Berlin' } };

    it('shows the country/timezone pill after a successful tunnel-verified check, with no asterisk', async () => {
      mockInvoke({
        'proxy:list': () => [makeProxy({})],
        'proxy:geolocate': () => tunnelGeo,
        'profiles:list': () => [],
      });
      renderPage();
      fireEvent.click(await screen.findByRole('button', { name: 'Check location' }));

      const pill = await screen.findByText((content) => content.startsWith('Germany (Europe/Berlin)'));
      expect(pill.textContent).toBe('Germany (Europe/Berlin)');
    });

    it('shows an asterisk and a host-only notice when the check falls back to a host-only lookup (e.g. SOCKS5)', async () => {
      mockInvoke({
        'proxy:list': () => [makeProxy({ protocol: 'socks5' })],
        'proxy:geolocate': () => ({ ok: true, verifiedThroughTunnel: false, geo: tunnelGeo.geo }),
        'profiles:list': () => [],
      });
      renderPage();
      fireEvent.click(await screen.findByRole('button', { name: 'Check location' }));

      const pill = await screen.findByText((content) => content.startsWith('Germany (Europe/Berlin)'));
      expect(pill.textContent).toBe('Germany (Europe/Berlin) *');
      expect(pill).toHaveAttribute('title', expect.stringContaining("SOCKS5"));
    });

    it('shows a failure pill when the lookup fails entirely', async () => {
      mockInvoke({
        'proxy:list': () => [makeProxy({})],
        'proxy:geolocate': () => ({ ok: false, reason: 'lookup-failed' }),
        'profiles:list': () => [],
      });
      renderPage();
      fireEvent.click(await screen.findByRole('button', { name: 'Check location' }));

      expect(await screen.findByText('Could not determine location')).toBeInTheDocument();
    });

    it('flags a mismatch when a profile assigned to this proxy has a different timezone', async () => {
      const invoke = mockInvoke({
        'proxy:list': () => [makeProxy({ id: 'proxy-1' })],
        'proxy:geolocate': () => tunnelGeo,
        'profiles:list': () => [{ id: 'p1', proxyId: 'proxy-1', fingerprintId: 'fp1' }],
        'fingerprint:get': () => ({ timezone: 'America/New_York' }),
      });
      renderPage();
      fireEvent.click(await screen.findByRole('button', { name: 'Check location' }));

      const pill = await screen.findByText((content) => content.startsWith('Germany (Europe/Berlin)'));
      expect(pill.className).toContain('warn');
      expect(pill).toHaveAttribute('title', expect.stringContaining('1 profile(s)'));
      expect(invoke).toHaveBeenCalledWith('fingerprint:get', { id: 'fp1' });
    });

    it('does not flag a mismatch when the assigned profile\'s timezone matches', async () => {
      mockInvoke({
        'proxy:list': () => [makeProxy({ id: 'proxy-1' })],
        'proxy:geolocate': () => tunnelGeo,
        'profiles:list': () => [{ id: 'p1', proxyId: 'proxy-1', fingerprintId: 'fp1' }],
        'fingerprint:get': () => ({ timezone: 'Europe/Berlin' }),
      });
      renderPage();
      fireEvent.click(await screen.findByRole('button', { name: 'Check location' }));

      const pill = await screen.findByText((content) => content.startsWith('Germany (Europe/Berlin)'));
      expect(pill.className).toContain('on');
      expect(pill).not.toHaveAttribute('title');
    });

    it('ignores profiles assigned to a different proxy when checking for mismatches', async () => {
      mockInvoke({
        'proxy:list': () => [makeProxy({ id: 'proxy-1' })],
        'proxy:geolocate': () => tunnelGeo,
        'profiles:list': () => [{ id: 'p1', proxyId: 'other-proxy', fingerprintId: 'fp1' }],
        'fingerprint:get': () => ({ timezone: 'America/New_York' }),
      });
      renderPage();
      fireEvent.click(await screen.findByRole('button', { name: 'Check location' }));

      const pill = await screen.findByText((content) => content.startsWith('Germany (Europe/Berlin)'));
      expect(pill.className).toContain('on');
    });
  });
});
