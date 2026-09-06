// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { I18nProvider } from '../../src/renderer/i18n';
import { ProfileEditorModal } from '../../src/renderer/components/ProfileEditorModal';
import type { Profile } from '../../src/shared/schemas/profile';
import type { Fingerprint } from '../../src/shared/schemas/fingerprint';

afterEach(() => {
  cleanup();
});

function makeProfile(overrides: Partial<Profile> = {}): Profile {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    name: 'Test Profile',
    description: '',
    profilePath: '/tmp/p1',
    fingerprintId: '22222222-2222-2222-2222-222222222222',
    proxyId: null,
    groupId: null,
    status: 'STOPPED',
    tags: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    lastStartedAt: null,
    lastStoppedAt: null,
    automationEnabled: false,
    automationPort: null,
    ...overrides,
  };
}

function makeFingerprint(overrides: Partial<Fingerprint> = {}): Fingerprint {
  return {
    id: '22222222-2222-2222-2222-222222222222',
    name: 'fp',
    os: 'windows',
    osVersion: '10',
    browserVersion: '128.0.0.0',
    userAgent: 'Mozilla/5.0',
    platform: 'Win32',
    locale: 'en-US',
    languages: ['en-US', 'en'],
    timezone: 'America/New_York',
    screenWidth: 1920,
    screenHeight: 1080,
    deviceScaleFactor: 1,
    hardwareConcurrency: 8,
    deviceMemory: 8,
    webglVendor: 'Google Inc.',
    webglRenderer: 'ANGLE',
    canvasMode: 'off',
    audioMode: 'off',
    webrtcMode: 'default',
    fontsMode: 'system',
    mediaDevicesMode: 'real',
    webglSpoofingMode: 'off',
    geolocationMode: 'real',
    geolocationLatitude: 0,
    geolocationLongitude: 0,
    permissionsMode: 'real',
    serviceWorkerMode: 'real',
    seed: 'seed',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

/** Every IPC call ProfileEditorModal's load() makes on mount, all with
 * sane defaults — individual tests override just the handler they care
 * about. Mirrors ProxiesPage.test.tsx/SettingsPage.test.tsx's mockInvoke
 * pattern (window.profileforge.invoke, not the module). */
function mockInvoke(overrides: Partial<Record<string, (payload: unknown) => unknown>> = {}) {
  const handlers: Record<string, (payload: unknown) => unknown> = {
    'profiles:get': () => makeProfile(),
    'fingerprint:get': () => makeFingerprint(),
    'proxy:list': () => [],
    'groups:list': () => [],
    'profiles:getAutomationToken': () => ({ token: null }),
    'settings:get': () => ({ defaultAutomationPort: null }),
    'fingerprint:options': () => ({
      platforms: [
        {
          os: 'windows',
          osVersions: ['10', '11'],
          platform: 'Win32',
          screens: [{ width: 1920, height: 1080 }],
          hardwareConcurrencyOptions: [4, 8, 16],
          deviceMemoryOptions: [8, 16],
          gpuOptions: [{ vendor: 'Google Inc.', renderer: 'ANGLE' }],
        },
      ],
      browserVersions: ['128.0.0.0'],
    }),
    'profiles:clearCache': () => undefined,
    'fingerprint:update': (p) => ({ ...makeFingerprint(), ...(p as object) }),
    'fingerprint:validate': () => ({ valid: true, warnings: [], errors: [] }),
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

function renderModal() {
  render(
    <I18nProvider initialLocale="en" onLocaleChange={() => {}}>
      <ProfileEditorModal profileId="11111111-1111-1111-1111-111111111111" onClose={() => {}} onSaved={() => {}} />
    </I18nProvider>,
  );
}

describe('ProfileEditorModal — per-tab unsaved-changes marker', () => {
  it('shows no dirty dot on any tab right after loading (nothing edited yet)', async () => {
    mockInvoke();
    renderModal();

    await screen.findByLabelText('Name');
    expect(document.querySelector('.tab-dirty-dot')).not.toBeInTheDocument();
  });

  it('editing the Name field marks only the General tab dirty, not Proxy', async () => {
    mockInvoke();
    renderModal();
    const nameInput = await screen.findByLabelText('Name');

    fireEvent.change(nameInput, { target: { value: 'Renamed Profile' } });

    const generalTab = screen.getByText('general').closest('.tab-item')!;
    const proxyTab = screen.getByText('proxy').closest('.tab-item')!;
    expect(generalTab.querySelector('.tab-dirty-dot')).toBeInTheDocument();
    expect(proxyTab.querySelector('.tab-dirty-dot')).not.toBeInTheDocument();
  });

  it('saving General clears its dirty dot', async () => {
    const invoke = mockInvoke({ 'profiles:update': (p) => makeProfile(p as Partial<Profile>) });
    renderModal();
    const nameInput = await screen.findByLabelText('Name');
    fireEvent.change(nameInput, { target: { value: 'Renamed Profile' } });
    const generalTab = screen.getByText('general').closest('.tab-item')!;
    expect(generalTab.querySelector('.tab-dirty-dot')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(invoke).toHaveBeenCalledWith('profiles:update', expect.objectContaining({ name: 'Renamed Profile' })));
    await waitFor(() => expect(generalTab.querySelector('.tab-dirty-dot')).not.toBeInTheDocument());
  });

  it('Reset clears the dirty dot without saving (no profiles:update call)', async () => {
    const invoke = mockInvoke();
    renderModal();
    const nameInput = await screen.findByLabelText('Name');
    fireEvent.change(nameInput, { target: { value: 'Renamed Profile' } });
    const generalTab = screen.getByText('general').closest('.tab-item')!;
    expect(generalTab.querySelector('.tab-dirty-dot')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));

    expect(generalTab.querySelector('.tab-dirty-dot')).not.toBeInTheDocument();
    expect(invoke).not.toHaveBeenCalledWith('profiles:update', expect.anything());
  });
});

describe('ProfileEditorModal — Proxy tab save', () => {
  it('changing the assigned proxy and clicking Save calls profiles:update with the new proxyId, then reloads', async () => {
    const invoke = mockInvoke({
      'proxy:list': () => [
        { id: '33333333-3333-3333-3333-333333333333', name: 'Proxy 1', protocol: 'http', host: '1.2.3.4', port: 8080, lastCheckStatus: null, lastCheckedAt: null, lastCheckLatencyMs: null, createdAt: '', updatedAt: '' },
      ],
      'profiles:update': (p) => makeProfile(p as Partial<Profile>),
    });
    renderModal();
    await screen.findByLabelText('Name');
    fireEvent.click(screen.getByText('proxy'));

    fireEvent.change(screen.getByLabelText('Assigned proxy'), { target: { value: '33333333-3333-3333-3333-333333333333' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('profiles:update', { id: '11111111-1111-1111-1111-111111111111', proxyId: '33333333-3333-3333-3333-333333333333' }),
    );
    // saveProxy() reloads the whole profile afterward (see its own comment) —
    // a second profiles:get call is the observable proof of that reload.
    await waitFor(() => expect(invoke.mock.calls.filter((c) => c[0] === 'profiles:get').length).toBeGreaterThanOrEqual(2));
  });
});

describe('ProfileEditorModal — Fingerprint tab: regenerate, validate, manual save, spoofing', () => {
  it('clicking Regenerate calls fingerprint:generate then fingerprint:update with the freshly generated fields', async () => {
    const invoke = mockInvoke({
      'fingerprint:generate': () => ({ ...makeFingerprint(), userAgent: 'Mozilla/5.0 (regenerated)' }),
    });
    renderModal();
    await screen.findByLabelText('Name');
    fireEvent.click(screen.getByText('fingerprint'));

    fireEvent.click(screen.getByRole('button', { name: 'Regenerate (new random identity)' }));

    await waitFor(() => expect(invoke).toHaveBeenCalledWith('fingerprint:generate', expect.anything()));
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith(
        'fingerprint:update',
        expect.objectContaining({ id: '22222222-2222-2222-2222-222222222222', userAgent: 'Mozilla/5.0 (regenerated)' }),
      ),
    );
  });

  it('clicking Validate calls fingerprint:validate and shows the result', async () => {
    const invoke = mockInvoke({
      'fingerprint:validate': () => ({ valid: false, warnings: [], errors: ['platform mismatch'] }),
    });
    renderModal();
    await screen.findByLabelText('Name');
    fireEvent.click(screen.getByText('fingerprint'));

    fireEvent.click(screen.getByRole('button', { name: 'Validate' }));

    await waitFor(() => expect(invoke).toHaveBeenCalledWith('fingerprint:validate', expect.anything()));
    await screen.findByText(/Invalid/);
  });

  it('editing a field in MANUAL mode and saving calls fingerprint:update with the parsed manual fields', async () => {
    const invoke = mockInvoke({
      'fingerprint:update': (p) => ({ ...makeFingerprint(), ...(p as object) }),
    });
    renderModal();
    await screen.findByLabelText('Name');
    fireEvent.click(screen.getByText('fingerprint'));
    fireEvent.click(screen.getByRole('button', { name: 'MANUAL' }));

    const uaInput = screen.getByLabelText('User-Agent');
    fireEvent.change(uaInput, { target: { value: 'Mozilla/5.0 (manual edit)' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith(
        'fingerprint:update',
        expect.objectContaining({ id: '22222222-2222-2222-2222-222222222222', userAgent: 'Mozilla/5.0 (manual edit)' }),
      ),
    );
  });

  it('changing Canvas Mode calls fingerprint:update immediately with just that spoofing patch', async () => {
    const invoke = mockInvoke({
      'fingerprint:update': (p) => ({ ...makeFingerprint(), ...(p as object) }),
    });
    renderModal();
    await screen.findByLabelText('Name');
    fireEvent.click(screen.getByText('fingerprint'));

    fireEvent.change(screen.getByLabelText('Canvas Mode'), { target: { value: 'noise' } });

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('fingerprint:update', { id: '22222222-2222-2222-2222-222222222222', canvasMode: 'noise' }),
    );
  });
});

describe('ProfileEditorModal — Storage tab: clear cache', () => {
  it('clicking Clear Cache calls profiles:clearCache with this profile\'s id', async () => {
    const invoke = mockInvoke();
    renderModal();
    await screen.findByLabelText('Name');
    fireEvent.click(screen.getByText('storage'));

    fireEvent.click(screen.getByRole('button', { name: 'Clear Cache' }));

    await waitFor(() => expect(invoke).toHaveBeenCalledWith('profiles:clearCache', { id: '11111111-1111-1111-1111-111111111111' }));
  });
});
