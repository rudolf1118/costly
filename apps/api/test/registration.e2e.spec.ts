import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { verifyPassword } from '../src/identity/password';
import { PrismaService } from '../src/platform/database/prisma.service';
import { listenOnLoopback } from './support/http';
import { applyMigrations } from './support/migrations';

describe('POST /auth/register', () => {
  let postgres: StartedPostgreSqlContainer;
  let redis: StartedRedisContainer;
  let app: INestApplication;
  let prisma: PrismaService;

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
    await listenOnLoopback(app);
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app?.close();
    await Promise.all([postgres?.stop(), redis?.stop()]);
  });

  /** A unique address per call, so tests never collide whatever their order. */
  function uniqueEmail(): string {
    return `user-${randomUUID()}@costly.test`;
  }

  function validBody(overrides: Record<string, unknown> = {}) {
    return {
      email: uniqueEmail(),
      password: 'correct horse battery staple',
      timezone: 'Asia/Yerevan',
      ...overrides,
    };
  }

  function register(body: unknown) {
    return request(app.getHttpServer())
      .post('/auth/register')
      .send(body as object);
  }

  async function storedHash(email: string): Promise<string | undefined> {
    const rows = await prisma.$queryRaw<{ password_hash: string }[]>`
      SELECT password_hash FROM users WHERE email = ${email}`;
    return rows[0]?.password_hash;
  }

  async function countUsers(email: string): Promise<number> {
    return prisma.user.count({ where: { email } });
  }

  describe('success', () => {
    it('creates the account and returns it without credentials', async () => {
      const body = validBody();

      const res = await register(body).expect(201);

      expect(res.headers['content-type']).toMatch(/^application\/json/);
      expect(Object.keys(res.body).sort()).toEqual([
        'baseCurrency',
        'createdAt',
        'email',
        'id',
        'timezone',
      ]);
      expect(res.body).toMatchObject({
        email: body.email,
        baseCurrency: 'AMD',
        timezone: 'Asia/Yerevan',
      });
      expect(res.body.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7/);
      expect(new Date(res.body.createdAt).toString()).not.toBe('Invalid Date');
      expect(JSON.stringify(res.body)).not.toContain(body.password);
    });

    it('stores an Argon2id hash with the configured parameters, never the password', async () => {
      const body = validBody();
      await register(body).expect(201);

      const hash = await storedHash(body.email);

      expect(hash).toMatch(/^\$argon2id\$v=19\$m=65536,t=3,p=4\$/);
      expect(hash).not.toContain(body.password);
      await expect(verifyPassword(hash!, body.password)).resolves.toBe(true);
      await expect(verifyPassword(hash!, `${body.password}!`)).resolves.toBe(false);
    });

    it('normalizes the password with NFKC before hashing', async () => {
      // "ﬁ" (U+FB01) is the ligature form of "fi"; NFKC maps one to the other.
      const body = validBody({ password: 'ﬁnancial plan 2027' });
      await register(body).expect(201);

      const hash = await storedHash(body.email);

      await expect(verifyPassword(hash!, 'financial plan 2027')).resolves.toBe(true);
    });

    it('trims the email but keeps the casing as typed', async () => {
      const typed = `Anna.${randomUUID()}@Example.Test`;

      const res = await register(validBody({ email: `  ${typed}\t` })).expect(201);

      expect(res.body.email).toBe(typed);
    });

    it('stores the canonical name of the time zone', async () => {
      const res = await register(validBody({ timezone: ' asia/yerevan ' })).expect(201);

      expect(res.body.timezone).toBe('Asia/Yerevan');
    });

    it('accepts AMD given explicitly', async () => {
      const res = await register(validBody({ baseCurrency: 'AMD' })).expect(201);

      expect(res.body.baseCurrency).toBe('AMD');
    });

    it('accepts a password of exactly 8 characters', async () => {
      await register(validBody({ password: '12345678' })).expect(201);
    });
  });

  describe('duplicate email', () => {
    it('answers 409 when the email differs only in case', async () => {
      const email = uniqueEmail();
      await register(validBody({ email })).expect(201);

      const res = await register(validBody({ email: email.toUpperCase() })).expect(409);

      expect(res.headers['content-type']).toMatch(/^application\/problem\+json/);
      expect(res.body).toEqual({
        type: 'about:blank',
        title: 'Conflict',
        status: 409,
        detail: 'An account with this email already exists.',
      });
      expect(await countUsers(email)).toBe(1);
    });

    it('creates exactly one account when the same email registers concurrently', async () => {
      const email = uniqueEmail();
      const variants = [
        email,
        email.toUpperCase(),
        ` ${email} `,
        email,
        email.toUpperCase(),
        email,
      ];

      const responses = await Promise.all(
        variants.map((variant) => register(validBody({ email: variant }))),
      );

      const statuses = responses.map((res) => res.status).sort();
      expect(statuses).toEqual([201, 409, 409, 409, 409, 409]);
      expect(await countUsers(email)).toBe(1);
    });
  });

  describe('validation', () => {
    async function rejectedFields(body: unknown): Promise<string[]> {
      const res = await register(body).expect(400);
      expect(res.headers['content-type']).toMatch(/^application\/problem\+json/);
      expect(res.body).toMatchObject({ type: 'about:blank', title: 'Bad Request', status: 400 });
      return (res.body.errors as { path: string }[]).map((issue) => issue.path);
    }

    it.each([
      ['no @', 'anna.costly.test'],
      ['no domain', 'anna@'],
      ['inner whitespace', 'an na@costly.test'],
      ['not a string', 42],
      ['longer than 254 characters', `${'a'.repeat(243)}@costly.test`],
    ])('rejects an email with %s', async (_case, email) => {
      expect(await rejectedFields(validBody({ email }))).toEqual(['email']);
    });

    it.each([
      ['7 characters', 'abcdefg'],
      ['4 emoji, 8 UTF-16 units but 4 characters', '🙂🙂🙂🙂'],
      ['more than 128 characters', 'p'.repeat(129)],
      ['not a string', 12345678],
    ])('rejects a password of %s', async (_case, password) => {
      expect(await rejectedFields(validBody({ password }))).toEqual(['password']);
    });

    it.each([
      ['unknown zone', 'Mars/Olympus_Mons'],
      ['UTC offset', '+04:00'],
      ['empty', ''],
      ['abbreviation-like garbage', 'Yerevan Time'],
    ])('rejects a time zone that is an %s', async (_case, timezone) => {
      expect(await rejectedFields(validBody({ timezone }))).toEqual(['timezone']);
    });

    it.each(['USD', 'amd', ''])('rejects the base currency %j', async (baseCurrency) => {
      expect(await rejectedFields(validBody({ baseCurrency }))).toEqual(['baseCurrency']);
    });

    it('lists every missing required field', async () => {
      expect((await rejectedFields({})).sort()).toEqual(['email', 'password', 'timezone']);
    });

    it('rejects fields the endpoint does not accept', async () => {
      const res = await register(validBody({ passwordHash: 'x', id: randomUUID() })).expect(400);

      expect(res.body.errors).toHaveLength(1);
    });

    it('rejects a body that is not valid JSON', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/register')
        .set('Content-Type', 'application/json')
        .send('{"email": ')
        .expect(400);

      expect(res.headers['content-type']).toMatch(/^application\/problem\+json/);
      expect(res.body.detail).toBe('The request body is not valid JSON.');
    });

    it('does not echo fragments of a malformed body back', async () => {
      // V8's "Unexpected token" message quotes the input around the error.
      const res = await request(app.getHttpServer())
        .post('/auth/register')
        .set('Content-Type', 'application/json')
        .send('{"email": "a@costly.test", "password": my-real-secret}')
        .expect(400);

      expect(JSON.stringify(res.body)).not.toContain('real-se');
    });

    it('does not echo a rejected password back', async () => {
      const password = 'short1!';

      const res = await register(validBody({ password })).expect(400);

      expect(JSON.stringify(res.body)).not.toContain(password);
    });

    it('creates no account for an invalid request', async () => {
      const email = uniqueEmail();

      await register(validBody({ email, timezone: 'Nowhere/Land' })).expect(400);

      expect(await countUsers(email)).toBe(0);
    });
  });

  it('answers an unknown route with problem details', async () => {
    const res = await request(app.getHttpServer()).post('/auth/nope').send({}).expect(404);

    expect(res.headers['content-type']).toMatch(/^application\/problem\+json/);
    expect(res.body).toMatchObject({ title: 'Not Found', status: 404 });
  });
});
