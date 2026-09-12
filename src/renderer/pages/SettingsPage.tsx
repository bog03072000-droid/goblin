import { useEffect, useState } from 'react';
import { Languages, Gauge, HardDrive, SlidersHorizontal, ScrollText, Keyboard, CircleCheck, ShieldAlert, ShieldCheck, Copy, RefreshCw, Globe } from 'lucide-react';
import type { Settings } from '@shared/schemas/settings';
import { callApi } from '../services/api';
import { useAsyncAction } from '../hooks/useAsyncAction';
import { useTranslation, LOCALES, type Locale } from '../i18n';
import { applyTheme } from '../theme';

export function SettingsPage(): JSX.Element {
  const { t, locale, setLocale } = useTranslation();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [saved, setSaved] = useState(false);
  const [encryptionAvailable, setEncryptionAvailable] = useState(true);
  const [restApiToken, setRestApiToken] = useState<string | null>(null);
  const [restApiRunning, setRestApiRunning] = useState(false);
  const [copied, setCopied] = useState<'token' | 'snippet' | null>(null);
  const { error, run } = useAsyncAction();

  async function refreshRestApiStatus(): Promise<void> {
    const { token } = await callApi<'restApi:getToken', { token: string | null }>('restApi:getToken', {});
    setRestApiToken(token);
    const { running } = await callApi<'restApi:getStatus', { running: boolean }>('restApi:getStatus', {});
    setRestApiRunning(running);
  }

  useEffect(() => {
    void run(async () => {
      const s = await callApi<'settings:get', Settings>('settings:get', {});
      setSettings(s);
      const encStatus = await callApi<'security:credentialEncryptionStatus', { available: boolean }>(
        'security:credentialEncryptionStatus',
        {},
      );
      setEncryptionAvailable(encStatus.available);
      await refreshRestApiStatus();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function copy(value: string, what: 'token' | 'snippet'): void {
    void navigator.clipboard.writeText(value).then(() => {
      setCopied(what);
      setTimeout(() => setCopied(null), 1500);
    });
  }

  async function regenerateRestApiToken(): Promise<void> {
    await run(async () => {
      const { token } = await callApi<'restApi:regenerateToken', { token: string }>('restApi:regenerateToken', {});
      setRestApiToken(token);
      await refreshRestApiStatus();
    });
  }

  async function save(patch: Partial<Settings>): Promise<void> {
    await run(async () => {
      const updated = await callApi<'settings:update', Settings>('settings:update', patch);
      setSettings(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
      // Toggling restApiEnabled or changing restApiPort takes effect
      // immediately in the main process (RestApiManager.sync(), called from
      // the settings:update handler) — refresh here so the running/token
      // state shown on this page never lags behind what's actually live.
      if ('restApiEnabled' in patch || 'restApiPort' in patch) await refreshRestApiStatus();
    });
  }

  function changeLanguage(next: Locale): void {
    setLocale(next);
    void save({ language: next });
  }

  function changeTheme(next: Settings['theme']): void {
    applyTheme(next);
    void save({ theme: next });
  }

  if (!settings) return <div className="content">{t('common.loading')}</div>;

  return (
    <div className="content settings-content">
      {error && <div className="banner banner-error">{error}</div>}
      {saved && (
        <div className="banner banner-success fp-heading">
          <CircleCheck size={14} strokeWidth={2.25} />
          {t('settings.saved')}
        </div>
      )}
      {!encryptionAvailable && (
        <div className="banner banner-warn fp-heading" title={t('settings.encryptionWarning.tooltip')}>
          <ShieldAlert size={14} strokeWidth={2.25} />
          {t('settings.encryptionWarning')}
        </div>
      )}

      <div className="panel">
        <h3 className="fp-heading"><Languages size={16} strokeWidth={2.25} />{t('settings.title.language')}</h3>
        <label className="field">
          {t('settings.language.label')}
          <select
            value={locale}
            onChange={(e) => changeLanguage(e.target.value as Locale)}
            className="field-input-220"
          >
            {LOCALES.map((l) => (
              <option key={l} value={l}>
                {t(`settings.language.${l}` as 'settings.language.uk' | 'settings.language.en')}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          {t('settings.theme.label')}
          <select
            value={settings.theme}
            onChange={(e) => changeTheme(e.target.value as Settings['theme'])}
            className="field-input-220"
          >
            <option value="system">{t('settings.theme.system')}</option>
            <option value="light">{t('settings.theme.light')}</option>
            <option value="dark">{t('settings.theme.dark')}</option>
          </select>
        </label>
      </div>

      <div className="panel">
        <h3 className="fp-heading"><Gauge size={16} strokeWidth={2.25} />{t('settings.title.performance')}</h3>
        <label className="field-inline">
          <input
            type="checkbox"
            className="toggle"
            checked={settings.hardwareAcceleration}
            onChange={(e) => void save({ hardwareAcceleration: e.target.checked })}
          />
          {t('settings.hardwareAcceleration')}
        </label>
        <label className="field-inline">
          <input
            type="checkbox"
            className="toggle"
            checked={settings.autoCacheCleanup}
            onChange={(e) => void save({ autoCacheCleanup: e.target.checked })}
          />
          {t('settings.autoCacheCleanup')}
        </label>
        <label className="field-narrow">
          {t('settings.maxConcurrentLaunches')}
          <input
            type="number"
            min={1}
            max={20}
            value={settings.maxConcurrentLaunches}
            onChange={(e) => void save({ maxConcurrentLaunches: Number(e.target.value) })}
            className="field-input-160"
          />
        </label>
        <div className="settings-description">
          {t('settings.maxConcurrentLaunches.description')}
        </div>
        {settings.maxConcurrentLaunches > 4 && (
          <div className="banner banner-warn banner-maxw440">
            {t('settings.maxConcurrentLaunches.ramWarning')}
          </div>
        )}
      </div>

      <div className="panel">
        <h3 className="fp-heading"><HardDrive size={16} strokeWidth={2.25} />{t('settings.title.storage')}</h3>
        <label className="field">
          {t('settings.cacheLimitMb')}
          <input
            type="number"
            value={settings.cacheLimitMb}
            onChange={(e) => void save({ cacheLimitMb: Number(e.target.value) })}
            className="field-input-160"
          />
        </label>
      </div>

      <div className="panel">
        <h3 className="fp-heading"><SlidersHorizontal size={16} strokeWidth={2.25} />{t('settings.title.general')}</h3>
        <label className="field">
          {t('settings.startupBehavior')}
          <select
            value={settings.startupBehavior}
            onChange={(e) => void save({ startupBehavior: e.target.value as Settings['startupBehavior'] })}
            className="field-input-220"
          >
            <option value="showProfileList">{t('settings.startupBehavior.showProfileList')}</option>
            <option value="blank">{t('settings.startupBehavior.blank')}</option>
            <option value="lastSession">{t('settings.startupBehavior.lastSession')}</option>
          </select>
        </label>
      </div>

      <div className="panel">
        <h3 className="fp-heading"><ShieldCheck size={16} strokeWidth={2.25} />{t('settings.title.automation')}</h3>
        <label className="field field-narrow">
          {t('settings.defaultAutomationPort')}
          <input
            className="mono field-input-160"
            type="number"
            min={1024}
            max={65535}
            value={settings.defaultAutomationPort ?? ''}
            onChange={(e) => void save({ defaultAutomationPort: e.target.value ? Number(e.target.value) : null })}
          />
        </label>
        <p className="text-dim text-xs mb-0">{t('settings.defaultAutomationPort.hint')}</p>
      </div>

      <div className="panel">
        <h3 className="fp-heading"><Globe size={16} strokeWidth={2.25} />{t('settings.title.restApi')}</h3>
        <p className="text-dim text-xs">{t('settings.restApi.hint')}</p>
        <label className="field">
          <span className="inline-flex" style={{ alignItems: 'center', gap: 8 }}>
            <input
              type="checkbox"
              checked={settings.restApiEnabled}
              onChange={(e) => void save({ restApiEnabled: e.target.checked })}
            />
            {t('settings.restApi.enable')}
          </span>
        </label>
        {settings.restApiEnabled && (
          <>
            <label className="field field-narrow">
              {t('settings.restApi.port')}
              <input
                className="mono field-input-160"
                type="number"
                min={1024}
                max={65535}
                value={settings.restApiPort ?? ''}
                onChange={(e) => void save({ restApiPort: e.target.value ? Number(e.target.value) : null })}
              />
            </label>
            <p className="text-dim text-xs">
              {restApiRunning ? t('settings.restApi.statusRunning') : t('settings.restApi.statusStopped')}
            </p>
            <label className="field">
              {t('settings.restApi.token')}
              <div className="inline-flex" style={{ alignItems: 'center', gap: 8 }}>
                <input className="mono" readOnly value={restApiToken ?? ''} style={{ width: 340 }} />
                <button
                  className="btn btn-ghost btn-sm"
                  type="button"
                  onClick={() => restApiToken && copy(restApiToken, 'token')}
                  title={t('editor.advanced.automation.copyToken')}
                >
                  <Copy size={14} />
                  {copied === 'token' ? t('common.copied') : t('common.copy')}
                </button>
                <button
                  className="btn btn-danger-ghost btn-sm"
                  type="button"
                  onClick={() => void regenerateRestApiToken()}
                  title={t('editor.advanced.automation.regenerateHint')}
                >
                  <RefreshCw size={14} />
                  {t('editor.advanced.automation.regenerate')}
                </button>
              </div>
            </label>
            {settings.restApiPort && restApiToken && (
              <label className="field">
                {t('settings.restApi.exampleLabel')}
                <div className="inline-flex" style={{ alignItems: 'center', gap: 8 }}>
                  <input
                    className="mono"
                    readOnly
                    style={{ width: 460 }}
                    value={`curl http://127.0.0.1:${settings.restApiPort}/profiles?token=${restApiToken}`}
                  />
                  <button
                    className="btn btn-ghost btn-sm"
                    type="button"
                    onClick={() =>
                      copy(`curl http://127.0.0.1:${settings.restApiPort}/profiles?token=${restApiToken}`, 'snippet')
                    }
                  >
                    <Copy size={14} />
                    {copied === 'snippet' ? t('common.copied') : t('common.copy')}
                  </button>
                </div>
              </label>
            )}
          </>
        )}
      </div>

      <div className="panel">
        <h3 className="fp-heading"><ScrollText size={16} strokeWidth={2.25} />{t('settings.title.logging')}</h3>
        <label className="field">
          {t('settings.logRetentionDays')}
          <input
            type="number"
            value={settings.logRetentionDays}
            onChange={(e) => void save({ logRetentionDays: Number(e.target.value) })}
            className="field-input-160"
          />
        </label>
      </div>

      <div className="panel">
        <h3 className="fp-heading"><Keyboard size={16} strokeWidth={2.25} />{t('settings.title.help')}</h3>
        <table>
          <tbody>
            {(
              [
                ['Ctrl+N', 'help.shortcut.createProfile'],
                ['Ctrl+F', 'help.shortcut.search'],
                ['Ctrl+A', 'help.shortcut.selectAll'],
                ['Delete', 'help.shortcut.deleteSelected'],
                ['Enter', 'help.shortcut.openSelected'],
              ] as const
            ).map(([keys, key]) => (
              <tr key={keys}>
                <th className="mono shortcut-key-col">
                  {keys}
                </th>
                <td>{t(key)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
