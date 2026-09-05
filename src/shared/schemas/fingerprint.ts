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
// 'real' preserves the pre-existing default behavior exactly (no CDP
// override installed, Electron's own permission-request default applies) —
// 'spoof' reports a locale-coherent city (see LocaleProfile.latitude/
// longitude in platformProfiles.ts, not an independently random point) via
// CDP `Emulation.setGeolocationOverride`; 'blocked' denies the geolocation
// permission outright, the same outcome a real user clicking "Block" gets.
export const GeolocationModeSchema = z.enum(['real', 'spoof', 'blocked']);
export type GeolocationMode = z.infer<typeof GeolocationModeSchema>;
// A blanket toggle for every OTHER permission type (camera, mic,
// notifications, clipboard, etc.) — deliberately separate from
// geolocationMode rather than folded into one enum, since "spoof my
// location" and "deny every permission" are independent axes a user might
// want in any combination (e.g. spoofed location + no camera/mic access).
export const PermissionsModeSchema = z.enum(['real', 'deny-all']);
export type PermissionsMode = z.infer<typeof PermissionsModeSchema>;
// Off by default ('real', matches every existing profile's current
// behavior exactly — no change unless explicitly opted into). 'disabled'
// deletes navigator.serviceWorker outright (a genuine absence, not an
// overridden getter — see docs/FINGERPRINT_AUDIT.md's "Fifth attempt" and
// "Seventh attempt" write-ups) and — only in combination with that, never
// on its own — extends webglSpoofingMode's getParameter() override into
// same-page iframes too, which closes a real, verified fingerprint leak
// AND a real, verified new detection signal that appeared when only one of
// the two was fixed. Real compatibility risk: any site that actually uses
// a Service Worker (offline caching, push notifications, background sync)
// won't get that functionality with this on — documented in the
// Fingerprint tab's own UI warning, same convention as webglSpoofingMode.
export const ServiceWorkerModeSchema = z.enum(['real', 'disabled']);
export type ServiceWorkerMode = z.infer<typeof ServiceWorkerModeSchema>;

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
  geolocationMode: GeolocationModeSchema,
  // Always carried regardless of geolocationMode (same convention as
  // webglVendor/webglRenderer being generated even when webglSpoofingMode is
  // 'off') so switching to 'spoof' later doesn't need a regenerate — a
  // locale-coherent city coordinate, not an arbitrary/independently random
  // point (see LOCALE_PROFILES in platformProfiles.ts).
  geolocationLatitude: z.number().min(-90).max(90),
  geolocationLongitude: z.number().min(-180).max(180),
  permissionsMode: PermissionsModeSchema,
  serviceWorkerMode: ServiceWorkerModeSchema,
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
