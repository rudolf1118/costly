import type { INestApplication } from '@nestjs/common';
import type { Express } from 'express';
import { ConfigService } from '@nestjs/config';
import cookieParser from 'cookie-parser';
import type { Env } from '../config/env.schema';

/**
 * HTTP settings that must be identical in production and in the e2e tests,
 * so main.ts and the test bootstrap both call this.
 */
export function configureHttp(app: INestApplication): void {
  const config = app.get<ConfigService<Env, true>>(ConfigService);
  // req.ip, used for rate limiting, believes X-Forwarded-For only for this many
  // proxy hops. 0 means the header is ignored: it is client-controlled.
  const hops = config.get('TRUST_PROXY', { infer: true });
  const express = app.getHttpAdapter().getInstance() as Express;
  express.set('trust proxy', hops > 0 ? hops : false);
  // Parses the refresh cookie (ADR-0006).
  app.use(cookieParser());
  // The web client runs on its own origin. credentials: true lets it send and
  // receive the refresh cookie; only this one origin may do so.
  app.enableCors({ origin: config.get('CORS_ORIGIN', { infer: true }), credentials: true });
}
