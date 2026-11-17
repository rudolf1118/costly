import { ApiError } from '@costly/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, type RouterHistory } from '@tanstack/react-router';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { createAppRouter } from './app/router';
import { SessionStore } from './auth/session';
import { SessionProvider } from './auth/SessionContext';
import { Button } from './ui/Button';
import { LogoMark } from './ui/Logo';
import { ToastProvider } from './ui/Toast';

export interface AppProps {
  apiBaseUrl: string;
  /** Tests inject a session on a fake API and an in-memory history. */
  session?: SessionStore;
  history?: RouterHistory;
}

export function App({ apiBaseUrl, session: injected, history }: AppProps) {
  // One of each for the app's lifetime.
  const [session] = useState(() => injected ?? new SessionStore({ baseUrl: apiBaseUrl }));
  const [queryClient] = useState(createQueryClient);
  const [router] = useState(() => createAppRouter({ apiBaseUrl, session }, history));
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot);

  useEffect(() => {
    if (session.getSnapshot().status === 'restoring') void session.restore();
  }, [session]);

  // Every session change re-runs the route guards: signing in moves on from
  // the sign-in page, signing out or expiring moves to it. Nothing cached for
  // one session may be shown to the next.
  useEffect(() => {
    if (state.status === 'anonymous') queryClient.clear();
    if (state.status === 'authenticated' || state.status === 'anonymous') {
      void router.invalidate();
    }
  }, [state, router, queryClient]);

  if (state.status === 'restoring') return <Starting />;
  if (state.status === 'unavailable') return <Unreachable onRetry={() => session.restore()} />;

  return (
    <SessionProvider store={session}>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <RouterProvider router={router} />
        </ToastProvider>
      </QueryClientProvider>
    </SessionProvider>
  );
}

/**
 * A failed read is retried once, and only when retrying can help: the network
 * dropped or the API was briefly unavailable. A 4xx answer won't change.
 */
function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: (failures, error) =>
          failures < 1 &&
          error instanceof ApiError &&
          (error.kind === 'network' || error.status >= 500),
      },
    },
  });
}

/** Shown while the session is restored on start; usually a fraction of a second. */
function Starting() {
  return (
    <div aria-busy="true" className="flex min-h-dvh items-center justify-center bg-page">
      <LogoMark className="size-10 text-accent-muted motion-safe:animate-pulse" />
      <span className="sr-only">Loading Costly</span>
    </div>
  );
}

/** The API didn't answer on start: not the same as being signed out. */
function Unreachable({ onRetry }: { onRetry: () => void }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-page px-6 text-center text-text">
      <LogoMark className="size-10 text-accent-muted" />
      <h1 className="text-heading-section">Costly can’t be reached</h1>
      <p className="max-w-sm text-body text-text-secondary">
        Check your connection. Your data is safe; nothing was changed.
      </p>
      <Button variant="secondary" onClick={onRetry}>
        Try again
      </Button>
    </main>
  );
}
