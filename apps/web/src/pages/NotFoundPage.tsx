import { Link } from '@tanstack/react-router';
import { Button } from '../ui/Button';
import { EmptyState } from '../ui/EmptyState';
import { Logo } from '../ui/Logo';
import { PageHeader } from '../ui/PageHeader';

/**
 * An address no route matches. It stands on its own, outside the app shell
 * and the sign-in layout, so it works whether or not anyone is signed in.
 */
export function NotFoundPage() {
  return (
    <div className="min-h-dvh bg-page text-text">
      <header className="px-6 py-6 sm:px-10">
        <Link to="/" aria-label="Costly, overview" className="inline-flex rounded-sm">
          <Logo />
        </Link>
      </header>
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6 sm:px-6">
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
      </main>
    </div>
  );
}
