import { type Account, ACCOUNT_TYPE_LABELS } from '@costly/shared';
import { getRouteApi, Link } from '@tanstack/react-router';
import { Pencil, Plus } from 'lucide-react';
import { useState } from 'react';
import { Alert } from '../../ui/Alert';
import { Button } from '../../ui/Button';
import { EmptyState } from '../../ui/EmptyState';
import { PageHeader } from '../../ui/PageHeader';
import { SegmentedControl } from '../../ui/SegmentedControl';
import { Skeleton } from '../../ui/Skeleton';
import { AccountFormDialog } from './AccountFormDialog';
import { CurrentBalance } from './CurrentBalance';
import { useAccounts } from './queries';

const route = getRouteApi('/app/accounts');

export type AccountsView = 'active' | 'archived';

const VIEWS = [
  { value: 'active', label: 'Active' },
  { value: 'archived', label: 'Archived' },
] as const;

/**
 * The user's accounts, each with its current balance as the API derives it
 * from the account's transactions. There is no total yet: net worth and
 * liquid money are analytics, a later chapter.
 */
export function AccountsPage() {
  const view: AccountsView = route.useSearch().view ?? 'active';
  const navigate = route.useNavigate();
  const accounts = useAccounts(view);
  const [formOpen, setFormOpen] = useState(false);
  // The account being edited, or none while adding one. Kept after closing,
  // so the drawer's content doesn't change while it animates out.
  const [editing, setEditing] = useState<Account | undefined>();
  const openForm = (account?: Account) => {
    setEditing(account);
    setFormOpen(true);
  };

  const addAccount = (
    <Button onClick={() => openForm()}>
      <Plus aria-hidden="true" className="size-4" />
      New account
    </Button>
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Accounts" actions={addAccount} />

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
            <EmptyState title="No accounts yet" action={addAccount}>
              Add the places your money is kept, such as a bank card, cash or savings, with the
              balance each had on a day you choose.
            </EmptyState>
          ) : (
            <EmptyState title="No archived accounts">
              Accounts you archive are kept here with their history.
            </EmptyState>
          )
        ) : (
          <AccountList accounts={accounts.data} onEdit={view === 'active' ? openForm : undefined} />
        )}
      </section>

      <AccountFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        account={editing}
        onSaved={() => {
          // A new account is active: show it there.
          if (!editing && view !== 'active') void navigate({ search: {}, replace: true });
        }}
      />
    </div>
  );
}

interface AccountListProps {
  accounts: Account[];
  /** Offered for active accounts only: archived ones are read-only. */
  onEdit?: ((account: Account) => void) | undefined;
}

function AccountList({ accounts, onEdit }: AccountListProps) {
  return (
    <ul className="divide-y divide-border rounded-md border border-border bg-surface">
      {accounts.map((account) => (
        <li key={account.id}>
          <AccountRow account={account} onEdit={onEdit} />
        </li>
      ))}
    </ul>
  );
}

function AccountRow({ account, onEdit }: { account: Account; onEdit: AccountListProps['onEdit'] }) {
  return (
    <div className="flex items-center gap-2 px-4 py-3.5 sm:px-5">
      <div className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-x-6 gap-y-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <Link
            to="/accounts/$accountId"
            params={{ accountId: account.id }}
            className="truncate rounded-xs text-body font-medium hover:text-accent-text hover:underline"
          >
            {account.name}
          </Link>
          <span className="text-body-small text-text-secondary">
            {ACCOUNT_TYPE_LABELS[account.type]}
            {account.isLiquid ? ' · Spendable' : ''}
          </span>
        </div>
        <CurrentBalance account={account} className="sm:items-end" />
      </div>
      {onEdit && (
        <Button
          variant="ghost"
          size="sm"
          aria-label={`Edit ${account.name}`}
          className="shrink-0 px-2"
          onClick={() => onEdit(account)}
        >
          <Pencil aria-hidden="true" className="size-4" />
        </Button>
      )}
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
