import { type DashboardSummary, percentOf } from '@costly/shared';
import { dayAndMonth, shortMonth } from './month';

/**
 * The summary reshaped for the charts. Recharts positions marks with
 * numbers, so each datum carries a `number` for geometry next to the exact
 * `bigint` it came from; every label, tooltip and total is formatted from
 * the `bigint`. A pixel can be off for sums beyond 2^53 minor units; a
 * printed amount never is.
 */

/** Minor units as a plain number of dram, for chart geometry only. */
export function plotValue(minor: bigint): number {
  return Number(minor) / 100;
}

export interface HistoryDatum {
  month: string;
  label: string;
  income: number;
  expense: number;
  incomeMinor: bigint;
  expenseMinor: bigint;
}

export type HistoryRange = 6 | 12;

/** The last `range` months of the history, oldest first, ending at the selected month. */
export function historyData(
  history: DashboardSummary['history'],
  range: HistoryRange,
): HistoryDatum[] {
  const months = history.slice(-range);
  // Show the year on January, and on the first bar, so the axis says which year it is.
  return months.map((entry, index) => ({
    month: entry.month,
    label: shortMonth(entry.month, index === 0 || entry.month.endsWith('-01')),
    income: plotValue(entry.income),
    expense: plotValue(entry.expense),
    incomeMinor: entry.income,
    expenseMinor: entry.expense,
  }));
}

export function hasHistory(history: readonly HistoryDatum[]): boolean {
  return history.some((entry) => entry.incomeMinor > 0n || entry.expenseMinor > 0n);
}

/** Categorical slots the donut uses, in this fixed order (validated palette, styles.css). */
export const CATEGORY_SLOTS = 6;

export interface CategorySlice {
  /** null for the "Other" slice that folds the rest together. */
  categoryId: string | null;
  name: string;
  /** "Food › Groceries" for a subcategory. */
  label: string;
  amount: bigint;
  value: number;
  /** Whole percent of the month's expense, or null when there was none. */
  percent: bigint | null;
  transactionCount: number;
  /** CSS colour: a categorical slot, or the neutral for "Other". */
  color: string;
}

const slotColor = (index: number) => `var(--chart-category-${index + 1})`;
export const OTHER_COLOR = 'var(--chart-category-other)';

/**
 * The month's categories as donut slices: the largest CATEGORY_SLOTS − 1
 * get their own colour, the rest fold into "Other", so no colour is ever
 * generated or reused. With exactly CATEGORY_SLOTS categories, all get a slot.
 * The slices add up to the month's expense exactly.
 */
export function categorySlices(
  categories: DashboardSummary['categories'],
  expense: bigint,
): CategorySlice[] {
  const toSlice = (
    category: DashboardSummary['categories'][number],
    index: number,
  ): CategorySlice => ({
    categoryId: category.categoryId,
    name: category.name,
    label: category.parentName ? `${category.parentName} › ${category.name}` : category.name,
    amount: category.amount,
    value: plotValue(category.amount),
    percent: percentOf(category.amount, expense),
    transactionCount: category.transactionCount,
    color: slotColor(index),
  });

  if (categories.length <= CATEGORY_SLOTS) return categories.map(toSlice);

  const named = categories.slice(0, CATEGORY_SLOTS - 1).map(toSlice);
  const rest = categories.slice(CATEGORY_SLOTS - 1);
  const amount = rest.reduce((sum, category) => sum + category.amount, 0n);
  return [
    ...named,
    {
      categoryId: null,
      name: `${rest.length} other categories`,
      label: `${rest.length} other categories`,
      amount,
      value: plotValue(amount),
      percent: percentOf(amount, expense),
      transactionCount: rest.reduce((sum, category) => sum + category.transactionCount, 0),
      color: OTHER_COLOR,
    },
  ];
}

export interface DailyDatum {
  date: string;
  /** Day of the month, the axis label. */
  day: number;
  label: string;
  expense: number;
  expenseMinor: bigint;
  /** Spending from the 1st up to and including this day. */
  cumulative: number;
  cumulativeMinor: bigint;
}

/** One datum per day of the month, with the running total of spending. */
export function dailyData(daily: DashboardSummary['daily']): DailyDatum[] {
  let running = 0n;
  return daily.map((entry) => {
    running += entry.expense;
    return {
      date: entry.date,
      day: Number(entry.date.slice(8, 10)),
      label: dayAndMonth(entry.date),
      expense: plotValue(entry.expense),
      expenseMinor: entry.expense,
      cumulative: plotValue(running),
      cumulativeMinor: running,
    };
  });
}

/** Compact axis ticks in dram: 1,500 → "1.5K", 2,000,000 → "2M". */
export function compactDram(value: number): string {
  const units: [number, string][] = [
    [1e9, 'B'],
    [1e6, 'M'],
    [1e3, 'K'],
  ];
  const magnitude = Math.abs(value);
  for (const [size, suffix] of units) {
    if (magnitude >= size) {
      const scaled = value / size;
      const text = Number.isInteger(scaled)
        ? String(scaled)
        : scaled.toFixed(1).replace(/\.0$/, '');
      return `${text}${suffix}`;
    }
  }
  return String(Math.round(value));
}
