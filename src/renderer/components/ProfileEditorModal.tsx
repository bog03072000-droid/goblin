import { useEffect, useState } from 'react';
import type { Profile } from '@shared/schemas/profile';
import type { Fingerprint, FingerprintValidationResult } from '@shared/schemas/fingerprint';
import type { ProxyRecord } from '@shared/schemas/proxy';
import { callApi } from '../services/api';

type Tab = 'general' | 'fingerprint' | 'proxy' | 'storage' | 'advanced';

const FIELD_ROWS: Array<[string, keyof Fingerprint]> = [
  ['OS', 'os'],
  ['OS Version', 'osVersion'],
  ['Browser Version', 'browserVersion'],
  ['Platform', 'platform'],
  ['User-Agent', 'userAgent'],
  ['Locale', 'locale'],
  ['Languages', 'languages'],
  ['Timezone', 'timezone'],
  ['Screen', 'screenWidth'],
  ['Device Scale Factor', 'deviceScaleFactor'],
  ['Hardware Concurrency', 'hardwareConcurrency'],
  ['Device Memory (GB)', 'deviceMemory'],
  ['WebGL Vendor', 'webglVendor'],
  ['WebGL Renderer', 'webglRenderer'],
  ['Canvas Mode', 'canvasMode'],
  ['Audio Mode', 'audioMode'],
  ['WebRTC Mode', 'webrtcMode'],
  ['Fonts Mode', 'fontsMode'],
  ['Media Devices Mode', 'mediaDevicesMode'],
  ['Seed', 'seed'],
];

