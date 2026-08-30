import { useEffect, useState } from 'react';
import type { ActivityLogEntry } from '@shared/schemas/activityLog';
import { callApi } from '../services/api';
import { describeError } from '../services/errorMessages';
import { useTranslation } from '../i18n';

export function LogsPage(): JSX.Element {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<ActivityLogEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    callApi<'logs:list', ActivityLogEntry[]>('logs:list', { limit: 200 })
      .then(setEntries)
      .catch((err: unknown) => setError(describeError(err, t)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function eventPillVariant(eventType: string): string {
    if (/ERROR|CRASH|FAIL/.test(eventType)) return 'danger';
    if (/DELETE|STOP|LOCK/.test(eventType)) return 'warn';
    return 'on';
  }

  return (
    <div className="content">
      {error && <div className="banner banner-error">{error}</div>}
      <div className="panel">
      <table>
        <thead>
          <tr>
            <th>{t('logs.table.time')}</th>
            <th>{t('logs.table.event')}</th>
            <th>{t('logs.table.profile')}</th>
            <th>{t('logs.table.message')}</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.id}>
              <td className="mono">{e.createdAt}</td>
              <td>
                <span className={`pill ${eventPillVariant(e.eventType)}`}>{e.eventType}</span>
              </td>
              <td className="mono">{e.profileId ?? '—'}</td>
              <td>{e.message}</td>
            </tr>
          ))}
          {entries.length === 0 && !error && (
            <tr>
              <td colSpan={4} style={{ color: 'var(--ash-dim)' }}>
                {t('logs.empty.none')}
              </td>
            </tr>
          )}
        </tbody>
      </table>
      </div>
    </div>
  );
}
