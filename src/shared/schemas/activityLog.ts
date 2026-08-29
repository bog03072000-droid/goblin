import { z } from 'zod';

export const ActivityEventTypeSchema = z.enum([
  'PROFILE_CREATED',
  'PROFILE_STARTED',
  'PROFILE_STOPPED',
  'PROFILE_CRASHED',
  'PROFILE_DELETED',
  'PROFILE_CLONED',
  'PROFILE_UPDATED',
  'PROXY_ASSIGNED',
  'FINGERPRINT_CHANGED',
  'PROFILE_IMPORTED',
  'PROFILE_EXPORTED',
  'PROFILE_BACKUP',
  'PROFILE_RESTORE',
]);
export type ActivityEventType = z.infer<typeof ActivityEventTypeSchema>;

export const ActivityLogEntrySchema = z.object({
  id: z.number().int(),
  eventType: ActivityEventTypeSchema,
  profileId: z.string().nullable(),
  message: z.string(),
  createdAt: z.string(),
});
export type ActivityLogEntry = z.infer<typeof ActivityLogEntrySchema>;
