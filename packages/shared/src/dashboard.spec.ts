import { describe, expect, it } from 'vitest';
import {
  dashboardSummaryPath,
  dashboardSummarySchema,
  percentChange,
  percentOf,
} from './dashboard';

const wire = {
  month: '2026-11',
  currency: 'AMD',
  income: '61500050',
  expense: '2000000',
  net: '-3000',
  transactionCount: 4,
  previous: { income: '0', expense: '0', net: '0' },
  balance: { total: '2999999999999997', previousMonthEnd: null, accountCount: 1 },
  history: [{ month: '2026-11', income: '61500050', expense: '2000000' }],
  categories: [
    {
      categoryId: '00000000-0000-7000-8000-00000000000b',
      name: 'Groceries',
      parentName: 'Food',
      amount: '2000000',
      transactionCount: 2,
    },
  ],
  daily: [{ date: '2026-11-01', income: '0', expense: '2000000' }],
  recentTransactions: [
    {
      id: '01a1f083-ce6a-736d-9190-90f0dc9eab54',
      type: 'expense',
      amount: '2000000',
      currency: 'AMD',
      occurredOn: '2026-11-01',
      description: null,
      account: { id: 'a1', name: 'Card' },
      category: { id: 'c1', name: 'Groceries', parentName: 'Food' },
    },
  ],
  accounts: [
    {
      id: 'a1',
      name: 'Card',
      type: 'checking',
      currency: 'AMD',
      isLiquid: true,
      balance: '2999999999999997',
    },
  ],
};

describe('dashboardSummarySchema', () => {
  it('reads every amount as an exact bigint, including sums beyond 2^53', () => {
    const summary = dashboardSummarySchema.parse(wire);
    expect(summary.income).toBe(61_500_050n);
    expect(summary.net).toBe(-3_000n);
    expect(summary.balance.total).toBe(2_999_999_999_999_997n);
    expect(summary.balance.previousMonthEnd).toBeNull();
    expect(summary.categories[0]!.amount).toBe(2_000_000n);
    expect(summary.daily[0]!.expense).toBe(2_000_000n);
    expect(summary.accounts[0]!.balance).toBe(2_999_999_999_999_997n);
  });

  it('reads sums with more digits than a single amount may have', () => {
    const summary = dashboardSummarySchema.parse({ ...wire, expense: '9223372036854775807' });
    expect(summary.expense).toBe(9_223_372_036_854_775_807n);
  });

  it('refuses an amount sent as a JSON number', () => {
    expect(dashboardSummarySchema.safeParse({ ...wire, income: 61500050 }).success).toBe(false);
  });

  it('keeps working when the API adds a field', () => {
    expect(dashboardSummarySchema.safeParse({ ...wire, savingsRate: '12' }).success).toBe(true);
  });
});

describe('dashboardSummaryPath', () => {
  it('names the month', () => {
    expect(dashboardSummaryPath('2026-11')).toBe('/dashboard/summary?month=2026-11');
  });
});

describe('percentChange', () => {
  it.each([
    [112_000n, 100_000n, 12n],
    [88_000n, 100_000n, -12n],
    [100_000n, 100_000n, 0n],
    [300n, 100n, 200n],
    // 0.5 % rounds away from zero both ways.
    [1_005n, 1_000n, 1n],
    [995n, 1_000n, -1n],
    [1_004n, 1_000n, 0n],
    [0n, 5_000n, -100n],
    // A negative base is measured by its magnitude: from −100 to −50 is up 50 %.
    [-50n, -100n, 50n],
  ])('%s after %s is %s%%', (current, previous, expected) => {
    expect(percentChange(current, previous)).toBe(expected);
  });

  it('has no percentage for a change from zero', () => {
    expect(percentChange(50_000n, 0n)).toBeNull();
    expect(percentChange(0n, 0n)).toBeNull();
  });

  it('stays exact for amounts beyond 2^53', () => {
    expect(percentChange(1_999_999_999_999_998n, 999_999_999_999_999n)).toBe(100n);
  });
});

describe('percentOf', () => {
  it.each([
    [28n, 100n, 28n],
    [1n, 3n, 33n],
    [2n, 3n, 67n],
    [1n, 200n, 1n],
    [1n, 201n, 0n],
    [5n, 5n, 100n],
  ])('%s of %s is %s%%', (part, total, expected) => {
    expect(percentOf(part, total)).toBe(expected);
  });

  it('has no share of nothing', () => {
    expect(percentOf(0n, 0n)).toBeNull();
    expect(percentOf(5n, -10n)).toBeNull();
  });
});
