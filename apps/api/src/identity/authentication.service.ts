import { randomBytes } from 'node:crypto';
import { Injectable, type OnModuleInit, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../platform/database/prisma.service';
import { RateLimiter } from '../platform/rate-limit/rate-limiter.service';
import { AccessTokenService } from './access-token.service';
import { ACCESS_TOKEN_TTL_SECONDS } from './auth.constants';
import { KNOWN_CLIENT_TTL_MS, LOGIN_FAILURES_PER_ACCOUNT, loginKeys } from './auth-rate-limits';
import { hashPassword, verifyPassword } from './password';
import { type IssuedRefreshToken, RefreshTokensService } from './refresh-tokens.service';
import { type UserProfile, userProfileFields } from './user-profile';

/** What a successful login or refresh produces; the controller decides the transport. */
export interface SessionTokens {
  accessToken: string;
  expiresIn: number;
  refresh: IssuedRefreshToken;
}

@Injectable()
export class AuthenticationService implements OnModuleInit {
  /** Verified against when the email is unknown, so both failures cost one Argon2id verification. */
  private dummyHash = '';

  constructor(
    private readonly prisma: PrismaService,
    private readonly accessTokens: AccessTokenService,
    private readonly refreshTokens: RefreshTokensService,
    private readonly limiter: RateLimiter,
  ) {}

  async onModuleInit(): Promise<void> {
    this.dummyHash = await hashPassword(randomBytes(32).toString('base64url'));
  }

  /**
   * Checks credentials and starts a session. A wrong password and an unknown
   * email give the same 401 after the same amount of hashing work, so neither
   * the response nor its timing reveals whether the account exists. The
   * account's failure budget is checked first, before any hashing; unknown
   * emails have one too, so a 429 doesn't reveal existence either. A client
   * that has logged in to this account before skips that budget, so an
   * attacker's failures can't lock the owner out; per-IP limits still apply.
   *
   * @param client the caller's rate-limit identity (rateLimitSubject)
   */
  async login(email: string, password: string, client: string): Promise<SessionTokens> {
    const keys = loginKeys(email, client);
    if (!(await this.limiter.isMarked(keys.knownClient))) {
      await this.limiter.ensureBelow(keys.failures, LOGIN_FAILURES_PER_ACCOUNT);
    }
    // citext: the lookup ignores case, as uniqueness does.
    const user = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true, passwordHash: true },
    });
    const matches = await verifyPassword(user?.passwordHash ?? this.dummyHash, password);
    if (!user || !matches) {
      await this.limiter.hit(keys.failures, LOGIN_FAILURES_PER_ACCOUNT.windowMs);
      throw new UnauthorizedException('Invalid email or password.');
    }
    await this.limiter.mark(keys.knownClient, KNOWN_CLIENT_TTL_MS);
    return this.startSession(user.id);
  }

  /** A new access token and a rotated refresh token for the same session, or 401. */
  async refresh(refreshToken: string): Promise<SessionTokens> {
    const rotated = await this.refreshTokens.rotate(refreshToken);
    const accessToken = await this.accessTokens.issue(rotated.userId);
    return { accessToken, expiresIn: ACCESS_TOKEN_TTL_SECONDS, refresh: rotated.refresh };
  }

  /** Ends the session the refresh token belongs to, if there is one. */
  logout(refreshToken: string): Promise<void> {
    return this.refreshTokens.revokeSession(refreshToken);
  }

  /** The current user's profile, or 401 if the account no longer exists. */
  async profile(userId: string): Promise<UserProfile> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: userProfileFields,
    });
    if (!user) throw new UnauthorizedException('The access token is missing, invalid or expired.');
    return user;
  }

  private async startSession(userId: string): Promise<SessionTokens> {
    const [accessToken, refresh] = await Promise.all([
      this.accessTokens.issue(userId),
      this.refreshTokens.issue(userId),
    ]);
    return { accessToken, expiresIn: ACCESS_TOKEN_TTL_SECONDS, refresh };
  }
}
