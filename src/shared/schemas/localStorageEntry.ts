import { z } from 'zod';

/** Unlike cookies (session-wide, via Electron's session.cookies API),
 * localStorage is per-origin and only reachable by executing JS in a page
 * currently loaded in one of the profile's tabs — see
 * profileWindowEntry.ts's localStorage: message handlers. `origin` is
 * included in the list response so the UI can show which origin these
 * entries actually belong to (the profile's primary/first tab's current
 * page), since that's implicit for cookies but not for localStorage. */
export const LocalStorageEntrySchema = z.object({
  key: z.string(),
  value: z.string(),
});
export type LocalStorageEntry = z.infer<typeof LocalStorageEntrySchema>;

export const LocalStorageListResponseSchema = z.object({
  origin: z.string(),
  items: z.array(LocalStorageEntrySchema),
});
export type LocalStorageListResponse = z.infer<typeof LocalStorageListResponseSchema>;

export const LocalStorageSetInputSchema = z.object({
  key: z.string().min(1),
  value: z.string(),
});
export type LocalStorageSetInput = z.infer<typeof LocalStorageSetInputSchema>;
