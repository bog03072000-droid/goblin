import { z } from 'zod';
import { OsSchema } from './fingerprint';

export const TemplateDefinitionSchema = z.object({
  os: OsSchema,
  locale: z.string().min(2).optional(),
  // Ad-platform presets (e.g. "TikTok Ads Mobile") need more than os/locale
  // to pin a specific, realistic device/GPU combo — same fields
  // generateFingerprint()'s own GenerateFingerprintOptions already accepts
  // as overrides, reused here rather than duplicated. Each is validated
  // against the resolved OS's own real option list by the generator itself
  // (see generator.ts), so a stale/mistyped value here is silently ignored
  // rather than producing an incoherent fingerprint — same guarantee the
  // "choose instead of Auto" UI already relies on.
  screenWidth: z.number().int().positive().optional(),
  screenHeight: z.number().int().positive().optional(),
  hardwareConcurrency: z.number().int().positive().optional(),
  deviceMemory: z.number().int().positive().optional(),
  webglVendor: z.string().optional(),
  webglRenderer: z.string().optional(),
});
export type TemplateDefinition = z.infer<typeof TemplateDefinitionSchema>;

export const TemplateSchema = z.object({
  id: z.string(),
  name: z.string(),
  definition: TemplateDefinitionSchema,
  createdAt: z.string(),
});
export type Template = z.infer<typeof TemplateSchema>;
