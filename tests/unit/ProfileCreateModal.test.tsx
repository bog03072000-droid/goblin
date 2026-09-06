// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { I18nProvider } from '../../src/renderer/i18n';
import { ProfileCreateModal } from '../../src/renderer/components/ProfileCreateModal';
import type { FingerprintInput } from '../../src/shared/schemas/fingerprint';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
});

function makeGeneratedFingerprint(overrides: Partial<FingerprintInput> = {}): FingerprintInput {
  return {
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
    seed: 'seed-1',
    ...overrides,
  };
}

/** Every IPC call ProfileCreateModal's load() and its hooks make on mount,
 * all with sane defaults — mirrors ProfileEditorModal.test.tsx's pattern. */
function mockInvoke(overrides: Partial<Record<string, (payload: unknown) => unknown>> = {}) {
  const handlers: Record<string, (payload: unknown) => unknown> = {
    'proxy:list': () => [],
    'groups:list': () => [],
    'templates:list': () => [],
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
    'fingerprint:generate': () => makeGeneratedFingerprint(),
    'fingerprint:validate': () => ({ valid: true, issues: [] }),
    'profiles:create': () => undefined,
    'proxy:create': (p) => ({
      id: '33333333-3333-3333-3333-333333333333',
      lastCheckStatus: null,
      lastCheckedAt: null,
      lastCheckLatencyMs: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      ...(p as object),
    }),
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

function renderModal(props: Partial<React.ComponentProps<typeof ProfileCreateModal>> = {}) {
  const onClose = vi.fn();
  const onCreated = vi.fn();
  render(
    <I18nProvider initialLocale="en" onLocaleChange={() => {}}>
      <ProfileCreateModal
        initialName="New Profile"
        initialGroupId=""
        initialProxyId=""
        initialTags=""
        initialTemplateId=""
        onClose={onClose}
        onCreated={onCreated}
        {...props}
      />
    </I18nProvider>,
  );
  return { onClose, onCreated };
}

describe('ProfileCreateModal', () => {
  it('loads with the initial name pre-filled and the fingerprint tab populated from fingerprint:generate', async () => {
    mockInvoke();
    renderModal();
    const nameInput = await screen.findByLabelText('Name');
    expect(nameInput).toHaveValue('New Profile');
  });

  it('the Create button is disabled until the name is non-blank and a fingerprint has loaded', async () => {
    mockInvoke();
    renderModal({ initialName: '' });
    const createButton = await screen.findByRole('button', { name: 'Create profile' });
    expect(createButton).toBeDisabled();
    const nameInput = screen.getByLabelText('Name');
    fireEvent.change(nameInput, { target: { value: 'My Profile' } });
    expect(createButton).not.toBeDisabled();
  });

  it('clicking Create profile calls profiles:create with the entered name and generated fingerprint, then onCreated/onClose', async () => {
    const invoke = mockInvoke();
    const { onClose, onCreated } = renderModal();
    await screen.findByLabelText('Name');
    fireEvent.click(screen.getByRole('button', { name: 'Create profile' }));

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith(
        'profiles:create',
        expect.objectContaining({ name: 'New Profile', fingerprint: expect.objectContaining({ seed: 'seed-1' }) }),
      ),
    );
    expect(onCreated).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('switching to the Proxy tab and adding a new proxy assigns it and hides the add-proxy form', async () => {
    const invoke = mockInvoke();
    renderModal();
    await screen.findByLabelText('Name');
    fireEvent.click(screen.getByText('proxy'));
    fireEvent.click(screen.getByRole('button', { name: 'Add new proxy' }));

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'My Proxy' } });
    fireEvent.change(screen.getByLabelText('Host'), { target: { value: '10.0.0.1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add Proxy' }));

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith(
        'proxy:create',
        expect.objectContaining({ name: 'My Proxy', host: '10.0.0.1' }),
      ),
    );
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Add Proxy' })).not.toBeInTheDocument());
  });

  it('does not call proxy:create when name or host is blank', async () => {
    const invoke = mockInvoke();
    renderModal();
    await screen.findByLabelText('Name');
    fireEvent.click(screen.getByText('proxy'));
    fireEvent.click(screen.getByRole('button', { name: 'Add new proxy' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add Proxy' }));
    expect(invoke).not.toHaveBeenCalledWith('proxy:create', expect.anything());
  });

  it('changing the template regenerates the fingerprint preview via fingerprint:generate', async () => {
    const invoke = mockInvoke({ 'templates:list': () => [{ id: 't1', name: 'Mobile Template', platform: 'android' }] });
    renderModal();
    await screen.findByLabelText('Name');
    fireEvent.click(screen.getByText('fingerprint'));
    const initialCalls = invoke.mock.calls.filter((c) => c[0] === 'fingerprint:generate').length;

    fireEvent.change(screen.getByLabelText('Template (OS / browser)'), { target: { value: 't1' } });

    await waitFor(() => {
      const calls = invoke.mock.calls.filter((c) => c[0] === 'fingerprint:generate').length;
      expect(calls).toBeGreaterThan(initialCalls);
    });
  });

  it('shows the first-run Custom setup hint and dismissing it persists to localStorage so it never reappears', async () => {
    mockInvoke();
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem');
    renderModal();
    await screen.findByLabelText('Name');
    expect(screen.getByText(/Custom setup lets you configure/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }));
    expect(setItemSpy).toHaveBeenCalledWith('profileforge.hint.customSetupSeen', '1');
    expect(screen.queryByRole('button', { name: 'Got it' })).not.toBeInTheDocument();
  });

  it('clicking the overlay calls onClose, but clicking inside the panel does not', async () => {
    mockInvoke();
    const { onClose } = renderModal();
    await screen.findByLabelText('Name');
    fireEvent.click(screen.getByLabelText('Name'));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(document.querySelector('.modal-overlay')!);
    expect(onClose).toHaveBeenCalled();
  });
});
