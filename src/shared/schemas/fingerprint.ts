import { z } from 'zod';

export const OsSchema = z.enum(['windows', 'macos', 'linux']);
export type Os = z.infer<typeof OsSchema>;

export const CanvasModeSchema = z.enum(['off', 'noise']);
export const AudioModeSchema = z.enum(['off', 'noise']);
export const WebrtcModeSchema = z.enum(['default', 'disabled', 'proxy-only']);
export type WebrtcMode = z.infer<typeof WebrtcModeSchema>;
export const FontsModeSchema = z.enum(['system', 'restricted']);
export const MediaDevicesModeSchema = z.enum(['real', 'hidden']);
// Separate from webglVendor/webglRenderer (which are always generated) because
// spoofing getParameter() is a JS-level override with real compatibility risk
// for WebGL-heavy sites (canvas games, map renderers, some CAPTCHAs) — opt-in,
// off by default. See docs/FINGERPRINT_AUDIT.md.
export const WebglSpoofingModeSchema = z.enum(['off', 'spoof']);

export const FingerprintSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(120),
  os: OsSchema,
  osVersion: z.string().min(1),
  browserVersion: z.string().min(1),
  userAgent: z.string().min(1),
  platform: z.string().min(1),
  locale: z.string().min(2),
  languages: z.array(z.string().min(2)).min(1),
  timezone: z.string().min(1),
  screenWidth: z.number().int().min(320).max(15360),
  screenHeight: z.number().int().min(240).max(8640),
  deviceScaleFactor: z.number().min(0.5).max(4),
  hardwareConcurrency: z.number().int().min(1).max(128),
  deviceMemory: z.number().int().min(1).max(128),
  webglVendor: z.string().min(1),
  webglRenderer: z.string().min(1),
  canvasMode: CanvasModeSchema,
  audioMode: AudioModeSchema,
  webrtcMode: WebrtcModeSchema,
  fontsMode: FontsModeSchema,
  mediaDevicesMode: MediaDevicesModeSchema,
  webglSpoofingMode: WebglSpoofingModeSchema,
  seed: z.string().min(1),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Fingerprint = z.infer<typeof FingerprintSchema>;

export const FingerprintInputSchema = FingerprintSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type FingerprintInput = z.infer<typeof FingerprintInputSchema>;

export interface FingerprintValidationResult {
  valid: boolean;
  warnings: string[];
  errors: string[];
}

/** Real, selectable option lists per OS — backs the explicit
 * OS/version/browser/CPU/RAM/GPU/resolution pickers in FingerprintTab.tsx.
 * Served by `fingerprint:options` straight from platformProfiles.ts (the
 * same data the generator itself picks from), so the UI can never offer a
 * combination the generator wouldn't also produce. */
export interface FingerprintPlatformOptions {
  os: Os;
  osVersions: string[];
  platform: string;
  screens: Array<{ width: number; height: number }>;
  hardwareConcurrencyOptions: number[];
  deviceMemoryOptions: number[];
  gpuOptions: Array<{ vendor: string; renderer: string }>;
}

export interface FingerprintOptionsResponse {
  platforms: FingerprintPlatformOptions[];
  browserVersions: string[];
}
