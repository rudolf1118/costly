import {
  type Account,
  accountListSchema,
  accountSchema,
  type AccountStatusFilter,
} from '@costly/shared';
import { useQuery } from '@tanstack/react-query';
import { useSessionStore } from '../../auth/SessionContext';

/** Query keys. After a write, lists are refetched and the details take the API's answer. */
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

/** One account, active or archived. A 404 means it doesn't exist or isn't the user's. */
export function useAccount(id: string) {
  const { api } = useSessionStore();
  return useQuery({
    queryKey: accountKeys.detail(id),
    queryFn: ({ signal }) => api.request(`/accounts/${id}`, { schema: accountSchema, signal }),
  });
}
