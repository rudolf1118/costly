import axe from 'axe-core';

/**
 * Runs axe on a rendered node and returns its violations as readable lines,
 * so a failing test says what is wrong: `expect(await axeViolations(el)).toEqual([])`.
 *
 * Two rules are off. `color-contrast` needs real layout, which jsdom doesn't
 * have; contrast is tested on the tokens instead. `region` expects a whole
 * page with landmarks, not an isolated component.
 */
export async function axeViolations(node: Element = document.body): Promise<string[]> {
  const result = await axe.run(node, {
    rules: { 'color-contrast': { enabled: false }, region: { enabled: false } },
  });
  return result.violations.flatMap((violation) =>
    violation.nodes.map((n) => `${violation.id}: ${violation.help} — ${n.html}`),
  );
}
