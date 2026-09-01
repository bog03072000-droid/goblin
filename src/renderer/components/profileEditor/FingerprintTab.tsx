import type { Fingerprint, FingerprintValidationResult } from '@shared/schemas/fingerprint';
import { useTranslation, type TranslationKey } from '../../i18n';

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
