import type { Fingerprint, FingerprintValidationResult, FingerprintOptionsResponse } from '@shared/schemas/fingerprint';
import { useTranslation, type TranslationKey } from '../../i18n';
import { FieldOverridesPicker, type FieldOverrides } from './FieldOverridesPicker';

export type { FieldOverrides };

/** Same four field-categories FieldOverridesPicker groups its selects into
 * (Platform/Hardware/Display), plus two more this read-only view also
 * covers that the picker doesn't touch (Identity & Locale, Privacy &
 * Spoofing) — kept as separate cards instead of one 21-row table so the
 * read-only Auto-mode view and the explicit-selection picker read as the
 * same design language, not two different UIs bolted together. */
export const FIELD_GROUPS: Array<{
  titleKey: TranslationKey;
  rows: Array<[TranslationKey, keyof Fingerprint]>;
}> = [
  {
    titleKey: 'editor.fingerprint.picker.group.platform',
    rows: [
      ['editor.fingerprint.row.os', 'os'],
      ['editor.fingerprint.row.osVersion', 'osVersion'],
      ['editor.fingerprint.row.browserVersion', 'browserVersion'],
      ['editor.fingerprint.field.platform', 'platform'],
      ['editor.fingerprint.field.userAgent', 'userAgent'],
      ['editor.fingerprint.row.seed', 'seed'],
    ],
  },
  {
    titleKey: 'editor.fingerprint.group.identity',
    rows: [
      ['editor.fingerprint.field.locale', 'locale'],
      ['editor.fingerprint.field.languages', 'languages'],
      ['editor.fingerprint.field.timezone', 'timezone'],
    ],
  },
  {
    titleKey: 'editor.fingerprint.picker.group.hardware',
    rows: [
      ['editor.fingerprint.field.hardwareConcurrency', 'hardwareConcurrency'],
      ['editor.fingerprint.row.deviceMemory', 'deviceMemory'],
      ['editor.fingerprint.row.webglVendor', 'webglVendor'],
      ['editor.fingerprint.row.webglRenderer', 'webglRenderer'],
    ],
  },
  {
    titleKey: 'editor.fingerprint.picker.group.display',
    rows: [
      ['editor.fingerprint.field.screenWidth', 'screenWidth'],
      ['editor.fingerprint.field.deviceScaleFactor', 'deviceScaleFactor'],
    ],
  },
  {
    titleKey: 'editor.fingerprint.group.privacy',
    rows: [
      ['editor.fingerprint.row.canvasMode', 'canvasMode'],
      ['editor.fingerprint.row.audioMode', 'audioMode'],
      ['editor.fingerprint.field.webrtcMode', 'webrtcMode'],
      ['editor.fingerprint.row.fontsMode', 'fontsMode'],
      ['editor.fingerprint.row.mediaDevicesMode', 'mediaDevicesMode'],
      ['editor.fingerprint.spoofing.webglLabel', 'webglSpoofingMode'],
      ['editor.fingerprint.spoofing.geolocationLabel', 'geolocationMode'],
      ['editor.fingerprint.spoofing.permissionsLabel', 'permissionsMode'],
    ],
  },
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
  Pick<
    Fingerprint,
    'canvasMode' | 'audioMode' | 'fontsMode' | 'mediaDevicesMode' | 'webglSpoofingMode' | 'geolocationMode' | 'permissionsMode'
  >
>;

/** What a live-loaded copy of `fingerprint`/`draft` — whichever is currently
 * "in effect" — actually presents to a website's own JS (navigator.*,
 * screen.*, the User-Agent header, etc.), rendered before Regenerate/Save so
 * a change can be reviewed in these terms instead of only as raw field
 * values. In MANUAL mode this reflects the still-unsaved draft for the
 * fields it covers; fields the manual form doesn't expose (WebGL
 * vendor/renderer, spoofing modes, ...) always come from the last-saved
 * `fingerprint`, since editing them isn't possible until after Save anyway. */
function buildSitePreview(
  fingerprint: Fingerprint,
  manualMode: boolean,
  draft: FingerprintDraft,
): {
  userAgent: string;
  platform: string;
  screen: string;
  languages: string;
  timezone: string;
  hardwareConcurrency: string;
  webrtcMode: string;
} {
  return {
    userAgent: manualMode ? draft.userAgent : fingerprint.userAgent,
    platform: manualMode ? draft.platform : fingerprint.platform,
    screen: manualMode
      ? `${draft.screenWidth} x ${draft.screenHeight} @ ${draft.deviceScaleFactor}x`
      : `${fingerprint.screenWidth} x ${fingerprint.screenHeight} @ ${fingerprint.deviceScaleFactor}x`,
    languages: manualMode ? draft.languages : fingerprint.languages.join(', '),
    timezone: manualMode ? draft.timezone : fingerprint.timezone,
    hardwareConcurrency: manualMode ? draft.hardwareConcurrency : String(fingerprint.hardwareConcurrency),
    webrtcMode: manualMode ? draft.webrtcMode : fingerprint.webrtcMode,
  };
}

const PROTECTION_PILLS: Array<{
  labelKey: TranslationKey;
  active: (fp: Fingerprint) => boolean;
}> = [
  { labelKey: 'editor.fingerprint.row.canvasMode', active: (fp) => fp.canvasMode !== 'off' },
  { labelKey: 'editor.fingerprint.row.audioMode', active: (fp) => fp.audioMode !== 'off' },
  { labelKey: 'editor.fingerprint.row.fontsMode', active: (fp) => fp.fontsMode !== 'system' },
  { labelKey: 'editor.fingerprint.row.mediaDevicesMode', active: (fp) => fp.mediaDevicesMode !== 'real' },
  { labelKey: 'editor.fingerprint.spoofing.webglLabel', active: (fp) => fp.webglSpoofingMode !== 'off' },
  { labelKey: 'editor.fingerprint.spoofing.geolocationLabel', active: (fp) => fp.geolocationMode !== 'real' },
];

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
  const sitePreview = buildSitePreview(fingerprint, manualMode, draft);
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

      <div className="panel fp-preview" data-testid="fp-site-preview">
        <h5 className="fp-picker-group-title">{t('editor.fingerprint.preview.title')}</h5>
        <table>
          <tbody>
            <tr>
              <th className="w-180">{t('editor.fingerprint.field.userAgent')}</th>
              <td className="mono fp-preview-ua">{sitePreview.userAgent}</td>
            </tr>
            <tr>
              <th>{t('editor.fingerprint.field.platform')}</th>
              <td className="mono">{sitePreview.platform}</td>
            </tr>
            <tr>
              <th>{t('editor.fingerprint.preview.screen')}</th>
              <td className="mono">{sitePreview.screen}</td>
            </tr>
            <tr>
              <th>{t('editor.fingerprint.field.languages')}</th>
              <td className="mono">{sitePreview.languages}</td>
            </tr>
            <tr>
              <th>{t('editor.fingerprint.field.timezone')}</th>
              <td className="mono">{sitePreview.timezone}</td>
            </tr>
            <tr>
              <th>{t('editor.fingerprint.field.hardwareConcurrency')}</th>
              <td className="mono">{sitePreview.hardwareConcurrency}</td>
            </tr>
            <tr>
              <th>{t('editor.fingerprint.field.webrtcMode')}</th>
              <td className="mono">{sitePreview.webrtcMode}</td>
            </tr>
          </tbody>
        </table>
        <div className="fp-preview-pills">
          {PROTECTION_PILLS.map(({ labelKey, active }) => {
            const isActive = active(fingerprint);
            return (
              <span key={labelKey} className={`pill ${isActive ? 'on' : 'idle'}`}>
                {t(labelKey)}: {isActive ? t('editor.fingerprint.preview.protected') : t('editor.fingerprint.preview.real')}
              </span>
            );
          })}
        </div>
      </div>

      {!manualMode && (
        <div className="fp-card-grid">
          {FIELD_GROUPS.map((group) => (
            <div key={group.titleKey} className="panel fp-field-card">
              <h5 className="fp-picker-group-title">{t(group.titleKey)}</h5>
              <table>
                <tbody>
                  {group.rows.map(([labelKey, key]) => (
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
            </div>
          ))}
        </div>
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
        <label className="block">
          {t('editor.fingerprint.spoofing.geolocationLabel')}
          <select
            value={fingerprint.geolocationMode}
            onChange={(e) => onUpdateSpoofing({ geolocationMode: e.target.value as Fingerprint['geolocationMode'] })}
            title={t('editor.fingerprint.spoofing.geolocationTooltip')}
          >
            <option value="real">{t('editor.fingerprint.spoofing.geolocationReal')}</option>
            <option value="spoof">{t('editor.fingerprint.spoofing.geolocationSpoof')}</option>
            <option value="blocked">{t('editor.fingerprint.spoofing.geolocationBlocked')}</option>
          </select>
        </label>
        <label className="block">
          {t('editor.fingerprint.spoofing.permissionsLabel')}
          <select
            value={fingerprint.permissionsMode}
            onChange={(e) => onUpdateSpoofing({ permissionsMode: e.target.value as Fingerprint['permissionsMode'] })}
            title={t('editor.fingerprint.spoofing.permissionsTooltip')}
          >
            <option value="real">{t('editor.fingerprint.spoofing.permissionsReal')}</option>
            <option value="deny-all">{t('editor.fingerprint.spoofing.permissionsDenyAll')}</option>
          </select>
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
