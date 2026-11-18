import { type TransactionFilters, transactionPageSchema, transactionsPath } from '@costly/shared';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useSessionStore } from '../../auth/SessionContext';

/** Rows per request. The API allows up to 100. */
export const PAGE_SIZE = 50;

/** Query keys. Any transaction write refetches every list (and the account balances). */
export const transactionKeys = {
  all: ['transactions'] as const,
  list: (filters: TransactionFilters) => ['transactions', 'list', filters] as const,
};

/**
 * The user's transactions matching the filters, newest first, one page at a
 * time. Each page asks for the rows after the previous page's cursor (keyset
 * pagination), so loading more never repeats or skips a row.
 */
export function useTransactions(filters: TransactionFilters) {
  const { api } = useSessionStore();
  return useInfiniteQuery({
    queryKey: transactionKeys.list(filters),
    queryFn: ({ pageParam, signal }) =>
      api.request(transactionsPath(filters, { limit: PAGE_SIZE, cursor: pageParam }), {
        schema: transactionPageSchema,
        signal,
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (page) => page.nextCursor,
  });
}
