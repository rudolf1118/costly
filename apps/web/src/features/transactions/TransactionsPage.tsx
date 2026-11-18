import {
  type Account,
  type Category,
  formatAmd,
  signedAmount,
  type Transaction,
  type TransactionFilters,
  type TransactionType,
} from '@costly/shared';
import { getRouteApi, Link } from '@tanstack/react-router';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { toFormError } from '../../auth/errors';
import { formatCalendarDate } from '../../lib/dates';
import { Alert } from '../../ui/Alert';
import { Button } from '../../ui/Button';
import { cn } from '../../ui/cn';
import { Dialog, DialogClose, DialogContent } from '../../ui/Dialog';
import { EmptyState } from '../../ui/EmptyState';
import { PageHeader } from '../../ui/PageHeader';
import { SegmentedControl } from '../../ui/SegmentedControl';
import { SelectField } from '../../ui/SelectField';
import { Skeleton } from '../../ui/Skeleton';
import { TextField } from '../../ui/TextField';
import { useToast } from '../../ui/Toast';
import { useAccounts } from '../accounts/queries';
import { categoryLabel, useCategories } from '../categories/queries';
import { useDeleteTransaction } from './mutations';
import { useTransactions } from './queries';
import { hasFilters } from './search';
import { TransactionFormDialog } from './TransactionFormDialog';

const route = getRouteApi('/app/transactions');

type TypeView = 'all' | TransactionType;

const TYPE_VIEWS = [
  { value: 'all', label: 'All' },
  { value: 'expense', label: 'Expenses' },
  { value: 'income', label: 'Income' },
] as const;

/** Names for the ids a transaction carries, from the account and category lists. */
export interface Lookups {
  accounts: ReadonlyMap<string, Account>;
  categories: ReadonlyMap<string, Category>;
}

/** What a row offers. Transactions of an archived account are read-only, so they get none. */
interface RowActions {
  onEdit(transaction: Transaction): void;
  onDelete(transaction: Transaction): void;
}

/** "Food › Groceries, −18,500 ֏, 12 Nov 2026": how a transaction is named in labels. */
function transactionName(transaction: Transaction, lookups: Lookups): string {
  const category = lookups.categories.get(transaction.categoryId);
  return [
    category ? categoryLabel(category, lookups.categories) : 'Transaction',
    formatAmd(signedAmount(transaction), { sign: 'always' }),
    formatCalendarDate(transaction.occurredOn),
  ].join(', ');
}

/**
 * The user's transactions, newest first, grouped by day, with filters kept
 * in the address. Pages load on request ("Show more"); each asks the API for
 * the rows after the last one shown, so nothing repeats or goes missing.
 */
