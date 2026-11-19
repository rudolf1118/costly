import { describe, expect, it } from 'vitest';
import {
  currentMonth,
  dayAndMonth,
  formatMonth,
  isMonth,
  monthDays,
  shiftMonth,
  shortMonth,
} from './month';

describe('currentMonth', () => {
  it('is the month in the user’s time zone, not the browser’s', () => {
    // 21:30 UTC on 31 Oct is already 1 Nov in Yerevan (UTC+4), still 31 Oct in New York.
    const now = new Date('2026-10-31T21:30:00Z');
    expect(currentMonth('Asia/Yerevan', now)).toBe('2026-11');
    expect(currentMonth('America/New_York', now)).toBe('2026-10');
  });

  it('turns the year in the user’s time zone', () => {
    expect(currentMonth('Asia/Yerevan', new Date('2026-12-31T20:00:00Z'))).toBe('2027-01');
  });
});

describe('shiftMonth', () => {
  it.each([
    ['2026-11', -1, '2026-10'],
    ['2026-01', -1, '2025-12'],
    ['2026-12', 1, '2027-01'],
    ['2026-03', -11, '2025-04'],
    ['2026-03', 0, '2026-03'],
  ])('%s %+d is %s', (month, offset, expected) => {
    expect(shiftMonth(month, offset)).toBe(expected);
  });
});

describe('monthDays', () => {
  it('covers the whole month, leap days included', () => {
    expect(monthDays('2026-11')).toEqual({ from: '2026-11-01', to: '2026-11-30' });
    expect(monthDays('2028-02')).toEqual({ from: '2028-02-01', to: '2028-02-29' });
    expect(monthDays('2026-12')).toEqual({ from: '2026-12-01', to: '2026-12-31' });
  });
});

describe('isMonth', () => {
  it.each(['2026-11', '1900-01'])('accepts %s', (value) => expect(isMonth(value)).toBe(true));
  it.each(['2026-13', '2026-1', '1899-12', 202611, undefined, '2026-11-01'])(
    'refuses %j',
    (value) => expect(isMonth(value)).toBe(false),
  );
});

describe('formatting', () => {
  it('names months and days without shifting them by a time zone', () => {
    expect(formatMonth('2026-11')).toBe('November 2026');
    expect(shortMonth('2026-01')).toBe('Jan');
    expect(shortMonth('2026-01', true)).toBe('Jan 26');
    expect(dayAndMonth('2026-11-01')).toBe('1 Nov');
  });
});
