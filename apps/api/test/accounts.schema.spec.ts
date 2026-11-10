import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '../src/generated/prisma/client';
import { applyMigrations } from './support/migrations';
import { violation } from './support/postgres';

/**
 * Verifies the accounts table as PostgreSQL enforces it. Every test creates
 * its own user, so none depends on another.
 */
describe('accounts table', () => {
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

  /** Inserts with raw SQL, so the database's own rules are what is tested. */
  function insert(
    userId: string,
    overrides: Partial<{
      name: string;
      type: string;
      currency: string;
      balance: bigint;
      date: string;
    }> = {},
  ) {
    const row = {
      name: 'Main',
      type: 'checking',
      currency: 'AMD',
      balance: 0n,
      date: '2026-01-01',
      ...overrides,
    };
    return prisma.$executeRaw`
      INSERT INTO accounts (user_id, name, type, currency, is_liquid, opening_balance, opening_date)
      VALUES (${userId}::uuid, ${row.name}, ${row.type}::account_type, ${row.currency}, true,
              ${row.balance}, ${row.date}::date)`;
  }

  it('is created by the third migration', async () => {
    const rows = await prisma.$queryRaw<{ migration_name: string }[]>`
      SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL`;

    expect(rows.map((row) => row.migration_name)).toContainEqual(
      expect.stringMatching(/^\d{14}_add_accounts$/),
    );
  });

  it('stores an account with database-generated id and timestamps, and no balance column', async () => {
    const userId = await newUser();
    await insert(userId, { balance: -150_000n });

    const account = await prisma.account.findFirstOrThrow({ where: { userId } });
    const columns = await prisma.$queryRaw<{ column_name: string }[]>`
      SELECT column_name FROM information_schema.columns WHERE table_name = 'accounts'`;

    expect(account.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7/);
    expect(account.openingBalance).toBe(-150_000n);
    expect(account.archivedAt).toBeNull();
    expect(account.updatedAt).toBeInstanceOf(Date);
    expect(columns.map((column) => column.column_name)).not.toContain('balance');
  });

  describe('opening balance', () => {
    it.each([999_999_999_999_999n, -999_999_999_999_999n, 0n])(
      'accepts %s minor units',
      async (balance) => {
        await expect(insert(await newUser(), { balance })).resolves.toBe(1);
      },
    );

    it.each([1_000_000_000_000_000n, -1_000_000_000_000_000n])(
      'rejects %s minor units',
      async (balance) => {
        const error = await violation(insert(await newUser(), { balance }));

        expect(error.code).toBe('23514');
        expect(error.message).toContain('accounts_opening_balance_range_check');
      },
    );

    it('cannot hold a fraction: the column is a bigint', async () => {
      const [column] = await prisma.$queryRaw<{ data_type: string }[]>`
        SELECT data_type FROM information_schema.columns
        WHERE table_name = 'accounts' AND column_name = 'opening_balance'`;

      expect(column?.data_type).toBe('bigint');
    });
  });

  describe('names', () => {
    it.each([
      ['empty', ''],
      ['surrounding whitespace', ' Main '],
      ['longer than 64 characters', 'a'.repeat(65)],
      ['a control character', 'Main\taccount'],
    ])('rejects a name that is %s', async (_case, name) => {
      const error = await violation(insert(await newUser(), { name }));

      expect(error.code).toBe('23514');
      expect(error.message).toContain('accounts_name_check');
    });

    it('accepts 64 characters and non-Latin letters', async () => {
      await expect(insert(await newUser(), { name: 'Ա'.repeat(64) })).resolves.toBe(1);
    });

    it('rejects a second active account with the same name in any case', async () => {
      const userId = await newUser();
      await insert(userId, { name: 'Main' });

      const error = await violation(insert(userId, { name: 'MAIN' }));

      expect(error.code).toBe('23505');
      expect(error.message).toContain('accounts_active_name_key');
    });

    it('frees the name of an archived account', async () => {
      const userId = await newUser();
      await insert(userId, { name: 'Main' });
      await prisma.account.updateMany({ where: { userId }, data: { archivedAt: new Date() } });

      await expect(insert(userId, { name: 'Main' })).resolves.toBe(1);
    });

    it('lets different users use the same name', async () => {
      await insert(await newUser(), { name: 'Main' });

      await expect(insert(await newUser(), { name: 'Main' })).resolves.toBe(1);
    });
  });

  it('rejects a type outside the enum', async () => {
    const error = await violation(insert(await newUser(), { type: 'bank' }));

    expect(error.code).toBe('22P02');
    expect(error.message).toContain('account_type');
  });

  it.each(['amd', 'AM', 'A1D'])('rejects the currency %j', async (currency) => {
    const error = await violation(insert(await newUser(), { currency }));

    expect(error.code).toBe('23514');
    expect(error.message).toContain('accounts_currency_format_check');
  });

  it('rejects an opening date before 1900', async () => {
    const error = await violation(insert(await newUser(), { date: '1899-12-31' }));

    expect(error.code).toBe('23514');
    expect(error.message).toContain('accounts_opening_date_check');
  });

  it('rejects an archive time before the creation time', async () => {
    const userId = await newUser();
    await insert(userId);

    const error = await violation(prisma.$executeRaw`
      UPDATE accounts SET archived_at = created_at - interval '1 second' WHERE user_id = ${userId}::uuid`);

    expect(error.code).toBe('23514');
    expect(error.message).toContain('accounts_archived_after_creation_check');
  });

  describe('ownership', () => {
    it('rejects an account for a user that does not exist', async () => {
      const error = await violation(insert(randomUUID()));

      expect(error.code).toBe('23503');
      expect(error.message).toContain('accounts_user_id_fkey');
    });

    it('refuses to delete a user who owns accounts', async () => {
      const userId = await newUser();
      await insert(userId);

      const error = await violation(
        prisma.$executeRaw`DELETE FROM users WHERE id = ${userId}::uuid`,
      );

      expect(error.code).toBe('23001');
      expect(error.message).toContain('accounts_user_id_fkey');
    });
  });

  it('serves a user-scoped listing from the (user_id, id) index', async () => {
    // With a near-empty table the planner would scan it sequentially, so
    // sequential scans are disabled for this one transaction.
    const plan = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET LOCAL enable_seqscan = off');
      return tx.$queryRawUnsafe<{ 'QUERY PLAN': string }[]>(
        `EXPLAIN SELECT id FROM accounts WHERE user_id = '${randomUUID()}' ORDER BY id`,
      );
    });

    expect(plan.map((line) => line['QUERY PLAN']).join('\n')).toContain('accounts_user_id_id_idx');
  });
});
