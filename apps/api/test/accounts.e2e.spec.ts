import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
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

  const notFound = {
    type: 'about:blank',
    title: 'Not Found',
    status: 404,
    detail: 'Account not found.',
  };

  describe('GET /accounts/:id', () => {
    it("returns the caller's account", async () => {
      const user = await newUser();
      const account = await createAccount(user, { openingBalance: '-1250000' });

      const res = await as(user).get(`/accounts/${account.id}`).expect(200);

      expect(res.body).toEqual(account);
    });

    it("answers another user's account exactly like a missing one", async () => {
      const [owner, intruder] = await Promise.all([newUser(), newUser()]);
      const account = await createAccount(owner);

      const foreign = await as(intruder).get(`/accounts/${account.id}`).expect(404);
      const missing = await as(intruder).get(`/accounts/${randomUUID()}`).expect(404);

      expect(foreign.body).toEqual(notFound);
      expect(missing.body).toEqual(foreign.body);
    });

    it.each(['not-a-uuid', '123', "1' OR '1'='1"])(
      'rejects the malformed id %j with 400',
      async (id) => {
        const res = await as(await newUser())
          .get(`/accounts/${encodeURIComponent(id)}`)
          .expect(400);

        expect(res.body.errors).toEqual([{ path: 'id', message: 'Must be an account id (UUID)' }]);
      },
    );
  });

  describe('PATCH /accounts/:id', () => {
    it('changes the name, type and isLiquid, and moves updatedAt', async () => {
      const user = await newUser();
      const account = await createAccount(user, { type: 'checking' });

      const res = await as(user)
        .patch(`/accounts/${account.id}`, { name: '  Renamed ', type: 'savings', isLiquid: true })
        .expect(200);

      expect(res.body).toMatchObject({ name: 'Renamed', type: 'savings', isLiquid: true });
      expect(new Date(res.body.updatedAt).getTime()).toBeGreaterThan(
        new Date(account.updatedAt as string).getTime(),
      );
      expect(res.body.openingBalance).toBe(account.openingBalance);
    });

    it('keeps isLiquid when only the type changes', async () => {
      const user = await newUser();
      const account = await createAccount(user, { type: 'checking' });

      const res = await as(user).patch(`/accounts/${account.id}`, { type: 'savings' }).expect(200);

      expect(res.body.isLiquid).toBe(true);
    });

    it.each([
      ['openingBalance', '1'],
      ['openingDate', '2025-01-01'],
      ['currency', 'AMD'],
      ['userId', randomUUID()],
      ['archivedAt', null],
      ['id', randomUUID()],
    ])('refuses to change %s', async (field, value) => {
      const user = await newUser();
      const account = await createAccount(user);

      await as(user)
        .patch(`/accounts/${account.id}`, { [field]: value })
        .expect(400);

      const stored = await prisma.account.findUniqueOrThrow({ where: { id: account.id } });
      expect(stored.openingBalance).toBe(250_000n);
      expect(stored.userId).toBe(user.id);
      expect(stored.archivedAt).toBeNull();
    });

    it('rejects an empty change', async () => {
      const user = await newUser();
      const account = await createAccount(user);

      const res = await as(user).patch(`/accounts/${account.id}`, {}).expect(400);

      expect(res.body.errors).toEqual([
        { path: '', message: 'Provide at least one of: name, type, isLiquid' },
      ]);
    });

    it("cannot change another user's account, and says nothing about it", async () => {
      const [owner, intruder] = await Promise.all([newUser(), newUser()]);
      const account = await createAccount(owner, { name: 'Original' });

      const res = await as(intruder)
        .patch(`/accounts/${account.id}`, { name: 'Taken over' })
        .expect(404);

      expect(res.body).toEqual(notFound);
      await expect(
        prisma.account.findUniqueOrThrow({ where: { id: account.id } }),
      ).resolves.toMatchObject({ name: 'Original', userId: owner.id });
    });

    it('answers 404 for a missing account', async () => {
      await as(await newUser())
        .patch(`/accounts/${randomUUID()}`, { name: 'x' })
        .expect(404);
    });

    it('answers 409 when renaming to the name of another active account', async () => {
      const user = await newUser();
      await createAccount(user, { name: 'Main' });
      const other = await createAccount(user, { name: 'Other' });

      const res = await as(user).patch(`/accounts/${other.id}`, { name: 'main' }).expect(409);

      expect(res.body.detail).toBe('An active account with this name already exists.');
    });

    it('lets an account keep its own name in another case', async () => {
      const user = await newUser();
      const account = await createAccount(user, { name: 'Main' });

      await as(user).patch(`/accounts/${account.id}`, { name: 'MAIN' }).expect(200);
    });

    it('answers 409 for an archived account and leaves it unchanged', async () => {
      const user = await newUser();
      const account = await createAccount(user, { name: 'Old' });
      await prisma.account.update({ where: { id: account.id }, data: { archivedAt: new Date() } });

      const res = await as(user).patch(`/accounts/${account.id}`, { name: 'New' }).expect(409);

      expect(res.body.detail).toBe('The account is archived. Restore it before changing it.');
      await expect(
        prisma.account.findUniqueOrThrow({ where: { id: account.id } }),
      ).resolves.toMatchObject({ name: 'Old' });
    });
  });

  describe('POST /accounts/:id/archive and /restore', () => {
    it('archives the account without deleting it, keeping its money and details', async () => {
      const user = await newUser();
      const account = await createAccount(user, { openingBalance: '-500000' });

      const res = await as(user).post(`/accounts/${account.id}/archive`).expect(200);

      expect(res.body.archivedAt).not.toBeNull();
      expect(new Date(res.body.archivedAt).getTime()).toBeGreaterThanOrEqual(
        new Date(account.createdAt as string).getTime(),
      );
      expect(res.body).toMatchObject({
        id: account.id,
        openingBalance: '-500000',
        name: account.name,
      });
      await expect(prisma.account.count({ where: { id: account.id } })).resolves.toBe(1);
    });

    // archived_at must not precede created_at (a CHECK). Prisma sets created_at
    // from the API host's clock, so archiving must use that clock too: with the
    // database's now(), an API host running ahead broke the CHECK with a 500.
    it("archives an account when the API host's clock runs ahead of the database's", async () => {
      const user = await newUser();
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(Date.now() + 60_000);
      try {
        const account = await createAccount(user);

        const res = await as(user).post(`/accounts/${account.id}/archive`).expect(200);

        expect(new Date(res.body.archivedAt).getTime()).toBeGreaterThanOrEqual(
          new Date(res.body.createdAt).getTime(),
        );
      } finally {
        vi.useRealTimers();
      }
    });

    it('is idempotent: archiving again returns the account unchanged', async () => {
      const user = await newUser();
      const account = await createAccount(user);
      const first = await as(user).post(`/accounts/${account.id}/archive`).expect(200);

      const second = await as(user).post(`/accounts/${account.id}/archive`).expect(200);

      expect(second.body).toEqual(first.body);
    });

    it('hides archived accounts from the default list and shows them on request', async () => {
      const user = await newUser();
      const active = await createAccount(user, { name: 'Active' });
      const archived = await createAccount(user, { name: 'Archived' });
      await as(user).post(`/accounts/${archived.id}/archive`).expect(200);

      const ids = async (query: string) =>
        (await as(user).get(`/accounts${query}`).expect(200)).body.items.map(
          (a: { id: string }) => a.id,
        );

      expect(await ids('')).toEqual([active.id]);
      expect(await ids('?status=active')).toEqual([active.id]);
      expect(await ids('?status=archived')).toEqual([archived.id]);
      expect(await ids('?status=all')).toEqual([active.id, archived.id]);
      await as(user).get(`/accounts/${archived.id}`).expect(200);
    });

    it('frees the name of an archived account for a new one', async () => {
      const user = await newUser();
      const account = await createAccount(user, { name: 'Main' });
      await as(user).post(`/accounts/${account.id}/archive`).expect(200);

      await createAccount(user, { name: 'Main' });
    });

    it('restores an archived account to the active list', async () => {
      const user = await newUser();
      const account = await createAccount(user);
      await as(user).post(`/accounts/${account.id}/archive`).expect(200);

      const res = await as(user).post(`/accounts/${account.id}/restore`).expect(200);

      expect(res.body.archivedAt).toBeNull();
      const list = await as(user).get('/accounts').expect(200);
      expect(list.body.items.map((a: { id: string }) => a.id)).toEqual([account.id]);
      await as(user).patch(`/accounts/${account.id}`, { name: 'Editable again' }).expect(200);
    });

    it('is idempotent: restoring an active account returns it unchanged', async () => {
      const user = await newUser();
      const account = await createAccount(user);

      const res = await as(user).post(`/accounts/${account.id}/restore`).expect(200);

      expect(res.body).toEqual(account);
    });

    it('refuses to restore when an active account already has the name, leaving it archived', async () => {
      const user = await newUser();
      const old = await createAccount(user, { name: 'Main' });
      await as(user).post(`/accounts/${old.id}/archive`).expect(200);
      await createAccount(user, { name: 'MAIN' });

      const res = await as(user).post(`/accounts/${old.id}/restore`).expect(409);

      expect(res.body.detail).toBe('An active account with this name already exists.');
      const stored = await prisma.account.findUniqueOrThrow({ where: { id: old.id } });
      expect(stored.archivedAt).not.toBeNull();
    });

    it.each(['archive', 'restore'])(
      "cannot %s another user's account, and says nothing about it",
      async (action) => {
        const [owner, intruder] = await Promise.all([newUser(), newUser()]);
        const account = await createAccount(owner);
        if (action === 'restore')
          await as(owner).post(`/accounts/${account.id}/archive`).expect(200);
        const before = await prisma.account.findUniqueOrThrow({ where: { id: account.id } });

        const res = await as(intruder).post(`/accounts/${account.id}/${action}`).expect(404);

        expect(res.body).toEqual(notFound);
        await expect(
          prisma.account.findUniqueOrThrow({ where: { id: account.id } }),
        ).resolves.toEqual(before);
      },
    );

    it.each(['archive', 'restore'])(
      'answers 404 when asked to %s a missing account',
      async (action) => {
        await as(await newUser())
          .post(`/accounts/${randomUUID()}/${action}`)
          .expect(404);
      },
    );

    it.each(['archive', 'restore'])('rejects a malformed id for %s', async (action) => {
      await as(await newUser())
        .post(`/accounts/not-a-uuid/${action}`)
        .expect(400);
    });
    // Several API instances, or one whose clock is stepped back by NTP, can
    // archive with a clock behind the one that set created_at.
    it('archives an account when the archiving clock runs behind the one that created it', async () => {
      const user = await newUser();
      const account = await createAccount(user);
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date(account.createdAt as string).getTime() - 60_000);
      try {
        const res = await as(user).post(`/accounts/${account.id}/archive`).expect(200);

        expect(new Date(res.body.archivedAt).getTime()).toBeGreaterThanOrEqual(
          new Date(account.createdAt as string).getTime(),
        );
      } finally {
        vi.useRealTimers();
      }
    });
  });

  // Real concurrent requests against PostgreSQL. Each case runs several rounds;
  // whatever the interleaving, no request may fail with a 500 and the stored
  // state must match one of the serial orders.
  describe('concurrent requests', () => {
    const ROUNDS = 5;
    const statuses = (responses: { status: number }[]) => responses.map((r) => r.status).sort();

    it('restores exactly one of two archived accounts with the same name', async () => {
      for (let round = 0; round < ROUNDS; round++) {
        const user = await newUser();
        const a = await createAccount(user, { name: 'Twin' });
        await as(user).post(`/accounts/${a.id}/archive`).expect(200);
        const b = await createAccount(user, { name: 'twin' });
        await as(user).post(`/accounts/${b.id}/archive`).expect(200);

        const responses = await Promise.all([
          as(user).post(`/accounts/${a.id}/restore`),
          as(user).post(`/accounts/${b.id}/restore`),
        ]);

        expect(statuses(responses)).toEqual([200, 409]);
        await expect(
          prisma.account.count({ where: { userId: user.id, archivedAt: null } }),
        ).resolves.toBe(1);
      }
    });

    it('lets only one of two concurrent renames take a name', async () => {
      for (let round = 0; round < ROUNDS; round++) {
        const user = await newUser();
        const [a, b] = [await createAccount(user), await createAccount(user)];

        const responses = await Promise.all([
          as(user).patch(`/accounts/${a.id}`, { name: 'Wanted' }),
          as(user).patch(`/accounts/${b.id}`, { name: 'WANTED' }),
        ]);

        expect(statuses(responses)).toEqual([200, 409]);
      }
    });

    it('lets only one of a create and a restore take a name', async () => {
      for (let round = 0; round < ROUNDS; round++) {
        const user = await newUser();
        const old = await createAccount(user, { name: 'Shared' });
        await as(user).post(`/accounts/${old.id}/archive`).expect(200);

        const responses = await Promise.all([
          as(user).post(`/accounts/${old.id}/restore`),
          as(user).post('/accounts', validAccount({ name: 'shared' })),
        ]);

        expect([
          [200, 409],
          [201, 409],
        ]).toContainEqual(statuses(responses));
        await expect(
          prisma.account.count({ where: { userId: user.id, archivedAt: null } }),
        ).resolves.toBe(1);
      }
    });

    it('archives once when archive is requested concurrently', async () => {
      const user = await newUser();
      const account = await createAccount(user);

      const responses = await Promise.all(
        Array.from({ length: 5 }, () => as(user).post(`/accounts/${account.id}/archive`)),
      );

      expect(statuses(responses)).toEqual([200, 200, 200, 200, 200]);
      const stored = await prisma.account.findUniqueOrThrow({ where: { id: account.id } });
      for (const res of responses)
        expect(res.body.archivedAt).toBe(stored.archivedAt?.toISOString());
    });

    // Deterministic version of the race above: this request read the account
    // as active, then another request archived it before this one's UPDATE.
    it('keeps the first archive time when a concurrent archive wins the race', async () => {
      const user = await newUser();
      const account = await createAccount(user);
      const first = await as(user).post(`/accounts/${account.id}/archive`).expect(200);
      const stored = await prisma.account.findUniqueOrThrow({ where: { id: account.id } });
      const staleRead = vi
        .spyOn(prisma.account, 'findFirst')
        .mockResolvedValueOnce({ ...stored, archivedAt: null } as never);
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(Date.now() + 60_000);
      try {
        const second = await as(user).post(`/accounts/${account.id}/archive`).expect(200);

        expect(staleRead).toHaveBeenCalled();
        expect(second.body.archivedAt).toBe(first.body.archivedAt);
      } finally {
        vi.useRealTimers();
        staleRead.mockRestore();
      }
    });

    it('never applies an edit to an account archived concurrently', async () => {
      for (let round = 0; round < ROUNDS; round++) {
        const user = await newUser();
        const account = await createAccount(user, { name: 'Before' });

        const [edit, archive] = await Promise.all([
          as(user).patch(`/accounts/${account.id}`, { name: 'After' }),
          as(user).post(`/accounts/${account.id}/archive`),
        ]);

        expect(archive.status).toBe(200);
        expect([200, 409]).toContain(edit.status);
        const stored = await prisma.account.findUniqueOrThrow({ where: { id: account.id } });
        expect(stored.archivedAt).not.toBeNull();
        // The edit either landed before the archive or not at all.
        expect(stored.name).toBe(edit.status === 200 ? 'After' : 'Before');
      }
    });

    it('ends archive-versus-restore in a consistent state', async () => {
      for (let round = 0; round < ROUNDS; round++) {
        const user = await newUser();
        const account = await createAccount(user);
        await as(user).post(`/accounts/${account.id}/archive`).expect(200);

        const [restore, archive] = await Promise.all([
          as(user).post(`/accounts/${account.id}/restore`),
          as(user).post(`/accounts/${account.id}/archive`),
        ]);

        expect([restore.status, archive.status]).toEqual([200, 200]);
        const stored = await prisma.account.findUniqueOrThrow({ where: { id: account.id } });
        // Whichever ran last decided the state, and it said so.
        const last = [restore, archive].find(
          (res) => (res.body.archivedAt === null) === (stored.archivedAt === null),
        );
        expect(last).toBeDefined();
      }
    });
  });

  // Malformed transport input must end in a 4xx problem, never a 500.
  describe('transport edge cases', () => {
    const post = (user: User) =>
      http().post('/accounts').set('Authorization', `Bearer ${user.token}`);

    it('rejects malformed JSON with 400', async () => {
      const res = await post(await newUser())
        .set('Content-Type', 'application/json')
        .send('{"name":')
        .expect(400);
      expect(res.headers['content-type']).toMatch(/^application\/problem\+json/);
    });

    it('rejects a body that is not JSON with 400', async () => {
      await post(await newUser())
        .set('Content-Type', 'text/plain')
        .send('name=Main')
        .expect(400);
    });

    it('rejects an oversized body with 413', async () => {
      const res = await post(await newUser())
        .send(validAccount({ name: 'x'.repeat(200_000) }))
        .expect(413);
      expect(res.body.status).toBe(413);
    });

    it.each([
      ['a repeated status', '?status=active&status=all'],
      ['an array-shaped status', '?status[]=active'],
      ['an object-shaped status', '?status[a]=active'],
      ['an unknown status', '?status=deleted'],
      ['an unknown parameter', '?userId=00000000-0000-0000-0000-000000000000'],
    ])('rejects %s in the list query', async (_case, query) => {
      const user = await newUser();
      await as(user).get(`/accounts${query}`).expect(400);
    });

    it('rejects a userId in the body: the owner comes only from the token', async () => {
      const [user, other] = await Promise.all([newUser(), newUser()]);

      await as(user)
        .post('/accounts', validAccount({ userId: other.id }))
        .expect(400);
      await expect(prisma.account.count({ where: { userId: other.id } })).resolves.toBe(0);
    });
  });

  describe('names across scripts and Unicode forms', () => {
    it('treats Armenian names case-insensitively', async () => {
      const user = await newUser();
      await createAccount(user, { name: 'ԱՄԵՐԻԱԲԱՆԿ' });

      await as(user)
        .post('/accounts', validAccount({ name: 'ամերիաբանկ' }))
        .expect(409);
    });

    it('stores a decomposed name in composed (NFC) form', async () => {
      const account = await createAccount(await newUser(), { name: 'Cafe\u0301' });

      expect(account.name).toBe('Caf\u00e9');
    });

    it('treats composed and decomposed spellings of a name as the same name', async () => {
      const user = await newUser();
      const composed = 'Caf\u00e9';
      const created = await createAccount(user, { name: composed });

      await as(user)
        .post('/accounts', validAccount({ name: 'Cafe\u0301' }))
        .expect(409);
      expect(created.name).toBe(composed);
    });
  });

  describe('two users', () => {
    it("never let one user see, change, archive or claim the other's accounts", async () => {
      const [anna, ben] = await Promise.all([newUser(), newUser()]);
      const annas = await createAccount(anna, { name: 'Anna savings', type: 'savings' });
      const bens = await createAccount(ben, { name: 'Ben wallet', type: 'cash' });

      // Listing: each sees only their own.
      expect((await as(anna).get('/accounts?status=all').expect(200)).body.items).toEqual([annas]);
      expect((await as(ben).get('/accounts?status=all').expect(200)).body.items).toEqual([bens]);

      // Every route on the other's account answers like a missing account.
      for (const response of [
        await as(anna).get(`/accounts/${bens.id}`),
        await as(anna).patch(`/accounts/${bens.id}`, { name: 'Mine now' }),
        await as(anna).post(`/accounts/${bens.id}/archive`),
        await as(anna).post(`/accounts/${bens.id}/restore`),
      ]) {
        expect(response.status).toBe(404);
        expect(response.body).toEqual(notFound);
      }

      // Nothing about Ben's account changed.
      expect((await as(ben).get(`/accounts/${bens.id}`).expect(200)).body).toEqual(bens);
    });
  });

  describe('authentication', () => {
    it.each([
      ['POST', '/accounts'],
      ['GET', '/accounts'],
      ['GET', `/accounts/${randomUUID()}`],
      ['PATCH', `/accounts/${randomUUID()}`],
      ['POST', `/accounts/${randomUUID()}/archive`],
      ['POST', `/accounts/${randomUUID()}/restore`],
    ])('rejects %s %s without an access token', async (method, path) => {
      const req =
        method === 'POST'
          ? http().post(path).send(validAccount())
          : method === 'PATCH'
            ? http().patch(path).send({ name: 'x' })
            : http().get(path);

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
