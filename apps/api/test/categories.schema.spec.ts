import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '../src/generated/prisma/client';
import { applyMigrations } from './support/migrations';
import { violation } from './support/postgres';

/** Fixed ids from the seed migration. */
const SALARY = '00000000-0000-7000-8000-000000000001';
const HOUSING = '00000000-0000-7000-8000-000000000006';
const RENT = '00000000-0000-7000-8000-000000000007';
const FOOD = '00000000-0000-7000-8000-00000000000a';
const RESTAURANTS = '00000000-0000-7000-8000-00000000000c';

/**
 * Verifies the categories table as PostgreSQL enforces it, including the
 * seeded system categories. Every test creates its own user.
 */
describe('categories table', () => {
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
  async function insert(
    overrides: Partial<{
      id: string;
      userId: string | null;
      parentId: string | null;
      name: string;
      kind: string;
      nature: string | null;
    }> = {},
  ): Promise<string> {
    const row = {
      id: randomUUID(),
      userId: null,
      parentId: null,
      name: `Category ${randomUUID().slice(0, 8)}`,
      kind: 'expense',
      nature: 'discretionary',
      ...overrides,
    };
    await prisma.$executeRaw`
      INSERT INTO categories (id, user_id, parent_id, name, kind, nature)
      VALUES (${row.id}::uuid, ${row.userId}::uuid, ${row.parentId}::uuid, ${row.name},
              ${row.kind}::category_kind, ${row.nature}::category_nature)`;
    return row.id;
  }

  describe('system categories', () => {
    it('are created by the seed migration after the table migration', async () => {
      const rows = await prisma.$queryRaw<{ migration_name: string }[]>`
        SELECT migration_name FROM _prisma_migrations
        WHERE finished_at IS NOT NULL ORDER BY migration_name`;
      const names = rows.map((row) => row.migration_name.slice(15));

      expect(names.indexOf('seed_system_categories')).toBe(names.indexOf('add_categories') + 1);
    });

    it('are the agreed set: 5 income and 12 expense top-level, 19 subcategories', async () => {
      const system = await prisma.category.findMany({ where: { userId: null } });
      const top = (kind: string) =>
        system.filter((c) => c.kind === kind && c.parentId === null).length;

      expect(system).toHaveLength(36);
      expect(top('income')).toBe(5);
      expect(top('expense')).toBe(12);
      expect(system.filter((c) => c.parentId !== null)).toHaveLength(19);
      expect(system.every((c) => c.archivedAt === null)).toBe(true);
    });

    it('keep their fixed ids', async () => {
      const byId = async (id: string) => prisma.category.findUniqueOrThrow({ where: { id } });

      expect(await byId(SALARY)).toMatchObject({ name: 'Salary', kind: 'income', nature: null });
      expect(await byId(HOUSING)).toMatchObject({ name: 'Housing', nature: 'essential_fixed' });
      expect(await byId(RENT)).toMatchObject({ name: 'Rent', parentId: HOUSING });
      expect(await byId(RESTAURANTS)).toMatchObject({
        name: 'Restaurants',
        parentId: FOOD,
        nature: 'discretionary',
      });
    });

    it('sort before every real UUIDv7, parents before their subcategories', async () => {
      const userId = await newUser();
      const custom = await prisma.category.create({
        data: { userId, name: 'Mine', kind: 'expense', nature: 'discretionary' },
      });
      const ordered = await prisma.category.findMany({
        where: { OR: [{ userId: null }, { userId }] },
        orderBy: { id: 'asc' },
      });
      const position = new Map(ordered.map((c, index) => [c.id, index]));

      expect(ordered.at(-1)?.id).toBe(custom.id);
      for (const category of ordered.filter((c) => c.parentId)) {
        expect(position.get(category.parentId!)).toBeLessThan(position.get(category.id)!);
      }
    });

    it('are not inserted again when migrations are deployed again', async () => {
      const before = await prisma.category.count({ where: { userId: null } });

      await applyMigrations(postgres.getConnectionUri());

      await expect(prisma.category.count({ where: { userId: null } })).resolves.toBe(before);
    });
  });

  describe('names', () => {
    it.each([
      ['empty', ''],
      ['surrounding whitespace', ' Food '],
      ['longer than 64 characters', 'a'.repeat(65)],
      ['a control character', 'Food\tcourt'],
    ])('rejects a name that is %s', async (_case, name) => {
      const error = await violation(insert({ userId: await newUser(), name }));

      expect(error.code).toBe('23514');
      expect(error.message).toContain('categories_name_check');
    });

    it('rejects a name that is not in Unicode NFC form', async () => {
      const error = await violation(insert({ userId: await newUser(), name: 'Café' }));

      expect(error.code).toBe('23514');
      expect(error.message).toContain('categories_name_nfc_check');
    });

    it('accepts Armenian names', async () => {
      await expect(insert({ userId: await newUser(), name: 'Սնունդ' })).resolves.toBeDefined();
    });
  });

  describe('nature', () => {
    it('is required for an expense category', async () => {
      const error = await violation(insert({ userId: await newUser(), nature: null }));

      expect(error.code).toBe('23514');
      expect(error.message).toContain('categories_nature_check');
    });

    it('is forbidden for an income category', async () => {
      const error = await violation(
        insert({ userId: await newUser(), kind: 'income', nature: 'discretionary' }),
      );

      expect(error.code).toBe('23514');
      expect(error.message).toContain('categories_nature_check');
    });

    it('rejects a value outside the enum', async () => {
      const error = await violation(insert({ userId: await newUser(), nature: 'luxury' }));

      expect(error.code).toBe('22P02');
    });
  });

  describe('unique active names', () => {
    it('rejects the same name for one owner, parent and kind, in any case', async () => {
      const userId = await newUser();
      await insert({ userId, name: 'Coffee', parentId: FOOD });

      const error = await violation(insert({ userId, name: 'COFFEE', parentId: FOOD }));

      expect(error.code).toBe('23505');
      expect(error.message).toContain('categories_active_name_key');
    });

    it('treats top-level categories as siblings (NULL parents are not distinct)', async () => {
      const userId = await newUser();
      await insert({ userId, name: 'Pets' });

      const error = await violation(insert({ userId, name: 'pets' }));

      expect(error.code).toBe('23505');
    });

    it('treats system categories as one owner (NULL owners are not distinct)', async () => {
      const error = await violation(insert({ name: 'Food', nature: 'essential_variable' }));

      expect(error.code).toBe('23505');
      expect(error.message).toContain('categories_active_name_key');
    });

    it('allows a name under another parent, of another kind, or of another owner', async () => {
      const [userId, other] = [await newUser(), await newUser()];
      await insert({ userId, name: 'Gifts' });

      await insert({ userId, name: 'Gifts', kind: 'income', nature: null });
      await insert({ userId, name: 'Gifts', parentId: FOOD });
      await insert({ userId: other, name: 'Gifts' });
    });

    it("lets a user's name match a system category's", async () => {
      const userId = await newUser();

      await insert({ userId, name: 'Food' });
      await insert({ userId, name: 'Restaurants', parentId: FOOD });
    });

    it('frees the name of an archived category', async () => {
      const userId = await newUser();
      const id = await insert({ userId, name: 'Pets' });
      await prisma.category.update({ where: { id }, data: { archivedAt: new Date() } });

      await insert({ userId, name: 'Pets' });
    });
  });

  describe('parent rules', () => {
    it('rejects a third level', async () => {
      const userId = await newUser();
      const child = await insert({ userId, parentId: FOOD });

      const error = await violation(insert({ userId, parentId: child }));

      expect(error.code).toBe('23514');
      expect(error.message).toContain('a top-level category');
    });

    it('rejects a subcategory of the other kind', async () => {
      const error = await violation(
        insert({ userId: await newUser(), parentId: SALARY, kind: 'expense' }),
      );

      expect(error.code).toBe('23514');
      expect(error.message).toContain("its parent's kind");
    });

    it("rejects a subcategory under another user's category", async () => {
      const parent = await insert({ userId: await newUser() });

      const error = await violation(insert({ userId: await newUser(), parentId: parent }));

      expect(error.code).toBe('23514');
      expect(error.message).toContain('same owner');
    });

    it("rejects a system subcategory under a user's category", async () => {
      const parent = await insert({ userId: await newUser() });

      const error = await violation(insert({ userId: null, parentId: parent }));

      expect(error.code).toBe('23514');
      expect(error.message).toContain('same owner');
    });

    it("accepts a user's subcategory under a system or their own category", async () => {
      const userId = await newUser();
      const own = await insert({ userId });

      await insert({ userId, parentId: FOOD });
      await insert({ userId, parentId: own });
    });

    it('rejects a category that is its own parent', async () => {
      const id = randomUUID();

      const error = await violation(insert({ id, userId: await newUser(), parentId: id }));

      expect(error.code).toBe('23514');
      expect(error.message).toContain('categories_not_own_parent_check');
    });

    it('rejects a parent that does not exist', async () => {
      const error = await violation(insert({ userId: await newUser(), parentId: randomUUID() }));

      expect(error.code).toBe('23503');
      expect(error.message).toContain('categories_parent_id_fkey');
    });
  });

  describe('immutability', () => {
    it.each([
      ['kind', `kind = 'income', nature = NULL`],
      ['parent', `parent_id = '${FOOD}'`],
      ['owner', 'user_id = NULL'],
    ])('rejects a change of %s', async (_field, assignment) => {
      const id = await insert({ userId: await newUser() });

      const error = await violation(
        prisma.$executeRawUnsafe(`UPDATE categories SET ${assignment} WHERE id = $1::uuid`, id),
      );

      expect(error.code).toBe('23514');
      expect(error.message).toContain('cannot change');
    });

    it('allows a rename, a change of nature and archiving', async () => {
      const id = await insert({ userId: await newUser() });

      await prisma.$executeRaw`
        UPDATE categories SET name = 'Renamed', nature = 'essential_fixed', archived_at = now()
        WHERE id = ${id}::uuid`;
    });
  });

  describe('ownership', () => {
    it('rejects a category for a user that does not exist', async () => {
      const error = await violation(insert({ userId: randomUUID() }));

      expect(error.code).toBe('23503');
      expect(error.message).toContain('categories_user_id_fkey');
    });

    it('refuses to delete a user who owns categories', async () => {
      const userId = await newUser();
      await insert({ userId });

      const error = await violation(
        prisma.$executeRaw`DELETE FROM users WHERE id = ${userId}::uuid`,
      );

      expect(error.code).toBe('23001');
      expect(error.message).toContain('categories_user_id_fkey');
    });

    it('refuses to delete a category that has subcategories', async () => {
      const userId = await newUser();
      const parent = await insert({ userId });
      await insert({ userId, parentId: parent });

      const error = await violation(
        prisma.$executeRaw`DELETE FROM categories WHERE id = ${parent}::uuid`,
      );

      expect(error.code).toBe('23001');
      expect(error.message).toContain('categories_parent_id_fkey');
    });
  });

  it('rejects an archive time before the creation time', async () => {
    const id = await insert({ userId: await newUser() });

    const error = await violation(prisma.$executeRaw`
      UPDATE categories SET archived_at = created_at - interval '1 second' WHERE id = ${id}::uuid`);

    expect(error.code).toBe('23514');
    expect(error.message).toContain('categories_archived_after_creation_check');
  });

  it("serves a user's listing from the (user_id, id) index", async () => {
    const plan = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET LOCAL enable_seqscan = off');
      return tx.$queryRawUnsafe<{ 'QUERY PLAN': string }[]>(
        `EXPLAIN SELECT id FROM categories WHERE user_id = '${randomUUID()}' ORDER BY id`,
      );
    });

    expect(plan.map((line) => line['QUERY PLAN']).join('\n')).toContain(
      'categories_user_id_id_idx',
    );
  });
});
