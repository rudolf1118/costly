import { z } from 'zod';
import { latestDateToday } from '../../ledger/calendar-date';

/** How many months the income and expense history covers, the selected one included. */
export const HISTORY_MONTHS = 12;

/**
 * The calendar days a dashboard month covers, as YYYY-MM-DD strings that
 * compare directly with `occurred_on`. No time zone is involved: a
 * transaction's date is already the user's own day
 * (docs/02-requirements/dashboard-v1.md).
 */
export interface MonthRange {
  month: string;
  /** The month's first day. */
  start: string;
  /** The month's last day. */
  end: string;
  /** The previous month's first and last day. */
  previousStart: string;
  previousEnd: string;
  /** The first day of the history window: HISTORY_MONTHS − 1 months before `start`. */
  historyStart: string;
}

/** The first day of the month `offset` months from YYYY-MM, as YYYY-MM-DD. */
function firstDay(year: number, monthIndex: number, offset = 0): string {
  return new Date(Date.UTC(year, monthIndex + offset, 1)).toISOString().slice(0, 10);
}

/** The last day of the month `offset` months from YYYY-MM: the day before the next one's first. */
function lastDay(year: number, monthIndex: number, offset = 0): string {
  return new Date(Date.UTC(year, monthIndex + offset + 1, 0)).toISOString().slice(0, 10);
}

/** The days of a valid YYYY-MM month and of the months the dashboard compares it with. */
export function monthRange(month: string): MonthRange {
  const year = Number(month.slice(0, 4));
  const monthIndex = Number(month.slice(5, 7)) - 1;
  return {
    month,
    start: firstDay(year, monthIndex),
    end: lastDay(year, monthIndex),
    previousStart: firstDay(year, monthIndex, -1),
    previousEnd: lastDay(year, monthIndex, -1),
    historyStart: firstDay(year, monthIndex, -(HISTORY_MONTHS - 1)),
  };
}

/** The latest month any transaction can be dated in: the current month in UTC+14. */
function latestMonth(): string {
  return latestDateToday().slice(0, 7);
}

/**
 * A month as YYYY-MM, from 1900-01 to the current month anywhere on Earth.
 * Later months are refused rather than answered with zeros: no transaction
 * can be dated there, so the numbers would only look like data.
 */
export const dashboardMonth = z
  .string({ error: 'Must be a month in the form YYYY-MM' })
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, { error: 'Must be a month in the form YYYY-MM', abort: true })
  .refine((month) => month >= '1900-01', { error: 'Must not be before 1900-01' })
  .refine((month) => month <= latestMonth(), { error: 'Must not be in the future' });

/** GET /dashboard/summary. */
export const dashboardQuerySchema = z.strictObject({ month: dashboardMonth });

export type DashboardQuery = z.output<typeof dashboardQuerySchema>;
