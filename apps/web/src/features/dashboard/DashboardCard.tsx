import type { ReactNode } from 'react';
import { Card } from '../../ui/Card';
import { cn } from '../../ui/cn';

/**
 * A titled dashboard panel: a section landmark named by its heading, with an
 * optional control (a period switch, a link) on the right.
 */
export function DashboardCard({
  title,
  description,
  action,
  className,
  children,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  const id = `dashboard-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  return (
    <Card className={cn('flex min-w-0 flex-col gap-4', className)}>
      <section aria-labelledby={id} className="contents">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-0.5">
            <h2 id={id} className="text-title-card">
              {title}
            </h2>
            {description && <p className="text-body-small text-text-secondary">{description}</p>}
          </div>
          {action}
        </div>
        {children}
      </section>
    </Card>
  );
}

/** A panel's own empty state: quieter than the page's, one sentence. */
export function PanelEmpty({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-40 flex-1 items-center justify-center rounded-sm border border-dashed border-border px-4 py-8 text-center text-body-small text-text-secondary">
      {children}
    </div>
  );
}
