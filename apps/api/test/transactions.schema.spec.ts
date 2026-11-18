import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '../src/generated/prisma/client';
import { applyMigrations } from './support/migrations';
import { violation } from './support/postgres';

/** Fixed ids from the seed migration. */
const SALARY = '00000000-0000-7000-8000-000000000001';
const GROCERIES = '00000000-0000-7000-8000-00000000000b';

/**
 * Verifies the transactions table as PostgreSQL enforces it: the rules hold
 * for any code path, not only for the API. Every test creates its own user.
 */
describe('transactions table', () => {
  let postgres: StartedPostgreSqlContainer;
  let prisma: PrismaClient;

  beforeAll(async () => {
    postgres = await new PostgreSqlContainer('postgres:18-alpine').start();
    await applyMigrations(postgres.getConnectionUri());
    prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: postgres.getConnectionUri() }),
    });
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    await postgres?.stop();
  });

  async function newUser(): Promise<string> {
    const user = await prisma.user.create({
      data: { email: `user-${randomUUID()}@costly.test`, passwordHash: 'hash', timezone: 'UTC' },
    });
    return user.id;
  }

  async function newAccount(userId: string, openingDate = '2026-01-01'): Promise<string> {
    const account = await prisma.account.create({
      data: {
        userId,
        name: `Account ${randomUUID().slice(0, 8)}`,
        type: 'checking',
        currency: 'AMD',
        isLiquid: true,
        openingBalance: 0n,
        openingDate: new Date(`${openingDate}T00:00:00Z`),
      },
    });
    return account.id;
  }

  async function newCategory(userId: string, kind: 'income' | 'expense'): Promise<string> {
    const category = await prisma.category.create({
      data: {
        userId,
        name: `Category ${randomUUID().slice(0, 8)}`,
        kind,
        nature: kind === 'expense' ? 'discretionary' : null,
      },
    });
    return category.id;
  }

  interface Row {
    userId: string;
    accountId: string;
    categoryId: string;
    type: string;
    amount: string;
    currency: string;
    occurredOn: string;
    description: string | null;
  }

  /** A user with an account; the row is a valid expense of theirs. */
  async function validRow(): Promise<Row> {
    const userId = await newUser();
    return {
      userId,
      accountId: await newAccount(userId),
      categoryId: GROCERIES,
      type: 'expense',
      amount: '450000',
      currency: 'AMD',
      occurredOn: '2026-03-01',
      description: null,
    };
  }

  /** Inserts with raw SQL, so the database's own rules are what is tested. */
  function insert(row: Row) {
    return prisma.$executeRaw`
      INSERT INTO transactions
        (user_id, account_id, category_id, type, amount, currency, occurred_on, description)
      VALUES (${row.userId}::uuid, ${row.accountId}::uuid, ${row.categoryId}::uuid,
        ${row.type}::transaction_type, ${row.amount}::bigint, ${row.currency},
        ${row.occurredOn}::date, ${row.description})`;
  }

  async function insertedId(row: Row): Promise<string> {
    const [inserted] = await prisma.$queryRaw<{ id: string }[]>`
      INSERT INTO transactions
        (user_id, account_id, category_id, type, amount, currency, occurred_on)
      VALUES (${row.userId}::uuid, ${row.accountId}::uuid, ${row.categoryId}::uuid,
        ${row.type}::transaction_type, ${row.amount}::bigint, ${row.currency},
        ${row.occurredOn}::date)
      RETURNING id`;
    return inserted!.id;
  }

  it('accepts a valid expense on a system category, with a UUIDv7 id', async () => {
    const id = await insertedId(await validRow());

    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7/);
  });

  it("accepts an income on the owner's own income category", async () => {
    const row = await validRow();
    const own = await newCategory(row.userId, 'income');

    await expect(insert({ ...row, type: 'income', categoryId: own })).resolves.toBe(1);
  });

  describe('amount', () => {
    it.each(['0', '-1', '-450000', '1000000000000000'])('rejects %s', async (amount) => {
      const rejected = await violation(insert({ ...(await validRow()), amount }));

      expect(rejected.code).toBe('23514');
      expect(rejected.message).toContain('transactions_amount_range_check');
    });

    it.each(['1', '999999999999999'])('accepts %s', async (amount) => {
      await expect(insert({ ...(await validRow()), amount })).resolves.toBe(1);
    });
  });

  describe('account', () => {
    it("rejects another user's account", async () => {
      const row = await validRow();
      const otherAccount = await newAccount(await newUser());

      const rejected = await violation(insert({ ...row, accountId: otherAccount }));

      expect(rejected.code).toBe('23503');
      expect(rejected.message).toContain('transactions_account_id_user_id_currency_fkey');
    });

    it("rejects a currency other than the account's", async () => {
      const rejected = await violation(insert({ ...(await validRow()), currency: 'USD' }));

      expect(rejected.code).toBe('23503');
      expect(rejected.message).toContain('transactions_account_id_user_id_currency_fkey');
    });

    it('rejects a date before the opening date, and accepts the opening date itself', async () => {
      const row = await validRow();

      const rejected = await violation(insert({ ...row, occurredOn: '2025-12-31' }));
      expect(rejected.code).toBe('23514');
      expect(rejected.message).toContain("predate its account's opening date");

      await expect(insert({ ...row, occurredOn: '2026-01-01' })).resolves.toBe(1);
    });

    it('cannot be deleted while it has transactions', async () => {
      const row = await validRow();
      await insert(row);

      const rejected = await violation(
        prisma.$executeRaw`DELETE FROM accounts WHERE id = ${row.accountId}::uuid`,
      );

      // RESTRICT reports restrict_violation.
      expect(rejected.code).toBe('23001');
    });

    it('cannot change currency while it has transactions', async () => {
      const row = await validRow();
      await insert(row);

      const rejected = await violation(
        prisma.$executeRaw`UPDATE accounts SET currency = 'USD' WHERE id = ${row.accountId}::uuid`,
      );

      expect(rejected.code).toBe('23001');
    });
  });

  describe('category', () => {
    it("rejects another user's category", async () => {
      const row = await validRow();
      const foreign = await newCategory(await newUser(), 'expense');

      const rejected = await violation(insert({ ...row, categoryId: foreign }));

      expect(rejected.code).toBe('23514');
      expect(rejected.message).toContain('a system category or its owner');
    });

    it.each([
      ['an expense', 'expense', SALARY],
      ['an income', 'income', GROCERIES],
    ])('rejects %s with a category of the other kind', async (_label, type, categoryId) => {
      const rejected = await violation(insert({ ...(await validRow()), type, categoryId }));

      expect(rejected.code).toBe('23514');
      expect(rejected.message).toContain('must be of its type');
    });

    it('rejects a nonexistent category', async () => {
      const rejected = await violation(insert({ ...(await validRow()), categoryId: randomUUID() }));

      expect(rejected.code).toBe('23503');
      expect(rejected.message).toContain('transactions_category_id_fkey');
    });

    it('cannot be deleted while transactions use it', async () => {
      const row = await validRow();
      const own = await newCategory(row.userId, 'expense');
      await insert({ ...row, categoryId: own });

      const rejected = await violation(
        prisma.$executeRaw`DELETE FROM categories WHERE id = ${own}::uuid`,
      );

      expect(rejected.code).toBe('23001');
    });
  });

  describe('updates', () => {
    it('rejects a change of owner', async () => {
      const row = await validRow();
      const id = await insertedId(row);
      const other = await newUser();

      const rejected = await violation(
        prisma.$executeRaw`UPDATE transactions SET user_id = ${other}::uuid WHERE id = ${id}::uuid`,
      );

      expect(rejected.code).toBe('23514');
      expect(rejected.message).toContain('owner cannot change');
    });

    it('applies the category and date rules to an update', async () => {
      const id = await insertedId(await validRow());

      const kind = await violation(
        prisma.$executeRaw`UPDATE transactions SET type = 'income' WHERE id = ${id}::uuid`,
      );
      expect(kind.message).toContain('must be of its type');

      const date = await violation(
        prisma.$executeRaw`UPDATE transactions SET occurred_on = '2025-06-01' WHERE id = ${id}::uuid`,
      );
      expect(date.message).toContain("predate its account's opening date");

      await expect(
        prisma.$executeRaw`UPDATE transactions SET type = 'income', category_id = ${SALARY}::uuid WHERE id = ${id}::uuid`,
      ).resolves.toBe(1);
    });

    it('rejects moving a transaction to an account opened after its date', async () => {
      const row = await validRow();
      const id = await insertedId(row);
      const later = await newAccount(row.userId, '2026-06-01');

      const rejected = await violation(
        prisma.$executeRaw`UPDATE transactions SET account_id = ${later}::uuid WHERE id = ${id}::uuid`,
      );

      expect(rejected.message).toContain("predate its account's opening date");
    });
  });

  describe('description', () => {
    it.each([
      ['empty', ''],
      ['untrimmed', ' Taxi'],
      ['too long', 'x'.repeat(256)],
      ['with a line break', 'Taxi\nhome'],
      ['not NFC', 'Café'],
    ])('rejects one that is %s', async (_label, description) => {
      const rejected = await violation(insert({ ...(await validRow()), description }));

      expect(rejected.code).toBe('23514');
      expect(rejected.message).toContain('transactions_description_check');
    });

    it.each([null, 'Taxi home', 'x'.repeat(255), 'Café'])('accepts %j', async (description) => {
      await expect(insert({ ...(await validRow()), description })).resolves.toBe(1);
    });
  });

  it('rejects a date before 1900', async () => {
    const row = await validRow();
    const old = await newAccount(row.userId, '1900-01-01');

    const rejected = await violation(insert({ ...row, accountId: old, occurredOn: '1899-12-31' }));

    expect(rejected.code).toBe('23514');
  });
});
