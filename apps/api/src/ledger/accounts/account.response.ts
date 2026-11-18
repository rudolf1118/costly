import type { AccountWithBalance } from './accounts.service';

/**
 * What the API returns for an account. The owner id is never included; amounts
 * are decimal strings of minor units (ADR-0002) and the opening date a plain
 * YYYY-MM-DD. `balance` is the current balance, derived from the ledger on
 * every read (docs/02-requirements/ledger-transactions.md).
 */
export interface AccountResponse {
  id: string;
  name: string;
  type: AccountWithBalance['type'];
  currency: string;
  isLiquid: boolean;
  openingBalance: string;
  openingDate: string;
  balance: string;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export function toAccountResponse(account: AccountWithBalance): AccountResponse {
  return {
    id: account.id,
    name: account.name,
    type: account.type,
    currency: account.currency,
    isLiquid: account.isLiquid,
    openingBalance: account.openingBalance.toString(),
    // A DATE column arrives as midnight UTC of that day.
    openingDate: account.openingDate.toISOString().slice(0, 10),
    balance: account.balance.toString(),
    archivedAt: account.archivedAt,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
  };
}
