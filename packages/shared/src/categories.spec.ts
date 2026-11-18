import { describe, expect, it } from 'vitest';
import { categoryListSchema, categorySchema } from './categories';

const wire = {
  id: '00000000-0000-7000-8000-00000000000b',
  name: 'Groceries',
  kind: 'expense',
  nature: 'essential_variable',
  parentId: '00000000-0000-7000-8000-00000000000a',
  isSystem: true,
  archivedAt: null,
  createdAt: '2026-11-13T09:30:00.000Z',
  updatedAt: '2026-11-13T09:30:00.000Z',
};

describe('categorySchema', () => {
  it('reads a system subcategory', () => {
    expect(categorySchema.parse(wire)).toMatchObject({ kind: 'expense', isSystem: true });
  });

  it('reads an income category, which has no nature', () => {
    expect(categorySchema.parse({ ...wire, kind: 'income', nature: null }).nature).toBeNull();
  });

  it.each([
    ['an unknown kind', { kind: 'transfer' }],
    ['an unknown nature', { nature: 'luxury' }],
    ['a missing isSystem', { isSystem: undefined }],
  ])('rejects %s', (_case, change) => {
    expect(categorySchema.safeParse({ ...wire, ...change }).success).toBe(false);
  });

  it('reads a list', () => {
    expect(categoryListSchema.parse({ items: [wire] }).items).toHaveLength(1);
  });
});
