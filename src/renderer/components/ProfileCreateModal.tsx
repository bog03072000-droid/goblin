import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import type { Fingerprint, FingerprintInput, FingerprintValidationResult, FingerprintOptionsResponse } from '@shared/schemas/fingerprint';
import type { ProxyRecord, ProxyProtocol } from '@shared/schemas/proxy';
import type { Group } from '@shared/schemas/group';
import type { Template } from '@shared/schemas/template';
import { callApi } from '../services/api';
import { useAsyncAction } from '../hooks/useAsyncAction';
import { useTranslation } from '../i18n';
import { FingerprintTab, type FingerprintDraft, type SpoofingPatch, type FieldOverrides } from './profileEditor/FingerprintTab';

type Tab = 'general' | 'fingerprint' | 'proxy' | 'storage' | 'advanced';

/** A local, not-yet-persisted stand-in for a real `Fingerprint` row — same
 * shape so FingerprintTab (built for editing a real, saved fingerprint) can
 * be reused unmodified here. Nothing under this id is ever read from or
 * written to the database; `fingerprint:generate` and `fingerprint:validate`
 * are both already stateless IPC calls that don't require a real id. */
function toDraftFingerprint(input: FingerprintInput): Fingerprint {
  return { ...input, id: '__draft__', createdAt: '', updatedAt: '' };
}

function draftFromFingerprint(fp: Fingerprint): FingerprintDraft {
  return {
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
  };
}

/**
 * Profile creation, fully configured up front: nothing is written to the
 * database until "Create profile" is clicked. Every field collected here
 * (general/fingerprint/proxy) travels in that single `profiles:create` call;
 * closing this modal at any point before then discards the whole draft.
 *
 * Storage/Advanced are shown (matching ProfileEditorModal's tab set) but
 * only ever display real, persisted data for an EXISTING profile — there is
 * no storage directory or created/updated history before the profile
 * actually exists, so those tabs show that plainly instead of faking data.
 */
