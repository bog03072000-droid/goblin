import { useEffect, useState } from 'react';
import type { ProxyRecord, ProxyProtocol, ProxyTestResult } from '@shared/schemas/proxy';
import { callApi } from '../services/api';
import { useTranslation } from '../i18n';

export function ProxiesPage(): JSX.Element {
  const { t } = useTranslation();
  const [proxies, setProxies] = useState<ProxyRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, ProxyTestResult>>({});
  const [form, setForm] = useState({ name: '', protocol: 'http' as ProxyProtocol, host: '', port: 8080, username: '', password: '' });

  async function refresh(): Promise<void> {
    try {
      const list = await callApi<'proxy:list', ProxyRecord[]>('proxy:list', {});
      setProxies(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function createProxy(): Promise<void> {
    if (!form.name.trim() || !form.host.trim()) return;
    try {
      await callApi('proxy:create', {
        name: form.name.trim(),
        protocol: form.protocol,
        host: form.host.trim(),
        port: Number(form.port),
        username: form.username || undefined,
        password: form.password || undefined,
      });
      setForm({ name: '', protocol: 'http', host: '', port: 8080, username: '', password: '' });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function test(id: string): Promise<void> {
    try {
      const result = await callApi<'proxy:test', ProxyTestResult>('proxy:test', { id });
      setResults((prev) => ({ ...prev, [id]: result }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function remove(id: string): Promise<void> {
    await callApi('proxy:delete', { id });
    await refresh();
  }

  return (
    <>
      <div className="toolbar">
        <input placeholder={t('proxy.namePlaceholder')} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <select value={form.protocol} onChange={(e) => setForm({ ...form, protocol: e.target.value as ProxyProtocol })}>
          <option value="http">HTTP</option>
          <option value="https">HTTPS</option>
          <option value="socks5">SOCKS5</option>
        </select>
        <input placeholder={t('proxy.hostPlaceholder')} value={form.host} onChange={(e) => setForm({ ...form, host: e.target.value })} />
        <input
          placeholder={t('proxy.portPlaceholder')}
          type="number"
          value={form.port}
          onChange={(e) => setForm({ ...form, port: Number(e.target.value) })}
          style={{ width: 80 }}
        />
        <input placeholder={t('proxy.usernamePlaceholder')} value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
        <input
          placeholder={t('proxy.passwordPlaceholder')}
          type="password"
          value={form.password}
          onChange={(e) => setForm({ ...form, password: e.target.value })}
        />
        <button className="primary" onClick={() => void createProxy()}>
          {t('proxy.create')}
        </button>
      </div>
      <div className="content">
        {error && <div className="error-banner">{error}</div>}
        <table>
          <thead>
            <tr>
              <th>{t('proxy.table.name')}</th>
              <th>{t('proxy.table.protocol')}</th>
              <th>{t('proxy.table.host')}</th>
              <th>{t('proxy.table.port')}</th>
              <th>{t('proxy.table.username')}</th>
              <th>{t('proxy.table.status')}</th>
              <th>{t('proxy.table.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {proxies.map((p) => (
              <tr key={p.id}>
                <td>{p.name}</td>
                <td>{p.protocol}</td>
                <td>{p.host}</td>
                <td>{p.port}</td>
                <td>{p.username ?? '—'}</td>
                <td>
                  {results[p.id]
                    ? results[p.id]!.success
                      ? t('proxy.status.ok', { ms: results[p.id]!.latencyMs ?? 0 })
                      : t('proxy.status.failed', { error: results[p.id]!.error ?? '' })
                    : '—'}
                </td>
                <td>
                  <button onClick={() => void test(p.id)}>{t('proxy.test')}</button>
                  <button onClick={() => void remove(p.id)}>{t('proxy.delete')}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
