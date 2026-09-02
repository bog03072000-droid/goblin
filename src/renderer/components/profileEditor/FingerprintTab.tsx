import type { Fingerprint, FingerprintValidationResult, FingerprintOptionsResponse, Os } from '@shared/schemas/fingerprint';
import { useTranslation, type TranslationKey } from '../../i18n';

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
 * offered and then silently ignored. */
function FieldOverridesPicker({
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
  );
}

export const FIELD_ROW_KEYS: Array<[TranslationKey, keyof Fingerprint]> = [
  ['editor.fingerprint.row.os', 'os'],
  ['editor.fingerprint.row.osVersion', 'osVersion'],
  ['editor.fingerprint.row.browserVersion', 'browserVersion'],
  ['editor.fingerprint.field.platform', 'platform'],
  ['editor.fingerprint.field.userAgent', 'userAgent'],
  ['editor.fingerprint.field.locale', 'locale'],
  ['editor.fingerprint.field.languages', 'languages'],
  ['editor.fingerprint.field.timezone', 'timezone'],
  ['editor.fingerprint.field.screenWidth', 'screenWidth'],
  ['editor.fingerprint.field.deviceScaleFactor', 'deviceScaleFactor'],
  ['editor.fingerprint.field.hardwareConcurrency', 'hardwareConcurrency'],
  ['editor.fingerprint.row.deviceMemory', 'deviceMemory'],
  ['editor.fingerprint.row.webglVendor', 'webglVendor'],
  ['editor.fingerprint.row.webglRenderer', 'webglRenderer'],
  ['editor.fingerprint.row.canvasMode', 'canvasMode'],
  ['editor.fingerprint.row.audioMode', 'audioMode'],
  ['editor.fingerprint.field.webrtcMode', 'webrtcMode'],
  ['editor.fingerprint.row.fontsMode', 'fontsMode'],
  ['editor.fingerprint.row.mediaDevicesMode', 'mediaDevicesMode'],
  ['editor.fingerprint.spoofing.webglLabel', 'webglSpoofingMode'],
  ['editor.fingerprint.row.seed', 'seed'],
];

export type FingerprintDraft = {
  userAgent: string;
  platform: string;
  locale: string;
  languages: string;
  timezone: string;
  screenWidth: string;
  screenHeight: string;
  deviceScaleFactor: string;
  hardwareConcurrency: string;
  webrtcMode: string;
};

const MANUAL_FIELD_KEYS: Array<
  [TranslationKey, 'userAgent' | 'platform' | 'locale' | 'languages' | 'timezone' | 'screenWidth' | 'screenHeight' | 'deviceScaleFactor' | 'hardwareConcurrency']
> = [
  ['editor.fingerprint.field.userAgent', 'userAgent'],
  ['editor.fingerprint.field.platform', 'platform'],
  ['editor.fingerprint.field.locale', 'locale'],
  ['editor.fingerprint.field.languages', 'languages'],
  ['editor.fingerprint.field.timezone', 'timezone'],
  ['editor.fingerprint.field.screenWidth', 'screenWidth'],
  ['editor.fingerprint.field.screenHeight', 'screenHeight'],
  ['editor.fingerprint.field.deviceScaleFactor', 'deviceScaleFactor'],
  ['editor.fingerprint.field.hardwareConcurrency', 'hardwareConcurrency'],
];

export type SpoofingPatch = Partial<
  Pick<Fingerprint, 'canvasMode' | 'audioMode' | 'fontsMode' | 'mediaDevicesMode' | 'webglSpoofingMode'>
>;

