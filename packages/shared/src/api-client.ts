import type { z } from 'zod';
import { type ProblemDetails, readProblem } from './problem-details';

/**
 * How a client keeps its session. The access token lives in memory; how the
 * refresh credential travels is platform-specific (a cookie on the web, a
 * body field on native), so each client supplies `refresh`.
 */
export interface SessionHandler {
  /** The current access token, or null when there is none or it has expired. */
  getAccessToken(): string | null;
  /**
   * Exchanges the refresh credential for a new access token. Resolves to the
   * new token, or null when the session has ended (the API refused it).
   * Rejects only for failures that say nothing about the session, such as
   * the network being down.
   */
  refresh(): Promise<string | null>;
}

export type ApiErrorKind =
  /** The API answered with an error status. */
  | 'http'
  /** No answer: offline, DNS, CORS, connection refused. */
  | 'network'
  /** An answer whose body doesn't have the expected shape. */
  | 'invalid-response';

/**
 * Every failure of an API call. Messages never contain request or response
 * bodies, tokens or amounts, so an error can be logged or shown safely.
 */
export class ApiError extends Error {
  override readonly name = 'ApiError';

  constructor(
    readonly kind: ApiErrorKind,
    /** The HTTP status, or 0 when there was no answer. */
    readonly status: number,
    /** The API's problem details, for `http` errors. */
    readonly problem?: ProblemDetails,
  ) {
    super(
      kind === 'http'
        ? `The API answered ${status}${problem?.title ? ` ${problem.title}` : ''}.`
        : kind === 'network'
          ? 'The API could not be reached.'
          : 'The API answered with an unexpected response.',
    );
  }
}

export interface RequestOptions<T> {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  /** Serialized as JSON. A `bigint` is written as its exact decimal string. */
  body?: unknown;
  /** Validates and types the response body. Omit for responses without one. */
  schema?: z.ZodType<T>;
  /** Send the access token, and refresh it once on a 401. Default `true`. */
  auth?: boolean;
  /** Send cookies cross-origin. Only the refresh-cookie endpoints need it. */
  credentials?: RequestCredentials;
  signal?: AbortSignal;
}

export interface ApiClient {
  request<T = undefined>(path: string, options?: RequestOptions<T>): Promise<T>;
}

export interface ApiClientOptions {
  /** Such as `http://localhost:3100`, without a trailing slash. */
  baseUrl: string;
  session?: SessionHandler;
  fetch?: typeof fetch;
}

const bigintAsString = (_key: string, value: unknown) =>
  typeof value === 'bigint' ? value.toString() : value;

/**
 * The one way Costly's clients talk to the API (ADR-0010).
 *
 * - Every non-2xx answer becomes an `ApiError` carrying the problem details.
 * - Every response body is validated against its schema, so a drifted
 *   contract shows as an error, never as a wrong figure.
 * - Authenticated requests carry the access token. Without one, or after a
 *   401, the session is refreshed once and the request replayed once.
 *   Concurrent refreshes are merged into one, because the API accepts each
 *   refresh token only once (ADR-0006).
 */
export function createApiClient({
  baseUrl,
  session,
  fetch: fetchImpl = (...args) => globalThis.fetch(...args),
}: ApiClientOptions): ApiClient {
  let refreshing: Promise<string | null> | null = null;

  function refreshOnce(): Promise<string | null> {
    if (!session) return Promise.resolve(null);
    refreshing ??= session.refresh().finally(() => {
      refreshing = null;
    });
    return refreshing;
  }

  async function send(path: string, options: RequestOptions<unknown>, token: string | null) {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = `Bearer ${token}`;
    try {
      return await fetchImpl(`${baseUrl}${path}`, {
        method: options.method ?? 'GET',
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body, bigintAsString),
        credentials: options.credentials ?? 'same-origin',
        signal: options.signal,
      });
    } catch (error) {
      if (options.signal?.aborted) throw error;
      throw new ApiError('network', 0);
    }
  }

  async function request<T>(path: string, options: RequestOptions<T> = {}): Promise<T> {
    const authenticated = options.auth ?? true;
    let token: string | null = null;

    if (authenticated) {
      token = session?.getAccessToken() ?? null;
      if (!token) token = await refreshOnce();
      if (!token) throw new ApiError('http', 401);
    }

    let response = await send(path, options, token);

    if (authenticated && response.status === 401) {
      const fresh = await refreshOnce();
      if (!fresh) throw new ApiError('http', 401, await readProblem(response));
      response = await send(path, options, fresh);
    }

    if (!response.ok) {
      throw new ApiError('http', response.status, await readProblem(response));
    }
    return parseBody(response, options.schema);
  }

  return { request };
}

async function parseBody<T>(response: Response, schema: z.ZodType<T> | undefined): Promise<T> {
  if (!schema) return undefined as T;
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new ApiError('invalid-response', response.status);
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new ApiError('invalid-response', response.status);
  return parsed.data;
}
