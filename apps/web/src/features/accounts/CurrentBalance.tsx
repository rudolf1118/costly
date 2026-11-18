import { type Account, formatAmd } from '@costly/shared';
import { cn } from '../../ui/cn';

/**
 * An account's current balance: the opening balance plus income minus
 * expenses, as the API derives it from the account's transactions.
 */
export function CurrentBalance({ account, className }: { account: Account; className?: string }) {
  return (
    <div className={cn('flex flex-col', className)}>
      <span className="text-label text-text-secondary">Current balance</span>
      <span className="font-mono text-body font-medium tabular-nums">
        {formatAmd(account.balance)}
      </span>
    </div>
  );
}
