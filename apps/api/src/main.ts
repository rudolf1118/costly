import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import type { Env } from './platform/config/env.schema';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  // Lets the process finish in-flight requests and close connections on SIGTERM.
  app.enableShutdownHooks();

  const config = app.get<ConfigService<Env, true>>(ConfigService);
  await app.listen(config.get('PORT', { infer: true }));
}

void bootstrap();
