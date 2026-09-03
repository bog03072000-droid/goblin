import { describe, it, expect } from 'vitest';
import type { ProfileListItem } from '../../src/shared/schemas/profile';
import { computeVisibleProfiles } from '../../src/renderer/pages/profiles/visibleProfiles';
import { UNGROUPED_FILTER, NO_PROXY_FILTER } from '../../src/renderer/pages/profiles/ProfilesToolbar';

function profile(overrides: Partial<ProfileListItem>): ProfileListItem {
  return {
    id: overrides.id ?? 'id',
    name: 'Profile',
    status: 'STOPPED',
    os: 'windows',
    browserVersion: '128.0.0.0',
    proxyId: null,
    groupId: null,
    tags: [],
    lastStartedAt: null,
    ...overrides,
  } as ProfileListItem;
}

describe('computeVisibleProfiles', () => {
  it('returns everything, sorted by name ascending, with default filters', () => {
    const profiles = [profile({ id: '1', name: 'Charlie' }), profile({ id: '2', name: 'Alice' }), profile({ id: '3', name: 'Bob' })];
    const result = computeVisibleProfiles(
      profiles,
      { statusFilter: 'ALL', groupFilter: '', proxyFilter: '' },
      { sortKey: 'name', sortDirection: 'asc' },
    );
    expect(result.map((p) => p.name)).toEqual(['Alice', 'Bob', 'Charlie']);
  });

  it('filters by exact status', () => {
    const profiles = [profile({ id: '1', status: 'RUNNING' }), profile({ id: '2', status: 'STOPPED' })];
    const result = computeVisibleProfiles(
      profiles,
      { statusFilter: 'RUNNING', groupFilter: '', proxyFilter: '' },
      { sortKey: 'name', sortDirection: 'asc' },
    );
    expect(result.map((p) => p.id)).toEqual(['1']);
  });

  it('the UNGROUPED_FILTER sentinel keeps only profiles with groupId === null, not a real group id', () => {
    const profiles = [profile({ id: '1', groupId: null }), profile({ id: '2', groupId: 'group-a' })];
    const result = computeVisibleProfiles(
      profiles,
      { statusFilter: 'ALL', groupFilter: UNGROUPED_FILTER, proxyFilter: '' },
      { sortKey: 'name', sortDirection: 'asc' },
    );
    expect(result.map((p) => p.id)).toEqual(['1']);
  });

  it('the NO_PROXY_FILTER sentinel keeps only profiles with proxyId === null', () => {
    const profiles = [profile({ id: '1', proxyId: null }), profile({ id: '2', proxyId: 'proxy-a' })];
    const result = computeVisibleProfiles(
      profiles,
      { statusFilter: 'ALL', groupFilter: '', proxyFilter: NO_PROXY_FILTER },
      { sortKey: 'name', sortDirection: 'asc' },
    );
    expect(result.map((p) => p.id)).toEqual(['1']);
  });

  it('a real proxy id filters to only profiles using that exact proxy', () => {
    const profiles = [
      profile({ id: '1', proxyId: 'proxy-a' }),
      profile({ id: '2', proxyId: 'proxy-b' }),
      profile({ id: '3', proxyId: null }),
    ];
    const result = computeVisibleProfiles(
      profiles,
      { statusFilter: 'ALL', groupFilter: '', proxyFilter: 'proxy-a' },
      { sortKey: 'name', sortDirection: 'asc' },
    );
    expect(result.map((p) => p.id)).toEqual(['1']);
  });

  it('sorts by status, and sortDirection "desc" reverses whichever key is active', () => {
    const profiles = [profile({ id: '1', status: 'STOPPED' }), profile({ id: '2', status: 'RUNNING' })];
    const asc = computeVisibleProfiles(
      profiles,
      { statusFilter: 'ALL', groupFilter: '', proxyFilter: '' },
      { sortKey: 'status', sortDirection: 'asc' },
    );
    // 'RUNNING' < 'STOPPED' lexicographically.
    expect(asc.map((p) => p.id)).toEqual(['2', '1']);

    const desc = computeVisibleProfiles(
      profiles,
      { statusFilter: 'ALL', groupFilter: '', proxyFilter: '' },
      { sortKey: 'status', sortDirection: 'desc' },
    );
    expect(desc.map((p) => p.id)).toEqual(['1', '2']);
  });

  it('sorts by lastUsed, treating a never-started profile (null) as sorting before any real timestamp', () => {
    const profiles = [
      profile({ id: '1', lastStartedAt: '2026-01-02T00:00:00.000Z' }),
      profile({ id: '2', lastStartedAt: null }),
      profile({ id: '3', lastStartedAt: '2026-01-01T00:00:00.000Z' }),
    ];
    const result = computeVisibleProfiles(
      profiles,
      { statusFilter: 'ALL', groupFilter: '', proxyFilter: '' },
      { sortKey: 'lastUsed', sortDirection: 'asc' },
    );
    expect(result.map((p) => p.id)).toEqual(['2', '3', '1']);
  });

  it('combines a status filter and a group filter together (both must match)', () => {
    const profiles = [
      profile({ id: '1', status: 'RUNNING', groupId: null }),
      profile({ id: '2', status: 'RUNNING', groupId: 'group-a' }),
      profile({ id: '3', status: 'STOPPED', groupId: null }),
    ];
    const result = computeVisibleProfiles(
      profiles,
      { statusFilter: 'RUNNING', groupFilter: UNGROUPED_FILTER, proxyFilter: '' },
      { sortKey: 'name', sortDirection: 'asc' },
    );
    expect(result.map((p) => p.id)).toEqual(['1']);
  });

  it('does not mutate the input array (returns a new sorted array)', () => {
    const profiles = [profile({ id: '1', name: 'B' }), profile({ id: '2', name: 'A' })];
    const original = [...profiles];
    computeVisibleProfiles(profiles, { statusFilter: 'ALL', groupFilter: '', proxyFilter: '' }, { sortKey: 'name', sortDirection: 'asc' });
    expect(profiles).toEqual(original);
  });
});
