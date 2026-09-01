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
      <p className="text-dim text-sm">{t('editor.storage.hint')}</p>
      <button className="btn btn-ghost btn-sm" onClick={onClearCache}>{t('editor.storage.clearCache')}</button>
    </div>
  );
}
