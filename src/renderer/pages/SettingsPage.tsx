import { useEffect, useState } from 'react';
import { Languages, Gauge, HardDrive, SlidersHorizontal, ScrollText, Keyboard, CircleCheck } from 'lucide-react';
import type { Settings } from '@shared/schemas/settings';
import { callApi } from '../services/api';
import { useAsyncAction } from '../hooks/useAsyncAction';
import { useTranslation, LOCALES, type Locale } from '../i18n';

export function SettingsPage(): JSX.Element {
  const { t, locale, setLocale } = useTranslation();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [saved, setSaved] = useState(false);
  const { error, run } = useAsyncAction();

  useEffect(() => {
    void run(async () => {
      const s = await callApi<'settings:get', Settings>('settings:get', {});
      setSettings(s);
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
    <div className="content" style={{ maxWidth: 560 }}>
      {error && <div className="banner banner-error">{error}</div>}
      {saved && (
        <div className="banner banner-success" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <CircleCheck size={14} strokeWidth={2.25} />
          {t('settings.saved')}
        </div>
      )}

      <div className="panel">
        <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Languages size={16} strokeWidth={2.25} />{t('settings.title.language')}</h3>
        <label style={{ display: 'block', marginBottom: 8 }}>
          {t('settings.language.label')}
          <select
            value={locale}
            onChange={(e) => changeLanguage(e.target.value as Locale)}
            style={{ display: 'block', width: 220, marginTop: 4 }}
          >
            {LOCALES.map((l) => (
              <option key={l} value={l}>
                {t(`settings.language.${l}` as 'settings.language.uk' | 'settings.language.en')}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="panel">
        <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Gauge size={16} strokeWidth={2.25} />{t('settings.title.performance')}</h3>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <input
            type="checkbox"
            checked={settings.hardwareAcceleration}
            onChange={(e) => void save({ hardwareAcceleration: e.target.checked })}
          />
          {t('settings.hardwareAcceleration')}
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <input
            type="checkbox"
            checked={settings.autoCacheCleanup}
            onChange={(e) => void save({ autoCacheCleanup: e.target.checked })}
          />
          {t('settings.autoCacheCleanup')}
        </label>
        <label style={{ display: 'block', marginBottom: 4 }}>
          {t('settings.maxConcurrentLaunches')}
          <input
            type="number"
            min={1}
            max={20}
            value={settings.maxConcurrentLaunches}
            onChange={(e) => void save({ maxConcurrentLaunches: Number(e.target.value) })}
            style={{ display: 'block', width: 160, marginTop: 4 }}
          />
        </label>
        <div style={{ color: 'var(--ash-dim)', fontSize: 12, maxWidth: 440, marginBottom: 8 }}>
          {t('settings.maxConcurrentLaunches.description')}
        </div>
        {settings.maxConcurrentLaunches > 4 && (
          <div className="banner banner-warn" style={{ maxWidth: 440 }}>
            {t('settings.maxConcurrentLaunches.ramWarning')}
          </div>
        )}
      </div>

      <div className="panel">
        <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}><HardDrive size={16} strokeWidth={2.25} />{t('settings.title.storage')}</h3>
        <label style={{ display: 'block', marginBottom: 8 }}>
          {t('settings.cacheLimitMb')}
          <input
            type="number"
            value={settings.cacheLimitMb}
            onChange={(e) => void save({ cacheLimitMb: Number(e.target.value) })}
            style={{ display: 'block', width: 160, marginTop: 4 }}
          />
        </label>
      </div>

      <div className="panel">
        <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}><SlidersHorizontal size={16} strokeWidth={2.25} />{t('settings.title.general')}</h3>
        <label style={{ display: 'block', marginBottom: 8 }}>
          {t('settings.startupBehavior')}
          <select
            value={settings.startupBehavior}
            onChange={(e) => void save({ startupBehavior: e.target.value as Settings['startupBehavior'] })}
            style={{ display: 'block', width: 220, marginTop: 4 }}
          >
            <option value="showProfileList">{t('settings.startupBehavior.showProfileList')}</option>
            <option value="blank">{t('settings.startupBehavior.blank')}</option>
            <option value="lastSession">{t('settings.startupBehavior.lastSession')}</option>
          </select>
        </label>
      </div>

      <div className="panel">
        <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}><ScrollText size={16} strokeWidth={2.25} />{t('settings.title.logging')}</h3>
        <label style={{ display: 'block', marginBottom: 8 }}>
          {t('settings.logRetentionDays')}
          <input
            type="number"
            value={settings.logRetentionDays}
            onChange={(e) => void save({ logRetentionDays: Number(e.target.value) })}
            style={{ display: 'block', width: 160, marginTop: 4 }}
          />
        </label>
      </div>

      <div className="panel">
        <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Keyboard size={16} strokeWidth={2.25} />{t('settings.title.help')}</h3>
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
                <th style={{ width: 100 }} className="mono">
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
