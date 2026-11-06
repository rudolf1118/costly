import { createHash, randomBytes } from 'node:crypto';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../platform/database/prisma.service';
import { REFRESH_SESSION_TTL_MS } from './auth.constants';

export interface IssuedRefreshToken {
  /** The credential itself. Only the client ever holds it; it is not stored. */
  token: string;
  expiresAt: Date;
}

/** 256 random bits; 43 characters of base64url. */
const TOKEN_BYTES = 32;
export const REFRESH_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/**
 * SHA-256 is enough here: the token is 256 random bits, not a password, so
 * the digest cannot be brute-forced, and it can be looked up directly.
 */
export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function newToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

export function invalidRefreshSession(): UnauthorizedException {
  return new UnauthorizedException('The refresh session is invalid or has expired.');
}

export interface RotatedRefreshToken {
  userId: string;
  refresh: IssuedRefreshToken;
}

type Transaction = Parameters<Parameters<PrismaService['$transaction']>[0]>[0];

/**
 * Finds the session (family) of a token and takes its transaction-scoped
 * advisory lock, returning undefined for an unknown token.
 *
 * Without it, PostgreSQL's READ COMMITTED isolation lets a revocation miss a
 * successor: a revoking UPDATE that waits on the old token's row lock sees
 * only rows that existed when it started, so the successor inserted by a
 * concurrent rotation survives a logout or a reuse revocation. Holding the
 * session lock for the whole transaction makes rotation, reuse revocation and
 * logout of one session run one after another, each seeing the last one's
 * rows. Each transaction takes exactly one such lock, before any row lock, so
 * they cannot deadlock.
 */
async function lockSession(tx: Transaction, tokenHash: string): Promise<string | undefined> {
  const [token] = await tx.$queryRaw<{ family_id: string }[]>`
    SELECT family_id::text FROM refresh_tokens WHERE token_hash = ${tokenHash}`;
  if (!token) return undefined;
  await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${token.family_id}, 0))`;
  return token.family_id;
}

/** Refresh sessions (ADR-0006): one family of tokens per login. */
@Injectable()
export class RefreshTokensService {
  constructor(private readonly prisma: PrismaService) {}

  /** Starts a new session: a new family whose first token expires in 30 days. */
  async issue(userId: string): Promise<IssuedRefreshToken> {
    const token = newToken();
    const expiresAt = new Date(Date.now() + REFRESH_SESSION_TTL_MS);
    await this.prisma.refreshToken.create({
      data: { userId, tokenHash: hashRefreshToken(token), expiresAt },
    });
    return { token, expiresAt };
  }

  /**
   * Exchanges a refresh token for its successor in the same session, or throws
   * 401. Everything happens in one transaction that first takes the session's
   * lock (see lockSession), so it never interleaves with another rotation,
   * reuse revocation or logout of the same session. The conditional UPDATE
   * passes only for an unrotated, unrevoked, unexpired token, and the
   * successor is inserted in the same transaction: a failure leaves the old
   * token valid.
   */
  async rotate(token: string): Promise<RotatedRefreshToken> {
    const tokenHash = hashRefreshToken(token);
    const successor = newToken();

    const rotated = await this.prisma.$transaction(async (tx) => {
      const familyId = await lockSession(tx, tokenHash);
      if (!familyId) return undefined;

      const [current] = await tx.$queryRaw<{ user_id: string; expires_at: Date }[]>`
        UPDATE refresh_tokens SET rotated_at = now()
        WHERE token_hash = ${tokenHash}
          AND rotated_at IS NULL AND revoked_at IS NULL AND expires_at > now()
        RETURNING user_id::text, expires_at`;
      if (current) {
        // Same family, same absolute expiry: rotation never extends a session.
        await tx.refreshToken.create({
          data: {
            userId: current.user_id,
            familyId,
            tokenHash: hashRefreshToken(successor),
            expiresAt: current.expires_at,
          },
        });
        return current;
      }

      // An already exchanged token has been used twice: by the client and by
      // whoever else holds a copy. Nobody can tell which is legitimate, so the
      // whole session is revoked (RFC 9700, refresh token reuse detection).
      // Under the session lock, this sees every successor, including one
      // created by a rotation that was in flight when the replay arrived.
      await tx.$executeRaw`
        UPDATE refresh_tokens SET revoked_at = now()
        WHERE family_id = ${familyId}::uuid AND revoked_at IS NULL
          AND EXISTS (SELECT 1 FROM refresh_tokens WHERE token_hash = ${tokenHash} AND rotated_at IS NOT NULL)`;
      return undefined;
    });

    if (!rotated) throw invalidRefreshSession();
    return {
      userId: rotated.user_id,
      refresh: { token: successor, expiresAt: rotated.expires_at },
    };
  }

  /**
   * Ends the session the token belongs to. Revoking an unknown, expired or
   * already revoked session is a no-op, so logout never reveals which it was.
   * Under the session lock, a rotation in flight finishes first and its
   * successor is revoked too.
   */
  async revokeSession(token: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const familyId = await lockSession(tx, hashRefreshToken(token));
      if (!familyId) return;
      await tx.$executeRaw`
        UPDATE refresh_tokens SET revoked_at = now()
        WHERE family_id = ${familyId}::uuid AND revoked_at IS NULL`;
    });
  }
}
