import {
  type Account,
  accountSchema,
  type CreateAccountBody,
  type UpdateAccountBody,
} from '@costly/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useSessionStore } from '../../auth/SessionContext';
import { accountKeys } from './queries';

/**
 * Account writes. None is optimistic (ADR-0010): the screen changes when the
 * API has answered. The answer is stored as the account's details, and every
 * list is refetched, since a write can move an account between them.
 */
function useAccountWrite<V>(write: (variables: V) => Promise<Account>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: write,
    onSuccess: async (account) => {
      queryClient.setQueryData(accountKeys.detail(account.id), account);
      await queryClient.invalidateQueries({ queryKey: [...accountKeys.all, 'list'] });
    },
  });
}

export function useCreateAccount() {
  const { api } = useSessionStore();
  return useAccountWrite((body: CreateAccountBody) =>
    api.request('/accounts', { method: 'POST', body, schema: accountSchema }),
  );
}

export function useUpdateAccount(id: string) {
  const { api } = useSessionStore();
  return useAccountWrite((body: UpdateAccountBody) =>
    api.request(`/accounts/${id}`, { method: 'PATCH', body, schema: accountSchema }),
  );
}

/** Archiving an archived account changes nothing, so a repeated click is harmless. */
export function useArchiveAccount(id: string) {
  const { api } = useSessionStore();
  return useAccountWrite(() =>
    api.request(`/accounts/${id}/archive`, { method: 'POST', schema: accountSchema }),
  );
}

/** Fails with 409 while an active account uses the same name. */
export function useRestoreAccount(id: string) {
  const { api } = useSessionStore();
  return useAccountWrite(() =>
    api.request(`/accounts/${id}/restore`, { method: 'POST', schema: accountSchema }),
  );
}
