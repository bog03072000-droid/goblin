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
  // Real bulk-start measurements across 20/50/100 profiles (see
  // tests/performance/LOAD_TEST_BULKSTART_RAW.md) show concurrency=4 beats
  // concurrency=2 on BOTH axes at every tier tested, not just one traded off
  // against the other — e.g. at 100 profiles, concurrency=2 took ~93.9s and
  // used ~10.7GB RAM at peak, while concurrency=4 took ~51.5s and used only
  // ~9.6GB. Higher concurrency finishes the launch queue faster, which
  // shortens the window where many Chromium processes are alive at once —
  // so it's not purely a "faster but riskier" tradeoff at this specific
  // step. Still capped well below the point (~8) where per-launch RAM
  // deltas start shrinking for diminishing time gains; see the same file
  // for the full 2/4/8 comparison at each tier.
  maxConcurrentLaunches: z.number().int().min(1).max(20).default(4),
});
export type Settings = z.infer<typeof SettingsSchema>;

export const SettingsUpdateSchema = SettingsSchema.partial();
export type SettingsUpdate = z.infer<typeof SettingsUpdateSchema>;

export const DEFAULT_SETTINGS: Settings = SettingsSchema.parse({});
