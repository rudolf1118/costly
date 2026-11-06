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
   * 401. The conditional UPDATE is the gate: of any number of concurrent
   * requests with one token, exactly one finds it unrotated; the others wait
   * for its row lock, then match nothing. The successor is inserted in the
   * same transaction, so a failure leaves the old token valid.
   */
  async rotate(token: string): Promise<RotatedRefreshToken> {
    const tokenHash = hashRefreshToken(token);
    const successor = newToken();

    const rotated = await this.prisma.$transaction(async (tx) => {
      const [current] = await tx.$queryRaw<
        { user_id: string; family_id: string; expires_at: Date }[]
      >`
        UPDATE refresh_tokens SET rotated_at = now()
        WHERE token_hash = ${tokenHash}
          AND rotated_at IS NULL AND revoked_at IS NULL AND expires_at > now()
        RETURNING user_id::text, family_id::text, expires_at`;
      if (!current) return undefined;
      // Same family, same absolute expiry: rotation never extends a session.
      await tx.refreshToken.create({
        data: {
          userId: current.user_id,
          familyId: current.family_id,
          tokenHash: hashRefreshToken(successor),
          expiresAt: current.expires_at,
        },
      });
      return current;
    });

    if (rotated) {
      return {
        userId: rotated.user_id,
        refresh: { token: successor, expiresAt: rotated.expires_at },
      };
    }

    await this.revokeFamilyIfReused(tokenHash);
    throw invalidRefreshSession();
  }

  /**
   * Ends the session the token belongs to. Revoking an unknown, expired or
   * already revoked session is a no-op, so logout never reveals which it was.
   */
  async revokeSession(token: string): Promise<void> {
    await this.prisma.$executeRaw`
      UPDATE refresh_tokens SET revoked_at = now()
      WHERE family_id = (SELECT family_id FROM refresh_tokens WHERE token_hash = ${hashRefreshToken(token)})
        AND revoked_at IS NULL`;
  }

  /**
   * A token that was already exchanged has been used twice: by the client and
   * by whoever else holds a copy. Nobody can tell which is legitimate, so the
   * whole session is revoked (RFC 9700, refresh token reuse detection).
   */
  private async revokeFamilyIfReused(tokenHash: string): Promise<void> {
    await this.prisma.$executeRaw`
      UPDATE refresh_tokens SET revoked_at = now()
      WHERE family_id = (
          SELECT family_id FROM refresh_tokens WHERE token_hash = ${tokenHash} AND rotated_at IS NOT NULL
        )
        AND revoked_at IS NULL`;
  }
}
