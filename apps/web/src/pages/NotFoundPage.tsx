import { Link } from '@tanstack/react-router';
import { Button } from '../ui/Button';
import { EmptyState } from '../ui/EmptyState';
import { PageHeader } from '../ui/PageHeader';

export function NotFoundPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Page not found" />
      <EmptyState
        title="This page doesn't exist"
        action={
          <Button asChild variant="secondary">
            <Link to="/">Go to the overview</Link>
          </Button>
        }
      >
        The address may be mistyped, or the page may have moved.
      </EmptyState>
    </div>
  );
}
