import { ApiError } from '@costly/shared';

export interface FormError {
  /** Shown above the form, for what belongs to no single field. */
  message?: string;
  /** By field name, for what the API attributed to a field. */
  fields: Record<string, string>;
}

const UNREACHABLE = 'Costly can’t be reached right now. Check your connection and try again.';
const UNAVAILABLE = 'This service is temporarily unavailable. Try again in a moment.';
const UNEXPECTED = 'Something went wrong. Try again.';

function wait(seconds: number | undefined): string {
  if (seconds === undefined) return 'Try again later.';
  if (seconds < 60) return 'Try again in a minute.';
  const minutes = Math.ceil(seconds / 60);
  return `Try again in ${minutes} minutes.`;
}

/**
 * Turns a failed auth request into what the form shows. Each status gets a
 * message written for people; the API's own detail is used only where it
 * is meant for them (a 409 or a field error).
 *
 * `fieldNames` are the form's fields: a field error for any other path, or
 * for the whole body (path ""), becomes a form-level message.
 */
export function toFormError(
  error: unknown,
  fieldNames: readonly string[],
  messages: { unauthorized?: string; conflict?: { field: string; message: string } } = {},
): FormError {
  if (!(error instanceof ApiError)) return { message: UNEXPECTED, fields: {} };
  if (error.kind === 'network') return { message: UNREACHABLE, fields: {} };
  if (error.kind === 'invalid-response') return { message: UNEXPECTED, fields: {} };

  switch (error.status) {
    case 400: {
      const fields: Record<string, string> = {};
      const other: string[] = [];
      for (const issue of error.problem?.errors ?? []) {
        if (fieldNames.includes(issue.path)) fields[issue.path] ??= issue.message;
        else other.push(issue.message);
      }
      return {
        fields,
        ...(other.length > 0 || Object.keys(fields).length === 0
          ? { message: other[0] ?? 'Check the highlighted details and try again.' }
          : {}),
      };
    }
    case 401:
      return { message: messages.unauthorized ?? UNEXPECTED, fields: {} };
    case 409:
      return messages.conflict
        ? { fields: { [messages.conflict.field]: messages.conflict.message } }
        : { message: error.problem?.detail ?? UNEXPECTED, fields: {} };
    case 429:
      return {
        message: `Too many attempts. ${wait(error.problem?.retryAfterSeconds)}`,
        fields: {},
      };
    case 503:
      return { message: UNAVAILABLE, fields: {} };
    default:
      return { message: UNEXPECTED, fields: {} };
  }
}
