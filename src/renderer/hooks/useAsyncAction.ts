import { useCallback, useState } from 'react';
import { describeError } from '../services/errorMessages';
import { useTranslation } from '../i18n';

/** Wraps the try/catch + human-readable-error + pending-flag pattern that
 * used to be re-typed in every async handler across the app. `run` swallows
 * the error (already mapped via describeError and exposed as `error`) rather
 * than rethrowing, since every call site just wanted to show a banner, not
 * handle the failure itself. */
export function useAsyncAction(): {
  pending: boolean;
  error: string | null;
  setError: (error: string | null) => void;
  run: (fn: () => Promise<void>) => Promise<void>;
} {
  const { t } = useTranslation();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async (fn: () => Promise<void>): Promise<void> => {
      setPending(true);
      setError(null);
      try {
        await fn();
      } catch (err) {
        setError(describeError(err, t));
      } finally {
        setPending(false);
      }
    },
    [t],
  );

  return { pending, error, setError, run };
}
