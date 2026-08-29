import { z } from 'zod';
import { FingerprintInputSchema } from './fingerprint';

export const EXPORT_FORMAT = 'profileforge';
export const EXPORT_VERSION = 1;

/** Proxy config in an export never carries a password — see importExport.ts. */
export const ExportProxySchema = z
  .object({
    name: z.string(),
    protocol: z.enum(['http', 'https', 'socks5']),
    host: z.string(),
    port: z.number().int(),
    username: z.string().optional(),
  })
  .nullable();

export const ProfileExportSchema = z.object({
  format: z.literal(EXPORT_FORMAT),
  version: z.literal(EXPORT_VERSION),
  mode: z.enum(['config', 'full']),
  profile: z.object({
    name: z.string().min(1).max(120),
    description: z.string().max(2000).optional(),
    tags: z.array(z.string()).default([]),
  }),
  fingerprint: FingerprintInputSchema,
  proxy: ExportProxySchema,
  metadata: z.object({
    exportedAt: z.string(),
    sourceAppVersion: z.string(),
  }),
});
export type ProfileExport = z.infer<typeof ProfileExportSchema>;
