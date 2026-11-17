import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readThemePreference, resolveTheme, THEME_STORAGE_KEY } from './theme';

/** The inline script in index.html that sets the theme before the first paint. */
const script = (() => {
  const html = readFileSync(`${import.meta.dirname}/../../index.html`, 'utf8');
  const match = /<script id="theme-script">([\s\S]*?)<\/script>/.exec(html);
  if (!match?.[1]) throw new Error('index.html has no #theme-script');
  return match[1];
})();

function stubBrowser(stored: string | null | 'throws', systemDark: boolean | 'missing') {
  const getItem =
    stored === 'throws'
      ? () => {
          throw new DOMException('denied', 'SecurityError');
        }
      : () => stored;
  vi.stubGlobal('localStorage', { getItem });
  vi.stubGlobal(
    'matchMedia',
    systemDark === 'missing' ? undefined : vi.fn(() => ({ matches: systemDark })),
  );
  return { getItem };
}

afterEach(() => {
  document.documentElement.removeAttribute('data-theme');
});

describe('index.html theme script', () => {
  it('reads the same storage key as the theme module', () => {
    expect(script).toContain(`'${THEME_STORAGE_KEY}'`);
  });

  const cases = ['light', 'dark', null, 'nonsense', 'throws'] as const;
  const systems = [true, false, 'missing'] as const;

  it.each(cases.flatMap((stored) => systems.map((system) => [stored, system] as const)))(
    'agrees with resolveTheme for stored %j and system dark %j',
    (stored, system) => {
      const { getItem } = stubBrowser(stored, system);

      new Function(script)();

      const expected = resolveTheme(readThemePreference({ getItem }), system === true);
      expect(document.documentElement.getAttribute('data-theme')).toBe(expected);
    },
  );
});
