import { z } from 'zod';
import {
  ProfileCreateInputSchema,
  ProfileUpdateInputSchema,
  ProfileIdSchema,
} from '../schemas/profile';
import { FingerprintInputSchema } from '../schemas/fingerprint';
import { ProxyInputSchema } from '../schemas/proxy';

/**
 * Central IPC contract registry. Every channel's request/response shape is
 * defined here as a Zod schema so the main process can validate any payload
 * arriving from the renderer before acting on it (renderer input is never trusted).
 */
export const IpcRequestSchemas = {
  'profiles:list': z.object({ search: z.string().optional(), tag: z.string().optional() }),
  'profiles:get': z.object({ id: ProfileIdSchema }),
  'profiles:create': ProfileCreateInputSchema,
  'profiles:update': ProfileUpdateInputSchema,
  'profiles:delete': z.object({ id: ProfileIdSchema }),
  'profiles:start': z.object({ id: ProfileIdSchema }),
  'profiles:stop': z.object({ id: ProfileIdSchema }),
  'profiles:restart': z.object({ id: ProfileIdSchema }),
  'profiles:clone': z.object({
    id: ProfileIdSchema,
    mode: z.enum(['config', 'full']),
    name: z.string().min(1).max(120),
  }),
  'profiles:clearCache': z.object({ id: ProfileIdSchema }),

  'fingerprint:generate': z.object({
    seed: z.string().min(1),
    templateId: z.string().optional(),
  }),
  'fingerprint:validate': FingerprintInputSchema,
  'fingerprint:update': z.object({ id: z.string().uuid() }).merge(FingerprintInputSchema.partial()),

  'proxy:list': z.object({}),
  'proxy:create': ProxyInputSchema,
  'proxy:update': z.object({ id: z.string().uuid() }).merge(ProxyInputSchema.partial()),
  'proxy:delete': z.object({ id: z.string().uuid() }),
  'proxy:test': z.object({ id: z.string().uuid() }),

  'logs:list': z.object({ limit: z.number().int().min(1).max(1000).default(200) }),
} as const;

export type IpcChannel = keyof typeof IpcRequestSchemas;
export type IpcRequest<C extends IpcChannel> = z.infer<(typeof IpcRequestSchemas)[C]>;
