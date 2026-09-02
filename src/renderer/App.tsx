import { useEffect, useState } from 'react';
import { Users, Globe, Download, ScrollText, Settings as SettingsIcon } from 'lucide-react';
import { ProfilesPage } from './pages/ProfilesPage';
import { ProxiesPage } from './pages/ProxiesPage';
import { DownloadsPage } from './pages/DownloadsPage';
import { LogsPage } from './pages/LogsPage';
import { SettingsPage } from './pages/SettingsPage';
import { I18nProvider, useTranslation, DEFAULT_LOCALE, type Locale } from './i18n';
import { callApi } from './services/api';
import type { Settings } from '@shared/schemas/settings';
import goblinLogo from './assets/goblin-logo.png';

type Page = 'profiles' | 'proxies' | 'downloads' | 'logs' | 'settings';

/** Loads the persisted language before rendering the real app, so the UI
 * never flashes in the wrong language and the choice survives a restart. */
export function App(): JSX.Element | null {
  const [locale, setLocale] = useState<Locale | null>(null);

  useEffect(() => {
    void callApi<'settings:get', Settings>('settings:get', {}).then((s) => setLocale(s.language));
  }, []);

  if (locale === null) return null;

  const handleLocaleChange = (next: Locale): void => {
    setLocale(next);
    void callApi('settings:update', { language: next });
  };

  return (
    <I18nProvider initialLocale={locale ?? DEFAULT_LOCALE} onLocaleChange={handleLocaleChange}>
      <AppShell />
    </I18nProvider>
  );
}

function AppShell(): JSX.Element {
  const [page, setPage] = useState<Page>('profiles');
  const [updateVersion, setUpdateVersion] = useState<string | null>(null);
  const { t } = useTranslation();

  useEffect(() => {
    window.profileforge.onUpdateAvailable((info) => setUpdateVersion(info.version));
  }, []);

  return (
    <>
      <div className="sidebar">
        <div className="sidebar-brand">
          <img src={goblinLogo} alt="GoblinAnty" width="28" height="28" className="brand-logo" />
          <span className="sidebar-brand-name">GoblinAnty</span>
        </div>
        <div className={`sidebar-item ${page === 'profiles' ? 'active' : ''}`} onClick={() => setPage('profiles')}>
          <Users size={16} strokeWidth={2} />
          {t('app.sidebar.profiles')}
        </div>
        <div className={`sidebar-item ${page === 'proxies' ? 'active' : ''}`} onClick={() => setPage('proxies')}>
          <Globe size={16} strokeWidth={2} />
          {t('app.sidebar.proxies')}
        </div>
        <div className={`sidebar-item ${page === 'downloads' ? 'active' : ''}`} onClick={() => setPage('downloads')}>
          <Download size={16} strokeWidth={2} />
          {t('app.sidebar.downloads')}
        </div>
        <div className={`sidebar-item ${page === 'logs' ? 'active' : ''}`} onClick={() => setPage('logs')}>
          <ScrollText size={16} strokeWidth={2} />
          {t('app.sidebar.logs')}
        </div>
        <div className={`sidebar-item ${page === 'settings' ? 'active' : ''}`} onClick={() => setPage('settings')}>
          <SettingsIcon size={16} strokeWidth={2} />
          {t('app.sidebar.settings')}
        </div>
      </div>
      <div className="main">
        {updateVersion && (
          <div className="banner banner-success update-banner">
            <span className="flex-1">{t('app.updateAvailable', { version: updateVersion })}</span>
            <button className="btn btn-primary btn-sm" onClick={() => window.profileforge.installUpdate()}>
              {t('app.updateRestart')}
            </button>
          </div>
        )}
        {page === 'profiles' && <ProfilesPage />}
        {page === 'proxies' && <ProxiesPage />}
        {page === 'downloads' && <DownloadsPage />}
        {page === 'logs' && <LogsPage />}
        {page === 'settings' && <SettingsPage />}
      </div>
    </>
  );
}
