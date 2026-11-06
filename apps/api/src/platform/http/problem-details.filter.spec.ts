import {
  type ArgumentsHost,
  BadRequestException,
  ConflictException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '../../generated/prisma/client';
import { ProblemDetailsFilter } from './problem-details.filter';
import { RequestValidationException } from './zod-validation.pipe';

/** The parts of an Express response the filter uses, recording what was sent. */
function capture() {
  const sent: { status?: number; type?: string; body?: unknown } = {};
  const response = {
    status(code: number) {
      sent.status = code;
      return response;
    },
    type(value: string) {
      sent.type = value;
      return response;
    },
    json(body: unknown) {
      sent.body = body;
      return response;
    },
  };
  const host = {
    switchToHttp: () => ({ getResponse: () => response }),
  } as unknown as ArgumentsHost;
  return { sent, host };
}

describe('ProblemDetailsFilter', () => {
  const filter = new ProblemDetailsFilter();

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('turns a standard HTTP exception into problem details', () => {
    const { sent, host } = capture();

    filter.catch(new ConflictException('An account with this email already exists.'), host);

    expect(sent).toEqual({
      status: 409,
      type: 'application/problem+json',
      body: {
        type: 'about:blank',
        title: 'Conflict',
        status: 409,
        detail: 'An account with this email already exists.',
      },
    });
  });

  it('omits a detail that would only repeat the title', () => {
    const { sent, host } = capture();

    filter.catch(new NotFoundException(), host);

    expect(sent.body).toEqual({ type: 'about:blank', title: 'Not Found', status: 404 });
  });

  it('lists the invalid fields of a rejected request', () => {
    const { sent, host } = capture();

    filter.catch(
      new RequestValidationException([{ path: 'email', message: 'Invalid email' }]),
      host,
    );

    expect(sent.status).toBe(400);
    expect(sent.body).toEqual({
      type: 'about:blank',
      title: 'Bad Request',
      status: 400,
      detail: 'The request body is invalid.',
      errors: [{ path: 'email', message: 'Invalid email' }],
    });
  });

  it('replaces a JSON parse error with a message that quotes nothing', () => {
    const { sent, host } = capture();
    // What Nest builds from body-parser's SyntaxError for an unquoted value.
    const parseError = new BadRequestException(
      `Unexpected token 'm', ..."assword": my-real-se"... is not valid JSON`,
    );

    filter.catch(parseError, host);

    expect(sent.body).toEqual({
      type: 'about:blank',
      title: 'Bad Request',
      status: 400,
      detail: 'The request body is not valid JSON.',
    });
  });

  it('keeps the message of other bad requests', () => {
    const { sent, host } = capture();

    filter.catch(new BadRequestException('Validation failed (uuid is expected)'), host);

    expect(sent.body).toMatchObject({ detail: 'Validation failed (uuid is expected)' });
  });

  it('keeps a body the thrower chose, as the health check does', () => {
    const { sent, host } = capture();
    const report = { status: 'error', info: {}, error: { redis: { status: 'down' } }, details: {} };

    filter.catch(new ServiceUnavailableException(report), host);

    expect(sent).toEqual({ status: 503, body: report });
  });

  it('answers an unknown error with a generic 500 and logs the cause', () => {
    const log = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const { sent, host } = capture();

    filter.catch(new Error('connect ECONNREFUSED 10.0.0.5:5432'), host);

    expect(sent.status).toBe(500);
    expect(sent.body).toEqual({ type: 'about:blank', title: 'Internal Server Error', status: 500 });
    expect(JSON.stringify(log.mock.calls)).toContain('ECONNREFUSED');
  });

  it('answers a body parser client error with its own status, unlogged', () => {
    const log = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const { sent, host } = capture();
    // The shape of an http-errors object, as raised by body-parser.
    const tooLarge = Object.assign(new Error('request entity too large'), {
      status: 413,
      expose: true,
      type: 'entity.too.large',
    });

    filter.catch(tooLarge, host);

    expect(sent.body).toEqual({ type: 'about:blank', title: 'Payload Too Large', status: 413 });
    expect(log).not.toHaveBeenCalled();
  });

  it('still treats an error marked as not exposable as a server error', () => {
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const { sent, host } = capture();

    filter.catch(Object.assign(new Error('internal'), { status: 400, expose: false }), host);

    expect(sent.status).toBe(500);
  });

  it('logs a Prisma error with its stack frames but never its message', () => {
    const log = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const { sent, host } = capture();
    const secret = '$argon2id$v=19$m=65536,t=3,p=4$secret-hash';

    filter.catch(
      new Prisma.PrismaClientValidationError(`Argument passwordHash: ${secret}`, {
        clientVersion: Prisma.prismaVersion.client,
      }),
      host,
    );

    expect(sent.status).toBe(500);
    const logged = JSON.stringify(log.mock.calls);
    expect(logged).toContain('PrismaClientValidationError');
    // Where the query came from is kept: the stack frames, not the message.
    expect(logged).toContain('problem-details.filter.spec.ts');
    expect(logged).not.toContain(secret);
    expect(JSON.stringify(sent.body)).not.toContain(secret);
  });
});
