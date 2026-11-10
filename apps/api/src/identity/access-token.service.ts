import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ACCESS_TOKEN_TTL_SECONDS, TOKEN_AUDIENCE, TOKEN_ISSUER } from './auth.constants';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Signs and verifies access tokens (ADR-0006). The algorithm, issuer and
 * audience are spelled out on every call rather than inherited from module
 * defaults, so the allowlist is visible where it matters.
 */
@Injectable()
export class AccessTokenService {
  constructor(private readonly jwt: JwtService) {}

  /** A token whose only identity claim is the user id, as `sub`. */
  issue(userId: string): Promise<string> {
    return this.jwt.signAsync(
      {},
      {
        algorithm: 'HS256',
        subject: userId,
        issuer: TOKEN_ISSUER,
        audience: TOKEN_AUDIENCE,
        expiresIn: ACCESS_TOKEN_TTL_SECONDS,
      },
    );
  }

  /**
   * The user id of a valid token. Anything else (a bad signature, another
   * algorithm including "none", expiry, the wrong issuer or audience, or a
   * malformed token) is a 401 with the same message.
   */
  async verify(token: string): Promise<string> {
    let subject: unknown;
    try {
      const payload = await this.jwt.verifyAsync<{ sub?: unknown }>(token, {
        algorithms: ['HS256'],
        issuer: TOKEN_ISSUER,
        audience: TOKEN_AUDIENCE,
      });
      subject = payload.sub;
    } catch {
      throw invalidAccessToken();
    }
    if (typeof subject !== 'string' || !UUID.test(subject)) throw invalidAccessToken();
    return subject;
  }
}

export function invalidAccessToken(): UnauthorizedException {
  return new UnauthorizedException('The access token is missing, invalid or expired.');
}
