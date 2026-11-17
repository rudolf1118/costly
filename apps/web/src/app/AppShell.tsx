import { Outlet, useRouterState } from '@tanstack/react-router';
import { useEffect, useRef } from 'react';
import { TooltipProvider } from '../ui/Tooltip';
import { BottomTabs, Sidebar, TopBar } from './NavMenus';

/**
 * The frame around every signed-in page: a skip link, the navigation and
 * the page in `<main>`. Moves focus to the page after each navigation so a
 * screen reader starts reading there.
 */
export function AppShell() {
  const mainRef = useFocusOnNavigation();

  return (
    <TooltipProvider delayDuration={300}>
      <div className="min-h-dvh bg-page text-text">
        <SkipLink />
        <Sidebar />
        <TopBar />
        <main
          id="main"
          ref={mainRef}
          tabIndex={-1}
          className="pb-[calc(4rem+env(safe-area-inset-bottom))] outline-none sm:pb-0 md:pl-16 lg:pl-58"
        >
          <div className="mx-auto w-full max-w-[85rem] px-4 py-6 sm:px-6 lg:px-10 lg:py-9">
            <Outlet />
          </div>
        </main>
        <BottomTabs />
      </div>
    </TooltipProvider>
  );
}

export function SkipLink() {
  return (
    <a
      href="#main"
      className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-sm focus:bg-surface focus:px-4 focus:py-2 focus:text-body focus:font-medium focus:shadow-e1"
    >
      Skip to content
    </a>
  );
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
