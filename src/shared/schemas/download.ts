import { z } from 'zod';

export const DownloadStateSchema = z.enum(['completed', 'cancelled', 'failed']);
export type DownloadState = z.infer<typeof DownloadStateSchema>;

export const DownloadRecordSchema = z.object({
  id: z.string().uuid(),
  profileId: z.string().uuid(),
  filename: z.string(),
  savePath: z.string(),
  url: z.string(),
  totalBytes: z.number().int().nonnegative(),
  state: DownloadStateSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type DownloadRecord = z.infer<typeof DownloadRecordSchema>;

/** What the renderer actually gets back from `downloads:list` — the stored
 * record plus two values only the main process can compute: whether the
 * file still exists on disk, and the owning profile's current name (profiles
 * can be renamed after a download completes, so this isn't denormalized
 * into the downloads table itself). */
export const DownloadWithStatusSchema = DownloadRecordSchema.extend({
  missing: z.boolean(),
  profileName: z.string(),
});
export type DownloadWithStatus = z.infer<typeof DownloadWithStatusSchema>;
