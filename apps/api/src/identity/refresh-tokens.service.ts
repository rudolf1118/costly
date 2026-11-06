import { createHash, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
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
}
