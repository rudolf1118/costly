import type { CookieOptions, Request, Response } from 'express';
import { REFRESH_COOKIE_NAME, REFRESH_COOKIE_PATH } from './auth.constants';
import { REFRESH_TOKEN_PATTERN } from './refresh-tokens.service';

/**
 * The refresh token's only transport (ADR-0006): HttpOnly so no script can
 * read it, SameSite=Strict so no other site can make the browser send it,
 * scoped to /auth, and Secure in production. http://localhost is not HTTPS.
 */
function cookieOptions(secure: boolean): CookieOptions {
  return { httpOnly: true, secure, sameSite: 'strict', path: REFRESH_COOKIE_PATH };
}

export function setRefreshCookie(
  response: Response,
  token: string,
  expiresAt: Date,
  secure: boolean,
): void {
  response.cookie(REFRESH_COOKIE_NAME, token, { ...cookieOptions(secure), expires: expiresAt });
}

export function clearRefreshCookie(response: Response, secure: boolean): void {
  response.clearCookie(REFRESH_COOKIE_NAME, cookieOptions(secure));
}

/** The refresh token from the cookie, or undefined if absent or not shaped like one. */
export function readRefreshCookie(request: Request): string | undefined {
  const value: unknown = request.cookies?.[REFRESH_COOKIE_NAME];
  return typeof value === 'string' && REFRESH_TOKEN_PATTERN.test(value) ? value : undefined;
}
