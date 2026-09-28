import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import type { Env } from './platform/config/env.schema';

async function bootstrap(): Promise<void> {
  // Buffer startup logs until the pino logger is ready, so they share one format.
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  // Lets the process finish in-flight requests and close connections on SIGTERM.
  app.enableShutdownHooks();

  const config = app.get<ConfigService<Env, true>>(ConfigService);
  // The web client runs on its own origin (Vite in development, a static host later).
  app.enableCors({ origin: config.get('CORS_ORIGIN', { infer: true }) });

  await app.listen(config.get('PORT', { infer: true }));
}

void bootstrap();
