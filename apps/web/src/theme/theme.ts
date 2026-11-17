/**
 * Light, dark or follow the system. The preference is the only thing the web
 * client keeps in localStorage (ADR-0010); it is not sensitive, and every
 * access is guarded because storage can be unavailable or throw.
 *
 * index.html has a small copy of `readThemePreference` and `resolveTheme` that
 * runs before the first paint. theme-script.spec.ts keeps the two in step.
 */

export type ThemePreference = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'costly.theme';
export const DARK_QUERY = '(prefers-color-scheme: dark)';

type ReadableStorage = Pick<Storage, 'getItem'>;
type WritableStorage = Pick<Storage, 'setItem' | 'removeItem'>;

export function readThemePreference(storage: ReadableStorage | undefined): ThemePreference {
  try {
    const value = storage?.getItem(THEME_STORAGE_KEY);
    return value === 'light' || value === 'dark' ? value : 'system';
  } catch {
    return 'system';
  }
}

/** Saves the choice. "system" is the absence of a choice, so it clears the key. */
export function writeThemePreference(
  storage: WritableStorage | undefined,
  preference: ThemePreference,
): void {
  try {
    if (preference === 'system') storage?.removeItem(THEME_STORAGE_KEY);
    else storage?.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // The theme still applies for this visit; it just won't be remembered.
  }
}

export function resolveTheme(
  preference: ThemePreference,
  systemPrefersDark: boolean,
): ResolvedTheme {
  if (preference === 'system') return systemPrefersDark ? 'dark' : 'light';
  return preference;
}

export function applyTheme(root: HTMLElement, theme: ResolvedTheme): void {
  root.setAttribute('data-theme', theme);
}

/** `window.localStorage`, or undefined where reading the property itself throws. */
export function browserStorage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}
