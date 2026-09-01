import { useState } from 'react';
import type { ProxyRecord, ProxyProtocol } from '@shared/schemas/proxy';
import { callApi } from '../services/api';
import { useAsyncAction } from '../hooks/useAsyncAction';
import { useTranslation } from '../i18n';

/**
 * Edits an existing proxy in place via the already-wired `proxy:update` IPC
 * channel (backend had no gap — only the UI never called it, so every proxy
 * edit used to mean delete + recreate). Password is intentionally excluded
 * from the update payload unless the user actually types a new one: the
 * backend never returns a stored password to the renderer (see
 * proxyRepository.ts's own doc comment), so an empty field here means
 * "leave it as-is", not "clear it" — only a non-empty field replaces it.
 */
export function EditProxyModal({ proxy, onClose, onSaved }: { proxy: ProxyRecord; onClose: () => void; onSaved: () => void }): JSX.Element {
  const { t } = useTranslation();
  const [form, setForm] = useState({
    name: proxy.name,
    protocol: proxy.protocol,
    host: proxy.host,
    port: proxy.port,
    username: proxy.username ?? '',
    password: '',
  });
  const { error, pending, run } = useAsyncAction();

  async function save(): Promise<void> {
    if (!form.name.trim() || !form.host.trim()) return;
    await run(async () => {
      await callApi('proxy:update', {
        id: proxy.id,
        name: form.name.trim(),
        protocol: form.protocol,
        host: form.host.trim(),
        port: Number(form.port),
        username: form.username || undefined,
        ...(form.password.trim() ? { password: form.password } : {}),
      });
      onSaved();
      onClose();
    });
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel modal-panel-sm" onClick={(e) => e.stopPropagation()}>
        <h3 className="mt-0">{t('proxy.edit.title')}</h3>
        {error && <div className="banner banner-error">{error}</div>}

        <label className="field">
          {t('proxy.namePlaceholder')}
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="field-input" />
        </label>
        <label className="field">
          {t('proxy.table.protocol')}
          <select
            value={form.protocol}
            onChange={(e) => setForm({ ...form, protocol: e.target.value as ProxyProtocol })}
            className="field-input"
          >
            <option value="http">HTTP</option>
            <option value="https">HTTPS</option>
            <option value="socks5">SOCKS5</option>
          </select>
        </label>
        <label className="field">
          {t('proxy.hostPlaceholder')}
          <input value={form.host} onChange={(e) => setForm({ ...form, host: e.target.value })} className="field-input" />
        </label>
        <label className="field">
          {t('proxy.portPlaceholder')}
          <input
            type="number"
            value={form.port}
            onChange={(e) => setForm({ ...form, port: Number(e.target.value) })}
            className="field-input"
          />
        </label>
        <label className="field">
          {t('proxy.usernamePlaceholder')}
          <input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} className="field-input" />
        </label>
        <label className="field mb-20">
          {t('proxy.edit.passwordPlaceholder')}
          <input
            type="password"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            placeholder={t('proxy.edit.passwordHint')}
            className="field-input"
          />
        </label>

        <div className="flex-row-end">
          <button className="btn btn-ghost btn-sm" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button className="btn btn-primary btn-sm" onClick={() => void save()} disabled={pending}>
            {t('common.save')}
          </button>
        </div>
      </div>
    </div>
  );
}
