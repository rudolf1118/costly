import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from 'react';
import {
  applyTheme,
  browserStorage,
  DARK_QUERY,
  readThemePreference,
  type ResolvedTheme,
  resolveTheme,
  type ThemePreference,
  writeThemePreference,
} from './theme';

interface ThemeContextValue {
  preference: ThemePreference;
  resolved: ResolvedTheme;
  setPreference(preference: ThemePreference): void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function systemPrefersDark(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia(DARK_QUERY).matches;
}

/**
 * Owns the theme after the first paint. index.html already set `data-theme`;
 * this keeps it right when the preference changes, or when it is "system" and
 * the operating system switches between light and dark.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>(() =>
    readThemePreference(browserStorage()),
  );
  const [prefersDark, setPrefersDark] = useState(systemPrefersDark);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia(DARK_QUERY);
    const onChange = (event: MediaQueryListEvent) => setPrefersDark(event.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  const resolved = resolveTheme(preference, prefersDark);

  useEffect(() => {
    applyTheme(document.documentElement, resolved);
  }, [resolved]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      preference,
      resolved,
      setPreference(next) {
        writeThemePreference(browserStorage(), next);
        setPreferenceState(next);
      },
    }),
    [preference, resolved],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme must be used inside <ThemeProvider>');
  return context;
}
