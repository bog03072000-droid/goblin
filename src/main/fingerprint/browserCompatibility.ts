export interface CompatibilityCheckResult {
  compatible: boolean;
  configuredMajor: string;
  actualMajor: string;
  message: string | null;
}

/**
 * Compares a fingerprint's configured browser version against the Chromium
 * version actually bundled with this build of Electron (`process.versions.chrome`,
 * read at the call site rather than hardcoded here so this stays correct across
 * Electron upgrades without editing this function).
 *
 * Chrome/Chromium's own "reduced User-Agent" convention already collapses the
 * minor/build/patch numbers to 0 in the UA string (verified during the
 * fingerprint audit — this project's real Electron UA does the same thing by
 * default), so only the major version is meaningful to compare.
 */
export function checkBrowserCompatibility(
  configuredBrowserVersion: string,
  actualChromeVersion: string,
): CompatibilityCheckResult {
  const configuredMajor = configuredBrowserVersion.split('.')[0] ?? '';
  const actualMajor = actualChromeVersion.split('.')[0] ?? '';
  const compatible = configuredMajor === actualMajor;
  return {
    compatible,
    configuredMajor,
    actualMajor,
    message: compatible
      ? null
      : `Fingerprint claims Chrome ${configuredMajor}.x but this app is running Chromium ${actualMajor}.x — ` +
        `the User-Agent no longer matches the real engine version. Regenerate this profile's fingerprint ` +
        `(or re-import a template) after an Electron/Chromium upgrade.`,
  };
}
