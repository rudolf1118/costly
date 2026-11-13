import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
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

  /** A user's own category written straight to the database. */
  function storedCategory(user: User, data: Partial<Prisma.CategoryUncheckedCreateInput> = {}) {
    return prisma.category.create({
      data: {
        userId: user.id,
        name: `Category ${randomUUID().slice(0, 8)}`,
        kind: 'expense',
        nature: 'discretionary',
        ...data,
      },
    });
  }

  const ids = (res: { body: { items: { id: string }[] } }) => res.body.items.map((c) => c.id);

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

  describe('authentication', () => {
    it.each([
      ['GET', '/categories'],
      ['GET', `/categories/${FOOD}`],
    ])('rejects %s %s without an access token', async (method, path) => {
      const res = await http().get(path).expect(401);

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
