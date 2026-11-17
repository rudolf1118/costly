import { forwardRef, type HTMLAttributes } from 'react';
import { cn } from './cn';

/** A bordered surface. Border only, no shadow (Handoff board). */
export const Card = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(function Card(
  { className, ...props },
  ref,
) {
  return (
    <div
      ref={ref}
      className={cn('rounded-md border border-border bg-surface p-5 sm:p-6', className)}
      {...props}
    />
  );
});
