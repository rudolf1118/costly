import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TerminusModule } from '@nestjs/terminus';
import { validateEnv } from './config/env.schema';
import { DatabaseModule } from './database/database.module';
import { HealthController } from './health/health.controller';
import { LoggingModule } from './logging/logging.module';
import { RedisModule } from './redis/redis.module';

/**
 * Shared infrastructure used by every domain module: configuration, logging,
 * database and Redis connections, and health checks.
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, cache: true, validate: validateEnv }),
    LoggingModule,
    DatabaseModule,
    RedisModule,
    TerminusModule.forRoot({ logger: false }),
  ],
  controllers: [HealthController],
  exports: [DatabaseModule, RedisModule],
})
export class PlatformModule {}
