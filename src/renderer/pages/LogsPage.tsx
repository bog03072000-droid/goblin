import { useEffect, useRef, useState } from 'react';
import type { ActivityLogEntry, ActivityEventType } from '@shared/schemas/activityLog';
import type { ProfileListItem } from '@shared/schemas/profile';
import { callApi } from '../services/api';
import { useAsyncAction } from '../hooks/useAsyncAction';
import { useTranslation } from '../i18n';

const PAGE_SIZE = 50;

const EVENT_TYPES: ActivityEventType[] = [
  'PROFILE_CREATED',
  'PROFILE_STARTED',
  'PROFILE_STOPPED',
  'PROFILE_CRASHED',
  'PROFILE_DELETED',
  'PROFILE_DELETE_UNDONE',
  'PROFILE_CLONED',
  'PROFILE_UPDATED',
  'PROXY_ASSIGNED',
  'PROXY_CREATED',
  'PROXY_UPDATED',
  'PROXY_DELETED',
  'FINGERPRINT_CHANGED',
  'PROFILE_IMPORTED',
  'PROFILE_EXPORTED',
  'PROFILE_BACKUP',
  'PROFILE_RESTORE',
];

export function LogsPage(): JSX.Element {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<ActivityLogEntry[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [eventTypeFilter, setEventTypeFilter] = useState('');
  const [profileFilter, setProfileFilter] = useState('');
  const [profiles, setProfiles] = useState<ProfileListItem[]>([]);
  const [live, setLive] = useState(false);
  const { error, run } = useAsyncAction();
  const loadMoreAction = useAsyncAction();
  const latestIdRef = useRef<number | null>(null);

  // Matches ProfilesPage's own 250ms debounce for the same reason: avoid
  // firing an IPC round-trip (and a LIKE query) on every keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 250);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    void callApi<'profiles:list', ProfileListItem[]>('profiles:list', {}).then(setProfiles);
  }, []);

  async function loadFirstPage(): Promise<void> {
    await run(async () => {
      const list = await callApi<'logs:list', ActivityLogEntry[]>('logs:list', {
        limit: PAGE_SIZE,
        eventType: (eventTypeFilter || undefined) as ActivityEventType | undefined,
        profileId: profileFilter || undefined,
        search: debouncedSearch || undefined,
      });
      setEntries(list);
      setHasMore(list.length === PAGE_SIZE);
      latestIdRef.current = list[0]?.id ?? null;
    });
  }

  useEffect(() => {
    void loadFirstPage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch, eventTypeFilter, profileFilter]);

  async function loadMore(): Promise<void> {
    const lastId = entries[entries.length - 1]?.id;
    if (lastId === undefined) return;
    await loadMoreAction.run(async () => {
      const next = await callApi<'logs:list', ActivityLogEntry[]>('logs:list', {
        limit: PAGE_SIZE,
        beforeId: lastId,
        eventType: (eventTypeFilter || undefined) as ActivityEventType | undefined,
        profileId: profileFilter || undefined,
        search: debouncedSearch || undefined,
      });
      setEntries((prev) => [...prev, ...next]);
      setHasMore(next.length === PAGE_SIZE);
    });
  }

  // Live-tail: poll a cheap "what's the newest id" check rather than
  // re-running the full filtered query every tick — only refetches the
  // first page when something has actually changed. Disabled by default
  // since a growing table isn't always what you want mid-investigation.
  useEffect(() => {
    if (!live) return;
    const interval = setInterval(() => {
      void callApi<'logs:latestId', number | null>('logs:latestId', {}).then((id) => {
        if (id !== null && id !== latestIdRef.current) void loadFirstPage();
      });
    }, 3000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, debouncedSearch, eventTypeFilter, profileFilter]);

  function eventPillVariant(eventType: string): string {
    if (/ERROR|CRASH|FAIL/.test(eventType)) return 'danger';
    if (/DELETE|STOP|LOCK/.test(eventType)) return 'warn';
    return 'on';
  }

  function profileName(id: string | null): string {
    if (!id) return '—';
    return profiles.find((p) => p.id === id)?.name ?? id;
  }

  return (
    <>
      <div className="toolbar">
        <input
          placeholder={t('logs.searchPlaceholder')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select value={eventTypeFilter} onChange={(e) => setEventTypeFilter(e.target.value)}>
          <option value="">{t('logs.filter.allEvents')}</option>
          {EVENT_TYPES.map((et) => (
            <option key={et} value={et}>
              {et}
            </option>
          ))}
        </select>
        <select value={profileFilter} onChange={(e) => setProfileFilter(e.target.value)}>
          <option value="">{t('logs.filter.allProfiles')}</option>
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <label className="flex-row-gap6">
          <input type="checkbox" checked={live} onChange={(e) => setLive(e.target.checked)} />
          {t('logs.live')}
        </label>
      </div>
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
                  <td>{profileName(e.profileId)}</td>
                  <td>{e.message}</td>
                </tr>
              ))}
              {entries.length === 0 && !error && (
                <tr>
                  <td colSpan={4} className="text-dim">
                    {t('logs.empty.none')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {hasMore && (
          <button className="btn btn-ghost mt-12" onClick={() => void loadMore()} disabled={loadMoreAction.pending}>
            {t('logs.loadMore')}
          </button>
        )}
      </div>
    </>
  );
}
