// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { I18nProvider } from '../../src/renderer/i18n';
import { AdvancedTab } from '../../src/renderer/components/profileEditor/AdvancedTab';
import type { Profile } from '../../src/shared/schemas/profile';

afterEach(() => {
  cleanup();
});

function makeProfile(overrides: Partial<Profile> = {}): Profile {
  return {
    id: 'p1',
    name: 'Work Bot',
    description: '',
    profilePath: '/data/p1',
    fingerprintId: 'fp1',
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
    scheduleEnabled: false,
    scheduleTime: null,
    scheduleDays: null,
    scheduleLastTriggeredAt: null,
    // Matches the real DB column default (014_schedule_timezone_and_once.sql)
    // — every existing test in this file implicitly exercises the
    // "recurring" mode, same as every profile that predates one-time
    // schedules and per-profile time zones.
    scheduleMode: 'recurring',
    scheduleTimezone: null,
    scheduleOneTimeAt: null,
    extensionPaths: [],
    ...overrides,
  } as Profile;
}

function renderTab(overrides: Partial<Parameters<typeof AdvancedTab>[0]> = {}) {
  const onSaveAutomation = vi.fn();
  const onRegenerateToken = vi.fn();
  const onPickExtensionDirectory = vi.fn(async () => null);
  render(
    <I18nProvider initialLocale="en" onLocaleChange={() => {}}>
      <AdvancedTab
        profile={makeProfile()}
        automationToken={null}
        defaultAutomationPort={null}
        automationSaving={false}
        onSaveAutomation={onSaveAutomation}
        onRegenerateToken={onRegenerateToken}
        onPickExtensionDirectory={onPickExtensionDirectory}
        {...overrides}
      />
    </I18nProvider>,
  );
  return { onSaveAutomation, onRegenerateToken, onPickExtensionDirectory };
}

