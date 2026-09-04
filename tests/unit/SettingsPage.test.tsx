// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { I18nProvider } from '../../src/renderer/i18n';
import { SettingsPage } from '../../src/renderer/pages/SettingsPage';
import { DEFAULT_SETTINGS, type Settings } from '../../src/shared/schemas/settings';

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute('data-theme');
});

function makeSettings(overrides: Partial<Settings> = {}): Settings {
  return { ...DEFAULT_SETTINGS, ...overrides };
}

/** Mocks the one bridge SettingsPage actually talks through
 * (window.profileforge.invoke — see services/api.ts's callApi), same
 * pattern as ProxiesPage.test.tsx. */
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
      <SettingsPage />
    </I18nProvider>,
  );
}

describe('SettingsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('loads settings on mount and renders the current theme selection', async () => {
    mockInvoke({
      'settings:get': () => makeSettings({ theme: 'dark' }),
      'security:credentialEncryptionStatus': () => ({ available: true }),
    });
    renderPage();

    const themeSelect = (await screen.findByLabelText('Theme')) as HTMLSelectElement;
    expect(themeSelect.value).toBe('dark');
  });

  it('changing the theme select applies it to <html data-theme> immediately and persists it', async () => {
    const invoke = mockInvoke({
      'settings:get': () => makeSettings({ theme: 'system' }),
      'security:credentialEncryptionStatus': () => ({ available: true }),
      'settings:update': (p) => makeSettings({ ...(p as Partial<Settings>) }),
    });
    renderPage();
    const themeSelect = (await screen.findByLabelText('Theme')) as HTMLSelectElement;

    expect(document.documentElement.dataset.theme).toBeUndefined();

    fireEvent.change(themeSelect, { target: { value: 'light' } });

    // Applied to the document root synchronously, before the save round-trip
    // resolves — this is what makes the switch feel instant.
    expect(document.documentElement.dataset.theme).toBe('light');
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('settings:update', expect.objectContaining({ theme: 'light' })),
    );
  });

  it('switching theme back to "system" clears the data-theme attribute instead of setting it to the string "system"', async () => {
    mockInvoke({
      'settings:get': () => makeSettings({ theme: 'dark' }),
      'security:credentialEncryptionStatus': () => ({ available: true }),
      'settings:update': (p) => makeSettings({ ...(p as Partial<Settings>) }),
    });
    renderPage();
    const themeSelect = (await screen.findByLabelText('Theme')) as HTMLSelectElement;
    document.documentElement.dataset.theme = 'dark';

    fireEvent.change(themeSelect, { target: { value: 'system' } });

    expect(document.documentElement.dataset.theme).toBeUndefined();
  });

  it('shows the encryption-unavailable warning banner when credential encryption is unavailable', async () => {
    mockInvoke({
      'settings:get': () => makeSettings(),
      'security:credentialEncryptionStatus': () => ({ available: false }),
    });
    renderPage();

    expect(await screen.findByText(/credential encryption is unavailable/i)).toBeInTheDocument();
  });

  it('does not show the encryption warning when encryption is available', async () => {
    mockInvoke({
      'settings:get': () => makeSettings(),
      'security:credentialEncryptionStatus': () => ({ available: true }),
    });
    renderPage();

    await screen.findByLabelText('Theme');
    expect(screen.queryByText(/credential encryption is unavailable/i)).not.toBeInTheDocument();
  });

  it('toggling hardware acceleration saves it and shows the "Saved" banner (which calls out the restart requirement), then the banner clears itself', async () => {
    const invoke = mockInvoke({
      'settings:get': () => makeSettings({ hardwareAcceleration: true }),
      'security:credentialEncryptionStatus': () => ({ available: true }),
      'settings:update': (p) => makeSettings({ hardwareAcceleration: true, ...(p as Partial<Settings>) }),
    });
    renderPage();
    const checkbox = await screen.findByLabelText('Hardware acceleration (restart required)');
    expect(checkbox).toBeChecked();

    fireEvent.click(checkbox);

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('settings:update', expect.objectContaining({ hardwareAcceleration: false })),
    );
    expect(await screen.findByText(/Some settings \(hardware acceleration\) take effect on next launch/)).toBeInTheDocument();

    // The banner is timed to clear itself (SettingsPage.tsx's own
    // setTimeout(..., 1500)) rather than staying up forever.
    vi.advanceTimersByTime(1500);
    await waitFor(() =>
      expect(screen.queryByText(/Some settings \(hardware acceleration\) take effect on next launch/)).not.toBeInTheDocument(),
    );
  });

  it('shows the RAM warning banner once maxConcurrentLaunches exceeds 4, not before', async () => {
    mockInvoke({
      'settings:get': () => makeSettings({ maxConcurrentLaunches: 4 }),
      'security:credentialEncryptionStatus': () => ({ available: true }),
    });
    renderPage();
    await screen.findByLabelText('Theme');
    expect(screen.queryByText(/simultaneously launching profile/i)).not.toBeInTheDocument();

    cleanup();
    mockInvoke({
      'settings:get': () => makeSettings({ maxConcurrentLaunches: 8 }),
      'security:credentialEncryptionStatus': () => ({ available: true }),
    });
    renderPage();
    expect(await screen.findByText(/simultaneously launching profile/i)).toBeInTheDocument();
  });
});
