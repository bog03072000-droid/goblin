import { describe, it, expect } from 'vitest';
import { translate, DEFAULT_LOCALE, LOCALES } from '../../src/renderer/i18n';
import en from '../../src/renderer/i18n/en';
import uk from '../../src/renderer/i18n/uk';
import { DEFAULT_SETTINGS } from '../../src/shared/schemas/settings';

describe('i18n', () => {
  it('Ukrainian is the default locale', () => {
    expect(DEFAULT_LOCALE).toBe('uk');
    expect(DEFAULT_SETTINGS.language).toBe('uk');
  });

  it('supports exactly Ukrainian and English', () => {
    expect(LOCALES.sort()).toEqual(['en', 'uk']);
  });

  it('loads Ukrainian translations for known keys', () => {
    expect(translate('uk', 'app.sidebar.profiles')).toBe('Профілі');
    expect(translate('uk', 'profiles.create')).toBe('Новий профіль');
    expect(translate('uk', 'settings.language.uk')).toContain('Українська');
  });

  it('loads English translations for known keys', () => {
    expect(translate('en', 'app.sidebar.profiles')).toBe('Profiles');
    expect(translate('en', 'profiles.create')).toBe('New Profile');
  });

  it('falls back to English for a locale missing a key, never showing the raw key', () => {
    // Every key in `en` must resolve to real text in every locale — either a
    // genuine translation or the English fallback — never the dotted key
    // itself, per the "no raw translation keys shown to the user" rule.
    for (const key of Object.keys(en) as Array<keyof typeof en>) {
      for (const locale of LOCALES) {
        const result = translate(locale, key);
        expect(result).not.toBe(key);
        expect(result.length).toBeGreaterThan(0);
      }
    }
  });

  it('interpolates {placeholder} variables', () => {
    expect(translate('en', 'profiles.selectedCount', { count: 3 })).toBe('3 selected');
    expect(translate('uk', 'profiles.msg.restored', { name: 'Test' })).toBe('Відновлено "Test"');
  });

  it('leaves an unmatched placeholder untouched rather than crashing', () => {
    expect(translate('en', 'profiles.selectedCount')).toBe('{count} selected');
  });

  it('no major UI translation keys are missing from the Ukrainian dictionary (spot check core surfaces)', () => {
    const coreKeys: Array<keyof typeof en> = [
      'app.sidebar.profiles',
      'app.sidebar.proxies',
      'app.sidebar.logs',
      'app.sidebar.settings',
      'profiles.create',
      'profiles.table.name',
      'editor.tab.fingerprint',
      'editor.fingerprint.auto',
      'editor.fingerprint.manual',
      'proxy.title',
      'proxy.create',
      'settings.language.label',
      'logs.table.time',
    ];
    for (const key of coreKeys) {
      expect(uk[key], `missing Ukrainian translation for "${key}"`).toBeDefined();
    }
  });
});