describe('AdvancedTab — schedule', () => {
  it('shows the schedule section collapsed (no time/days) when scheduling is off', () => {
    renderTab({ profile: makeProfile({ scheduleEnabled: false }) });
    expect(screen.getByText('Scheduled auto-start')).toBeInTheDocument();
    expect(screen.queryByLabelText('Time')).not.toBeInTheDocument();
    expect(screen.queryByText('Days')).not.toBeInTheDocument();
  });

  it('checking "Enable scheduled start" on a profile with no stored time also saves the UI\'s own default time — a null scheduleTime would otherwise make the schedule never actually fire, even though the "next run" preview looks fine', () => {
    const { onSaveAutomation } = renderTab({ profile: makeProfile({ scheduleEnabled: false, scheduleTime: null }) });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Enable scheduled start' }));
    expect(onSaveAutomation).toHaveBeenCalledWith({ scheduleEnabled: true, scheduleTime: '09:00' });
  });

  it('checking it on a profile that already has a stored time does not re-send scheduleTime redundantly', () => {
    const { onSaveAutomation } = renderTab({ profile: makeProfile({ scheduleEnabled: false, scheduleTime: '14:30' }) });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Enable scheduled start' }));
    expect(onSaveAutomation).toHaveBeenCalledWith({ scheduleEnabled: true });
  });

  it('unchecking it calls onSaveAutomation with scheduleEnabled: false', () => {
    const { onSaveAutomation } = renderTab({ profile: makeProfile({ scheduleEnabled: true, scheduleTime: '09:00', scheduleDays: [1] }) });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Enable scheduled start' }));
    expect(onSaveAutomation).toHaveBeenCalledWith({ scheduleEnabled: false });
  });

  it('shows time input and day buttons once scheduling is enabled', () => {
    renderTab({ profile: makeProfile({ scheduleEnabled: true, scheduleTime: '09:00', scheduleDays: [1, 3] }) });
    expect(screen.getByDisplayValue('09:00')).toBeInTheDocument();
    for (const label of ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    }
  });

  it('changing the time and blurring saves it', () => {
    const { onSaveAutomation } = renderTab({ profile: makeProfile({ scheduleEnabled: true, scheduleTime: '09:00', scheduleDays: [1] }) });
    const timeInput = screen.getByDisplayValue('09:00');
    fireEvent.change(timeInput, { target: { value: '14:30' } });
    fireEvent.blur(timeInput);
    expect(onSaveAutomation).toHaveBeenCalledWith({ scheduleTime: '14:30' });
  });

  it('blurring again with the same value the profile already has does not re-save', () => {
    const { onSaveAutomation } = renderTab({ profile: makeProfile({ scheduleEnabled: true, scheduleTime: '09:00', scheduleDays: [1] }) });
    const timeInput = screen.getByDisplayValue('09:00');
    fireEvent.blur(timeInput); // never changed — draft still equals profile.scheduleTime
    expect(onSaveAutomation).not.toHaveBeenCalled();
  });

  it('clicking an unselected day adds it to scheduleDays, sorted', () => {
    const { onSaveAutomation } = renderTab({ profile: makeProfile({ scheduleEnabled: true, scheduleTime: '09:00', scheduleDays: [1, 5] }) });
    fireEvent.click(screen.getByRole('button', { name: 'Wed' })); // day 3
    expect(onSaveAutomation).toHaveBeenCalledWith({ scheduleDays: [1, 3, 5] });
  });

  it('clicking an already-selected day removes it from scheduleDays', () => {
    const { onSaveAutomation } = renderTab({ profile: makeProfile({ scheduleEnabled: true, scheduleTime: '09:00', scheduleDays: [1, 3, 5] }) });
    fireEvent.click(screen.getByRole('button', { name: 'Wed' }));
    expect(onSaveAutomation).toHaveBeenCalledWith({ scheduleDays: [1, 5] });
  });

  it('picking a day on a profile that reached this screen with scheduleEnabled already true but scheduleTime still null (e.g. after the bulk "Enable schedule" action) also saves the default time, not just the day', () => {
    const { onSaveAutomation } = renderTab({ profile: makeProfile({ scheduleEnabled: true, scheduleTime: null, scheduleDays: [] }) });
    fireEvent.click(screen.getByRole('button', { name: 'Wed' }));
    expect(onSaveAutomation).toHaveBeenCalledWith({ scheduleDays: [3], scheduleTime: '09:00' });
  });

  it('a selected day button carries the primary style, unselected days carry ghost', () => {
    renderTab({ profile: makeProfile({ scheduleEnabled: true, scheduleTime: '09:00', scheduleDays: [3] }) });
    expect(screen.getByRole('button', { name: 'Wed' }).className).toContain('btn-primary');
    expect(screen.getByRole('button', { name: 'Mon' }).className).toContain('btn-ghost');
  });

  it('shows a warning when scheduling is enabled but no day is selected', () => {
    renderTab({ profile: makeProfile({ scheduleEnabled: true, scheduleTime: '09:00', scheduleDays: [] }) });
    expect(screen.getByText('Pick at least one day for the schedule to actually run.')).toBeInTheDocument();
  });

  it('does not show the warning once at least one day is selected', () => {
    renderTab({ profile: makeProfile({ scheduleEnabled: true, scheduleTime: '09:00', scheduleDays: [2] }) });
    expect(screen.queryByText('Pick at least one day for the schedule to actually run.')).not.toBeInTheDocument();
  });

  it('shows the last-triggered timestamp when present, and nothing when null', () => {
    const { rerender } = render(
      <I18nProvider initialLocale="en" onLocaleChange={() => {}}>
        <AdvancedTab
          profile={makeProfile({ scheduleEnabled: true, scheduleTime: '09:00', scheduleDays: [1], scheduleLastTriggeredAt: '2026-09-02T09:00:00.000Z' })}
          automationToken={null}
          defaultAutomationPort={null}
          automationSaving={false}
          onSaveAutomation={() => {}}
          onRegenerateToken={() => {}}
        />
      </I18nProvider>,
    );
    expect(screen.getByText('2026-09-02T09:00:00.000Z')).toBeInTheDocument();

    rerender(
      <I18nProvider initialLocale="en" onLocaleChange={() => {}}>
        <AdvancedTab
          profile={makeProfile({ scheduleEnabled: true, scheduleTime: '09:00', scheduleDays: [1], scheduleLastTriggeredAt: null })}
          automationToken={null}
          defaultAutomationPort={null}
          automationSaving={false}
          onSaveAutomation={() => {}}
          onRegenerateToken={() => {}}
        />
      </I18nProvider>,
    );
    expect(screen.queryByText(/Last auto-started/)).not.toBeInTheDocument();
  });
});

