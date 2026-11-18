/**
 * Calendar days as the API sends them: plain YYYY-MM-DD strings with no time
 * or zone. They are formatted as the day they name, never shifted by the
 * browser's time zone.
 */

const DAY = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

/** "2026-11-01" → "1 Nov 2026". */
export function formatCalendarDate(date: string): string {
  return DAY.format(new Date(`${date}T00:00:00Z`));
}

/** Today's date, YYYY-MM-DD, in the given IANA time zone. */
export function todayIn(timeZone: string, now: Date = new Date()): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}
