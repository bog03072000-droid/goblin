import { useState } from 'react';
import { ProfilesPage } from './pages/ProfilesPage';
import { ProxiesPage } from './pages/ProxiesPage';
import { LogsPage } from './pages/LogsPage';
import { SettingsPage } from './pages/SettingsPage';

type Page = 'profiles' | 'proxies' | 'logs' | 'settings';

export function App(): JSX.Element {
  const [page, setPage] = useState<Page>('profiles');

  return (
    <>
      <div className="sidebar">
        <div className={`sidebar-item ${page === 'profiles' ? 'active' : ''}`} onClick={() => setPage('profiles')}>
          Profiles
        </div>
        <div className={`sidebar-item ${page === 'proxies' ? 'active' : ''}`} onClick={() => setPage('proxies')}>
          Proxies
        </div>
        <div className={`sidebar-item ${page === 'logs' ? 'active' : ''}`} onClick={() => setPage('logs')}>
          Logs
        </div>
        <div className={`sidebar-item ${page === 'settings' ? 'active' : ''}`} onClick={() => setPage('settings')}>
          Settings
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
