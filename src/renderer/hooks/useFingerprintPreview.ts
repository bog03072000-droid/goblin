import { useEffect, useState } from 'react';
import type {
  Fingerprint,
  FingerprintInput,
  FingerprintOptionsResponse,
  FingerprintValidationResult,
} from '@shared/schemas/fingerprint';
import { callApi } from '../services/api';
import type { FieldOverrides } from '../components/profileEditor/FieldOverridesPicker';

/** The `fingerprint:validate` request shape is identical for both callers
 * (~20 fields, straight off a Fingerprint) — exported standalone (not tied
 * to this hook's own state) so ProfileEditorModal's onGenerated callback can
 * call it directly right after persisting, without needing the hook's own
 * runValidate (which isn't available yet at the point onGenerated has to be
 * constructed, since it's passed INTO the hook call). */
export async function validateFingerprintPreview(source: Fingerprint): Promise<FingerprintValidationResult> {
  return callApi<'fingerprint:validate', FingerprintValidationResult>('fingerprint:validate', {
    name: source.name,
    os: source.os,
    osVersion: source.osVersion,
    browserVersion: source.browserVersion,
    userAgent: source.userAgent,
    platform: source.platform,
    locale: source.locale,
    languages: source.languages,
    timezone: source.timezone,
    screenWidth: source.screenWidth,
    screenHeight: source.screenHeight,
    deviceScaleFactor: source.deviceScaleFactor,
    hardwareConcurrency: source.hardwareConcurrency,
    deviceMemory: source.deviceMemory,
    webglVendor: source.webglVendor,
    webglRenderer: source.webglRenderer,
    canvasMode: source.canvasMode,
    audioMode: source.audioMode,
    webrtcMode: source.webrtcMode,
    fontsMode: source.fontsMode,
    mediaDevicesMode: source.mediaDevicesMode,
    webglSpoofingMode: source.webglSpoofingMode,
    geolocationMode: source.geolocationMode,
    geolocationLatitude: source.geolocationLatitude,
    geolocationLongitude: source.geolocationLongitude,
    permissionsMode: source.permissionsMode,
    seed: source.seed,
  });
}

/**
 * The "fingerprint preview" subsystem shared by ProfileCreateModal (a
 * not-yet-persisted draft) and ProfileEditorModal (regenerates and persists
 * an existing profile's fingerprint immediately) — before this hook, both
 * modals independently fetched the same fieldOptions list, carried their own
 * `overrides` state, and called `fingerprint:generate` with byte-for-byte
 * identical request shapes. Only what happens to a freshly generated
 * fingerprint differs between the two callers (kept as a local draft vs.
 * written straight to the DB via `fingerprint:update`) — which is exactly
 * why `generatePreview` takes that as an `onGenerated` callback instead of
 * this hook owning persistence itself.
 */
export function useFingerprintPreview(onGenerated: (input: FingerprintInput) => void | Promise<void>): {
  fieldOptions: FingerprintOptionsResponse | null;
  overrides: FieldOverrides;
  setOverrides: (next: FieldOverrides) => void;
  validation: FingerprintValidationResult | null;
  setValidation: (next: FingerprintValidationResult | null) => void;
  generatePreview: (seed: string, templateId?: string, withOverrides?: FieldOverrides) => Promise<void>;
  runValidate: (source: Fingerprint | null | undefined) => Promise<void>;
} {
  const [fieldOptions, setFieldOptions] = useState<FingerprintOptionsResponse | null>(null);
  const [overrides, setOverrides] = useState<FieldOverrides>({});
  const [validation, setValidation] = useState<FingerprintValidationResult | null>(null);

  useEffect(() => {
    void callApi<'fingerprint:options', FingerprintOptionsResponse>('fingerprint:options', {}).then(setFieldOptions);
  }, []);

  async function generatePreview(seed: string, templateId?: string, withOverrides: FieldOverrides = overrides): Promise<void> {
    const generated = await callApi<'fingerprint:generate', FingerprintInput>('fingerprint:generate', {
      seed,
      templateId: templateId || undefined,
      ...withOverrides,
    });
    await onGenerated(generated);
    setValidation(null);
  }

  async function runValidate(source: Fingerprint | null | undefined): Promise<void> {
    if (!source) return;
    setValidation(await validateFingerprintPreview(source));
  }

  return { fieldOptions, overrides, setOverrides, validation, setValidation, generatePreview, runValidate };
}
