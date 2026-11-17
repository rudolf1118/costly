# @costly/design-tokens

The approved design's tokens (ADR-0010) as one typed source, `src/tokens.ts`, generated as CSS
custom properties in `tokens.css`.

```sh
pnpm --filter @costly/design-tokens generate   # after changing src/tokens.ts
```

`tokens.css` is committed. A test fails when it no longer matches `src/tokens.ts`, so the two
cannot drift.

## What is in it

| Group | Tokens | CSS |
|---|---|---|
| Colour | Cobalt scale; 48 theme colours for light and dark | `--costly-color-<name>` |
| Elevation | `e1` (menus), `e2` (dialogs); none in dark mode, which uses `raised` | `--costly-shadow-<name>` |
| Type | Geist and Geist Mono; 9 text styles from the Type board | `--costly-font-*`, `--costly-text-<style>-{size,line-height,weight,tracking}` |
| Radius | `xs` 4, `s` 6, `m` 10, `l` 14, `full` | `--costly-radius-<name>` |
| Motion | 8 duration and easing pairs from the Motion board | `--costly-motion-<name>-{duration,easing}` |
| Breakpoints | `sm` 768, `md` 1024, `lg` 1440 | `--costly-breakpoint-<name>` |

Spacing is a 4 px scale, which is Tailwind's default, so it is not re-declared.

## Tailwind

`tailwind.css` is a generated Tailwind v4 theme that exposes only these tokens: Tailwind's own
palette, type scale, radii, shadows, easings and breakpoints are cleared. Utilities read the
`--costly-*` variables, so they follow the theme at runtime.

| Token | Utility |
|---|---|
| colour `textSecondary` | `text-text-secondary`, `bg-…`, `border-…` |
| text style `body` | `text-body` (size, line height, weight and tracking together) |
| radius `xs`, `s`, `m`, `l` | `rounded-xs`, `rounded-sm`, `rounded-md`, `rounded-lg` |
| elevation `e1`, `e2` | `shadow-e1`, `shadow-e2` |
| motion `control` | `ease-control` with `duration-160` |
| breakpoints | `sm:` 768, `md:` 1024, `lg:` 1440 |

The design's `s`, `m` and `l` radii are renamed because `rounded-s` is Tailwind's start-corners
utility.

## Themes

Light is the default. `data-theme="dark"` or `data-theme="light"` on `<html>` forces a theme;
without it, `prefers-color-scheme` decides, so the colours are right before any script runs.

Most dark values come from the theme variables of the design's dark screens. The few the design
doesn't give are marked `derived` in `src/tokens.ts` with the reasoning: the dark primary hover
and pressed fills, the dark negative ink, the dark disabled fill, the dark border hover and the
dark scrim.

## Contrast

The tests check every text and background pair the components use against WCAG 2.2 AA in both
themes: 4.5 : 1 for text; 3 : 1 for large text, the focus ring and meaningful marks.

Known gaps in the approved design, left as designed until decided otherwise:

- **Input borders** (`borderStrong` on `surface`) are 1.5 : 1 light and 1.7 : 1 dark, below the
  3 : 1 that WCAG 1.4.11 asks for the boundary of a text field. Every field has a visible label,
  and focus adds a Cobalt border and halo.
- **The dark primary fill** (`accent`) is 2.7 : 1 on the dark page. Buttons are identified by
  their label, which is 6.5 : 1 on the fill, so this is not a failure; meaningful marks use
  `accentText` instead.
