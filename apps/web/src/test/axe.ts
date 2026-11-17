import axe from 'axe-core';

/**
 * Runs axe on a rendered node and returns its violations as readable lines,
 * so a failing test says what is wrong: `expect(await axeViolations(el)).toEqual([])`.
 *
 * Two rules are always off. `color-contrast` needs real layout, which jsdom
 * doesn't have; contrast is tested on the tokens instead. `region` expects a
 * whole page with landmarks, not an isolated component. `skip` turns off more
 * rules for one check; say why where it is used.
 */
export async function axeViolations(
  node: Element = document.body,
  { skip = [] }: { skip?: string[] } = {},
): Promise<string[]> {
  const rules: Record<string, { enabled: false }> = {
    'color-contrast': { enabled: false },
    region: { enabled: false },
  };
  for (const id of skip) rules[id] = { enabled: false };

  const result = await axe.run(node, { rules });
  return result.violations.flatMap((violation) =>
    violation.nodes.map((n) => `${violation.id}: ${violation.help} — ${n.html}`),
  );
}
