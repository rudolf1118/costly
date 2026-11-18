import { TRANSACTION_TYPES, type TransactionFilters, type TransactionType } from '@costly/shared';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The transaction filters as they live in the address, so a filtered view
 * can be bookmarked, shared and restored with Back. Anything malformed is
 * dropped rather than sent to the API, which would refuse it.
 */
export function validateTransactionSearch(search: Record<string, unknown>): TransactionFilters {
  const pick = (key: string, pattern: RegExp) => {
    const value = search[key];
    return typeof value === 'string' && pattern.test(value) ? value : undefined;
  };
  const type = TRANSACTION_TYPES.includes(search.type as TransactionType)
    ? (search.type as TransactionType)
    : undefined;
  const filters: TransactionFilters = {
    accountId: pick('accountId', UUID),
    categoryId: pick('categoryId', UUID),
    type,
    from: pick('from', DATE),
    to: pick('to', DATE),
  };
  // Only the filters that are set, so the address stays short.
  return Object.fromEntries(
    Object.entries(filters).filter(([, value]) => value !== undefined),
  ) as TransactionFilters;
}

export function hasFilters(filters: TransactionFilters): boolean {
  return Object.values(filters).some((value) => value !== undefined && value !== '');
}
