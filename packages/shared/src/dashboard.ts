import { z } from 'zod';
import { ACCOUNT_TYPES, calendarDate, minorUnitsField } from './accounts';
import { TRANSACTION_TYPES } from './transactions';

/**
 * `GET /dashboard/summary?month=YYYY-MM` as `docs/02-requirements/dashboard-v1.md`
 * describes it. Every amount is read into an exact `bigint`; objects are not
 * strict, so a field the API adds later doesn't break this client.
 */

const yearMonth = z.string().regex(/^\d{4}-\d{2}$/);

/**
 * A sum of minor units, such as a month's expense or a balance. Unlike a
 * single amount it has no 15-digit limit: the API sums in PostgreSQL's
 * bigint, and many maximal amounts together exceed what one may be. Read
 * straight into a `bigint`, never through a number.
 */
const sumField = z
  .string()
  .regex(/^-?(?:0|[1-9][0-9]*)$/, 'Not a decimal string of minor units')
  .refine((value) => value !== '-0', 'Not a decimal string of minor units')
  .transform((value) => BigInt(value));

const count = z.number().int().nonnegative();

const totals = {
  income: sumField,
  expense: sumField,
  /** May be negative. */
  net: sumField,
};

export const dashboardSummarySchema = z.object({
  month: yearMonth,
  currency: z.string().length(3),
  ...totals,
  transactionCount: count,
  previous: z.object(totals),
  balance: z.object({
    /** The active accounts' balance at the end of the month. */
    total: sumField,
    /** At the end of the previous month; null if none of the accounts was open yet. */
    previousMonthEnd: sumField.nullable(),
    accountCount: count,
  }),
  /** 12 months, oldest first, the selected month last. */
  history: z.array(z.object({ month: yearMonth, income: sumField, expense: sumField })),
  /** The month's expense by category, largest first. */
  categories: z.array(
    z.object({
      categoryId: z.string().min(1),
      name: z.string(),
      parentName: z.string().nullable(),
      amount: sumField,
      transactionCount: count,
    }),
  ),
  /** Every day of the month. */
  daily: z.array(z.object({ date: calendarDate, income: sumField, expense: sumField })),
  recentTransactions: z.array(
    z.object({
      id: z.string().min(1),
      type: z.enum(TRANSACTION_TYPES),
      amount: minorUnitsField,
      currency: z.string().length(3),
      occurredOn: calendarDate,
      description: z.string().nullable(),
      account: z.object({ id: z.string().min(1), name: z.string() }),
      category: z.object({
        id: z.string().min(1),
        name: z.string(),
        parentName: z.string().nullable(),
      }),
    }),
  ),
  /** The active accounts with their current balances. */
  accounts: z.array(
    z.object({
      id: z.string().min(1),
      name: z.string(),
      type: z.enum(ACCOUNT_TYPES),
      currency: z.string().length(3),
      isLiquid: z.boolean(),
      balance: sumField,
    }),
  ),
});
export type DashboardSummary = z.output<typeof dashboardSummarySchema>;

export function dashboardSummaryPath(month: string): string {
  return `/dashboard/summary?month=${encodeURIComponent(month)}`;
}

/** `numerator / denominator` rounded half away from zero; the denominator is positive. */
function divideRounded(numerator: bigint, denominator: bigint): bigint {
  const magnitude = numerator < 0n ? -numerator : numerator;
  const rounded = (2n * magnitude + denominator) / (2n * denominator);
  return numerator < 0n ? -rounded : rounded;
}

/**
 * How much `current` changed relative to `previous`, in whole percent,
 * rounded half away from zero: 112,000 after 100,000 is `12n`. `null` when
 * `previous` is zero, because a change from nothing has no percentage. A
 * negative `previous` is measured by its magnitude, so a move up is always
 * positive. Integer arithmetic only: nothing is rounded before the end.
 */
export function percentChange(current: bigint, previous: bigint): bigint | null {
  if (previous === 0n) return null;
  const base = previous < 0n ? -previous : previous;
  return divideRounded((current - previous) * 100n, base);
}

/**
 * `part` as whole percent of `total`, rounded half away from zero. `null`
 * when `total` isn't positive: there is no share of nothing.
 */
export function percentOf(part: bigint, total: bigint): bigint | null {
  if (total <= 0n) return null;
  return divideRounded(part * 100n, total);
}
