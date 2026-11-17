import { createMemoryHistory } from '@tanstack/react-router';
import { render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import { App } from '../App';
import { SessionStore } from '../auth/session';
import { ThemeProvider } from '../theme/ThemeProvider';

export const TEST_API = 'http://api.test';

export const TEST_USER = {
  id: 'u1',
  email: 'anna@example.test',
  baseCurrency: 'AMD',
  timezone: 'Asia/Yerevan',
  createdAt: '2026-11-01T10:00:00.000Z',
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
export const problem = (
  status: number,
  extra: Record<string, unknown> = {},
  headers: Record<string, string> = {},
) =>
  new Response(JSON.stringify({ type: 'about:blank', title: 'Error', status, ...extra }), {
    status,
    headers: { 'Content-Type': 'application/problem+json', ...headers },
  });
export const accessToken = (value = 't1') =>
  json(200, { accessToken: value, tokenType: 'Bearer', expiresIn: 900 });

export type Route = (init: RequestInit) => Response | Promise<Response>;

/**
 * A fake API for whole-app tests. `signedIn` decides what the refresh
 * cookie answers on start; `routes` override or add endpoints by
 * "METHOD /path".
 */
export function fakeApi({
  signedIn,
  routes = {},
}: {
  signedIn: boolean;
  routes?: Record<string, Route>;
}) {
  const defaults: Record<string, Route> = {
    'POST /auth/refresh': () => (signedIn ? accessToken() : problem(401)),
    'GET /auth/me': () => json(200, TEST_USER),
    'POST /auth/login': () => accessToken(),
    'POST /auth/logout': () => new Response(null, { status: 204 }),
    'GET /health': () => json(200, { status: 'ok', details: {} }),
  };
  const all = { ...defaults, ...routes };
  const calls: string[] = [];
  const fetch = vi.fn<typeof globalThis.fetch>(async (input, init = {}) => {
    const key = `${init.method ?? 'GET'} ${String(input).replace(TEST_API, '')}`;
    calls.push(key);
    const route = all[key];
    if (!route) throw new Error(`unexpected request ${key}`);
    return route(init);
  });
  return { fetch, calls, json };
}

/**
 * Renders the whole app at a path, on a fake API, and waits until the
 * session is settled and a page is shown.
 */
export async function renderApp(
  path = '/',
  api: ReturnType<typeof fakeApi> = fakeApi({ signedIn: true }),
) {
  vi.stubGlobal('fetch', api.fetch);
  const session = new SessionStore({ baseUrl: TEST_API, fetch: api.fetch });
  const history = createMemoryHistory({ initialEntries: [path] });
  const result = render(
    <ThemeProvider>
      <App apiBaseUrl={TEST_API} session={session} history={history} />
    </ThemeProvider>,
  );
  await screen.findByRole('heading', { level: 1 }, { timeout: 3000 });
  return { ...result, session, history, api };
}
