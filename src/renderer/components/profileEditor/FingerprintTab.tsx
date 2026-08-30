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

export function FingerprintTab({
  fingerprint,
  draft,
  onDraftChange,
  manualMode,
  onManualModeChange,
  validation,
  saving,
  onRegenerate,
  onValidate,
  onSaveManual,
}: {
  fingerprint: Fingerprint;
  draft: FingerprintDraft;
  onDraftChange: (draft: FingerprintDraft) => void;
  manualMode: boolean;
  onManualModeChange: (manual: boolean) => void;
  validation: FingerprintValidationResult | null;
  saving: boolean;
  onRegenerate: () => void;
  onValidate: () => void;
  onSaveManual: () => void;
}): JSX.Element {
  const { t } = useTranslation();
  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 10, alignItems: 'center' }}>
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
        <div style={{ flex: 1 }} />
        <button className="btn btn-ghost btn-sm" onClick={onValidate}>
          {t('editor.fingerprint.validate')}
        </button>
      </div>

      {!manualMode && (
        <table>
          <tbody>
            {FIELD_ROW_KEYS.map(([labelKey, key]) => (
              <tr key={key}>
                <th style={{ width: 180 }}>{t(labelKey)}</th>
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
          <p style={{ color: 'var(--ash-dim)', fontSize: 12, marginTop: 0 }}>{t('editor.fingerprint.manualHint')}</p>
          {MANUAL_FIELD_KEYS.map(([labelKey, key]) => (
            <label key={key} style={{ display: 'block', marginBottom: 8 }}>
              {t(labelKey)}
              <input
                className="mono"
                value={draft[key]}
                onChange={(e) => onDraftChange({ ...draft, [key]: e.target.value })}
                style={{ display: 'block', width: '100%', marginTop: 4 }}
              />
            </label>
          ))}
          <label style={{ display: 'block', marginBottom: 8 }}>
            {t('editor.fingerprint.field.webrtcMode')}
            <select
              value={draft.webrtcMode}
              onChange={(e) => onDraftChange({ ...draft, webrtcMode: e.target.value })}
              style={{ display: 'block', width: '100%', marginTop: 4 }}
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

      {validation && (
        <div style={{ marginTop: 10, fontSize: 12 }}>
          <p style={{ color: validation.valid ? 'var(--lime)' : 'var(--danger)' }}>
            {validation.valid ? t('editor.fingerprint.valid') : t('editor.fingerprint.invalid')}
          </p>
          {validation.errors.map((e) => (
            <p key={e} style={{ color: 'var(--danger)' }}>
              ERROR: {e}
            </p>
          ))}
          {validation.warnings.map((w) => (
            <p key={w} style={{ color: 'var(--warn)' }}>
              WARNING: {w}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
