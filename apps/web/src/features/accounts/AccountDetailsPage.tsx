import { type Account, ACCOUNT_TYPE_LABELS, ApiError, formatAmd } from '@costly/shared';
import { getRouteApi, Link } from '@tanstack/react-router';
import { ArchiveRestore, ChevronLeft, Pencil } from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { toFormError } from '../../auth/errors';
import { formatCalendarDate } from '../../lib/dates';
import { Alert } from '../../ui/Alert';
import { Button } from '../../ui/Button';
import { Card } from '../../ui/Card';
import { Dialog, DialogClose, DialogContent } from '../../ui/Dialog';
import { EmptyState } from '../../ui/EmptyState';
import { PageHeader } from '../../ui/PageHeader';
import { Skeleton } from '../../ui/Skeleton';
import { useToast } from '../../ui/Toast';
import { AccountFormDialog } from './AccountFormDialog';
import { useArchiveAccount, useRestoreAccount } from './mutations';
import { useAccount } from './queries';

const route = getRouteApi('/app/accounts/$accountId');

/** The instant the API sends, as the calendar day it was in the user's browser. */
function formatInstant(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(iso));
}

/**
 * One account: what it is, its opening balance, and the actions its state
 * allows. An archived account is read-only until it is restored.
 */
export function AccountDetailsPage() {
  const { accountId } = route.useParams();
  const account = useAccount(accountId);

  if (account.isPending) return <DetailsSkeleton />;

  if (account.isError) {
    // A malformed id (400) and someone else's or a missing account (404)
    // mean the same thing to the person: there is no such account.
    const missing =
      account.error instanceof ApiError &&
      account.error.kind === 'http' &&
      (account.error.status === 404 || account.error.status === 400);
    return (
      <div className="flex flex-col gap-6">
        <BackLink />
        <PageHeader title={missing ? 'Account not found' : 'Account'} />
        {missing ? (
          <EmptyState
            title="This account doesn’t exist"
            action={
              <Button asChild variant="secondary">
                <Link to="/accounts">Go to your accounts</Link>
              </Button>
            }
          >
            Check the address, or open the account from your list.
          </EmptyState>
        ) : (
          <Alert>
            <p>This account couldn’t be loaded.</p>
            <Button
              variant="secondary"
              size="sm"
              className="mt-2"
              loading={account.isFetching}
              onClick={() => void account.refetch()}
            >
              Try again
            </Button>
          </Alert>
        )}
      </div>
    );
  }

  return <AccountDetails account={account.data} />;
}

function BackLink({ archived = false }: { archived?: boolean }) {
  return (
    <Link
      to="/accounts"
      search={archived ? { view: 'archived' } : {}}
      className="-ml-1 inline-flex w-fit items-center gap-1 rounded-sm px-1 text-body-small font-medium text-text-secondary hover:text-text"
    >
      <ChevronLeft aria-hidden="true" className="size-4" />
      Accounts
    </Link>
  );
}

function AccountDetails({ account }: { account: Account }) {
  const archived = account.archivedAt !== null;
  const toast = useToast();
  const archive = useArchiveAccount(account.id);
  const restore = useRestoreAccount(account.id);
  const [editOpen, setEditOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const alertRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (actionError) alertRef.current?.focus();
  }, [actionError]);

  const onRestore = async () => {
    setActionError(null);
    try {
      await restore.mutateAsync();
      toast({ title: 'Account restored' });
    } catch (error) {
      const conflict = error instanceof ApiError && error.kind === 'http' && error.status === 409;
      setActionError(
        conflict
          ? `You already have an active account called “${account.name}”. Rename that one first, then restore this account.`
          : (toFormError(error, []).message ?? null),
      );
    }
  };

  const onArchive = async () => {
    setActionError(null);
    try {
      await archive.mutateAsync();
      setConfirmOpen(false);
      toast({ title: 'Account archived' });
    } catch (error) {
      setConfirmOpen(false);
      setActionError(toFormError(error, []).message ?? null);
    }
  };

  const actions = archived ? (
    <Button variant="secondary" loading={restore.isPending} onClick={() => void onRestore()}>
      <ArchiveRestore aria-hidden="true" className="size-4" />
      Restore
    </Button>
  ) : (
    <>
      <Button variant="secondary" onClick={() => setConfirmOpen(true)}>
        Archive
      </Button>
      <Button variant="secondary" onClick={() => setEditOpen(true)}>
        <Pencil aria-hidden="true" className="size-4" />
        Edit
      </Button>
    </>
  );

  return (
    <div className="flex flex-col gap-6">
      <BackLink archived={archived} />
      <PageHeader title={account.name} actions={actions} />

      {actionError && <Alert ref={alertRef}>{actionError}</Alert>}
      {archived && (
        <Alert tone="info">
          Archived on {formatInstant(account.archivedAt!)}. It is kept with its history and can’t be
          changed. Restore it to use it again.
        </Alert>
      )}

      <Card>
        <dl className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
          <Detail term={`Opening balance, ${formatCalendarDate(account.openingDate)}`}>
            <span className="font-mono text-heading-section tabular-nums">
              {formatAmd(account.openingBalance)}
            </span>
          </Detail>
          <Detail term="Type">{ACCOUNT_TYPE_LABELS[account.type]}</Detail>
          <Detail term="Spendable money">
            {account.isLiquid ? 'Yes, counts as money you can spend' : 'No'}
          </Detail>
          <Detail term="Currency">{account.currency}</Detail>
          <Detail term="Added">{formatInstant(account.createdAt)}</Detail>
        </dl>
      </Card>

      <AccountFormDialog open={editOpen} onOpenChange={setEditOpen} account={account} />

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent
          title={`Archive “${account.name}”?`}
          description="It leaves your active accounts and can’t be changed while archived. Nothing is deleted, and you can restore it at any time."
        >
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <DialogClose asChild>
              <Button variant="secondary">Cancel</Button>
            </DialogClose>
            <Button loading={archive.isPending} onClick={() => void onArchive()}>
              Archive account
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Detail({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-label text-text-secondary">{term}</dt>
      <dd className="text-body">{children}</dd>
    </div>
  );
}

function DetailsSkeleton() {
  return (
    <div aria-busy="true" className="flex flex-col gap-6">
      <span className="sr-only">Loading account</span>
      <Skeleton className="h-4 w-20" />
      <Skeleton className="h-8 w-56" />
      <Skeleton className="h-40 w-full" />
    </div>
  );
}
