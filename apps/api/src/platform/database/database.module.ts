import { Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import type { Env } from '../config/env.schema';
import { PrismaService } from './prisma.service';

export const PG_POOL = Symbol('PG_POOL');

/**
 * Database access for the whole application. The health check still runs on the
 * raw pool; everything else goes through Prisma.
 */
@Module({
  providers: [
    PrismaService,
    {
      provide: PG_POOL,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        new Pool({
          connectionString: config.get('DATABASE_URL', { infer: true }),
          max: 5,
          connectionTimeoutMillis: 2000,
        }),
    },
  ],
  exports: [PrismaService, PG_POOL],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}