describe('AdvancedTab — live schedule validation', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows a plain "next run" hint when the scheduled time has not passed today', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-07T08:00:00')); // Monday, before 09:00
    renderTab({ profile: makeProfile({ scheduleEnabled: true, scheduleTime: '09:00', scheduleDays: [1] }) });
    expect(screen.getByText('Next run: Mon 09:00')).toBeInTheDocument();
    expect(screen.queryByText(/already passed/)).not.toBeInTheDocument();
  });

  it('shows the "already passed today" hint when today is scheduled but its time has gone by', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-07T10:00:00')); // Monday, after 09:00
    renderTab({ profile: makeProfile({ scheduleEnabled: true, scheduleTime: '09:00', scheduleDays: [1] }) });
    expect(screen.getByText("Today's time has already passed — the first run will be Mon 09:00.")).toBeInTheDocument();
  });

  it('updates the live preview immediately when typing a new time, before blur/save', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-07T08:00:00')); // Monday, before either time
    renderTab({ profile: makeProfile({ scheduleEnabled: true, scheduleTime: '09:00', scheduleDays: [1] }) });
    const timeInput = screen.getByDisplayValue('09:00');
    fireEvent.change(timeInput, { target: { value: '07:00' } }); // now in the past today
    expect(screen.getByText("Today's time has already passed — the first run will be Mon 07:00.")).toBeInTheDocument();
  });

  it('updates the live preview immediately when toggling a day, before save', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-07T08:00:00')); // Monday
    renderTab({ profile: makeProfile({ scheduleEnabled: true, scheduleTime: '09:00', scheduleDays: [3] }) }); // Wednesday only
    expect(screen.getByText('Next run: Wed 09:00')).toBeInTheDocument();
  });

  it('shows no next-run hint at all when no days are selected (only the noDaysWarning)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-07T08:00:00'));
    renderTab({ profile: makeProfile({ scheduleEnabled: true, scheduleTime: '09:00', scheduleDays: [] }) });
    expect(screen.queryByText(/Next run:/)).not.toBeInTheDocument();
    expect(screen.queryByText(/already passed/)).not.toBeInTheDocument();
  });
});

