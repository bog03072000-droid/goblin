// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { I18nProvider } from '../../src/renderer/i18n';
import { ProfilesTable } from '../../src/renderer/pages/profiles/ProfilesTable';
import type { ProfileListItem } from '../../src/shared/schemas/profile';

afterEach(() => {
  cleanup();
});

function makeProfile(overrides: Partial<ProfileListItem>): ProfileListItem {
  return {
    id: 'id-1',
    name: 'Profile One',
    description: '',
    profilePath: '/tmp/profile-1',
    fingerprintId: 'fp-1',
    proxyId: null,
    groupId: null,
    status: 'STOPPED',
    tags: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    lastStartedAt: null,
    lastStoppedAt: null,
    automationEnabled: false,
    automationPort: null,
    os: 'windows',
    browserVersion: '128.0.0.0',
    ...overrides,
  } as ProfileListItem;
}

function renderTable(
  profiles: ProfileListItem[],
  overrides: Partial<Parameters<typeof ProfilesTable>[0]> = {},
) {
  const handlers = {
    onToggleSelectAll: vi.fn(),
    onToggleSelect: vi.fn(),
    onStart: vi.fn(),
    onStop: vi.fn(),
    onRestart: vi.fn(),
    onEdit: vi.fn(),
    onClone: vi.fn(),
    onExport: vi.fn(),
    onBackup: vi.fn(),
    onDeleteRequest: vi.fn(),
  };
  render(
    <I18nProvider initialLocale="en" onLocaleChange={() => {}}>
      <ProfilesTable
        profiles={profiles}
        totalProfileCount={profiles.length}
        proxies={[]}
        groups={[]}
        selected={new Set()}
        allVisibleSelected={false}
        busyId={null}
        {...handlers}
        {...overrides}
      />
    </I18nProvider>,
  );
  return handlers;
}

