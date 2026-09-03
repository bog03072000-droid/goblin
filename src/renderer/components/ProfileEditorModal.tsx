import { useEffect, useState } from 'react';
import type { Profile } from '@shared/schemas/profile';
import type { Settings } from '@shared/schemas/settings';
import type { Fingerprint } from '@shared/schemas/fingerprint';
import type { CookieInfo, CookieSetInput } from '@shared/schemas/cookie';
import type { LocalStorageEntry, LocalStorageSetInput } from '@shared/schemas/localStorageEntry';
import { callApi } from '../services/api';
import { useAsyncAction } from '../hooks/useAsyncAction';
import { useFingerprintPreview, validateFingerprintPreview } from '../hooks/useFingerprintPreview';
import { useProfileFormFields, parseTagsText } from '../hooks/useProfileFormFields';
import { useTranslation, type TranslationKey } from '../i18n';
import { GeneralTab } from './profileEditor/GeneralTab';
import { FingerprintTab, type FieldOverrides, type FingerprintDraft, type SpoofingPatch } from './profileEditor/FingerprintTab';
import { ProxyTab } from './profileEditor/ProxyTab';
import { StorageTab } from './profileEditor/StorageTab';
import { AdvancedTab } from './profileEditor/AdvancedTab';
import { ConfirmDialog } from './ConfirmDialog';

