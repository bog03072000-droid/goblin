import type { Fingerprint, WebrtcMode, GeolocationMode, PermissionsMode } from '../../shared/schemas/fingerprint';
import type { SpoofableFingerprint } from './spoofingScript';

/**
 * Pure logic extracted out of profileWindowEntry.ts's single large
 * `runProfileWindowProcess()` — that function is a genuinely imperative
 * Electron entry point (BrowserWindow/session/ipcMain wiring), already
 * exercised end to end by nearly every E2E test in this suite (every test
 * that starts a real profile runs it for real), but the actual decision
 * logic buried inside its closures — fingerprint-config defaulting, URL
 * precedence, navigation URL normalization — was previously untestable in
 * isolation. Pulled out here so it can be unit-tested directly instead of
 * only ever exercised as a side effect of a full Electron process.
 */

/** navigator.languages resolution: the fingerprint config's own `languages`
 * array when present and well-formed, otherwise a single-entry array of
 * the profile's locale — never an empty/missing languages list. */
export function resolveLanguages(fingerprintConfig: Record<string, unknown>, locale: string): string[] {
  return Array.isArray(fingerprintConfig['languages']) ? (fingerprintConfig['languages'] as string[]) : [locale];
}

/**
 * Builds the object buildSpoofingScript() actually consumes, applying the
 * same defaults profileWindowEntry.ts always has (matching a freshly
 * generated profile's own defaults, see generator.ts) whenever a field is
 * missing from the raw fingerprint config — e.g. an older profile created
 * before a field existed, or a hand-edited config missing a key.
 */
export function buildSpoofableFingerprint(
  fingerprintConfig: Record<string, unknown>,
  args: { userAgent: string; profileId: string },
): SpoofableFingerprint {
  return {
    seed: String(fingerprintConfig['seed'] ?? args.profileId),
    canvasMode: (fingerprintConfig['canvasMode'] as Fingerprint['canvasMode']) ?? 'off',
    audioMode: (fingerprintConfig['audioMode'] as Fingerprint['audioMode']) ?? 'off',
    deviceMemory: Number(fingerprintConfig['deviceMemory'] ?? 8),
    webglSpoofingMode: (fingerprintConfig['webglSpoofingMode'] as Fingerprint['webglSpoofingMode']) ?? 'off',
    webglVendor: String(fingerprintConfig['webglVendor'] ?? 'Google Inc.'),
    webglRenderer: String(fingerprintConfig['webglRenderer'] ?? 'ANGLE'),
    fontsMode: (fingerprintConfig['fontsMode'] as Fingerprint['fontsMode']) ?? 'system',
    mediaDevicesMode: (fingerprintConfig['mediaDevicesMode'] as Fingerprint['mediaDevicesMode']) ?? 'real',
    userAgent: args.userAgent,
    platform: String(fingerprintConfig['platform'] ?? 'Win32'),
    hardwareConcurrency: Number(fingerprintConfig['hardwareConcurrency'] ?? 8),
    maxTouchPoints: Number(fingerprintConfig['maxTouchPoints'] ?? 0),
    serviceWorkerMode: (fingerprintConfig['serviceWorkerMode'] as Fingerprint['serviceWorkerMode']) ?? 'real',
  };
}

/** The three independent enforcement modes read off the raw fingerprint
 * config, each with the same "real"/"default" fallback a freshly generated
 * profile already has (generator.ts) — kept as one function since all
 * three are read together, right before applyPermissionPolicy(). */
export function resolveEnforcementModes(fingerprintConfig: Record<string, unknown>): {
  webrtcMode: WebrtcMode;
  geolocationMode: GeolocationMode;
  permissionsMode: PermissionsMode;
} {
  return {
    webrtcMode: (fingerprintConfig['webrtcMode'] as WebrtcMode | undefined) ?? 'default',
    geolocationMode: (fingerprintConfig['geolocationMode'] as GeolocationMode | undefined) ?? 'real',
    permissionsMode: (fingerprintConfig['permissionsMode'] as PermissionsMode | undefined) ?? 'real',
  };
}

/**
 * Which URL a freshly attached webview navigates to first — precedence,
 * highest first: the auto-diagnostics testing hook, the proxy-verification
 * testing hook, an explicit initialUrl (Downloads page's "Re-download"),
 * then the real default start page. Both testing hooks are read from env
 * (see docs/FINGERPRINT_AUDIT.md's PF_E2E_* convention) and are never set
 * in a normal launch.
 */
export function resolveAutoNavigateTarget(
  env: NodeJS.ProcessEnv,
  args: { navigateTo: string | null },
  diagnosticsUrl: string,
  defaultStartUrl: string,
): string {
  if (env['PF_E2E_AUTO_DIAGNOSTICS'] === '1') return diagnosticsUrl;
  return env['PF_E2E_PROXY_TEST_URL'] ?? args.navigateTo ?? defaultStartUrl;
}

/** The 'pf:navigate' IPC handler's own URL normalization: a bare
 * "example.com" (no scheme) is treated as https, same as typing it into a
 * real browser's address bar — anything that already looks like
 * "<scheme>://..." (including a non-http one) is passed through unchanged. */
export function normalizeNavigationUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  return /^[a-zA-Z]+:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`;
}
