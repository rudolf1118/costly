import type { ReactNode } from 'react';
import { LogoMark } from './Logo';

/**
 * The design's empty state: the C mark at 40 px in Cobalt 200, one sentence
 * and at most one action.
 */
export function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-md border border-dashed border-border-strong px-6 py-14 text-center">
      <LogoMark className="size-10 text-accent-muted" />
      <h2 className="text-title-card">{title}</h2>
      {children && <p className="max-w-md text-body text-text-secondary">{children}</p>}
      {action && <div className="pt-2">{action}</div>}
    </div>
  );
}
