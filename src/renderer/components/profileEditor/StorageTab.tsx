import { useState } from 'react';
import { Cookie, Trash2, RefreshCw, Plus } from 'lucide-react';
import type { CookieInfo, CookieSetInput } from '@shared/schemas/cookie';
import { useTranslation } from '../../i18n';

const EMPTY_DRAFT = { url: '', name: '', value: '', secure: true, httpOnly: false, persist: false };

function AddCookieForm({ onAdd }: { onAdd: (input: CookieSetInput) => void }): JSX.Element {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(EMPTY_DRAFT);

  function submit(): void {
    if (!draft.url.trim() || !draft.name.trim()) return;
    const url = /^[a-zA-Z]+:\/\//.test(draft.url.trim()) ? draft.url.trim() : `https://${draft.url.trim()}`;
    onAdd({
      url,
      name: draft.name.trim(),
      value: draft.value,
      secure: draft.secure,
      httpOnly: draft.httpOnly,
      // Omitted (undefined) means a session cookie in Electron's
      // session.cookies.set() — only sent when the user explicitly asks
      // for it to persist, one year out from now.
      expirationDate: draft.persist ? Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60 : undefined,
    });
    setDraft(EMPTY_DRAFT);
  }

  return (
    <div className="panel mt-16">
      <h4 className="fp-heading">
        <Plus size={16} strokeWidth={2.25} />
        {t('editor.storage.cookies.add.title')}
      </h4>
      <label className="field field-narrow">
        {t('editor.storage.cookies.url')}
        <input
          className="mono"
          placeholder="example.com"
          value={draft.url}
          onChange={(e) => setDraft({ ...draft, url: e.target.value })}
        />
      </label>
      <label className="field field-narrow">
        {t('editor.storage.cookies.name')}
        <input className="mono" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
      </label>
      <label className="field field-narrow">
        {t('editor.storage.cookies.value')}
        <input className="mono" value={draft.value} onChange={(e) => setDraft({ ...draft, value: e.target.value })} />
      </label>
      <label className="field">
        <span className="inline-flex" style={{ alignItems: 'center', gap: 8 }}>
          <input type="checkbox" checked={draft.secure} onChange={(e) => setDraft({ ...draft, secure: e.target.checked })} />
          {t('editor.storage.cookies.secure')}
        </span>
      </label>
      <label className="field">
        <span className="inline-flex" style={{ alignItems: 'center', gap: 8 }}>
          <input type="checkbox" checked={draft.httpOnly} onChange={(e) => setDraft({ ...draft, httpOnly: e.target.checked })} />
          {t('editor.storage.cookies.httpOnly')}
        </span>
      </label>
      <label className="field">
        <span className="inline-flex" style={{ alignItems: 'center', gap: 8 }}>
          <input type="checkbox" checked={draft.persist} onChange={(e) => setDraft({ ...draft, persist: e.target.checked })} />
          {t('editor.storage.cookies.persist')}
        </span>
      </label>
      <button className="btn btn-primary btn-sm" type="button" onClick={submit} disabled={!draft.url.trim() || !draft.name.trim()}>
        <Plus size={14} />
        {t('editor.storage.cookies.add.submit')}
      </button>
    </div>
  );
}

export function StorageTab({
  profilePath,
  onClearCache,
  isRunning,
  cookies,
  cookiesLoading,
  onRefreshCookies,
  onRemoveCookie,
  onAddCookie,
}: {
  profilePath: string;
  onClearCache: () => void;
  isRunning: boolean;
  cookies: CookieInfo[] | null;
  cookiesLoading: boolean;
  onRefreshCookies: () => void;
  onRemoveCookie: (cookie: CookieInfo) => void;
  onAddCookie: (input: CookieSetInput) => void;
}): JSX.Element {
  const { t } = useTranslation();
  return (
    <div>
      <p>
        <strong>{t('editor.storage.path')}</strong> <span className="mono">{profilePath}</span>
      </p>
      <p className="text-dim text-sm">{t('editor.storage.hint')}</p>
      <button className="btn btn-ghost btn-sm" onClick={onClearCache}>{t('editor.storage.clearCache')}</button>

      <div className="panel mt-16">
        <h4 className="fp-heading">
          <Cookie size={16} strokeWidth={2.25} />
          {t('editor.storage.cookies.title')}
          {cookiesLoading && <span className="spinner" />}
        </h4>

        {!isRunning && <p className="text-dim text-sm mt-0">{t('editor.storage.cookies.notRunning')}</p>}

        {isRunning && (
          <>
            <div className="fp-toolbar">
              <p className="text-dim text-xs mt-0 mb-0">{t('editor.storage.cookies.hint')}</p>
              <div className="flex-1" />
              <button className="btn btn-ghost btn-sm" type="button" onClick={onRefreshCookies}>
                <RefreshCw size={14} />
                {t('common.refresh')}
              </button>
            </div>

            {cookies && cookies.length === 0 && <p className="text-dim text-sm">{t('editor.storage.cookies.empty')}</p>}

            {cookies && cookies.length > 0 && (
              <table>
                <thead>
                  <tr>
                    <th>{t('editor.storage.cookies.domain')}</th>
                    <th>{t('editor.storage.cookies.name')}</th>
                    <th>{t('editor.storage.cookies.value')}</th>
                    <th>{t('editor.storage.cookies.expires')}</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {cookies.map((cookie) => (
                    <tr key={`${cookie.domain ?? ''}|${cookie.path ?? '/'}|${cookie.name}`}>
                      <td className="mono">{cookie.domain}</td>
                      <td className="mono">{cookie.name}</td>
                      <td className="mono" style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {cookie.value}
                      </td>
                      <td className="mono">
                        {cookie.expirationDate ? new Date(cookie.expirationDate * 1000).toLocaleDateString() : t('editor.storage.cookies.session')}
                      </td>
                      <td>
                        <button className="btn btn-danger-ghost btn-sm" type="button" onClick={() => onRemoveCookie(cookie)}>
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </div>

      {isRunning && <AddCookieForm onAdd={onAddCookie} />}
    </div>
  );
}
