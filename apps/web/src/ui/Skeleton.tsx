import { cn } from './cn';

/**
 * A placeholder block while content loads. Hidden from assistive technology:
 * the region that is loading marks itself `aria-busy` instead.
 */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cn('animate-pulse rounded-sm bg-subtle', className)} />;
}
