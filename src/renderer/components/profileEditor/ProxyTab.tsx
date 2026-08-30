import type { ProxyRecord } from '@shared/schemas/proxy';
import { useTranslation } from '../../i18n';

export function ProxyTab({
  proxyId,
  onProxyIdChange,
  proxies,
  saving,
  onSave,
}: {
  proxyId: string;
  onProxyIdChange: (value: string) => void;
  proxies: ProxyRecord[];
  saving: boolean;
  onSave: () => void;
}): JSX.Element {
  const { t } = useTranslation();
  return (
    <div>
      <label style={{ display: 'block', marginBottom: 8 }}>
        {t('editor.proxy.assigned')}
        <select value={proxyId} onChange={(e) => onProxyIdChange(e.target.value)} style={{ display: 'block', width: '100%', marginTop: 4 }}>
          <option value="">{t('common.none')}</option>
          {proxies.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} ({p.protocol}://{p.host}:{p.port})
            </option>
          ))}
        </select>
      </label>
      <button className="btn btn-primary" disabled={saving} onClick={onSave}>
        {saving && <span className="spinner" />}
        {t('common.save')}
      </button>
    </div>
  );
}
