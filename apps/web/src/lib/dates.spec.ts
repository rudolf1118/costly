import { describe, expect, it } from 'vitest';
import { formatCalendarDate, todayIn } from './dates';

describe('formatCalendarDate', () => {
  it('shows the day the string names, whatever the browser’s zone', () => {
    expect(formatCalendarDate('2026-11-01')).toBe('1 Nov 2026');
    expect(formatCalendarDate('2026-12-31')).toBe('31 Dec 2026');
  });
});

describe('todayIn', () => {
  // 22:30 UTC on 16 November is already 17 November in Yerevan (UTC+4).
  const now = new Date('2026-11-16T22:30:00Z');

  it('uses the given time zone', () => {
    expect(todayIn('Asia/Yerevan', now)).toBe('2026-11-17');
    expect(todayIn('UTC', now)).toBe('2026-11-16');
    expect(todayIn('America/Los_Angeles', now)).toBe('2026-11-16');
  });
});
