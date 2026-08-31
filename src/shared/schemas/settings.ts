import { z } from 'zod';

export const StartupBehaviorSchema = z.enum(['blank', 'lastSession', 'showProfileList']);
export const LanguageSchema = z.enum(['uk', 'en']);

export const SettingsSchema = z.object({
  language: LanguageSchema.default('uk'),
  hardwareAcceleration: z.boolean().default(true),
  autoCacheCleanup: z.boolean().default(false),
  cacheLimitMb: z.number().int().min(50).max(20000).default(2000),
  startupBehavior: StartupBehaviorSchema.default('showProfileList'),
  logRetentionDays: z.number().int().min(1).max(365).default(30),
  // Conservative default: real-world load testing measured ~585MB and ~5 OS
  // processes per simultaneously launching profile (main + GPU + renderer +
  // utility/audio), so a high default here can spike RAM usage badly on
  // typical machines. See docs/LOAD_TEST.md.
  maxConcurrentLaunches: z.number().int().min(1).max(20).default(2),
});
export type Settings = z.infer<typeof SettingsSchema>;

export const SettingsUpdateSchema = SettingsSchema.partial();
export type SettingsUpdate = z.infer<typeof SettingsUpdateSchema>;

export const DEFAULT_SETTINGS: Settings = SettingsSchema.parse({});
