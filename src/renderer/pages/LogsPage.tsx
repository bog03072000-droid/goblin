import { useEffect, useRef, useState } from 'react';
import { Download, ChevronDown, ChevronUp, CircleDot, Circle } from 'lucide-react';
import type { ActivityLogEntry, ActivityEventType } from '@shared/schemas/activityLog';
import type { ProfileListItem } from '@shared/schemas/profile';
import { callApi } from '../services/api';
import { useAsyncAction } from '../hooks/useAsyncAction';
import { useTranslation } from '../i18n';

const PAGE_SIZE = 50;

/** Below this length a message never actually overflows `.log-message`'s
 * own 480px/one-line truncation (roughly matches what fits at the app's
 * base font size), so showing an expand affordance for it would be
 * offering to reveal text that's already fully visible. */
const LOG_MESSAGE_EXPAND_THRESHOLD = 80;

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
  const exportAction = useAsyncAction();
  const [exportedInfo, setExportedInfo] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const latestIdRef = useRef<number | null>(null);

  function toggleExpanded(id: number): void {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

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

  /** Exports every entry matching the CURRENT filters (search/event
   * type/profile) — not just the page loaded on screen, which cursor
   * pagination means is often a small fraction of what actually matches.
   * The save dialog and file write both happen in the main process (see
   * logsExport.ts); this just reports the chosen path back, or does
   * nothing if the user cancelled the dialog. */
  async function exportLogs(): Promise<void> {
    setExportedInfo(null);
    await exportAction.run(async () => {
      const path = await callApi<'logs:export', string | null>('logs:export', {
        eventType: (eventTypeFilter || undefined) as ActivityEventType | undefined,
        profileId: profileFilter || undefined,
        search: debouncedSearch || undefined,
      });
      if (path) setExportedInfo(path);
    });
  }

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
        {/* A styled toggle button, not a plain checkbox — the design
            system's own "Live tail" treatment: a lime-wash pill with a
            pulsing dot while live, a neutral ghost pill while paused.
            Same underlying `live` boolean and polling effect as before,
            purely a visual/interaction swap. aria-label (not just visible
            text) keeps getByLabelText('Live') working for the existing
            test that toggles this control. */}
        <button
          className={`btn btn-sm ${live ? 'btn-live-on' : 'btn-ghost'}`}
          aria-label={t('logs.live')}
          title={live ? t('logs.live.pause') : t('logs.live.resume')}
          onClick={() => setLive((v) => !v)}
        >
          {live ? <CircleDot size={13} strokeWidth={2.25} className="pill-icon-pulse" /> : <Circle size={13} strokeWidth={2.25} />}
          {t('logs.live')}
        </button>
        <button className="btn btn-ghost" onClick={() => void exportLogs()} disabled={exportAction.pending}>
          <Download size={14} strokeWidth={2.25} />
          {exportAction.pending ? t('common.loading') : t('logs.export')}
        </button>
      </div>
      <div className="content">
        {error && <div className="banner banner-error">{error}</div>}
        {exportAction.error && <div className="banner banner-error">{exportAction.error}</div>}
        {exportedInfo && <div className="banner banner-success">{t('logs.export.success', { path: exportedInfo })}</div>}
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
                  <td>
                    {e.message.length > LOG_MESSAGE_EXPAND_THRESHOLD ? (
                      <button
                        type="button"
                        className="log-message-toggle"
                        onClick={() => toggleExpanded(e.id)}
                        title={expandedIds.has(e.id) ? t('logs.message.collapse') : t('logs.message.expand')}
                      >
                        {expandedIds.has(e.id) ? <ChevronUp size={13} strokeWidth={2.25} /> : <ChevronDown size={13} strokeWidth={2.25} />}
                        <span className={expandedIds.has(e.id) ? 'log-message log-message-expanded' : 'log-message'}>
                          {e.message}
                        </span>
                      </button>
                    ) : (
                      // Short enough to never truncate at the cell's own
                      // max-width — no expand affordance to show for
                      // something that's already showing everything.
                      <span className="log-message-short">{e.message}</span>
                    )}
                  </td>
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