export function TransactionsPage() {
  const filters = route.useSearch();
  const navigate = route.useNavigate();
  const accounts = useAccounts('all');
  const categories = useCategories();

  const lookups = useMemo<Lookups>(
    () => ({
      accounts: new Map((accounts.data ?? []).map((account) => [account.id, account])),
      categories: new Map((categories.data ?? []).map((category) => [category.id, category])),
    }),
    [accounts.data, categories.data],
  );

  const setFilters = (change: Partial<TransactionFilters>) =>
    void navigate({
      search: (previous) => {
        const next: Record<string, string | undefined> = { ...previous, ...change };
        for (const key of Object.keys(next)) if (!next[key]) delete next[key];
        return next;
      },
      replace: true,
    });

  const invalidRange = Boolean(filters.from && filters.to && filters.from > filters.to);

  // The form: kept after closing, so the drawer's content doesn't change while it animates out.
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Transaction | undefined>();
  const [newType, setNewType] = useState<TransactionType>('expense');
  const [deleting, setDeleting] = useState<Transaction | undefined>();
  const openNew = (type: TransactionType) => {
    setEditing(undefined);
    setNewType(type);
    setFormOpen(true);
  };
  const actions: RowActions = {
    onEdit: (transaction) => {
      setEditing(transaction);
      setFormOpen(true);
    },
    onDelete: setDeleting,
  };

  // Recording needs an active account; until the accounts load, the buttons wait.
  const canRecord = (accounts.data ?? []).some((account) => account.archivedAt === null);
  const header = (
    <>
      <Button variant="secondary" disabled={!canRecord} onClick={() => openNew('income')}>
        <Plus aria-hidden="true" className="size-4" />
        Income
      </Button>
      <Button disabled={!canRecord} onClick={() => openNew('expense')}>
        <Plus aria-hidden="true" className="size-4" />
        Expense
      </Button>
    </>
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Transactions" actions={header} />

      <Filters
        filters={filters}
        accounts={accounts.data ?? []}
        categories={categories.data ?? []}
        lookups={lookups}
        invalidRange={invalidRange}
        onChange={setFilters}
      />

      <section aria-label="Transactions">
        {invalidRange ? (
          <Alert tone="info">Choose a “From” date on or before the “To” date.</Alert>
        ) : (
          <TransactionResults
            filters={filters}
            lookups={lookups}
            hasAccounts={accounts.data === undefined || accounts.data.length > 0}
            actions={actions}
            onClearFilters={() => void navigate({ search: {}, replace: true })}
          />
        )}
      </section>

      <TransactionFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        transaction={editing}
        initialType={newType}
        defaultAccountId={filters.accountId}
        accounts={accounts.data ?? []}
        categories={categories.data ?? []}
      />
      <DeleteDialog
        transaction={deleting}
        lookups={lookups}
        onClose={() => setDeleting(undefined)}
      />
    </div>
  );
}

