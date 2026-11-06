import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import cookieParser from 'cookie-parser';
import type { Env } from '../config/env.schema';

/**
 * HTTP settings that must be identical in production and in the e2e tests,
 * so main.ts and the test bootstrap both call this.
 */
export function configureHttp(app: INestApplication): void {
  const config = app.get<ConfigService<Env, true>>(ConfigService);
  // Parses the refresh cookie (ADR-0006).
  app.use(cookieParser());
  // The web client runs on its own origin. credentials: true lets it send and
  // receive the refresh cookie; only this one origin may do so.
  app.enableCors({ origin: config.get('CORS_ORIGIN', { infer: true }), credentials: true });
}
