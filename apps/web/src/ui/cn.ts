import { TAILWIND_RADIUS, themes, typeScale } from '@costly/design-tokens';
import { type ClassValue, clsx } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

const kebab = (name: string) => name.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());

/**
 * tailwind-merge told about Costly's theme. Without this it can't tell that
 * `text-body` is a size and `text-text-secondary` a colour, treats them as
 * the same kind of class and silently drops one.
 */
const merge = extendTailwindMerge({
  override: {
    theme: {
      color: Object.keys(themes.light).map(kebab),
      text: Object.keys(typeScale),
      radius: Object.values(TAILWIND_RADIUS),
      shadow: ['e1', 'e2'],
    },
  },
});

/** Joins class names, letting a later Tailwind class override an earlier one of the same kind. */
export function cn(...inputs: ClassValue[]): string {
  return merge(clsx(inputs));
}
