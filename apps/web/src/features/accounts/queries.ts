import { type Account, accountListSchema, type AccountStatusFilter } from '@costly/shared';
import { useQuery } from '@tanstack/react-query';
import { useSessionStore } from '../../auth/SessionContext';

/** Query keys: everything under `accounts` is refetched after any account write. */
export const accountKeys = {
  all: ['accounts'] as const,
  list: (status: AccountStatusFilter) => ['accounts', 'list', status] as const,
  detail: (id: string) => ['accounts', 'detail', id] as const,
};

/** The user's accounts with this status, in the order they were created. */
export function useAccounts(status: AccountStatusFilter) {
  const { api } = useSessionStore();
  return useQuery({
    queryKey: accountKeys.list(status),
    queryFn: async ({ signal }): Promise<Account[]> => {
      const { items } = await api.request(`/accounts?status=${status}`, {
        schema: accountListSchema,
        signal,
      });
      return items;
    },
  });
}
