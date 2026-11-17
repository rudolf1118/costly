import { EmptyState } from '../ui/EmptyState';
import { PageHeader } from '../ui/PageHeader';

/**
 * The overview has nothing to show until the ledger exists: no balances,
 * totals or trends are invented in the meantime.
 */
export function OverviewPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Overview" />
      <EmptyState title="Nothing to show yet">
        Your balances, income and spending will appear here once you have accounts and transactions.
      </EmptyState>
    </div>
  );
}
