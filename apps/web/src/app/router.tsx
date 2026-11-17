import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  type RouterHistory,
} from '@tanstack/react-router';
import { NotFoundPage } from '../pages/NotFoundPage';
import { OverviewPage } from '../pages/OverviewPage';
import { SettingsPage } from '../pages/SettingsPage';
import { AppShell } from './AppShell';

export interface RouterContext {
  apiBaseUrl: string;
}

declare module '@tanstack/react-router' {
  interface StaticDataRouteOption {
    /** The page's name, used for the document title. */
    title?: string;
  }
}

const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: AppShell,
  notFoundComponent: NotFoundPage,
  staticData: { title: 'Page not found' },
});

const overviewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: OverviewPage,
  staticData: { title: 'Overview' },
});

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings',
  component: SettingsPage,
  staticData: { title: 'Settings' },
});

const routeTree = rootRoute.addChildren([overviewRoute, settingsRoute]);

/** The router. Tests pass a memory history; the app uses the browser's. */
export function createAppRouter(context: RouterContext, history?: RouterHistory) {
  return createRouter({
    routeTree,
    context,
    defaultPreload: 'intent',
    scrollRestoration: true,
    ...(history ? { history } : {}),
  });
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
