import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionStore } from './session';

const BASE = 'http://api.test';
const USER = {
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
const problem = (status: number, detail?: string) =>
  new Response(JSON.stringify({ type: 'about:blank', title: 'Error', status, detail }), {
    status,
    headers: { 'Content-Type': 'application/problem+json' },
  });
const token = (value: string) =>
  json(200, { accessToken: value, tokenType: 'Bearer', expiresIn: 900 });

type Handler = (init: RequestInit) => Response | Promise<Response>;

/** A fake API: one handler queue per "METHOD path"; records every call. */
function fakeApi(routes: Record<string, Handler[]>) {
  const calls: Array<{ key: string; init: RequestInit }> = [];
  const fetch = vi.fn<typeof globalThis.fetch>(async (input, init = {}) => {
    const key = `${init.method ?? 'GET'} ${String(input).replace(BASE, '')}`;
    calls.push({ key, init });
    const queue = routes[key];
    const handler = queue && queue.length > 1 ? queue.shift() : queue?.[0];
    if (!handler) throw new Error(`unexpected request ${key}`);
    return handler(init);
  });
  const count = (key: string) => calls.filter((c) => c.key === key).length;
  return { fetch, calls, count };
}

let clock = 0;
const now = () => clock;

beforeEach(() => {
  clock = Date.parse('2026-11-18T10:00:00Z');
});

describe('SessionStore', () => {
  it('starts out restoring', () => {
    const store = new SessionStore({ baseUrl: BASE, fetch: vi.fn(), now });

    expect(store.getSnapshot()).toEqual({ status: 'restoring' });
  });

  it('restores a session from the refresh cookie', async () => {
    const api = fakeApi({
      'POST /auth/refresh': [() => token('t1')],
      'GET /auth/me': [() => json(200, USER)],
    });
    const store = new SessionStore({ baseUrl: BASE, fetch: api.fetch, now });

    await store.restore();

    expect(store.getSnapshot()).toEqual({ status: 'authenticated', user: USER });
    const refreshCall = api.calls.find((c) => c.key === 'POST /auth/refresh')!;
    expect(refreshCall.init.credentials).toBe('include');
    const meCall = api.calls.find((c) => c.key === 'GET /auth/me')!;
    expect((meCall.init.headers as Record<string, string>).Authorization).toBe('Bearer t1');
  });

  it('is signed out when the cookie holds no session', async () => {
    const api = fakeApi({ 'POST /auth/refresh': [() => problem(401)] });
    const store = new SessionStore({ baseUrl: BASE, fetch: api.fetch, now });

    await store.restore();

    expect(store.getSnapshot()).toEqual({ status: 'anonymous' });
    expect(store.getAccessToken()).toBeNull();
  });

  it('tells "unreachable" apart from "signed out"', async () => {
    const store = new SessionStore({
      baseUrl: BASE,
      fetch: vi.fn<typeof fetch>(async () => {
        throw new TypeError('Failed to fetch');
      }),
      now,
    });

    await store.restore();

    expect(store.getSnapshot()).toEqual({ status: 'unavailable' });
  });

  it('retries a refresh once after a 409 from another tab', async () => {
    const api = fakeApi({
      'POST /auth/refresh': [() => problem(409), () => token('t2')],
      'GET /auth/me': [() => json(200, USER)],
    });
    const store = new SessionStore({ baseUrl: BASE, fetch: api.fetch, now });

    await store.restore();

    expect(api.count('POST /auth/refresh')).toBe(2);
    expect(store.getSnapshot().status).toBe('authenticated');
  });

  it('merges restores started at the same time, as StrictMode does', async () => {
    const api = fakeApi({
      'POST /auth/refresh': [() => token('t1')],
      'GET /auth/me': [() => json(200, USER)],
    });
    const store = new SessionStore({ baseUrl: BASE, fetch: api.fetch, now });

    await Promise.all([store.restore(), store.restore()]);

    expect(api.count('POST /auth/refresh')).toBe(1);
  });

  it('signs in, keeping the access token in memory only', async () => {
    const api = fakeApi({
      'POST /auth/login': [() => token('t1')],
      'GET /auth/me': [() => json(200, USER)],
    });
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const store = new SessionStore({ baseUrl: BASE, fetch: api.fetch, now });

    await store.login('anna@example.test', 'correct horse battery staple');

    expect(store.getSnapshot()).toEqual({ status: 'authenticated', user: USER });
    expect(store.getAccessToken()).toBe('t1');
    const login = api.calls.find((c) => c.key === 'POST /auth/login')!;
    expect(login.init.credentials).toBe('include');
    expect(JSON.parse(login.init.body as string)).toEqual({
      email: 'anna@example.test',
      password: 'correct horse battery staple',
    });
    expect(setItem).not.toHaveBeenCalled();
    expect(document.cookie).toBe('');
  });

  it('reports a refused sign-in without changing the state', async () => {
    const api = fakeApi({ 'POST /auth/login': [() => problem(401, 'Invalid email or password.')] });
    const store = new SessionStore({ baseUrl: BASE, fetch: api.fetch, now });
    const before = store.getSnapshot();

    await expect(store.login('anna@example.test', 'wrong')).rejects.toMatchObject({
      status: 401,
      problem: { detail: 'Invalid email or password.' },
    });
    expect(api.count('POST /auth/refresh')).toBe(0);
    expect(store.getSnapshot()).toBe(before);
  });

  it('registers, then signs in with the new account', async () => {
    const api = fakeApi({
      'POST /auth/register': [() => json(201, USER)],
      'POST /auth/login': [() => token('t1')],
      'GET /auth/me': [() => json(200, USER)],
    });
    const store = new SessionStore({ baseUrl: BASE, fetch: api.fetch, now });

    await store.register({
      email: 'anna@example.test',
      password: 'correct horse battery staple',
      timezone: 'Asia/Yerevan',
    });

    expect(api.calls.map((c) => c.key)).toEqual([
      'POST /auth/register',
      'POST /auth/login',
      'GET /auth/me',
    ]);
    expect(store.getSnapshot().status).toBe('authenticated');
  });

  it('refreshes an access token that is about to expire before using it', async () => {
    const api = fakeApi({
      'POST /auth/login': [() => token('t1')],
      'POST /auth/refresh': [() => token('t2')],
      'GET /auth/me': [() => json(200, USER)],
    });
    const store = new SessionStore({ baseUrl: BASE, fetch: api.fetch, now });
    await store.login('anna@example.test', 'pw-12345678');

    clock += 880_000; // 14 min 40 s of a 15 min token: inside the 30 s margin.
    await store.api.request('/auth/me');

    const lastMe = api.calls.filter((c) => c.key === 'GET /auth/me').at(-1)!;
    expect((lastMe.init.headers as Record<string, string>).Authorization).toBe('Bearer t2');
  });

  it('ends the session as "expired" when the API refuses to refresh it', async () => {
    const api = fakeApi({
      'POST /auth/login': [() => token('t1')],
      'GET /auth/me': [() => json(200, USER)],
      'POST /auth/refresh': [() => problem(401)],
    });
    const store = new SessionStore({ baseUrl: BASE, fetch: api.fetch, now });
    await store.login('anna@example.test', 'pw-12345678');

    clock += 900_000;
    await expect(store.api.request('/auth/me')).rejects.toMatchObject({ status: 401 });

    expect(store.getSnapshot()).toEqual({ status: 'anonymous', reason: 'expired' });
  });

  it('keeps the session through a network failure while refreshing', async () => {
    const api = fakeApi({
      'POST /auth/login': [() => token('t1')],
      'GET /auth/me': [() => json(200, USER)],
      'POST /auth/refresh': [
        () => {
          throw new TypeError('Failed to fetch');
        },
      ],
    });
    const store = new SessionStore({ baseUrl: BASE, fetch: api.fetch, now });
    await store.login('anna@example.test', 'pw-12345678');

    clock += 900_000;
    await expect(store.api.request('/auth/me')).rejects.toMatchObject({ kind: 'network' });

    expect(store.getSnapshot().status).toBe('authenticated');
  });

  it('signs out locally even when the API cannot be told', async () => {
    const api = fakeApi({
      'POST /auth/login': [() => token('t1')],
      'GET /auth/me': [() => json(200, USER)],
      'POST /auth/logout': [
        () => {
          throw new TypeError('Failed to fetch');
        },
      ],
    });
    const store = new SessionStore({ baseUrl: BASE, fetch: api.fetch, now });
    await store.login('anna@example.test', 'pw-12345678');

    await store.logout();

    expect(store.getSnapshot()).toEqual({ status: 'anonymous', reason: 'signed-out' });
    expect(store.getAccessToken()).toBeNull();
    const logout = api.calls.find((c) => c.key === 'POST /auth/logout')!;
    expect(logout.init.credentials).toBe('include');
  });

  it('notifies subscribers of every change', async () => {
    const api = fakeApi({ 'POST /auth/refresh': [() => problem(401)] });
    const store = new SessionStore({ baseUrl: BASE, fetch: api.fetch, now });
    const seen: string[] = [];
    const unsubscribe = store.subscribe(() => seen.push(store.getSnapshot().status));

    await store.restore();
    unsubscribe();
    await store.logout().catch(() => {});

    expect(seen).toEqual(['restoring', 'anonymous']);
  });
});
