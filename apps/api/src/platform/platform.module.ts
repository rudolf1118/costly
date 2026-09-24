import { Module } from '@nestjs/common';
import { HealthController } from './health/health.controller';

/**
 * Shared infrastructure used by every domain module: configuration, logging,
 * health checks and, later, database and queue connections.
 */
@Module({
  controllers: [HealthController],
})
export class PlatformModule {}
