import { z } from 'zod';

/**
 * Categories as the API describes them in
 * `docs/02-requirements/ledger-categories.md`. Clients only read them for now:
 * the categories screen is a later task.
 */

export const CATEGORY_KINDS = ['income', 'expense'] as const;
export type CategoryKind = (typeof CATEGORY_KINDS)[number];

export const CATEGORY_NATURES = ['essential_fixed', 'essential_variable', 'discretionary'] as const;
export type CategoryNature = (typeof CATEGORY_NATURES)[number];

/** One category from `GET /categories` and `GET /categories/:id`. */
export const categorySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  kind: z.enum(CATEGORY_KINDS),
  /** `null` exactly for income categories. */
  nature: z.enum(CATEGORY_NATURES).nullable(),
  /** `null` for a top-level category. */
  parentId: z.string().min(1).nullable(),
  /** Shared by every user and read-only. */
  isSystem: z.boolean(),
  archivedAt: z.string().nullable(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});
export type Category = z.output<typeof categorySchema>;

/** `GET /categories?kind=…&status=…`. */
export const categoryListSchema = z.object({ items: z.array(categorySchema) });

export type CategoryStatusFilter = 'active' | 'archived' | 'all';
