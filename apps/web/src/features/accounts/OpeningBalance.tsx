import { type Account, formatAmd } from '@costly/shared';
import { formatCalendarDate } from '../../lib/dates';
import { cn } from '../../ui/cn';

/**
 * An account's opening balance and the day it applies to. It is always named
 * as the opening balance, never shown as what the account holds now.
 */
export function OpeningBalance({ account, className }: { account: Account; className?: string }) {
  return (
    <div className={cn('flex flex-col', className)}>
      <span className="text-label text-text-secondary">
        Opening balance, {formatCalendarDate(account.openingDate)}
      </span>
      <span className="font-mono text-body font-medium tabular-nums">
        {formatAmd(account.openingBalance)}
      </span>
    </div>
  );
}
