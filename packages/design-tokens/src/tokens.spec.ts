import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { contrastRatio } from './contrast.ts';
import { tailwindThemeCss, tokensCss } from './css.ts';
import { type ThemeColors, type ThemeName, themes } from './tokens.ts';

describe('generated CSS', () => {
  // Run `pnpm --filter @costly/design-tokens generate` after changing a token.
  it.each([
    ['tokens.css', tokensCss],
    ['tailwind.css', tailwindThemeCss],
  ])('%s is up to date with tokens.ts', (file, generate) => {
    const committed = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

    expect(committed).toBe(generate());
  });

  it('gives Tailwind a utility for every colour token', () => {
    for (const name of Object.keys(themes.light)) {
      const kebab = name.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());
      expect(tailwindThemeCss()).toContain(`--color-${kebab}: var(--costly-color-${kebab});`);
    }
  });

  it('declares the same colour names for both themes', () => {
    expect(Object.keys(themes.dark).sort()).toEqual(Object.keys(themes.light).sort());
  });
});

describe('contrastRatio', () => {
  it('matches the WCAG reference values', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
    expect(contrastRatio('#FFFFFF', '#FFFFFF')).toBeCloseTo(1, 5);
    // The Color board lists Cobalt with white text at 8.05 : 1.
    expect(contrastRatio('#FFFFFF', '#2849A8')).toBeCloseTo(8.05, 1);
  });
});

type Key = keyof ThemeColors;

/** Normal text: WCAG 2.2 AA 1.4.3. */
const TEXT: [Key, Key[]][] = [
  ['text', ['page', 'surface', 'subtle', 'subtleAlt', 'raised']],
  ['textBody', ['page', 'surface', 'subtle']],
  ['textSecondary', ['page', 'surface', 'subtle', 'subtleAlt', 'raised']],
  ['accentText', ['page', 'surface', 'subtle', 'accentSoft', 'navSelected']],
  ['accentInk', ['accentSoft', 'accentSoftStrong']],
  ['onAccent', ['accent', 'accentHover', 'accentPressed']],
  ['positive', ['surface', 'positiveSoft']],
  ['positiveInk', ['positiveSoft']],
  ['negative', ['surface', 'negativeSoft']],
  ['negativeInk', ['negativeSoft']],
  ['warning', ['surface']],
  ['warningInk', ['warningSoft']],
  ['info', ['surface']],
  ['onBrand', ['brand']],
  ['onBrandSecondary', ['brand']],
  ['onInverse', ['inverse']],
  ['onInverseSecondary', ['inverse']],
];

/**
 * Large text and essential non-text marks: 1.4.3 (large) and 1.4.11.
 *
 * `accent` is deliberately absent: it fills buttons, which are identified by
 * their label (`onAccent` above), and the dark fill is 2.7 : 1 on the page.
 * Marks that carry meaning on their own (progress, chart lines) use
 * `accentText`, which is held to this bar.
 */
const LARGE_OR_GRAPHIC: [Key, Key[]][] = [
  ['textTertiary', ['page', 'surface']],
  ['focus', ['page', 'surface']],
  ['accentText', ['page', 'surface']],
];

describe.each(['light', 'dark'] as ThemeName[])('%s theme contrast', (theme) => {
  const colors = themes[theme];

  it.each(TEXT.flatMap(([fg, bgs]) => bgs.map((bg) => [fg, bg] as const)))(
    '%s on %s is at least 4.5 : 1',
    (fg, bg) => {
      expect(contrastRatio(colors[fg], colors[bg])).toBeGreaterThanOrEqual(4.5);
    },
  );

  it.each(LARGE_OR_GRAPHIC.flatMap(([fg, bgs]) => bgs.map((bg) => [fg, bg] as const)))(
    '%s on %s is at least 3 : 1',
    (fg, bg) => {
      expect(contrastRatio(colors[fg], colors[bg])).toBeGreaterThanOrEqual(3);
    },
  );
});
