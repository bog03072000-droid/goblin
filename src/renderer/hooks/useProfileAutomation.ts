import { useState } from 'react';
import type { Profile } from '@shared/schemas/profile';
import { callApi } from '../services/api';
import { useAsyncAction } from './useAsyncAction';

/**
 * Automation-token state and actions for ProfileEditorModal's Advanced tab —
 * same extraction rationale as useProfileStorageData: a self-contained,
 * independently-testable unit split off following the ProfileChildChannel
 * precedent, rather than left inlined in the modal. `profile` itself stays
 * owned by the caller (every other tab reads it too) — this hook only owns
 * the token/port state and reports profile updates back via `onProfileUpdated`.
 */
export function useProfileAutomation(
  profileId: string,
  onProfileUpdated: (profile: Profile) => void,
): {
  automationToken: string | null;
  setAutomationToken: (token: string | null) => void;
  pending: boolean;
  error: string | null;
  saveAutomation: (patch: { automationEnabled?: boolean; automationPort?: number | null }) => Promise<void>;
  regenerateAutomationToken: () => Promise<void>;
} {
  const [automationToken, setAutomationToken] = useState<string | null>(null);
  const automationAction = useAsyncAction();

  /** Toggling automation on generates a token the first time (none exists
   * yet for a profile that never had it enabled); toggling off just flips
   * the flag and clears the displayed token — the encrypted token itself
   * stays in the database so re-enabling later doesn't silently rotate it
   * out from under an already-configured external automation client. */
  async function saveAutomation(patch: { automationEnabled?: boolean; automationPort?: number | null }): Promise<void> {
    await automationAction.run(async () => {
      const updated = await callApi<'profiles:update', Profile>('profiles:update', { id: profileId, ...patch });
      onProfileUpdated(updated);
      if (patch.automationEnabled === true && !automationToken) {
        const generated = await callApi<'profiles:regenerateAutomationToken', { token: string }>(
          'profiles:regenerateAutomationToken',
          { id: profileId },
        );
        setAutomationToken(generated.token);
      }
    });
  }

  async function regenerateAutomationToken(): Promise<void> {
    await automationAction.run(async () => {
      const result = await callApi<'profiles:regenerateAutomationToken', { token: string }>(
        'profiles:regenerateAutomationToken',
        { id: profileId },
      );
      setAutomationToken(result.token);
    });
  }

  return {
    automationToken,
    setAutomationToken,
    pending: automationAction.pending,
    error: automationAction.error,
    saveAutomation,
    regenerateAutomationToken,
  };
}
