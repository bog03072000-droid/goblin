import type { FingerprintInput } from '../../shared/schemas/fingerprint';
import type { FingerprintValidationResult } from '../../shared/schemas/fingerprint';
import { PLATFORM_PROFILES, LOCALE_PROFILES } from './platformProfiles';

const MACOS_ONLY_PLATFORM = 'MacIntel';
const WINDOWS_ONLY_PLATFORM = 'Win32';
const ANDROID_ONLY_PLATFORM = 'Linux armv8l';
const IOS_ONLY_PLATFORM = 'iPhone';

/**
 * Checks cross-field coherence. Does NOT and cannot guarantee anonymity or
 * undetectability — it only flags internally contradictory configurations.
 */
export function validateFingerprint(fp: FingerprintInput): FingerprintValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const uaLower = fp.userAgent.toLowerCase();

  if (fp.os === 'windows' && fp.platform !== WINDOWS_ONLY_PLATFORM) {
    errors.push(`Windows profile must use platform "${WINDOWS_ONLY_PLATFORM}", got "${fp.platform}"`);
  }
  if (fp.os === 'macos' && fp.platform !== MACOS_ONLY_PLATFORM) {
    errors.push(`macOS profile must use platform "${MACOS_ONLY_PLATFORM}", got "${fp.platform}"`);
  }
  // Android's real platform string ("Linux armv8l") itself starts with
  // "linux" — checked before the plain 'linux' OS check below so an
  // android profile doesn't also have to satisfy the desktop-Linux rule
  // (it already does incidentally, but the intent is Android-specific).
  if (fp.os === 'android' && fp.platform !== ANDROID_ONLY_PLATFORM) {
    errors.push(`Android profile must use platform "${ANDROID_ONLY_PLATFORM}", got "${fp.platform}"`);
  }
  if (fp.os === 'ios' && fp.platform !== IOS_ONLY_PLATFORM) {
    errors.push(`iOS profile must use platform "${IOS_ONLY_PLATFORM}", got "${fp.platform}"`);
  }
  if (fp.os === 'linux' && !fp.platform.toLowerCase().startsWith('linux')) {
    errors.push(`Linux profile must use a Linux platform string, got "${fp.platform}"`);
  }

  if (fp.os === 'windows' && !uaLower.includes('windows')) {
    errors.push('User-Agent does not mention Windows but OS is set to windows');
  }
  if (fp.os === 'macos' && !uaLower.includes('mac os x') && !uaLower.includes('macintosh')) {
    errors.push('User-Agent does not mention macOS but OS is set to macos');
  }
  if (fp.os === 'linux' && !uaLower.includes('linux')) {
    errors.push('User-Agent does not mention Linux but OS is set to linux');
  }
  if (fp.os === 'android' && !uaLower.includes('android')) {
    errors.push('User-Agent does not mention Android but OS is set to android');
  }
  if (fp.os === 'ios' && !uaLower.includes('iphone')) {
    errors.push('User-Agent does not mention iPhone but OS is set to ios');
  }
  if (!uaLower.includes(fp.browserVersion.split('.')[0] ?? '')) {
    warnings.push('Browser version in User-Agent does not match configured browserVersion major');
  }

  if (!fp.languages.some((l) => l.toLowerCase() === fp.locale.toLowerCase())) {
    warnings.push('Primary locale is not present in the languages list');
  }

  const localeProfile = LOCALE_PROFILES.find((l) => l.locale === fp.locale);
  if (localeProfile && localeProfile.timezone !== fp.timezone) {
    warnings.push(
      `Timezone "${fp.timezone}" is unusual for locale "${fp.locale}" (commonly "${localeProfile.timezone}") — technically possible but uncommon`,
    );
  }

  const isMobileOs = fp.os === 'android' || fp.os === 'ios';
  // Portrait (width < height) is the NORMAL orientation for a phone —
  // this warning only makes sense for a desktop-class profile.
  if (!isMobileOs && fp.screenWidth < fp.screenHeight) {
    warnings.push('Screen width is smaller than height — unusual for a desktop profile');
  }
  if (fp.deviceScaleFactor <= 0) {
    errors.push('deviceScaleFactor must be positive');
  }
  if (fp.os === 'macos' && fp.deviceScaleFactor < 2) {
    warnings.push('macOS profiles are almost always Retina (deviceScaleFactor >= 2)');
  }
  if (isMobileOs && fp.deviceScaleFactor < 2) {
    warnings.push('Real Android/iOS devices are almost always high-DPI (deviceScaleFactor >= 2)');
  }

  if (fp.maxTouchPoints < 0) {
    errors.push('maxTouchPoints must not be negative');
  }
  if (isMobileOs && fp.maxTouchPoints === 0) {
    warnings.push('A real Android/iOS device reports maxTouchPoints > 0 — 0 usually means "no touchscreen"');
  }
  if (!isMobileOs && fp.maxTouchPoints > 0) {
    warnings.push(`maxTouchPoints is ${fp.maxTouchPoints} but OS is "${fp.os}" — most desktop machines report 0 (no touchscreen)`);
  }

  if (fp.hardwareConcurrency < 1) {
    errors.push('hardwareConcurrency must be at least 1');
  }
  if (fp.deviceMemory < 1) {
    errors.push('deviceMemory must be at least 1');
  }
  if (fp.hardwareConcurrency >= 16 && fp.deviceMemory <= 2) {
    warnings.push(
      `${fp.hardwareConcurrency} CPU cores with only ${fp.deviceMemory}GB RAM is an implausible hardware pairing`,
    );
  }
  if (fp.deviceMemory >= 16 && fp.hardwareConcurrency <= 2) {
    warnings.push(
      `${fp.deviceMemory}GB RAM with only ${fp.hardwareConcurrency} CPU core(s) is an implausible hardware pairing`,
    );
  }

  const gpuVendorLower = fp.webglVendor.toLowerCase();
  const platformProfile = PLATFORM_PROFILES.find((p) => p.os === fp.os);
  if (platformProfile) {
    const knownVendor = platformProfile.gpuOptions.some(
      (g) => g.vendor.toLowerCase() === gpuVendorLower,
    );
    if (!knownVendor) {
      warnings.push(`WebGL vendor "${fp.webglVendor}" is not a known match for OS "${fp.os}"`);
    }
  }
  const isApplePlatform = fp.os === 'macos' || fp.os === 'ios';
  if (!isApplePlatform && fp.webglRenderer.toLowerCase().includes('apple')) {
    errors.push('WebGL renderer references Apple GPU but OS is not macos/ios');
  }
  if (isApplePlatform && !fp.webglRenderer.toLowerCase().includes('apple')) {
    warnings.push(`WebGL renderer does not reference Apple GPU on a ${fp.os} profile`);
  }

  return { valid: errors.length === 0, warnings, errors };
}
