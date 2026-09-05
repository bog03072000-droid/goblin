// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { I18nProvider } from '../../src/renderer/i18n';
import { useProfileCreate } from '../../src/renderer/hooks/useProfileCreate';
import type { FingerprintInput } from '../../src/shared/schemas/fingerprint';
import type { ReactNode } from 'react';

function wrapper({ children }: { children: ReactNode }) {
  return <I18nProvider initialLocale="en" onLocaleChange={() => {}}>{children}</I18nProvider>;
}

afterEach(() => {
  vi.restoreAllMocks();
});

function mockInvoke(handlers: Partial<Record<string, (payload: unknown) => unknown>>) {
  const invoke = vi.fn((channel: string, payload: unknown) => {
    const handler = handlers[channel];
    if (!handler) throw new Error(`Unmocked IPC channel in test: ${channel}`);
    return Promise.resolve(handler(payload));
  });
  window.profileforge = { invoke, onUpdateAvailable: vi.fn(), installUpdate: vi.fn() } as unknown as Window['profileforge'];
  return invoke;
}

function setup() {
  const refresh = vi.fn(async () => undefined);
  const refreshGroups = vi.fn(async () => undefined);
  const { result } = renderHook(() => useProfileCreate({ refresh, refreshGroups }), { wrapper });
  return { result, refresh, refreshGroups };
}

describe('useProfileCreate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it('openCreateModal/closeCreateModal toggle showCreateModal', () => {
    const { result } = setup();
    expect(result.current.showCreateModal).toBe(false);
    act(() => result.current.openCreateModal());
    expect(result.current.showCreateModal).toBe(true);
    act(() => result.current.closeCreateModal());
    expect(result.current.showCreateModal).toBe(false);
  });

  it('setters update their respective quick-create fields', () => {
    const { result } = setup();
    act(() => {
      result.current.setNewName('My Bot');
      result.current.setTemplateId('tmpl-1');
      result.current.setNewGroupId('group-1');
      result.current.setNewProxyId('proxy-1');
      result.current.setNewTags('a, b');
    });
    expect(result.current.newName).toBe('My Bot');
    expect(result.current.templateId).toBe('tmpl-1');
    expect(result.current.newGroupId).toBe('group-1');
    expect(result.current.newProxyId).toBe('proxy-1');
    expect(result.current.newTags).toBe('a, b');
  });

  it('onProfileCreated clears name/group/proxy/tags (but not templateId) and refreshes both lists', () => {
    const { result, refresh, refreshGroups } = setup();
    act(() => {
      result.current.setNewName('My Bot');
      result.current.setTemplateId('tmpl-1');
      result.current.setNewGroupId('group-1');
      result.current.setNewProxyId('proxy-1');
      result.current.setNewTags('a, b');
    });
    act(() => result.current.onProfileCreated());
    expect(result.current.newName).toBe('');
    expect(result.current.newGroupId).toBe('');
    expect(result.current.newProxyId).toBe('');
    expect(result.current.newTags).toBe('');
    expect(result.current.templateId).toBe('tmpl-1');
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(refreshGroups).toHaveBeenCalledTimes(1);
  });

  it('quickCreateProfile generates a fingerprint, creates the profile with the typed fields, and resets the form', async () => {
    const generated = { name: 'fp' } as unknown as FingerprintInput;
    const invoke = mockInvoke({
      'fingerprint:generate': () => generated,
      'profiles:create': () => ({ id: 'p1' }),
    });
    const { result, refresh, refreshGroups } = setup();
    act(() => {
      result.current.setNewName('My Bot');
      result.current.setTemplateId('tmpl-1');
      result.current.setNewGroupId('group-1');
      result.current.setNewProxyId('proxy-1');
      result.current.setNewTags(' a , b ,, ');
    });

    await act(() => result.current.quickCreateProfile());

    expect(invoke).toHaveBeenCalledWith('fingerprint:generate', expect.objectContaining({ templateId: 'tmpl-1' }));
    expect(invoke).toHaveBeenCalledWith('profiles:create', {
      name: 'My Bot',
      groupId: 'group-1',
      proxyId: 'proxy-1',
      tags: ['a', 'b'],
      fingerprint: generated,
    });
    expect(result.current.newName).toBe('');
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(refreshGroups).toHaveBeenCalledTimes(1);
  });

  it('quickCreateProfile falls back to a timestamp-based name when newName is blank', async () => {
    const invoke = mockInvoke({
      'fingerprint:generate': () => ({}) as FingerprintInput,
      'profiles:create': () => ({ id: 'p1' }),
    });
    const { result } = setup();
    act(() => result.current.setNewName('   '));

    await act(() => result.current.quickCreateProfile());

    const createCall = invoke.mock.calls.find(([channel]) => channel === 'profiles:create');
    expect(createCall?.[1]).toMatchObject({ groupId: undefined, proxyId: undefined, tags: [] });
    expect((createCall?.[1] as { name: string }).name).toMatch(/^Profile /);
  });

  it('quickCreateProfile omits templateId/groupId/proxyId when the toolbar fields are empty', async () => {
    const invoke = mockInvoke({
      'fingerprint:generate': () => ({}) as FingerprintInput,
      'profiles:create': () => ({ id: 'p1' }),
    });
    const { result } = setup();

    await act(() => result.current.quickCreateProfile());

    expect(invoke).toHaveBeenCalledWith('fingerprint:generate', expect.objectContaining({ templateId: undefined }));
    const createCall = invoke.mock.calls.find(([channel]) => channel === 'profiles:create');
    expect(createCall?.[1]).toMatchObject({ groupId: undefined, proxyId: undefined });
  });
});
