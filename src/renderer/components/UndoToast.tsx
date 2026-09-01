import { useEffect } from 'react';
import { X } from 'lucide-react';
import { useTranslation } from '../i18n';

/** A dismissible "X deleted. Undo" toast with a visible countdown, shown after
 * a soft-delete (see profileManager.ts's SOFT_DELETE_WINDOW_MS). Purely a UI
 * affordance — the actual undo window is enforced server-side by a main-
 * process timer that keeps running even if this toast is dismissed, navigated
 * away from, or the countdown otherwise never reaches zero on screen. */
export function UndoToast({
  message,
  durationMs,
  onUndo,
  onDismiss,
}: {
  message: string;
  durationMs: number;
  onUndo: () => void;
  onDismiss: () => void;
}): JSX.Element {
  const { t } = useTranslation();

  useEffect(() => {
    const timer = setTimeout(onDismiss, durationMs);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [durationMs]);

  return (
    <div className="undo-toast" role="status">
      <div className="undo-toast-bar" style={{ animationDuration: `${durationMs}ms` }} />
      <span className="undo-toast-message">{message}</span>
      <div className="undo-toast-actions">
        <button className="btn btn-ghost btn-sm" onClick={onUndo}>
          {t('common.undo')}
        </button>
        <button className="undo-toast-close" onClick={onDismiss} aria-label={t('common.dismiss')}>
          <X size={14} strokeWidth={2.25} />
        </button>
      </div>
    </div>
  );
}
