import { useState } from 'react';
import { Copy, RefreshCw, ShieldCheck } from 'lucide-react';
import type { Profile } from '@shared/schemas/profile';
import { useTranslation } from '../../i18n';

export function AdvancedTab({
  profile,
  automationToken,
  defaultAutomationPort,
  automationSaving,
  onSaveAutomation,
  onRegenerateToken,
}: {
  profile: Profile;
  automationToken: string | null;
  defaultAutomationPort: number | null;
  automationSaving: boolean;
  onSaveAutomation: (patch: { automationEnabled?: boolean; automationPort?: number | null }) => void;
  onRegenerateToken: () => void;
}): JSX.Element {
  const { t } = useTranslation();
  const [portDraft, setPortDraft] = useState(String(profile.automationPort ?? defaultAutomationPort ?? ''));
  const [copied, setCopied] = useState<'port' | 'token' | 'snippet' | null>(null);

  function copy(value: string, what: 'port' | 'token' | 'snippet'): void {
    void navigator.clipboard.writeText(value).then(() => {
      setCopied(what);
      setTimeout(() => setCopied(null), 1500);
    });
  }

  const puppeteerSnippet = profile.automationPort
    ? `const browser = await puppeteer.connect({\n  browserURL: 'http://127.0.0.1:${profile.automationPort}?token=${automationToken ?? '<token>'}',\n});`
    : '';

  return (
    <div>
      <table>
        <tbody>
          <tr>
            <th className="w-180">{t('editor.advanced.id')}</th>
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

      <div className="panel mt-16">
        <h4 className="fp-heading">
          <ShieldCheck size={16} strokeWidth={2.25} />
          {t('editor.advanced.automation.title')}
          {automationSaving && <span className="spinner" />}
        </h4>
        <p className="text-dim text-xs mt-0">{t('editor.advanced.automation.hint')}</p>

        <label className="field">
          <span className="inline-flex" style={{ alignItems: 'center', gap: 8 }}>
            <input
              type="checkbox"
              checked={profile.automationEnabled}
              onChange={(e) => {
                const enabled = e.target.checked;
                const port = enabled ? (Number(portDraft) || defaultAutomationPort || null) : profile.automationPort;
                onSaveAutomation({ automationEnabled: enabled, automationPort: port });
              }}
            />
            {t('editor.advanced.automation.enable')}
          </span>
        </label>

        {profile.automationEnabled && (
          <>
            <label className="field field-narrow">
              {t('editor.advanced.automation.port')}
              <input
                className="mono field-input-160"
                type="number"
                min={1024}
                max={65535}
                value={portDraft}
                onChange={(e) => setPortDraft(e.target.value)}
                onBlur={() => {
                  const port = Number(portDraft);
                  if (port && port !== profile.automationPort) onSaveAutomation({ automationPort: port });
                }}
              />
            </label>

            <label className="field">
              {t('editor.advanced.automation.token')}
              <div className="inline-flex" style={{ alignItems: 'center', gap: 8 }}>
                <input className="mono" readOnly value={automationToken ?? ''} style={{ width: 340 }} />
                <button
                  className="btn btn-ghost btn-sm"
                  type="button"
                  onClick={() => automationToken && copy(automationToken, 'token')}
                  title={t('editor.advanced.automation.copyToken')}
                >
                  <Copy size={14} />
                  {copied === 'token' ? t('common.copied') : t('common.copy')}
                </button>
                <button
                  className="btn btn-danger-ghost btn-sm"
                  type="button"
                  onClick={onRegenerateToken}
                  title={t('editor.advanced.automation.regenerateHint')}
                >
                  <RefreshCw size={14} />
                  {t('editor.advanced.automation.regenerate')}
                </button>
              </div>
            </label>

            {profile.automationPort && (
              <div className="mt-10">
                <p className="text-dim text-xs mb-4">{t('editor.advanced.automation.snippetHint')}</p>
                <div className="inline-flex" style={{ alignItems: 'flex-start', gap: 8 }}>
                  <pre className="mono text-xs" style={{ background: 'var(--char)', padding: 10, borderRadius: 8, margin: 0 }}>
                    {puppeteerSnippet}
                  </pre>
                  <button
                    className="btn btn-ghost btn-sm"
                    type="button"
                    onClick={() => copy(puppeteerSnippet, 'snippet')}
                  >
                    <Copy size={14} />
                    {copied === 'snippet' ? t('common.copied') : t('common.copy')}
                  </button>
                </div>
              </div>
            )}

            <div className="banner banner-warn mt-8 mb-0 text-xs">
              {t('editor.advanced.automation.warning')}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
