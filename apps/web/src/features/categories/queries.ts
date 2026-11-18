import { type Category, categoryListSchema } from '@costly/shared';
import { useQuery } from '@tanstack/react-query';
import { useSessionStore } from '../../auth/SessionContext';

export const categoryKeys = {
  all: ['categories'] as const,
};

/**
 * Every category the user can see, active and archived, system ones first.
 * Archived ones are kept so past transactions still show their labels; the
 * pickers offer only active ones.
 */
export function useCategories() {
  const { api } = useSessionStore();
  return useQuery({
    queryKey: categoryKeys.all,
    queryFn: async ({ signal }): Promise<Category[]> => {
      const { items } = await api.request('/categories?status=all', {
        schema: categoryListSchema,
        signal,
      });
      return items;
    },
    // Categories change rarely and only through their own screen (a later task).
    staleTime: 5 * 60_000,
  });
}

/** "Food › Restaurants" for a subcategory, the plain name at the top level. */
export function categoryLabel(category: Category, byId: ReadonlyMap<string, Category>): string {
  const parent = category.parentId ? byId.get(category.parentId) : undefined;
  return parent ? `${parent.name} › ${category.name}` : category.name;
}
