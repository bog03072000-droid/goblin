import type { FingerprintOptionsResponse, Os } from '@shared/schemas/fingerprint';
import { useTranslation } from '../../i18n';

/** Explicit "choose instead of Auto" overrides for the generator — an unset
 * field means Auto (the generator picks it, seeded/random as always). Kept
 * separate from FingerprintDraft (which is free-text Manual mode's own
 * state) since these are structured picks validated server-side against the
 * real platform option lists, never hand-typed strings. */
export type FieldOverrides = {
  os?: Os;
  osVersion?: string;
  browserVersion?: string;
  screenWidth?: number;
  screenHeight?: number;
  hardwareConcurrency?: number;
  deviceMemory?: number;
  webglVendor?: string;
  webglRenderer?: string;
};

const AUTO = '';

/** Renders the OS/version/browser/CPU/RAM/GPU/resolution pickers — each
 * defaults to "Auto" and only appears in the request to fingerprint:generate
 * once explicitly chosen. Platform (Win32/MacIntel/Linux x86_64) and GPU
 * options are filtered to whichever OS is currently in effect (the override
 * if set, otherwise the last-generated fingerprint's own os) so the list
 * never offers a combination the generator itself would reject — e.g. no
 * Apple GPU option shows up for a Windows profile at all, rather than being
 * offered and then silently ignored. Fields are grouped into Platform/
 * Hardware/Display subsections rather than one flat list. */
export function FieldOverridesPicker({
  overrides,
  onChange,
  fieldOptions,
  effectiveOs,
  effectivePlatform,
}: {
  overrides: FieldOverrides;
  onChange: (next: FieldOverrides) => void;
  fieldOptions: FingerprintOptionsResponse;
  effectiveOs: Os;
  effectivePlatform: string;
}): JSX.Element {
  const { t } = useTranslation();
  const platformOptions = fieldOptions.platforms.find((p) => p.os === effectiveOs) ?? fieldOptions.platforms[0]!;

  function set<K extends keyof FieldOverrides>(key: K, value: FieldOverrides[K]): void {
    onChange({ ...overrides, [key]: value });
  }

  return (
    <div className="panel mt-16">
      <h4 className="fp-heading">{t('editor.fingerprint.picker.title')}</h4>
      <p className="text-dim text-xs mt-0">{t('editor.fingerprint.picker.hint')}</p>

      <div className="fp-picker-group">
        <h5 className="fp-picker-group-title">{t('editor.fingerprint.picker.group.platform')}</h5>

        <label className="field field-narrow">
          {t('editor.fingerprint.picker.os')}
          <select
            value={overrides.os ?? AUTO}
            onChange={(e) => {
              const next = e.target.value as Os | '';
              // Changing OS invalidates any osVersion/GPU override that
              // belonged to the previous OS — clearing them back to Auto
              // rather than silently keeping a now-foreign value around.
              onChange({ ...overrides, os: next || undefined, osVersion: undefined, webglVendor: undefined, webglRenderer: undefined });
            }}
          >
            <option value={AUTO}>{t('editor.fingerprint.picker.auto')}</option>
            {fieldOptions.platforms.map((p) => (
              <option key={p.os} value={p.os}>
                {p.os === 'windows' ? 'Windows' : p.os === 'macos' ? 'macOS' : 'Linux'}
              </option>
            ))}
          </select>
        </label>

        <label className="field field-narrow">
          {t('editor.fingerprint.picker.osVersion')}
          <select value={overrides.osVersion ?? AUTO} onChange={(e) => set('osVersion', e.target.value || undefined)}>
            <option value={AUTO}>{t('editor.fingerprint.picker.auto')}</option>
            {platformOptions.osVersions.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </label>

        <p className="text-dim text-xs mb-0">
          {t('editor.fingerprint.picker.platformDerived', { platform: effectivePlatform })}
        </p>

        <label className="field field-narrow">
          {t('editor.fingerprint.picker.browserVersion')}
          <select value={overrides.browserVersion ?? AUTO} onChange={(e) => set('browserVersion', e.target.value || undefined)}>
            <option value={AUTO}>{t('editor.fingerprint.picker.auto')}</option>
            {fieldOptions.browserVersions.map((v) => (
              <option key={v} value={v}>
                Chrome {v}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="fp-picker-group">
        <h5 className="fp-picker-group-title">{t('editor.fingerprint.picker.group.hardware')}</h5>

        <label className="field field-narrow">
          {t('editor.fingerprint.picker.cpu')}
          <select
            value={overrides.hardwareConcurrency ?? AUTO}
            onChange={(e) => set('hardwareConcurrency', e.target.value ? Number(e.target.value) : undefined)}
          >
            <option value={AUTO}>{t('editor.fingerprint.picker.auto')}</option>
            {platformOptions.hardwareConcurrencyOptions.map((n) => (
              <option key={n} value={n}>
                {n} {t('editor.fingerprint.picker.cores')}
              </option>
            ))}
          </select>
        </label>

        <label className="field field-narrow">
          {t('editor.fingerprint.picker.ram')}
          <select
            value={overrides.deviceMemory ?? AUTO}
            onChange={(e) => set('deviceMemory', e.target.value ? Number(e.target.value) : undefined)}
          >
            <option value={AUTO}>{t('editor.fingerprint.picker.auto')}</option>
            {platformOptions.deviceMemoryOptions.map((n) => (
              <option key={n} value={n}>
                {n} GB
              </option>
            ))}
          </select>
        </label>

        <label className="field field-narrow">
          {t('editor.fingerprint.picker.gpu')}
          <select
            value={overrides.webglVendor ?? AUTO}
            onChange={(e) => {
              const vendor = e.target.value || undefined;
              const match = platformOptions.gpuOptions.find((g) => g.vendor === vendor);
              onChange({ ...overrides, webglVendor: vendor, webglRenderer: match?.renderer });
            }}
          >
            <option value={AUTO}>{t('editor.fingerprint.picker.auto')}</option>
            {platformOptions.gpuOptions.map((g) => (
              <option key={g.vendor} value={g.vendor}>
                {g.renderer}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="fp-picker-group">
        <h5 className="fp-picker-group-title">{t('editor.fingerprint.picker.group.display')}</h5>

        <label className="field field-narrow">
          {t('editor.fingerprint.picker.resolution')}
          <select
            value={overrides.screenWidth ? `${overrides.screenWidth}x${overrides.screenHeight}` : AUTO}
            onChange={(e) => {
              if (!e.target.value) {
                onChange({ ...overrides, screenWidth: undefined, screenHeight: undefined });
                return;
              }
              const [w, h] = e.target.value.split('x').map(Number);
              onChange({ ...overrides, screenWidth: w, screenHeight: h });
            }}
          >
            <option value={AUTO}>{t('editor.fingerprint.picker.auto')}</option>
            {platformOptions.screens.map((s) => (
              <option key={`${s.width}x${s.height}`} value={`${s.width}x${s.height}`}>
                {s.width} x {s.height}
              </option>
            ))}
          </select>
        </label>
      </div>
    </div>
  );
}
