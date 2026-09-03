// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import type { FingerprintOptionsResponse } from '@shared/schemas/fingerprint';
import { I18nProvider } from '../../src/renderer/i18n';
import { FieldOverridesPicker, type FieldOverrides } from '../../src/renderer/components/profileEditor/FieldOverridesPicker';

// Vitest doesn't auto-register RTL's cleanup the way Jest's testEnvironment
// integration does — without this, each test's render() output accumulates
// in the same jsdom `document.body` instead of being unmounted, and the
// next test's queries see every previous test's elements too (found via a
// real failure: "Found multiple elements" from the second test onward).
afterEach(() => {
  cleanup();
});

// Real shape (mirrors src/main/fingerprint/platformProfiles.ts) — a fixture,
// not the real module, so this test doesn't depend on main-process code and
// stays free to change independently as long as the shared schema shape
// doesn't change.
const FIELD_OPTIONS: FingerprintOptionsResponse = {
  platforms: [
    {
      os: 'windows',
      osVersions: ['10.0', '11.0'],
      platform: 'Win32',
      screens: [
        { width: 1920, height: 1080 },
        { width: 2560, height: 1440 },
      ],
      hardwareConcurrencyOptions: [4, 8, 12, 16],
      deviceMemoryOptions: [8, 16, 32],
      gpuOptions: [
        { vendor: 'Google Inc. (NVIDIA)', renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0)' },
        { vendor: 'Google Inc. (Intel)', renderer: 'ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0)' },
      ],
    },
    {
      os: 'macos',
      osVersions: ['13.6', '14.5', '15.1'],
      platform: 'MacIntel',
      screens: [{ width: 1440, height: 900 }],
      hardwareConcurrencyOptions: [8, 10],
      deviceMemoryOptions: [8, 16],
      gpuOptions: [{ vendor: 'Google Inc. (Apple)', renderer: 'ANGLE (Apple, Apple M2, OpenGL 4.1)' }],
    },
  ],
  browserVersions: ['126.0.0.0', '127.0.0.0', '128.0.0.0'],
};

function renderPicker(overrides: FieldOverrides, effectiveOs: 'windows' | 'macos' = 'windows') {
  const onChange = vi.fn();
  render(
    <I18nProvider initialLocale="en" onLocaleChange={() => {}}>
      <FieldOverridesPicker
        overrides={overrides}
        onChange={onChange}
        fieldOptions={FIELD_OPTIONS}
        effectiveOs={effectiveOs}
        effectivePlatform="Win32"
      />
    </I18nProvider>,
  );
  return onChange;
}

describe('FieldOverridesPicker', () => {
  it('renders the three field groups, every select defaulting to Auto', () => {
    renderPicker({});
    expect(screen.getByText('Platform')).toBeInTheDocument();
    expect(screen.getByText('Hardware')).toBeInTheDocument();
    expect(screen.getByText('Display')).toBeInTheDocument();
    for (const select of screen.getAllByRole('combobox')) {
      expect(select).toHaveValue('');
    }
  });

  it('only offers the effective OS\'s own option lists, not another OS\'s (no Apple GPU showing up for Windows)', () => {
    renderPicker({}, 'windows');
    const gpuSelect = screen.getByLabelText('GPU (WebGL vendor/renderer)');
    expect(gpuSelect).toHaveTextContent('ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0)');
    expect(gpuSelect).not.toHaveTextContent('Apple');

    const osVersionSelect = screen.getByLabelText('OS version');
    expect(osVersionSelect).toHaveTextContent('10.0');
    expect(osVersionSelect).not.toHaveTextContent('13.6');
  });

  it('changing OS clears the previous OS\'s osVersion/GPU overrides, not just sets os', () => {
    const onChange = renderPicker({ osVersion: '11.0', webglVendor: 'Google Inc. (NVIDIA)', webglRenderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0)' });
    fireEvent.change(screen.getByLabelText('Operating system'), { target: { value: 'macos' } });
    expect(onChange).toHaveBeenCalledWith({
      os: 'macos',
      osVersion: undefined,
      webglVendor: undefined,
      webglRenderer: undefined,
      screenWidth: undefined,
      screenHeight: undefined,
    });
  });

  it('selecting an OS version sets only that field, leaving other overrides untouched', () => {
    const onChange = renderPicker({ hardwareConcurrency: 8 });
    fireEvent.change(screen.getByLabelText('OS version'), { target: { value: '11.0' } });
    expect(onChange).toHaveBeenCalledWith({ hardwareConcurrency: 8, osVersion: '11.0' });
  });

  it('selecting a GPU sets vendor AND renderer together as a matched pair', () => {
    const onChange = renderPicker({});
    fireEvent.change(screen.getByLabelText('GPU (WebGL vendor/renderer)'), { target: { value: 'Google Inc. (Intel)' } });
    expect(onChange).toHaveBeenCalledWith({
      webglVendor: 'Google Inc. (Intel)',
      webglRenderer: 'ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0)',
    });
  });

  it('selecting a resolution decodes "WxH" into screenWidth/screenHeight', () => {
    const onChange = renderPicker({});
    fireEvent.change(screen.getByLabelText('Screen resolution'), { target: { value: '2560x1440' } });
    expect(onChange).toHaveBeenCalledWith({ screenWidth: 2560, screenHeight: 1440 });
  });

  it('picking Auto on a previously-overridden field clears just that field', () => {
    const onChange = renderPicker({ hardwareConcurrency: 8, deviceMemory: 16 });
    fireEvent.change(screen.getByLabelText('CPU cores (hardwareConcurrency)'), { target: { value: '' } });
    expect(onChange).toHaveBeenCalledWith({ hardwareConcurrency: undefined, deviceMemory: 16 });
  });
});
