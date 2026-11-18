import type { Transaction } from '../../generated/prisma/client';
import { fromDateColumn } from '../calendar-date';

/**
 * What the API returns for a transaction. The owner id is never included; the
 * amount is a positive decimal string of minor units (ADR-0002) whose
 * direction is the type, and the date a plain YYYY-MM-DD.
 */
export interface TransactionResponse {
  id: string;
  type: Transaction['type'];
  accountId: string;
  categoryId: string;
  amount: string;
  currency: string;
  occurredOn: string;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export function toTransactionResponse(transaction: Transaction): TransactionResponse {
  return {
    id: transaction.id,
    type: transaction.type,
    accountId: transaction.accountId,
    categoryId: transaction.categoryId,
    amount: transaction.amount.toString(),
    currency: transaction.currency,
    occurredOn: fromDateColumn(transaction.occurredOn),
    description: transaction.description,
    createdAt: transaction.createdAt,
    updatedAt: transaction.updatedAt,
  };
}
