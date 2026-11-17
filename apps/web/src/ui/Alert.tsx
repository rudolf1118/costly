import { CircleAlert, CircleCheck, Info } from 'lucide-react';
import { forwardRef, type ReactNode } from 'react';
import { cn } from './cn';

const TONES = {
  error: { icon: CircleAlert, box: 'bg-negative-soft text-negative-ink', mark: 'text-negative' },
  success: { icon: CircleCheck, box: 'bg-positive-soft text-positive-ink', mark: 'text-positive' },
  info: { icon: Info, box: 'bg-accent-soft text-accent-ink', mark: 'text-accent-text' },
} as const;

/**
 * A message about the page or form as a whole: what happened and what to
 * do. An error is announced as soon as it appears (`role="alert"`); other
 * tones politely. Field errors belong on their fields instead.
 */
export const Alert = forwardRef<
  HTMLDivElement,
  { tone?: keyof typeof TONES; children: ReactNode; className?: string }
>(function Alert({ tone = 'error', children, className }, ref) {
  const { icon: Icon, box, mark } = TONES[tone];
  return (
    <div
      ref={ref}
      tabIndex={-1}
      role={tone === 'error' ? 'alert' : 'status'}
      className={cn(
        'flex gap-2.5 rounded-sm px-3 py-2.5 text-body-small outline-none',
        box,
        className,
      )}
    >
      <Icon aria-hidden="true" className={cn('mt-px size-4 shrink-0', mark)} />
      <div>{children}</div>
    </div>
  );
});