export function ProfileCreateModal({
  initialName,
  initialGroupId,
  initialProxyId,
  initialTags,
  initialTemplateId,
  onClose,
  onCreated,
}: {
  initialName: string;
  initialGroupId: string;
  initialProxyId: string;
  initialTags: string;
  initialTemplateId: string;
  onClose: () => void;
  onCreated: () => void;
}): JSX.Element {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>('general');

  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState('');
  const [tagsText, setTagsText] = useState(initialTags);
  const [groupId, setGroupId] = useState(initialGroupId);
  const [proxyId, setProxyId] = useState(initialProxyId);
  const [templateId, setTemplateId] = useState(initialTemplateId);

  const [groups, setGroups] = useState<Group[]>([]);
  const [proxies, setProxies] = useState<ProxyRecord[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);

  const [fingerprint, setFingerprint] = useState<Fingerprint | null>(null);
  const [draft, setDraft] = useState<FingerprintDraft | null>(null);
  const [manualMode, setManualMode] = useState(false);
  const [validation, setValidation] = useState<FingerprintValidationResult | null>(null);
  const [fieldOptions, setFieldOptions] = useState<FingerprintOptionsResponse | null>(null);
  const [overrides, setOverrides] = useState<FieldOverrides>({});

  const [showAddProxy, setShowAddProxy] = useState(false);
  const [proxyForm, setProxyForm] = useState({
    name: '',
    protocol: 'http' as ProxyProtocol,
    host: '',
    port: 8080,
    username: '',
    password: '',
  });

  const loadAction = useAsyncAction();
  const addProxyAction = useAsyncAction();
  const miscAction = useAsyncAction();
  const createAction = useAsyncAction();
  const error = loadAction.error ?? addProxyAction.error ?? miscAction.error ?? createAction.error;

  async function generatePreview(forTemplateId: string, withOverrides: FieldOverrides = overrides): Promise<void> {
    const generated = await callApi<'fingerprint:generate', FingerprintInput>('fingerprint:generate', {
      seed: `new-profile-${Date.now()}`,
      templateId: forTemplateId || undefined,
      ...withOverrides,
    });
    const fp = toDraftFingerprint(generated);
    setFingerprint(fp);
    setDraft(draftFromFingerprint(fp));
    setValidation(null);
  }

  async function load(): Promise<void> {
    await loadAction.run(async () => {
      const [groupList, proxyList, templateList, options] = await Promise.all([
        callApi<'groups:list', Group[]>('groups:list', {}),
        callApi<'proxy:list', ProxyRecord[]>('proxy:list', {}),
        callApi<'templates:list', Template[]>('templates:list', {}),
        callApi<'fingerprint:options', FingerprintOptionsResponse>('fingerprint:options', {}),
      ]);
      setGroups(groupList);
      setProxies(proxyList);
      setTemplates(templateList);
      setFieldOptions(options);
      await generatePreview(initialTemplateId);
    });
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function onTemplateChange(next: string): void {
    setTemplateId(next);
    void miscAction.run(() => generatePreview(next));
  }

  function onOverridesChange(next: FieldOverrides): void {
    setOverrides(next);
    void miscAction.run(() => generatePreview(templateId, next));
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

  /** Applies the manual-mode draft fields onto the local (not-yet-persisted)
   * fingerprint — the same field parsing ProfileEditorModal's manual-save
   * uses, but written to local state instead of a `fingerprint:update` call. */
  function applyManualDraft(): void {
    if (!fingerprint || !draft) return;
    const updated: Fingerprint = {
      ...fingerprint,
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
    };
    setFingerprint(updated);
    setDraft(draftFromFingerprint(updated));
    void runValidate(updated);
  }

  function updateSpoofingLocal(patch: SpoofingPatch): void {
    if (!fingerprint) return;
    setFingerprint({ ...fingerprint, ...patch });
  }

  async function addProxy(): Promise<void> {
    if (!proxyForm.name.trim() || !proxyForm.host.trim()) return;
    await addProxyAction.run(async () => {
      const created = await callApi<'proxy:create', ProxyRecord>('proxy:create', {
        name: proxyForm.name.trim(),
        protocol: proxyForm.protocol,
        host: proxyForm.host.trim(),
        port: Number(proxyForm.port),
        username: proxyForm.username || undefined,
        password: proxyForm.password || undefined,
      });
      setProxies((prev) => [...prev, created]);
      setProxyId(created.id);
      setProxyForm({ name: '', protocol: 'http', host: '', port: 8080, username: '', password: '' });
      setShowAddProxy(false);
    });
  }

  async function createProfile(): Promise<void> {
    if (!name.trim() || !fingerprint) return;
    await createAction.run(async () => {
      await callApi('profiles:create', {
        name: name.trim(),
        description: description || undefined,
        groupId: groupId || undefined,
        proxyId: proxyId || undefined,
        tags: tagsText
          .split(',')
          .map((tg) => tg.trim())
          .filter(Boolean),
        fingerprint: {
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
          webglSpoofingMode: fingerprint.webglSpoofingMode,
          seed: fingerprint.seed,
        },
      });
      onCreated();
      onClose();
    });
  }

  const TAB_LABELS: Record<Tab, string> = {
    general: t('editor.tab.general'),
    fingerprint: t('editor.tab.fingerprint'),
    proxy: t('editor.tab.proxy'),
    storage: t('editor.tab.storage'),
    advanced: t('editor.tab.advanced'),
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel modal-panel-lg" onClick={(e) => e.stopPropagation()}>
        <div className="modal-tabs-header">
          <strong className="modal-tabs-title">{t('profileCreate.title')}</strong>
          {(['general', 'fingerprint', 'proxy', 'storage', 'advanced'] as Tab[]).map((tabKey) => (
            <div
              key={tabKey}
              className={`tab-item tab-item-capitalize ${tab === tabKey ? 'active' : ''}`}
              onClick={() => setTab(tabKey)}
            >
              {TAB_LABELS[tabKey]}
            </div>
          ))}
          <div className="flex-1" />
          <button className="btn btn-ghost btn-sm modal-close-btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
        </div>
        <div className="modal-body-scroll">
          {error && <div className="banner banner-error">{error}</div>}
          {loadAction.pending && !fingerprint && <p>{t('common.loading')}</p>}

          {tab === 'general' && (
            <div>
              <label className="field">
                {t('editor.general.name')}
                <input value={name} onChange={(e) => setName(e.target.value)} />
              </label>
              <label className="field">
                {t('editor.general.description')}
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="field-textarea"
                />
              </label>
              <label className="field">
                {t('editor.general.tags')}
                <input
                  value={tagsText}
                  onChange={(e) => setTagsText(e.target.value)}
                />
              </label>
              <label className="field">
                {t('editor.general.group')}
                <select value={groupId} onChange={(e) => setGroupId(e.target.value)}>
                  <option value="">{t('profiles.group.none')}</option>
                  {groups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}

          {tab === 'fingerprint' && fingerprint && draft && (
            <div>
              <label className="field">
                {t('profileCreate.fingerprint.template')}
                <select
                  value={templateId}
                  onChange={(e) => onTemplateChange(e.target.value)}
                >
                  <option value="">{t('profiles.template.auto')}</option>
                  {templates.map((tmpl) => (
                    <option key={tmpl.id} value={tmpl.id}>
                      {tmpl.name}
                    </option>
                  ))}
                </select>
              </label>
              <FingerprintTab
                fingerprint={fingerprint}
                draft={draft}
                onDraftChange={setDraft}
                manualMode={manualMode}
                onManualModeChange={setManualMode}
                validation={validation}
                saving={false}
                spoofingSaving={false}
                onRegenerate={() => void miscAction.run(() => generatePreview(templateId))}
                onValidate={() => void runValidate()}
                onSaveManual={applyManualDraft}
                onUpdateSpoofing={updateSpoofingLocal}
                fieldOptions={fieldOptions}
                overrides={overrides}
                onOverridesChange={onOverridesChange}
              />
            </div>
          )}

          {tab === 'proxy' && (
            <div>
              <label className="field">
                {t('editor.proxy.assigned')}
                <select value={proxyId} onChange={(e) => setProxyId(e.target.value)}>
                  <option value="">{t('common.none')}</option>
                  {proxies.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.protocol}://{p.host}:{p.port})
                    </option>
                  ))}
                </select>
              </label>
              {!showAddProxy && (
                <button className="btn btn-ghost btn-sm" onClick={() => setShowAddProxy(true)}>
                  <Plus size={14} strokeWidth={2.25} />
                  {t('profileCreate.proxy.addNew')}
                </button>
              )}
              {showAddProxy && (
                <div className="panel mt-8">
                  <label className="field">
                    {t('proxy.namePlaceholder')}
                    <input
                      value={proxyForm.name}
                      onChange={(e) => setProxyForm({ ...proxyForm, name: e.target.value })}
                    />
                  </label>
                  <label className="field">
                    {t('proxy.table.protocol')}
                    <select
                      value={proxyForm.protocol}
                      onChange={(e) => setProxyForm({ ...proxyForm, protocol: e.target.value as ProxyProtocol })}
                    >
                      <option value="http">HTTP</option>
                      <option value="https">HTTPS</option>
                      <option value="socks5">SOCKS5</option>
                    </select>
                  </label>
                  <label className="field">
                    {t('proxy.hostPlaceholder')}
                    <input
                      value={proxyForm.host}
                      onChange={(e) => setProxyForm({ ...proxyForm, host: e.target.value })}
                    />
                  </label>
                  <label className="field">
                    {t('proxy.portPlaceholder')}
                    <input
                      type="number"
                      value={proxyForm.port}
                      onChange={(e) => setProxyForm({ ...proxyForm, port: Number(e.target.value) })}
                      className="w-120"
                    />
                  </label>
                  <label className="field">
                    {t('proxy.usernamePlaceholder')}
                    <input
                      value={proxyForm.username}
                      onChange={(e) => setProxyForm({ ...proxyForm, username: e.target.value })}
                    />
                  </label>
                  <label className="field">
                    {t('proxy.passwordPlaceholder')}
                    <input
                      type="password"
                      value={proxyForm.password}
                      onChange={(e) => setProxyForm({ ...proxyForm, password: e.target.value })}
                    />
                  </label>
                  <button className="btn btn-ghost btn-sm" disabled={addProxyAction.pending} onClick={() => void addProxy()}>
                    {addProxyAction.pending && <span className="spinner" />}
                    {t('proxy.create')}
                  </button>
                  <button className="btn btn-ghost btn-sm" onClick={() => setShowAddProxy(false)}>
                    {t('common.cancel')}
                  </button>
                </div>
              )}
            </div>
          )}

          {tab === 'storage' && <p className="text-dim text-sm">{t('profileCreate.storage.hint')}</p>}

          {tab === 'advanced' && <p className="text-dim text-sm">{t('profileCreate.advanced.hint')}</p>}
        </div>
        <div className="modal-footer">
          <button
            className="btn btn-primary"
            disabled={createAction.pending || !name.trim() || !fingerprint}
            onClick={() => void createProfile()}
          >
            {createAction.pending && <span className="spinner" />}
            {t('profileCreate.createButton')}
          </button>
        </div>
      </div>
    </div>
  );
}
