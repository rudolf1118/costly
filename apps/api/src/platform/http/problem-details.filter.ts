import { STATUS_CODES } from 'node:http';
import {
  type ArgumentsHost,
  BadRequestException,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import { RequestValidationException, type ValidationIssue } from './zod-validation.pipe';

/** An error response body as defined by RFC 9457 (which obsoletes RFC 7807). */
export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail?: string;
  /** Extension member: one entry per invalid field of a rejected request. */
  errors?: ValidationIssue[];
}

/**
 * Turns every error that leaves a controller into an RFC 9457 response, so
 * clients get one error format and nothing internal leaks:
 *
 * - Nest's standard HTTP exceptions become problem details;
 * - an HttpException thrown with its own object body keeps that body, which
 *   is how the Terminus health report is returned on 503;
 * - anything else is a 500 whose cause is logged, never sent.
 */
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemDetailsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    if (exception instanceof HttpException) {
      const body = exception.getResponse();
      if (isCustomBody(body) && !(exception instanceof RequestValidationException)) {
        response.status(exception.getStatus()).json(body);
        return;
      }
      if (exception.getStatus() >= 500) {
        this.logger.error({ msg: 'request failed', error: describeForLog(exception) });
      }
      send(response, toProblem(exception));
      return;
    }

    const clientStatus = exposedClientErrorStatus(exception);
    if (clientStatus !== undefined) {
      send(response, problem(clientStatus));
      return;
    }

    this.logger.error({ msg: 'unhandled exception', error: describeForLog(exception) });
    send(response, problem(HttpStatus.INTERNAL_SERVER_ERROR));
  }
}

/**
 * The body parser rejects some requests itself: too large (413), an
 * unsupported charset or content encoding (415), a body it cannot decode
 * (400). It raises http-errors objects, not HttpExceptions, and marks client
 * errors with expose: true. Only the status is used, because the messages
 * repeat request header values.
 */
function exposedClientErrorStatus(error: unknown): number | undefined {
  if (!(error instanceof Error)) return undefined;
  const { status, expose } = error as { status?: unknown; expose?: unknown };
  const isClientError = typeof status === 'number' && status >= 400 && status < 500;
  return expose === true && isClientError ? status : undefined;
}

function send(response: Response, body: ProblemDetails): void {
  response.status(body.status).type('application/problem+json').json(body);
}

function problem(status: number, detail?: string): ProblemDetails {
  return {
    type: 'about:blank',
    title: STATUS_CODES[status] ?? 'Error',
    status,
    ...(detail ? { detail } : {}),
  };
}

function toProblem(exception: HttpException): ProblemDetails {
  const status = exception.getStatus();
  if (exception instanceof RequestValidationException) {
    return { ...problem(status, exception.message), errors: exception.errors };
  }
  if (isJsonParseFailure(exception)) {
    return problem(status, 'The request body is not valid JSON.');
  }
  const body = exception.getResponse();
  const message = typeof body === 'string' ? body : (body as { message?: unknown }).message;
  // A detail that only repeats the title says nothing; arrays are not ours.
  const detail =
    typeof message === 'string' && message !== STATUS_CODES[status] ? message : undefined;
  return problem(status, detail);
}

/**
 * Nest turns the JSON body parser's SyntaxError into a plain
 * BadRequestException carrying V8's message, and that message can quote the
 * raw body around the error ("...assword": my-real-se..."), credentials
 * included. V8's JSON errors always mention JSON, which is what identifies them.
 */
function isJsonParseFailure(exception: HttpException): boolean {
  // Exactly BadRequestException: subclasses such as RequestValidationException are ours.
  const isPlainBadRequest = Object.getPrototypeOf(exception) === BadRequestException.prototype;
  return isPlainBadRequest && /\bJSON\b/.test(exception.message);
}

/** Nest's own error bodies always carry statusCode and message; anything else was chosen by the thrower. */
function isCustomBody(body: string | object): boolean {
  return typeof body === 'object' && !('statusCode' in body && 'message' in body);
}

/**
 * Prisma validation errors render the query arguments into their message
 * (a password hash, for example), whatever errorFormat is set. For Prisma
 * errors the message is dropped: the class, the code and the stack frames
 * (where the failing query was issued) are logged, the stack's first lines,
 * which repeat the message, are not.
 */
export function describeForLog(error: unknown): Record<string, unknown> {
  if (!(error instanceof Error)) return { type: typeof error };
  if (error.name.startsWith('PrismaClient')) {
    return {
      type: error.name,
      code: (error as { code?: unknown }).code,
      stack: stackFrames(error.stack),
    };
  }
  return { type: error.name, message: error.message, stack: error.stack };
}

/** The "    at ..." lines of a stack trace, without the message before them. */
function stackFrames(stack: string | undefined): string | undefined {
  const start = stack?.indexOf('\n    at ') ?? -1;
  return start === -1 ? undefined : stack?.slice(start + 1);
}
