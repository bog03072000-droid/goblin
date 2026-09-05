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
    'fingerprint:options': () => ({ platforms: [], browserVersions: [] }),
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
