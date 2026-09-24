import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnv } from './config/env.schema';
import { HealthController } from './health/health.controller';

/**
 * Shared infrastructure used by every domain module: configuration, logging,
 * health checks and, later, database and queue connections.
 */
@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true, cache: true, validate: validateEnv })],
  controllers: [HealthController],
})
export class PlatformModule {}
