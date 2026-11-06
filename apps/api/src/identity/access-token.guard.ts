import {
  type CanActivate,
  createParamDecorator,
  type ExecutionContext,
  Injectable,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AccessTokenService, invalidAccessToken } from './access-token.service';

/** Who made the request, as proven by the access token. Nothing else is trusted for this. */
export interface AuthenticatedUser {
  id: string;
}

const AUTHENTICATED_USER = Symbol('authenticatedUser');
type AuthenticatedRequest = Request & { [AUTHENTICATED_USER]?: AuthenticatedUser };

const BEARER = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/;

/** RFC 6750: a 401 for a Bearer-protected resource must name the scheme. */
export function challengeBearer(response: Response): void {
  response.setHeader('WWW-Authenticate', 'Bearer realm="costly"');
}

/**
 * Requires `Authorization: Bearer <access token>`. The user id comes only from
 * the verified token, never from the body or the query. No database query:
 * the token itself is the proof (ADR-0006).
 */
@Injectable()
export class AccessTokenGuard implements CanActivate {
  constructor(private readonly accessTokens: AccessTokenService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const request = http.getRequest<AuthenticatedRequest>();
    try {
      const match = BEARER.exec(request.headers.authorization ?? '');
      if (!match?.[1]) throw invalidAccessToken();
      request[AUTHENTICATED_USER] = { id: await this.accessTokens.verify(match[1]) };
      return true;
    } catch (error) {
      challengeBearer(http.getResponse<Response>());
      throw error;
    }
  }
}

/** The user AccessTokenGuard authenticated. Using it on an unguarded route is a programming error. */
export const CurrentUser = createParamDecorator((_data: unknown, context: ExecutionContext) => {
  const user = context.switchToHttp().getRequest<AuthenticatedRequest>()[AUTHENTICATED_USER];
  if (!user) throw new Error('CurrentUser used on a route without AccessTokenGuard');
  return user;
});
