import { useEffect, useState } from 'react';
import type { Profile } from '@shared/schemas/profile';
import type { Fingerprint, FingerprintInput, FingerprintValidationResult } from '@shared/schemas/fingerprint';
import type { ProxyRecord } from '@shared/schemas/proxy';
import type { Group } from '@shared/schemas/group';
import { callApi } from '../services/api';
import { describeError } from '../services/errorMessages';
import { useTranslation, type TranslationKey } from '../i18n';

type Tab = 'general' | 'fingerprint' | 'proxy' | 'storage' | 'advanced';

const FIELD_ROW_KEYS: Array<[TranslationKey, keyof Fingerprint]> = [
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

export function ProfileEditorModal({
  profileId,
  onClose,
  onSaved,
}: {
  profileId: string;
  onClose: () => void;
  onSaved: () => void;
}): JSX.Element {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>('general');
  const [profile, setProfile] = useState<Profile | null>(null);
  const [fingerprint, setFingerprint] = useState<Fingerprint | null>(null);
  const [proxies, setProxies] = useState<ProxyRecord[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [tagsText, setTagsText] = useState('');
  const [groupId, setGroupId] = useState('');
  const [proxyId, setProxyId] = useState('');
  const [validation, setValidation] = useState<FingerprintValidationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [manualMode, setManualMode] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<{
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
  } | null>(null);

  async function load(): Promise<void> {
    try {
      const p = await callApi<'profiles:get', Profile | null>('profiles:get', { id: profileId });
      if (!p) throw new Error('Profile not found');
      setProfile(p);
      setName(p.name);
      setDescription(p.description);
      setTagsText(p.tags.join(', '));
      setProxyId(p.proxyId ?? '');
      setGroupId(p.groupId ?? '');
      const fp = await callApi<'fingerprint:get', Fingerprint | null>('fingerprint:get', { id: p.fingerprintId });
      setFingerprint(fp);
      if (fp) resetDraft(fp);
      const proxyList = await callApi<'proxy:list', ProxyRecord[]>('proxy:list', {});
      setProxies(proxyList);
      const groupList = await callApi<'groups:list', Group[]>('groups:list', {});
      setGroups(groupList);
    } catch (err) {
      setError(describeError(err, t));
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileId]);

  async function saveGeneral(): Promise<void> {
    setSaving(true);
    try {
      await callApi('profiles:update', {
        id: profileId,
        name,
        description,
        groupId: groupId || null,
        tags: tagsText
          .split(',')
          .map((t2) => t2.trim())
          .filter(Boolean),
      });
      onSaved();
    } catch (err) {
      setError(describeError(err, t));
    } finally {
      setSaving(false);
    }
  }

  async function saveProxy(): Promise<void> {
    setSaving(true);
    try {
      await callApi('profiles:update', { id: profileId, proxyId: proxyId || null });
      onSaved();
      await load();
    } catch (err) {
      setError(describeError(err, t));
    } finally {
      setSaving(false);
    }
  }

  function resetDraft(fp: Fingerprint): void {
    setDraft({
      userAgent: fp.userAgent,
      platform: fp.platform,
      locale: fp.locale,
      languages: fp.languages.join(', '),
      timezone: fp.timezone,
      screenWidth: String(fp.screenWidth),
      screenHeight: String(fp.screenHeight),
      deviceScaleFactor: String(fp.deviceScaleFactor),
      hardwareConcurrency: String(fp.hardwareConcurrency),
      webrtcMode: fp.webrtcMode,
    });
  }

  /** Only the fields verified to be genuinely enforced in the real browser
   * (see docs/FINGERPRINT_AUDIT.md) are editable here — editing a field that
   * isn't actually applied would be a fake control. */
  async function saveManualFingerprint(): Promise<void> {
    if (!fingerprint || !draft) return;
    setSaving(true);
    try {
      const updated = await callApi<'fingerprint:update', Fingerprint>('fingerprint:update', {
        id: fingerprint.id,
        userAgent: draft.userAgent,
        platform: draft.platform,
        locale: draft.locale,
        languages: draft.languages
          .split(',')
          .map((l) => l.trim())
          .filter(Boolean),
        timezone: draft.timezone,
        screenWidth: Number(draft.screenWidth),
        screenHeight: Number(draft.screenHeight),
        deviceScaleFactor: Number(draft.deviceScaleFactor),
        hardwareConcurrency: Number(draft.hardwareConcurrency),
        webrtcMode: draft.webrtcMode as Fingerprint['webrtcMode'],
      });
      setFingerprint(updated);
      resetDraft(updated);
      setError(null);
      await runValidate(updated);
    } catch (err) {
      setError(describeError(err, t));
    } finally {
      setSaving(false);
    }
  }

  /** AUTO mode: regenerates a fresh coherent bundle from a new random seed and
   * applies it to this profile's existing fingerprint row (same id). */
  async function regenerateAuto(): Promise<void> {
    if (!fingerprint) return;
    try {
      const generated = await callApi<'fingerprint:generate', FingerprintInput>('fingerprint:generate', {
        seed: `${profileId}-${Date.now()}`,
      });
      const updated = await callApi<'fingerprint:update', Fingerprint>('fingerprint:update', {
        id: fingerprint.id,
        ...generated,
      });
      setFingerprint(updated);
      resetDraft(updated);
      setError(null);
      await runValidate(updated);
    } catch (err) {
      setError(describeError(err, t));
    }
  }

  async function runValidate(fpArg?: Fingerprint): Promise<void> {
    const source = fpArg ?? fingerprint;
    if (!source) return;
    try {
      const result = await callApi<'fingerprint:validate', FingerprintValidationResult>('fingerprint:validate', {
        name: source.name,
        os: source.os,
        osVersion: source.osVersion,
        browserVersion: source.browserVersion,
        userAgent: source.userAgent,
        platform: source.platform,
        locale: source.locale,
        languages: source.languages,
        timezone: source.timezone,
        screenWidth: source.screenWidth,
        screenHeight: source.screenHeight,
        deviceScaleFactor: source.deviceScaleFactor,
        hardwareConcurrency: source.hardwareConcurrency,
        deviceMemory: source.deviceMemory,
        webglVendor: source.webglVendor,
        webglRenderer: source.webglRenderer,
        canvasMode: source.canvasMode,
        audioMode: source.audioMode,
        webrtcMode: source.webrtcMode,
        fontsMode: source.fontsMode,
        mediaDevicesMode: source.mediaDevicesMode,
        seed: source.seed,
      });
      setValidation(result);
    } catch (err) {
      setError(describeError(err, t));
    }
  }

  async function clearCache(): Promise<void> {
    try {
      await callApi('profiles:clearCache', { id: profileId });
      setError(null);
    } catch (err) {
      setError(describeError(err, t));
    }
  }

  const TAB_LABEL_KEYS: Record<Tab, TranslationKey> = {
    general: 'editor.tab.general',
    fingerprint: 'editor.tab.fingerprint',
    proxy: 'editor.tab.proxy',
    storage: 'editor.tab.storage',
    advanced: 'editor.tab.advanced',
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-panel"
        style={{
          width: 640,
          maxHeight: '80vh',
          display: 'flex',
          flexDirection: 'column',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', borderBottom: '1px solid var(--stroke)', alignItems: 'center' }}>
          {(['general', 'fingerprint', 'proxy', 'storage', 'advanced'] as Tab[]).map((tabKey) => (
            <div
              key={tabKey}
              className={`tab-item ${tab === tabKey ? 'active' : ''}`}
              style={{ textTransform: 'capitalize' }}
              onClick={() => setTab(tabKey)}
            >
              {t(TAB_LABEL_KEYS[tabKey])}
            </div>
          ))}
          <div style={{ flex: 1 }} />
          <button className="btn btn-ghost btn-sm" style={{ margin: 8 }} onClick={onClose}>
            {t('common.close')}
          </button>
        </div>
        <div style={{ padding: 16, overflow: 'auto' }}>
          {error && <div className="banner banner-error">{error}</div>}
          {!profile && <p>{t('common.loading')}</p>}

          {profile && tab === 'general' && (
            <div>
              <label style={{ display: 'block', marginBottom: 8 }}>
                {t('editor.general.name')}
                <input value={name} onChange={(e) => setName(e.target.value)} style={{ display: 'block', width: '100%', marginTop: 4 }} />
              </label>
              <label style={{ display: 'block', marginBottom: 8 }}>
                {t('editor.general.description')}
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  style={{ display: 'block', width: '100%', marginTop: 4, minHeight: 60 }}
                />
              </label>
              <label style={{ display: 'block', marginBottom: 8 }}>
                {t('editor.general.tags')}
                <input value={tagsText} onChange={(e) => setTagsText(e.target.value)} style={{ display: 'block', width: '100%', marginTop: 4 }} />
              </label>
              <label style={{ display: 'block', marginBottom: 8 }}>
                {t('editor.general.group')}
                <select value={groupId} onChange={(e) => setGroupId(e.target.value)} style={{ display: 'block', width: '100%', marginTop: 4 }}>
                  <option value="">{t('profiles.group.none')}</option>
                  {groups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              </label>
              <button className="btn btn-primary" disabled={saving} onClick={() => void saveGeneral()}>
                {saving && <span className="spinner" />}
                {t('common.save')}
              </button>
            </div>
          )}

          {profile && tab === 'fingerprint' && fingerprint && draft && (
            <div>
              <div style={{ display: 'flex', gap: 8, marginBottom: 10, alignItems: 'center' }}>
                <button className={`btn btn-sm ${!manualMode ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setManualMode(false)}>
                  {t('editor.fingerprint.auto')}
                </button>
                <button className={`btn btn-sm ${manualMode ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setManualMode(true)}>
                  {t('editor.fingerprint.manual')}
                </button>
                {!manualMode && (
                  <button className="btn btn-ghost btn-sm" onClick={() => void regenerateAuto()}>
                    {t('editor.fingerprint.regenerate')}
                  </button>
                )}
                <div style={{ flex: 1 }} />
                <button className="btn btn-ghost btn-sm" onClick={() => void runValidate()}>
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
                        onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
                        style={{ display: 'block', width: '100%', marginTop: 4 }}
                      />
                    </label>
                  ))}
                  <label style={{ display: 'block', marginBottom: 8 }}>
                    {t('editor.fingerprint.field.webrtcMode')}
                    <select
                      value={draft.webrtcMode}
                      onChange={(e) => setDraft({ ...draft, webrtcMode: e.target.value })}
                      style={{ display: 'block', width: '100%', marginTop: 4 }}
                    >
                      <option value="default">{t('editor.fingerprint.webrtc.default')}</option>
                      <option value="proxy-only">{t('editor.fingerprint.webrtc.proxyOnly')}</option>
                      <option value="disabled">{t('editor.fingerprint.webrtc.disabled')}</option>
                    </select>
                  </label>
                  <button className="btn btn-primary" disabled={saving} onClick={() => void saveManualFingerprint()}>
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
          )}

          {profile && tab === 'proxy' && (
            <div>
              <label style={{ display: 'block', marginBottom: 8 }}>
                {t('editor.proxy.assigned')}
                <select value={proxyId} onChange={(e) => setProxyId(e.target.value)} style={{ display: 'block', width: '100%', marginTop: 4 }}>
                  <option value="">{t('common.none')}</option>
                  {proxies.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.protocol}://{p.host}:{p.port})
                    </option>
                  ))}
                </select>
              </label>
              <button className="btn btn-primary" disabled={saving} onClick={() => void saveProxy()}>
                {saving && <span className="spinner" />}
                {t('common.save')}
              </button>
            </div>
          )}

          {profile && tab === 'storage' && (
            <div>
              <p>
                <strong>{t('editor.storage.path')}</strong> <span className="mono">{profile.profilePath}</span>
              </p>
              <p style={{ color: 'var(--ash-dim)', fontSize: 12 }}>{t('editor.storage.hint')}</p>
              <button className="btn btn-ghost btn-sm" onClick={() => void clearCache()}>{t('editor.storage.clearCache')}</button>
            </div>
          )}

          {profile && tab === 'advanced' && (
            <table>
              <tbody>
                <tr>
                  <th style={{ width: 180 }}>{t('editor.advanced.id')}</th>
                  <td className="mono">{profile.id}</td>
                </tr>
                <tr>
                  <th>{t('editor.advanced.created')}</th>
                  <td className="mono">{profile.createdAt}</td>
                </tr>
                <tr>
                  <th>{t('editor.advanced.updated')}</th>
                  <td className="mono">{profile.updatedAt}</td>
                </tr>
                <tr>
                  <th>{t('editor.advanced.lastStarted')}</th>
                  <td className="mono">{profile.lastStartedAt ?? '—'}</td>
                </tr>
                <tr>
                  <th>{t('editor.advanced.lastStopped')}</th>
                  <td className="mono">{profile.lastStoppedAt ?? '—'}</td>
                </tr>
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
