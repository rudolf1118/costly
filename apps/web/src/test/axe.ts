import axe from 'axe-core';

/**
 * Runs axe on a rendered node and returns its violations as readable lines,
 * so a failing test says what is wrong: `expect(await axeViolations(el)).toEqual([])`.
 *
 * `color-contrast` is always off: it needs real layout, which jsdom doesn't
 * have; contrast is tested on the tokens instead. `region` (all content in
 * landmarks) is off for an isolated component and on for a whole page
 * (`page: true`). `skip` turns off more rules for one check; say why where
 * it is used.
 */
export async function axeViolations(
  node: Element = document.body,
  { skip = [], page = false }: { skip?: string[]; page?: boolean } = {},
): Promise<string[]> {
  const rules: Record<string, { enabled: false }> = { 'color-contrast': { enabled: false } };
  if (!page) rules.region = { enabled: false };
  for (const id of skip) rules[id] = { enabled: false };

  const result = await axe.run(node, { rules });
  return result.violations.flatMap((violation) =>
    violation.nodes.map((n) => `${violation.id}: ${violation.help} — ${n.html}`),
  );
}
