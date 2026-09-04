import { Fragment, useEffect, useState } from 'react';
import { PlugZap, Wifi, Pencil, Trash2, History, ChevronDown, ChevronUp } from 'lucide-react';
import type { ProxyRecord, ProxyProtocol, ProxyTestResult, ProxyCheckHistoryEntry } from '@shared/schemas/proxy';
import { callApi } from '../services/api';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { EditProxyModal } from '../components/EditProxyModal';
import { useAsyncAction } from '../hooks/useAsyncAction';
import { useTranslation } from '../i18n';

/** "3m ago" / "2h ago" / "just now" — used for the proxy health-check badge's
 * timestamp so it stays readable without a full date. */
function formatRelativeTime(iso: string, t: ReturnType<typeof useTranslation>['t']): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return t('proxy.status.justNow');
  if (minutes < 60) return t('proxy.status.minutesAgo', { n: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t('proxy.status.hoursAgo', { n: hours });
  return t('proxy.status.daysAgo', { n: Math.floor(hours / 24) });
}

export function ProxiesPage(): JSX.Element {
  const { t } = useTranslation();
  const [proxies, setProxies] = useState<ProxyRecord[]>([]);
  const [results, setResults] = useState<Record<string, ProxyTestResult>>({});
  const [form, setForm] = useState({ name: '', protocol: 'http' as ProxyProtocol, host: '', port: 8080, username: '', password: '' });
  const [confirmDeleteProxy, setConfirmDeleteProxy] = useState<ProxyRecord | null>(null);
  const [editingProxy, setEditingProxy] = useState<ProxyRecord | null>(null);
  // Which proxy's history panel is open (at most one at a time) and its
  // fetched rows, keyed by proxy id so switching back and forth doesn't
  // re-fetch a panel that was already loaded this session.
  const [expandedHistoryId, setExpandedHistoryId] = useState<string | null>(null);
  const [history, setHistory] = useState<Record<string, ProxyCheckHistoryEntry[]>>({});
  const historyAction = useAsyncAction();
  const { error, run } = useAsyncAction();
  const portInvalid = !Number.isInteger(form.port) || form.port < 1 || form.port > 65535;

  async function refresh(): Promise<void> {
    await run(async () => {
      const list = await callApi<'proxy:list', ProxyRecord[]>('proxy:list', {});
      setProxies(list);
    });
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function createProxy(): Promise<void> {
    if (!form.name.trim() || !form.host.trim() || portInvalid) return;
    await run(async () => {
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
    });
  }

  async function test(id: string): Promise<void> {
    await run(async () => {
      const result = await callApi<'proxy:test', ProxyTestResult>('proxy:test', { id });
      setResults((prev) => ({ ...prev, [id]: result }));
      // A manual test writes a new history row on the backend (see
      // proxy:test's handler) — drop the cached history for this proxy so
      // the panel re-fetches instead of showing a stale list if reopened.
      setHistory((prev) => {
        const { [id]: _drop, ...rest } = prev;
        return rest;
      });
    });
  }

  async function remove(id: string): Promise<void> {
    await run(async () => {
      await callApi('proxy:delete', { id });
      await refresh();
    });
  }

  /** Toggles the history panel for one proxy — fetches on first open only
   * (results.length===0 either way once loaded means "no checks yet", not
   * "not loaded yet"), so re-toggling the same proxy doesn't re-fetch. */
  async function toggleHistory(id: string): Promise<void> {
    if (expandedHistoryId === id) {
      setExpandedHistoryId(null);
      return;
    }
    setExpandedHistoryId(id);
    if (history[id]) return;
    await historyAction.run(async () => {
      const rows = await callApi<'proxy:checkHistory', ProxyCheckHistoryEntry[]>('proxy:checkHistory', { id });
      setHistory((prev) => ({ ...prev, [id]: rows }));
    });
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
          min={1}
          max={65535}
          value={form.port}
          onChange={(e) => setForm({ ...form, port: Number(e.target.value) })}
          className={portInvalid ? 'w-80 field-input-invalid' : 'w-80'}
          title={portInvalid ? t('proxy.portInvalid') : undefined}
        />
        <input placeholder={t('proxy.usernamePlaceholder')} value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
        <input
          placeholder={t('proxy.passwordPlaceholder')}
          type="password"
          value={form.password}
          onChange={(e) => setForm({ ...form, password: e.target.value })}
        />
        <button className="btn btn-primary" onClick={() => void createProxy()} disabled={portInvalid}>
          <PlugZap size={14} strokeWidth={2.25} />
          {t('proxy.create')}
        </button>
      </div>
      <div className="content">
        {error && <div className="banner banner-error">{error}</div>}
        {portInvalid && <div className="banner banner-error">{t('proxy.portInvalid')}</div>}
        <div className="panel">
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
              <Fragment key={p.id}>
              <tr>
                <td>{p.name}</td>
                <td>{p.protocol}</td>
                <td className="mono">{p.host}</td>
                <td className="mono">{p.port}</td>
                <td>{p.username ?? '—'}</td>
                <td>
                  {results[p.id] ? (
                    // A manual "Test" click this session always wins over the
                    // (possibly older) background-scheduler result below.
                    <span className={`pill ${results[p.id]!.success ? 'on' : 'danger'}`}>
                      {results[p.id]!.success
                        ? t('proxy.status.ok', { ms: results[p.id]!.latencyMs ?? 0 })
                        : t('proxy.status.failed', { error: results[p.id]!.error ?? '' })}
                    </span>
                  ) : p.lastCheckedAt ? (
                    // Persisted result from the periodic health-check
                    // scheduler (see proxyHealthScheduler.ts) or an earlier
                    // session's manual test — not just "no data yet".
                    <span className={`pill ${p.lastCheckStatus === 'OK' ? 'on' : 'danger'}`}>
                      {p.lastCheckStatus === 'OK'
                        ? t('proxy.status.autoOk', { ms: p.lastCheckLatencyMs ?? 0, when: formatRelativeTime(p.lastCheckedAt, t) })
                        : t('proxy.status.autoFail', { when: formatRelativeTime(p.lastCheckedAt, t) })}
                    </span>
                  ) : (
                    <span className="pill idle" title={t('proxy.status.neverChecked')}>
                      —
                    </span>
                  )}
                </td>
                <td>
                  <button className="btn btn-ghost btn-sm" onClick={() => void test(p.id)}>
                    <Wifi size={13} strokeWidth={2.25} />
                    {t('proxy.test')}
                  </button>
                  <button className="btn btn-ghost btn-sm" onClick={() => void toggleHistory(p.id)}>
                    <History size={13} strokeWidth={2.25} />
                    {t('proxy.history')}
                    {expandedHistoryId === p.id ? (
                      <ChevronUp size={13} strokeWidth={2.25} />
                    ) : (
                      <ChevronDown size={13} strokeWidth={2.25} />
                    )}
                  </button>
                  <button className="btn btn-ghost btn-sm" onClick={() => setEditingProxy(p)}>
                    <Pencil size={13} strokeWidth={2.25} />
                    {t('proxy.edit')}
                  </button>
                  <button className="btn btn-danger-ghost btn-sm" onClick={() => setConfirmDeleteProxy(p)}>
                    <Trash2 size={13} strokeWidth={2.25} />
                    {t('proxy.delete')}
                  </button>
                </td>
              </tr>
              {expandedHistoryId === p.id && (
                <tr className="proxy-history-row">
                  <td colSpan={7}>
                    {historyAction.pending && !history[p.id] ? (
                      <p className="text-dim text-sm m-0">{t('common.loading')}</p>
                    ) : !history[p.id] || history[p.id]!.length === 0 ? (
                      <p className="text-dim text-sm m-0">{t('proxy.history.empty')}</p>
                    ) : (
                      <table className="proxy-history-table">
                        <thead>
                          <tr>
                            <th>{t('proxy.history.when')}</th>
                            <th>{t('proxy.history.status')}</th>
                            <th>{t('proxy.history.latency')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {history[p.id]!.map((entry) => (
                            <tr key={entry.id}>
                              <td className="mono" title={new Date(entry.checkedAt).toLocaleString()}>
                                {formatRelativeTime(entry.checkedAt, t)}
                              </td>
                              <td>
                                <span className={`pill ${entry.status === 'OK' ? 'on' : 'danger'}`}>{entry.status}</span>
                              </td>
                              <td className="mono">{entry.latencyMs !== null ? `${entry.latencyMs}ms` : '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </td>
                </tr>
              )}
              </Fragment>
            ))}
            {proxies.length === 0 && (
              <tr>
                <td colSpan={7} className="text-dim">
                  {t('proxy.empty.none')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
        </div>
      </div>
      {confirmDeleteProxy && (
        <ConfirmDialog
          message={t('proxy.confirmDelete', { name: confirmDeleteProxy.name })}
          confirmLabel={t('proxy.delete')}
          onCancel={() => setConfirmDeleteProxy(null)}
          onConfirm={() => {
            const id = confirmDeleteProxy.id;
            setConfirmDeleteProxy(null);
            void remove(id);
          }}
        />
      )}
      {editingProxy && (
        <EditProxyModal proxy={editingProxy} onClose={() => setEditingProxy(null)} onSaved={() => void refresh()} />
      )}
    </>
  );
}
