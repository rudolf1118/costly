import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startHttpServer } from './support/http';
import { applyMigrations } from './support/migrations';

const PASSWORD = 'correct horse battery staple';

/** Fixed ids from the seed migration. */
const SALARY = '00000000-0000-7000-8000-000000000001';
const FREELANCE = '00000000-0000-7000-8000-000000000002';
const RENT = '00000000-0000-7000-8000-000000000007';
const GROCERIES = '00000000-0000-7000-8000-00000000000b';
const TAXI = '00000000-0000-7000-8000-000000000010';
const TRAVEL = '00000000-0000-7000-8000-000000000022';

/** docs/02-requirements/dashboard-v1.md */
describe('GET /dashboard/summary', () => {
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

    const { AppModule } = await import('../src/app.module');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await startHttpServer(app);
  });

  afterAll(async () => {
    await app?.close();
    await Promise.all([postgres?.stop(), redis?.stop()]);
  });

  const http = () => request(app.getHttpServer());

  interface User {
    token: string;
  }

  async function newUser(): Promise<User> {
    const email = `user-${randomUUID()}@costly.test`;
    await http()
      .post('/auth/register')
      .send({ email, password: PASSWORD, timezone: 'Asia/Yerevan' })
      .expect(201);
    const login = await http().post('/auth/login').send({ email, password: PASSWORD }).expect(200);
    return { token: login.body.accessToken };
  }

  const as = (user: User) => ({
    get: (path: string) => http().get(path).set('Authorization', `Bearer ${user.token}`),
    post: (path: string, body?: object) =>
      http().post(path).set('Authorization', `Bearer ${user.token}`).send(body),
  });

  async function createAccount(user: User, overrides: Record<string, unknown> = {}) {
    const res = await as(user)
      .post('/accounts', {
        name: `Account ${randomUUID().slice(0, 8)}`,
        type: 'checking',
        openingBalance: '0',
        openingDate: '2024-01-01',
        ...overrides,
      })
      .expect(201);
    return res.body as { id: string; name: string };
  }

  async function record(
    user: User,
    accountId: string,
    type: 'income' | 'expense',
    categoryId: string,
    amount: string,
    occurredOn: string,
  ) {
    const res = await as(user)
      .post('/transactions', { type, accountId, categoryId, amount, occurredOn })
      .expect(201);
    return res.body as { id: string };
  }

  async function summary(user: User, month: string) {
    const res = await as(user).get(`/dashboard/summary?month=${month}`).expect(200);
    return res.body;
  }

  it('returns zeros, a full calendar and no comparison for a new user', async () => {
    const body = await summary(await newUser(), '2026-11');

    expect(body).toMatchObject({
      month: '2026-11',
      currency: 'AMD',
      income: '0',
      expense: '0',
      net: '0',
      transactionCount: 0,
      previous: { income: '0', expense: '0', net: '0' },
      balance: { total: '0', previousMonthEnd: null, accountCount: 0 },
      categories: [],
      recentTransactions: [],
      accounts: [],
    });
    expect(body.history.map((entry: { month: string }) => entry.month)).toEqual([
      '2025-12',
      '2026-01',
      '2026-02',
      '2026-03',
      '2026-04',
      '2026-05',
      '2026-06',
      '2026-07',
      '2026-08',
      '2026-09',
      '2026-10',
      '2026-11',
    ]);
    expect(body.history.every((m: { income: string }) => m.income === '0')).toBe(true);
    expect(body.daily).toHaveLength(30);
    expect(body.daily[0]).toEqual({ date: '2026-11-01', income: '0', expense: '0' });
    expect(body.daily.at(-1).date).toBe('2026-11-30');
  });

  it('has a day for 29 February in a leap year', async () => {
    const body = await summary(await newUser(), '2024-02');
    expect(body.daily).toHaveLength(29);
    expect(body.daily.at(-1).date).toBe('2024-02-29');
  });

  it('totals the month by occurred_on, inclusive of its first and last day', async () => {
    const user = await newUser();
    const account = await createAccount(user);
    // September, on its last day: the previous month.
    await record(user, account.id, 'income', SALARY, '50000000', '2026-09-30');
    await record(user, account.id, 'expense', RENT, '20000000', '2026-09-30');
    // October, first and last day.
    await record(user, account.id, 'income', SALARY, '60000000', '2026-10-01');
    await record(user, account.id, 'income', FREELANCE, '1500050', '2026-10-31');
    await record(user, account.id, 'expense', GROCERIES, '1234567', '2026-10-01');
    await record(user, account.id, 'expense', GROCERIES, '765433', '2026-10-31');
    // November 1st, and a day before the 12-month window: in neither total.
    await record(user, account.id, 'expense', TAXI, '99900', '2026-11-01');
    await record(user, account.id, 'expense', TAXI, '99900', '2025-10-31');

    const body = await summary(user, '2026-10');

    expect(body).toMatchObject({
      income: '61500050',
      expense: '2000000',
      net: '59500050',
      transactionCount: 4,
      previous: { income: '50000000', expense: '20000000', net: '30000000' },
    });
    expect(body.history[0]).toEqual({ month: '2025-11', income: '0', expense: '0' });
    expect(body.history.at(-2)).toEqual({
      month: '2026-09',
      income: '50000000',
      expense: '20000000',
    });
    expect(body.daily).toHaveLength(31);
    expect(body.daily[0]).toEqual({ date: '2026-10-01', income: '60000000', expense: '1234567' });
    expect(body.daily[30]).toEqual({ date: '2026-10-31', income: '1500050', expense: '765433' });
  });

  it('reports a negative net when spending exceeds income', async () => {
    const user = await newUser();
    const account = await createAccount(user, { openingBalance: '100000000' });
    await record(user, account.id, 'income', SALARY, '1000', '2026-09-10');
    await record(user, account.id, 'expense', TRAVEL, '5000', '2026-09-11');

    const body = await summary(user, '2026-09');

    expect(body.net).toBe('-4000');
  });

  it('groups expense by the category on the transaction, largest first, adding up to the total', async () => {
    const user = await newUser();
    const account = await createAccount(user);
    await record(user, account.id, 'expense', GROCERIES, '300000', '2026-08-02');
    await record(user, account.id, 'expense', GROCERIES, '200000', '2026-08-20');
    await record(user, account.id, 'expense', RENT, '15000000', '2026-08-01');
    await record(user, account.id, 'expense', TRAVEL, '500000', '2026-08-15');
    await record(user, account.id, 'income', SALARY, '90000000', '2026-08-01');
    // Another month: not in August's breakdown.
    await record(user, account.id, 'expense', TAXI, '120000', '2026-07-31');

    const body = await summary(user, '2026-08');

    expect(body.categories).toEqual([
      {
        categoryId: RENT,
        name: 'Rent',
        parentName: 'Housing',
        amount: '15000000',
        transactionCount: 1,
      },
      // A tie of 5,000 ֏: ordered by name.
      {
        categoryId: GROCERIES,
        name: 'Groceries',
        parentName: 'Food',
        amount: '500000',
        transactionCount: 2,
      },
      {
        categoryId: TRAVEL,
        name: 'Travel',
        parentName: null,
        amount: '500000',
        transactionCount: 1,
      },
    ]);
    const total = body.categories.reduce(
      (sum: bigint, category: { amount: string }) => sum + BigInt(category.amount),
      0n,
    );
    expect(total.toString()).toBe(body.expense);
  });

  it('lists the 8 latest transactions of the month in the list order, with names', async () => {
    const user = await newUser();
    const account = await createAccount(user, { name: 'Main card' });
    const ids: string[] = [];
    for (let day = 1; day <= 10; day += 1) {
      const date = `2026-06-${String(day).padStart(2, '0')}`;
      ids.push((await record(user, account.id, 'expense', TAXI, '1000', date)).id);
    }
    // Same day as the last one, added later: listed first.
    const latest = await record(user, account.id, 'income', SALARY, '5000', '2026-06-10');
    // July: not June's.
    await record(user, account.id, 'expense', TAXI, '1000', '2026-07-01');

    const body = await summary(user, '2026-06');

    expect(body.recentTransactions).toHaveLength(8);
    expect(body.recentTransactions.map((t: { id: string }) => t.id)).toEqual([
      latest.id,
      ...ids.slice(3).reverse(),
    ]);
    expect(body.recentTransactions[1]).toEqual({
      id: ids[9],
      type: 'expense',
      amount: '1000',
      currency: 'AMD',
      occurredOn: '2026-06-10',
      description: null,
      account: { id: account.id, name: 'Main card' },
      category: { id: TAXI, name: 'Taxi', parentName: 'Transport' },
    });
  });

  it('takes the balance at the end of each month, from active accounts open by then', async () => {
    const user = await newUser();
    const card = await createAccount(user, {
      openingBalance: '1000000',
      openingDate: '2026-01-01',
    });
    await createAccount(user, {
      type: 'savings',
      openingBalance: '5000000',
      openingDate: '2026-03-15',
    });
    const credit = await createAccount(user, {
      type: 'credit_card',
      openingBalance: '-200000',
      openingDate: '2026-02-01',
    });
    await record(user, card.id, 'income', SALARY, '300000', '2026-02-10');
    await record(user, card.id, 'expense', GROCERIES, '50000', '2026-03-31');
    await record(user, credit.id, 'expense', TRAVEL, '100000', '2026-04-01');

    // End of February: the card and the credit card are open, savings isn't.
    const february = await summary(user, '2026-02');
    expect(february.balance).toEqual({
      total: (1000000n + 300000n - 200000n).toString(),
      previousMonthEnd: '1000000',
      accountCount: 2,
    });

    // End of March: savings has opened; the expense on the 31st counts.
    const march = await summary(user, '2026-03');
    expect(march.balance).toEqual({
      total: (1250000n + 5000000n - 200000n).toString(),
      previousMonthEnd: '1100000',
      accountCount: 3,
    });

    // Before any account existed: nothing to compare with.
    const december = await summary(user, '2025-12');
    expect(december.balance).toEqual({ total: '0', previousMonthEnd: null, accountCount: 0 });
  });

  it('matches GET /accounts for the current balances and leaves archived accounts out', async () => {
    const user = await newUser();
    const card = await createAccount(user, { name: 'Card', openingBalance: '700000' });
    const old = await createAccount(user, { name: 'Old cash', type: 'cash', openingBalance: '0' });
    await record(user, card.id, 'expense', GROCERIES, '125000', '2026-05-05');
    await record(user, old.id, 'income', SALARY, '400000', '2026-05-06');
    await as(user).post(`/accounts/${old.id}/archive`).expect(200);

    const body = await summary(user, '2026-05');
    const accounts = await as(user).get('/accounts?status=active').expect(200);

    expect(body.accounts).toEqual([
      {
        id: card.id,
        name: 'Card',
        type: 'checking',
        currency: 'AMD',
        isLiquid: true,
        balance: accounts.body.items[0].balance,
      },
    ]);
    expect(body.accounts[0].balance).toBe('575000');
    // The archived account's income still happened in May; its balance isn't in the total.
    expect(body.income).toBe('400000');
    expect(body.balance.total).toBe('575000');
  });

  it('keeps sums beyond 2^53 exact', async () => {
    const user = await newUser();
    const account = await createAccount(user, { openingBalance: '999999999999999' });
    for (const day of ['01', '02', '03']) {
      await record(user, account.id, 'income', SALARY, '999999999999999', `2026-04-${day}`);
    }
    await record(user, account.id, 'expense', RENT, '999999999999999', '2026-04-04');

    const body = await summary(user, '2026-04');

    expect(body.income).toBe('2999999999999997');
    expect(body.expense).toBe('999999999999999');
    expect(body.net).toBe('1999999999999998');
    expect(body.balance.total).toBe('2999999999999997');
    expect(body.accounts[0].balance).toBe('2999999999999997');
  });

  it("never includes another user's ledger", async () => {
    const alice = await newUser();
    const bob = await newUser();
    const aliceAccount = await createAccount(alice, { openingBalance: '100' });
    await record(alice, aliceAccount.id, 'expense', GROCERIES, '42', '2026-10-05');
    const bobAccount = await createAccount(bob, { openingBalance: '900' });
    await record(bob, bobAccount.id, 'expense', TAXI, '7', '2026-10-05');

    const body = await summary(alice, '2026-10');

    expect(body.expense).toBe('42');
    expect(body.categories.map((c: { categoryId: string }) => c.categoryId)).toEqual([GROCERIES]);
    expect(body.recentTransactions).toHaveLength(1);
    expect(body.accounts.map((a: { id: string }) => a.id)).toEqual([aliceAccount.id]);
    expect(body.balance.total).toBe('58');
  });

  it('requires authentication', async () => {
    await http().get('/dashboard/summary?month=2026-11').expect(401);
  });

  it.each([
    ['a missing month', ''],
    ['a malformed month', '?month=2026-13'],
    ['a date instead of a month', '?month=2026-11-01'],
    ['an unknown parameter', '?month=2026-11&userId=x'],
  ])('refuses %s with a 400', async (_case, query) => {
    const user = await newUser();
    const res = await as(user).get(`/dashboard/summary${query}`).expect(400);
    expect(res.headers['content-type']).toMatch(/^application\/problem\+json/);
  });

  it('refuses a month in the future', async () => {
    const user = await newUser();
    const now = new Date();
    const future = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 2, 1));
    const month = future.toISOString().slice(0, 7);
    const res = await as(user).get(`/dashboard/summary?month=${month}`).expect(400);
    expect(res.body.errors).toEqual([{ path: 'month', message: 'Must not be in the future' }]);
  });
});
