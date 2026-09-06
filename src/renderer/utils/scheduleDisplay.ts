import type { TranslationKey } from '../i18n';

/** Shared by AdvancedTab.tsx (the editor's own schedule panel) and
 * ProfilesTable.tsx (the table's "next auto-start" badge) so a schedule
 * reads identically in both places — was duplicated between the two
 * before being pulled out here. */
export const SCHEDULE_DAY_KEYS: TranslationKey[] = [
  'editor.advanced.schedule.day.0',
  'editor.advanced.schedule.day.1',
  'editor.advanced.schedule.day.2',
  'editor.advanced.schedule.day.3',
  'editor.advanced.schedule.day.4',
  'editor.advanced.schedule.day.5',
  'editor.advanced.schedule.day.6',
];

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** "Mon 09:00". */
export function formatNextRun(next: Date, t: (key: TranslationKey) => string): string {
  return `${t(SCHEDULE_DAY_KEYS[next.getDay()]!)} ${pad2(next.getHours())}:${pad2(next.getMinutes())}`;
}