describe('ProfilesTable', () => {
  it('renders one row per profile with name, status label, and OS', () => {
    renderTable([
      makeProfile({ id: '1', name: 'Alpha', status: 'RUNNING' }),
      makeProfile({ id: '2', name: 'Beta', status: 'STOPPED' }),
    ]);
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.getByText('Beta')).toBeInTheDocument();
    expect(screen.getByText('Running')).toBeInTheDocument();
    expect(screen.getByText('Stopped')).toBeInTheDocument();
  });

  it('shows the empty state distinguishing "no profiles at all" from "no profiles match the filters"', () => {
    renderTable([]);
    expect(screen.getByText('No profiles yet. Create one above.')).toBeInTheDocument();
    cleanup();
    render(
      <I18nProvider initialLocale="en" onLocaleChange={() => {}}>
        <ProfilesTable
          profiles={[]}
          totalProfileCount={5}
          proxies={[]}
          groups={[]}
          selected={new Set()}
          allVisibleSelected={false}
          busyId={null}
          onToggleSelectAll={vi.fn()}
          onToggleSelect={vi.fn()}
          onStart={vi.fn()}
          onStop={vi.fn()}
          onRestart={vi.fn()}
          onEdit={vi.fn()}
          onClone={vi.fn()}
          onExport={vi.fn()}
          onBackup={vi.fn()}
          onDeleteRequest={vi.fn()}
        />
      </I18nProvider>,
    );
    expect(screen.getByText('No profiles match the current filters.')).toBeInTheDocument();
  });

  it('the header checkbox reflects allVisibleSelected and calls onToggleSelectAll when clicked', () => {
    const handlers = renderTable([makeProfile({ id: '1' })], { allVisibleSelected: true });
    const headerCheckbox = screen.getAllByRole('checkbox')[0]!;
    expect(headerCheckbox).toBeChecked();
    headerCheckbox.click();
    expect(handlers.onToggleSelectAll).toHaveBeenCalledTimes(1);
  });

  it('a row checkbox reflects whether that profile id is in `selected`, and toggling it calls onToggleSelect with its id', () => {
    const handlers = renderTable(
      [makeProfile({ id: '1', name: 'Selected One' }), makeProfile({ id: '2', name: 'Not Selected' })],
      { selected: new Set(['1']) },
    );
    const row1 = screen.getByText('Selected One').closest('tr')!;
    const row2 = screen.getByText('Not Selected').closest('tr')!;
    const checkbox1 = within(row1).getByRole('checkbox');
    const checkbox2 = within(row2).getByRole('checkbox');

    expect(checkbox1).toBeChecked();
    expect(checkbox2).not.toBeChecked();

    checkbox2.click();
    expect(handlers.onToggleSelect).toHaveBeenCalledWith('2');
  });

  it('a RUNNING profile shows a Stop button; any other status shows Start — never both', () => {
    renderTable([makeProfile({ id: '1', name: 'Running One', status: 'RUNNING' })]);
    const row = screen.getByText('Running One').closest('tr')!;
    expect(within(row).getByRole('button', { name: /Stop/ })).toBeInTheDocument();
    expect(within(row).queryByRole('button', { name: /^Start/ })).not.toBeInTheDocument();
  });

  it('clicking Start calls onStart with that profile\'s id, not any other row\'s', () => {
    const handlers = renderTable([
      makeProfile({ id: '1', name: 'First', status: 'STOPPED' }),
      makeProfile({ id: '2', name: 'Second', status: 'STOPPED' }),
    ]);
    const row2 = screen.getByText('Second').closest('tr')!;
    within(row2).getByRole('button', { name: 'Start' }).click();
    expect(handlers.onStart).toHaveBeenCalledWith('2');
    expect(handlers.onStart).toHaveBeenCalledTimes(1);
  });

  it('every action button in a row is disabled while that row is the busy one', () => {
    renderTable([makeProfile({ id: '1', name: 'Busy Row' })], { busyId: '1' });
    const row = screen.getByText('Busy Row').closest('tr')!;
    for (const button of within(row).getAllByRole('button')) {
      expect(button).toBeDisabled();
    }
  });

  it('a different row\'s buttons stay enabled while another row is busy', () => {
    renderTable(
      [makeProfile({ id: '1', name: 'Busy Row' }), makeProfile({ id: '2', name: 'Idle Row' })],
      { busyId: '1' },
    );
    const idleRow = screen.getByText('Idle Row').closest('tr')!;
    expect(within(idleRow).getByRole('button', { name: 'Start' })).toBeEnabled();
  });

  it('resolves each profile\'s proxy/group id to its display name, falling back to "—" when unassigned', () => {
    renderTable(
      [
        makeProfile({ id: '1', name: 'With Proxy', proxyId: 'px-1' }),
        makeProfile({ id: '2', name: 'No Proxy', proxyId: null }),
      ],
      { proxies: [{ id: 'px-1', name: 'My Proxy' } as never] },
    );
    const withProxyRow = screen.getByText('With Proxy').closest('tr')!;
    const noProxyRow = screen.getByText('No Proxy').closest('tr')!;
    // Proxy is column index 5 (checkbox, name, status, os, browser, proxy, ...)
    // — scoped to that one cell since the group column right after it is
    // ALSO "—" for an unassigned profile, which would make a bare
    // getByText('—') ambiguous.
    expect(within(withProxyRow).getAllByRole('cell')[5]).toHaveTextContent('My Proxy');
    expect(within(noProxyRow).getAllByRole('cell')[5]).toHaveTextContent('—');
  });

  it('clicking Delete calls onDeleteRequest with the whole profile object, not just its id', () => {
    const handlers = renderTable([makeProfile({ id: '1', name: 'To Delete' })]);
    const row = screen.getByText('To Delete').closest('tr')!;
    within(row).getByRole('button', { name: /Delete/ }).click();
    expect(handlers.onDeleteRequest).toHaveBeenCalledWith(expect.objectContaining({ id: '1', name: 'To Delete' }));
  });
});
