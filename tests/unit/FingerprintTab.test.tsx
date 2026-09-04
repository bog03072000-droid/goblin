// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { I18nProvider } from '../../src/renderer/i18n';
import { FingerprintTab, type FingerprintDraft } from '../../src/renderer/components/profileEditor/FingerprintTab';
import type { Fingerprint } from '../../src/shared/schemas/fingerprint';

afterEach(() => {
  cleanup();
});

function makeFingerprint(overrides: Partial<Fingerprint> = {}): Fingerprint {
  return {
    id: '22222222-2222-2222-2222-222222222222',
    name: 'fp',
    os: 'windows',
    osVersion: '10',
    browserVersion: '128.0.0.0',
    userAgent: 'Mozilla/5.0 (Auto UA)',
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
    seed: 'seed',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeDraft(overrides: Partial<FingerprintDraft> = {}): FingerprintDraft {
  return {
    userAgent: 'Mozilla/5.0 (Manual UA)',
    platform: 'Win32',
    locale: 'en-US',
    languages: 'en-US, en',
    timezone: 'America/New_York',
    screenWidth: '1920',
    screenHeight: '1080',
    deviceScaleFactor: '1',
    hardwareConcurrency: '8',
    webrtcMode: 'default',
    ...overrides,
  };
}

function renderTab(props: Partial<Parameters<typeof FingerprintTab>[0]> = {}) {
  render(
    <I18nProvider initialLocale="en" onLocaleChange={() => {}}>
      <FingerprintTab
        fingerprint={makeFingerprint()}
        draft={makeDraft()}
        onDraftChange={() => {}}
        manualMode={false}
        onManualModeChange={() => {}}
        validation={null}
        saving={false}
        spoofingSaving={false}
        onRegenerate={() => {}}
        onValidate={() => {}}
        onSaveManual={() => {}}
        onUpdateSpoofing={() => {}}
        {...props}
      />
    </I18nProvider>,
  );
}

describe('FingerprintTab — "as seen by a site" preview', () => {
  it('shows the current (auto) fingerprint values before Regenerate/Save', () => {
    renderTab({ manualMode: false });
    const preview = screen.getByTestId('fp-site-preview');
    expect(preview).toHaveTextContent('Mozilla/5.0 (Auto UA)');
    expect(preview).toHaveTextContent('1920 x 1080 @ 1x');
  });

  it('reflects the unsaved manual draft, not the last-saved fingerprint, while in MANUAL mode', () => {
    renderTab({
      manualMode: true,
      draft: makeDraft({ userAgent: 'Mozilla/5.0 (Edited Draft UA)', screenWidth: '800', screenHeight: '600' }),
    });
    const preview = screen.getByTestId('fp-site-preview');
    expect(preview).toHaveTextContent('Mozilla/5.0 (Edited Draft UA)');
    expect(preview).toHaveTextContent('800 x 600');
    expect(preview).not.toHaveTextContent('Mozilla/5.0 (Auto UA)');
  });

  it('marks an active spoofing mode as Protected and an inactive one as Real', () => {
    renderTab({ fingerprint: makeFingerprint({ canvasMode: 'noise', audioMode: 'off' }) });
    const preview = screen.getByTestId('fp-site-preview');
    expect(preview).toHaveTextContent('Canvas Mode: Protected');
    expect(preview).toHaveTextContent('Audio Mode: Real');
  });
});
