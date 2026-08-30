import { useEffect, useState } from 'react';
import type { Settings } from '@shared/schemas/settings';
import { callApi } from '../services/api';

export function SettingsPage(): JSX.Element {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void callApi<'settings:get', Settings>('settings:get', {}).then(setSettings);
  }, []);

  async function save(patch: Partial<Settings>): Promise<void> {
    const updated = await callApi<'settings:update', Settings>('settings:update', patch);
    setSettings(updated);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  if (!settings) return <div className="content">Loading…</div>;

  return (
    <div className="content" style={{ maxWidth: 560 }}>
      {saved && (
        <div className="error-banner" style={{ borderColor: 'var(--green)', color: '#a6f0b4' }}>
          Saved. Some settings (hardware acceleration) take effect on next launch.
        </div>
      )}

      <h3>Performance</h3>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <input
          type="checkbox"
          checked={settings.hardwareAcceleration}
          onChange={(e) => void save({ hardwareAcceleration: e.target.checked })}
        />
        Hardware acceleration (restart required)
      </label>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <input
          type="checkbox"
          checked={settings.autoCacheCleanup}
          onChange={(e) => void save({ autoCacheCleanup: e.target.checked })}
        />
        Automatic cache cleanup
      </label>
      <label style={{ display: 'block', marginBottom: 8 }}>
        Max simultaneous profile launches (bulk start)
        <input
          type="number"
          min={1}
          max={20}
          value={settings.maxConcurrentLaunches}
          onChange={(e) => void save({ maxConcurrentLaunches: Number(e.target.value) })}
          style={{ display: 'block', width: 160, marginTop: 4 }}
        />
      </label>

      <h3>Storage</h3>
      <label style={{ display: 'block', marginBottom: 8 }}>
        Cache limit per profile (MB)
        <input
          type="number"
          value={settings.cacheLimitMb}
          onChange={(e) => void save({ cacheLimitMb: Number(e.target.value) })}
          style={{ display: 'block', width: 160, marginTop: 4 }}
        />
      </label>

      <h3>General</h3>
      <label style={{ display: 'block', marginBottom: 8 }}>
        Startup behavior
        <select
          value={settings.startupBehavior}
          onChange={(e) => void save({ startupBehavior: e.target.value as Settings['startupBehavior'] })}
          style={{ display: 'block', width: 220, marginTop: 4 }}
        >
          <option value="showProfileList">Show profile list</option>
          <option value="blank">Blank</option>
          <option value="lastSession">Restore last session</option>
        </select>
      </label>

      <h3>Logging</h3>
      <label style={{ display: 'block', marginBottom: 8 }}>
        Activity log retention (days)
        <input
          type="number"
          value={settings.logRetentionDays}
          onChange={(e) => void save({ logRetentionDays: Number(e.target.value) })}
          style={{ display: 'block', width: 160, marginTop: 4 }}
        />
      </label>
    </div>
  );
}
