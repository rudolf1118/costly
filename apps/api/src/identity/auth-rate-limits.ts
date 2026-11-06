import { createHash } from 'node:crypto';
import type { RateLimit } from '../platform/rate-limit/rate-limiter.service';
import type { RateLimitPolicy } from '../platform/rate-limit/rate-limit.guard';

/** Authentication rate limits (ADR-0006). All windows are 15 minutes. */
const WINDOW_MS = 15 * 60 * 1000;

/** Every registration costs an Argon2id hash, and a person registers once. */
export const REGISTER_PER_IP: RateLimitPolicy = { name: 'register', limit: 5, windowMs: WINDOW_MS };

export const LOGIN_PER_IP: RateLimitPolicy = { name: 'login', limit: 10, windowMs: WINDOW_MS };

/** Refresh is cheap (no Argon2id) and happens every 15 minutes per open session. */
export const REFRESH_PER_IP: RateLimitPolicy = { name: 'refresh', limit: 30, windowMs: WINDOW_MS };

/**
 * Failed logins per account from any number of IPs: stops a distributed
 * attack on one account. Only failures count. Clients that have logged in to
 * the account before are exempt (but still limited per IP), so other people's
 * failures cannot lock the owner out (ADR-0006).
 */
export const LOGIN_FAILURES_PER_ACCOUNT: RateLimit = { limit: 10, windowMs: WINDOW_MS };

/**
 * How long a client stays known to an account after a successful login from
 * it: as long as a session (ADR-0006).
 */
export const KNOWN_CLIENT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

/** Redis keys of one account's login protection. They hold digests: never an address or an IP. */
export function loginKeys(
  email: string,
  client: string,
): { failures: string; knownClient: string } {
  const account = sha256(email.trim().toLowerCase());
  return {
    failures: `ratelimit:login-failures:account:${account}`,
    knownClient: `ratelimit:login-known:account:${sha256(`${account}|${client}`)}`,
  };
}
