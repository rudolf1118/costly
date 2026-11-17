import { type Account, ACCOUNT_TYPE_LABELS, formatAmd } from '@costly/shared';
import { getRouteApi } from '@tanstack/react-router';
import { formatCalendarDate } from '../../lib/dates';
import { Alert } from '../../ui/Alert';
import { Button } from '../../ui/Button';
import { EmptyState } from '../../ui/EmptyState';
import { PageHeader } from '../../ui/PageHeader';
import { SegmentedControl } from '../../ui/SegmentedControl';
import { Skeleton } from '../../ui/Skeleton';
import { useAccounts } from './queries';

const route = getRouteApi('/app/accounts');

export type AccountsView = 'active' | 'archived';

const VIEWS = [
  { value: 'active', label: 'Active' },
  { value: 'archived', label: 'Archived' },
] as const;

/**
 * The user's accounts. Each shows the opening balance it was created with,
 * labelled as such: there is no current balance or total until the ledger
 * can derive one (ADR-0010).
 */
export function AccountsPage() {
  const view: AccountsView = route.useSearch().view ?? 'active';
  const navigate = route.useNavigate();
  const accounts = useAccounts(view);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Accounts" />

      <SegmentedControl
        label="Show accounts"
        options={VIEWS}
        value={view}
        onValueChange={(next) =>
          void navigate({ search: next === 'archived' ? { view: next } : {}, replace: true })
        }
      />

      <section aria-label={view === 'active' ? 'Active accounts' : 'Archived accounts'}>
        {accounts.isPending ? (
          <AccountListSkeleton />
        ) : accounts.isError ? (
          <Alert>
            <p>Your accounts couldn’t be loaded.</p>
            <Button
              variant="secondary"
              size="sm"
              className="mt-2"
              loading={accounts.isFetching}
              onClick={() => void accounts.refetch()}
            >
              Try again
            </Button>
          </Alert>
        ) : accounts.data.length === 0 ? (
          view === 'active' ? (
            <EmptyState title="No accounts yet">
              Add the places your money is kept, such as a bank card, cash or savings, with the
              balance each had on a day you choose.
            </EmptyState>
          ) : (
            <EmptyState title="No archived accounts">
              Accounts you archive are kept here with their history.
            </EmptyState>
          )
        ) : (
          <AccountList accounts={accounts.data} />
        )}
      </section>
    </div>
  );
}

function AccountList({ accounts }: { accounts: Account[] }) {
  return (
    <ul className="divide-y divide-border rounded-md border border-border bg-surface">
      {accounts.map((account) => (
        <li key={account.id}>
          <AccountRow account={account} />
        </li>
      ))}
    </ul>
  );
}

function AccountRow({ account }: { account: Account }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-3.5 sm:px-5">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="truncate text-body font-medium">{account.name}</span>
        <span className="text-body-small text-text-secondary">
          {ACCOUNT_TYPE_LABELS[account.type]}
          {account.isLiquid ? ' · Spendable' : ''}
        </span>
      </div>
      <OpeningBalance account={account} />
    </div>
  );
}

/** The amount and the day it applies to, always named as the opening balance. */
export function OpeningBalance({ account }: { account: Account }) {
  return (
    <div className="flex flex-col sm:items-end">
      <span className="text-label text-text-secondary">
        Opening balance, {formatCalendarDate(account.openingDate)}
      </span>
      <span className="font-mono text-body font-medium tabular-nums">
        {formatAmd(account.openingBalance)}
      </span>
    </div>
  );
}

function AccountListSkeleton() {
  return (
    <div
      aria-busy="true"
      className="divide-y divide-border rounded-md border border-border bg-surface"
    >
      <span className="sr-only">Loading accounts</span>
      {[0, 1, 2].map((row) => (
        <div key={row} className="flex items-center justify-between gap-6 px-4 py-4 sm:px-5">
          <div className="flex flex-col gap-2">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-24" />
          </div>
          <Skeleton className="h-4 w-28" />
        </div>
      ))}
    </div>
  );
}
