import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  Outlet,
  redirect,
  type RouterHistory,
  useMatches,
} from '@tanstack/react-router';
import { useEffect } from 'react';
import { AuthLayout } from '../auth/AuthLayout';
import type { SessionStore } from '../auth/session';
import { AccountsPage } from '../features/accounts/AccountsPage';
import { LoginPage } from '../pages/LoginPage';
import { NotFoundPage } from '../pages/NotFoundPage';
import { OverviewPage } from '../pages/OverviewPage';
import { RegisterPage } from '../pages/RegisterPage';
import { SettingsPage } from '../pages/SettingsPage';
import { AppShell } from './AppShell';

export interface RouterContext {
  apiBaseUrl: string;
  session: SessionStore;
}

declare module '@tanstack/react-router' {
  interface StaticDataRouteOption {
    /** The page's name, used for the document title. */
    title?: string;
  }
}

export interface AuthSearch {
  /** Where to go after signing in: a path on this site, never an external URL. */
  redirect?: string;
  /** Why the sign-in page is shown, when it isn't the user's own choice. */
  reason?: 'expired' | 'signed-out';
}

/** Accepts only a local path, so a crafted link can't send anyone off-site after sign-in. */
export function safeRedirect(value: unknown): string | undefined {
  return typeof value === 'string' &&
    value.startsWith('/') &&
    !value.startsWith('//') &&
    !value.startsWith('/\\')
    ? value
    : undefined;
}

function validateAuthSearch(search: Record<string, unknown>): AuthSearch {
  const redirectTo = safeRedirect(search.redirect);
  const reason =
    search.reason === 'expired' || search.reason === 'signed-out' ? search.reason : undefined;
  return {
    ...(redirectTo ? { redirect: redirectTo } : {}),
    ...(reason ? { reason } : {}),
  };
}

const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
  notFoundComponent: NotFoundPage,
  staticData: { title: 'Page not found' },
});

/** Every page that needs a session. Without one, it goes to sign-in and comes back after. */
const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'app',
  component: AppShell,
  beforeLoad: ({ context, location }) => {
    const state = context.session.getSnapshot();
    if (state.status !== 'authenticated') {
      const reason = state.status === 'anonymous' ? state.reason : undefined;
      throw redirect({
        to: '/login',
        search: {
          ...(location.href !== '/' ? { redirect: location.href } : {}),
          ...(reason ? { reason } : {}),
        },
      });
    }
  },
});

/** Sign-in and registration. With a session, they send you on to where you were going. */
const authRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'auth',
  component: AuthLayout,
  beforeLoad: ({ context, location }) => {
    if (context.session.getSnapshot().status === 'authenticated') {
      const search = validateAuthSearch(location.search as Record<string, unknown>);
      throw redirect({ href: search.redirect ?? '/' });
    }
  },
});

const overviewRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/',
  component: OverviewPage,
  staticData: { title: 'Overview' },
});

const accountsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/accounts',
  component: AccountsPage,
  // Active is the default view, so only the archived one appears in the address.
  validateSearch: (search: Record<string, unknown>): { view?: 'archived' } =>
    search.view === 'archived' ? { view: 'archived' } : {},
  staticData: { title: 'Accounts' },
});

const settingsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/settings',
  component: SettingsPage,
  staticData: { title: 'Settings' },
});

const loginRoute = createRoute({
  getParentRoute: () => authRoute,
  path: '/login',
  component: LoginPage,
  validateSearch: validateAuthSearch,
  staticData: { title: 'Sign in' },
});

const registerRoute = createRoute({
  getParentRoute: () => authRoute,
  path: '/register',
  component: RegisterPage,
  validateSearch: validateAuthSearch,
  staticData: { title: 'Create account' },
});

const routeTree = rootRoute.addChildren([
  appRoute.addChildren([overviewRoute, accountsRoute, settingsRoute]),
  authRoute.addChildren([loginRoute, registerRoute]),
]);

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

const APP_NAME = 'Costly';

/** Keeps the document title in step with the page, for every layout. */
function RootLayout() {
  const matches = useMatches();
  const title = [...matches].reverse().find((match) => match.staticData.title)?.staticData.title;

  useEffect(() => {
    document.title = title ? `${title} · ${APP_NAME}` : APP_NAME;
  }, [title]);

  return <Outlet />;
}