export function ProfileEditorModal({
  profileId,
  onClose,
  onSaved,
}: {
  profileId: string;
  onClose: () => void;
  onSaved: () => void;
}): JSX.Element {
  const [tab, setTab] = useState<Tab>('general');
  const [profile, setProfile] = useState<Profile | null>(null);
  const [fingerprint, setFingerprint] = useState<Fingerprint | null>(null);
  const [proxies, setProxies] = useState<ProxyRecord[]>([]);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [tagsText, setTagsText] = useState('');
  const [proxyId, setProxyId] = useState('');
  const [validation, setValidation] = useState<FingerprintValidationResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load(): Promise<void> {
    try {
      const p = await callApi<'profiles:get', Profile | null>('profiles:get', { id: profileId });
      if (!p) throw new Error('Profile not found');
      setProfile(p);
      setName(p.name);
      setDescription(p.description);
      setTagsText(p.tags.join(', '));
      setProxyId(p.proxyId ?? '');
      const fp = await callApi<'fingerprint:get', Fingerprint | null>('fingerprint:get', { id: p.fingerprintId });
      setFingerprint(fp);
      const proxyList = await callApi<'proxy:list', ProxyRecord[]>('proxy:list', {});
      setProxies(proxyList);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileId]);

  async function saveGeneral(): Promise<void> {
    try {
      await callApi('profiles:update', {
        id: profileId,
        name,
        description,
        tags: tagsText
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
      });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function saveProxy(): Promise<void> {
    try {
      await callApi('profiles:update', { id: profileId, proxyId: proxyId || null });
      onSaved();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function runValidate(): Promise<void> {
    if (!fingerprint) return;
    try {
      const result = await callApi<'fingerprint:validate', FingerprintValidationResult>('fingerprint:validate', {
        name: fingerprint.name,
        os: fingerprint.os,
        osVersion: fingerprint.osVersion,
        browserVersion: fingerprint.browserVersion,
        userAgent: fingerprint.userAgent,
        platform: fingerprint.platform,
        locale: fingerprint.locale,
        languages: fingerprint.languages,
        timezone: fingerprint.timezone,
        screenWidth: fingerprint.screenWidth,
        screenHeight: fingerprint.screenHeight,
        deviceScaleFactor: fingerprint.deviceScaleFactor,
        hardwareConcurrency: fingerprint.hardwareConcurrency,
        deviceMemory: fingerprint.deviceMemory,
        webglVendor: fingerprint.webglVendor,
        webglRenderer: fingerprint.webglRenderer,
        canvasMode: fingerprint.canvasMode,
        audioMode: fingerprint.audioMode,
        webrtcMode: fingerprint.webrtcMode,
        fontsMode: fingerprint.fontsMode,
        mediaDevicesMode: fingerprint.mediaDevicesMode,
        seed: fingerprint.seed,
      });
      setValidation(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function clearCache(): Promise<void> {
    try {
      await callApi('profiles:clearCache', { id: profileId });
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 100,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'var(--bg-panel)',
          border: '1px solid var(--border)',
          borderRadius: 6,
          width: 640,
          maxHeight: '80vh',
          display: 'flex',
          flexDirection: 'column',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', borderBottom: '1px solid var(--border)' }}>
          {(['general', 'fingerprint', 'proxy', 'storage', 'advanced'] as Tab[]).map((t) => (
            <div
              key={t}
              className={`sidebar-item ${tab === t ? 'active' : ''}`}
              style={{ textTransform: 'capitalize', cursor: 'pointer' }}
              onClick={() => setTab(t)}
            >
              {t}
            </div>
          ))}
          <div style={{ flex: 1 }} />
          <button style={{ margin: 8 }} onClick={onClose}>
            Close
          </button>
        </div>
        <div style={{ padding: 16, overflow: 'auto' }}>
          {error && <div className="error-banner">{error}</div>}
          {!profile && <p>Loading…</p>}

          {profile && tab === 'general' && (
            <div>
              <label style={{ display: 'block', marginBottom: 8 }}>
                Name
                <input value={name} onChange={(e) => setName(e.target.value)} style={{ display: 'block', width: '100%', marginTop: 4 }} />
              </label>
              <label style={{ display: 'block', marginBottom: 8 }}>
                Description
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  style={{ display: 'block', width: '100%', marginTop: 4, minHeight: 60 }}
                />
              </label>
              <label style={{ display: 'block', marginBottom: 8 }}>
                Tags (comma-separated)
                <input value={tagsText} onChange={(e) => setTagsText(e.target.value)} style={{ display: 'block', width: '100%', marginTop: 4 }} />
              </label>
              <button className="primary" onClick={() => void saveGeneral()}>
                Save
              </button>
            </div>
          )}

          {profile && tab === 'fingerprint' && fingerprint && (
            <div>
              <table>
                <tbody>
                  {FIELD_ROWS.map(([label, key]) => (
                    <tr key={key}>
                      <th style={{ width: 180 }}>{label}</th>
                      <td>
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
              <button style={{ marginTop: 10 }} onClick={() => void runValidate()}>
                Validate
              </button>
              {validation && (
                <div style={{ marginTop: 10, fontSize: 12 }}>
                  <p style={{ color: validation.valid ? 'var(--green)' : 'var(--red)' }}>
                    {validation.valid ? 'Valid — no contradictions found.' : 'Invalid — errors found.'}
                  </p>
                  {validation.errors.map((e) => (
                    <p key={e} style={{ color: 'var(--red)' }}>
                      ERROR: {e}
                    </p>
                  ))}
                  {validation.warnings.map((w) => (
                    <p key={w} style={{ color: 'var(--yellow)' }}>
                      WARNING: {w}
                    </p>
                  ))}
                </div>
              )}
            </div>
          )}

          {profile && tab === 'proxy' && (
            <div>
              <label style={{ display: 'block', marginBottom: 8 }}>
                Assigned proxy
                <select value={proxyId} onChange={(e) => setProxyId(e.target.value)} style={{ display: 'block', width: '100%', marginTop: 4 }}>
                  <option value="">None</option>
                  {proxies.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.protocol}://{p.host}:{p.port})
                    </option>
                  ))}
                </select>
              </label>
              <button className="primary" onClick={() => void saveProxy()}>
                Save
              </button>
            </div>
          )}

          {profile && tab === 'storage' && (
            <div>
              <p>
                <strong>Storage path:</strong> {profile.profilePath}
              </p>
              <p style={{ color: 'var(--text-dim)', fontSize: 12 }}>
                Clearing cache removes only the Cache subdirectory — cookies, localStorage, and
                history are preserved. The profile must be stopped first.
              </p>
              <button onClick={() => void clearCache()}>Clear Cache</button>
            </div>
          )}

          {profile && tab === 'advanced' && (
            <table>
              <tbody>
                <tr>
                  <th style={{ width: 180 }}>Profile ID</th>
                  <td>{profile.id}</td>
                </tr>
                <tr>
                  <th>Created</th>
                  <td>{profile.createdAt}</td>
                </tr>
                <tr>
                  <th>Updated</th>
                  <td>{profile.updatedAt}</td>
                </tr>
                <tr>
                  <th>Last Started</th>
                  <td>{profile.lastStartedAt ?? '—'}</td>
                </tr>
                <tr>
                  <th>Last Stopped</th>
                  <td>{profile.lastStoppedAt ?? '—'}</td>
                </tr>
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
