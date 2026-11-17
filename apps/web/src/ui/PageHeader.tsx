import type { ReactNode } from 'react';

/** The page title row: the page's one `<h1>`, and optional actions on the right. */
export function PageHeader({ title, actions }: { title: string; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4">
      <h1 className="text-heading-page">{title}</h1>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
