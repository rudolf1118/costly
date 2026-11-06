import { Controller, Get, Inject } from '@nestjs/common';
import { HealthCheck, HealthCheckService, HealthIndicatorService } from '@nestjs/terminus';
import type { Redis } from 'ioredis';
import { PrismaService } from '../database/prisma.service';
import { REDIS } from '../redis/redis.module';

const CHECK_TIMEOUT_MS = 1500;

/**
 * Prisma 7 driver-adapter errors keep the cause in `code` (ECONNREFUSED,
 * 28P01, ...) and leave the message empty, so readiness would report a failure
 * without saying why. Only the code is exposed, never connection details.
 */
function databaseFailure(error: unknown): Error {
  const code =
    typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '';
  return new Error(code ? `database query failed (${code})` : 'database query failed');
}

@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly indicators: HealthIndicatorService,
    private readonly prisma: PrismaService,
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
            try {
              await this.prisma.$queryRaw`SELECT 1`;
            } catch (error) {
              throw databaseFailure(error);
            }
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
