import type { Settings } from '@shared/schemas/settings';

/** Applies a theme choice to the document root as a `[data-theme]` attribute
 * — 'system' clears it entirely (letting global.css's `prefers-color-scheme`
 * media query decide), 'light'/'dark' set it explicitly so the matching
 * `:root[data-theme="..."]` block in global.css wins regardless of the OS
 * setting. Called once on load (App.tsx) and again immediately whenever the
 * user changes it in Settings, so the switch is instant, no restart needed. */
export function applyTheme(theme: Settings['theme']): void {
  if (theme === 'system') {
    delete document.documentElement.dataset.theme;
  } else {
    document.documentElement.dataset.theme = theme;
  }
}
