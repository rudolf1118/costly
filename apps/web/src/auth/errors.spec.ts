import { ApiError } from '@costly/shared';
import { describe, expect, it } from 'vitest';
import { toFormError } from './errors';

const http = (status: number, problem: Partial<ApiError['problem']> = {}) =>
  new ApiError('http', status, { type: 'about:blank', title: 'x', status, ...problem });

const FIELDS = ['email', 'password'] as const;

describe('toFormError', () => {
  it('attributes field errors to their fields', () => {
    const error = http(400, {
      errors: [
        { path: 'email', message: 'Invalid email address' },
        { path: 'password', message: 'Must be at least 8 characters' },
      ],
    });

    expect(toFormError(error, FIELDS)).toEqual({
      fields: { email: 'Invalid email address', password: 'Must be at least 8 characters' },
    });
  });

  it('shows errors for the whole body, or unknown fields, above the form', () => {
    const error = http(400, {
      errors: [
        { path: '', message: 'Unrecognized key: "extra"' },
        { path: 'email', message: 'Invalid email address' },
      ],
    });

    expect(toFormError(error, FIELDS)).toEqual({
      message: 'Unrecognized key: "extra"',
      fields: { email: 'Invalid email address' },
    });
  });

  it('gives a 400 without field errors a general message', () => {
    expect(
      toFormError(http(400, { detail: 'The request body is not valid JSON.' }), FIELDS),
    ).toMatchObject({ message: 'Check the highlighted details and try again.' });
  });

  it('uses the caller’s wording for a 401', () => {
    expect(
      toFormError(http(401), FIELDS, { unauthorized: 'Email or password is incorrect.' }),
    ).toEqual({ message: 'Email or password is incorrect.', fields: {} });
  });

  it('puts a 409 on the field the caller names', () => {
    expect(
      toFormError(http(409), FIELDS, {
        conflict: { field: 'email', message: 'An account with this email already exists.' },
      }),
    ).toEqual({ fields: { email: 'An account with this email already exists.' } });
  });

  it.each([
    [30, 'Too many attempts. Try again in a minute.'],
    [60, 'Too many attempts. Try again in a minute.'],
    [840, 'Too many attempts. Try again in 14 minutes.'],
    [undefined, 'Too many attempts. Try again later.'],
  ])('says how long to wait after a 429 (Retry-After %s)', (seconds, message) => {
    const problem = seconds === undefined ? {} : { retryAfterSeconds: seconds };

    expect(toFormError(http(429, problem), FIELDS).message).toBe(message);
  });

  it.each([
    ['an unreachable API', new ApiError('network', 0), /can’t be reached/],
    ['a 503', http(503), /temporarily unavailable/],
    ['an unexpected status', http(500), /Something went wrong/],
    ['a malformed response', new ApiError('invalid-response', 200), /Something went wrong/],
    ['something that is not an ApiError', new Error('boom'), /Something went wrong/],
  ])('explains %s without technical detail', (_case, error, message) => {
    expect(toFormError(error, FIELDS).message).toMatch(message);
  });
});
