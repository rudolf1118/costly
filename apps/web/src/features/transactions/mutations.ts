import {
  type CreateTransactionBody,
  type Transaction,
  transactionSchema,
  type UpdateTransactionBody,
} from '@costly/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useSessionStore } from '../../auth/SessionContext';
import { accountKeys } from '../accounts/queries';
import { transactionKeys } from './queries';

/**
 * Transaction writes. None is optimistic (ADR-0010): the screen changes when
 * the API has answered. Every write can move a row in any filtered list and
 * changes the balance of one or two accounts, so both are refetched: the
 * balances come from the API, never from arithmetic in the browser.
 */
function useTransactionWrite<V, R>(write: (variables: V) => Promise<R>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: write,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: transactionKeys.all }),
        queryClient.invalidateQueries({ queryKey: accountKeys.all }),
      ]);
    },
  });
}

export function useCreateTransaction() {
  const { api } = useSessionStore();
  return useTransactionWrite((body: CreateTransactionBody): Promise<Transaction> =>
    api.request('/transactions', { method: 'POST', body, schema: transactionSchema }),
  );
}

export function useUpdateTransaction(id: string) {
  const { api } = useSessionStore();
  return useTransactionWrite((body: UpdateTransactionBody): Promise<Transaction> =>
    api.request(`/transactions/${id}`, { method: 'PATCH', body, schema: transactionSchema }),
  );
}

/** Deletes for good; the API answers 204 with no body. */
export function useDeleteTransaction() {
  const { api } = useSessionStore();
  return useTransactionWrite((id: string): Promise<void> =>
    api.request(`/transactions/${id}`, { method: 'DELETE' }),
  );
}
