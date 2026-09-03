import { z } from 'zod';

export const StartupBehaviorSchema = z.enum(['blank', 'lastSession', 'showProfileList']);
export const LanguageSchema = z.enum(['uk', 'en']);
// 'system' follows the OS's prefers-color-scheme automatically (App.tsx
// leaves no [data-theme] attribute set, letting the CSS media query decide)
// — 'light'/'dark' force an explicit choice regardless of the OS. See
// global.css's :root[data-theme] blocks and README.md's Design section.
export const ThemeSchema = z.enum(['system', 'light', 'dark']);

export const SettingsSchema = z.object({
  language: LanguageSchema.default('uk'),
  theme: ThemeSchema.default('system'),
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
  // Pure UI convenience: pre-fills the port field when a user first enables
  // automation on a profile (see AdvancedTab.tsx). Not enforced or unique —
  // each profile still needs its own actual port if run simultaneously with
  // others that also have automation enabled; the app can't know that in
  // advance, so this stays a suggestion, not a reservation.
  defaultAutomationPort: z.number().int().min(1024).max(65535).nullable().default(null),
});
export type Settings = z.infer<typeof SettingsSchema>;

export const SettingsUpdateSchema = SettingsSchema.partial();
export type SettingsUpdate = z.infer<typeof SettingsUpdateSchema>;

export const DEFAULT_SETTINGS: Settings = SettingsSchema.parse({});
