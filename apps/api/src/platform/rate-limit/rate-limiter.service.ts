import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Redis } from 'ioredis';
import type { Env } from '../config/env.schema';
import { describeForLog } from '../http/problem-details.filter';
import { REDIS } from '../redis/redis.module';

/** A fixed-window limit: at most `limit` hits per `windowMs` for one key. */
export interface RateLimit {
  limit: number;
  windowMs: number;
}

export interface WindowState {
  count: number;
  /** Time until the window resets; 0 if the key has no hits. */
  retryAfterMs: number;
}

/** 429 with Retry-After (set by ProblemDetailsFilter). */
export class RateLimitExceededException extends HttpException {
  readonly retryAfterSeconds: number;

  constructor(retryAfterMs: number) {
    super('Too many requests. Try again later.', HttpStatus.TOO_MANY_REQUESTS);
    this.retryAfterSeconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
  }
}

/**
 * Increments the counter and gives it its TTL in one atomic step, so even
 * concurrent first hits never leave a key without an expiry.
 */
const HIT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
return { count, redis.call('PTTL', KEYS[1]) }`;

/**
 * Gives back one hit, only while the window still exists (so an expired key
 * is never recreated without a TTL) and never below zero. DECR keeps the TTL.
 */
const REFUND = `
if redis.call('EXISTS', KEYS[1]) == 1 and tonumber(redis.call('GET', KEYS[1])) > 0 then
  redis.call('DECR', KEYS[1])
end
return { 0, 0 }`;

const MARK = `redis.call('SET', KEYS[1], '1', 'PX', ARGV[1]) return { 1, 0 }`;

const IS_MARKED = `return { redis.call('EXISTS', KEYS[1]), 0 }`;

/**
 * Redis calls give up after this long. ioredis queues commands while
 * disconnected (maxRetriesPerRequest: null, required by BullMQ), so without a
 * bound a request would hang instead of failing.
 */
const REDIS_TIMEOUT_MS = 500;

/**
 * Fixed-window counters in Redis (ADR-0006). When Redis is unavailable this
 * fails closed: callers get 503, never unlimited access to what the limit
 * protects. AUTH_RATE_LIMIT=off (refused in production) turns it into a no-op
 * for test suites about other behaviour.
 */
@Injectable()
export class RateLimiter {
  private readonly logger = new Logger(RateLimiter.name);
  private readonly enabled: boolean;

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    config: ConfigService<Env, true>,
  ) {
    this.enabled = config.get('AUTH_RATE_LIMIT', { infer: true }) === 'on';
  }

  /** Counts a hit and throws 429 once the key is over its limit. */
  async consume(key: string, rule: RateLimit): Promise<void> {
    const state = await this.hit(key, rule.windowMs);
    if (state.count > rule.limit) throw new RateLimitExceededException(state.retryAfterMs);
  }

  /** Counts a hit without enforcing anything. */
  async hit(key: string, windowMs: number): Promise<WindowState> {
    if (!this.enabled) return { count: 0, retryAfterMs: 0 };
    return this.run(HIT, key, String(windowMs));
  }

  /**
   * Returns a hit taken by consume() for an attempt that turned out not to
   * count, such as a successful login against a failures budget.
   */
  async refund(key: string): Promise<void> {
    if (!this.enabled) return;
    await this.run(REFUND, key);
  }

  /** Records a fact for `ttlMs`, such as a client known to an account. */
  async mark(key: string, ttlMs: number): Promise<void> {
    if (!this.enabled) return;
    await this.run(MARK, key, String(ttlMs));
  }

  async isMarked(key: string): Promise<boolean> {
    if (!this.enabled) return false;
    return (await this.run(IS_MARKED, key)).count === 1;
  }

  private async run(script: string, key: string, ...args: string[]): Promise<WindowState> {
    if (this.redis.status !== 'ready')
      throw this.unavailable(new Error(`redis connection is ${this.redis.status}`));
    let timer: NodeJS.Timeout | undefined;
    try {
      const reply = (await Promise.race([
        this.redis.eval(script, 1, key, ...args),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error('redis timed out')), REDIS_TIMEOUT_MS);
        }),
      ])) as [number, number];
      return { count: Number(reply[0]), retryAfterMs: Math.max(0, Number(reply[1])) };
    } catch (error) {
      throw this.unavailable(error);
    } finally {
      clearTimeout(timer);
    }
  }

  private unavailable(cause: unknown): ServiceUnavailableException {
    this.logger.error({ msg: 'rate limiter unavailable', error: describeForLog(cause) });
    return new ServiceUnavailableException(
      'This service is temporarily unavailable. Try again later.',
    );
  }
}
