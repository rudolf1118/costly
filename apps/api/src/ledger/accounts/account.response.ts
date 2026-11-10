import type { Account } from '../../generated/prisma/client';

/**
 * What the API returns for an account. The owner id is never included; amounts
 * are decimal strings of minor units (ADR-0002) and the opening date a plain
 * YYYY-MM-DD. There is no current balance: without a ledger there is nothing
 * to derive it from (docs/02-requirements/ledger-accounts.md).
 */
export interface AccountResponse {
  id: string;
  name: string;
  type: Account['type'];
  currency: string;
  isLiquid: boolean;
  openingBalance: string;
  openingDate: string;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export function toAccountResponse(account: Account): AccountResponse {
  return {
    id: account.id,
    name: account.name,
    type: account.type,
    currency: account.currency,
    isLiquid: account.isLiquid,
    openingBalance: account.openingBalance.toString(),
    // A DATE column arrives as midnight UTC of that day.
    openingDate: account.openingDate.toISOString().slice(0, 10),
    archivedAt: account.archivedAt,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
  };
}
