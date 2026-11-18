import { type DashboardSummary, formatAmd, percentChange, percentOf } from '@costly/shared';
import { dayAndMonth, monthName, shiftMonth } from './month';

export type InsightTone = 'positive' | 'negative' | 'neutral';

export interface Insight {
  id: 'spending-change' | 'largest-category' | 'net-flow' | 'busiest-day' | 'income-change';
  tone: InsightTone;
  text: string;
}

const abs = (value: bigint) => (value < 0n ? -value : value);

/**
 * Statements about the month, each a fixed sentence filled with numbers from
 * the summary (docs/02-requirements/dashboard-v1.md). Nothing is predicted
 * or recommended, and a percentage appears only when its base isn't zero.
 *
 * `isCurrentMonth` changes the wording, not the numbers: a month that isn't
 * over is compared "so far" with the whole of the previous one.
 */
export function monthlyInsights(summary: DashboardSummary, isCurrentMonth: boolean): Insight[] {
  const insights: Insight[] = [];
  const previousName = monthName(shiftMonth(summary.month, -1));
  const soFar = isCurrentMonth ? ' so far' : '';

  // Spending compared with the previous month.
  const spendingChange = percentChange(summary.expense, summary.previous.expense);
  if (spendingChange !== null && summary.expense > 0n) {
    insights.push({
      id: 'spending-change',
      tone: spendingChange > 0n ? 'negative' : spendingChange < 0n ? 'positive' : 'neutral',
      text:
        spendingChange === 0n
          ? `Your spending${soFar} is about the same as in ${previousName}.`
          : `Your spending${soFar} is ${abs(spendingChange)}% ${spendingChange > 0n ? 'higher' : 'lower'} than in ${previousName}.`,
    });
  } else if (summary.expense > 0n && summary.previous.expense === 0n) {
    insights.push({
      id: 'spending-change',
      tone: 'neutral',
      text: `You had no spending in ${previousName}, so there is nothing to compare this month with.`,
    });
  }

  // The largest category and its share.
  const largest = summary.categories[0];
  const share = largest ? percentOf(largest.amount, summary.expense) : null;
  if (largest && share !== null) {
    insights.push({
      id: 'largest-category',
      tone: 'neutral',
      text: `${largest.name} is your largest spending category: ${formatAmd(largest.amount)}, ${share}% of this month’s spending.`,
    });
  }

  // Net cash flow and how much of the income it is.
  if (summary.income > 0n || summary.expense > 0n) {
    const kept = percentOf(summary.net, summary.income);
    if (summary.net > 0n) {
      insights.push({
        id: 'net-flow',
        tone: 'positive',
        text:
          kept !== null
            ? `Your net cash flow${soFar} is positive: you kept ${formatAmd(summary.net)}, ${kept}% of your income.`
            : `Your net cash flow${soFar} is positive: ${formatAmd(summary.net)}.`,
      });
    } else if (summary.net < 0n) {
      insights.push({
        id: 'net-flow',
        tone: 'negative',
        text: `Your net cash flow${soFar} is negative: you spent ${formatAmd(-summary.net)} more than you received.`,
      });
    } else {
      insights.push({
        id: 'net-flow',
        tone: 'neutral',
        text: `Your income and spending${soFar} are exactly equal.`,
      });
    }
  }

  // The day with the most spending, when there is one clear day.
  const busiest = summary.daily.reduce<DashboardSummary['daily'][number] | undefined>(
    (best, day) => (day.expense > (best?.expense ?? 0n) ? day : best),
    undefined,
  );
  if (busiest && summary.daily.filter((day) => day.expense > 0n).length > 1) {
    insights.push({
      id: 'busiest-day',
      tone: 'neutral',
      text: `Your highest-spending day was ${dayAndMonth(busiest.date)}, with ${formatAmd(busiest.expense)}.`,
    });
  }

  // Income compared with the previous month, only for a finished month: a
  // salary that hasn't arrived yet isn't a drop in income.
  const incomeChange = percentChange(summary.income, summary.previous.income);
  if (!isCurrentMonth && incomeChange !== null && incomeChange !== 0n && summary.income > 0n) {
    insights.push({
      id: 'income-change',
      tone: incomeChange > 0n ? 'positive' : 'negative',
      text: `Your income was ${abs(incomeChange)}% ${incomeChange > 0n ? 'higher' : 'lower'} than in ${previousName}.`,
    });
  }

  return insights;
}
