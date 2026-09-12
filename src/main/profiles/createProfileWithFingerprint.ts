import type { TemplateRepository } from '../database/templateRepository';
import type { FingerprintRepository } from '../database/fingerprintRepository';
import type { ProfileManager } from './profileManager';
import type { ProfileCreateInput, Profile } from '../../shared/schemas/profile';
import { generateFingerprint } from '../fingerprint/generator';

export interface CreateProfileDeps {
  templates: TemplateRepository;
  fingerprints: FingerprintRepository;
  profileManager: ProfileManager;
}

/**
 * The one true "create a profile" implementation — resolve an optional
 * template, generate a coherent fingerprint from it (falling back to any
 * explicit `input.fingerprint` fields, an ad-platform preset's own pinned
 * screen/GPU/hardware — see templateRepository.ts — applies here too),
 * persist the fingerprint, then the profile. Shared between
 * registerIpc.ts's `profiles:create` IPC handler and restApiServer.ts's
 * `POST /profiles` route so the two never drift: a profile created through
 * the REST API is generated exactly the same way as one created through the
 * app's own UI, not a second reimplementation that could quietly diverge.
 */
export function createProfileWithFingerprint(deps: CreateProfileDeps, input: ProfileCreateInput): Profile {
  const template = input.templateId ? deps.templates.getById(input.templateId) : null;
  const generated = generateFingerprint({
    seed: input.name + Date.now(),
    os: template?.definition.os ?? input.fingerprint?.os,
    locale: template?.definition.locale ?? input.fingerprint?.locale,
    screenWidth: template?.definition.screenWidth,
    screenHeight: template?.definition.screenHeight,
    hardwareConcurrency: template?.definition.hardwareConcurrency,
    deviceMemory: template?.definition.deviceMemory,
    webglVendor: template?.definition.webglVendor,
    webglRenderer: template?.definition.webglRenderer,
  });
  // User-supplied overrides (manual mode fields, spoofing toggles) win over
  // the generated base — same merge shape fingerprint:update already uses
  // for post-creation edits.
  const fingerprint = deps.fingerprints.create({ ...generated, ...input.fingerprint });
  return deps.profileManager.create(input, fingerprint.id);
}
