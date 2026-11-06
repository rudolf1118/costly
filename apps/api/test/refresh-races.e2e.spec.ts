import { createHash, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '../src/generated/prisma/client';
import { startHttpServer } from './support/http';
import { applyMigrations } from './support/migrations';

const PASSWORD = 'correct horse battery staple';

/**
 * Interleavings of refresh, reuse detection and logout on one session,
 * forced deterministically: a separate connection holds a token's row lock,
 * the test waits (by polling pg_locks, not by sleeping) until the API
 * requests are queued behind it in a known order, then releases it.
 */
describe('refresh session races', () => {
  let postgres: StartedPostgreSqlContainer;
  let redis: StartedRedisContainer;
  let app: INestApplication;
  /** Own connection pool, so holding a lock never starves the API's pool. */
  let db: PrismaClient;

  beforeAll(async () => {
    [postgres, redis] = await Promise.all([
      new PostgreSqlContainer('postgres:18-alpine').start(),
      new RedisContainer('redis:8-alpine').start(),
    ]);
    process.env.DATABASE_URL = postgres.getConnectionUri();
    process.env.REDIS_URL = redis.getConnectionUrl();
    await applyMigrations(process.env.DATABASE_URL);

    const { AppModule } = await import('../src/app.module');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await startHttpServer(app);
    db = new PrismaClient({
      adapter: new PrismaPg({ connectionString: postgres.getConnectionUri() }),
    });
  });

  afterAll(async () => {
    await db?.$disconnect();
    await app?.close();
    await Promise.all([postgres?.stop(), redis?.stop()]);
  });

  const http = () => request(app.getHttpServer());
  const digest = (token: string) => createHash('sha256').update(token).digest('hex');

  async function session(): Promise<string> {
    const email = `user-${randomUUID()}@costly.test`;
    await http()
      .post('/auth/register')
      .send({ email, password: PASSWORD, timezone: 'UTC' })
      .expect(201);
    const res = await http().post('/auth/login').send({ email, password: PASSWORD }).expect(200);
    return cookieToken(res);
  }

  function cookieToken(res: request.Response): string {
    const cookie = ([res.headers['set-cookie'] ?? []].flat() as string[]).find((value) =>
      value.startsWith('costly_refresh='),
    );
    return cookie?.split(';')[0]?.slice('costly_refresh='.length) ?? '';
  }

  /** Starts a request now and returns its eventual response. */
  function start(path: '/auth/refresh' | '/auth/logout', token: string): Promise<request.Response> {
    return http()
      .post(path)
      .set('Cookie', `costly_refresh=${token}`)
      .then((res) => res);
  }

  /** Holds the row lock of a token's row until release() is called. */
  async function holdRowLock(token: string): Promise<{ release: () => Promise<void> }> {
    let release!: () => void;
    const released = new Promise<void>((resolve) => (release = resolve));
    let locked!: () => void;
    const isLocked = new Promise<void>((resolve) => (locked = resolve));
    const transaction = db.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT 1 FROM refresh_tokens WHERE token_hash = ${digest(token)} FOR UPDATE`;
        locked();
        await released;
      },
      { timeout: 30_000 },
    );
    await isLocked;
    return {
      release: async () => {
        release();
        await transaction;
      },
    };
  }

  /** Resolves once `count` lock requests are waiting in PostgreSQL. */
  async function waitingLocks(count: number): Promise<void> {
    for (let attempt = 0; attempt < 500; attempt++) {
      const [row] = await db.$queryRaw<{ waiting: number }[]>`
        SELECT count(*)::int AS waiting FROM pg_locks WHERE NOT granted`;
      if ((row?.waiting ?? 0) >= count) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(`expected ${count} lock requests to be waiting`);
  }

  it('ends the session when logout races a refresh of the same token', async () => {
    const token = await session();
    const lock = await holdRowLock(token);

    // The refresh is queued first, then the logout behind it.
    const refreshing = start('/auth/refresh', token);
    await waitingLocks(1);
    const loggingOut = start('/auth/logout', token);
    await waitingLocks(2);
    await lock.release();

    const [refreshed, loggedOut] = await Promise.all([refreshing, loggingOut]);
    expect(refreshed.status).toBe(200);
    expect(loggedOut.status).toBe(204);
    // The token the racing refresh handed out must not outlive the logout.
    await http()
      .post('/auth/refresh')
      .set('Cookie', `costly_refresh=${cookieToken(refreshed)}`)
      .expect(401);
  });

  it('revokes the newest successor when an old token is replayed during a rotation', async () => {
    const first = await session();
    const res = await http()
      .post('/auth/refresh')
      .set('Cookie', `costly_refresh=${first}`)
      .expect(200);
    const current = cookieToken(res);
    // Make the replay of `first` count as reuse, not as a concurrent duplicate.
    await db.$executeRaw`
      UPDATE refresh_tokens SET rotated_at = now() - interval '1 minute' WHERE token_hash = ${digest(first)}`;
    const lock = await holdRowLock(current);

    // The holder of `current` rotates it; meanwhile `first` is replayed.
    const rotating = start('/auth/refresh', current);
    await waitingLocks(1);
    const replaying = start('/auth/refresh', first);
    await waitingLocks(2);
    await lock.release();

    const [rotated, replayed] = await Promise.all([rotating, replaying]);
    expect(rotated.status).toBe(200);
    expect(replayed.status).toBe(401);
    // Reuse detection must catch the successor created during the race.
    await http()
      .post('/auth/refresh')
      .set('Cookie', `costly_refresh=${cookieToken(rotated)}`)
      .expect(401);
  });
});
