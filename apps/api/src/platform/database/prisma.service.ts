import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import type { Env } from '../config/env.schema';
import { PrismaClient } from '../../generated/prisma/client';

/**
 * The database client every module queries through. Prisma 7 has no built-in
 * driver, so the connection pool comes from the PostgreSQL driver adapter.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor(config: ConfigService<Env, true>) {
    super({
      adapter: new PrismaPg({
        connectionString: config.get('DATABASE_URL', { infer: true }),
        max: 5,
        connectionTimeoutMillis: 2000,
      }),
    });
  }

  /**
   * Prisma connects on its first query, so this warms the pool during bootstrap
   * instead. The driver adapter's pool is lazy as well, so an unreachable
   * database does not stop the application from starting; readiness reports it.
   */
  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  /** Disconnecting also disposes the adapter, which ends its connection pool. */
  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
