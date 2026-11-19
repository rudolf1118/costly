import { z } from 'zod';

/** The latest calendar date anywhere on Earth: today in UTC+14. */
export function latestDateToday(): string {
  return new Date(Date.now() + 14 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** True for a YYYY-MM-DD string naming a day that exists (no 2026-02-30). */
function isCalendarDate(date: string): boolean {
  const parsed = new Date(`${date}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}

/**
 * Any real calendar date as YYYY-MM-DD, such as a filter bound. Zod 4 runs
 * later checks even after a failed one, so the format check aborts: the date
 * check only ever sees the right shape.
 */
export const calendarDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, { error: 'Must be a date in the form YYYY-MM-DD', abort: true })
  .refine(isCalendarDate, { error: 'Must be a real calendar date', abort: true });

/**
 * A day something happened: a real calendar date from 1900-01-01 up to today
 * in any time zone, so no user is refused their own today.
 */
export const pastCalendarDate = calendarDate
  .refine((date) => date >= '1900-01-01', { error: 'Must not be before 1900-01-01' })
  .refine((date) => date <= latestDateToday(), { error: 'Must not be in the future' });

/** A DATE column as Prisma takes it: midnight UTC of that day. */
export function toDateColumn(date: string): Date {
  return new Date(`${date}T00:00:00Z`);
}

/** A DATE column as Prisma returns it (midnight UTC) back to YYYY-MM-DD. */
export function fromDateColumn(date: Date): string {
  return date.toISOString().slice(0, 10);
}
