import { z } from 'zod';
import { CategoryKind } from '../../generated/prisma/client';

export const categoryKind = z.enum(CategoryKind, { error: 'Must be one of: income, expense' });

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
