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
// 24-hour "HH:MM" in the local system time zone — same posture as the rest
// of this app's time handling (no per-profile time zone selector; see
// docs/FINGERPRINT_AUDIT.md for why the fingerprint's own claimed time zone
// is a separate, independent concern from when the OS actually starts it).
export const ScheduleTimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Expected HH:MM (24-hour)');

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
});
export type ProfileUpdateInput = z.infer<typeof ProfileUpdateInputSchema>;
