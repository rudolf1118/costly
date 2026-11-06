import { type CanActivate, type ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { type RateLimit, RateLimiter } from './rate-limiter.service';

export interface RateLimitPolicy extends RateLimit {
  /** Names the counter, e.g. "login"; part of the Redis key. */
  name: string;
}

const RATE_LIMIT_POLICY = Symbol('rateLimitPolicy');

/** Limits a route per client IP; enforced by RateLimitGuard. */
export const RateLimitPerIp = (policy: RateLimitPolicy) => SetMetadata(RATE_LIMIT_POLICY, policy);

/**
 * Counts every request to a @RateLimitPerIp route per client IP, before
 * validation and before the handler, so a rejected request costs a Redis call
 * and nothing more. The IP is Express's req.ip, which only honours
 * X-Forwarded-For for the configured number of trusted proxy hops
 * (TRUST_PROXY, ADR-0006).
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly limiter: RateLimiter,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const policy = this.reflector.get<RateLimitPolicy | undefined>(
      RATE_LIMIT_POLICY,
      context.getHandler(),
    );
    if (!policy) return true;
    const ip = context.switchToHttp().getRequest<Request>().ip ?? 'unknown';
    await this.limiter.consume(`ratelimit:${policy.name}:ip:${ip}`, policy);
    return true;
  }
}
