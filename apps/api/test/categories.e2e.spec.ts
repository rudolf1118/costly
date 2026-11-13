import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Prisma } from '../src/generated/prisma/client';
import { PrismaService } from '../src/platform/database/prisma.service';
import { startHttpServer } from './support/http';
import { applyMigrations } from './support/migrations';

const PASSWORD = 'correct horse battery staple';

/** Fixed ids from the seed migration. */
const SALARY = '00000000-0000-7000-8000-000000000001';
const FOOD = '00000000-0000-7000-8000-00000000000a';
const RESTAURANTS = '00000000-0000-7000-8000-00000000000c';
const SYSTEM_COUNT = { all: 36, income: 5, expense: 31 };

describe('categories', () => {
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

  /**
   * A user's own category written straight to the database. An archived one
   * gets the same creation time, since Prisma would otherwise set created_at
   * after archived_at and break the archive-after-creation CHECK.
   */
  function storedCategory(user: User, data: Partial<Prisma.CategoryUncheckedCreateInput> = {}) {
    return prisma.category.create({
      data: {
        userId: user.id,
        name: `Category ${randomUUID().slice(0, 8)}`,
        kind: 'expense',
        nature: 'discretionary',
        ...(data.archivedAt ? { createdAt: data.archivedAt } : {}),
        ...data,
      },
    });
  }

  const validCategory = (overrides: Record<string, unknown> = {}) => ({
    name: `Category ${randomUUID().slice(0, 8)}`,
    kind: 'expense',
    nature: 'discretionary',
    ...overrides,
  });

  async function createCategory(user: User, overrides: Record<string, unknown> = {}) {
    const res = await as(user).post('/categories', validCategory(overrides)).expect(201);
    return res.body as { id: string; name: string } & Record<string, unknown>;
  }

  async function rejectedFields(user: User, body: object): Promise<string[]> {
    const res = await as(user).post('/categories', body).expect(400);
    expect(res.headers['content-type']).toMatch(/^application\/problem\+json/);
    return (res.body.errors as { path: string }[]).map((issue) => issue.path);
  }

  const ids = (res: { body: { items: { id: string }[] } }) => res.body.items.map((c) => c.id);
  const sorted = (responses: { status: number }[]) => responses.map((r) => r.status).sort();

  const conflict = (detail: string) => ({
    type: 'about:blank',
    title: 'Conflict',
    status: 409,
    detail,
  });
  const NAME_TAKEN = 'An active category with this name already exists here.';

  const notFound = {
    type: 'about:blank',
    title: 'Not Found',
    status: 404,
    detail: 'Category not found.',
  };

  describe('GET /categories', () => {
    it('lists the system categories, first and in seed order, for a new user', async () => {
      const res = await as(await newUser())
        .get('/categories')
        .expect(200);

      expect(res.body.items).toHaveLength(SYSTEM_COUNT.all);
      expect(res.body.items[0]).toEqual({
        id: SALARY,
        name: 'Salary',
        kind: 'income',
        nature: null,
        parentId: null,
        isSystem: true,
        archivedAt: null,
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      });
      expect(res.body.items.find((c: { id: string }) => c.id === RESTAURANTS)).toMatchObject({
        name: 'Restaurants',
        parentId: FOOD,
        nature: 'discretionary',
      });
      expect(ids(res)).toEqual([...ids(res)].sort());
    });

    it("lists the user's own categories after the system ones, never another user's", async () => {
      const [user, other] = [await newUser(), await newUser()];
      const first = await storedCategory(user);
      const second = await storedCategory(user, { parentId: FOOD });
      const foreign = await storedCategory(other);

      const res = await as(user).get('/categories').expect(200);

      expect(ids(res).slice(SYSTEM_COUNT.all)).toEqual([first.id, second.id]);
      expect(ids(res)).not.toContain(foreign.id);
      expect(res.body.items.at(-1)).toMatchObject({ isSystem: false, parentId: FOOD });
      expect(res.body.items.at(-1)).not.toHaveProperty('userId');
    });

    it('filters by kind', async () => {
      const user = await newUser();
      const income = await storedCategory(user, { kind: 'income', nature: null });

      const incomes = await as(user).get('/categories?kind=income').expect(200);
      const expenses = await as(user).get('/categories?kind=expense').expect(200);

      expect(incomes.body.items).toHaveLength(SYSTEM_COUNT.income + 1);
      expect(incomes.body.items.every((c: { kind: string }) => c.kind === 'income')).toBe(true);
      expect(ids(incomes)).toContain(income.id);
      expect(expenses.body.items).toHaveLength(SYSTEM_COUNT.expense);
    });

    it('lists active categories by default and archived ones on request', async () => {
      const user = await newUser();
      const active = await storedCategory(user);
      const archived = await storedCategory(user, { archivedAt: new Date() });

      const mine = async (query: string) =>
        ids(await as(user).get(`/categories${query}`).expect(200)).slice(
          query.includes('archived') ? 0 : SYSTEM_COUNT.all,
        );

      expect(await mine('')).toEqual([active.id]);
      expect(await mine('?status=active')).toEqual([active.id]);
      expect(await mine('?status=archived')).toEqual([archived.id]);
      expect(await mine('?status=all')).toEqual([active.id, archived.id]);
    });

    it.each([
      ['an unknown kind', '?kind=transfer'],
      ['an unknown status', '?status=deleted'],
      ['a repeated kind', '?kind=income&kind=expense'],
      ['an array-shaped kind', '?kind[]=income'],
      ['an unknown parameter', '?userId=00000000-0000-0000-0000-000000000000'],
    ])('rejects %s', async (_case, query) => {
      const res = await as(await newUser())
        .get(`/categories${query}`)
        .expect(400);

      expect(res.headers['content-type']).toMatch(/^application\/problem\+json/);
    });
  });

  describe('GET /categories/:id', () => {
    it('returns a system category', async () => {
      const res = await as(await newUser())
        .get(`/categories/${FOOD}`)
        .expect(200);

      expect(res.body).toMatchObject({ id: FOOD, name: 'Food', isSystem: true });
    });

    it("returns the user's own category, archived or not", async () => {
      const user = await newUser();
      const category = await storedCategory(user, { archivedAt: new Date() });

      const res = await as(user).get(`/categories/${category.id}`).expect(200);

      expect(res.body).toMatchObject({ id: category.id, isSystem: false });
      expect(res.body.archivedAt).not.toBeNull();
    });

    it("answers another user's category exactly as a missing one", async () => {
      const foreign = await storedCategory(await newUser());
      const user = await newUser();

      const theirs = await as(user).get(`/categories/${foreign.id}`).expect(404);
      const missing = await as(user).get(`/categories/${randomUUID()}`).expect(404);

      expect(theirs.body).toEqual(notFound);
      expect(missing.body).toEqual(notFound);
    });

    it('rejects a malformed id', async () => {
      await as(await newUser())
        .get('/categories/not-a-uuid')
        .expect(400);
    });
  });

  describe('POST /categories', () => {
    it('creates a top-level expense category with its Location', async () => {
      const user = await newUser();

      const res = await as(user)
        .post('/categories', { name: 'Pets', kind: 'expense', nature: 'essential_variable' })
        .expect(201);

      expect(res.headers.location).toBe(`/categories/${res.body.id}`);
      expect(res.body).toEqual({
        id: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-7/),
        name: 'Pets',
        kind: 'expense',
        nature: 'essential_variable',
        parentId: null,
        isSystem: false,
        archivedAt: null,
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      });
      await expect(
        prisma.category.findUniqueOrThrow({ where: { id: res.body.id } }),
      ).resolves.toMatchObject({ userId: user.id });
    });

    it('creates an income category, which has no nature', async () => {
      const category = await createCategory(await newUser(), {
        kind: 'income',
        nature: undefined,
        parentId: null,
      });

      expect(category).toMatchObject({ kind: 'income', nature: null, parentId: null });
    });

    it("creates a subcategory under a system category and under the user's own", async () => {
      const user = await newUser();
      const own = await createCategory(user);

      const underSystem = await createCategory(user, { name: 'Coffee', parentId: FOOD });
      const underOwn = await createCategory(user, { parentId: own.id });

      expect(underSystem).toMatchObject({ parentId: FOOD, isSystem: false });
      expect(underOwn).toMatchObject({ parentId: own.id });
    });

    it('normalizes the name to NFC and trims it, keeping Armenian text', async () => {
      const user = await newUser();

      expect((await createCategory(user, { name: '  Cafe\u0301  ' })).name).toBe('Caf\u00e9');
      expect((await createCategory(user, { name: 'Սնունդ' })).name).toBe('Սնունդ');
    });

    describe('validation', () => {
      it('lists every missing required field', async () => {
        expect((await rejectedFields(await newUser(), {})).sort()).toEqual(['kind', 'name']);
      });

      it.each([
        ['nature on an income category', { kind: 'income', nature: 'discretionary' }, 'nature'],
        ['no nature on an expense category', { nature: undefined }, 'nature'],
        ['an unknown kind', { kind: 'transfer' }, 'kind'],
        ['an unknown nature', { nature: 'luxury' }, 'nature'],
        ['an empty name', { name: '   ' }, 'name'],
        ['a 65-character name', { name: 'a'.repeat(65) }, 'name'],
        ['a name with a control character', { name: 'Pets\u0000' }, 'name'],
        ['a name with an unpaired surrogate', { name: 'Pets \ud800' }, 'name'],
        ['a malformed parentId', { parentId: 'food' }, 'parentId'],
        ['an owner', { userId: randomUUID() }, ''],
        ['a system flag', { isSystem: true }, ''],
        ['an archive time', { archivedAt: new Date().toISOString() }, ''],
      ])('rejects %s', async (_case, overrides, field) => {
        expect(await rejectedFields(await newUser(), validCategory(overrides))).toEqual([field]);
      });
    });

    describe('parent', () => {
      const PARENT_UNKNOWN = 'Must be one of your categories or a system category';

      it.each([
        ['does not exist', async () => randomUUID()],
        ['belongs to another user', async () => (await storedCategory(await newUser())).id],
      ])('rejects a parent that %s, with the same answer', async (_case, parent) => {
        const res = await as(await newUser())
          .post('/categories', validCategory({ parentId: await parent() }))
          .expect(400);

        expect(res.body.errors).toEqual([{ path: 'parentId', message: PARENT_UNKNOWN }]);
      });

      it('rejects a third level', async () => {
        const res = await as(await newUser())
          .post('/categories', validCategory({ parentId: RESTAURANTS }))
          .expect(400);

        expect(res.body.errors).toEqual([
          { path: 'parentId', message: 'Must be a top-level category' },
        ]);
      });

      it("rejects a kind other than the parent's", async () => {
        const res = await as(await newUser())
          .post('/categories', validCategory({ parentId: SALARY }))
          .expect(400);

        expect(res.body.errors).toEqual([
          { path: 'kind', message: "Must match the parent category's kind (income)" },
        ]);
      });

      it('rejects an archived parent with 409', async () => {
        const user = await newUser();
        const parent = await storedCategory(user, { archivedAt: new Date() });

        const res = await as(user)
          .post('/categories', validCategory({ parentId: parent.id }))
          .expect(409);

        expect(res.body).toEqual(conflict('The parent category is archived.'));
      });
    });

    describe('names', () => {
      it('answers 409 for an active sibling with the same name in any case or Unicode form', async () => {
        const user = await newUser();
        await createCategory(user, { name: 'Café', parentId: FOOD });

        for (const name of ['CAFÉ', 'Cafe\u0301']) {
          const res = await as(user)
            .post('/categories', validCategory({ name, parentId: FOOD }))
            .expect(409);
          expect(res.body).toEqual(conflict(NAME_TAKEN));
        }
      });

      it('allows the name of a system category, another kind, another parent or another user', async () => {
        const user = await newUser();

        await createCategory(user, { name: 'Food' });
        await createCategory(user, { name: 'Restaurants', parentId: FOOD });
        await createCategory(user, { name: 'Gifts', kind: 'income', nature: undefined });
        await createCategory(user, { name: 'Gifts' });
        await createCategory(await newUser(), { name: 'Food' });
      });

      it('creates exactly one category when the same name is submitted concurrently', async () => {
        const user = await newUser();

        const responses = await Promise.all(
          Array.from({ length: 5 }, () =>
            as(user).post('/categories', validCategory({ name: 'Race', parentId: FOOD })),
          ),
        );

        expect(sorted(responses)).toEqual([201, 409, 409, 409, 409]);
        await expect(prisma.category.count({ where: { userId: user.id } })).resolves.toBe(1);
      });
    });
  });

  describe('PATCH /categories/:id', () => {
    it('renames the category and changes its nature', async () => {
      const user = await newUser();
      const category = await createCategory(user, { name: 'Pets' });

      const res = await as(user)
        .patch(`/categories/${category.id}`, { name: 'Pet care', nature: 'essential_variable' })
        .expect(200);

      expect(res.body).toMatchObject({ name: 'Pet care', nature: 'essential_variable' });
      expect(new Date(res.body.updatedAt).getTime()).toBeGreaterThanOrEqual(
        new Date(category.updatedAt as string).getTime(),
      );
    });

    it('lets a category change the case of its own name', async () => {
      const user = await newUser();
      const category = await createCategory(user, { name: 'pets' });

      await as(user).patch(`/categories/${category.id}`, { name: 'Pets' }).expect(200);
    });

    it('answers 409 for a name taken by an active sibling', async () => {
      const user = await newUser();
      await createCategory(user, { name: 'Pets' });
      const category = await createCategory(user);

      const res = await as(user).patch(`/categories/${category.id}`, { name: 'PETS' }).expect(409);

      expect(res.body).toEqual(conflict(NAME_TAKEN));
    });

    it('refuses to change a system category with 403', async () => {
      const res = await as(await newUser())
        .patch(`/categories/${FOOD}`, { name: 'Groceries and more' })
        .expect(403);

      expect(res.body).toEqual({
        type: 'about:blank',
        title: 'Forbidden',
        status: 403,
        detail: "System categories can't be changed.",
      });
      await expect(
        prisma.category.findUniqueOrThrow({ where: { id: FOOD } }),
      ).resolves.toMatchObject({ name: 'Food' });
    });

    it("cannot change another user's category, and says nothing about it", async () => {
      const owner = await newUser();
      const category = await storedCategory(owner);

      const res = await as(await newUser())
        .patch(`/categories/${category.id}`, { name: 'Mine now' })
        .expect(404);

      expect(res.body).toEqual(notFound);
      await expect(
        prisma.category.findUniqueOrThrow({ where: { id: category.id } }),
      ).resolves.toEqual(category);
    });

    it('refuses to change an archived category', async () => {
      const user = await newUser();
      const category = await storedCategory(user, { archivedAt: new Date() });

      const res = await as(user).patch(`/categories/${category.id}`, { name: 'x' }).expect(409);

      expect(res.body).toEqual(
        conflict('The category is archived. Restore it before changing it.'),
      );
    });

    it('rejects a nature for an income category', async () => {
      const user = await newUser();
      const category = await createCategory(user, { kind: 'income', nature: undefined });

      const res = await as(user)
        .patch(`/categories/${category.id}`, { nature: 'discretionary' })
        .expect(400);

      expect(res.body.errors).toEqual([
        { path: 'nature', message: 'Income categories have no nature' },
      ]);
    });

    it.each([
      ['an empty body', {}],
      ['a kind', { kind: 'income' }],
      ['a parent', { parentId: FOOD }],
      ['an owner', { userId: randomUUID() }],
      ['a system flag', { isSystem: true }],
      ['an archive time', { archivedAt: null }],
      ['a null nature', { nature: null }],
    ])('rejects %s', async (_case, body) => {
      const user = await newUser();
      const category = await createCategory(user);

      await as(user).patch(`/categories/${category.id}`, body).expect(400);
      await expect(
        prisma.category.findUniqueOrThrow({ where: { id: category.id } }),
      ).resolves.toMatchObject({ kind: 'expense', parentId: null, userId: user.id });
    });

    it('lets only one of two concurrent renames take a name', async () => {
      for (let round = 0; round < 5; round++) {
        const user = await newUser();
        const [a, b] = [await createCategory(user), await createCategory(user)];

        const responses = await Promise.all([
          as(user).patch(`/categories/${a.id}`, { name: 'Wanted' }),
          as(user).patch(`/categories/${b.id}`, { name: 'WANTED' }),
        ]);

        expect(sorted(responses)).toEqual([200, 409]);
      }
    });
  });

  /** Active categories under an archived parent: the lifecycle rules forbid any. */
  async function orphans(userId: string): Promise<number> {
    const [row] = await prisma.$queryRaw<{ count: bigint }[]>`
      SELECT count(*) FROM categories c JOIN categories p ON p.id = c.parent_id
      WHERE c.user_id = ${userId}::uuid AND c.archived_at IS NULL AND p.archived_at IS NOT NULL`;
    return Number(row?.count);
  }

  describe('POST /categories/:id/archive and /restore', () => {
    it('archives the category without deleting it', async () => {
      const user = await newUser();
      const category = await createCategory(user, { parentId: FOOD });

      const res = await as(user).post(`/categories/${category.id}/archive`).expect(200);

      expect(res.body.archivedAt).not.toBeNull();
      expect(new Date(res.body.archivedAt).getTime()).toBeGreaterThanOrEqual(
        new Date(category.createdAt as string).getTime(),
      );
      expect(ids(await as(user).get('/categories').expect(200))).not.toContain(category.id);
      expect(ids(await as(user).get('/categories?status=archived').expect(200))).toEqual([
        category.id,
      ]);
      await as(user).get(`/categories/${category.id}`).expect(200);
    });

    it('is idempotent: archiving again returns the category unchanged', async () => {
      const user = await newUser();
      const category = await createCategory(user);
      const first = await as(user).post(`/categories/${category.id}/archive`).expect(200);

      const second = await as(user).post(`/categories/${category.id}/archive`).expect(200);

      expect(second.body).toEqual(first.body);
    });

    it('refuses to archive a top-level category with active subcategories', async () => {
      const user = await newUser();
      const parent = await createCategory(user);
      const child = await createCategory(user, { parentId: parent.id });

      const res = await as(user).post(`/categories/${parent.id}/archive`).expect(409);

      expect(res.body).toEqual(
        conflict('The category has active subcategories. Archive them first.'),
      );
      await as(user).post(`/categories/${child.id}/archive`).expect(200);
      await as(user).post(`/categories/${parent.id}/archive`).expect(200);
    });

    it("archives a category whose clock-skewed creation time is in this host's future", async () => {
      const user = await newUser();
      const category = await createCategory(user);
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date(category.createdAt as string).getTime() - 60_000);
      try {
        const res = await as(user).post(`/categories/${category.id}/archive`).expect(200);

        expect(res.body.archivedAt).toBe(category.createdAt);
      } finally {
        vi.useRealTimers();
      }
    });

    it('frees the name of an archived category, and restores it to the active list', async () => {
      const user = await newUser();
      const category = await createCategory(user, { name: 'Pets' });
      await as(user).post(`/categories/${category.id}/archive`).expect(200);
      const replacement = await createCategory(user, { name: 'Pets' });
      await as(user).post(`/categories/${replacement.id}/archive`).expect(200);

      const res = await as(user).post(`/categories/${category.id}/restore`).expect(200);

      expect(res.body.archivedAt).toBeNull();
      await as(user).patch(`/categories/${category.id}`, { name: 'Pets again' }).expect(200);
    });

    it('is idempotent: restoring an active category returns it unchanged', async () => {
      const user = await newUser();
      const category = await createCategory(user);

      const res = await as(user).post(`/categories/${category.id}/restore`).expect(200);

      expect(res.body).toEqual(category);
    });

    it('refuses to restore when an active sibling has the name, leaving it archived', async () => {
      const user = await newUser();
      const old = await createCategory(user, { name: 'Pets' });
      await as(user).post(`/categories/${old.id}/archive`).expect(200);
      await createCategory(user, { name: 'PETS' });

      const res = await as(user).post(`/categories/${old.id}/restore`).expect(409);

      expect(res.body).toEqual(conflict(NAME_TAKEN));
      const stored = await prisma.category.findUniqueOrThrow({ where: { id: old.id } });
      expect(stored.archivedAt).not.toBeNull();
    });

    it('refuses to restore a subcategory while its parent is archived', async () => {
      const user = await newUser();
      const parent = await createCategory(user);
      const child = await createCategory(user, { parentId: parent.id });
      await as(user).post(`/categories/${child.id}/archive`).expect(200);
      await as(user).post(`/categories/${parent.id}/archive`).expect(200);

      const res = await as(user).post(`/categories/${child.id}/restore`).expect(409);

      expect(res.body).toEqual(conflict('The parent category is archived. Restore it first.'));
      await as(user).post(`/categories/${parent.id}/restore`).expect(200);
      await as(user).post(`/categories/${child.id}/restore`).expect(200);
    });

    it.each(['archive', 'restore'])('refuses to %s a system category with 403', async (action) => {
      const res = await as(await newUser())
        .post(`/categories/${FOOD}/${action}`)
        .expect(403);

      expect(res.body.detail).toBe("System categories can't be changed.");
      await expect(
        prisma.category.findUniqueOrThrow({ where: { id: FOOD } }),
      ).resolves.toMatchObject({ archivedAt: null });
    });

    it.each(['archive', 'restore'])(
      "cannot %s another user's category, and says nothing about it",
      async (action) => {
        const category = await storedCategory(await newUser(), {
          archivedAt: action === 'restore' ? new Date() : null,
        });

        const res = await as(await newUser())
          .post(`/categories/${category.id}/${action}`)
          .expect(404);

        expect(res.body).toEqual(notFound);
        await expect(
          prisma.category.findUniqueOrThrow({ where: { id: category.id } }),
        ).resolves.toEqual(category);
      },
    );

    it.each(['archive', 'restore'])(
      'answers 404 for a missing id and 400 for a malformed one on %s',
      async (action) => {
        const user = await newUser();

        await as(user).post(`/categories/${randomUUID()}/${action}`).expect(404);
        await as(user).post(`/categories/nope/${action}`).expect(400);
      },
    );
  });

  // Real concurrent requests against PostgreSQL. Each case runs several rounds;
  // whatever the interleaving, no request may fail with a 500 and the stored
  // state must match one of the serial orders.
  describe('concurrent requests', () => {
    const ROUNDS = 5;

    /**
     * Deterministic interleaving: another transaction runs `hold` and keeps
     * its row locks while `send` starts. Once PostgreSQL reports a backend
     * waiting on a lock (or the request has already finished, which is what
     * happens when the code takes no lock), the holder commits. A request
     * that locks correctly therefore always sees the holder's committed work.
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
        { timeout: 20_000 },
      );
      await held;

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

    it('makes a subcategory create wait for an archive of its parent in progress', async () => {
      const user = await newUser();
      const parent = await createCategory(user);

      const res = await whileLocked(
        (tx) =>
          tx.$executeRaw`UPDATE categories SET archived_at = now() WHERE id = ${parent.id}::uuid`,
        () => as(user).post('/categories', validCategory({ parentId: parent.id })),
      );

      expect(res.status).toBe(409);
      expect(await orphans(user.id)).toBe(0);
    });

    it('makes an archive wait for a subcategory being created under it', async () => {
      const user = await newUser();
      const parent = await createCategory(user);

      const res = await whileLocked(
        (tx) => tx.$executeRaw`
          INSERT INTO categories (user_id, parent_id, name, kind, nature)
          VALUES (${user.id}::uuid, ${parent.id}::uuid, 'Child', 'expense', 'discretionary')`,
        () => as(user).post(`/categories/${parent.id}/archive`),
      );

      expect(res.status).toBe(409);
      expect(await orphans(user.id)).toBe(0);
    });

    it('makes a subcategory restore wait for an archive of its parent in progress', async () => {
      const user = await newUser();
      const parent = await createCategory(user);
      const child = await createCategory(user, { parentId: parent.id });
      await as(user).post(`/categories/${child.id}/archive`).expect(200);

      const res = await whileLocked(
        (tx) =>
          tx.$executeRaw`UPDATE categories SET archived_at = now() WHERE id = ${parent.id}::uuid`,
        () => as(user).post(`/categories/${child.id}/restore`),
      );

      expect(res.status).toBe(409);
      expect(await orphans(user.id)).toBe(0);
    });

    it('never leaves a new subcategory under a parent archived at the same time', async () => {
      for (let round = 0; round < ROUNDS; round++) {
        const user = await newUser();
        const parent = await createCategory(user);

        const [create, archive] = await Promise.all([
          as(user).post('/categories', validCategory({ parentId: parent.id })),
          as(user).post(`/categories/${parent.id}/archive`),
        ]);

        expect([
          [201, 409],
          [409, 200],
        ]).toContainEqual([create.status, archive.status]);
        expect(await orphans(user.id)).toBe(0);
      }
    });

    it('never restores a subcategory under a parent archived at the same time', async () => {
      for (let round = 0; round < ROUNDS; round++) {
        const user = await newUser();
        const parent = await createCategory(user);
        const child = await createCategory(user, { parentId: parent.id });
        await as(user).post(`/categories/${child.id}/archive`).expect(200);

        const [restore, archive] = await Promise.all([
          as(user).post(`/categories/${child.id}/restore`),
          as(user).post(`/categories/${parent.id}/archive`),
        ]);

        expect([
          [200, 409],
          [409, 200],
        ]).toContainEqual([restore.status, archive.status]);
        expect(await orphans(user.id)).toBe(0);
      }
    });

    it('restores exactly one of two archived categories with the same name', async () => {
      for (let round = 0; round < ROUNDS; round++) {
        const user = await newUser();
        const a = await createCategory(user, { name: 'Twin' });
        await as(user).post(`/categories/${a.id}/archive`).expect(200);
        const b = await createCategory(user, { name: 'twin' });
        await as(user).post(`/categories/${b.id}/archive`).expect(200);

        const responses = await Promise.all([
          as(user).post(`/categories/${a.id}/restore`),
          as(user).post(`/categories/${b.id}/restore`),
        ]);

        expect(sorted(responses)).toEqual([200, 409]);
      }
    });

    it('lets only one of a create and a restore take a name', async () => {
      for (let round = 0; round < ROUNDS; round++) {
        const user = await newUser();
        const old = await createCategory(user, { name: 'Shared' });
        await as(user).post(`/categories/${old.id}/archive`).expect(200);

        const responses = await Promise.all([
          as(user).post(`/categories/${old.id}/restore`),
          as(user).post('/categories', validCategory({ name: 'shared' })),
        ]);

        expect([
          [200, 409],
          [201, 409],
        ]).toContainEqual(sorted(responses));
        await expect(
          prisma.category.count({ where: { userId: user.id, archivedAt: null } }),
        ).resolves.toBe(1);
      }
    });

    it('lets only one of a rename and a restore take a name', async () => {
      for (let round = 0; round < ROUNDS; round++) {
        const user = await newUser();
        const old = await createCategory(user, { name: 'Shared' });
        await as(user).post(`/categories/${old.id}/archive`).expect(200);
        const other = await createCategory(user);

        const responses = await Promise.all([
          as(user).post(`/categories/${old.id}/restore`),
          as(user).patch(`/categories/${other.id}`, { name: 'SHARED' }),
        ]);

        expect(sorted(responses)).toEqual([200, 409]);
      }
    });

    it('archives once when archive is requested concurrently', async () => {
      const user = await newUser();
      const category = await createCategory(user);

      const responses = await Promise.all(
        Array.from({ length: 5 }, () => as(user).post(`/categories/${category.id}/archive`)),
      );

      expect(sorted(responses)).toEqual([200, 200, 200, 200, 200]);
      const stored = await prisma.category.findUniqueOrThrow({ where: { id: category.id } });
      for (const res of responses)
        expect(res.body.archivedAt).toBe(stored.archivedAt?.toISOString());
    });

    it('never applies an edit to a category archived concurrently', async () => {
      for (let round = 0; round < ROUNDS; round++) {
        const user = await newUser();
        const category = await createCategory(user, { name: 'Before' });

        const [edit, archive] = await Promise.all([
          as(user).patch(`/categories/${category.id}`, { name: 'After' }),
          as(user).post(`/categories/${category.id}/archive`),
        ]);

        expect(archive.status).toBe(200);
        expect([200, 409]).toContain(edit.status);
        const stored = await prisma.category.findUniqueOrThrow({ where: { id: category.id } });
        expect(stored.archivedAt).not.toBeNull();
        expect(stored.name).toBe(edit.status === 200 ? 'After' : 'Before');
      }
    });

    it('ends archive-versus-restore in a consistent state', async () => {
      for (let round = 0; round < ROUNDS; round++) {
        const user = await newUser();
        const category = await createCategory(user);
        await as(user).post(`/categories/${category.id}/archive`).expect(200);

        const [restore, archive] = await Promise.all([
          as(user).post(`/categories/${category.id}/restore`),
          as(user).post(`/categories/${category.id}/archive`),
        ]);

        expect([restore.status, archive.status]).toEqual([200, 200]);
        const stored = await prisma.category.findUniqueOrThrow({ where: { id: category.id } });
        const last = [restore, archive].find(
          (res) => (res.body.archivedAt === null) === (stored.archivedAt === null),
        );
        expect(last).toBeDefined();
      }
    });
  });

  describe('two users', () => {
    it('keeps each user to their own categories while both see the system ones', async () => {
      const [anna, ben] = [await newUser(), await newUser()];
      const annas = await createCategory(anna, { name: 'Pets', parentId: FOOD });
      const bens = await createCategory(ben, { name: 'Pets', parentId: FOOD });

      const annaList = ids(await as(anna).get('/categories').expect(200));
      const benList = ids(await as(ben).get('/categories').expect(200));

      expect(annaList.slice(0, SYSTEM_COUNT.all)).toEqual(benList.slice(0, SYSTEM_COUNT.all));
      expect(annaList.slice(SYSTEM_COUNT.all)).toEqual([annas.id]);
      expect(benList.slice(SYSTEM_COUNT.all)).toEqual([bens.id]);
      for (const [method, path] of [
        ['get', `/categories/${bens.id}`],
        ['patch', `/categories/${bens.id}`],
        ['post', `/categories/${bens.id}/archive`],
        ['post', `/categories/${bens.id}/restore`],
      ] as const) {
        const res =
          method === 'patch'
            ? await as(anna).patch(path, { name: 'x' })
            : await as(anna)[method](path);
        expect(res.status).toBe(404);
      }
      await as(anna)
        .post('/categories', validCategory({ parentId: bens.id }))
        .expect(400);
    });
  });

  describe('authentication', () => {
    it.each([
      ['GET', '/categories'],
      ['GET', `/categories/${FOOD}`],
      ['POST', '/categories'],
      ['PATCH', `/categories/${FOOD}`],
      ['POST', `/categories/${FOOD}/archive`],
      ['POST', `/categories/${FOOD}/restore`],
    ])('rejects %s %s without an access token', async (method, path) => {
      const req =
        method === 'POST'
          ? http().post(path).send(validCategory())
          : method === 'PATCH'
            ? http().patch(path).send({ name: 'x' })
            : http().get(path);

      const res = await req.expect(401);

      expect(res.headers['www-authenticate']).toBe('Bearer realm="costly"');
    });

    it('rejects a malformed or expired access token', async () => {
      const user = await newUser();
      const expired = await new JwtService({ secret: process.env.JWT_ACCESS_SECRET }).signAsync(
        { exp: Math.floor(Date.now() / 1000) - 1 },
        { subject: user.id, issuer: 'costly-api', audience: 'costly-api', algorithm: 'HS256' },
      );

      await http().get('/categories').set('Authorization', `Bearer ${expired}`).expect(401);
      await http().get('/categories').set('Authorization', 'Bearer not-a-token').expect(401);
    });
  });
});
