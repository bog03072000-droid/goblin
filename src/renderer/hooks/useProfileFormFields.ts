import { useState, type Dispatch, type SetStateAction } from 'react';
import type { ProxyRecord } from '@shared/schemas/proxy';
import type { Group } from '@shared/schemas/group';
import { callApi } from '../services/api';

/** The comma-separated tags input both modals use, parsed into the
 * trimmed/non-empty string[] `profiles:create`/`profiles:update` expect —
 * exported standalone (not tied to the hook's own state) so a caller can
 * apply it to any tagsText value, not just the hook's current one. */
export function parseTagsText(tagsText: string): string[] {
  return tagsText
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
}

export interface ProfileFormFieldsValues {
  name: string;
  description: string;
  tagsText: string;
  groupId: string;
  proxyId: string;
}

/**
 * The General/Proxy tab form state shared by ProfileCreateModal (a
 * not-yet-persisted draft, discarded if the modal closes early) and
 * ProfileEditorModal (persists each tab immediately via its own
 * saveGeneral/saveProxy, and separately tracks a dirty/saved snapshot for
 * unsaved-changes detection) — before this hook, both modals independently
 * carried the same five useState calls and the same groups/proxies list
 * fetch. Only what happens to an edit (kept as a local draft vs. saved
 * immediately, and whether "dirty" needs tracking at all) differs between
 * the two callers, so this hook owns just the field state and the
 * groups/proxies lists — not persistence or dirty-tracking, which stay with
 * each caller exactly as they were.
 */
export function useProfileFormFields(initial: ProfileFormFieldsValues): {
  name: string;
  setName: (value: string) => void;
  description: string;
  setDescription: (value: string) => void;
  tagsText: string;
  setTagsText: (value: string) => void;
  groupId: string;
  setGroupId: (value: string) => void;
  proxyId: string;
  setProxyId: (value: string) => void;
  setAllFields: (values: ProfileFormFieldsValues) => void;
  groups: Group[];
  proxies: ProxyRecord[];
  setProxies: Dispatch<SetStateAction<ProxyRecord[]>>;
  loadGroupsAndProxies: () => Promise<void>;
} {
  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description);
  const [tagsText, setTagsText] = useState(initial.tagsText);
  const [groupId, setGroupId] = useState(initial.groupId);
  const [proxyId, setProxyId] = useState(initial.proxyId);
  const [groups, setGroups] = useState<Group[]>([]);
  const [proxies, setProxies] = useState<ProxyRecord[]>([]);

  function setAllFields(values: ProfileFormFieldsValues): void {
    setName(values.name);
    setDescription(values.description);
    setTagsText(values.tagsText);
    setGroupId(values.groupId);
    setProxyId(values.proxyId);
  }

  async function loadGroupsAndProxies(): Promise<void> {
    const [proxyList, groupList] = await Promise.all([
      callApi<'proxy:list', ProxyRecord[]>('proxy:list', {}),
      callApi<'groups:list', Group[]>('groups:list', {}),
    ]);
    setProxies(proxyList);
    setGroups(groupList);
  }

  return {
    name,
    setName,
    description,
    setDescription,
    tagsText,
    setTagsText,
    groupId,
    setGroupId,
    proxyId,
    setProxyId,
    setAllFields,
    groups,
    proxies,
    setProxies,
    loadGroupsAndProxies,
  };
}
