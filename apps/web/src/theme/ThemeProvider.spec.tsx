import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { THEME_STORAGE_KEY } from './theme';
import { ThemeProvider, useTheme } from './ThemeProvider';

let systemDark = false;
const listeners = new Set<(event: { matches: boolean }) => void>();

function setSystemDark(matches: boolean) {
  systemDark = matches;
  act(() => listeners.forEach((listener) => listener({ matches })));
}

beforeEach(() => {
  window.localStorage.clear();
  systemDark = false;
  listeners.clear();
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({
      get matches() {
        return systemDark;
      },
      addEventListener: (_: string, listener: (event: { matches: boolean }) => void) =>
        listeners.add(listener),
      removeEventListener: (_: string, listener: (event: { matches: boolean }) => void) =>
        listeners.delete(listener),
    })),
  );
});

afterEach(() => {
  document.documentElement.removeAttribute('data-theme');
});

function Probe() {
  const { preference, resolved, setPreference } = useTheme();
  return (
    <div>
      <output>
        {preference}/{resolved}
      </output>
      <button onClick={() => setPreference('dark')}>dark</button>
      <button onClick={() => setPreference('system')}>system</button>
    </div>
  );
}

const theme = () => document.documentElement.getAttribute('data-theme');

describe('ThemeProvider', () => {
  it('starts from the saved preference', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark');

    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );

    expect(screen.getByRole('status')).toHaveProperty('textContent', 'dark/dark');
    expect(theme()).toBe('dark');
  });

  it('saves a new choice and applies it at once', () => {
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );

    act(() => screen.getByRole('button', { name: 'dark' }).click());

    expect(theme()).toBe('dark');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
  });

  it('follows the operating system while the preference is system', () => {
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(theme()).toBe('light');

    setSystemDark(true);
    expect(theme()).toBe('dark');

    act(() => screen.getByRole('button', { name: 'dark' }).click());
    setSystemDark(false);
    expect(theme()).toBe('dark');

    act(() => screen.getByRole('button', { name: 'system' }).click());
    expect(theme()).toBe('light');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
  });

  it('refuses to be used outside the provider', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => render(<Probe />)).toThrow(/ThemeProvider/);
  });
});
