import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import { Redis } from 'ioredis';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as password from '../src/identity/password';
import { hashPassword, verifyPassword } from '../src/identity/password';
import { startHttpServer } from './support/http';
import { applyMigrations } from './support/migrations';

// Spy on the Argon2id entry points, keeping their behaviour, to prove that a
// limited request never reaches them.
vi.mock('../src/identity/password', async (importOriginal) => {
  const actual = await importOriginal<typeof password>();
  return {
    ...actual,
    hashPassword: vi.fn(actual.hashPassword),
    verifyPassword: vi.fn(actual.verifyPassword),
  };
});

const PASSWORD = 'correct horse battery staple';

/**
 * With TRUST_PROXY=1 the client IP is the X-Forwarded-For value, so each test
 * plays a client of its own and no test shares a counter with another.
 */
describe('authentication rate limits', () => {
  let postgres: StartedPostgreSqlContainer;
  let redisContainer: StartedRedisContainer;
  let redis: Redis;
  let app: INestApplication;
  let ipCounter = 0;

  beforeAll(async () => {
    [postgres, redisContainer] = await Promise.all([
      new PostgreSqlContainer('postgres:18-alpine').start(),
      new RedisContainer('redis:8-alpine').start(),
    ]);
    process.env.DATABASE_URL = postgres.getConnectionUri();
    process.env.REDIS_URL = redisContainer.getConnectionUrl();
    process.env.AUTH_RATE_LIMIT = 'on';
    process.env.TRUST_PROXY = '1';
    await applyMigrations(process.env.DATABASE_URL);

    const { AppModule } = await import('../src/app.module');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await startHttpServer(app);
    redis = new Redis(redisContainer.getConnectionUrl());
  });

  afterAll(async () => {
    redis?.disconnect();
    await app?.close();
    await Promise.all([postgres?.stop(), redisContainer?.stop()]);
  });

  beforeEach(() => {
    vi.mocked(hashPassword).mockClear();
    vi.mocked(verifyPassword).mockClear();
  });

  /** A client IP no other request in this suite uses. */
  function newClient(): string {
    ipCounter += 1;
    return `198.51.100.${ipCounter}`;
  }

  const post = (path: string, ip: string) =>
    request(app.getHttpServer()).post(path).set('X-Forwarded-For', ip);

  const registration = () => ({
    email: `user-${randomUUID()}@costly.test`,
    password: PASSWORD,
    timezone: 'Asia/Yerevan',
  });

  async function newAccount(): Promise<string> {
    const body = registration();
    await post('/auth/register', newClient()).send(body).expect(201);
    return body.email;
  }

  function expectTooManyRequests(res: request.Response): void {
    expect(res.status).toBe(429);
    expect(res.headers['content-type']).toMatch(/^application\/problem\+json/);
    expect(res.body).toEqual({
      type: 'about:blank',
      title: 'Too Many Requests',
      status: 429,
      detail: 'Too many requests. Try again later.',
    });
    const retryAfter = Number(res.headers['retry-after']);
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(15 * 60);
  }

  describe('POST /auth/register: 5 per 15 minutes per IP', () => {
    it('answers the sixth request with 429 and never hashes its password', async () => {
      const ip = newClient();
      for (let i = 0; i < 5; i++) await post('/auth/register', ip).send(registration()).expect(201);
      vi.mocked(hashPassword).mockClear();

      expectTooManyRequests(await post('/auth/register', ip).send(registration()));
      expect(hashPassword).not.toHaveBeenCalled();
    });

    it('counts rejected requests too: the limit runs before validation', async () => {
      const ip = newClient();
      for (let i = 0; i < 5; i++) await post('/auth/register', ip).send({}).expect(400);

      expectTooManyRequests(await post('/auth/register', ip).send(registration()));
    });

    it('keeps a separate budget for every client', async () => {
      const exhausted = newClient();
      for (let i = 0; i < 6; i++) await post('/auth/register', exhausted).send({});

      await post('/auth/register', newClient()).send(registration()).expect(201);
    });

    it('admits exactly five of twenty concurrent requests from one client', async () => {
      const ip = newClient();

      const responses = await Promise.all(
        Array.from({ length: 20 }, () => post('/auth/register', ip).send({})),
      );

      expect(responses.filter((res) => res.status !== 429)).toHaveLength(5);
    });
  });

  describe('POST /auth/login', () => {
    it('answers the eleventh request from one IP with 429, before verifying the password', async () => {
      const email = await newAccount();
      const ip = newClient();
      for (let i = 0; i < 10; i++) {
        await post('/auth/login', ip)
          .send({ email: `other-${i}@costly.test`, password: PASSWORD })
          .expect(401);
      }
      vi.mocked(verifyPassword).mockClear();

      expectTooManyRequests(await post('/auth/login', ip).send({ email, password: PASSWORD }));
      expect(verifyPassword).not.toHaveBeenCalled();
    });

    it('blocks an account after 10 failures from different IPs, even with the right password', async () => {
      const email = await newAccount();
      for (let i = 0; i < 10; i++) {
        await post('/auth/login', newClient())
          .send({ email, password: 'wrong password' })
          .expect(401);
      }
      vi.mocked(verifyPassword).mockClear();

      expectTooManyRequests(
        await post('/auth/login', newClient()).send({ email, password: PASSWORD }),
      );
      expect(verifyPassword).not.toHaveBeenCalled();
    });

    it('treats an unknown email the same way, so a 429 reveals nothing', async () => {
      const unknown = `nobody-${randomUUID()}@costly.test`;
      for (let i = 0; i < 10; i++) {
        await post('/auth/login', newClient()).send({ email: unknown, password: 'x' }).expect(401);
      }

      expectTooManyRequests(
        await post('/auth/login', newClient()).send({ email: unknown, password: 'x' }),
      );
    });

    it('counts failures per account regardless of email casing', async () => {
      const email = await newAccount();
      for (let i = 0; i < 10; i++) {
        const variant = i % 2 === 0 ? email.toUpperCase() : ` ${email} `;
        await post('/auth/login', newClient())
          .send({ email: variant, password: 'wrong' })
          .expect(401);
      }

      expectTooManyRequests(
        await post('/auth/login', newClient()).send({ email, password: PASSWORD }),
      );
    });

    it('does not count successful logins against the account', async () => {
      const email = await newAccount();

      for (let i = 0; i < 12; i++) {
        await post('/auth/login', newClient()).send({ email, password: PASSWORD }).expect(200);
      }
    });
  });

  describe('POST /auth/refresh: 30 per 15 minutes per IP', () => {
    it('answers the thirty-first request with 429', async () => {
      const ip = newClient();
      for (let i = 0; i < 30; i++) await post('/auth/refresh', ip).expect(401);

      expectTooManyRequests(await post('/auth/refresh', ip));
    });
  });

  it('does not limit logout, which does no expensive work', async () => {
    const ip = newClient();

    for (let i = 0; i < 40; i++) await post('/auth/logout', ip).expect(204);
  });

  it('keeps every counter bounded in time and free of credentials', async () => {
    const email = await newAccount();
    const ip = newClient();
    const login = await post('/auth/login', ip).send({ email, password: PASSWORD }).expect(200);
    await post('/auth/login', newClient())
      .send({ email, password: 'a wrong password' })
      .expect(401);
    await post('/auth/refresh', ip)
      .set('Cookie', [login.headers['set-cookie']].flat() as string[])
      .expect(200);

    const keys = await redis.keys('ratelimit:*');
    const ttls = await Promise.all(keys.map((key) => redis.pttl(key)));

    expect(keys.length).toBeGreaterThan(0);
    for (const ttl of ttls) {
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(15 * 60 * 1000);
    }
    const everything = keys.join('\n');
    expect(everything).not.toContain(email);
    expect(everything).not.toContain('@');
    expect(everything).not.toContain(PASSWORD);
    expect(everything).not.toContain(login.body.accessToken);
    expect(keys.every((key) => /^ratelimit:[a-z-]+:(ip|account):[\w.:-]+$/.test(key))).toBe(true);
  });
});
