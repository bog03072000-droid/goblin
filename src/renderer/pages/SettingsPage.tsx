import { useEffect, useState } from 'react';
import { Languages, Gauge, HardDrive, SlidersHorizontal, ScrollText, Keyboard, CircleCheck, ShieldAlert } from 'lucide-react';
import type { Settings } from '@shared/schemas/settings';
import { callApi } from '../services/api';
import { useAsyncAction } from '../hooks/useAsyncAction';
import { useTranslation, LOCALES, type Locale } from '../i18n';

export function SettingsPage(): JSX.Element {
  const { t, locale, setLocale } = useTranslation();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [saved, setSaved] = useState(false);
  const [encryptionAvailable, setEncryptionAvailable] = useState(true);
  const { error, run } = useAsyncAction();

  useEffect(() => {
    void run(async () => {
      const s = await callApi<'settings:get', Settings>('settings:get', {});
      setSettings(s);
      const encStatus = await callApi<'security:credentialEncryptionStatus', { available: boolean }>(
        'security:credentialEncryptionStatus',
        {},
      );
      setEncryptionAvailable(encStatus.available);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function save(patch: Partial<Settings>): Promise<void> {
    await run(async () => {
      const updated = await callApi<'settings:update', Settings>('settings:update', patch);
      setSettings(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    });
  }

  function changeLanguage(next: Locale): void {
    setLocale(next);
    void save({ language: next });
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
        <p className="text-dim text-xs mt-8 mb-0">{t('settings.theme.note')}</p>
      </div>

      <div className="panel">
        <h3 className="fp-heading"><Gauge size={16} strokeWidth={2.25} />{t('settings.title.performance')}</h3>
        <label className="field-inline">
          <input
            type="checkbox"
            checked={settings.hardwareAcceleration}
            onChange={(e) => void save({ hardwareAcceleration: e.target.checked })}
          />
          {t('settings.hardwareAcceleration')}
        </label>
        <label className="field-inline">
          <input
            type="checkbox"
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
