import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '../../ui/Button';
import { formatMonth, shiftMonth } from './month';

/**
 * Steps through months, one at a time, up to the current one: there is
 * nothing to show after it. "This month" jumps back from the past.
 */
export function MonthPicker({
  month,
  latest,
  onChange,
}: {
  month: string;
  latest: string;
  onChange(month: string): void;
}) {
  const atLatest = month >= latest;
  return (
    <div className="flex items-center gap-1" role="group" aria-label="Month">
      {/* Before the arrows, so they don't move when it appears. */}
      {!atLatest && (
        <Button variant="ghost" size="sm" onClick={() => onChange(latest)}>
          This month
        </Button>
      )}
      <Button
        variant="secondary"
        size="sm"
        className="px-2"
        aria-label="Previous month"
        onClick={() => onChange(shiftMonth(month, -1))}
      >
        <ChevronLeft aria-hidden="true" className="size-4" />
      </Button>
      <span
        aria-live="polite"
        className="min-w-36 px-2 text-center text-body font-medium tabular-nums"
      >
        {formatMonth(month)}
      </span>
      <Button
        variant="secondary"
        size="sm"
        className="px-2"
        aria-label="Next month"
        disabled={atLatest}
        onClick={() => onChange(shiftMonth(month, 1))}
      >
        <ChevronRight aria-hidden="true" className="size-4" />
      </Button>
    </div>
  );
}
