import type { ProfileListItem } from '@shared/schemas/profile';
import { UNGROUPED_FILTER, NO_PROXY_FILTER, type StatusFilter, type SortKey, type SortDirection } from './ProfilesToolbar';

/**
 * The client-side filter/sort pipeline ProfilesPage.tsx's `visibleProfiles`
 * useMemo runs on every profiles/filter/sort change — extracted into a pure
 * function so it's testable directly (see visibleProfiles.test.ts) without
 * mounting the whole page or mocking IPC. The backend has no "ungrouped"/
 * "no proxy" filter concept (its id param is either a real id or "match
 * anything") — cheap enough to filter client-side rather than teach the IPC
 * contract two special sentinels.
 */
export function computeVisibleProfiles(
  profiles: ProfileListItem[],
  filters: { statusFilter: StatusFilter; groupFilter: string; proxyFilter: string },
  sort: { sortKey: SortKey; sortDirection: SortDirection },
): ProfileListItem[] {
  let filtered = filters.statusFilter === 'ALL' ? profiles : profiles.filter((p) => p.status === filters.statusFilter);
  if (filters.groupFilter === UNGROUPED_FILTER) filtered = filtered.filter((p) => p.groupId === null);
  if (filters.proxyFilter === NO_PROXY_FILTER) filtered = filtered.filter((p) => p.proxyId === null);
  else if (filters.proxyFilter) filtered = filtered.filter((p) => p.proxyId === filters.proxyFilter);

  const sorted = [...filtered];
  sorted.sort((a, b) => {
    let cmp: number;
    if (sort.sortKey === 'name') cmp = a.name.localeCompare(b.name);
    else if (sort.sortKey === 'status') cmp = a.status.localeCompare(b.status);
    else cmp = (a.lastStartedAt ?? '').localeCompare(b.lastStartedAt ?? '');
    return sort.sortDirection === 'asc' ? cmp : -cmp;
  });
  return sorted;
}
