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

  /** Logs in and returns the refresh token from the cookie. */
  async function session(account: { email: string }): Promise<string> {
    const res = await login({ email: account.email, password: PASSWORD }).expect(200);
    return cookieValue(refreshCookie(res));
  }

  function refresh(token: string | undefined) {
    const req = http().post('/auth/refresh');
    if (token !== undefined) req.set('Cookie', `costly_refresh=${token}`);
    return req;
  }

  function logout(token: string | undefined) {
    const req = http().post('/auth/logout');
    if (token !== undefined) req.set('Cookie', `costly_refresh=${token}`);
    return req;
  }

  const tokenRow = (token: string) =>
    prisma.refreshToken.findUniqueOrThrow({
      where: { tokenHash: createHash('sha256').update(token).digest('hex') },
    });

  const invalidSession = {
    type: 'about:blank',
    title: 'Unauthorized',
    status: 401,
    detail: 'The refresh session is invalid or has expired.',
  };

  describe('POST /auth/refresh', () => {
    it('returns a new access token and rotates the refresh cookie', async () => {
      const account = await newAccount();
      const first = await session(account);

      const res = await refresh(first).expect(200);
      const second = cookieValue(refreshCookie(res));

      expect(res.body).toMatchObject({ tokenType: 'Bearer', expiresIn: 900 });
      expect(res.headers['cache-control']).toBe('no-store');
      expect(second).not.toBe(first);
      await me(res.body.accessToken).expect(200);
    });

    it('keeps the session and its absolute expiry, and marks the old token rotated', async () => {
      const account = await newAccount();
      const first = await session(account);

      const second = cookieValue(refreshCookie(await refresh(first).expect(200)));
      const [old, current] = await Promise.all([tokenRow(first), tokenRow(second)]);

      expect(old.rotatedAt).not.toBeNull();
      expect(current.familyId).toBe(old.familyId);
      expect(current.expiresAt.getTime()).toBe(old.expiresAt.getTime());
      expect(current.rotatedAt).toBeNull();
    });

    it('can be repeated along the chain of successors', async () => {
      let token = await session(await newAccount());

      for (let i = 0; i < 3; i++) {
        token = cookieValue(refreshCookie(await refresh(token).expect(200)));
      }

      await refresh(token).expect(200);
    });

    it('rejects a replayed token and ends the whole session', async () => {
      const account = await newAccount();
      const first = await session(account);
      const second = cookieValue(refreshCookie(await refresh(first).expect(200)));

      const replay = await refresh(first).expect(401);

      expect(replay.body).toEqual(invalidSession);
      // Reuse revoked the family, so even the legitimate latest token is dead.
      await refresh(second).expect(401);
      expect((await tokenRow(second)).revokedAt).not.toBeNull();
    });

    it('lets exactly one of several concurrent refreshes with one token succeed', async () => {
      const token = await session(await newAccount());

      const responses = await Promise.all(Array.from({ length: 5 }, () => refresh(token)));

      expect(responses.map((res) => res.status).sort()).toEqual([200, 401, 401, 401, 401]);
      // The losers count as reuse: the winner's successor was revoked too.
      const winner = responses.find((res) => res.status === 200)!;
      await refresh(cookieValue(refreshCookie(winner))).expect(401);
    });

    it('rejects a token whose session has expired', async () => {
      const token = await session(await newAccount());
      await prisma.$executeRaw`
        UPDATE refresh_tokens SET created_at = now() - interval '31 days', expires_at = now() - interval '1 day'
        WHERE token_hash = ${createHash('sha256').update(token).digest('hex')}`;

      expect((await refresh(token).expect(401)).body).toEqual(invalidSession);
    });

    it('rejects a token whose session was revoked', async () => {
      const token = await session(await newAccount());
      await prisma.refreshToken.updateMany({
        where: { tokenHash: createHash('sha256').update(token).digest('hex') },
        data: { revokedAt: new Date() },
      });

      await refresh(token).expect(401);
    });

    it.each([
      ['no cookie', undefined],
      ['an unknown token', 'A'.repeat(43)],
      ['a malformed cookie', 'not a token'],
    ])('rejects a request with %s and clears the cookie', async (_case, token) => {
      const res = await refresh(token).expect(401);

      expect(res.body).toEqual(invalidSession);
      expect(refreshCookie(res)).toMatch(/Expires=Thu, 01 Jan 1970/);
    });

    it('rejects an access token sent as the refresh cookie', async () => {
      const account = await newAccount();
      const accessToken = (await login({ email: account.email, password: PASSWORD })).body
        .accessToken;

      await refresh(accessToken).expect(401);
    });

    it('ignores a refresh token sent in the body: the cookie is the only transport', async () => {
      const token = await session(await newAccount());

      await http().post('/auth/refresh').send({ refreshToken: token }).expect(401);
    });

    it('refuses a request sent from another origin, leaving the token usable', async () => {
      const token = await session(await newAccount());

      await refresh(token).set('Origin', 'https://evil.example').expect(403);

      await refresh(token).expect(200);
    });

    it('leaves the old token valid when the rotation transaction fails', async () => {
      const account = await newAccount();
      const token = await session(account);
      // Make inserting this user's next token fail inside the rotation transaction.
      await prisma.$executeRawUnsafe(`
        CREATE FUNCTION reject_successor() RETURNS trigger AS $$
        BEGIN RAISE EXCEPTION 'simulated failure'; END $$ LANGUAGE plpgsql`);
      await prisma.$executeRawUnsafe(`
        CREATE TRIGGER reject_successor BEFORE INSERT ON refresh_tokens
        FOR EACH ROW WHEN (NEW.user_id = '${account.id}') EXECUTE FUNCTION reject_successor()`);

      try {
        const failed = await refresh(token).expect(500);
        expect(failed.body).toEqual({
          type: 'about:blank',
          title: 'Internal Server Error',
          status: 500,
        });
      } finally {
        await prisma.$executeRawUnsafe('DROP TRIGGER reject_successor ON refresh_tokens');
        await prisma.$executeRawUnsafe('DROP FUNCTION reject_successor()');
      }

      // The UPDATE that marked it rotated was rolled back with the failed INSERT.
      expect((await tokenRow(token)).rotatedAt).toBeNull();
      await refresh(token).expect(200);
    });
  });

  describe('POST /auth/logout', () => {
    it('ends the session, clears the cookie and answers 204', async () => {
      const token = await session(await newAccount());

      const res = await logout(token).expect(204);

      expect(res.text).toBe('');
      expect(refreshCookie(res)).toMatch(/^costly_refresh=;.*Expires=Thu, 01 Jan 1970/);
      expect((await tokenRow(token)).revokedAt).not.toBeNull();
      await refresh(token).expect(401);
    });

    it('answers 204 again when the session is already ended', async () => {
      const token = await session(await newAccount());
      await logout(token).expect(204);

      await logout(token).expect(204);
    });

    it.each([
      ['no cookie', undefined],
      ['an unknown token', 'B'.repeat(43)],
    ])('answers 204 with %s, revealing nothing', async (_case, token) => {
      await logout(token).expect(204);
    });

    it("ends only this session: the user's other sessions keep working", async () => {
      const account = await newAccount();
      const [phone, laptop] = await Promise.all([session(account), session(account)]);

      await logout(phone).expect(204);

      await refresh(laptop).expect(200);
      await refresh(phone).expect(401);
    });

    it('needs no access token, and leaves an issued one valid until it expires', async () => {
      const account = await newAccount();
      const res = await login({ email: account.email, password: PASSWORD }).expect(200);

      await logout(cookieValue(refreshCookie(res))).expect(204);

      // Documented in ADR-0006: stateless access tokens outlive their session by up to 15 minutes.
      await me(res.body.accessToken).expect(200);
    });

    it('refuses a request sent from another origin, leaving the session alive', async () => {
      const token = await session(await newAccount());

      await logout(token).set('Origin', 'https://evil.example').expect(403);

      await refresh(token).expect(200);
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
