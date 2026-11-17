import { describe, expect, it, vi } from 'vitest';
import {
  readThemePreference,
  resolveTheme,
  THEME_STORAGE_KEY,
  writeThemePreference,
} from './theme';

const storageWith = (value: string | null) => ({ getItem: vi.fn(() => value) });

describe('readThemePreference', () => {
  it.each([
    ['light', 'light'],
    ['dark', 'dark'],
    [null, 'system'],
    ['system', 'system'],
    ['DARK', 'system'],
    ['<script>', 'system'],
  ] as const)('reads %j as %s', (stored, expected) => {
    expect(readThemePreference(storageWith(stored))).toBe(expected);
  });

  it('falls back to system when storage is missing or throws', () => {
    expect(readThemePreference(undefined)).toBe('system');
    const throwing = {
      getItem: () => {
        throw new DOMException('denied', 'SecurityError');
      },
    };
    expect(readThemePreference(throwing)).toBe('system');
  });
});

describe('writeThemePreference', () => {
  it('stores an explicit choice and clears the key for system', () => {
    const storage = { setItem: vi.fn(), removeItem: vi.fn() };

    writeThemePreference(storage, 'dark');
    writeThemePreference(storage, 'system');

    expect(storage.setItem).toHaveBeenCalledWith(THEME_STORAGE_KEY, 'dark');
    expect(storage.removeItem).toHaveBeenCalledWith(THEME_STORAGE_KEY);
  });

  it('swallows a storage failure such as a full quota', () => {
    const storage = {
      setItem: () => {
        throw new DOMException('full', 'QuotaExceededError');
      },
      removeItem: vi.fn(),
    };

    expect(() => writeThemePreference(storage, 'light')).not.toThrow();
  });
});

describe('resolveTheme', () => {
  it('follows the system only when the preference is system', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });
});
