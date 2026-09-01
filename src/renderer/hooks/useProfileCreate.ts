import { useState } from 'react';
import type { FingerprintInput } from '@shared/schemas/fingerprint';
import { callApi } from '../services/api';
import { useAsyncAction } from './useAsyncAction';

/**
 * Owns the toolbar's "quick fields" (name/template/group/proxy/tags) and
 * both ways a profile gets created from them: the full config modal
 * (openCreateModal — nothing written until the modal's own "Create profile"
 * confirms) and the one-click quick-create path (quickCreateProfile —
 * generates a fingerprint and calls profiles:create immediately). Extracted
 * out of ProfilesPage.tsx as a self-contained slice: nothing outside the
 * create flow reads these fields or calls these functions.
 */
export function useProfileCreate(options: { refresh: () => Promise<void>; refreshGroups: () => Promise<void> }): {
  newName: string;
  setNewName: (value: string) => void;
  templateId: string;
  setTemplateId: (value: string) => void;
  newGroupId: string;
  setNewGroupId: (value: string) => void;
  newProxyId: string;
  setNewProxyId: (value: string) => void;
  newTags: string;
  setNewTags: (value: string) => void;
  showCreateModal: boolean;
  openCreateModal: () => void;
  closeCreateModal: () => void;
  onProfileCreated: () => void;
  quickCreateProfile: () => Promise<void>;
  createAction: ReturnType<typeof useAsyncAction>;
} {
  const { refresh, refreshGroups } = options;
  const [newName, setNewName] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [newGroupId, setNewGroupId] = useState('');
  const [newProxyId, setNewProxyId] = useState('');
  const [newTags, setNewTags] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const createAction = useAsyncAction();

  /** Opens the full profile-creation modal instead of creating a profile
   * immediately — nothing is written to the database until the user
   * explicitly confirms inside that modal. Whatever's already been typed
   * into the toolbar's quick fields (name/group/proxy/tags/template) just
   * seeds the modal's initial state, exactly as it used to seed the
   * immediate create call. */
  function openCreateModal(): void {
    setShowCreateModal(true);
  }

  function closeCreateModal(): void {
    setShowCreateModal(false);
  }

  function onProfileCreated(): void {
    setNewName('');
    setNewGroupId('');
    setNewProxyId('');
    setNewTags('');
    void refresh();
    void refreshGroups();
  }

  /** The one-click path the full config modal (openCreateModal) replaced:
   * generates a fingerprint the same way the modal's own preview does
   * (fingerprint:generate, honoring whatever template is selected in the
   * toolbar) and creates the profile immediately with it — no modal, no
   * extra confirmation step. Whatever's already typed into the toolbar's
   * quick fields (name/group/proxy/tags) is used exactly as-is; an empty
   * name falls back to a timestamp-based one since profiles:create requires
   * a non-empty name. */
  async function quickCreateProfile(): Promise<void> {
    await createAction.run(async () => {
      const generated = await callApi<'fingerprint:generate', FingerprintInput>('fingerprint:generate', {
        seed: `quick-${Date.now()}`,
        templateId: templateId || undefined,
      });
      const name = newName.trim() || `Profile ${new Date().toLocaleString()}`;
      await callApi('profiles:create', {
        name,
        groupId: newGroupId || undefined,
        proxyId: newProxyId || undefined,
        tags: newTags
          .split(',')
          .map((tg) => tg.trim())
          .filter(Boolean),
        fingerprint: generated,
      });
      onProfileCreated();
    });
  }

  return {
    newName,
    setNewName,
    templateId,
    setTemplateId,
    newGroupId,
    setNewGroupId,
    newProxyId,
    setNewProxyId,
    newTags,
    setNewTags,
    showCreateModal,
    openCreateModal,
    closeCreateModal,
    onProfileCreated,
    quickCreateProfile,
    createAction,
  };
}
