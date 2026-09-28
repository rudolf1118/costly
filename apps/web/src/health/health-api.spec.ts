import { describe, expect, it, vi } from 'vitest';
import { fetchHealth } from './health-api';

const API = 'http://localhost:3100';

const upReport = {
  status: 'ok',
  info: { database: { status: 'up' }, redis: { status: 'up' } },
  error: {},
  details: { database: { status: 'up' }, redis: { status: 'up' } },
};

const downReport = {
  status: 'error',
  info: { database: { status: 'up' } },
  error: { redis: { status: 'down', message: 'connect ECONNREFUSED' } },
  details: { database: { status: 'up' }, redis: { status: 'down' } },
};

function respondWith(status: number, body: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(body), { status })),
  );
}

describe('fetchHealth', () => {
  it('requests the health endpoint of the configured API', async () => {
    respondWith(200, upReport);

    await fetchHealth(API);

    expect(fetch).toHaveBeenCalledWith(`${API}/health`, { signal: undefined });
  });

  it('reports healthy when every dependency is up', async () => {
    respondWith(200, upReport);

    const result = await fetchHealth(API);

    expect(result).toEqual({ state: 'healthy', report: upReport });
  });

  it('reports degraded when the API answers 503', async () => {
    respondWith(503, downReport);

    const result = await fetchHealth(API);

    expect(result).toEqual({ state: 'degraded', report: downReport });
  });

  it('reports unreachable when the request fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );

    expect(await fetchHealth(API)).toEqual({
      state: 'unreachable',
      reason: 'Failed to fetch',
    });
  });

  it('reports unreachable on a status the API never returns', async () => {
    respondWith(502, '<html>bad gateway</html>');

    expect(await fetchHealth(API)).toEqual({
      state: 'unreachable',
      reason: 'the API answered with HTTP 502',
    });
  });

  it('reports unreachable when the body is not a health report', async () => {
    respondWith(200, { hello: 'world' });

    expect(await fetchHealth(API)).toEqual({
      state: 'unreachable',
      reason: 'the API response was not a health report',
    });
  });
});