describe('AdvancedTab — schedule mode/timezone/one-time', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('defaults to showing the recurring time/days UI, and clicking "One-time" switches the mode', () => {
    const { onSaveAutomation } = renderTab({ profile: makeProfile({ scheduleEnabled: true, scheduleTime: '09:00', scheduleDays: [1] }) });
    expect(screen.getByDisplayValue('09:00')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'One-time' }));
    expect(onSaveAutomation).toHaveBeenCalledWith({ scheduleMode: 'once' });
  });

  it('shows the one-time date/time picker instead of time/days once scheduleMode is "once"', () => {
    renderTab({ profile: makeProfile({ scheduleEnabled: true, scheduleMode: 'once', scheduleOneTimeAt: null }) });
    expect(screen.getByText('Start at')).toBeInTheDocument();
    expect(screen.queryByText('Days')).not.toBeInTheDocument();
  });

  it('clicking "Recurring" while already on "once" switches back, and does not re-send the same mode redundantly', () => {
    const { onSaveAutomation } = renderTab({ profile: makeProfile({ scheduleEnabled: true, scheduleMode: 'once' }) });
    fireEvent.click(screen.getByRole('button', { name: 'One-time' })); // already "once" — no-op
    expect(onSaveAutomation).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Recurring' }));
    expect(onSaveAutomation).toHaveBeenCalledWith({ scheduleMode: 'recurring' });
  });

  it('changing the time zone select saves scheduleTimezone, and picking "System" back saves null', () => {
    const { onSaveAutomation } = renderTab({ profile: makeProfile({ scheduleEnabled: true, scheduleTime: '09:00', scheduleDays: [1] }) });
    const select = screen.getByLabelText('Time zone') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'Asia/Tokyo' } });
    expect(onSaveAutomation).toHaveBeenCalledWith({ scheduleTimezone: 'Asia/Tokyo' });

    fireEvent.change(select, { target: { value: '' } });
    expect(onSaveAutomation).toHaveBeenCalledWith({ scheduleTimezone: null });
  });

  it('shows a missing-date warning for a one-time schedule with no scheduleOneTimeAt set yet', () => {
    renderTab({ profile: makeProfile({ scheduleEnabled: true, scheduleMode: 'once', scheduleOneTimeAt: null }) });
    expect(screen.getByText('Pick a date and time for the schedule to actually run.')).toBeInTheDocument();
  });

  it('entering a future one-time date/time and blurring saves it as a real absolute UTC instant', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-07T08:00:00'));
    const { onSaveAutomation } = renderTab({ profile: makeProfile({ scheduleEnabled: true, scheduleMode: 'once', scheduleOneTimeAt: null }) });
    const input = screen.getByLabelText('Start at') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '2026-12-25T08:00' } });
    fireEvent.blur(input);
    expect(onSaveAutomation).toHaveBeenCalledWith({ scheduleOneTimeAt: new Date('2026-12-25T08:00').toISOString() });
  });

  it('shows the "already passed" warning for a one-time moment in the past, and a plain next-run hint for one in the future', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-07T08:00:00'));
    // Two independent renders, not a rerender of the same instance —
    // oneTimeDraft is local useState seeded once from the initial profile
    // prop (same established pattern as timeDraft/scheduleDays elsewhere in
    // this component), so swapping the profile prop on an existing instance
    // wouldn't reset that draft; a fresh render is what actually exercises
    // "this profile's own passed-vs-future state", not a same-instance prop
    // swap this component was never designed to react to live.
    renderTab({ profile: makeProfile({ scheduleEnabled: true, scheduleMode: 'once', scheduleOneTimeAt: '2020-01-01T00:00:00.000Z' }) });
    expect(screen.getByText(/already passed/)).toBeInTheDocument();
    cleanup();

    renderTab({ profile: makeProfile({ scheduleEnabled: true, scheduleMode: 'once', scheduleOneTimeAt: '2030-01-01T00:00:00.000Z' }) });
    expect(screen.queryByText(/already passed/)).not.toBeInTheDocument();
    expect(screen.getByText(/Next run:/)).toBeInTheDocument();
  });
});

describe('AdvancedTab — automation token regenerate while running', () => {
  // Found via a live E2E check: startAutomationProxy() captures its token
  // once at profile-process launch, with no live channel telling an
  // already-running profile's proxy that the DB's token changed —
  // regenerating while RUNNING does not actually take effect until the
  // profile restarts, contradicting the button's own former "invalidates
  // immediately" wording. This warning is the fix for the false claim,
  // shown only when it's actually true.
  it('shows the "takes effect after restart" warning when the profile is RUNNING', () => {
    renderTab({ profile: makeProfile({ automationEnabled: true, automationPort: 9222, status: 'RUNNING' }) });
    expect(
      screen.getByText("This profile is currently running — the OLD token stays valid, and the new one won't work, until you restart it."),
    ).toBeInTheDocument();
  });

  it('does not show the warning when the profile is stopped', () => {
    renderTab({ profile: makeProfile({ automationEnabled: true, automationPort: 9222, status: 'STOPPED' }) });
    expect(screen.queryByText(/currently running/)).not.toBeInTheDocument();
  });

  it('the Regenerate button hint no longer overclaims "immediately"', () => {
    renderTab({ profile: makeProfile({ automationEnabled: true, automationPort: 9222 }) });
    expect(screen.getByTitle('Generates a new token. Takes effect the next time this profile starts.')).toBeInTheDocument();
  });
});

