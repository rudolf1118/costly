import { Writable } from 'node:stream';
import pino from 'pino';
import { describe, expect, it } from 'vitest';
import { LOG_REDACT_PATHS } from './logging.module';

/** Logs one line with the production redaction rules and returns it. */
function logLine(fields: object): string {
  let output = '';
  const sink = new Writable({
    write(chunk, _encoding, done) {
      output += String(chunk);
      done();
    },
  });
  pino({ redact: LOG_REDACT_PATHS }, sink).info(fields, 'request completed');
  return output;
}

describe('request log redaction', () => {
  // The shape pino-http's serializers produce for a login and a refresh.
  const line = logLine({
    req: {
      url: '/auth/refresh',
      headers: {
        authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.access.token',
        cookie: 'costly_refresh=client-sent-refresh-token',
        'user-agent': 'curl/8',
      },
    },
    res: {
      statusCode: 200,
      headers: {
        'set-cookie': 'costly_refresh=server-set-refresh-token; Path=/auth; HttpOnly',
        'content-type': 'application/json',
      },
    },
  });

  it.each([
    ['the access token', 'eyJhbGciOiJIUzI1NiJ9.access.token'],
    ['the refresh token the client sends', 'client-sent-refresh-token'],
    ['the refresh token the server sets', 'server-set-refresh-token'],
  ])('never writes %s', (_what, secret) => {
    expect(line).not.toContain(secret);
  });

  it('redacts Set-Cookie when the response sets several cookies', () => {
    const multiple = logLine({
      res: {
        headers: {
          'set-cookie': ['costly_refresh=first-secret; Path=/auth', 'other=second-secret'],
        },
      },
    });

    expect(multiple).not.toContain('first-secret');
    expect(multiple).not.toContain('second-secret');
  });

  it('keeps the rest of the request and response for diagnosis', () => {
    expect(line).toContain('curl/8');
    expect(line).toContain('application/json');
    expect(line).toContain('/auth/refresh');
  });
});
