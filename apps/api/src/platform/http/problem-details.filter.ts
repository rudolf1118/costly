import { STATUS_CODES } from 'node:http';
import {
  type ArgumentsHost,
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

    this.logger.error({ msg: 'unhandled exception', error: describeForLog(exception) });
    send(response, problem(HttpStatus.INTERNAL_SERVER_ERROR));
  }
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
  const body = exception.getResponse();
  const message = typeof body === 'string' ? body : (body as { message?: unknown }).message;
  // A detail that only repeats the title says nothing; arrays are not ours.
  const detail =
    typeof message === 'string' && message !== STATUS_CODES[status] ? message : undefined;
  return problem(status, detail);
}

/** Nest's own error bodies always carry statusCode and message; anything else was chosen by the thrower. */
function isCustomBody(body: string | object): boolean {
  return typeof body === 'object' && !('statusCode' in body && 'message' in body);
}

/**
 * Prisma validation errors render the query arguments into their message
 * (a password hash, for example), whatever errorFormat is set, so for Prisma
 * errors only the class and code are logged.
 */
export function describeForLog(error: unknown): Record<string, unknown> {
  if (!(error instanceof Error)) return { type: typeof error };
  if (error.name.startsWith('PrismaClient')) {
    return { type: error.name, code: (error as { code?: unknown }).code };
  }
  return { type: error.name, message: error.message, stack: error.stack };
}
