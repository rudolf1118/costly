import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import type { Env } from '../config/env.schema';

const REQUEST_ID_HEADER = 'x-request-id';

/**
 * Headers that carry credentials, removed from every request log line:
 * access tokens (Authorization), the refresh cookie the client sends
 * (Cookie) and the one the API sets (Set-Cookie, ADR-0006).
 */
export const LOG_REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
];

/**
 * Structured JSON logs (pretty-printed in development). Every request gets a
 * request id, taken from the incoming x-request-id header or generated, so a
 * request can be followed across log lines and, later, into background jobs.
 */
@Module({
  imports: [
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => {
        const nodeEnv = config.get('NODE_ENV', { infer: true });
        return {
          pinoHttp: {
            level: nodeEnv === 'test' ? 'silent' : config.get('LOG_LEVEL', { infer: true }),
            genReqId: (req: IncomingMessage) => {
              const incoming = req.headers[REQUEST_ID_HEADER];
              return typeof incoming === 'string' && incoming.length > 0 ? incoming : randomUUID();
            },
            autoLogging: {
              ignore: (req: IncomingMessage) => req.url?.startsWith('/health') ?? false,
            },
            redact: LOG_REDACT_PATHS,
            transport:
              nodeEnv === 'development'
                ? { target: 'pino-pretty', options: { singleLine: true } }
                : undefined,
          },
        };
      },
    }),
  ],
})
export class LoggingModule {}
