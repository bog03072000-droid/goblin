import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import en, { type TranslationKey } from './en';
import uk from './uk';

export type Locale = 'uk' | 'en';
export const LOCALES: Locale[] = ['uk', 'en'];
export const DEFAULT_LOCALE: Locale = 'uk';

const DICTIONARIES: Record<Locale, Partial<Record<TranslationKey, string>>> = { uk, en };

function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, key: string) => {
    const value = vars[key];
    return value === undefined ? match : String(value);
  });
}

/** English is the fallback for any key missing from another locale, so a key
 * that exists anywhere in the app is guaranteed to render — never a raw
 * "profiles.title"-style key shown to the user. */
export function translate(locale: Locale, key: TranslationKey, vars?: Record<string, string | number>): string {
  const template = DICTIONARIES[locale][key] ?? en[key] ?? key;
  return interpolate(template, vars);
}

interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({
  initialLocale,
  onLocaleChange,
  children,
}: {
  initialLocale: Locale;
  onLocaleChange: (locale: Locale) => void;
  children: ReactNode;
}): ReturnType<typeof createElement> {
  const [locale, setLocaleState] = useState<Locale>(initialLocale);

  useEffect(() => {
    setLocaleState(initialLocale);
  }, [initialLocale]);

  const setLocale = useCallback(
    (next: Locale) => {
      setLocaleState(next);
      onLocaleChange(next);
    },
    [onLocaleChange],
  );

  const t = useCallback((key: TranslationKey, vars?: Record<string, string | number>) => translate(locale, key, vars), [
    locale,
  ]);

  const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t]);

  return createElement(I18nContext.Provider, { value }, children);
}

export function useTranslation(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useTranslation() must be used within an I18nProvider');
  return ctx;
}

export type { TranslationKey };
