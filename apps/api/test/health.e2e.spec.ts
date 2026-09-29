import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const run = promisify(execFile);

/**
 * Brings the throwaway database up to the committed schema. Tests must never
 * call `migrate dev`, which is interactive and writes new migration files.
 */
async function applyMigrations(databaseUrl: string): Promise<void> {
  await run('prisma', ['migrate', 'deploy'], {
    cwd: resolve(__dirname, '..'),
    env: { ...process.env, DATABASE_URL: databaseUrl },
  });
}

describe('health endpoints', () => {
  let postgres: StartedPostgreSqlContainer;
  let redis: StartedRedisContainer;
  let app: INestApplication;

  beforeAll(async () => {
    [postgres, redis] = await Promise.all([
      new PostgreSqlContainer('postgres:18-alpine').start(),
      new RedisContainer('redis:8-alpine').start(),
    ]);
    process.env.DATABASE_URL = postgres.getConnectionUri();
    process.env.REDIS_URL = redis.getConnectionUrl();
    await applyMigrations(process.env.DATABASE_URL);

    // Imported only after the URLs are set: ConfigModule.forRoot() validates the
    // environment when the module file is loaded, not when the app starts.
    const { AppModule } = await import('../src/app.module');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    // Closing the app disconnects Prisma and Redis; both containers may already
    // be stopped by the outage tests below.
    await app?.close();
    await Promise.all([
      postgres?.stop().catch(() => undefined),
      redis?.stop().catch(() => undefined),
    ]);
  });

  it('GET /health/live responds without checking dependencies', async () => {
    await request(app.getHttpServer()).get('/health/live').expect(200, { status: 'ok' });
  });

  it('GET /health reports database and Redis as up', async () => {
    const res = await request(app.getHttpServer()).get('/health').expect(200);

    expect(res.body.status).toBe('ok');
    expect(res.body.info.database.status).toBe('up');
    expect(res.body.info.redis.status).toBe('up');
  });

  // The remaining tests stop a container, so they run last. Redis goes before
  // PostgreSQL because it still expects the database to be up.
  it('GET /health returns 503 when Redis is unavailable', async () => {
    await redis.stop();

    const res = await request(app.getHttpServer()).get('/health').expect(503);

    expect(res.body.status).toBe('error');
    expect(res.body.error.redis.status).toBe('down');
    expect(res.body.info.database.status).toBe('up');
  });

  it('GET /health returns 503 when PostgreSQL is unavailable', async () => {
    await postgres.stop();

    const res = await request(app.getHttpServer()).get('/health').expect(503);

    expect(res.body.status).toBe('error');
    expect(res.body.error.database.status).toBe('down');
  });

  it('GET /health/live still responds while both dependencies are down', async () => {
    await request(app.getHttpServer()).get('/health/live').expect(200, { status: 'ok' });
  });
});
