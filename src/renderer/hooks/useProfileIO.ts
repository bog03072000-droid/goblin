import type { Profile } from '@shared/schemas/profile';
import { callApi } from '../services/api';
import { useAsyncAction } from './useAsyncAction';
import { useTranslation } from '../i18n';

/**
 * Owns the single-profile and whole-list import/export/backup/restore
 * actions (as opposed to bulk actions against a selection, which live in
 * useProfileSelection) — extracted out of ProfilesPage.tsx as another
 * self-contained slice with its own pending/error state, same pattern as
 * useProfileCreate.
 */
export function useProfileIO(options: { selected: Set<string>; setInfo: (message: string) => void; refresh: () => Promise<void> }): {
  ioAction: ReturnType<typeof useAsyncAction>;
  exportConfig: (id: string) => Promise<void>;
  backupOne: (id: string) => Promise<void>;
  restoreProfile: () => Promise<void>;
  importProfiles: () => Promise<void>;
  exportSelected: () => Promise<void>;
  exportAll: () => Promise<void>;
} {
  const { selected, setInfo, refresh } = options;
  const { t } = useTranslation();
  const ioAction = useAsyncAction();

  async function exportConfig(id: string): Promise<void> {
    await ioAction.run(async () => {
      const savedPath = await callApi<'profiles:exportConfig', string | null>('profiles:exportConfig', { id });
      if (savedPath) setInfo(t('profiles.msg.exportedConfig', { path: savedPath }));
    });
  }

  async function backupOne(id: string): Promise<void> {
    await ioAction.run(async () => {
      const savedPath = await callApi<'profiles:backup', string>('profiles:backup', { id });
      setInfo(t('profiles.msg.backedUp', { path: savedPath }));
    });
  }

  async function restoreProfile(): Promise<void> {
    await ioAction.run(async () => {
      const restored = await callApi<'profiles:restore', Profile | null>('profiles:restore', {});
      if (restored) {
        setInfo(t('profiles.msg.restored', { name: restored.name }));
        await refresh();
      }
    });
  }

  async function importProfiles(): Promise<void> {
    await ioAction.run(async () => {
      const result = await callApi<'profiles:import', { created: Profile[]; errors: Array<{ path: string; message: string }> }>(
        'profiles:import',
        {},
      );
      if (result.created.length > 0) {
        setInfo(
          t('profiles.msg.imported', { count: result.created.length }) +
            (result.errors.length > 0 ? t('profiles.msg.importedWithFailures', { count: result.errors.length }) : ''),
        );
        await refresh();
      } else if (result.errors.length > 0) {
        ioAction.setError(result.errors.map((e) => `${e.path}: ${e.message}`).join('; '));
      }
    });
  }

  async function exportSelected(): Promise<void> {
    await ioAction.run(async () => {
      const dir = await callApi<'profiles:exportSelected', string | null>('profiles:exportSelected', {
        ids: Array.from(selected),
      });
      if (dir) setInfo(t('profiles.msg.exportedSelected', { count: selected.size, path: dir }));
    });
  }

  async function exportAll(): Promise<void> {
    await ioAction.run(async () => {
      const dir = await callApi<'profiles:exportAll', string | null>('profiles:exportAll', {});
      if (dir) setInfo(t('profiles.msg.exportedAll', { path: dir }));
    });
  }

  return { ioAction, exportConfig, backupOne, restoreProfile, importProfiles, exportSelected, exportAll };
}