describe('AdvancedTab — Chrome extensions', () => {
  it('always shows the security warning, not just on first add', () => {
    renderTab();
    expect(screen.getByText(/full permissions its manifest declares/)).toBeInTheDocument();
  });

  it('shows no list when no extensions are configured', () => {
    renderTab({ profile: makeProfile({ extensionPaths: [] }) });
    expect(screen.queryByTitle('Remove this extension')).not.toBeInTheDocument();
  });

  it('lists every configured extension path with a remove button', () => {
    renderTab({ profile: makeProfile({ extensionPaths: ['/ext/one', '/ext/two'] }) });
    expect(screen.getByText('/ext/one')).toBeInTheDocument();
    expect(screen.getByText('/ext/two')).toBeInTheDocument();
    expect(screen.getAllByTitle('Remove this extension')).toHaveLength(2);
  });

  it('clicking "Add extension…" calls onPickExtensionDirectory and saves the returned path', async () => {
    const onPickExtensionDirectory = vi.fn(async () => ({ path: '/picked/ext', name: 'Picked', manifestVersion: 3 }));
    const { onSaveAutomation } = renderTab({
      profile: makeProfile({ extensionPaths: ['/existing'] }),
      onPickExtensionDirectory,
    });

    fireEvent.click(screen.getByText('Add extension…'));
    await vi.waitFor(() => expect(onSaveAutomation).toHaveBeenCalledWith({ extensionPaths: ['/existing', '/picked/ext'] }));
  });

  it('cancelling the native dialog (null result) saves nothing', async () => {
    const onPickExtensionDirectory = vi.fn(async () => null);
    const { onSaveAutomation } = renderTab({ onPickExtensionDirectory });

    fireEvent.click(screen.getByText('Add extension…'));
    await vi.waitFor(() => expect(onPickExtensionDirectory).toHaveBeenCalled());
    expect(onSaveAutomation).not.toHaveBeenCalled();
  });

  it('picking a directory that is not a real extension shows the thrown error instead of saving', async () => {
    const onPickExtensionDirectory = vi.fn(async () => {
      throw new Error('This folder has no manifest.json');
    });
    const { onSaveAutomation } = renderTab({ onPickExtensionDirectory });

    fireEvent.click(screen.getByText('Add extension…'));
    await screen.findByText('This folder has no manifest.json');
    expect(onSaveAutomation).not.toHaveBeenCalled();
  });

  it('does not add the same path twice', async () => {
    const onPickExtensionDirectory = vi.fn(async () => ({ path: '/existing', name: 'X', manifestVersion: 3 }));
    const { onSaveAutomation } = renderTab({
      profile: makeProfile({ extensionPaths: ['/existing'] }),
      onPickExtensionDirectory,
    });

    fireEvent.click(screen.getByText('Add extension…'));
    await vi.waitFor(() => expect(onPickExtensionDirectory).toHaveBeenCalled());
    expect(onSaveAutomation).not.toHaveBeenCalled();
  });

  it('clicking a path\'s Remove button saves the list without that path', () => {
    const { onSaveAutomation } = renderTab({ profile: makeProfile({ extensionPaths: ['/ext/one', '/ext/two'] }) });

    fireEvent.click(screen.getAllByTitle('Remove this extension')[0]!);

    expect(onSaveAutomation).toHaveBeenCalledWith({ extensionPaths: ['/ext/two'] });
  });
});
