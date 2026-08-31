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
});
export type ProfileUpdateInput = z.infer<typeof ProfileUpdateInputSchema>;
