import { Controller, Get, Inject } from '@nestjs/common';
import { HealthCheck, HealthCheckService, HealthIndicatorService } from '@nestjs/terminus';
import type { Redis } from 'ioredis';
import type { Pool } from 'pg';
import { PG_POOL } from '../database/database.module';
import { REDIS } from '../redis/redis.module';

const CHECK_TIMEOUT_MS = 1500;

@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly indicators: HealthIndicatorService,
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  /** Liveness: the process is running. Does not touch dependencies. */
  @Get('live')
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  /** Readiness: the API can serve requests. Returns 503 if a dependency is down. */
  @Get()
  @HealthCheck()
  ready() {
    return this.health.check([
      () =>
        this.indicators
          .check('database')
          .attempt(async () => {
            await this.pool.query('SELECT 1');
          })
          .withTimeout(CHECK_TIMEOUT_MS),
      () =>
        this.indicators
          .check('redis')
          .attempt(async () => {
            await this.redis.ping();
          })
          .withTimeout(CHECK_TIMEOUT_MS),
    ]);
  }
}
