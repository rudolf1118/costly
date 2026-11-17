import { Link, Outlet, useMatches, useRouterState } from '@tanstack/react-router';
import { useEffect, useRef } from 'react';
import { Logo } from '../ui/Logo';
import { allNav } from './navigation';

/**
 * The frame around every page: a skip link, the navigation and the page in
 * `<main>`. Keeps the document title in step with the page, and moves focus
 * to the page after each navigation so a screen reader starts reading there.
 */
export function AppShell() {
  usePageTitle();
  const mainRef = useFocusOnNavigation();

  return (
    <div className="min-h-dvh bg-page text-text">
      <SkipLink />
      <header className="flex items-center gap-6 border-b border-border bg-surface px-4 py-3">
        <Logo />
        <nav aria-label="Main">
          <ul className="flex gap-1">
            {allNav.map((item) => (
              <li key={item.to}>
                <Link
                  to={item.to}
                  className="rounded-sm px-3 py-2 text-body font-medium text-text-secondary hover:bg-subtle aria-[current=page]:text-accent-text"
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </header>
      <main
        id="main"
        ref={mainRef}
        tabIndex={-1}
        className="mx-auto w-full max-w-[85rem] px-4 py-6 outline-none sm:px-6 lg:px-10 lg:py-9"
      >
        <Outlet />
      </main>
    </div>
  );
}

function SkipLink() {
  return (
    <a
      href="#main"
      className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-sm focus:bg-surface focus:px-4 focus:py-2 focus:text-body focus:font-medium focus:shadow-e1"
    >
      Skip to content
    </a>
  );
}

const APP_NAME = 'Costly';

function usePageTitle() {
  const matches = useMatches();
  const title = [...matches].reverse().find((match) => match.staticData.title)?.staticData.title;

  useEffect(() => {
    document.title = title ? `${title} · ${APP_NAME}` : APP_NAME;
  }, [title]);
}

function useFocusOnNavigation() {
  const mainRef = useRef<HTMLElement>(null);
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const firstRender = useRef(true);

  useEffect(() => {
    // The first page load keeps the browser's own focus handling.
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    mainRef.current?.focus({ preventScroll: true });
  }, [pathname]);

  return mainRef;
}
