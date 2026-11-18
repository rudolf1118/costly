import { afterEach, describe, expect, it, vi } from 'vitest';
import { dashboardMonth, monthRange } from './month';

describe('monthRange', () => {
  it('covers the first to the last day of the month', () => {
    expect(monthRange('2026-11')).toMatchObject({ start: '2026-11-01', end: '2026-11-30' });
    expect(monthRange('2026-12')).toMatchObject({ start: '2026-12-01', end: '2026-12-31' });
  });

  it('knows leap years', () => {
    expect(monthRange('2024-02').end).toBe('2024-02-29');
    expect(monthRange('2026-02').end).toBe('2026-02-28');
    expect(monthRange('2000-02').end).toBe('2000-02-29');
    expect(monthRange('1900-02').end).toBe('1900-02-28');
  });

  it('crosses the year boundary for the previous month and the history window', () => {
    expect(monthRange('2026-01')).toEqual({
      month: '2026-01',
      start: '2026-01-01',
      end: '2026-01-31',
      previousStart: '2025-12-01',
      previousEnd: '2025-12-31',
      historyStart: '2025-02-01',
    });
  });

  it('starts the history 11 months before the month, so it holds 12', () => {
    expect(monthRange('2026-11').historyStart).toBe('2025-12-01');
    expect(monthRange('2026-12').historyStart).toBe('2026-01-01');
  });
});

describe('dashboardMonth', () => {
  afterEach(() => vi.useRealTimers());

  it('accepts a real month up to the current one in UTC+14', () => {
    vi.useFakeTimers({ now: new Date('2026-11-30T10:00:00Z') });
    // 10:00 UTC on 30 Nov is already 1 Dec in UTC+14.
    expect(dashboardMonth.safeParse('2026-12').success).toBe(true);
    expect(dashboardMonth.safeParse('2026-11').success).toBe(true);
    expect(dashboardMonth.safeParse('1900-01').success).toBe(true);
  });

  it('refuses a month after it', () => {
    vi.useFakeTimers({ now: new Date('2026-11-19T10:00:00Z') });
    expect(dashboardMonth.safeParse('2026-12').success).toBe(false);
  });

  it.each(['2026-13', '2026-00', '2026-1', '26-11', '2026-11-01', ' 2026-11', '1899-12', ''])(
    'refuses %j',
    (month) => {
      expect(dashboardMonth.safeParse(month).success).toBe(false);
    },
  );
});
