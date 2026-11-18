import { type DashboardSummary, formatAmd, percentChange } from '@costly/shared';
import {
  ArrowDownRight,
  ArrowUpRight,
  Landmark,
  type LucideIcon,
  Minus,
  TrendingDown,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '../../ui/cn';
import { dayAndMonth, monthDays, shiftMonth, shortMonth } from './month';

type Tone = 'positive' | 'negative' | 'neutral';

const TONE_TEXT: Record<Tone, string> = {
  positive: 'text-positive-ink bg-positive-soft',
  negative: 'text-negative-ink bg-negative-soft',
  neutral: 'text-text-secondary bg-subtle',
};

/**
 * The four headline numbers for the month. Each comparison appears only
 * when it means something: a percentage needs a non-zero base, and a
 * balance needs an account that existed a month earlier.
 */
export function SummaryCards({
  summary,
  isCurrentMonth,
}: {
  summary: DashboardSummary;
  isCurrentMonth: boolean;
}) {
  const previous = shortMonth(shiftMonth(summary.month, -1));
  const monthEnd = monthDays(summary.month).to;

  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
      <StatCard
        className="col-span-2 sm:col-span-1"
        icon={Landmark}
        label={isCurrentMonth ? 'Total balance' : `Balance on ${dayAndMonth(monthEnd)}`}
        value={formatAmd(summary.balance.total)}
        emphasis
        note={
          summary.balance.accountCount === 1
            ? '1 active account'
            : `${summary.balance.accountCount} active accounts`
        }
        comparison={balanceComparison(summary, previous)}
      />
      <StatCard
        icon={TrendingUp}
        label={isCurrentMonth ? 'Income this month' : 'Income'}
        value={formatAmd(summary.income)}
        comparison={changeComparison(summary.income, summary.previous.income, previous, 'up')}
      />
      <StatCard
        icon={TrendingDown}
        label={isCurrentMonth ? 'Expenses this month' : 'Expenses'}
        value={formatAmd(summary.expense)}
        comparison={changeComparison(summary.expense, summary.previous.expense, previous, 'down')}
      />
      <StatCard
        className="col-span-2 sm:col-span-1"
        icon={Wallet}
        label="Net cash flow"
        value={formatAmd(summary.net, { sign: 'always' })}
        valueTone={summary.net > 0n ? 'positive' : summary.net < 0n ? 'negative' : 'neutral'}
        note="Income minus expenses"
        comparison={
          summary.income === 0n && summary.expense === 0n
            ? undefined
            : {
                tone: summary.net > 0n ? 'positive' : summary.net < 0n ? 'negative' : 'neutral',
                icon: summary.net > 0n ? ArrowUpRight : summary.net < 0n ? ArrowDownRight : Minus,
                text: summary.net > 0n ? 'Positive' : summary.net < 0n ? 'Negative' : 'Even',
              }
        }
      />
    </div>
  );
}

interface Comparison {
  tone: Tone;
  icon: LucideIcon;
  text: string;
}

function balanceComparison(summary: DashboardSummary, previous: string): Comparison | undefined {
  const before = summary.balance.previousMonthEnd;
  if (before === null) return undefined;
  const change = summary.balance.total - before;
  if (change === 0n)
    return { tone: 'neutral', icon: Minus, text: `No change since end of ${previous}` };
  return {
    tone: change > 0n ? 'positive' : 'negative',
    icon: change > 0n ? ArrowUpRight : ArrowDownRight,
    text: `${formatAmd(change, { sign: 'always' })} since end of ${previous}`,
  };
}

/**
 * "▲ 12% vs Oct". `good` says which direction is good news: more income,
 * less spending. With nothing last month there is no percentage to show.
 */
function changeComparison(
  current: bigint,
  before: bigint,
  previous: string,
  good: 'up' | 'down',
): Comparison {
  const change = percentChange(current, before);
  if (change === null) {
    return { tone: 'neutral', icon: Minus, text: `Nothing in ${previous} to compare` };
  }
  if (change === 0n) return { tone: 'neutral', icon: Minus, text: `Same as ${previous}` };
  const up = change > 0n;
  return {
    tone: up === (good === 'up') ? 'positive' : 'negative',
    icon: up ? ArrowUpRight : ArrowDownRight,
    text: `${up ? '+' : '−'}${up ? change : -change}% vs ${previous}`,
  };
}

function StatCard({
  className,
  icon: Icon,
  label,
  value,
  valueTone = 'neutral',
  emphasis = false,
  note,
  comparison,
}: {
  className?: string;
  icon: LucideIcon;
  label: string;
  value: string;
  valueTone?: Tone;
  emphasis?: boolean;
  note?: ReactNode;
  comparison?: Comparison | undefined;
}) {
  const ComparisonIcon = comparison?.icon;
  return (
    <div
      className={cn(
        'relative flex min-w-0 flex-col gap-2 overflow-hidden rounded-md border border-border bg-surface p-4 sm:gap-3 sm:p-5',
        className,
        emphasis &&
          'border-accent-soft-strong bg-[linear-gradient(135deg,var(--costly-color-accent-soft),var(--costly-color-surface)_70%)]',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-label text-text-secondary">{label}</h3>
        <span
          aria-hidden="true"
          className={cn(
            'flex size-7 shrink-0 items-center justify-center rounded-sm sm:size-8',
            emphasis ? 'bg-accent text-on-accent' : 'bg-subtle text-text-secondary',
          )}
        >
          <Icon className="size-4" />
        </span>
      </div>
      <p
        className={cn(
          'truncate font-mono text-[1.25rem] leading-7 font-medium tracking-tight tabular-nums sm:text-[1.5rem] sm:leading-8',
          valueTone === 'positive' && 'text-positive',
          valueTone === 'negative' && 'text-negative',
        )}
      >
        {value}
      </p>
      <div className="flex min-h-6 flex-wrap items-center gap-x-2 gap-y-1">
        {comparison && ComparisonIcon && (
          <span
            className={cn(
              'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-label',
              TONE_TEXT[comparison.tone],
            )}
          >
            <ComparisonIcon aria-hidden="true" className="size-3.5" />
            {comparison.text}
          </span>
        )}
        {note && <span className="text-label text-text-secondary">{note}</span>}
      </div>
    </div>
  );
}