/** Asks before deleting: a transaction is deleted for good, and the balance changes at once. */
function DeleteDialog({
  transaction,
  lookups,
  onClose,
}: {
  transaction: Transaction | undefined;
  lookups: Lookups;
  onClose(): void;
}) {
  const remove = useDeleteTransaction();
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  const alertRef = useRef<HTMLDivElement>(null);
  // Kept while the dialog animates out after a delete.
  const [shown, setShown] = useState(transaction);
  if (transaction && transaction !== shown) setShown(transaction);

  useEffect(() => {
    if (error) alertRef.current?.focus();
  }, [error]);

  const onDelete = async () => {
    if (!transaction) return;
    setError(null);
    try {
      await remove.mutateAsync(transaction.id);
      toast({ title: 'Transaction deleted' });
      onClose();
    } catch (failure) {
      setError(toFormError(failure, []).message ?? null);
    }
  };

  return (
    <Dialog
      open={transaction !== undefined}
      onOpenChange={(open) => {
        if (!open) {
          setError(null);
          onClose();
        }
      }}
    >
      <DialogContent
        title="Delete this transaction?"
        description={
          shown
            ? `${transactionName(shown, lookups)}. It is deleted for good, and the account’s balance changes at once.`
            : undefined
        }
      >
        {error && (
          <Alert ref={alertRef} className="mb-4">
            {error}
          </Alert>
        )}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <DialogClose asChild>
            <Button variant="secondary">Cancel</Button>
          </DialogClose>
          <Button variant="destructive" loading={remove.isPending} onClick={() => void onDelete()}>
            Delete
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

interface FiltersProps {
  filters: TransactionFilters;
  accounts: Account[];
  categories: Category[];
  lookups: Lookups;
  invalidRange: boolean;
  onChange(change: Partial<TransactionFilters>): void;
}

function Filters({ filters, accounts, categories, lookups, invalidRange, onChange }: FiltersProps) {
  const accountOptions = [
    { value: '', label: 'All accounts' },
    ...accounts.map((account) => ({
      value: account.id,
      label: account.archivedAt ? `${account.name} (archived)` : account.name,
    })),
  ];
  const categoryOptions = [
    { value: '', label: 'All categories' },
    ...categories
      .filter((category) => !filters.type || category.kind === filters.type)
      .map((category) => ({
        value: category.id,
        label: `${categoryLabel(category, lookups.categories)}${category.archivedAt ? ' (archived)' : ''}`,
      })),
  ];

  const onType = (view: TypeView) => {
    const type = view === 'all' ? undefined : view;
    const category = filters.categoryId ? lookups.categories.get(filters.categoryId) : undefined;
    // A category of the other kind would match nothing: drop it with the switch.
    const keepCategory = !type || !category || category.kind === type;
    onChange({ type, ...(keepCategory ? {} : { categoryId: undefined }) });
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SegmentedControl
          label="Show"
          options={TYPE_VIEWS}
          value={filters.type ?? 'all'}
          onValueChange={onType}
        />
        {hasFilters(filters) && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              onChange({
                accountId: undefined,
                categoryId: undefined,
                type: undefined,
                from: undefined,
                to: undefined,
              })
            }
          >
            Clear filters
          </Button>
        )}
      </div>
      {/* Two columns from the narrowest phone: the dates share a row there. */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <SelectField
          label="Account"
          className="col-span-2 sm:col-span-1"
          options={accountOptions}
          value={filters.accountId ?? ''}
          onChange={(event) => onChange({ accountId: event.target.value || undefined })}
        />
        <SelectField
          label="Category"
          className="col-span-2 sm:col-span-1"
          options={categoryOptions}
          value={filters.categoryId ?? ''}
          onChange={(event) => onChange({ categoryId: event.target.value || undefined })}
        />
        <TextField
          label="From"
          type="date"
          value={filters.from ?? ''}
          max={filters.to}
          error={invalidRange ? 'After the “To” date.' : undefined}
          onChange={(event) => onChange({ from: event.target.value || undefined })}
        />
        <TextField
          label="To"
          type="date"
          value={filters.to ?? ''}
          min={filters.from}
          onChange={(event) => onChange({ to: event.target.value || undefined })}
        />
      </div>
    </div>
  );
}

interface TransactionResultsProps {
  filters: TransactionFilters;
  lookups: Lookups;
  hasAccounts: boolean;
  actions: RowActions;
  onClearFilters(): void;
}

function TransactionResults({
  filters,
  lookups,
  hasAccounts,
  actions,
  onClearFilters,
}: TransactionResultsProps) {
  const transactions = useTransactions(filters);

  if (transactions.isPending) return <TransactionListSkeleton />;

  if (transactions.isError) {
    return (
      <Alert>
        <p>Your transactions couldn’t be loaded.</p>
        <Button
          variant="secondary"
          size="sm"
          className="mt-2"
          loading={transactions.isFetching}
          onClick={() => void transactions.refetch()}
        >
          Try again
        </Button>
      </Alert>
    );
  }

  const items = transactions.data.pages.flatMap((page) => page.items);

  if (items.length === 0) {
    if (hasFilters(filters)) {
      return (
        <EmptyState
          title="No transactions match these filters"
          action={
            <Button variant="secondary" onClick={onClearFilters}>
              Clear filters
            </Button>
          }
        >
          Try a wider date range, or another account or category.
        </EmptyState>
      );
    }
    if (!hasAccounts) {
      return (
        <EmptyState
          title="Add an account first"
          action={
            <Button asChild variant="secondary">
              <Link to="/accounts">Go to accounts</Link>
            </Button>
          }
        >
          Every transaction belongs to an account, such as a bank card or cash.
        </EmptyState>
      );
    }
    return (
      <EmptyState title="No transactions yet">
        Record what you earn and spend, and your account balances follow.
      </EmptyState>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {groupByDay(items).map(([day, dayItems]) => (
        <DayGroup key={day} day={day} items={dayItems} lookups={lookups} actions={actions} />
      ))}
      {transactions.hasNextPage && (
        <Button
          variant="secondary"
          className="self-center"
          loading={transactions.isFetchingNextPage}
          onClick={() => void transactions.fetchNextPage()}
        >
          Show more
        </Button>
      )}
    </div>
  );
}

/** Consecutive rows of one day. The list is ordered by day, so each day is one run. */
function groupByDay(items: Transaction[]): [string, Transaction[]][] {
  const groups: [string, Transaction[]][] = [];
  for (const item of items) {
    const last = groups.at(-1);
    if (last && last[0] === item.occurredOn) last[1].push(item);
    else groups.push([item.occurredOn, [item]]);
  }
  return groups;
}

function DayGroup({
  day,
  items,
  lookups,
  actions,
}: {
  day: string;
  items: Transaction[];
  lookups: Lookups;
  actions: RowActions;
}) {
  const headingId = `day-${day}`;
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2">
      <h2 id={headingId} className="text-label text-text-secondary">
        {formatCalendarDate(day)}
      </h2>
      <ul className="divide-y divide-border rounded-md border border-border bg-surface">
        {items.map((transaction) => (
          <li key={transaction.id}>
            <TransactionRow
              transaction={transaction}
              lookups={lookups}
              actions={
                lookups.accounts.get(transaction.accountId)?.archivedAt === null ? (
                  <RowButtons transaction={transaction} lookups={lookups} actions={actions} />
                ) : undefined
              }
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

export function TransactionRow({
  transaction,
  lookups,
  actions,
}: {
  transaction: Transaction;
  lookups: Lookups;
  actions?: ReactNode;
}) {
  const category = lookups.categories.get(transaction.categoryId);
  const account = lookups.accounts.get(transaction.accountId);
  const income = transaction.type === 'income';
  const details = [transaction.description, account?.name].filter(Boolean).join(' · ');

  return (
    <div className="flex items-center gap-2 px-4 py-3 sm:px-5">
      <div className="flex min-w-0 flex-1 items-center justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate text-body font-medium">
            {category ? categoryLabel(category, lookups.categories) : 'Category'}
          </span>
          {details && (
            <span className="truncate text-body-small text-text-secondary">{details}</span>
          )}
        </div>
        <span
          className={cn(
            'shrink-0 font-mono text-body font-medium tabular-nums',
            income ? 'text-positive' : 'text-text',
          )}
        >
          <span className="sr-only">{income ? 'Income' : 'Expense'} </span>
          {formatAmd(signedAmount(transaction), { sign: 'always' })}
        </span>
      </div>
      {actions}
    </div>
  );
}

function RowButtons({
  transaction,
  lookups,
  actions,
}: {
  transaction: Transaction;
  lookups: Lookups;
  actions: RowActions;
}) {
  const name = transactionName(transaction, lookups);
  return (
    <div className="flex shrink-0">
      <Button
        variant="ghost"
        size="sm"
        aria-label={`Edit ${name}`}
        className="px-2"
        onClick={() => actions.onEdit(transaction)}
      >
        <Pencil aria-hidden="true" className="size-4" />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        aria-label={`Delete ${name}`}
        className="px-2 text-text-secondary hover:text-negative"
        onClick={() => actions.onDelete(transaction)}
      >
        <Trash2 aria-hidden="true" className="size-4" />
      </Button>
    </div>
  );
}

function TransactionListSkeleton() {
  return (
    <div
      aria-busy="true"
      className="divide-y divide-border rounded-md border border-border bg-surface"
    >
      <span className="sr-only">Loading transactions</span>
      {[0, 1, 2, 3].map((row) => (
        <div key={row} className="flex items-center justify-between gap-6 px-4 py-4 sm:px-5">
          <div className="flex flex-col gap-2">
            <Skeleton className="h-4 w-36" />
            <Skeleton className="h-3 w-48" />
          </div>
          <Skeleton className="h-4 w-24" />
        </div>
      ))}
    </div>
  );
}
