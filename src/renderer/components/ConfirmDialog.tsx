import { TriangleAlert } from 'lucide-react';
import { useTranslation } from '../i18n';

export function ConfirmDialog({
  message,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}): JSX.Element {
  const { t } = useTranslation();
  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-panel modal-panel-sm" onClick={(e) => e.stopPropagation()}>
        <p className="confirm-message">
          <TriangleAlert size={18} strokeWidth={2.25} className="confirm-icon" />
          <span>{message}</span>
        </p>
        <div className="flex-row-end">
          <button className="btn btn-ghost btn-sm" onClick={onCancel}>
            {t('common.cancel')}
          </button>
          <button className="btn btn-danger btn-sm" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
