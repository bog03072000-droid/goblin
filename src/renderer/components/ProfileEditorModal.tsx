import { useEffect, useState } from 'react';
import type { Profile } from '@shared/schemas/profile';
import type { Fingerprint, FingerprintInput, FingerprintValidationResult } from '@shared/schemas/fingerprint';
import type { ProxyRecord } from '@shared/schemas/proxy';
import type { Group } from '@shared/schemas/group';
import { callApi } from '../services/api';
import { useAsyncAction } from '../hooks/useAsyncAction';
import { useTranslation, type TranslationKey } from '../i18n';
import { GeneralTab } from './profileEditor/GeneralTab';
import { FingerprintTab, type FingerprintDraft, type SpoofingPatch } from './profileEditor/FingerprintTab';
import { ProxyTab } from './profileEditor/ProxyTab';
import { StorageTab } from './profileEditor/StorageTab';
import { AdvancedTab } from './profileEditor/AdvancedTab';

type Tab = 'general' | 'fingerprint' | 'proxy' | 'storage' | 'advanced';

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
  const [manualMode, setManualMode] = useState(false);
  const [draft, setDraft] = useState<FingerprintDraft | null>(null);

  const loadAction = useAsyncAction();
  const saveAction = useAsyncAction();
  const miscAction = useAsyncAction();
  const spoofingAction = useAsyncAction();
  const error = loadAction.error ?? saveAction.error ?? miscAction.error ?? spoofingAction.error;

  async function load(): Promise<void> {
    await loadAction.run(async () => {
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
    });
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileId]);

  async function saveGeneral(): Promise<void> {
    await saveAction.run(async () => {
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
    });
  }

  async function saveProxy(): Promise<void> {
    await saveAction.run(async () => {
      await callApi('profiles:update', { id: profileId, proxyId: proxyId || null });
      onSaved();
      await load();
    });
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
    await saveAction.run(async () => {
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
      await runValidate(updated);
    });
  }

  /** AUTO mode: regenerates a fresh coherent bundle from a new random seed and
   * applies it to this profile's existing fingerprint row (same id). */
  async function regenerateAuto(): Promise<void> {
    if (!fingerprint) return;
    await miscAction.run(async () => {
      const generated = await callApi<'fingerprint:generate', FingerprintInput>('fingerprint:generate', {
        seed: `${profileId}-${Date.now()}`,
      });
      const updated = await callApi<'fingerprint:update', Fingerprint>('fingerprint:update', {
        id: fingerprint.id,
        ...generated,
      });
      setFingerprint(updated);
      resetDraft(updated);
      await runValidate(updated);
    });
  }

  async function runValidate(fpArg?: Fingerprint): Promise<void> {
    const source = fpArg ?? fingerprint;
    if (!source) return;
    await miscAction.run(async () => {
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
        webglSpoofingMode: source.webglSpoofingMode,
        seed: source.seed,
      });
      setValidation(result);
    });
  }

  async function clearCache(): Promise<void> {
    await miscAction.run(async () => {
      await callApi('profiles:clearCache', { id: profileId });
    });
  }

  async function updateSpoofing(patch: SpoofingPatch): Promise<void> {
    if (!fingerprint) return;
    await spoofingAction.run(async () => {
      const updated = await callApi<'fingerprint:update', Fingerprint>('fingerprint:update', {
        id: fingerprint.id,
        ...patch,
      });
      setFingerprint(updated);
    });
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
            <GeneralTab
              name={name}
              onNameChange={setName}
              description={description}
              onDescriptionChange={setDescription}
              tagsText={tagsText}
              onTagsTextChange={setTagsText}
              groupId={groupId}
              onGroupIdChange={setGroupId}
              groups={groups}
              saving={saveAction.pending}
              onSave={() => void saveGeneral()}
            />
          )}

          {profile && tab === 'fingerprint' && fingerprint && draft && (
            <FingerprintTab
              fingerprint={fingerprint}
              draft={draft}
              onDraftChange={setDraft}
              manualMode={manualMode}
              onManualModeChange={setManualMode}
              validation={validation}
              saving={saveAction.pending}
              spoofingSaving={spoofingAction.pending}
              onRegenerate={() => void regenerateAuto()}
              onValidate={() => void runValidate()}
              onSaveManual={() => void saveManualFingerprint()}
              onUpdateSpoofing={(patch) => void updateSpoofing(patch)}
            />
          )}

          {profile && tab === 'proxy' && (
            <ProxyTab proxyId={proxyId} onProxyIdChange={setProxyId} proxies={proxies} saving={saveAction.pending} onSave={() => void saveProxy()} />
          )}

          {profile && tab === 'storage' && (
            <StorageTab profilePath={profile.profilePath} onClearCache={() => void clearCache()} />
          )}

          {profile && tab === 'advanced' && <AdvancedTab profile={profile} />}
        </div>
      </div>
    </div>
  );
}
