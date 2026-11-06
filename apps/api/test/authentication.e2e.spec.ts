import { createHash, generateKeyPairSync, randomUUID } from 'node:crypto';
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

const SECRET = process.env.JWT_ACCESS_SECRET as string;
const TRUSTED_ORIGIN = 'http://localhost:5173';
const PASSWORD = 'correct horse battery staple';

describe('authentication', () => {
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
    await startHttpServer(app);
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app?.close();
    await Promise.all([postgres?.stop(), redis?.stop()]);
  });

  const http = () => request(app.getHttpServer());

  /** Registers a fresh account; every test gets its own, so none depends on another. */
  async function newAccount(password = PASSWORD): Promise<{ id: string; email: string }> {
    const email = `user-${randomUUID()}@costly.test`;
    const res = await http()
      .post('/auth/register')
      .send({ email, password, timezone: 'Asia/Yerevan' })
      .expect(201);
    return { id: res.body.id, email };
  }

  function login(body: object) {
    return http().post('/auth/login').send(body);
  }

  /** The value of the refresh cookie a response set. */
  function refreshCookie(res: request.Response): string {
    const cookies = [res.headers['set-cookie'] ?? []].flat() as string[];
    const cookie = cookies.find((value) => value.startsWith('costly_refresh='));
    if (!cookie) throw new Error('no refresh cookie was set');
    return cookie;
  }

  function cookieValue(cookie: string): string {
    return cookie.split(';')[0]!.slice('costly_refresh='.length);
  }

  function decodeJwt(token: string): {
    header: Record<string, unknown>;
    payload: Record<string, unknown>;
  } {
    const [header, payload] = token.split('.');
    const decode = (part: string | undefined) =>
      JSON.parse(Buffer.from(part ?? '', 'base64url').toString()) as Record<string, unknown>;
    return { header: decode(header), payload: decode(payload) };
  }

  const me = (token: string) => http().get('/auth/me').set('Authorization', `Bearer ${token}`);

  describe('POST /auth/login', () => {
    it('answers 200 with a 15-minute access token and the refresh cookie', async () => {
      const account = await newAccount();

      const res = await login({ email: account.email, password: PASSWORD }).expect(200);

      expect(Object.keys(res.body).sort()).toEqual(['accessToken', 'expiresIn', 'tokenType']);
      expect(res.body).toMatchObject({ tokenType: 'Bearer', expiresIn: 900 });
      expect(res.headers['cache-control']).toBe('no-store');
      expect(JSON.stringify(res.body)).not.toContain(cookieValue(refreshCookie(res)));
    });

    it('signs only minimal identity claims with HS256', async () => {
      const account = await newAccount();

      const res = await login({ email: account.email, password: PASSWORD }).expect(200);
      const { header, payload } = decodeJwt(res.body.accessToken);

      expect(header).toEqual({ alg: 'HS256', typ: 'JWT' });
      expect(Object.keys(payload).sort()).toEqual(['aud', 'exp', 'iat', 'iss', 'sub']);
      expect(payload).toMatchObject({ sub: account.id, iss: 'costly-api', aud: 'costly-api' });
      expect((payload.exp as number) - (payload.iat as number)).toBe(900);
    });

    it('sets the refresh cookie HttpOnly, SameSite=Strict, scoped to /auth, for 30 days', async () => {
      const account = await newAccount();

      const cookie = refreshCookie(
        await login({ email: account.email, password: PASSWORD }).expect(200),
      );

      expect(cookieValue(cookie)).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(cookie).toMatch(/; HttpOnly/);
      expect(cookie).toMatch(/; SameSite=Strict/);
      expect(cookie).toMatch(/; Path=\/auth(;|$)/);
      // Secure only in production: http://localhost is not HTTPS.
      expect(cookie).not.toMatch(/; Secure/);
      const expires = new Date(/Expires=([^;]+)/.exec(cookie)?.[1] ?? '').getTime();
      expect(Math.abs(expires - (Date.now() + 30 * 24 * 3600 * 1000))).toBeLessThan(60_000);
    });

    it('stores only the SHA-256 of the refresh token, in a new session', async () => {
      const account = await newAccount();

      const token = cookieValue(
        refreshCookie(await login({ email: account.email, password: PASSWORD })),
      );
      const rows = await prisma.refreshToken.findMany({ where: { userId: account.id } });

      expect(rows).toHaveLength(1);
      expect(rows[0]?.tokenHash).toBe(createHash('sha256').update(token).digest('hex'));
      expect(JSON.stringify(rows)).not.toContain(token);
    });

    it('starts a separate session for every login', async () => {
      const account = await newAccount();

      await login({ email: account.email, password: PASSWORD }).expect(200);
      await login({ email: account.email, password: PASSWORD }).expect(200);
      const families = await prisma.refreshToken.groupBy({
        by: ['familyId'],
        where: { userId: account.id },
      });

      expect(families).toHaveLength(2);
    });

    it('matches the email regardless of case and surrounding whitespace', async () => {
      const account = await newAccount();

      await login({ email: `  ${account.email.toUpperCase()} `, password: PASSWORD }).expect(200);
    });

    it('applies the same NFKC normalization as registration', async () => {
      // "ﬁ" (U+FB01) normalizes to "fi".
      const account = await newAccount('ﬁnancial plan 2027');

      await login({ email: account.email, password: 'financial plan 2027' }).expect(200);
    });

    it('answers a wrong password and an unknown email identically', async () => {
      const account = await newAccount();

      const wrongPassword = await login({ email: account.email, password: `${PASSWORD}!` }).expect(
        401,
      );
      const unknownEmail = await login({
        email: `nobody-${randomUUID()}@costly.test`,
        password: PASSWORD,
      }).expect(401);

      expect(wrongPassword.body).toEqual({
        type: 'about:blank',
        title: 'Unauthorized',
        status: 401,
        detail: 'Invalid email or password.',
      });
      expect(unknownEmail.body).toEqual(wrongPassword.body);
      expect(unknownEmail.headers['set-cookie']).toBeUndefined();
    });

    it('creates no session for failed attempts', async () => {
      const account = await newAccount();

      await login({ email: account.email, password: 'wrong password' }).expect(401);

      await expect(prisma.refreshToken.count({ where: { userId: account.id } })).resolves.toBe(0);
    });

    it.each([
      ['an empty body', {}],
      ['a missing password', { email: 'a@costly.test' }],
      ['a non-string email', { email: 42, password: PASSWORD }],
      ['an empty password', { email: 'a@costly.test', password: '' }],
      ['an unknown field', { email: 'a@costly.test', password: PASSWORD, userId: randomUUID() }],
    ])('rejects %s with 400', async (_case, body) => {
      const res = await login(body).expect(400);

      expect(res.body.title).toBe('Bad Request');
      expect(JSON.stringify(res.body)).not.toContain(PASSWORD);
    });

    it('refuses a request sent from another origin', async () => {
      const account = await newAccount();

      const res = await login({ email: account.email, password: PASSWORD })
        .set('Origin', 'https://evil.example')
        .expect(403);

      expect(res.body.title).toBe('Forbidden');
      expect(res.headers['set-cookie']).toBeUndefined();
    });

    it('accepts a request from the web client origin and allows it credentials', async () => {
      const account = await newAccount();

      const res = await login({ email: account.email, password: PASSWORD })
        .set('Origin', TRUSTED_ORIGIN)
        .expect(200);

      expect(res.headers['access-control-allow-origin']).toBe(TRUSTED_ORIGIN);
      expect(res.headers['access-control-allow-credentials']).toBe('true');
    });
  });

  describe('GET /auth/me and access tokens', () => {
    const jwt = new JwtService({ secret: SECRET });
    const claims = { issuer: 'costly-api', audience: 'costly-api' } as const;

    async function accessTokenFor(account: { email: string }): Promise<string> {
      const res = await login({ email: account.email, password: PASSWORD }).expect(200);
      return res.body.accessToken as string;
    }

    it('returns the profile of the token holder, without credentials', async () => {
      const account = await newAccount();

      const res = await me(await accessTokenFor(account)).expect(200);

      expect(Object.keys(res.body).sort()).toEqual([
        'baseCurrency',
        'createdAt',
        'email',
        'id',
        'timezone',
      ]);
      expect(res.body).toMatchObject({ id: account.id, email: account.email });
    });

    it('identifies the user from the token only, ignoring ids in the query', async () => {
      const [account, other] = await Promise.all([newAccount(), newAccount()]);

      const res = await http()
        .get(`/auth/me?userId=${other.id}`)
        .set('Authorization', `Bearer ${await accessTokenFor(account)}`)
        .expect(200);

      expect(res.body.id).toBe(account.id);
    });

    async function rejected(authorization: string | undefined) {
      const req = http().get('/auth/me');
      if (authorization !== undefined) req.set('Authorization', authorization);
      const res = await req.expect(401);
      expect(res.body).toMatchObject({
        title: 'Unauthorized',
        detail: 'The access token is missing, invalid or expired.',
      });
      expect(res.headers['www-authenticate']).toBe('Bearer realm="costly"');
    }

    it('rejects a request without an Authorization header', async () => {
      await rejected(undefined);
    });

    it.each([
      'Basic dXNlcjpwYXNz',
      'Bearer',
      'Bearer ',
      'bearer x.y.z',
      'Bearer not-a-jwt',
      'Bearer a.b',
    ])('rejects the Authorization header %j', async (header) => {
      await rejected(header);
    });

    it('rejects a token signed with another key', async () => {
      const account = await newAccount();
      const forged = await new JwtService({
        secret: 'another-secret-that-is-long-enough!!',
      }).signAsync({}, { subject: account.id, expiresIn: 900, algorithm: 'HS256', ...claims });

      await rejected(`Bearer ${forged}`);
    });

    it('rejects an expired token', async () => {
      const account = await newAccount();
      const expired = await jwt.signAsync(
        { exp: Math.floor(Date.now() / 1000) - 1 },
        { subject: account.id, algorithm: 'HS256', ...claims },
      );

      await rejected(`Bearer ${expired}`);
    });

    it.each([
      ['the wrong issuer', { issuer: 'someone-else', audience: 'costly-api' }],
      ['the wrong audience', { issuer: 'costly-api', audience: 'another-api' }],
    ])('rejects a token with %s', async (_case, options) => {
      const account = await newAccount();
      const token = await jwt.signAsync(
        {},
        { subject: account.id, expiresIn: 900, algorithm: 'HS256', ...options },
      );

      await rejected(`Bearer ${token}`);
    });

    it('rejects a token signed with another HMAC algorithm and the same key', async () => {
      const account = await newAccount();
      const hs512 = await jwt.signAsync(
        {},
        { subject: account.id, expiresIn: 900, algorithm: 'HS512', ...claims },
      );

      await rejected(`Bearer ${hs512}`);
    });

    it('rejects an RS256 token', async () => {
      const account = await newAccount();
      const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
      const rs256 = await new JwtService({
        privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }),
      }).signAsync({}, { subject: account.id, expiresIn: 900, algorithm: 'RS256', ...claims });

      await rejected(`Bearer ${rs256}`);
    });

    it('rejects an unsigned token (alg: none)', async () => {
      const account = await newAccount();
      const now = Math.floor(Date.now() / 1000);
      const part = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
      const unsigned = `${part({ alg: 'none', typ: 'JWT' })}.${part({ sub: account.id, iat: now, exp: now + 900, ...{ iss: 'costly-api', aud: 'costly-api' } })}.`;

      await rejected(`Bearer ${unsigned}`);
    });

    it('rejects a validly signed token whose subject is not a user id', async () => {
      const token = await jwt.signAsync(
        {},
        { subject: 'admin', expiresIn: 900, algorithm: 'HS256', ...claims },
      );

      await rejected(`Bearer ${token}`);
    });

    it('rejects the token of a user who no longer exists', async () => {
      const account = await newAccount();
      const token = await accessTokenFor(account);
      await prisma.user.delete({ where: { id: account.id } });

      await rejected(`Bearer ${token}`);
    });

    it('rejects a refresh token used as an access token', async () => {
      const account = await newAccount();
      const refresh = cookieValue(
        refreshCookie(await login({ email: account.email, password: PASSWORD })),
      );

      await rejected(`Bearer ${refresh}`);
    });
  });
});
