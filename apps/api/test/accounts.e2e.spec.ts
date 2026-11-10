import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/platform/database/prisma.service';
import { startHttpServer } from './support/http';
import { applyMigrations } from './support/migrations';

const PASSWORD = 'correct horse battery staple';

describe('financial accounts', () => {
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

    const { AppModule } = await import('../src/app.module');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await startHttpServer(app);
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app?.close();
    await Promise.all([postgres?.stop(), redis?.stop()]);
  });

  const http = () => request(app.getHttpServer());

  interface User {
    id: string;
    token: string;
  }

  /** A fresh user with an access token; every test makes its own. */
  async function newUser(): Promise<User> {
    const email = `user-${randomUUID()}@costly.test`;
    const registered = await http()
      .post('/auth/register')
      .send({ email, password: PASSWORD, timezone: 'Asia/Yerevan' })
      .expect(201);
    const login = await http().post('/auth/login').send({ email, password: PASSWORD }).expect(200);
    return { id: registered.body.id, token: login.body.accessToken };
  }

  const as = (user: User) => ({
    get: (path: string) => http().get(path).set('Authorization', `Bearer ${user.token}`),
    post: (path: string, body?: object) =>
      http().post(path).set('Authorization', `Bearer ${user.token}`).send(body),
    patch: (path: string, body: object) =>
      http().patch(path).set('Authorization', `Bearer ${user.token}`).send(body),
  });

  const validAccount = (overrides: Record<string, unknown> = {}) => ({
    name: `Account ${randomUUID().slice(0, 8)}`,
    type: 'checking',
    openingBalance: '250000',
    openingDate: '2026-01-01',
    ...overrides,
  });

  async function createAccount(user: User, overrides: Record<string, unknown> = {}) {
    const res = await as(user).post('/accounts', validAccount(overrides)).expect(201);
    return res.body as { id: string; name: string } & Record<string, unknown>;
  }

  async function rejectedFields(user: User, body: object): Promise<string[]> {
    const res = await as(user).post('/accounts', body).expect(400);
    expect(res.headers['content-type']).toMatch(/^application\/problem\+json/);
    return (res.body.errors as { path: string }[]).map((issue) => issue.path);
  }

  describe('POST /accounts', () => {
    it('creates the account for the authenticated user and returns it', async () => {
      const user = await newUser();

      const res = await as(user)
        .post('/accounts', {
          name: '  Main bank account ',
          type: 'checking',
          currency: 'AMD',
          openingBalance: '250000',
          openingDate: '2026-01-01',
        })
        .expect(201);

      expect(res.headers.location).toBe(`/accounts/${res.body.id}`);
      expect(Object.keys(res.body).sort()).toEqual([
        'archivedAt',
        'createdAt',
        'currency',
        'id',
        'isLiquid',
        'name',
        'openingBalance',
        'openingDate',
        'type',
        'updatedAt',
      ]);
      expect(res.body).toMatchObject({
        name: 'Main bank account',
        type: 'checking',
        currency: 'AMD',
        isLiquid: true,
        openingBalance: '250000',
        openingDate: '2026-01-01',
        archivedAt: null,
      });
      expect(res.body.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7/);
      const stored = await prisma.account.findUniqueOrThrow({ where: { id: res.body.id } });
      expect(stored.userId).toBe(user.id);
      expect(stored.openingBalance).toBe(250_000n);
    });

    it.each([
      ['checking', true],
      ['cash', true],
      ['savings', false],
      ['credit_card', true],
    ])('defaults isLiquid for a %s account to %s', async (type, liquid) => {
      const account = await createAccount(await newUser(), { type });

      expect(account.isLiquid).toBe(liquid);
    });

    it('lets the client override isLiquid', async () => {
      const account = await createAccount(await newUser(), { type: 'savings', isLiquid: true });

      expect(account.isLiquid).toBe(true);
    });

    it('defaults the currency to AMD', async () => {
      const user = await newUser();
      const { currency: _omitted, ...body } = { ...validAccount(), currency: undefined };

      const res = await as(user).post('/accounts', body).expect(201);

      expect(res.body.currency).toBe('AMD');
    });

    it('rejects a userId in the body: the owner is always the token holder', async () => {
      const [user, other] = await Promise.all([newUser(), newUser()]);

      expect(await rejectedFields(user, validAccount({ userId: other.id }))).toEqual(['']);
      await expect(prisma.account.count({ where: { userId: other.id } })).resolves.toBe(0);
    });

    it.each([['id'], ['archivedAt'], ['createdAt']])(
      'rejects the server-owned field %s',
      async (field) => {
        const value = field === 'id' ? randomUUID() : new Date().toISOString();

        expect(await rejectedFields(await newUser(), validAccount({ [field]: value }))).toEqual([
          '',
        ]);
      },
    );

    describe('money', () => {
      it.each([
        ['zero', '0'],
        ['a positive balance', '150000'],
        ['a negative balance (credit card debt)', '-1250000'],
        ['the maximum', '999999999999999'],
        ['the minimum', '-999999999999999'],
      ])('accepts %s and returns it exactly', async (_case, openingBalance) => {
        const account = await createAccount(await newUser(), { openingBalance });

        expect(account.openingBalance).toBe(openingBalance);
      });

      it.each([
        ['a JSON number', 150000],
        ['a JSON number beyond 2^53', Number.MAX_SAFE_INTEGER + 2],
        ['a decimal', '1500.50'],
        ['a float-looking integer', '150000.0'],
        ['an exponent', '1.5e5'],
        ['a leading zero', '0150000'],
        ['a plus sign', '+150000'],
        ['negative zero', '-0'],
        ['more than the maximum', '1000000000000000'],
        ['less than the minimum', '-1000000000000000'],
        ['a value beyond bigint', '99999999999999999999'],
        ['thousands separators', '150,000'],
        ['an empty string', ''],
      ])('rejects %s', async (_case, openingBalance) => {
        expect(await rejectedFields(await newUser(), validAccount({ openingBalance }))).toEqual([
          'openingBalance',
        ]);
      });
    });

    it.each([
      ['an unsupported type', { type: 'bank' }, 'type'],
      ['an unsupported currency', { currency: 'USD' }, 'currency'],
      ['an empty name', { name: '   ' }, 'name'],
      ['a 65-character name', { name: 'a'.repeat(65) }, 'name'],
      ['a name with a control character', { name: 'Main\u0000' }, 'name'],
      ['a name with an unpaired surrogate', { name: 'Main \ud800' }, 'name'],
      ['a non-boolean isLiquid', { isLiquid: 'yes' }, 'isLiquid'],
      ['a malformed date', { openingDate: '01/01/2026' }, 'openingDate'],
      ['an impossible date', { openingDate: '2026-02-30' }, 'openingDate'],
      ['a date before 1900', { openingDate: '1899-12-31' }, 'openingDate'],
      ['a future date', { openingDate: '2999-01-01' }, 'openingDate'],
    ])('rejects %s', async (_case, overrides, field) => {
      expect(await rejectedFields(await newUser(), validAccount(overrides))).toEqual([field]);
    });

    it('accepts a 64-character name counted in characters, not UTF-16 units', async () => {
      const name = '🙂'.repeat(64);

      const account = await createAccount(await newUser(), { name });

      expect(account.name).toBe(name);
    });

    it('accepts today in the furthest-ahead time zone as the opening date', async () => {
      const latest = new Date(Date.now() + 14 * 3600 * 1000).toISOString().slice(0, 10);

      const account = await createAccount(await newUser(), { openingDate: latest });

      expect(account.openingDate).toBe(latest);
    });

    it('lists every missing required field', async () => {
      expect((await rejectedFields(await newUser(), {})).sort()).toEqual([
        'name',
        'openingBalance',
        'openingDate',
        'type',
      ]);
    });

    it('answers 409 for a second active account with the same name in any case', async () => {
      const user = await newUser();
      await createAccount(user, { name: 'Main' });

      const res = await as(user)
        .post('/accounts', validAccount({ name: 'MAIN' }))
        .expect(409);

      expect(res.body).toEqual({
        type: 'about:blank',
        title: 'Conflict',
        status: 409,
        detail: 'An active account with this name already exists.',
      });
    });

    it('lets two users use the same name', async () => {
      await createAccount(await newUser(), { name: 'Main' });

      await createAccount(await newUser(), { name: 'Main' });
    });

    it('creates exactly one account when the same name is submitted concurrently', async () => {
      const user = await newUser();

      const responses = await Promise.all(
        Array.from({ length: 5 }, () => as(user).post('/accounts', validAccount({ name: 'Race' }))),
      );

      expect(responses.map((res) => res.status).sort()).toEqual([201, 409, 409, 409, 409]);
      await expect(prisma.account.count({ where: { userId: user.id } })).resolves.toBe(1);
    });
  });

  describe('GET /accounts', () => {
    it("lists only the caller's accounts, in creation order", async () => {
      const [user, other] = await Promise.all([newUser(), newUser()]);
      const first = await createAccount(user, { name: 'First' });
      const second = await createAccount(user, { name: 'Second' });
      await createAccount(other, { name: 'Not yours' });

      const res = await as(user).get('/accounts').expect(200);

      expect(res.body.items.map((account: { id: string }) => account.id)).toEqual([
        first.id,
        second.id,
      ]);
    });

    it('returns an empty list for a user without accounts', async () => {
      const res = await as(await newUser())
        .get('/accounts')
        .expect(200);

      expect(res.body).toEqual({ items: [] });
    });

    it('returns money as strings in the list too', async () => {
      const user = await newUser();
      await createAccount(user, { openingBalance: '-999999999999999' });

      const res = await as(user).get('/accounts').expect(200);

      expect(res.text).toContain('"openingBalance":"-999999999999999"');
    });

    it.each([
      ['an unknown status', '?status=deleted'],
      ['an unknown parameter', '?userId=00000000-0000-7000-8000-000000000000'],
    ])('rejects %s', async (_case, query) => {
      await as(await newUser())
        .get(`/accounts${query}`)
        .expect(400);
    });
  });

  describe('authentication', () => {
    it.each([
      ['POST', '/accounts'],
      ['GET', '/accounts'],
    ])('rejects %s %s without an access token', async (method, path) => {
      const req = method === 'POST' ? http().post(path).send(validAccount()) : http().get(path);

      const res = await req.expect(401);

      expect(res.headers['www-authenticate']).toBe('Bearer realm="costly"');
    });

    it('rejects an expired access token', async () => {
      const user = await newUser();
      const expired = await new JwtService({ secret: process.env.JWT_ACCESS_SECRET }).signAsync(
        { exp: Math.floor(Date.now() / 1000) - 1 },
        { subject: user.id, issuer: 'costly-api', audience: 'costly-api', algorithm: 'HS256' },
      );

      await http().get('/accounts').set('Authorization', `Bearer ${expired}`).expect(401);
      await http()
        .post('/accounts')
        .set('Authorization', `Bearer ${expired}`)
        .send(validAccount())
        .expect(401);
    });
  });
});
