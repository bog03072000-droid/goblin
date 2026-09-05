// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { I18nProvider } from '../../src/renderer/i18n';
import { ProfilesToolbar, UNGROUPED_FILTER, NO_PROXY_FILTER } from '../../src/renderer/pages/profiles/ProfilesToolbar';
import type { Group } from '../../src/shared/schemas/group';
import type { ProxyRecord } from '../../src/shared/schemas/proxy';
import type { Template } from '../../src/shared/schemas/template';

afterEach(() => {
  cleanup();
});

function makeGroup(overrides: Partial<Group> = {}): Group {
  return { id: 'group-1', name: 'Work', profileCount: 3, proxyPoolIds: [], createdAt: '', updatedAt: '', ...overrides } as Group;
}

function makeProxy(overrides: Partial<ProxyRecord> = {}): ProxyRecord {
  return {
    id: 'proxy-1',
    name: 'My Proxy',
    protocol: 'http',
    host: '1.2.3.4',
    port: 8080,
    username: null,
    lastCheckStatus: null,
    lastCheckedAt: null,
    lastCheckLatencyMs: null,
    createdAt: '',
    updatedAt: '',
    ...overrides,
  } as ProxyRecord;
}

function makeTemplate(overrides: Partial<Template> = {}): Template {
  return { id: 'tmpl-1', name: 'Windows Chrome', definition: {} as Template['definition'], createdAt: '', updatedAt: '', ...overrides } as Template;
}

/** Every handler is a fresh vi.fn() per render so each test can assert on
 * exactly the one it cares about without cross-test contamination — the
 * same pattern this project's other pure presentational-component tests
 * (FieldOverridesPicker.test.tsx) already use. */
function renderToolbar(overrides: Partial<Parameters<typeof ProfilesToolbar>[0]> = {}) {
  const handlers = {
    onSearchChange: vi.fn(),
    onStatusFilterChange: vi.fn(),
    onTagFilterChange: vi.fn(),
    onGroupFilterChange: vi.fn(),
    onManageGroups: vi.fn(),
    onProxyFilterChange: vi.fn(),
    onSortKeyChange: vi.fn(),
    onToggleSortDirection: vi.fn(),
    onInvertSelection: vi.fn(),
    onTemplateIdChange: vi.fn(),
    onNewNameChange: vi.fn(),
    onNewGroupIdChange: vi.fn(),
    onNewProxyIdChange: vi.fn(),
    onNewTagsChange: vi.fn(),
    onCreate: vi.fn(),
    onQuickCreate: vi.fn(),
    onImport: vi.fn(),
    onRestore: vi.fn(),
    onExportAll: vi.fn(),
  };
  render(
    <I18nProvider initialLocale="en" onLocaleChange={() => {}}>
      <ProfilesToolbar
        search=""
        statusFilter="ALL"
        tagFilter=""
        allTags={['important', 'test']}
        groupFilter=""
        groups={[makeGroup()]}
        proxyFilter=""
        proxies={[makeProxy()]}
        sortKey="name"
        sortDirection="asc"
        templateId=""
        templates={[makeTemplate()]}
        newName=""
        newGroupId=""
        newProxyId=""
        newTags=""
        quickCreatePending={false}
        {...handlers}
        {...overrides}
      />
    </I18nProvider>,
  );
  return handlers;
}

