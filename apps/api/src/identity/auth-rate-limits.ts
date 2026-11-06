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
 * attack on one account. Only failures count, so the owner can still log in
 * after other people's attempts, until they reach the limit themselves.
 */
export const LOGIN_FAILURES_PER_ACCOUNT: RateLimit = { limit: 10, windowMs: WINDOW_MS };

/** The account's Redis key holds a SHA-256 of the normalized email, never the address. */
export function loginFailuresKey(email: string): string {
  const digest = createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
  return `ratelimit:login-failures:account:${digest}`;
}
