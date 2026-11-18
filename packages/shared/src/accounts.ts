import { z } from 'zod';
import { parseMinorUnits } from './money';

/**
 * Financial accounts as the API describes them in
 * `docs/02-requirements/ledger-accounts.md`. Like the identity schemas, the
 * response object is not strict: a field the API adds later must not break a
 * client that doesn't use it yet.
 */

export const ACCOUNT_TYPES = ['checking', 'cash', 'savings', 'credit_card'] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  checking: 'Checking',
  cash: 'Cash',
  savings: 'Savings',
  credit_card: 'Credit card',
};

/**
 * What the API assumes when `isLiquid` is left out: checking, cash and
 * credit cards count as money available to spend, savings doesn't.
 */
export const DEFAULT_LIQUIDITY: Record<AccountType, boolean> = {
  checking: true,
  cash: true,
  savings: false,
  credit_card: true,
};

/** A plain calendar day, YYYY-MM-DD. */
export const calendarDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** An amount as the API sends it, read into an exact `bigint`. */
export const minorUnitsField = z.string().transform((value, context) => {
  try {
    return parseMinorUnits(value);
  } catch {
    context.addIssue({ code: 'custom', message: 'Not a decimal string of minor units' });
    return z.NEVER;
  }
});

/** One account from `GET /accounts`, `GET /accounts/:id` and every write. */
export const accountSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  type: z.enum(ACCOUNT_TYPES),
  currency: z.string().length(3),
  isLiquid: z.boolean(),
  /** The balance at the start of `openingDate`. */
  openingBalance: minorUnitsField,
  openingDate: calendarDate,
  /**
   * The current balance: the opening balance plus income minus expenses over
   * the account's transactions, computed by the API on every read. It can
   * exceed the range of a single amount, which `bigint` holds exactly.
   */
  balance: z.string().transform((value, context) => {
    if (!/^-?(?:0|[1-9][0-9]*)$/.test(value) || value === '-0') {
      context.addIssue({ code: 'custom', message: 'Not a decimal string of minor units' });
      return z.NEVER;
    }
    return BigInt(value);
  }),
  archivedAt: z.string().nullable(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});
export type Account = z.output<typeof accountSchema>;

/** `GET /accounts?status=…`. */
export const accountListSchema = z.object({ items: z.array(accountSchema) });

export type AccountStatusFilter = 'active' | 'archived' | 'all';

/** The body of `POST /accounts`. The opening balance is serialized for sending. */
export interface CreateAccountBody {
  name: string;
  type: AccountType;
  isLiquid: boolean;
  openingBalance: string;
  openingDate: string;
}

/** The body of `PATCH /accounts/:id`: only these fields can change. */
export interface UpdateAccountBody {
  name?: string;
  type?: AccountType;
  isLiquid?: boolean;
}

/**
 * The name rule the API applies to accounts and categories: NFC, trimmed,
 * 1–64 code points, no control characters or lone surrogates. Returns the
 * normalized name, or why it can't be used.
 */
export const DISPLAY_NAME_MAX = 64;

export type DisplayNameResult =
  { ok: true; name: string } | { ok: false; error: 'empty' | 'length' | 'characters' };

export function checkDisplayName(input: string): DisplayNameResult {
  const name = input.normalize('NFC').trim();
  if (name === '') return { ok: false, error: 'empty' };
  if ([...name].length > DISPLAY_NAME_MAX) return { ok: false, error: 'length' };
  if (/[\p{Cc}\p{Cs}]/u.test(name)) return { ok: false, error: 'characters' };
  return { ok: true, name };
}
