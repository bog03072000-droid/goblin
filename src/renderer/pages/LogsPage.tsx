import { useEffect, useState } from 'react';
import type { ActivityLogEntry } from '@shared/schemas/activityLog';
import { callApi } from '../services/api';
import { useTranslation } from '../i18n';

export function LogsPage(): JSX.Element {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<ActivityLogEntry[]>([]);

  useEffect(() => {
    void callApi<'logs:list', ActivityLogEntry[]>('logs:list', { limit: 200 }).then(setEntries);
  }, []);

  return (
    <div className="content">
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
              <td>{e.createdAt}</td>
              <td>{e.eventType}</td>
              <td>{e.profileId ?? '—'}</td>
              <td>{e.message}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