describe('ProfilesToolbar', () => {
  it('typing in the search box calls onSearchChange with the new value', () => {
    const handlers = renderToolbar();
    fireEvent.change(screen.getByPlaceholderText('Search profiles...'), { target: { value: 'work laptop' } });
    expect(handlers.onSearchChange).toHaveBeenCalledWith('work laptop');
  });

  it('lists every status option plus "All statuses", and selecting one calls onStatusFilterChange', () => {
    const handlers = renderToolbar();
    const select = screen.getByDisplayValue('All statuses') as HTMLSelectElement;
    expect(screen.getByRole('option', { name: 'Running' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Crashed' })).toBeInTheDocument();
    fireEvent.change(select, { target: { value: 'RUNNING' } });
    expect(handlers.onStatusFilterChange).toHaveBeenCalledWith('RUNNING');
  });

  it('renders every provided tag as a filter option', () => {
    renderToolbar({ allTags: ['alpha', 'beta'] });
    expect(screen.getByRole('option', { name: 'alpha' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'beta' })).toBeInTheDocument();
  });

  it('the group filter includes the real group (with its profile count) and the ungrouped sentinel', () => {
    const handlers = renderToolbar({ groups: [makeGroup({ id: 'g2', name: 'Scrapers', profileCount: 5 })] });
    expect(screen.getByRole('option', { name: 'Scrapers (5)' })).toBeInTheDocument();
    const select = screen.getByDisplayValue('All groups') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: UNGROUPED_FILTER } });
    expect(handlers.onGroupFilterChange).toHaveBeenCalledWith(UNGROUPED_FILTER);
  });

  it('the proxy filter includes the real proxy and the no-proxy sentinel', () => {
    // "Rotating Proxy" legitimately appears twice — once in this filter
    // select, once in the separate "assign a proxy to the new profile"
    // select just below it, both fed by the same `proxies` prop.
    const handlers = renderToolbar({ proxies: [makeProxy({ id: 'p2', name: 'Rotating Proxy' })] });
    expect(screen.getAllByRole('option', { name: 'Rotating Proxy' })).toHaveLength(2);
    const select = screen.getByDisplayValue('All proxies') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: NO_PROXY_FILTER } });
    expect(handlers.onProxyFilterChange).toHaveBeenCalledWith(NO_PROXY_FILTER);
  });

  it('"Manage Groups" calls onManageGroups', () => {
    const handlers = renderToolbar();
    fireEvent.click(screen.getByRole('button', { name: /Manage Groups/ }));
    expect(handlers.onManageGroups).toHaveBeenCalledTimes(1);
  });

  it('the sort-direction button shows the opposite-direction icon as its title and toggles on click', () => {
    const handlers = renderToolbar({ sortDirection: 'asc' });
    expect(screen.getByTitle('Ascending')).toBeInTheDocument();
    fireEvent.click(screen.getByTitle('Ascending'));
    expect(handlers.onToggleSortDirection).toHaveBeenCalledTimes(1);
  });

  it('"Invert selection" calls onInvertSelection', () => {
    const handlers = renderToolbar();
    fireEvent.click(screen.getByRole('button', { name: /Invert selection/ }));
    expect(handlers.onInvertSelection).toHaveBeenCalledTimes(1);
  });

  it('pressing Enter in the new-profile-name field calls onCreate', () => {
    const handlers = renderToolbar();
    fireEvent.keyDown(screen.getByPlaceholderText('New profile name'), { key: 'Enter' });
    expect(handlers.onCreate).toHaveBeenCalledTimes(1);
  });

  it('typing a name updates via onNewNameChange without triggering onCreate', () => {
    const handlers = renderToolbar();
    fireEvent.change(screen.getByPlaceholderText('New profile name'), { target: { value: 'New Bot' } });
    expect(handlers.onNewNameChange).toHaveBeenCalledWith('New Bot');
    expect(handlers.onCreate).not.toHaveBeenCalled();
  });

  it('"New Profile" (quick create) is disabled while pending and calls onQuickCreate otherwise', () => {
    const { rerender } = render(
      <I18nProvider initialLocale="en" onLocaleChange={() => {}}>
        <ProfilesToolbar
          search=""
          onSearchChange={() => {}}
          statusFilter="ALL"
          onStatusFilterChange={() => {}}
          tagFilter=""
          onTagFilterChange={() => {}}
          allTags={[]}
          groupFilter=""
          onGroupFilterChange={() => {}}
          groups={[]}
          onManageGroups={() => {}}
          proxyFilter=""
          onProxyFilterChange={() => {}}
          proxies={[]}
          sortKey="name"
          onSortKeyChange={() => {}}
          sortDirection="asc"
          onToggleSortDirection={() => {}}
          onInvertSelection={() => {}}
          templateId=""
          onTemplateIdChange={() => {}}
          templates={[]}
          newName=""
          onNewNameChange={() => {}}
          newGroupId=""
          onNewGroupIdChange={() => {}}
          newProxyId=""
          onNewProxyIdChange={() => {}}
          newTags=""
          onNewTagsChange={() => {}}
          onCreate={() => {}}
          onQuickCreate={() => {}}
          quickCreatePending={true}
          onImport={() => {}}
          onRestore={() => {}}
          onExportAll={() => {}}
        />
      </I18nProvider>,
    );
    expect(screen.getByRole('button', { name: /New Profile/ })).toBeDisabled();
    rerender(
      <I18nProvider initialLocale="en" onLocaleChange={() => {}}>
        <ProfilesToolbar
          search=""
          onSearchChange={() => {}}
          statusFilter="ALL"
          onStatusFilterChange={() => {}}
          tagFilter=""
          onTagFilterChange={() => {}}
          allTags={[]}
          groupFilter=""
          onGroupFilterChange={() => {}}
          groups={[]}
          onManageGroups={() => {}}
          proxyFilter=""
          onProxyFilterChange={() => {}}
          proxies={[]}
          sortKey="name"
          onSortKeyChange={() => {}}
          sortDirection="asc"
          onToggleSortDirection={() => {}}
          onInvertSelection={() => {}}
          templateId=""
          onTemplateIdChange={() => {}}
          templates={[]}
          newName=""
          onNewNameChange={() => {}}
          newGroupId=""
          onNewGroupIdChange={() => {}}
          newProxyId=""
          onNewProxyIdChange={() => {}}
          newTags=""
          onNewTagsChange={() => {}}
          onCreate={() => {}}
          onQuickCreate={() => {}}
          quickCreatePending={false}
          onImport={() => {}}
          onRestore={() => {}}
          onExportAll={() => {}}
        />
      </I18nProvider>,
    );
    expect(screen.getByRole('button', { name: /New Profile/ })).not.toBeDisabled();
  });

  it('"Custom setup" calls onCreate (the full-config-modal path, distinct from quick create)', () => {
    const handlers = renderToolbar();
    fireEvent.click(screen.getByRole('button', { name: /Custom setup/ }));
    expect(handlers.onCreate).toHaveBeenCalledTimes(1);
  });

  it('Import/Restore/Export All each call their own handler', () => {
    const handlers = renderToolbar();
    fireEvent.click(screen.getByRole('button', { name: /Import/ }));
    fireEvent.click(screen.getByRole('button', { name: /Restore/ }));
    fireEvent.click(screen.getByRole('button', { name: /Export All/ }));
    expect(handlers.onImport).toHaveBeenCalledTimes(1);
    expect(handlers.onRestore).toHaveBeenCalledTimes(1);
    expect(handlers.onExportAll).toHaveBeenCalledTimes(1);
  });

  it('the template select lists every provided template and reports a change', () => {
    const handlers = renderToolbar({ templates: [makeTemplate({ id: 't2', name: 'macOS Safari' })] });
    expect(screen.getByRole('option', { name: 'macOS Safari' })).toBeInTheDocument();
    fireEvent.change(screen.getByDisplayValue('Automatic (mixed)'), { target: { value: 't2' } });
    expect(handlers.onTemplateIdChange).toHaveBeenCalledWith('t2');
  });
});
