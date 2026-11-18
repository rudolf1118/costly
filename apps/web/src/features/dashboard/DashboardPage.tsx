import { getRouteApi, Link } from '@tanstack/react-router';
import { Plus } from 'lucide-react';
import { useSessionState } from '../../auth/SessionContext';
import { Alert } from '../../ui/Alert';
import { Button } from '../../ui/Button';
import { cn } from '../../ui/cn';
import { EmptyState } from '../../ui/EmptyState';
import { PageHeader } from '../../ui/PageHeader';
import { Skeleton } from '../../ui/Skeleton';
import { monthlyInsights } from './insights';
import { currentMonth } from './month';
import { MonthPicker } from './MonthPicker';
import { AccountsOverview, InsightsPanel, RecentTransactions } from './Panels';
import { useDashboardSummary } from './queries';
import { SummaryCards } from './SummaryCards';

const route = getRouteApi('/app/');

/**
 * The overview: one month of the user's money, every number computed by the
 * API from the ledger (docs/02-requirements/dashboard-v1.md). The month
 * lives in the address, so a past month can be bookmarked and Back works;
 * without one it is the current month in the user's time zone.
 */
export function DashboardPage() {
  const session = useSessionState();
  const timeZone = session.status === 'authenticated' ? session.user.timezone : 'UTC';
  const latest = currentMonth(timeZone);
  const requested = route.useSearch().month;
  const month = requested && requested < latest ? requested : latest;
  const navigate = route.useNavigate();
  const summary = useDashboardSummary(month);

  const changeMonth = (next: string) =>
    void navigate({ search: next >= latest ? {} : { month: next }, replace: true });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Overview"
        actions={<MonthPicker month={month} latest={latest} onChange={changeMonth} />}
      />

      {summary.isPending ? (
        <DashboardSkeleton />
      ) : summary.isError && !summary.data ? (
        <Alert>
          <p>Your overview couldn’t be loaded.</p>
          <Button
            variant="secondary"
            size="sm"
            className="mt-2"
            loading={summary.isFetching}
            onClick={() => void summary.refetch()}
          >
            Try again
          </Button>
        </Alert>
      ) : summary.data.accounts.length === 0 && summary.data.transactionCount === 0 ? (
        <EmptyState
          title="Start with an account"
          action={
            <Button asChild>
              <Link to="/accounts">
                <Plus aria-hidden="true" className="size-4" />
                Create account
              </Link>
            </Button>
          }
        >
          Add the places your money is kept, such as a bank card, cash or savings. Your balances,
          income and spending will appear here as you record transactions.
        </EmptyState>
      ) : (
        <div
          aria-busy={summary.isPlaceholderData}
          className={cn(
            'flex flex-col gap-4 transition-opacity duration-160 ease-control sm:gap-6',
            summary.isPlaceholderData && 'opacity-60',
          )}
        >
          <h2 className="sr-only">Summary</h2>
          <SummaryCards summary={summary.data} isCurrentMonth={summary.data.month === latest} />
          <div className="grid gap-4 sm:gap-6 lg:grid-cols-3">
            <RecentTransactions
              month={summary.data.month}
              transactions={summary.data.recentTransactions}
              total={summary.data.transactionCount}
              className="lg:col-span-2"
            />
            <InsightsPanel
              month={summary.data.month}
              insights={monthlyInsights(summary.data, summary.data.month === latest)}
            />
          </div>
          {summary.data.accounts.length > 0 && (
            <AccountsOverview accounts={summary.data.accounts} />
          )}
        </div>
      )}
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div aria-busy="true" className="flex flex-col gap-4 sm:gap-6">
      <span className="sr-only">Loading your overview</span>
      <div className="grid grid-cols-1 gap-3 min-[30rem]:grid-cols-2 sm:gap-4 lg:grid-cols-4">
        {[0, 1, 2, 3].map((card) => (
          <div
            key={card}
            className="flex flex-col gap-4 rounded-md border border-border bg-surface p-5"
          >
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-7 w-36" />
            <Skeleton className="h-4 w-28" />
          </div>
        ))}
      </div>
      <div className="grid gap-4 sm:gap-6 lg:grid-cols-3">
        <Skeleton className="h-80 rounded-md lg:col-span-2" />
        <Skeleton className="h-80 rounded-md" />
      </div>
    </div>
  );
}
