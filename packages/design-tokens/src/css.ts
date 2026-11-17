import {
  breakpoints,
  elevation,
  fonts,
  motion,
  radius,
  type ThemeColors,
  type ThemeName,
  themes,
  typeScale,
} from './tokens.ts';

/** Every custom property starts with this, so tokens never collide with a library's. */
export const PREFIX = '--costly';

const kebab = (name: string) => name.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());

export const colorVar = (name: keyof ThemeColors) => `${PREFIX}-color-${kebab(name)}`;

function themeDeclarations(theme: ThemeName): string[] {
  const colors = Object.entries(themes[theme]).map(
    // Lower-case hex, as Prettier writes it, so the committed file stays formatted.
    ([name, value]) => `${colorVar(name as keyof ThemeColors)}: ${value.toLowerCase()};`,
  );
  const shadows = Object.entries(elevation[theme]).map(
    ([name, value]) => `${PREFIX}-shadow-${name}: ${value};`,
  );
  return [`color-scheme: ${theme};`, ...colors, ...shadows];
}

function staticDeclarations(): string[] {
  const lines = [`${PREFIX}-font-sans: ${fonts.sans};`, `${PREFIX}-font-mono: ${fonts.mono};`];
  for (const [name, t] of Object.entries(typeScale)) {
    lines.push(
      `${PREFIX}-text-${name}-size: ${t.size / 16}rem;`,
      `${PREFIX}-text-${name}-line-height: ${t.lineHeight / 16}rem;`,
      `${PREFIX}-text-${name}-weight: ${t.weight};`,
      `${PREFIX}-text-${name}-tracking: ${t.tracking}em;`,
    );
  }
  for (const [name, px] of Object.entries(radius)) {
    lines.push(`${PREFIX}-radius-${name}: ${px}px;`);
  }
  for (const [name, m] of Object.entries(motion)) {
    lines.push(
      `${PREFIX}-motion-${name}-duration: ${m.duration}ms;`,
      `${PREFIX}-motion-${name}-easing: ${m.easing};`,
    );
  }
  for (const [name, px] of Object.entries(breakpoints)) {
    lines.push(`${PREFIX}-breakpoint-${name}: ${px}px;`);
  }
  return lines;
}

const block = (selector: string, lines: string[], indent = '') =>
  `${indent}${selector} {\n${lines.map((l) => `${indent}  ${l}`).join('\n')}\n${indent}}`;

/**
 * The tokens as CSS. Light is the default. `data-theme="dark"` on the root
 * forces dark, `data-theme="light"` forces light, and without either the
 * system preference decides — so the page has the right colours even before
 * any script runs.
 */
export function tokensCss(): string {
  return [
    '/* Generated from src/tokens.ts by `pnpm --filter @costly/design-tokens generate`. Do not edit. */',
    '',
    block(':root', staticDeclarations()),
    '',
    block(":root,\n[data-theme='light']", themeDeclarations('light')),
    '',
    block("[data-theme='dark']", themeDeclarations('dark')),
    '',
    '@media (prefers-color-scheme: dark) {',
    block(":root:not([data-theme='light'])", themeDeclarations('dark'), '  '),
    '}',
    '',
  ].join('\n');
}
