import { describe, expect, it } from 'vitest';
import { readProblem, type ResponseLike } from './problem-details';

function response(
  status: number,
  body: string,
  headers: Record<string, string> = {},
  statusText = '',
): ResponseLike {
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    status,
    statusText,
    headers: { get: (name) => lower[name.toLowerCase()] ?? null },
    text: () => Promise.resolve(body),
  };
}

const json = (value: unknown) => JSON.stringify(value);

describe('readProblem', () => {
  it('reads a conflict with its detail', async () => {
    const problem = await readProblem(
      response(
        409,
        json({
          type: 'about:blank',
          title: 'Conflict',
          status: 409,
          detail: 'An account with this email already exists.',
        }),
      ),
    );

    expect(problem).toEqual({
      type: 'about:blank',
      title: 'Conflict',
      status: 409,
      detail: 'An account with this email already exists.',
    });
  });

  it('reads the field errors of a rejected body', async () => {
    const problem = await readProblem(
      response(
        400,
        json({
          type: 'about:blank',
          title: 'Bad Request',
          status: 400,
          detail: 'The request body is invalid.',
          errors: [
            { path: 'email', message: 'Invalid email address' },
            { path: 'openingBalance', message: 'Must be a string of minor units' },
          ],
        }),
      ),
    );

    expect(problem.errors).toEqual([
      { path: 'email', message: 'Invalid email address' },
      { path: 'openingBalance', message: 'Must be a string of minor units' },
    ]);
  });

  it('keeps only well-formed field errors and drops their extra members', async () => {
    const problem = await readProblem(
      response(
        400,
        json({
          title: 'Bad Request',
          errors: [{ path: 'name', message: 'Must not be empty', code: 'x' }, { path: 3 }, 'oops'],
        }),
      ),
    );

    expect(problem.errors).toEqual([{ path: 'name', message: 'Must not be empty' }]);
  });

  it('omits errors when none are usable', async () => {
    const problem = await readProblem(response(400, json({ title: 'Bad Request', errors: [] })));

    expect(problem).not.toHaveProperty('errors');
  });

  it('reads Retry-After in seconds on a 429', async () => {
    const problem = await readProblem(
      response(
        429,
        json({ title: 'Too Many Requests', detail: 'Too many requests. Try again later.' }),
        { 'Retry-After': '840' },
      ),
    );

    expect(problem).toMatchObject({ status: 429, retryAfterSeconds: 840 });
  });

  it.each([
    ['an HTTP date', 'Wed, 21 Oct 2026 07:28:00 GMT'],
    ['a negative number', '-5'],
    ['a decimal', '1.5'],
    ['nothing', undefined],
  ])('ignores a Retry-After with %s', async (_case, value) => {
    const headers: Record<string, string> = value === undefined ? {} : { 'Retry-After': value };
    const problem = await readProblem(response(429, '', headers));

    expect(problem).not.toHaveProperty('retryAfterSeconds');
  });

  it('ignores Retry-After on other statuses', async () => {
    const problem = await readProblem(response(503, '', { 'Retry-After': '30' }));

    expect(problem).not.toHaveProperty('retryAfterSeconds');
  });

  it('trusts the response status over the body', async () => {
    const problem = await readProblem(response(404, json({ title: 'Not Found', status: 200 })));

    expect(problem.status).toBe(404);
  });

  it.each([
    ['an empty body', ''],
    ['an HTML error page', '<html><body>502 Bad Gateway</body></html>'],
    ['malformed JSON', '{"title": '],
    ['a JSON array', '[1, 2]'],
    ['a JSON string', '"boom"'],
    ['null', 'null'],
  ])('falls back to a generic problem for %s', async (_case, body) => {
    const problem = await readProblem(response(502, body, {}, 'Bad Gateway'));

    expect(problem).toEqual({ type: 'about:blank', title: 'Bad Gateway', status: 502 });
  });

  it('ignores members of the wrong type', async () => {
    const problem = await readProblem(
      response(500, json({ title: 42, detail: ['x'], type: null }), {}, 'Internal Server Error'),
    );

    expect(problem).toEqual({ type: 'about:blank', title: 'Internal Server Error', status: 500 });
  });

  it('keeps the well-typed members when another member is malformed', async () => {
    const problem = await readProblem(
      response(409, json({ title: 'Conflict', detail: 'Name taken.', errors: 'nope', type: 7 })),
    );

    expect(problem).toEqual({
      type: 'about:blank',
      title: 'Conflict',
      status: 409,
      detail: 'Name taken.',
    });
  });

  it('gives a title even when the response has no status text', async () => {
    expect((await readProblem(response(503, ''))).title).toBe('Server error');
    expect((await readProblem(response(404, ''))).title).toBe('Request failed');
  });

  it('survives a body that cannot be read', async () => {
    const broken: ResponseLike = {
      status: 500,
      headers: { get: () => null },
      text: () => Promise.reject(new Error('stream aborted')),
    };

    await expect(readProblem(broken)).resolves.toEqual({
      type: 'about:blank',
      title: 'Server error',
      status: 500,
    });
  });

  it('does not parse an oversized body', async () => {
    const huge = json({ title: 'Conflict', detail: 'x'.repeat(70_000) });
    const problem = await readProblem(response(409, huge, {}, 'Conflict'));

    expect(problem).toEqual({ type: 'about:blank', title: 'Conflict', status: 409 });
  });
});
