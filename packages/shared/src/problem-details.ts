import { z } from 'zod';

/**
 * An API error as `api-conventions.md` defines it: RFC 9457 problem details,
 * with an `errors` extension listing invalid fields on a 400.
 */
export interface ProblemDetails {
  type: string;
  title: string;
  /** Always the HTTP status of the response, whatever the body claims. */
  status: number;
  detail?: string;
  /** One entry per invalid field of a rejected request body. */
  errors?: FieldError[];
  /** From `Retry-After` on a 429: how many seconds to wait. */
  retryAfterSeconds?: number;
}

export interface FieldError {
  /** The field, as a dotted path such as `email` or `items.0.name`. */
  path: string;
  message: string;
}

/**
 * The parts of a fetch `Response` this module reads. Kept structural so the
 * package needs neither the DOM nor Node type definitions.
 */
export interface ResponseLike {
  status: number;
  statusText?: string;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}

const fieldErrorSchema = z.object({ path: z.string(), message: z.string() });

/** A member of the wrong type is dropped on its own; the others are kept. */
const optionalString = z.string().optional().catch(undefined);

/** Not strict: problem details may carry extension members. */
const problemSchema = z.object({
  type: optionalString,
  title: optionalString,
  detail: optionalString,
  errors: z.array(z.unknown()).optional().catch(undefined),
});

/** Bodies larger than this are never parsed; no API error body comes close. */
const MAX_BODY_LENGTH = 64 * 1024;

/**
 * Reads the error of a non-2xx response. Never throws: a body that isn't
 * problem details (a proxy's HTML page, an empty body, malformed JSON) gives
 * a generic problem for the response's status, so callers always have a
 * status and a title to show.
 *
 * The body is not required to be `application/problem+json`, because some
 * API errors are sent as plain JSON with the same shape. Fields are taken
 * only when they have the right type, and the body is never copied into the
 * result as a whole.
 */
export async function readProblem(response: ResponseLike): Promise<ProblemDetails> {
  const problem: ProblemDetails = {
    type: 'about:blank',
    title: response.statusText?.trim() || genericTitle(response.status),
    status: response.status,
  };

  const parsed = problemSchema.safeParse(await readJson(response));
  if (parsed.success) {
    const { type, title, detail, errors } = parsed.data;
    if (type) problem.type = type;
    if (title) problem.title = title;
    if (detail) problem.detail = detail;
    const fieldErrors = (errors ?? []).flatMap((entry) => {
      const field = fieldErrorSchema.safeParse(entry);
      return field.success ? [{ path: field.data.path, message: field.data.message }] : [];
    });
    if (fieldErrors.length > 0) problem.errors = fieldErrors;
  }

  if (response.status === 429) {
    const seconds = parseRetryAfter(response.headers.get('Retry-After'));
    if (seconds !== undefined) problem.retryAfterSeconds = seconds;
  }

  return problem;
}

async function readJson(response: ResponseLike): Promise<unknown> {
  let text: string;
  try {
    text = await response.text();
  } catch {
    return undefined;
  }
  if (text.length === 0 || text.length > MAX_BODY_LENGTH) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/** `Retry-After` as delta-seconds, which is what the API sends. HTTP dates are ignored. */
function parseRetryAfter(value: string | null): number | undefined {
  if (value === null || !/^[0-9]{1,9}$/.test(value.trim())) return undefined;
  return Number(value.trim());
}

function genericTitle(status: number): string {
  if (status >= 500) return 'Server error';
  if (status >= 400) return 'Request failed';
  return 'Unexpected response';
}