interface EditableSnapshot {
  name: string;
  description: string;
  tagsText: string;
  groupId: string;
  proxyId: string;
}

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
  const { name, setName, description, setDescription, tagsText, setTagsText, groupId, setGroupId, proxyId, setProxyId, setAllFields, groups, proxies, loadGroupsAndProxies } =
    useProfileFormFields({ name: '', description: '', tagsText: '', groupId: '', proxyId: '' });
  const [manualMode, setManualMode] = useState(false);
  const [draft, setDraft] = useState<FingerprintDraft | null>(null);
  const [automationToken, setAutomationToken] = useState<string | null>(null);
  const [defaultAutomationPort, setDefaultAutomationPort] = useState<number | null>(null);
  const [cookies, setCookies] = useState<CookieInfo[] | null>(null);
  const [localStorageItems, setLocalStorageItems] = useState<LocalStorageEntry[] | null>(null);
  const [localStorageOrigin, setLocalStorageOrigin] = useState<string | null>(null);
  // Baseline snapshot of the last-loaded-or-saved General/Proxy field values —
  // compared against current state to detect unsaved edits, so closing the
  // modal (or the Reset button) can act on them instead of silently
  // discarding or ignoring in-progress changes.
  const [savedSnapshot, setSavedSnapshot] = useState<EditableSnapshot>({
    name: '',
    description: '',
    tagsText: '',
    groupId: '',
    proxyId: '',
  });
  const [confirmClose, setConfirmClose] = useState(false);
  const isDirty =
    name !== savedSnapshot.name ||
    description !== savedSnapshot.description ||
    tagsText !== savedSnapshot.tagsText ||
    groupId !== savedSnapshot.groupId ||
    proxyId !== savedSnapshot.proxyId;

  const loadAction = useAsyncAction();
  const saveAction = useAsyncAction();
  const miscAction = useAsyncAction();
  const spoofingAction = useAsyncAction();
  const automationAction = useAsyncAction();
  const cookiesAction = useAsyncAction();
  const localStorageAction = useAsyncAction();
  const error =
    loadAction.error ??
    saveAction.error ??
    miscAction.error ??
    spoofingAction.error ??
    automationAction.error ??
    cookiesAction.error ??
    localStorageAction.error;

  // AUTO mode here has no separate "preview vs. persist" step (unlike the
  // create-modal's not-yet-persisted draft): a freshly generated fingerprint
  // is written straight to this profile's existing fingerprint row via
  // fingerprint:update, then validated — same merge shape fingerprint:update
  // already uses for post-creation edits.
  const { fieldOptions, overrides, setOverrides, validation, setValidation, generatePreview, runValidate } = useFingerprintPreview(
    async (generated) => {
      if (!fingerprint) return;
      const updated = await callApi<'fingerprint:update', Fingerprint>('fingerprint:update', {
        id: fingerprint.id,
        ...generated,
      });
      setFingerprint(updated);
      resetDraft(updated);
      setValidation(await validateFingerprintPreview(updated));
    },
  );

  async function load(): Promise<void> {
    await loadAction.run(async () => {
      const p = await callApi<'profiles:get', Profile | null>('profiles:get', { id: profileId });
      if (!p) throw new Error('Profile not found');
      setProfile(p);
      const loaded = {
        name: p.name,
        description: p.description,
        tagsText: p.tags.join(', '),
        groupId: p.groupId ?? '',
        proxyId: p.proxyId ?? '',
      };
      setAllFields(loaded);
      setSavedSnapshot(loaded);
      const fp = await callApi<'fingerprint:get', Fingerprint | null>('fingerprint:get', { id: p.fingerprintId });
      setFingerprint(fp);
      if (fp) resetDraft(fp);
      setOverrides({});
      await loadGroupsAndProxies();
      const tokenResult = await callApi<'profiles:getAutomationToken', { token: string | null }>(
        'profiles:getAutomationToken',
        { id: profileId },
      );
      setAutomationToken(tokenResult.token);
      const settings = await callApi<'settings:get', Settings>('settings:get', {});
      setDefaultAutomationPort(settings.defaultAutomationPort);
    });
  }

  /** Toggling automation on generates a token the first time (none exists
   * yet for a profile that never had it enabled); toggling off just flips
   * the flag and clears the displayed token — the encrypted token itself
   * stays in the database so re-enabling later doesn't silently rotate it
   * out from under an already-configured external automation client. */
  async function saveAutomation(patch: { automationEnabled?: boolean; automationPort?: number | null }): Promise<void> {
    await automationAction.run(async () => {
      const updated = await callApi<'profiles:update', Profile>('profiles:update', { id: profileId, ...patch });
      setProfile(updated);
      if (patch.automationEnabled === true && !automationToken) {
        const generated = await callApi<'profiles:regenerateAutomationToken', { token: string }>(
          'profiles:regenerateAutomationToken',
          { id: profileId },
        );
        setAutomationToken(generated.token);
      }
    });
  }

  async function regenerateAutomationToken(): Promise<void> {
    await automationAction.run(async () => {
      const result = await callApi<'profiles:regenerateAutomationToken', { token: string }>(
        'profiles:regenerateAutomationToken',
        { id: profileId },
      );
      setAutomationToken(result.token);
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
        tags: parseTagsText(tagsText),
      });
      setSavedSnapshot((prev) => ({ ...prev, name, description, tagsText, groupId }));
      onSaved();
    });
  }

  async function saveProxy(): Promise<void> {
    await saveAction.run(async () => {
      await callApi('profiles:update', { id: profileId, proxyId: proxyId || null });
      setSavedSnapshot((prev) => ({ ...prev, proxyId }));
      onSaved();
      await load();
    });
  }

  /** Reverts any unsaved General/Proxy edits back to the last-loaded-or-saved
   * values — a plain form reset, distinct from Fingerprint's "Regenerate"
   * (which creates a brand-new random identity, not a revert). */
  function resetFields(): void {
    setAllFields(savedSnapshot);
  }

  function requestClose(): void {
    if (isDirty) setConfirmClose(true);
    else onClose();
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
      setValidation(await validateFingerprintPreview(updated));
    });
  }

  /** AUTO mode: regenerates a fresh coherent bundle from a new random seed
   * and applies it to this profile's existing fingerprint row (same id) —
   * persistence/validation happens inside useFingerprintPreview's
   * onGenerated callback above. Any explicit field overrides (OS/CPU/GPU/
   * etc. picked in the UI, distinct from `draft`'s free-text manual-mode
   * fields) win over the random pick for that field — same merge the
   * create-modal preview uses. */
  async function regenerateAuto(withOverrides: FieldOverrides = overrides): Promise<void> {
    if (!fingerprint) return;
    await miscAction.run(() => generatePreview(`${profileId}-${Date.now()}`, undefined, withOverrides));
  }

  /** Applying a field override immediately regenerates+saves — there is no
   * separate "preview vs. persist" step in AUTO mode here (unlike the
   * create-modal's not-yet-persisted draft): "Regenerate" already writes
   * straight through, so a field choice does the same. */
  function onOverridesChange(next: FieldOverrides): void {
    setOverrides(next);
    void regenerateAuto(next);
  }

  async function clearCache(): Promise<void> {
    await miscAction.run(async () => {
      await callApi('profiles:clearCache', { id: profileId });
    });
  }

  /** Cookies only exist inside a running profile's own child-process session
   * (see ProfileManager.sendChildRequest) — there is nothing to list while
   * stopped, so the Storage tab gates this behind profile.status. */
  async function loadCookies(): Promise<void> {
    await cookiesAction.run(async () => {
      const list = await callApi<'profiles:cookies:list', CookieInfo[]>('profiles:cookies:list', { id: profileId });
      setCookies(list);
    });
  }

  async function removeCookie(cookie: CookieInfo): Promise<void> {
    await cookiesAction.run(async () => {
      const url = `${cookie.secure ? 'https' : 'http'}://${(cookie.domain ?? '').replace(/^\./, '')}${cookie.path ?? '/'}`;
      await callApi('profiles:cookies:remove', { id: profileId, url, name: cookie.name });
      await loadCookies();
    });
  }

  async function addCookie(input: CookieSetInput): Promise<void> {
    await cookiesAction.run(async () => {
      await callApi('profiles:cookies:set', { id: profileId, cookie: input });
      await loadCookies();
    });
  }

  /** Same running-only constraint as cookies, plus a narrower scope: only
   * the profile's first/primary tab's current origin (see
   * profileWindowEntry.ts's localStorage: handlers) — localStorage has no
   * session-wide API the way cookies do. */
  async function loadLocalStorage(): Promise<void> {
    await localStorageAction.run(async () => {
      const result = await callApi<'profiles:localStorage:list', { origin: string; items: LocalStorageEntry[] }>(
        'profiles:localStorage:list',
        { id: profileId },
      );
      setLocalStorageOrigin(result.origin);
      setLocalStorageItems(result.items);
    });
  }

  async function removeLocalStorageItem(key: string): Promise<void> {
    await localStorageAction.run(async () => {
      await callApi('profiles:localStorage:remove', { id: profileId, key });
      await loadLocalStorage();
    });
  }

  async function addLocalStorageItem(input: LocalStorageSetInput): Promise<void> {
    await localStorageAction.run(async () => {
      await callApi('profiles:localStorage:set', { id: profileId, item: input });
      await loadLocalStorage();
    });
  }

  useEffect(() => {
    if (tab === 'storage' && profile?.status === 'RUNNING' && cookies === null) {
      void loadCookies();
    }
    if (tab === 'storage' && profile?.status === 'RUNNING' && localStorageItems === null) {
      void loadLocalStorage();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, profile?.status]);

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
    <div className="modal-overlay" onClick={requestClose}>
      <div className="modal-panel modal-panel-lg" onClick={(e) => e.stopPropagation()}>
        <div className="modal-tabs-header">
          {(['general', 'fingerprint', 'proxy', 'storage', 'advanced'] as Tab[]).map((tabKey) => (
            <div
              key={tabKey}
              className={`tab-item tab-item-capitalize ${tab === tabKey ? 'active' : ''}`}
              onClick={() => setTab(tabKey)}
            >
              {t(TAB_LABEL_KEYS[tabKey])}
            </div>
          ))}
          <div className="flex-1" />
          {isDirty && (
            <button className="btn btn-ghost btn-sm reset-btn" onClick={resetFields}>
              {t('common.reset')}
            </button>
          )}
          <button className="btn btn-ghost btn-sm modal-close-btn" onClick={requestClose}>
            {t('common.close')}
          </button>
        </div>
        <div className="modal-body-pad">
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
              onValidate={() => void runValidate(fingerprint)}
              onSaveManual={() => void saveManualFingerprint()}
              onUpdateSpoofing={(patch) => void updateSpoofing(patch)}
              fieldOptions={fieldOptions}
              overrides={overrides}
              onOverridesChange={onOverridesChange}
            />
          )}

          {profile && tab === 'proxy' && (
            <ProxyTab proxyId={proxyId} onProxyIdChange={setProxyId} proxies={proxies} saving={saveAction.pending} onSave={() => void saveProxy()} />
          )}

          {profile && tab === 'storage' && (
            <StorageTab
              profilePath={profile.profilePath}
              onClearCache={() => void clearCache()}
              isRunning={profile.status === 'RUNNING'}
              cookies={cookies}
              cookiesLoading={cookiesAction.pending}
              onRefreshCookies={() => void loadCookies()}
              onRemoveCookie={(cookie) => void removeCookie(cookie)}
              onAddCookie={(input) => void addCookie(input)}
              localStorageOrigin={localStorageOrigin}
              localStorageItems={localStorageItems}
              localStorageLoading={localStorageAction.pending}
              onRefreshLocalStorage={() => void loadLocalStorage()}
              onRemoveLocalStorageItem={(key) => void removeLocalStorageItem(key)}
              onAddLocalStorageItem={(input) => void addLocalStorageItem(input)}
            />
          )}

          {profile && tab === 'advanced' && (
            <AdvancedTab
              profile={profile}
              automationToken={automationToken}
              defaultAutomationPort={defaultAutomationPort}
              automationSaving={automationAction.pending}
              onSaveAutomation={(patch) => void saveAutomation(patch)}
              onRegenerateToken={() => void regenerateAutomationToken()}
            />
          )}
        </div>
      </div>
      {confirmClose && (
        <ConfirmDialog
          message={t('editor.unsavedChanges.confirm')}
          confirmLabel={t('editor.unsavedChanges.discard')}
          onCancel={() => setConfirmClose(false)}
          onConfirm={() => {
            setConfirmClose(false);
            onClose();
          }}
        />
      )}
    </div>
  );
}
