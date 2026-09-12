import { z } from 'zod';
import { FingerprintInputSchema } from './fingerprint';

export const ProfileStatusSchema = z.enum([
  'STOPPED',
  'STARTING',
  'RUNNING',
  'STOPPING',
  'CRASHED',
  'LOCKED',
  'ERROR',
]);
export type ProfileStatus = z.infer<typeof ProfileStatusSchema>;

// JS Date.getDay() convention: 0 = Sunday ... 6 = Saturday. Used as-is (not
// remapped to an ISO Monday-first week) so ProfileScheduler's runOnce() can
// compare against `new Date().getDay()` directly with no translation layer.
export const ScheduleDaySchema = z.number().int().min(0).max(6);
// 24-hour "HH:MM", interpreted in scheduleTimezone if set, otherwise the
// local system time zone — same posture as the rest of this app's time
// handling for the "otherwise" case (see docs/FINGERPRINT_AUDIT.md for why
// the fingerprint's own claimed time zone is a separate, independent
// concern from when the OS actually starts a profile).
export const ScheduleTimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Expected HH:MM (24-hour)');

// A real IANA zone name (e.g. "Europe/Kyiv"), or null to keep the original
// behavior (the OS's own local time) — every profile created before this
// field existed has this as null and keeps working identically, unchanged.
// Not validated against Intl.supportedValuesOf('timeZone') at the schema
// level (that list is Node/engine-version-dependent and this schema is
// shared with the renderer, which builds the picker's own option list from
// the same real API — see ScheduleTab's own source) — an invalid/unknown
// zone is handled defensively where it's actually used (ProfileScheduler
// falls back to local time and logs a warning, same "one bad item doesn't
// stop the others" posture as the rest of that scheduler).
export const ScheduleTimezoneSchema = z.string().min(1).max(100);

// "recurring" (the original, still-default behavior: scheduleTime +
// scheduleDays, every matching week) vs "once" (scheduleOneTimeAt: a single
// absolute instant, never repeats, and disables scheduleEnabled the moment
// it fires — see ProfileScheduler).
export const ScheduleModeSchema = z.enum(['recurring', 'once']);
export type ScheduleMode = z.infer<typeof ScheduleModeSchema>;

// An absolute UTC instant (real ISO 8601, e.g. from `Date.toISOString()`),
// not a wall-clock HH:MM — a one-time schedule doesn't need a time zone to
// interpret it, since "this exact moment" is the same instant everywhere.
// The UI collects it via a local date/time picker (interpreted in
// scheduleTimezone if set, else the OS local zone) and converts to this
// absolute form before saving, the same way scheduleTime does the reverse
// (an absolute concept, converted to/from a zone at the UI boundary).
export const ScheduleOneTimeAtSchema = z.string().datetime({ offset: true });

// Profile IDs are generated server-side (main process). This pattern is enforced
// wherever a renderer-supplied ID is used to derive a filesystem path, to block
// path traversal (see src/main/storage/profileStorage.ts).
export const ProfileIdSchema = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, 'Invalid profile id');

