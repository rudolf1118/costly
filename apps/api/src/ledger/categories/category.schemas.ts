import { z } from 'zod';
import { CategoryKind, CategoryNature } from '../../generated/prisma/client';
import { displayName } from '../display-name';

export const categoryKind = z.enum(CategoryKind, { error: 'Must be one of: income, expense' });

const categoryNature = z.enum(CategoryNature, {
  error: 'Must be one of: essential_fixed, essential_variable, discretionary',
});

export const INCOME_HAS_NO_NATURE = 'Income categories have no nature';

/**
 * docs/02-requirements/ledger-categories.md. Expense categories need a
 * nature; income categories must not send one. Whether parentId names a
 * usable parent is checked by the service, against the database.
 */
export const createCategorySchema = z
  .strictObject({
    name: displayName,
    kind: categoryKind,
    nature: categoryNature.optional(),
    parentId: z.uuid({ error: 'Must be a category id (UUID)' }).nullable().optional(),
  })
  .superRefine((category, context) => {
    if (category.kind === 'income' && category.nature !== undefined) {
      context.addIssue({ code: 'custom', path: ['nature'], message: INCOME_HAS_NO_NATURE });
    }
    if (category.kind === 'expense' && category.nature === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['nature'],
        message: 'Required for expense categories',
      });
    }
  });

export type CreateCategoryInput = z.output<typeof createCategorySchema>;

/**
 * The editable fields. Strict, so an attempt to change the kind, parent,
 * owner or system status is a 400, never ignored.
 */
export const updateCategorySchema = z
  .strictObject({
    name: displayName.optional(),
    nature: categoryNature.optional(),
  })
  .refine((patch) => Object.values(patch).some((value) => value !== undefined), {
    error: 'Provide at least one of: name, nature',
  });

export type UpdateCategoryInput = z.output<typeof updateCategorySchema>;

/** docs/02-requirements/ledger-categories.md, Endpoints */
export const listCategoriesQuerySchema = z.strictObject({
  kind: categoryKind.optional(),
  status: z.enum(['active', 'archived', 'all']).default('active'),
});

export type ListCategoriesQuery = z.output<typeof listCategoriesQuerySchema>;

/** The :id route parameter. A malformed id is a 400 and says nothing about any category. */
export const categoryParamsSchema = z.strictObject({
  id: z.uuid({ error: 'Must be a category id (UUID)' }),
});

export type CategoryParams = z.output<typeof categoryParamsSchema>;
