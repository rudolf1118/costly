import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnv } from './config/env.schema';
import { HealthController } from './health/health.controller';
import { LoggingModule } from './logging/logging.module';

/**
 * Shared infrastructure used by every domain module: configuration, logging,
 * health checks and, later, database and queue connections.
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, cache: true, validate: validateEnv }),
    LoggingModule,
  ],
  controllers: [HealthController],
})
export class PlatformModule {}
