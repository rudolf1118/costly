import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER } from '@nestjs/core';
import { TerminusModule } from '@nestjs/terminus';
import { validateEnv } from './config/env.schema';
import { DatabaseModule } from './database/database.module';
import { HealthController } from './health/health.controller';
import { ProblemDetailsFilter } from './http/problem-details.filter';
import { LoggingModule } from './logging/logging.module';
import { RateLimitModule } from './rate-limit/rate-limit.module';
import { RedisModule } from './redis/redis.module';

/**
 * Shared infrastructure used by every domain module: configuration, logging,
 * database and Redis connections, health checks and the HTTP error format.
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, cache: true, validate: validateEnv }),
    LoggingModule,
    DatabaseModule,
    RedisModule,
    RateLimitModule,
    TerminusModule.forRoot({ logger: false }),
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_FILTER, useClass: ProblemDetailsFilter }],
  exports: [DatabaseModule, RedisModule],
})
export class PlatformModule {}
