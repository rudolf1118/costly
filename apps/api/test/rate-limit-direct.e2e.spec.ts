import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type * as password from '../src/identity/password';
import { hashPassword, verifyPassword } from '../src/identity/password';
import { startHttpServer } from './support/http';
import { applyMigrations } from './support/migrations';

vi.mock('../src/identity/password', async (importOriginal) => {
  const actual = await importOriginal<typeof password>();
  return {
    ...actual,
    hashPassword: vi.fn(actual.hashPassword),
    verifyPassword: vi.fn(actual.verifyPassword),
  };
});

const PASSWORD = 'correct horse battery staple';

/** TRUST_PROXY=0, the default: no forwarding header is believed. */
describe('authentication rate limits without a trusted proxy', () => {
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
    process.env.AUTH_RATE_LIMIT = 'on';
    process.env.TRUST_PROXY = '0';
    await applyMigrations(process.env.DATABASE_URL);

    const { AppModule } = await import('../src/app.module');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await startHttpServer(app);
  });

  afterAll(async () => {
    await app?.close();
    await Promise.all([postgres?.stop(), redis?.stop().catch(() => undefined)]);
  });

  const http = () => request(app.getHttpServer());

  it('ignores X-Forwarded-For, so a client cannot claim a fresh IP for each request', async () => {
    for (let i = 1; i <= 5; i++) {
      await http()
        .post('/auth/register')
        .set('X-Forwarded-For', `203.0.113.${i}`)
        .send({})
        .expect(400);
    }

    await http().post('/auth/register').set('X-Forwarded-For', '203.0.113.99').send({}).expect(429);
  });

  // Runs last: it stops the Redis container.
  describe('while Redis is unavailable', () => {
    let accessToken: string;
    let refreshCookie: string[];

    beforeAll(async () => {
      // A session from before the outage. The login comes from this suite's
      // only client IP, which the test above already used for registration
      // only, so the login budget is untouched.
      const email = `user-${randomUUID()}@costly.test`;
      await redis.exec(['redis-cli', 'FLUSHALL']);
      await http()
        .post('/auth/register')
        .send({ email, password: PASSWORD, timezone: 'UTC' })
        .expect(201);
      const login = await http()
        .post('/auth/login')
        .send({ email, password: PASSWORD })
        .expect(200);
      accessToken = login.body.accessToken;
      refreshCookie = [login.headers['set-cookie']].flat() as string[];

      await redis.stop();
      vi.mocked(hashPassword).mockClear();
      vi.mocked(verifyPassword).mockClear();
    });

    const unavailable = {
      type: 'about:blank',
      title: 'Service Unavailable',
      status: 503,
      detail: 'This service is temporarily unavailable. Try again later.',
    };

    it.each([
      [
        'register',
        () =>
          http()
            .post('/auth/register')
            .send({ email: 'x@costly.test', password: PASSWORD, timezone: 'UTC' }),
      ],
      [
        'login',
        () => http().post('/auth/login').send({ email: 'x@costly.test', password: PASSWORD }),
      ],
      ['refresh', () => http().post('/auth/refresh').set('Cookie', refreshCookie)],
    ])('fails %s closed with a prompt 503 and no password hashing', async (_endpoint, send) => {
      const started = Date.now();

      const res = await send().expect(503);

      expect(res.body).toEqual(unavailable);
      expect(Date.now() - started).toBeLessThan(2_000);
      expect(hashPassword).not.toHaveBeenCalled();
      expect(verifyPassword).not.toHaveBeenCalled();
    });

    it('still accepts issued access tokens, which need no Redis', async () => {
      await http().get('/auth/me').set('Authorization', `Bearer ${accessToken}`).expect(200);
    });

    it('still lets the user log out, which is not rate-limited', async () => {
      await http().post('/auth/logout').set('Cookie', refreshCookie).expect(204);
    });
  });
});
