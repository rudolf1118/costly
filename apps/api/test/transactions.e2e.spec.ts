import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Prisma } from '../src/generated/prisma/client';
import { PrismaService } from '../src/platform/database/prisma.service';
import { startHttpServer } from './support/http';
import { applyMigrations } from './support/migrations';

const PASSWORD = 'correct horse battery staple';

/** Fixed ids from the seed migration. */
const SALARY = '00000000-0000-7000-8000-000000000001';
const FOOD = '00000000-0000-7000-8000-00000000000a';
const GROCERIES = '00000000-0000-7000-8000-00000000000b';

describe('transactions', () => {
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
    delete: (path: string) => http().delete(path).set('Authorization', `Bearer ${user.token}`),
  });

  async function createAccount(user: User, overrides: Record<string, unknown> = {}) {
    const res = await as(user)
      .post('/accounts', {
        name: `Account ${randomUUID().slice(0, 8)}`,
        type: 'checking',
        openingBalance: '100000',
        openingDate: '2026-01-01',
        ...overrides,
      })
      .expect(201);
    return res.body as { id: string };
  }

  async function createCategory(user: User, overrides: Record<string, unknown> = {}) {
    const res = await as(user)
      .post('/categories', {
        name: `Category ${randomUUID().slice(0, 8)}`,
        kind: 'expense',
        nature: 'discretionary',
        ...overrides,
      })
      .expect(201);
    return res.body as { id: string };
  }

  /** A user with one active account, ready to record transactions. */
  async function newLedger() {
    const user = await newUser();
    const account = await createAccount(user);
    return { user, account };
  }

  const expense = (accountId: string, overrides: Record<string, unknown> = {}) => ({
    type: 'expense',
    accountId,
    categoryId: GROCERIES,
    amount: '450000',
    occurredOn: '2026-03-01',
    ...overrides,
  });

  async function createTransaction(user: User, body: object) {
    const res = await as(user).post('/transactions', body).expect(201);
    return res.body as Record<string, string | null> & { id: string };
  }

  async function rejectedFields(res: request.Response): Promise<string[]> {
    expect(res.status).toBe(400);
    expect(res.headers['content-type']).toMatch(/^application\/problem\+json/);
    return (res.body.errors as { path: string }[]).map((issue) => issue.path);
  }

  describe('POST /transactions', () => {
    it('records an expense for the authenticated user and returns it', async () => {
      const { user, account } = await newLedger();

      const res = await as(user)
        .post('/transactions', expense(account.id, { description: '  Weekly shop ' }))
        .expect(201);

      expect(res.headers.location).toBe(`/transactions/${res.body.id}`);
      expect(Object.keys(res.body).sort()).toEqual([
        'accountId',
        'amount',
        'categoryId',
        'createdAt',
        'currency',
        'description',
        'id',
        'occurredOn',
        'type',
        'updatedAt',
      ]);
      expect(res.body).toMatchObject({
        type: 'expense',
        accountId: account.id,
        categoryId: GROCERIES,
        amount: '450000',
        currency: 'AMD',
        occurredOn: '2026-03-01',
        description: 'Weekly shop',
      });
      expect(res.body.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7/);
      const stored = await prisma.transaction.findUniqueOrThrow({ where: { id: res.body.id } });
      expect(stored.userId).toBe(user.id);
      expect(stored.amount).toBe(450_000n);
    });

    it('records an income on an income category', async () => {
      const { user, account } = await newLedger();

      const created = await createTransaction(
        user,
        expense(account.id, { type: 'income', categoryId: SALARY, amount: '90000000' }),
      );

      expect(created).toMatchObject({ type: 'income', amount: '90000000', description: null });
    });

    it("accepts the user's own category and a top-level system category", async () => {
      const { user, account } = await newLedger();
      const own = await createCategory(user, { parentId: FOOD });

      await createTransaction(user, expense(account.id, { categoryId: own.id }));
      await createTransaction(user, expense(account.id, { categoryId: FOOD }));
    });

    it('accepts the opening date itself and stores a blank description as null', async () => {
      const { user, account } = await newLedger();

      const created = await createTransaction(
        user,
        expense(account.id, { occurredOn: '2026-01-01', description: '   ' }),
      );

      expect(created.description).toBeNull();
    });

    it.each([
      ['zero', '0'],
      ['negative', '-450000'],
      ['a JSON number', 450000],
      ['a decimal', '4500.50'],
      ['an exponent', '45e4'],
      ['above the limit', '1000000000000000'],
      ['missing', undefined],
    ])('rejects an amount that is %s', async (_label, amount) => {
      const { user, account } = await newLedger();

      const res = await as(user).post('/transactions', expense(account.id, { amount }));

      expect(await rejectedFields(res)).toEqual(['amount']);
      expect(await prisma.transaction.count({ where: { userId: user.id } })).toBe(0);
    });

    it.each([
      ['an unknown type', { type: 'transfer_out' }, ['type']],
      ['a malformed account id', { accountId: 'abc' }, ['accountId']],
      ['a malformed category id', { categoryId: 'abc' }, ['categoryId']],
      ['an impossible date', { occurredOn: '2026-02-30' }, ['occurredOn']],
      ['a date in another format', { occurredOn: '01.03.2026' }, ['occurredOn']],
      ['a future date', { occurredOn: '2999-01-01' }, ['occurredOn']],
      ['a description over 255 characters', { description: 'x'.repeat(256) }, ['description']],
      ['a description with a line break', { description: 'a\nb' }, ['description']],
    ])('rejects %s', async (_label, overrides, paths) => {
      const { user, account } = await newLedger();

      const res = await as(user).post('/transactions', expense(account.id, overrides));

      expect(await rejectedFields(res)).toEqual(paths);
    });

    it.each([['userId'], ['currency'], ['id'], ['balance']])(
      'rejects an attempt to set %s',
      async (field) => {
        const { user, account } = await newLedger();

        const res = await as(user).post(
          '/transactions',
          expense(account.id, { [field]: field === 'currency' ? 'AMD' : randomUUID() }),
        );

        expect(res.status).toBe(400);
      },
    );

    it('rejects a date before the account was opened', async () => {
      const { user, account } = await newLedger();

      const res = await as(user).post(
        '/transactions',
        expense(account.id, { occurredOn: '2025-12-31' }),
      );

      expect(await rejectedFields(res)).toEqual(['occurredOn']);
      expect(res.body.errors[0].message).toBe(
        "Must not be before the account's opening date (2026-01-01)",
      );
    });

    it.each([
      ['an expense on an income category', { type: 'expense', categoryId: SALARY }, 'expense'],
      ['an income on an expense category', { type: 'income', categoryId: GROCERIES }, 'income'],
    ])('rejects %s', async (_label, overrides, kind) => {
      const { user, account } = await newLedger();

      const res = await as(user).post('/transactions', expense(account.id, overrides));

      expect(await rejectedFields(res)).toEqual(['categoryId']);
      expect(res.body.errors[0].message).toBe(`Must be an ${kind} category`);
    });

    it("answers another user's category exactly like a missing one", async () => {
      const { user, account } = await newLedger();
      const foreign = await createCategory(await newUser());

      const [theirs, missing] = await Promise.all([
        as(user).post('/transactions', expense(account.id, { categoryId: foreign.id })),
        as(user).post('/transactions', expense(account.id, { categoryId: randomUUID() })),
      ]);

      expect(await rejectedFields(theirs)).toEqual(['categoryId']);
      expect(theirs.body).toEqual(missing.body);
    });

    it("answers another user's account exactly like a missing one", async () => {
      const user = await newUser();
      const foreign = await createAccount(await newUser());

      const [theirs, missing] = await Promise.all([
        as(user).post('/transactions', expense(foreign.id)),
        as(user).post('/transactions', expense(randomUUID())),
      ]);

      expect(await rejectedFields(theirs)).toEqual(['accountId']);
      expect(theirs.body).toEqual(missing.body);
      expect(await prisma.transaction.count({ where: { accountId: foreign.id } })).toBe(0);
    });

    it('refuses an archived account with 409', async () => {
      const { user, account } = await newLedger();
      await as(user).post(`/accounts/${account.id}/archive`).expect(200);

      const res = await as(user).post('/transactions', expense(account.id)).expect(409);

      expect(res.body.detail).toBe(
        'The account is archived. Restore it before changing its transactions.',
      );
    });

    it('refuses an archived category with 409', async () => {
      const { user, account } = await newLedger();
      const category = await createCategory(user);
      await as(user).post(`/categories/${category.id}/archive`).expect(200);

      const res = await as(user)
        .post('/transactions', expense(account.id, { categoryId: category.id }))
        .expect(409);

      expect(res.body.detail).toBe('The category is archived. Choose an active category.');
    });

    it('requires an access token', async () => {
      await http().post('/transactions').send(expense(randomUUID())).expect(401);
    });
  });

  describe('GET /transactions/:id', () => {
    it("returns the user's transaction", async () => {
      const { user, account } = await newLedger();
      const created = await createTransaction(user, expense(account.id));

      const res = await as(user).get(`/transactions/${created.id}`).expect(200);

      expect(res.body).toEqual(created);
    });

    it("answers another user's transaction exactly like a missing one", async () => {
      const { user, account } = await newLedger();
      const created = await createTransaction(user, expense(account.id));
      const other = await newUser();

      const theirs = await as(other).get(`/transactions/${created.id}`).expect(404);
      const missing = await as(other).get(`/transactions/${randomUUID()}`).expect(404);

      expect(theirs.body).toEqual(missing.body);
      expect(theirs.body.detail).toBe('Transaction not found.');
    });

    it('rejects a malformed id with 400', async () => {
      const user = await newUser();

      await as(user).get('/transactions/not-a-uuid').expect(400);
    });
  });

  describe('PATCH /transactions/:id', () => {
    it('changes the amount, date and description', async () => {
      const { user, account } = await newLedger();
      const created = await createTransaction(user, expense(account.id, { description: 'Old' }));

      const res = await as(user)
        .patch(`/transactions/${created.id}`, {
          amount: '500000',
          occurredOn: '2026-04-02',
          description: null,
        })
        .expect(200);

      expect(res.body).toMatchObject({
        id: created.id,
        amount: '500000',
        occurredOn: '2026-04-02',
        description: null,
        type: 'expense',
        categoryId: GROCERIES,
      });
    });

    it('changes the type together with a category of the new kind', async () => {
      const { user, account } = await newLedger();
      const created = await createTransaction(user, expense(account.id));

      const res = await as(user)
        .patch(`/transactions/${created.id}`, { type: 'income', categoryId: SALARY })
        .expect(200);

      expect(res.body).toMatchObject({ type: 'income', categoryId: SALARY });
    });

    it('rejects a type change that leaves the category of the other kind', async () => {
      const { user, account } = await newLedger();
      const created = await createTransaction(user, expense(account.id));

      const res = await as(user).patch(`/transactions/${created.id}`, { type: 'income' });

      expect(await rejectedFields(res)).toEqual(['categoryId']);
    });

    it('moves a transaction to another active account', async () => {
      const { user, account } = await newLedger();
      const other = await createAccount(user);
      const created = await createTransaction(user, expense(account.id));

      const res = await as(user)
        .patch(`/transactions/${created.id}`, { accountId: other.id })
        .expect(200);

      expect(res.body.accountId).toBe(other.id);
    });

    it('refuses to move a transaction before the new account was opened', async () => {
      const { user, account } = await newLedger();
      const later = await createAccount(user, { openingDate: '2026-06-01' });
      const created = await createTransaction(user, expense(account.id));

      const res = await as(user).patch(`/transactions/${created.id}`, { accountId: later.id });

      expect(await rejectedFields(res)).toEqual(['occurredOn']);
    });

    it("refuses to move a transaction to another user's or an archived account", async () => {
      const { user, account } = await newLedger();
      const archived = await createAccount(user);
      await as(user).post(`/accounts/${archived.id}/archive`).expect(200);
      const foreign = await createAccount(await newUser());
      const created = await createTransaction(user, expense(account.id));

      const theirs = await as(user).patch(`/transactions/${created.id}`, {
        accountId: foreign.id,
      });
      expect(await rejectedFields(theirs)).toEqual(['accountId']);
      await as(user).patch(`/transactions/${created.id}`, { accountId: archived.id }).expect(409);
    });

    it('keeps a category archived since it was assigned, but refuses to assign one', async () => {
      const { user, account } = await newLedger();
      const category = await createCategory(user);
      const created = await createTransaction(
        user,
        expense(account.id, { categoryId: category.id }),
      );
      await as(user).post(`/categories/${category.id}/archive`).expect(200);

      await as(user).patch(`/transactions/${created.id}`, { amount: '1' }).expect(200);

      const other = await createTransaction(user, expense(account.id));
      await as(user).patch(`/transactions/${other.id}`, { categoryId: category.id }).expect(409);
    });

    it('refuses any change while the account is archived', async () => {
      const { user, account } = await newLedger();
      const created = await createTransaction(user, expense(account.id));
      await as(user).post(`/accounts/${account.id}/archive`).expect(200);

      await as(user).patch(`/transactions/${created.id}`, { amount: '1' }).expect(409);

      const stored = await prisma.transaction.findUniqueOrThrow({ where: { id: created.id } });
      expect(stored.amount).toBe(450_000n);
    });

    it("answers another user's transaction with 404 and changes nothing", async () => {
      const { user, account } = await newLedger();
      const created = await createTransaction(user, expense(account.id));

      await as(await newUser())
        .patch(`/transactions/${created.id}`, { amount: '1' })
        .expect(404);

      const stored = await prisma.transaction.findUniqueOrThrow({ where: { id: created.id } });
      expect(stored.amount).toBe(450_000n);
    });

    it.each([
      ['an empty patch', {}],
      ['a zero amount', { amount: '0' }],
      ['a change of owner', { userId: randomUUID() }],
      ['a change of currency', { currency: 'USD' }],
    ])('rejects %s', async (_label, body) => {
      const { user, account } = await newLedger();
      const created = await createTransaction(user, expense(account.id));

      await as(user).patch(`/transactions/${created.id}`, body).expect(400);
    });
  });

  describe('DELETE /transactions/:id', () => {
    it('deletes the transaction for good', async () => {
      const { user, account } = await newLedger();
      const created = await createTransaction(user, expense(account.id));

      await as(user).delete(`/transactions/${created.id}`).expect(204);

      await as(user).get(`/transactions/${created.id}`).expect(404);
      expect(await prisma.transaction.count({ where: { id: created.id } })).toBe(0);
    });

    it("answers another user's transaction with 404 and keeps it", async () => {
      const { user, account } = await newLedger();
      const created = await createTransaction(user, expense(account.id));

      await as(await newUser())
        .delete(`/transactions/${created.id}`)
        .expect(404);

      expect(await prisma.transaction.count({ where: { id: created.id } })).toBe(1);
    });

    it('refuses while the account is archived', async () => {
      const { user, account } = await newLedger();
      const created = await createTransaction(user, expense(account.id));
      await as(user).post(`/accounts/${account.id}/archive`).expect(200);

      await as(user).delete(`/transactions/${created.id}`).expect(409);

      expect(await prisma.transaction.count({ where: { id: created.id } })).toBe(1);
    });
  });

  describe('GET /transactions', () => {
    /** Collects every page, following nextCursor. */
    async function allPages(user: User, query: string) {
      const pages: { id: string; occurredOn: string }[][] = [];
      let cursor: string | null = null;
      do {
        const res: request.Response = await as(user)
          .get(`/transactions?${query}${cursor ? `&cursor=${cursor}` : ''}`)
          .expect(200);
        pages.push(res.body.items);
        cursor = res.body.nextCursor;
      } while (cursor);
      return pages;
    }

    it('lists newest first, the latest added first within a day, across pages', async () => {
      const { user, account } = await newLedger();
      const dates = ['2026-03-01', '2026-03-03', '2026-03-03', '2026-03-02', '2026-03-03'];
      const created = [];
      for (const occurredOn of dates) {
        created.push(await createTransaction(user, expense(account.id, { occurredOn })));
      }

      const pages = await allPages(user, 'limit=2');

      expect(pages.map((page) => page.length)).toEqual([2, 2, 1]);
      expect(pages.flat().map((item) => item.id)).toEqual(
        [created[4], created[2], created[1], created[3], created[0]].map((item) => item!.id),
      );
    });

    it('neither repeats nor skips a row when one is added between pages', async () => {
      const { user, account } = await newLedger();
      for (const day of ['01', '02', '03', '04']) {
        await createTransaction(user, expense(account.id, { occurredOn: `2026-03-${day}` }));
      }
      const first = await as(user).get('/transactions?limit=2').expect(200);

      // Newer than everything already shown: it belongs before the cursor.
      await createTransaction(user, expense(account.id, { occurredOn: '2026-03-05' }));
      const second = await as(user)
        .get(`/transactions?limit=2&cursor=${first.body.nextCursor}`)
        .expect(200);

      expect(second.body.items.map((item: { occurredOn: string }) => item.occurredOn)).toEqual([
        '2026-03-02',
        '2026-03-01',
      ]);
      expect(second.body.nextCursor).toBeNull();
    });

    it('shows only the caller’s transactions', async () => {
      const { user, account } = await newLedger();
      const mine = await createTransaction(user, expense(account.id));
      const other = await newLedger();
      await createTransaction(other.user, expense(other.account.id));

      const res = await as(user).get('/transactions').expect(200);

      expect(res.body).toEqual({ items: [mine], nextCursor: null });
    });

    it('filters by account, category, type and an inclusive date range', async () => {
      const { user, account } = await newLedger();
      const second = await createAccount(user);
      const salary = await createTransaction(
        user,
        expense(account.id, { type: 'income', categoryId: SALARY, occurredOn: '2026-03-10' }),
      );
      const food = await createTransaction(
        user,
        expense(account.id, { categoryId: FOOD, occurredOn: '2026-03-05' }),
      );
      const groceries = await createTransaction(
        user,
        expense(second.id, { occurredOn: '2026-03-01' }),
      );

      const ids = async (query: string) => {
        const res = await as(user).get(`/transactions?${query}`).expect(200);
        return res.body.items.map((item: { id: string }) => item.id);
      };

      expect(await ids(`accountId=${second.id}`)).toEqual([groceries.id]);
      expect(await ids(`categoryId=${FOOD}`)).toEqual([food.id]);
      expect(await ids('type=income')).toEqual([salary.id]);
      expect(await ids('from=2026-03-05&to=2026-03-10')).toEqual([salary.id, food.id]);
      expect(await ids('to=2026-03-01')).toEqual([groceries.id]);
      expect(await ids(`accountId=${account.id}&type=expense`)).toEqual([food.id]);
      // An account the caller can't see simply matches nothing.
      expect(await ids(`accountId=${randomUUID()}`)).toEqual([]);
    });

    it.each([
      ['a limit of 0', 'limit=0'],
      ['a limit over 100', 'limit=101'],
      ['a non-numeric limit', 'limit=ten'],
      ['a malformed cursor', 'cursor=bm90LWEtY3Vyc29y'],
      ['from after to', 'from=2026-03-02&to=2026-03-01'],
      ['an unknown type', 'type=transfer_in'],
      ['an unknown parameter', 'sort=amount'],
    ])('rejects %s', async (_label, query) => {
      const user = await newUser();

      await as(user).get(`/transactions?${query}`).expect(400);
    });
  });

  describe('account balances', () => {
    const balanceOf = async (user: User, accountId: string) =>
      (await as(user).get(`/accounts/${accountId}`).expect(200)).body.balance as string;

    it('is the opening balance plus income minus expenses', async () => {
      const { user, account } = await newLedger(); // opening balance 100000
      await createTransaction(
        user,
        expense(account.id, { type: 'income', categoryId: SALARY, amount: '90000000' }),
      );
      await createTransaction(user, expense(account.id, { amount: '450000' }));
      await createTransaction(user, expense(account.id, { amount: '1' }));

      // 100000 + 90000000 - 450000 - 1
      expect(await balanceOf(user, account.id)).toBe('89649999');
    });

    it('can go below zero', async () => {
      const { user, account } = await newLedger();

      await createTransaction(user, expense(account.id, { amount: '250000' }));

      expect(await balanceOf(user, account.id)).toBe('-150000');
    });

    it('follows edits, moves between accounts and deletes', async () => {
      const { user, account } = await newLedger();
      const other = await createAccount(user, { openingBalance: '0' });
      const created = await createTransaction(user, expense(account.id, { amount: '30000' }));
      expect(await balanceOf(user, account.id)).toBe('70000');

      await as(user).patch(`/transactions/${created.id}`, { amount: '40000' }).expect(200);
      expect(await balanceOf(user, account.id)).toBe('60000');

      await as(user)
        .patch(`/transactions/${created.id}`, { type: 'income', categoryId: SALARY })
        .expect(200);
      expect(await balanceOf(user, account.id)).toBe('140000');

      await as(user).patch(`/transactions/${created.id}`, { accountId: other.id }).expect(200);
      expect(await balanceOf(user, account.id)).toBe('100000');
      expect(await balanceOf(user, other.id)).toBe('40000');

      await as(user).delete(`/transactions/${created.id}`).expect(204);
      expect(await balanceOf(user, other.id)).toBe('0');
    });

    it('stays exact at the largest amounts, beyond what a JS number holds', async () => {
      const { user, account } = await newLedger();
      for (let i = 0; i < 12; i++) {
        await createTransaction(
          user,
          expense(account.id, { type: 'income', categoryId: SALARY, amount: '999999999999999' }),
        );
      }

      // 100000 + 12 × 999999999999999, far above 2^53.
      expect(await balanceOf(user, account.id)).toBe('12000000000099988');
    });

    it('is listed for every account, including archived ones', async () => {
      const { user, account } = await newLedger();
      const archived = await createAccount(user, { openingBalance: '5000' });
      await createTransaction(user, expense(account.id, { amount: '1000' }));
      await createTransaction(user, expense(archived.id, { amount: '2000' }));
      await as(user).post(`/accounts/${archived.id}/archive`).expect(200);

      const res = await as(user).get('/accounts?status=all').expect(200);

      const balances = Object.fromEntries(
        res.body.items.map((item: { id: string; balance: string }) => [item.id, item.balance]),
      );
      expect(balances).toEqual({ [account.id]: '99000', [archived.id]: '3000' });
    });

    it("never counts another user's transactions", async () => {
      const { user, account } = await newLedger();
      const other = await newLedger();
      await createTransaction(other.user, expense(other.account.id, { amount: '7000' }));

      expect(await balanceOf(user, account.id)).toBe('100000');
    });

    it('is returned by every account write', async () => {
      const { user, account } = await newLedger();
      await createTransaction(user, expense(account.id, { amount: '1000' }));

      const renamed = await as(user).patch(`/accounts/${account.id}`, { name: 'Renamed' });
      const archived = await as(user).post(`/accounts/${account.id}/archive`);
      const restored = await as(user).post(`/accounts/${account.id}/restore`);

      expect([renamed, archived, restored].map((res) => res.body.balance)).toEqual([
        '99000',
        '99000',
        '99000',
      ]);
    });
  });

  describe('concurrency', () => {
    /**
     * Runs `hold` in a transaction that keeps its locks, sends the request,
     * waits until PostgreSQL reports the request waiting on a lock, then
     * commits the holder. The request's outcome therefore shows what it saw
     * after waiting, deterministically, not by the luck of timing.
     */
    async function whileLocked(
      hold: (tx: Prisma.TransactionClient) => Promise<unknown>,
      send: () => request.Test,
    ): Promise<request.Response> {
      let release!: () => void;
      const released = new Promise<void>((resolve) => (release = resolve));
      let holding!: () => void;
      const held = new Promise<void>((resolve) => (holding = resolve));
      const holder = prisma.$transaction(
        async (tx) => {
          await hold(tx);
          holding();
          await released;
        },
        { maxWait: 10_000, timeout: 20_000 },
      );
      await Promise.race([held, holder]);

      let finished = false;
      const response = send().then((res) => {
        finished = true;
        return res;
      });
      for (let attempt = 0; attempt < 400 && !finished; attempt++) {
        const [row] = await prisma.$queryRaw<{ waiting: bigint }[]>`
          SELECT count(*) AS waiting FROM pg_stat_activity
          WHERE datname = current_database() AND wait_event_type = 'Lock'`;
        if (Number(row?.waiting) > 0) break;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      release();
      await holder;
      return response;
    }

    const archiveAccount = (id: string) => (tx: Prisma.TransactionClient) =>
      tx.$executeRaw`UPDATE accounts SET archived_at = GREATEST(now(), created_at) WHERE id = ${id}::uuid`;

    it('makes a new transaction wait for an archive of its account in progress', async () => {
      const { user, account } = await newLedger();

      const res = await whileLocked(archiveAccount(account.id), () =>
        as(user).post('/transactions', expense(account.id)),
      );

      expect(res.status).toBe(409);
      expect(await prisma.transaction.count({ where: { accountId: account.id } })).toBe(0);
    });

    it('makes an account archive wait for a transaction being recorded on it', async () => {
      const { user, account } = await newLedger();

      const res = await whileLocked(
        (tx) => tx.$queryRaw`SELECT id FROM accounts WHERE id = ${account.id}::uuid FOR SHARE`,
        () => as(user).post(`/accounts/${account.id}/archive`),
      );

      expect(res.status).toBe(200);
    });

    it('makes an edit wait for an archive of the account in progress', async () => {
      const { user, account } = await newLedger();
      const created = await createTransaction(user, expense(account.id));

      const res = await whileLocked(archiveAccount(account.id), () =>
        as(user).patch(`/transactions/${created.id}`, { amount: '1' }),
      );

      expect(res.status).toBe(409);
      const stored = await prisma.transaction.findUniqueOrThrow({ where: { id: created.id } });
      expect(stored.amount).toBe(450_000n);
    });

    it('makes a delete wait for an archive of the account in progress', async () => {
      const { user, account } = await newLedger();
      const created = await createTransaction(user, expense(account.id));

      const res = await whileLocked(archiveAccount(account.id), () =>
        as(user).delete(`/transactions/${created.id}`),
      );

      expect(res.status).toBe(409);
      expect(await prisma.transaction.count({ where: { id: created.id } })).toBe(1);
    });

    it('makes a new transaction wait for an archive of its category in progress', async () => {
      const { user, account } = await newLedger();
      const category = await createCategory(user);

      const res = await whileLocked(
        (tx) =>
          tx.$executeRaw`UPDATE categories SET archived_at = GREATEST(now(), created_at) WHERE id = ${category.id}::uuid`,
        () => as(user).post('/transactions', expense(account.id, { categoryId: category.id })),
      );

      expect(res.status).toBe(409);
    });

    it('lets many transactions be recorded on one account at once, losing none', async () => {
      const { user, account } = await newLedger();

      const responses = await Promise.all(
        Array.from({ length: 12 }, () => as(user).post('/transactions', expense(account.id))),
      );

      expect(responses.map((res) => res.status)).toEqual(Array(12).fill(201));
      expect(await prisma.transaction.count({ where: { accountId: account.id } })).toBe(12);
      // 100000 - 12 × 450000: no write was lost.
      const res = await as(user).get(`/accounts/${account.id}`).expect(200);
      expect(res.body.balance).toBe('-5300000');
    });
  });
});