export const ProfileSchema = z.object({
  id: ProfileIdSchema,
  name: z.string().min(1).max(120),
  description: z.string().max(2000).optional().default(''),
  profilePath: z.string().min(1),
  fingerprintId: z.string().uuid(),
  proxyId: z.string().uuid().nullable(),
  groupId: z.string().uuid().nullable(),
  status: ProfileStatusSchema,
  tags: z.array(z.string().min(1).max(60)).default([]),
  createdAt: z.string(),
  updatedAt: z.string(),
  lastStartedAt: z.string().nullable(),
  lastStoppedAt: z.string().nullable(),
  // The automation token itself is never part of this object (same posture
  // as a proxy's password) — see profiles:getAutomationToken. `automationPort`
  // must be unique across profiles the user runs simultaneously (each is a
  // separate OS process binding its own localhost port); the app doesn't
  // enforce that at save time, since it can't know which OTHER profiles will
  // actually be running at the same time as this one.
  automationEnabled: z.boolean(),
  automationPort: z.number().int().min(1024).max(65535).nullable(),
  // Recurring auto-start: "at this local HH:MM, on these days of the week,
  // start this profile if it isn't already running/starting" — see
  // ProfileScheduler for the actual check. `scheduleLastTriggeredAt` guards
  // against firing twice for the same matching minute (the scheduler polls
  // more often than once a minute) — not user-facing, not part of the
  // create/update input surface.
  scheduleEnabled: z.boolean(),
  scheduleTime: ScheduleTimeSchema.nullable(),
  scheduleDays: z.array(ScheduleDaySchema).nullable(),
  scheduleLastTriggeredAt: z.string().nullable(),
  // "recurring" (default, original behavior) or "once" — see
  // ScheduleModeSchema. scheduleTimezone applies to scheduleTime's HH:MM
  // (recurring only); scheduleOneTimeAt is a real absolute instant (once
  // only) and ignores scheduleTimezone entirely (see ScheduleOneTimeAtSchema).
  scheduleMode: ScheduleModeSchema,
  scheduleTimezone: ScheduleTimezoneSchema.nullable(),
  scheduleOneTimeAt: ScheduleOneTimeAtSchema.nullable(),
  // Absolute paths to unpacked Chrome extension directories loaded into
  // this profile's session on every start — see SECURITY.md's "Chrome
  // extension risks" section for what that actually grants (full
  // manifest-declared permissions, no additional sandboxing, no
  // signature/store verification). Empty by default; a bad/removed path is
  // skipped at launch (see profileWindowEntry.ts) rather than failing the
  // whole profile start.
  extensionPaths: z.array(z.string().min(1)).default([]),
});
export type Profile = z.infer<typeof ProfileSchema>;

/** What the profile list actually needs to show OS/Browser columns without an
 * N+1 fingerprint lookup per row — filled in via a single SQL join in
 * ProfileRepository.list(), not a separate round trip per profile. */
export interface ProfileListItem extends Profile {
  os: string;
  browserVersion: string;
}

export const ProfileCreateInputSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(2000).optional(),
  proxyId: z.string().uuid().nullable().optional(),
  groupId: z.string().uuid().nullable().optional(),
  tags: z.array(z.string().min(1).max(60)).optional(),
  templateId: z.string().optional(),
  // Optional fingerprint field overrides collected up front in the creation
  // modal (e.g. manual mode, spoofing toggles) — merged onto the
  // auto-generated base fingerprint server-side, same generator every other
  // creation path already uses. Omitted fields keep their generated value.
  fingerprint: FingerprintInputSchema.partial().optional(),
});
export type ProfileCreateInput = z.infer<typeof ProfileCreateInputSchema>;

export const ProfileUpdateInputSchema = z.object({
  id: ProfileIdSchema,
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(2000).optional(),
  proxyId: z.string().uuid().nullable().optional(),
  groupId: z.string().uuid().nullable().optional(),
  tags: z.array(z.string().min(1).max(60)).optional(),
  automationEnabled: z.boolean().optional(),
  automationPort: z.number().int().min(1024).max(65535).nullable().optional(),
  scheduleEnabled: z.boolean().optional(),
  scheduleTime: ScheduleTimeSchema.nullable().optional(),
  scheduleDays: z.array(ScheduleDaySchema).nullable().optional(),
  scheduleMode: ScheduleModeSchema.optional(),
  scheduleTimezone: ScheduleTimezoneSchema.nullable().optional(),
  scheduleOneTimeAt: ScheduleOneTimeAtSchema.nullable().optional(),
  extensionPaths: z.array(z.string().min(1)).optional(),
});
export type ProfileUpdateInput = z.infer<typeof ProfileUpdateInputSchema>;
