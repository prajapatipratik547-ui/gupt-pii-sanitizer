import type { Theme } from './settings';

const ORDER: readonly Theme[] = ['system', 'light', 'dark'];

export function nextTheme(current: Theme): Theme {
  return ORDER[(ORDER.indexOf(current) + 1) % ORDER.length] as Theme;
}

/** "system" removes the override so `prefers-color-scheme` decides. */
export function applyTheme(theme: Theme, toggle: HTMLElement): void {
  if (theme === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', theme);
  toggle.setAttribute('aria-label', `Colour theme: ${theme}. Activate to change.`);
  toggle.title = `Theme: ${theme}`;
}
