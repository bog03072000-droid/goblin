import { useState } from 'react';
import { Copy, RefreshCw, ShieldCheck, CalendarClock } from 'lucide-react';
import type { Profile } from '@shared/schemas/profile';
import { computeNextScheduledRun } from '@shared/utils/scheduleNextRun';
import { SCHEDULE_DAY_KEYS, formatNextRun } from '../../utils/scheduleDisplay';
import { useTranslation } from '../../i18n';

export function AdvancedTab({
  profile,
  automationToken,
  defaultAutomationPort,
  automationSaving,
  onSaveAutomation,
  onRegenerateToken,
}: {
  profile: Profile;
  automationToken: string | null;
  defaultAutomationPort: number | null;
  automationSaving: boolean;
  onSaveAutomation: (patch: {
    automationEnabled?: boolean;
    automationPort?: number | null;
    scheduleEnabled?: boolean;
    scheduleTime?: string | null;
    scheduleDays?: number[] | null;
  }) => void;
  onRegenerateToken: () => void;
}): JSX.Element {
  const { t } = useTranslation();
  const [portDraft, setPortDraft] = useState(String(profile.automationPort ?? defaultAutomationPort ?? ''));
  const [copied, setCopied] = useState<'port' | 'token' | 'snippet' | null>(null);
  const portNum = Number(portDraft);
  const portInvalid = portDraft.trim() !== '' && (!Number.isInteger(portNum) || portNum < 1024 || portNum > 65535);
  const [timeDraft, setTimeDraft] = useState(profile.scheduleTime ?? '09:00');
  const scheduleDays = profile.scheduleDays ?? [];
  // Live preview, recomputed on every render from the current draft/day
  // selection — not the last-saved profile.scheduleTime/scheduleDays — so
  // it reacts to typing a time or toggling a day immediately, before the
  // onBlur/onClick save round-trip completes.
  const now = new Date();
  const nextRun = computeNextScheduledRun(now, timeDraft, scheduleDays);
  const todayAlreadyPassed = scheduleDays.includes(now.getDay()) && nextRun !== null && nextRun.toDateString() !== now.toDateString();

  function toggleScheduleDay(day: number): void {
    const next = scheduleDays.includes(day) ? scheduleDays.filter((d) => d !== day) : [...scheduleDays, day].sort();
    // Same defensive default as the "Enable scheduled start" checkbox
    // above, and needed for the same reason here too: a profile that
    // reached this screen with scheduleEnabled already true but
    // scheduleTime still null (e.g. the bulk "Enable schedule" action,
    // which deliberately leaves time/days unset — see
    // profileSchedule.spec.ts's own bulk test) would otherwise let a user
    // pick real days here while scheduleTime silently stays null forever,
    // the exact "looks configured, never actually fires" trap this file
    // already fixed once for the checkbox alone.
    const patch: Parameters<typeof onSaveAutomation>[0] = { scheduleDays: next };
    if (profile.scheduleTime === null && timeDraft) patch.scheduleTime = timeDraft;
    onSaveAutomation(patch);
  }

  function copy(value: string, what: 'port' | 'token' | 'snippet'): void {
    void navigator.clipboard.writeText(value).then(() => {
      setCopied(what);
      setTimeout(() => setCopied(null), 1500);
    });
  }

  const puppeteerSnippet = profile.automationPort
    ? `const browser = await puppeteer.connect({\n  browserURL: 'http://127.0.0.1:${profile.automationPort}?token=${automationToken ?? '<token>'}',\n});`
    : '';

  return (
    <div>
      <table>
        <tbody>
          <tr>
            <th className="w-180">{t('editor.advanced.id')}</th>
            <td className="mono">{profile.id}</td>
          </tr>
          <tr>
            <th>{t('editor.advanced.created')}</th>
            <td className="mono">{profile.createdAt}</td>
          </tr>
          <tr>
            <th>{t('editor.advanced.updated')}</th>
            <td className="mono">{profile.updatedAt}</td>
          </tr>
          <tr>
            <th>{t('editor.advanced.lastStarted')}</th>
            <td className="mono">{profile.lastStartedAt ?? '—'}</td>
          </tr>
          <tr>
            <th>{t('editor.advanced.lastStopped')}</th>
            <td className="mono">{profile.lastStoppedAt ?? '—'}</td>
          </tr>
        </tbody>
      </table>

      <div className="panel mt-16">
        <h4 className="fp-heading">
          <ShieldCheck size={16} strokeWidth={2.25} />
          {t('editor.advanced.automation.title')}
          {automationSaving && <span className="spinner" />}
        </h4>
        <p className="text-dim text-xs mt-0">{t('editor.advanced.automation.hint')}</p>

        <label className="field">
          <span className="inline-flex" style={{ alignItems: 'center', gap: 8 }}>
            <input
              type="checkbox"
              checked={profile.automationEnabled}
              onChange={(e) => {
                const enabled = e.target.checked;
                const port = enabled ? ((!portInvalid && Number(portDraft)) || defaultAutomationPort || null) : profile.automationPort;
                onSaveAutomation({ automationEnabled: enabled, automationPort: port });
              }}
            />
            {t('editor.advanced.automation.enable')}
          </span>
        </label>

        {profile.automationEnabled && (
          <>
            <label className="field field-narrow">
              {t('editor.advanced.automation.port')}
              <input
                className={portInvalid ? 'mono field-input-160 field-input-invalid' : 'mono field-input-160'}
                type="number"
                min={1024}
                max={65535}
                placeholder={t('editor.advanced.automation.portPlaceholder')}
                title={t('settings.defaultAutomationPort.hint')}
                value={portDraft}
                onChange={(e) => setPortDraft(e.target.value)}
                onBlur={() => {
                  if (portInvalid) return;
                  const port = Number(portDraft);
                  if (port && port !== profile.automationPort) onSaveAutomation({ automationPort: port });
                }}
              />
              {portInvalid && <p className="field-hint field-hint-error">{t('editor.advanced.automation.portInvalid')}</p>}
            </label>

            <label className="field">
              {t('editor.advanced.automation.token')}
              <div className="inline-flex" style={{ alignItems: 'center', gap: 8 }}>
                <input className="mono" readOnly value={automationToken ?? ''} style={{ width: 340 }} />
                <button
                  className="btn btn-ghost btn-sm"
                  type="button"
                  onClick={() => automationToken && copy(automationToken, 'token')}
                  title={t('editor.advanced.automation.copyToken')}
                >
                  <Copy size={14} />
                  {copied === 'token' ? t('common.copied') : t('common.copy')}
                </button>
                <button
                  className="btn btn-danger-ghost btn-sm"
                  type="button"
                  onClick={onRegenerateToken}
                  title={t('editor.advanced.automation.regenerateHint')}
                >
                  <RefreshCw size={14} />
                  {t('editor.advanced.automation.regenerate')}
                </button>
              </div>
            </label>

            {/* Found via a live E2E check: regenerating while RUNNING does
                NOT actually take effect for that already-running process —
                startAutomationProxy() captures its token once at launch,
                with no live-reload channel. The old token stays valid and
                the newly-shown one doesn't work until the profile is
                restarted — surfaced here instead of silently contradicting
                the button's own former "invalidates immediately" claim. */}
            {profile.status === 'RUNNING' && (
              <div className="banner banner-warn mt-8 mb-0 text-xs">
                {t('editor.advanced.automation.regenerateWhileRunning')}
              </div>
            )}

            {profile.automationPort && (
              <div className="mt-10">
                <p className="text-dim text-xs mb-4">{t('editor.advanced.automation.snippetHint')}</p>
                <div className="inline-flex" style={{ alignItems: 'flex-start', gap: 8 }}>
                  <pre className="mono text-xs" style={{ background: 'var(--char)', padding: 10, borderRadius: 8, margin: 0 }}>
                    {puppeteerSnippet}
                  </pre>
                  <button
                    className="btn btn-ghost btn-sm"
                    type="button"
                    onClick={() => copy(puppeteerSnippet, 'snippet')}
                  >
                    <Copy size={14} />
                    {copied === 'snippet' ? t('common.copied') : t('common.copy')}
                  </button>
                </div>
              </div>
            )}

            <div className="banner banner-warn mt-8 mb-0 text-xs">
              {t('editor.advanced.automation.warning')}
            </div>
          </>
        )}
      </div>

      <div className="panel mt-16">
        <h4 className="fp-heading">
          <CalendarClock size={16} strokeWidth={2.25} />
          {t('editor.advanced.schedule.title')}
          {automationSaving && <span className="spinner" />}
        </h4>
        <p className="text-dim text-xs mt-0">{t('editor.advanced.schedule.hint')}</p>

        <label className="field">
          <span className="inline-flex" style={{ alignItems: 'center', gap: 8 }}>
            <input
              type="checkbox"
              checked={profile.scheduleEnabled}
              onChange={(e) => {
                // scheduleTime only otherwise saves on the time input's own
                // onBlur — a real profile could end up with
                // scheduleEnabled: true, scheduleDays: [...], but
                // scheduleTime still null if the user enables the schedule
                // and picks days without ever focusing the time field.
                // computeNextScheduledRun() (and ProfileScheduler's own
                // real trigger check) both treat a null scheduleTime as "no
                // schedule" — so that combination would show a live "next
                // run" preview here from timeDraft's own UI-only default,
                // while the backend would never actually fire it. Saving
                // the current draft time in the same call the checkbox
                // itself makes keeps the persisted state honest from the
                // first toggle, not just after the user happens to touch
                // the time field too.
                const patch: Parameters<typeof onSaveAutomation>[0] = { scheduleEnabled: e.target.checked };
                if (e.target.checked && profile.scheduleTime === null && timeDraft) patch.scheduleTime = timeDraft;
                onSaveAutomation(patch);
              }}
            />
            {t('editor.advanced.schedule.enable')}
          </span>
        </label>

        {profile.scheduleEnabled && (
          <>
            <label className="field field-narrow">
              {t('editor.advanced.schedule.time')}
              <input
                type="time"
                className="mono field-input-160"
                value={timeDraft}
                onChange={(e) => setTimeDraft(e.target.value)}
                onBlur={() => {
                  if (timeDraft && timeDraft !== profile.scheduleTime) onSaveAutomation({ scheduleTime: timeDraft });
                }}
              />
            </label>

            <div className="field">
              <span>{t('editor.advanced.schedule.days')}</span>
              <div className="flex-row-gap6 mt-4">
                {SCHEDULE_DAY_KEYS.map((key, day) => (
                  <button
                    key={day}
                    type="button"
                    className={`btn btn-sm ${scheduleDays.includes(day) ? 'btn-primary' : 'btn-ghost'}`}
                    onClick={() => toggleScheduleDay(day)}
                  >
                    {t(key)}
                  </button>
                ))}
              </div>
              {scheduleDays.length === 0 && (
                <p className="field-hint field-hint-error">{t('editor.advanced.schedule.noDaysWarning')}</p>
              )}
              {nextRun && todayAlreadyPassed && (
                <p className="field-hint field-hint-warn">
                  {t('editor.advanced.schedule.todayPassed', { when: formatNextRun(nextRun, t) })}
                </p>
              )}
              {nextRun && !todayAlreadyPassed && (
                <p className="field-hint">{t('editor.advanced.schedule.nextRun', { when: formatNextRun(nextRun, t) })}</p>
              )}
            </div>

            {profile.scheduleLastTriggeredAt && (
              <p className="text-dim text-xs">
                {t('editor.advanced.schedule.lastTriggered')}: <span className="mono">{profile.scheduleLastTriggeredAt}</span>
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
