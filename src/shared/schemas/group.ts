import { z } from 'zod';

export const GroupSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(80),
  createdAt: z.string(),
  profileCount: z.number().int().min(0),
});
export type Group = z.infer<typeof GroupSchema>;

export const GroupCreateInputSchema = z.object({ name: z.string().min(1).max(80) });
export const GroupRenameInputSchema = z.object({ id: z.string().uuid(), name: z.string().min(1).max(80) });
export const GroupDeleteInputSchema = z.object({ id: z.string().uuid() });
