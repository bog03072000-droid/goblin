import { useEffect, useState } from 'react';
import { ProfilesPage } from './pages/ProfilesPage';
import { ProxiesPage } from './pages/ProxiesPage';
import { LogsPage } from './pages/LogsPage';
import { SettingsPage } from './pages/SettingsPage';
import { I18nProvider, useTranslation, DEFAULT_LOCALE, type Locale } from './i18n';
import { callApi } from './services/api';
import type { Settings } from '@shared/schemas/settings';

type Page = 'profiles' | 'proxies' | 'logs' | 'settings';

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
  const { t } = useTranslation();

  return (
    <>
      <div className="sidebar">
        <div className="sidebar-brand">
          <svg width="28" height="28" viewBox="0 0 32 32" aria-hidden="true">
            <rect x="1" y="1" width="30" height="30" rx="10" fill="var(--lime)" stroke="var(--ink)" strokeWidth="2" />
            <path d="M9 13c-2-3-1-6 1-7 0 2 1 3 2 3" fill="var(--lime)" stroke="var(--ink)" strokeWidth="1.4" strokeLinejoin="round" />
            <path d="M23 13c2-3 1-6-1-7 0 2-1 3-2 3" fill="var(--lime)" stroke="var(--ink)" strokeWidth="1.4" strokeLinejoin="round" />
            <ellipse cx="16" cy="18" rx="8" ry="7" fill="var(--lime)" stroke="var(--ink)" strokeWidth="1.6" />
            <path d="M10.5 16.5c1.5-1.5 4-1.5 5.5 0M16 16.5c1.5-1.5 4-1.5 5.5 0" stroke="var(--ink)" strokeWidth="1.4" strokeLinecap="round" fill="none" />
            <path d="M12 22c2 1.5 6 1.5 8 0" stroke="var(--ink)" strokeWidth="1.4" strokeLinecap="round" fill="none" />
          </svg>
          <span className="sidebar-brand-name">Goblin</span>
        </div>
        <div className={`sidebar-item ${page === 'profiles' ? 'active' : ''}`} onClick={() => setPage('profiles')}>
          {t('app.sidebar.profiles')}
        </div>
        <div className={`sidebar-item ${page === 'proxies' ? 'active' : ''}`} onClick={() => setPage('proxies')}>
          {t('app.sidebar.proxies')}
        </div>
        <div className={`sidebar-item ${page === 'logs' ? 'active' : ''}`} onClick={() => setPage('logs')}>
          {t('app.sidebar.logs')}
        </div>
        <div className={`sidebar-item ${page === 'settings' ? 'active' : ''}`} onClick={() => setPage('settings')}>
          {t('app.sidebar.settings')}
        </div>
      </div>
      <div className="main">
        {page === 'profiles' && <ProfilesPage />}
        {page === 'proxies' && <ProxiesPage />}
        {page === 'logs' && <LogsPage />}
        {page === 'settings' && <SettingsPage />}
      </div>
    </>
  );
}
