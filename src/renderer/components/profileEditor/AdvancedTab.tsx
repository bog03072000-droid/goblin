import type { Profile } from '@shared/schemas/profile';
import { useTranslation } from '../../i18n';

export function AdvancedTab({ profile }: { profile: Profile }): JSX.Element {
  const { t } = useTranslation();
  return (
    <table>
      <tbody>
        <tr>
          <th style={{ width: 180 }}>{t('editor.advanced.id')}</th>
          <td className="mono">{profile.id}</td>
        </tr>
        <tr>
          <th>{t('editor.advanced.created')}</th>
          <td className="mono">{profile.createdAt}</td>
        </tr>
        <tr>
          <th>{t('editor.advanced.updated')}</th>
          <td className="mono">{profile.updatedAt}</td>
        </tr>
        <tr>
          <th>{t('editor.advanced.lastStarted')}</th>
          <td className="mono">{profile.lastStartedAt ?? '—'}</td>
        </tr>
        <tr>
          <th>{t('editor.advanced.lastStopped')}</th>
          <td className="mono">{profile.lastStoppedAt ?? '—'}</td>
        </tr>
      </tbody>
    </table>
  );
}