export function FingerprintTab({
  fingerprint,
  draft,
  onDraftChange,
  manualMode,
  onManualModeChange,
  validation,
  saving,
  spoofingSaving,
  onRegenerate,
  onValidate,
  onSaveManual,
  onUpdateSpoofing,
  fieldOptions,
  overrides,
  onOverridesChange,
}: {
  fingerprint: Fingerprint;
  draft: FingerprintDraft;
  onDraftChange: (draft: FingerprintDraft) => void;
  manualMode: boolean;
  onManualModeChange: (manual: boolean) => void;
  validation: FingerprintValidationResult | null;
  saving: boolean;
  spoofingSaving: boolean;
  onRegenerate: () => void;
  onValidate: () => void;
  onSaveManual: () => void;
  onUpdateSpoofing: (patch: SpoofingPatch) => void;
  /** Optional: the explicit field-selection picker only renders when both
   * are provided. Callers not yet wired up to it (there are none left in
   * this codebase, but keeping this optional avoids a hard break for any
   * future direct consumer) just don't get the picker. */
  fieldOptions?: FingerprintOptionsResponse | null;
  overrides?: FieldOverrides;
  onOverridesChange?: (next: FieldOverrides) => void;
}): JSX.Element {
  const { t } = useTranslation();
  return (
    <div>
      <div className="fp-toolbar">
        <button className={`btn btn-sm ${!manualMode ? 'btn-primary' : 'btn-ghost'}`} onClick={() => onManualModeChange(false)}>
          {t('editor.fingerprint.auto')}
        </button>
        <button className={`btn btn-sm ${manualMode ? 'btn-primary' : 'btn-ghost'}`} onClick={() => onManualModeChange(true)}>
          {t('editor.fingerprint.manual')}
        </button>
        {!manualMode && (
          <button className="btn btn-ghost btn-sm" onClick={onRegenerate}>
            {t('editor.fingerprint.regenerate')}
          </button>
        )}
        <div className="flex-1" />
        <button className="btn btn-ghost btn-sm" onClick={onValidate}>
          {t('editor.fingerprint.validate')}
        </button>
      </div>

      {!manualMode && (
        <table>
          <tbody>
            {FIELD_ROW_KEYS.map(([labelKey, key]) => (
              <tr key={key}>
                <th className="w-180">{t(labelKey)}</th>
                <td className="mono">
                  {key === 'languages'
                    ? fingerprint.languages.join(', ')
                    : key === 'screenWidth'
                      ? `${fingerprint.screenWidth} x ${fingerprint.screenHeight}`
                      : String(fingerprint[key])}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {!manualMode && fieldOptions && overrides !== undefined && onOverridesChange && (
        <FieldOverridesPicker
          overrides={overrides}
          onChange={onOverridesChange}
          fieldOptions={fieldOptions}
          effectiveOs={overrides.os ?? fingerprint.os}
          effectivePlatform={fingerprint.platform}
        />
      )}

      {manualMode && (
        <div>
          <p className="text-dim text-sm mt-0">{t('editor.fingerprint.manualHint')}</p>
          {MANUAL_FIELD_KEYS.map(([labelKey, key]) => (
            <label key={key} className="field">
              {t(labelKey)}
              <input
                className="mono"
                value={draft[key]}
                onChange={(e) => onDraftChange({ ...draft, [key]: e.target.value })}
              />
            </label>
          ))}
          <label className="field">
            {t('editor.fingerprint.field.webrtcMode')}
            <select
              value={draft.webrtcMode}
              onChange={(e) => onDraftChange({ ...draft, webrtcMode: e.target.value })}
            >
              <option value="default">{t('editor.fingerprint.webrtc.default')}</option>
              <option value="proxy-only">{t('editor.fingerprint.webrtc.proxyOnly')}</option>
              <option value="disabled">{t('editor.fingerprint.webrtc.disabled')}</option>
            </select>
          </label>
          <button className="btn btn-primary" disabled={saving} onClick={onSaveManual}>
            {saving && <span className="spinner" />}
            {t('common.save')}
          </button>
        </div>
      )}

      <div className="panel mt-16">
        <h4 className="fp-heading">
          {t('editor.fingerprint.spoofing.title')}
          {spoofingSaving && <span className="spinner" />}
        </h4>
        <label className="field">
          {t('editor.fingerprint.row.canvasMode')}
          <select
            value={fingerprint.canvasMode}
            onChange={(e) => onUpdateSpoofing({ canvasMode: e.target.value as Fingerprint['canvasMode'] })}
            title={t('editor.fingerprint.spoofing.canvasTooltip')}
          >
            <option value="off">{t('editor.fingerprint.spoofing.off')}</option>
            <option value="noise">{t('editor.fingerprint.spoofing.noise')}</option>
          </select>
        </label>
        <label className="field">
          {t('editor.fingerprint.row.audioMode')}
          <select
            value={fingerprint.audioMode}
            onChange={(e) => onUpdateSpoofing({ audioMode: e.target.value as Fingerprint['audioMode'] })}
            title={t('editor.fingerprint.spoofing.audioTooltip')}
          >
            <option value="off">{t('editor.fingerprint.spoofing.off')}</option>
            <option value="noise">{t('editor.fingerprint.spoofing.noise')}</option>
          </select>
        </label>
        <label className="field">
          {t('editor.fingerprint.row.fontsMode')}
          <select
            value={fingerprint.fontsMode}
            onChange={(e) => onUpdateSpoofing({ fontsMode: e.target.value as Fingerprint['fontsMode'] })}
            title={t('editor.fingerprint.spoofing.fontsHint')}
          >
            <option value="system">{t('editor.fingerprint.spoofing.fontsSystem')}</option>
            <option value="restricted">{t('editor.fingerprint.spoofing.fontsRestricted')}</option>
          </select>
          <p className="text-dim text-xs mt-4 mb-0">
            {t('editor.fingerprint.spoofing.fontsHint')}
          </p>
        </label>
        <label className="field">
          {t('editor.fingerprint.row.mediaDevicesMode')}
          <select
            value={fingerprint.mediaDevicesMode}
            onChange={(e) => onUpdateSpoofing({ mediaDevicesMode: e.target.value as Fingerprint['mediaDevicesMode'] })}
            title={t('editor.fingerprint.spoofing.mediaTooltip')}
          >
            <option value="real">{t('editor.fingerprint.spoofing.mediaReal')}</option>
            <option value="hidden">{t('editor.fingerprint.spoofing.mediaHidden')}</option>
          </select>
        </label>
        <label className="block">
          {t('editor.fingerprint.spoofing.webglLabel')}
          <select
            value={fingerprint.webglSpoofingMode}
            onChange={(e) => onUpdateSpoofing({ webglSpoofingMode: e.target.value as Fingerprint['webglSpoofingMode'] })}
            title={t('editor.fingerprint.spoofing.webglTooltip')}
          >
            <option value="off">{t('editor.fingerprint.spoofing.off')}</option>
            <option value="spoof">{t('editor.fingerprint.spoofing.webglSpoof')}</option>
          </select>
          {fingerprint.webglSpoofingMode === 'spoof' && (
            <div className="banner banner-warn mt-8 mb-0 text-xs">
              {t('editor.fingerprint.spoofing.webglWarning')}
            </div>
          )}
        </label>
      </div>

      {validation && (
        <div className="mt-10 text-sm">
          <p className={validation.valid ? 'text-valid' : 'text-invalid'}>
            {validation.valid ? t('editor.fingerprint.valid') : t('editor.fingerprint.invalid')}
          </p>
          {validation.errors.map((e) => (
            <p key={e} className="text-invalid">
              ERROR: {e}
            </p>
          ))}
          {validation.warnings.map((w) => (
            <p key={w} className="text-warn">
              WARNING: {w}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
