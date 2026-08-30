import { useTranslation } from '../../i18n';

export function StorageTab({
  profilePath,
  onClearCache,
}: {
  profilePath: string;
  onClearCache: () => void;
}): JSX.Element {
  const { t } = useTranslation();
  return (
    <div>
      <p>
        <strong>{t('editor.storage.path')}</strong> <span className="mono">{profilePath}</span>
      </p>
      <p style={{ color: 'var(--ash-dim)', fontSize: 12 }}>{t('editor.storage.hint')}</p>
      <button className="btn btn-ghost btn-sm" onClick={onClearCache}>{t('editor.storage.clearCache')}</button>
    </div>
  );
}
