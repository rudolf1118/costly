import { z } from 'zod';
import { calendarDate, minorUnitsField } from './accounts';

/**
 * Income and expense transactions as the API describes them in
 * `docs/02-requirements/ledger-transactions.md`. The amount is always
 * positive; the type says which way the money moved.
 */

export const TRANSACTION_TYPES = ['income', 'expense'] as const;
export type TransactionType = (typeof TRANSACTION_TYPES)[number];

export const TRANSACTION_TYPE_LABELS: Record<TransactionType, string> = {
  income: 'Income',
  expense: 'Expense',
};

/** The longest description the API accepts, in code points. */
export const DESCRIPTION_MAX = 255;

/** One transaction from `GET /transactions/:id`, a list page and every write. */
export const transactionSchema = z.object({
  id: z.string().min(1),
  type: z.enum(TRANSACTION_TYPES),
  accountId: z.string().min(1),
  categoryId: z.string().min(1),
  /** Positive minor units. */
  amount: minorUnitsField.refine((amount) => amount > 0n, 'Not a positive amount'),
  currency: z.string().length(3),
  occurredOn: calendarDate,
  description: z.string().nullable(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});
export type Transaction = z.output<typeof transactionSchema>;

/** One page of `GET /transactions`: `nextCursor` is null on the last page. */
export const transactionPageSchema = z.object({
  items: z.array(transactionSchema),
  nextCursor: z.string().min(1).nullable(),
});
export type TransactionPage = z.output<typeof transactionPageSchema>;

/** The amount with its direction: positive for income, negative for an expense. */
export function signedAmount(transaction: Pick<Transaction, 'type' | 'amount'>): bigint {
  return transaction.type === 'income' ? transaction.amount : -transaction.amount;
}

/** The body of `POST /transactions`. The amount is serialized for sending. */
export interface CreateTransactionBody {
  type: TransactionType;
  accountId: string;
  categoryId: string;
  amount: string;
  occurredOn: string;
  description?: string | null;
}

/** The body of `PATCH /transactions/:id`: any subset of the fields; `null` clears the description. */
export type UpdateTransactionBody = Partial<CreateTransactionBody>;

/** The filters of `GET /transactions`; every one is optional. */
export interface TransactionFilters {
  accountId?: string | undefined;
  categoryId?: string | undefined;
  type?: TransactionType | undefined;
  /** Inclusive, YYYY-MM-DD. */
  from?: string | undefined;
  /** Inclusive, YYYY-MM-DD. */
  to?: string | undefined;
}

/**
 * The path for one page of the list: the filters that are set, the page size
 * and the cursor of the previous page, in a stable order so equal filters
 * give equal paths.
 */
export function transactionsPath(
  filters: TransactionFilters,
  page: { limit?: number; cursor?: string | null } = {},
): string {
  const params = new URLSearchParams();
  for (const key of ['accountId', 'categoryId', 'type', 'from', 'to'] as const) {
    const value = filters[key];
    if (value) params.set(key, value);
  }
  if (page.limit !== undefined) params.set('limit', String(page.limit));
  if (page.cursor) params.set('cursor', page.cursor);
  const query = params.toString();
  return query ? `/transactions?${query}` : '/transactions';
}
