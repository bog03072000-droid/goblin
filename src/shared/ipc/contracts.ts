import { z } from 'zod';
import {
  ProfileCreateInputSchema,
  ProfileUpdateInputSchema,
  ProfileIdSchema,
} from '../schemas/profile';
import { FingerprintInputSchema, OsSchema } from '../schemas/fingerprint';
import { ProxyInputSchema } from '../schemas/proxy';
import { SettingsUpdateSchema } from '../schemas/settings';
import { GroupCreateInputSchema, GroupRenameInputSchema, GroupDeleteInputSchema } from '../schemas/group';
import { ActivityEventTypeSchema } from '../schemas/activityLog';
import { CookieSetInputSchema } from '../schemas/cookie';
import { LocalStorageSetInputSchema } from '../schemas/localStorageEntry';

/**
 * Central IPC contract registry. Every channel's request/response shape is
 * defined here as a Zod schema so the main process can validate any payload
 * arriving from the renderer before acting on it (renderer input is never trusted).
 */
export const IpcRequestSchemas = {
  'profiles:list': z.object({
    search: z.string().optional(),
    tag: z.string().optional(),
    groupId: z.string().uuid().optional(),
  }),
  'profiles:get': z.object({ id: ProfileIdSchema }),
  'profiles:create': ProfileCreateInputSchema,
  'profiles:update': ProfileUpdateInputSchema,
  'profiles:getAutomationToken': z.object({ id: ProfileIdSchema }),
  'profiles:regenerateAutomationToken': z.object({ id: ProfileIdSchema }),
  'profiles:delete': z.object({ id: ProfileIdSchema }),
  'profiles:restoreDeleted': z.object({ id: ProfileIdSchema }),
  'profiles:start': z.object({ id: ProfileIdSchema }),
  'profiles:stop': z.object({ id: ProfileIdSchema }),
  'profiles:restart': z.object({ id: ProfileIdSchema }),
  'profiles:clone': z.object({
    id: ProfileIdSchema,
    mode: z.enum(['config', 'full']),
    name: z.string().min(1).max(120),
  }),
  'profiles:clearCache': z.object({ id: ProfileIdSchema }),
  'profiles:cookies:list': z.object({ id: ProfileIdSchema }),
  'profiles:cookies:remove': z.object({ id: ProfileIdSchema, url: z.string(), name: z.string() }),
  'profiles:cookies:set': z.object({ id: ProfileIdSchema, cookie: CookieSetInputSchema }),
  'profiles:localStorage:list': z.object({ id: ProfileIdSchema }),
  'profiles:localStorage:set': z.object({ id: ProfileIdSchema, item: LocalStorageSetInputSchema }),
  'profiles:localStorage:remove': z.object({ id: ProfileIdSchema, key: z.string() }),

  'fingerprint:get': z.object({ id: z.string().uuid() }),
  'fingerprint:generate': z.object({
    seed: z.string().min(1),
    templateId: z.string().optional(),
    // Explicit "choose instead of Auto" overrides — see generator.ts's
    // GenerateFingerprintOptions for how each is validated against the
    // resolved platform's own real option lists rather than trusted as-is.
    os: OsSchema.optional(),
    osVersion: z.string().optional(),
    browserVersion: z.string().optional(),
    screenWidth: z.number().int().optional(),
    screenHeight: z.number().int().optional(),
    hardwareConcurrency: z.number().int().optional(),
    deviceMemory: z.number().int().optional(),
    webglVendor: z.string().optional(),
    webglRenderer: z.string().optional(),
  }),
  'fingerprint:options': z.object({}),
  'fingerprint:validate': FingerprintInputSchema,
  'fingerprint:update': z.object({ id: z.string().uuid() }).merge(FingerprintInputSchema.partial()),

  'proxy:list': z.object({}),
  'proxy:create': ProxyInputSchema,
  'proxy:update': z.object({ id: z.string().uuid() }).merge(ProxyInputSchema.partial()),
  'proxy:delete': z.object({ id: z.string().uuid() }),
  'proxy:test': z.object({ id: z.string().uuid() }),
  'proxy:checkHistory': z.object({ id: z.string().uuid() }),

  'logs:list': z.object({
    limit: z.number().int().min(1).max(1000).default(200),
    beforeId: z.number().int().optional(),
    eventType: ActivityEventTypeSchema.optional(),
    profileId: z.string().optional(),
    search: z.string().optional(),
  }),
  'logs:latestId': z.object({}),

  'templates:list': z.object({}),

  'profiles:exportConfig': z.object({ id: ProfileIdSchema }),
  'profiles:exportFull': z.object({ id: ProfileIdSchema }),
  'profiles:exportSelected': z.object({ ids: z.array(ProfileIdSchema).min(1) }),
  'profiles:exportAll': z.object({}),
  'profiles:import': z.object({}),
  'profiles:backup': z.object({ id: ProfileIdSchema }),
  'profiles:restore': z.object({}),

  'profiles:bulkStart': z.object({ ids: z.array(ProfileIdSchema).min(1) }),
  'profiles:bulkStop': z.object({ ids: z.array(ProfileIdSchema).min(1) }),
  'profiles:bulkRestart': z.object({ ids: z.array(ProfileIdSchema).min(1) }),
  'profiles:bulkDelete': z.object({ ids: z.array(ProfileIdSchema).min(1) }),
  'profiles:bulkRestoreDeleted': z.object({ ids: z.array(ProfileIdSchema).min(1) }),
  'profiles:bulkClone': z.object({ ids: z.array(ProfileIdSchema).min(1) }),
  'profiles:bulkBackup': z.object({ ids: z.array(ProfileIdSchema).min(1) }),
  'profiles:bulkAssignProxy': z.object({ ids: z.array(ProfileIdSchema).min(1), proxyId: z.string().uuid().nullable() }),
  'profiles:bulkAddTags': z.object({ ids: z.array(ProfileIdSchema).min(1), tags: z.array(z.string().min(1).max(60)) }),
  'profiles:bulkRemoveTags': z.object({ ids: z.array(ProfileIdSchema).min(1), tags: z.array(z.string().min(1).max(60)) }),
  'profiles:bulkAssignGroup': z.object({ ids: z.array(ProfileIdSchema).min(1), groupId: z.string().uuid().nullable() }),

  'groups:list': z.object({}),
  'groups:create': GroupCreateInputSchema,
  'groups:rename': GroupRenameInputSchema,
  'groups:delete': GroupDeleteInputSchema,
  'groups:getProxyPool': z.object({ groupId: z.string().uuid() }),
  'groups:setProxyPool': z.object({ groupId: z.string().uuid(), proxyIds: z.array(z.string().uuid()) }),

  'settings:get': z.object({}),
  'settings:update': SettingsUpdateSchema,

  'security:credentialEncryptionStatus': z.object({}),

  'downloads:list': z.object({
    profileId: z.string().uuid().optional(),
    search: z.string().optional(),
    dateFrom: z.string().optional(),
    dateTo: z.string().optional(),
  }),
  'downloads:delete': z.object({ id: z.string().uuid() }),
  'downloads:open': z.object({ id: z.string().uuid() }),
  'downloads:showInFolder': z.object({ id: z.string().uuid() }),
  'downloads:redownload': z.object({ id: z.string().uuid() }),
} as const;

export type IpcChannel = keyof typeof IpcRequestSchemas;
export type IpcRequest<C extends IpcChannel> = z.infer<(typeof IpcRequestSchemas)[C]>;
