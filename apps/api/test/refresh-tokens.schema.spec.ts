import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '../src/generated/prisma/client';
import { applyMigrations } from './support/migrations';
import { violation } from './support/postgres';

/**
 * Verifies the refresh_tokens table as PostgreSQL enforces it (ADR-0006).
 * Every test creates its own user and family, so none depends on another.
 */
describe('refresh_tokens table', () => {
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

  function tokenHash(): string {
    return createHash('sha256').update(randomBytes(32)).digest('hex');
  }

  const inThirtyDays = () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  function insert(userId: string, familyId: string, hash = tokenHash()) {
    return prisma.$executeRaw`
      INSERT INTO refresh_tokens (user_id, family_id, token_hash, expires_at)
      VALUES (${userId}::uuid, ${familyId}::uuid, ${hash}, ${inThirtyDays()})`;
  }

  it('is created by the second migration', async () => {
    const rows = await prisma.$queryRaw<{ migration_name: string }[]>`
      SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL`;

    expect(rows.map((row) => row.migration_name)).toContainEqual(
      expect.stringMatching(/^\d{14}_add_refresh_tokens$/),
    );
  });

  it('generates the id, a new family and created_at', async () => {
    const token = await prisma.refreshToken.create({
      data: { userId: await newUser(), tokenHash: tokenHash(), expiresAt: inThirtyDays() },
    });

    expect(token.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7/);
    expect(token.familyId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7/);
    expect(token.familyId).not.toBe(token.id);
    expect(token.rotatedAt).toBeNull();
    expect(token.revokedAt).toBeNull();
  });

  it('rejects a token hash that is stored twice', async () => {
    const userId = await newUser();
    const hash = tokenHash();
    await insert(userId, randomUUID(), hash);

    const error = await violation(insert(userId, randomUUID(), hash));

    expect(error.code).toBe('23505');
    expect(error.message).toContain('refresh_tokens_token_hash_key');
  });

  it.each([
    ['upper-case hex', 'A'.repeat(64)],
    ['too short', 'a'.repeat(63)],
    ['not hex', 'g'.repeat(64)],
    ['a raw token instead of a digest', randomBytes(32).toString('base64url').padEnd(64, '=')],
  ])('rejects a token hash that is %s', async (_case, hash) => {
    const error = await violation(insert(await newUser(), randomUUID(), hash));

    expect(error.code).toBe('23514');
    expect(error.message).toContain('refresh_tokens_token_hash_format_check');
  });

  it('rejects an expiry that is not after creation', async () => {
    const error = await violation(prisma.$executeRaw`
      INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
      VALUES (${await newUser()}::uuid, ${tokenHash()}, now() - interval '1 second')`);

    expect(error.code).toBe('23514');
    expect(error.message).toContain('refresh_tokens_expires_after_creation_check');
  });

  describe('one active token per family', () => {
    it('rejects a second usable token in the same family', async () => {
      const userId = await newUser();
      const familyId = randomUUID();
      await insert(userId, familyId);

      const error = await violation(insert(userId, familyId));

      expect(error.code).toBe('23505');
      expect(error.message).toContain('refresh_tokens_one_active_per_family');
    });

    it('allows a successor once the previous token is rotated', async () => {
      const userId = await newUser();
      const familyId = randomUUID();
      const first = tokenHash();
      await insert(userId, familyId, first);
      await prisma.$executeRaw`UPDATE refresh_tokens SET rotated_at = now() WHERE token_hash = ${first}`;

      await expect(insert(userId, familyId)).resolves.toBe(1);
    });

    it('allows a new token in a family whose tokens were revoked', async () => {
      const userId = await newUser();
      const familyId = randomUUID();
      await insert(userId, familyId);
      await prisma.$executeRaw`UPDATE refresh_tokens SET revoked_at = now() WHERE family_id = ${familyId}::uuid`;

      await expect(insert(userId, familyId)).resolves.toBe(1);
    });

    it('lets different sessions of one user be active at the same time', async () => {
      const userId = await newUser();
      await insert(userId, randomUUID());

      await expect(insert(userId, randomUUID())).resolves.toBe(1);
    });
  });

  describe('ownership', () => {
    it('rejects a token for a user that does not exist', async () => {
      const error = await violation(insert(randomUUID(), randomUUID()));

      expect(error.code).toBe('23503');
      expect(error.message).toContain('refresh_tokens_user_id_fkey');
    });

    it("deletes a user's tokens with the user", async () => {
      const userId = await newUser();
      await insert(userId, randomUUID());

      await prisma.user.delete({ where: { id: userId } });

      await expect(prisma.refreshToken.count({ where: { userId } })).resolves.toBe(0);
    });
  });
});
