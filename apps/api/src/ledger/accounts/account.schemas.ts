import { z } from 'zod';
import { minorUnits } from '../../platform/money/minor-units';
import { AccountType } from '../../generated/prisma/client';

/** checking, cash and credit_card count as money available to spend; savings doesn't. */
export const DEFAULT_LIQUIDITY: Record<AccountType, boolean> = {
  checking: true,
  cash: true,
  savings: false,
  credit_card: true,
};

const NAME_MAX = 64;

/**
 * Trimmed, 1-64 characters counted as PostgreSQL's char_length does (code
 * points), with no control characters and no unpaired surrogates, which
 * would otherwise be stored silently as U+FFFD.
 */
const accountName = z
  .string()
  .trim()
  .min(1, { error: 'Must not be empty' })
  .refine((name) => [...name].length <= NAME_MAX, {
    error: `Must be at most ${NAME_MAX} characters`,
  })
  .refine((name) => !/[\p{Cc}\p{Cs}]/u.test(name), {
    error: 'Must not contain control characters or invalid Unicode',
  });

const accountType = z.enum(AccountType, {
  error: 'Must be one of: checking, cash, savings, credit_card',
});

/** The latest calendar date anywhere on Earth: today in UTC+14. */
function latestDateToday(): string {
  return new Date(Date.now() + 14 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** True for a YYYY-MM-DD string naming a day that exists (no 2026-02-30). */
function isCalendarDate(date: string): boolean {
  const parsed = new Date(`${date}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}

/**
 * A real calendar date as YYYY-MM-DD, from 1900-01-01 up to today in any time
 * zone. Zod 4 runs later checks even after a failed one, so the format check
 * aborts: the date checks below only ever see the right shape.
 */
const openingDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, { error: 'Must be a date in the form YYYY-MM-DD', abort: true })
  .refine(isCalendarDate, { error: 'Must be a real calendar date', abort: true })
  .refine((date) => date >= '1900-01-01', { error: 'Must not be before 1900-01-01' })
  .refine((date) => date <= latestDateToday(), { error: 'Must not be in the future' });

/** docs/02-requirements/ledger-accounts.md */
export const createAccountSchema = z.strictObject({
  name: accountName,
  type: accountType,
  // v1 has a single currency (ADR-0002); the field exists so clients don't change later.
  currency: z.literal('AMD', { error: 'Only AMD is supported' }).default('AMD'),
  isLiquid: z.boolean().optional(),
  openingBalance: minorUnits,
  openingDate,
});

export type CreateAccountInput = z.output<typeof createAccountSchema>;

export const listAccountsQuerySchema = z.strictObject({
  status: z.enum(['active', 'archived', 'all']).default('active'),
});

export type ListAccountsQuery = z.output<typeof listAccountsQuerySchema>;

/** The :id route parameter. A malformed id is a 400 and says nothing about any account. */
export const accountParamsSchema = z.strictObject({
  id: z.uuid({ error: 'Must be an account id (UUID)' }),
});

export type AccountParams = z.output<typeof accountParamsSchema>;

/**
 * The editable fields. Strict, so an attempt to change the opening balance,
 * opening date, currency, owner or archive state is a 400, never ignored.
 */
export const updateAccountSchema = z
  .strictObject({
    name: accountName.optional(),
    type: accountType.optional(),
    isLiquid: z.boolean().optional(),
  })
  .refine((patch) => Object.values(patch).some((value) => value !== undefined), {
    error: 'Provide at least one of: name, type, isLiquid',
  });

export type UpdateAccountInput = z.output<typeof updateAccountSchema>;
