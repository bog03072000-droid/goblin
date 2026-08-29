import { z } from 'zod';

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
  status: ProfileStatusSchema,
  tags: z.array(z.string().min(1).max(60)).default([]),
  createdAt: z.string(),
  updatedAt: z.string(),
  lastStartedAt: z.string().nullable(),
  lastStoppedAt: z.string().nullable(),
});
export type Profile = z.infer<typeof ProfileSchema>;

export const ProfileCreateInputSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(2000).optional(),
  proxyId: z.string().uuid().nullable().optional(),
  tags: z.array(z.string().min(1).max(60)).optional(),
  templateId: z.string().optional(),
});
export type ProfileCreateInput = z.infer<typeof ProfileCreateInputSchema>;

export const ProfileUpdateInputSchema = z.object({
  id: ProfileIdSchema,
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(2000).optional(),
  proxyId: z.string().uuid().nullable().optional(),
  tags: z.array(z.string().min(1).max(60)).optional(),
});
export type ProfileUpdateInput = z.infer<typeof ProfileUpdateInputSchema>;
