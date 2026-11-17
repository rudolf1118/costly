import type { Category } from '../../generated/prisma/client';

/**
 * What the API returns for a category. The owner id is never included:
 * isSystem tells a shared system category from the user's own.
 */
export interface CategoryResponse {
  id: string;
  name: string;
  kind: Category['kind'];
  nature: Category['nature'];
  parentId: string | null;
  isSystem: boolean;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export function toCategoryResponse(category: Category): CategoryResponse {
  return {
    id: category.id,
    name: category.name,
    kind: category.kind,
    nature: category.nature,
    parentId: category.parentId,
    isSystem: category.userId === null,
    archivedAt: category.archivedAt,
    createdAt: category.createdAt,
    updatedAt: category.updatedAt,
  };
}
