import { dashboardSummarySchema, formatAmd } from '@costly/shared';
import { describe, expect, it } from 'vitest';
import { monthlyInsights } from './insights';
import { emptySummary, wireSummary } from './test-dashboard';

const summary = (overrides: Record<string, unknown> = {}) =>
  dashboardSummarySchema.parse(wireSummary('2026-10', overrides));

const texts = (overrides: Record<string, unknown> = {}, current = false) =>
  Object.fromEntries(monthlyInsights(summary(overrides), current).map((i) => [i.id, i.text]));

describe('monthlyInsights', () => {
  it('compares spending with the previous month in whole percent', () => {
    // 245,000 after 200,000: up 22.5 %, rounded half away from zero.
    expect(texts()['spending-change']).toBe('Your spending is 23% higher than in September.');
    expect(
      texts({ expense: '15000000', previous: { income: '0', expense: '20000000', net: '0' } })[
        'spending-change'
      ],
    ).toBe('Your spending is 25% lower than in September.');
  });

  it('says "so far" for the month that isn’t over', () => {
    expect(texts({}, true)['spending-change']).toBe(
      'Your spending so far is 23% higher than in September.',
    );
  });

  it('shows no percentage when there was no spending the month before', () => {
    const text = texts({ previous: { income: '0', expense: '0', net: '0' } })['spending-change'];
    expect(text).toBe(
      'You had no spending in September, so there is nothing to compare this month with.',
    );
    expect(text).not.toMatch(/%/);
  });

  it('names the largest category and its share of the month’s spending', () => {
    // 220,000 of 245,000 is 89.8 %.
    expect(texts()['largest-category']).toBe(
      `Rent is your largest spending category: ${formatAmd(22000000n)}, 90% of this month’s spending.`,
    );
  });

  it('describes a positive and a negative net cash flow', () => {
    expect(texts()['net-flow']).toBe(
      `Your net cash flow is positive: you kept ${formatAmd(40500000n)}, 62% of your income.`,
    );
    expect(texts({ income: '1000000', expense: '1500000', net: '-500000' })['net-flow']).toBe(
      `Your net cash flow is negative: you spent ${formatAmd(500000n)} more than you received.`,
    );
  });

  it('has no share of income when there was no income', () => {
    expect(texts({ income: '1000000', expense: '1000000', net: '0' })['net-flow']).toBe(
      'Your income and spending are exactly equal.',
    );
    expect(texts({ income: '0', expense: '0', net: '0' })['net-flow']).toBeUndefined();
    expect(texts({ income: '0', expense: '1500000', net: '-1500000' })['net-flow']).toMatch(
      /negative/,
    );
  });

  it('names the highest-spending day', () => {
    expect(texts()['busiest-day']).toBe(
      `Your highest-spending day was 1 Oct, with ${formatAmd(22000000n)}.`,
    );
  });

  it('compares income only for a finished month', () => {
    expect(texts()['income-change']).toBe('Your income was 8% higher than in September.');
    expect(texts({}, true)['income-change']).toBeUndefined();
  });

  it('says nothing about an empty month', () => {
    expect(monthlyInsights(dashboardSummarySchema.parse(emptySummary('2026-10')), false)).toEqual(
      [],
    );
  });
});
