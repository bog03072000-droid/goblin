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
    ...overrides,
  } as Profile;
}

function renderTab(overrides: Partial<Parameters<typeof AdvancedTab>[0]> = {}) {
  const onSaveAutomation = vi.fn();
  const onRegenerateToken = vi.fn();
  render(
    <I18nProvider initialLocale="en" onLocaleChange={() => {}}>
      <AdvancedTab
        profile={makeProfile()}
        automationToken={null}
        defaultAutomationPort={null}
        automationSaving={false}
        onSaveAutomation={onSaveAutomation}
        onRegenerateToken={onRegenerateToken}
        {...overrides}
      />
    </I18nProvider>,
  );
  return { onSaveAutomation, onRegenerateToken };
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
