import { ACCOUNT_TYPE_LABELS, type DashboardSummary, formatAmd } from '@costly/shared';
import { Link } from '@tanstack/react-router';
import { ArrowRight, CircleMinus, CirclePlus, Info, TrendingDown, TrendingUp } from 'lucide-react';
import { formatCalendarDate } from '../../lib/dates';
import { cn } from '../../ui/cn';
import { DashboardCard, PanelEmpty } from './DashboardCard';
import type { Insight } from './insights';
import { formatMonth, monthDays } from './month';

const linkClass =
  'inline-flex items-center gap-1 rounded-xs text-body-small font-medium text-accent-text hover:underline';

/** The active accounts with their current balances, each linking to its page. */
export function AccountsOverview({
  accounts,
  className,
}: {
  accounts: DashboardSummary['accounts'];
  className?: string;
}) {
  return (
    <DashboardCard
      className={className}
      title="Accounts"
      description="Current balances"
      action={
        <Link to="/accounts" className={linkClass}>
          Manage
          <ArrowRight aria-hidden="true" className="size-3.5" />
        </Link>
      }
    >
      <ul className="-mx-2 flex flex-col">
        {accounts.map((account) => (
          <li key={account.id}>
            <Link
              to="/accounts/$accountId"
              params={{ accountId: account.id }}
              className="flex items-center justify-between gap-4 rounded-sm px-2 py-2.5 hover:bg-subtle"
            >
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-body font-medium">{account.name}</span>
                <span className="text-body-small text-text-secondary">
                  {ACCOUNT_TYPE_LABELS[account.type]} · {account.currency}
                </span>
              </span>
              <span
                className={cn(
                  'shrink-0 font-mono text-body font-medium tabular-nums',
                  account.balance < 0n && 'text-negative',
                )}
              >
                {formatAmd(account.balance)}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </DashboardCard>
  );
}

/** The month's latest transactions, with a link to all of them. */
export function RecentTransactions({
  month,
  transactions,
  total,
  className,
}: {
  month: string;
  transactions: DashboardSummary['recentTransactions'];
  total: number;
  className?: string;
}) {
  const days = monthDays(month);
  return (
    <DashboardCard
      className={className}
      title="Recent transactions"
      description={`Latest in ${formatMonth(month)}`}
      action={
        <Link to="/transactions" search={days} className={linkClass}>
          View all{total > 0 ? ` ${total}` : ''}
          <ArrowRight aria-hidden="true" className="size-3.5" />
        </Link>
      }
    >
      {transactions.length === 0 ? (
        <PanelEmpty>No transactions in {formatMonth(month)}.</PanelEmpty>
      ) : (
        <ul className="-mx-2 flex flex-col divide-y divide-border">
          {transactions.map((transaction) => {
            const income = transaction.type === 'income';
            const Icon = income ? CirclePlus : CircleMinus;
            return (
              <li key={transaction.id} className="flex items-center gap-3 px-2 py-2.5">
                <span
                  aria-hidden="true"
                  className={cn(
                    'flex size-8 shrink-0 items-center justify-center rounded-full',
                    income ? 'bg-positive-soft text-positive' : 'bg-subtle text-text-secondary',
                  )}
                >
                  <Icon className="size-4" />
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-body font-medium">
                    {transaction.category.parentName
                      ? `${transaction.category.parentName} › ${transaction.category.name}`
                      : transaction.category.name}
                  </span>
                  <span className="truncate text-body-small text-text-secondary">
                    {[
                      formatCalendarDate(transaction.occurredOn),
                      transaction.account.name,
                      transaction.description,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </span>
                <span
                  className={cn(
                    'shrink-0 font-mono text-body font-medium tabular-nums',
                    income ? 'text-positive' : 'text-text',
                  )}
                >
                  <span className="sr-only">{income ? 'Income' : 'Expense'} </span>
                  {formatAmd(income ? transaction.amount : -transaction.amount, {
                    sign: 'always',
                  })}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </DashboardCard>
  );
}

const INSIGHT_ICONS = { positive: TrendingUp, negative: TrendingDown, neutral: Info } as const;
const INSIGHT_TONES = {
  positive: 'bg-positive-soft text-positive',
  negative: 'bg-negative-soft text-negative',
  neutral: 'bg-accent-soft text-accent-text',
} as const;

/** Fixed sentences filled with the month's numbers; nothing predicted or advised. */
export function InsightsPanel({
  insights,
  month,
  className,
}: {
  insights: Insight[];
  month: string;
  className?: string;
}) {
  return (
    <DashboardCard className={className} title="Monthly insights" description={formatMonth(month)}>
      {insights.length === 0 ? (
        <PanelEmpty>Insights appear once the month has income or spending.</PanelEmpty>
      ) : (
        <ul className="flex flex-col gap-3">
          {insights.map((insight) => {
            const Icon = INSIGHT_ICONS[insight.tone];
            return (
              <li key={insight.id} className="flex gap-3">
                <span
                  aria-hidden="true"
                  className={cn(
                    'mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full',
                    INSIGHT_TONES[insight.tone],
                  )}
                >
                  <Icon className="size-3.5" />
                </span>
                <p className="text-body-small text-text-body">{insight.text}</p>
              </li>
            );
          })}
        </ul>
      )}
    </DashboardCard>
  );
}
