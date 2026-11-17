import { describe, expect, it, type Mock, vi } from 'vitest';
import { z } from 'zod';
import { ApiError, createApiClient, type SessionHandler } from './api-client';

const BASE = 'http://api.test';
const thing = z.object({ id: z.string() });

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
const problem = (status: number, title: string, detail?: string) =>
  new Response(JSON.stringify({ type: 'about:blank', title, status, detail }), {
    status,
    headers: { 'Content-Type': 'application/problem+json' },
  });

/** A session whose token can be changed, and whose refresh is a spy. */
function fakeSession(initial: string | null, refreshed: Array<string | null> = ['fresh']) {
  let token = initial;
  const refresh = vi.fn(async () => {
    token = refreshed.shift() ?? null;
    return token;
  });
  const session: SessionHandler = { getAccessToken: () => token, refresh };
  return { session, refresh };
}

const authHeader = (fetchMock: Mock<typeof fetch>, call: number) =>
  (fetchMock.mock.calls[call]?.[1] as RequestInit).headers as Record<string, string>;

describe('createApiClient', () => {
  it('requests the path on the base URL and validates the body', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => json(200, { id: 'a1', extra: true }));
    const api = createApiClient({ baseUrl: BASE, fetch: fetchMock });

    const result = await api.request('/things/a1', { schema: thing, auth: false });

    expect(result).toEqual({ id: 'a1' });
    expect(fetchMock).toHaveBeenCalledWith(
      `${BASE}/things/a1`,
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('sends a JSON body, writing a bigint as its exact string', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => json(201, { id: 'a1' }));
    const api = createApiClient({ baseUrl: BASE, fetch: fetchMock });

    await api.request('/accounts', {
      method: 'POST',
      body: { openingBalance: 999_999_999_999_999n },
      schema: thing,
      auth: false,
    });

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.body).toBe('{"openingBalance":"999999999999999"}');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
  });

  it('passes credentials only when asked', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(null, { status: 204 }));
    const api = createApiClient({ baseUrl: BASE, fetch: fetchMock });

    await api.request('/auth/logout', { method: 'POST', auth: false, credentials: 'include' });
    await api.request('/health', { auth: false });

    expect((fetchMock.mock.calls[0]?.[1] as RequestInit).credentials).toBe('include');
    expect((fetchMock.mock.calls[1]?.[1] as RequestInit).credentials).toBe('same-origin');
  });

  it('sends the access token on authenticated requests', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => json(200, { id: 'a1' }));
    const { session, refresh } = fakeSession('token-1');
    const api = createApiClient({ baseUrl: BASE, session, fetch: fetchMock });

    await api.request('/things/a1', { schema: thing });

    expect(authHeader(fetchMock, 0).Authorization).toBe('Bearer token-1');
    expect(refresh).not.toHaveBeenCalled();
  });

  it('refreshes first when there is no token yet', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => json(200, { id: 'a1' }));
    const { session, refresh } = fakeSession(null, ['fresh']);
    const api = createApiClient({ baseUrl: BASE, session, fetch: fetchMock });

    await api.request('/things/a1', { schema: thing });

    expect(refresh).toHaveBeenCalledOnce();
    expect(authHeader(fetchMock, 0).Authorization).toBe('Bearer fresh');
  });

  it('refreshes once after a 401 and replays the request once', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(problem(401, 'Unauthorized'))
      .mockResolvedValueOnce(json(200, { id: 'a1' }));
    const { session, refresh } = fakeSession('expired', ['fresh']);
    const api = createApiClient({ baseUrl: BASE, session, fetch: fetchMock });

    await expect(api.request('/things/a1', { schema: thing })).resolves.toEqual({ id: 'a1' });

    expect(refresh).toHaveBeenCalledOnce();
    expect(authHeader(fetchMock, 1).Authorization).toBe('Bearer fresh');
  });

  it('does not loop when the replay is refused too', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => problem(401, 'Unauthorized'));
    const { session, refresh } = fakeSession('expired', ['fresh', 'fresher']);
    const api = createApiClient({ baseUrl: BASE, session, fetch: fetchMock });

    await expect(api.request('/things/a1', { schema: thing })).rejects.toMatchObject({
      kind: 'http',
      status: 401,
    });

    expect(refresh).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('fails with 401, without replaying, when the session has ended', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => problem(401, 'Unauthorized'));
    const { session } = fakeSession('expired', [null]);
    const api = createApiClient({ baseUrl: BASE, session, fetch: fetchMock });

    await expect(api.request('/things/a1')).rejects.toMatchObject({ status: 401 });

    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('merges concurrent refreshes into one', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let token: string | null = 'expired';
    const refresh = vi.fn(async () => {
      await gate;
      token = 'fresh';
      return token;
    });
    const fetchMock = vi.fn<typeof fetch>(async (_url, init) =>
      (init?.headers as Record<string, string>).Authorization === 'Bearer fresh'
        ? json(200, { id: 'a1' })
        : problem(401, 'Unauthorized'),
    );
    const api = createApiClient({
      baseUrl: BASE,
      session: { getAccessToken: () => token, refresh },
      fetch: fetchMock,
    });

    const calls = Promise.all([
      api.request('/a', { schema: thing }),
      api.request('/b', { schema: thing }),
      api.request('/c', { schema: thing }),
    ]);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    release();

    await expect(calls).resolves.toHaveLength(3);
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('never refreshes for an unauthenticated request', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      problem(401, 'Unauthorized', 'Invalid email or password.'),
    );
    const { session, refresh } = fakeSession('token-1');
    const api = createApiClient({ baseUrl: BASE, session, fetch: fetchMock });

    const error = await api
      .request('/auth/login', { method: 'POST', body: {}, auth: false })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).problem?.detail).toBe('Invalid email or password.');
    expect(refresh).not.toHaveBeenCalled();
    expect(authHeader(fetchMock, 0).Authorization).toBeUndefined();
  });

  it('turns an error status into an ApiError with the problem details', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      problem(409, 'Conflict', 'An account with this email already exists.'),
    );
    const api = createApiClient({ baseUrl: BASE, fetch: fetchMock });

    await expect(api.request('/auth/register', { auth: false })).rejects.toMatchObject({
      kind: 'http',
      status: 409,
      problem: { detail: 'An account with this email already exists.' },
    });
  });

  it('reports an unreachable API as a network error', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => {
      throw new TypeError('Failed to fetch');
    });
    const api = createApiClient({ baseUrl: BASE, fetch: fetchMock });

    await expect(api.request('/health', { auth: false })).rejects.toMatchObject({
      kind: 'network',
      status: 0,
    });
  });

  it('lets an aborted request reject with the abort, not a network error', async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn<typeof fetch>(async () => {
      controller.abort();
      throw new DOMException('aborted', 'AbortError');
    });
    const api = createApiClient({ baseUrl: BASE, fetch: fetchMock });

    await expect(
      api.request('/health', { auth: false, signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });

  it.each([
    ['a body of the wrong shape', json(200, { id: 42 })],
    ['a body that is not JSON', new Response('<html>', { status: 200 })],
  ])('rejects %s instead of passing it on', async (_case, response) => {
    const api = createApiClient({
      baseUrl: BASE,
      fetch: vi.fn<typeof fetch>(async () => response),
    });

    await expect(api.request('/things/a1', { schema: thing, auth: false })).rejects.toMatchObject({
      kind: 'invalid-response',
    });
  });

  it('lets a failure to refresh propagate, so the session is not ended by a network error', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => json(200, { id: 'a1' }));
    const api = createApiClient({
      baseUrl: BASE,
      session: {
        getAccessToken: () => null,
        refresh: () => Promise.reject(new ApiError('network', 0)),
      },
      fetch: fetchMock,
    });

    await expect(api.request('/things/a1')).rejects.toMatchObject({ kind: 'network' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('never puts a response body in an error message', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      problem(400, 'Bad Request', 'secret-detail-123'),
    );
    const api = createApiClient({ baseUrl: BASE, fetch: fetchMock });

    const error = (await api.request('/x', { auth: false }).catch((e: unknown) => e)) as ApiError;

    expect(error.message).not.toContain('secret-detail-123');
  });
});
