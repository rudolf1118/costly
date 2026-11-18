import { todayIn } from '../../lib/dates';

/**
 * Months as the dashboard handles them: plain YYYY-MM strings naming a
 * calendar month, never a moment in time, so no browser time zone can shift
 * one into its neighbour.
 */

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;

export function isMonth(value: unknown): value is string {
  return typeof value === 'string' && MONTH.test(value) && value >= '1900-01';
}

/** The month it is now in the user's time zone, which decides where a day belongs. */
export function currentMonth(timeZone: string, now: Date = new Date()): string {
  return todayIn(timeZone, now).slice(0, 7);
}

/** The month `offset` months after YYYY-MM (before, for a negative offset). */
export function shiftMonth(month: string, offset: number): string {
  const year = Number(month.slice(0, 4));
  const index = Number(month.slice(5, 7)) - 1 + offset;
  const shifted = new Date(Date.UTC(year, index, 1));
  return shifted.toISOString().slice(0, 7);
}

/** The first and last day of a month, as the transaction filters take them. */
export function monthDays(month: string): { from: string; to: string } {
  const year = Number(month.slice(0, 4));
  const index = Number(month.slice(5, 7)) - 1;
  const last = new Date(Date.UTC(year, index + 1, 0)).toISOString().slice(0, 10);
  return { from: `${month}-01`, to: last };
}

const LONG = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const NAME = new Intl.DateTimeFormat('en-GB', { month: 'long', timeZone: 'UTC' });
const SHORT = new Intl.DateTimeFormat('en-GB', { month: 'short', timeZone: 'UTC' });
const SHORT_YEAR = new Intl.DateTimeFormat('en-GB', {
  month: 'short',
  year: '2-digit',
  timeZone: 'UTC',
});
const DAY_MONTH = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});

const at = (month: string) => new Date(`${month}-01T00:00:00Z`);

/** "2026-11" → "November 2026". */
export function formatMonth(month: string): string {
  return LONG.format(at(month));
}

/** "2026-11" → "November". */
export function monthName(month: string): string {
  return NAME.format(at(month));
}

/** "2026-11" → "Nov"; with the year, "Nov 26". */
export function shortMonth(month: string, withYear = false): string {
  return (withYear ? SHORT_YEAR : SHORT).format(at(month));
}

/** "2026-11-05" → "5 Nov". */
export function dayAndMonth(date: string): string {
  return DAY_MONTH.format(new Date(`${date}T00:00:00Z`));
}
