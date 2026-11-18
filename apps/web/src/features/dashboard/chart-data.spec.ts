import { dashboardSummarySchema } from '@costly/shared';
import { describe, expect, it } from 'vitest';
import {
  categorySlices,
  compactDram,
  dailyData,
  hasHistory,
  historyData,
  OTHER_COLOR,
  plotValue,
} from './chart-data';
import { wireSummary } from './test-dashboard';

const summary = dashboardSummarySchema.parse(wireSummary('2026-10'));

const category = (name: string, amount: bigint, parentName: string | null = null) => ({
  categoryId: `id-${name}`,
  name,
  parentName,
  amount,
  transactionCount: 1,
});

describe('historyData', () => {
  it('keeps the last 6 or 12 months, ending at the selected one', () => {
    const six = historyData(summary.history, 6);
    expect(six.map((d) => d.month)).toEqual([
      '2026-05',
      '2026-06',
      '2026-07',
      '2026-08',
      '2026-09',
      '2026-10',
    ]);
    expect(historyData(summary.history, 12)).toHaveLength(12);
  });

  it('carries the exact amounts beside the plotted dram', () => {
    const last = historyData(summary.history, 6).at(-1)!;
    expect(last).toMatchObject({
      incomeMinor: 65000000n,
      expenseMinor: 24500000n,
      income: 650000,
      expense: 245000,
    });
  });

  it('labels the first month and every January with the year', () => {
    const labels = historyData(summary.history, 12).map((d) => d.label);
    expect(labels[0]).toBe('Nov 25');
    expect(labels[1]).toBe('Dec');
    expect(labels[2]).toBe('Jan 26');
  });

  it('knows when there is nothing to plot', () => {
    expect(hasHistory(historyData(summary.history, 6))).toBe(true);
    expect(
      hasHistory(
        historyData(
          summary.history.map((m) => ({ ...m, income: 0n, expense: 0n })),
          6,
        ),
      ),
    ).toBe(false);
  });
});

describe('categorySlices', () => {
  it('gives each category its share and a fixed colour slot in order', () => {
    const slices = categorySlices(summary.categories, summary.expense);
    expect(slices.map((s) => [s.label, s.percent, s.color])).toEqual([
      ['Housing › Rent', 90n, 'var(--chart-category-1)'],
      ['Food › Groceries', 8n, 'var(--chart-category-2)'],
      ['Transport › Taxi', 3n, 'var(--chart-category-3)'],
    ]);
  });

  it('gives six categories six slots, and folds a seventh and more into "Other"', () => {
    const six = Array.from({ length: 6 }, (_, i) => category(`C${i}`, BigInt(600 - i * 50)));
    expect(categorySlices(six, 2_850n).every((s) => s.categoryId !== null)).toBe(true);

    const nine = [...six, category('C6', 100n), category('C7', 60n), category('C8', 40n)];
    const total = nine.reduce((sum, c) => sum + c.amount, 0n);
    const slices = categorySlices(nine, total);

    expect(slices).toHaveLength(6);
    const other = slices.at(-1)!;
    expect(other).toMatchObject({
      categoryId: null,
      name: '4 other categories',
      amount: 350n + 100n + 60n + 40n,
      color: OTHER_COLOR,
      transactionCount: 4,
    });
    // The slices add up to the month's expense exactly.
    expect(slices.reduce((sum, s) => sum + s.amount, 0n)).toBe(total);
  });

  it('has no share when there was no expense', () => {
    expect(categorySlices([category('A', 0n)], 0n)[0]!.percent).toBeNull();
  });

  it('keeps amounts beyond 2^53 exact', () => {
    const huge = 9_007_199_254_740_993n;
    const slice = categorySlices([category('Big', huge)], huge)[0]!;
    expect(slice.amount).toBe(huge);
    expect(slice.percent).toBe(100n);
  });
});

describe('dailyData', () => {
  it('has every day with its spending and the running total', () => {
    const days = dailyData(summary.daily);
    expect(days).toHaveLength(31);
    expect(days[0]).toMatchObject({
      date: '2026-10-01',
      day: 1,
      label: '1 Oct',
      expenseMinor: 22000000n,
      cumulativeMinor: 22000000n,
    });
    expect(days[9]!.cumulativeMinor).toBe(22000000n + 1850000n);
    expect(days.at(-1)!.cumulativeMinor).toBe(summary.expense);
  });
});

describe('number helpers', () => {
  it('plots minor units as dram', () => {
    expect(plotValue(150050n)).toBe(1500.5);
  });

  it.each([
    [0, '0'],
    [950, '950'],
    [1500, '1.5K'],
    [400000, '400K'],
    [1200000, '1.2M'],
    [2000000000, '2B'],
    [-1500, '-1.5K'],
  ])('writes %d as %s on an axis', (value, text) => {
    expect(compactDram(value)).toBe(text);
  });
});
